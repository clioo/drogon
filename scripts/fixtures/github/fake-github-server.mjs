// Fake GitHub REST server for Drogon's `github_pr.v1` watch tests.
//
// HARD RULE: this fixture never contacts github.com and never reads a real
// token. It implements exactly the one endpoint a pull-request watch reads:
//
//   GET /repos/:owner/:repo/pulls   (state=open&sort=created&direction=asc&per_page=N)
//
// Auth: `Authorization: Bearer fixture-token` (or `token fixture-token`).
// Anything else — including no header at all — gets GitHub's real 401 body,
// so tests can prove a watch with no granted secret is refused rather than
// silently reading a public list.
//
// The dataset is a JSON file re-read on EVERY request
// (`{"pulls": [{"number": 42, "assignees": [{"login": "clioo"}],
//  "requested_reviewers": [{"login": "clioo"}], ...}]}`), so a test can make
// "a new pull request appears" true by writing the file — no HTTP client
// code and no in-process control endpoint. Every handled request appends one
// JSON line when `--log` is given, so a test can assert the exact path and
// Authorization header the daemon sent.
//
// Usage: node fake-github-server.mjs --data <json> [--port 0] [--log <file>]
// Prints `LISTEN <port>` on stdout once bound (port 0 = ephemeral).

import { createServer } from 'node:http'
import { appendFileSync, readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const FIXTURE_TOKEN = 'fixture-token'

const { values } = parseArgs({
  options: {
    data: { type: 'string' },
    port: { type: 'string', default: '0' },
    log: { type: 'string', default: '' },
  },
})

if (!values.data) {
  process.stderr.write('fake-github-server: --data <json> is required\n')
  process.exit(2)
}

function logRequest(record) {
  if (!values.log) return
  appendFileSync(values.log, `${JSON.stringify(record)}\n`)
}

function readPulls() {
  try {
    const parsed = JSON.parse(readFileSync(values.data, 'utf8'))
    return Array.isArray(parsed.pulls) ? parsed.pulls : []
  } catch {
    // A dataset the test is mid-write is an honest empty list, never a crash
    // that would take the whole fixture down between poll ticks.
    return []
  }
}

function send(res, status, body, headers = {}) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
    ...headers,
  })
  res.end(text)
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const authorization = req.headers.authorization ?? ''
  const entry = {
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    authorization: authorization ? authorization.split(' ')[0] : null,
    hasCredential: authorization.endsWith(FIXTURE_TOKEN),
  }

  const pulls = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls$/)
  if (req.method === 'GET' && pulls) {
    logRequest(entry)
    if (!entry.hasCredential) {
      send(res, 401, { message: 'Bad credentials' })
      return
    }
    const listed = readPulls()
    const page = Number(url.searchParams.get('per_page') ?? '30') || 30
    send(res, 200, listed.slice(0, page))
    return
  }

  logRequest(entry)
  send(res, 404, { message: 'Not Found' })
})

server.listen(Number(values.port), '127.0.0.1', () => {
  process.stdout.write(`LISTEN ${server.address().port}\n`)
})
