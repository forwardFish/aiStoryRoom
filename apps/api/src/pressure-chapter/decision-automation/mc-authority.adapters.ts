import {
  compareCanonicalText,
  isSha256,
  sha256Canonical,
  validateRunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  loadPublishedSangtianAiDecisionPolicyV1,
  loadSangtianPressureChapterBeatAuthoringV1,
  type PublishedSangtianAiDecisionPolicyV1,
  type SangtianNpcDecisionPolicyInputV1,
  type SangtianNpcDecisionResolutionV1,
} from "@ai-story/templates";
import {
  BeatSubmitPolicyV1,
  computeBeatSubmitPolicyInputHashV1,
  type BeatSubmitPolicyInputV1,
} from "../beat-submit-policy";
import { validateOrchestratorStateV1 } from "../orchestrator/validation";
import {
  DECISION_AUTOMATION_ERROR_CODES as ERROR,
  failDecisionAutomation,
} from "./errors";
import type {
  BeatSubmitAuthorityPortV1,
  NpcCouncilDecisionPolicyPortV1,
  PreparedNpcDecisionResolutionV1,
  ResolvedBeatSubmitAuthorityV1,
} from "./contracts";

const SHA256 = /^[a-f0-9]{64}$/u;

/**
 * MC bridge to accepted MA. It supplies only already-frozen Beat closure and
 * seat-control authority, then seals MA's exact input/output pair.
 */
export class AcceptedBeatSubmitAuthorityAdapterV1
implements BeatSubmitAuthorityPortV1 {
  constructor(private readonly policy = new BeatSubmitPolicyV1()) {}

  resolve(
    context: Parameters<BeatSubmitAuthorityPortV1["resolve"]>[0],
  ): ResolvedBeatSubmitAuthorityV1 {
    const route = validateRunRouteSnapshotV1(context.routeSnapshot);
    const chapter = validateOrchestratorStateV1(context.chapter);
    const active = chapter.activeDecision;
    if (
      !active
      || chapter.phase !== "ACTIVE"
      || chapter.runId !== route.runId
      || chapter.routeHash !== route.routeHash
      || context.projection.key.runId !== route.runId
      || context.projection.key.chapterRuntimeId !== chapter.chapterRuntimeId
      || context.projection.routeHash !== route.routeHash
      || context.projection.chapterId !== chapter.currentChapterId
      || context.projection.nextDecisionPin?.decisionPointId !== active.decisionPointId
      || context.seatAuthority.runId !== route.runId
      || context.seatAuthority.routeHash !== route.routeHash
      || !isSha256(context.seatAuthority.stateHash)
    ) {
      invalid("beatSubmit.context", "ACTIVE_BOUND_AUTHORITY_REQUIRED");
    }

    const authoring = loadSangtianPressureChapterBeatAuthoringV1(
      chapter.currentChapterId,
    );
    const beat = authoring.beats.find(
      (candidate) => candidate.catalogDecisionPointRef === active.decisionPointId,
    );
    if (!beat) invalid("beatSubmit.beat", "AUTHORING_BINDING_NOT_FOUND");

    const requiredSeatIds = active.seats
      .filter((seat) => seat.requirement === "REQUIRED")
      .map((seat) => seat.seatId);
    const controllerTopology = requiredSeatIds.map((seatId) => {
      const activeSeat = active.seats.find((seat) => seat.seatId === seatId);
      const authority = context.seatAuthority.seatControls.find(
        (seat) => seat.seatId === seatId,
      );
      if (!activeSeat || !authority) {
        return invalid("beatSubmit.controllerTopology", `MISSING_${seatId}`);
      }
      if (
        !authority.activeControllerId.trim()
        || !Number.isSafeInteger(authority.controlEpoch)
        || authority.controlEpoch < 1
        || !isSha256(authority.submissionFenceToken)
      ) {
        return invalid("beatSubmit.controllerTopology", `INVALID_${seatId}`);
      }
      return {
        seatId,
        mode: authority.mode,
        activeControllerId: authority.activeControllerId,
        controlEpoch: authority.controlEpoch,
        authorityStateHash: context.seatAuthority.stateHash,
        // Exact HTTP/recovery replay is validated against the accepted human
        // command before MA is invoked. Preserve the submitter as the one
        // human participant so MA can deterministically reproduce the same
        // plan without treating the already-recorded action as new authority.
        requiresResolution: seatId === context.viewerSeatId
          ? true
          : activeSeat.completion === "PENDING"
            && activeSeat.actionCount === 0
            && activeSeat.actionIds.length === 0,
      };
    });
    const inputWithoutHash: Omit<BeatSubmitPolicyInputV1, "inputHash"> = {
      schemaVersion: "pressure_beat_submit_policy_input_v1",
      beat: {
        beatId: beat.beatId,
        closesChapter: beat.closesChapter,
      },
      participantMode: route.participantMode,
      viewerSeatId: context.viewerSeatId,
      requiredSeatIds,
      controllerTopology,
    };
    const input: BeatSubmitPolicyInputV1 = {
      ...inputWithoutHash,
      inputHash: computeBeatSubmitPolicyInputHashV1(inputWithoutHash),
    };
    const plan = this.policy.plan(input);
    const body = {
      schemaVersion: "pressure_resolved_beat_submit_authority_v1" as const,
      input: structuredClone(input),
      plan: structuredClone(plan),
    };
    return deepFreeze({ ...body, authorityHash: sha256Canonical(body) });
  }
}

