import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import templates, {
  type DestinyNetProjection,
  type PlayerActionIntent,
  type PlayerTurnProjection,
  type SettlementResult,
  type SettlementSnapshot,
} from "@ai-story/templates";
import type { WorldModuleRegistry } from "./world-module-registry.js";

const {
  DeterministicSettlementEngine,
  compileDestinyNetProjection,
  compilePlayerTurnProjection,
} = templates;

export type SharedRunFeedEntry = {
  worldTurnId: string;
  stateRevision: number;
  kind: "OPENING" | "PERSONAL" | "CROSS_PLAYER" | "WORLD";
  text: string;
  createdAt: string;
};

type IdempotencyRecord = {
  requestHash: string;
  result: SharedActionResult;
};

type SharedRunHead = {
  schemaVersion: "openovel_shared_run_v1";
  runId: string;
  worldId: string;
  actorIds: string[];
  snapshot: SettlementSnapshot;
  latestEnvelope: SettlementResult["envelope"] | null;
  projections: Record<string, PlayerTurnProjection>;
  feeds: Record<string, SharedRunFeedEntry[]>;
  idempotency: Record<string, IdempotencyRecord>;
  createdAt: string;
  updatedAt: string;
};

export type SharedActionInput = {
  runId: string;
  actorId: string;
  rawText: string;
  expectedStateRevision: number;
  idempotencyKey: string;
  intentType: PlayerActionIntent["intentType"];
  referencedEntityIds?: string[];
  proposedCapabilityId?: string;
  explicitCommitment?: boolean;
  explicitOrder?: boolean;
};

export type SharedActionResult = {
  kind: "ACCEPTED" | "REPLAYED";
  actionId: string;
  worldTurnId: string;
  stateRevision: number;
  projection: PlayerTurnProjection;
};

/**
 * File-backed asynchronous shared-world coordinator.
 *
 * It owns only typed settlement and actor-safe projections. Narrative models
 * consume these projections later and never become the source of world truth.
 */
export class MultiplayerWorldRuntime {
  private readonly engine = new DeterministicSettlementEngine();
  private readonly tails = new Map<string, Promise<void>>();

  constructor(
    private readonly root: string,
    private readonly worlds: WorldModuleRegistry,
  ) {}

  async createRun(input: { runId: string; worldId: string; actorIds: string[] }) {
    const runId = requiredId(input.runId, "SHARED_RUN_ID_INVALID");
    const { contract } = this.worlds.requireSharedWorld(input.worldId);
    const playableActors = new Set(contract.roles.map((role) => role.actorId));
    const actorIds = [...new Set(input.actorIds.map((actorId) => requiredId(actorId, "SHARED_ACTOR_ID_INVALID")))];
    if (!actorIds.length) throw new Error("SHARED_RUN_ACTORS_REQUIRED");
    for (const actorId of actorIds) {
      if (!playableActors.has(actorId)) throw new Error(`SHARED_ACTOR_NOT_PLAYABLE:${actorId}`);
    }

    return this.serial(runId, async () => {
      const existing = await this.readOptional(runId);
      if (existing) {
        if (existing.worldId !== contract.worldId || stable(existing.actorIds) !== stable(actorIds)) {
          throw new Error("SHARED_RUN_CREATE_CONFLICT");
        }
        return this.summary(existing);
      }
      const now = new Date().toISOString();
      const snapshot: SettlementSnapshot = {
        runId,
        state: structuredClone(contract.openingState),
        events: [],
        pending: [],
      };
      const feeds = Object.fromEntries(actorIds.map((actorId) => [actorId, [{
        worldTurnId: "G00",
        stateRevision: snapshot.state.revision,
        kind: "OPENING" as const,
        text: contract.roles.find((role) => role.actorId === actorId)!.destinyQuestion,
        createdAt: now,
      }]]));
      const head: SharedRunHead = {
        schemaVersion: "openovel_shared_run_v1",
        runId,
        worldId: contract.worldId,
        actorIds,
        snapshot,
        latestEnvelope: null,
        projections: {},
        feeds,
        idempotency: {},
        createdAt: now,
        updatedAt: now,
      };
      await this.write(head);
      return this.summary(head);
    });
  }

