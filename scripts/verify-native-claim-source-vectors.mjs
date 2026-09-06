import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);

export function verifySourceSignerVectors() {
const fs = require("node:fs"), crypto = require("node:crypto"), assert = require("node:assert/strict"), path = require("node:path");
const sourceStage = ".preflight/parity-baseline/eng-identity-claim-20260906-a1-vkr7Zn";
const hash = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const manifestPath = "tests/parity/ports/WP-ENG-RUNTIME/identity-leases/source-baselines/agent-session-claim-identity.manifest.json";
assert.equal(hash(manifestPath), "841b12542b4fe2392dee2c7c4aa8c2c014236bff0a3d5d826364525fdb96d963");
const manifest = JSON.parse(fs.readFileSync(manifestPath));
for(const f of [...manifest.files, manifest.license]) assert.equal(hash(path.join(sourceStage,f.path)),f.sha256);
const esbuild = require("/Users/carlos/Documents/Drogon-mentu-session/node_modules/esbuild");
const compiled=esbuild.buildSync({entryPoints:[path.join(sourceStage,"src/main/runtime/agent-session-claim-identity.ts")],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",metafile:true,logLevel:"silent"});
const allowed=new Set(manifest.files.map(f=>path.resolve(sourceStage,f.path)));
for(const input of Object.keys(compiled.metafile.inputs)) assert.ok(allowed.has(path.resolve(input)), "unreviewed input:"+input);
for(const output of Object.values(compiled.metafile.outputs)) {
  for(const dependency of output.imports) assert.ok(dependency.path.startsWith("node:"), "unreviewed external import:"+dependency.path);
}
const moduleObject={exports:{}};
new Function("require","module","exports",compiled.outputFiles[0].text)(require,moduleObject,moduleObject.exports);
const vectorFile="tests/parity/ports/WP-ENG-RUNTIME/native-claim-identity/reference-vectors/vectors.json";
const data=JSON.parse(fs.readFileSync(vectorFile));
assert.equal(data.sourceRevision, manifest.sourceRevision);
assert.equal(data.vectors.length, 20);
for(const v of data.vectors){
 const signer=new moduleObject.exports.AgentSessionClaimSigner(v.authorityDomainId,Buffer.from(v.keyHex,"hex"));
 const claim=signer.createClaim({namespace:v.namespace,identity:{agent:v.agent,providerSession:{key:v.sessionKey,id:v.sessionId,transcriptPath:v.transcriptPath}},canonicalWorktreeId:v.canonicalWorktreeId});
 assert.equal(claim.keyId,v.expectedKeyId,v.name);assert.equal(claim.identityDigest,v.expectedIdentityDigest,v.name);assert.equal(claim.worktreeScopeDigest,v.expectedWorktreeScopeDigest,v.name);
}
return {originalSourceVectorsMatched:data.vectors.length,vectorSha256:hash(vectorFile),sourceFilesVerified:manifest.files.length,bundledInputs:Object.keys(compiled.metafile.inputs).length,sourceRevision:manifest.sourceRevision,bundleWriteEnabled:false,scope:"signer outputs from actual pinned original source, not canonicalization or platform equivalence"};
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.length !== 2) throw new Error("No arguments accepted; this checks the recorded local baseline only.");
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  process.chdir(repoRoot);
  console.log(JSON.stringify(verifySourceSignerVectors()));
}