/**
 * MC bridge to the final accepted MB artifact. It compiles the exact MB input
 * from current viewer-safe Working authority and returns MB's untouched,
 * self-hashed resolution. No score or fallback rule is reimplemented here.
 */
export class AcceptedNpcCouncilDecisionPolicyAdapterV1
implements NpcCouncilDecisionPolicyPortV1 {
  private readonly published: PublishedSangtianAiDecisionPolicyV1;

  constructor(options: Readonly<{ releaseRoot?: string }> = {}) {
    this.published = loadPublishedSangtianAiDecisionPolicyV1(options);
  }

  get artifactSha256(): string {
    return this.published.artifactSha256;
  }

  get identityPolicyArtifactSha256(): string {
    return this.published.identityPolicyArtifactSha256;
  }

  resolve(
    context: Parameters<NpcCouncilDecisionPolicyPortV1["resolve"]>[0],
  ): PreparedNpcDecisionResolutionV1 {
    const route = validateRunRouteSnapshotV1(context.routeSnapshot);
    const chapter = validateOrchestratorStateV1(context.chapter);
    const active = chapter.activeDecision;
    const authority = context.seatAuthority;
    if (
      !active
      || chapter.phase !== "ACTIVE"
      || chapter.runId !== route.runId
      || chapter.routeHash !== route.routeHash
      || context.projection.key.runId !== route.runId
      || context.projection.key.chapterRuntimeId !== chapter.chapterRuntimeId
      || context.projection.routeHash !== route.routeHash
      || context.projection.chapterId !== chapter.currentChapterId
      || context.projection.nextDecisionPin?.decisionPointId !== active.decisionPointId
      || authority.mode !== "AI_ACTIVE"
      || authority.requiresResolution !== true
      || !authority.activeControllerId.trim()
      || !Number.isSafeInteger(authority.controlEpoch)
      || authority.controlEpoch < 1
      || !isSha256(authority.submissionFenceToken)
      || !isSha256(authority.authorityStateHash)
    ) {
      invalid("npcCouncil.context", "ACTIVE_BOUND_AI_AUTHORITY_REQUIRED");
    }
    const activeSeat = active.seats.find((seat) => seat.seatId === authority.seatId);
    if (
      !activeSeat
      || activeSeat.requirement !== "REQUIRED"
      || activeSeat.completion !== "PENDING"
      || activeSeat.actionCount !== 0
      || activeSeat.actionIds.length !== 0
    ) {
      invalid("npcCouncil.seat", "PENDING_REQUIRED_AI_SEAT_REQUIRED");
    }

    const profile = this.published.identityPolicy.seatProfiles.find(
      (candidate) => candidate.seatId === authority.seatId,
    );
    if (!profile) invalid("npcCouncil.seatIdentity", "PROFILE_NOT_FOUND");
    const eligibleActionTypes = [...new Set(context.eligibleActionTypes)]
      .sort(compareCanonicalText);
    if (!eligibleActionTypes.length || !eligibleActionTypes.includes("DEFAULT_PASS")) {
      invalid("npcCouncil.eligibleActionTypes", "PUBLISHED_SET_REQUIRED");
    }

    const authoritativeFacts = scalarEntries(context.projection.state.facts)
      .map(([factRef, value]) => ({
        factRef,
        state: "ACTIVE" as const,
        value,
        tags: tagsForAuthorityRef(factRef),
      }));
    const chapterWorkingDeltas = [
      ...Object.entries(context.projection.state.counters).map(([deltaRef, value]) => ({
        deltaRef,
        state: value === 0 ? "INACTIVE" as const : "ACTIVE" as const,
        value,
        tags: tagsForAuthorityRef(deltaRef),
      })),
      ...context.projection.state.satisfiedRequirementIds.map((deltaRef) => ({
        deltaRef,
        state: "ACTIVE" as const,
        value: true,
        tags: tagsForAuthorityRef(deltaRef),
      })),
    ].sort((left, right) => compareCanonicalText(left.deltaRef, right.deltaRef));
    const commitments = [...context.projection.commitments.values()]
      .map((commitment) => ({
        commitmentId: commitment.commitmentId,
        status: commitmentStatus(commitment.operation),
        tags: tagsForAuthorityRef(commitment.commitmentId),
      }))
      .sort((left, right) => compareCanonicalText(
        left.commitmentId,
        right.commitmentId,
      ));
    // Formal actions for the currently open DecisionPoint may already exist
    // during crash recovery. They are part of the batch being reproduced, not
    // prior resource authority. Excluding their pending reservations keeps the
    // final MB input stable between first execution and action-only replay.
    const currentDecisionActionIds = new Set(
      [...context.projection.acceptedActions.values()]
        .filter((item) => (
          item.action.chapterRuntimeId === chapter.chapterRuntimeId
          && item.action.decisionPointId === active.decisionPointId
        ))
        .map((item) => item.action.actionId),
    );
    const resources = compileResources(
      context.projection,
      currentDecisionActionIds,
    );
    const controllerAuthority = {
      mode: authority.mode,
      activeControllerId: authority.activeControllerId,
      controlEpoch: authority.controlEpoch,
      authorityStateHash: authority.authorityStateHash,
      requiresResolution: authority.requiresResolution,
    };
    const identityStateHash = sha256Canonical({
      schemaVersion: "pressure_npc_identity_state_binding_v1",
      runId: route.runId,
      routeHash: route.routeHash,
      chapterRuntimeId: chapter.chapterRuntimeId,
      decisionPointId: active.decisionPointId,
      seatId: authority.seatId,
      identityProfileRef: profile.identityProfileRef,
      controllerAuthority,
      workingStateHash: context.projection.stateHash,
      commitmentIds: commitments.map((item) => item.commitmentId),
      resourceIds: resources.map((item) => item.resourceId),
    });
    const inputWithoutHash: Omit<SangtianNpcDecisionPolicyInputV1, "inputHash"> = {
      schemaVersion: "sangtian_npc_decision_policy_input_v1",
      runId: route.runId,
      routeHash: route.routeHash,
      runSeed: route.runSeed,
      contentPackageVersion: route.contentPackageVersion,
      contentPackageSha256: route.contentPackageSha256,
      chapterRuntimeId: chapter.chapterRuntimeId,
      chapterId: chapter.currentChapterId,
      decisionPointId: active.decisionPointId,
      seatId: authority.seatId,
      eligibleActionTypes,
      controllerAuthority,
      seatIdentity: {
        identityProfileRef: profile.identityProfileRef,
        identityStateHash,
      },
      authoritativeFacts,
      chapterWorkingDeltas,
      commitments,
      resources,
      authorityGrants: [],
      capabilities: [],
    };
    const policyInput: SangtianNpcDecisionPolicyInputV1 = {
      ...inputWithoutHash,
      inputHash: sha256Canonical(inputWithoutHash),
    };
    const resolution = this.published.select(policyInput);
    validateResolution(resolution, policyInput, this.published);
    const body = {
      schemaVersion: "pressure_prepared_npc_decision_resolution_v1" as const,
      seatId: authority.seatId,
      input: structuredClone(policyInput),
      resolution: structuredClone(resolution),
    };
    return deepFreeze({ ...body, bindingHash: sha256Canonical(body) });
  }
}

