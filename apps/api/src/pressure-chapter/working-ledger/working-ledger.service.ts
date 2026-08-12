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

export class WorkingLedgerService {
  constructor(private readonly ledgerPort: WorkingLedgerPort) {}

  async open(command: OpenWorkingLedgerCommandV1): Promise<{
    status: "OPENED" | "REPLAYED";
    event: WorkingLedgerEventV1;
  }> {
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
    const existing = await this.ledgerPort.read(key);
    const definitionHash = sha256Canonical(definition);
    const stateHash = workingStateHash(state);
    if (existing.length) {
      const projection = projectWorkingLedger(existing);
      const opened = existing[0]!.payload;
      if (opened.eventType !== "WORKING_LEDGER_OPENED") {
        failWorkingLedger(ERROR.CORRUPT, "first-event-not-open");
      }
      if (
        projection.routeHash !== route.routeHash
        || projection.chapterDefinitionHash !== definitionHash
        || opened.initialStateHash !== stateHash
      ) failWorkingLedger(ERROR.ALREADY_OPEN, "different-input");
      return { status: "REPLAYED", event: structuredClone(existing[0]!) };
    }
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
    const appended = await this.ledgerPort.append({
      key,
      expectedHeadHash: null,
      events: [event!],
    });
    if (appended.status === "APPENDED") return { status: "OPENED", event: event! };
    const concurrent = await this.ledgerPort.read(key);
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
    return { status: "REPLAYED", event: structuredClone(concurrent[0]!) };
  }
}
