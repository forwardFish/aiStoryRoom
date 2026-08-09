import { Body, Controller, Get, Inject, Param, Post, Res, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../auth/current-user.decorator";
import { OpenNovelAdapterService } from "./openovel-adapter.service";
import type { OpenNovelTurnEvent } from "./openovel-runtime.client";
import { stripPrivateSoloEndingEvidenceFromEvent } from "./solo-ending-result";

@UseGuards(AuthGuard)
@Controller("v4/openovel")
export class OpenNovelAdapterController {
  constructor(@Inject(OpenNovelAdapterService) private readonly adapter: OpenNovelAdapterService) {}

  @Post("runs")
  createRun(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { idempotencyKey?: string },
  ) {
    return this.adapter.createRun(user, body);
  }

  @Get("runs/:runId")
  getRun(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
  ) {
    return this.adapter.getRun(user, runId);
  }

  @Post("runs/:runId/actions")
  async submitAction(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
    @Body() body: {
      action?: string;
      idempotencyKey?: string;
      boundOption?: { id?: string; label?: string } | null;
    },
    @Res() response: any,
  ) {
    response.status(200);
    response.setHeader("content-type", "text/event-stream; charset=utf-8");
    response.setHeader("cache-control", "no-store, no-transform");
    response.setHeader("x-accel-buffering", "no");
    response.flushHeaders?.();
    try {
      await this.adapter.submitAction(user, runId, body, async (event) => {
        writeSse(response, stripPrivateSoloEndingEvidenceFromEvent(event));
      });
    } catch (error) {
      writeSse(response, {
        type: "runtime.warning",
        data: {
          code: exceptionCode(error),
          message: exceptionMessage(error),
          severity: "HIGH",
          blocksPlayer: false,
        },
      });
    } finally {
      response.end();
    }
  }
}

function writeSse(response: any, event: OpenNovelTurnEvent) {
  if (response.writableEnded || response.destroyed) return;
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event.data)}\n\n`);
}

function exceptionCode(error: unknown) {
  const response = typeof (error as any)?.getResponse === "function" ? (error as any).getResponse() : null;
  return String(response?.code || (error as any)?.code || "OPENOVEL_ACTION_FAILED");
}

function exceptionMessage(error: unknown) {
  const response = typeof (error as any)?.getResponse === "function" ? (error as any).getResponse() : null;
  return String(response?.message || (error as Error)?.message || "The story could not continue.");
}
