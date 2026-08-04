import { createHash } from "node:crypto";

export const SCENE_DRAFT_SCHEMA = "omw.scene-draft.v1" as const;
export const ASSEMBLY_MANIFEST_SCHEMA = "omw.assembly-manifest.v1" as const;
export const narrativeSlotIds = [
  "PLAYER_RESULT",
  "IMMEDIATE_REACTION",
  "SCENE_TRANSITION",
  "WORLD_PRESSURE",
  "DECISION_STOP",
] as const;

export type NarrativeSlotId = (typeof narrativeSlotIds)[number];
export type ScenePhase = "ACTION_PHASE" | "AFTER_PHASE";
export type ExpressionOwner = "NARRATOR" | "COMPOSED" | "FALLBACK";
export type SceneSnapshot = {
  sceneId: string;
  timeLabel: string;
  locationLabel: string;
  presentActorIds: string[];
};
export type SceneTransitionPlan = {
  beforeScene: SceneSnapshot;
  narrationScene: SceneSnapshot;
  afterScene: SceneSnapshot;
  transitionRequired: boolean;
  arrivingActorIds: string[];
  departingActorIds: string[];
  elapsedTimeLabel?: string;
};
export type DramaticSceneGuidance = {
  dramaticTask: string;
  sourceMechanisms: string[];
  scenePatterns: Array<{
    dramaticFunction: string;
    openingPressure: string;
    orderedBeats: Array<{
      ordinal: number;
      actorRole: string;
      observableMove: string;
      sceneFunction: string;
      reactionCue: string;
    }>;
    dialogueTactics: Array<{
      actorRole: string;
      surfaceMove: string;
      hiddenRisk: string;
      cadenceRule: string;
    }>;
    blockingPrinciples: string[];
    objectPowerMoves: Array<{
      objectLabel: string;
      observableUse: string;
      powerMeaning: string;
    }>;
    transferableTechniques: string[];
    forbiddenFlattening: string[];
  }>;
};
export type NarrativeFactTicket = {
  ticketId: string;
  slot: NarrativeSlotId;
  scenePhase: ScenePhase;
  required: boolean;
  sourceRefs: string[];
  requiredMeaning: string;
  /** The server owns irreversible causal prose; the model owns ordinary scene prose. */
  expressionOwner?: "NARRATOR" | "PROTECTED";
  /** Author-reviewed prose inserted verbatim when expressionOwner is PROTECTED. */
  protectedText?: string;
};
export type BeatManifest = {
  beatId: string;
  sourceRef: string;
  transition: SceneTransitionPlan;
  tickets: NarrativeFactTicket[];
  /** Dramatic techniques from source decomposition; never current-world facts. */
  dramaticGuidance?: DramaticSceneGuidance;
};
export type SceneDraft = {
  schemaVersion: typeof SCENE_DRAFT_SCHEMA;
  draftId: string;
  owner: ExpressionOwner;
  slots: Partial<Record<NarrativeSlotId, string>>;
};
export type FallbackSlotProvenance = {
  surfaceSource: "STORY_PACKAGE";
  sourceRef: string;
  coveredTicketIds: string[];
};
export type PlayerVisibleFallbackDraft = SceneDraft & {
  owner: "FALLBACK";
  surfaceProvenance: Partial<Record<NarrativeSlotId, FallbackSlotProvenance>>;
};
export type SlotAudit = {
  slot: NarrativeSlotId;
  coveredTicketIds: string[];
  p0ConflictCodes: string[];
  scenePhaseValid: boolean;
};
export type SceneAudit = {
  draftId: string;
  valid: boolean;
  slots: SlotAudit[];
  reason?: string;
};
export type AssemblyManifest = {
  schemaVersion: typeof ASSEMBLY_MANIFEST_SCHEMA;
  draftId: string;
  owner: ExpressionOwner;
  slotOrder: NarrativeSlotId[];
  slotOwners: Partial<Record<NarrativeSlotId, "NARRATOR" | "PROTECTED" | "FALLBACK">>;
  ticketOwnership: Record<string, NarrativeSlotId>;
  slotHashes: Partial<Record<NarrativeSlotId, string>>;
  finalTextHash: string;
  invariants: {
    singleOwnerPerSlot: true;
    stopSlotIsTerminal: true;
    noUnownedServerProse: true;
    scenePhasesValid: true;
    mustVisibleCovered: true;
    noCrossSlotDuplicate: true;
    fallbackSurfaceValidated: true;
  };
};
export type AssembledScene = { text: string; manifest: AssemblyManifest };

