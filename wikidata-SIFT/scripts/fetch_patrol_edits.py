#!/usr/bin/env python3
"""Fetch unpatrolled and autopatrolled statement edits from production Wikidata.

Saves raw edit metadata as YAML snapshots for reproducible analysis.

Unpatrolled edits are identified by "new editor" tags (these edits are from
non-autoconfirmed users whose edits require patrol review). Control edits are
statement edits by established users (autopatrolled by definition).

HTTP Architecture
-----------------
All Wikidata API requests go through pywikibot, inheriting its authenticated
session, User-Agent (from ``user-config.py``), and retry/backoff logic.

``fetch_entity_at_revision`` uses ``pwb_http.fetch`` (pywikibot's HTTP layer)
because ``Special:EntityData`` is a page URL, not an API action.  pywikibot's
API layer (``_simple_request`` / ``Request``) doesn't support revision-specific
entity fetching.  ``pwb_http.fetch`` still benefits from pywikibot's
authenticated session and User-Agent string.

Usage:
    # Fetch 10 unpatrolled statement edits (default)
    python scripts/fetch_patrol_edits.py

    # Fetch 50 unpatrolled + 50 control edits
    python scripts/fetch_patrol_edits.py --unpatrolled 50 --control 50

    # Fetch only "changing" (not "removing") edits
    python scripts/fetch_patrol_edits.py --tag "new editor changing statement"

    # Dry run (print edits, don't save)
    python scripts/fetch_patrol_edits.py --dry-run
"""

import argparse
import re
import sys
import time

import json

from datetime import datetime, timezone
from pathlib import Path

import pywikibot
from pywikibot.comms import http as pwb_http
import yaml


STATEMENT_TAGS = [
    "new editor changing statement",
    "new editor removing statement",
]

STATEMENT_SUMMARY_PATTERNS = [
    "wbsetclaim",
    "wbcreateclaim",
    "wbremoveclaims",
    "wbsetclaimvalue",
    "wbsetreference",
    "wbremovereferences",
    "wbsetqualifier",
    "wbremovequalifiers",
]

SNAPSHOT_DIR = Path("logs/wikidata-patrol-experiment/snapshot")
CONTROL_DIR = Path("logs/wikidata-patrol-experiment/control")

EDIT_SUMMARY_RE = re.compile(
    r"/\*\s*(wb[a-z]+(?:-[a-z]+)?)"  # operation (e.g., wbsetclaim-update)
    r"[^*]*"                          # flags (e.g., :2||1)
    r"\*/"                            # end comment marker
    r"\s*\[\[Property:(P\d+)\]\]"     # property ID
    r"(?::\s*(.+))?"                  # optional value after colon
)

QID_IN_VALUE_RE = re.compile(r"\[\[(Q\d+)\]\]")


def get_production_site():
    """Connect to production Wikidata for read-only access."""
    return pywikibot.Site("wikidata", "wikidata")


def fetch_unpatrolled_edits(site, tag=None, total=10):
    """Fetch statement edits by new editors from production Wikidata.

    New editor edits are identified by tags like "new editor changing
    statement". These edits are from non-autoconfirmed users and require
    patrol review.

    Args:
        site: pywikibot Site object for production Wikidata.
        tag: Optional single tag to filter by. If None, queries all
            STATEMENT_TAGS.
        total: Maximum number of edits to return.

    Yields:
        dict with edit metadata for each unpatrolled edit.
    """
    tags_to_query = [tag] if tag else STATEMENT_TAGS

    count = 0
    for query_tag in tags_to_query:
        if count >= total:
            break
        for change in site.recentchanges(
            namespaces=[0],
            bot=False,
            tag=query_tag,
            total=total - count,
        ):
            yield normalize_change(change)
            count += 1
            if count >= total:
                break


def fetch_control_edits(site, total=10):
    """Fetch statement edits by established users as a control group.

    These are edits by autoconfirmed users (autopatrolled), identified by
    having statement-related edit summaries but no "new editor" tags.

    Args:
        site: pywikibot Site object for production Wikidata.
        total: Maximum number of edits to return.

    Yields:
        dict with edit metadata for each control edit.
    """
    count = 0
    for change in site.recentchanges(
        namespaces=[0],
        bot=False,
        total=total * 5,  # overfetch since we filter by edit summary
    ):
        comment = change.get("comment", "")
        tags = change.get("tags", [])

        is_statement_edit = any(p in comment for p in STATEMENT_SUMMARY_PATTERNS)
        is_new_editor = any(t in tags for t in STATEMENT_TAGS)

        if is_statement_edit and not is_new_editor:
            yield normalize_change(change)
            count += 1
            if count >= total:
                break


