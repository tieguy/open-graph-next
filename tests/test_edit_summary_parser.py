"""Tests for Wikibase edit summary comment parsing."""

from fetch_patrol_edits import parse_edit_summary


class TestParseEditSummary:
    def test_wbsetclaim_update_with_qid(self):
        comment = "/* wbsetclaim-update:2||1 */ [[Property:P106]]: [[Q117321337]]"
        result = parse_edit_summary(comment)
        assert result["operation"] == "wbsetclaim-update"
        assert result["property"] == "P106"
        assert result["value_raw"] == "Q117321337"

    def test_wbcreateclaim_create_with_plain_text(self):
        comment = "/* wbcreateclaim-create:1| */ [[Property:P569]]: 8 March 1952"
        result = parse_edit_summary(comment)
        assert result["operation"] == "wbcreateclaim-create"
        assert result["property"] == "P569"
        assert result["value_raw"] == "8 March 1952"

    def test_wbremoveclaims_remove(self):
        comment = "/* wbremoveclaims-remove:1| */ [[Property:P21]]: [[Q6581097]]"
        result = parse_edit_summary(comment)
        assert result["operation"] == "wbremoveclaims-remove"
        assert result["property"] == "P21"
        assert result["value_raw"] == "Q6581097"

    def test_wbsetclaimvalue(self):
        comment = "/* wbsetclaimvalue:1| */ [[Property:P18]]: Cat.jpg"
        result = parse_edit_summary(comment)
        assert result["operation"] == "wbsetclaimvalue"
        assert result["property"] == "P18"
        assert result["value_raw"] == "Cat.jpg"

    def test_wbsetreference_set(self):
        comment = "/* wbsetreference-set:2| */ [[Property:P248]]: [[Q36578]]"
        result = parse_edit_summary(comment)
        assert result["operation"] == "wbsetreference-set"
        assert result["property"] == "P248"
        assert result["value_raw"] == "Q36578"

    def test_wbsetqualifier_add(self):
        comment = "/* wbsetqualifier-add:1| */ [[Property:P580]]: 1 January 2020"
        result = parse_edit_summary(comment)
        assert result["operation"] == "wbsetqualifier-add"
        assert result["property"] == "P580"
        assert result["value_raw"] == "1 January 2020"

    def test_property_only_no_value(self):
        comment = "/* wbremovequalifiers-remove:1| */ [[Property:P582]]"
        result = parse_edit_summary(comment)
        assert result["operation"] == "wbremovequalifiers-remove"
        assert result["property"] == "P582"
        assert result["value_raw"] is None

    def test_unparseable_comment(self):
        assert parse_edit_summary("some random edit") is None

    def test_empty_comment(self):
        assert parse_edit_summary("") is None

    def test_real_snapshot_comment(self):
        """Test with actual comment from existing snapshot data."""
        comment = "/* wbsetclaim-update:2||1 */ [[Property:P1303]]: [[Q52954]]"
        result = parse_edit_summary(comment)
        assert result["operation"] == "wbsetclaim-update"
        assert result["property"] == "P1303"
        assert result["value_raw"] == "Q52954"
