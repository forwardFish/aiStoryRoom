import path from "node:path";
import { readJson, writeAtomic, writeJsonAtomic } from "./io.js";
import type { OpenNovelOption, RunMetadata } from "./types.js";
import type { WorkspacePaths } from "./paths.js";

type OpeningAsset = {
  packageVersion: string;
  schemaVersion: string;
  prologueNarrative: string;
  story: {
    title: string;
    resultNarrative: string;
    nextSituationNarrative: string;
  };
  decisions: Array<{
    decisionId: string;
    description: string;
    intent?: string;
    method?: string;
    concreteCost?: string;
    expectedCountermove?: string;
  }>;
};

type NarrativeStyle = {
  language?: string;
  pov?: string;
  tense?: string;
  register?: string[];
  proseRules?: string[];
  dialogueRules?: string[];
  characterVoices?: Record<string, string[]>;
  forbiddenTerminologyPhrases?: string[];
  forbiddenModernPhrases?: string[];
  forbiddenSystemPhrases?: string[];
  forbiddenAiSummaryPatterns?: string[];
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
];

export async function seedSangtianWorkspace(
  paths: WorkspacePaths,
  metadata: RunMetadata,
  projectRoot: string,
) {
  const openingPath = path.join(
    projectRoot,
    "packages",
    "templates",
    "config",
    "sangtian",
    "story-package",
    "opening.json",
  );
  const stylePath = path.join(
    projectRoot,
    "packages",
    "templates",
    "authoring",
    "sangtian",
    "narrative",
    "style-profile.approved.json",
  );
  const opening = await readJson<OpeningAsset | null>(openingPath, null);
  if (!opening) throw new Error(`Sangtian opening asset is missing: ${openingPath}`);
  const style = await readJson<NarrativeStyle>(stylePath, {});

  const openingOptions: OpenNovelOption[] = opening.decisions.map((decision, index) => ({
    id: decision.decisionId || `opening_${index + 1}`,
    label: decision.description.trim(),
    key: true,
    effect: {
      intent: decision.method || decision.intent,
      consequence: [decision.concreteCost, decision.expectedCountermove].filter(Boolean).join("；"),
      risk: index === 0 ? "medium" : "high",
      reversible: false,
    },
  }));

  const openingCanon = [
    `# ${opening.story.title}`,
    "",
    opening.prologueNarrative.trim(),
    "",
    opening.story.resultNarrative.trim(),
    "",
    opening.story.nextSituationNarrative.trim(),
    "",
  ].join("\n");
  const recentOpening = [
    opening.story.resultNarrative.trim(),
    "",
    opening.story.nextSituationNarrative.trim(),
  ].join("\n");

  await Promise.all([
    writeAtomic(paths.brief, sangtianBrief()),
    writeAtomic(paths.chapters, openingCanon),
    writeAtomic(paths.chaptersRecent, `${recentOpening}\n`),
    writeAtomic(paths.foregroundTemplate, foregroundTemplate()),
    writeAtomic(paths.cardsManifest, [
      "@include story/context-cards/governor/CARD.md",
      "@include story/context-cards/xunfu-clerk/CARD.md",
      "@include story/context-cards/qingliu-messenger/CARD.md",
      "",
    ].join("\n")),
    writeAtomic(paths.cardsAutoManifest, ""),
    writeAtomic(paths.optionsGuidance, optionsGuidance()),
    writeAtomic(paths.qualityLog, qualitySeed()),
    writeAtomic(paths.arcLog, arcSeed()),
    writeAtomic(paths.storyMemory, storyMemorySeed()),
    writeJsonAtomic(paths.currentOptions, openingOptions),
    writeJsonAtomic(paths.jobs, { storykeeper: { status: "IDLE" }, updatedAt: metadata.createdAt }),
  ]);

  const sections: Record<string, string> = {
    "header.md": [
      "## Story",
      "",
      "- 《桑田诏》第一部分：急令与暗册。",
      "- 视角人物：浙江总督。所有叙述都从他能看见、听见、判断或命人查证的范围展开。",
    ].join("\n"),
    "scene.md": [
      "## Scene",
      "",
      "- 嘉靖三十五年五月初八，杭州总督府内厅。",
      "- 巡抚书吏捧着回文匣等候答复；清流县令亲随也在场。",
      "- 案上有巡抚催办公文和清流县令密信。密信只有报疑，没有原册、具结或定罪证据。",
      "- 现在必须承接内厅里两边都不肯退的最后一刻，不重讲公文送到的过程。",
    ].join("\n"),
    "tone.md": renderTone(style),
    "active-characters.md": [
      "## Active Characters",
      "",
      "- 浙江总督：玩家角色，权力很重，处境却受皇命、地方责任和证据不足同时约束。不要替他作出玩家尚未选择的重大承诺。",
      "- 巡抚书吏：奉命等候回文，谨慎守礼，但会把总督的态度和每一句答复带回巡抚衙门。他只知道自己携带的催办公文、取回答复的差事和亲眼所见；不知道清流县册内容、具体田亩数字或巡抚未公开的另行安排。",
      "- 清流县令亲随：只负责送来县令的报疑密信并候令；他说不出原册内容，也不能替县令指认幕后人物。",
      "- 浙江巡抚：此刻不在内厅。他要尽快推进改桑，并争夺第一份奏报的解释权，会通过书吏、公文和后续动作施压。",
      "- 清流县令：此刻不在内厅。他最早发现县册疑点，但证据不完整，既怕误告，也怕材料被动。",
    ].join("\n"),
    "relationships.md": [
      "## Relationships",
      "",
      "- 总督与巡抚：同为浙江大员，表面协同执行国策，实际争夺执行边界、复核主持权和入京叙述权。",
      "- 总督与清流县令：总督可以命其查验和保护材料，但县令的密报目前只能作为调查入口，不能作为定罪结论。",
      "- 巡抚书吏与县令亲随：都在观察总督如何处置，彼此并不信任，也没有权力替各自主官让步。",
    ].join("\n"),
    "constants.md": [
      "## Constants",
      "",
      "- 朝廷要求浙江三日内具报改桑执行方案。",
      "- 杭州米价已连涨，已有米行闭门；这是正在加重的民生压力，不是已经爆发的全城粮荒。",
      "- 清流县令密信只说县册数字似有改痕，没有随信附原册、田契、暗账或经手人具结。",
      "- 巡抚催办公文仍待总督答复，玩家尚未签发改桑放行文书。",
      "- 第一部分的核心是执行权、证据权与第一份奏报解释权的争夺；不能提前完成破案或御前裁决。",
      "- 任何关键证据、正式文书、具名人物和秘密都必须由既有 Canon、Context Card 或自然查证过程进入故事。",
    ].join("\n"),
    "open-threads.md": [
      "## Open Threads",
      "",
      "- 怎样答复巡抚，既不让拖延国策的罪名先坐实，也不让可疑县册变成既成事实？",
      "- 谁来主持县册复核，谁能接触原件，谁来写第一份具报？",
      "- 清流县档房和经手人是否还来得及保护？",
      "- 粮价上涨究竟会怎样逼迫官府、商人和百姓选边？",
    ].join("\n"),
    "active-pressures.md": [
      "## Active Pressures",
      "",
      "- [URGENT] 巡抚书吏仍在内厅等候答复，不能无限拖延。",
      "- [HIGH] 三日具报期限正在倒数，先写出的政治叙述会约束后来的调查。",
      "- [HIGH] 县册若确有改动，迟一步可能使原件、经手链或现场发生变化。",
      "- [MEDIUM] 米价连涨和米行闭门正在把抽象国策变成地方危机。",
    ].join("\n"),
    "directed-beat.md": "",
    "pending-consequence.md": "",
    "forbidden.md": [
      "## Forbidden",
      "",
      "- 不得把“报疑”写成已经证实的篡改，更不得直接宣布巡抚或商会是幕后主使。",
      "- 不得凭空出现暗账、田契副本、口供、密令或已经完成的封存程序；需要时让人物通过行动去寻找。",
      "- 不得把内部规则、状态字段、验证语言、利弊分析或选项说明写进小说正文。",
      "- 避免现代报告腔和系统腔。用人物、场面、话语、迟疑和反制呈现压力。",
      "- 不要复述刚刚发生的开场，也不要让所有人物停住等待总督一句话；NPC 应依各自职责主动试探和传递压力。",
    ].join("\n"),
  };

  await Promise.all(
    FRONTEND_FILES.map((name) => writeAtomic(path.join(paths.frontendDir, name), `${sections[name] || ""}\n`)),
  );

  await Promise.all([
    writeCard(paths, "governor", ["浙江总督", "总督", "督宪"], [
      "# 浙江总督",
      "",
      "玩家角色。统筹浙江军政、粮饷和地方秩序，有权发文、调人、命查和具报；但不能凭怀疑定罪，也不能越过朝廷改写国策。",
    ].join("\n")),
    writeCard(paths, "xunfu-clerk", ["巡抚书吏", "书吏", "中丞的书吏"], [
      "# 巡抚书吏",
      "",
      "奉浙江巡抚之命送来催办公文并取回答复。守礼、谨慎、记性好，会把总督的态度和具体措辞带回去。没有独立修改公文或代表巡抚妥协的权限。",
      "",
      "## Knowledge Boundary",
      "",
      "- 已知：自己携带的催办公文、巡抚要求取回答复的差事，以及他在总督府亲眼听见和看见的事。",
      "- 未知：清流县册内容、任何具体田亩数字、未在 Canon 出现的汇总表册，以及巡抚是否私下派过其他人。",
      "- 被问到未知事项时，只能如实说不知道、说明自己未曾经手，或请主官另行答复；不能为了应答而新造公文、数字、经手经历或幕后安排。",
    ].join("\n")),
    writeCard(paths, "qingliu-messenger", ["县令亲随", "清流县令亲随", "亲随"], [
      "# 清流县令亲随",
      "",
      "连夜送来清流县令密信，只知道县令报疑、原册没有随信送来。他能受命返回清流传话，但不能替县令提供不存在的证据。",
    ].join("\n")),
    writeCard(paths, "governor-runner", ["总督府差役", "差役", "值差", "府中差人"], [
      "# 总督府差役",
      "",
      "这是总督府内可受命传话、送文或随行监督的匿名职役，不是一个已经具名的常驻角色。",
      "",
      "## Identity Boundary",
      "",
      "- 正文只称“差役”“值差”或“府中差人”，不得临时添加姓名、绰号、外貌履历或私人关系。",
      "- 他可以准确转达玩家本回合明确授予的命令，但不能自行扩大权限、查看证据内容、扣押人员或替总督作结论。",
      "- 只有后续 Canon 让某一名差役产生长期独立影响，并由 Storykeeper 明确晋升为持续实体时，才另建个人 Context Card。",
    ].join("\n")),
    writeCard(paths, "xunfu", ["浙江巡抚", "巡抚", "中丞"], [
      "# 浙江巡抚",
      "",
      "急于推进改桑并掌握具报口径。会以期限、粮价和国策名分催促总督，也会争取让复核结果先归巡抚衙门汇总。此刻不在总督府内厅。",
    ].join("\n")),
    writeCard(paths, "qingliu-magistrate", ["清流县令", "县令", "县尊"], [
      "# 清流县令",
      "",
      "最早发现县册数字似有改痕，因证据不足只敢报疑。他既想保住原件和经手链，也担心被归为阻挠国策。此刻不在总督府内厅。",
    ].join("\n")),
  ]);

  return {
    opening,
    openingOptions,
    openingCanon,
    recentOpening,
  };
}

