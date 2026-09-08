// Fake Jira REST server for Drogon's daemon-side Jira tests (R17-A).
//
// HARD RULE: this fixture never contacts a real Atlassian site and never
// reads real credentials. It implements just enough of the Jira Cloud REST
// v3 (and the Server/DC v2 shapes the fork distinguishes) for
// `crates/drogon-core/tests/jira_*.rs`:
//
//   GET  /rest/api/3/myself            GET  /rest/api/2/myself
//   POST /rest/api/3/search/jql        POST /rest/api/2/search   (classic)
//   GET  /rest/api/3/project/search    GET  /rest/api/2/project  (array)
//   GET  /rest/api/{2,3}/issue/createmeta/<project>/issuetypes[/<type>]
//   GET  /rest/api/{2,3}/priority
//   GET  /rest/api/{2,3}/user/search
//   GET  /rest/api/{2,3}/issue/<key>            (detail; failure injection via -404/-429/-400 keys)
//   GET  /rest/api/{2,3}/issue/<key>/transitions
//   GET  /rest/api/{2,3}/issue/<key>/comment    (paged by `comments`, orderBy=created)
//   POST /rest/api/{2,3}/issue                  (create; logs its body; FAIL_CREATE summary → 400)
//   PUT  /rest/api/{2,3}/issue/<key>            (field updates; logs body)
//   PUT  /rest/api/{2,3}/issue/<key>/assignee   (logs the user ref shape)
//   POST /rest/api/{2,3}/issue/<key>/transitions
//   POST /rest/api/{2,3}/issue/<key>/comment    (logs the body shape; returns id 90001)
//
// Auth: `Basic base64(<email>:fixture-token)` or `Bearer fixture-token`
// (the PAT shape). Anything else gets a real 401 body.
//
// Behavior switches ride inside the JQL so individual tests do not need
// extra config: a JQL containing JQL_SLOW (10s delay, for cancellation),
// JQL_RATE_LIMIT (429 + Retry-After: 7), JQL_NOT_FOUND (404) or JQL_BAD
// (400 with Atlassian's errorMessages shape) triggers that path.
//
// The default dataset reproduces Carlos's Tasks-page screenshot shape: 19
// issues in project DROG, 13 of them in "Backlog", priorities High /
// Medium / Not Set, unassigned and un-prioritized rows included. See
// data/screenshot-site.json.
//
// Usage: node fake-jira-server.mjs --data <json> --port <n>   (port 0 =
// ephemeral; the chosen port is printed as `LISTEN <port>` on stdout.)

import { createServer } from 'node:http'
import { appendFileSync, readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const FIXTURE_TOKEN = 'fixture-token'
const SLOW_JQL_DELAY_MS = 10_000

const { values } = parseArgs({
  options: {
    data: { type: 'string', default: new URL('./data/screenshot-site.json', import.meta.url).pathname },
    port: { type: 'string', default: '0' },
    log: { type: 'string', default: '' },
  },
})

const dataset = JSON.parse(readFileSync(values.data, 'utf8'))

// Test-only observability: when --log is given, every handled request
// appends one JSON line so Rust tests can assert exactly which endpoint,
// JQL and field list the daemon sent — without touching the contract.
function logRequest(record) {
  if (!values.log) return
  appendFileSync(values.log, `${JSON.stringify(record)}\n`)
}

function checkAuth(req) {
  const header = req.headers.authorization ?? ''
  if (header === `Bearer ${FIXTURE_TOKEN}`) return true
  if (header.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
      return decoded.split(':')[1] === FIXTURE_TOKEN
    } catch {
      return false
    }
  }
  return false
}

function authError(res) {
  res.writeHead(401, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ errorMessages: ['You are not authenticated. Authentication required to perform this operation.'], errors: {} }))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let text = ''
    req.on('data', (chunk) => {
      text += chunk
      if (text.length > 1024 * 1024) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(text ? JSON.parse(text) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function page(records, startAt, maxResults) {
  const start = Number.isFinite(startAt) ? startAt : 0
  const size = Number.isFinite(maxResults) && maxResults > 0 ? maxResults : 50
  return {
    startAt: start,
    maxResults: size,
    total: records.length,
    isLast: start + size >= records.length,
    values: records.slice(start, start + size),
  }
}

function jqlFailure(jql, res) {
  if (jql.includes('JQL_RATE_LIMIT')) {
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '7' })
    res.end(JSON.stringify({ errorMessages: ['Rate limit exceeded.'], errors: {} }))
    return true
  }
  if (jql.includes('JQL_NOT_FOUND')) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ errorMessages: ['Issue does not exist or you do not have permission to see it.'], errors: {} }))
    return true
  }
  if (jql.includes('JQL_BAD')) {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ errorMessages: ["The value 'NOT_A_FIELD' does not exist for the field 'field'."], errors: {} }))
    return true
  }
  return false
}

