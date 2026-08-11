import { BadRequestException, HttpException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import {
  ManeuverDomainErrorV1,
  ManeuverEngineV1,
  ManeuverPreviewTokenCodecV1,
  type AuthoritativeManeuverContextV1,
} from "./maneuver-v1.core";
import { ManeuverV1PrismaStore } from "./maneuver-v1.prisma-store";

@Injectable()
export class ManeuverV1Service {
  private engineInstance: ManeuverEngineV1 | null = null;

  constructor(@Inject(ManeuverV1PrismaStore) private readonly store: ManeuverV1PrismaStore) {}

  private engine(): ManeuverEngineV1 {
    if (this.engineInstance) return this.engineInstance;
    const secret = previewSecret();
    const ttlSeconds = boundedInteger(process.env.MANEUVER_PREVIEW_TTL_SECONDS, 300, 30, 900);
    this.engineInstance = new ManeuverEngineV1(
      this.store,
      new ManeuverPreviewTokenCodecV1(secret),
      () => new Date(),
      ttlSeconds * 1000,
    );
    return this.engineInstance;
  }

  async projection(user: AuthenticatedUser, runId: string) {
    try {
      return await this.store.readProjection(user.id, runId);
    } catch (error) {
      throw httpError(error);
    }
  }

  async preview(user: AuthenticatedUser, runId: string, body: unknown) {
    try {
      const input = object(body);
      return await this.engine().preview(user.id, runId, {
        draft: input.draft,
        expectedStateRevision: input.expectedStateRevision,
      });
    } catch (error) {
      throw httpError(error);
    }
  }

  async previewWithContext(
    user: AuthenticatedUser,
    runId: string,
    body: unknown,
    context: AuthoritativeManeuverContextV1,
  ) {
    try {
      const input = object(body);
      return await this.engine().previewWithContext(user.id, runId, {
        draft: input.draft,
        expectedStateRevision: input.expectedStateRevision,
      }, context);
    } catch (error) {
      throw httpError(error);
    }
  }

  async commit(user: AuthenticatedUser, runId: string, body: unknown) {
    try {
      return await this.engine().commit(user.id, runId, body);
    } catch (error) {
      throw httpError(error);
    }
  }
}

function previewSecret(): string {
  const configured = String(process.env.MANEUVER_PREVIEW_SECRET || "").trim();
  if (configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new ServiceUnavailableException({
      code: "MANEUVER_PREVIEW_SECRET_REQUIRED",
      message: "Maneuver previews are not configured.",
    });
  }
  return "local-maneuver-preview-secret-change-before-production";
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException({ code: "MANEUVER_DRAFT_INVALID", message: "The maneuver request is invalid." });
  }
  return value as Record<string, unknown>;
}

function httpError(error: unknown): Error {
  if (error instanceof HttpException) return error;
  if (error instanceof ManeuverDomainErrorV1) {
    return new HttpException({
      code: error.code,
      message: playerMessage(error.code, error.message),
      recoverable: error.recoverable,
    }, error.httpStatus);
  }
  const message = String(error instanceof Error ? error.message : error || "");
  if (/^(MANEUVER|PRIVATE_EVIDENCE)_[A-Z0-9_]+:/.test(message)) {
    return new BadRequestException({
      code: message.split(":", 1)[0],
      message: "The maneuver request is incomplete or invalid.",
      recoverable: true,
    });
  }
  return error instanceof Error ? error : new Error(message || "Unknown maneuver error");
}

function playerMessage(code: string, fallback: string): string {
  const messages: Record<string, string> = {
    MANEUVER_WINDOW_CLOSED: "The main decision is already being committed. This maneuver was not submitted.",
    MANEUVER_LIMIT_REACHED: "No maneuver opportunities remain in this turn.",
    PREVIEW_EXPIRED: "This preview expired. Preview the maneuver again.",
    PREVIEW_STALE: "The situation changed. Refresh and preview the maneuver again.",
    PREVIEW_TAMPERED: "This preview could not be verified. Preview the maneuver again.",
    REVISION_CONFLICT: "The situation changed. Refresh before continuing.",
    TARGET_UNAVAILABLE: "That target is no longer available.",
    TRACE_UNAVAILABLE: "That trace or route is no longer available.",
    LEVERAGE_UNAVAILABLE: "That leverage is not available to this role.",
    ACTION_NEEDS_CLARIFICATION: "Choose one target and one main action before previewing.",
    ACTION_NOT_ALLOWED: "This role cannot submit that maneuver.",
    IDEMPOTENCY_KEY_REUSED: "This confirmation key was already used for another request.",
    PRIVATE_EVIDENCE_CONFLICT: "This evidence is already bound to another role scope.",
  };
  return messages[code] || fallback;
}
