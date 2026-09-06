#!/usr/bin/env node
// Bounded CLI-only contract census for the Drogon rewrite parity gate.
//
// Scope (deliberately narrow — see docs/migration/parity-contract-enumeration.md):
//   - src/cli/specs/index.ts (COMMAND_SPECS registry) + every spec module it spreads in
//   - src/cli/handler-group-manifest.ts (+ browser-handler-groups.ts spread) for
//     group *membership* only
// Out of scope for this pass (recorded as such, never silently dropped):
//   - resolving handler function bodies or RPC method calls reachable from a handler
//   - settings UI / keybinding census (separate future task)
//
// Parses the read-only legacy checkout with @babel/parser (never imports, requires,
// or executes source modules). Fails loudly (throws) if extraction is empty, if the
// registry doesn't resolve to a literal array, or if an output path is not confined
// to this repo. Every run appends a nonce evidence record under
// .preflight/parity-contracts/ and never deletes prior evidence.

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = realpathSync(path.resolve(SCRIPT_DIR, ".."));
const DEFAULT_SOURCE = "/Users/carlos/Documents/Drogon-mentu-session";
const PINNED_SOURCE_SHA = "c97906287bb7a390b25e2025b600d9fb3c25d9c3";
const DEFAULT_JSON_OUTPUT = path.join(
  REPO_ROOT,
  "docs/migration/parity-source-contracts.json",
);
const DEFAULT_MD_OUTPUT = path.join(
  REPO_ROOT,
  "docs/migration/parity-contract-enumeration.md",
);
const PREFLIGHT_DIR = path.join(REPO_ROOT, ".preflight/parity-contracts");
const SCHEMA = "drogon.inventory.cli-contracts.v1";
const EVIDENCE_SCHEMA = "drogon.inventory.cli-contracts.evidence.v1";
const ENGINE_KIND = "babel-ast";

const MAX_SPREAD_DEPTH = 12;

const AST_IGNORED_KEYS = new Set([
  "loc",
  "start",
  "end",
  "range",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "extra",
  "tokens",
  "comments",
  "typeParameters",
  "typeAnnotation",
  "returnType",
  "predicate",
  "accessibility",
  "abstract",
  "declare",
  "optional",
  "override",
  "variance",
]);

const LEGACY_REL = {
  specsDir: "src/cli/specs",
  specRegistry: "src/cli/specs/index.ts",
  handlerManifest: "src/cli/handler-group-manifest.ts",
};

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------
function parseArgv(argv) {
  const out = {
    source: DEFAULT_SOURCE,
    jsonOutput: DEFAULT_JSON_OUTPUT,
    mdOutput: DEFAULT_MD_OUTPUT,
    evidenceDir: PREFLIGHT_DIR,
    verify: false,
    evidence: true,
    allowShaMismatch: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source") {
      out.source = argv[++i];
      assert.ok(out.source, "--source requires a path");
    } else if (arg === "--output") {
      out.jsonOutput = argv[++i];
      assert.ok(out.jsonOutput, "--output requires an exact path");
    } else if (arg === "--md-output") {
      out.mdOutput = argv[++i];
      assert.ok(out.mdOutput, "--md-output requires an exact path");
    } else if (arg === "--evidence-dir") {
      out.evidenceDir = argv[++i];
      assert.ok(out.evidenceDir, "--evidence-dir requires a path");
    } else if (arg === "--verify") {
      out.verify = true;
    } else if (arg === "--no-evidence") {
      out.evidence = false;
    } else if (arg === "--allow-sha-mismatch") {
      out.allowShaMismatch = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "usage: node scripts/inventory-source-contracts.mjs",
          "  [--source <legacy-checkout>] [--output <exact-json-path>]",
          "  [--md-output <exact-md-path>] [--evidence-dir <dir>]",
          "  [--verify] [--no-evidence] [--allow-sha-mismatch]",
          "",
          "  CLI-only census: src/cli/specs/index.ts registry + handler-group",
          "  membership from src/cli/handler-group-manifest.ts. Does not resolve",
          "  handler bodies/RPC calls or settings/keybinding surfaces.",
          "",
          "  --verify              regenerate both artifacts in memory and compare",
          "                        them byte-for-byte against disk (determinism gate).",
          "  --allow-sha-mismatch  continue past a legacy HEAD sha that differs from",
          "                        the pinned baseline, recording the mismatch instead",
          "                        of failing the run.",
          "  Every run (unless --no-evidence) appends a nonce evidence record under",
          "  .preflight/parity-contracts/ and never deletes prior evidence.",
        ].join("\n") + "\n",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Confinement guards, adapted from the reviewed scripts/inventory-source-bridges.mjs
// pattern: lstat-first (never existsSync-gated — existsSync FOLLOWS a symlink
// and reports false for a dangling one, so a guard gated on it never even
// inspects the link) and lexical-containment-first (no FS calls) before any
// physical check. No reads/writes may cross a symlinked ancestor or leaf,
// dangling or not, and no write may land inside the actual (resolved)
// --source root.
// ---------------------------------------------------------------------------
function fail(message) {
  throw new Error(message);
}

// Source reads: walk every path component from `root` down to the leaf and
// lstat it directly. A missing component (ENOENT) stops the walk — nothing
// deeper exists to inspect, and the caller's own existsSync/readFileSync
// reports the ordinary "missing" case. A component that DOES exist and is a
// symlink is rejected immediately, including a dangling one (lstat succeeds
// on a dangling symlink; it is the follow, not the stat, that fails).
function assertNoSymlinkAncestors(root, relPath, label) {
  const parts = relPath.split(path.sep).filter(Boolean);
  let cursor = root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    let st;
    try {
      st = lstatSync(cursor);
    } catch (error) {
      if (error.code === "ENOENT") return;
      fail(`read failure guarding ${label}: ${error.message}`);
    }
    if (st.isSymbolicLink()) {
      fail(`refusing symlinked path component (${label}): ${cursor}`);
    }
  }
}

function assertWithinRoot(root, relPath, label) {
  const resolvedRoot = path.resolve(root);
  const resolvedFull = path.resolve(root, relPath);
  if (resolvedFull !== resolvedRoot && !resolvedFull.startsWith(resolvedRoot + path.sep)) {
    fail(`${label} escapes root (path traversal): ${relPath}`);
  }
  return resolvedFull;
}

