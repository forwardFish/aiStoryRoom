import type { DurableState, WorldRuntimeContract } from "./types";
import { conditionSatisfied, predicateKey, validateDurableState, validateWorldRuntimeContract } from "./validation";

export function applyCausalRule(contractInput: WorldRuntimeContract, stateInput: DurableState, ruleId: string): DurableState {
  const contract = validateWorldRuntimeContract(contractInput);
  const state = validateDurableState(stateInput, contract);
  const rule = [...contract.causalRules, ...contract.delayedRules].find((candidate) => candidate.id === ruleId);
  if (!rule) throw new Error(`RUNTIME_CONTRACT_DANGLING_RULE:${ruleId}`);
  if (!conditionSatisfied(rule.condition, state.predicates)) throw new Error(`CAUSAL_CONDITION_UNSATISFIED:${ruleId}`);
  if ("delayRevisions" in rule) {
    return { ...state, revision: state.revision + 1, pendingRuleIds: [...new Set([...state.pendingRuleIds, rule.id])].sort() };
  }
  const predicates = new Map(state.predicates.map((predicate) => [predicateKey(predicate), predicate]));
  rule.effects.forEach((predicate) => predicates.set(predicateKey(predicate), predicate));
  return { ...state, revision: state.revision + 1, predicates: [...predicates.values()].sort((a, b) => predicateKey(a).localeCompare(predicateKey(b))) };
}
