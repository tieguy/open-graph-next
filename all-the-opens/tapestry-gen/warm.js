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
 * here is the by-hand form: point it at any base URL to refill a showcase
 * after an eviction sweep, to warm staging's volume once, or to verify that a
 * deploy actually serves pages.
 *
 * The titles come from `showcaseTitles()`, the same list the front page renders
 * its cards from — for the showcase there is deliberately no second copy to
 * keep in step. With HOLDER_FLAGSHIPS=1 the walk covers the holder
 * flagship articles instead (tools/holder-flagships.mjs), one per wired
 * museum holder plus the role-carrying exemplars.
 *
 * Exits non-zero when a page did not finish — the site is slow, not broken. A
 * page reported "thin" is warm but provisional: it was rendered while a source
 * was refusing us, and the server re-renders it once that source answers.
 */
import { showcaseTitles } from './src/front-page.js'
import { warmAll } from './src/warming.js'
import { HOLDER_FLAGSHIPS } from './tools/holder-flagships.mjs'

const BASE = (process.argv[2] ?? process.env.SITE_URL ?? 'https://friendsof.wiki')
  .replace(/\/+$/, '')
// A genuinely cold page can take a minute; the timeout only has to be longer
// than the slowest honest run, not tight.
const TIMEOUT_MS = Number(process.env.WARM_TIMEOUT_MS ?? 300_000)

// HOLDER_FLAGSHIPS=1 walks the holder flagships instead of the showcase —
// an env var, not a flag argument, because argv[2] IS the base URL.
const holderWalk = process.env.HOLDER_FLAGSHIPS === '1'
const titles = holderWalk ? HOLDER_FLAGSHIPS.map((f) => f.title) : showcaseTitles()

// The walk's own announcement says "showcase"; correct it here rather than
// parameterizing src/warming.js — a src/ edit re-keys the production page
// cache (buildId fingerprints src/*.js), too high a price for a log word.
const log = holderWalk
  ? (line) => console.error(line.replace(' showcase pages ', ' holder-flagship pages '))
  : console.error

const { failed } = await warmAll(BASE, titles, { timeoutMs: TIMEOUT_MS, log })
process.exit(failed ? 1 : 0)
