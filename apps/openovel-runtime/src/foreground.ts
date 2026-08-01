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
import { renderNarratorCausalDelta } from "./causal-delta.js";
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
  let removedPlayerDirectiveClauses = 0;
  const deduplicated = deduplicateTopLevelGuidanceSections(String(value || ""));
  const text = deduplicated.text
    .split(/\r?\n/)
    .flatMap((line) => {
      if (!line.trim() || /^#{1,6}\s/.test(line.trim())) return [line];
      const sentences = line.match(/[^。！？!?]+[。！？!?]?/g) || [line];
      const projected = sentences.flatMap((sentence) => {
        if (isBackstagePlayerMenu(sentence)) {
          removedPlayerDirectiveClauses += 1;
          return [];
        }
        const directiveAt = protagonistDirectiveIndex(sentence);
        if (directiveAt < 0) return [sentence];
        removedPlayerDirectiveClauses += 1;
        const factualPrefix = sentence
          .slice(0, directiveAt)
          .replace(/[\s,，;；:：—–-]+$/u, "")
          .trimEnd();
        if (/^(?:[-*+]\s*)?(?:面对|面临)\b/u.test(factualPrefix)) return [];
        if (/^(?:[-*+]\s*)?facing\b/iu.test(factualPrefix)) return [];
        return /[\p{L}\p{N}]/u.test(factualPrefix) ? [factualPrefix] : [];
      }).join("");
      const structuralPrefix = line.match(/^\s*(?:[-*+]|\d+[.)])\s*/)?.[0] || "";
      const content = projected.trim();
      if (!content || (structuralPrefix && content === structuralPrefix.trim())) return [];
      return [content.startsWith(structuralPrefix.trim()) ? content : `${structuralPrefix}${content}`];
    })
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  return {
    text,
    removedPlayerDirectiveClauses,
    deduplicatedContextCardSections: deduplicated.removed,
  };
}

export function buildForegroundUserContext(
  delta: CausalDelta,
  context: CompiledForegroundContext,
) {
  const settledNarrative = String(delta.beatContract?.settledNarrative || "").trim();
  const blocks = [
    "# Foreground Context",
    "",
    "前面的工作集只提供约束和叙事纹理，不是要求逐项写入正文的命令。当前动作、站位、对话和场面衔接以 Recent Canon Excerpt 为准。",
    section("Foreground Guidance", context.foregroundGuidance),
    section("Durable Memory", context.durableMemory),
    section("Story Memory", context.storyMemory),
    section("Recent Canon Excerpt", context.recentCanonExcerpt),
    settledNarrative
      ? section("Settled Action Draft", settledNarrative)
      : "",
    // The compiled per-turn boundary belongs next to the Reader Action. Stable
    // world context and Canon come first; the narrow authorization is the last
    // thing the Narrator reads before the player's action.
    section("This Turn", renderNarratorCausalDelta(delta)),
    section("Reader Action", delta.readerAction),
  ].filter(Boolean);
  const rendered = blocks.join("\n\n").trim();
  const marker = "## Reader Action";
  if (rendered.lastIndexOf(marker) < rendered.length - section("Reader Action", delta.readerAction).length - 2) {
    throw new Error("Reader Action must remain the final foreground section");
  }
  return rendered;
}

