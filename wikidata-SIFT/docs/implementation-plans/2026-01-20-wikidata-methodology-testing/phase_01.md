# Wikidata Methodology Testing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Create testing infrastructure for measuring SIFT methodology accuracy

**Architecture:** Testing skill reads production Wikidata (read-only), runs SIFT pipeline, logs proposed claims without execution, enables human verification via YAML logs

**Tech Stack:** Python, pywikibot, YAML logging, Claude Code skills

**Scope:** 5 phases from original design (Phase 1 of 5)

**Codebase verified:** 2026-01-20

---

## Phase 1: Testing Infrastructure

**Goal:** Extend skill and logging to support methodology validation

### Task 1: Create Testing Skill Variant

**Files:**
- Create: `skills/wikidata-methodology-testing/SKILL.md`

**Step 1: Create the skill directory**

```bash
mkdir -p skills/wikidata-methodology-testing
```

**Step 2: Create the skill file**

Create `skills/wikidata-methodology-testing/SKILL.md` with the following content:

```markdown
---
name: wikidata-methodology-testing
description: Test SIFT methodology accuracy by reading production Wikidata, proposing claims, and logging for human verification (no execution)
---

# Wikidata Methodology Testing

## Purpose

Measure SIFT methodology accuracy by:
1. Reading entities from production Wikidata
2. Running full SIFT verification pipeline
3. Proposing claims (WITHOUT executing)
4. Logging for human verification

**This skill does NOT write to Wikidata.** All proposed claims are logged only.

## Safety

**READ-ONLY:** This skill reads from production Wikidata but never writes.

```python
# Read from production Wikidata
site = pywikibot.Site('wikidata', 'wikidata')  # Production for reading
repo = site.data_repository()
# NO write operations - logging only
```

## Workflow

### Step 1: Select Test Entity

Load entity from `docs/test-entities.yaml` or accept Q-id as argument.

```
/wikidata-methodology-testing Q42
```

### Step 2: Fetch Entity from Production Wikidata

```python
import pywikibot

site = pywikibot.Site('wikidata', 'wikidata')
repo = site.data_repository()
item = pywikibot.ItemPage(repo, '[Q-id]')
item.get()

# Extract current claims, labels, descriptions
```

### Step 3: System Selects Properties

Based on entity type (detected from P31), propose properties to verify:

**For humans (P31 = Q5):**
- P569 (date of birth)
- P570 (date of death)
- P27 (country of citizenship)
- P106 (occupation)
- P21 (sex or gender)

**For organizations (P31 = Q43229 or subclasses):**
- P571 (inception)
- P576 (dissolved/abolished)
- P17 (country)
- P159 (headquarters location)
- P112 (founded by)

**For creative works (P31 = Q7725634 or subclasses):**
- P577 (publication date)
- P50 (author)
- P123 (publisher)
- P495 (country of origin)
- P136 (genre)

Log which properties were selected and why.

### Step 4: Run SIFT Verification

For each selected property, follow the full SIFT methodology from `docs/wikidata-methodology.md`:

1. **Source Discovery:** Use WebSearch to find sources
2. **Stop:** Question assumptions
3. **Investigate:** Assess source authority
4. **Find:** Cross-reference multiple sources
5. **Trace:** Locate primary sources

### Step 5: Propose Claim (No Execution)

For each verified property, create a proposed claim:

```yaml
proposed_claim:
  property: P569
  property_label: date of birth
  proposed_value: "1952-03-11"
  value_type: time
  precision: day
  references:
    - url: "https://example.com/source"
      retrieved: 2026-01-20
  confidence: high
  confidence_reasoning: "Primary source confirmed"
```

**DO NOT EXECUTE.** This is proposal only.

### Step 6: Log for Human Verification

Write to `logs/wikidata-methodology-testing/[date]-[Q-id]-[P-id].yaml`:

```yaml
test_date: [YYYY-MM-DD]
entity: [Q-id]
entity_label: [label]
entity_type: [human|organization|creative_work]

property: [P-id]
property_label: [label]
property_selected_by: system

sources_consulted:
  - url: "[url]"
    name: "[name]"
    type: [primary|secondary]
    reliability: [1-5]
    useful_for: "[description]"

