import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, lstatSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(repo, 'apps/desktop/package.json'))
const { parse } = createRequire(require.resolve('@vitejs/plugin-react'))('@babel/parser')
const revision = 'c97906287bb7a390b25e2025b600d9fb3c25d9c3'
const hash = value => createHash('sha256').update(value).digest('hex')

// Evaluate literal syntax only; never import or execute the inspected source.
export function staticBindings(source) {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] })
  const bindings = new Map()
  for (const item of ast.program.body) {
    const statement = item.type === 'ExportNamedDeclaration' ? item.declaration : item
    if (statement?.type !== 'VariableDeclaration') continue
    for (const decl of statement.declarations) {
      if (decl.id.type === 'Identifier') bindings.set(decl.id.name, decl)
    }
  }
  const active = new Set()
  function value(node) {
    assert(node, 'Missing literal expression')
    switch (node.type) {
      case 'TSAsExpression': case 'TSSatisfiesExpression': return value(node.expression)
      case 'StringLiteral': case 'NumericLiteral': case 'BooleanLiteral': return node.value
      case 'NullLiteral': return null
      case 'ArrayExpression': return node.elements.map(value)
      case 'ObjectExpression': {
        const result = Object.create(null)
        for (const property of node.properties) {
          assert(property.type === 'ObjectProperty' && !property.computed, 'Non-literal property')
          const key = property.key.name ?? property.key.value
          assert(typeof key === 'string' && !Object.hasOwn(result, key), 'Invalid/duplicate key')
          result[key] = value(property.value)
        }
        return result
      }
      case 'Identifier': return get(node.name).value
      default: throw new Error(`Non-literal expression: ${node.type}`)
    }
  }
  function get(name) {
    assert(!active.has(name), `Cyclic constant: ${name}`)
    const decl = bindings.get(name)
    assert(decl, `Unknown constant: ${name}`)
    active.add(name)
    try { return { value: value(decl.init), line: decl.loc.start.line } }
    finally { active.delete(name) }
  }
  return { get, names: [...bindings.keys()] }
}

export function inventory(sourceRoot) {
  const root = path.resolve(sourceRoot)
  const relative = path.relative(repo, root)
  assert(relative && relative.startsWith('..'), 'Source must be outside the rewrite')
  const inverse = path.relative(root, repo)
  assert(inverse && inverse.startsWith('..'), 'Source must not contain the rewrite')
  assert.equal(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), revision)
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(), '')
  const sources = []
  function read(file) {
    let current = root
    for (const part of file.split('/')) {
      current = path.join(current, part)
      assert(!lstatSync(current).isSymbolicLink(), `Symlink source: ${file}`)
    }
    const bytes = readFileSync(current)
    const pinned = execFileSync('git', ['-C', root, 'show', `${revision}:${file}`], { maxBuffer: 4 * 1024 * 1024 })
    assert.equal(hash(bytes), hash(pinned), `Source differs from pinned blob: ${file}`)
    sources.push({ file, sha256: hash(bytes) })
    return bytes.toString('utf8')
  }
  function module(file) { return staticBindings(read(file)) }
  const generator = module('config/scripts/generate-bundled-skill-guides.mjs')
  const embedded = module('src/cli/bundled-skill-guides.ts')
  const canonical = generator.get('CANONICAL_GUIDE_NAMES').value.slice().sort()
  const stubTopics = generator.get('STUB_TOPICS').value.slice().sort()
  const aliases = generator.get('GUIDE_ALIASES').value
  const guides = embedded.get('BUNDLED_SKILL_GUIDES').value
  assert.deepEqual(guides.map(g => g.name).sort(), canonical)
  assert.deepEqual(stubTopics, canonical)
  for (const folder of ['skill-guides', 'skill-stubs']) {
    assert.deepEqual(readdirSync(path.join(root, folder)).filter(n => n.endsWith('.md')).map(n => n.slice(0, -3)).sort(), canonical)
  }
  const normalized = text => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const records = guides.map(guide => {
    const file = `skill-guides/${guide.name}.md`
    const markdown = normalized(read(file))
    assert.equal(guide.markdown, markdown, `Stale embedded guide: ${guide.name}`)
    assert.equal(guide.fullMarkdown, markdown, `Full guide mismatch: ${guide.name}`)
    assert.deepEqual(guide.aliases, aliases[guide.name])
    const frontmatter = /^---[ \t]*\n[\s\S]*?\n---[ \t]*\n/.exec(markdown)?.[0]
    assert(frontmatter, `Missing frontmatter: ${file}`)
    const stub = normalized(read(`skill-stubs/${guide.name}.md`)).replace(/^\n+/, '').replace(/\n*$/, '\n')
    const projection = read(`skills/${guide.name}/SKILL.md`)
    assert.equal(projection, `${frontmatter}\n${stub}`, `Stale install projection: ${guide.name}`)
    return { name: guide.name, description: guide.description, aliases: guide.aliases,
      normalizedGuideSha256: hash(markdown), fullEqualsNormal: true,
      stubProjectionVerified: true, owner: 'WP-ENG-CLI', semanticReview: 'not-established-by-this-census' }
  })
  const tasks = module('src/shared/task-providers.ts').get('TASK_PROVIDERS')
  const placements = module('src/shared/skill-install-providers.ts').get('SKILL_INSTALL_PROVIDERS')
  const agentKeys = module('src/shared/skills-cli-agent-keys.ts')
  const mapping = agentKeys.get('SKILLS_CLI_AGENT_KEY_BY_TUI_AGENT')
  const caps = module('src/shared/skill-install-capability.ts')
  const capabilities = caps.names.filter(n => n.endsWith('_CAPABILITY')).map(name => ({ name, ...caps.get(name) }))
  const tests = ['config/scripts/generate-bundled-skill-guides.test.mjs', 'src/shared/task-providers.test.ts',
    'src/shared/skills-cli-agent-keys.test.ts', 'src/shared/skill-install-contract.test.ts']
  for (const file of tests) read(file)
  const license = read('LICENSE')
  return { schema: 'drogon.source-skill-provider-census/1', sourceRevision: revision,
    provenance: { license: 'MIT', licenseSha256: hash(license), copyright: 'Copyright (c) 2026 Lovecast Inc.' },
    status: 'static-registries-and-projections-only', guides: records,
    taskProviders: { ...tasks, owner: 'WP-CAP-INT' },
    nativeSkillPlacements: { ...placements, owner: 'WP-ENG-PLUGINS' },
    communitySkillsAgentKeys: { ...mapping, universal: agentKeys.get('SKILLS_CLI_UNIVERSAL_AGENT_KEY').value, owner: 'WP-ENG-CLI' },
    skillWireCapabilities: { values: capabilities, owner: 'WP-ENG-PLUGINS' },
    testPointers: tests.map(file => ({ file, evidence: 'path-and-hash-only', executed: false })), sources,
    limits: ['No guide instructions were executed and no installed skill was read or changed.',
      'Three distinct namespaces: bundled guide topics, native skill placement destinations, and community CLI agent keys. Do not conflate counts.',
      'Task provider registry is not the universe of git hosting, credentials, model providers or runtime transports.',
      'Wire capability declarations are not proof a running host advertises or implements them.',
      'Guide command/prose semantics, handler behavior, installation, permissions, mixed-version negotiation and provider journeys need test-wave proof.'] }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'Usage: node inventory-source-skill-providers.mjs <frozen-source-root>')
  console.log(JSON.stringify(inventory(process.argv[2]), null, 2))
}
