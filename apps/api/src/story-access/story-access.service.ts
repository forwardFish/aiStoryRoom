import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../auth/current-user.decorator";
import { CreditsService } from "../credits/credits.service";
import { PrismaService } from "../prisma.service";
import { ReferralsService } from "../referrals/referrals.service";

@Injectable()
export class StoryAccessService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(CreditsService) private readonly credits: CreditsService, @Inject(ReferralsService) private readonly referrals: ReferralsService) {}

  async freeDecision(user: AuthenticatedUser, runId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const run = await tx.storyRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException({ code: "STORY_RUN_NOT_FOUND", message: "Story run not found" });
      const participant = run.ownerUserId === user.id || Boolean(await tx.storyPlayer.findFirst({ where: { runId, userId: user.id, status: "active" } }));
      if (!participant) throw new ForbiddenException({ code: "RUN_PARTICIPANT_REQUIRED", message: "Only participants can play this run" });
      if (run.accessLevel === "UNLOCKED") return { run, completed: false, unlocked: true, freeDecisionsUsed: run.freeDecisionsUsed };
      const limit = Number(process.env.CREDIT_FREE_DECISION_LIMIT || 3);
      if (run.freeDecisionsUsed >= limit) throw new HttpException({ code: "WORLD_UNLOCK_REQUIRED", message: "Unlock this world to continue", details: { requiredCredits: Number(process.env.CREDIT_STANDARD_WORLD_COST || 100), runId } }, HttpStatus.PAYMENT_REQUIRED);
      const updated = await tx.storyRun.update({ where: { id: runId }, data: { freeDecisionsUsed: { increment: 1 }, paywallReachedAt: run.freeDecisionsUsed + 1 >= limit ? new Date() : undefined } });
      await tx.eventLog.create({ data: { userId: user.id, runId, eventName: "free_decision_completed", source: "story-access", payload: { freeDecisionsUsed: updated.freeDecisionsUsed } } });
      return { run: updated, completed: true, unlocked: false, freeDecisionsUsed: updated.freeDecisionsUsed };
    });
    if (result.completed && result.freeDecisionsUsed >= 2) await this.referrals.qualifyReferral(user.id, runId);
    return { ...result, run: undefined };
  }

  async unlock(user: AuthenticatedUser, runId: string) {
    const cost = Number(process.env.CREDIT_STANDARD_WORLD_COST || 100);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.worldUnlock.findUnique({ where: { runId } });
      if (existing?.status === "COMMITTED") return { unlocked: true, alreadyUnlocked: true, runId, creditsCharged: 0, balance: await this.credits.getBalance(user.id, tx) };
      const run = await tx.storyRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException({ code: "STORY_RUN_NOT_FOUND", message: "Story run not found" });
      const participant = run.ownerUserId === user.id || Boolean(await tx.storyPlayer.findFirst({ where: { runId, userId: user.id, status: "active" } }));
      if (!participant) throw new ForbiddenException({ code: "RUN_PARTICIPANT_REQUIRED", message: "Only participants can unlock this world" });
      const ledger = await this.credits.spendCredits({ userId: user.id, amount: cost, reason: "WORLD_UNLOCK", idempotencyKey: `world-unlock:${runId}`, externalRef: runId, metadata: { runId, templateKey: run.templateKey }, tx });
      const unlock = await tx.worldUnlock.create({ data: { runId, templateKey: run.templateKey, paidByUserId: user.id, creditsCharged: cost, debitLedgerId: ledger.id } });
      await tx.storyRun.update({ where: { id: runId }, data: { accessLevel: "UNLOCKED", unlockedAt: new Date() } });
      return { unlocked: true, alreadyUnlocked: false, runId, creditsCharged: cost, paidByUserId: user.id, unlockId: unlock.id, balance: await this.credits.getBalance(user.id, tx) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
