import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { caesarRuntimeFixture, sangtianRuntimeFixture } from "../src/runtime-contract/fixtures";
import { applyCausalRule, runtimeContractSha256, validateCausalEvent, validateDurableTurnEnvelope, validateWorldRuntimeContract, WorldRegistry } from "../src/runtime-contract";

const clone=<T>(v:T):T=>structuredClone(v);
const rejects=(mutate:(v:any)=>void, pattern:RegExp)=>{const value=clone(sangtianRuntimeFixture);mutate(value);assert.throws(()=>validateWorldRuntimeContract(value),pattern);};

test("one validator accepts two independent world fixtures",()=>{
  assert.equal(validateWorldRuntimeContract(sangtianRuntimeFixture).worldId,"sangtian");
  assert.equal(validateWorldRuntimeContract(caesarRuntimeFixture).worldId,"caesar");
  assert.notEqual(sangtianRuntimeFixture.entities[2].kind,caesarRuntimeFixture.entities[2].kind);
});

test("structured rules produce deterministic immediate and delayed transitions",()=>{
  for(const fixture of [sangtianRuntimeFixture,caesarRuntimeFixture]){
    const first=applyCausalRule(fixture,fixture.openingState,fixture.causalRules[0].id);
    const replay=applyCausalRule(fixture,fixture.openingState,fixture.causalRules[0].id);
    assert.deepEqual(first,replay); assert.equal(first.revision,1); assert.equal(first.predicates.length,fixture.openingState.predicates.length+2);
    const delayed=applyCausalRule(fixture,first,fixture.delayedRules[0].id); assert.equal(delayed.revision,2); assert.deepEqual(delayed.pendingRuleIds,[fixture.delayedRules[0].id]);
  }
});

test("registry verifies identity, version, hash, aliases and unknown worlds",()=>{
  const root=mkdtempSync(join(tmpdir(),"runtime-registry-"));
  for(const c of [sangtianRuntimeFixture,caesarRuntimeFixture])writeFileSync(join(root,`${c.worldId}.json`),JSON.stringify(c));
  const index={registryVersion:1 as const,worlds:[sangtianRuntimeFixture,caesarRuntimeFixture].map(c=>({worldKey:c.worldId,aliases:[`${c.worldId}-stable`],worldId:c.worldId,contractVersion:c.contractVersion,contractSha256:runtimeContractSha256(c),contractPath:`${c.worldId}.json`}))};
  const registry=new WorldRegistry(index,root);assert.equal(registry.get("sangtian-stable").title,"桑田诏");assert.equal(registry.get("caesar").title,"Caesar");assert.throws(()=>registry.get("unknown"),/WORLD_REGISTRY_UNKNOWN_WORLD/);
  assert.throws(()=>new WorldRegistry({...index,worlds:[...index.worlds,{...index.worlds[1],worldKey:"other",aliases:["sangtian-stable"]}]},root),/WORLD_REGISTRY_ALIAS_COLLISION/);
  assert.throws(()=>new WorldRegistry({...index,worlds:[{...index.worlds[0],worldId:"wrong"}]},root),/WORLD_REGISTRY_WORLD_MISMATCH/);
  assert.throws(()=>new WorldRegistry({...index,worlds:[{...index.worlds[0],contractSha256:"0".repeat(64)}]},root),/WORLD_REGISTRY_HASH_MISMATCH/);
});

