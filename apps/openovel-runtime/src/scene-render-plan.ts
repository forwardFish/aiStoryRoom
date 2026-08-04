import type { PreparedAuthoredDecision } from "./decision-adapter.js";
import {
  assembleSceneDraft,
  narrativeSlotIds,
  validatePlayerVisibleFallbackDraft,
  type AssemblyManifest,
  type PlayerVisibleFallbackDraft,
  type SceneAudit,
} from "./scene-expression.js";
import type { ProviderResult } from "./types.js";

export const SCENE_RENDER_PLAN_SCHEMA = "omw.scene-render-plan.v1" as const;

export type SceneRenderMode = "COMPOSED_SCENE" | "OPEN_SCENE";
export type NarrativeOwner = "COMPOSED" | "NARRATOR" | "FALLBACK";
export type CriticalSceneReason =
  | "PROTECTED_CAUSAL_RESULT"
  | "SCENE_TRANSITION"
  | "KEY_CAST_CHANGE";

export type SceneRenderPlan = {
  schemaVersion: typeof SCENE_RENDER_PLAN_SCHEMA;
  turnId: string;
  mode: SceneRenderMode;
  owner: "NARRATOR";
  criticalReasons: CriticalSceneReason[];
  approvedAssetId: string | null;
};

export interface SceneRenderPlannerModule {
  readonly moduleId: string;
  plan(input: {
    turnId: string;
    preparedDecision: PreparedAuthoredDecision | null;
  }): SceneRenderPlan;
}

/**
 * Chooses whether the Narrator writes an open scene or a slot-composed scene.
 * Durable facts never make the deterministic fallback the normal scene
 * writer: the server owns only protected slots and the Narrator owns the
 * dramatic expression around them.
 */
export class DefaultSceneRenderPlanner implements SceneRenderPlannerModule {
  readonly moduleId = "openovel.scene-render-planner.v1";

  plan(input: {
    turnId: string;
    preparedDecision: PreparedAuthoredDecision | null;
  }): SceneRenderPlan {
    const prepared = input.preparedDecision;
    if (!prepared) return openPlan(input.turnId);

    const reasons = new Set<CriticalSceneReason>();
    if (prepared.beatManifest.tickets.some((ticket) => (
      ticket.expressionOwner === "PROTECTED"
    ))) {
      reasons.add("PROTECTED_CAUSAL_RESULT");
    }
    if (prepared.beatManifest.transition.transitionRequired) {
      reasons.add("SCENE_TRANSITION");
    }
    if (
      prepared.beatManifest.transition.arrivingActorIds.length
      || prepared.beatManifest.transition.departingActorIds.length
    ) {
      reasons.add("KEY_CAST_CHANGE");
    }

    if (!reasons.size) return openPlan(input.turnId);
    return {
      schemaVersion: SCENE_RENDER_PLAN_SCHEMA,
      turnId: input.turnId,
      mode: "COMPOSED_SCENE",
      owner: "NARRATOR",
      criticalReasons: [...reasons],
      approvedAssetId: prepared.fallbackDraft.draftId,
    };
  }
}

export type ProtectedSceneRenderResult = {
  owner: "FALLBACK";
  text: string;
  contextText: string;
  factText: string;
  draft: PlayerVisibleFallbackDraft;
  audit: SceneAudit;
  assemblyManifest: AssemblyManifest;
  providerResult: ProviderResult;
};

export interface ProtectedSceneRendererModule {
  readonly moduleId: string;
  render(input: {
    plan: SceneRenderPlan;
    preparedDecision: PreparedAuthoredDecision;
  }): ProtectedSceneRenderResult;
}

/**
 * Emergency deterministic renderer for provider/transport failure. It is not
 * selected merely because a turn contains a protected causal result.
 */
export class DeterministicProtectedSceneRenderer implements ProtectedSceneRendererModule {
  readonly moduleId = "openovel.protected-scene-renderer.v1";

  render(input: {
    plan: SceneRenderPlan;
    preparedDecision: PreparedAuthoredDecision;
  }): ProtectedSceneRenderResult {
    if (
      input.plan.mode !== "COMPOSED_SCENE"
      || input.plan.owner !== "NARRATOR"
    ) {
      throw new Error("COMPOSED_RENDER_MODE_REQUIRED");
    }
    const manifest = input.preparedDecision.beatManifest;
    const draft = validatePlayerVisibleFallbackDraft(
      input.preparedDecision.fallbackDraft,
      manifest,
    );
    if (input.plan.approvedAssetId !== draft.draftId) {
      throw new Error("PROTECTED_SCENE_ASSET_MISMATCH");
    }
    const audit: SceneAudit = {
      draftId: draft.draftId,
      valid: true,
      slots: narrativeSlotIds
        .filter((slot) => draft.slots[slot])
        .map((slot) => ({
          slot,
          coveredTicketIds: draft.surfaceProvenance[slot]!.coveredTicketIds,
          p0ConflictCodes: [],
          scenePhaseValid: true,
        })),
    };
    const assembled = assembleSceneDraft({ manifest, draft, audit });
    const factText = manifest.tickets
      .filter((ticket) => ticket.required)
      .map((ticket) => ticket.requiredMeaning)
      .join("\n");
    return {
      owner: "FALLBACK",
      text: assembled.text,
      contextText: factText,
      factText,
      draft,
      audit,
      assemblyManifest: assembled.manifest,
      providerResult: {
        text: assembled.text,
        model: this.moduleId,
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 0,
      },
    };
  }
}

export function assertSingleSceneOwner(input: {
  plan: SceneRenderPlan;
  actualOwner: NarrativeOwner;
}) {
  // Fallback remains a complete independently authored player surface. Normal
  // composed scenes have one owner per slot, with a deterministic assembly.
  if (input.actualOwner === "FALLBACK") return;
  const expected = input.plan.mode === "COMPOSED_SCENE"
    ? "COMPOSED"
    : "NARRATOR";
  if (input.actualOwner !== expected) {
    throw new Error(`SCENE_OWNER_MISMATCH:${expected}:${input.actualOwner}`);
  }
}

function openPlan(turnId: string): SceneRenderPlan {
  return {
    schemaVersion: SCENE_RENDER_PLAN_SCHEMA,
    turnId,
    mode: "OPEN_SCENE",
    owner: "NARRATOR",
    criticalReasons: [],
    approvedAssetId: null,
  };
}
