"""Tests for SIFT-Patrol Phase 1 pre-processing."""

from sift_precheck import make_verification_question


def _make_edit(operation, property_label, value_label, item_label=None,
               title="Q12345"):
    """Build a minimal enriched edit for testing."""
    edit = {
        "title": title,
        "parsed_edit": {
            "operation": operation,
            "property": "P106",
            "property_label": property_label,
            "value_raw": "Q999",
            "value_label": value_label,
        },
    }
    if item_label:
        edit["item"] = {"label_en": item_label}
    return edit


class TestMakeVerificationQuestion:
    """Tests for make_verification_question()."""

    def test_statement_added(self):
        edit = _make_edit("wbsetclaim-create", "occupation",
                          "singer-songwriter", "Douglas Adams")
        result = make_verification_question(edit)
        assert result == (
            'Is "singer-songwriter" a correct occupation '
            'for Douglas Adams?'
        )

    def test_statement_added_createclaim(self):
        edit = _make_edit("wbcreateclaim-create", "occupation",
                          "physicist", "Albert Einstein")
        result = make_verification_question(edit)
        assert result == (
            'Is "physicist" a correct occupation '
            'for Albert Einstein?'
        )

    def test_statement_removed(self):
        edit = _make_edit("wbremoveclaims-remove", "sex or gender",
                          "male", "Jane Doe")
        result = make_verification_question(edit)
        assert result == (
            'Was "male" correctly removed '
            'as sex or gender for Jane Doe?'
        )

    def test_value_changed(self):
        edit = _make_edit("wbsetclaim-update", "employer",
                          "State Biotechnological University",
                          "Serhii Rieznik")
        result = make_verification_question(edit)
        assert result == (
            'Is "State Biotechnological University" a correct updated '
            'employer for Serhii Rieznik?'
        )

    def test_value_changed_setclaimvalue(self):
        edit = _make_edit("wbsetclaimvalue", "date of birth",
                          "1952-03-11", "Douglas Adams")
        result = make_verification_question(edit)
        assert result == (
            'Is "1952-03-11" a correct updated date of birth '
            'for Douglas Adams?'
        )

    def test_reference_added(self):
        edit = _make_edit("wbsetreference-add", "occupation",
                          "https://example.com", "Douglas Adams")
        result = make_verification_question(edit)
        assert result == (
            'Does the added reference support the occupation claim '
            'for Douglas Adams?'
        )

    def test_reference_changed(self):
        edit = _make_edit("wbsetreference-set", "occupation",
                          "https://example.com", "Douglas Adams")
        result = make_verification_question(edit)
        assert result == (
            'Does the updated reference support the occupation claim '
            'for Douglas Adams?'
        )

    def test_reference_removed(self):
        edit = _make_edit("wbremovereferences-remove", "occupation",
                          "https://example.com", "Douglas Adams")
        result = make_verification_question(edit)
        assert result == (
            'Was the reference correctly removed from the occupation '
            'claim for Douglas Adams?'
        )

    def test_qualifier_added(self):
        edit = _make_edit("wbsetqualifier-add", "employer",
                          "2023", "Serhii Rieznik")
        result = make_verification_question(edit)
        assert result == (
            'Is "2023" a correct qualifier for the '
            'employer claim on Serhii Rieznik?'
        )

    def test_qualifier_changed(self):
        edit = _make_edit("wbsetqualifier-update", "employer",
                          "2024", "Serhii Rieznik")
        result = make_verification_question(edit)
        assert result == (
            'Is "2024" a correct updated qualifier for the '
            'employer claim on Serhii Rieznik?'
        )

    def test_qualifier_removed(self):
        edit = _make_edit("wbremovequalifiers-remove", "employer",
                          "2023", "Serhii Rieznik")
        result = make_verification_question(edit)
        assert result == (
            'Was the qualifier correctly removed from the employer '
            'claim for Serhii Rieznik?'
        )

    def test_unknown_operation_fallback(self):
        edit = _make_edit("wbsomething-new", "occupation",
                          "painter", "Picasso")
        result = make_verification_question(edit)
        assert result == (
            'Is the edit to occupation ("painter") correct '
            'for Picasso?'
        )

    def test_no_parsed_edit_returns_none(self):
        edit = {"title": "Q12345"}
        result = make_verification_question(edit)
        assert result is None

    def test_falls_back_to_title_when_no_item_label(self):
        edit = _make_edit("wbsetclaim-create", "occupation",
                          "scientist")
        # No item dict, should fall back to title
        result = make_verification_question(edit)
        assert "Q12345" in result

    def test_falls_back_to_property_id_when_no_label(self):
        edit = {
            "title": "Q12345",
            "parsed_edit": {
                "operation": "wbsetclaim-create",
                "property": "P106",
                "property_label": None,
                "value_raw": "Q999",
                "value_label": "scientist",
            },
            "item": {"label_en": "Some Person"},
        }
        result = make_verification_question(edit)
        assert "P106" in result

    def test_falls_back_to_value_raw_when_no_value_label(self):
        edit = {
            "title": "Q12345",
            "parsed_edit": {
                "operation": "wbsetclaim-create",
                "property": "P106",
                "property_label": "occupation",
                "value_raw": "Q117321337",
                "value_label": None,
            },
            "item": {"label_en": "Some Person"},
        }
        result = make_verification_question(edit)
        assert "Q117321337" in result

    def test_refined_diff_type_from_edit_diff(self):
        """edit_diff.type should override operation-based diff type."""
        edit = _make_edit("wbsetclaim-update", "date of birth",
                          "1986", "Terry Blade")
        # Without edit_diff, wbsetclaim-update maps to value_changed
        assert "correct updated" in make_verification_question(edit)

        # With refined edit_diff.type = reference_added
        edit["edit_diff"] = {"type": "reference_added"}
        result = make_verification_question(edit)
        assert result == (
            "Does the added reference support the date of birth claim "
            "for Terry Blade?"
        )

    def test_rank_changed(self):
        edit = _make_edit("wbsetclaim-update", "date of birth",
                          "1986", "Terry Blade")
        edit["edit_diff"] = {"type": "rank_changed"}
        result = make_verification_question(edit)
        assert result == (
            "Is the rank change on the date of birth claim "
            "correct for Terry Blade?"
        )

    def test_real_snapshot_edit(self):
        """Test with a structure matching the real snapshot data."""
        edit = {
            "rcid": 2540426022,
            "revid": 2464238434,
            "old_revid": 2464237910,
            "title": "Q138332576",
            "user": "Serhey0211994",
            "timestamp": "2026-02-17T20:31:27Z",
            "comment": "/* wbsetclaim-update:2||1|1 */ "
                       "[[Property:P108]]: [[Q124375837]]",
            "tags": ["new editor changing statement", "wikidata-ui"],
            "parsed_edit": {
                "operation": "wbsetclaim-update",
                "property": "P108",
                "property_label": "employer",
                "value_raw": "Q124375837",
                "value_label": "State Biotechnological University",
            },
            "item": {
                "label_en": "Serhii Rieznik",
                "description_en": "Ukrainian soil scientist",
                "claims": {},
            },
            "removed_claim": None,
        }
        result = make_verification_question(edit)
        assert result == (
            'Is "State Biotechnological University" a correct updated '
            'employer for Serhii Rieznik?'
        )
