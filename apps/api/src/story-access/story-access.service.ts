import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../auth/current-user.decorator";
import { CreditsService } from "../credits/credits.service";
import { PrismaService } from "../prisma.service";
import { ReferralsService } from "../referrals/referrals.service";
import { ActionWindowService } from "../continuous-strategy/action-window.service";
import { MemberProjectionService } from "../continuous-strategy/member-projection.service";
import { CONTINUOUS_ENGINE_VERSION, type UnlockResponseV1 } from "@ai-story/shared";

@Injectable()
export class StoryAccessService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(ReferralsService) private readonly referrals: ReferralsService,
    @Inject(ActionWindowService) private readonly actionWindows: ActionWindowService,
    @Inject(MemberProjectionService) private readonly projections: MemberProjectionService
  ) {}

  private async retrySerializableTransaction<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await operation();
      } catch (error: any) {
        const message = String(error?.message || error || "");
        const transient = error?.code === "P2034" || /40P01|40001|deadlock detected|write conflict/i.test(message);
        if (!transient || attempt === 3) throw error;
        // Two rooms owned by the same player can reach the shared credit
        // wallet at the same instant. Retrying the whole idempotent unlock
        // transaction is required by PostgreSQL Serializable isolation.
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    throw new Error("unreachable serialization retry state");
  }

  roomAccessState(run: { accessLevel: string; freeDecisionsUsed: number }, currentRound: number) {
    const freeRounds = Number(process.env.CREDIT_FREE_DECISION_LIMIT || 3);
    const requiredCredits = Number(process.env.CREDIT_STANDARD_WORLD_COST || 100);
    const unlocked = run.accessLevel === "UNLOCKED";
    return {
      unlocked,
      freeRounds,
      freeRoundsUsed: Math.min(freeRounds, Number(run.freeDecisionsUsed || 0)),
      currentRound,
      requiredCredits,
      requiresUnlock: !unlocked && currentRound > freeRounds
    };
  }

  /**
   * Shared rooms consume their free opening once per round, never once per
   * participant action. The first action of a free round records that round;
   * later actions observe the same state. From the next round onward the
   * existing idempotent world-unlock transaction is required.
   */
  async ensureRoomRoundAccess(user: AuthenticatedUser, runId: string, currentRound: number) {
    // All three browsers submit at nearly the same instant.  On Postgres
    // serializable transactions, the one which records a newly opened free
    // round can transiently conflict with the other two read/update paths.
    // The update is idempotent, so retrying the whole transaction is safe.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const run = await tx.storyRun.findUnique({ where: { id: runId } });
          if (!run) throw new NotFoundException({ code: "STORY_RUN_NOT_FOUND", message: "Story run not found" });
          const participant = run.ownerUserId === user.id || Boolean(await tx.storyPlayer.findFirst({ where: { runId, userId: user.id, status: "active" } }));
          if (!participant) throw new ForbiddenException({ code: "RUN_PARTICIPANT_REQUIRED", message: "Only participants can play this run" });
          const access = this.roomAccessState(run, currentRound);
          if (access.unlocked) return { completedFreeRound: false, access };
          if (access.requiresUnlock) {
            throw new HttpException({ code: "WORLD_UNLOCK_REQUIRED", message: "Unlock this shared world to continue", details: { ...access, runId } }, HttpStatus.PAYMENT_REQUIRED);
          }
          if (run.freeDecisionsUsed >= currentRound) return { completedFreeRound: false, access };
          const advanced = await tx.storyRun.updateMany({
            where: { id: runId, freeDecisionsUsed: { lt: currentRound } },
            data: { freeDecisionsUsed: currentRound, paywallReachedAt: currentRound >= access.freeRounds ? new Date() : undefined }
          });
          if (advanced.count) await tx.eventLog.create({ data: { userId: user.id, runId, eventName: "free_room_round_started", source: "story-access", payload: { currentRound, freeRounds: access.freeRounds } } });
          return { completedFreeRound: Boolean(advanced.count), access: { ...access, freeRoundsUsed: currentRound } };
        });
        if (result.completedFreeRound && currentRound >= 2) await this.referrals.qualifyReferral(user.id, runId);
        return result.access;
      } catch (error: any) {
        if (error?.code !== "P2034" || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    throw new Error("unreachable serialization retry state");
  }

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

  async unlock(user: AuthenticatedUser, runId: string, command: { idempotencyKey?: string } = {}): Promise<UnlockResponseV1> {
    const requestedKey = String(command.idempotencyKey || `world-unlock:${runId}`).trim();
    if (requestedKey.length < 8 || requestedKey.length > 160) throw new HttpException({ code: "INVALID_COMMAND", message: "A valid idempotencyKey is required" }, HttpStatus.BAD_REQUEST);
    const cost = Number(process.env.CREDIT_STANDARD_WORLD_COST || 100);
    const result = await this.retrySerializableTransaction(() => this.prisma.$transaction(async (tx) => {
        const run = await tx.storyRun.findUnique({ where: { id: runId } });
        if (!run) throw new NotFoundException({ code: "STORY_RUN_NOT_FOUND", message: "Story run not found" });
        const participant = run.ownerUserId === user.id || Boolean(await tx.storyPlayer.findFirst({ where: { runId, userId: user.id, status: "active" } }));
        if (!participant) throw new ForbiddenException({ code: "RUN_PARTICIPANT_REQUIRED", message: "Only participants can unlock this world" });
        const existing = await tx.worldUnlock.findUnique({ where: { runId } });
        if (existing?.status === "COMMITTED") {
          if (run.engineVersion === CONTINUOUS_ENGINE_VERSION) await this.actionWindows.resumeAfterUnlock(tx, runId, user.id);
          return { alreadyUnlocked: true, creditsCharged: 0, payerUserId: existing.paidByUserId };
        }
        const ledger = await this.credits.spendCredits({ userId: user.id, amount: cost, reason: "WORLD_UNLOCK", idempotencyKey: `world-unlock:${runId}`, externalRef: runId, metadata: { runId, templateKey: run.templateKey }, tx });
        const unlock = await tx.worldUnlock.create({ data: { runId, templateKey: run.templateKey, paidByUserId: user.id, creditsCharged: cost, debitLedgerId: ledger.id } });
        await tx.storyRun.update({ where: { id: runId }, data: { accessLevel: "UNLOCKED", unlockedAt: new Date() } });
        if (run.engineVersion === CONTINUOUS_ENGINE_VERSION) await this.actionWindows.resumeAfterUnlock(tx, runId, user.id);
        return { alreadyUnlocked: false, creditsCharged: cost, payerUserId: unlock.paidByUserId };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 }));
    const gameProjection = await this.projections.game(user, runId);
    return {
      unlocked: true,
      alreadyUnlocked: result.alreadyUnlocked,
      creditsCharged: result.creditsCharged,
      payerUserId: result.payerUserId,
      access: gameProjection.access,
      gameProjection
    };
  }
}
