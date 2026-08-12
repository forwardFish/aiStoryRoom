import type { SeatIdV1 } from "@ai-story/shared";
import type { SangtianAEmotionLifecycleBindingsV1 } from "@ai-story/templates";
import {
  PressurePromiseOperationServiceV1,
  PressureSimplePromiseServiceV1,
  failPressureSimplePromiseV1,
  pressureSimplePromiseIdV1,
  PRESSURE_SIMPLE_PROMISE_ERROR_CODES_V1 as ERROR,
  type AppliedPressurePromiseOperationV1,
  type ApplyPressurePromiseOperationCommandV1,
  type CreatedPressureSimplePromiseV1,
  type CreatePressureSimplePromiseCommandV1,
  type PressureSimplePromiseAccessPortV1,
  type PressureSimplePromiseFormalCommitPortV1,
} from "../a-emotion-promise";
import type { PressureInteractionAccessPort } from "../interaction/contracts";
import type {
  ChapterOrchestratorStatePort,
  WorkingProjectionReaderPort,
} from "../orchestrator/contracts";
import type { PressureChapterRunRouterService } from "../run-router";

const ISSUER: SeatIdV1 = "zhejiang_administration";

/**
 * Resolves every authority fence for Promise commands on the server. HTTP is
 * deliberately unable to assert a Run route, seat, epoch, decision or ledger
 * revision.
 */
export class PressurePromiseProductAccessAdapterV1
implements PressureSimplePromiseAccessPortV1 {
  constructor(private readonly dependencies: Readonly<{
    routes: Pick<PressureChapterRunRouterService, "readStoredRoute">;
    orchestrators: ChapterOrchestratorStatePort;
    interactions: PressureInteractionAccessPort;
    working: WorkingProjectionReaderPort;
    bindings: SangtianAEmotionLifecycleBindingsV1;
  }>) {}

  async load(input: { roomId: string; subjectId: string }) {
    const stored = await this.dependencies.routes.readStoredRoute(input.roomId);
    const state = await this.dependencies.orchestrators.read(input.roomId);
    if (!state || state.phase !== "ACTIVE" || !state.activeDecision) {
      failPressureSimplePromiseV1(ERROR.CONTEXT_MISMATCH, "orchestrator.activeDecision");
    }
    const [access, projection] = await Promise.all([
      this.dependencies.interactions.load({
        runId: input.roomId,
        subjectId: input.subjectId,
        chapterRuntimeId: state.chapterRuntimeId,
      }),
      this.dependencies.working.load({
        runId: input.roomId,
        chapterRuntimeId: state.chapterRuntimeId,
      }),
    ]);
    if (
      stored.snapshot.runId !== input.roomId
      || state.routeHash !== stored.snapshot.routeHash
      || access.routeHash !== stored.snapshot.routeHash
      || access.chapterRuntimeId !== state.chapterRuntimeId
      || access.chapterId !== state.currentChapterId
      || access.activeDecisionPointId !== state.activeDecision.decisionPointId
      || projection.nextDecisionPin?.decisionPointId !== state.activeDecision.decisionPointId
      || access.workingRevision !== projection.state.revision
      || !access.controlledSeatIds.includes(ISSUER)
    ) {
      failPressureSimplePromiseV1(ERROR.CONTEXT_MISMATCH, "authority.snapshot");
    }
    const controlEpoch = access.controlEpochBySeat[ISSUER];
    if (!Number.isSafeInteger(controlEpoch) || Number(controlEpoch) < 0) {
      failPressureSimplePromiseV1(ERROR.ROLE_FORBIDDEN, "authority.issuerSeat");
    }
    const commitmentActions = [
      ...(projection.commitmentActionsByIdempotencyKey?.values() ?? []),
    ].map((entry) => entry.action);
    const actionOrdinals = [
      ...[...projection.acceptedActions.values()].map((entry) => entry.action),
      ...commitmentActions,
    ].filter((action) =>
      action.seatId === ISSUER
      && action.decisionPointId === state.activeDecision!.decisionPointId,
    ).map((action) => action.actionOrdinal);
    const issuerCommitments = [...projection.commitments.values()]
      .filter((commitment) => commitment.seatIds.includes(ISSUER));
    const expectedPromiseId = pressureSimplePromiseIdV1({
      runId: input.roomId,
      issuerSeatId: ISSUER,
    });
    const current = projection.commitments.get(expectedPromiseId);
    const promiseBindings = this.dependencies.bindings.formalPromise;
    return {
      routeSnapshot: structuredClone(stored.snapshot),
      runId: input.roomId,
      chapterRuntimeId: state.chapterRuntimeId,
      chapterId: state.currentChapterId,
      decisionPointId: state.activeDecision.decisionPointId,
      issuerSeatId: ISSUER,
      controlEpoch: Number(controlEpoch),
      expectedWorkingRevision: projection.state.revision,
      nextActionOrdinal: Math.max(0, ...actionOrdinals) + 1,
      allowedPromiseCodes: [...promiseBindings.promiseCodes],
      interactableSeatIds: [...access.interactableSeatIds],
      existingIssuerPromiseIds: issuerCommitments.map((entry) => entry.commitmentId),
      currentPromiseOperation: current?.operation,
      priorCommitmentActionsByIdempotencyKey: new Map(
        [...(projection.commitmentActionsByIdempotencyKey?.entries() ?? [])]
          .map(([key, entry]) => [key, structuredClone(entry.action)]),
      ),
      allowedPromiseOperationCodes: promiseBindings.deliverOriginalLedgerOperations
        .map((entry) => entry.operationCode),
    };
  }
}

export class PressurePromiseProductFacadeV1 {
  private readonly createService: PressureSimplePromiseServiceV1;
  private readonly operationService: PressurePromiseOperationServiceV1;

  constructor(
    access: PressureSimplePromiseAccessPortV1,
    formal: PressureSimplePromiseFormalCommitPortV1,
  ) {
    this.createService = new PressureSimplePromiseServiceV1(access, formal);
    this.operationService = new PressurePromiseOperationServiceV1(access, formal);
  }

  create(command: CreatePressureSimplePromiseCommandV1): Promise<CreatedPressureSimplePromiseV1> {
    return this.createService.create(command);
  }

  apply(command: ApplyPressurePromiseOperationCommandV1): Promise<AppliedPressurePromiseOperationV1> {
    return this.operationService.apply(command);
  }
}
