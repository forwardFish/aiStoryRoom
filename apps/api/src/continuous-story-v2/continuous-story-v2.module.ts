import { Global, Module } from "@nestjs/common";
import { StoryAccessModule } from "../story-access/story-access.module";
import { CreditsModule } from "../credits/credits.module";
import { ContinuousStoryV2Service } from "./continuous-story-v2.service";
import { StoryContextComposerV2 } from "./story-context.composer";
import { StoryNarrativeProvider } from "./story-narrative.provider";

@Global()
@Module({
  imports: [StoryAccessModule, CreditsModule],
  providers: [StoryContextComposerV2, StoryNarrativeProvider, ContinuousStoryV2Service],
  exports: [StoryContextComposerV2, StoryNarrativeProvider, ContinuousStoryV2Service]
})
export class ContinuousStoryV2Module {}
