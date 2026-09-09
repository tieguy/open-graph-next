// Who is rendering right now, since when, and for at most how long.
//
// serve.js admits a bounded number of discoveries at once (MAX_CONCURRENT and
// the showcase reserve, src/admission.js). It counted them with a bare
// integer, which could say "four in flight" but never which four, since when,
// or why they had not finished. Measured on production, 2026-09-04 →
// 2026-09-08: one MediaWiki request never settled, every discovery queued
// behind it (src/mw.js, QUEUE_DEADLINE_MS), the count sat at four for four and
// a half days, and every cold page answered 503 until a restart — with nothing
// in the log but the replays that still worked.
//
// Two things here answer that. The ledger knows each render by name and age,
// so a refusal and the stall watchdog can print who is holding the slots. And
// `withDeadline` gives a discovery an end of its own: whatever is stuck
// underneath, the slot comes back and the log says which page held it.

/** A discovery in flight. */
class Entry {
  constructor(page, deadlineMs, startedAt) {
    this.page = page
    this.deadlineMs = deadlineMs
    this.startedAt = startedAt
  }
}

export class Ledger {
  #entries = new Set()

  /** Record a render starting. Returns the entry to `release` later. */
  take(page, deadlineMs, now = Date.now()) {
    const e = new Entry(page, deadlineMs, now)
    this.#entries.add(e)
    return e
  }

  /** Record a render ending. False if it was already released. */
  release(entry) {
    return this.#entries.delete(entry)
  }

  get size() {
    return this.#entries.size
  }

  /**
   * Every render in flight, oldest first.
   * @returns {{page: string, ageMs: number, deadlineMs: number}[]}
   */
  snapshot(now = Date.now()) {
    return [...this.#entries]
      .map((e) => ({ page: e.page, ageMs: now - e.startedAt, deadlineMs: e.deadlineMs }))
      .sort((a, b) => b.ageMs - a.ageMs)
  }

  /** One line for the log. Empty when nothing is in flight. */
  describe(now = Date.now()) {
    return this.snapshot(now)
      .map((r) => `${r.page} (${(r.ageMs / 1000).toFixed(1)}s)`)
      .join(', ')
  }
}

/**
 * `promise`, or a rejection marked `stalled: true` once `ms` have passed.
 *
 * The underlying work is not cancelled — nothing in discovery takes a signal
 * today — but the caller is released, which is what the admission slot needs.
 * The timer is cleared on settle so a finished render leaves nothing behind.
 */
export function withDeadline(promise, ms, label) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(
        new Error(`${label}: discovery did not finish within ${ms}ms`),
        { stalled: true },
      ))
    }, ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}
