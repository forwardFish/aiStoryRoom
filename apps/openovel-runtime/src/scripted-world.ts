import path from "node:path";
import { appendJsonl, readJson, readText, writeAtomic, writeJsonAtomic } from "./io.js";
import {
  composeAuthoredDecisionModules,
  type FactSettlementModule,
  type NextBeatPlannerModule,
  type PreparedAuthoredDecision,
  type PreparedFactSettlement,
} from "./decision-adapter.js";
import {
  bindProtectedFallbackDraft,
  SCENE_DRAFT_SCHEMA,
  type BeatManifest,
  type PlayerVisibleFallbackDraft,
  type SceneSnapshot,
} from "./scene-expression.js";
import type { AtomicTurnProjection } from "./atomic-turn.js";
import type { FileStoryWorkspace } from "./workspace.js";
import type { OpenNovelOption, RunMetadata } from "./types.js";
import type { WorkspacePaths } from "./paths.js";
import type { RuntimeWorldModule } from "./world-module-registry.js";
import { actionRejected } from "./runtime-errors.js";

export type ScriptedScene = {
  sceneId: string;
  timeLabel: string;
  locationLabel: string;
  situation: string;
  presentActors: Array<{ actorRef: string; displayName: string }>;
};

export type ScriptedTransition = {
  optionId: string;
  fromStepId: string;
  toStepId: string;
  sourceRef: string;
  settledNarrative: string;
  immediateReaction: string;
  worldPressure: string;
  stopCondition: string;
  continuationMoves?: string[];
  keyFactUpdates: Record<string, string | number | boolean>;
  nextScene: ScriptedScene;
  storyComplete?: boolean;
};

export type ScriptedStep = {
  stepId: string;
  options: Array<{
    id: string;
    label: string;
    intent: string;
    risk?: "low" | "medium" | "high";
  }>;
};

export type ScriptedWorldConfig = {
  worldId: string;
  roleId: string;
  title: string;
  packageVersion: string;
  brief: string;
  tone: string[];
  opening: {
    prologueNarrative: string;
    canon: string;
    stepId: string;
    scene: ScriptedScene;
    keyFacts: Record<string, string | number | boolean>;
  };
  steps: ScriptedStep[];
  transitions: ScriptedTransition[];
};

export type ScriptedWorldState = {
  schemaVersion: "openovel.scripted-world-state.v1";
  worldId: string;
  revision: number;
  currentStepId: string;
  scene: ScriptedScene;
  keyFacts: Record<string, string | number | boolean>;
  history: Array<{
    turnNumber: number;
    optionId: string;
    transitionSourceRef: string;
  }>;
  storyComplete: boolean;
};

type PreparedScriptedSettlement = {
  config: ScriptedWorldConfig;
  transition: ScriptedTransition;
  selectedOption: OpenNovelOption;
  beforeState: ScriptedWorldState;
  proposedState: ScriptedWorldState;
  event: {
    eventId: string;
    turnNumber: number;
    optionId: string;
    sourceRef: string;
    keyFactUpdates: Record<string, string | number | boolean>;
  };
};

const FRONTEND_FILES = [
  "header.md",
  "scene.md",
  "tone.md",
  "active-characters.md",
  "relationships.md",
  "constants.md",
  "open-threads.md",
  "active-pressures.md",
  "directed-beat.md",
  "pending-consequence.md",
  "forbidden.md",
] as const;

/**
 * Creates a complete solo world module from authored data. The factory owns
 * no story names and adds no world-specific branch to the runtime pipeline.
 */