function validateResolution(
  resolution: SangtianNpcDecisionResolutionV1,
  input: SangtianNpcDecisionPolicyInputV1,
  published: PublishedSangtianAiDecisionPolicyV1,
): void {
  const { resolutionHash, ...body } = resolution;
  if (
    resolution.schemaVersion !== "sangtian_npc_decision_resolution_v1"
    || resolution.inputHash !== input.inputHash
    || resolution.policyHash !== published.artifactSha256
    || resolution.identityPolicyArtifactSha256
      !== published.identityPolicyArtifactSha256
    || resolution.providerCallCount !== 0
    || !input.eligibleActionTypes.includes(resolution.actionType)
    || !SHA256.test(resolutionHash)
    || sha256Canonical(body) !== resolutionHash
  ) {
    invalid("npcCouncil.resolution", "FINAL_MB_BINDING_INVALID");
  }
}

function scalarEntries(
  facts: Readonly<Record<string, unknown>>,
): Array<[string, string | number | boolean | null]> {
  return Object.entries(facts)
    .filter((entry): entry is [string, string | number | boolean | null] => (
      entry[1] === null
      || typeof entry[1] === "string"
      || typeof entry[1] === "number"
      || typeof entry[1] === "boolean"
    ))
    .sort(([left], [right]) => compareCanonicalText(left, right));
}

