"""SIFT-Patrol Phase 1: deterministic pre-processing for edit verification.

Transforms enriched edit records into structured verification questions
that downstream LLM phases can use. Zero model cost — pure Python.
"""

from fetch_patrol_edits import OPERATION_TO_DIFF_TYPE


def make_verification_question(edit):
    """Template a natural-language verification question from an enriched edit.

    Args:
        edit: An enriched edit dict with at minimum 'parsed_edit' containing
            'operation', 'property_label', and 'value_label'. Also uses
            'item.label_en' and 'title' for the item name.

    Returns:
        str: A verification question, or None if parsed_edit is missing.
    """
    parsed = edit.get("parsed_edit")
    if not parsed:
        return None

    operation = parsed.get("operation", "")
    prop_label = parsed.get("property_label") or parsed.get("property", "")
    value_label = parsed.get("value_label") or parsed.get("value_raw", "")

    item_info = edit.get("item") or {}
    item_label = item_info.get("label_en") or edit.get("title", "unknown item")

    # Prefer the refined diff type from the enrichment pipeline (edit_diff.type)
    # which distinguishes reference/qualifier changes from value changes.
    # Fall back to the operation-based mapping for unenriched edits.
    edit_diff = edit.get("edit_diff") or {}
    diff_type = edit_diff.get("type") or OPERATION_TO_DIFF_TYPE.get(
        operation, "unknown"
    )

    if diff_type == "statement_removed":
        return (
            f'Was "{value_label}" correctly removed '
            f'as {prop_label} for {item_label}?'
        )

    if diff_type == "statement_added":
        return (
            f'Is "{value_label}" a correct {prop_label} '
            f"for {item_label}?"
        )

    if diff_type == "value_changed":
        return (
            f'Is "{value_label}" a correct updated {prop_label} '
            f"for {item_label}?"
        )

    if diff_type == "reference_added":
        return (
            f"Does the added reference support the {prop_label} claim "
            f"for {item_label}?"
        )

    if diff_type == "reference_changed":
        return (
            f"Does the updated reference support the {prop_label} claim "
            f"for {item_label}?"
        )

    if diff_type == "reference_removed":
        return (
            f"Was the reference correctly removed from the {prop_label} "
            f"claim for {item_label}?"
        )

    if diff_type == "qualifier_added":
        return (
            f'Is "{value_label}" a correct qualifier for the '
            f"{prop_label} claim on {item_label}?"
        )

    if diff_type == "qualifier_changed":
        return (
            f'Is "{value_label}" a correct updated qualifier for the '
            f"{prop_label} claim on {item_label}?"
        )

    if diff_type == "qualifier_removed":
        return (
            f"Was the qualifier correctly removed from the {prop_label} "
            f"claim for {item_label}?"
        )

    if diff_type == "rank_changed":
        return (
            f"Is the rank change on the {prop_label} claim "
            f"correct for {item_label}?"
        )

    # Fallback for unknown operation types
    return (
        f'Is the edit to {prop_label} ("{value_label}") correct '
        f"for {item_label}?"
    )