def normalize_change(change):
    """Normalize a recentchanges dict to a consistent snapshot format."""
    return {
        "rcid": change.get("rcid"),
        "revid": change.get("revid"),
        "old_revid": change.get("old_revid"),
        "title": change.get("title"),
        "user": change.get("user"),
        "timestamp": change.get("timestamp"),
        "comment": change.get("comment", ""),
        "tags": change.get("tags", []),
    }


def parse_edit_summary(comment):
    """Parse a Wikibase edit summary into operation, property, and value.

    Wikibase generates standardized edit summaries like:
        /* wbsetclaim-update:2||1 */ [[Property:P106]]: [[Q117321337]]

    Returns:
        dict with 'operation', 'property', 'value_raw' keys, or None if
        the comment doesn't match a known Wikibase edit summary format.
    """
    match = EDIT_SUMMARY_RE.search(comment)
    if not match:
        return None

    operation = match.group(1)
    prop = match.group(2)
    raw_value = match.group(3)

    if raw_value:
        raw_value = raw_value.strip()
        qid_match = QID_IN_VALUE_RE.search(raw_value)
        if qid_match:
            raw_value = qid_match.group(1)

    return {
        "operation": operation,
        "property": prop,
        "value_raw": raw_value,
    }


def collect_entity_ids(raw_claims):
    """Return set of all entity IDs (P-ids, Q-ids) referenced in claims.

    Walks properties, mainsnaks, references, and qualifiers to find every
    entity ID that will need label resolution during serialization.

    Args:
        raw_claims: The "claims" dict from a wbgetentities response.

    Returns:
        Set of entity ID strings (e.g., {"P31", "Q5", "P106", "Q42"}).
    """
    ids = set()
    for pid, claim_list in raw_claims.items():
        ids.add(pid)
        for claim in claim_list:
            # Mainsnak value
            _collect_snak_ids(claim.get("mainsnak", {}), ids)
            # References
            for ref_block in claim.get("references", []):
                for ref_pid, snaks in ref_block.get("snaks", {}).items():
                    ids.add(ref_pid)
                    for snak in snaks:
                        _collect_snak_ids(snak, ids)
            # Qualifiers
            for qual_pid, qual_snaks in claim.get("qualifiers", {}).items():
                ids.add(qual_pid)
                for snak in qual_snaks:
                    _collect_snak_ids(snak, ids)
    return ids


def _collect_snak_ids(snak, ids):
    """Extract entity ID from a snak's datavalue if it's a wikibase-entityid."""
    datavalue = snak.get("datavalue", {})
    if datavalue.get("type") == "wikibase-entityid":
        val = datavalue.get("value", {})
        if "id" in val:
            ids.add(val["id"])
        elif "numeric-id" in val:
            prefix = "P" if val.get("entity-type") == "property" else "Q"
            ids.add(f"{prefix}{val['numeric-id']}")