sift_verification:
  stop: "[what was questioned]"
  investigate: "[source assessment]"
  find_better: "[cross-reference findings]"
  trace: "[primary source status]"

proposed_claim:
  value: "[proposed value]"
  value_type: [item|string|time|quantity]
  precision: [if applicable]
  confidence: [high|medium|low]
  confidence_reasoning: "[reasoning]"
  references:
    - url: "[url]"
      retrieved: [date]

# HUMAN FILLS IN AFTER REVIEW:
human_verification:
  reviewed_by: null
  review_date: null
  sift_correct: null  # true/false
  proposed_value_correct: null  # true/false
  actual_value: null  # if different from proposed
  failure_mode: null  # hallucinated_source|misread_source|wrong_property|incorrect_value|other
  notes: null
```

### Step 7: Present for Human Verification

After logging, present the proposed claim to human:

```
Proposed claim for [Entity Label] ([Q-id]):

Property: [P-id] ([Property Label])
Proposed Value: [value]
Confidence: [high/medium/low]

Sources consulted:
1. [source 1] (reliability: X/5)
2. [source 2] (reliability: X/5)

SIFT Analysis:
- Stop: [what was questioned]
- Investigate: [source assessment]
- Find: [cross-references]
- Trace: [primary source]

Log file: logs/wikidata-methodology-testing/[filename].yaml

Please verify and update the human_verification section of the log file.
```

## Metrics Tracked

After testing completes, analyze logs for:
- **Property selection appropriateness:** Did system select sensible properties?
- **Source fetchability rate:** What % of sources were accessible?
- **SIFT accuracy rate:** What % of proposed claims were correct?
- **Failure mode distribution:** Which error types are most common?
- **Accuracy by entity type:** Do humans/orgs/works differ?
- **Accuracy by property type:** Which properties are harder?
```

**Step 3: Create the logs directory**

```bash
mkdir -p logs/wikidata-methodology-testing
touch logs/wikidata-methodology-testing/.gitkeep
```

**Step 4: Verify the skill loads**

```bash
ls skills/wikidata-methodology-testing/SKILL.md
```

Expected: File exists

**Step 5: Commit**

```bash
git add skills/wikidata-methodology-testing/SKILL.md
git add logs/wikidata-methodology-testing/.gitkeep
git commit -m "feat: add wikidata-methodology-testing skill for SIFT accuracy measurement"
```

---

### Task 2: Create Entity Selection List

**Files:**
- Create: `docs/test-entities.yaml`

**Step 1: Create the test entity list**

Create `docs/test-entities.yaml` with 60 entities (20 per type):

