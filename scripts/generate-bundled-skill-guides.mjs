// MIT Copyright (c) 2026 Lovecast Inc.
// Source: /Users/carlos/Documents/Drogon-orca/config/scripts/generate-bundled-skill-guides.mjs
// Ported for Drogon: generates the embedded Rust guide table and the
// installable `skills/<topic>/SKILL.md` projections from `skill-guides/` and
// `skill-stubs/`.

import { constants } from 'node:fs'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

// Minimal frontmatter reader for the exact shape the bundled guides use:
// `---`, `name: <value>`, `description: >-` plus two-space-indented folded
// lines, `---`. Mirrors the Rust parser in crates/drogon-cli/src/skills.rs so
// both sides accept precisely the same sources. The reference script parses
// full YAML; that dependency is unavailable in this repository.
function parseFrontmatterValues(raw, sourcePath) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const values = {}
  let index = 0
  while (index < lines.length) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[index])
    if (!match) {
      index += 1
      continue
    }
    const key = match[1]
    const value = match[2].trim()
    if (value === '|-' || value === '>-') {
      const block = []
      index += 1
      while (index < lines.length && /^(?:\s{2,}|\s*$)/.test(lines[index])) {
        block.push(lines[index].replace(/^\s{2}/, ''))
        index += 1
      }
      values[key] = block.join(' ').replace(/\s+/g, ' ').trim()
      continue
    }
    values[key] = value
    index += 1
  }
  if (typeof values.name !== 'string' || typeof values.description !== 'string') {
    throw new Error(`Guide source must declare name and description: ${sourcePath}`)
  }
  return values
}

const SCRIPT_DIR = import.meta.dirname
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')

const CANONICAL_GUIDE_NAMES = ['drogon-cli', 'orchestration']

// Why: old discovery stubs can outlive a rename indefinitely, so aliases are
// a compatibility ledger: add entries for renames, but never remove them.
const GUIDE_ALIASES = {
  'drogon-cli': [],
  orchestration: []
}

// Why: a stubbed topic ships a hybrid discovery stub as its installable projection while
// `drogon-cli skills get --topic <topic>` still serves the full version-matched guide from
// the binary. Migrating a topic here is effectively one-way — earlier fat installs rely on
// the stub landing to converge — so entries are added as skills convert, never removed.
// The stub body lives in skill-stubs/<topic>.md; the projection reuses the guide's own
// frontmatter.
const STUB_TOPICS = ['drogon-cli', 'orchestration']

const RUST_MODULE_PATH = path.join(REPO_ROOT, 'crates', 'drogon-cli', 'src', 'bundled_skill_guides.rs')
// include_str! paths are relative to crates/drogon-cli/src/.
const RUST_GUIDE_INCLUDE_ROOT = '../../../skill-guides'