class LabelCache:
    """In-memory cache for resolving Wikidata entity IDs to English labels.

    Resolves Q-ids via ItemPage and P-ids via PropertyPage. Caches results
    so repeated lookups for the same entity avoid duplicate API calls.
    Also stores descriptions alongside labels for use in edit verification.
    """

    def __init__(self, site):
        self._repo = site.data_repository()
        self._cache = {}  # {entity_id: (label, description)}

    def resolve(self, entity_id):
        """Resolve an entity ID to its English label.

        Args:
            entity_id: A Q-id (e.g., "Q5") or P-id (e.g., "P106").

        Returns:
            The English label string, or the entity_id itself if no
            English label is available or the lookup fails.
        """
        if entity_id in self._cache:
            return self._cache[entity_id][0]

        try:
            if entity_id.startswith("P"):
                page = pywikibot.PropertyPage(self._repo, entity_id)
            else:
                page = pywikibot.ItemPage(self._repo, entity_id)
            page.get()
            label = page.labels.get("en", entity_id)
            desc = page.descriptions.get("en")
        except Exception:
            label = entity_id
            desc = None

        self._cache[entity_id] = (label, desc)
        return label

    def resolve_description(self, entity_id):
        """Resolve an entity ID to its English description.

        Args:
            entity_id: A Q-id (e.g., "Q5") or P-id (e.g., "P106").

        Returns:
            The English description string, or None if unavailable.
        """
        if entity_id not in self._cache:
            self.resolve(entity_id)
        return self._cache[entity_id][1]

    def resolve_batch(self, entity_ids):
        """Resolve multiple entity IDs in batched API calls (max 50 per call).

        Uses pywikibot's ``_simple_request`` to call ``wbgetentities`` with
        ``props=labels|descriptions&languages=en``, fetching labels and
        descriptions for many entities at once.  This benefits from
        pywikibot's authenticated session (higher rate limits when logged
        in) and its retry/backoff logic for maxlag throttling.

        Args:
            entity_ids: Iterable of entity ID strings (Q-ids and P-ids).
        """
        # Filter out already-cached IDs
        needed = [eid for eid in entity_ids if eid not in self._cache]
        if not needed:
            return

        # Batch in chunks of 50 (Wikidata API limit)
        for i in range(0, len(needed), 50):
            chunk = needed[i:i + 50]
            try:
                req = self._repo.simple_request(
                    action="wbgetentities",
                    ids="|".join(chunk),
                    props="labels|descriptions",
                    languages="en",
                )
                data = req.submit()
                for eid, entity_data in data.get("entities", {}).items():
                    labels = entity_data.get("labels", {})
                    en_label = labels.get("en", {}).get("value", eid)
                    descs = entity_data.get("descriptions", {})
                    en_desc = descs.get("en", {}).get("value")
                    self._cache[eid] = (en_label, en_desc)
            except Exception:
                # Fall back to storing IDs as their own labels
                for eid in chunk:
                    if eid not in self._cache:
                        self._cache[eid] = (eid, None)

    def prime(self, entity_id, label, description=None):
        """Pre-populate the cache with a known label and optional description."""
        self._cache[entity_id] = (label, description)


def extract_snak_value(snak, label_cache):
    """Extract value and optional label from a Wikibase snak.

    A snak is the atomic data structure in Wikibase (property + value).
    Raw JSON format comes from the wbgetentities API / Special:EntityData.

    Returns:
        Tuple of (value_string, label_or_none).
    """
    snaktype = snak.get("snaktype", "value")
    if snaktype != "value":
        return snaktype, None

    datavalue = snak.get("datavalue", {})
    dtype = datavalue.get("type")
    val = datavalue.get("value")

    if dtype == "wikibase-entityid":
        if "id" in val:
            entity_id = val["id"]
        else:
            prefix = "P" if val.get("entity-type") == "property" else "Q"
            entity_id = f"{prefix}{val['numeric-id']}"
        return entity_id, label_cache.resolve(entity_id)
    elif dtype == "time":
        return val["time"], None
    elif dtype == "quantity":
        return val["amount"], None
    elif dtype == "string":
        return val, None
    elif dtype == "globecoordinate":
        return f"{val['latitude']},{val['longitude']}", None
    elif dtype == "monolingualtext":
        return val["text"], None
    else:
        return str(val), None


def serialize_statement(claim_json, label_cache):
    """Convert a raw Wikibase claim JSON to a YAML-friendly dict.

    Args:
        claim_json: A single claim dict from the wbgetentities response.
        label_cache: LabelCache for resolving entity IDs to labels.

    Returns:
        dict with value, value_label, rank, references, qualifiers.
    """
    mainsnak = claim_json["mainsnak"]
    value, value_label = extract_snak_value(mainsnak, label_cache)

    refs = []
    for ref_block in claim_json.get("references", []):
        ref_dict = {}
        for ref_pid, snaks in ref_block.get("snaks", {}).items():
            snak = snaks[0]
            ref_value, ref_value_label = extract_snak_value(snak, label_cache)
            ref_dict[ref_pid] = {
                "property_label": label_cache.resolve(ref_pid),
                "value": ref_value,
                "value_label": ref_value_label,
            }
        refs.append(ref_dict)

    quals = {}
    for qual_pid, qual_snaks in claim_json.get("qualifiers", {}).items():
        snak = qual_snaks[0]
        qual_value, qual_value_label = extract_snak_value(snak, label_cache)
        quals[qual_pid] = {
            "property_label": label_cache.resolve(qual_pid),
            "value": qual_value,
            "value_label": qual_value_label,
        }

    return {
        "value": value,
        "value_label": value_label,
        "rank": claim_json.get("rank", "normal"),
        "references": refs,
        "qualifiers": quals,
    }


