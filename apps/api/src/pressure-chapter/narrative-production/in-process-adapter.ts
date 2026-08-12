import {
  validateOpenNovelNarrativeProjectionJobV1,
} from "@ai-story/shared";
import type {
  OpenNovelNarrativeProjectorPortV1,
} from "../narrative";
import type {
  OpenNovelPressureNarrativeRuntimeModuleV1,
} from "./runtime-module";

interface OpenNovelProjectorLikeV1 {
  project(request: {
    job: unknown;
    audienceSafeSource: unknown;
    workerId: string;
  }): Promise<unknown>;
}

/** Defense-in-depth adapter across the API/OpenNovel trust boundary. */
export class InProcessOpenNovelNarrativeProjectorAdapterV1
implements OpenNovelNarrativeProjectorPortV1 {
  constructor(
    private readonly projector: OpenNovelProjectorLikeV1,
    private readonly runtime: Pick<
      OpenNovelPressureNarrativeRuntimeModuleV1,
      "validateNarrativeProjectionJobV1"
      | "validateAudienceSafeNarrativeSourceV1"
    >,
  ) {}

  async project(request: Parameters<OpenNovelNarrativeProjectorPortV1["project"]>[0]) {
    const sharedJob = validateOpenNovelNarrativeProjectionJobV1(request.job);
    const runtimeJob = this.runtime.validateNarrativeProjectionJobV1(
      structuredClone(sharedJob),
    );
    // This exact validator rejects authoritative snapshots, visibility ACLs,
    // seatVariants and every field outside the audience-safe DTO.
    const source = this.runtime.validateAudienceSafeNarrativeSourceV1(
      structuredClone(request.audienceSafeSource),
      runtimeJob,
    );
    return this.projector.project({
      job: runtimeJob,
      audienceSafeSource: source,
      workerId: request.workerId,
    });
  }
}
