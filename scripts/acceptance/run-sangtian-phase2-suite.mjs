import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../.."),boundaryPath=resolve(root,"packages/templates/config/sangtian/pressure-spine-input-boundary.json"),artifact=resolve(root,"packages/templates/config/sangtian/pressure-spine-v1.0"),content=resolve(artifact,"source"),archive=resolve(artifact,"source-package/sangtian_complete_story_content_package_v1_1.zip"),importer=resolve(root,"packages/templates/scripts/import-sangtian-pressure-spine.mjs"),registry=resolve(root,"packages/templates/config/sangtian/strategy-registry.json"),suite=process.argv[2];
const sha=b=>createHash("sha256").update(b).digest("hex").toUpperCase();
function verify(path,e,label){if(!existsSync(path))throw new Error(`INPUT_FILE_REQUIRED:${label}:${path}`);const b=readFileSync(path),a={byteSize:b.byteLength,sha256:sha(b)};if(a.byteSize!==Number(e.byteSize)||a.sha256!==String(e.sha256).toUpperCase())throw new Error(`INPUT_FILE_MISMATCH:${label}:expected=${e.byteSize}:${e.sha256}:actual=${a.byteSize}:${a.sha256}`);return{label,path,...a};}
function roots(){return[process.env.SANGTIAN_PHASE2_INPUT_DIR,process.cwd(),root,dirname(root),process.platform==="win32"?null:"/mnt/data"].filter(Boolean).map(String).map(value=>resolve(value));}
function locate(name,env){if(process.env[env]&&existsSync(process.env[env]))return resolve(process.env[env]);for(const r of [...new Set(roots())]){const p=resolve(r,name);if(existsSync(p))return p;}throw new Error(`INPUT_FILE_REQUIRED:${env}:${name}`);}
const python=()=>process.env.PYTHON||(process.platform==="win32"?"python":"python3");
function run(cmd,args,cwd=root,env={}){const r=spawnSync(cmd,args,{cwd,encoding:"utf8",env:{...process.env,...env},maxBuffer:64*1024*1024});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.error)throw r.error;if(r.status!==0)throw new Error(`COMMAND_FAILED:${cmd} ${args.join(" ")}:exit=${r.status}`);}
function inspect(path){const script=String.raw`import json,sys,zipfile,collections
with zipfile.ZipFile(sys.argv[1]) as z:
 f=[];u=[]
 for i in z.infolist():
  n=i.filename.replace('\\','/')
  if n.endswith('/'): continue
  p=[x for x in n.split('/') if x]
  if not p or n.startswith('/') or '..' in p or ':' in p[0]: u.append(n)
  f.append(n)
 print(json.dumps({'fileCount':len(f),'groups':dict(collections.Counter(x.split('/')[0] for x in f)),'unsafe':u},sort_keys=True))`;
 const r=spawnSync(python(),["-c",script,path],{encoding:"utf8"});if(r.status!==0)throw new Error(`ZIP_INSPECTION_FAILED:${r.stderr}`);return JSON.parse(r.stdout);}