export function validateBeatManifest(manifest: BeatManifest): BeatManifest {
  if (!nonEmpty(manifest?.beatId) || !nonEmpty(manifest?.sourceRef)) {
    throw new Error("BEAT_MANIFEST_IDENTITY_INVALID");
  }
  validateTransition(manifest.transition);
  if (!Array.isArray(manifest.tickets) || !manifest.tickets.length) {
    throw new Error("BEAT_MANIFEST_TICKETS_MISSING");
  }
  validateDramaticGuidance(manifest.dramaticGuidance);
  const ticketIds = new Set<string>();
  for (const ticket of manifest.tickets) {
    if (!nonEmpty(ticket.ticketId) || ticketIds.has(ticket.ticketId)) {
      throw new Error("BEAT_MANIFEST_TICKET_ID_INVALID");
    }
    if (!narrativeSlotIds.includes(ticket.slot) || !nonEmpty(ticket.requiredMeaning)) {
      throw new Error(`BEAT_MANIFEST_TICKET_INVALID:${ticket.ticketId}`);
    }
    if (!Array.isArray(ticket.sourceRefs) || !ticket.sourceRefs.length
      || ticket.sourceRefs.some((sourceRef) => !nonEmpty(sourceRef))) {
      throw new Error(`BEAT_MANIFEST_TICKET_SOURCE_MISSING:${ticket.ticketId}`);
    }
    if (ticket.scenePhase !== phaseForSlot(ticket.slot)) {
      throw new Error(`BEAT_MANIFEST_TICKET_PHASE_INVALID:${ticket.ticketId}`);
    }
    const expressionOwner = ticket.expressionOwner || "NARRATOR";
    if (expressionOwner !== "NARRATOR" && expressionOwner !== "PROTECTED") {
      throw new Error(`BEAT_MANIFEST_TICKET_OWNER_INVALID:${ticket.ticketId}`);
    }
    if (expressionOwner === "PROTECTED" && !nonEmpty(ticket.protectedText)) {
      throw new Error(`BEAT_MANIFEST_PROTECTED_TEXT_MISSING:${ticket.ticketId}`);
    }
    if (expressionOwner === "NARRATOR" && ticket.protectedText !== undefined) {
      throw new Error(`BEAT_MANIFEST_UNOWNED_PROTECTED_TEXT:${ticket.ticketId}`);
    }
    ticketIds.add(ticket.ticketId);
  }
  for (const slot of ["PLAYER_RESULT", "DECISION_STOP"] as const) {
    if (!manifest.tickets.some((ticket) => ticket.slot === slot && ticket.required)) {
      throw new Error(`BEAT_MANIFEST_REQUIRED_SLOT_MISSING:${slot}`);
    }
  }
  if (manifest.transition.transitionRequired
    && !manifest.tickets.some((ticket) => ticket.slot === "SCENE_TRANSITION" && ticket.required)) {
    throw new Error("BEAT_MANIFEST_TRANSITION_TICKET_MISSING");
  }
  return manifest;
}