function compileResources(
  projection: Parameters<NpcCouncilDecisionPolicyPortV1["resolve"]>[0]["projection"],
  excludedSourceActionIds: ReadonlySet<string>,
) {
  const byResource = new Map<string, { available: number; reserved: number }>();
  for (const reservation of projection.pendingReservations.values()) {
    if (excludedSourceActionIds.has(reservation.sourceActionId)) continue;
    const current = byResource.get(reservation.resourceId) ?? {
      available: 0,
      reserved: 0,
    };
    current.available += reservation.amount;
    if (reservation.status === "RESERVED") current.reserved += reservation.amount;
    byResource.set(reservation.resourceId, current);
  }
  return [...byResource.entries()]
    .sort(([left], [right]) => compareCanonicalText(left, right))
    .map(([resourceId, values]) => ({
      resourceId,
      available: values.available,
      reserved: values.reserved,
      tags: tagsForAuthorityRef(resourceId),
    }));
}

function commitmentStatus(operation: "CREATE" | "FULFILL" | "BREAK" | "CANCEL") {
  switch (operation) {
    case "CREATE": return "ACTIVE" as const;
    case "FULFILL": return "FULFILLED" as const;
    case "BREAK": return "BROKEN" as const;
    case "CANCEL": return "CANCELLED" as const;
  }
}

/** Generic tokenization only; it does not know or copy any MB score rule. */
function tagsForAuthorityRef(reference: string): string[] {
  const normalized = reference
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toUpperCase();
  const tags = new Set<string>();
  if (normalized) tags.add(normalized);
  for (const token of normalized.split("_")) {
    if (token.length > 1) tags.add(token);
  }
  return [...tags].sort(compareCanonicalText);
}

function invalid(path: string, detail: string): never {
  return failDecisionAutomation(
    ERROR.AUTHORITY_MISMATCH,
    `MC authority compilation failed at ${path}`,
    { path, detail },
  );
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