function inputBoundary(){const b=JSON.parse(readFileSync(boundaryPath,"utf8"));if(b.originMainSha!=="8584867d20cc089126f458afa82636e5ad570cd4")throw new Error("INPUT_BASE_SHA_MISMATCH");const c=verify(locate(b.contextArchive.fileName,"SANGTIAN_PHASE2_CONTEXT_ZIP"),b.contextArchive,"contextArchive"),ci=inspect(c.path),total=Object.values(b.contextArchive.expectedGroups).reduce((a,v)=>a+Number(v),0);if(ci.fileCount!==total||ci.unsafe.length)throw new Error(`CONTEXT_ZIP_INVENTORY_INVALID:${JSON.stringify(ci)}`);for(const[g,n]of Object.entries(b.contextArchive.expectedGroups))if(Number(ci.groups[g]||0)!==Number(n))throw new Error(`CONTEXT_ZIP_GROUP_MISMATCH:${g}`);const a=verify(archive,b.acceptedContentArchive,"acceptedContentArchive"),ai=inspect(a.path);if(ai.fileCount!==95||ai.unsafe.length)throw new Error("ACCEPTED_ZIP_INVENTORY_INVALID");const artifacts=b.phase2Artifacts.map(x=>verify(locate(x.fileName,`SANGTIAN_PHASE2_${x.fileName.replace(/[^A-Za-z0-9]+/g,"_").toUpperCase()}`),x,x.fileName));console.log(JSON.stringify({verdict:"PASS",suite:"input-boundary",originMainSha:b.originMainSha,context:{...c,inventory:ci},acceptedContent:{...a,inventory:ai},phase2ArtifactCount:artifacts.length,phase2Artifacts:artifacts},null,2));}
function contentSuite(){const t0=process.env.SANGTIAN_T0_PATH||resolve(root,"docs/剧本/嘉靖财政危局/大明王朝1566 (刘和平).txt"),args=["--import","tsx",importer,"--check","--output-root",artifact,"--registry-path",registry];if(existsSync(t0))args.push("--t0",t0);run(process.execPath,args);run(python(),[resolve(content,"tools/validate_package.py")],content);run(process.execPath,["--import","tsx","--test",resolve(root,"packages/templates/tests/pressure-spine.test.ts")],root,existsSync(t0)?{SANGTIAN_T0_PATH:t0}:{});const lock=JSON.parse(readFileSync(resolve(artifact,"manifest.lock.json"),"utf8")),index=JSON.parse(readFileSync(resolve(artifact,"runtime-index.json"),"utf8"));console.log(JSON.stringify({verdict:"PASS",suite:"content",registeredPackageVersion:lock.registeredPackageVersion,contentTreeSha256:lock.contentTreeSha256,runtimeIndexSha256:lock.runtimeIndexSha256,sourcePackageSha256:lock.sourcePackageSha256,sourceSha256:lock.sourceSha256,counts:index.counts},null,2));}
const d2Suites={
  kernel:["packages/templates/tests/pressure-spine.test.ts","packages/templates/tests/pressure-spine-kernel.test.ts"],
  determinism:["packages/templates/tests/pressure-spine-determinism.test.ts"],
  integration:["packages/templates/tests/pressure-spine-integration.test.ts"],
  security:["packages/templates/tests/pressure-spine-security.test.ts"],
  recovery:["packages/templates/tests/pressure-spine-recovery.test.ts"],
  api:["apps/api/src/continuous-strategy/pressure-spine-runtime.service.spec.ts"]
};
function d2Suite(name){
 const relativeFiles=d2Suites[name];
 if(!relativeFiles)throw new Error(`SUITE_NOT_IMPLEMENTED:${name||"<missing>"}`);
 const files=relativeFiles.map(relative=>resolve(root,relative));
 for(const [index,target] of files.entries())if(!existsSync(target))throw new Error(`D2_TEST_FILE_REQUIRED:${relativeFiles[index]}`);
 const result=spawnSync(process.execPath,["--import","tsx","--test",...files],{cwd:root,encoding:"utf8",env:process.env,maxBuffer:64*1024*1024});
 if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);if(result.error)throw result.error;
 const output=`${result.stdout||""}\n${result.stderr||""}`;
 const count=(label)=>{const match=new RegExp(`# ${label}\\s+(\\d+)`).exec(output);return match?Number(match[1]):0;};
 const counts={total:count("tests"),pass:count("pass"),fail:count("fail"),skip:count("skipped"),todo:count("todo")};
 if(result.status!==0||counts.fail!==0||counts.total<1||counts.pass!==counts.total||counts.skip!==0||counts.todo!==0)throw new Error(`D2_TEST_FAILED:${name}:exit=${result.status}:counts=${JSON.stringify(counts)}`);
 console.log(JSON.stringify({verdict:"PASS",suite:name,testFiles:relativeFiles,runner:"node --import tsx --test",counts},null,2));
}
try{if(suite==="input-boundary")inputBoundary();else if(suite==="content")contentSuite();else d2Suite(suite);}catch(e){console.error(JSON.stringify({verdict:"FAIL",suite:suite||null,error:e instanceof Error?e.message:String(e)},null,2));process.exitCode=1;}