function foregroundTemplate() {
  return [
    "@include story/frontend/header.md",
    "@include story/frontend/scene.md",
    "@include story/frontend/tone.md",
    "@include story/frontend/active-characters.md",
    "@include story/frontend/relationships.md",
    "@include story/frontend/constants.md",
    "@include story/frontend/open-threads.md",
    "@include story/frontend/active-pressures.md",
    "@include story/frontend/directed-beat.md",
    "@include story/frontend/pending-consequence.md",
    "@include story/guidance/cards.auto.md",
    "@include story/guidance/cards.md",
    "@include story/frontend/forbidden.md",
    "",
  ].join("\n");
}

function sangtianBrief() {
  return [
    "# 《桑田诏》Story Brief",
    "",
    "玩家扮演浙江总督，在嘉靖财政危局中处理改稻为桑。故事必须有原著权力逻辑和现实代价，但不是复刻原著人物线路。",
    "",
    "第一部分“急令与暗册”只处理县册疑云与复核权争夺：改桑必须回应，证据尚不完整，粮价正在上升，各方争夺执行、复核和第一份奏报的解释权。",
    "",
    "剧情要像连续的历史权谋小说：人物主动行动，决定可被普通玩家理解，每个选择改变后来的人物态度、证据机会、民生压力或政治责任。不要写成工作报告、规则说明、问答题或预设胜负的选择题。",
  ].join("\n");
}

