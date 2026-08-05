import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { PrismaService } from "../prisma.service";
import { OpenNovelRuntimeClient } from "./openovel-runtime.client";

type SharedActionBody = {
  rawText?: string;
  expectedStateRevision?: number;
  idempotencyKey?: string;
  candidateId?: string;
};

/** Product authorization and redaction adapter for the shared-world runtime. */
@Injectable()
export class OpenNovelSharedService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OpenNovelRuntimeClient) private readonly runtime: OpenNovelRuntimeClient,
  ) {}

  async initialize(user: AuthenticatedUser, runId: string) {
    const room = await this.roomForMember(user, runId);
    const roleKeys = room.players
      .map((player: any) => String(player.role?.roleKey || "").trim())
      .filter(Boolean);
    if (!roleKeys.length) {
      throw new BadRequestException({
        code: "SHARED_ROLES_REQUIRED",
        message: "At least one room participant must select a supported role.",
      });
    }
    const shared = await this.runtime.createSharedRun({
      runId,
      worldId: room.templateKey,
      roleKeys,
    });
    return publicRun(shared);
  }

  async getRun(user: AuthenticatedUser, runId: string) {
    await this.roomForMember(user, runId);
    return publicRun(await this.runtime.getSharedRun(runId));
  }

  async submitAction(user: AuthenticatedUser, runId: string, body: SharedActionBody) {
    const membership = await this.controlledRole(user, runId);
    const rawText = String(body.rawText || "").trim();
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    const expectedStateRevision = Number(body.expectedStateRevision);
    if (!rawText) throw new BadRequestException({ code: "SHARED_ACTION_REQUIRED", message: "Enter an action." });
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(idempotencyKey)) {
      throw new BadRequestException({ code: "INVALID_IDEMPOTENCY_KEY", message: "A stable action key is required." });
    }
    if (!Number.isInteger(expectedStateRevision) || expectedStateRevision < 0) {
      throw new BadRequestException({ code: "EXPECTED_STATE_REVISION_INVALID", message: "Refresh the shared story state." });
    }
    const result = await this.runtime.submitSharedAction({
      runId,
      roleKey: membership.role.roleKey,
      rawText,
      expectedStateRevision,
      idempotencyKey,
      candidateId: body.candidateId ? String(body.candidateId) : undefined,
    });
    return {
      kind: result.kind,
      actionId: opaque(runId, String(result.actionId || "action")),
      worldTurnId: String(result.worldTurnId || ""),
      stateRevision: Number(result.stateRevision),
      projection: publicProjection(result.projection),
    };
  }

  async feed(user: AuthenticatedUser, runId: string) {
    const role = await this.controlledRole(user, runId);
    const entries = await this.runtime.getSharedRoleView(runId, role.role.roleKey, "feed");
    return (Array.isArray(entries) ? entries : []).map((entry: any) => ({
      kind: String(entry.kind || "WORLD"),
      text: String(entry.text || ""),
      createdAt: String(entry.createdAt || ""),
    }));
  }

  async projection(user: AuthenticatedUser, runId: string) {
    return this.view(user, runId, "projection", publicProjection);
  }

  async impact(user: AuthenticatedUser, runId: string) {
    return this.view(user, runId, "impact", publicImpact);
  }

  async clues(user: AuthenticatedUser, runId: string) {
    return this.view(user, runId, "clues", publicClues);
  }

  async destinyNet(user: AuthenticatedUser, runId: string) {
    return this.view(user, runId, "destiny-net", (value) => publicDestinyNet(runId, value));
  }

  async actions(user: AuthenticatedUser, runId: string) {
    const membership = await this.controlledRole(user, runId);
    return this.runtime.getSharedRoleActions(runId, membership.role.roleKey);
  }

  private async view(
    user: AuthenticatedUser,
    runId: string,
    capability: "projection" | "impact" | "clues" | "destiny-net",
    project: (value: any) => unknown,
  ) {
    const membership = await this.controlledRole(user, runId);
    return project(await this.runtime.getSharedRoleView(runId, membership.role.roleKey, capability));
  }

  private async controlledRole(user: AuthenticatedUser, runId: string) {
    const room = await this.roomForMember(user, runId);
    const membership = room.players.find((player: any) => player.userId === user.id);
    const role = membership?.role;
    if (!role?.roleKey) {
      throw new ForbiddenException({
        code: "SHARED_ROLE_REQUIRED",
        message: "Select a role before entering the shared story.",
      });
    }
    return { ...membership, role };
  }

  private async roomForMember(user: AuthenticatedUser, runId: string) {
    const room = await this.prisma.storyRun.findUnique({
      where: { id: runId },
      include: { players: { include: { role: true } } },
    });
    if (!room || room.mode !== "room") {
      throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found." });
    }
    if (room.ownerUserId !== user.id && !room.players.some((player: any) => player.userId === user.id)) {
      throw new ForbiddenException({ code: "ROOM_ACCESS_DENIED", message: "Join this room first." });
    }
    return room;
  }
}

