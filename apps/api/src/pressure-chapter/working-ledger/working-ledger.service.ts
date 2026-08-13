import {
  sha256Canonical,
  validateRunRouteSnapshotV1,
  type RunRouteSnapshotV1,
} from "@ai-story/shared";
import {
  assertPressureChapterDefinition,
  buildChapterWorkingSet,
  pinChapterWorkingSet,
  type ChapterWorkingState,
  type PressureChapterDefinition,
} from "@ai-story/templates";
import type {
  WorkingLedgerEventV1,
  WorkingLedgerOpenedPayloadV1,
  WorkingLedgerPort,
  WorkingLedgerProjectionV1,
} from "./contracts";
import {
  buildWorkingLedgerEvents,
  projectWorkingLedger,
  workingStateHash,
} from "./working-ledger";
import {
  WORKING_LEDGER_ERROR_CODES as ERROR,
  failWorkingLedger,
} from "./errors";

export interface OpenWorkingLedgerCommandV1 {
  routeSnapshot: RunRouteSnapshotV1;
  chapterRuntimeId: string;
  chapterDefinition: PressureChapterDefinition;
  initialState: ChapterWorkingState;
}

export interface PlannedWorkingLedgerOpeningV1 {
  event: WorkingLedgerEventV1;
  projection: WorkingLedgerProjectionV1;
}

/**
 * Side-effect-free W5 opening plan. The regular repository-backed service and
 * the SQL7 transaction boundary share this exact authority calculation.
 */
export function planWorkingLedgerOpeningV1(
  command: Readonly<OpenWorkingLedgerCommandV1>,
): PlannedWorkingLedgerOpeningV1 {
  const route = validateRunRouteSnapshotV1(command.routeSnapshot);
  const definition = assertPressureChapterDefinition(command.chapterDefinition);
  const state = structuredClone(command.initialState);
  if (
    !command.chapterRuntimeId.trim()
    || state.runId !== route.runId
    || state.chapterId !== definition.chapterId
    || state.revision !== 0
  ) failWorkingLedger(ERROR.CONTEXT_MISMATCH, "open-command");
  const key = { runId: route.runId, chapterRuntimeId: command.chapterRuntimeId };
  const definitionHash = sha256Canonical(definition);
  const stateHash = workingStateHash(state);
  const workingSet = buildChapterWorkingSet(definition, state);
  const payload: WorkingLedgerOpenedPayloadV1 = {
    eventType: "WORKING_LEDGER_OPENED",
    routeHash: route.routeHash,
    chapterDefinitionHash: definitionHash,
    initialState: state,
    initialStateHash: stateHash,
    nextDecisionPin: workingSet ? pinChapterWorkingSet(workingSet) : null,
  };
  const [event] = buildWorkingLedgerEvents({
    key,
    chapterId: definition.chapterId,
    previousEvents: [],
    payloads: [payload],
  });
  if (!event) failWorkingLedger(ERROR.CORRUPT, "opening-event-missing");
  return {
    event,
    projection: projectWorkingLedger([event]),
  };
}

export class WorkingLedgerService {
  constructor(private readonly ledgerPort: WorkingLedgerPort) {}

  async open(command: OpenWorkingLedgerCommandV1): Promise<{
    status: "OPENED" | "REPLAYED";
    event: WorkingLedgerEventV1;
    projection: WorkingLedgerProjectionV1;
  }> {
    const route = validateRunRouteSnapshotV1(command.routeSnapshot);
    const definition = assertPressureChapterDefinition(command.chapterDefinition);
    const planned = planWorkingLedgerOpeningV1(command);
    const event = planned.event;
    const key = { runId: route.runId, chapterRuntimeId: command.chapterRuntimeId };
    const definitionHash = sha256Canonical(definition);
    const stateHash = workingStateHash(command.initialState);
    const appended = await this.ledgerPort.append({
      key,
      expectedHeadHash: null,
      events: [event],
    });
    if (appended.status === "APPENDED") {
      return {
        status: "OPENED",
        event,
        projection: planned.projection,
      };
    }
    // HEAD_MISMATCH returns the current durable chain from the same atomic
    // append attempt, so replay validation does not need another DB read.
    const concurrent = appended.events;
    if (!concurrent.length) failWorkingLedger(ERROR.HEAD_CONFLICT);
    const projection = projectWorkingLedger(concurrent);
    const opened = concurrent[0]!.payload;
    if (opened.eventType !== "WORKING_LEDGER_OPENED") {
      failWorkingLedger(ERROR.CORRUPT, "concurrent-first-event-not-open");
    }
    if (
      projection.routeHash !== route.routeHash
      || projection.chapterDefinitionHash !== definitionHash
      || opened.initialStateHash !== stateHash
    ) failWorkingLedger(ERROR.HEAD_CONFLICT, "different-concurrent-open");
    return {
      status: "REPLAYED",
      event: structuredClone(concurrent[0]!),
      projection,
    };
  }
}
