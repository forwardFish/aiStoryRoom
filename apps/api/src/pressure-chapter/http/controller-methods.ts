import { Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "../../auth/current-user.decorator";
import type { LegacyPressureSlotEndpointV1 } from "./contracts";
import { PressureChapterHttpFacade } from "./pressure-chapter-http.facade";
import {
  isPressureChapterSummaryConfirmationCommandV2,
  normalizePressureChapterSummaryConfirmationCommandV2,
  type PressureChapterSummaryConfirmationCommandV2,
} from "../chapter-summary-gate/production";
import { assertPressureChapterSummaryConfirmationAuthorityV2 } from "../chapter-summary-gate/confirmation-authority";

/**
 * Injectable delegate for the existing RoomsController.
 *
 * It deliberately has no Controller decorator: registering a second
 * /v4/rooms/:roomId/result route would make Nest dispatch order ambiguous.
 */
@Injectable()
export class PressureChapterHttpControllerMethods {
  constructor(
    @Inject(PressureChapterHttpFacade)
    private readonly pressure: PressureChapterHttpFacade,
    private readonly chapterSummaryCommandHandler?: {
      handle(input: PressureChapterSummaryConfirmationCommandV2): Promise<unknown>;
    },
  ) {}

  /** GET /v4/rooms/:roomId/game */
  game(
    user: Pick<AuthenticatedUser, "id">,
    roomId: string,
    feedCursor?: string,
    feedLimit?: string | number,
  ) {
    return this.pressure.getGame(toPrincipal(user), roomId, {
      ...(feedCursor === undefined ? {} : { feedCursor }),
      ...(feedLimit === undefined ? {} : { feedLimit: parseLimit(feedLimit) }),
    });
  }

  /** GET /v4/rooms/:roomId/game/narrative-update */
  narrativeUpdate(
    user: Pick<AuthenticatedUser, "id">,
    roomId: string,
    chapterRuntimeId: string,
    updateKey?: string,
  ) {
    return this.pressure.getNarrativeUpdate(
      toPrincipal(user),
      roomId,
      chapterRuntimeId,
      updateKey,
    );
  }

  /** GET /v4/rooms/:roomId/result */
  result(user: Pick<AuthenticatedUser, "id">, roomId: string) {
    return this.pressure.getResult(toPrincipal(user), roomId);
  }

  /** POST /v4/rooms/:roomId/game/action */
  async action(
    user: Pick<AuthenticatedUser, "id">,
    roomId: string,
    body: unknown,
  ) {
    if (isPressureChapterSummaryConfirmationCommandV2(body)) {
      if (!this.chapterSummaryCommandHandler) {
        throw new Error("PRESSURE_CHAPTER_SUMMARY_COMMAND_HANDLER_MISSING");
      }
      const command = normalizePressureChapterSummaryConfirmationCommandV2(body);
      const projection = await this.pressure.getGame(toPrincipal(user), roomId);
      assertPressureChapterSummaryConfirmationAuthorityV2(roomId, command, projection);
      return await this.chapterSummaryCommandHandler.handle(command) as never;
    }

    return this.pressure.submitDecision(toPrincipal(user), roomId, body);
  }

  /** POST /v4/rooms/:roomId/game/chat */
  chat(
    user: Pick<AuthenticatedUser, "id">,
    roomId: string,
    body: unknown,
  ) {
    return this.pressure.submitChat(toPrincipal(user), roomId, body);
  }

  /** POST /v4/rooms/:roomId/replay */
  replay(
    user: Pick<AuthenticatedUser, "id">,
    roomId: string,
    body: unknown,
  ) {
    return this.pressure.replay(toPrincipal(user), roomId, body);
  }

  /**
   * Guard called by legacy actions/main, actions/maneuver and event reaction
   * branches after the existing RoomsService identifies a Pressure stored run.
   */
  legacySlot(
    user: Pick<AuthenticatedUser, "id">,
    roomId: string,
    endpoint: LegacyPressureSlotEndpointV1,
  ) {
    return this.pressure.rejectLegacySlotEndpoint(
      toPrincipal(user),
      roomId,
      endpoint,
    );
  }
}

export function toPressureChapterHttpPrincipal(
  user: Pick<AuthenticatedUser, "id">,
) {
  return toPrincipal(user);
}

function toPrincipal(user: Pick<AuthenticatedUser, "id">) {
  return {
    subjectId: user.id,
    viewerId: user.id,
  };
}

function parseLimit(value: string | number): number {
  if (typeof value === "number") return value;
  if (!/^[0-9]+$/.test(value)) return Number.NaN;
  return Number(value);
}
