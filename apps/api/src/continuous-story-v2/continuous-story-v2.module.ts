import { Global, Module } from "@nestjs/common";
import { StoryAccessModule } from "../story-access/story-access.module";
import { CreditsModule } from "../credits/credits.module";
import { ContinuousStoryV2Service } from "./continuous-story-v2.service";
import { AEmotionM1Service } from "./a-emotion-m1.service";
import { AEmotionM2Service } from "./a-emotion-m2.service";
import { AEmotionM3Service } from "./a-emotion-m3.service";
import { AEmotionM4Service } from "./a-emotion-m4.service";
import { AEmotionM5Service } from "./a-emotion-m5.service";
import { AEmotionM6Service } from "./a-emotion-m6.service";
import { AEmotionKeyModalService } from "./a-emotion-key-modal.service";
import { StoryContextComposerV2 } from "./story-context.composer";
import { StoryNarrativeProvider } from "./story-narrative.provider";

@Global()
@Module({
  imports: [StoryAccessModule, CreditsModule],
  providers: [StoryContextComposerV2, StoryNarrativeProvider, AEmotionM1Service, AEmotionM2Service, AEmotionM3Service, AEmotionM4Service, AEmotionM5Service, AEmotionM6Service, AEmotionKeyModalService, ContinuousStoryV2Service],
  exports: [StoryContextComposerV2, StoryNarrativeProvider, AEmotionM1Service, AEmotionM2Service, AEmotionM3Service, AEmotionM4Service, AEmotionM5Service, AEmotionM6Service, AEmotionKeyModalService, ContinuousStoryV2Service]
})
export class ContinuousStoryV2Module {}