```yaml
# Test entities for SIFT methodology validation
# 60 total: 20 humans, 20 organizations, 20 creative works
# Difficulty levels: easy (well-documented), medium (moderate coverage), hard (limited sources)

humans:
  # Well-documented (easy)
  - id: Q42
    label: Douglas Adams
    difficulty: easy
    notes: Famous author, extensive Wikipedia coverage
  - id: Q5879
    label: Johann Wolfgang von Goethe
    difficulty: easy
    notes: Historical figure, well-documented
  - id: Q937
    label: Albert Einstein
    difficulty: easy
    notes: Famous scientist, extensive sources
  - id: Q7186
    label: Marie Curie
    difficulty: easy
    notes: Famous scientist, well-documented
  - id: Q1339
    label: Johann Sebastian Bach
    difficulty: easy
    notes: Famous composer, extensive historical records
  - id: Q76
    label: Barack Obama
    difficulty: easy
    notes: Former US president, extensive coverage
  - id: Q317521
    label: Elon Musk
    difficulty: easy
    notes: Tech CEO, extensive coverage

  # Moderately documented (medium)
  - id: Q6701196
    label: Luis Villa
    difficulty: medium
    notes: Software/legal figure, moderate coverage
  - id: Q313590
    label: Mitchell Baker
    difficulty: medium
    notes: Tech executive, moderate coverage
  - id: Q2845707
    label: Karen Sandler
    difficulty: medium
    notes: Tech/nonprofit figure, moderate coverage
  - id: Q7296746
    label: Raph Levien
    difficulty: medium
    notes: Software developer, limited mainstream coverage
  - id: Q4039475
    label: Bradley Kuhn
    difficulty: medium
    notes: Software freedom advocate, niche coverage
  - id: Q36215
    label: Tim Berners-Lee
    difficulty: medium
    notes: Web inventor, good but technical coverage
  - id: Q92743
    label: Vint Cerf
    difficulty: medium
    notes: Internet pioneer, moderate coverage
  - id: Q2387325
    label: Moxie Marlinspike
    difficulty: medium
    notes: Privacy technologist, moderate coverage
  - id: Q17174219
    label: Limor Fried
    difficulty: medium
    notes: Hardware hacker, moderate coverage
  - id: Q553790
    label: Aaron Swartz
    difficulty: medium
    notes: Internet activist, moderate coverage

  # Less documented (hard)
  - id: Q21540213
    label: Deb Nicholson
    difficulty: hard
    notes: Nonprofit tech, limited sources
  - id: Q4723060
    label: Allison Randal
    difficulty: hard
    notes: Open source leader, limited mainstream coverage
  - id: Q16195460
    label: Asheesh Laroia
    difficulty: hard
    notes: Open source contributor, very limited coverage

organizations:
  # Well-documented (easy)
  - id: Q312
    label: Apple Inc.
    difficulty: easy
    notes: Major corporation, extensive coverage
  - id: Q95
    label: Google
    difficulty: easy
    notes: Major corporation, extensive coverage
  - id: Q380
    label: Meta Platforms
    difficulty: easy
    notes: Major corporation, extensive coverage
  - id: Q9531
    label: BBC
    difficulty: easy
    notes: Major media org, well-documented
  - id: Q8525
    label: Mozilla Foundation
    difficulty: easy
    notes: Major nonprofit, good coverage
  - id: Q170877
    label: Wikimedia Foundation
    difficulty: easy
    notes: Wikipedia parent org, well-documented
  - id: Q737
    label: NASA
    difficulty: easy
    notes: Space agency, extensive coverage
  - id: Q5396743
    label: Electronic Frontier Foundation
    difficulty: easy
    notes: Digital rights nonprofit, good coverage

  # Moderately documented (medium)
  - id: Q1093914
    label: Open Source Initiative
    difficulty: medium
    notes: Nonprofit, moderate coverage
  - id: Q671779
    label: Free Software Foundation
    difficulty: medium
    notes: Nonprofit, moderate coverage
  - id: Q99658699
    label: Tidelift
    difficulty: medium
    notes: Startup, limited but verifiable coverage
  - id: Q55597695
    label: Software Freedom Conservancy
    difficulty: medium
    notes: Nonprofit, moderate coverage
  - id: Q40561
    label: Linux Foundation
    difficulty: medium
    notes: Tech nonprofit, moderate coverage
  - id: Q7414033
    label: GNOME Foundation
    difficulty: medium
    notes: Software foundation, moderate coverage
  - id: Q193489
    label: Creative Commons
    difficulty: medium
    notes: Licensing nonprofit, moderate coverage

  # Less documented (hard)
  - id: Q7071698
    label: Open Invention Network
    difficulty: hard
    notes: Patent consortium, limited coverage
  - id: Q30089773
    label: OpenSSF
    difficulty: hard
    notes: Security foundation, limited coverage
  - id: Q7097920
    label: Open Rights Group
    difficulty: hard
    notes: UK digital rights, limited coverage
  - id: Q5193377
    label: Courage Foundation
    difficulty: hard
    notes: Whistleblower support, limited coverage
  - id: Q105576557
    label: Open Source Security Foundation
    difficulty: hard
    notes: Security initiative, very limited coverage

creative_works:
  # Well-documented (easy)
  - id: Q25338
    label: The Hitchhiker's Guide to the Galaxy
    difficulty: easy
    notes: Famous book, extensive coverage
  - id: Q47209
    label: 1984 (novel)
    difficulty: easy
    notes: Classic novel, well-documented
  - id: Q208460
    label: The Lord of the Rings
    difficulty: easy
    notes: Famous book series
  - id: Q184843
    label: The Catcher in the Rye
    difficulty: easy
    notes: Classic novel
  - id: Q170583
    label: Star Wars
    difficulty: easy
    notes: Major franchise
  - id: Q388
    label: Linux
    difficulty: easy
    notes: Major software project
  - id: Q82580
    label: Firefox
    difficulty: easy
    notes: Major software
  - id: Q11015
    label: Python (programming language)
    difficulty: easy
    notes: Major language
  - id: Q2005
    label: Wikipedia
    difficulty: easy
    notes: Well-documented project

  # Software/tech works (medium)
  - id: Q131339
    label: Git
    difficulty: medium
    notes: Software, technical sources
  - id: Q14813
    label: GIMP
    difficulty: medium
    notes: Graphics software, moderate coverage
  - id: Q188893
    label: Blender (software)
    difficulty: medium
    notes: 3D software, moderate coverage
  - id: Q846045
    label: LibreOffice
    difficulty: medium
    notes: Office suite, moderate coverage
  - id: Q10287
    label: GNU Emacs
    difficulty: medium
    notes: Text editor, technical coverage
  - id: Q15206305
    label: Signal (software)
    difficulty: medium
    notes: Messaging app, moderate coverage
  - id: Q125977
    label: GNU General Public License
    difficulty: medium
    notes: Software license, moderate coverage

  # Less documented (hard)
  - id: Q17061486
    label: Debian Free Software Guidelines
    difficulty: hard
    notes: Policy document, limited coverage
  - id: Q854449
    label: Open Source Definition
    difficulty: hard
    notes: Definition document, limited coverage
  - id: Q341
    label: The Cathedral and the Bazaar
    difficulty: hard
    notes: Essay, limited mainstream coverage
  - id: Q1630105
    label: Revolution OS
    difficulty: hard
    notes: Documentary, limited coverage
```

