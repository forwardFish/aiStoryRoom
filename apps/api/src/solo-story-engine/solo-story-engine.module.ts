import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma.module";
import { CreditsModule } from "../credits/credits.module";
import { SoloStoryEngineService } from "./solo-story-engine.service";

@Module({
  imports: [PrismaModule, CreditsModule],
  providers: [SoloStoryEngineService],
  exports: [SoloStoryEngineService]
})
export class SoloStoryEngineModule {}
