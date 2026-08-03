import { Global, Module } from "@nestjs/common";
import { StoryAccessModule } from "../story-access/story-access.module";
import { CreditsModule } from "../credits/credits.module";
import { ContinuousStoryV2Service } from "./continuous-story-v2.service";
import { StoryContextComposerV2 } from "./story-context.composer";
import { StoryNarrativeProvider } from "./story-narrative.provider";
import { ContinuousOpenNovelModule } from "../continuous-openovel/continuous-openovel.module";
import { NarrativeAdapterSelector } from "../continuous-openovel/narrative-adapter.selector";
import { StructuredStoryNarrativeAdapter } from "./structured-story-narrative.adapter";

@Global()
@Module({
  imports: [StoryAccessModule, CreditsModule, ContinuousOpenNovelModule],
  providers: [StoryContextComposerV2, StoryNarrativeProvider, StructuredStoryNarrativeAdapter, NarrativeAdapterSelector, ContinuousStoryV2Service],
  exports: [StoryContextComposerV2, StoryNarrativeProvider, StructuredStoryNarrativeAdapter, NarrativeAdapterSelector, ContinuousStoryV2Service]
})
export class ContinuousStoryV2Module {}
