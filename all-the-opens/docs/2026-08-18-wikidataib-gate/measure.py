#!/usr/bin/env python3
"""Measure gate-clearing coverage for enwiki WikidataIB channels.

Fetches entity claims via www.wikidata.org wbgetentities (serial, via wm-fetch),
then evaluates Module:WikidataIB's sourced() predicate faithfully:
a claim passes iff it has >=1 reference whose rendered snak values
(English labels for item values, raw strings/URLs/ids, formatted dates)
do NOT contain the case-sensitive substring "Wiki".
Rank handling matches getValue defaults: preferred+normal (deprecated excluded).
"""
import json, subprocess, urllib.parse, random, os, sys, time
from collections import defaultdict

WORK = os.path.dirname(os.path.abspath(__file__))
os.chdir(WORK)

SCOPES = {
    # gated fields of Template:Infobox person/Wikidata (onlysourced default/yes)
    "personwd": ["P1559","P1477","P569","P19","P1636","P570","P20","P119","P1449",
                  "P69","P106","P108","P800","P102","P26","P451","P40","P22","P25",
                  "P3373","P53","P166"],
    # Infobox company gated fields (onlysourced default yes, fetchwikidata default ALL)
    "company": ["P946","P452","P155","P156","P571","P576","P112","P1001","P159",
                 "P17","P2139","P3362","P2295","P2403","P1128","P749","P856"],
    # Infobox video game gated fields (defaults ALL/yes)
    "videogame": ["P178","P123","P57","P162","P287","P943","P3080","P50","P86",
                   "P179","P408","P400","P136","P404"],
    "marriage": ["P570"],
}
SCOPES["person"] = SCOPES["personwd"]  # counterfactual population, same field set

MONTHS = ["January","February","March","April","May","June","July","August",
          "September","October","November","December"]

def wm(url):
    for attempt in range(3):
        r = subprocess.run(["wm-fetch", url], capture_output=True, text=True)
        try:
            return json.loads(r.stdout)
        except json.JSONDecodeError:
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("fetch failed: " + url[:200] + " :: " + r.stdout[:200] + r.stderr[:200])

def load_samples():
    pops = defaultdict(list)
    for line in open("samples.tsv"):
        pop, title, qid = line.rstrip("\n").split("\t")
        pops[pop].append((title, qid))
    # personwd: full population listed; evaluate a seeded sample of 400
    rnd = random.Random(42)
    full_personwd = pops["personwd"]
    pops["personwd"] = rnd.sample(full_personwd, 400)
    json.dump(full_personwd, open("personwd_full.json", "w"))
    return pops

def fetch_entities(qids):
    ents = {}
    cache = "entities.json"
    if os.path.exists(cache):
        ents = json.load(open(cache))
    missing = [q for q in qids if q not in ents]
    for i in range(0, len(missing), 50):
        batch = missing[i:i+50]
        url = ("https://www.wikidata.org/w/api.php?action=wbgetentities&ids=" +
               urllib.parse.quote("|".join(batch)) +
               "&props=claims&format=json&formatversion=2")
        d = wm(url)
        for q, e in d.get("entities", {}).items():
            ents[q] = e.get("claims", {})
        print(f"  entities {i+len(batch)}/{len(missing)}", file=sys.stderr)
    json.dump(ents, open(cache, "w"))
    return ents

def snak_strings(snak, label_wanted):
    """Return (list of raw strings, list of qids needing labels) for one snak."""
    if snak.get("snaktype") != "value":
        return (["unknown value" if snak.get("snaktype")=="somevalue" else "no value"], [])
    dv = snak["datavalue"]
    t = dv["type"]; v = dv["value"]
    if t == "string":
        return ([v], [])
    if t == "monolingualtext":
        return ([v["text"]], [])
    if t == "wikibase-entityid":
        qid = v.get("id") or ("Q%d" % v["numeric-id"])
        label_wanted.add(qid)
        return ([("QID:%s" % qid)], [qid])
    if t == "time":
        # rendered as e.g. "27 December 2020" - never contains "Wiki"
        return ([v["time"]], [])
    if t == "quantity":
        return ([v["amount"]], [])
    if t == "globecoordinate":
        return (["%s,%s" % (v["latitude"], v["longitude"])], [])
    return ([str(v)], [])

def collect_label_qids(ents):
    wanted = set()
    for claims in ents.values():
        for plist in claims.values():
            for c in plist:
                for ref in c.get("references", []):
                    for snaks in ref.get("snaks", {}).values():
                        for s in snaks:
                            snak_strings(s, wanted)
    return wanted

def fetch_labels(qids):
    labels = {}
    cache = "labels.json"
    if os.path.exists(cache):
        labels = json.load(open(cache))
    missing = [q for q in qids if q not in labels]
    for i in range(0, len(missing), 50):
        batch = missing[i:i+50]
        url = ("https://www.wikidata.org/w/api.php?action=wbgetentities&ids=" +
               urllib.parse.quote("|".join(batch)) +
               "&props=labels&languages=en&format=json&formatversion=2")
        d = wm(url)
        for q, e in d.get("entities", {}).items():
            lab = e.get("labels", {}).get("en", {}).get("value", "")
            labels[q] = lab
        print(f"  labels {i+len(batch)}/{len(missing)}", file=sys.stderr)
    json.dump(labels, open(cache, "w"))
    return labels