export function createScriptedWorldModule(config: ScriptedWorldConfig): RuntimeWorldModule {
  validateConfig(config);
  const steps = new Map(config.steps.map((step) => [step.stepId, step]));
  const transitions = new Map(config.transitions.map((transition) => [
    `${transition.fromStepId}:${transition.optionId}`,
    transition,
  ]));

  const settlementModule: FactSettlementModule = {
    moduleId: "openovel.scripted-world.fact-settlement.v1",
    async currentOptions(workspace, runId) {
      const state = await readState(workspace, runId);
      if (state.storyComplete) return [];
      return optionsForStep(config, steps, state.currentStepId);
    },
    async settle(workspace, input) {
      const metadata = await workspace.metadata(input.runId);
      if (metadata.worldId !== config.worldId || metadata.roleId !== config.roleId) return null;
      const state = await readState(workspace, input.runId);
      if (state.storyComplete) throw actionRejected("RUN_COMPLETED");
      const selected = input.selectedOption;
      if (!selected) throw actionRejected("SCRIPTED_WORLD_BOUND_OPTION_REQUIRED");
      const available = optionsForStep(config, steps, state.currentStepId);
      const authoredOption = available.find((option) => option.id === selected.id);
      if (!authoredOption || authoredOption.label !== selected.label) {
        throw actionRejected("SCRIPTED_WORLD_OPTION_NOT_AVAILABLE");
      }
      const transition = transitions.get(`${state.currentStepId}:${selected.id}`);
      if (!transition) throw new Error("SCRIPTED_WORLD_TRANSITION_MISSING");
      const proposedState: ScriptedWorldState = {
        ...state,
        revision: state.revision + 1,
        currentStepId: transition.toStepId,
        scene: structuredClone(transition.nextScene),
        keyFacts: { ...state.keyFacts, ...transition.keyFactUpdates },
        history: [
          ...state.history,
          {
            turnNumber: input.turnNumber,
            optionId: selected.id,
            transitionSourceRef: transition.sourceRef,
          },
        ],
        storyComplete: transition.storyComplete === true,
      };
      const prepared: PreparedScriptedSettlement = {
        config,
        transition,
        selectedOption: authoredOption,
        beforeState: structuredClone(state),
        proposedState,
        event: {
          eventId: `${config.worldId}.turn.${input.turnNumber}.${selected.id}`,
          turnNumber: input.turnNumber,
          optionId: selected.id,
          sourceRef: transition.sourceRef,
          keyFactUpdates: structuredClone(transition.keyFactUpdates),
        },
      };
      return {
        selectedOption: authoredOption,
        storyComplete: proposedState.storyComplete,
        audit: {
          eventId: prepared.event.eventId,
          sourceRef: transition.sourceRef,
          changedKeyFacts: Object.keys(transition.keyFactUpdates),
        },
        payload: prepared,
      };
    },
    async commit(workspace, runId, settlement) {
      const prepared = requirePayload(settlement);
      const paths = workspace.paths(runId);
      await writeJsonAtomic(paths.worldState, prepared.proposedState);
      await appendJsonl(paths.worldEvents, prepared.event);
    },
    async projectCommit(workspace, runId, settlement): Promise<AtomicTurnProjection> {
      const prepared = requirePayload(settlement);
      const paths = workspace.paths(runId);
      const existingEvents = parseJsonLines(await readText(paths.worldEvents, ""));
      return {
        stateRevision: prepared.proposedState,
        causalEvents: [prepared.event],
        delayedEvents: [],
        projectionSummary: {
          eventId: prepared.event.eventId,
          currentStepId: prepared.proposedState.currentStepId,
          changedKeyFacts: Object.keys(prepared.transition.keyFactUpdates),
        },
        materializedViews: [
          {
            relativePath: relativeRunPath(paths.root, paths.worldState),
            format: "json",
            value: prepared.proposedState,
          },
          {
            relativePath: relativeRunPath(paths.root, paths.worldEvents),
            format: "jsonl",
            value: [...existingEvents, prepared.event],
          },
        ],
      };
    },
  };

  const nextBeatModule: NextBeatPlannerModule = {
    moduleId: "openovel.scripted-world.next-beat.v1",
    async plan(settlement) {
      return planScriptedBeat(requirePayload(settlement));
    },
    nextOptions(prepared) {
      const payload = requirePayload(prepared);
      return payload.proposedState.storyComplete
        ? []
        : optionsForStep(config, steps, payload.proposedState.currentStepId);
    },
  };

  return {
    worldId: config.worldId,
    seeder: {
      supports: ({ worldId, roleId }) => worldId === config.worldId && roleId === config.roleId,
      seed: (paths, metadata) => seedScriptedWorld(config, steps, paths, metadata),
    },
    decisionAdapter: composeAuthoredDecisionModules({
      settlement: settlementModule,
      nextBeat: nextBeatModule,
    }),
  };
}

