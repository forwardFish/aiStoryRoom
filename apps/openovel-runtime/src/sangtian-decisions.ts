import path from "node:path";
import templatesPackage, {
  type KernelSelectionTrace,
  type PartOneActionSettlement,
  type PartOneDecisionPin,
  type PartOneRuntimePackage,
  type PartOneRuntimeWorkingSet,
  type PartOneState,
} from "@ai-story/templates";
import {
  composeAuthoredDecisionModules,
  type FactSettlementModule,
  type NextBeatPlannerModule,
  type PreparedAuthoredDecision,
  type PreparedFactSettlement,
} from "./decision-adapter.js";
import { readJson, readText } from "./io.js";
import type { FileStoryWorkspace } from "./workspace.js";
import type { OpenNovelOption } from "./types.js";
import * as base from "./sangtian-decisions-base.js";
import type { PreparedSangtianDecision } from "./sangtian-decisions-base.js";

export * from "./sangtian-decisions-base.js";

const {
  buildPartOneRuntimeWorkingSet,
  loadPartOneRuntimePackage,
} = templatesPackage;

type EventWithKernelSelection = PartOneActionSettlement["event"] & {
  nextKernelSelection?: KernelSelectionTrace;
};

type SangtianDecisionContext = {
  pkg: PartOneRuntimePackage;
  state: PartOneState;
  turnNumber: number;
  workingSet: PartOneRuntimeWorkingSet & {
    kernelSelection?: KernelSelectionTrace;
  };
  pin: PartOneDecisionPin;
};

export async function prepareSangtianDecision(
  workspace: FileStoryWorkspace,
  input: {
    runId: string;
    turnNumber: number;
    action: string;
    selectedOption: OpenNovelOption | null;
  },
): Promise<PreparedSangtianDecision | null> {
  if (
    input.selectedOption
    && !input.selectedOption.id.startsWith("opening_")
    && !input.selectedOption.id.startsWith("opt_")
  ) {
    const context = await currentSangtianDecisionContext(
      workspace,
      input.runId,
    );
    if (context) {
      assertSelectedOptionMatchesContext(input.selectedOption, context);
    }
  }
  return base.prepareSangtianDecision(workspace, input);
}

export function nextSangtianOptions(
  prepared: PreparedSangtianDecision,
): OpenNovelOption[] {
  const state = prepared.settlement.proposedState;
  if (state.partCompletionStatus === "HANDOFF_READY") return [];
  const context = decisionContextForCommittedEvent(
    prepared.package,
    state,
    prepared.settlement.event.turnNumber,
    prepared.settlement.event,
    true,
  );
  const options = optionsForWorkingSet(context.workingSet);
  assertOptionsMatchContext(options, context);
  return options;
}

export async function currentSangtianOptions(
  workspace: FileStoryWorkspace,
  runId: string,
): Promise<OpenNovelOption[] | null> {
  const context = await currentSangtianDecisionContext(workspace, runId);
  if (!context) {
    return base.currentSangtianOptions(workspace, runId);
  }
  const options = optionsForWorkingSet(context.workingSet);
  assertOptionsMatchContext(options, context);
  return options;
}

export const sangtianFactSettlementModule: FactSettlementModule = {
  moduleId: base.sangtianFactSettlementModule.moduleId,
  currentOptions: currentSangtianOptions,

  async settle(workspace, input) {
    const prepared = await prepareSangtianDecision(workspace, input);
    if (!prepared) return null;
    const event = prepared.settlement.event;
    return {
      selectedOption: prepared.selectedOption,
      storyComplete:
        prepared.settlement.proposedState.partCompletionStatus
        === "HANDOFF_READY",
      audit: {
        eventId: event.eventId,
        decisionKernelId: event.decisionKernelId,
        affordanceTemplateId: event.affordanceTemplateId,
        changedStatePaths: event.changedStatePaths,
      },
      payload: prepared,
    };
  },

  async commit(workspace, runId, settlement) {
    await base.commitSangtianDecision(
      workspace,
      runId,
      requireSangtianPayload(settlement),
    );
  },

  async projectCommit(workspace, runId, settlement) {
    return base.projectSangtianDecision(
      workspace,
      runId,
      requireSangtianPayload(settlement),
    );
  },
};