  async submitAction(input: SharedActionInput): Promise<SharedActionResult> {
    const runId = requiredId(input.runId, "SHARED_RUN_ID_INVALID");
    const key = requiredKey(input.idempotencyKey);
    const rawText = String(input.rawText || "").trim();
    if (!rawText) throw new Error("SHARED_ACTION_REQUIRED");
    if (rawText.length > 2_000) throw new Error("SHARED_ACTION_TOO_LONG");

    return this.serial(runId, async () => {
      const head = await this.read(runId);
      const requestHash = hash({
        actorId: input.actorId,
        rawText,
        expectedStateRevision: input.expectedStateRevision,
        intentType: input.intentType,
        referencedEntityIds: input.referencedEntityIds || [],
        proposedCapabilityId: input.proposedCapabilityId || null,
        explicitCommitment: Boolean(input.explicitCommitment),
        explicitOrder: Boolean(input.explicitOrder),
      });
      const prior = head.idempotency[key];
      if (prior) {
        if (prior.requestHash !== requestHash) throw new Error("IDEMPOTENCY_KEY_REUSED");
        return { ...structuredClone(prior.result), kind: "REPLAYED" };
      }
      if (!head.actorIds.includes(input.actorId)) throw new Error("SHARED_ACTOR_NOT_IN_RUN");
      const { contract, settlementPackage } = this.worlds.requireSharedWorld(head.worldId);
      const actionId = `${runId}.action.${randomUUID()}`;
      const intent: PlayerActionIntent = {
        actionId,
        runId,
        actorId: input.actorId,
        rawText,
        submittedAt: new Date().toISOString(),
        expectedStateRevision: input.expectedStateRevision,
        intentType: input.intentType,
        referencedEntityIds: [...new Set(input.referencedEntityIds || [])],
        ...(input.proposedCapabilityId ? { proposedCapabilityId: input.proposedCapabilityId } : {}),
        explicitCommitment: Boolean(input.explicitCommitment),
        explicitOrder: Boolean(input.explicitOrder),
        confidence: 1,
      };
      const outcome = this.engine.settle(contract, settlementPackage, head.snapshot, intent);
      if (outcome.kind === "CONFLICT") {
        throw new Error(`STATE_REVISION_CONFLICT:${outcome.expectedRevision}:${outcome.actualRevision}`);
      }
      if (outcome.kind === "REJECTED") throw new Error(outcome.code);
      if (outcome.kind !== "ACCEPTED") throw new Error("SHARED_SETTLEMENT_UNEXPECTED_REPLAY");

      const settledSnapshot = this.engine.applyDue(contract, outcome.result.snapshot);
      const projections = Object.fromEntries(head.actorIds.map((actorId) => [
        actorId,
        compilePlayerTurnProjection({
          contract,
          snapshot: settledSnapshot,
          envelope: outcome.result.envelope,
          actorId,
        }),
      ]));
      const now = new Date().toISOString();
      for (const actorId of head.actorIds) {
        const projection = projections[actorId];
        const entries = feedEntries(projection, outcome.result.fallbackText, now);
        head.feeds[actorId] = [...(head.feeds[actorId] || []), ...entries];
      }
      const result: SharedActionResult = {
        kind: "ACCEPTED",
        actionId,
        worldTurnId: outcome.result.envelope.worldTurnId,
        stateRevision: settledSnapshot.state.revision,
        projection: projections[input.actorId],
      };
      head.snapshot = settledSnapshot;
      head.latestEnvelope = outcome.result.envelope;
      head.projections = projections;
      head.idempotency[key] = { requestHash, result };
      head.updatedAt = now;
      await this.write(head);
      return structuredClone(result);
    });
  }

  async getRun(runId: string) {
    return this.summary(await this.read(runId));
  }

  async feed(runId: string, actorId: string) {
    const head = await this.authorizedActor(runId, actorId);
    return structuredClone(head.feeds[actorId] || []);
  }

  async projection(runId: string, actorId: string) {
    const head = await this.authorizedActor(runId, actorId);
    return structuredClone(head.projections[actorId] || null);
  }

  async impact(runId: string, actorId: string) {
    const projection = await this.projection(runId, actorId);
    if (!projection) return { personal: [], crossPlayer: [], world: [], delayed: [] };
    const head = await this.read(runId);
    const delayed = head.snapshot.pending
      .filter((entry) => entry.appliedAtRevision === undefined)
      .filter((entry) => entry.event.affectedActorIds.includes(actorId) || entry.event.visibility.scope === "PUBLIC")
      .map((entry) => ({
        summary: entry.event.affectedPlayerSummaries[actorId] || entry.event.publicSummary,
        status: entry.event.status,
      }));
    return {
      personal: projection.personalEchoes,
      crossPlayer: projection.crossPlayerEchoes,
      world: projection.worldEchoes,
      delayed,
    };
  }

  async clues(runId: string, actorId: string) {
    const projection = await this.projection(runId, actorId);
    return projection ? {
      private: projection.privateFacts,
      public: projection.publicFacts,
      inferable: projection.inferableSignals,
    } : { private: [], public: [], inferable: [] };
  }