function renderTone(style: NarrativeStyle) {
  const profileLines = [
    ...(style.register || []),
    ...(style.proseRules || []),
    ...(style.dialogueRules || []),
  ].filter(Boolean).slice(0, 18);
  return [
    "## Tone",
    "",
    "- 使用中文第三人称近距离叙事，镜头贴近浙江总督能感知的场面。",
    "- 语言克制、具体，有《大明王朝1566》式的权力分寸、含蓄对话和现实压力；学习其结构与气质，不复制原句。",
    "- 用动作、停顿、称谓、递话和人物之间的试探呈现政治含义，不替读者总结“核心矛盾”和“决策代价”。",
    "- 一回合只推进一个自然 beat，既回应玩家行动，也让世界或 NPC 向前走一步，停在新的可行动时刻。",
    ...profileLines.map((line) => `- ${line}`),
  ].join("\n");
}

function optionsGuidance() {
  return [
    "# Options Guidance",
    "",
    "- 建议行动只是帮助玩家，不是故事闸门；玩家可以始终自由输入。",
    "- 每个 label 只写玩家下一步要做什么，不显示后台 intent、risk、cost、countermove 或正确答案暗示。",
    "- 2—4 个方向应真正不同：例如立即处置、继续问话、派人查验、暂缓观察；不要把同一动作换词重复。",
    "- 每项只写一个主要制度动作；不要把封存、送册、签发、派人等多个重大动作捆在同一项。",
    "- 可以建议查找未知事实，但不能把尚不存在的原册细节、具体疑点、证人、文书或数字写成已经掌握。",
    "- 选项必须从最新正文结尾出发，不能重做已经完成的动作，也不能提前保证结果。",
    "- 只有真正不可逆的制度选择才标为 key，并把后果放进隐藏 effect。",
  ].join("\n");
}

