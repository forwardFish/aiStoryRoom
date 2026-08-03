import { Inject, Injectable } from "@nestjs/common";
import { CONTINUOUS_OPENOVEL_ENGINE_VERSION } from "@ai-story/shared";
import { StructuredStoryNarrativeAdapter } from "../continuous-story-v2/structured-story-narrative.adapter";
import { isContinuousOpenNovelEnabledForRun } from "./continuous-openovel.config";
import { OpenNovelRoleNarrativeAdapter } from "./openovel-role-runtime.adapter";

@Injectable()
export class NarrativeAdapterSelector {
  constructor(
    @Inject(StructuredStoryNarrativeAdapter) readonly structured: StructuredStoryNarrativeAdapter,
    @Inject(OpenNovelRoleNarrativeAdapter) readonly openNovel: OpenNovelRoleNarrativeAdapter
  ) {}

  isOpenNovel(input: { id: string; engineVersion: string }) {
    return isContinuousOpenNovelEnabledForRun(input);
  }

  select(input: { id: string; engineVersion: string }) {
    if (input.engineVersion === CONTINUOUS_OPENOVEL_ENGINE_VERSION) {
      if (!this.isOpenNovel(input)) throw new Error("CONTINUOUS_OPENOVEL_V1_DISABLED");
      return { kind: "OPENOVEL_ROLE_V1" as const, runtime: this.openNovel };
    }
    return { kind: "STRUCTURED_STORY_V2" as const, runtime: this.structured };
  }
}
