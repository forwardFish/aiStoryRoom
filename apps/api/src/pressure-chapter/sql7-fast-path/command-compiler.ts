import { isSha256 } from "@ai-story/shared";
import { withDecisionConvergenceSnapshotHashV1 } from "../decision-automation/convergence.service";
import { withDecisionSubmitSnapshotHashV1 } from "../decision-automation/prisma-snapshot";
import { PressureDecisionCommandCompilerV1 } from "../integration/decision-command.compiler";
import type { PressureSql7CommandCompilerPortV1 } from "./service";

export class PressureSql7CommandCompilerAdapterV1
implements PressureSql7CommandCompilerPortV1 {
  constructor(
    private readonly compiler: Pick<
      PressureDecisionCommandCompilerV1,
      "compileFromCapturedSnapshot"
    >,
    private readonly aiPolicyArtifactHash: string,
  ) {
    if (!isSha256(aiPolicyArtifactHash)) {
      throw new Error("PRESSURE_SQL7_AI_POLICY_ARTIFACT_INVALID");
    }
  }

  compile(input: Parameters<PressureSql7CommandCompilerPortV1["compile"]>[0]) {
    const authority = withDecisionConvergenceSnapshotHashV1({
      schemaVersion: "pressure_decision_convergence_authority_snapshot_v1",
      routeSnapshot: input.snapshot.routeSnapshot,
      chapter: input.snapshot.chapter,
      projection: input.snapshot.workingProjection,
      seatAuthority: input.snapshot.seatAuthority,
      aiPolicyArtifactHash: this.aiPolicyArtifactHash,
      capturedAtMs: input.snapshot.capturedAtMs,
    });
    const snapshot = withDecisionSubmitSnapshotHashV1({
      schemaVersion: "pressure_decision_submit_snapshot_v1",
      authority,
      viewer: {
        roomId: input.roomId,
        runId: input.snapshot.request.runId,
        subjectId: input.principal.subjectId,
        seatId: input.command.seatId,
        humanControllerId: input.principal.subjectId,
      },
    });
    return this.compiler.compileFromCapturedSnapshot({
      access: {
        schemaVersion: "pressure_chapter_http_access_v1",
        roomId: input.roomId,
        runId: input.command.runId,
        subjectId: input.principal.subjectId,
        viewerId: input.principal.viewerId,
      },
      storedRoute: input.snapshot.storedRoute,
      command: input.command,
      nowMs: input.nowMs,
      snapshot,
    });
  }
}