**Step 2: Verify entity count**

```bash
grep -E "^  - id:" docs/test-entities.yaml | wc -l
```

Expected: 60

**Step 3: Commit**

```bash
git add docs/test-entities.yaml
git commit -m "feat: add 60 test entities for methodology validation"
```

---

### Task 3: Create Log Analysis Helper

**Files:**
- Create: `scripts/analyze_test_results.py`

**Step 1: Create scripts directory**

```bash
mkdir -p scripts
```

**Step 2: Create the analysis script**

Create `scripts/analyze_test_results.py`:

```python
#!/usr/bin/env python3
"""
Analyze SIFT methodology test results from YAML logs.

Usage: python scripts/analyze_test_results.py
"""

import os
import yaml
from pathlib import Path
from collections import Counter, defaultdict


def load_test_logs(log_dir: str = "logs/wikidata-methodology-testing") -> list[dict]:
    """Load all test log files."""
    logs = []
    log_path = Path(log_dir)

    if not log_path.exists():
        print(f"Log directory not found: {log_dir}")
        return logs

    for file in log_path.glob("*.yaml"):
        with open(file, 'r') as f:
            try:
                log = yaml.safe_load(f)
                log['_filename'] = file.name
                logs.append(log)
            except yaml.YAMLError as e:
                print(f"Error parsing {file}: {e}")

    return logs


def analyze_results(logs: list[dict]) -> dict:
    """Analyze test results and return metrics."""
    results = {
        'total_claims': len(logs),
        'verified_claims': 0,
        'unverified_claims': 0,
        'sift_correct': 0,
        'sift_incorrect': 0,
        'value_correct': 0,
        'value_incorrect': 0,
        'failure_modes': Counter(),
        'by_entity_type': defaultdict(lambda: {'total': 0, 'correct': 0}),
        'by_property': defaultdict(lambda: {'total': 0, 'correct': 0}),
        'by_confidence': defaultdict(lambda: {'total': 0, 'correct': 0}),
    }

    for log in logs:
        human_verification = log.get('human_verification', {})

        if not human_verification or human_verification.get('reviewed_by') is None:
            results['unverified_claims'] += 1
            continue

        results['verified_claims'] += 1

        # SIFT correctness
        if human_verification.get('sift_correct'):
            results['sift_correct'] += 1
        else:
            results['sift_incorrect'] += 1

        # Value correctness
        if human_verification.get('proposed_value_correct'):
            results['value_correct'] += 1
        else:
            results['value_incorrect'] += 1

        # Failure modes
        failure_mode = human_verification.get('failure_mode')
        if failure_mode:
            results['failure_modes'][failure_mode] += 1

        # By entity type
        entity_type = log.get('entity_type', 'unknown')
        results['by_entity_type'][entity_type]['total'] += 1
        if human_verification.get('sift_correct'):
            results['by_entity_type'][entity_type]['correct'] += 1

        # By property
        prop = log.get('property', 'unknown')
        results['by_property'][prop]['total'] += 1
        if human_verification.get('sift_correct'):
            results['by_property'][prop]['correct'] += 1

        # By confidence
        confidence = log.get('proposed_claim', {}).get('confidence', 'unknown')
        results['by_confidence'][confidence]['total'] += 1
        if human_verification.get('sift_correct'):
            results['by_confidence'][confidence]['correct'] += 1

    return results


def calculate_accuracy(correct: int, total: int) -> float:
    """Calculate accuracy percentage."""
    if total == 0:
        return 0.0
    return (correct / total) * 100


def print_report(results: dict):
    """Print human-readable analysis report."""
    print("=" * 60)
    print("SIFT METHODOLOGY TEST RESULTS")
    print("=" * 60)

    print(f"\n## Summary")
    print(f"Total claims logged: {results['total_claims']}")
    print(f"Human-verified: {results['verified_claims']}")
    print(f"Awaiting verification: {results['unverified_claims']}")

    if results['verified_claims'] > 0:
        sift_accuracy = calculate_accuracy(
            results['sift_correct'], results['verified_claims']
        )
        value_accuracy = calculate_accuracy(
            results['value_correct'], results['verified_claims']
        )

        print(f"\n## Accuracy Metrics")
        print(f"SIFT accuracy: {sift_accuracy:.1f}% ({results['sift_correct']}/{results['verified_claims']})")
        print(f"Value accuracy: {value_accuracy:.1f}% ({results['value_correct']}/{results['verified_claims']})")

        # Go/no-go assessment
        print(f"\n## Go/No-Go Assessment")
        if sift_accuracy >= 99:
            print("✓ SIFT accuracy ≥99% - autonomous operation viable")
        elif sift_accuracy >= 95:
            print("~ SIFT accuracy 95-99% - consider confidence-based filtering")
        else:
            print("✗ SIFT accuracy <95% - methodology needs iteration")

        # Failure modes
        if results['failure_modes']:
            print(f"\n## Failure Modes")
            for mode, count in results['failure_modes'].most_common():
                pct = (count / results['verified_claims']) * 100
                print(f"  {mode}: {count} ({pct:.1f}%)")

        # By entity type
        print(f"\n## Accuracy by Entity Type")
        for entity_type, stats in sorted(results['by_entity_type'].items()):
            if stats['total'] > 0:
                acc = calculate_accuracy(stats['correct'], stats['total'])
                print(f"  {entity_type}: {acc:.1f}% ({stats['correct']}/{stats['total']})")

        # By confidence level
        print(f"\n## Accuracy by Confidence Level")
        for confidence, stats in sorted(results['by_confidence'].items()):
            if stats['total'] > 0:
                acc = calculate_accuracy(stats['correct'], stats['total'])
                print(f"  {confidence}: {acc:.1f}% ({stats['correct']}/{stats['total']})")

    print("\n" + "=" * 60)


def main():
    logs = load_test_logs()

    if not logs:
        print("No test logs found. Run the wikidata-methodology-testing skill first.")
        return

    results = analyze_results(logs)
    print_report(results)


if __name__ == "__main__":
    main()
```

**Step 3: Make script executable**

```bash
chmod +x scripts/analyze_test_results.py
```

**Step 4: Verify script runs**

```bash
python scripts/analyze_test_results.py
```

Expected: "No test logs found. Run the wikidata-methodology-testing skill first."

**Step 5: Commit**

```bash
git add scripts/analyze_test_results.py
git commit -m "feat: add test results analysis script"
```

---

## Phase 1 Verification

**Done when:**
- [ ] Testing skill exists at `skills/wikidata-methodology-testing/SKILL.md`
- [ ] Logs directory exists at `logs/wikidata-methodology-testing/`
- [ ] Test entities list exists at `docs/test-entities.yaml` with 60 entities
- [ ] Analysis script exists at `scripts/analyze_test_results.py` and runs
- [ ] All changes committed to git