function publicRun(value: any) {
  return {
    schemaVersion: String(value.schemaVersion || "openovel_shared_run_v1"),
    runId: String(value.runId || ""),
    worldId: String(value.worldId || ""),
    stateRevision: Number(value.stateRevision || 0),
    latestWorldTurnId: value.latestWorldTurnId ? String(value.latestWorldTurnId) : null,
    createdAt: String(value.createdAt || ""),
    updatedAt: String(value.updatedAt || ""),
  };
}

function publicProjection(value: any) {
  if (!value || typeof value !== "object") return null;
  return {
    stateRevision: Number(value.stateRevision || 0),
    destinyQuestion: String(value.destinyQuestion || ""),
    privateFacts: summaries(value.privateFacts),
    publicFacts: summaries(value.publicFacts),
    inferableSignals: summaries(value.inferableSignals),
    personalEchoes: summaries(value.personalEchoes),
    crossPlayerEchoes: summaries(value.crossPlayerEchoes),
    worldEchoes: summaries(value.worldEchoes),
    activeDestinyHooks: (Array.isArray(value.activeDestinyHooks) ? value.activeDestinyHooks : []).map((hook: any) => ({
      status: String(hook.status || "ACTIVE"),
    })),
  };
}

function publicImpact(value: any) {
  return {
    personal: summaries(value?.personal),
    crossPlayer: summaries(value?.crossPlayer),
    world: summaries(value?.world),
    delayed: summaries(value?.delayed),
  };
}

function publicClues(value: any) {
  return {
    mine: summaries(value?.private),
    public: summaries(value?.public),
    inferable: summaries(value?.inferable),
  };
}

function publicDestinyNet(runId: string, value: any) {
  if (!value || typeof value !== "object") return null;
  const nodes = (Array.isArray(value.nodes) ? value.nodes : []).map((node: any) => ({
    id: opaque(runId, String(node.id || "node")),
    label: String(node.label || ""),
    type: String(node.type || "UNKNOWN"),
    visibility: String(node.visibility || "KNOWN"),
  }));
  const ids = new Map((Array.isArray(value.nodes) ? value.nodes : []).map((node: any, index: number) => [
    String(node.id || ""),
    nodes[index].id,
  ]));
  return {
    nodes,
    edges: (Array.isArray(value.edges) ? value.edges : []).flatMap((edge: any) => {
      const from = ids.get(String(edge.from || ""));
      const to = ids.get(String(edge.to || ""));
      return from && to ? [{
        from,
        to,
        ...(edge.label ? { label: String(edge.label) } : {}),
        visibility: String(edge.visibility || "KNOWN"),
      }] : [];
    }),
  };
}

function summaries(value: unknown) {
  return (Array.isArray(value) ? value : []).map((item: any) => ({
    summary: String(item?.summary || ""),
    ...(item?.status ? { status: String(item.status) } : {}),
  })).filter((item) => item.summary);
}

function opaque(runId: string, internalId: string) {
  return `view_${createHash("sha256").update(`${runId}\0${internalId}`).digest("hex").slice(0, 16)}`;
}
