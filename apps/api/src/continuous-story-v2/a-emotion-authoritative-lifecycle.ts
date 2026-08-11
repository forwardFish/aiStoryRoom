import type { Prisma } from "@prisma/client";
import { isAEmotionM4EnabledForRun } from "../config/a-emotion-m4.config";
import { isAEmotionM5EnabledForRun } from "../config/a-emotion-m5.config";
import { aEmotionSangtianLifecycleAction } from "../config/a-emotion-sangtian-lifecycle.config";
import type { AEmotionM4Service } from "./a-emotion-m4.service";
import type { AEmotionM5Service } from "./a-emotion-m5.service";
import type { PlannedIntentAction } from "./player-intent";

export type AEmotionAuthoritativeLifecycleCodes = {
  actionCodes: string[];
  effectCodes: string[];
  factCodes: string[];
};

export type AEmotionAuthoritativeLifecycleRun = {
  id: string;
  templateKey: string;
  mode: string;
  maxPlayers: number;
  engineVersion: string;
  stateJson: unknown;
  currentNodeId: string | null;
};

/**
 * Compile lifecycle inputs from the exact committed action contract.
 *
 * Suggested cards retain the author actionKey and factKeys. The current planner
 * represents the primary effect as WORLD_FACT hooks, so the exact bare
 * effectKey is restored only through the validated Sangtian action mapping.
 * No prose, labels, translations or model output participate in this bridge.
 */
export function authoritativeLifecycleCodes(
  action: PlannedIntentAction,
  templateKey: string
): AEmotionAuthoritativeLifecycleCodes {
  const actionCodes = action.actionKey ? [action.actionKey] : [];
  const effectCodes = uniqueStrings([
    ...action.effectHooks,
    ...action.influenceEdges.map((edge) => edge.effectKey)
  ]);
  const factCodes = uniqueStrings(action.effectFactKeys);

  if (templateKey === "sangtian") {
    const mapping = aEmotionSangtianLifecycleAction(action.actionKey);
    if (mapping) {
      if (!factCodes.includes(mapping.factKey)) {
        throw new Error(`A_EMOTION_SANGTIAN_LIFECYCLE_FACT_MISMATCH:${action.actionKey}`);
      }
      if (mapping.assetMutation) {
        const mutation = action.leverageDispositions.find((candidate) => candidate.assetKey === mapping.assetMutation?.assetKey);
        if (!mutation || mutation.disposition !== mapping.assetMutation.disposition) {
          throw new Error(`A_EMOTION_SANGTIAN_LIFECYCLE_ASSET_MISMATCH:${action.actionKey}`);
        }
      }
      effectCodes.push(mapping.effectKey);
    }
  }

  return {
    actionCodes: uniqueStrings(actionCodes),
    effectCodes: uniqueStrings(effectCodes),
    factCodes
  };
}

/**
 * The single production dispatch point used by both committed-resolution
 * paths. Tests invoke this same function after creating the real catalog
 * action, ActionResolution and role-asset mutation, so they cannot bypass the
 * integration contract by injecting synthetic lifecycle arrays directly.
 */
export async function applyAuthoritativeAEmotionLifecycle(
  tx: Prisma.TransactionClient,
  input: {
    run: AEmotionAuthoritativeLifecycleRun;
    sourceRoleId: string;
    sourceResolutionId: string;
    sourceActionId: string;
    stageIndex: number;
    action: PlannedIntentAction;
    m4: AEmotionM4Service | null;
    m5: AEmotionM5Service | null;
  }
) {
  const m4Service = input.m4 && isAEmotionM4EnabledForRun(input.run) ? input.m4 : null;
  const m5Service = input.m5 && isAEmotionM5EnabledForRun(input.run) ? input.m5 : null;
  if (!m4Service && !m5Service) return { codes: null, m4: null, m5: null };

  const codes = authoritativeLifecycleCodes(input.action, input.run.templateKey);
  const m4 = m4Service
    ? await m4Service.applyAuthoritativeLifecycle(tx, {
        run: input.run,
        sourceRoleId: input.sourceRoleId,
        sourceResolutionId: input.sourceResolutionId,
        sourceActionId: input.sourceActionId,
        stageIndex: input.stageIndex,
        ...codes
      })
    : null;
  const m5 = m5Service
    ? await m5Service.applyAuthoritativeMilestones(tx, {
        run: input.run,
        beneficiaryRoleId: input.sourceRoleId,
        sourceResolutionId: input.sourceResolutionId,
        sourceActionId: input.sourceActionId,
        stageIndex: input.stageIndex,
        ...codes
      })
    : null;
  return { codes, m4, m5 };
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}