def serialize_claims(raw_claims, label_cache, skip_external_ids=True):
    """Convert all claims from raw entity JSON to YAML-friendly dict.

    Args:
        raw_claims: The "claims" dict from a wbgetentities response.
        label_cache: LabelCache for resolving entity IDs to labels.
        skip_external_ids: If True, skip properties with datatype
            "external-id" to reduce snapshot size. These are identifiers
            in external databases (VIAF, GND, etc.) that aren't useful
            for SIFT verification yet. See chainlink #12.

    Returns:
        dict mapping property IDs to {property_label, statements}.
    """
    result = {}
    for pid, claim_list in raw_claims.items():
        if skip_external_ids and claim_list:
            datatype = claim_list[0].get("mainsnak", {}).get("datatype")
            if datatype == "external-id":
                continue
        statements = [serialize_statement(c, label_cache) for c in claim_list]
        result[pid] = {
            "property_label": label_cache.resolve(pid),
            "statements": statements,
        }
    return result


def fetch_entity_at_revision(qid, revid):
    """Fetch Wikidata entity JSON at a specific revision.

    Uses ``Special:EntityData`` via ``pwb_http.fetch`` (pywikibot's HTTP
    layer).  This is *not* the same as the ``resolve_batch`` bypass --
    ``pwb_http.fetch`` inherits pywikibot's authenticated session and
    User-Agent from ``user-config.py``, so it benefits from logged-in
    rate limits.

    We use ``pwb_http.fetch`` instead of pywikibot's API layer because
    ``Special:EntityData`` is a page URL (not an API action), and the
    ``wbgetentities`` API does not support a ``revision`` parameter for
    fetching entity state at a specific revision.

    Args:
        qid: Entity ID (e.g., "Q42").
        revid: Revision ID to fetch.

    Returns:
        dict with entity data (labels, descriptions, claims, etc.).

    Raises:
        Exception: If the HTTP request fails (404, timeout, etc.).
    """
    url = (
        f"https://www.wikidata.org/wiki/Special:EntityData/"
        f"{qid}.json?revision={revid}"
    )
    resp = pwb_http.fetch(url)
    if resp.status_code != 200:
        raise Exception(
            f"{resp.status_code} for {url}"
        )
    data = json.loads(resp.text)
    return data["entities"][qid]


def find_removed_claims(old_entity, new_entity, property_id):
    """Find claims present in old entity but missing from new entity.

    Compares statement IDs to identify which specific claims were removed.

    Args:
        old_entity: Entity JSON dict at the old revision.
        new_entity: Entity JSON dict at the current revision.
        property_id: Property to compare (e.g., "P21").

    Returns:
        List of raw claim JSON dicts that were removed.
    """
    old_claims = old_entity.get("claims", {}).get(property_id, [])
    new_claims = new_entity.get("claims", {}).get(property_id, [])
    new_ids = {c["id"] for c in new_claims}
    return [c for c in old_claims if c["id"] not in new_ids]


# Map Wikibase operation names to diff types
OPERATION_TO_DIFF_TYPE = {
    "wbsetclaim-create": "statement_added",
    "wbcreateclaim-create": "statement_added",
    "wbremoveclaims-remove": "statement_removed",
    "wbsetclaim-update": "value_changed",
    "wbsetclaimvalue": "value_changed",
    "wbsetreference-add": "reference_added",
    "wbsetreference-set": "reference_changed",
    "wbremovereferences-remove": "reference_removed",
    "wbsetqualifier-add": "qualifier_added",
    "wbsetqualifier-update": "qualifier_changed",
    "wbremovequalifiers-remove": "qualifier_removed",
}


