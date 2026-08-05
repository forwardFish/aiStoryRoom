import type { FileStoryWorkspace } from "./workspace.js";
import type { OpenNovelOption } from "./types.js";
import type { NarrativeTruthContext } from "./truth-review.js";
import type { AtomicTurnProjection } from "./atomic-turn.js";
import { executeTurnModule, type TurnModuleExecutionRecord } from "./turn-modules.js";
import {
  validateBeatManifest,
  validatePlayerVisibleFallbackDraft,
  type BeatManifest,
  type PlayerVisibleFallbackDraft,
} from "./scene-expression.js";
import {
  DeterministicAffordanceIntentResolver,
  type IntentResolverModule,
  type ResolvedIntent,
} from "./intent-resolver.js";
import { actionRejected } from "./runtime-errors.js";

export type PreparedAuthoredDecision = {
  selectedOption: OpenNovelOption | null;
  settledNarrative: string;
  sourceRef: string;
  beatManifest: BeatManifest;
  storyComplete: boolean;
  fallbackDraft: PlayerVisibleFallbackDraft;
  truthContexts: {
    actionPhase: NarrativeTruthContext;
    afterPhase: NarrativeTruthContext;
  };
  audit: Record<string, unknown>;
  payload: unknown;
};

export type PreparedFactSettlement = {
  selectedOption: OpenNovelOption | null;
  storyComplete: boolean;
  audit: Record<string, unknown>;
  /** World-owned settlement payload. Narrative text must never be parsed back into it. */
  payload: unknown;
};

export interface FactSettlementModule {
  readonly moduleId: string;

  currentOptions(
    workspace: FileStoryWorkspace,
    runId: string,
  ): Promise<OpenNovelOption[] | null>;

  settle(
    workspace: FileStoryWorkspace,
    input: {
      runId: string;
      turnNumber: number;
      action: string;
      selectedOption: OpenNovelOption | null;
    },
  ): Promise<PreparedFactSettlement | null>;

  commit(
    workspace: FileStoryWorkspace,
    runId: string,
    settlement: PreparedFactSettlement,
  ): Promise<void>;

  projectCommit(
    workspace: FileStoryWorkspace,
    runId: string,
    settlement: PreparedFactSettlement,
  ): Promise<AtomicTurnProjection>;
}

export interface NextBeatPlannerModule {
  readonly moduleId: string;

  plan(settlement: PreparedFactSettlement): Promise<PreparedAuthoredDecision>;

  nextOptions(prepared: PreparedAuthoredDecision): OpenNovelOption[];
}

export type AuthoredTurnModules = {
  settlement: FactSettlementModule;
  nextBeat: NextBeatPlannerModule;
  intentResolver?: IntentResolverModule;
};

/**
 * Compatibility adapter assembled from independently replaceable modules.
 * Settlement is the sole world-fact writer; NextBeat only plans what the
 * Narrator is allowed to render and cannot mutate settlement payloads.
 * Unbound player language is resolved against the exact Affordances already
 * published to the player before either module runs, so free text and option
 * clicks enter the same authoritative Settlement / Kernel path without a
 * recomputation race at G00 or after recovery.
 */
