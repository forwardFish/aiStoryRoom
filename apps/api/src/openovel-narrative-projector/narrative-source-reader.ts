import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  B0ActionContractV1,
  B0BatchCommitManifestV1,
  B0SettlementResolutionV1,
  B0SettlementSnapshotV1,
} from "@ai-story/shared";
import {
  buildB0PublicationPlanV1,
  type B0PublicationPlanV1,
} from "@ai-story/templates";
import { PrismaService } from "../prisma.service";
import { assertB0StoredIntentEnvelopeV1 } from "../b0-settlement/b0-window-coordinator.core";
import type { StoryTaskLeaseFenceV1 } from "../story-task-outbox.contract";
import {
  OPENOVEL_NARRATIVE_SOURCE_SCHEMA_V1,
  type OpenNovelNarrativeSourceV1,
} from "./openovel-narrative-projector.contract";

type B0CommitEnvelopeV1 = {
  schemaVersion: "b0-commit-envelope-v1";
  batchId: string;
  snapshot: B0SettlementSnapshotV1;
  resolution: B0SettlementResolutionV1;
  manifest: B0BatchCommitManifestV1;
};

@Injectable()
export class NarrativeSourceReader {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async read(taskId: string, fence: StoryTaskLeaseFenceV1): Promise<OpenNovelNarrativeSourceV1> {
    const task = await this.prisma.storyTaskOutbox.findUnique({ where: { id: taskId } });
    if (!task || task.taskType !== "B0_NARRATIVE_GENERATION") {
      throw new NotFoundException({ code: "NARRATIVE_SOURCE_NOT_FOUND", message: "Narrative source task not found." });
    }
    if (task.id !== fence.taskId
      || task.status !== "running"
      || task.leaseOwner !== fence.leaseOwner
      || task.leaseVersion !== fence.leaseVersion) {
      throw new Error("NARRATIVE_SOURCE_LEASE_LOST");
    }
    const windowId = required(task.windowId, "windowId");
    const roleId = required(task.roleId, "roleId");
    const workflow = await this.prisma.resolutionWorkflow.findUnique({
      where: { windowId },
      select: { rulesOutputJson: true },
    });
    const envelope = assertCommitEnvelope(workflow?.rulesOutputJson);
    const intents = await this.readLockedIntents(envelope.resolution);
    const plan = buildB0PublicationPlanV1({
      snapshot: envelope.snapshot,
      resolution: envelope.resolution,
      intents,
    });
    const run = await this.prisma.storyRun.findUnique({
      where: { id: envelope.manifest.runId },
      select: { worldSequence: true, stateJson: true },
    });
    if (!run) throw new Error("NARRATIVE_SOURCE_RUN_MISSING");
    const roles = await this.prisma.storyRole.findMany({
      where: { runId: envelope.manifest.runId },
      select: { id: true, roleKey: true, roleName: true },
      orderBy: { id: "asc" },
    });
    const recipientDeliveries = plan.deliveries.filter((delivery) => delivery.recipientActorId === roleId);
    if (!recipientDeliveries.length) throw new Error("NARRATIVE_RECIPIENT_HAS_NO_DELIVERIES");
    const fullyDisclosedActors = new Set<string>([roleId]);
    for (const delivery of recipientDeliveries) {
      if (delivery.sourceDisclosure === "FULL") {
        delivery.originActorIds.forEach((actorId) => fullyDisclosedActors.add(actorId));
      }
    }
    const actorLabels = Object.fromEntries(roles
      .filter((role) => fullyDisclosedActors.has(role.id))
      .map((role) => [role.id, [role.roleName, role.roleKey]]));
    const forbiddenPhrases = roles
      .filter((role) => !fullyDisclosedActors.has(role.id))
      .flatMap((role) => [role.id, role.roleKey, role.roleName]);
    const fallbackLines = recipientDeliveries.flatMap((delivery) => [
      delivery.summary,
      ...delivery.explanation.reasons.map((reason) => reason.summary),
    ]);
    const forbiddenClaims = [
      envelope.manifest.commitHash,
      envelope.manifest.resolutionHash,
      "未披露的幕后主使",
      "undisclosed mastermind",
    ];
    return Object.freeze({
      schemaVersion: OPENOVEL_NARRATIVE_SOURCE_SCHEMA_V1,
      sourceKind: "B0_SETTLEMENT",
      sourceCommitHash: envelope.manifest.commitHash,
      runId: envelope.manifest.runId,
      nodeId: task.nodeId,
      windowId,
      roleId,
      entryType: "B0_NARRATIVE",
      visibility: "private",
      worldSequence: envelope.manifest.committedWorldSequence,
      dedupeKey: narrativeKey(envelope.batchId, roleId),
      providerInput: {
        manifest: envelope.manifest,
        publicationPlan: plan,
        recipientActorId: roleId,
        appliedWorldSequence: envelope.manifest.committedWorldSequence,
        guidance: {
          schemaVersion: "b0-narrative-guidance-v1",
          version: 1,
          locale: b0Locale(run.stateJson),
          narrativeKind: "SETTLEMENT_ROLE_VIEW",
          styleDirectives: [
            "Write a concise role-scoped account of the committed settlement.",
            "Preserve the supplied outcome and changes exactly.",
            "Do not infer hidden actors or undisclosed causes.",
          ],
          allowedActorLabels: roles
            .filter((role) => fullyDisclosedActors.has(role.id))
            .flatMap((role) => [role.roleName, role.roleKey]),
          forbiddenPhrases: [],
        },
        actorLabels,
      },
      fallbackLines,
      forbiddenPhrases,
      forbiddenClaims,
      sourceTaskResult: task.resultJson as Prisma.JsonValue | null,
    });
  }