export const sangtianNextBeatPlannerModule: NextBeatPlannerModule = {
  moduleId: base.sangtianNextBeatPlannerModule.moduleId,
  plan: (settlement) => base.sangtianNextBeatPlannerModule.plan(settlement),
  nextOptions(prepared) {
    return nextSangtianOptions(requireSangtianPayload(prepared));
  },
};

export const sangtianDecisionAdapter = composeAuthoredDecisionModules({
  settlement: sangtianFactSettlementModule,
  nextBeat: sangtianNextBeatPlannerModule,
});

async function currentSangtianDecisionContext(
  workspace: FileStoryWorkspace,
  runId: string,
): Promise<SangtianDecisionContext | null> {
  const metadata = await workspace.metadata(runId);
  if (
    metadata.worldId !== "sangtian"
    || metadata.roleId !== "zhejiang_governor"
  ) {
    return null;
  }
  const paths = workspace.paths(runId);
  const state = await readJson<PartOneState | null>(paths.partOneState, null);
  if (!state || state.partCompletionStatus === "HANDOFF_READY") return null;
  if (Number(state.turnNumber || 0) !== Number(metadata.turnNumber || 0)) {
    throw new Error("SANGTIAN_STATE_REVISION_MISMATCH");
  }
  const lastCommittedEventId = String(
    state.lastCommittedEventId || "",
  ).trim();
  if (!lastCommittedEventId) {
    if (Number(state.turnNumber || 0) > 0) {
      throw new Error("SANGTIAN_COMMITTED_EVENT_ID_MISSING");
    }
    return null;
  }

  const events = parseJsonLines<PartOneActionSettlement["event"]>(
    await readText(paths.partOneEvents, ""),
  );
  const matches = events.filter(
    (event) => event?.eventId === lastCommittedEventId,
  );
  if (!matches.length) {
    throw new Error("SANGTIAN_COMMITTED_EVENT_MISSING");
  }
  if (matches.length > 1) {
    throw new Error("SANGTIAN_COMMITTED_EVENT_DUPLICATE");
  }
  const pkg = partOnePackage(workspace.projectRoot);
  return decisionContextForCommittedEvent(
    pkg,
    state,
    metadata.turnNumber,
    matches[0]!,
    false,
  );
}

function decisionContextForCommittedEvent(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
  event: PartOneActionSettlement["event"],
  includeOutcomeHashes: boolean,
): SangtianDecisionContext {
  if (event.sectionIdAfter !== state.sectionId) {
    throw new Error("SANGTIAN_COMMITTED_EVENT_SECTION_MISMATCH");
  }
  if (
    Number(event.turnNumber || 0) !== Number(turnNumber || 0)
    || Number(state.turnNumber || 0) !== Number(turnNumber || 0)
  ) {
    throw new Error("SANGTIAN_COMMITTED_EVENT_REVISION_MISMATCH");
  }
  if (
    state.lastCommittedEventId
    && state.lastCommittedEventId !== event.eventId
  ) {
    throw new Error("SANGTIAN_COMMITTED_EVENT_STATE_MISMATCH");
  }

  const pin = decisionPinForCommittedEvent(event, includeOutcomeHashes);
  const workingSet = buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    turnNumber,
    { mode: "DYNAMIC_LITE", pin },
  );
  if (
    workingSet.decisionPoint.decisionKernelId !== pin.decisionKernelId
    || workingSet.decisionPoint.decisionPointId !== pin.decisionPointId
  ) {
    throw new Error("SANGTIAN_PINNED_DECISION_POINT_MISMATCH");
  }
  if (pin.affordanceIds?.length) {
    const actual = workingSet.decisionAffordances.map(
      (item) => item.affordanceTemplateId,
    );
    if (!sameStringArray(actual, pin.affordanceIds)) {
      throw new Error("SANGTIAN_PINNED_AFFORDANCE_PAIR_MISMATCH");
    }
  }
  return {
    pkg,
    state,
    turnNumber,
    workingSet,
    pin,
  };
}