function validateDramaticGuidance(guidance?: DramaticSceneGuidance) {
  if (!guidance) return;
  if (!nonEmpty(guidance.dramaticTask)
    || !Array.isArray(guidance.sourceMechanisms)
    || guidance.sourceMechanisms.some((item) => !nonEmpty(item))
    || !Array.isArray(guidance.scenePatterns)) {
    throw new Error("BEAT_MANIFEST_DRAMATIC_GUIDANCE_INVALID");
  }
  for (const pattern of guidance.scenePatterns) {
    if (!nonEmpty(pattern.dramaticFunction)
      || !nonEmpty(pattern.openingPressure)
      || !Array.isArray(pattern.orderedBeats)
      || !Array.isArray(pattern.dialogueTactics)
      || !Array.isArray(pattern.blockingPrinciples)
      || !Array.isArray(pattern.objectPowerMoves)
      || !Array.isArray(pattern.transferableTechniques)
      || !Array.isArray(pattern.forbiddenFlattening)) {
      throw new Error("BEAT_MANIFEST_SCENE_PATTERN_INVALID");
    }
  }
}

export function validateSceneDraft(draft: SceneDraft, manifest: BeatManifest): SceneDraft {
  if (draft?.schemaVersion !== SCENE_DRAFT_SCHEMA || !nonEmpty(draft.draftId)) {
    throw new Error("SCENE_DRAFT_IDENTITY_INVALID");
  }
  if (draft.owner !== "NARRATOR" && draft.owner !== "COMPOSED" && draft.owner !== "FALLBACK") {
    throw new Error("SCENE_DRAFT_OWNER_INVALID");
  }
  const keys = Object.keys(draft.slots || {});
  if (keys.some((key) => !narrativeSlotIds.includes(key as NarrativeSlotId))) {
    throw new Error("SCENE_DRAFT_SLOT_UNKNOWN");
  }
  if (keys.some((key) => !nonEmpty(draft.slots[key as NarrativeSlotId]))) {
    throw new Error("SCENE_DRAFT_SLOT_EMPTY");
  }
  const protectedSlots = new Set(
    manifest.tickets
      .filter((ticket) => (ticket.expressionOwner || "NARRATOR") === "PROTECTED")
      .map((ticket) => ticket.slot),
  );
  if (draft.owner === "NARRATOR") {
    for (const slot of protectedSlots) {
      if (nonEmpty(draft.slots[slot])) throw new Error(`SCENE_DRAFT_PROTECTED_SLOT_CLAIMED:${slot}`);
    }
  }
  for (const ticket of manifest.tickets.filter((candidate) => candidate.required)) {
    if (draft.owner === "NARRATOR" && protectedSlots.has(ticket.slot)) continue;
    if (!nonEmpty(draft.slots[ticket.slot])) {
      throw new Error(`SCENE_DRAFT_REQUIRED_SLOT_MISSING:${ticket.slot}`);
    }
  }
  if (!manifest.transition.transitionRequired && nonEmpty(draft.slots.SCENE_TRANSITION)) {
    throw new Error("SCENE_DRAFT_UNAUTHORIZED_TRANSITION");
  }
  validateNoCrossSlotDuplicate(draft);
  return draft;
}

/**
 * Creates one final scene draft with deterministic ownership per slot. The
 * Narrator can never rewrite or expand a protected player result, document
 * transfer, signature, order, or scene transition.
 */
export function composeProtectedSceneDraft(
  narratorDraft: SceneDraft,
  manifest: BeatManifest,
): SceneDraft {
  validateBeatManifest(manifest);
  validateSceneDraft(narratorDraft, manifest);
  if (narratorDraft.owner !== "NARRATOR") {
    throw new Error("PROTECTED_COMPOSITION_REQUIRES_NARRATOR_DRAFT");
  }
  const protectedTickets = manifest.tickets.filter(
    (ticket) => (ticket.expressionOwner || "NARRATOR") === "PROTECTED",
  );
  if (!protectedTickets.length) return narratorDraft;
  const slots = { ...narratorDraft.slots };
  for (const ticket of protectedTickets) {
    if (nonEmpty(slots[ticket.slot])) {
      throw new Error(`SCENE_DRAFT_PROTECTED_SLOT_CLAIMED:${ticket.slot}`);
    }
    slots[ticket.slot] = ticket.protectedText!.trim();
  }
  const composed: SceneDraft = {
    ...narratorDraft,
    owner: "COMPOSED",
    slots,
  };
  return validateSceneDraft(composed, manifest);
}

