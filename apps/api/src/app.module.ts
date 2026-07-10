import { Module } from "@nestjs/common";
import { MvpCatalogController } from "./mvp-catalog.controller";
import { StoryController } from "./story.controller";
import { PrismaService } from "./prisma.service";
import { StoryService } from "./story.service";

@Module({
  controllers: [MvpCatalogController, StoryController],
  providers: [PrismaService, StoryService]
})
export class AppModule {}
