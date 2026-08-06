/*
 * Portions of this file are derived from Feed-Scription/openovel:
 * src/context/contextCapsule.js, src/context/contextCompiler.js,
 * src/context/foregroundInserts.js, src/lib/foregroundCompose.js,
 * src/lib/narrator.js, and src/prompts/agentContracts.js.
 * Licensed under Apache-2.0. Modified for Our Many Worlds on 2026-07-27.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { compactText, readJson, readText, writeAtomic, writeJsonAtomic } from "./io.js";
import {
  readShadowWarnings,
  removeUnsupportedObjectiveClaims,
  unsupportedClaimsFromWarnings,
} from "./shadow-claims.js";
import { renderNarratorCausalDelta } from "./causal-context.js";
import type {
  CausalDelta,
  CompiledForegroundContext,
  NarratorSceneProjection,
  OpenNovelOption,
  StorySnapshot,
} from "./types.js";
import type { WorkspacePaths } from "./paths.js";
import type { BeatManifest } from "./scene-expression.js";

const DEFAULT_BUDGETS = {
  guidance: 12_000,
  durableMemory: 4_000,
  storyMemory: 6_000,
  recentCanon: 12_000,
};

const FRONTEND_SECTION_TITLES: Record<string, string> = {
  "header.md": "Story",
  "scene.md": "Scene",
  "tone.md": "Tone",
  "active-characters.md": "Active Characters",
  "relationships.md": "Relationships",
  "constants.md": "Constants",
  "open-threads.md": "Open Threads",
  "active-pressures.md": "Active Pressures",
  "directed-beat.md": "This Turn",
  "pending-consequence.md": "Pending Consequence",
  "forbidden.md": "Forbidden",
};

export async function composeForeground(paths: WorkspacePaths) {
  await Promise.all([
    normalizeFrontendSections(paths),
    normalizeContextCardHeadings(paths),
  ]);
  const template = await readText(paths.foregroundTemplate, "");
  const composed = await expandIncludes(template, paths, new Set(), 0);
  await writeAtomic(paths.foregroundGuidance, `${composed.trim()}\n`);
  return composed.trim();
}

/**
 * Storykeeper is allowed to return compact section bodies without Markdown
 * headings. The file boundary is an application invariant, not a model
 * convention, so normalize it in code before the next foreground is compiled.
 */
export function formatFrontendSection(name: string, value: string) {
  const body = String(value || "").trim();
  if (!body) return "";
  const title = FRONTEND_SECTION_TITLES[name];
  if (!title) return body;
  const firstHeading = body.match(/^#{1,6}\s+(.+?)\s*(?:\r?\n|$)/)?.[1] || "";
  if (normalizeSectionTitle(firstHeading) === normalizeSectionTitle(title)) return body;
  return `## ${title}\n\n${body}`;
}

async function normalizeFrontendSections(paths: WorkspacePaths) {
  await Promise.all(Object.keys(FRONTEND_SECTION_TITLES).map(async (name) => {
    const file = path.join(paths.frontendDir, name);
    const current = await readText(file, "");
    const normalized = formatFrontendSection(name, current);
    const next = normalized ? `${normalized}\n` : "";
    if (current !== next) await writeAtomic(file, next);
  }));
}

async function normalizeContextCardHeadings(paths: WorkspacePaths) {
  const directories = await readdir(paths.contextCardsDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(directories.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const file = path.join(paths.contextCardsDir, entry.name, "CARD.md");
    const current = await readText(file, "");
    const normalized = formatContextCardContent(current, entry.name);
    if (current !== normalized) await writeAtomic(file, normalized);
  }));
}