async function seedScriptedWorld(
  config: ScriptedWorldConfig,
  steps: Map<string, ScriptedStep>,
  paths: WorkspacePaths,
  metadata: RunMetadata,
) {
  const openingOptions = optionsForStep(config, steps, config.opening.stepId);
  const state: ScriptedWorldState = {
    schemaVersion: "openovel.scripted-world-state.v1",
    worldId: config.worldId,
    revision: 0,
    currentStepId: config.opening.stepId,
    scene: structuredClone(config.opening.scene),
    keyFacts: structuredClone(config.opening.keyFacts),
    history: [],
    storyComplete: false,
  };
  const template = [
    ...FRONTEND_FILES.map((name) => `@include story/frontend/${name}`),
    "@include story/guidance/cards.auto.md",
    "@include story/guidance/cards.md",
    "",
  ].join("\n");
  const sections: Record<(typeof FRONTEND_FILES)[number], string> = {
    "header.md": `## Story\n\n- ${config.title}`,
    "scene.md": renderScene(config.opening.scene),
    "tone.md": `## Tone\n\n${config.tone.map((line) => `- ${line}`).join("\n")}`,
    "active-characters.md": [
      "## Active Characters",
      "",
      ...config.opening.scene.presentActors.map((actor) => `- ${actor.displayName}`),
    ].join("\n"),
    "relationships.md": "## Relationships\n\n- Only relationships established in Canon may be treated as durable facts.",
    "constants.md": renderKeyFacts(config.opening.keyFacts),
    "open-threads.md": `## Open Threads\n\n- ${config.opening.scene.situation}`,
    "active-pressures.md": `## Active Pressures\n\n- ${config.opening.scene.situation}`,
    "directed-beat.md": "",
    "pending-consequence.md": "",
    "forbidden.md": [
      "## Forbidden",
      "",
      "- Do not replace a settled player action with a different action.",
      "- Do not change a key fact unless the current transition changes it.",
      "- Do not expose internal IDs, rules, checks, or state fields in story prose.",
    ].join("\n"),
  };
  await Promise.all([
    writeAtomic(paths.brief, `# ${config.title}\n\n${config.brief.trim()}\n`),
    writeAtomic(paths.chapters, `${config.opening.canon.trim()}\n`),
    writeAtomic(paths.chaptersRecent, `${config.opening.canon.trim()}\n`),
    writeAtomic(paths.foregroundTemplate, template),
    writeAtomic(paths.cardsManifest, ""),
    writeAtomic(paths.cardsAutoManifest, ""),
    writeAtomic(paths.optionsGuidance, "# Options Guidance\n\n- Offer distinct player actions in ordinary language.\n"),
    writeAtomic(paths.qualityLog, "# Story Quality\n\nMinor texture issues are logged; key-fact conflicts block publication.\n"),
    writeAtomic(paths.arcLog, `# Arc\n\nCurrent step: ${config.opening.stepId}\n`),
    writeAtomic(paths.storyMemory, `# Story Memory\n\n${renderKeyFacts(config.opening.keyFacts)}\n`),
    writeJsonAtomic(paths.currentOptions, openingOptions),
    writeJsonAtomic(paths.worldState, state),
    writeAtomic(paths.worldEvents, ""),
    writeJsonAtomic(paths.jobs, { storykeeper: { status: "IDLE" }, updatedAt: metadata.createdAt }),
    ...FRONTEND_FILES.map((name) => writeAtomic(
      path.join(paths.frontendDir, name),
      sections[name] ? `${sections[name]}\n` : "",
    )),
  ]);
  return {
    openingOptions,
    prologueNarrative: config.opening.prologueNarrative,
  };
}