  async destinyNet(runId: string, actorId: string): Promise<DestinyNetProjection | null> {
    const head = await this.authorizedActor(runId, actorId);
    const projection = head.projections[actorId];
    if (!projection) return null;
    const { contract } = this.worlds.requireSharedWorld(head.worldId);
    return compileDestinyNetProjection(projection, contract);
  }

  private async authorizedActor(runId: string, actorId: string) {
    const head = await this.read(requiredId(runId, "SHARED_RUN_ID_INVALID"));
    if (!head.actorIds.includes(actorId)) throw new Error("SHARED_ACTOR_NOT_IN_RUN");
    return head;
  }

  private summary(head: SharedRunHead) {
    return {
      schemaVersion: head.schemaVersion,
      runId: head.runId,
      worldId: head.worldId,
      actorIds: [...head.actorIds],
      stateRevision: head.snapshot.state.revision,
      latestWorldTurnId: head.latestEnvelope?.worldTurnId || null,
      createdAt: head.createdAt,
      updatedAt: head.updatedAt,
    };
  }

  private async readOptional(runId: string): Promise<SharedRunHead | null> {
    try {
      return JSON.parse(await readFile(this.headPath(runId), "utf8")) as SharedRunHead;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async read(runId: string) {
    const head = await this.readOptional(runId);
    if (!head) throw new Error("SHARED_RUN_NOT_FOUND");
    return head;
  }

  private async write(head: SharedRunHead) {
    const dir = path.join(this.root, "shared-runs", head.runId);
    await mkdir(dir, { recursive: true });
    const destination = path.join(dir, "head.json");
    const temporary = path.join(dir, `.head.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(head, null, 2)}\n`, "utf8");
    await rename(temporary, destination);
  }

  private headPath(runId: string) {
    return path.join(this.root, "shared-runs", runId, "head.json");
  }

  private serial<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(runId) || Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = prior.catch(() => undefined).then(() => gate);
    this.tails.set(runId, tail);
    return prior.catch(() => undefined).then(() => this.withFileLease(runId, operation)).finally(() => {
      release();
      if (this.tails.get(runId) === tail) this.tails.delete(runId);
    });
  }

  private async withFileLease<T>(runId: string, operation: () => Promise<T>) {
    const dir = path.join(this.root, "shared-runs", runId);
    await mkdir(dir, { recursive: true });
    const lockPath = path.join(dir, "commit.lock");
    const token = randomUUID();
    const deadline = Date.now() + 5_000;
    while (true) {
      try {
        const handle = await open(lockPath, "wx");
        try {
          await handle.writeFile(JSON.stringify({ token, createdAt: new Date().toISOString() }), "utf8");
        } finally {
          await handle.close();
        }
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const details = await stat(lockPath).catch(() => null);
        if (details && Date.now() - details.mtimeMs > 30_000) {
          await unlink(lockPath).catch(() => undefined);
          continue;
        }
        if (Date.now() >= deadline) throw new Error("SHARED_RUN_BUSY");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    try {
      return await operation();
    } finally {
      const current = await readFile(lockPath, "utf8").catch(() => "");
      if (current.includes(token)) await unlink(lockPath).catch(() => undefined);
    }
  }
}

function feedEntries(
  projection: PlayerTurnProjection,
  originFallback: string,
  createdAt: string,
): SharedRunFeedEntry[] {
  const entries: SharedRunFeedEntry[] = [];
  if (projection.personalEchoes.length) {
    entries.push({
      worldTurnId: projection.worldTurnId,
      stateRevision: projection.stateRevision,
      kind: "PERSONAL",
      text: originFallback,
      createdAt,
    });
  }
  for (const echo of projection.crossPlayerEchoes) {
    entries.push({
      worldTurnId: projection.worldTurnId,
      stateRevision: projection.stateRevision,
      kind: "CROSS_PLAYER",
      text: echo.summary,
      createdAt,
    });
  }
  for (const echo of projection.worldEchoes) {
    entries.push({
      worldTurnId: projection.worldTurnId,
      stateRevision: projection.stateRevision,
      kind: "WORLD",
      text: echo.summary,
      createdAt,
    });
  }
  return entries;
}

function requiredId(value: string, code: string) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/u.test(id)) throw new Error(code);
  return id;
}

function requiredKey(value: string) {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(key)) throw new Error("IDEMPOTENCY_KEY_INVALID");
  return key;
}

function stable(value: unknown) {
  return JSON.stringify(value);
}

function hash(value: unknown) {
  return createHash("sha256").update(stable(value)).digest("hex");
}
