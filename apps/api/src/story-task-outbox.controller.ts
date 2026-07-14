import { Controller, Get, Inject } from "@nestjs/common";
import { StoryTaskOutboxService } from "./story-task-outbox.service";

/** Readiness-safe worker observability: no prompts, actions, or player data. */
@Controller("health")
export class StoryTaskOutboxController {
  constructor(@Inject(StoryTaskOutboxService) private readonly outbox: StoryTaskOutboxService) {}

  @Get("worker")
  workerHealth() {
    return this.outbox.health();
  }
}