function normalizeMarkdown(markdown) {
  return markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function parseFrontmatter(markdown, sourcePath) {
  const normalized = normalizeMarkdown(markdown)
  const match = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(normalized)
  if (!match) {
    throw new Error(`Guide source has no YAML frontmatter: ${sourcePath}`)
  }
  let values
  try {
    values = parseFrontmatterValues(match[1], sourcePath)
  } catch (error) {
    throw new Error(
      `Guide source has invalid YAML frontmatter: ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (
    !values ||
    typeof values !== 'object'
  ) {
    throw new Error(`Guide source must declare name and description: ${sourcePath}`)
  }
  return {
    name: values.name,
    description: values.description.replace(/\s+/g, ' ').trim()
  }
}

function frontmatterBlock(markdown, sourcePath) {
  const normalized = normalizeMarkdown(markdown)
  const match = /^---[ \t]*\n[\s\S]*?\n---[ \t]*\n/.exec(normalized)
  if (!match) {
    throw new Error(`Guide source has no YAML frontmatter block: ${sourcePath}`)
  }
  return match[0]
}

// Why: the stub's routing frontmatter (name + description) must stay byte-identical to the
// guide's — it is the unchanged discovery surface — so we reuse the guide's own block and
// replace only the body. Body normalized to LF with exactly one trailing newline.
function composeStubProjection(guideMarkdown, stubBody, sourcePath) {
  const block = frontmatterBlock(guideMarkdown, sourcePath)
  const body = normalizeMarkdown(stubBody).replace(/^\n+/, '').replace(/\n*$/, '\n')
  return `${block}\n${body}`
}

function rustString(value) {
  return JSON.stringify(value)
}

function serializeRustModule(guides) {
  const entries = guides
    .map((guide) => {
      return [
        '    BundledSkillGuide {',
        `        name: ${rustString(guide.name)},`,
        `        description: ${rustString(guide.description)},`,
        `        markdown: include_str!(${rustString(`${RUST_GUIDE_INCLUDE_ROOT}/${guide.name}.md`)}),`,
        `        full_markdown: include_str!(${rustString(`${RUST_GUIDE_INCLUDE_ROOT}/${guide.name}.md`)}),`,
        `        aliases: &[${guide.aliases.map(rustString).join(', ')}],`,
        '    },'
      ].join('\n')
    })
    .join('\n')

  return `// Generated by scripts/generate-bundled-skill-guides.mjs. Do not edit.
// MIT Copyright (c) 2026 Lovecast Inc.
// Source: /Users/carlos/Documents/Drogon-orca/config/scripts/generate-bundled-skill-guides.mjs

pub struct BundledSkillGuide {
    pub name: &'static str,
    pub description: &'static str,
    pub markdown: &'static str,
    // Why: no current guide has bundled reference documents, so --full is byte-identical for now.
    pub full_markdown: &'static str,
    pub aliases: &'static [&'static str],
}

/// Canonical (sorted-by-name) embedded guide table.
pub const BUNDLED_SKILL_GUIDES: &[BundledSkillGuide] = &[
${entries}
];
`
}

function assertAliasContract(guides) {
  const canonicalNames = new Set(guides.map((guide) => guide.name))
  const seenAliases = new Set()
  for (const guide of guides) {
    for (const alias of guide.aliases) {
      if (canonicalNames.has(alias)) {
        throw new Error(`Guide alias collides with canonical name: ${alias}`)
      }
      if (seenAliases.has(alias)) {
        throw new Error(`Guide alias is assigned more than once: ${alias}`)
      }
      seenAliases.add(alias)
    }
  }
}

async function assertStubSourcesMatchTopics(repoRoot) {
  const stubRoot = path.join(repoRoot, 'skill-stubs')
  let names = []
  try {
    names = (await readdir(stubRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name.slice(0, -3))
  } catch (error) {
    // Why: a repo state with no stubbed topics yet has no skill-stubs directory at all.
    if (error.code !== 'ENOENT') {
      throw error
    }
  }
  const found = names.sort((left, right) => left.localeCompare(right, 'en'))
  const expected = [...STUB_TOPICS].sort((left, right) => left.localeCompare(right, 'en'))
  if (JSON.stringify(found) !== JSON.stringify(expected)) {
    throw new Error(
      `skill-stubs sources must match STUB_TOPICS.\nExpected: ${expected.join(', ') || '(none)'}\nFound: ${found.join(', ') || '(none)'}`
    )
  }
  for (const name of STUB_TOPICS) {
    if (!CANONICAL_GUIDE_NAMES.includes(name)) {
      throw new Error(`Stub topic is not a canonical guide: ${name}`)
    }
  }
}

// Why: path.relative yields `\` on Windows, but these paths are asserted in tests and pasted into commands.
// split(sep) rather than replaceAll('\\', '/') so a POSIX filename containing a backslash survives intact.
function toPosixRelativePath(repoRoot, filePath, pathModule = path) {
  return pathModule.relative(repoRoot, filePath).split(pathModule.sep).join('/')
}

async function buildArtifacts(repoRoot = REPO_ROOT) {
  const guideRoot = path.join(repoRoot, 'skill-guides')
  const sourceFiles = (await readdir(guideRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.slice(0, -3))
    .sort((left, right) => left.localeCompare(right, 'en'))
  const expectedNames = [...CANONICAL_GUIDE_NAMES].sort((left, right) =>
    left.localeCompare(right, 'en')
  )
  if (JSON.stringify(sourceFiles) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `Guide sources must match the canonical topic list.\nExpected: ${expectedNames.join(', ')}\nFound: ${sourceFiles.join(', ')}`
    )
  }
  await assertStubSourcesMatchTopics(repoRoot)

  const stubTopics = new Set(STUB_TOPICS)
  const guides = []
  const projections = []
  for (const name of expectedNames) {
    const sourcePath = path.join(guideRoot, `${name}.md`)
    // Why: Git may render text with native EOLs despite repository policy; the
    // embedded guide and generated projection must have one platform-neutral identity.
    const markdown = normalizeMarkdown(await readFile(sourcePath, 'utf8'))
    const frontmatter = parseFrontmatter(markdown, toPosixRelativePath(repoRoot, sourcePath))
    if (frontmatter.name !== name) {
      throw new Error(`Guide source ${name}.md declares mismatched name ${frontmatter.name}`)
    }
    const aliases = GUIDE_ALIASES[name]
    // Why: the embedded table always carries the full guide (served by `skills get`);
    // only the installable projection thins to a stub once a topic is in STUB_TOPICS.
    guides.push({ name, description: frontmatter.description, markdown, aliases })
    const stubPath = path.join(repoRoot, 'skill-stubs', `${name}.md`)
    const content = stubTopics.has(name)
      ? composeStubProjection(markdown, await readFile(stubPath, 'utf8'), `skill-stubs/${name}.md`)
      : markdown
    projections.push({
      path: path.join(repoRoot, 'skills', name, 'SKILL.md'),
      content
    })
  }
  assertAliasContract(guides)

  return [
    {
      path: RUST_MODULE_PATH,
      content: serializeRustModule(guides)
    },
    ...projections
  ]
}

async function writeArtifacts(artifacts) {
  for (const artifact of artifacts) {
    await mkdir(path.dirname(artifact.path), { recursive: true })
    await writeFile(artifact.path, artifact.content, 'utf8')
  }
}

async function verifyArtifacts(artifacts, repoRoot = REPO_ROOT) {
  const stale = []
  for (const artifact of artifacts) {
    try {
      await access(artifact.path, constants.R_OK)
      if ((await readFile(artifact.path, 'utf8')) !== artifact.content) {
        stale.push(artifact.path)
      }
    } catch {
      stale.push(artifact.path)
    }
  }
  if (stale.length > 0) {
    throw new Error(
      `Generated bundled skill guides are stale:\n${stale
        .map((filePath) => toPosixRelativePath(repoRoot, filePath))
        .join('\n')}\nRun node scripts/generate-bundled-skill-guides.mjs --write.`
    )
  }
}

async function main() {
  const artifacts = await buildArtifacts()
  await (process.argv.includes('--write') ? writeArtifacts : verifyArtifacts)(artifacts)
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

export {
  CANONICAL_GUIDE_NAMES,
  GUIDE_ALIASES,
  STUB_TOPICS,
  assertAliasContract,
  buildArtifacts,
  composeStubProjection,
  frontmatterBlock,
  normalizeMarkdown,
  parseFrontmatter,
  serializeRustModule
}
