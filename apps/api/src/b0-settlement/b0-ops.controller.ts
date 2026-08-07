import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AdminGuard } from "../auth/admin.guard";
import { AuthGuard } from "../auth/auth.guard";
import { B0SettlementPipelineService } from "./b0-settlement-pipeline.service";

@UseGuards(AuthGuard, AdminGuard)
@Controller("v4/admin/b0")
export class B0OpsController {
  constructor(@Inject(B0SettlementPipelineService) private readonly pipeline: B0SettlementPipelineService) {}

  @Get("runs/:runId/diagnostics")
  diagnostics(@Param("runId") runId: string) {
    return this.pipeline.diagnostics(runId);
  }

  @Post("recover")
  recover() {
    return this.pipeline.recover();
  }

  @Get("windows/:windowId/replay")
  replay(@Param("windowId") windowId: string) {
    return this.pipeline.replayWindow(windowId);
  }

  @Post("tasks/:taskId/retry")
  retry(@Param("taskId") taskId: string) {
    return this.pipeline.retryTask(taskId);
  }

  @Post("runs/:runId/pause")
  pause(@Param("runId") runId: string, @Body() body: unknown) {
    const paused = Boolean(body && typeof body === "object" && (body as { paused?: unknown }).paused === true);
    return this.pipeline.pauseRun(runId, paused);
  }

  @Post("windows/:windowId/abort")
  abort(@Param("windowId") windowId: string) {
    return this.pipeline.abortWindow(windowId);
  }
}
