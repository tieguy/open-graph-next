# Test Execution Checklist

## Pre-Testing Setup

- [ ] Phase 1 infrastructure complete (skill, entities, analysis script)
- [ ] Verified pywikibot can read from production Wikidata
- [ ] Chainlink session started for tracking

## Stage 1 Testing (200+ claims)

### Batch 1: Humans (20 entities × ~3-5 properties = 60-100 claims)

For each human entity in `docs/test-entities.yaml`:

```bash
# Run the testing skill
/wikidata-methodology-testing [Q-id]
```

- [ ] Q42 (Douglas Adams) - properties verified, logged
- [ ] Q5879 (Goethe) - properties verified, logged
- [ ] Q937 (Einstein) - properties verified, logged
- [ ] Q7186 (Marie Curie) - properties verified, logged
- [ ] Q1339 (Bach) - properties verified, logged
- [ ] Q76 (Obama) - properties verified, logged
- [ ] Q317521 (Musk) - properties verified, logged
- [ ] Q6701196 (Luis Villa) - properties verified, logged
- [ ] Q313590 (Mitchell Baker) - properties verified, logged
- [ ] Q2845707 (Karen Sandler) - properties verified, logged
- [ ] Q7296746 (Raph Levien) - properties verified, logged
- [ ] Q4039475 (Bradley Kuhn) - properties verified, logged
- [ ] Q36215 (Tim Berners-Lee) - properties verified, logged
- [ ] Q92743 (Vint Cerf) - properties verified, logged
- [ ] Q2387325 (Moxie Marlinspike) - properties verified, logged
- [ ] Q17174219 (Limor Fried) - properties verified, logged
- [ ] Q553790 (Aaron Swartz) - properties verified, logged
- [ ] Q21540213 (Deb Nicholson) - properties verified, logged
- [ ] Q4723060 (Allison Randal) - properties verified, logged
- [ ] Q16195460 (Asheesh Laroia) - properties verified, logged

Human verification complete for batch 1: [ ]

### Batch 2: Organizations (20 entities × ~3-5 properties = 60-100 claims)

- [ ] Q312 (Apple) - properties verified, logged
- [ ] Q95 (Google) - properties verified, logged
- [ ] Q380 (Meta) - properties verified, logged
- [ ] Q9531 (BBC) - properties verified, logged
- [ ] Q8525 (Mozilla) - properties verified, logged
- [ ] Q170877 (Wikimedia) - properties verified, logged
- [ ] Q737 (NASA) - properties verified, logged
- [ ] Q5396743 (EFF) - properties verified, logged
- [ ] Q1093914 (OSI) - properties verified, logged
- [ ] Q671779 (FSF) - properties verified, logged
- [ ] Q99658699 (Tidelift) - properties verified, logged
- [ ] Q55597695 (Conservancy) - properties verified, logged
- [ ] Q40561 (Linux Foundation) - properties verified, logged
- [ ] Q7414033 (GNOME Foundation) - properties verified, logged
- [ ] Q193489 (Creative Commons) - properties verified, logged
- [ ] Q7071698 (OIN) - properties verified, logged
- [ ] Q30089773 (OpenSSF) - properties verified, logged
- [ ] Q7097920 (Open Rights Group) - properties verified, logged
- [ ] Q5193377 (Courage Foundation) - properties verified, logged
- [ ] Q105576557 (OpenSSF duplicate?) - properties verified, logged

Human verification complete for batch 2: [ ]

### Batch 3: Creative Works (20 entities × ~3-5 properties = 60-100 claims)

- [ ] Q25338 (Hitchhiker's Guide) - properties verified, logged
- [ ] Q47209 (1984) - properties verified, logged
- [ ] Q208460 (Lord of the Rings) - properties verified, logged
- [ ] Q184843 (Catcher in the Rye) - properties verified, logged
- [ ] Q170583 (Star Wars) - properties verified, logged
- [ ] Q388 (Linux) - properties verified, logged
- [ ] Q82580 (Firefox) - properties verified, logged
- [ ] Q11015 (Python) - properties verified, logged
- [ ] Q2005 (Wikipedia) - properties verified, logged
- [ ] Q131339 (Git) - properties verified, logged
- [ ] Q14813 (GIMP) - properties verified, logged
- [ ] Q188893 (Blender) - properties verified, logged
- [ ] Q846045 (LibreOffice) - properties verified, logged
- [ ] Q10287 (Emacs) - properties verified, logged
- [ ] Q15206305 (Signal) - properties verified, logged
- [ ] Q125977 (GPL) - properties verified, logged
- [ ] Q17061486 (DFSG) - properties verified, logged
- [ ] Q854449 (OSD) - properties verified, logged
- [ ] Q341 (Cathedral and Bazaar) - properties verified, logged
- [ ] Q1630105 (Revolution OS) - properties verified, logged

Human verification complete for batch 3: [ ]

## Post-Testing Analysis

- [ ] Run analysis script: `python scripts/analyze_test_results.py`
- [ ] Document results in `docs/test-results-stage1.md`
- [ ] Identify top failure modes
- [ ] Calculate accuracy by entity type and property
- [ ] Make go/no-go recommendation

## Metrics to Record

After each batch, note:
- Total claims proposed
- Total claims verified
- Time spent on verification
- Common issues encountered
- Any patterns in failures
