"""Tests for run_verdict_fanout.py — verdict runner core."""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import yaml

from run_verdict_fanout import (
    MAX_TURNS,
    build_edit_context,
    dispatch_tool_call,
    fetch_generation_cost,
    model_slug,
    run_investigation_phase,
    run_verdict_phase,
    save_verdict,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _skip_rate_limit(monkeypatch):
    monkeypatch.setattr("tool_executor._rate_limit", lambda: None)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_enriched_edit(**overrides):
    """Build a minimal enriched edit dict for testing."""
    edit = {
        "rcid": 12345,
        "revid": 67890,
        "title": "Q42",
        "user": "TestUser",
        "timestamp": "2026-02-19T12:00:00Z",
        "tags": [],
        "parsed_edit": {
            "operation": "wbsetclaim-update",
            "property": "P569",
            "property_label": "date of birth",
            "value_raw": "+1952-03-11T00:00:00Z/11",
            "value_label": "11 March 1952",
        },
        "edit_diff": {"type": "value_changed"},
        "item": {"label_en": "Douglas Adams", "claims": {}},
    }
    edit.update(overrides)
    return edit


def _make_tool_call(name, arguments, call_id="call_123"):
    """Build a mock tool call object."""
    tc = MagicMock()
    tc.id = call_id
    tc.function.name = name
    tc.function.arguments = json.dumps(arguments)
    return tc


def _make_chat_response(finish_reason, content=None, tool_calls=None, response_id="gen_abc"):
    """Build a mock OpenAI chat completion response."""
    response = MagicMock()
    response.id = response_id

    choice = MagicMock()
    choice.finish_reason = finish_reason
    choice.message.content = content
    choice.message.tool_calls = tool_calls or []

    response.choices = [choice]

    usage = MagicMock()
    usage.prompt_tokens = 100
    usage.completion_tokens = 50
    response.usage = usage

    return response


# ---------------------------------------------------------------------------
# TestModelSlug
# ---------------------------------------------------------------------------


class TestModelSlug:
    def test_extracts_last_segment(self):
        assert model_slug("deepseek/deepseek-v3.2") == "deepseek-v3.2"

    def test_single_segment(self):
        assert model_slug("mymodel") == "mymodel"

    def test_multi_segment(self):
        assert model_slug("org/subgroup/model-name") == "model-name"


# ---------------------------------------------------------------------------
# TestDispatchToolCall
# ---------------------------------------------------------------------------


class TestDispatchToolCall:
    def test_malformed_json_returns_error_string(self):
        """AC2.4: Malformed tool call arguments return error string without crash."""
        tc = MagicMock()
        tc.id = "call_123"
        tc.function.name = "web_search"
        tc.function.arguments = "not json"

        result = dispatch_tool_call(tc)

        assert isinstance(result, str)
        assert "error" in result.lower()
        # No exception raised — function returns gracefully

    def test_unknown_tool_returns_error_listing_valid_tools(self):
        """AC2.5: Unknown tool names return error listing valid tools."""
        tc = _make_tool_call("unknown_tool", {"foo": "bar"})

        result = dispatch_tool_call(tc)

        assert isinstance(result, str)
        assert "unknown_tool" in result
        assert "web_search" in result
        assert "web_fetch" in result

    def test_successful_web_search_dispatch(self):
        """Successful dispatch to web_search calls function with correct args."""
        tc = _make_tool_call("web_search", {"query": "Douglas Adams birthdate"})
        mock_results = [{"title": "Test", "url": "https://example.com", "snippet": "info"}]

        with patch("run_verdict_fanout.web_search", return_value=mock_results) as mock_ws:
            result = dispatch_tool_call(tc)

        mock_ws.assert_called_once_with("Douglas Adams birthdate", blocked_domains=set())
        parsed = json.loads(result)
        assert parsed == mock_results

    def test_successful_web_fetch_dispatch(self):
        """Successful dispatch to web_fetch calls function with correct args."""
        tc = _make_tool_call("web_fetch", {"url": "https://example.com/page"})
        mock_text = "Article content here."

        with patch("run_verdict_fanout.web_fetch", return_value=mock_text) as mock_wf:
            result = dispatch_tool_call(tc)

        mock_wf.assert_called_once_with("https://example.com/page", blocked_domains=set())
        assert result == mock_text

    def test_tool_exception_returns_error_string(self):
        """Exception from tool function is caught and returned as error string."""
        tc = _make_tool_call("web_search", {"query": "test"})

        with patch("run_verdict_fanout.web_search", side_effect=RuntimeError("connection failed")):
            result = dispatch_tool_call(tc)

        assert isinstance(result, str)
        assert "error" in result.lower()

    def test_blocked_domains_passed_to_web_search(self):
        """Blocked domains are forwarded to web_search."""
        tc = _make_tool_call("web_search", {"query": "test"})
        blocked = {"wikipedia.org", "imdb.com"}

        with patch("run_verdict_fanout.web_search", return_value=[]) as mock_ws:
            dispatch_tool_call(tc, blocked_domains=blocked)

        mock_ws.assert_called_once_with("test", blocked_domains=blocked)

    def test_blocked_domains_passed_to_web_fetch(self):
        """Blocked domains are forwarded to web_fetch."""
        tc = _make_tool_call("web_fetch", {"url": "https://example.com"})
        blocked = {"wikipedia.org"}

        with patch("run_verdict_fanout.web_fetch", return_value="text") as mock_wf:
            dispatch_tool_call(tc, blocked_domains=blocked)

        mock_wf.assert_called_once_with("https://example.com", blocked_domains=blocked)


# ---------------------------------------------------------------------------
# TestRunInvestigationPhase
# ---------------------------------------------------------------------------


class TestRunInvestigationPhase:
    def test_tool_calls_then_stop_completes_investigation(self):
        """AC2.1: Investigation loop handles tool_calls followed by stop."""
        client = MagicMock()
        tool_call = _make_tool_call("web_search", {"query": "test"})

        first_response = _make_chat_response("tool_calls", tool_calls=[tool_call])
        second_response = _make_chat_response("stop", content="Investigation complete.")

        client.chat.completions.create.side_effect = [first_response, second_response]

        initial_messages = [
            {"role": "system", "content": "You are SIFT."},
            {"role": "user", "content": "Check this edit."},
        ]

        with patch("run_verdict_fanout.web_search", return_value=[{"title": "T", "url": "http://x.com", "snippet": "s"}]):
            messages, prompt_tokens, completion_tokens, response_ids, status = \
                run_investigation_phase(client, "deepseek/deepseek-v3.2", initial_messages)

        assert status == "stop"
        # Should have called the API twice
        assert client.chat.completions.create.call_count == 2
        # Messages should include tool result
        roles = [m["role"] if isinstance(m, dict) else m.role for m in messages]
        assert "tool" in roles
        # Token counts should be cumulative
        assert prompt_tokens == 200  # 100 + 100
        assert completion_tokens == 100  # 50 + 50

    def test_finish_reason_length_returns_incomplete_status(self):
        """AC2.6: finish_reason=length logs as incomplete, returns with status."""
        client = MagicMock()
        response = _make_chat_response("length", content="Partial analysis...")
        client.chat.completions.create.return_value = response

        initial_messages = [
            {"role": "system", "content": "You are SIFT."},
            {"role": "user", "content": "Check this edit."},
        ]

        messages, prompt_tokens, completion_tokens, response_ids, status = \
            run_investigation_phase(client, "allenai/olmo-3.1-32b-instruct", initial_messages)

        assert status == "length"
        assert client.chat.completions.create.call_count == 1

    def test_max_turns_enforcement(self):
        """Loop stops after MAX_TURNS iterations even with repeated tool_calls."""
        client = MagicMock()

        # Always return tool_calls
        def make_tool_response(*args, **kwargs):
            tc = _make_tool_call("web_search", {"query": "test"})
            return _make_chat_response("tool_calls", tool_calls=[tc])

        client.chat.completions.create.side_effect = make_tool_response

        initial_messages = [
            {"role": "system", "content": "system"},
            {"role": "user", "content": "user"},
        ]

        with patch("run_verdict_fanout.web_search", return_value=[]):
            messages, _, _, _, status = \
                run_investigation_phase(client, "deepseek/deepseek-v3.2", initial_messages)

        assert status == "max_turns"
        assert client.chat.completions.create.call_count == MAX_TURNS

    def test_stop_immediately_returns_stop(self):
        """Single stop response completes investigation immediately."""
        client = MagicMock()
        response = _make_chat_response("stop", content="Done immediately.")
        client.chat.completions.create.return_value = response

        initial_messages = [{"role": "user", "content": "test"}]

        messages, prompt_tokens, completion_tokens, response_ids, status = \
            run_investigation_phase(client, "deepseek/deepseek-v3.2", initial_messages)

        assert status == "stop"
        assert client.chat.completions.create.call_count == 1
        assert prompt_tokens == 100
        assert completion_tokens == 50


# ---------------------------------------------------------------------------
# TestRunVerdictPhase
# ---------------------------------------------------------------------------


class TestRunVerdictPhase:
    def test_valid_verdict_json_returned(self):
        """AC2.2: Verdict JSON contains verdict, rationale, and sources."""
        client = MagicMock()
        verdict_content = json.dumps({
            "verdict": "verified-high",
            "rationale": "Strong primary source confirms the claim.",
            "sources": [
                {
                    "url": "https://example.com/source",
                    "supports_claim": True,
                    "provenance": "verified",
                }
            ],
        })
        response = _make_chat_response("stop", content=verdict_content)
        client.chat.completions.create.return_value = response

        messages = [
            {"role": "system", "content": "system"},
            {"role": "assistant", "content": "investigation done"},
        ]

        verdict_dict, prompt_tokens, completion_tokens, response_id = \
            run_verdict_phase(client, "deepseek/deepseek-v3.2", messages)

        assert verdict_dict is not None
        assert verdict_dict["verdict"] == "verified-high"
        assert "rationale" in verdict_dict
        assert "sources" in verdict_dict
        assert isinstance(verdict_dict["sources"], list)

    def test_invalid_json_response_returns_none(self):
        """Invalid JSON in verdict phase returns None gracefully."""
        client = MagicMock()
        response = _make_chat_response("stop", content="This is not JSON at all!")
        client.chat.completions.create.return_value = response

        messages = [{"role": "user", "content": "test"}]

        verdict_dict, _, _, _ = run_verdict_phase(client, "deepseek/deepseek-v3.2", messages)

        assert verdict_dict is None

    def test_verdict_message_appended_to_messages(self):
        """Verdict request message is appended before sending."""
        client = MagicMock()
        verdict_content = json.dumps({
            "verdict": "unverifiable",
            "rationale": "Could not find sources.",
            "sources": [],
        })
        response = _make_chat_response("stop", content=verdict_content)
        client.chat.completions.create.return_value = response

        messages = [{"role": "user", "content": "initial"}]

        run_verdict_phase(client, "deepseek/deepseek-v3.2", messages)

        # The call should include a user message with the verdict request
        call_args = client.chat.completions.create.call_args
        sent_messages = call_args[1]["messages"]
        assert len(sent_messages) > len(messages)
        last_msg = sent_messages[-1]
        assert last_msg["role"] == "user"
        assert "verdict" in last_msg["content"].lower() or "json" in last_msg["content"].lower()

    def test_token_counts_returned(self):
        """Token counts from verdict phase response are returned."""
        client = MagicMock()
        verdict_content = json.dumps({
            "verdict": "plausible",
            "rationale": "Maybe.",
            "sources": [],
        })
        response = _make_chat_response("stop", content=verdict_content, response_id="gen_verdict")
        response.usage.prompt_tokens = 200
        response.usage.completion_tokens = 75
        client.chat.completions.create.return_value = response

        messages = [{"role": "user", "content": "test"}]

        _, prompt_tokens, completion_tokens, response_id = \
            run_verdict_phase(client, "deepseek/deepseek-v3.2", messages)

        assert prompt_tokens == 200
        assert completion_tokens == 75
        assert response_id == "gen_verdict"


# ---------------------------------------------------------------------------
# TestFetchGenerationCost
# ---------------------------------------------------------------------------


class TestFetchGenerationCost:
    def test_extracts_cost_from_generation_endpoint(self):
        """AC2.3: Cost data extracted from generation endpoint response."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": {
                "native_tokens_prompt": 1500,
                "native_tokens_completion": 300,
                "total_cost": 0.00245,
            }
        }

        with patch("run_verdict_fanout.httpx.get", return_value=mock_response), \
             patch("run_verdict_fanout.time.sleep"):
            result = fetch_generation_cost("gen_abc123", "test-api-key")

        assert result is not None
        assert result["prompt_tokens"] == 1500
        assert result["completion_tokens"] == 300
        assert result["cost_usd"] == pytest.approx(0.00245)

    def test_non_200_response_returns_none(self):
        """Non-200 response from generation endpoint returns None."""
        mock_response = MagicMock()
        mock_response.status_code = 404

        with patch("run_verdict_fanout.httpx.get", return_value=mock_response), \
             patch("run_verdict_fanout.time.sleep"):
            result = fetch_generation_cost("gen_missing", "test-api-key")

        assert result is None

    def test_uses_bearer_auth_header(self):
        """Request uses Bearer token in Authorization header."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"data": {}}

        with patch("run_verdict_fanout.httpx.get", return_value=mock_response) as mock_get, \
             patch("run_verdict_fanout.time.sleep"):
            fetch_generation_cost("gen_test", "my-secret-key")

        call_kwargs = mock_get.call_args[1]
        assert call_kwargs["headers"]["Authorization"] == "Bearer my-secret-key"

    def test_sleep_called_before_request(self):
        """Brief delay before hitting generation endpoint."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"data": {}}

        with patch("run_verdict_fanout.httpx.get", return_value=mock_response), \
             patch("run_verdict_fanout.time.sleep") as mock_sleep:
            fetch_generation_cost("gen_test", "key")

        mock_sleep.assert_called_once_with(0.5)


# ---------------------------------------------------------------------------
# TestSaveVerdict
# ---------------------------------------------------------------------------


class TestSaveVerdict:
    def test_creates_yaml_file_at_expected_path(self, tmp_path):
        """save_verdict creates a YAML file with correct filename format."""
        edit = _make_enriched_edit()
        verdict = {
            "timestamp": "2026-02-19T12:00:00+00:00",
            "model": "deepseek/deepseek-v3.2",
            "verdict": "verified-high",
            "rationale": "Confirmed by source.",
            "sources": [],
        }

        out_path = save_verdict(verdict, edit, "deepseek/deepseek-v3.2", verdict_dir=tmp_path)

        assert out_path.exists()
        assert out_path.suffix == ".yaml"
        # Filename contains QID, property, and model slug
        assert "Q42" in out_path.name
        assert "P569" in out_path.name
        assert "deepseek-v3.2" in out_path.name

    def test_yaml_content_matches_verdict_data(self, tmp_path):
        """YAML content matches the verdict dict."""
        edit = _make_enriched_edit()
        verdict = {
            "timestamp": "2026-02-19T12:00:00+00:00",
            "model": "deepseek/deepseek-v3.2",
            "verdict": "incorrect",
            "rationale": "Source contradicts claim.",
            "sources": [
                {
                    "url": "https://example.com/source",
                    "supports_claim": False,
                    "provenance": "verified",
                }
            ],
        }

        out_path = save_verdict(verdict, edit, "deepseek/deepseek-v3.2", verdict_dir=tmp_path)

        with open(out_path) as f:
            loaded = yaml.safe_load(f)

        assert loaded["verdict"] == "incorrect"
        assert loaded["rationale"] == "Source contradicts claim."
        assert len(loaded["sources"]) == 1
        assert loaded["sources"][0]["url"] == "https://example.com/source"

    def test_creates_verdict_dir_if_not_exists(self, tmp_path):
        """save_verdict creates the verdict directory if it doesn't exist."""
        nested_dir = tmp_path / "deep" / "nested" / "dir"
        edit = _make_enriched_edit()
        verdict = {"verdict": "plausible", "rationale": ".", "sources": []}

        out_path = save_verdict(verdict, edit, "deepseek/deepseek-v3.2", verdict_dir=nested_dir)

        assert out_path.exists()
        assert nested_dir.is_dir()


# ---------------------------------------------------------------------------
# TestBuildEditContext
# ---------------------------------------------------------------------------


class TestBuildEditContext:
    def test_includes_verification_question(self):
        """build_edit_context includes the verification question."""
        edit = _make_enriched_edit()

        with patch("run_verdict_fanout.make_verification_question", return_value="Is 11 March 1952 correct?") as mock_q, \
             patch("run_verdict_fanout.check_ontological_consistency", return_value=[]):
            context = build_edit_context(edit)

        mock_q.assert_called_once_with(edit)
        assert "Is 11 March 1952 correct?" in context

    def test_includes_ontological_warnings(self):
        """build_edit_context includes ontological warnings when present."""
        edit = _make_enriched_edit()
        warning = "WARNING: P279 used on an instance item."

        with patch("run_verdict_fanout.make_verification_question", return_value="Question?"), \
             patch("run_verdict_fanout.check_ontological_consistency", return_value=[warning]):
            context = build_edit_context(edit)

        assert warning in context

    def test_includes_item_context_when_present(self):
        """Item context is serialized into the message."""
        edit = _make_enriched_edit()

        with patch("run_verdict_fanout.make_verification_question", return_value="Q?"), \
             patch("run_verdict_fanout.check_ontological_consistency", return_value=[]):
            context = build_edit_context(edit)

        # The item label should appear in the context
        assert "Douglas Adams" in context

    def test_includes_parsed_edit(self):
        """Parsed edit is included in the context."""
        edit = _make_enriched_edit()

        with patch("run_verdict_fanout.make_verification_question", return_value="Q?"), \
             patch("run_verdict_fanout.check_ontological_consistency", return_value=[]):
            context = build_edit_context(edit)

        assert "P569" in context or "date of birth" in context

    def test_no_warnings_when_none(self):
        """Context does not contain WARNING when no issues found."""
        edit = _make_enriched_edit()

        with patch("run_verdict_fanout.make_verification_question", return_value="Normal question."), \
             patch("run_verdict_fanout.check_ontological_consistency", return_value=[]):
            context = build_edit_context(edit)

        assert "WARNING" not in context
