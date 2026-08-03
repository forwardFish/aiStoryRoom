import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MODEL_CALL_BUDGET_SCHEMA_VERSION, OPENOVEL_ROLE_RUNTIME_MODE, ROLE_NARRATIVE_INPUT_SCHEMA_VERSION } from "../src/role-contracts.js";

const token="role-http-token";
const opening=(roleId:string,key:string,consumed=0,working="Filtered role context")=>({schemaVersion:ROLE_NARRATIVE_INPUT_SCHEMA_VERSION,runtimeMode:OPENOVEL_ROLE_RUNTIME_MODE,turnKind:"OPENING",roomId:"http_room",roleId,actorTurnId:`actor_${roleId}`,turnIndex:0,baseWorldSequence:0,appliedWorldSequence:null,contextSnapshotHash:"ctx",renderedWorkingSet:working,visibleWorldEvents:[],pendingInteractions:[],modelCallBudget:{schemaVersion:MODEL_CALL_BUDGET_SCHEMA_VERSION,kind:"NORMAL",hardLimit:3,consumed},idempotencyKey:key});

test("real Role HTTP process maps 401/400/404/409/429/503 without leakage and preserves Solo shapes",{timeout:30_000},async()=>{
  const provider=createServer(async(req,res)=>{let raw="";for await(const c of req)raw+=c;const body=JSON.parse(raw),text=body.messages?.map((x:any)=>x.content).join("\n")||"";if(text.includes("force503")){res.writeHead(500,{"content-type":"application/json"});res.end(JSON.stringify({error:{message:"backend raw secret rationale statePatch"}}));return;}const content=text.includes("Role options")?'{"options":[]}':text.includes("Role storykeeper")?'{"guidance":"g","memory":"m","contextCards":[]}':"A bounded role-visible response.";res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({choices:[{message:{content}}],usage:{prompt_tokens:1,completion_tokens:1},model:"fake"}));});
  await new Promise<void>(resolve=>provider.listen(0,"127.0.0.1",resolve));const providerPort=(provider.address() as net.AddressInfo).port,runtimePort=await freePort(),root=await mkdtemp(path.join(os.tmpdir(),"role-http-"));
  const child=spawn(process.execPath,["--import","tsx","apps/openovel-runtime/src/server.ts"],{cwd:path.resolve(import.meta.dirname,"../../.."),env:{...process.env,NODE_ENV:"production",PORT:String(runtimePort),OPENOVEL_RUNTIME_HOST:"127.0.0.1",OPENOVEL_WORKSPACE_ROOT:root,OPENOVEL_PROJECT_ROOT:path.resolve(import.meta.dirname,"../../.."),OPENOVEL_INTERNAL_TOKEN:token,OPENOVEL_API_KEY:"fake",OPENOVEL_PROVIDER_BASE_URL:`http://127.0.0.1:${providerPort}`},stdio:["ignore","pipe","pipe"]});
  let stderr="",startupError:Error|undefined;child.stderr.on("data",c=>stderr+=c);child.on("error",error=>startupError=error);
  try{
    await waitForListen(child,runtimePort,()=>stderr,()=>startupError);const base=`http://127.0.0.1:${runtimePort}`,auth={authorization:`Bearer ${token}`,"content-type":"application/json"};
    let r=await fetch(`${base}/internal/openovel/rooms/http_room/roles/role_a`);assert.equal(r.status,401);assert.deepEqual(await r.json(),{code:"UNAUTHORIZED",error:"UNAUTHORIZED",message:"Unauthorized"});
    r=await fetch(`${base}/internal/openovel/runs/run_123456`);assert.equal(r.status,401);assert.deepEqual(await r.json(),{error:"UNAUTHORIZED"});
    r=await fetch(`${base}/internal/openovel/rooms/http_room/roles/role_a`,{method:"POST",headers:auth,body:"{"});assert.equal(r.status,400);assert.equal((await r.json() as any).code,"INVALID_JSON");
    r=await fetch(`${base}/internal/openovel/rooms/http_room/roles/bad%2Frole`,{headers:auth});assert.equal(r.status,400);assert.equal((await r.json() as any).code,"ROLE_PATH_INVALID");
    r=await fetch(`${base}/internal/openovel/rooms/http_room/roles/missing`,{headers:auth});assert.equal(r.status,404);assert.equal((await r.json() as any).code,"ROLE_WORKSPACE_NOT_FOUND");
    await ensureRole(base,auth,"role_a");r=await post(base,auth,"role_a",opening("role_a","same"));assert.equal(r.status,200);r=await post(base,auth,"role_a",{...opening("role_a","same"),renderedWorkingSet:"changed"});assert.equal(r.status,409);assert.equal((await r.json() as any).code,"IDEMPOTENCY_KEY_CONFLICT");
    await ensureRole(base,auth,"budget");r=await post(base,auth,"budget",opening("budget","budget",3));assert.equal(r.status,429);assert.equal((await r.json() as any).code,"MODEL_CALL_BUDGET_EXCEEDED");
    await ensureRole(base,auth,"provider");r=await post(base,auth,"provider",opening("provider","provider",0,"force503"));assert.equal(r.status,503);const transient=JSON.stringify(await r.json());assert.match(transient,/ROLE_PROVIDER_TRANSIENT/);assert.doesNotMatch(transient,/backend raw|secret rationale|statePatch/i);
    r=await fetch(`${base}/internal/openovel/not-a-route`,{headers:auth});assert.equal(r.status,404);assert.deepEqual(await r.json(),{error:"NOT_FOUND"});
  }finally{if(child.exitCode===null)child.kill("SIGTERM");await new Promise<void>(resolve=>provider.close(()=>resolve()));}
});

async function ensureRole(base:string,headers:Record<string,string>,roleId:string){const r=await fetch(`${base}/internal/openovel/rooms/http_room/roles/${roleId}`,{method:"POST",headers,body:JSON.stringify({runtimeMode:OPENOVEL_ROLE_RUNTIME_MODE,roomId:"http_room",roleId,worldId:"world",storyPackageVersion:"v1"})});assert.equal(r.status,201,await r.text());}
function post(base:string,headers:Record<string,string>,roleId:string,body:unknown){return fetch(`${base}/internal/openovel/rooms/http_room/roles/${roleId}/turns`,{method:"POST",headers,body:JSON.stringify(body)});}
async function freePort(){const s=net.createServer();await new Promise<void>(r=>s.listen(0,"127.0.0.1",r));const p=(s.address() as net.AddressInfo).port;await new Promise<void>(r=>s.close(()=>r()));return p;}
async function waitForListen(child:ReturnType<typeof spawn>,port:number,stderr:()=>string,startupError:()=>Error|undefined){for(let i=0;i<100;i++){if(startupError())throw startupError();if(child.exitCode!==null)throw new Error(`runtime exited ${child.exitCode}: ${stderr()}`);try{const r=await fetch(`http://127.0.0.1:${port}/health`);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw new Error(`runtime did not listen: ${stderr()}`);}
