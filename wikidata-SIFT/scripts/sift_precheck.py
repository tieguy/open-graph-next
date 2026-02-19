"""SIFT-Patrol Phase 1: deterministic pre-processing for edit verification.

Transforms enriched edit records into structured verification questions
that downstream LLM phases can use. Zero model cost — pure Python.
"""

from fetch_patrol_edits import OPERATION_TO_DIFF_TYPE

# Well-known P31 classes that indicate a person/human entity.
_HUMAN_CLASSES = {"Q5", "Q15632617"}  # human, fictional human

# P31/P279 values that are obviously wrong on a person item.
_NOT_PERSON_VALUES = {
    "Q6545185",    # external identifier
    "Q19847637",   # Wikidata property type "external-identifier"
    "Q18616576",   # Wikidata property
    "Q29934200",   # Wikidata property for items about people
}


def check_ontological_consistency(edit):
    """Flag obvious P31/P279 mismatches on enriched edits.

    Returns a list of warning strings (empty if no issues found).
    Checks performed:
    - Person item getting P31 set to a non-person class
    - P279 (subclass of) used on an instance (not a class) item
    - Known-bad P31 values (external identifier on a person, etc.)
    """
    warnings = []
    parsed = edit.get("parsed_edit") or {}
    prop = parsed.get("property", "")
    value_raw = parsed.get("value_raw", "")
    value_label = parsed.get("value_label", "")

    if prop not in ("P31", "P279"):
        return warnings

    item = edit.get("item") or {}
    claims = item.get("claims") or {}

    # Collect existing P31 values for this item
    existing_p31 = set()
    for stmt in claims.get("P31", {}).get("statements", []):
        v = stmt.get("value", "")
        if isinstance(v, str) and v.startswith("Q"):
            existing_p31.add(v)

    is_person = bool(existing_p31 & _HUMAN_CLASSES)

    # Check: known-bad values on any item
    if value_raw in _NOT_PERSON_VALUES:
        warnings.append(
            f'WARNING: "{value_label or value_raw}" is a Wikidata '
            f"internal type, not a valid {prop} classification for an entity."
        )

    # Check: P279 used on an instance (person or other non-class item)
    if prop == "P279" and is_person:
        warnings.append(
            "WARNING: P279 (subclass of) is being used on an item that is "
            "an instance of human (Q5). P279 is for classes, not instances. "
            "This is almost certainly an error."
        )

    # Check: P31 set to human/Homo sapiens on a class item that has P279
    if prop == "P31" and value_raw in _HUMAN_CLASSES:
        existing_p279 = claims.get("P279", {}).get("statements", [])
        if existing_p279:
            warnings.append(
                "WARNING: P31 is being set to human (Q5) on an item that "
                "already has P279 (subclass of) claims, suggesting it is a "
                "class, not an instance. Classes should not be instances of human."
            )

    return warnings


def make_verification_question(edit):
    """Template a natural-language verification question from an enriched edit.

    Args:
        edit: An enriched edit dict with at minimum 'parsed_edit' containing
            'operation', 'property_label', and 'value_label'. Also uses
            'item.label_en' and 'title' for the item name.

    Returns:
        str: A verification question (with ontological warnings appended
        if any are detected), or None if parsed_edit is missing.
    """
    parsed = edit.get("parsed_edit")
    if not parsed:
        return None

    question = _build_question(edit, parsed)
    warnings = check_ontological_consistency(edit)
    if warnings:
        question = question + "\n\n" + "\n".join(warnings)
    return question


def _build_question(edit, parsed):
    """Build the core verification question string."""
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