const server = createServer(async (req, res) => {
  if (!checkAuth(req)) return authError(res)
  const url = new URL(req.url, 'http://fixture.local')
  const path = url.pathname
  const api = path.startsWith('/rest/api/2') ? 'v2' : path.startsWith('/rest/api/3') ? 'v3' : null

  // /myself (both versions share the fixture viewer).
  if (api && path.endsWith('/myself')) {
    logRequest({ path, method: req.method })
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(dataset.myself))
  }

  // Issue search: POST /search/jql (Cloud) or POST /search (classic).
  if (api && req.method === 'POST' && (path.endsWith('/search/jql') || path.endsWith('/search'))) {
    const body = await readBody(req)
    const jql = typeof body.jql === 'string' ? body.jql : ''
    logRequest({ path, method: req.method, jql, maxResults: body.maxResults ?? null, fields: Array.isArray(body.fields) ? body.fields : null })
    if (jqlFailure(jql, res)) return
    if (jql.includes('JQL_SLOW')) await new Promise((resolve) => setTimeout(resolve, SLOW_JQL_DELAY_MS))
    const matching = dataset.issues.filter((issue) => matchesJql(issue, jql))
    const startAt = Number(body.startAt ?? 0)
    const maxResults = Number(body.maxResults ?? 50)
    const window = matching.slice(startAt, startAt + maxResults)
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(
      JSON.stringify({
        issues: window.map((issue) => pickFields(issue, body.fields)),
        startAt,
        maxResults,
        total: matching.length,
        isLast: startAt + maxResults >= matching.length,
      }),
    )
  }

  // Project picker: paged search (Cloud) or the plain array (Server/DC).
  if (api && path.endsWith('/project/search')) {
    logRequest({ path, method: req.method })
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(page(dataset.projects, Number(url.searchParams.get('startAt')), Number(url.searchParams.get('maxResults')))))
  }
  if (api && path.endsWith('/project')) {
    logRequest({ path, method: req.method })
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(dataset.projects))
  }

  // Create metadata: issuetypes (paged) and per-type fields (paged).
  const createmeta = path.match(/^\/rest\/api\/[23]\/issue\/createmeta\/([^/]+)\/issuetypes(?:\/([^/]+))?$/)
  if (api && createmeta) {
    logRequest({ path, method: req.method })
    const issueTypes = dataset.createmeta.issueTypes ?? []
    if (createmeta[2] === undefined) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ ...page(issueTypes, Number(url.searchParams.get('startAt')), Number(url.searchParams.get('maxResults'))), issueTypes: undefined }))
    }
    const fields = dataset.createmeta.fieldsByType?.[createmeta[2]] ?? []
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(page(fields, Number(url.searchParams.get('startAt')), Number(url.searchParams.get('maxResults')))))
  }

  if (api && path.endsWith('/priority')) {
    logRequest({ path, method: req.method })
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(dataset.priorities ?? []))
  }

  if (api && path.endsWith('/user/search')) {
    logRequest({ path, method: req.method })
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(dataset.users ?? []))
  }

  // --- R17-C: issue detail, comments, transitions, mutations --------------

  // Issue detail: dataset lookup by key; failure injection via magic keys
  // (DROG-404 / DROG-429 / DROG-400) keeps every other test config-free.
  const issueMatch = path.match(/^\/rest\/api\/[23]\/issue\/([^/]+)$/)
  if (api && req.method === 'GET' && issueMatch) {
    const key = decodeURIComponent(issueMatch[1])
    logRequest({ path, method: req.method, key, fields: url.searchParams.get('fields'), expand: url.searchParams.get('expand') })
    if (key.endsWith('-404')) {
      res.writeHead(404, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ errorMessages: ['Issue does not exist or you do not have permission to see it.'], errors: {} }))
    }
    if (key.endsWith('-429')) {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '7' })
      return res.end(JSON.stringify({ errorMessages: ['Rate limit exceeded.'], errors: {} }))
    }
    if (key.endsWith('-400')) {
      res.writeHead(400, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ errorMessages: ["The value 'NOT_A_FIELD' does not exist for the field 'field'."], errors: {} }))
    }
    const issue = (dataset.issues ?? []).find((candidate) => candidate.key === key)
    if (!issue) {
      res.writeHead(404, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ errorMessages: ['Issue does not exist or you do not have permission to see it.'], errors: {} }))
    }
    // Honor a `fields` list the way Jira does (the daemon asks for its
    // detail field set, description/attachment included).
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(pickFields(issue, url.searchParams.get('fields')?.split(',') ?? null)))
  }

  if (api && req.method === 'GET' && path.endsWith('/transitions')) {
    const key = decodeURIComponent(path.split('/issue/')[1].split('/')[0])
    logRequest({ path, method: req.method, key })
    if (key.endsWith('-404') || key.endsWith('-429') || key.endsWith('-400')) {
      res.writeHead(Number(key.split('-').pop()), { 'content-type': 'application/json', ...(key.endsWith('-429') ? { 'retry-after': '7' } : {}) })
      return res.end(JSON.stringify({ errorMessages: ['Transition lookup failed (fixture switch).'], errors: {} }))
    }
    const issue = (dataset.issues ?? []).find((candidate) => candidate.key === key)
    const from = issue?.fields.status
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ transitions: (dataset.transitions ?? []).map((transition) => ({ ...transition, from })) }))
  }

  const commentListMatch = path.match(/^\/rest\/api\/[23]\/issue\/([^/]+)\/comment$/)
  if (api && req.method === 'GET' && commentListMatch) {
    const key = decodeURIComponent(commentListMatch[1])
    logRequest({ path, method: req.method, key, orderBy: url.searchParams.get('orderBy') })
    const comments = (dataset.comments ?? {})[key] ?? []
    const start = Number(url.searchParams.get('startAt') ?? 0)
    const size = Number(url.searchParams.get('maxResults') ?? 50)
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({
      startAt: start,
      maxResults: size,
      total: comments.length,
      isLast: start + size >= comments.length,
      comments: comments.slice(start, start + size),
    }))
  }

  if (api && req.method === 'POST' && path.endsWith('/issue')) {
    const body = await readBody(req)
    logRequest({ path, method: req.method, body })
    const summary = body?.fields?.summary ?? ''
    if (typeof summary === 'string' && summary.includes('FAIL_CREATE')) {
      res.writeHead(400, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ errorMessages: ['The issue could not be created (fixture FAIL_CREATE switch).'], errors: {} }))
    }
    const maxNumber = Math.max(0, ...(dataset.issues ?? []).map((issue) => Number(issue.key.split('-')[1]) || 0))
    const key = `DROG-${maxNumber + 1}`
    res.writeHead(201, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ id: String(10000 + maxNumber + 1), key, self: `https://fixture.local/rest/api/3/issue/${key}` }))
  }

  const issueWriteMatch = path.match(/^\/rest\/api\/[23]\/issue\/([^/]+)(\/assignee|\/transitions|\/comment)?$/)
  if (api && (req.method === 'PUT' || req.method === 'POST') && issueWriteMatch) {
    const key = decodeURIComponent(issueWriteMatch[1])
    const sub = issueWriteMatch[2] ?? ''
    const body = await readBody(req)
    logRequest({ path, method: req.method, key, sub, body })
    if (key.endsWith('-400')) {
      res.writeHead(400, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ errorMessages: ['The value is invalid (fixture -400 switch).'], errors: {} }))
    }
    if (sub === '/comment') {
      res.writeHead(201, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ id: '90001', self: `https://fixture.local/rest/api/3/issue/${key}/comment/90001` }))
    }
    res.writeHead(204, { 'content-type': 'application/json' })
    return res.end()
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ errorMessages: [`Fixture has no handler for ${req.method} ${path}.`], errors: {} }))
})

