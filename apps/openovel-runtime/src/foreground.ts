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
  OpenNovelOption,
  StorySnapshot,
} from "./types.js";
import type { WorkspacePaths } from "./paths.js";

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
  const recent = await readText(paths.chaptersRecent, "");
  return {
    metadata: await readJson(paths.metadata, null as never),
    brief: await readText(paths.brief, ""),
    directorArc: await readText(paths.arcLog, ""),
    foregroundGuidance: await composeForeground(paths),
    durableMemory: "",
    storyMemory: await readText(paths.storyMemory, ""),
    chapters,
    recentCanon: recent.trim() || canonTail(chapters, DEFAULT_BUDGETS.recentCanon),
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
) {
  return buildChineseForegroundCapsule(delta, context);
}

function buildChineseForegroundCapsule(
  delta: CausalDelta,
  context: CompiledForegroundContext,
) {
  const settledNarrative = String(delta.beatContract?.settledNarrative || '').trim();
  const recentPlayerCanon = [
    context.recentCanonExcerpt,
    settledNarrative,
  ].filter(Boolean).join(String.fromCharCode(10).repeat(2));
  const durableMemory = [
    context.durableMemory,
    context.storyMemory,
  ].map((item) => String(item || '').trim())
    .filter(Boolean)
    .join(String.fromCharCode(10).repeat(2));
  const blocks = [
    '# 当前叙事工作集',
    '',
    '前面的内容只提供当前玩家可知的连续事实和叙事纹理，不是要求逐项写进正文的命令。当前动作、站位、对话和场面衔接，以最近正文为准。',
    fixedSection('前景约束', localizeForegroundHeadings(context.foregroundGuidance)),
    fixedSection('持久记忆', durableMemory),
    fixedSection('最近正文', recentPlayerCanon),
    fixedSection('本轮唯一剧情拍', renderNarratorCausalDelta(delta)),
    fixedSection('玩家行动', delta.readerAction),
  ].filter(Boolean);
  const separator = String.fromCharCode(10).repeat(2);
  const rendered = blocks.join(separator).trim();
  const finalSection = fixedSection('玩家行动', delta.readerAction);
  const marker = '## 玩家行动';
  if (rendered.lastIndexOf(marker) < rendered.length - finalSection.length - 2) {
    throw new Error('PLAYER_ACTION_MUST_REMAIN_FINAL_FOREGROUND_SECTION');
  }
  return rendered;
}

function localizeForegroundHeadings(value: string) {
  const labels: Record<string, string> = {
    Story: '故事背景',
    Scene: '当前场景',
    Tone: '叙事语调',
    'Active Characters': '在场人物',
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
) {
  const narratorContext = scopeNarratorContext(delta, context);
  return buildChineseNarratorMessages(delta, narratorContext);
}

function buildChineseNarratorMessages(
  delta: CausalDelta,
  narratorContext: CompiledForegroundContext,
) {
  const hasSettledNarrative = Boolean(
    String(delta.beatContract?.settledNarrative || '').trim(),
  );
  const lengthRegister = hasSettledNarrative
    ? '已结算动作正文不计入你的输出。只续写其后的现场回应与新压力，到下一个玩家必须回应的时刻立即停下。'
    : '使用工作集指定的小说语言和人物声音，写一个具体、连续的场景节拍；到下一个玩家必须回应的时刻停下。';
  return [
    {
      role: 'system' as const,
      content: [
        '你是互动历史小说的前景叙述者。从最近正文的最后一刻继续，只写服务器已经选定的一个自然、具体、可继续游玩的剧情拍。',
        hasSettledNarrative
          ? '最近正文末尾已经写成本回合唯一的主角行动。不要复述、改写或补充它；只从它的最后一刻继续。'
          : '玩家行动是本回合唯一的主角行动。其他工作集内容只提供约束与叙事纹理，不要逐条复述或解释规则。',
        '当前镜头的动作、站位、对话与空间衔接以最近正文为准；让现场人物从这一刻自然回应。',
        '保留玩家意图。字面动作与现场有小冲突时，从既有正文的现在把它圆成可发生的尝试、传话或过渡；不要拒绝、倒带或瞬移。',
        '让在场人物依自己的利益和职责主动回应。普通动作、目光、衣袖、灯火、案几、普通纸张和空间调度可以自由书写。',
        '不要凭空新增具名人物、关键证据、正式文书或主角不知道的秘密；不要替主角完成玩家行动之外的签署、承诺或重大处置。',
        '场面到达下一项真正需要玩家决定的动作时停下。不要写规则说明、状态报告、选择菜单或分支总结。',
        '最后一个现场人物的动作或问话已经把问题交给玩家时，正文就在那里结束；不要再追加局势归纳、利弊总结或换句话重复停止点。',
        lengthRegister,
        '只返回小说正文，不要标题、列表、结构化数据、选项或解释。',
      ].join(String.fromCharCode(10)),
    },
    {
      role: 'user' as const,
      content: buildForegroundUserContext(delta, narratorContext),
    },
  ];
}

function scopeNarratorContext(
  delta: CausalDelta,
  context: CompiledForegroundContext,
): CompiledForegroundContext {
  if (!delta.beatContract && !delta.knowledgeBoundaryRef) return context;
  const hasAuthoredRuntimeBeat = Boolean(delta.beatContract);
  const allowedSections = hasAuthoredRuntimeBeat
    ? new Set([
        "Story",
        "Scene",
        "Tone",
        "Active Characters",
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
        "Constants",
        "Forbidden",
      ]);
  return {
    ...context,
    foregroundGuidance: selectMarkdownSections(
      context.foregroundGuidance,
      allowedSections,
    ),
    // The server-owned Next Story Beat decides what happens now. Durable state
    // and prior Canon remain available only to keep names, relationships and
    // unresolved facts continuous; they are no longer used as a menu from
    // which the Narrator chooses the next event.
  };
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