function planScriptedBeat(prepared: PreparedScriptedSettlement): PreparedAuthoredDecision {
  const { transition, proposedState, selectedOption } = prepared;
  const before = sceneSnapshot(prepared.beforeState.scene);
  const after = sceneSnapshot(transition.nextScene);
  const transitionRequired = before.sceneId !== after.sceneId;
  const sourceRef = transition.sourceRef;
  const tickets: BeatManifest["tickets"] = [
    {
      ticketId: `${prepared.event.eventId}.result`,
      slot: "PLAYER_RESULT",
      scenePhase: "ACTION_PHASE",
      required: true,
      sourceRefs: [sourceRef],
      requiredMeaning: transition.settledNarrative,
      expressionOwner: "PROTECTED",
      protectedText: transition.settledNarrative,
    },
    {
      ticketId: `${prepared.event.eventId}.reaction`,
      slot: "IMMEDIATE_REACTION",
      scenePhase: "ACTION_PHASE",
      required: true,
      sourceRefs: [sourceRef],
      requiredMeaning: transition.immediateReaction,
      expressionOwner: "NARRATOR",
    },
    ...(transitionRequired ? [{
      ticketId: `${prepared.event.eventId}.transition`,
      slot: "SCENE_TRANSITION" as const,
      scenePhase: "AFTER_PHASE" as const,
      required: true,
      sourceRefs: [sourceRef],
      requiredMeaning: `The scene moves to ${transition.nextScene.locationLabel} at ${transition.nextScene.timeLabel}.`,
      expressionOwner: "PROTECTED" as const,
      protectedText: `The scene moves to ${transition.nextScene.locationLabel} at ${transition.nextScene.timeLabel}.`,
    }] : []),
    {
      ticketId: `${prepared.event.eventId}.pressure`,
      slot: "WORLD_PRESSURE",
      scenePhase: "AFTER_PHASE",
      required: true,
      sourceRefs: [sourceRef],
      requiredMeaning: transition.worldPressure,
      expressionOwner: "NARRATOR",
    },
    {
      ticketId: `${prepared.event.eventId}.stop`,
      slot: "DECISION_STOP",
      scenePhase: "AFTER_PHASE",
      required: true,
      sourceRefs: [sourceRef],
      requiredMeaning: transition.stopCondition,
      expressionOwner: "NARRATOR",
    },
  ];
  const beatManifest: BeatManifest = {
    beatId: prepared.event.eventId,
    sourceRef,
    transition: {
      beforeScene: before,
      narrationScene: before,
      afterScene: after,
      transitionRequired,
      arrivingActorIds: after.presentActorIds.filter((id) => !before.presentActorIds.includes(id)),
      departingActorIds: before.presentActorIds.filter((id) => !after.presentActorIds.includes(id)),
    },
    tickets,
  };
  const slots: PlayerVisibleFallbackDraft["slots"] = {
    PLAYER_RESULT: transition.settledNarrative,
    IMMEDIATE_REACTION: transition.immediateReaction,
    ...(transitionRequired ? {
      SCENE_TRANSITION: `The scene moves to ${transition.nextScene.locationLabel} at ${transition.nextScene.timeLabel}.`,
    } : {}),
    WORLD_PRESSURE: transition.worldPressure,
    DECISION_STOP: transition.stopCondition,
  };
  const fallbackDraft = bindProtectedFallbackDraft({
    schemaVersion: SCENE_DRAFT_SCHEMA,
    draftId: `${prepared.event.eventId}.fallback`,
    owner: "FALLBACK",
    slots,
    surfaceProvenance: Object.fromEntries(Object.keys(slots).map((slot) => [
      slot,
      {
        surfaceSource: "STORY_PACKAGE",
        sourceRef,
        coveredTicketIds: tickets
          .filter((ticket) => ticket.slot === slot)
          .map((ticket) => ticket.ticketId),
      },
    ])),
  } as PlayerVisibleFallbackDraft, beatManifest);
  const playerVisibleFallback = {
    PLAYER_RESULT: transition.settledNarrative,
    IMMEDIATE_REACTION: transition.immediateReaction,
    ...(transitionRequired ? {
      SCENE_TRANSITION: `The scene moves to ${transition.nextScene.locationLabel} at ${transition.nextScene.timeLabel}.`,
    } : {}),
    WORLD_PRESSURE: transition.worldPressure,
    DECISION_STOP: transition.stopCondition,
  };
  const selectedWithContract: OpenNovelOption = {
    ...selectedOption,
    effect: {
      ...(selectedOption.effect || {}),
      beatContract: {
        sourceRef,
        objective: transition.nextScene.situation,
        moves: [transition.settledNarrative],
        continuationMoves: transition.continuationMoves || [
          transition.immediateReaction,
          transition.worldPressure,
        ],
        requiredAnchorGroups: [[transition.stopCondition]],
        authorizedPlayerActions: [selectedOption.label],
        constraints: [
          "Preserve settled key facts.",
          "Ordinary scene texture may vary without becoming durable state.",
        ],
        settledNarrative: transition.settledNarrative,
        fallbackContinuation: [
          transition.immediateReaction,
          transition.worldPressure,
          transition.stopCondition,
        ].join("\n\n"),
        playerVisibleFallback,
        sceneProjection: {
          sceneRef: proposedState.scene.sceneId,
          timeLabel: proposedState.scene.timeLabel,
          locationLabel: proposedState.scene.locationLabel,
          situation: proposedState.scene.situation,
          presentActors: proposedState.scene.presentActors,
          observableFacts: Object.entries(proposedState.keyFacts)
            .map(([key, value]) => `${key}: ${String(value)}`),
          keyEntityInventoryIsExhaustive: true,
          documents: [],
          objects: [],
        },
        narrativeSeed: {
          playerOutcome: transition.settledNarrative,
          continuationMoves: transition.continuationMoves || [transition.immediateReaction],
          sourceEventIds: [prepared.event.eventId],
          deferredEventIds: [],
          npcOrWorldPressure: transition.worldPressure,
          stopCondition: transition.stopCondition,
        },
        stopCondition: transition.stopCondition,
      },
      knowledgeBoundary: {
        sourceRef,
        allowed: [
          transition.settledNarrative,
          ...Object.entries(proposedState.keyFacts).map(([key, value]) => `${key}: ${String(value)}`),
        ],
        forbidden: ["Any key-fact change not present in the current settlement."],
        subjects: Object.keys(proposedState.keyFacts),
      },
    },
  };
  const truthContext = {
    originActorId: prepared.config.roleId,
    projectionActorId: prepared.config.roleId,
    activeSceneEntityIds: proposedState.scene.presentActors.map((actor) => actor.actorRef),
    catalog: proposedState.scene.presentActors.map((actor) => ({
      id: actor.actorRef,
      kind: "ACTOR",
      displayName: actor.displayName,
      aliases: [],
    })),
    capabilityIds: [],
    secretIds: [],
    establishedPredicates: [],
    allowedPredicates: [],
    requiredVisiblePredicates: [],
    forbiddenPredicates: [],
    originActionsInDraft: "FORBIDDEN" as const,
    supportedStoryFacts: [
      { supportId: prepared.event.eventId, statement: transition.settledNarrative, claimSupport: true },
      ...Object.entries(proposedState.keyFacts).map(([key, value]) => ({
        supportId: `key-fact:${key}`,
        statement: `${key}: ${String(value)}`,
        claimSupport: true,
      })),
    ],
    forbiddenStoryClaims: [],
    mechanismOnlyEvidence: [],
    specificityBoundary: "Preserve settled key facts; ordinary scene texture may vary without becoming durable state.",
    stopCondition: transition.stopCondition,
    sceneContinuity: {
      sceneId: proposedState.scene.sceneId,
      timeLabel: proposedState.scene.timeLabel,
      locationLabel: proposedState.scene.locationLabel,
    },
  };
  return {
    selectedOption: selectedWithContract,
    settledNarrative: transition.settledNarrative,
    sourceRef,
    beatManifest,
    storyComplete: proposedState.storyComplete,
    fallbackDraft,
    truthContexts: { actionPhase: truthContext, afterPhase: truthContext },
    audit: {
      eventId: prepared.event.eventId,
      sourceRef,
      changedKeyFacts: Object.keys(transition.keyFactUpdates),
    },
    payload: prepared,
  };
}

