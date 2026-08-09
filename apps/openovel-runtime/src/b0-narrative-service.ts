import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { jsonrepair } from "jsonrepair";
import type { OpenNovelProvider } from "./types.js";
import {
  B0NarrativeRuntimeErrorV1,
  beginB0NarrativeValidationV1,
  claimB0NarrativeJobV1,
  createB0NarrativeJobV1,
  failB0NarrativeJobV1,
  heartbeatB0NarrativeJobV1,
  publishB0NarrativeJobV1,
  recoverB0NarrativeJobV1,
  upsertB0NarrativeJobV1,
  type B0NarrativeCommitManifestV1,
  type B0NarrativeInputV1,
  type B0NarrativeJobV1,
  type B0NarrativeOutputV1,
  type B0NarrativePublicationV1,
} from "./b0-narrative-runtime.js";

export interface B0NarrativeGeneratorV1 {
  generate(input: B0NarrativeInputV1): Promise<B0NarrativeOutputV1>;
}

export type B0NarrativeProcessResultV1 = {
  job: B0NarrativeJobV1;
  publication: B0NarrativePublicationV1;
  replayed: boolean;
};

export class ProviderB0NarrativeGeneratorV1 implements B0NarrativeGeneratorV1 {
  constructor(private readonly provider: OpenNovelProvider) {}

  async generate(input: B0NarrativeInputV1): Promise<B0NarrativeOutputV1> {
    const result = await this.provider.generate({
      profile: "narrator",
      messages: [
        {
role: "system",
content: [
  "You are a deterministic narrative renderer, not a rules engine.",
  "Return exactly one JSON object whose only field is prose.",
  "Write two to four concise sentences in the requested locale.",
  "Every factual statement must be a paraphrase of the supplied recipient-safe results.",
  "Do not repeat input keys, identifiers, hashes or schema metadata.",
  "Do not invent facts, outcomes, resources, relationships, capabilities, knowledge or hidden identities.",
  "Do not identify an undisclosed source actor.",
].join("\n"),
        },
        {
role: "user",
content: JSON.stringify(b0NarrativeProseBriefV1(input)),
        },
      ],
      temperature: 0,
      maxTokens: 500,
      json: true,
      jsonSchema: {
        name: "b0_narrative_prose_v1",
        schema: b0NarrativeProseJsonSchemaV1(),
      },
      stream: false,
    });
    try {
      const parsed = JSON.parse(jsonrepair(result.text)) as Record<string, unknown>;
      if (!parsed || Array.isArray(parsed) || typeof parsed.prose !== "string") {
        throw new Error("response must contain a prose string");
      }
      return assembleB0NarrativeOutputV1(input, parsed.prose);
    } catch (error) {
      throw new B0NarrativeRuntimeErrorV1(
        "NARRATIVE_PROVIDER_OUTPUT_INVALID",
        `Narrative provider returned invalid JSON: ${(error as Error).message}`,
      );
    }
  }
}

export class FileB0NarrativeJobRepositoryV1 {
  private readonly tails = new Map<string, Promise<void>>();

  constructor(private readonly root: string) {}

  async enqueue(input: B0NarrativeInputV1, now: string): Promise<{ job: B0NarrativeJobV1; created: boolean }> {
    return this.serial(input.jobKey, async () => {
      const existingJob = await this.readOptional<B0NarrativeJobV1>(this.jobPath(input.jobKey));
      const existingInput = await this.readOptional<B0NarrativeInputV1>(this.inputPath(input.jobKey));
      const candidate = createB0NarrativeJobV1(input, now);
      if ((existingJob && !existingInput) || (!existingJob && existingInput)) {
        throw repositoryError("NARRATIVE_REPOSITORY_INCOMPLETE", `Narrative repository is incomplete for ${input.jobKey}.`);
      }
      if (existingInput && existingInput.inputHash !== input.inputHash) {
        throw repositoryError("NARRATIVE_JOB_KEY_CONFLICT", `Narrative input for ${input.jobKey} is immutable.`);
      }
      const result = upsertB0NarrativeJobV1(existingJob, candidate);
      if (result.created) {
        await this.writeAtomic(this.inputPath(input.jobKey), input);
        await this.writeAtomic(this.jobPath(input.jobKey), result.job);
      }
      return result;
    });
  }

