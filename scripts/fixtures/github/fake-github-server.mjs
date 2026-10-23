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

function readDataset() {
  try {
    const parsed = JSON.parse(readFileSync(values.data, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    // A dataset the test is mid-write is an honest empty list, never a crash
    // that would take the whole fixture down between poll ticks.
    return {}
  }
}

function readCollection(key) {
  const listed = readDataset()[key]
  return Array.isArray(listed) ? listed : []
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

// Paging is real: a request is answered with its own `page`/`per_page`
// window, plus GitHub's `Link: <...>; rel="next"` header while more rows
// remain, so a watch that reads only the first page fails its test instead
// of passing against a one-page world. A dataset carrying
// `"linkHeader": false` serves the same windows with NO `Link` header at
// all, which is the harder case a client must still get right: a full page
// is not proof of the end of the list.
function pageUrl(url, page) {
  const next = new URL(url)
  next.searchParams.set('page', String(page))
  return `http://127.0.0.1${next.pathname}${next.search}`
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

  const listing = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/(pulls|issues)$/)
  if (req.method === 'GET' && listing) {
    logRequest(entry)
    if (!entry.hasCredential) {
      send(res, 401, { message: 'Bad credentials' })
      return
    }
    // GitHub's issues endpoint returns issues AND pull requests; the PRs it
    // returns carry a `pull_request` object. Reproduce that faithfully, so a
    // watch that fails to exclude them fails the test rather than passing on
    // a fixture that is kinder than the real API.
    const listed =
      listing[3] === 'issues'
        ? [
            ...readCollection('issues'),
            ...readCollection('pulls').map((pull) => ({
              ...pull,
              pull_request: { url: `${url.origin}/repos/${listing[1]}/${listing[2]}/pulls/${pull.number}` },
            })),
          ].sort((a, b) => Number(a.number) - Number(b.number))
        : readCollection('pulls')
    const perPage = Number(url.searchParams.get('per_page') ?? '30') || 30
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1)
    const start = (page - 1) * perPage
    const rows = listed.slice(start, start + perPage)
    const headers = {}
    if (readDataset().linkHeader !== false) {
      const relations = []
      if (start + perPage < listed.length) {
        relations.push(`<${pageUrl(url, page + 1)}>; rel="next"`)
        relations.push(`<${pageUrl(url, Math.ceil(listed.length / perPage))}>; rel="last"`)
      }
      if (page > 1) relations.push(`<${pageUrl(url, 1)}>; rel="first"`)
      if (relations.length > 0) headers.link = relations.join(', ')
    }
    send(res, 200, rows, headers)
    return
  }

  logRequest(entry)
  send(res, 404, { message: 'Not Found' })
})

server.listen(Number(values.port), '127.0.0.1', () => {
  process.stdout.write(`LISTEN ${server.address().port}\n`)
})