function decisionPinForCommittedEvent(
  event: PartOneActionSettlement["event"],
  includeOutcomeHashes: boolean,
): PartOneDecisionPin {
  const traced = event as EventWithKernelSelection;
  const next = event.nextDecisionPoint;
  const trace = traced.nextKernelSelection;
  if (
    trace
    && (
      trace.selectedKernelId !== next.decisionKernelId
      || trace.selectedDecisionPointId !== next.decisionPointId
      || trace.sectionId !== event.sectionIdAfter
    )
  ) {
    throw new Error("SANGTIAN_COMMITTED_KERNEL_TRACE_MISMATCH");
  }
  return {
    decisionKernelId: next.decisionKernelId,
    decisionPointId: next.decisionPointId,
    ...(trace?.selectedAffordanceIds?.length
      ? { affordanceIds: [...trace.selectedAffordanceIds] }
      : {}),
    ...(includeOutcomeHashes && trace?.selectedOutcomeHashes?.length
      ? { outcomeHashes: [...trace.selectedOutcomeHashes] }
      : {}),
  };
}

/**
 * Published and recovered option surfaces are projected from the already
 * pinned WorkingSet. Their full narrative contract is rebuilt after the
 * selected action settles, so recovery does not need to re-run an unpinned
 * selector merely to produce the player-facing action surface.
 */
function optionsForWorkingSet(
  workingSet: PartOneRuntimeWorkingSet,
): OpenNovelOption[] {
  return workingSet.decisionAffordances.map((affordance) => ({
    id: affordance.affordanceTemplateId,
    label: affordance.actionText,
    key: true,
    effect: {
      decisionPointId: affordance.decisionPointId,
      intent: affordance.immediateIntent,
      consequence: affordance.visibleTradeoff,
      reversible: false,
    },
  }));
}

function assertOptionsMatchContext(
  options: OpenNovelOption[],
  context: SangtianDecisionContext,
) {
  const actual = options.map((option) => option.id);
  const expected = context.workingSet.decisionAffordances
    .map((affordance) => affordance.affordanceTemplateId);
  if (!sameStringArray(actual, expected)) {
    throw new Error("SANGTIAN_PINNED_OPTION_SURFACE_MISMATCH");
  }
  if (options.some((option) => (
    option.effect?.decisionPointId !== context.pin.decisionPointId
  ))) {
    throw new Error("SANGTIAN_PINNED_OPTION_DECISION_POINT_MISMATCH");
  }
}

function assertSelectedOptionMatchesContext(
  selectedOption: OpenNovelOption,
  context: SangtianDecisionContext,
) {
  const expected = context.workingSet.decisionAffordances.find(
    (affordance) => affordance.affordanceTemplateId === selectedOption.id,
  );
  if (!expected) {
    throw new Error("SANGTIAN_PINNED_SELECTED_OPTION_MISSING");
  }
  if (selectedOption.effect?.decisionPointId !== context.pin.decisionPointId) {
    throw new Error(
      "SANGTIAN_PINNED_SELECTED_OPTION_DECISION_POINT_MISMATCH",
    );
  }
}

function requireSangtianPayload(
  prepared: Pick<PreparedAuthoredDecision, "payload"> | PreparedFactSettlement,
): PreparedSangtianDecision {
  const payload = prepared.payload as PreparedSangtianDecision | null;
  if (!payload?.package || !payload.settlement?.event) {
    throw new Error("AUTHORED_DECISION_PAYLOAD_INVALID");
  }
  return payload;
}

function partOnePackage(projectRoot: string) {
  return loadPartOneRuntimePackage(
    "sangtian",
    path.join(projectRoot, "packages", "templates", "config"),
  ).package;
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function parseJsonLines<T>(text: string): T[] {
  return text
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}
