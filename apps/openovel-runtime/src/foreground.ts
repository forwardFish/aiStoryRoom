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
import type { CompiledForegroundContext, OpenNovelOption, StorySnapshot } from "./types.js";
import type { WorkspacePaths } from "./paths.js";

const DEFAULT_BUDGETS = {
  guidance: 24_000,
  durableMemory: 6_400,
  storyMemory: 12_000,
  recentCanon: 24_000,
};

export async function composeForeground(paths: WorkspacePaths) {
  const template = await readText(paths.foregroundTemplate, "");
  const composed = await expandIncludes(template, paths, new Set(), 0);
  await writeAtomic(paths.foregroundGuidance, `${composed.trim()}\n`);
  return composed.trim();
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
  const clip = (name: string, value: string, max: number, tail = false) => {
    if (value.length <= max) return value;
    truncated.push(name);
    return tail ? `…\n${value.slice(-max)}` : `${value.slice(0, max)}\n…`;
  };
  const compiled: CompiledForegroundContext = {
    foregroundGuidance: clip("foregroundGuidance", stripVolatileLines(snapshot.foregroundGuidance), limits.guidance),
    durableMemory: clip("durableMemory", snapshot.durableMemory, limits.durableMemory),
    storyMemory: clip("storyMemory", snapshot.storyMemory, limits.storyMemory, true),
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
    },
  };
  compiled.report.usedChars = [
    compiled.foregroundGuidance,
    compiled.durableMemory,
    compiled.storyMemory,
    compiled.recentCanonExcerpt,
  ].reduce((sum, value) => sum + value.length, 0);
  await writeJsonAtomic(paths.contextReport, compiled.report);
  return compiled;
}

export function buildForegroundUserContext(
  action: string,
  context: CompiledForegroundContext,
  selectedActionScope = "",
) {
  const readerAction = [
    `玩家选择：${action}`,
    "",
    selectedActionScope
      ? "本回合行动信封（作者给定的即时执行范围）："
      : "本回合行动信封（以玩家原文自身为即时执行范围）：",
    selectedActionScope || action,
    "",
    "行动信封是本回合主角行动的最大范围，不是必须逐句复述的清单。",
    "问话、核对或调查只能得到 Canon、工作集或行动信封已经明确的事实；未写明的数字、姓名、证词、文书内容、保管状态和调查结果仍然未知。",
    "只演完这个动作及 NPC 的直接回应；如果动作要求问话、试探、查看、等待或听取说明，就在对方作答、拒答或材料呈现后停下，把主角如何处置留给玩家下一回合。",
    "到下一项需要玩家决定的重大行动之前立即停下，不替玩家签发、下令、答复、承诺、放人离场或完成后续处置。",
  ].join("\n");
  const blocks = [
    "# Foreground Context",
    "",
    "Foreground Guidance 是可能滞后一轮的小型工作集；Recent Canon Excerpt 是当前镜头的权威。前面的内容只提供约束和叙事纹理，不是要求逐条复述的施工清单。",
    section("Foreground Guidance", context.foregroundGuidance),
    section("Durable Memory", context.durableMemory),
    section("Story Memory", context.storyMemory),
    section("Recent Canon Excerpt", context.recentCanonExcerpt),
    section("Reader Action", readerAction),
  ].filter(Boolean);
  const rendered = blocks.join("\n\n").trim();
  const marker = "## Reader Action";
  if (rendered.lastIndexOf(marker) < rendered.length - section("Reader Action", readerAction).length - 2) {
    throw new Error("Reader Action must remain the final foreground section");
  }
  return rendered;
}

export function buildNarratorMessages(
  action: string,
  context: CompiledForegroundContext,
  selectedActionScope = "",
) {
  return [
    {
      role: "system" as const,
      content: [
        "你是互动历史小说的前景叙述者。只写从最新 Canon 结尾继续的一个自然剧情 beat。",
        "最新 Reader Action 是本回合唯一的主角行动指令；更早的工作集、压力和开放线程只是约束与叙事纹理，不是要求本回合逐项执行的命令。",
        "Recent Canon 是当前镜头权威；Foreground Guidance 可能滞后，只约束持久事实、人物关系、语气和未来方向。",
        "只落实 Reader Action 已经授权的行动，并让在场人物或外部压力依自身目的回应。可以补足提笔、转身、传话等无独立战略含义的连续动作；不得替主角新增签发、落印、批准、封存、调人、行文、承诺、离场等重大行动。",
        "当场面来到下一个需要主角决定的制度动作时就停下，让后置 Options 和玩家自由输入接手。尤其不能把“先问、先查、暂缓、不签”写成同一回合里随后又签、又下令、又完成处置。",
        "调查动作不会自动产生新证据。若工作集只说“报疑”而没有具体数字、姓名或原文，就让人物承认不知道、说明证据未到，或把取得材料留作下一步；不要为了让问话有内容而编造精确数字、具名经手人、既成程序或关键证词。",
        "如果玩家动作与当前场面冲突，从 Canon 的现在圆回去：保留意图，把它转成现在能做的尝试、传令或过渡；不拒绝、不倒带、不瞬移，也不假装已经成功。",
        "不要复写上一 beat。不要新增上下文里没有来源的具名人物，也不要泄漏主角不知道的幕后信息。",
        "用中文历史权谋小说正文推进场面，克制、具体、有对话和动作。采用短回合：目标 300—500 个汉字，硬上限 600 个汉字；材料再多也在最近的真实分叉处提前停下，不得以写长来包办整场处置。",
        "只返回正文，不要标题、列表、JSON、XML、选项或解释。",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: buildForegroundUserContext(action, context, selectedActionScope),
    },
  ];
}

export function buildOptionsMessages(
  action: string,
  narration: string,
  snapshot: StorySnapshot,
  context: CompiledForegroundContext,
) {
  const previousLabels = snapshot.previousOptions.map((option) => option.label);
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
        "只返回严格 JSON：{\"framing\"?:string,\"options\":[{\"label\":string,\"key\"?:true,\"effect\"?:{\"intent\"?:string,\"consequence\"?:string,\"stateHints\"?:array,\"risk\"?:\"low\"|\"medium\"|\"high\",\"difficulty\"?:string,\"reversible\"?:boolean}}],\"tension\":string,\"storyComplete\"?:boolean}",
        "</output>",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        snapshot.optionsGuidance.trim()
          ? `<options_guidance>\n${snapshot.optionsGuidance.trim()}\n</options_guidance>`
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
    const included = await readText(file, "");
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