/**
 * A complete fallback still has one expression owner, but any irreversible
 * causal slot has one semantic source: the server-owned protected ticket.
 * Binding happens before validation so fallback prose only owns literary slots.
 */
export function bindProtectedFallbackDraft(
  draft: PlayerVisibleFallbackDraft,
  manifest: BeatManifest,
): PlayerVisibleFallbackDraft {
  const slots = { ...draft.slots };
  const bound = new Map<NarrativeSlotId, string>();
  for (const ticket of manifest.tickets.filter((candidate) => (
    candidate.expressionOwner === "PROTECTED"
  ))) {
    const protectedText = normalize(ticket.protectedText || "");
    if (!protectedText) {
      throw new Error("FALLBACK_PROTECTED_TEXT_MISSING:" + ticket.slot);
    }
    const previous = bound.get(ticket.slot);
    if (previous && previous !== protectedText) {
      throw new Error("FALLBACK_PROTECTED_TEXT_CONFLICT:" + ticket.slot);
    }
    bound.set(ticket.slot, protectedText);
    slots[ticket.slot] = protectedText;
  }
  return { ...draft, slots };
}

/**
 * Fallback is a complete player surface. Its ordinary prose is independently
 * authored, while protected causal slots must equal the server-owned surface.
 * must come from a Story Package surface and declare the tickets it renders.
 */
export function validatePlayerVisibleFallbackDraft(
  draft: PlayerVisibleFallbackDraft,
  manifest: BeatManifest,
): PlayerVisibleFallbackDraft {
  validateSceneDraft(draft, manifest);
  if (draft.owner !== "FALLBACK") throw new Error("FALLBACK_EXPRESSION_OWNER_INVALID");
  const allowedKeys = new Set([
    "schemaVersion", "draftId", "owner", "slots", "surfaceProvenance",
  ]);
  if (Object.keys(draft as unknown as Record<string, unknown>)
    .some((key) => !allowedKeys.has(key))) {
    throw new Error("FALLBACK_DRAFT_FIELD_UNKNOWN");
  }
  const provenance = draft.surfaceProvenance;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    throw new Error("FALLBACK_SURFACE_PROVENANCE_MISSING");
  }
  const seenTicketIds = new Set<string>();
  for (const slot of narrativeSlotIds) {
    const text = draft.slots[slot];
    const item = provenance[slot];
    if (!nonEmpty(text)) {
      if (item !== undefined) throw new Error(`FALLBACK_PROVENANCE_WITHOUT_SLOT:${slot}`);
      continue;
    }
    if (!item || item.surfaceSource !== "STORY_PACKAGE" || !nonEmpty(item.sourceRef)) {
      throw new Error(`FALLBACK_SURFACE_NOT_AUTHORED:${slot}`);
    }
    const protectedTexts = [...new Set(manifest.tickets
      .filter((ticket) => ticket.slot === slot && ticket.expressionOwner === "PROTECTED")
      .map((ticket) => normalize(ticket.protectedText || ""))
      .filter(Boolean))];
    if (protectedTexts.length > 1) {
      throw new Error("FALLBACK_PROTECTED_TEXT_CONFLICT:" + slot);
    }
    if (protectedTexts.length === 1 && normalize(text) !== protectedTexts[0]) {
      throw new Error("FALLBACK_PROTECTED_SLOT_MISMATCH:" + slot);
    }
    const expected = manifest.tickets
      .filter((ticket) => ticket.slot === slot)
      .map((ticket) => ticket.ticketId)
      .sort();
    const actual = [...new Set(item.coveredTicketIds || [])].sort();
    if (actual.length !== (item.coveredTicketIds || []).length
      || actual.length !== expected.length
      || actual.some((ticketId, index) => ticketId !== expected[index])) {
      throw new Error(`FALLBACK_TICKET_OWNERSHIP_INVALID:${slot}`);
    }
    for (const ticketId of actual) {
      if (seenTicketIds.has(ticketId)) throw new Error(`FALLBACK_TICKET_DUPLICATE:${ticketId}`);
      seenTicketIds.add(ticketId);
    }
  }
  for (const ticket of manifest.tickets.filter((candidate) => candidate.required)) {
    if (!seenTicketIds.has(ticket.ticketId)) {
      throw new Error(`FALLBACK_REQUIRED_TICKET_MISSING:${ticket.ticketId}`);
    }
  }
  return draft;
}

