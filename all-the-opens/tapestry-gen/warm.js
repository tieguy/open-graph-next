#!/usr/bin/env node
/**
 * Re-warm a deployed server's page cache for the articles the front page links
 * to, by hand.
 *
 *   node warm.js [base-url]
 *
 * The walk itself lives in src/warming.js, because the deployed server now
 * does its own warming at startup (serve.js, WARM_ON_START) — a deploy no
 * longer ends with this script running on the operator's machine. What is left
 * here is the by-hand form: point it at any base URL to refill the
 * ready-now pages after an eviction sweep, to warm staging's volume once,
 * or to verify that a deploy actually serves pages.
 *
 * The titles come from `bootWarmTitles()` — the showcase plus the held-works
 * row, the same lists the front page renders its cards from, with
 * deliberately no second copy to keep in step. With HOLDER_FLAGSHIPS=1 the
 * walk covers the holder flagship articles instead
 * (tools/holder-flagships.mjs), one per wired museum holder plus the
 * role-carrying exemplars.
 *
 * Exits non-zero when a page did not finish — the site is slow, not broken. A
 * page reported "thin" is warm but provisional: it was rendered while a source
 * was refusing us, and the server re-renders it once that source answers.
 */
import { bootWarmTitles, warmAll } from './src/warming.js'
import { HOLDER_FLAGSHIPS } from './tools/holder-flagships.mjs'

const BASE = (process.argv[2] ?? process.env.SITE_URL ?? 'https://friendsof.wiki')
  .replace(/\/+$/, '')
// A genuinely cold page can take a minute; the timeout only has to be longer
// than the slowest honest run, not tight.
const TIMEOUT_MS = Number(process.env.WARM_TIMEOUT_MS ?? 300_000)

// HOLDER_FLAGSHIPS=1 walks the holder flagships instead of the ready-now
// list — an env var, not a flag argument, because argv[2] IS the base URL.
const holderWalk = process.env.HOLDER_FLAGSHIPS === '1'
// The default walk is bootWarmTitles — the same list the server warms at
// startup: every front-page card that makes the ready-now promise.
const titles = holderWalk ? HOLDER_FLAGSHIPS.map((f) => f.title) : bootWarmTitles()
const log = console.error

const { failed } = await warmAll(BASE, titles, { timeoutMs: TIMEOUT_MS, log })
process.exit(failed ? 1 : 0)