function qualitySeed() {
  return [
    "# Story Quality",
    "",
    "后台笔记，不进入 Narrator。",
    "",
    "每轮检查：是否复写；是否报告腔；NPC 是否主动；上一选择是否有回应；是否发生玩家可感知的连续性错误。修复下一轮工作集，不改已发布 Canon。",
  ].join("\n");
}

function arcSeed() {
  return [
    "# Arc",
    "",
    "第一部分：急令与暗册。",
    "",
    "当前段落：第一节“急令压案”。先形成答复、责任和复核方式，再推进县册现场。不要急着引入完整暗账、商会主线或京师裁决。",
    "",
    "松弛节奏目标：G00—T05 让开场决定产生反制，并自然形成去清流县或调取材料的下一步入口。玩家选择可以改变路径，不要求每五回合机械结束一节。",
  ].join("\n");
}

function storyMemorySeed() {
  return [
    "# Story Memory",
    "",
    "- 这是一次新 Run；当前可靠历史以 opening Canon 和随后追加的正文为准。",
    "- 记忆只保存跨回合仍会改变行为的事实，不复制逐场摘要。",
  ].join("\n");
}

async function writeCard(paths: WorkspacePaths, slug: string, triggers: string[], body: string) {
  const content = [
    "---",
    `name: ${slug}`,
    "target: foreground",
    `triggers: [${triggers.map((item) => JSON.stringify(item)).join(", ")}]`,
    "max_chars: 1800",
    "---",
    "",
    body,
    "",
  ].join("\n");
  await writeAtomic(path.join(paths.contextCardsDir, slug, "CARD.md"), content);
}
