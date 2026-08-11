import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { PrismaService } from "../prisma.service";
import {
  ManeuverDomainErrorV1,
  ManeuverPreviewTokenCodecV1,
  type ManeuverPreviewTokenPayloadV1,
} from "../maneuver-v1/maneuver-v1.core";
import {
  readB0ManeuverContextV1,
  selectCurrentB0WindowV1,
  type B0AuthoritativeManeuverContextV1,
} from "../maneuver-v1/maneuver-v1.prisma-read";
import { ManeuverV1Service } from "../maneuver-v1/maneuver-v1.service";
import {
  buildB0PublicationPlanV1,
  type B0PublicationDeliveryV1,
} from "@ai-story/templates";
import type {
  B0ActionContractV1,
  B0SettlementResolutionV1,
  B0SettlementSnapshotV1,
} from "@ai-story/shared";
import {
  assertB0StoredIntentEnvelopeV1,
  type B0WindowProjectionV1,
} from "./b0-window-coordinator.core";
import { B0WindowCoordinatorService } from "./b0-window-coordinator.prisma";
import {
  B0PlayerWindowErrorV1,
  mapManeuverPreviewToB0ActionV1,
  normalizeB0PlayerPlanPresentationV1,
  projectB0PlayerWindowV1,
  type B0PlayerNarrativeProjectionV1,
  type B0PlayerPlanPresentationV1,
  type B0PlayerWindowProjectionV1,
} from "./b0-window-player.core";

const ACTIVE_WINDOW_STATUSES = [
  "OPEN", "LOCKED", "SETTLING", "COMMITTED", "PUBLISHING", "COMPLETED", "FAILED_RETRYABLE", "FAILED_HARD",
] as const;

type WindowRow = Awaited<ReturnType<B0WindowPlayerService["findCurrentWindow"]>>;

