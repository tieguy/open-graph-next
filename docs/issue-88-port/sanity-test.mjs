// Quick sanity test for extract-relevant-content.mjs.
// Run with: node sanity-test.mjs
//
// Not a real test suite — just a few representative inputs to confirm the
// algorithm picks the right paragraphs and respects the caps.

import { extractRelevantContent, tokenizeClaim } from './extract-relevant-content.mjs';

let failures = 0;
function check(name, cond, info) {
    if (cond) {
        console.log('PASS  ' + name);
    } else {
        failures += 1;
        console.log('FAIL  ' + name + (info ? ' :: ' + info : ''));
    }
}

// --- 1. tokenizeClaim drops stopwords, keeps numbers + multi-char tokens.
{
    const t = tokenizeClaim('The bridge was completed in 1998 by Acme Corp.');
    check('tokenize: no stopwords', !t.includes('the') && !t.includes('was') && !t.includes('in'));
    check('tokenize: keeps year', t.includes('1998'));
    check('tokenize: keeps proper noun', t.includes('Acme'));
    check('tokenize: keeps verb stem', t.includes('completed'));
}

// --- 2. tokenizeClaim preserves quoted phrases as-is.
{
    const t = tokenizeClaim('The president said "the era of austerity is over" in March.');
    check('tokenize: keeps quoted phrase', t.includes('the era of austerity is over'));
}

// --- 3. Short input is returned untouched.
{
    const out = extractRelevantContent('A short page.', 'something', { maxTotalChars: 100, leadChars: 50 });
    check('short input: returned whole', out.text === 'A short page.' && out.truncated === false && out.strategy === 'short');
}

// --- 4. No query: head-of-page fallback with truncation marker.
{
    const big = 'X'.repeat(20000);
    const out = extractRelevantContent(big, null, { fallbackChars: 5000 });
    check('no query: truncated', out.truncated === true);
    check('no query: starts at head', out.text.startsWith('XXXX'));
    check('no query: includes truncation marker', out.text.includes('[Truncated'));
    check('no query: strategy=fallback', out.strategy === 'fallback');
}

// --- 5. Query path: lead + matches around the conclusion (issue #88 case).
{
    const lead = 'INTRO. '.repeat(400);                 // ~2,800 chars of intro
    const middle = 'FILLER paragraph. '.repeat(800);    // ~14,400 chars of irrelevant middle
    const conclusion =
        'In conclusion, the population of Belgium increased by 12% between 2010 and 2020 ' +
        'according to census data, marking the largest decadal jump in 30 years.';
    const page = lead + '\n\n' + middle + '\n\n' + conclusion;
    const claim = 'The population of Belgium increased by 12% between 2010 and 2020.';

    const out = extractRelevantContent(page, claim);
    check('issue #88: includes lead', out.text.includes('INTRO.'));
    check('issue #88: surfaces conclusion', out.text.includes('Belgium increased by 12%'));
    check('issue #88: drops the filler bulk', !out.text.includes('FILLER paragraph. '.repeat(20)));
    check('issue #88: at least one match', out.matches >= 1);
    check('issue #88: strategy=lead+matches', out.strategy === 'lead+matches');
    check('issue #88: respects max total chars', out.text.length <= 9500); // 9000 + buffer for headers
}

// --- 6. Query with no hits: lead-only with a "fact may not appear" note.
{
    const page = 'INTRO ' + 'X'.repeat(20000) + '\n\nIrrelevant paragraph about cats.';
    const out = extractRelevantContent(page, 'committee published findings in 1932');
    check('no hits: zero matches', out.matches === 0);
    check('no hits: includes lead-only warning', out.text.includes('No matches found'));
    check('no hits: strategy=lead-only', out.strategy === 'lead-only');
}

// --- 7. Multi-word phrase match (proper noun + qualifier).
{
    const page =
        'INTRO\n\n' +
        'X'.repeat(5000) + '\n\n' +
        'According to the Morrison Bridge committee, the structure was finished in 2002.\n\n' +
        'Final notes about other bridges.';
    const out = extractRelevantContent(page, '"Morrison Bridge"');
    check('phrase match: surfaces target paragraph', out.text.includes('Morrison Bridge committee'));
    check('phrase match: at least one match', out.matches >= 1);
}

// --- 8. Bare-comma query string is treated as a term list, not a sentence.
{
    const page = 'INTRO\n\n' + 'X'.repeat(5000) + '\n\nDouglas Adams was born on 11 March 1952.';
    const out = extractRelevantContent(page, 'Douglas Adams,1952');
    check('comma-list query: surfaces target', out.text.includes('Douglas Adams was born'));
}

// --- 9. Full-length unaltered when source fits under the total cap.
{
    const page = 'A'.repeat(800) + '\n\nDouglas Adams\n\n' + 'B'.repeat(800);
    const out = extractRelevantContent(page, 'Douglas Adams', { maxTotalChars: 9000, leadChars: 2500 });
    check('fits under cap: not truncated', out.truncated === false);
    check('fits under cap: full text returned', out.text === page);
}

// --- 10. Source with no double-newlines still chunks correctly.
{
    const page = 'INTRO ' + 'X'.repeat(8000) + '\nDouglas Adams was born in 1952.\nMore filler.';
    const out = extractRelevantContent(page, 'Douglas Adams 1952');
    check('single-newline source: surfaces target', out.text.includes('Douglas Adams was born in 1952'));
}

console.log('');
if (failures === 0) {
    console.log('All checks passed.');
    process.exit(0);
} else {
    console.log(failures + ' check(s) failed.');
    process.exit(1);
}