  private async readLockedIntents(resolution: B0SettlementResolutionV1): Promise<B0ActionContractV1[]> {
    const intentIds = [...new Set(resolution.intentOutcomes.map((outcome) => outcome.intentId))].sort();
    const rows = await this.prisma.playerAction.findMany({
      where: { runId: resolution.runId, id: { in: intentIds } },
      select: { id: true, normalizedJson: true },
      orderBy: { id: "asc" },
    });
    const intents = rows.map((row) => {
      const envelope = row.normalizedJson ? assertB0StoredIntentEnvelopeV1(row.normalizedJson) : null;
      if (!envelope?.lockedIntent || envelope.lockedIntent.id !== row.id) {
        throw new Error(`NARRATIVE_STRUCTURED_SOURCE_MISSING:${row.id}`);
      }
      return envelope.lockedIntent;
    });
    if (intents.length !== intentIds.length) throw new Error("NARRATIVE_STRUCTURED_SOURCE_INCOMPLETE");
    return intents;
  }
}

function assertCommitEnvelope(value: unknown): B0CommitEnvelopeV1 {
  const record = jsonRecord(value);
  if (!record || record.schemaVersion !== "b0-commit-envelope-v1") {
    throw new Error("NARRATIVE_COMMIT_ENVELOPE_MISSING");
  }
  const envelope = record as unknown as B0CommitEnvelopeV1;
  if (!envelope.manifest?.authoritative
    || envelope.batchId !== envelope.manifest.batchId
    || envelope.snapshot?.id !== envelope.manifest.snapshotId
    || envelope.resolution?.resolutionHash !== envelope.manifest.resolutionHash) {
    throw new Error("NARRATIVE_COMMIT_ENVELOPE_INVALID");
  }
  return envelope;
}

function narrativeKey(batchId: string, roleId: string): string {
  return `b0-narrative:${batchId}:${roleId}:SETTLEMENT_ROLE_VIEW`;
}

function b0Locale(stateValue: unknown): string {
  const state = jsonRecord(stateValue);
  const b0 = jsonRecord(state?.b0);
  const locale = typeof b0?.locale === "string" ? b0.locale.trim() : "";
  return locale || String(process.env.B0_NARRATIVE_LOCALE || "en").trim() || "en";
}

function required(value: string | null | undefined, label: string): string {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`NARRATIVE_SOURCE_${label.toUpperCase()}_REQUIRED`);
  return result;
}

function jsonRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}
