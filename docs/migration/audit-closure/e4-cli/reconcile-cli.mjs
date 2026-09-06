// Audit-only static reconciliation. Never imports or executes reference modules.
// Source expressions are evidence excerpts from the pinned Orca source; its
// upstream copyright and license remain applicable (see source LICENSE).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = '/Users/carlos/Documents/Drogon-rewrite';
const source = '/Users/carlos/Documents/Drogon-mentu-session';
const out = path.join(root, 'docs/migration/audit-closure/e4-cli');
const req = createRequire(path.join(root, 'apps/desktop/package.json'));
const parser = createRequire(req.resolve('@vitejs/plugin-react'))('@babel/parser');
const hash = s => createHash('sha256').update(s).digest('hex');
const catalog = JSON.parse(fs.readFileSync(path.join(root,'docs/migration/parity-source-contracts.json')));
const modules = new Map();
const omittedKeys = new Set(['loc','start','end','extra','leadingComments','trailingComments','innerComments','typeAnnotation','typeParameters','returnType','superTypeParameters','implements']);
function walk(n, fn) {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) { n.forEach(x=>walk(x,fn)); return; }
  if (n.type?.startsWith('TS') && !['TSAsExpression','TSSatisfiesExpression','TSNonNullExpression'].includes(n.type)) return;
  fn(n);
  for (const [k,v] of Object.entries(n)) if (!omittedKeys.has(k)) walk(v,fn);
}
function resolvePath(file, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(file),spec.replace(/\.js$/, '')));
  return [base+'.ts',base+'.tsx',base+'/index.ts'].find(x=>fs.existsSync(path.join(source,x))) ?? null;
}
function mod(file) {
  if (modules.has(file)) return modules.get(file);
  const code=fs.readFileSync(path.join(source,file),'utf8');
  const ast=parser.parse(code,{sourceType:'module',plugins:['typescript',...(file.endsWith('tsx')?['jsx']:[])]});
  const m={file,code,ast,defs:new Map(),imports:new Map(),exports:new Map()}; modules.set(file,m);
  for (const top of ast.program.body) {
    const n=top.declaration??top;
    if (n.type==='FunctionDeclaration' || n.type==='ClassDeclaration') m.defs.set(n.id.name,n);
    if (n.type==='VariableDeclaration') for(const d of n.declarations) if(d.id.type==='Identifier') m.defs.set(d.id.name,d.init);
    if(top.type==='ImportDeclaration' && top.importKind!=='type') for(const s of top.specifiers) if(s.importKind!=='type') m.imports.set(s.local.name,{file:resolvePath(file,top.source.value),symbol:s.imported?.name??s.imported?.value??'default',external:top.source.value});
    if(top.type==='ExportNamedDeclaration') for(const s of top.specifiers??[]) m.exports.set(s.exported.name,{file:top.source?resolvePath(file,top.source.value):file,symbol:s.local.name});
    if(top.type==='ExportAllDeclaration') m.exports.set('*'+m.exports.size,{file:resolvePath(file,top.source.value),symbol:'*'});
  }
  return m;
}
function resolve(file,symbol,seen=new Set()) {
  const key=file+':'+symbol;if(seen.has(key))return null;seen.add(key);
  const m=mod(file); const n=m.defs.get(symbol);if(n)return {file,node:n,symbol};
  const link=m.imports.get(symbol)??m.exports.get(symbol);
  if(link?.file && link.file.startsWith('src/cli/')) return resolve(link.file,link.symbol,seen);
  for(const x of m.exports.values()) if(x.symbol==='*' && x.file?.startsWith('src/cli/')) {const r=resolve(x.file,symbol,seen);if(r)return r;}
  return null;
}
const text=(file,n)=>mod(file).code.slice(n.start,n.end);
const anchor=(file,n)=>({file,line:n.loc.start.line,endLine:n.loc.end.line,sha256:hash(mod(file).code)});
function entries(file,n,seen=new Set()) {
  if(n.type==='Identifier'){const r=resolve(file,n.name);assert(r,`unresolved registry ${file}:${n.name}`);return entries(r.file,r.node,seen);}
  if(n.type==='TSAsExpression'||n.type==='TSSatisfiesExpression') return entries(file,n.expression,seen);
  assert(n.type==='ObjectExpression',`non-object registry ${file}:${n.type}`);
  return n.properties.flatMap(p=>p.type==='SpreadElement'?entries(file,p.argument,seen):[{command:p.key.name??p.key.value,file,node:p.value,property:p}]);
}
const routes=new Map();
for(const file of ['src/cli/handler-group-manifest.ts','src/cli/browser-handler-groups.ts']) {
  walk(mod(file).ast,n=>{
    if(n.type!=='ObjectExpression')return;
    const ps=Object.fromEntries(n.properties.filter(x=>x.type==='ObjectProperty').map(x=>[x.key.name??x.key.value,x.value]));
    if(!ps.name||!ps.keys||!ps.load)return;
    const body=text(file,ps.load);const match=body.match(/import\('([^']+)'\)\)\.(\w+)/);assert(match);
    const target=resolvePath(file,match[1]);const r=resolve(target,match[2]);assert(r);
    const actual=entries(r.file,r.node);const expected=ps.keys.elements.map(x=>x.value).sort();
    assert.deepEqual(actual.map(x=>x.command).sort(),expected);
    for(const e of actual){assert(!routes.has(e.command));routes.set(e.command,{...e,group:ps.name.value,registry:anchor(file,n)});}
  });
}
const nodes=new Map();
function extract(file,n,name) {
  const id=file+':'+n.loc.start.line+':'+n.start;if(nodes.has(id))return id;
  const info={id,name,source:anchor(file,n),calls:[],conditions:[],throws:[],bindings:[],assignments:[],returns:[],helperIds:[],constants:[],boundaryImports:[]};nodes.set(id,info);
  const refs=new Set();
  walk(n,x=>{
    if(x.type==='CallExpression'||x.type==='NewExpression')info.calls.push({line:x.loc.start.line,callee:text(file,x.callee),arguments:x.arguments.map(a=>text(file,a))});
    if(x.type==='IfStatement'||x.type==='ConditionalExpression') info.conditions.push({line:x.loc.start.line,expression:text(file,x.test)});
    if(x.type==='ThrowStatement')info.throws.push({line:x.loc.start.line,expression:text(file,x.argument)});
    if(x.type==='AssignmentExpression')info.assignments.push({line:x.loc.start.line,expression:text(file,x)});
    if(x.type==='VariableDeclarator'&&x.init)info.bindings.push({line:x.loc.start.line,name:text(file,x.id),expression:text(file,x.init)});
    if(x.type==='ReturnStatement'&&x.argument)info.returns.push({line:x.loc.start.line,expression:text(file,x.argument)});
    if(x.type==='Identifier')refs.add(x.name);
  });
  for(const symbol of refs){
    const r=resolve(file,symbol);
    if(r && r.node!==n && ['FunctionDeclaration','ArrowFunctionExpression','FunctionExpression'].includes(r.node.type)) info.helperIds.push(extract(r.file,r.node,symbol));
    else if(r && r.node!==n && !['ObjectExpression','ClassDeclaration'].includes(r.node.type)) info.constants.push({symbol,source:anchor(r.file,r.node),expression:text(r.file,r.node)});
    else {const imp=mod(file).imports.get(symbol);if(imp)info.boundaryImports.push({symbol,...imp});}
  }
  info.helperIds=[...new Set(info.helperIds)].sort();
  return id;
}
const accepted=new Map();
for(const [name,key] of [['skills','rows'],['terminal','rows'],['workspace','commandContracts']]) {
  const file=`docs/migration/parity-cli-${name}-contracts.json`;const d=JSON.parse(fs.readFileSync(path.join(root,file)));
  const rows=d[key];for(const row of rows){let cmd=row.command??row.canonicalCommand??row.canonicalName??row.name;cmd=Array.isArray(cmd)?cmd.join(' '):cmd;if(name==='skills')cmd='skills '+cmd;accepted.set(cmd,{file,command:cmd});}
}
const rows=catalog.cli.specs.map(s=>{
  const command=s.path.join(' '),r=routes.get(command);assert(r,command);
  let n=r.node,file=r.file;
  if(n.type==='Identifier'){const resolved=resolve(file,n.name);assert(resolved,command);file=resolved.file;n=resolved.node;}
  return {command,group:r.group,aliases:s.aliases,hidden:s.hidden,destructive:s.destructive,specSource:s.source,summary:s.summary,allowedFlags:s.allowedFlags,positionals:s.positionals,argumentMode:s.argumentMode,registry:r.registry,handler:anchor(file,n),binding:text(r.file,r.node.type==='ArrowFunctionExpression'?r.property.key:r.node),semanticNode:extract(file,n,command),acceptedContract:accepted.get(command)??null};
});
assert.equal(rows.length,234);assert.equal(routes.size,234);
assert.equal(rows.filter(r=>r.acceptedContract).length,30);
for(const r of rows)assert.equal(hash(fs.readFileSync(path.join(source,r.specSource.file))),r.specSource.sha256);
const entryContracts=[];
for(const [file,symbols] of [
  ['src/cli/index.ts',['main','runClaudeTeams','runAgentTeamsTmuxShim','resolveInvocationCwd','shouldIgnoreRemoteSelection']],
  ['src/cli/runtime/client.ts',['RuntimeClient']],
  ['src/cli/runtime/remote-runtime-compat-gate.ts',['RemoteRuntimeCompatGate']],
  ['src/cli/format.ts',['reportCliError','formatCliError']],
  ['src/main/startup/cli-launch-redirect.ts',['maybeRedirectCliLaunch','getCliLaunchArgs']]
])for(const symbol of symbols){const r=resolve(file,symbol);assert(r,symbol);entryContracts.push({symbol,node:extract(r.file,r.node,symbol)});}
// Tests are indexed from the already accepted M1 census, not a new suite census.
const testManifest=JSON.parse(fs.readFileSync(path.join(root,'docs/migration/parity-source-tests.json')));
const boundaryFiles=[...new Set([...nodes.values()].flatMap(n=>n.boundaryImports.map(i=>i.file)).filter(Boolean))].sort();
const sourceStems=new Set([...modules.keys(),...boundaryFiles].map(f=>f.replace(/\.[jt]sx?$/,'')));
const testRows=testManifest.files.filter(f=>/\.(test|spec)\.[cm]?[jt]sx?$/.test(f.path)&&(f.path.startsWith('src/cli/')||sourceStems.has(f.path.replace(/\.(test|spec)\.[cm]?[jt]sx?$/,''))));
const fullyReadTests=new Set(['src/cli/handlers/core.test.ts','src/cli/handler-group-manifest.test.ts','src/cli/registry-parity.test.ts']);
const testIndex=testRows.map(f=>{const code=fs.readFileSync(path.join(source,f.path),'utf8');assert.equal(hash(code),f.sha256,f.path);return {path:f.path,sha256:f.sha256,runner:f.runner,membership:f.membership,caseMarkers:f.caseMarkers,bodyRead:fullyReadTests.has(f.path)?'full':f.path==='src/cli/index-worktree-selector-resolution.test.ts'?'partial:100-250':false,executed:false,code};});
function reachable(id,seen=new Set()){if(seen.has(id))return seen;seen.add(id);for(const h of nodes.get(id).helperIds)reachable(h,seen);return seen;}
for(const r of rows){
  const ns=[...reachable(r.semanticNode)].map(id=>nodes.get(id));
  const calls=ns.flatMap(n=>n.calls.map(c=>({...c,file:n.source.file,node:n.id})));
  const rpc=calls.filter(c=>/\.call$/.test(c.callee)&&/client/.test(c.callee)||['callOrchestrationMutation','callProjectHostSetup'].includes(c.callee));
  r.observableContract={
    layer:'CLI-side static expressions; result semantics beyond called RPC are a runtime contract boundary',
    rpcCalls:rpc,
    flagReads:calls.filter(c=>/Flag|flags\.(get|has)|getStringFlag/.test(c.callee)),
    outputCalls:calls.filter(c=>/printResult|console\.(log|error)|process\.(stdout|stderr)\.write/.test(c.callee)),
    exitAssignments:ns.flatMap(n=>n.assignments.filter(a=>a.expression.startsWith('process.exitCode')).map(a=>({...a,file:n.source.file}))),
    errorNodes:ns.filter(n=>n.throws.length).map(n=>n.id),
    helperNodes:ns.map(n=>n.id),
    hostBoundary:['account','artifacts','environment','host','serve','agent','vm','agent-context'].includes(r.command.split(' ')[0])?'entry-local-remote-selection-suppressed':r.command==='claude-teams'?'passthrough-forced-local-client':'entry-runtime-selection; command target helpers listed in semantic graph',
    eligibility:r.hidden?'hidden-but-observable-compatibility-command':'public-observable-command'
  };
  const words=r.command.split(' '), tokens=words.map(w=>`['"]${w}['"]`).join('\\s*,\\s*');
  const arrayPattern=new RegExp('\\[\\s*'+tokens+'(?:\\s*[,\\]])');
  r.sourceTests=testIndex.flatMap(t=>{
    const literal=t.code.includes(`'${r.command}'`)||t.code.includes(`"${r.command}"`)||arrayPattern.test(t.code);
    const sameModule=t.path.replace('.test.ts','.ts')===r.handler.file;
    return literal||sameModule?[{path:t.path,relation:literal?'literal-command-or-argv-match; candidate association, not assertion coverage':'same handler module; cohort association only'}]:[];
  });
  const serialized=ns.map(n=>JSON.stringify(n)).join('\n');
  r.flagRouting=r.allowedFlags.map(flag=>({flag,
    classification:r.command==='orchestration coordinator-start'?'accepted-name-ignored-by-unconditional-retirement-error':['text-stdin','value-stdin'].includes(flag)?'dynamic-name-specialization-getTextPayload':serialized.includes(`'${flag}'`)?'literal-appears-in-handler-helper-graph':'unresolved',
    evidenceNodes:ns.filter(n=>JSON.stringify(n).includes(`'${flag}'`)).map(n=>n.id)
  }));
  const noRpcReasons={open:'RuntimeClient.openOrca: local desktop activation/status polling; remote status-only.',serve:'serveOrcaApp spawns local runtime process and forwards exit status.',status:'RuntimeClient.getCliStatus: local metadata/status or remote status.get projection.','orchestration coordinator-start':'Unconditional orchestration_migration_required; accepted flags have no mutation effects.','orchestration coordinator-stop':'Unconditional orchestration_migration_required; alias has same error.','agent hooks status':'Local profile state and managed hook inspection, local success envelope.','agent-context':'Pure static registry schema, bare JSON or summary.','environment add':'Local pairing-store insertion and redacted result.','environment list':'Local redacted pairing-store read; explicit routing flags rejected.','environment show':'Local named/id pairing-store read and redaction.','environment rm':'Local pairing-store removal and redacted removed row.','vm recipe doctor':'Local YAML/doctor; optional provision and cleanup runner, bare JSON/result exit.','skills list':'Accepted six-command skills contract: local bundled guide registry.','skills get':'Accepted six-command skills contract: local guide content.','skills install':'Accepted six-command skills contract: local installation child runner and projection.','skills update':'Accepted six-command skills contract: local update child runner and projection.'};
  if(!rpc.length){r.observableContract.noRpcReason=noRpcReasons[r.command];assert(r.observableContract.noRpcReason,r.command);}
}
assert.deepEqual(rows.flatMap(r=>r.flagRouting.filter(f=>f.classification==='unresolved').map(f=>[r.command,f.flag])),[]);
fs.writeFileSync(path.join(out,'source-tests.json'),JSON.stringify({schema:'drogon.e4.source-test-debt/1',sourceManifest:'docs/migration/parity-source-tests.json',sourceManifestSha256:hash(fs.readFileSync(path.join(root,'docs/migration/parity-source-tests.json'))),scope:'All test/spec paths under src/cli plus same-stem tests for reached CLI/shared boundary source modules, selected from accepted manifest; no marker recount. Per-command associations are discovery only. Full shared/runtime and script runner debt remains in accepted full manifest.',counts:{cli:testRows.filter(t=>t.path.startsWith('src/cli/')).length,adjacentBoundary:testRows.filter(t=>!t.path.startsWith('src/cli/')).length},executed:0,tests:testIndex.map(({code,...r})=>r)},null,2)+'\n');
fs.writeFileSync(path.join(out,'command-map.json'),JSON.stringify({schema:'drogon.e4.command-reconciliation/1',sourceRevision:catalog.source.pinnedSha,method:'Babel AST, static CLI function-reference graph; no module evaluation. Expressions are lexical evidence, not path feasibility or runtime execution proof. Factory bindings retain parameters without speculative specialization; dynamic imports and non-CLI implementations are explicit boundaries.',counts:{canonical:rows.length,handlerKeys:routes.size,acceptedLinks:rows.filter(r=>r.acceptedContract).length,semanticNodes:nodes.size},commands:rows,entryContracts,semanticNodes:[...nodes.values()],boundarySources:boundaryFiles.map(file=>({file,sha256:hash(fs.readFileSync(path.join(source,file))),review:'dependency boundary; hash/read by extraction is not full semantic review'})),sourceFiles:[...modules.values()].map(m=>({file:m.file,sha256:hash(m.code)})).sort((a,b)=>a.file.localeCompare(b.file))},null,2)+'\n');
console.log(JSON.stringify({commands:rows.length,acceptedLinks:rows.filter(r=>r.acceptedContract).map(r=>r.command),nodes:nodes.size,files:modules.size,testManifestKeys:Object.keys(testManifest)}));