export function buildNarratorMessages(
  delta: CausalDelta,
  context: CompiledForegroundContext,
) {
  const narratorContext = scopeNarratorContext(delta, context);
  const narrowBeat = (
    delta.protagonistScope !== "bounded-action"
    || delta.allowedKnowledge.length > 0
  );
  const exclusiveAuthoredBeat = Boolean(
    delta.beatContract?.constraints?.some((item) =>
      /(?:文中|其中|回文中|奏报中|公文中|责任说明中)只写/u.test(item)
    ),
  );
  const authoredSceneTransition = Boolean(
    delta.beatContract?.constraints?.some((item) =>
      /(?:只有写完已授权的世界行动后，才转到|完成旧场的玩家行动和在场 NPC 即时回应后，直接转到)/u.test(item)
    ),
  );
  const hasSettledNarrative = Boolean(
    String(delta.beatContract?.settledNarrative || "").trim(),
  );
  const lengthRegister = hasSettledNarrative
    ? "已结算动作正文不计入你的输出。你只续写其后的 NPC 回应与新压力，目标 140—260 个汉字，最长 360 个汉字；到下一个玩家必须回应的时刻立即停下。"
    : authoredSceneTransition
    ? "这是一个跨场承接 beat：目标 320—480 个汉字，最长 560 个汉字。先收束旧场动作，再用自然段直接进入指定的新时间与地点；不要使用标题、横线或 Markdown 分隔符。新场只使用 This Turn 已列出的角色称呼，不给人物另起姓名；呈现合并后的当面反制后立即停在玩家需要回应之处。"
    : exclusiveAuthoredBeat
    ? "这是带正式文书闭集的窄幅行动 beat：目标 220—360 个汉字，最长 440 个汉字。文书只可使用结果上限列出的名称、条款和去向；不要写套语，不要扩展同义制度，不要让人物离场后再返回。"
    : narrowBeat
    ? "这是窄幅核问或观察 beat：目标 180—320 个汉字，最长 420 个汉字。直接回应一旦完成就停，不为凑长度另添证据、命令或外部事件。"
    : "使用工作集指定的小说语言和人物声音，写具体动作、对话和反制。目标 300—500 个汉字，最长 600 个汉字。";
  return [
    {
      role: "system" as const,
      content: [
        "你是互动历史小说的前景叙述者。从 Recent Canon 最后一刻继续，只写一个自然、具体、可继续游玩的剧情 beat。",
        hasSettledNarrative
          ? "Settled Action Draft 已经精确写成本回合唯一的主角行动。不要复述、改写或补充这段草稿；你的输出只从草稿最后一刻继续，不要包含草稿本身。"
          : "Reader Action 是本回合唯一的主角行动。Foreground Guidance、Memory 和 This Turn 只提供约束与叙事纹理，不要逐条复述或解释规则。",
        "当前镜头的动作、站位、对话与空间衔接以 Recent Canon 为准；持久事实变化以 This Turn 为准。让二者在小说场面里自然相接。",
        "保留玩家意图。字面动作与现场有小冲突时，从 Canon 的现在把它圆成可发生的尝试、传话或过渡；不要拒绝、倒带或瞬移。",
        "让在场人物依自己的利益和职责主动回应。普通动作、目光、衣袖、灯火、案几、普通纸张和空间调度可以自由书写。",
        "不要凭空新增具名人物、关键证据、正式文书或主角不知道的秘密；不要替主角完成 Reader Action 之外的签署、承诺或重大处置。若获准写正式文书，只使用 This Turn 列出的名称、内容和去向。",
        "场面到达下一项真正需要玩家决定的动作时停下。不要写规则说明、状态报告、选择菜单或分支总结。",
        lengthRegister,
        "只返回正文，不要标题、列表、JSON、XML、选项或解释。",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: buildForegroundUserContext(delta, narratorContext),
    },
  ];
}

function scopeNarratorContext(
  delta: CausalDelta,
  context: CompiledForegroundContext,
): CompiledForegroundContext {
  if (!delta.beatContract) return context;
  const hasSourceBoundedKnowledge = Boolean(delta.knowledgeBoundaryRef);
  const hasAuthoredRuntimeBeat = String(delta.beatContract.sourceRef || "")
    .startsWith("part-one-event:");
  if (!hasSourceBoundedKnowledge && !hasAuthoredRuntimeBeat) return context;
  const allowedSections = hasAuthoredRuntimeBeat
    ? new Set([
        "Story",
        "Scene",
        "Tone",
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
    // For a source-bounded evidence beat or an authored runtime settlement,
    // Causal Delta already owns this beat's action, staging and result ceiling.
    // Repeating every durable card and future thread makes later mysteries
    // salient too early and invites the Narrator to bridge them now. Recent
    // Canon remains the camera authority.
    durableMemory: "",
    storyMemory: "",
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
  return String(value || "")
    .split(/\r?\n/)
    .flatMap((line) => {
      if (!line.trim()) return [];
      const sentences = line.match(/[^。！？!?]+[。！？!?]?/g) || [line];
      return sentences.filter((sentence) => (
        !/(?:下一回合|本回合|当前回合|眼下).{0,20}(?:方向|选择|选项|行动).{0,6}[：:]/.test(sentence)
        && !/^(?:[-*+]\s*)?(?:总督|玩家|主角|读者).{0,24}(?:下令|命|派|召|问|查|封|签|写|给|去|留|暂缓)/.test(sentence.trim())
      ));
    })
    .join("\n")
    .trim();
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

function isBackstagePlayerMenu(value: string) {
  return /(?:T\d+\s*)?入口节点|由玩家(?:此前)?选择|路径由玩家|玩家选择决定|可实际采取的下一步入口|下一步(?:可以|可|应当|应该)是|(?:next|available|possible)\s+player\s+(?:choice|action)|player\s+(?:chooses|must choose)/iu
    .test(value);
}

function protagonistDirectiveIndex(value: string) {
  const patterns = [
    /(?:玩家(?:角色)?|读者(?:角色)?|主角|总督|舰长|船长|指挥官|调查员|领主|市长|将军|侦探|当前角色)\s*(?:必须|须|需|应当|应先|需要|务必|不可|不得|不能继续)/u,
    /(?:必须|须|应当|应先|需要|务必|不能继续)\s*(?:给出|给|作出|做出|回应|答复|选择|决定|行动|采取|签|下令|派|启动|调取|处置|离开|前往|调查|查验)/u,
    /(?:the\s+)?(?:player|reader|protagonist|governor|captain|commander|investigator|mayor|general|detective)\s+(?:must|should|needs?\s+to|has\s+to|cannot\s+continue|must\s+not)\b/iu,
  ];
  return patterns.reduce((earliest, pattern) => {
    const index = value.search(pattern);
    if (index < 0) return earliest;
    return earliest < 0 ? index : Math.min(earliest, index);
  }, -1);
}

export function sanitizeDirectedBeat(value: string) {
  const text = String(value || "").trim();
  if (!text) return "";
  const backstageScheduling =
    /(?:floor\s*T\d+|T\d+\s*(?:floor|前置|入口)|最迟(?:在|于)?(?:本|该|T\d+)?回合|由玩家(?:此前)?选择|路径由玩家|玩家选择决定|下一步入口|若T\d+|如果T\d+|前提(?:是|：|:))/iu;
  const protagonistAction =
    /(?:玩家(?:角色)?|读者(?:角色)?|主角|总督|舰长|船长|指挥官|调查员|领主|市长|将军|侦探|当前角色)\s*(?:必须|须|需|应当|应先|需要|务必|不可|不得|不能继续)/u;
  if (backstageScheduling.test(text) || protagonistAction.test(text)) return "";
  return text;
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

export const foregroundInternal = {
  DEFAULT_BUDGETS,
  compactText,
};
