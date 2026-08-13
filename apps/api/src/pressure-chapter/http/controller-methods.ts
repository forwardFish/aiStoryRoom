import { Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "../../auth/current-user.decorator";
import type { LegacyPressureSlotEndpointV1 } from "./contracts";
import { PressureChapterHttpFacade } from "./pressure-chapter-http.facade";

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

  /** GET /v4/rooms/:roomId/result */
  result(user: Pick<AuthenticatedUser, "id">, roomId: string) {
    return this.pressure.getResult(toPrincipal(user), roomId);
  }

  /** POST /v4/rooms/:roomId/game/action */
  action(
    user: Pick<AuthenticatedUser, "id">,
    roomId: string,
    body: unknown,
  ) {
    if (isDeliveryMarkCommand(body)) {
      return this.pressure.markFeedDelivery(toPrincipal(user), roomId, body);
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

function isDeliveryMarkCommand(value: unknown): boolean {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as { commandType?: unknown }).commandType === "DELIVERY_MARK";
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