def _refine_diff_type(old_stmt, new_stmt):
    """Determine what actually changed between two serialized statements.

    wbsetclaim-update fires for any claim modification. By comparing the
    serialized old and new statements, we can distinguish value changes
    from reference/qualifier/rank-only changes.

    Args:
        old_stmt: Serialized statement dict (value, references, qualifiers, rank).
        new_stmt: Serialized statement dict.

    Returns:
        Refined diff type string.
    """
    value_changed = old_stmt.get("value") != new_stmt.get("value")
    rank_changed = old_stmt.get("rank") != new_stmt.get("rank")
    refs_changed = old_stmt.get("references") != new_stmt.get("references")
    quals_changed = old_stmt.get("qualifiers") != new_stmt.get("qualifiers")

    if value_changed:
        return "value_changed"
    if refs_changed and not quals_changed and not rank_changed:
        # Determine if references were added, removed, or modified
        old_refs = old_stmt.get("references", [])
        new_refs = new_stmt.get("references", [])
        if not old_refs and new_refs:
            return "reference_added"
        if old_refs and not new_refs:
            return "reference_removed"
        return "reference_changed"
    if quals_changed and not refs_changed and not rank_changed:
        old_quals = old_stmt.get("qualifiers", {})
        new_quals = new_stmt.get("qualifiers", {})
        if not old_quals and new_quals:
            return "qualifier_added"
        if old_quals and not new_quals:
            return "qualifier_removed"
        return "qualifier_changed"
    if rank_changed and not refs_changed and not quals_changed:
        return "rank_changed"
    # Multiple things changed at once — keep the generic type
    return "value_changed"


def compute_edit_diff(old_entity, new_entity, parsed_edit, label_cache):
    """Compare old and new entity revisions for the edited property.

    Args:
        old_entity: Entity JSON at the old revision.
        new_entity: Entity JSON at the new revision.
        parsed_edit: Parsed edit summary dict (from parse_edit_summary).
        label_cache: LabelCache for resolving entity IDs.

    Returns:
        dict with type, property, property_label, old_value, new_value.
        Returns None if parsed_edit is None.
    """
    if not parsed_edit:
        return None

    prop = parsed_edit["property"]
    operation = parsed_edit["operation"]
    diff_type = OPERATION_TO_DIFF_TYPE.get(operation, "unknown")

    old_claims = old_entity.get("claims", {}).get(prop, [])
    new_claims = new_entity.get("claims", {}).get(prop, [])

    old_by_id = {c["id"]: c for c in old_claims}
    new_by_id = {c["id"]: c for c in new_claims}

    old_value = None
    new_value = None

    if diff_type == "statement_added":
        # New statements are those with IDs not in old
        added_ids = set(new_by_id) - set(old_by_id)
        if added_ids:
            new_value = serialize_statement(
                new_by_id[next(iter(added_ids))], label_cache
            )
    elif diff_type == "statement_removed":
        removed_ids = set(old_by_id) - set(new_by_id)
        if removed_ids:
            old_value = serialize_statement(
                old_by_id[next(iter(removed_ids))], label_cache
            )
    else:
        # For updates/changes, find matching statement IDs
        common_ids = set(old_by_id) & set(new_by_id)
        if common_ids:
            # Pick the first common ID (usually there's only one changed)
            stmt_id = next(iter(common_ids))
            old_value = serialize_statement(old_by_id[stmt_id], label_cache)
            new_value = serialize_statement(new_by_id[stmt_id], label_cache)
        elif new_by_id:
            # No common IDs — just show the new state
            new_value = serialize_statement(
                next(iter(new_by_id.values())), label_cache
            )

    # Refine diff_type for wbsetclaim-update by comparing old and new
    # statements. The Wikibase operation "wbsetclaim-update" fires for ANY
    # change to an existing claim (value, references, qualifiers, rank).
    # Compare the serialized statements to determine what actually changed.
    if diff_type == "value_changed" and old_value and new_value:
        diff_type = _refine_diff_type(old_value, new_value)

    return {
        "type": diff_type,
        "property": prop,
        "property_label": label_cache.resolve(prop),
        "old_value": old_value,
        "new_value": new_value,
    }


