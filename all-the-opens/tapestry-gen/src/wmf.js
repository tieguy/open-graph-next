// Wikimedia Foundation API compliance, defined once for the whole repo.
//
// Wikimedia runs on donations and serves everyone; non-compliant clients get
// IP-blocked without notice, and the block lands on whoever ran the code. This
// module exists because the alternative — a User-Agent string copied into each
// fetching module — reliably drifts. This repo had four copies before it had
// this file.
//
// Policy:    https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy
// Etiquette: https://www.mediawiki.org/wiki/API:Etiquette

const VERSION = '0.2'
const PROJECT = 'https://github.com/tieguy/open-graph-next'

/**
 * The User-Agent for one component of this project.
 *
 * The contact must identify **the operator** — whoever is generating the
 * traffic — not this repo's author. Anyone can clone or fork this, and a
 * hardcoded address would attribute their traffic to someone who never ran it.
 * So it comes from the environment and there is deliberately no default:
 * traffic attributed to nobody is exactly what the policy forbids, and failing
 * at startup is cheaper than being blocked mid-run.
 *
 * @param {string} component  e.g. 'tapestry-gen' — which part is calling
 * @param {{contact?: string}} [options]  defaults to WIKIMEDIA_UA_CONTACT
 */
export function userAgent(component, { contact = process.env.WIKIMEDIA_UA_CONTACT } = {}) {
  if (!contact || !contact.trim()) {
    throw new Error(
      'WIKIMEDIA_UA_CONTACT is not set. Wikimedia requires a User-Agent naming a ' +
        'contact who can be reached about this traffic — an email, or a URL you ' +
        'control. Set it to your own address before calling any Wikimedia API.',
    )
  }
  return `all-the-opens-${component}/${VERSION} (${PROJECT}; ${contact.trim()}) node/${process.versions.node}`
}

/** The MediaWiki Action API, on any Wikimedia project. */
const ACTION_API = /^https:\/\/([a-z0-9-]+\.)*(wikipedia|wikidata|wikimedia|wiktionary|wikisource)\.org\/w\/api\.php$/i

/**
 * `maxlag=5` on Action API calls, so that when replication falls behind this
 * batch job steps aside for interactive users rather than competing with them.
 * Correct for everything here: nothing in this project is a human waiting on a
 * response. Non-Wikimedia hosts and non-Action-API URLs are returned unchanged —
 * an unknown parameter is at best ignored and at worst an error.
 */
export function withMaxlag(url, seconds = 5) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (!ACTION_API.test(`${parsed.origin}${parsed.pathname}`)) return url
  if (parsed.searchParams.has('maxlag')) return url
  parsed.searchParams.set('maxlag', String(seconds))
  return parsed.toString()
}

/** Longest we will sit on a server's say-so. Beyond this, back off our own way. */
const MAX_RETRY_AFTER_MS = 60000

/**
 * How long a 429 or 503 asked us to wait, in milliseconds, or null when it did
 * not say or said something unusable. Capped: a broken or hostile header must
 * not park a run for a day.
 */
export function retryAfterMs(headers) {
  const raw = headers?.get?.('retry-after')
  if (!raw) return null
  const seconds = Number(String(raw).trim())
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
}

/** Status codes worth trying again. Everything else 4xx is our bug, not theirs. */
export function isRetryable(status) {
  return status === 429 || status === 503 || (status >= 500 && status < 600)
}
