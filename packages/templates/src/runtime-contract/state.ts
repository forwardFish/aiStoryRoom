import type { CausalRule, DelayedCausalRule, DurableState, WorldRuntimeContract } from "./types";
import { conditionSatisfied, validateWorldRuntimeContract } from "./validation";

export function applyCausalRule(contractInput: WorldRuntimeContract, state: DurableState, ruleId: string): DurableState {
  const contract=validateWorldRuntimeContract(contractInput); if(state.worldId!==contract.worldId)throw new Error(`RUNTIME_CONTRACT_WORLD_MISMATCH:${state.worldId}`); if(!Number.isInteger(state.revision)||state.revision<0)throw new Error(`STATE_REVISION_INVALID:${state.revision}`);
  const rule: CausalRule | DelayedCausalRule | undefined=[...contract.causalRules,...contract.delayedRules].find(r=>r.id===ruleId); if(!rule)throw new Error(`RUNTIME_CONTRACT_DANGLING_RULE:${ruleId}`); if(!conditionSatisfied(rule.condition,state.predicates))throw new Error(`CAUSAL_CONDITION_UNSATISFIED:${ruleId}`);
  if("delayRevisions" in rule)return {worldId:state.worldId,revision:state.revision+1,predicates:[...state.predicates],pendingRuleIds:[...new Set([...state.pendingRuleIds,rule.id])].sort()};
  const encoded=new Map(state.predicates.map(p=>[JSON.stringify(p),p])); rule.effects.forEach(p=>encoded.set(JSON.stringify(p),p)); return {worldId:state.worldId,revision:state.revision+1,predicates:[...encoded.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),pendingRuleIds:[...state.pendingRuleIds].sort()};
}