WIKIMEDIA_REF_PROPS = {"P143", "P4656", "P3452"}  # imported from / import URL / inferred from

def classify_claim(claim, labels):
    """Return dict describing this claim's reference status under the gates."""
    refs = claim.get("references", [])
    out = {"nrefs": len(refs), "wikidataib_pass": False, "wd_pass": False,
           "weak_pass_only": False, "wm_only": False}
    if not refs:
        return out
    passing_refs = []
    for ref in refs:
        txt_parts = []
        wanted = set()
        props = set(ref.get("snaks", {}).keys())
        for p, snaks in ref.get("snaks", {}).items():
            for s in snaks:
                strs, _ = snak_strings(s, wanted)
                for x in strs:
                    if x.startswith("QID:"):
                        txt_parts.append(labels.get(x[4:], ""))
                    else:
                        txt_parts.append(x)
        rendered = " ".join(txt_parts)
        ib_pass = "Wiki" not in rendered           # WikidataIB sourced()
        wd_pass = not (props & WIKIMEDIA_REF_PROPS) # Module:Wd getReference filter
        if ib_pass:
            passing_refs.append(props)
        if ib_pass:
            out["wikidataib_pass"] = True
        if wd_pass:
            out["wd_pass"] = True
    if out["wikidataib_pass"]:
        # weak pass: every gate-passing reference consists only of P813 (retrieved)
        # and/or P4656/P854-to-wikimedia-ish leftovers with no substantive snak
        substantive = False
        for props in passing_refs:
            if props - {"P813"}:
                substantive = True
        out["weak_pass_only"] = not substantive
    else:
        out["wm_only"] = True  # has refs but none clears WikidataIB gate
    return out

def main():
    pops = load_samples()
    all_qids = sorted({q for pop in pops.values() for _, q in pop})
    print(f"{len(all_qids)} unique QIDs", file=sys.stderr)
    ents = fetch_entities(all_qids)
    label_qids = collect_label_qids(ents)
    print(f"{len(label_qids)} reference-target QIDs need labels", file=sys.stderr)
    labels = fetch_labels(sorted(label_qids))

    results = {}
    for pop, members in pops.items():
        scope = SCOPES[pop]
        prop_stats = {p: defaultdict(int) for p in scope}
        item_completeness = []
        stmt_counts = defaultdict(int)
        for title, qid in members:
            claims = ents.get(qid) or {}
            fields_present = 0
            fields_render = 0
            for p in scope:
                plist = [c for c in claims.get(p, [])
                         if c.get("rank") in ("normal", "preferred")]
                st = prop_stats[p]
                st["items"] += 1
                if not plist:
                    st["absent"] += 1
                    continue
                st["present"] += 1
                fields_present += 1
                renders = False
                for c in plist:
                    cl = classify_claim(c, labels)
                    stmt_counts["stmts"] += 1
                    if cl["nrefs"] == 0:
                        stmt_counts["unreferenced"] += 1
                    elif cl["wikidataib_pass"]:
                        stmt_counts["pass"] += 1
                        if cl["weak_pass_only"]:
                            stmt_counts["weak_pass"] += 1
                    else:
                        stmt_counts["wm_only"] += 1
                    if cl["wd_pass"] and cl["nrefs"] > 0:
                        stmt_counts["wd_pass"] += 1
                    if cl["wikidataib_pass"]:
                        renders = True
                if renders:
                    st["renders"] += 1
                    fields_render += 1
            item_completeness.append({"title": title, "qid": qid,
                                      "present": fields_present,
                                      "renders": fields_render,
                                      "scope": len(scope)})
        results[pop] = {"n": len(members),
                        "prop_stats": {p: dict(v) for p, v in prop_stats.items()},
                        "stmt_counts": dict(stmt_counts),
                        "item_completeness": item_completeness}
    json.dump(results, open("results.json", "w"), indent=1)

    for pop, r in results.items():
        print(f"\n===== {pop} (n={r['n']})")
        print(f"{'prop':8}{'present':>9}{'renders':>9}{'render%of-present':>19}")
        for p in SCOPES[pop]:
            s = r["prop_stats"][p]
            pres = s.get("present", 0); rend = s.get("renders", 0)
            pct = (100*rend/pres) if pres else 0
            print(f"{p:8}{pres:>9}{rend:>9}{pct:>18.1f}%")
        sc = r["stmt_counts"]
        tot = sc.get("stmts", 0) or 1
        print(f"statements={sc.get('stmts',0)} unref={sc.get('unreferenced',0)} "
              f"({100*sc.get('unreferenced',0)/tot:.1f}%) pass={sc.get('pass',0)} "
              f"({100*sc.get('pass',0)/tot:.1f}%) weak(P813-only)={sc.get('weak_pass',0)} "
              f"wm_only={sc.get('wm_only',0)} wd_pass={sc.get('wd_pass',0)}")
        comp = r["item_completeness"]
        n = len(comp)
        avg_p = sum(c["present"] for c in comp)/n
        avg_r = sum(c["renders"] for c in comp)/n
        zero = sum(1 for c in comp if c["renders"] == 0)
        print(f"per-item: avg fields present={avg_p:.2f}, avg render={avg_r:.2f} "
              f"of {len(SCOPES[pop])}; items rendering zero gated fields={zero}/{n}")

if __name__ == "__main__":
    main()