export function assembleSceneDraft(input: {
  manifest: BeatManifest;
  draft: SceneDraft;
  audit: SceneAudit;
}): AssembledScene {
  const manifest = validateBeatManifest(input.manifest);
  const draft = validateSceneDraft(input.draft, manifest);
  if (draft.owner === "FALLBACK") {
    validatePlayerVisibleFallbackDraft(draft as PlayerVisibleFallbackDraft, manifest);
  }
  validateSceneAudit(input.audit, manifest, draft);
  const slotOrder = narrativeSlotIds.filter((slot) => nonEmpty(draft.slots[slot]));
  if (slotOrder.at(-1) !== "DECISION_STOP") {
    throw new Error("SCENE_DRAFT_STOP_NOT_TERMINAL");
  }
  const text = slotOrder.map((slot) => normalize(draft.slots[slot]!)).join("\n\n");
  if (!text) throw new Error("SCENE_DRAFT_EMPTY");
  const ticketOwnership = Object.fromEntries(
    manifest.tickets.map((ticket) => [ticket.ticketId, ticket.slot]),
  );
  const slotHashes = Object.fromEntries(
    slotOrder.map((slot) => [slot, sha256(normalize(draft.slots[slot]!))]),
  );
  const protectedSlots = new Set(
    manifest.tickets
      .filter((ticket) => (ticket.expressionOwner || "NARRATOR") === "PROTECTED")
      .map((ticket) => ticket.slot),
  );
  const slotOwners = Object.fromEntries(slotOrder.map((slot) => [
    slot,
    draft.owner === "FALLBACK" ? "FALLBACK" : protectedSlots.has(slot) ? "PROTECTED" : "NARRATOR",
  ]));
  return {
    text,
    manifest: {
      schemaVersion: ASSEMBLY_MANIFEST_SCHEMA,
      draftId: draft.draftId,
      owner: draft.owner,
      slotOrder,
      slotOwners,
      ticketOwnership,
      slotHashes,
      finalTextHash: sha256(text),
      invariants: {
        singleOwnerPerSlot: true,
        stopSlotIsTerminal: true,
        noUnownedServerProse: true,
        scenePhasesValid: true,
        mustVisibleCovered: true,
        noCrossSlotDuplicate: true,
        fallbackSurfaceValidated: true,
      },
    },
  };
}

export function phaseForSlot(slot: NarrativeSlotId): ScenePhase {
  return slot === "PLAYER_RESULT" || slot === "IMMEDIATE_REACTION"
    ? "ACTION_PHASE"
    : "AFTER_PHASE";
}

function validateSceneAudit(audit: SceneAudit, manifest: BeatManifest, draft: SceneDraft) {
  if (!audit || audit.draftId !== draft.draftId || !audit.valid) {
    throw new Error(`SCENE_AUDIT_REJECTED:${audit?.reason || "INVALID"}`);
  }
  const auditBySlot = new Map(audit.slots.map((slot) => [slot.slot, slot]));
  const covered = new Set<string>();
  for (const ticket of manifest.tickets.filter((candidate) => candidate.required)) {
    const slot = auditBySlot.get(ticket.slot);
    if (!slot || !slot.scenePhaseValid || slot.p0ConflictCodes.length
      || !slot.coveredTicketIds.includes(ticket.ticketId)) {
      throw new Error(`SCENE_AUDIT_TICKET_UNCOVERED:${ticket.ticketId}`);
    }
    if (covered.has(ticket.ticketId)) {
      throw new Error(`SCENE_AUDIT_TICKET_DUPLICATE:${ticket.ticketId}`);
    }
    covered.add(ticket.ticketId);
  }
  for (const slot of audit.slots) {
    if (slot.p0ConflictCodes.length || !slot.scenePhaseValid) {
      throw new Error(`SCENE_AUDIT_SLOT_INVALID:${slot.slot}`);
    }
    for (const ticketId of slot.coveredTicketIds) {
      const ticket = manifest.tickets.find((candidate) => candidate.ticketId === ticketId);
      if (!ticket || ticket.slot !== slot.slot) {
        throw new Error(`SCENE_AUDIT_TICKET_WRONG_SLOT:${ticketId}`);
      }
    }
  }
}