// Output guards: lexical containment first (must be inside REPO_ROOT, must
// NOT be inside the actual resolved --source root — keyed off the real
// argument, never the DEFAULT_SOURCE constant, so pointing --source at some
// other path, including one nested under this repo's own .preflight/, is
// still caught), then lstat the leaf itself (never follow/overwrite a
// symlink, dangling or not), then walk up to the first existing ancestor,
// realpath it, and reconstruct the intended destination with the
// not-yet-created components appended, to catch a symlinked intermediate
// directory before mkdir would create the rest of the chain.
function resolveSourceRootReal(sourceRoot) {
  try {
    return realpathSync(sourceRoot);
  } catch {
    return path.resolve(sourceRoot);
  }
}

function assertLexicalContainment(resolvedPath, allowedRoot, sourceRootReal, label) {
  if (resolvedPath !== allowedRoot && !resolvedPath.startsWith(allowedRoot + path.sep)) {
    fail(`refusing to write ${label}: escapes allowed root: ${resolvedPath}`);
  }
  if (resolvedPath === sourceRootReal || resolvedPath.startsWith(sourceRootReal + path.sep)) {
    fail(`refusing to write ${label}: lands inside the source tree: ${resolvedPath}`);
  }
}

function assertAncestorChainSafe(dirPath, allowedRoot, sourceRootReal, label) {
  let ancestor = dirPath;
  const missing = [];
  while (ancestor !== allowedRoot && ancestor.startsWith(allowedRoot + path.sep)) {
    let st = null;
    try {
      st = lstatSync(ancestor);
    } catch {
      st = null;
    }
    if (st !== null) break;
    missing.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  let ancestorReal;
  try {
    ancestorReal = realpathSync(ancestor);
  } catch (error) {
    fail(`cannot resolve existing ancestor for ${label}: ${error.message}`);
  }
  const destination = path.resolve(ancestorReal, ...missing);
  if (destination === sourceRootReal || destination.startsWith(sourceRootReal + path.sep)) {
    fail(`refusing to write ${label}: ancestor chain resolves inside the source tree: ${destination}`);
  }
  if (destination !== allowedRoot && !destination.startsWith(allowedRoot + path.sep)) {
    fail(`refusing to write ${label}: ancestor chain escapes allowed root via symlink: ${destination}`);
  }
  return destination;
}

function assertSafeOutputDir(dirPath, allowedRoot, sourceRoot) {
  const resolved = path.resolve(dirPath);
  const sourceRootReal = resolveSourceRootReal(sourceRoot);
  assertLexicalContainment(resolved, allowedRoot, sourceRootReal, `directory ${dirPath}`);
  try {
    const st = lstatSync(resolved);
    if (st.isSymbolicLink()) fail(`refusing to write through a symlinked directory: ${dirPath}`);
    if (!st.isDirectory()) fail(`refusing to use a non-directory as an output directory: ${dirPath}`);
  } catch (error) {
    if (error.code !== "ENOENT") fail(`cannot stat output directory: ${error.message}`);
  }
  assertAncestorChainSafe(resolved, allowedRoot, sourceRootReal, `directory ${dirPath}`);
  return resolved;
}

function assertSafeOutputFile(filePath, allowedRoot, sourceRoot) {
  const resolved = path.resolve(filePath);
  const sourceRootReal = resolveSourceRootReal(sourceRoot);
  assertLexicalContainment(resolved, allowedRoot, sourceRootReal, `file ${filePath}`);
  try {
    const st = lstatSync(resolved);
    if (st.isSymbolicLink()) {
      fail(`refusing to write through an existing symlink (leaf lstat): ${filePath}`);
    }
    if (st.isDirectory()) fail(`refusing to overwrite a directory with a file write: ${filePath}`);
    if (!st.isFile()) fail(`refusing to overwrite non-regular output: ${filePath}`);
  } catch (error) {
    if (error.code !== "ENOENT") fail(`cannot stat output file: ${error.message}`);
  }
  assertAncestorChainSafe(path.dirname(resolved), allowedRoot, sourceRootReal, `file ${filePath}`);
  return resolved;
}

// Atomic staged write: an exclusive (`wx`) random-sibling temp file — a
// preexisting file or symlink at the temp path fails closed instead of being
// followed or overwritten — then an atomic rename onto the final path
// (rename replaces whatever inode is at the destination rather than
// following a symlink there).
function stageAndWriteFile(resolvedPath, contents) {
  const dir = path.dirname(resolvedPath);
  let staging = "";
  let stagedFd = null;
  for (let attempt = 0; attempt < 10 && stagedFd === null; attempt += 1) {
    staging = path.join(dir, `.inventory-source-contracts-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
    try {
      stagedFd = openSync(staging, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") fail(`cannot stage output: ${error.message}`);
    }
  }
  if (stagedFd === null) fail("cannot stage output: no unique temp name after 10 attempts");
  try {
    writeSync(stagedFd, contents, null, "utf8");
  } catch (error) {
    try {
      closeSync(stagedFd);
    } catch {
      // best effort
    }
    try {
      unlinkSync(staging);
    } catch {
      // best effort
    }
    fail(`cannot write output: ${error.message}`);
  }
  try {
    closeSync(stagedFd);
  } catch (error) {
    fail(`cannot write output: ${error.message}`);
  }
  try {
    renameSync(staging, resolvedPath);
  } catch (error) {
    fail(`cannot finalize output: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Git provenance (fail loudly, never swallow errors)
// ---------------------------------------------------------------------------
function gitOutput(sourceRoot, args) {
  return execFileSync("git", args, {
    cwd: sourceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function sourceGitMeta(sourceRoot) {
  const headSha = gitOutput(sourceRoot, ["rev-parse", "HEAD"]).trim();
  assert.ok(/^[0-9a-f]{40}$/.test(headSha), `unexpected HEAD sha: ${headSha}`);
  const porcelain = gitOutput(sourceRoot, ["status", "--porcelain"]);
  const trackedDirty = [];
  const untracked = [];
  for (const line of porcelain.split("\n")) {
    if (line.length === 0) continue;
    const status = line.slice(0, 2);
    const entry = line.slice(3).trim();
    if (status === "??") untracked.push(entry);
    else trackedDirty.push(`${status} ${entry}`);
  }
  trackedDirty.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  untracked.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (trackedDirty.length > 0) {
    fail(
      `legacy source has tracked dirty changes, refusing a canonical census: ${trackedDirty.join("; ")}`,
    );
  }
  return { headSha, trackedDirty, untracked };
}

// ---------------------------------------------------------------------------
// Babel parser loading (reuse the installed @vitejs/plugin-react dependency;
// no new deps, no TypeScript compiler API — tsgo/typescript@7 has none).
// ---------------------------------------------------------------------------
function loadBabelParser() {
  const desktopPkg = path.join(REPO_ROOT, "apps/desktop/package.json");
  const requireFromDesktop = createRequire(desktopPkg);
  const pluginReactPath = requireFromDesktop.resolve("@vitejs/plugin-react");
  const requireFromPlugin = createRequire(pluginReactPath);
  const parserPath = requireFromPlugin.resolve("@babel/parser");
  const parser = requireFromPlugin(parserPath);
  assert.equal(typeof parser.parse, "function", "@babel/parser has no parse()");
  const parserVersion = requireFromPlugin("@babel/parser/package.json").version ?? "unknown";
  return {
    parse: parser.parse,
    parserVersion,
    loadChain:
      "createRequire(<repo>/apps/desktop/package.json).resolve('@vitejs/plugin-react') -> @babel/parser",
  };
}

// ---------------------------------------------------------------------------
// Generic AST walking (structure only; no language semantics evaluated here)
// ---------------------------------------------------------------------------
function walkNode(node, visit, seen) {
  if (node === null || node === undefined || typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);
  if (typeof node.type === "string") visit(node);
  for (const key of Object.keys(node)) {
    if (AST_IGNORED_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walkNode(child, visit, seen);
    } else if (value !== null && typeof value === "object") {
      walkNode(value, visit, seen);
    }
  }
}

function walk(ast, visit) {
  walkNode(ast, visit, new Set());
}

function findNodes(rootNode, predicate) {
  const nodes = [];
  walk(rootNode, (node) => {
    if (predicate(node)) nodes.push(node);
  });
  return nodes;
}

function lineOf(node) {
  return node?.loc?.start?.line ?? 0;
}

function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function stableSortStrings(list) {
  return [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Source tree: parse-once module index (read-only access, traversal-guarded)
// ---------------------------------------------------------------------------
class SourceTree {
  constructor(sourceRoot, babel) {
    this.sourceRoot = sourceRoot;
    this.parseModule = babel.parse;
    this.cache = new Map();
    this.fileHashes = new Map(); // relPosix -> { sha256, bytes }
  }

  abs(rel) {
    return assertWithinRoot(this.sourceRoot, rel, "source path");
  }

  readModule(rel) {
    const relPosix = rel.split(path.sep).join("/");
    const cached = this.cache.get(relPosix);
    if (cached) return cached;
    const absPath = this.abs(relPosix);
    assertNoSymlinkAncestors(this.sourceRoot, relPosix, "source module");
    assert.ok(existsSync(absPath), `source module missing: ${relPosix}`);
    const code = readFileSync(absPath, "utf8");
    const sha256 = sha256Hex(code);
    const moduleCtx = buildModuleContext(this, relPosix, code, sha256);
    this.fileHashes.set(relPosix, { sha256, bytes: Buffer.byteLength(code, "utf8") });
    this.cache.set(relPosix, moduleCtx);
    return moduleCtx;
  }
}

function parseSource(babelParse, code, relPosix) {
  const plugins = ["typescript"];
  if (relPosix.endsWith(".tsx") || relPosix.endsWith(".jsx")) plugins.push("jsx");
  return babelParse(code, {
    sourceType: "module",
    plugins,
    errorRecovery: false,
    attachComment: false,
  });
}

function buildModuleContext(tree, relPosix, code, sha256) {
  const ast = parseSource(tree.parseModule, code, relPosix);
  const mod = {
    tree,
    rel: relPosix,
    code,
    sha256,
    ast,
    imports: new Map(), // localName -> { source, importedName, resolved }
    consts: new Map(), // name -> { init, exported, line }
  };
  const dirPosix = path.posix.dirname(relPosix);
  for (const node of ast.program.body) {
    if (node.type === "ImportDeclaration") {
      const resolved = resolveRelImport(tree, dirPosix, node.source.value);
      for (const spec of node.specifiers) {
        if (spec.type === "ImportDefaultSpecifier") continue;
        mod.imports.set(spec.local.name, {
          source: node.source.value,
          importedName: spec.type === "ImportNamespaceSpecifier" ? "*" : spec.imported.name,
          resolved,
        });
      }
    } else if (node.type === "ExportNamedDeclaration" && node.declaration) {
      collectDeclaration(mod, node.declaration, true);
    } else if (node.type === "VariableDeclaration" || node.type === "FunctionDeclaration") {
      collectDeclaration(mod, node, false);
    }
  }
  return mod;
}

function collectDeclaration(mod, decl, exported) {
  if (decl.type === "VariableDeclaration") {
    for (const declarator of decl.declarations) {
      if (declarator.id.type === "Identifier" && declarator.init) {
        mod.consts.set(declarator.id.name, {
          init: declarator.init,
          exported,
          line: lineOf(declarator),
        });
      }
    }
  }
}

function resolveRelImport(tree, fromDirPosix, source) {
  if (!source.startsWith(".")) return null; // external package: out of scope
  const relPosix = path.posix.normalize(path.posix.join(fromDirPosix, source));
  const candidates = [];
  if (relPosix.endsWith(".js")) {
    candidates.push(relPosix.replace(/\.js$/, ".ts"));
    candidates.push(relPosix.replace(/\.js$/, ".tsx"));
  } else if (/\.(ts|tsx)$/.test(relPosix)) {
    candidates.push(relPosix);
  } else {
    candidates.push(`${relPosix}.ts`);
    candidates.push(`${relPosix}.tsx`);
    candidates.push(path.posix.join(relPosix, "index.ts"));
  }
  for (const candidate of candidates) {
    if (existsSync(tree.abs(candidate))) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// AST value helpers (literal / static-symbol resolution only)
// ---------------------------------------------------------------------------
function objectProps(objNode) {
  const props = [];
  for (const prop of objNode.properties) {
    if (prop.type === "SpreadElement") {
      props.push({ kind: "spread", argument: prop.argument, node: prop });
    } else {
      let key = null;
      if (!prop.computed && prop.key.type === "Identifier") key = prop.key.name;
      else if (prop.key.type === "StringLiteral") key = prop.key.value;
      props.push({ kind: "prop", key, value: prop.value, node: prop });
    }
  }
  return props;
}

function propValue(objNode, key) {
  const found = objectProps(objNode).find((p) => p.kind === "prop" && p.key === key);
  return found ? found.value : null;
}

function stringLiteralArray(node) {
  if (!node || node.type !== "ArrayExpression") return null;
  const values = [];
  for (const element of node.elements) {
    if (!element || element.type !== "StringLiteral") return null;
    values.push(element.value);
  }
  return values;
}

function booleanLiteral(node) {
  if (!node) return null;
  if (node.type === "BooleanLiteral") return node.value;
  return null;
}

function resolveConstNode(mod, name, stack = [], depth = 0) {
  if (depth > MAX_SPREAD_DEPTH) return null;
  const key = `${mod.rel}#${name}`;
  if (stack.includes(key)) return null;
  stack.push(key);
  const local = mod.consts.get(name);
  if (local) return { module: mod, node: local.init, line: local.line, exported: local.exported };
  const imported = mod.imports.get(name);
  if (imported && imported.resolved && imported.importedName !== "*") {
    const target = mod.tree.readModule(imported.resolved);
    return resolveConstNode(target, imported.importedName, stack, depth + 1);
  }
  return null;
}

// Resolve an array registry expression (elements + ...spread identifiers)
// into flat member nodes, recording cross-file spread composition.
function resolveCollectionMembers(mod, node, members, composition, stack, depth) {
  if (depth > MAX_SPREAD_DEPTH) {
    composition.push({ status: "unresolved", reason: "spread-depth-exceeded" });
    return;
  }
  if (!node || node.type !== "ArrayExpression") {
    composition.push({
      status: "unresolved",
      reason: `non-literal-collection: ${node?.type ?? "missing"}`,
      line: lineOf(node),
    });
    return;
  }
  for (const element of node.elements) {
    if (!element) continue;
    if (element.type === "SpreadElement") {
      const arg = element.argument;
      if (arg.type !== "Identifier") {
        composition.push({
          status: "unresolved",
          reason: "spread-target-not-identifier",
          line: lineOf(element),
        });
        continue;
      }
      const resolvedConst = resolveConstNode(mod, arg.name, [...stack]);
      if (!resolvedConst) {
        composition.push({
          status: "unresolved",
          reason: `spread-unresolved: ${arg.name}`,
          line: lineOf(element),
        });
        continue;
      }
      composition.push({
        status: "resolved",
        spread: arg.name,
        module: resolvedConst.module.rel,
        line: lineOf(element),
      });
      resolveCollectionMembers(
        resolvedConst.module,
        resolvedConst.node,
        members,
        composition,
        [...stack, `${resolvedConst.module.rel}#${arg.name}`],
        depth + 1,
      );
    } else if (element.type === "Identifier") {
      // A bare identifier array element (not spread) referencing a single
      // exported spec-object constant, e.g. `TERMINAL_CLOSE_COMMAND_SPEC,`.
      const resolvedConst = resolveConstNode(mod, element.name, [...stack]);
      if (resolvedConst && resolvedConst.node.type === "ObjectExpression") {
        composition.push({
          status: "resolved",
          spread: element.name,
          module: resolvedConst.module.rel,
          line: lineOf(element),
        });
        members.push({
          module: resolvedConst.module,
          node: resolvedConst.node,
          line: resolvedConst.line,
        });
      } else {
        composition.push({
          status: "unresolved",
          reason: `identifier-element-unresolved: ${element.name}`,
          line: lineOf(element),
        });
      }
    } else {
      members.push({ module: mod, node: element, line: lineOf(element) });
    }
  }
}

// Resolve a flat string-literal array that may itself contain ...spread
// identifiers (e.g. `allowedFlags: [...GLOBAL_FLAGS, 'agent']`). One
// constant-spread hop only — not a general call-graph walk.
function resolveStringArrayWithSpreads(mod, node) {
  const literals = [];
  const unresolvedSpreads = [];
  if (!node) return { literals, unresolvedSpreads, present: false };
  if (node.type !== "ArrayExpression") {
    return { literals, unresolvedSpreads, present: true, wholeUnresolved: true };
  }
  for (const element of node.elements) {
    if (!element) continue;
    if (element.type === "StringLiteral") {
      literals.push(element.value);
    } else if (element.type === "SpreadElement" && element.argument.type === "Identifier") {
      const name = element.argument.name;
      const resolved = resolveConstNode(mod, name);
      const asArray = resolved ? stringLiteralArray(resolved.node) : null;
      if (asArray) literals.push(...asArray);
      else unresolvedSpreads.push(name);
    } else {
      unresolvedSpreads.push("<non-literal-element>");
    }
  }
  return { literals, unresolvedSpreads, present: true };
}

// ---------------------------------------------------------------------------
// CLI spec extraction (src/cli/command-spec.ts CommandSpec shape)
// ---------------------------------------------------------------------------
function isTestFile(relPosix) {
  const base = path.posix.basename(relPosix);
  return base.includes(".test.") || base.includes(".spec.") || base.endsWith(".d.ts");
}

function specListDir(tree, relDir) {
  const absDir = tree.abs(relDir);
  assertNoSymlinkAncestors(tree.sourceRoot, relDir, "spec directory");
  return readdirSync(absDir)
    .filter((name) => /\.(ts|tsx)$/.test(name) && !isTestFile(name))
    .map((name) => path.posix.join(relDir, name))
    .sort();
}

function extractSpecObject(mod, objNode) {
  const pathNode = propValue(objNode, "path");
  const summaryNode = propValue(objNode, "summary");
  if (!pathNode || pathNode.type !== "ArrayExpression") return null;
  if (!summaryNode || summaryNode.type !== "StringLiteral") return null;
  const pathValues = stringLiteralArray(pathNode);
  if (!pathValues) return null; // non-literal path is reported by the caller

  const aliasesNode = propValue(objNode, "aliases");
  const aliases = [];
  let aliasesUnresolved = null;
  if (aliasesNode) {
    if (aliasesNode.type === "ArrayExpression") {
      for (const aliasElement of aliasesNode.elements) {
        const aliasPath = stringLiteralArray(aliasElement);
        if (aliasPath) aliases.push(aliasPath);
        else aliasesUnresolved = "non-literal-alias-path";
      }
    } else {
      aliasesUnresolved = "non-literal-aliases";
    }
  }

  const flagsNode = propValue(objNode, "allowedFlags");
  const flags = resolveStringArrayWithSpreads(mod, flagsNode);

  const positionalNode = propValue(objNode, "positionalArgs");
  const positionals = positionalNode ? stringLiteralArray(positionalNode) : null;
  const examplesNode = propValue(objNode, "examples");
  const examples = examplesNode ? stringLiteralArray(examplesNode) : null;
  const notesNode = propValue(objNode, "notes");
  const notes = notesNode ? stringLiteralArray(notesNode) : null;

  return {
    module: mod,
    path: pathValues,
    summary: summaryNode.value,
    usage: propValue(objNode, "usage")?.value ?? null,
    aliases,
    aliasesUnresolved,
    argumentMode: propValue(objNode, "argumentMode")?.value ?? null,
    destructive: booleanLiteral(propValue(objNode, "destructive")) ?? false,
    hidden: booleanLiteral(propValue(objNode, "hidden")) ?? false,
    positionals: positionals ?? [],
    positionalsUnresolved: positionalNode && positionals === null ? "non-literal-positional-args" : null,
    // NB: the legacy CommandSpec type (src/cli/command-spec.ts) has no
    // structured per-option {name, aliases, type, default, required} shape —
    // options surface only as flat `allowedFlags` string literals. Recorded
    // as-is rather than inventing structure the source doesn't have.
    allowedFlags: flags.present ? stableSortStrings(flags.literals) : [],
    allowedFlagsUnresolvedSpreads: flags.unresolvedSpreads,
    allowedFlagsWholeUnresolved: flags.wholeUnresolved ?? false,
    examples: examples ?? [],
    notes: notes ?? [],
    line: lineOf(objNode),
    sourceAnchor: `${mod.rel}:${lineOf(objNode)}`,
  };
}

function extractSpecsFromModule(mod) {
  const specs = [];
  const nonLiteral = [];
  const objects = findNodes(mod.ast, (node) => node.type === "ObjectExpression");
  for (const objNode of objects) {
    const pathNode = propValue(objNode, "path");
    const summaryNode = propValue(objNode, "summary");
    if (!pathNode || !summaryNode) continue;
    const spec = extractSpecObject(mod, objNode);
    if (spec) specs.push(spec);
    else nonLiteral.push({ line: lineOf(objNode), reason: "path-or-summary-not-literal" });
  }
  specs.sort((a, b) => (a.line < b.line ? -1 : a.line > b.line ? 1 : 0));
  return { specs, nonLiteral };
}

function buildCliSpecInventory(tree) {
  const registryModule = tree.readModule(LEGACY_REL.specRegistry);

  // Independent literal scan: every path+summary object literal in every
  // non-test file under specs/, regardless of whether that file is actually
  // imported into the COMMAND_SPECS registry. This is the "simple census"
  // number (upstream reported 234) — NOT authoritative for the reachable
  // dispatch table, only a cross-check.
  const specFiles = [];
  const allLiteralSpecs = [];
  for (const rel of specListDir(tree, LEGACY_REL.specsDir)) {
    const mod = tree.readModule(rel);
    const { specs, nonLiteral } = extractSpecsFromModule(mod);
    if (specs.length > 0 || nonLiteral.length > 0) {
      specFiles.push({ file: rel, specCount: specs.length, nonLiteral });
      allLiteralSpecs.push(...specs);
    }
  }

  // Authoritative scan: resolve COMMAND_SPECS (spread of imported per-file
  // arrays) to the exact set of specs reachable from the dispatch registry.
  const registryConst = resolveConstNode(registryModule, "COMMAND_SPECS");
  assert.ok(
    registryConst && registryConst.node.type === "ArrayExpression",
    "COMMAND_SPECS registry not resolvable to a literal array",
  );
  const members = [];
  const composition = [];
  resolveCollectionMembers(
    registryConst.module,
    registryConst.node,
    members,
    composition,
    [`${registryConst.module.rel}#COMMAND_SPECS`],
    0,
  );

  const registrySpecs = [];
  const registryUnresolved = [];
  const seenPaths = new Map();
  const duplicatePaths = [];
  for (const member of members) {
    if (member.node.type !== "ObjectExpression") {
      registryUnresolved.push({
        line: member.line,
        module: member.module.rel,
        reason: `registry-member-not-object-literal: ${member.node.type}`,
      });
      continue;
    }
    const spec = extractSpecObject(member.module, member.node);
    if (!spec) {
      registryUnresolved.push({
        line: member.line,
        module: member.module.rel,
        reason: "registry-member-not-literal-spec",
      });
      continue;
    }
    const key = spec.path.join(" ");
    if (seenPaths.has(key)) duplicatePaths.push(key);
    seenPaths.set(key, spec);
    registrySpecs.push(spec);
  }

  const literalKeys = new Set(
    allLiteralSpecs.map((s) => `${s.module.rel}:${s.line}:${s.path.join(" ")}`),
  );
  const registryKeys = new Set(
    registrySpecs.map((s) => `${s.module.rel}:${s.line}:${s.path.join(" ")}`),
  );
  const filesInRegistry = new Set(registrySpecs.map((s) => s.module.rel));
  const literalOnlyFiles = stableSortStrings(
    [...new Set(allLiteralSpecs.map((s) => s.module.rel))].filter(
      (f) => !filesInRegistry.has(f),
    ),
  );

  assert.ok(registrySpecs.length > 0, "empty CLI registry extraction (fail-loud gate)");

  return {
    specFiles,
    literalCount: allLiteralSpecs.length,
    registryCount: registrySpecs.length,
    duplicatePaths: stableSortStrings(duplicatePaths),
    registryUnresolved,
    composition,
    reconciliation: {
      inRegistryNotLiteral: stableSortStrings(
        [...registryKeys].filter((k) => !literalKeys.has(k)),
      ),
      inLiteralNotRegistry: stableSortStrings(
        [...literalKeys].filter((k) => !registryKeys.has(k)),
      ),
      literalOnlyFiles,
      literalOnlyFilesExplanation:
        literalOnlyFiles.length > 0
          ? "these specs/*.ts files contain literal {path, summary} object literals " +
            "but are never imported by src/cli/specs/index.ts, so they are not part " +
            "of the reachable COMMAND_SPECS dispatch table"
          : null,
    },
    registrySpecs,
  };
}

// ---------------------------------------------------------------------------
// Handler-group membership (src/cli/handler-group-manifest.ts) — membership
// only. Handler function bodies / RPC methods are explicitly out of scope.
// ---------------------------------------------------------------------------
function extractHandlerGroups(tree) {
  const manifest = tree.readModule(LEGACY_REL.handlerManifest);
  const groupsConst = resolveConstNode(manifest, "HANDLER_GROUPS");
  assert.ok(
    groupsConst && groupsConst.node.type === "ArrayExpression",
    "HANDLER_GROUPS not resolvable to a literal array",
  );
  const members = [];
  const composition = [];
  resolveCollectionMembers(
    groupsConst.module,
    groupsConst.node,
    members,
    composition,
    [`${groupsConst.module.rel}#HANDLER_GROUPS`],
    0,
  );
  const groups = [];
  const unresolved = [];
  for (const member of members) {
    if (member.node.type !== "ObjectExpression") {
      unresolved.push({ line: member.line, reason: "group-not-object-literal" });
      continue;
    }
    const nameNode = propValue(member.node, "name");
    const keysNode = propValue(member.node, "keys");
    if (!nameNode || nameNode.type !== "StringLiteral" || !keysNode) {
      unresolved.push({ line: member.line, reason: "group-shape-unrecognized" });
      continue;
    }
    const keys = stringLiteralArray(keysNode);
    if (!keys) {
      unresolved.push({ line: member.line, reason: `group-keys-not-literal: ${nameNode.value}` });
      continue;
    }
    groups.push({ module: member.module.rel, name: nameNode.value, keys, line: member.line });
  }
  return { groups, composition, unresolved };
}

function buildGroupMembership(cliInventory, handlerGroups) {
  const keyToGroups = new Map();
  for (const group of handlerGroups.groups) {
    for (const key of group.keys) {
      if (!keyToGroups.has(key)) keyToGroups.set(key, []);
      keyToGroups.get(key).push(group.name);
    }
  }
  const matchedKeys = new Set();
  const rows = cliInventory.registrySpecs.map((spec) => {
    const candidateKeys = [spec.path.join(" "), ...spec.aliases.map((a) => a.join(" "))];
    let matchedGroups = [];
    for (const key of candidateKeys) {
      const found = keyToGroups.get(key);
      if (found) {
        matchedGroups = found;
        matchedKeys.add(key);
        break;
      }
    }
    return {
      command: spec.path.join(" "),
      sourceAnchor: spec.sourceAnchor,
      groups: matchedGroups,
      unresolvedLink: matchedGroups.length === 0,
    };
  });
  const unmatchedManifestKeys = stableSortStrings(
    [...keyToGroups.keys()].filter((k) => !matchedKeys.has(k)),
  );
  return {
    rows,
    unmatchedManifestKeys,
    unmatchedManifestKeysExplanation:
      unmatchedManifestKeys.length > 0
        ? "handler-group-manifest.ts keys with no matching CLI registry command path or " +
          "alias — likely top-level dispatcher intercepts outside src/cli/specs, out of " +
          "scope for this pass and recorded as an explicit unresolved link"
        : null,
    groupComposition: handlerGroups.composition,
    groupUnresolved: handlerGroups.unresolved,
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------
function serializeSpec(spec) {
  return {
    path: spec.path,
    aliases: spec.aliases,
    aliasesUnresolved: spec.aliasesUnresolved,
    summary: spec.summary,
    usage: spec.usage,
    argumentMode: spec.argumentMode,
    destructive: spec.destructive,
    hidden: spec.hidden,
    positionals: spec.positionals,
    positionalsUnresolved: spec.positionalsUnresolved,
    allowedFlags: spec.allowedFlags,
    allowedFlagsUnresolvedSpreads: spec.allowedFlagsUnresolvedSpreads,
    allowedFlagsWholeUnresolved: spec.allowedFlagsWholeUnresolved,
    examples: spec.examples,
    notes: spec.notes,
    source: { file: spec.module.rel, line: spec.line, sha256: spec.module.sha256 },
  };
}

function buildDocument({ sourceRoot, gitMeta, cliInventory, membership, shaMismatch }) {
  return {
    schema: SCHEMA,
    generatedBy: "scripts/inventory-source-contracts.mjs",
    scope: {
      included: [LEGACY_REL.specRegistry, `${LEGACY_REL.specsDir}/*.ts (non-test)`, LEGACY_REL.handlerManifest],
      excludedPendingCensus: [
        "handler function bodies / RPC method attribution",
        "flag parser types, repeatability, defaults and validation semantics",
        "settings UI surface (separate parity-settings-* checkpoints)",
        "keybindings (separate parity-settings-keybindings checkpoint)",
      ],
      flagScopeNote:
        "the legacy CommandSpec type (src/cli/command-spec.ts) has no structured " +
        "per-option {name, aliases, type, default, required} shape at all — it exposes " +
        "only a flat `allowedFlags: string[]` of accepted flag NAMES, with no parser-level " +
        "type/default/required metadata on CommandSpec. Parser behavior DOES exist separately " +
        "in src/cli/args.ts and src/shared/cli-argument-boundary.ts, including boolean/value " +
        "classification and repeated flags. This census records only the flat allowed list " +
        "with cross-file constant spreads resolved, not those separate parsing rules. This is " +
        "not a full CLI contract (handler bodies, RPC attribution, and flag *parsing* " +
        "semantics beyond the name list remain out of scope, per `excludedPendingCensus`).",
    },
    source: {
      root: sourceRoot,
      pinnedSha: PINNED_SOURCE_SHA,
      headSha: gitMeta.headSha,
      shaMismatch,
      trackedDirty: gitMeta.trackedDirty,
      untracked: gitMeta.untracked,
    },
    cli: {
      literalCount: cliInventory.literalCount,
      registryCount: cliInventory.registryCount,
      duplicatePaths: cliInventory.duplicatePaths,
      registryUnresolved: cliInventory.registryUnresolved,
      composition: cliInventory.composition,
      reconciliation: cliInventory.reconciliation,
      specFiles: cliInventory.specFiles,
      specs: cliInventory.registrySpecs.map(serializeSpec),
    },
    handlerGroupMembership: membership,
  };
}

function renderMarkdown(doc) {
  const lines = [];
  lines.push("# CLI registry census (bounded, CLI-only)");
  lines.push("");
  lines.push(
    "Machine-readable record: `docs/migration/parity-source-contracts.json` " +
      `(schema \`${doc.schema}\`).`,
  );
  lines.push("");
  lines.push(
    "Generated by `scripts/inventory-source-contracts.mjs` (babel-ast, syntactic — no " +
      "TypeScript type checking, no source module execution). Regenerate with " +
      "`node scripts/inventory-source-contracts.mjs`; verify determinism with `--verify`.",
  );
  lines.push("");
  lines.push(`- Legacy source: \`${doc.source.root}\` (read-only)`);
  lines.push(`- Legacy HEAD (full sha): \`${doc.source.headSha}\``);
  lines.push(`- Pinned baseline sha: \`${doc.source.pinnedSha}\``);
  lines.push(`- SHA mismatch: \`${doc.source.shaMismatch}\``);
  lines.push(
    `- Tracked-dirty: \`${doc.source.trackedDirty.length > 0}\`` +
      (doc.source.trackedDirty.length > 0 ? ` (${doc.source.trackedDirty.join(", ")})` : ""),
  );
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push("Included this pass:");
  for (const s of doc.scope.included) lines.push(`- \`${s}\``);
  lines.push("");
  lines.push("Explicitly out of scope, pending a separate future census:");
  for (const s of doc.scope.excludedPendingCensus) lines.push(`- ${s}`);
  lines.push("");
  lines.push("### Flag scope: flat `allowedFlags` names, not parser flag metadata");
  lines.push("");
  lines.push(doc.scope.flagScopeNote);
  lines.push("");
  lines.push(
    "**This document is not a claim of full CLI contract closure.** It covers the " +
      "canonical command registry and handler-group membership only.",
  );
  lines.push("");
  lines.push("## CLI command registry (`src/cli/specs/index.ts`)");
  lines.push("");
  lines.push(
    `Canonical \`CommandSpec\` objects reachable from \`COMMAND_SPECS\`: **${doc.cli.registryCount}**`,
  );
  lines.push(
    `Independent literal scan across all non-test \`specs/*.ts\` files: **${doc.cli.literalCount}** ` +
      "(not authoritative — see reconciliation below).",
  );
  lines.push("");
  lines.push(
    `- Duplicate command paths in the registry: ${doc.cli.duplicatePaths.length === 0 ? "none" : doc.cli.duplicatePaths.join(", ")}`,
  );
  lines.push(
    `- Registry members that did not resolve to a literal spec object: ${doc.cli.registryUnresolved.length}`,
  );
  lines.push("");
  lines.push("### Reconciliation: literal scan vs. reachable registry");
  lines.push("");
  if (doc.cli.reconciliation.literalOnlyFiles.length > 0) {
    lines.push(
      `Files with literal spec objects but **not** imported into \`COMMAND_SPECS\`: ` +
        doc.cli.reconciliation.literalOnlyFiles.map((f) => `\`${f}\``).join(", "),
    );
    lines.push("");
    lines.push(doc.cli.reconciliation.literalOnlyFilesExplanation);
  } else {
    lines.push("Every file with a literal spec object is reachable from the registry.");
  }
  lines.push("");
  lines.push(
    `- In registry, not found by literal scan: ${doc.cli.reconciliation.inRegistryNotLiteral.length}`,
  );
  lines.push(
    `- Found by literal scan, not in resolved registry: ${doc.cli.reconciliation.inLiteralNotRegistry.length}`,
  );
  lines.push("");
  lines.push("### Cross-file registry spread composition");
  lines.push("");
  lines.push("| Status | Spread | Module | Line |");
  lines.push("| --- | --- | --- | --- |");
  for (const c of doc.cli.composition) {
    lines.push(
      `| ${c.status} | ${c.spread ?? "—"} | ${c.module ?? "—"} | ${c.reason ? c.reason : c.line ?? "—"} |`,
    );
  }
  lines.push("");
  lines.push("### Commands");
  lines.push("");
  const byFile = new Map();
  for (const spec of doc.cli.specs) {
    if (!byFile.has(spec.source.file)) byFile.set(spec.source.file, []);
    byFile.get(spec.source.file).push(spec);
  }
  for (const file of stableSortStrings([...byFile.keys()])) {
    lines.push(`#### ${file}`);
    lines.push("");
    lines.push("| Command | aliases | argMode | destr. | hidden | positionals | allowedFlags | groups | source |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const spec of byFile.get(file)) {
      const command = spec.path.join(" ");
      const aliases = spec.aliases.length ? spec.aliases.map((a) => a.join(" ")).join("; ") : "—";
      const flags = spec.allowedFlags.length ? spec.allowedFlags.join(" ") : "—";
      const membershipRow = doc.handlerGroupMembership.rows.find((r) => r.command === command);
      const groups = membershipRow && membershipRow.groups.length ? membershipRow.groups.join(", ") : "unresolved: no matching handler-group key";
      lines.push(
        `\`${command}\` | ${aliases} | ${spec.argumentMode ?? "—"} | ${spec.destructive} | ${spec.hidden} | ${spec.positionals.join(" ") || "—"} | ${flags} | ${groups} | \`${spec.source.file}:${spec.source.line}\``,
      );
    }
    lines.push("");
  }
  lines.push("## Handler-group membership (`src/cli/handler-group-manifest.ts`)");
  lines.push("");
  lines.push(
    `Manifest keys with no matching registry command/alias (unresolved links): ` +
      `${doc.handlerGroupMembership.unmatchedManifestKeys.length}`,
  );
  if (doc.handlerGroupMembership.unmatchedManifestKeysExplanation) {
    lines.push("");
    lines.push(doc.handlerGroupMembership.unmatchedManifestKeysExplanation + ":");
    lines.push("");
    for (const k of doc.handlerGroupMembership.unmatchedManifestKeys) lines.push(`- \`${k}\``);
  }
  lines.push("");
  lines.push(
    `Group-manifest members that did not resolve to a literal group object: ` +
      `${doc.handlerGroupMembership.groupUnresolved.length}`,
  );
  lines.push("");
  lines.push(
    "Handler function bodies and RPC method attribution are **not** resolved by this pass " +
      "(explicit out-of-scope item above); a command with a matched group is recorded as " +
      "group-membership-only, never as handler-verified.",
  );
  lines.push("");
  return lines.join("\n").trimEnd() + "\n";
}

// ---------------------------------------------------------------------------
// Evidence (append-only, nonce per run)
// ---------------------------------------------------------------------------
function writeEvidence(evidenceDir, sourceRoot, record) {
  const safeDir = assertSafeOutputDir(evidenceDir, REPO_ROOT, sourceRoot);
  mkdirSync(safeDir, { recursive: true });
  const nonce = randomBytes(8).toString("hex");
  const file = path.join(safeDir, `run-${Date.now()}-${nonce}.json`);
  const safeFile = assertSafeOutputFile(file, REPO_ROOT, sourceRoot);
  const fd = openSync(safeFile, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify({ schema: EVIDENCE_SCHEMA, ...record }, null, 2) + "\n");
  } finally {
    closeSync(fd);
  }
  return safeFile;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run(argv) {
  const opts = parseArgv(argv);
  // realpathSync itself throws (ENOENT/ELOOP) on a dangling or cyclic
  // --source root; symlinks WITHIN the tree (a spec file, a specs
  // subdirectory) are caught per-read by assertNoSymlinkAncestors below.
  const sourceRoot = realpathSync(opts.source);

  const gitMeta = sourceGitMeta(sourceRoot);
  const shaMismatch = gitMeta.headSha !== PINNED_SOURCE_SHA;
  // This SHA guard applies unconditionally, including under --verify: a
  // determinism check against an unfrozen/mismatched reference checkout is
  // not a valid canonical-census verification, and must fail exactly like a
  // fresh generation would, not silently skip the gate.
  if (shaMismatch && !opts.allowShaMismatch) {
    throw new Error(
      `legacy source HEAD ${gitMeta.headSha} does not match pinned baseline ${PINNED_SOURCE_SHA} ` +
        "(pass --allow-sha-mismatch to continue and record the mismatch)",
    );
  }

  const babel = loadBabelParser();
  const tree = new SourceTree(sourceRoot, babel);

  const cliInventory = buildCliSpecInventory(tree);
  const handlerGroups = extractHandlerGroups(tree);
  const membership = buildGroupMembership(cliInventory, handlerGroups);

  const doc = buildDocument({ sourceRoot, gitMeta, cliInventory, membership, shaMismatch });
  const md = renderMarkdown(doc);
  const jsonText = JSON.stringify(doc, null, 2) + "\n";

  const jsonOutAbs = assertSafeOutputFile(opts.jsonOutput, REPO_ROOT, sourceRoot);
  const mdOutAbs = assertSafeOutputFile(opts.mdOutput, REPO_ROOT, sourceRoot);

  if (opts.verify) {
    const existingJson = existsSync(jsonOutAbs) ? readFileSync(jsonOutAbs, "utf8") : null;
    const existingMd = existsSync(mdOutAbs) ? readFileSync(mdOutAbs, "utf8") : null;
    const jsonMatches = existingJson === jsonText;
    const mdMatches = existingMd === md;
    if (opts.evidence) {
      writeEvidence(opts.evidenceDir, sourceRoot, {
        mode: "verify",
        headSha: gitMeta.headSha,
        shaMismatch,
        jsonMatches,
        mdMatches,
        registryCount: cliInventory.registryCount,
      });
    }
    if (!jsonMatches || !mdMatches) {
      throw new Error(
        `determinism gate failed: jsonMatches=${jsonMatches} mdMatches=${mdMatches}`,
      );
    }
    process.stdout.write("verify: OK (byte-identical regeneration)\n");
    return;
  }

  mkdirSync(path.dirname(jsonOutAbs), { recursive: true });
  mkdirSync(path.dirname(mdOutAbs), { recursive: true });
  stageAndWriteFile(jsonOutAbs, jsonText);
  stageAndWriteFile(mdOutAbs, md);

  if (opts.evidence) {
    const evidenceFile = writeEvidence(opts.evidenceDir, sourceRoot, {
      mode: "generate",
      headSha: gitMeta.headSha,
      shaMismatch,
      registryCount: cliInventory.registryCount,
      literalCount: cliInventory.literalCount,
      jsonOutput: path.relative(REPO_ROOT, jsonOutAbs),
      mdOutput: path.relative(REPO_ROOT, mdOutAbs),
    });
    process.stdout.write(`evidence: ${path.relative(REPO_ROOT, evidenceFile)}\n`);
  }
  process.stdout.write(
    `CLI registry census: ${cliInventory.registryCount} commands (literal scan: ${cliInventory.literalCount})\n`,
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
if (isMain) {
  run(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`${err.stack ?? err.message}\n`);
    process.exitCode = 1;
  });
}

export {
  buildCliSpecInventory,
  buildGroupMembership,
  buildDocument,
  extractHandlerGroups,
  loadBabelParser,
  renderMarkdown,
  run,
  SourceTree,
  sourceGitMeta,
};