  async getJob(jobKey: string): Promise<B0NarrativeJobV1> {
    return this.readRequired(this.jobPath(jobKey), "NARRATIVE_JOB_NOT_FOUND");
  }

  async getInput(jobKey: string): Promise<B0NarrativeInputV1> {
    return this.readRequired(this.inputPath(jobKey), "NARRATIVE_INPUT_NOT_FOUND");
  }

  async getPublication(jobKey: string): Promise<B0NarrativePublicationV1 | null> {
    return this.readOptional(this.publicationPath(jobKey));
  }

  async claim(input: {
    jobKey: string;
    workerId: string;
    now: string;
    leaseDurationMs: number;
  }): Promise<{ job: B0NarrativeJobV1; replayed: boolean }> {
    return this.serial(input.jobKey, async () => {
      const job = await this.getJob(input.jobKey);
      const result = claimB0NarrativeJobV1({ ...input, job });
      if (result.job !== job) await this.writeAtomic(this.jobPath(input.jobKey), result.job);
      return result;
    });
  }

  async heartbeat(input: {
    jobKey: string;
    workerId: string;
    leaseEpoch: number;
    now: string;
    leaseDurationMs: number;
  }): Promise<B0NarrativeJobV1> {
    return this.serial(input.jobKey, async () => {
      const job = heartbeatB0NarrativeJobV1({
        ...input,
        job: await this.getJob(input.jobKey),
      });
      await this.writeAtomic(this.jobPath(input.jobKey), job);
      return job;
    });
  }

  async beginValidation(input: {
    jobKey: string;
    workerId: string;
    leaseEpoch: number;
    now: string;
  }): Promise<B0NarrativeJobV1> {
    return this.serial(input.jobKey, async () => {
      const job = beginB0NarrativeValidationV1({
        ...input,
        job: await this.getJob(input.jobKey),
      });
      await this.writeAtomic(this.jobPath(input.jobKey), job);
      return job;
    });
  }

  async fail(input: {
    jobKey: string;
    workerId: string;
    leaseEpoch: number;
    now: string;
    failureCode: string;
  }): Promise<B0NarrativeJobV1> {
    return this.serial(input.jobKey, async () => {
      const job = failB0NarrativeJobV1({
        ...input,
        job: await this.getJob(input.jobKey),
      });
      await this.writeAtomic(this.jobPath(input.jobKey), job);
      return job;
    });
  }

  async publish(input: {
    jobKey: string;
    output: B0NarrativeOutputV1;
    workerId: string;
    leaseEpoch: number;
    currentGuidanceVersion: number;
    now: string;
  }): Promise<B0NarrativeProcessResultV1> {
    return this.serial(input.jobKey, async () => {
      const result = publishB0NarrativeJobV1({
        ...input,
        job: await this.getJob(input.jobKey),
        narrativeInput: await this.getInput(input.jobKey),
      });
      const existingPublication = await this.getPublication(input.jobKey);
      if (existingPublication && existingPublication.contentHash !== result.publication.contentHash) {
        throw repositoryError("NARRATIVE_PUBLICATION_HASH_MISMATCH", `Published narrative ${input.jobKey} is immutable.`);
      }
      if (!existingPublication) await this.writeAtomic(this.publicationPath(input.jobKey), result.publication);
      if (!result.replayed) await this.writeAtomic(this.jobPath(input.jobKey), result.job);
      return {
        ...result,
        publication: existingPublication ?? result.publication,
      };
    });
  }

  async recover(input: {
    jobKey: string;
    manifest: B0NarrativeCommitManifestV1;
    appliedWorldSequence: number;
    now: string;
  }): Promise<B0NarrativeJobV1> {
    return this.serial(input.jobKey, async () => {
      const current = await this.getJob(input.jobKey);
      const recovered = recoverB0NarrativeJobV1({
        job: current,
        manifest: input.manifest,
        appliedWorldSequence: input.appliedWorldSequence,
        now: input.now,
      });
      if (recovered !== current) await this.writeAtomic(this.jobPath(input.jobKey), recovered);
      return recovered;
    });
  }