export function composeAuthoredDecisionModules(
  modules: AuthoredTurnModules,
): AuthoredDecisionAdapter {
  const intentResolver = modules.intentResolver
    || new DeterministicAffordanceIntentResolver();
  return {
    moduleIds: {
      intentResolver: intentResolver.moduleId,
      factSettlement: modules.settlement.moduleId,
      nextBeatPlanner: modules.nextBeat.moduleId,
    },
    currentOptions: (workspace, runId) => modules.settlement.currentOptions(workspace, runId),
    async prepare(workspace, input) {
      const turnId = `T${String(input.turnNumber).padStart(2, "0")}`;
      const record = async (entry: TurnModuleExecutionRecord): Promise<void> => {
        await workspace.recordSceneEvent(
          input.runId,
          { type: "turn_module_execution", ...entry },
        ).catch(() => {});
      };
      const resolved = await resolveAuthoredAction({
        workspace,
        input,
        turnId,
        settlement: modules.settlement,
        intentResolver,
      });
      const settlement = await executeTurnModule({
        runId: input.runId,
        turnId,
        descriptor: {
          kind: "FACT_SETTLEMENT",
          moduleId: modules.settlement.moduleId,
          mode: "REQUIRED",
        },
        value: resolved.input,
        execute: () => modules.settlement.settle(workspace, resolved.input),
        onRecord: record,
      });
      if (!settlement) return null;
      const planned = await executeTurnModule({
        runId: input.runId,
        turnId,
        descriptor: {
          kind: "NEXT_BEAT_PLANNER",
          moduleId: modules.nextBeat.moduleId,
          mode: "REQUIRED",
        },
        value: settlement,
        execute: () => modules.nextBeat.plan(settlement),
        onRecord: record,
      });
      const prepared = validatePreparedAuthoredDecision(planned);
      if (!resolved.resolution) return prepared;
      return {
        ...prepared,
        audit: {
          ...prepared.audit,
          intentResolution: auditIntentResolution(
            resolved.resolution,
            input.action,
            resolved.affordanceSource,
          ),
        },
      };
    },
    commit: (workspace, runId, prepared) => modules.settlement.commit(
      workspace,
      runId,
      factSettlementFromPrepared(prepared),
    ),
    projectCommit: (workspace, runId, prepared) => modules.settlement.projectCommit(
      workspace,
      runId,
      factSettlementFromPrepared(prepared),
    ),
    nextOptions: (prepared) => modules.nextBeat.nextOptions(prepared),
  };
}

async function resolveAuthoredAction(input: {
  workspace: FileStoryWorkspace;
  input: {
    runId: string;
    turnNumber: number;
    action: string;
    selectedOption: OpenNovelOption | null;
  };
  turnId: string;
  settlement: FactSettlementModule;
  intentResolver: IntentResolverModule;
}) {
  if (input.input.selectedOption) {
    return {
      input: input.input,
      resolution: null as ResolvedIntent | null,
      affordanceSource: null as "DISPLAYED_OPTIONS" | "COMMITTED_WORLD_STATE" | null,
    };
  }
  const snapshot = await input.workspace.snapshot(input.input.runId);
  const displayedAffordances = snapshot.previousOptions;
  const committedAffordances = displayedAffordances.length
    ? null
    : await input.settlement.currentOptions(input.workspace, input.input.runId);
  const affordances = displayedAffordances.length
    ? displayedAffordances
    : committedAffordances;
  const affordanceSource = displayedAffordances.length
    ? "DISPLAYED_OPTIONS" as const
    : "COMMITTED_WORLD_STATE" as const;
  if (!affordances?.length) {
    return {
      input: input.input,
      resolution: null as ResolvedIntent | null,
      affordanceSource,
    };
  }
  const resolution = await input.intentResolver.resolve({
    action: input.input.action,
    affordances,
  });
  await input.workspace.recordSceneEvent(input.input.runId, {
    type: "intent_resolution",
    turnId: input.turnId,
    moduleId: input.intentResolver.moduleId,
    originalAction: input.input.action,
    affordanceSource,
    status: resolution.status,
    intentType: resolution.intentType,
    matchedAffordanceId: resolution.matchedAffordanceId,
    capabilityRef: resolution.capabilityRef,
    targetRefs: resolution.targetRefs,
    confidence: resolution.confidence,
    reason: resolution.reason,
    alternatives: resolution.alternatives,
  }).catch(() => {});

  if (resolution.status === "BOUND_CAPABILITY") {
    const decisionPointId = resolution.targetRefs[0];
    if (!decisionPointId || !resolution.canonicalAction) {
      throw new Error("INTENT_CAPABILITY_BINDING_INVALID");
    }
    const selectedOption: OpenNovelOption = {
      id: `opt_capability_${input.turnId.toLowerCase()}`,
      label: resolution.canonicalAction,
      key: true,
      effect: {
        decisionPointId,
        intent: resolution.canonicalAction,
        reversible: true,
        beatContract: {
          sourceRef: `intent-resolution:${input.turnId}`,
          objective: "在当前公开决策点内执行一次能力级观察或准备行动，不替代尚未完成的正式决策。",
          moves: [resolution.canonicalAction],
          requiredAnchorGroups: [],
          requiredDurableAnchorGroups: [],
          constraints: resolution.constraints,
          settledNarrative: resolution.canonicalAction,
          stopCondition: "回到同一公开决策点，由玩家决定是否执行一项会改变权威状态的正式行动。",
        },
      },
    };
    return {
      input: {
        ...input.input,
        action: resolution.canonicalAction,
        selectedOption,
      },
      resolution,
      affordanceSource,
    };
  }

  if (resolution.status !== "BOUND_AFFORDANCE") {
    throw actionRejected(
      resolution.status === "CLARIFICATION_REQUIRED"
        ? "INTENT_CLARIFICATION_REQUIRED"
        : "INTENT_CAPABILITY_UNAVAILABLE",
    );
  }
  const selectedOption = affordances.find((option) => (
    option.id === resolution.matchedAffordanceId
  ));
  if (!selectedOption || !resolution.canonicalAction) {
    throw new Error("INTENT_RESOLUTION_BINDING_INVALID");
  }
  return {
    input: {
      ...input.input,
      action: resolution.canonicalAction,
      selectedOption,
    },
    resolution,
    affordanceSource,
  };
}

