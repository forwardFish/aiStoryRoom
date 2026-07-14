import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma.service";
import { CreditsService } from "../credits/credits.service";
import QRCode from "qrcode";

function generateReferralCode() {
  return randomBytes(8).toString("base64url").replace(/[-_]/g, "").slice(0, 8).toUpperCase();
}

const referralChannels = ["LINK", "X", "FACEBOOK", "WHATSAPP", "TELEGRAM", "DISCORD", "NATIVE"] as const;
type ReferralChannelInput = (typeof referralChannels)[number];
function normalizeChannel(value: unknown): ReferralChannelInput | "UNKNOWN" {
  const channel = String(value || "").trim().toUpperCase();
  return (referralChannels as readonly string[]).includes(channel) ? channel as ReferralChannelInput : "UNKNOWN";
}

@Injectable()
export class ReferralsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(CreditsService) private readonly credits: CreditsService) {}

  async getOrCreateCode(userId: string) {
    const existing = await this.prisma.referralCode.findUnique({ where: { userId } });
    if (existing) return existing;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.referralCode.create({ data: { userId, code: generateReferralCode() } });
      } catch (error: any) {
        if (error?.code !== "P2002") throw error;
      }
    }
    throw new Error("Unable to allocate referral code");
  }

  async getSummary(userId: string) {
    const code = await this.getOrCreateCode(userId);
    const rewardedCount = await this.prisma.referral.count({ where: { inviterUserId: userId, status: "REWARDED" } });
    const maxRewardedInvites = Number(process.env.CREDIT_REFERRAL_MAX_REWARDS || 2);
    return {
      code: code.code,
      inviteUrl: `${process.env.REFERRAL_BASE_URL || `${process.env.PUBLIC_WEB_URL || "http://localhost:3000"}/join`}?ref=${encodeURIComponent(code.code)}`,
      rewardPerQualifiedInvite: Number(process.env.CREDIT_REFERRAL_REWARD || 25),
      maxRewardedInvites,
      rewardedCount,
      remainingRewardSlots: Math.max(0, maxRewardedInvites - rewardedCount)
    };
  }

  async bindReferral(params: { referredUserId: string; referralCode: string; channel?: string }) {
    const code = await this.prisma.referralCode.findUnique({ where: { code: params.referralCode.trim().toUpperCase() } });
    if (!code) return { bound: false, reason: "INVALID_CODE" };
    if (code.userId === params.referredUserId) return { bound: false, reason: "SELF_REFERRAL" };
    const existing = await this.prisma.referral.findUnique({ where: { referredUserId: params.referredUserId } });
    if (existing) return { bound: false, reason: "ALREADY_BOUND" };
    const channel = normalizeChannel(params.channel);
    const referral = await this.prisma.referral.create({
      data: { referralCodeId: code.id, inviterUserId: code.userId, referredUserId: params.referredUserId, channel }
    });
    return { bound: true, referralId: referral.id, status: referral.status };
  }

  async recordShareEvent(userId: string, body: { channel?: string; runId?: string }) {
    const channel = normalizeChannel(body.channel);
    const event = await this.prisma.referralShareEvent.create({ data: { userId, channel, runId: body.runId } });
    return { recorded: true, creditsGranted: 0, eventId: event.id };
  }

  async getInviteQr(userId: string, roomCode: string) {
    const inviteCode = String(roomCode || "").trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,40}$/.test(inviteCode)) throw new BadRequestException({ code: "INVALID_ROOM_CODE", message: "Invalid room invitation code" });
    const run = await this.prisma.storyRun.findUnique({ where: { inviteCode }, select: { id: true, ownerUserId: true } });
    if (!run) throw new BadRequestException({ code: "ROOM_INVITATION_NOT_FOUND", message: "Room invitation not found" });
    const participant = run.ownerUserId === userId || Boolean(await this.prisma.storyPlayer.findFirst({ where: { runId: run.id, userId, status: "active" }, select: { id: true } }));
    if (!participant) throw new BadRequestException({ code: "ROOM_PARTICIPANT_REQUIRED", message: "Only room participants can generate an invitation poster" });
    const referral = await this.getOrCreateCode(userId);
    const origin = String(process.env.PUBLIC_WEB_URL || "http://localhost:3000").replace(/\/$/, "");
    const combinedInviteUrl = `${origin}/join?room=${encodeURIComponent(inviteCode)}&ref=${encodeURIComponent(referral.code)}&channel=LINK`;
    const png = await QRCode.toBuffer(combinedInviteUrl, { type: "png", width: 360, margin: 1, errorCorrectionLevel: "M" });
    return { combinedInviteUrl, png };
  }

  async qualifyReferral(referredUserId: string, qualifiedRunId: string) {
    return this.prisma.$transaction(async (tx) => {
      const referral = await tx.referral.findUnique({ where: { referredUserId } });
      if (!referral) return { qualified: false, reason: "NO_REFERRAL" };
      if (referral.status === "REWARDED" || referral.status === "QUALIFIED_NO_REWARD") return { qualified: true, rewarded: referral.status === "REWARDED", alreadyProcessed: true };

      const qualified = await tx.referral.update({ where: { id: referral.id }, data: { status: "QUALIFIED", qualifiedRunId, qualifiedAt: new Date() } });
      const maxRewardedInvites = Number(process.env.CREDIT_REFERRAL_MAX_REWARDS || 2);
      const rewardedCount = await tx.referral.count({ where: { inviterUserId: referral.inviterUserId, status: "REWARDED" } });
      if (rewardedCount >= maxRewardedInvites) {
        const noReward = await tx.referral.update({ where: { id: qualified.id }, data: { status: "QUALIFIED_NO_REWARD", rejectionReason: "MVP_REWARD_LIMIT_REACHED" } });
        return { qualified: true, rewarded: false, status: noReward.status, reason: noReward.rejectionReason };
      }

      const ledger = await this.credits.grantCredits({
        userId: referral.inviterUserId,
        kind: "BONUS",
        source: "REFERRAL",
        amount: Number(process.env.CREDIT_REFERRAL_REWARD || 25),
        reason: "REFERRAL_REWARD",
        idempotencyKey: `referral-reward:${referral.id}`,
        externalRef: referral.id,
        expiresAt: new Date(Date.now() + Number(process.env.CREDIT_BONUS_TTL_DAYS || 90) * 86_400_000),
        metadata: { referredUserId, qualifiedRunId },
        tx
      });
      const rewarded = await tx.referral.update({ where: { id: referral.id }, data: { status: "REWARDED", rewardLedgerId: ledger.id, rewardedAt: new Date() } });
      return { qualified: true, rewarded: true, credits: Number(process.env.CREDIT_REFERRAL_REWARD || 25), status: rewarded.status };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async qualifyFromExperience(userId: string, runId: string) {
    const decisions = await this.prisma.playerAction.count({ where: { userId, runId } });
    if (decisions < 2) return { qualified: false, reason: "VALID_EXPERIENCE_REQUIRED", decisions };
    return this.qualifyReferral(userId, runId);
  }
}