function optionsForStep(
  config: ScriptedWorldConfig,
  steps: Map<string, ScriptedStep>,
  stepId: string,
): OpenNovelOption[] {
  const step = steps.get(stepId);
  if (!step) throw new Error(`SCRIPTED_WORLD_STEP_MISSING:${stepId}`);
  return step.options.map((option) => ({
    id: option.id,
    label: option.label,
    effect: {
      decisionPointId: `${config.worldId}.${stepId}`,
      intent: option.intent,
      risk: option.risk,
    },
  }));
}

function sceneSnapshot(scene: ScriptedScene): SceneSnapshot {
  return {
    sceneId: scene.sceneId,
    timeLabel: scene.timeLabel,
    locationLabel: scene.locationLabel,
    presentActorIds: scene.presentActors.map((actor) => actor.actorRef),
  };
}

function renderScene(scene: ScriptedScene) {
  return [
    "## Scene",
    "",
    `- ${scene.timeLabel}; ${scene.locationLabel}`,
    `- ${scene.situation}`,
  ].join("\n");
}

function renderKeyFacts(facts: Record<string, string | number | boolean>) {
  return [
    "## Constants",
    "",
    ...Object.entries(facts).map(([key, value]) => `- ${key}: ${String(value)}`),
  ].join("\n");
}

