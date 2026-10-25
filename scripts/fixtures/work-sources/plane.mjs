// Stateful Plane v1 fixture. Only documented fields and endpoints are accepted.
// No live credentials or network: hosted by fake-sources-server on loopback.
export function planeFixture({ send, readBody, log }) {
  const projects = [
    { id: 'plane-app', name: 'Application', identifier: 'APP', cycle_view: true },
    { id: 'plane-ops', name: 'Operations', identifier: 'OPS', cycle_view: false },
    { id: 'plane-web', name: 'Website', identifier: 'WEB', cycle_view: false },
  ]
  const states = [
    { id: 'ps-done', name: 'Done', group: 'completed', sequence: 4 },
    { id: 'ps-review', name: 'In Review', group: 'started', sequence: '3' },
    { id: 'ps-backlog', name: 'Backlog', group: 'backlog', sequence: 0 },
    { id: 'ps-todo', name: 'Todo', group: 'unstarted', sequence: 1 },
    { id: 'ps-progress', name: 'In Progress', group: 'started', sequence: 2 },
    { id: 'ps-cancelled', name: 'Cancelled', group: 'cancelled', sequence: 5 },
  ]
  const today = Date.now()
  const day = (offset) => new Date(today + offset * 86400000).toISOString()
  const cycles = [
    { id: 'pc-old', name: 'Previous cycle', start_date: day(-30), end_date: day(-16), status: 'completed' },
    { id: 'pc-active', name: 'Current cycle', start_date: day(-7), end_date: day(7), status: 'current' },
    { id: 'pc-next', name: 'Next cycle', start_date: day(8), end_date: day(22), status: 'upcoming' },
  ]
  const user = { id: 'plane-me', display_name: 'Jon Doe', first_name: 'Jon', last_name: 'Doe' }
  const issues = Array.from({ length: 5 }, (_, i) => ({
    id: `pi-${i + 1}`, project: 'plane-app', sequence_id: 128 + i,
    name: `Plane task ${i + 1}`, description_stripped: 'Context from Plane',
    priority: i ? 'none' : 'high', state: states.find((s) => s.name === ['In Review', 'Todo', 'Backlog', 'Done', 'Todo'][i]).id,
    assignees: i === 2 ? [] : [user], type: { id: 'type-bug', name: 'Bug' },
    updated_at: '2026-10-01T09:00:00Z',
  }))
  const membership = new Map([['pi-1', 'pc-active'], ['pi-2', 'pc-active'], ['pi-4', 'pc-old'], ['pi-5', 'pc-next']])
  let config = {}
  function page(items, url) {
    const offset = Number((url.searchParams.get('cursor') ?? '0:0:0').split(':')[1]) * 2
    const more = offset + 2 < items.length
    return { results: items.slice(offset, offset + 2), next_page_results: more,
      next_cursor: config.pagination === 'repeat' ? '2:1:0' : `2:${offset / 2 + 1}:0` }
  }
  return async (req, res, url) => {
    if (url.pathname === '/__fixture/plane/config') {
      config = await readBody(req); send(res, 200, { ok: true }); return true
    }
    if (url.pathname.startsWith('/__fixture/plane/issue/')) {
      const number = Number(url.pathname.split('/').pop().replace('APP-', ''))
      const issue = issues.find((i) => i.sequence_id === number)
      const body = await readBody(req)
      if (!issue) { send(res, 404, { detail: 'Not found.' }); return true }
      if ('cycle' in body) body.cycle === null ? membership.delete(issue.id) : membership.set(issue.id, body.cycle)
      Object.assign(issue, Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'cycle')))
      send(res, 200, { ok: true }); return true
    }
    if (!url.pathname.startsWith('/plane/')) return false
    if (req.headers['x-api-key'] !== 'plane_fixture' || req.headers.authorization) {
      send(res, 401, { detail: 'Invalid API key.' }); return true
    }
    const path = url.pathname.slice('/plane'.length)
    const body = req.method === 'POST' || req.method === 'PATCH' ? await readBody(req) : undefined
    log({ service: 'plane', method: req.method, path, query: url.search, body })
    const reply = (status, value) => { send(res, status, value); return true }
    if (config.failure && path.includes(config.failure.path)) {
      if (config.failure.status === 429) res.setHeader('retry-after', '9')
      return reply(config.failure.status, { detail: config.failure.message })
    }
    if (path === '/api/v1/users/me/') return reply(200, user)
    if (!path.startsWith('/api/v1/workspaces/drogon/')) return reply(404, { detail: 'Workspace not found.' })
    const suffix = path.slice('/api/v1/workspaces/drogon/'.length)
    if (suffix === 'projects/') return reply(200, page(projects, url))
    const byKey = suffix.match(/^work-items\/APP-(\d+)\/$/)
    if (byKey) {
      const issue = issues.find((i) => i.sequence_id === Number(byKey[1]) && !i.deleted)
      return issue ? reply(200, issue) : reply(404, { detail: 'Work item not found.' })
    }
    const match = suffix.match(/^projects\/([^/]+)\/(.*)$/)
    const project = projects.find((p) => p.id === match?.[1])
    if (!project) return reply(404, { detail: 'Project not found.' })
    const resource = match[2]
    if (!resource) return reply(200, project)
    if (resource === 'states/') return reply(200, page(states, url))
    if (resource === 'cycles/') return reply(200, page(project.cycle_view ? cycles : [], url))
    const cycle = resource.match(/^cycles\/([^/]+)\/cycle-issues\/(?:([^/]+)\/)?$/)
    if (cycle) {
      if (!cycles.some((c) => c.id === cycle[1])) return reply(404, { detail: 'Cycle not found.' })
      if (req.method === 'GET') return reply(200, page([...membership].filter(([id, c]) => c === cycle[1] && !issues.find((i) => i.id === id)?.deleted).map(([id, c]) => ({ id: `member-${id}`, issue: id, cycle: c })), url))
      if (req.method === 'POST' && Object.keys(body).length === 1 && Array.isArray(body.issues)) {
        for (const id of body.issues) membership.set(id, cycle[1])
        return reply(200, body.issues.map((id) => ({ id: `member-${id}`, issue: id, cycle: cycle[1] })))
      }
      if (req.method === 'DELETE' && cycle[2]) { membership.delete(cycle[2]); return reply(204) }
    }
    if (resource === 'work-items/') {
      if (req.method === 'GET') return reply(200, page(issues.filter((i) => i.project === project.id && !i.deleted), url))
      if (req.method === 'POST') {
        if (Object.keys(body).some((k) => !['name', 'description_html', 'state', 'assignees'].includes(k))) return reply(400, { detail: 'Unsupported create field.' })
        const issue = { ...issues[0], ...body, id: `pi-${issues.length + 1}`, sequence_id: 128 + issues.length, project: project.id,
          state: body.state ?? 'ps-todo', description_stripped: body.description_html.replace(/<[^>]*>/g, ''), assignees: body.assignees ?? [] }
        issues.push(issue); return reply(201, issue)
      }
    }
    const one = resource.match(/^work-items\/([^/]+)\/$/)
    const issue = issues.find((i) => i.id === one?.[1] && i.project === project.id && !i.deleted)
    if (issue) {
      if (req.method === 'GET') return reply(200, issue)
      if (req.method === 'PATCH') {
        if (Object.keys(body).some((k) => k !== 'state')) return reply(400, { detail: 'Unsupported PATCH field.' })
        if (!states.some((s) => s.id === body.state)) return reply(400, { detail: 'Invalid state.' })
        issue.state = body.state; return reply(200, issue)
      }
    }
    return reply(404, { detail: 'Work item not found.' })
  }
}