def enrich_edit(edit, label_cache):
    """Add item context, parsed edit summary, and resolved labels to an edit.

    Fetches the item at the edit's revision, serializes all claims with
    resolved labels, parses the edit summary, and for removal edits fetches
    the old revision to capture the removed claim.

    Modifies the edit dict in place and returns it.

    Args:
        edit: Edit metadata dict (from normalize_change).
        label_cache: LabelCache for resolving entity IDs.

    Returns:
        The edit dict with added parsed_edit, item, and removed_claim keys.
    """
    # Parse edit summary (resolve labels after batch)
    parsed = parse_edit_summary(edit["comment"])

    # Fetch entity at the edit's revision (new state)
    qid = edit["title"]
    try:
        new_entity = fetch_entity_at_revision(qid, edit["revid"])
    except Exception as e:
        # Still resolve parsed labels individually on fetch failure
        if parsed:
            parsed["property_label"] = label_cache.resolve(parsed["property"])
            if parsed["value_raw"] and parsed["value_raw"].startswith("Q"):
                parsed["value_label"] = label_cache.resolve(parsed["value_raw"])
                parsed["value_description"] = label_cache.resolve_description(
                    parsed["value_raw"]
                )
            else:
                parsed["value_label"] = None
                parsed["value_description"] = None
        edit["parsed_edit"] = parsed
        edit["item"] = {"error": str(e)}
        edit["removed_claim"] = None
        edit["edit_diff"] = {"error": str(e)}
        return edit

    # Prime cache with the entity's own label (free — already fetched)
    en_label = new_entity.get("labels", {}).get("en", {}).get("value")
    if en_label:
        label_cache.prime(qid, en_label)

    # Fetch old revision for diff and removal detection
    old_entity = None
    old_fetch_error = None
    try:
        old_entity = fetch_entity_at_revision(qid, edit["old_revid"])
    except Exception as e:
        old_fetch_error = str(e)

    # Batch-resolve all entity IDs before serialization
    all_ids = collect_entity_ids(new_entity.get("claims", {}))
    if old_entity is not None:
        all_ids |= collect_entity_ids(old_entity.get("claims", {}))
    if parsed:
        all_ids.add(parsed["property"])
        if parsed["value_raw"] and parsed["value_raw"].startswith("Q"):
            all_ids.add(parsed["value_raw"])
    label_cache.resolve_batch(all_ids)

    # Now resolve parsed edit labels (will hit cache from batch)
    if parsed:
        parsed["property_label"] = label_cache.resolve(parsed["property"])
        if parsed["value_raw"] and parsed["value_raw"].startswith("Q"):
            parsed["value_label"] = label_cache.resolve(parsed["value_raw"])
            parsed["value_description"] = label_cache.resolve_description(
                parsed["value_raw"]
            )
        else:
            parsed["value_label"] = None
            parsed["value_description"] = None
    edit["parsed_edit"] = parsed

    labels = new_entity.get("labels", {})
    descriptions = new_entity.get("descriptions", {})
    raw_claims = new_entity.get("claims", {})

    edit["item"] = {
        "label_en": labels.get("en", {}).get("value"),
        "description_en": descriptions.get("en", {}).get("value"),
        "claims": serialize_claims(raw_claims, label_cache),
    }

    # Compute edit diff
    if old_entity is not None:
        edit["edit_diff"] = compute_edit_diff(
            old_entity, new_entity, parsed, label_cache
        )
    else:
        edit["edit_diff"] = {"error": old_fetch_error, "partial": True}

    # For removal edits, populate removed_claim from diff or direct lookup
    edit["removed_claim"] = None
    if parsed and "remove" in parsed["operation"]:
        if old_entity is not None:
            removed = find_removed_claims(
                old_entity, new_entity, parsed["property"]
            )
            if removed:
                edit["removed_claim"] = serialize_statement(
                    removed[0], label_cache
                )
        elif old_fetch_error:
            edit["removed_claim"] = {"error": old_fetch_error}

    return edit


def group_edits(edits):
    """Group consecutive edits by (title, user).

    Sequential edits by the same user on the same item are grouped together
    to avoid redundant API calls during enrichment.

    Args:
        edits: List of edit dicts.

    Returns:
        List of lists, where each inner list is a group of related edits.
        Each edit gets group_id, group_seq, and group_size fields added.
    """
    if not edits:
        return []

    groups = []
    current_group = [edits[0]]
    current_key = (edits[0]["title"], edits[0]["user"])

    for edit in edits[1:]:
        key = (edit["title"], edit["user"])
        if key == current_key:
            current_group.append(edit)
        else:
            groups.append(current_group)
            current_group = [edit]
            current_key = key
    groups.append(current_group)

    # Annotate each edit with group metadata
    for group_id, group in enumerate(groups):
        for seq, edit in enumerate(group):
            edit["group_id"] = group_id
            edit["group_seq"] = seq
            edit["group_size"] = len(group)

    return groups


