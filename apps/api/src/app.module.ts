import { Module } from "@nestjs/common";
import { StoryController } from "./story.controller";
import { PrismaService } from "./prisma.service";
import { StoryService } from "./story.service";

@Module({
  controllers: [StoryController],
  providers: [PrismaService, StoryService]
})
export class AppModule {}