  private async readRequired<T>(file: string, code: string): Promise<T> {
    const value = await this.readOptional<T>(file);
    if (!value) throw repositoryError(code, `${path.basename(file)} does not exist.`);
    return value;
  }

  private async readOptional<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(file, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async writeAtomic(file: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, file);
  }

  private jobPath(jobKey: string): string {
    return path.join(this.jobDirectory(jobKey), "job.json");
  }

  private inputPath(jobKey: string): string {
    return path.join(this.jobDirectory(jobKey), "input.json");
  }

  private publicationPath(jobKey: string): string {
    return path.join(this.jobDirectory(jobKey), "publication.json");
  }

  private jobDirectory(jobKey: string): string {
    const keyHash = createHash("sha256").update(jobKey).digest("hex");
    return path.join(this.root, "b0-narrative-jobs", keyHash);
  }

  private serial<T>(jobKey: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(jobKey) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = prior.catch(() => undefined).then(() => gate);
    this.tails.set(jobKey, tail);
    return prior.catch(() => undefined)
      .then(() => this.withFileLock(jobKey, operation))
      .finally(() => {
        release();
        if (this.tails.get(jobKey) === tail) this.tails.delete(jobKey);
      });
  }

  private async withFileLock<T>(jobKey: string, operation: () => Promise<T>): Promise<T> {
    const directory = this.jobDirectory(jobKey);
    await mkdir(directory, { recursive: true });
    const lockPath = path.join(directory, "write.lock");
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
        if (Date.now() >= deadline) {
          throw repositoryError("NARRATIVE_REPOSITORY_BUSY", `Narrative job ${jobKey} repository is busy.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    try {
      return await operation();
    } finally {
      const lock = await readFile(lockPath, "utf8").catch(() => "");
      if (lock.includes(token)) await unlink(lockPath).catch(() => undefined);
    }
  }
}

export class B0NarrativeRuntimeV1 {
  constructor(
    private readonly repository: FileB0NarrativeJobRepositoryV1,
    private readonly generator: B0NarrativeGeneratorV1,
    private readonly leaseDurationMs = 30_000,
  ) {}

  enqueue(input: B0NarrativeInputV1, now = new Date().toISOString()) {
    return this.repository.enqueue(input, now);
  }

  async process(input: {
    jobKey: string;
    workerId: string;
    currentGuidanceVersion: number;
    now?: string;
  }): Promise<B0NarrativeProcessResultV1> {
    const now = input.now ?? new Date().toISOString();
    const claim = await this.repository.claim({
      jobKey: input.jobKey,
      workerId: input.workerId,
      now,
      leaseDurationMs: this.leaseDurationMs,
    });
    if (claim.job.status === "PUBLISHED") {
      const publication = await this.repository.getPublication(input.jobKey);
      if (!publication) {
        throw repositoryError("NARRATIVE_REPOSITORY_INCOMPLETE", `Published narrative ${input.jobKey} has no publication record.`);
      }
      return { job: claim.job, publication, replayed: true };
    }
    const epoch = claim.job.lease!.epoch;
    try {
      const immutableInput = await this.repository.getInput(input.jobKey);
      const generated = await this.generator.generate(immutableInput);
      await this.repository.beginValidation({
        jobKey: input.jobKey,
        workerId: input.workerId,
        leaseEpoch: epoch,
        now,
      });
      return await this.repository.publish({
        jobKey: input.jobKey,
        output: generated,
        workerId: input.workerId,
        leaseEpoch: epoch,
        currentGuidanceVersion: input.currentGuidanceVersion,
        now,
      });
    } catch (error) {
      const code = error instanceof B0NarrativeRuntimeErrorV1
        ? error.code
        : "NARRATIVE_GENERATION_FAILED";
      await this.repository.fail({
        jobKey: input.jobKey,
        workerId: input.workerId,
        leaseEpoch: epoch,
        now,
        failureCode: code,
      }).catch(() => undefined);
      throw error;
    }
  }
}

export function b0NarrativeProseJsonSchemaV1(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["prose"],
    properties: {
      prose: { type: "string", minLength: 20, maxLength: 6_000 },
    },
  };
}

function b0NarrativeProseBriefV1(input: B0NarrativeInputV1): Record<string, unknown> {
  return {
    schemaVersion: "b0-narrative-prose-brief-v1",
    locale: input.locale,
    styleDirectives: [...input.styleDirectives],
    allowedActorLabels: [...input.allowedActorLabels],
    results: input.deliveries.map((delivery) => ({
      resultKind: delivery.resultKind,
      summary: delivery.summary,
      outcomeStatus: delivery.outcomeStatus,
      changes: delivery.changes.map((change) => ({
        kind: change.kind,
        operation: change.operation,
        numericDelta: change.numericDelta,
      })),
      reasons: delivery.explanation.reasons.map((reason) => reason.summary),
      sourceDisclosure: delivery.sourceDisclosure === "FULL" ? "DISCLOSED" : "UNDISCLOSED",
    })),
  };
}

function assembleB0NarrativeOutputV1(input: B0NarrativeInputV1, prose: string): B0NarrativeOutputV1 {
  const revealedOriginActorIds = [...new Set(input.deliveries
    .filter((delivery) => delivery.sourceDisclosure === "FULL")
    .flatMap((delivery) => delivery.disclosedOriginActorIds))].sort();
  return {
    schemaVersion: "b0-narrative-output-v1",
    inputHash: input.inputHash,
    guidanceVersion: input.guidanceVersion,
    prose: prose.trim(),
    sourceResultIds: input.deliveries.map((delivery) => delivery.resultId),
    claims: input.deliveries.map((delivery) => ({
      sourceResultId: delivery.resultId,
      statement: delivery.summary,
    })),
    outcomeAssertions: input.deliveries
      .filter((delivery) => delivery.outcomeStatus !== null)
      .map((delivery) => ({
        sourceResultId: delivery.resultId,
        outcomeStatus: delivery.outcomeStatus!,
      })),
    changeAssertions: input.deliveries.flatMap((delivery) => delivery.changes.map((change, changeIndex) => ({
      sourceResultId: delivery.resultId,
      changeIndex,
      kind: change.kind,
      operation: change.operation,
      numericDelta: change.numericDelta,
    }))),
    revealedOriginActorIds,
    authoritativeFacts: [],
    stateMutations: [],
    relationshipMutations: [],
    capabilityMutations: [],
    knowledgeGrants: [],
  };
}

export function b0NarrativeOutputJsonSchemaV1(): Record<string, unknown> {
  const stringArray = { type: "array", items: { type: "string" } };
  const emptyAuthorityArray = { type: "array", maxItems: 0 };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion", "inputHash", "guidanceVersion", "prose", "sourceResultIds",
      "claims", "outcomeAssertions", "changeAssertions", "revealedOriginActorIds",
      "authoritativeFacts", "stateMutations", "relationshipMutations", "capabilityMutations", "knowledgeGrants",
    ],
    properties: {
      schemaVersion: { const: "b0-narrative-output-v1" },
      inputHash: { type: "string" },
      guidanceVersion: { type: "integer", minimum: 1 },
      prose: { type: "string", minLength: 20, maxLength: 6_000 },
      sourceResultIds: stringArray,
      claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["sourceResultId", "statement"],
          properties: { sourceResultId: { type: "string" }, statement: { type: "string" } },
        },
      },
      outcomeAssertions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["sourceResultId", "outcomeStatus"],
          properties: { sourceResultId: { type: "string" }, outcomeStatus: { type: "string" } },
        },
      },
      changeAssertions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["sourceResultId", "changeIndex", "kind", "operation", "numericDelta"],
          properties: {
            sourceResultId: { type: "string" },
            changeIndex: { type: "integer", minimum: 0 },
            kind: { type: "string" },
            operation: { type: "string" },
            numericDelta: { type: ["number", "null"] },
          },
        },
      },
      revealedOriginActorIds: stringArray,
      authoritativeFacts: emptyAuthorityArray,
      stateMutations: emptyAuthorityArray,
      relationshipMutations: emptyAuthorityArray,
      capabilityMutations: emptyAuthorityArray,
      knowledgeGrants: emptyAuthorityArray,
    },
  };
}

function repositoryError(code: string, message: string): B0NarrativeRuntimeErrorV1 {
  return new B0NarrativeRuntimeErrorV1(code, message);
}
