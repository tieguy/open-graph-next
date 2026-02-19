"""Tests for SIFT-Patrol Phase 1 pre-processing."""

from sift_precheck import check_ontological_consistency, make_verification_question


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


def _make_ontological_edit(prop, value_raw, value_label=None,
                           existing_p31=None, existing_p279=None):
    """Build an enriched edit for ontological consistency testing."""
    claims = {}
    if existing_p31:
        claims["P31"] = {
            "statements": [{"value": qid} for qid in existing_p31]
        }
    if existing_p279:
        claims["P279"] = {
            "statements": [{"value": qid} for qid in existing_p279]
        }
    return {
        "title": "Q12345",
        "parsed_edit": {
            "operation": "wbsetclaim-create",
            "property": prop,
            "property_label": "instance of" if prop == "P31" else "subclass of",
            "value_raw": value_raw,
            "value_label": value_label or value_raw,
        },
        "item": {
            "label_en": "Test Item",
            "claims": claims,
        },
    }


class TestCheckOntologicalConsistency:
    """Tests for check_ontological_consistency()."""

    def test_no_warnings_for_normal_p31(self):
        edit = _make_ontological_edit("P31", "Q5", "human")
        assert check_ontological_consistency(edit) == []

    def test_no_warnings_for_non_ontological_property(self):
        edit = _make_edit("wbsetclaim-create", "employer", "Acme Corp",
                          "Some Person")
        assert check_ontological_consistency(edit) == []

    def test_warns_known_bad_p31_value(self):
        # Person item getting P31 = external identifier
        edit = _make_ontological_edit(
            "P31", "Q19847637", "Wikidata property type for external identifier",
            existing_p31=["Q5"],
        )
        warnings = check_ontological_consistency(edit)
        assert len(warnings) == 1
        assert "internal type" in warnings[0]

    def test_warns_p279_on_person_instance(self):
        # P279 (subclass of) used on a human instance
        edit = _make_ontological_edit(
            "P279", "Q515", "city",
            existing_p31=["Q5"],
        )
        warnings = check_ontological_consistency(edit)
        assert len(warnings) == 1
        assert "P279" in warnings[0]
        assert "classes, not instances" in warnings[0]

    def test_warns_p31_human_on_class_item(self):
        # Setting P31=human on an item that already has P279 (is a class)
        edit = _make_ontological_edit(
            "P31", "Q5", "human",
            existing_p279=["Q7397"],  # software
        )
        warnings = check_ontological_consistency(edit)
        assert len(warnings) == 1
        assert "class" in warnings[0]

    def test_no_warning_for_p279_on_non_person(self):
        # P279 on a class item (no P31=Q5) is fine
        edit = _make_ontological_edit(
            "P279", "Q7397", "software",
            existing_p31=["Q35120"],  # entity
        )
        warnings = check_ontological_consistency(edit)
        assert warnings == []

    def test_multiple_warnings(self):
        # Known-bad value + P279 on person = two warnings
        edit = _make_ontological_edit(
            "P279", "Q19847637", "external identifier",
            existing_p31=["Q5"],
        )
        warnings = check_ontological_consistency(edit)
        assert len(warnings) == 2

    def test_warnings_appended_to_verification_question(self):
        edit = _make_ontological_edit(
            "P31", "Q19847637", "external identifier",
            existing_p31=["Q5"],
        )
        question = make_verification_question(edit)
        assert "WARNING" in question
        assert 'Is "external identifier"' in question

    def test_no_item_claims_no_crash(self):
        # Minimal edit with no item claims should not crash
        edit = _make_ontological_edit("P31", "Q5", "human")
        edit["item"]["claims"] = {}
        assert check_ontological_consistency(edit) == []

    def test_no_item_no_crash(self):
        edit = {
            "title": "Q12345",
            "parsed_edit": {
                "operation": "wbsetclaim-create",
                "property": "P31",
                "property_label": "instance of",
                "value_raw": "Q19847637",
                "value_label": "external identifier",
            },
        }
        warnings = check_ontological_consistency(edit)
        # Should still warn about known-bad value even without item context
        assert len(warnings) == 1
