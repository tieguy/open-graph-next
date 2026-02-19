# OpenRouter Verdict Fanout — Phase 1: SearXNG Setup

**Goal:** Self-hosted SearXNG search engine running via Podman, providing a JSON API at localhost:8080

**Architecture:** Two-container setup (SearXNG + Valkey/Redis) via docker-compose.yml, Podman-compatible. SearXNG configured for JSON-only output with Google, DuckDuckGo, and Brave engines. Bound to localhost only.

**Tech Stack:** Podman, podman-compose, SearXNG (docker.io/searxng/searxng:latest), Valkey 8

**Scope:** Phase 1 of 6 from original design

**Codebase verified:** 2026-02-19

---

## Acceptance Criteria Coverage

This is an infrastructure phase. **Verifies: None** — operational verification only (curl returns search results).

---

<!-- START_TASK_1 -->
### Task 1: Create docker-compose.yml

**Files:**
- Create: `wikidata-SIFT/docker-compose.yml`

**Step 1: Create the docker-compose.yml file**

Create `wikidata-SIFT/docker-compose.yml` with the following content:

```yaml
services:
  valkey:
    container_name: searxng-valkey
    image: docker.io/valkey/valkey:8-alpine
    command: valkey-server --save 30 1 --loglevel warning
    restart: unless-stopped
    networks:
      - searxng
    volumes:
      - valkey-data:/data
    cap_drop:
      - ALL
    cap_add:
      - SETGID
      - SETUID
      - DAC_OVERRIDE

  searxng:
    container_name: searxng
    image: docker.io/searxng/searxng:latest
    restart: unless-stopped
    networks:
      - searxng
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - ./config/searxng:/etc/searxng:rw
    environment:
      - SEARXNG_BASE_URL=http://localhost:8080/
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETGID
      - SETUID
    depends_on:
      - valkey

networks:
  searxng:

volumes:
  valkey-data:
```

Key decisions:
- Port bound to `127.0.0.1:8080` (localhost only — no external exposure)
- SearXNG config mounted from `./config/searxng/` to keep config alongside existing `config/blocked_domains.yaml`
- No Caddy reverse proxy (unnecessary for local API-only use)
- Secret key set in settings.yml (see Task 2), not via environment variable

**Step 2: Verify file created**

```bash
cat wikidata-SIFT/docker-compose.yml
```

Expected: File contents match above.

**Step 3: Commit**

```bash
git add wikidata-SIFT/docker-compose.yml
git commit -m "infra: add docker-compose for SearXNG + Valkey"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create SearXNG settings template and .gitignore

**Files:**
- Create: `wikidata-SIFT/config/searxng/settings.yml.template`
- Modify: `wikidata-SIFT/.gitignore`

**Step 1: Update .gitignore for SearXNG**

Append the following to `wikidata-SIFT/.gitignore` (before the existing `# Track chainlink issue database` line):

```
# SearXNG secret key (generated per-instance)
config/searxng/settings.yml

# Container volumes
valkey-data/
```

**Step 2: Create the settings template**

Create `wikidata-SIFT/config/searxng/settings.yml.template` with the following content:

```yaml
use_default_settings:
  engines:
    keep_only:
      - google
      - duckduckgo
      - brave

general:
  debug: false
  instance_name: "wikidata-sift-searxng"

search:
  safe_search: 0
  autocomplete: ""
  formats:
    - json

server:
  secret_key: "GENERATE_AND_REPLACE_WITH_openssl_rand_-hex_32"
  limiter: false
  image_proxy: false
  method: "GET"
  bind_address: "0.0.0.0"

redis:
  url: redis://searxng-valkey:6379/0

outgoing:
  request_timeout: 5.0
  max_request_timeout: 15.0
  pool_connections: 100
  pool_maxsize: 20
  enable_http2: true

engines:
  - name: google
    disabled: false
    weight: 1

  - name: duckduckgo
    disabled: false
    weight: 1

  - name: brave
    disabled: false
    weight: 1
```

Critical configuration notes:
- `search.formats: [json]` — **required** for JSON API to work. Without this, all API calls return 403.
- `server.limiter: false` — rate limiting disabled since this is a private local instance
- `server.method: "GET"` — allows GET requests for simple curl/httpx testing
- `use_default_settings.engines.keep_only` — restricts to only the three engines we want
- `server.secret_key` — placeholder; replaced with a real value in Task 3

**Step 3: Commit**

```bash
git add wikidata-SIFT/.gitignore wikidata-SIFT/config/searxng/settings.yml.template
git commit -m "config: add SearXNG settings template and gitignore"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Generate SearXNG settings with secret key

**Files:**
- Create: `wikidata-SIFT/config/searxng/settings.yml` (gitignored — local only)

**Step 1: Copy template and generate secret key**

```bash
cp wikidata-SIFT/config/searxng/settings.yml.template wikidata-SIFT/config/searxng/settings.yml
SECRET=$(openssl rand -hex 32)
sed -i "s/GENERATE_AND_REPLACE_WITH_openssl_rand_-hex_32/$SECRET/" wikidata-SIFT/config/searxng/settings.yml
```

**Step 2: Verify the secret was set**

```bash
grep secret_key wikidata-SIFT/config/searxng/settings.yml
```

Expected: Line shows a 64-character hex string, not the placeholder.

**Step 3: Verify gitignore is working**

```bash
git status wikidata-SIFT/config/searxng/settings.yml
```

Expected: File does not appear in git status (it's gitignored). No commit needed — this file is local-only.
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Start SearXNG and verify JSON API

**Step 1: Start the containers**

```bash
cd wikidata-SIFT && podman-compose up -d
```

Expected: Both `searxng-valkey` and `searxng` containers start without errors.

**Step 2: Wait for startup**

```bash
sleep 5
podman ps --format "{{.Names}} {{.Status}}"
```

Expected: Both containers show "Up" status.

**Step 3: Test the JSON API**

```bash
curl -s 'http://localhost:8080/search?q=wikidata&format=json' | python3 -m json.tool | head -20
```

Expected: JSON response with `results` array containing objects with `title`, `url`, and `content` fields.

**Step 4: Verify multiple engines respond**

```bash
curl -s 'http://localhost:8080/search?q=wikidata&format=json' | python3 -c "
import json, sys
data = json.load(sys.stdin)
engines = set()
for r in data.get('results', []):
    for e in r.get('engines', []):
        engines.add(e)
print(f'Results: {len(data.get(\"results\", []))}')
print(f'Engines responding: {engines}')
print(f'Unresponsive: {data.get(\"unresponsive_engines\", [])}')
"
```

Expected: At least 1 engine responds with results. Some engines may be unresponsive on first query (cold start).

**Step 5: Stop containers (will be started again during end-to-end testing)**

```bash
cd wikidata-SIFT && podman-compose down
```

No commit needed — this is operational verification only.
<!-- END_TASK_4 -->