function validateTransition(plan: SceneTransitionPlan) {
  for (const [label, scene] of Object.entries({
    beforeScene: plan?.beforeScene,
    narrationScene: plan?.narrationScene,
    afterScene: plan?.afterScene,
  })) {
    if (!scene || !nonEmpty(scene.sceneId) || !nonEmpty(scene.timeLabel)
      || !nonEmpty(scene.locationLabel) || !Array.isArray(scene.presentActorIds)
      || scene.presentActorIds.some((actorId) => !nonEmpty(actorId))) {
      throw new Error(`SCENE_TRANSITION_${label.toUpperCase()}_INVALID`);
    }
  }
  if (!sameScene(plan.beforeScene, plan.narrationScene)) {
    throw new Error("SCENE_TRANSITION_ACTION_SCENE_DRIFT");
  }
  const actuallyChanged = !sameScene(plan.narrationScene, plan.afterScene);
  if (plan.transitionRequired !== actuallyChanged) {
    throw new Error("SCENE_TRANSITION_FLAG_MISMATCH");
  }
  const beforeActors = new Set(plan.narrationScene.presentActorIds);
  const afterActors = new Set(plan.afterScene.presentActorIds);
  const arrivals = plan.afterScene.presentActorIds.filter((id) => !beforeActors.has(id));
  const departures = plan.narrationScene.presentActorIds.filter((id) => !afterActors.has(id));
  if (!sameSet(arrivals, plan.arrivingActorIds) || !sameSet(departures, plan.departingActorIds)) {
    throw new Error("SCENE_TRANSITION_CAST_DELTA_INVALID");
  }
}

function sameScene(left: SceneSnapshot, right: SceneSnapshot) {
  return left.sceneId === right.sceneId
    && left.timeLabel === right.timeLabel
    && left.locationLabel === right.locationLabel
    && sameSet(left.presentActorIds, right.presentActorIds);
}
function sameSet(left: string[], right: string[]) {
  return left.length === right.length && left.every((value) => right.includes(value));
}
function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function normalize(value: string) {
  return String(value || "").replace(/\r\n?/gu, "\n").trim();
}
function validateNoCrossSlotDuplicate(draft: SceneDraft) {
  const seenSlots = new Map<string, NarrativeSlotId>();
  const seenSentences = new Map<string, NarrativeSlotId>();
  for (const slot of narrativeSlotIds) {
    const text = draft.slots[slot];
    if (!nonEmpty(text)) continue;
    const normalized = normalizeSurface(text);
    const duplicateSlot = seenSlots.get(normalized);
    if (duplicateSlot) {
      throw new Error(`SCENE_DRAFT_DUPLICATE_SLOT:${duplicateSlot}:${slot}`);
    }
    seenSlots.set(normalized, slot);
    for (const sentence of surfaceSentences(text)) {
      const duplicateSentence = seenSentences.get(sentence);
      if (duplicateSentence) {
        throw new Error(`SCENE_DRAFT_DUPLICATE_SENTENCE:${duplicateSentence}:${slot}`);
      }
      seenSentences.set(sentence, slot);
    }
  }
}
function surfaceSentences(value: string) {
  return normalize(value)
    .split(/(?<=[\u3002\uFF01\uFF1F.!?])|\n+/u)
    .map(normalizeSurface)
    .filter((sentence) => sentence.length >= 8);
}
function normalizeSurface(value: string) {
  return normalize(value).replace(/\s+/gu, " ");
}
function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
