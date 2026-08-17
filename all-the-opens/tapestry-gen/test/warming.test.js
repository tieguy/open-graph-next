import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { thinMarker, warmAll, warmPage } from '../src/warming.js'

// A tiny stand-in site: each path answers with a canned page, so these tests
// prove the reading of pages without rendering any. The real pages' markers are
// written by serve.js — `__tapdone` last by streamClose, `__tapthin` just
// before it — and these fixtures carry the same ones.
const PAGES = {
  '/wiki/Whole': `<!doctype html><p>everything answered</p><script>window.__tapdone=1</script>`,
  '/wiki/Thin':
    `<!doctype html><p>rendered during a refusal</p>` +
    `${thinMarker(['api.openalex.org'])}<script>window.__tapdone=1</script>`,
  '/wiki/Cut': `<!doctype html><p>the stream died here`,
}

function site() {
  const srv = createServer((req, res) => {
    if (req.url === '/wiki/Busy') {
      res.writeHead(503, { 'Content-Type': 'text/html' })
      res.end('<!doctype html>busy')
      return
    }
    const page = PAGES[decodeURIComponent(req.url)]
    if (!page) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(page)
  })
  return new Promise((resolve) =>
    srv.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${srv.address().port}`, srv })),
  )
}

test('a whole page warms clean, and says it is not thin', async (t) => {
  const { base, srv } = await site()
  t.after(() => srv.close())
  const r = await warmPage(base, 'Whole')
  assert.equal(r.ok, true)
  assert.deepEqual(r.thin, [])
})

// The report exists so "all warm" cannot mean "all stored thin": a thin page
// is warm — it replays — but it is going to be re-rendered when its refusing
// source answers again, and the operator reading the warm output should know.
test('a page rendered during a refusal warms, and names who was refusing', async (t) => {
  const { base, srv } = await site()
  t.after(() => srv.close())
  const r = await warmPage(base, 'Thin')
  assert.equal(r.ok, true)
  assert.deepEqual(r.thin, ['api.openalex.org'])
})

test('a cut-short stream is a failure, not a warm page', async (t) => {
  const { base, srv } = await site()
  t.after(() => srv.close())
  const r = await warmPage(base, 'Cut')
  assert.equal(r.ok, false)
  assert.equal(r.complete, false)
})

test('warmAll walks every title and tallies failures and thinness', async (t) => {
  const { base, srv } = await site()
  t.after(() => srv.close())
  const lines = []
  const out = await warmAll(base, ['Whole', 'Thin', 'Busy', 'Cut'], { log: (l) => lines.push(l) })
  // warm.js's holder-flagship walk rewrites this exact phrase in its log
  // wrapper; rewording it here must break that test, not silently regress
  // the walk's announcement.
  assert.match(lines[0], / showcase pages /)
  assert.equal(out.failed, 2)
  assert.equal(out.thin, 1)
  assert.ok(lines.some((l) => l.includes('Thin') && l.includes('api.openalex.org')))
  assert.ok(lines.some((l) => l.includes('busy (503)')))
  assert.ok(lines.some((l) => l.includes('stream cut short')))
})

// The marker rides inside the stored bytes, so it must be inert page content:
// a script tag assigning a literal, nothing a host name could break out of.
test('the marker is a single self-contained script tag', () => {
  const m = thinMarker(['a.example', 'b.example'])
  assert.match(m, /^<script>window\.__tapthin=\["a\.example","b\.example"\]<\/script>\n$/)
})