async function readState(workspace: FileStoryWorkspace, runId: string) {
  const state = await readJson<ScriptedWorldState | null>(workspace.paths(runId).worldState, null);
  if (!state) throw new Error("SCRIPTED_WORLD_STATE_MISSING");
  return state;
}

function requirePayload(
  prepared: Pick<PreparedFactSettlement, "payload"> | Pick<PreparedAuthoredDecision, "payload">,
) {
  const payload = prepared.payload as PreparedScriptedSettlement | null;
  if (!payload?.config || !payload.transition || !payload.proposedState) {
    throw new Error("SCRIPTED_WORLD_SETTLEMENT_PAYLOAD_INVALID");
  }
  return payload;
}

function validateConfig(config: ScriptedWorldConfig) {
  if (!config.worldId || !config.roleId || !config.opening?.stepId) {
    throw new Error("SCRIPTED_WORLD_CONFIG_IDENTITY_INVALID");
  }
  const stepIds = new Set(config.steps.map((step) => step.stepId));
  if (!stepIds.has(config.opening.stepId)) throw new Error("SCRIPTED_WORLD_OPENING_STEP_MISSING");
  const optionIds = new Set<string>();
  for (const step of config.steps) {
    if (step.options.length < 2 || step.options.length > 4) {
      throw new Error(`SCRIPTED_WORLD_OPTION_COUNT_INVALID:${step.stepId}`);
    }
    for (const option of step.options) {
      if (optionIds.has(option.id)) throw new Error(`SCRIPTED_WORLD_OPTION_DUPLICATE:${option.id}`);
      optionIds.add(option.id);
      if (!config.transitions.some((transition) => (
        transition.fromStepId === step.stepId && transition.optionId === option.id
      ))) {
        throw new Error(`SCRIPTED_WORLD_TRANSITION_MISSING:${step.stepId}:${option.id}`);
      }
    }
  }
  for (const transition of config.transitions) {
    if (!stepIds.has(transition.fromStepId) || (!transition.storyComplete && !stepIds.has(transition.toStepId))) {
      throw new Error(`SCRIPTED_WORLD_TRANSITION_STEP_INVALID:${transition.optionId}`);
    }
  }
}

function parseJsonLines(text: string) {
  return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}

function relativeRunPath(root: string, target: string) {
  return path.relative(root, target).split(path.sep).join("/");
}
