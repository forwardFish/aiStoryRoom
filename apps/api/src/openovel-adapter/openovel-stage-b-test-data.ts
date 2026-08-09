import { HttpException } from "@nestjs/common";
import { creditRequestHash } from "../credits/credit-policy";
import {
  ReconciledOpenNovelAdapterService,
  openNovelActionIdempotencyKey,
  openNovelChargeIdempotencyKey,
  openNovelCommitEventId,
  openNovelPlayerActionId,
  openNovelRevisionNodeId,
  openNovelRevisionNodeIndex,
} from "./reconciled-openovel-adapter.service";
import { OPENOVEL_ENGINE_VERSION, OPENOVEL_RUNTIME_MODE } from "./openovel-runtime.client";

export const user = {
  id: "user-stage-b",
  openid: "openid-stage-b",
  email: null,
  emailVerifiedAt: null,
  nickname: "Stage B",
  authMethod: "PASSWORD" as const,
  authIdentityId: null,
};

export const prices = {
  currency: "WORLD_CREDITS",
  runCreate: 20,
  standardAction: 1,
  customAction: 2,
  complexAction: 2,
  sponsorshipPack: 10,
};

export type Deferred<T = void> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function stageBEnding() {
  return {
    schemaVersion: "openovel_ending_v1",
    scope: "PART",
    endingKey: "guarded_people_bore_responsibility",
    title: "守土担责",
    finalSceneNarrative: "最后一幕已经由权威 Head 固定。",
    protagonistFate: "问责落到了总督自己名下。",
    aftermath: ["证据仍可追索。"],
    sourceTurnId: "T20",
    sourceRevision: 20,
    playerEvidence: {
      schemaVersion: "openovel_player_ending_evidence_v1",
      endingKey: "guarded_people_bore_responsibility",
      scope: "PART",
      partId: "PART-01",
      partCompletionStatus: "HANDOFF_READY",
      sourceTurnId: "T20",
      sourceRevision: 20,
      causes: [{
        sourceTurnId: "T20",
        sourceRevision: 20,
        sourceEventId: "event-t20",
        authority: "PREDICATE",
        visibility: "PLAYER",
        criterion: "GOVERNOR_RESPONSIBILITY",
        factText: "总督本人已经进入明确问责范围。",
        direction: "DECISIVE",
      }],
      reveal: null,
    },
  };
}

export function committedResult(runId: string, submissionId: string) {
  return {
    runId,
    turnId: "T20",
    turnNumber: 20,
    submissionId,
    narration: "诏书念完，终局事实没有再改变。",
    options: [],
    warnings: [],
    storyComplete: true,
    ending: stageBEnding(),
    committedAt: "2026-08-09T12:00:00.000Z",
    narrator: {
      model: "deepseek-chat",
      usage: { inputTokens: 100, outputTokens: 40 },
      latencyMs: 10,
    },
  };
}

export function publicRuntime(runId: string, turnNumber = 19, status = "READY") {
  return {
    runId,
    worldId: "sangtian",
    roleId: "zhejiang_governor",
    runtimeMode: OPENOVEL_RUNTIME_MODE,
    turnNumber,
    status,
    canon: "权威 Canon",
    recentCanon: "最近一幕",
    prologueNarrative: "",
    ending: status === "COMPLETED" ? stageBEnding() : null,
    options: turnNumber === 19 ? [{ id: "T20_A", label: "完成最后提交。" }] : [],
    jobs: {},
    updatedAt: "2026-08-09T12:00:00.000Z",
  } as any;
}

export function statusMatches(actual: string, expected: unknown) {
  if (typeof expected === "string") return actual === expected;
  if (expected && typeof expected === "object" && Array.isArray((expected as any).in)) {
    return (expected as any).in.includes(actual);
  }
  return true;
}

