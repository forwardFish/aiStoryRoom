import { Inject, Injectable } from "@nestjs/common";
import type { GenerateStoryPipelineInputV2 } from "./story-generation.pipeline";
import { StoryNarrativeProvider } from "./story-narrative.provider";

/** Preserves continuous_story_v2 exactly while the new engine uses a role runtime. */
@Injectable()
export class StructuredStoryNarrativeAdapter {
  readonly kind = "STRUCTURED_STORY_V2" as const;

  constructor(@Inject(StoryNarrativeProvider) private readonly provider: StoryNarrativeProvider) {}

  resolveContext(input: GenerateStoryPipelineInputV2 & { contextRecordId: string }) {
    return this.provider.resolveContext(input);
  }
}
