import type { SangtianPressureResultEnvelopeV1 } from "@ai-story/shared";
import { PressureReplayPolicyEvaluatorV1 } from "../replay/replay-policy";
import { SangtianPressureResultV1Adapter } from "./adapter";
import { PressureResultAudienceProjectorV1 } from "./audience-projector";
import {
  PRESSURE_RESULT_READ_ERROR_CODES as ERROR,
  failPressureResultRead,
} from "./errors";
import {
  toReplayPolicySourceV1,
  validatePressureResultReadModelSourceV1,
  validateResultViewerContextV1,
  type PressureResultReadModelReaderPort,
  type ResultViewerAuthorizerPort,
} from "./ports";
import { ResultContractRegistryV1 } from "./registry";

export interface PressureResultQueryV1 {
  runId: string;
  viewerId: string;
}

/**
 * Pure Result read-side orchestration. Its constructor accepts read and policy
 * ports only: no Settlement, Finale, Provider, Repository writer or clock.
 */
export class PressureResultQueryServiceV1 {
  constructor(
    private readonly resultReader: PressureResultReadModelReaderPort,
    private readonly viewerAuthorizer: ResultViewerAuthorizerPort,
    private readonly replayPolicy: PressureReplayPolicyEvaluatorV1,
    private readonly registry = new ResultContractRegistryV1(),
    private readonly audience = new PressureResultAudienceProjectorV1(),
    private readonly adapter = new SangtianPressureResultV1Adapter(),
  ) {}

  async getResult(
    query: Readonly<PressureResultQueryV1>,
  ): Promise<SangtianPressureResultEnvelopeV1> {
    const runId = required(query.runId, "query.runId");
    const viewerId = required(query.viewerId, "query.viewerId");

    const rawViewer = await this.viewerAuthorizer.readViewerContext(runId, viewerId);
    if (rawViewer === null) {
      failPressureResultRead(ERROR.RESULT_ACCESS_DENIED, "query.viewerId");
    }
    const viewer = validateResultViewerContextV1(rawViewer, runId, viewerId);

    const rawSource = await this.resultReader.readFinalized(runId);
    if (rawSource === null) {
      failPressureResultRead(ERROR.RESULT_NOT_READY, "query.runId");
    }
    const source = validatePressureResultReadModelSourceV1(rawSource, runId);
    // Security order is intentional: six-seat authority is reduced before the
    // Adapter or any presentation consumer sees it.
    const projection = this.audience.project(source, viewer);
    const binding = this.registry.resolvePressure(projection.envelopeMetadata);
    const replayActions = await this.replayPolicy.listActions(
      toReplayPolicySourceV1(source.authority),
      viewer,
    );
    return this.adapter.assemble({ projection, replayActions, binding });
  }
}

function required(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    failPressureResultRead(ERROR.RESULT_STORED_RECORD_INVALID, path, "NON_EMPTY_STRING");
  }
  return value;
}
