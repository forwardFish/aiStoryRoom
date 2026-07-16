import { BadRequestException, ConflictException, ForbiddenException, GoneException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { PrismaService } from "../prisma.service";
import type { AuthenticatedUser } from "../auth/current-user.decorator";

const DAY_MS = 86_400_000;
const allowedChannels = new Set(["LINK", "NATIVE", "WHATSAPP", "TELEGRAM", "FACEBOOK", "X", "DISCORD"]);

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function publicOrigin() {
  const configured = String(process.env.PUBLIC_WEB_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000")).trim();
  if (!configured) throw new Error("PUBLIC_WEB_URL is required for public result shares");
  const url = new URL(configured);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("PUBLIC_WEB_URL must be a web origin");
  return url.origin;
}

function safeText(value: unknown, maxLength = 420) {
  const text = typeof value === "string"
    ? value
    : value && typeof value === "object" && "text" in value
      ? String((value as { text?: unknown }).text || "")
      : "";
  return text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[private email removed]")
    .replace(/https?:\/\/\S+/gi, "[private link removed]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

@Injectable()
export class ResultSharingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async requireCompletedParticipant(userId: string, runId: string) {
    const run = await this.prisma.storyRun.findUnique({
      where: { id: runId },
      include: {
        players: { where: { userId, status: "active" }, select: { id: true, roleId: true } },
        chapters: { where: { status: "generated" }, orderBy: { chapterIndex: "desc" }, take: 1 }
      }
    });
    if (!run) throw new NotFoundException({ code: "RESULT_NOT_FOUND", message: "Story result not found" });
    if (run.ownerUserId !== userId && run.players.length === 0) {
      throw new ForbiddenException({ code: "RESULT_PARTICIPANT_REQUIRED", message: "Only room participants can share this result" });
    }
    if (run.status !== "chapter_generated" || !run.chapters[0]) {
      throw new ConflictException({ code: "RESULT_NOT_READY", message: "The result can be shared after all seven rounds are complete" });
    }
    return run;
  }

  async create(user: AuthenticatedUser, runId: string, input: { expiresInDays?: number; channel?: string; includeRoleName?: boolean }) {
    const run = await this.requireCompletedParticipant(user.id, runId);
    const requestedDays = Number(input.expiresInDays || 7);
    if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 30) {
      throw new BadRequestException({ code: "INVALID_SHARE_EXPIRY", message: "Share links can expire in 1 to 30 days" });
    }
    const channel = String(input.channel || "LINK").trim().toUpperCase();
    if (!allowedChannels.has(channel)) throw new BadRequestException({ code: "INVALID_SHARE_CHANNEL", message: "Unsupported share channel" });

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + requestedDays * DAY_MS);
    const share = await this.prisma.shareToken.create({
      data: {
        tokenHash: tokenHash(token),
        tokenPrefix: token.slice(0, 8),
        runId,
        chapterId: run.chapters[0].id,
        shareUserId: user.id,
        scene: "result",
        channel,
        includeRoleName: input.includeRoleName === true,
        expiresAt
      },
      select: { id: true, createdAt: true, expiresAt: true, channel: true, includeRoleName: true }
    });
    const url = `${publicOrigin()}/shared/result?token=${encodeURIComponent(token)}`;
    return {
      ...share,
      url,
      qrDataUrl: await QRCode.toDataURL(url, { width: 360, margin: 1, errorCorrectionLevel: "M" }),
      security: { rawTokenStored: false, expiresAt, revocable: true }
    };
  }

  async list(user: AuthenticatedUser, runId: string) {
    await this.requireCompletedParticipant(user.id, runId);
    const shares = await this.prisma.shareToken.findMany({
      where: { runId, shareUserId: user.id, scene: "result", tokenHash: { not: null } },
      select: { id: true, tokenPrefix: true, channel: true, includeRoleName: true, expiresAt: true, revokedAt: true, lastAccessedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20
    });
    return { shares };
  }

  async revoke(user: AuthenticatedUser, runId: string, shareId: string) {
    const result = await this.prisma.shareToken.updateMany({
      where: { id: shareId, runId, shareUserId: user.id, scene: "result", revokedAt: null },
      data: { revokedAt: new Date() }
    });
    if (result.count !== 1) throw new NotFoundException({ code: "SHARE_NOT_FOUND", message: "Active share link not found" });
    return { revoked: true, shareId };
  }

  async publicResult(rawToken: string) {
    const token = String(rawToken || "").trim();
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) throw new NotFoundException({ code: "SHARE_NOT_FOUND", message: "Share link not found" });
    const share = await this.prisma.shareToken.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { run: true, chapter: true }
    });
    if (!share || share.scene !== "result") throw new NotFoundException({ code: "SHARE_NOT_FOUND", message: "Share link not found" });
    if (share.revokedAt) throw new GoneException({ code: "SHARE_REVOKED", message: "This result share has been revoked" });
    if (!share.expiresAt || share.expiresAt.getTime() <= Date.now()) throw new GoneException({ code: "SHARE_EXPIRED", message: "This result share has expired" });
    if (share.run.status !== "chapter_generated" || !share.chapter) throw new NotFoundException({ code: "SHARE_RESULT_UNAVAILABLE", message: "Shared result is unavailable" });

    let roleName: string | null = null;
    if (share.includeRoleName) {
      const player = await this.prisma.storyPlayer.findFirst({
        where: { runId: share.runId, userId: share.shareUserId },
        include: { role: { select: { roleName: true } } }
      });
      roleName = safeText(player?.role?.roleName, 80) || null;
    }
    await this.prisma.shareToken.update({ where: { id: share.id }, data: { lastAccessedAt: new Date() } });
    const highlights = Array.isArray(share.chapter.highlightsJson)
      ? share.chapter.highlightsJson.map((item) => safeText(item)).filter(Boolean).slice(0, 3)
      : [];
    return {
      privacyVersion: 1,
      room: {
        title: safeText(share.run.title, 120),
        worldId: safeText(share.run.templateKey, 40),
        completedAt: share.run.updatedAt,
        completedNodes: share.run.completedNodeCount
      },
      recap: {
        title: safeText(share.chapter.title, 160),
        highlights,
        roleName
      },
      share: { expiresAt: share.expiresAt },
      redacted: ["player identities", "private goals", "hidden intent", "private clues", "raw actions", "reasoning traces", "chapter source data"]
    };
  }
}