def enrich_edit_group(group, label_cache):
    """Enrich a group of edits, caching revision fetches.

    For a group of edits on the same item by the same user, fetches each
    unique revision only once and shares item context across the group.

    Args:
        group: List of edit dicts (same title and user).
        label_cache: LabelCache for resolving entity IDs.
    """
    if not group:
        return

    qid = group[0]["title"]

    # Collect all unique revisions needed
    revids = set()
    for edit in group:
        revids.add(edit["revid"])
        revids.add(edit["old_revid"])

    # Fetch each revision once, with rate limiting
    rev_cache = {}
    for i, revid in enumerate(sorted(revids)):
        if i > 0:
            time.sleep(0.5)
        try:
            rev_cache[revid] = fetch_entity_at_revision(qid, revid)
        except Exception as e:
            rev_cache[revid] = {"_error": str(e)}

    # Prime cache with entity labels from fetched revisions
    for entity_data in rev_cache.values():
        if "_error" not in entity_data:
            en_label = entity_data.get("labels", {}).get("en", {}).get("value")
            if en_label:
                label_cache.prime(qid, en_label)

    # Batch-resolve all entity IDs across all revisions + parsed edits
    all_ids = set()
    for entity_data in rev_cache.values():
        if "_error" not in entity_data:
            all_ids |= collect_entity_ids(entity_data.get("claims", {}))
    for edit in group:
        parsed = parse_edit_summary(edit["comment"])
        if parsed:
            all_ids.add(parsed["property"])
            if parsed["value_raw"] and parsed["value_raw"].startswith("Q"):
                all_ids.add(parsed["value_raw"])
    label_cache.resolve_batch(all_ids)

    # Use the latest revision (highest revid) for shared item context
    latest_revid = max(edit["revid"] for edit in group)
    latest_entity = rev_cache.get(latest_revid, {})

    if "_error" in latest_entity:
        shared_item = {"error": latest_entity["_error"]}
    else:
        labels = latest_entity.get("labels", {})
        descriptions = latest_entity.get("descriptions", {})
        raw_claims = latest_entity.get("claims", {})
        shared_item = {
            "label_en": labels.get("en", {}).get("value"),
            "description_en": descriptions.get("en", {}).get("value"),
            "claims": serialize_claims(raw_claims, label_cache),
        }

    # Enrich each edit using cached revisions
    for edit in group:
        parsed = parse_edit_summary(edit["comment"])
        if parsed:
            parsed["property_label"] = label_cache.resolve(parsed["property"])
            if parsed["value_raw"] and parsed["value_raw"].startswith("Q"):
                parsed["value_label"] = label_cache.resolve(
                    parsed["value_raw"]
                )
                parsed["value_description"] = (
                    label_cache.resolve_description(parsed["value_raw"])
                )
            else:
                parsed["value_label"] = None
                parsed["value_description"] = None
        edit["parsed_edit"] = parsed

        new_entity = rev_cache.get(edit["revid"], {})
        old_entity = rev_cache.get(edit["old_revid"], {})

        # Item context: use shared if this edit's revision is fine,
        # otherwise derive from this edit's new entity
        if "_error" in new_entity:
            edit["item"] = {"error": new_entity["_error"]}
            edit["edit_diff"] = {"error": new_entity["_error"]}
            edit["removed_claim"] = None
            continue

        edit["item"] = shared_item

        # Compute diff
        if "_error" not in old_entity:
            edit["edit_diff"] = compute_edit_diff(
                old_entity, new_entity, parsed, label_cache
            )
        else:
            edit["edit_diff"] = {
                "error": old_entity.get("_error"), "partial": True
            }

        # Removal detection
        edit["removed_claim"] = None
        if parsed and "remove" in parsed["operation"]:
            if "_error" not in old_entity:
                removed = find_removed_claims(
                    old_entity, new_entity, parsed["property"]
                )
                if removed:
                    edit["removed_claim"] = serialize_statement(
                        removed[0], label_cache
                    )
            else:
                edit["removed_claim"] = {"error": old_entity["_error"]}