function auditIntentResolution(
  resolution: ResolvedIntent,
  originalAction: string,
  affordanceSource: "DISPLAYED_OPTIONS" | "COMMITTED_WORLD_STATE" | null,
) {
  return {
    schemaVersion: resolution.schemaVersion,
    moduleStatus: resolution.status,
    intentType: resolution.intentType,
    capabilityRef: resolution.capabilityRef,
    targetRefs: resolution.targetRefs,
    constraints: resolution.constraints,
    matchedAffordanceId: resolution.matchedAffordanceId,
    confidence: resolution.confidence,
    reason: resolution.reason,
    affordanceSource,
    originalAction,
  };
}

function factSettlementFromPrepared(
  prepared: PreparedAuthoredDecision,
): PreparedFactSettlement {
  return {
    selectedOption: prepared.selectedOption,
    storyComplete: prepared.storyComplete,
    audit: prepared.audit,
    payload: prepared.payload,
  };
}
export interface AuthoredDecisionAdapter {
  readonly moduleIds?: {
    intentResolver?: string;
    factSettlement: string;
    nextBeatPlanner: string;
  };

  currentOptions(
    workspace: FileStoryWorkspace,
    runId: string,
  ): Promise<OpenNovelOption[] | null>;

  prepare(
    workspace: FileStoryWorkspace,
    input: {
      runId: string;
      turnNumber: number;
      action: string;
      selectedOption: OpenNovelOption | null;
    },
  ): Promise<PreparedAuthoredDecision | null>;

  commit(
    workspace: FileStoryWorkspace,
    runId: string,
    prepared: PreparedAuthoredDecision,
  ): Promise<void>;

  /** Build authoritative state before Canon advances. Generated prose is
   * never parsed to decide state; the runtime commits this projection and the
   * reviewed narrative behind one Head pointer. */
  projectCommit(
    workspace: FileStoryWorkspace,
    runId: string,
    prepared: PreparedAuthoredDecision,
  ): Promise<AtomicTurnProjection>;

  nextOptions(prepared: PreparedAuthoredDecision): OpenNovelOption[];
}

/** Deterministic pre-model gate for every world adapter. */
export function validatePreparedAuthoredDecision(
  prepared: PreparedAuthoredDecision,
): PreparedAuthoredDecision {
  const manifest = validateBeatManifest(prepared.beatManifest);
  validatePlayerVisibleFallbackDraft(prepared.fallbackDraft, manifest);
  const resultTicket = manifest.tickets.find((ticket) => ticket.slot === "PLAYER_RESULT");
  const stopTicket = manifest.tickets.find((ticket) => ticket.slot === "DECISION_STOP");
  if (!resultTicket || normalize(resultTicket.requiredMeaning) !== normalize(prepared.settledNarrative)) {
    throw new Error("BEAT_MANIFEST_PLAYER_RESULT_MISMATCH");
  }
  if (!stopTicket || normalize(stopTicket.requiredMeaning)
    !== normalize(prepared.truthContexts.afterPhase.stopCondition || "")) {
    throw new Error("BEAT_MANIFEST_STOP_POINT_MISMATCH");
  }
  return prepared;
}

function normalize(value: string) {
  return String(value || "").replace(/\r\n?/gu, "\n").trim();
}
