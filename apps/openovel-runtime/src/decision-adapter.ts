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
};

/**
 * Compatibility adapter assembled from two independently replaceable modules.
 * Settlement is the sole world-fact writer; NextBeat only plans what the
 * Narrator is allowed to render and cannot mutate settlement payloads.
 */
export function composeAuthoredDecisionModules(
  modules: AuthoredTurnModules,
): AuthoredDecisionAdapter {
  return {
    moduleIds: {
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
      const settlement = await executeTurnModule({
        runId: input.runId,
        turnId,
        descriptor: {
          kind: "FACT_SETTLEMENT",
          moduleId: modules.settlement.moduleId,
          mode: "REQUIRED",
        },
        value: input,
        execute: () => modules.settlement.settle(workspace, input),
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
      return validatePreparedAuthoredDecision(planned);
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
