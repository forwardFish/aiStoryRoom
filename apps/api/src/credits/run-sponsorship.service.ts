import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { readCreditConsumptionConfig } from "../config/credit-consumption.config";
import { PrismaService } from "../prisma.service";
import { parseRunBilling } from "./credit-policy";
import { CreditConsumptionService } from "./credit-consumption.service";
import { CreditsService } from "./credits.service";
import { operationalMetrics } from "../observability/operational-metrics";

type Tx = Prisma.TransactionClient;

@Injectable()
export class RunSponsorshipService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(CreditConsumptionService) private readonly consumption: CreditConsumptionService
  ) {}

  async creditStatus(user: AuthenticatedUser, runId: string) {
    const run = await this.requireParticipant(user.id, runId);
    const config = readCreditConsumptionConfig();
    const billing = parseRunBilling(run, config.prices);
    const available = await this.consumption.availableForRun(runId, user.id);
    operationalMetrics.set("sponsorship_allowance_amount", { status: "ACTIVE" }, available.runAllowanceAvailable);
    const latestRequest = run.ownerUserId === user.id ? null : await (this.prisma as any).sponsorshipRequest.findFirst({
      where: { runId, beneficiaryUserId: user.id },
      orderBy: { createdAt: "desc" }
    });
    return {
      policyVersion: billing.policyVersion,
      available: available.available,
      personalAvailable: available.personalAvailable,
      runAllowanceAvailable: available.runAllowanceAvailable,
      minimumActionCost: billing.prices.standardAction,
      standardActionCost: billing.prices.standardAction,
      customActionCost: billing.prices.customAction,
      canRequestSponsor: billing.policyVersion === "active_action_v1" && run.ownerUserId !== user.id && !isRunTerminal(run.status),
      sponsorshipRequestStatus: latestRequest?.status || "NONE",
      meteringMode: config.meteringMode
    };
  }

  async createRequest(user: AuthenticatedUser, runId: string, input: { idempotencyKey?: string; origin?: "FIRST_INSUFFICIENT" | "MANUAL" }) {
    const origin = input.origin === "FIRST_INSUFFICIENT" ? "FIRST_INSUFFICIENT" : "MANUAL";
    const key = String(input.idempotencyKey || "").trim();
    if (key.length < 8 || key.length > 200) throw new BadRequestException({ code: "INVALID_COMMAND", message: "A valid idempotencyKey is required" });
    let created = false;
    const outcome = await this.prisma.$transaction(async (tx) => {
      const run = await this.requireParticipant(user.id, runId, tx);
      if (run.ownerUserId === user.id) throw new BadRequestException({ code: "SPONSORSHIP_SELF_REQUEST_FORBIDDEN", message: "The room host cannot request sponsorship from themselves" });
      if (isRunTerminal(run.status)) throw new ConflictException({ code: "STORY_RUN_NOT_ACTIVE", message: "Sponsorship is unavailable after the run ends" });
      const billing = parseRunBilling(run, readCreditConsumptionConfig().prices);
      if (billing.policyVersion !== "active_action_v1") throw new ConflictException({ code: "BILLING_POLICY_DOES_NOT_SUPPORT_SPONSORSHIP", message: "This run uses the legacy unlock policy" });

      const existing = await (tx as any).sponsorshipRequest.findUnique({ where: { idempotencyKey: key } });
      if (existing) {
        if (existing.runId !== runId || existing.beneficiaryUserId !== user.id || existing.origin !== origin) {
          throw new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED", message: "The idempotency key was used for another sponsorship request" });
        }
        return existing;
      }
      const automaticPromptKey = origin === "FIRST_INSUFFICIENT" ? `auto-sponsor-prompt:${runId}:${user.id}` : null;
      if (automaticPromptKey) {
        const first = await (tx as any).sponsorshipRequest.findUnique({ where: { automaticPromptKey } });
        if (first) return first;
      }
      const request = await (tx as any).sponsorshipRequest.create({
        data: {
          runId,
          hostUserId: run.ownerUserId,
          beneficiaryUserId: user.id,
          origin,
          automaticPromptKey,
          idempotencyKey: key
        }
      });
      created = true;
      await tx.eventLog.create({ data: { userId: user.id, runId, eventName: "sponsorship_requested", source: "credits", payload: { requestId: request.id, origin } } });
      return request;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (created) {
      operationalMetrics.increment("sponsorship_request_total", { origin: outcome.origin, status: outcome.status });
    }
    return outcome;
  }

  async listForHost(user: AuthenticatedUser, runId: string) {
    const run = await this.prisma.storyRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException({ code: "STORY_RUN_NOT_FOUND", message: "Story run not found" });
    if (run.ownerUserId !== user.id) throw new ForbiddenException({ code: "ROOM_HOST_REQUIRED", message: "Only the room host can list sponsorship requests" });
    return (this.prisma as any).sponsorshipRequest.findMany({ where: { runId }, orderBy: { createdAt: "desc" } });
  }

  async approve(user: AuthenticatedUser, runId: string, requestId: string) {
    const outcome = await this.retrySerializable(async (tx) => {
      const db = tx as any;
      const request = await db.sponsorshipRequest.findUnique({ where: { id: requestId } });
      if (!request || request.runId !== runId) throw new NotFoundException({ code: "SPONSORSHIP_REQUEST_NOT_FOUND", message: "Sponsorship request not found" });
      const run = await tx.storyRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException({ code: "STORY_RUN_NOT_FOUND", message: "Story run not found" });
      if (run.ownerUserId !== user.id || request.hostUserId !== user.id) throw new ForbiddenException({ code: "ROOM_HOST_REQUIRED", message: "Only the room host can approve sponsorship" });
      if (request.status === "APPROVED" && request.allowanceId) {
        return { request, allowance: await db.runCreditAllowance.findUnique({ where: { id: request.allowanceId } }), alreadyApproved: true };
      }
      if (request.status !== "PENDING") throw new ConflictException({ code: "SPONSORSHIP_REQUEST_NOT_PENDING", message: "Only pending sponsorship requests can be approved" });
      if (isRunTerminal(run.status)) throw new ConflictException({ code: "STORY_RUN_NOT_ACTIVE", message: "Sponsorship is unavailable after the run ends" });
      const participant = await tx.storyPlayer.findFirst({ where: { runId, userId: request.beneficiaryUserId, status: "active" } });
      if (!participant) throw new ConflictException({ code: "SPONSORSHIP_BENEFICIARY_NOT_ACTIVE", message: "The sponsored player is no longer active in this run" });

      const billing = parseRunBilling(run, readCreditConsumptionConfig().prices);
      if (billing.policyVersion !== "active_action_v1") throw new ConflictException({ code: "BILLING_POLICY_DOES_NOT_SUPPORT_SPONSORSHIP", message: "This run uses the legacy unlock policy" });
      const amount = billing.prices.sponsorshipPack;
      const fundingKey = `run-sponsor:${runId}:${request.id}`;
      const ledger = await this.credits.spendCredits({
        userId: user.id,
        amount,
        reason: "RUN_SPONSORSHIP",
        idempotencyKey: fundingKey,
        externalRef: request.id,
        metadata: { runId, requestId: request.id, beneficiaryUserId: request.beneficiaryUserId },
        tx
      });
      const allowance = await db.runCreditAllowance.create({
        data: {
          runId,
          sponsorUserId: user.id,
          beneficiaryUserId: request.beneficiaryUserId,
          fundedAmount: amount,
          remainingAmount: amount,
          fundingLedgerId: ledger.id,
          idempotencyKey: fundingKey
        }
      });
      const resolved = await db.sponsorshipRequest.update({
        where: { id: request.id },
        data: { status: "APPROVED", allowanceId: allowance.id, resolvedAt: new Date() }
      });
      await tx.eventLog.create({ data: { userId: user.id, runId, eventName: "sponsorship_approved", source: "credits", payload: { requestId: request.id, allowanceId: allowance.id, beneficiaryUserId: request.beneficiaryUserId, amount } } });
      return { request: resolved, allowance, alreadyApproved: false };
    });
    if (!outcome.alreadyApproved) {
      operationalMetrics.increment("sponsorship_request_total", { origin: outcome.request.origin, status: "APPROVED" });
      operationalMetrics.set("sponsorship_allowance_amount", { status: "ACTIVE" }, Number(outcome.allowance.remainingAmount || 0));
    }
    return outcome;
  }

  async decline(user: AuthenticatedUser, runId: string, requestId: string) {
    let transitioned = false;
    const outcome = await this.prisma.$transaction(async (tx) => {
      const request = await (tx as any).sponsorshipRequest.findUnique({ where: { id: requestId } });
      if (!request || request.runId !== runId) throw new NotFoundException({ code: "SPONSORSHIP_REQUEST_NOT_FOUND", message: "Sponsorship request not found" });
      const run = await tx.storyRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException({ code: "STORY_RUN_NOT_FOUND", message: "Story run not found" });
      if (run.ownerUserId !== user.id || request.hostUserId !== user.id) throw new ForbiddenException({ code: "ROOM_HOST_REQUIRED", message: "Only the room host can decline sponsorship" });
      if (request.status === "DECLINED") return request;
      if (request.status !== "PENDING") throw new ConflictException({ code: "SPONSORSHIP_REQUEST_NOT_PENDING", message: "Only pending sponsorship requests can be declined" });
      const declined = await (tx as any).sponsorshipRequest.update({ where: { id: request.id }, data: { status: "DECLINED", resolvedAt: new Date() } });
      transitioned = true;
      await tx.eventLog.create({ data: { userId: user.id, runId, eventName: "sponsorship_declined", source: "credits", payload: { requestId: request.id, beneficiaryUserId: request.beneficiaryUserId } } });
      return declined;
    });
    if (transitioned) operationalMetrics.increment("sponsorship_request_total", { origin: outcome.origin, status: outcome.status });
    return outcome;
  }

  async expireForRun(runId: string, tx?: Tx) {
    const operation = (db: Tx) => Promise.all([
      (db as any).runCreditAllowance.updateMany({ where: { runId, status: { in: ["ACTIVE", "EXHAUSTED"] } }, data: { status: "EXPIRED" } }),
      (db as any).sponsorshipRequest.updateMany({ where: { runId, status: "PENDING" }, data: { status: "EXPIRED", resolvedAt: new Date() } })
    ]);
    return tx ? operation(tx) : this.prisma.$transaction(operation);
  }

  private async requireParticipant(userId: string, runId: string, tx?: Tx) {
    const db = (tx || this.prisma) as any;
    const run = await db.storyRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException({ code: "STORY_RUN_NOT_FOUND", message: "Story run not found" });
    const participant = run.ownerUserId === userId || Boolean(await db.storyPlayer.findFirst({ where: { runId, userId, status: "active" } }));
    if (!participant) throw new ForbiddenException({ code: "RUN_PARTICIPANT_REQUIRED", message: "Only active run participants can access run credits" });
    return run;
  }

  private async retrySerializable<T>(operation: (tx: Tx) => Promise<T>) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
      } catch (error: any) {
        if (!isTransient(error) || attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1) ** 2));
      }
    }
    throw new Error("unreachable sponsorship transaction retry state");
  }
}

function isRunTerminal(status: string) {
  return ["completed", "chapter_generated", "closed", "expired", "failed", "cancelled", "creation_failed"].includes(String(status || "").toLowerCase());
}

function isTransient(error: any) {
  return ["P2034", "P2028", "P2002"].includes(String(error?.code || ""))
    || /40P01|40001|deadlock detected|write conflict/i.test(String(error?.message || error || ""));
}