// A deliberately small JQL subset: the daemon's own filter JQLs plus
// `project = X`. Anything else matches everything (the tests that need
// filtering use these forms).
function matchesJql(issue, jql) {
  const trimmed = jql.trim()
  const project = /project\s*=\s*([A-Za-z0-9_-]+)/.exec(trimmed)
  if (project && issue.fields.project.key !== project[1]) return false
  if (trimmed.startsWith('assignee = currentUser()') && issue.fields.assignee?.accountId !== dataset.myself.accountId) return false
  if (trimmed.startsWith('reporter = currentUser()') && issue.fields.reporter?.accountId !== dataset.myself.accountId) return false
  if (/resolution IS NOT EMPTY/.test(trimmed) && issue.fields.resolution == null) return false
  if (/resolution = Unresolved/.test(trimmed) && issue.fields.resolution != null) return false
  return true
}

// Mirrors the daemon's ISSUE_LIST_FIELDS so a "fields" request is honored
// the way Jira honors it (description etc. simply absent).
function pickFields(issue, fields) {
  if (!Array.isArray(fields)) return issue
  const allowed = new Set(['id', 'key', ...fields])
  const picked = { id: issue.id, key: issue.key, fields: {} }
  for (const [name, value] of Object.entries(issue.fields)) {
    if (allowed.has(name)) picked.fields[name] = value
  }
  return picked
}

server.listen(Number(values.port), '127.0.0.1', () => {
  const address = server.address()
  process.stdout.write(`LISTEN ${address.port}\n`)
})
