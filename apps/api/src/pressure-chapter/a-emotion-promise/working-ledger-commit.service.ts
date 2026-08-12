import {
  sha256Canonical,
  validateDecisionActionV1,
  validateRunRouteSnapshotV1,
  type DecisionActionV1,
  type SeatIdV1,
} from "@ai-story/shared";
import type {
  FormalCommitmentAppliedPayloadV1,
  WorkingLedgerPort,
} from "../working-ledger/contracts";
import {
  buildWorkingLedgerEvents,
  projectWorkingLedger,
} from "../working-ledger/working-ledger";
import type { PressureSimplePromiseFormalCommitPortV1 } from "./contracts";
import {
  PRESSURE_SIMPLE_PROMISE_ERROR_CODES_V1 as ERROR,
  failPressureSimplePromiseV1,
} from "./errors";

export function computePressureFormalCommitmentFingerprintV1(input: {
  routeHash: string;
  action: DecisionActionV1;
  mutation: FormalCommitmentAppliedPayloadV1["mutation"];
  audienceSeatIds: SeatIdV1[];
}): string {
  return sha256Canonical({
    commandType: "APPLY_PRESSURE_FORMAL_COMMITMENT_V1",
    routeHash: input.routeHash,
    actionRequestFingerprint: input.action.requestFingerprint,
    sealedActionHash: input.action.sealedHash,
    mutation: input.mutation,
    audienceSeatIds: input.audienceSeatIds,
  });
}

/** CAS-backed adapter over the existing Working Ledger event stream. */
export class PressureWorkingLedgerFormalCommitmentServiceV1
implements PressureSimplePromiseFormalCommitPortV1 {
  constructor(private readonly ledger: WorkingLedgerPort) {}

  async submit(command: Parameters<PressureSimplePromiseFormalCommitPortV1["submit"]>[0]) {
    const route = validateRunRouteSnapshotV1(command.routeSnapshot);
    const action = validateDecisionActionV1(command.action);
    const key = { runId: action.runId, chapterRuntimeId: action.chapterRuntimeId };
    if (
      route.runId !== action.runId
      || command.mutation.sourceActionId !== action.actionId
      || command.inputFingerprint !== computePressureFormalCommitmentFingerprintV1({
        routeHash: route.routeHash,
        action,
        mutation: command.mutation,
        audienceSeatIds: command.audienceSeatIds,
      })
    ) failPressureSimplePromiseV1(ERROR.CONTEXT_MISMATCH, "command");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const events = await this.ledger.read(key);
      const projection = projectWorkingLedger(events);
      if (projection.routeHash !== route.routeHash) {
        failPressureSimplePromiseV1(ERROR.CONTEXT_MISMATCH, "workingLedger.routeHash");
      }
      if (projection.chapterId !== action.chapterId) {
        failPressureSimplePromiseV1(ERROR.CONTEXT_MISMATCH, "workingLedger.chapterId");
      }
      if (projection.state.revision !== action.expectedWorkingRevision) {
        failPressureSimplePromiseV1(ERROR.CONTEXT_MISMATCH, "workingLedger.revision");
      }
      if (projection.nextDecisionPin?.decisionPointId !== action.decisionPointId) {
        failPressureSimplePromiseV1(ERROR.CONTEXT_MISMATCH, "workingLedger.decisionPointId");
      }
      const commitmentActions = projection.commitmentActionsByIdempotencyKey ?? new Map();
      const replay = commitmentActions.get(action.idempotencyKey);
      if (replay) {
        if (
          replay.inputFingerprint !== command.inputFingerprint
          || replay.action.sealedHash !== action.sealedHash
          || sha256Canonical(replay.mutation) !== sha256Canonical(command.mutation)
        ) failPressureSimplePromiseV1(ERROR.IDEMPOTENCY_MISMATCH, "action.idempotencyKey");
        const event = events.find((candidate) => candidate.eventHash === replay.eventHash);
        if (!event) failPressureSimplePromiseV1(ERROR.CONTEXT_MISMATCH, "replay.event");
        return { status: "REPLAYED" as const, event };
      }
      if (
        command.mutation.operation === "CREATE"
        && [...commitmentActions.values()].some(
          (entry) => entry.mutation.commitmentId === command.mutation.commitmentId,
        )
      ) failPressureSimplePromiseV1(ERROR.SLOT_EXHAUSTED, "mutation.commitmentId");
      const currentCommitment = projection.commitments.get(command.mutation.commitmentId);
      if (
        command.mutation.operation !== "CREATE"
        && currentCommitment?.operation !== "CREATE"
      ) failPressureSimplePromiseV1(ERROR.CONTEXT_MISMATCH, "mutation.lifecycle");
      const payload: FormalCommitmentAppliedPayloadV1 = {
        eventType: "FORMAL_COMMITMENT_APPLIED",
        routeHash: route.routeHash,
        inputFingerprint: command.inputFingerprint,
        action,
        mutation: structuredClone(command.mutation),
        audienceSeatIds: [...command.audienceSeatIds],
      };
      const [event] = buildWorkingLedgerEvents({
        key,
        chapterId: action.chapterId,
        previousEvents: events,
        payloads: [payload],
      });
      const appended = await this.ledger.append({
        key,
        expectedHeadHash: projection.headHash,
        events: [event!],
      });
      if (appended.status === "APPENDED") {
        return { status: "ACCEPTED" as const, event: event! };
      }
    }
    failPressureSimplePromiseV1(ERROR.CONTEXT_MISMATCH, "workingLedger.cas");
  }
}