test("validator fails closed for malformed contracts and references",()=>{
  rejects(v=>v.entities.push(clone(v.entities[0])),/DUPLICATE_ID/);
  rejects(v=>v.openingState.predicates[0].entityId="missing.entity",/DANGLING_ENTITY/);
  rejects(v=>v.roles[0].actorId="missing.actor",/DANGLING_ACTOR/);
  rejects(v=>v.actorPolicies[0].capabilityIds=["missing.capability"],/DANGLING_CAPABILITY/);
  rejects(v=>v.destinyHooks[0].causalRuleIds=["missing.rule"],/DANGLING_RULE/);
  rejects(v=>v.openingState.worldId="wrong",/WORLD_MISMATCH/);
  rejects(v=>v.knowledgeAcl[0].visibility={scope:"EVERYONE"},/VISIBILITY_INVALID/);
  rejects(v=>v.openingState.predicates[0]={type:"STORY.SPECIAL",entityId:v.entities[0].id},/PREDICATE_KIND_INVALID/);
  rejects(v=>v.openingState.revision=1,/STATE_REVISION_INVALID/);
  rejects(v=>v.openingProjections[0].knownSecretIds.push("missing.secret"),/REFERENCE_KIND/);
  rejects(v=>v.knowledgeAcl[0].visibility={scope:"PUBLIC"},/ACL_LEAK/);
  rejects(v=>v.extra=true,/UNKNOWN_FIELD/);
  rejects(v=>v.entities[2].kind="PAPER",/ENTITY_KIND_INVALID/);
  rejects(v=>v.contractVersion="latest",/VERSION_INVALID/);
  rejects(v=>v.causalRules[0].condition={all:[{type:"ACTOR.COMMITTED",actorId:v.roles[0].actorId,commitmentId:"missing.commitment"}]},/CAUSAL_REFERENCE_UNSATISFIABLE/);
  rejects(v=>{const p1={type:"ACTOR.COMMITTED",actorId:v.roles[0].actorId,commitmentId:"cycle.one"},p2={type:"ACTOR.COMMITTED",actorId:v.roles[0].actorId,commitmentId:"cycle.two"};v.causalRules[0].condition={all:[p2]};v.causalRules[0].effects=[p1];v.delayedRules[0].condition={all:[p1]};v.delayedRules[0].effects=[p2];},/CAUSAL_REFERENCE_CYCLE/);
});

test("predicate kind references are enforced",()=>{
  rejects(v=>v.openingState.predicates[1].locationId=v.entities[0].id,/REFERENCE_KIND/);
  rejects(v=>v.capabilities[0].institutionId=v.entities[0].id,/REFERENCE_KIND/);
});

test("unsatisfied conditions and revision/world errors do not mutate state",()=>{
  const state=clone(sangtianRuntimeFixture.openingState);state.predicates=[];
  assert.throws(()=>applyCausalRule(sangtianRuntimeFixture,state,sangtianRuntimeFixture.causalRules[0].id),/CONDITION_UNSATISFIED/);
  assert.throws(()=>applyCausalRule(sangtianRuntimeFixture,{...state,worldId:"wrong"},sangtianRuntimeFixture.causalRules[0].id),/WORLD_MISMATCH/);
  assert.deepEqual(state.predicates,[]);
});

test("events and turn envelopes have positive and negative runtime validation",()=>{
  const c=sangtianRuntimeFixture, actor=c.roles[0].actorId, rule=c.causalRules[0], predicate=rule.effects[0];
  const event={eventId:"event.turn-1",worldId:c.worldId,sourceRuleId:rule.id,originActorId:actor,affectedActorIds:[actor],predicate,status:"APPLIED" as const,createdAtRevision:0,visibility:{scope:"PUBLIC" as const},idempotencyKey:"turn-1:event-1"};
  assert.equal(validateCausalEvent(event,c).eventId,event.eventId);
  const envelope={id:"envelope.turn-1",worldId:c.worldId,beforeStateRevision:0,sourceRuleId:rule.id,originActorId:actor,allowedPredicates:[predicate],requiredVisiblePredicates:[],forbiddenPredicates:[],events:[event],projectionActorId:actor};
  assert.equal(validateDurableTurnEnvelope(envelope,c).id,envelope.id);
  assert.throws(()=>validateCausalEvent({...event,sourceRuleId:"missing.rule"},c),/DANGLING_RULE/);
  assert.throws(()=>validateCausalEvent({...event,status:"UNKNOWN"},c),/CAUSAL_EVENT_INVALID/);
  assert.throws(()=>validateDurableTurnEnvelope({...envelope,forbiddenPredicates:[predicate]},c),/TURN_ENVELOPE_CONTRADICTION/);
  assert.throws(()=>validateDurableTurnEnvelope({...envelope,unexpected:true},c),/UNKNOWN_FIELD/);
});