@Injectable()
export class B0WindowPlayerService {
  private tokenCodecInstance: ManeuverPreviewTokenCodecV1 | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(B0WindowCoordinatorService) private readonly coordinator: B0WindowCoordinatorService,
    @Inject(ManeuverV1Service) private readonly maneuvers: ManeuverV1Service,
  ) {}

  async projection(user: AuthenticatedUser, runId: string): Promise<B0PlayerWindowProjectionV1> {
    try {
      const context = await this.requiredB0Context(user.id, runId);
      const window = await this.findCurrentWindow(runId, context.b0WindowId);
      return await this.buildProjection(window, context.roleId);
    } catch (error) {
      throw playerHttpError(error);
    }
  }

  async preview(user: AuthenticatedUser, runId: string, body: unknown) {
    try {
      const request = exactObject(body, ["draft", "expectedStateRevision", "expectedRevision", "clientRequestId"], "preview");
      const expectedRevision = revision(request.expectedRevision, "expectedRevision");
      const clientRequestId = identifier(request.clientRequestId, "clientRequestId");
      const context = await this.requiredB0Context(user.id, runId);
      const window = await this.findCurrentWindow(runId, context.b0WindowId);
      const currentProjection = await this.coordinator.projection(window.id, context.roleId);
      if (currentProjection.actorReady) {
        throw domain("READY_STATE_LOCKS_DRAFT", "Cancel ready before editing this plan.");
      }
      if (currentProjection.window.status !== "OPEN") {
        throw domain("WINDOW_NOT_OPEN", `The settlement window is ${currentProjection.window.status}.`);
      }
      const preview = await this.maneuvers.previewWithContext(user, runId, {
        draft: request.draft,
        expectedStateRevision: request.expectedStateRevision,
      }, context);
      if (preview.decision !== "READY" || !preview.previewToken || !preview.presentation) {
        return {
          ...preview,
          window: await this.buildProjection(window, context.roleId),
        };
      }
      const payload = this.tokens().verify(preview.previewToken);
      assertPreviewOwnership(payload, user.id, context);
      const candidate = mapManeuverPreviewToB0ActionV1({
        payload,
        window: currentProjection.window,
        compilerContext: context.compilerContext,
        clientRequestId,
        now: new Date().toISOString(),
      });
      const presentation = normalizeB0PlayerPlanPresentationV1(preview.presentation);
      const saved = await this.coordinator.saveDraft({
        windowId: window.id,
        actorId: context.roleId,
        controlEpoch: context.controlEpoch,
        expectedRevision,
        candidate,
        now: new Date().toISOString(),
      });
      await this.persistPresentation(runId, window.nodeId, context.roleId, presentation);
      return {
        ...preview,
        b0PlanRevision: saved.envelope.latestRevision,
        replayed: saved.replayed,
        window: await this.buildProjection(await this.findCurrentWindow(runId), context.roleId),
      };
    } catch (error) {
      throw playerHttpError(error);
    }
  }

  async confirm(user: AuthenticatedUser, runId: string, body: unknown): Promise<B0PlayerWindowProjectionV1> {
    try {
      const request = exactObject(body, ["expectedRevision"], "confirm");
      const context = await this.requiredB0Context(user.id, runId);
      const window = await this.findCurrentWindow(runId, context.b0WindowId);
      const projection = await this.coordinator.projection(window.id, context.roleId);
      if (projection.actorReady) throw domain("READY_STATE_LOCKS_DRAFT", "Cancel ready before confirming another plan revision.");
      await this.coordinator.confirmDraft({
        windowId: window.id,
        actorId: context.roleId,
        controlEpoch: context.controlEpoch,
        expectedRevision: revision(request.expectedRevision, "expectedRevision"),
        now: new Date().toISOString(),
      });
      return this.buildProjection(await this.findCurrentWindow(runId), context.roleId);
    } catch (error) {
      throw playerHttpError(error);
    }
  }

  async ready(user: AuthenticatedUser, runId: string, body: unknown): Promise<B0PlayerWindowProjectionV1> {
    try {
      const request = exactObject(body, ["expectedReadyRevision", "hold"], "ready");
      const context = await this.requiredB0Context(user.id, runId);
      const window = await this.findCurrentWindow(runId, context.b0WindowId);
      const projection = await this.coordinator.projection(window.id, context.roleId);
      if (!projection.lastConfirmed && request.hold !== true) {
        throw domain("READY_REQUIRES_CONFIRMED_OR_HOLD", "Confirm a plan or explicitly choose Hold before becoming ready.");
      }
      await this.coordinator.ready({
        windowId: window.id,
        actorId: context.roleId,
        controlEpoch: context.controlEpoch,
        expectedParticipantVersion: revision(request.expectedReadyRevision, "expectedReadyRevision"),
        now: new Date().toISOString(),
      });
      return this.buildProjection(await this.findCurrentWindow(runId), context.roleId);
    } catch (error) {
      throw playerHttpError(error);
    }
  }

  async unready(user: AuthenticatedUser, runId: string, body: unknown): Promise<B0PlayerWindowProjectionV1> {
    try {
      const request = exactObject(body, ["expectedReadyRevision"], "unready");
      const context = await this.requiredB0Context(user.id, runId);
      const window = await this.findCurrentWindow(runId, context.b0WindowId);
      await this.coordinator.unready({
        windowId: window.id,
        actorId: context.roleId,
        controlEpoch: context.controlEpoch,
        expectedParticipantVersion: revision(request.expectedReadyRevision, "expectedReadyRevision"),
        now: new Date().toISOString(),
      });
      return this.buildProjection(await this.findCurrentWindow(runId), context.roleId);
    } catch (error) {
      throw playerHttpError(error);
    }
  }

  private async requiredB0Context(userId: string, runId: string): Promise<B0AuthoritativeManeuverContextV1> {
    const context = await readB0ManeuverContextV1(this.prisma, userId, runId);
    if (!context) {
      throw new NotFoundException({
        code: "B0_WINDOW_NOT_AVAILABLE",
        message: "This room does not currently have a B0 settlement window.",
        recoverable: false,
      });
    }
    return context;
  }

  private async findCurrentWindow(runId: string, windowId?: string) {
    const windows = await this.prisma.actionWindow.findMany({
      where: {
        runId,
        ...(windowId ? { id: windowId } : {}),
        status: { in: [...ACTIVE_WINDOW_STATUSES] },
      },
      include: {
        participants: true,
        node: true,
        resolutionWorkflow: true,
      },
      orderBy: { createdAt: "desc" },
      take: 12,
    });
    const window = selectCurrentB0WindowV1(windows, windowId ?? null);
    if (!window) {
      throw new NotFoundException({
        code: "B0_WINDOW_NOT_AVAILABLE",
        message: "This room does not currently have a B0 settlement window.",
        recoverable: false,
      });
    }
    return window;
  }

  private async buildProjection(window: NonNullable<WindowRow>, actorId: string): Promise<B0PlayerWindowProjectionV1> {
    const projection = await this.coordinator.projection(window.id, actorId);
    const participant = window.participants.find((entry) => entry.roleId === actorId);
    if (!participant) throw new ForbiddenException({ code: "ACTOR_NOT_EXPECTED", message: "This role is not part of the settlement window." });
    const action = await this.prisma.playerAction.findUnique({
      where: { nodeId_roleId_actionSlot: { nodeId: window.nodeId, roleId: actorId, actionSlot: "B0_PRIMARY" } },
      select: { immediateJson: true },
    });
    const presentation = presentationFrom(action?.immediateJson);
    const structuredResults = await this.structuredResults(window, actorId);
    const narrative = await this.narrativeProjection(window.runId, actorId, projection);
    return projectB0PlayerWindowV1({
      projection,
      participantVersion: participant.version,
      presentation,
      structuredResults,
      narrative,
      serverNow: new Date().toISOString(),
    });
  }

  private async structuredResults(window: NonNullable<WindowRow>, actorId: string): Promise<B0PublicationDeliveryV1[]> {
    const envelope = await this.structuredResultEnvelope(window);
    if (!envelope) return [];
    const snapshot = envelope.snapshot as B0SettlementSnapshotV1;
    const resolution = envelope.resolution as B0SettlementResolutionV1;
    const intentIds = [...new Set(resolution.intentOutcomes.map((entry) => entry.intentId))].sort();
    const rows = await this.prisma.playerAction.findMany({
      where: { runId: window.runId, id: { in: intentIds } },
      select: { id: true, normalizedJson: true },
      orderBy: { id: "asc" },
    });
    const intents: B0ActionContractV1[] = rows.map((row) => {
      const stored = row.normalizedJson ? assertB0StoredIntentEnvelopeV1(row.normalizedJson) : null;
      if (!stored?.lockedIntent || stored.lockedIntent.id !== row.id) {
        throw new B0PlayerWindowErrorV1("STRUCTURED_RESULT_SOURCE_MISSING", `Committed intent ${row.id} is unavailable.`);
      }
      return stored.lockedIntent;
    });
    if (intents.length !== intentIds.length) {
      throw new B0PlayerWindowErrorV1("STRUCTURED_RESULT_SOURCE_MISSING", "The committed intent set is incomplete.");
    }
    return buildB0PublicationPlanV1({ snapshot, resolution, intents }).deliveries
      .filter((delivery) => delivery.recipientActorId === actorId);
  }

  private async structuredResultEnvelope(window: NonNullable<WindowRow>): Promise<Record<string, any> | null> {
    const current = jsonRecord(window.resolutionWorkflow?.rulesOutputJson);
    if (current?.schemaVersion === "b0-commit-envelope-v1") return current;

    // Publication opens the next synchronized window immediately. Keep the
    // just-completed settlement visible while players plan in that new window
    // instead of dropping every structured result as soon as ensureRunWindow
    // creates the successor.
    const completed = await this.prisma.actionWindow.findMany({
      where: {
        runId: window.runId,
        id: { not: window.id },
        status: "COMPLETED",
      },
      select: {
        resolutionWorkflow: { select: { rulesOutputJson: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 12,
    });
    for (const candidate of completed) {
      const envelope = jsonRecord(candidate.resolutionWorkflow?.rulesOutputJson);
      if (envelope?.schemaVersion === "b0-commit-envelope-v1") return envelope;
    }
    return null;
  }

  private async narrativeProjection(
    runId: string,
    actorId: string,
    projection: B0WindowProjectionV1,
  ): Promise<B0PlayerNarrativeProjectionV1> {
    const entry = await this.prisma.narrativeEntry.findFirst({
      where: {
        runId,
        roleId: actorId,
        entryType: "B0_NARRATIVE",
        ...(projection.window.committedAt ? { worldSequence: { gte: projection.window.baseWorldSequence + 1 } } : {}),
      },
      select: { content: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    if (entry) return { status: "AVAILABLE", content: entry.content, updatedAt: entry.createdAt.toISOString() };
    const failed = await this.prisma.storyTaskOutbox.findFirst({
      where: {
        runId,
        windowId: projection.window.id,
        taskType: "B0_NARRATIVE_GENERATION",
        status: { in: ["failed", "dead_letter", "FAILED_RETRYABLE"] },
      },
      select: { updatedAt: true },
      orderBy: { updatedAt: "desc" },
    });
    if (failed) return { status: "FAILED_RETRYABLE", content: null, updatedAt: failed.updatedAt.toISOString() };
    const committed = ["COMMITTED", "PUBLISHING", "COMPLETED"].includes(projection.window.status);
    return { status: committed ? "PENDING" : "NOT_REQUESTED", content: null, updatedAt: null };
  }

  private async persistPresentation(
    runId: string,
    nodeId: string,
    roleId: string,
    presentation: B0PlayerPlanPresentationV1,
  ): Promise<void> {
    await this.prisma.playerAction.updateMany({
      where: { runId, nodeId, roleId, actionSlot: "B0_PRIMARY" },
      data: { immediateJson: presentation as unknown as Prisma.InputJsonValue },
    });
  }

  private tokens(): ManeuverPreviewTokenCodecV1 {
    if (this.tokenCodecInstance) return this.tokenCodecInstance;
    this.tokenCodecInstance = new ManeuverPreviewTokenCodecV1(previewSecret());
    return this.tokenCodecInstance;
  }
}

function assertPreviewOwnership(
  payload: ManeuverPreviewTokenPayloadV1,
  userId: string,
  context: B0AuthoritativeManeuverContextV1,
): void {
  if (payload.userId !== userId
    || payload.runId !== context.runId
    || payload.actorRoleId !== context.roleId
    || payload.actorTurnId !== context.actorTurnId
    || payload.stateRevision !== context.stateRevision
    || payload.turnRevision !== context.turnRevision
    || payload.controlEpoch !== context.controlEpoch) {
    throw new B0PlayerWindowErrorV1("PREVIEW_STALE", "The preview no longer belongs to the current role state.");
  }
}

function previewSecret(): string {
  const configured = String(process.env.MANEUVER_PREVIEW_SECRET || "").trim();
  if (configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new ServiceUnavailableException({
      code: "MANEUVER_PREVIEW_SECRET_REQUIRED",
      message: "B0 plan previews are not configured.",
    });
  }
  return "local-maneuver-preview-secret-change-before-production";
}

function presentationFrom(value: unknown): B0PlayerPlanPresentationV1 | null {
  if (!jsonRecord(value)) return null;
  try {
    return normalizeB0PlayerPlanPresentationV1(value);
  } catch {
    return null;
  }
}

function exactObject(value: unknown, allowed: string[], label: string): Record<string, any> {
  const object = jsonRecord(value);
  if (!object) throw new BadRequestException({ code: "B0_REQUEST_INVALID", message: `${label} request must be an object.` });
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new BadRequestException({ code: "B0_REQUEST_UNKNOWN_FIELD", message: `${label} request contains unknown fields.` });
  return object;
}

function revision(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new BadRequestException({ code: "B0_REVISION_INVALID", message: `${label} must be a non-negative integer.` });
  return number;
}

function identifier(value: unknown, label: string): string {
  const result = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,199}$/u.test(result)) {
    throw new BadRequestException({ code: "B0_IDENTIFIER_INVALID", message: `${label} is invalid.` });
  }
  return result;
}

function jsonRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function domain(code: string, message: string): ConflictException {
  return new ConflictException({ code, message, recoverable: true });
}

function playerHttpError(error: unknown): Error {
  if (error instanceof HttpException) return error;
  if (error instanceof ManeuverDomainErrorV1) {
    return new HttpException({ code: error.code, message: error.message, recoverable: error.recoverable }, error.httpStatus);
  }
  if (error instanceof B0PlayerWindowErrorV1) {
    return new ConflictException({ code: error.code, message: error.message, recoverable: true });
  }
  const response = jsonRecord((error as any)?.response);
  if (response?.code) return new ConflictException({ ...response, recoverable: response.recoverable !== false });
  return error instanceof Error ? error : new Error(String(error || "Unknown B0 window error"));
}