def save_snapshot(edits, label, snapshot_dir):
    """Save a list of edits as a timestamped YAML snapshot.

    Args:
        edits: List of edit dicts to save.
        label: Descriptive label (e.g., "unpatrolled", "control").
        snapshot_dir: Path to snapshot directory.

    Returns:
        Path to the saved file.
    """
    snapshot_dir = Path(snapshot_dir)
    snapshot_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    timestamp = now.strftime("%Y-%m-%d-%H%M%S")
    filename = f"{timestamp}-{label}.yaml"
    filepath = snapshot_dir / filename

    snapshot = {
        "fetch_date": now.isoformat(),
        "label": label,
        "count": len(edits),
        "edits": edits,
    }

    with open(filepath, "w") as f:
        yaml.safe_dump(snapshot, f, default_flow_style=False, allow_unicode=True)

    return filepath


def main():
    parser = argparse.ArgumentParser(
        description="Fetch unpatrolled and control statement edits from Wikidata."
    )
    parser.add_argument(
        "--unpatrolled", "-u",
        type=int,
        default=10,
        help="Number of unpatrolled edits to fetch (default: 10)",
    )
    parser.add_argument(
        "--control", "-c",
        type=int,
        default=0,
        help="Number of autopatrolled control edits to fetch (default: 0)",
    )
    parser.add_argument(
        "--tag", "-t",
        type=str,
        default=None,
        help="Filter by specific tag (default: all statement tags)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print edits to stdout instead of saving",
    )
    parser.add_argument(
        "--output-dir", "-o",
        type=str,
        default=str(SNAPSHOT_DIR),
        help=f"Output directory for snapshots (default: {SNAPSHOT_DIR})",
    )
    parser.add_argument(
        "--enrich",
        action="store_true",
        help="Enrich edits with item data, resolved labels, and parsed edit summaries",
    )
    args = parser.parse_args()

    site = get_production_site()
    label_cache = LabelCache(site) if args.enrich else None

    # Fetch unpatrolled edits
    print(f"Fetching {args.unpatrolled} unpatrolled statement edits...")
    unpatrolled = list(fetch_unpatrolled_edits(site, tag=args.tag, total=args.unpatrolled))
    print(f"  Found {len(unpatrolled)} edits")

    if args.enrich:
        groups = group_edits(unpatrolled)
        print(
            f"  Enriching {len(unpatrolled)} edits "
            f"({len(groups)} groups) with item data..."
        )
        for gi, group in enumerate(groups):
            print(
                f"    [group {gi + 1}/{len(groups)}, "
                f"{len(group)} edit(s)] {group[0]['title']}...",
                end="",
                flush=True,
            )
            try:
                enrich_edit_group(group, label_cache)
                print(" done")
            except Exception as e:
                print(f" ERROR: {e}")

    if args.dry_run:
        for edit in unpatrolled:
            print(f"  {edit['title']} by {edit['user']} at {edit['timestamp']}")
            print(f"    comment: {edit['comment']}")
            print(f"    tags: {edit['tags']}")
            if edit.get("edit_diff") and "error" not in edit["edit_diff"]:
                print(f"    diff: {edit['edit_diff']['type']}")
    else:
        path = save_snapshot(unpatrolled, "unpatrolled", args.output_dir)
        print(f"  Saved to {path}")

    # Fetch control group if requested
    if args.control > 0:
        print(f"Fetching {args.control} control (autopatrolled) statement edits...")
        control = list(fetch_control_edits(site, total=args.control))
        print(f"  Found {len(control)} edits")
        if len(control) < args.control:
            print(
                f"  WARNING: requested {args.control} control edits but only "
                f"{len(control)} found — overfetch pool may be too small"
            )

        if args.enrich:
            groups = group_edits(control)
            print(
                f"  Enriching {len(control)} control edits "
                f"({len(groups)} groups) with item data..."
            )
            for gi, group in enumerate(groups):
                print(
                    f"    [group {gi + 1}/{len(groups)}, "
                    f"{len(group)} edit(s)] {group[0]['title']}...",
                    end="",
                    flush=True,
                )
                try:
                    enrich_edit_group(group, label_cache)
                    print(" done")
                except Exception as e:
                    print(f" ERROR: {e}")

        if args.dry_run:
            for edit in control:
                print(f"  {edit['title']} by {edit['user']} at {edit['timestamp']}")
                print(f"    comment: {edit['comment']}")
        else:
            path = save_snapshot(control, "control", CONTROL_DIR)
            print(f"  Saved to {path}")

    print("Done.")
    sys.exit(0)


if __name__ == "__main__":
    main()