export function formatContextCardContent(value: string, fallbackTitle = "Context") {
  const current = String(value || "");
  const frontmatter = current.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const body = stripFrontmatter(current);
  if (!body || /^#\s+.+/m.test(body)) return current;
  const triggerTitle = frontmatter?.[0]
    .match(/^triggers:\s*\[\s*"([^"]+)"/m)?.[1]
    ?.trim();
  const declaredName = frontmatter?.[0].match(/^name:\s*(.+?)\s*$/m)?.[1]?.trim();
  const title = triggerTitle || declaredName || fallbackTitle;
  return [
    frontmatter?.[0].trimEnd() || "",
    `# ${title}`,
    "",
    body,
    "",
  ].filter((line, index) => line || index > 0).join("\n");
}

function normalizeSectionTitle(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export async function activateContextCards(paths: WorkspacePaths, action: string, existingGuidance: string) {
  const query = `${action}\n${existingGuidance}`.toLocaleLowerCase();
  const cards = await discoverCards(paths);
  const selected = cards
    .filter((card) => card.triggers.some((trigger) => query.includes(trigger.toLocaleLowerCase())))
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .slice(0, 8);
  const manifest = selected
    .map((card) => `@include story/context-cards/${card.slug}/CARD.md`)
    .join("\n");
  await writeAtomic(paths.cardsAutoManifest, manifest ? `${manifest}\n` : "");
  return selected.map((card) => card.slug);
}

export async function getStorySnapshot(paths: WorkspacePaths): Promise<StorySnapshot> {
  const chapters = await readText(paths.chapters, "");
  const publishedRecent = await readText(paths.chaptersRecent, "");
  const contextChapters = await readText(paths.chaptersContext, chapters);
  const contextRecent = await readText(
    paths.chaptersContextRecent,
    publishedRecent.trim() || canonTail(contextChapters, DEFAULT_BUDGETS.recentCanon),
  );
  return {
    metadata: await readJson(paths.metadata, null as never),
    brief: await readText(paths.brief, ""),
    directorArc: await readText(paths.arcLog, ""),
    foregroundGuidance: await composeForeground(paths),
    durableMemory: "",
    storyMemory: await readText(paths.storyMemory, ""),
    chapters,
    contextChapters,
    contextRecentCanon: contextRecent.trim()
      || canonTail(contextChapters, DEFAULT_BUDGETS.recentCanon),
    // All model-facing consumers use the Shadow-free projection. The public
    // reader view continues to read chapters.md and chapters.recent.md.
    recentCanon: contextRecent.trim()
      || canonTail(contextChapters, DEFAULT_BUDGETS.recentCanon),
    previousOptions: await readJson<OpenNovelOption[]>(paths.currentOptions, []),
    optionsGuidance: await readText(paths.optionsGuidance, ""),
  };
}

export async function compileForegroundContext(
  paths: WorkspacePaths,
  snapshot: StorySnapshot,
  budgets: Partial<typeof DEFAULT_BUDGETS> = {},
): Promise<CompiledForegroundContext> {
  const limits = { ...DEFAULT_BUDGETS, ...budgets };
  const truncated: string[] = [];
  const shadowClaims = unsupportedClaimsFromWarnings(await readShadowWarnings(paths));
  const projectedGuidance = projectForegroundGuidance(
    removeUnsupportedObjectiveClaims(snapshot.foregroundGuidance, shadowClaims),
  );
  const clip = (name: string, value: string, max: number, tail = false) => {
    if (value.length <= max) return value;
    truncated.push(name);
    return tail ? `…\n${value.slice(-max)}` : `${value.slice(0, max)}\n…`;
  };
  const compiled: CompiledForegroundContext = {
    foregroundGuidance: clip(
      "foregroundGuidance",
      stripVolatileLines(projectedGuidance.text),
      limits.guidance,
    ),
    durableMemory: clip("durableMemory", snapshot.durableMemory, limits.durableMemory),
    storyMemory: clip(
      "storyMemory",
      removeUnsupportedObjectiveClaims(snapshot.storyMemory, shadowClaims),
      limits.storyMemory,
      true,
    ),
    recentCanonExcerpt: clip(
      "recentCanon",
      stripReaderChoiceHeaders(snapshot.recentCanon || snapshot.chapters),
      limits.recentCanon,
      true,
    ),
    report: {
      usedChars: 0,
      budgets: limits,
      truncated,
      removedPlayerDirectiveClauses: projectedGuidance.removedPlayerDirectiveClauses,
      deduplicatedContextCardSections: projectedGuidance.deduplicatedContextCardSections,
    },
  };
  compiled.report.usedChars = [
    compiled.foregroundGuidance,
    compiled.durableMemory,
    compiled.storyMemory,
    compiled.recentCanonExcerpt,
  ].reduce((sum, value) => sum + value.length, 0);
  await writeJsonAtomic(paths.contextReport, compiled.report).catch(() => {});
  return compiled;
}

/**
 * Storykeeper owns a backstage workset, not a second source of player actions.
 * This projection keeps world state, NPC pressure, consequences and forbidden
 * boundaries while removing scheduling notes or imperatives aimed at the
 * player character. Reader Action is appended later as the only protagonist
 * instruction.
 */
export function projectForegroundGuidance(value: string) {
  const deduplicated = deduplicateTopLevelGuidanceSections(String(value || ""));
  return {
    // The foreground workset is guidance, never a second source of player
    // authority. P03 deliberately avoids inferring directives from prose.
    text: deduplicated.text.replace(/\n{4,}/g, "\n\n\n").trim(),
    removedPlayerDirectiveClauses: 0,
    deduplicatedContextCardSections: deduplicated.removed,
  };
}

export function buildForegroundUserContext(
  delta: CausalDelta,
  context: CompiledForegroundContext,
  beatManifest?: BeatManifest,
) {
  return buildChineseForegroundCapsule(delta, context, beatManifest);
}

function buildChineseForegroundCapsule(
  delta: CausalDelta,
  context: CompiledForegroundContext,
  beatManifest?: BeatManifest,
) {
  const readerAction = projectReaderActionForNarrator(delta, beatManifest);
  const recentPlayerCanon = context.recentCanonExcerpt;
  const durableMemory = [
    context.durableMemory,
    context.storyMemory,
  ].map((item) => String(item || '').trim())
    .filter(Boolean)
    .join(String.fromCharCode(10).repeat(2));
  const blocks = [
    '# 当前叙事工作集',
    '',
    '前面的内容只提供当前玩家可知的连续事实和叙事纹理，不是要求逐项写进正文的命令。最近正文只供语言与未完对话衔接；人物、地点、关键物件和已经发生的行动，以前景约束与本轮唯一剧情拍为准。',
    fixedSection('前景约束', localizeForegroundHeadings(context.foregroundGuidance)),
    fixedSection('持久记忆', durableMemory),
    fixedSection('最近正文', recentPlayerCanon),
    fixedSection(
      '本轮唯一剧情拍',
      beatManifest
        ? renderBeatManifestForNarrator(beatManifest)
        : renderNarratorCausalDelta(delta),
    ),
    fixedSection('玩家行动', readerAction),
  ].filter(Boolean);
  const separator = String.fromCharCode(10).repeat(2);
  const rendered = blocks.join(separator).trim();
  const finalSection = fixedSection('玩家行动', readerAction);
  const marker = '## 玩家行动';
  if (rendered.lastIndexOf(marker) < rendered.length - finalSection.length - 2) {
    throw new Error('PLAYER_ACTION_MUST_REMAIN_FINAL_FOREGROUND_SECTION');
  }
  return rendered;
}

/**
 * A protected PLAYER_RESULT is already rendered by the server before any
 * Narrator-owned prose. Repeating the raw choice here gives the model a second
 * expression authority and can make it replay the action with a different key
 * object state. Keep the required Reader Action section last, but turn it into
 * a phase hand-off. The current scene projection and dramatic beat plan carry
 * everything the Narrator needs to write the aftermath.
 */
export function projectReaderActionForNarrator(
  delta: CausalDelta,
  beatManifest?: BeatManifest,
) {
  const playerResultIsProtected = Boolean(beatManifest?.tickets.some((ticket) => (
    ticket.slot === "PLAYER_RESULT"
    && ticket.expressionOwner === "PROTECTED"
  )));
  if (!playerResultIsProtected) return delta.readerAction;
  return [
    "该玩家行动已经完成结算，并由服务器在正文中先行展示。",
    "不得重演、转述或扩写该行动；只从上述动作完成后的现场开始。",
  ].join("\n");
}

function localizeForegroundHeadings(value: string) {
  const labels: Record<string, string> = {
    Story: '故事背景',
    Scene: '当前场景',
    Tone: '叙事语调',
    'Active Characters': '在场人物',
    'Key Entities': '关键实体',
    Relationships: '人物关系',
    Constants: '稳定事实',
    'Open Threads': '未决线索',
    'Active Pressures': '当前压力',
    'Pending Consequence': '待兑现后果',
    Forbidden: '不可越界内容',
  };
  return String(value || '').replace(
    /^## (.+)$/gmu,
    (line, heading: string) => labels[heading] ? '## ' + labels[heading] : line,
  );
}

export function buildNarratorMessages(
  delta: CausalDelta,
  context: CompiledForegroundContext,
  beatManifest?: BeatManifest,
) {
  const narratorContext = scopeNarratorContext(delta, context, beatManifest);
  if (!beatManifest) return buildLegacyNarratorMessages(delta, narratorContext);
  return [
    {
      role: "system" as const,
      content: [
        "Write only the Narrator-owned slots for this turn. The server inserts author-reviewed PROTECTED slots verbatim and will not rewrite your prose.",
        "Write in the same language, historical register and literary voice as Recent Player Canon.",
        "Write a lived dramatic scene, not a settlement report, policy summary, task list or decision memo.",
        "Put pressure on stage through a character's entrance, gesture, refusal, bargaining move, question or visible consequence. Let other characters react before the next choice appears.",
        "Use the dramaticGuidance as scene grammar and characterization technique only. It is not a list of current-world facts and must never be copied as exposition.",
        "Follow dramaticBeatPlan in order. It is the server-owned shape of this scene: show the settled player result once, stage an NPC/world countermove, make its visible consequence perceptible, and stop at the final unresolved pressure.",
        "REACTION_WINDOW permits only brief, non-durable reactions and dialogue consistent with the listed actor goals. It never authorizes a new order, document, evidence, secret, promise, arrival, departure or completed world event.",
        "Never import a name, number, object, location or event from sourceMechanisms into the current world. Borrow only the conflict shape and dramatic technique.",
        "WORLD_PRESSURE must dramatize an NPC or world countermove in the current scene. DECISION_STOP must arise from that confrontation, not from an abstract sentence saying the protagonist must decide.",
        "In a regular turn Narrator owns PLAYER_RESULT and must express the already-settled action exactly once without changing its facts. If PLAYER_RESULT is protected, begin after it and never replay or paraphrase it.",
        "serverRenderedContext is immutable prose that will appear immediately before your slots. Continue from its aftermath; do not quote, paraphrase or reproduce it.",
        "Write one focused confrontation. Do not exhaust every possible argument; usually six to ten short paragraphs and one to three dialogue exchanges are enough.",
        "The Reader Action is the only new protagonist action. Do not add another protagonist order, signature, commitment or major disposition.",
        "The action happens in ACTION_PHASE. If a transition is authorized, move to AFTER_PHASE only inside SCENE_TRANSITION.",
        "Render every required semantic slot as natural novel prose. Do not expose slot labels, rules, IDs, state paths or analysis inside prose.",
        "If PLAYER_RESULT is Narrator-owned, it shows the settled result. If it is protected, omit it. IMMEDIATE_REACTION contains only the old-scene immediate response.",
        "SCENE_TRANSITION performs only the authorized time/location/cast transition. WORLD_PRESSURE happens in the after-scene.",
        "DECISION_STOP is the final prose and must leave the real next decision unresolved. Do not add any sentence after it.",
        "Ordinary movement, gaze, sleeves, furniture, light, weather and incidental objects are free narrative texture.",
        "Do not invent a key document, evidence, secret, formal order, durable entity state or completed causal event.",
        "The current-scene key entity inventory is exhaustive for durable documents and evidence-bearing objects. Items absent from it cannot appear as present; ordinary texture remains free.",
        "Return raw JSON only with exactly schemaVersion, draftId, owner and slots.",
        "Use schemaVersion omw.scene-draft.v1, draftId " + delta.turnId + ".draft.original and owner NARRATOR.",
        "slots may contain only the narratorOwnedSlots listed in the user message. Never output a protectedSlots entry.",
        "Each slot value is prose only, with no heading or label.",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: buildForegroundUserContext(delta, narratorContext, beatManifest),
    },
  ];
}

function buildLegacyNarratorMessages(
  delta: CausalDelta,
  context: CompiledForegroundContext,
) {
  return [
    {
      role: "system" as const,
      content: [
        "从最近正文的最后一刻继续。",
        "Continue the interactive novel from the latest Canon.",
        "Reader Action is the only protagonist action.",
        "Write one concrete scene in the same language and literary voice as Canon.",
        "Stop at the next decision. Return prose only.",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: buildForegroundUserContext(delta, context),
    },
  ];
}

function scopeNarratorContext(
  delta: CausalDelta,
  context: CompiledForegroundContext,
  beatManifest?: BeatManifest,
): CompiledForegroundContext {
  if (!delta.beatContract && !delta.knowledgeBoundaryRef) return context;
  const hasAuthoredRuntimeBeat = Boolean(delta.beatContract);
  const protectedBeatOwned = Boolean(beatManifest);
  const allowedSections = protectedBeatOwned
    ? new Set([
        "Story",
        "Scene",
        "Tone",
        "Active Characters",
        "Key Entities",
        "Relationships",
        "Constants",
        "Forbidden",
      ])
    : hasAuthoredRuntimeBeat
    ? new Set([
        "Story",
        "Scene",
        "Tone",
        "Active Characters",
        "Key Entities",
        "Relationships",
        "Constants",
        "Open Threads",
        "Active Pressures",
        "Pending Consequence",
        "Forbidden",
      ])
    : new Set([
        "Story",
        "Scene",
        "Tone",
        "Active Characters",
        "Key Entities",
        "Constants",
        "Forbidden",
      ]);
  const selectedGuidance = selectMarkdownSections(
    context.foregroundGuidance,
    allowedSections,
  );
  const projection = delta.beatContract?.sceneProjection;
  const protectedTransitionOwned = Boolean(
    beatManifest?.tickets.some((ticket) => (
      ticket.slot === "SCENE_TRANSITION"
      && ticket.expressionOwner === "PROTECTED"
    )),
  );
  const currentSceneNeedsProjection = Boolean(
    projection
    && (
      !beatManifest
      || !beatManifest.transition.transitionRequired
      || protectedTransitionOwned
    ),
  );
  const phaseScopedCanon = protectedTransitionOwned
    ? protectedTransitionAnchor(beatManifest)
    : "";
  return {
    ...context,
    ...(phaseScopedCanon ? { recentCanonExcerpt: phaseScopedCanon } : {}),
    foregroundGuidance: currentSceneNeedsProjection && projection
      ? projectSettledSceneGuidance(
          selectedGuidance,
          projection,
        )
      : selectedGuidance,
    // The server-owned Next Story Beat decides what happens now. Durable state
    // and prior Canon remain available only to keep names, relationships and
    // unresolved facts continuous; they are no longer used as a menu from
    // which the Narrator chooses the next event.
  };
}

/**
 * BeatManifest exposes only player-safe semantic obligations and the approved
 * action/after scene phases. Each slot has exactly one expression owner:
 * irreversible causal results may be protected while the Narrator owns the
 * remaining literary scene. Source IDs and hidden mechanisms stay backstage.
 */
function protectedTransitionAnchor(manifest?: BeatManifest) {
  if (!manifest?.transition.transitionRequired) return "";
  return String(manifest.tickets.find((ticket) => (
    ticket.slot === "SCENE_TRANSITION"
    && ticket.expressionOwner === "PROTECTED"
  ))?.protectedText || "").trim();
}

function renderBeatManifestForNarrator(manifest: BeatManifest) {
  const narratorOwnedSlots = manifest.tickets
    .filter((ticket) => (ticket.expressionOwner || "NARRATOR") === "NARRATOR")
    .map((ticket) => ({
      slot: ticket.slot,
      required: ticket.required,
      meaning: ticket.requiredMeaning,
    }));
  const protectedSlots = manifest.tickets
    .filter((ticket) => ticket.expressionOwner === "PROTECTED")
    .map((ticket) => ticket.slot);
  const serverRenderedContext = manifest.tickets
    .filter((ticket) => ticket.expressionOwner === "PROTECTED")
    .map((ticket) => ({
      slot: ticket.slot,
      text: ticket.protectedText,
    }));
  return JSON.stringify({
    actionPhase: {
      time: manifest.transition.narrationScene.timeLabel,
      location: manifest.transition.narrationScene.locationLabel,
    },
    afterPhase: {
      time: manifest.transition.afterScene.timeLabel,
      location: manifest.transition.afterScene.locationLabel,
    },
    transitionRequired: manifest.transition.transitionRequired,
    narratorOwnedSlots,
    protectedSlots,
    serverRenderedContext,
    dramaticGuidance: projectDramaticGuidanceForNarrator(manifest.dramaticGuidance),
    dramaticBeatPlan: projectDramaticBeatPlanForNarrator(
      manifest.dramaticBeatPlan,
      protectedSlots,
    ),
  }, null, 2);
}

function projectDramaticBeatPlanForNarrator(
  plan: BeatManifest["dramaticBeatPlan"],
  protectedSlots: BeatManifest["tickets"][number]["slot"][],
) {
  if (!plan) return null;
  const protectedSet = new Set(protectedSlots);
  const slotForStep = (kind: typeof plan.steps[number]["kind"]) => {
    if (kind === "PLAYER_RESULT") return "PLAYER_RESULT" as const;
    if (kind === "COUNTERMOVE" || kind === "VISIBLE_CONSEQUENCE") {
      return "WORLD_PRESSURE" as const;
    }
    if (kind === "DECISION_PRESSURE") return "DECISION_STOP" as const;
    return null;
  };
  return {
    sceneObjective: plan.sceneObjective,
    activeActors: plan.activeActors.map((actor) => ({
      name: actor.displayName,
      ...(actor.goal ? { motivation: actor.goal } : {}),
    })),
    orderedSteps: plan.steps.filter((step) => {
      const slot = slotForStep(step.kind);
      return !slot || !protectedSet.has(slot);
    }).map((step) => ({
      kind: step.kind,
      actors: step.actorLabels,
      requiredMeaning: step.requiredMeaning,
      motivations: step.actorGoals,
      expressionPolicy: step.expressionPolicy,
    })),
    texturePolicy: plan.texturePolicy,
    expressionContract: plan.expressionContract,
  };
}

function projectDramaticGuidanceForNarrator(
  guidance: BeatManifest["dramaticGuidance"],
) {
  if (!guidance) return null;
  return {
    dramaticTask: guidance.dramaticTask,
    sourceMechanisms: guidance.sourceMechanisms,
    // Source patterns can contain protagonist moves and source-world props.
    // The runtime planner may inspect those backstage, but the Narrator gets
    // only reusable staging/cadence rules so it cannot replay them as current
    // events.
    sceneGrammar: guidance.scenePatterns.map((pattern) => ({
      dialogueCadenceRules: pattern.dialogueTactics.map((item) => item.cadenceRule),
      blockingPrinciples: pattern.blockingPrinciples,
      transferableTechniques: pattern.transferableTechniques,
      forbiddenFlattening: pattern.forbiddenFlattening,
    })),
  };
}

export function projectSettledSceneGuidance(
  value: string,
  projection: NarratorSceneProjection,
) {
  // A settled scene projection is the only current-scene authority. The
  // Storykeeper workset can legitimately lag by one turn, so none of its
  // scene-scoped prose may survive a scene cut as if it were current fact.
  // Keep only world-level story framing and durable safety boundaries; the
  // typed projection below rebuilds every current-scene section.
  const stableGuidance = removeMarkdownSections(value, new Set([
    "Scene",
    "Tone",
    "Active Characters",
    "Key Entities",
    "Relationships",
    "Constants",
    "Open Threads",
    "Active Pressures",
    "Pending Consequence",
  ]));
  const sceneLines = [
    "## Scene",
    "",
    `- ${[projection.timeLabel, projection.locationLabel].filter(Boolean).join("，")}`,
    ...(projection.situation ? [`- ${projection.situation}`] : []),
  ];
  const actorLines = [
    "## Active Characters",
    "",
    ...projection.presentActors.map((actor) => `- ${actor.displayName}`),
  ];
  const keyEntityLines = renderKeyEntityGuidance(projection);
  return upsertMarkdownSection(
    upsertMarkdownSection(
      upsertMarkdownSection(stableGuidance, "Scene", sceneLines.join("\n")),
      "Active Characters",
      actorLines.join("\n"),
    ),
    "Key Entities",
    keyEntityLines,
  );
}

function removeMarkdownSections(value: string, removed: Set<string>) {
  const lines = String(value || "").split(/\r?\n/u);
  const retained: string[] = [];
  let keep = true;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/u)?.[1]?.trim();
    if (heading) keep = !removed.has(heading);
    if (keep) retained.push(line);
  }
  return retained.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

function renderKeyEntityGuidance(projection: NarratorSceneProjection) {
  const documentStateLabels: Record<NarratorSceneProjection["documents"][number]["accessState"], string> = {
    NOT_PRESENT: "不在当前场景",
    SEALED: "仍处于封存状态",
    OPENED: "已经打开",
    READ: "已经被在场人物读过",
    WRITTEN: "已经写成",
  };
  const contentsLabels = {
    EMPTY: "其中为空",
    UNKNOWN: "其中内容尚不明确",
    CONTAINS_DOCUMENT: "其中已有文书",
  } as const;
  const closureLabels = {
    CLOSED: "目前合拢",
    OPEN: "目前打开",
    UNKNOWN: "开合状态尚不明确",
  } as const;
  const lines = [
    "## Key Entities",
    "",
    "- 以下清单穷尽当前场景中的关键文书与证据容器；未列出的关键实体不在场。普通无字纸张、笔墨、家具与环境细节不受此限制。",
    ...projection.observableFacts.map((fact) => `- 可见事实：${fact}`),
    ...projection.documents.map((document) => [
      document.label,
      documentStateLabels[document.accessState],
      document.holderLabel ? `由${document.holderLabel}持有` : "",
    ].filter(Boolean).join("，")).map((fact) => `- ${fact}`),
    ...projection.objects.map((object) => [
      object.label,
      object.holderLabel ? `由${object.holderLabel}持有` : "",
      object.contentsState ? contentsLabels[object.contentsState] : "",
      object.closureState ? closureLabels[object.closureState] : "",
    ].filter(Boolean).join("，")).map((fact) => `- ${fact}`),
  ];
  return lines.join("\n");
}

function upsertMarkdownSection(value: string, title: string, replacement: string) {
  const lines = String(value || "").split(/\r?\n/u);
  const start = lines.findIndex((line) => line.match(/^##\s+(.+?)\s*$/u)?.[1]?.trim() === title);
  if (start < 0) {
    return [String(value || "").trim(), replacement].filter(Boolean).join("\n\n");
  }
  let end = start + 1;
  while (end < lines.length && !/^##\s+.+?\s*$/u.test(lines[end])) end += 1;
  return [...lines.slice(0, start), replacement, ...lines.slice(end)]
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function selectMarkdownSections(value: string, allowed: Set<string>) {
  const lines = String(value || "").split(/\r?\n/);
  const selected: string[] = [];
  let keep = false;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/u)?.[1]?.trim();
    if (heading) {
      keep = allowed.has(heading);
    }
    if (keep) selected.push(line);
  }
  return selected.join("\n").trim();
}

export function buildOptionsMessages(
  action: string,
  narration: string,
  snapshot: StorySnapshot,
  context: CompiledForegroundContext,
) {
  const previousLabels = snapshot.previousOptions.map((option) => option.label);
  const optionsGuidance = sanitizeOptionsGuidance(snapshot.optionsGuidance);
  const narrativeNow = [
    context.recentCanonExcerpt,
    `**读者刚才的行动**：${action}`,
    narration,
  ].filter(Boolean).join("\n\n");
  return [
    {
      role: "system" as const,
      content: [
        "<role>",
        "你在正文已经流式显示完毕后，为互动小说生成简短、玩家可见的下一步行动建议。",
        "</role>",
        "<task>",
        "不要续写正文。narrative_so_far 的结尾是故事唯一的“现在”：它已经包含玩家刚才的行动以及该行动产生的正文。每个选项都必须从这个精确末态向前，不能重做、倒带或改写此前发生的事。",
        "先确定末尾处主角的位置、在场人物、自由程度、已经完成的动作和仍待决定的分叉。每个选项必须是主角此刻物理上、制度上和知识上都能执行的直接下一步。",
        "Foreground Guidance、Story Memory 和 Recent Canon 提供事实与约束，但可能有一轮延迟；当前现场冲突时以 narrative_so_far 最后一句为准。",
        "OPTIONS Guidance 是选择哲学，不是现成菜单。只用它判断什么分叉值得呈现，不要照抄其中的示例或把全部 Active Pressures、Open Threads 当成本回合清单。",
        "给出 2—4 个真正不同的方向，普通人一眼能懂。至少在行动种类、对象、风险、信息获取或承诺程度上不同；不要换词重复，也不要把玩家刚做完或上一轮已经拒绝的方向再次提供。",
        "每项只包含一个主要制度动作；不要把封存、移交、签发、派人等两个重大动作捆成一步。",
        "不得引入上下文里没有出现的具名人物、机构、地点、器物或事实。选项可以建议去询问、寻找或核验未知事实，但不能把缺失的原册、具体疑点、证人、文书、数字或幕后关系写成已经存在、已经可读或已经可调用；需要对象时使用已在场对象或不带事实承诺的泛称。",
        "选项是 UI affordance，不是 Canon，玩家始终可以忽略并自由输入。多数回合不是关键决策：普通建议只给 label，不附 key、effect 或 framing。",
        "只有正文确实停在不可逆的真实分叉时，才标记 1—3 项 key 并给隐藏 effect；effect 只是 Storykeeper 的候选，不直接修改业务状态。",
        "label 必须短、单行、只写玩家要做的动作；不写结果、成功失败、风险分析、代价解释、推荐理由或正确答案暗示。",
        "只有整个故事已经明确结束时才返回 storyComplete:true 和空 options；场景暂停、悬念或暂时无人说话不算结束。",
        "</task>",
        "<output>",
        "只返回严格 JSON：{\"framing\"?:string,\"options\":[{\"label\":string,\"key\"?:true,\"effect\"?:{\"intent\"?:string,\"consequence\"?:string,\"stateHints\"?:Array<{\"key\":string,\"op\":\"set\"|\"inc\"|\"dec\"|\"flag\",\"value\":unknown,\"note\"?:string,\"presentThisTurn\"?:boolean,\"surfaceAnchor\"?:string}>,\"risk\"?:\"low\"|\"medium\"|\"high\",\"difficulty\"?:string,\"reversible\"?:boolean}}],\"tension\":string,\"storyComplete\"?:boolean}",
        "</output>",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        optionsGuidance
          ? `<options_guidance>\n${optionsGuidance}\n</options_guidance>`
          : "",
        `<foreground_guidance>\n${context.foregroundGuidance}\n</foreground_guidance>`,
        `<narrative_so_far>\n${narrativeNow}\n</narrative_so_far>`,
        previousLabels.length
          ? `<do_not_repeat>\n${previousLabels.map((label) => `- ${label}`).join("\n")}\n</do_not_repeat>`
          : "",
      ].filter(Boolean).join("\n\n"),
    },
  ];
}

/**
 * OPTIONS.md is a durable choice philosophy, never a cached next-turn menu.
 * A slow-loop model occasionally writes concrete candidates despite that
 * contract. Keep the reusable principles and discard scene-local banks before
 * they can anchor the next options call.
 */
export function sanitizeOptionsGuidance(value: string) {
  return String(value || "").trim();
}

export function openingKey(value: string, length = 50) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/^[#>*\-\d.、]+/, "")
    .slice(0, length);
}

export function previousNarrationOpening(snapshot: StorySnapshot) {
  return openingKey(snapshot.recentCanon);
}

export function stripReaderChoiceHeaders(value: string) {
  return String(value || "")
    .replace(/^[ \t]*\*\*(?:读者选择|玩家行动)\*\*[：:][^\n]*\n?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimStart();
}

async function expandIncludes(
  text: string,
  paths: WorkspacePaths,
  visited: Set<string>,
  depth: number,
): Promise<string> {
  if (depth > 8) return "";
  const out: string[] = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^\s*@include\s+([^\s#]+)\s*$/);
    if (!match) {
      out.push(line);
      continue;
    }
    const relative = match[1].replaceAll("/", path.sep);
    if (!relative.startsWith(`story${path.sep}`) || relative.includes(`..${path.sep}`)) continue;
    const file = path.resolve(path.dirname(paths.story), relative);
    if (!file.startsWith(`${path.resolve(paths.story)}${path.sep}`)) continue;
    if (visited.has(file)) continue;
    visited.add(file);
    const rawIncluded = await readText(file, "");
    const included = relative === path.join("story", "frontend", "directed-beat.md")
      ? sanitizeDirectedBeat(rawIncluded)
      : rawIncluded;
    out.push(await expandIncludes(stripFrontmatter(included), paths, visited, depth + 1));
  }
  return out.join("\n").replace(/\n{4,}/g, "\n\n\n");
}

async function discoverCards(paths: WorkspacePaths) {
  const directories = await readdir(paths.contextCardsDir, { withFileTypes: true }).catch(() => []);
  const cards: Array<{ slug: string; triggers: string[] }> = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const content = await readText(path.join(paths.contextCardsDir, directory.name, "CARD.md"), "");
    const triggerLine = content.match(/^triggers:\s*\[(.*)\]\s*$/m)?.[1] || "";
    const triggers = [...triggerLine.matchAll(/"([^"]+)"/g)].map((match) => match[1].trim()).filter(Boolean);
    if (triggers.length) cards.push({ slug: directory.name, triggers });
  }
  return cards;
}

function stripFrontmatter(value: string) {
  return String(value || "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

function stripVolatileLines(value: string) {
  return String(value || "")
    .split(/\r?\n/)
    .filter((line) => !/^(Updated Turn:|Updated:\s*\d{4}-\d{2}-\d{2}T)/i.test(line.trim()))
    .join("\n");
}

export function sanitizeDirectedBeat(value: string) {
  // Narrative guidance is not parsed for authority. Structured turn data is
  // the only source of actionable facts; P05 will narrow this projection.
  return String(value || "").trim();
}

function deduplicateTopLevelGuidanceSections(value: string) {
  const lines = value.split(/\r?\n/);
  const prefix: string[] = [];
  const sections: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } | undefined;
  for (const line of lines) {
    const heading = line.match(/^#(?!#)\s+(.+?)\s*$/);
    if (heading) {
      current = { title: normalizeGuidanceIdentity(heading[1]), lines: [line] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else prefix.push(line);
  }
  const lastIndexByTitle = new Map<string, number>();
  sections.forEach((section, index) => {
    if (section.title) lastIndexByTitle.set(section.title, index);
  });
  const kept = sections.filter((section, index) => lastIndexByTitle.get(section.title) === index);
  return {
    text: [...prefix, ...kept.flatMap((section) => section.lines)].join("\n"),
    removed: sections.length - kept.length,
  };
}

function normalizeGuidanceIdentity(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function canonTail(value: string, maxChars: number) {
  const text = String(value || "");
  return text.length <= maxChars ? text : `…\n${text.slice(-maxChars)}`;
}

function section(title: string, value: string) {
  const body = String(value || "").trim();
  return body ? `## ${title}\n\n${body}` : "";
}

function fixedSection(title: string, value: string) {
  const body = demoteEmbeddedHeadings(String(value || "").trim()) || "无。";
  return `## ${title}\n\n${body}`;
}

function demoteEmbeddedHeadings(value: string) {
  return value.replace(/^(#{1,6})\s+/gmu, (_match, hashes: string) => {
    const depth = Math.min(6, Math.max(3, hashes.length + 1));
    return `${"#".repeat(depth)} `;
  });
}

export const foregroundInternal = {
  DEFAULT_BUDGETS,
  compactText,
};
