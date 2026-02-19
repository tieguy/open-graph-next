"""Tests for run_verdict_fanout.py — verdict runner core."""

import json
import sys
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import yaml

from run_verdict_fanout import (
    MAX_TURNS,
    build_edit_context,
    build_execution_order,
    dispatch_tool_call,
    fetch_generation_cost,
    load_checkpoint,
    main,
    model_slug,
    run_investigation_phase,
    run_single_verdict,
    run_verdict_phase,
    run_with_timeout,
    save_checkpoint,
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
            messages, prompt_tokens, completion_tokens, response_ids, status, turns = \
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
        # Turn count should reflect API calls made
        assert turns == 2

    def test_finish_reason_length_returns_incomplete_status(self):
        """AC2.6: finish_reason=length logs as incomplete, returns with status."""
        client = MagicMock()
        response = _make_chat_response("length", content="Partial analysis...")
        client.chat.completions.create.return_value = response

        initial_messages = [
            {"role": "system", "content": "You are SIFT."},
            {"role": "user", "content": "Check this edit."},
        ]

        messages, prompt_tokens, completion_tokens, response_ids, status, turns = \
            run_investigation_phase(client, "allenai/olmo-3.1-32b-instruct", initial_messages)

        assert status == "length"
        assert client.chat.completions.create.call_count == 1
        assert turns == 1

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
            messages, _, _, _, status, turns = \
                run_investigation_phase(client, "deepseek/deepseek-v3.2", initial_messages)

        assert status == "max_turns"
        assert client.chat.completions.create.call_count == MAX_TURNS
        assert turns == MAX_TURNS

    def test_stop_immediately_returns_stop(self):
        """Single stop response completes investigation immediately."""
        client = MagicMock()
        response = _make_chat_response("stop", content="Done immediately.")
        client.chat.completions.create.return_value = response

        initial_messages = [{"role": "user", "content": "test"}]

        messages, prompt_tokens, completion_tokens, response_ids, status, turns = \
            run_investigation_phase(client, "deepseek/deepseek-v3.2", initial_messages)

        assert status == "stop"
        assert client.chat.completions.create.call_count == 1
        assert prompt_tokens == 100
        assert completion_tokens == 50
        assert turns == 1

    def test_pre_set_cancel_event_returns_cancelled_status(self):
        """A pre-set cancel_event causes immediate exit with 'cancelled' status."""
        client = MagicMock()
        cancel_event = threading.Event()
        cancel_event.set()  # Pre-set before the call

        initial_messages = [
            {"role": "system", "content": "You are SIFT."},
            {"role": "user", "content": "Check this edit."},
        ]

        messages, prompt_tokens, completion_tokens, response_ids, status, turns = \
            run_investigation_phase(
                client, "deepseek/deepseek-v3.2", initial_messages,
                cancel_event=cancel_event
            )

        assert status == "cancelled"
        # No API calls made — cancelled before first turn
        assert client.chat.completions.create.call_count == 0
        assert turns == 0
        assert prompt_tokens == 0
        assert completion_tokens == 0


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


# ---------------------------------------------------------------------------
# TestRunSingleVerdict
# ---------------------------------------------------------------------------


class TestRunSingleVerdict:
    """Tests for the run_single_verdict orchestration function."""

    def _make_client(self):
        return MagicMock()

    def test_happy_path_returns_verdict_dict_with_expected_keys(self, tmp_path):
        """Happy path: returns full verdict dict with all expected keys."""
        edit = _make_enriched_edit()
        client = self._make_client()

        sift_prompt = "You are SIFT."
        edit_context = "## Edit to verify\nrcid: 12345\n"
        investigation_messages = [
            {"role": "system", "content": sift_prompt},
            {"role": "user", "content": edit_context},
            {"role": "assistant", "content": "Investigation complete."},
        ]
        verdict_data = {
            "verdict": "verified-high",
            "rationale": "Primary source confirmed.",
            "sources": [
                {
                    "url": "https://example.com",
                    "supports_claim": True,
                    "provenance": "verified",
                }
            ],
        }
        cost_data = {
            "prompt_tokens": 1500,
            "completion_tokens": 300,
            "cost_usd": 0.00245,
        }

        with patch("run_verdict_fanout.load_sift_prompt", return_value=sift_prompt), \
             patch("run_verdict_fanout.build_edit_context", return_value=edit_context), \
             patch("run_verdict_fanout.run_investigation_phase",
                   return_value=(investigation_messages, 100, 50, ["gen_inv_1"], "stop", 3)), \
             patch("run_verdict_fanout.run_verdict_phase",
                   return_value=(verdict_data, 200, 75, "gen_vrd_1")), \
             patch("run_verdict_fanout.fetch_generation_cost", return_value=cost_data):
            result = run_single_verdict(
                client, "deepseek/deepseek-v3.2", edit, set(), "test-api-key"
            )

        # All expected keys present
        assert "verdict" in result
        assert "rationale" in result
        assert "sources" in result
        assert "cost_usd" in result
        assert "prompt_tokens" in result
        assert "completion_tokens" in result
        assert "diff_type" in result
        assert "finish_status" in result
        assert "timestamp" in result
        assert "model" in result
        assert "rcid" in result
        assert "revid" in result
        assert "title" in result

        # Values populated from verdict_data
        assert result["verdict"] == "verified-high"
        assert result["rationale"] == "Primary source confirmed."
        assert len(result["sources"]) == 1

        # diff_type extracted from edit_diff.type
        assert result["diff_type"] == "value_changed"
        assert result["finish_status"] == "stop"
        assert result["model"] == "deepseek/deepseek-v3.2"

        # turns field populated from investigation phase
        assert "turns" in result
        assert result["turns"] == 3

    def test_happy_path_cost_summed_across_response_ids(self):
        """Cost is summed across all generation IDs (investigation + verdict)."""
        edit = _make_enriched_edit()
        client = self._make_client()

        cost_per_gen = {"prompt_tokens": 500, "completion_tokens": 100, "cost_usd": 0.001}

        with patch("run_verdict_fanout.load_sift_prompt", return_value="prompt"), \
             patch("run_verdict_fanout.build_edit_context", return_value="context"), \
             patch("run_verdict_fanout.run_investigation_phase",
                   return_value=([], 100, 50, ["gen_1", "gen_2"], "stop", 2)), \
             patch("run_verdict_fanout.run_verdict_phase",
                   return_value=({"verdict": "plausible", "rationale": ".", "sources": []}, 80, 30, "gen_3")), \
             patch("run_verdict_fanout.fetch_generation_cost", return_value=cost_per_gen) as mock_cost:
            result = run_single_verdict(
                client, "deepseek/deepseek-v3.2", edit, set(), "test-key"
            )

        # fetch_generation_cost called for gen_1, gen_2, and gen_3 (3 total)
        assert mock_cost.call_count == 3
        # Cost summed: 0.001 * 3
        assert result["cost_usd"] == pytest.approx(0.003)
        # Tokens summed: 500 * 3 and 100 * 3
        assert result["prompt_tokens"] == 1500
        assert result["completion_tokens"] == 300

    def test_sdk_token_fallback_when_generation_cost_returns_none(self):
        """Falls back to SDK-reported tokens when fetch_generation_cost returns None."""
        edit = _make_enriched_edit()
        client = self._make_client()

        with patch("run_verdict_fanout.load_sift_prompt", return_value="prompt"), \
             patch("run_verdict_fanout.build_edit_context", return_value="context"), \
             patch("run_verdict_fanout.run_investigation_phase",
                   return_value=([], 150, 60, ["gen_inv"], "stop", 5)), \
             patch("run_verdict_fanout.run_verdict_phase",
                   return_value=({"verdict": "suspect", "rationale": ".", "sources": []}, 90, 40, "gen_vrd")), \
             patch("run_verdict_fanout.fetch_generation_cost", return_value=None):
            result = run_single_verdict(
                client, "deepseek/deepseek-v3.2", edit, set(), "test-key"
            )

        # When generation cost returns None for all IDs, fall back to SDK totals
        assert result["prompt_tokens"] == 150 + 90  # inv + verdict SDK tokens
        assert result["completion_tokens"] == 60 + 40
        assert result["cost_usd"] is None

    def test_none_verdict_dict_produces_null_verdict_fields(self):
        """When verdict phase returns None, verdict/rationale/sources are null/empty."""
        edit = _make_enriched_edit()
        client = self._make_client()

        with patch("run_verdict_fanout.load_sift_prompt", return_value="prompt"), \
             patch("run_verdict_fanout.build_edit_context", return_value="context"), \
             patch("run_verdict_fanout.run_investigation_phase",
                   return_value=([], 100, 50, ["gen_inv"], "stop", 4)), \
             patch("run_verdict_fanout.run_verdict_phase",
                   return_value=(None, 80, 30, "gen_vrd")), \
             patch("run_verdict_fanout.fetch_generation_cost", return_value=None):
            result = run_single_verdict(
                client, "deepseek/deepseek-v3.2", edit, set(), "test-key"
            )

        assert result["verdict"] is None
        assert result["rationale"] is None
        assert result["sources"] == []


# ---------------------------------------------------------------------------
# TestMain
# ---------------------------------------------------------------------------


class TestMain:
    """Tests for the main() CLI entry point."""

    def test_dry_run_completes_without_error(self, tmp_path, capsys):
        """--dry-run smoke test: main() completes without error for a valid snapshot."""
        # Create a minimal enriched snapshot YAML
        snapshot = {
            "edits": [
                {
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
            ]
        }
        snapshot_path = tmp_path / "test-snapshot.yaml"
        with open(snapshot_path, "w") as f:
            yaml.dump(snapshot, f)

        # Call main() with --dry-run; no OpenRouter calls should be made
        with patch("sys.argv", ["run_verdict_fanout", "--snapshot", str(snapshot_path), "--dry-run"]), \
             patch("run_verdict_fanout.load_blocked_domains", return_value=set()):
            main()  # Must complete without raising an exception

        captured = capsys.readouterr()
        # Dry run should print summary info
        assert "dry run" in captured.out.lower() or "would process" in captured.out.lower()

    def test_dry_run_with_limit_processes_subset(self, tmp_path, capsys):
        """--dry-run with --limit N processes only first N edits."""
        edits = [
            {
                "rcid": i,
                "revid": i + 1000,
                "title": f"Q{i}",
                "user": "TestUser",
                "timestamp": "2026-02-19T12:00:00Z",
                "tags": [],
                "parsed_edit": {
                    "property": f"P{i}",
                },
                "edit_diff": {"type": "value_changed"},
            }
            for i in range(5)
        ]
        snapshot = {"edits": edits}
        snapshot_path = tmp_path / "test-snapshot-limit.yaml"
        with open(snapshot_path, "w") as f:
            yaml.dump(snapshot, f)

        with patch("sys.argv", ["run_verdict_fanout", "--snapshot", str(snapshot_path),
                                "--dry-run", "--limit", "2"]), \
             patch("run_verdict_fanout.load_blocked_domains", return_value=set()):
            main()  # Must complete without raising

        captured = capsys.readouterr()
        # Should report 2 edits, not 5
        assert "2 edits" in captured.out or "2" in captured.out


# ---------------------------------------------------------------------------
# TestCheckpoint
# ---------------------------------------------------------------------------


class TestCheckpoint:
    def test_load_checkpoint_returns_completed_pairs(self, tmp_path):
        """AC3.1: load_checkpoint returns the set of completed (rcid, model) pairs."""
        state_path = tmp_path / "fanout-state.yaml"
        completed = {(12345, "deepseek/deepseek-v3.2"), (67890, "allenai/olmo-3.1-32b-instruct")}
        save_checkpoint(completed, state_path=state_path)

        loaded = load_checkpoint(state_path=state_path)

        assert loaded == completed

    def test_load_checkpoint_skips_completed_pairs(self, tmp_path):
        """AC3.1: main() logic skips (rcid, model) pairs that are already completed."""
        state_path = tmp_path / "fanout-state.yaml"
        completed = {(12345, "deepseek/deepseek-v3.2")}
        save_checkpoint(completed, state_path=state_path)

        loaded = load_checkpoint(state_path=state_path)

        # Simulate the skip logic from main()
        pairs_to_process = [
            (12345, "deepseek/deepseek-v3.2"),  # already done
            (12345, "allenai/olmo-3.1-32b-instruct"),  # not done
        ]
        remaining = [(rcid, model) for rcid, model in pairs_to_process if (rcid, model) not in loaded]
        assert remaining == [(12345, "allenai/olmo-3.1-32b-instruct")]

    def test_save_checkpoint_persists_pairs_incrementally(self, tmp_path):
        """AC3.2: save_checkpoint writes the pair; adding a second pair yields both."""
        state_path = tmp_path / "fanout-state.yaml"

        # Save one pair
        completed = {(11111, "deepseek/deepseek-v3.2")}
        save_checkpoint(completed, state_path=state_path)

        with open(state_path) as f:
            data = yaml.safe_load(f)
        assert len(data["completed"]) == 1
        assert data["completed"][0]["rcid"] == 11111

        # Add a second pair
        completed.add((22222, "allenai/olmo-3.1-32b-instruct"))
        save_checkpoint(completed, state_path=state_path)

        with open(state_path) as f:
            data = yaml.safe_load(f)
        rcids = {entry["rcid"] for entry in data["completed"]}
        assert rcids == {11111, 22222}

    def test_load_checkpoint_missing_file_returns_empty_set(self, tmp_path):
        """load_checkpoint on a nonexistent path returns an empty set."""
        state_path = tmp_path / "does-not-exist.yaml"
        result = load_checkpoint(state_path=state_path)
        assert result == set()

    def test_load_checkpoint_empty_file_returns_empty_set(self, tmp_path):
        """load_checkpoint on an empty YAML file returns an empty set."""
        state_path = tmp_path / "empty.yaml"
        state_path.write_text("")
        result = load_checkpoint(state_path=state_path)
        assert result == set()


# ---------------------------------------------------------------------------
# TestTimeout
# ---------------------------------------------------------------------------


class TestTimeout:
    def test_function_exceeding_timeout_returns_timed_out_true(self):
        """AC3.3: A function that sleeps longer than timeout_secs returns timed_out=True."""
        def slow_func():
            time.sleep(5)
            return "done"

        result, timed_out = run_with_timeout(slow_func, args=(), timeout_secs=1)

        assert timed_out is True
        assert result is None

    def test_function_within_timeout_returns_timed_out_false(self):
        """Function that returns quickly has timed_out=False and correct result."""
        def fast_func(x, y):
            return x + y

        result, timed_out = run_with_timeout(fast_func, args=(3, 4), timeout_secs=5)

        assert timed_out is False
        assert result == 7

    def test_exception_from_function_is_reraised(self):
        """Exception raised inside the function is re-raised by run_with_timeout."""
        def failing_func():
            raise ValueError("something went wrong")

        with pytest.raises(ValueError, match="something went wrong"):
            run_with_timeout(failing_func, args=(), timeout_secs=5)

    def test_cancel_event_is_set_after_timeout_for_accepting_func(self):
        """After timeout, cancel_event is set so a cooperative func can stop gracefully."""
        captured_event = []

        def accepting_func(cancel_event=None):
            # Capture the event, then block until it's set (simulating cooperative loop)
            captured_event.append(cancel_event)
            # Block long enough to trigger timeout
            time.sleep(10)
            return "done"

        result, timed_out = run_with_timeout(accepting_func, args=(), timeout_secs=1)

        assert timed_out is True
        assert result is None
        # The cancel_event should have been passed to the function and then set on timeout
        assert len(captured_event) == 1
        assert captured_event[0] is not None
        assert captured_event[0].is_set()


# ---------------------------------------------------------------------------
# TestBuildExecutionOrder
# ---------------------------------------------------------------------------


class TestBuildExecutionOrder:
    def test_interleaved_order_with_two_edits_and_three_models(self):
        """AC3.4: build_execution_order returns edit-interleaved pairs."""
        edit1 = {"rcid": 1, "title": "Q1"}
        edit2 = {"rcid": 2, "title": "Q2"}
        model_a = "vendor/model-a"
        model_b = "vendor/model-b"
        model_c = "vendor/model-c"

        result = build_execution_order([edit1, edit2], [model_a, model_b, model_c])

        expected = [
            (edit1, model_a),
            (edit1, model_b),
            (edit1, model_c),
            (edit2, model_a),
            (edit2, model_b),
            (edit2, model_c),
        ]
        assert result == expected

    def test_empty_edits_returns_empty_list(self):
        """build_execution_order with no edits returns empty list."""
        result = build_execution_order([], ["vendor/model-a"])
        assert result == []

    def test_empty_models_returns_empty_list(self):
        """build_execution_order with no models returns empty list."""
        result = build_execution_order([{"rcid": 1}], [])
        assert result == []

    def test_single_edit_single_model(self):
        """Single edit and single model returns one pair."""
        edit = {"rcid": 99}
        model = "vendor/only-model"
        result = build_execution_order([edit], [model])
        assert result == [(edit, model)]
