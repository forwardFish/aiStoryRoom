/*
 * This slow-loop organization is derived from Feed-Scription/openovel:
 * src/workflows/storykeeperContext.js, src/workflows/storykeeperWorkflow.js,
 * and src/runtime/sessionProcessor.js. Licensed under Apache-2.0.
 * Modified for Our Many Worlds on 2026-07-27.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { jsonrepair } from "jsonrepair";
import { appendText, compactText, readJson, readText, writeAtomic } from "./io.js";
import {
  composeForeground,
  formatFrontendSection,
  sanitizeOptionsGuidance,
  sanitizeDirectedBeat,
} from "./foreground.js";
import {
  removeUnsupportedObjectiveClaims,
  unsupportedClaimsFromWarnings,
} from "./shadow-claims.js";
import type { FileStoryWorkspace } from "./workspace.js";
import type {
  OpenNovelProvider,
  ProviderRequest,
  ProviderResult,
  RuntimeWarning,
  StorykeeperInboxItem,
} from "./types.js";

const SECTION_FILES = new Set([
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
]);

/**
 * A Storykeeper model reads player POV prose, so its free-form summaries are
 * advisory rather than a second world-state writer. Only presentation-only
 * sections may be applied directly. Fact-bearing worksets are materialized
 * below from server-owned settlement data.
 */
const MODEL_WRITABLE_SECTIONS = new Set([
  "tone.md",
]);

export class StorykeeperDrain {
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly workspace: FileStoryWorkspace,
    private readonly provider: OpenNovelProvider,
  ) {}

  kick(runId: string) {
    const active = this.running.get(runId);
    if (active) return active;
    const task = this.drain(runId)
      .catch(() => {})
      .finally(() => this.running.delete(runId));
    this.running.set(runId, task);
    return task;
  }

  isRunning(runId: string) {
    return this.running.has(runId);
  }

  private async drain(runId: string) {
    let releaseLease: (() => Promise<void>) | undefined;
    try {
      releaseLease = await this.workspace.acquireStorykeeperLease(runId);
    } catch (error) {
      if (String((error as Error).message || error) === "RUN_STORYKEEPER_BUSY") return;
      throw error;
    }
    try {
      while (true) {
        const { items, state } = await this.workspace.inbox(runId);
        const item = items.find((candidate) => !state.processed.includes(candidate.id));
        if (!item) {
          await this.workspace.writeJobState(runId, {
            storykeeper: {
              status: "IDLE",
              deadLetters: Object.keys(state.deadLetters || {}).length,
              updatedAt: new Date().toISOString(),
            },
          });
          return;
        }
        const priorAttempts = state.attempts?.[item.id] || (state.failures[item.id] ? 1 : 0);
        const maxAttempts = storykeeperMaxAttempts();
        const reusableRecordedResult = await recordedStorykeeperResult(
          this.workspace,
          runId,
          item.turnId,
        );
        if (priorAttempts >= maxAttempts && !reusableRecordedResult) {
          await this.moveToDeadLetter(
            runId,
            item,
            state.failures[item.id] || "Storykeeper retry limit reached",
            priorAttempts,
          );
          continue;
        }
        await this.workspace.writeJobState(runId, {
          storykeeper: {
            status: "RUNNING",
            itemId: item.id,
            turnId: item.turnId,
            attempt: priorAttempts + 1,
            updatedAt: new Date().toISOString(),
          },
        });
        try {
          if (await storykeeperItemAlreadyApplied(this.workspace, runId, item.id)) {
            await this.workspace.markInbox(runId, item.id, { processed: true });
            continue;
          }
          await this.processItem(runId, item, {
            attempt: priorAttempts + 1,
            compactRetry: priorAttempts > 0 || storykeeperCompactFirst(),
          });
          await this.workspace.markInbox(runId, item.id, { processed: true });
        } catch (error) {
          const message = String((error as Error).message || error);
          await this.workspace.markInbox(runId, item.id, { processed: false, error: message });
          if (priorAttempts + 1 >= maxAttempts) {
            await this.moveToDeadLetter(runId, item, message, priorAttempts + 1);
            continue;
          }
          await this.workspace.writeJobState(runId, {
            storykeeper: {
              status: "FAILED",
              itemId: item.id,
              turnId: item.turnId,
              error: message.slice(0, 1000),
              updatedAt: new Date().toISOString(),
            },
          });
          return;
        }
      }
    } finally {
      await releaseLease().catch(() => {});
    }
  }

  private async moveToDeadLetter(
    runId: string,
    item: StorykeeperInboxItem,
    error: string,
    attempts: number,
  ) {
    await this.workspace.deadLetterInbox(runId, item.id, error);
    await this.workspace.recordSceneEvent(runId, {
      type: "storykeeper_dead_letter",
      turnId: item.turnId,
      itemId: item.id,
      attempts,
      error: error.slice(0, 1_000),
      canonPreserved: true,
    }).catch(() => {});
    await this.workspace.appendQuality(
      runId,
      `## ${item.turnId} Storykeeper deferred\n\n后台归并在 ${attempts} 次有界尝试后进入 dead-letter；Canon 保留，后续前景继续以 Recent Canon 为权威。`,
    ).catch(() => {});
  }

  private async processItem(
    runId: string,
    item: StorykeeperInboxItem,
    retry: { attempt: number; compactRetry: boolean },
  ) {
    const paths = this.workspace.paths(runId);
    if (
      item.narrativeOwner === "COMPOSED"
      || item.narrativeOwner === "FALLBACK"
      || item.narrativeOwner === "PROTECTED_RENDERER"
    ) {
      const deterministicFiles = await applySettlementWorksetProjection(paths, item);
      await composeForeground(paths);
      await this.workspace.recordSceneEvent(runId, {
        type: "storykeeper_applied",
        turnId: item.turnId,
        itemId: item.id,
        mode: "SETTLEMENT_ONLY",
        filesChanged: deterministicFiles,
        summary: "Durable scene facts were already owned by Settlement; no advisory model pass was required.",
        ignoredAdvisoryFactSections: [],
        ignoredAdvisoryContextCards: [],
      });
      return;
    }
    const snapshot = await this.workspace.snapshot(runId);
    const registry = await readContextCardRegistry(paths);
    const messages = buildStorykeeperMessages(item, snapshot, registry, retry.compactRetry);
    const request: ProviderRequest = {
      profile: "storykeeper",
      messages,
      temperature: 0.35,
      maxTokens: retry.compactRetry ? 2_000 : 5_000,
      json: true,
      // Storykeeper remains backstage and non-blocking. Streaming is only a
      // more reliable transport for the model's final JSON object.
      stream: true,
    };
    const recorded = await recordedStorykeeperResult(this.workspace, runId, item.turnId);
    let result = recorded;
    if (!result) {
      try {
        result = await this.provider.generate(request);
        await this.workspace.recordModelCall(
          runId,
          item.turnId,
          "storykeeper",
          request,
          result,
          undefined,
          retry.attempt,
        );
      } catch (error) {
        await this.workspace.recordModelCall(
          runId,
          item.turnId,
          "storykeeper",
          request,
          undefined,
          error,
          retry.attempt,
        );
        throw error;
      }
    }
    const patch = quarantineUnsupportedClaims(
      parseStorykeeperPatch(result.text),
      item.warnings || [],
    );
    // A model-authored card can silently turn a POV detail or an attributed
    // report into durable world truth. Runtime-created cards therefore require
    // a future typed entity/event projection; unreferenced prose candidates are
    // retained only in the audit record and never enter the foreground.
    const resolvedCards: ReturnType<typeof resolveContextCardIdentities> = [];
    for (const [name, content] of Object.entries(patch.sections)) {
      if (!SECTION_FILES.has(name) || !MODEL_WRITABLE_SECTIONS.has(name)) continue;
      const normalized = formatFrontendSection(name, content);
      await writeAtomic(path.join(paths.frontendDir, name), normalized ? `${normalized}\n` : "");
    }
    const deterministicFiles = await applySettlementWorksetProjection(paths, item);
    if (patch.directorArc?.trim()) {
      await writeAtomic(paths.arcLog, `${patch.directorArc.trim()}\n`);
    }
    if (patch.optionsGuidance?.trim()) {
      const reusableGuidance = sanitizeOptionsGuidance(patch.optionsGuidance);
      if (reusableGuidance) {
        await writeAtomic(paths.optionsGuidance, `${reusableGuidance}\n`);
      }
    }
    if (patch.qualityNotes?.trim()) {
      await appendText(paths.qualityLog, `\n\n## ${item.turnId}\n\n${patch.qualityNotes.trim()}\n`);
    }
    await composeForeground(paths);
    await this.workspace.recordSceneEvent(runId, {
      type: "storykeeper_applied",
      turnId: item.turnId,
      itemId: item.id,
      filesChanged: [
        ...Object.keys(patch.sections).filter((name) => MODEL_WRITABLE_SECTIONS.has(name)),
        ...deterministicFiles,
        ...resolvedCards.map((card) => `context-cards/${card.slug}/CARD.md`),
        ...(patch.directorArc?.trim() ? ["director/ARC.md"] : []),
      ],
      summary: patch.summary,
      ignoredAdvisoryFactSections: Object.keys(patch.sections)
        .filter((name) => SECTION_FILES.has(name) && !MODEL_WRITABLE_SECTIONS.has(name)),
      ignoredAdvisoryContextCards: patch.contextCards.map((card) => card.slug),
    });
  }
}

async function recordedStorykeeperResult(
  workspace: FileStoryWorkspace,
  runId: string,
  turnId: string,
) {
  const callsDir = workspace.paths(runId).callsDir;
  const files = await readdir(callsDir).catch(() => []);
  const candidates = files
    .filter((name) => new RegExp(`^${turnId}\\.storykeeper(?:\\.\\d+)?\\.json$`).test(name))
    .sort()
    .reverse();
  for (const name of candidates) {
    const call = await readJson<{
      stage?: string;
      result?: ProviderResult | null;
      error?: string | null;
    } | null>(path.join(callsDir, name), null);
    if (
      call?.stage === "storykeeper"
      && !call.error
      && call.result?.text?.trim()
    ) {
      return call.result;
    }
  }
  return null;
}

async function storykeeperItemAlreadyApplied(
  workspace: FileStoryWorkspace,
  runId: string,
  itemId: string,
) {
  const sceneLog = await readText(workspace.paths(runId).sceneLog, "");
  return sceneLog.split(/\r?\n/).some((line) => {
    if (!line.trim()) return false;
    try {
      const event = JSON.parse(line) as { type?: string; itemId?: string };
      return event.type === "storykeeper_applied" && event.itemId === itemId;
    } catch {
      return false;
    }
  });
}

function buildStorykeeperMessages(
  item: StorykeeperInboxItem,
  snapshot: Awaited<ReturnType<FileStoryWorkspace["snapshot"]>>,
  contextCardRegistry: ContextCardRegistryEntry[],
  compactRetry = false,
) {
  if (compactRetry) {
    return buildCompactStorykeeperMessages(item, snapshot, contextCardRegistry);
  }
  return [
    {
      role: "system" as const,
      content: [
        "你是互动小说的后台 Storykeeper。前景正文已经发布，绝不能修改、否定或重写 Canon。",
        "你的任务是读取玩家行动、真实正文、Recent Canon、BRIEF 和当前 Foreground Guidance，维护下一轮的小型工作集。",
        "published_narration 是玩家实际看到的文学正文，只用于场面连续、文风和质量判断；fact_projection 是移除 Shadow 后的后台投影。两者都不是权威状态源，持久事实只能来自 causal_delta、已结算 effect 与服务器工作集。shadow_claims 没有状态写入权，不能进入 Constants、Memory 或 Context Card。",
        "世界状态、Scene、Characters、Relationships、Constants、Threads、Pressure、Pending Consequence、Cards 与 Memory 都由服务器从 Settlement/Causal Event 投影；你无权写入这些事实字段。sections 只可返回 tone.md。",
        "Recent Canon 决定当前镜头。Guidance 若与最新正文的站位、时间或刚发生的事冲突，以 Canon 为准。",
        "recent_canon_before 是本轮正文提交前的 Canon；recent_canon 已包含 published_narration。published_narration 出现在 recent_canon 里是正常提交结果，绝不能据此判定复写。判断本轮是否重演旧场景，只比较 recent_canon_before 与 published_narration。",
        "causal_delta 是服务器从真实玩家输入或已绑定选项生成的短因果信封。只把其中已发生的行动和 presentThisTurn 持久结果写入下一轮状态；未来 consequence 仍是待兑现压力，不得提前写成既成事实。",
        "shadow_warnings 只标记正文里可能无来源的持久事实，不否定或改写 Canon。若警告来自角色对白、转述或猜测，把它保留为该角色的未经核实说法，不得升级成客观 Constants；在 Open Threads、Pending Consequence 或 Context Card 中明确谁说了什么、尚缺什么查证。若是叙述者直接断言，则限制其后续影响，并把核验真伪列为开放线程。",
        "若 shadow_warnings 含 MISSING_REQUIRED_BEAT_OUTCOME，当前正文仍已发布；不要假装该镜头已经呈现。把尚未被玩家看到的 NPC 反应、世界动作或即时后果压缩为下一轮 Scene / Pending Consequence / directed-beat 中的一项自然补偿，出现一次后清除。不得借补偿重做玩家选择或重复整段上一回合。",
        "凡某个事实在本轮 Canon 中只通过对白、书信、转述、猜测或单方报告出现，即使 shadow_warnings 没有逐项列出，也必须在 Scene、Active Characters、Memory 和 Context Card 的每一次引用中保留来源与未核实状态；不得在第一句先当客观事实陈述、下一句才补免责声明。",
        "Constants 只放持久事实。普通纸张、目光、衣袖、灯火和临时站位不升级为状态实体。",
        "Context Card 只用于会在后续继续被准确引用、其身份或状态会改变行为的持续实体。匿名差役、一次性路人和普通叙事物件不要建卡；如果正文误给匿名职役临时起名，不要用建卡固化错误，而要在下一轮 Guidance 恢复其匿名职役称呼。",
        "更新已有实体时必须复用既有 slug；只有 Canon 首次建立了真正持续的新实体时，才在 contextCards 返回新卡。curate=true 仅用于接下来数轮都必须在前景中的卡。",
        "玩家选择的隐藏 consequence 只作为未来影响线索，不能把尚未发生的结果写成既成事实。",
        "逐字比较 reader_action 与 published_narration：如果正文替玩家多签、下令、承诺或反做了玩家明确暂缓的事，必须在 qualityNotes 标为玩家代理权错误，并在下一轮 Guidance 限制继续扩大；不得把它美化成“部分转化”。",
        "在 qualityNotes 记录重复、报告腔、角色被动或连续性问题，并通过下一轮 Guidance 修根因；不要修改已发布正文。",
        "OPTIONS Guidance 只能写跨场景可复用的选择哲学、标签风格和真假分叉判断，绝不能列出“下一回合可选”的具体行动、候选标签或场景菜单；具体选项完全由独立 Options 调用根据最新正文生成。",
        "director_arc 是只供后台推理的节奏、伏笔和结构期限台账，绝不直接进入 Narrator。每轮都要将它与最新 Canon 和玩家实际选择重新对齐；可以在 directorArc 返回更新后的完整台账。",
        "ARC 中的 floor 是结构节拍最迟应发生的回合，不是要求玩家采取某个动作。达到 floor 且前提成立时，将一个已经由 BRIEF、Canon、人物或 Active Pressure 建立过的外部动作，翻译成 directed-beat.md 里的裸世界事件；不得替玩家响应、签字、成功或失败。",
        "当前回合号以 <turn> 的整数为准。只有 current turn 大于或等于 floor 数字时才能写“floor 已到/已触发”；例如 T01 不得把 floor T03 写成已经到达。未来 floor 只能保留为尚未到期的后台期限。",
        "每个正文 beat 至少推进情节、关系或风险之一。若最近两个 beat 都只是在起草、改字、复述、等待或处理同一件微小事务，下一轮必须让一个已埋下的 NPC 或外部压力独立向前走；这不是凭空制造证据，也不是强迫玩家按大纲行动。",
        "directed-beat.md 一旦已在 Canon 中发生就清空；若两轮仍未自然发生，说明前提不成立，应在 directorArc 中改写或延后前提，而不是继续加码。",
        "story_memory 是跨较长距离仍会改变人物行为或后续可行性的紧凑记忆，不是逐回合摘要。只有本轮新增、修正或淘汰了这种持久事实时，才在 storyMemory 返回更新后的完整记忆；普通动作、对白措辞和临时物件不写入。",
        "只返回严格 JSON：{\"summary\":string,\"sections\":{\"tone.md\"?:string},\"directorArc\"?:string,\"optionsGuidance\"?:string,\"qualityNotes\"?:string}。不要返回 storyMemory 或 contextCards。",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `<brief>\n${compactText(snapshot.brief, 6_000)}\n</brief>`,
        `<turn>\n${snapshot.metadata.turnNumber}\n</turn>`,
        `<director_arc>\n${compactText(snapshot.directorArc, 8_000)}\n</director_arc>`,
        `<story_memory>\n${compactText(snapshot.storyMemory, 8_000)}\n</story_memory>`,
        `<options_guidance>\n${compactText(snapshot.optionsGuidance, 4_000)}\n</options_guidance>`,
        `<context_card_registry>\n${renderContextCardRegistry(contextCardRegistry)}\n</context_card_registry>`,
        `<foreground_guidance>\n${compactText(snapshot.foregroundGuidance, 18_000)}\n</foreground_guidance>`,
        `<recent_canon_before>\n${compactText(item.recentCanonBefore || "", 12_000)}\n</recent_canon_before>`,
        `<recent_canon>\n${compactText(snapshot.recentCanon, 12_000)}\n</recent_canon>`,
        `<reader_action>\n${item.action}\n</reader_action>`,
        `<published_narration>\n${item.publishedNarration || item.narration}\n</published_narration>`,
        `<fact_projection>\n${item.narration}\n</fact_projection>`,
        item.causalDelta
          ? `<causal_delta>\n${JSON.stringify(item.causalDelta)}\n</causal_delta>`
          : "",
        `<shadow_claims>\n${JSON.stringify(storykeeperShadowMetadata(item.shadowClaims))}\n</shadow_claims>`,
        `<shadow_warnings>\n${JSON.stringify(storykeeperWarningMetadata(item.warnings))}\n</shadow_warnings>`,
        item.selectedEffect
          ? `<selected_effect>\n${JSON.stringify(item.selectedEffect)}\n</selected_effect>`
          : "",
      ].filter(Boolean).join("\n\n"),
    },
  ];
}

function buildCompactStorykeeperMessages(
  item: StorykeeperInboxItem,
  snapshot: Awaited<ReturnType<FileStoryWorkspace["snapshot"]>>,
  contextCardRegistry: ContextCardRegistryEntry[],
) {
  return [
    {
      role: "system" as const,
      content: [
        "你是互动小说的后台 Storykeeper。每回合只做紧凑增量归并，绝不修改 Canon。",
        "Recent Canon 只供质量、节奏和连续性判断。世界事实工作集由服务器投影；你只可返回 tone.md、directorArc、optionsGuidance 和 qualityNotes。",
        "published_narration 是玩家实际看到的文学正文；fact_projection 是移除 Shadow 后的后台投影。它们只供场面连续和质量判断，持久事实只从 causal_delta、已结算 effect 与服务器工作集归并。shadow_claims 绝不能升级为 Constants、Memory 或 Context Card。",
        "recent_canon_before 是本轮正文提交前的 Canon；recent_canon 已包含 published_narration。只用二者差异判断本轮变化，不把正常追加误判成复写。",
        "causal_delta 是服务器生成的短因果信封；只归并已发生行动和 presentThisTurn 结果，未来 consequence 仍保持待兑现。",
        "selected_effect 里的 consequence 只是由选择启动的未来压力，尚未在正文发生时不得写成既成事实。",
        "工作集只记录客观世界状态、NPC 压力、尚未解决的问题和条件后果。不得写“玩家/主角必须做什么”、备选菜单、floor 调度或替玩家决定。",
        "shadow_warnings 中的未经核实说法只能保留为明确归因且未经核实的角色说法，不得进入客观常量、长期记忆或实体卡。",
        "MISSING_REQUIRED_BEAT_OUTCOME 表示一个已批准 beat 在镜头中可能没有清楚出现。不要否决 Canon；只把仍未呈现的 NPC 反应、世界动作或即时后果留作下一轮一次性补偿，呈现后清除。",
        "任何只在对白、书信、转述、猜测或单方报告里出现的事实，每一次引用中保留来源与未核实状态；不能先客观陈述再补免责声明。",
        "director_arc 是只供后台推理的节奏台账，绝不直接进入 Narrator。当前 <turn> 小于 floor 时不得写成已到期；例如 T01 不得把 floor T03 写成已经到达。只有到期且前提成立，才可把一个裸世界事件放入 directed-beat.md。",
        "若最近两个 beat 都只是在起草、改字、复述、等待或处理同一微小事务，下一轮必须让一个已经建立的 NPC 或外部压力独立推进；不得凭空制造证据，也不得替玩家响应。",
        "optionsGuidance 若返回，只能是跨场景可复用的选择原则，不能列出下一回合具体行动或候选菜单。",
        "已有实体必须复用 context_card_registry 的 slug；除非 Canon 首次建立真正持续的新实体，否则不要返回 contextCards。",
        "directed-beat.md 只允许一个已经到达当前镜头的裸世界事件，不写前提、回合号、候选事件或玩家反应；没有就省略。",
        "总输出不超过 1800 个中文字符；summary 和 qualityNotes 各不超过 120 字。",
        "只返回严格 JSON：{\"summary\":string,\"sections\":{\"tone.md\"?:string},\"directorArc\"?:string,\"optionsGuidance\"?:string,\"qualityNotes\"?:string}。不要返回 storyMemory 或 contextCards。",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `<brief>\n${compactText(snapshot.brief, 2_000)}\n</brief>`,
        `<turn>\n${snapshot.metadata.turnNumber}\n</turn>`,
        `<director_arc>\n${compactText(snapshot.directorArc, 3_000)}\n</director_arc>`,
        `<story_memory>\n${compactText(snapshot.storyMemory, 3_000)}\n</story_memory>`,
        `<options_guidance>\n${compactText(snapshot.optionsGuidance, 2_000)}\n</options_guidance>`,
        `<foreground_guidance>\n${compactText(snapshot.foregroundGuidance, 8_000)}\n</foreground_guidance>`,
        `<recent_canon_before>\n${compactText(item.recentCanonBefore || "", 5_000)}\n</recent_canon_before>`,
        `<recent_canon>\n${compactText(snapshot.recentCanon, 7_000)}\n</recent_canon>`,
        `<reader_action>\n${item.action}\n</reader_action>`,
        `<published_narration>\n${compactText(item.publishedNarration || item.narration, 5_000)}\n</published_narration>`,
        `<fact_projection>\n${compactText(item.narration, 5_000)}\n</fact_projection>`,
        item.causalDelta
          ? `<causal_delta>\n${JSON.stringify(item.causalDelta)}\n</causal_delta>`
          : "",
        `<shadow_claims>\n${JSON.stringify(storykeeperShadowMetadata(item.shadowClaims))}\n</shadow_claims>`,
        `<shadow_warnings>\n${JSON.stringify(storykeeperWarningMetadata(item.warnings))}\n</shadow_warnings>`,
        item.selectedEffect
          ? `<selected_effect>\n${JSON.stringify(item.selectedEffect)}\n</selected_effect>`
          : "",
        `<context_card_registry>\n${compactText(renderContextCardRegistry(contextCardRegistry), 3_000)}\n</context_card_registry>`,
      ].filter(Boolean).join("\n\n"),
    },
  ];
}

function parseStorykeeperPatch(raw: string) {
  const text = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0) throw new Error("Storykeeper did not return a JSON object");
  const source = end > start ? text.slice(start, end + 1) : text.slice(start);
  const parsed = parseModelJson(source);
  const rawSections = parsed.sections && typeof parsed.sections === "object"
    ? parsed.sections as Record<string, unknown>
    : {};
  const sections: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawSections)) {
    if (!SECTION_FILES.has(name) || typeof value !== "string") continue;
    sections[name] = name === "directed-beat.md"
      ? sanitizeDirectedBeat(value)
      : value;
  }
  const contextCards = Array.isArray(parsed.contextCards)
    ? parsed.contextCards.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const record = value as Record<string, unknown>;
        const slug = String(record.slug || "").trim().toLocaleLowerCase();
        const body = typeof record.body === "string" ? record.body.trim() : "";
        const triggers = Array.isArray(record.triggers)
          ? record.triggers.map((trigger) => String(trigger || "").trim()).filter(Boolean).slice(0, 16)
          : [];
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !body || !triggers.length) return [];
        return [{
          slug,
          triggers,
          body: body.slice(0, 4_000),
          curate: record.curate === true,
        }];
      }).slice(0, 8)
    : [];
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 1000) : "",
    sections,
    directorArc: typeof parsed.directorArc === "string"
      ? parsed.directorArc.slice(0, 12_000)
      : "",
    storyMemory: typeof parsed.storyMemory === "string"
      ? parsed.storyMemory.slice(0, 12_000)
      : "",
    contextCards,
    optionsGuidance: typeof parsed.optionsGuidance === "string" ? parsed.optionsGuidance : "",
    qualityNotes: typeof parsed.qualityNotes === "string" ? parsed.qualityNotes : "",
  };
}

/**
 * Materialize only facts whose provenance is already owned by the server.
 * Literary narration remains in Player Canon/Recent Canon, while future
 * consequences remain explicitly pending. This rule is identical for every
 * world and contains no story vocabulary or language-specific matching.
 */
async function applySettlementWorksetProjection(
  paths: ReturnType<FileStoryWorkspace["paths"]>,
  item: StorykeeperInboxItem,
) {
  const changed: string[] = [];
  const consequence = String(item.selectedEffect?.consequence || "").trim();
  if (consequence) {
    const content = formatFrontendSection(
      "pending-consequence.md",
      `- [${item.turnId}] 已由本轮选择启动、尚未兑现：${consequence}`,
    );
    await writeAtomic(path.join(paths.frontendDir, "pending-consequence.md"), `${content}\n`);
    changed.push("pending-consequence.md");
  }
  return changed;
}

function storykeeperShadowMetadata(claims: unknown[] | undefined) {
  return (claims || []).flatMap((claim) => {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) return [];
    const value = claim as Record<string, unknown>;
    return [{
      shadowClaimId: String(value.shadowClaimId || ""),
      kind: String(value.kind || ""),
      reason: String(value.reason || ""),
      stateWriteAllowed: false,
      durableMemoryWriteAllowed: false,
    }];
  });
}

function storykeeperWarningMetadata(warnings: RuntimeWarning[] | undefined) {
  return (warnings || []).map((warning) => ({
    code: warning.code,
    message: warning.message,
    severity: warning.severity,
    blocksPlayer: warning.blocksPlayer,
  }));
}

function parseModelJson(source: string) {
  try {
    return JSON.parse(source) as Record<string, unknown>;
  } catch (originalError) {
    // Some OpenAI-compatible providers occasionally emit a lone backslash
    // before Markdown punctuation inside an otherwise complete JSON string
    // (for example "\- item"). A lone backslash is not legal JSON. Dropping
    // only invalid escape introducers preserves all legal JSON escapes and
    // avoids paying for a second Storykeeper call merely to fix serialization.
    const repaired = source.replace(/\\(?!["\\/bfnrtu])/g, "");
    try {
      return JSON.parse(repaired) as Record<string, unknown>;
    } catch {
      try {
        return JSON.parse(jsonrepair(repaired)) as Record<string, unknown>;
      } catch {
        throw originalError;
      }
    }
  }
}

async function writeContextCard(
  paths: ReturnType<FileStoryWorkspace["paths"]>,
  card: { slug: string; triggers: string[]; body: string },
) {
  const content = [
    "---",
    `name: ${card.slug}`,
    "target: foreground",
    `triggers: [${card.triggers.map((trigger) => JSON.stringify(trigger)).join(", ")}]`,
    "max_chars: 4000",
    "---",
    "",
    card.body,
    "",
  ].join("\n");
  await writeAtomic(path.join(paths.contextCardsDir, card.slug, "CARD.md"), content);
}

type ContextCardRegistryEntry = {
  slug: string;
  title: string;
  triggers: string[];
  curated: boolean;
};

async function readContextCardRegistry(
  paths: ReturnType<FileStoryWorkspace["paths"]>,
): Promise<ContextCardRegistryEntry[]> {
  const curatedManifest = await readText(paths.cardsManifest, "");
  const curated = new Set(
    [...curatedManifest.matchAll(/context-cards\/([^/\s]+)\/CARD\.md/g)].map((match) => match[1]),
  );
  const directories = await readdir(paths.contextCardsDir, { withFileTypes: true }).catch(() => []);
  const entries: ContextCardRegistryEntry[] = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const content = await readText(path.join(paths.contextCardsDir, directory.name, "CARD.md"), "");
    const title = content.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim() || "";
    const triggerLine = content.match(/^triggers:\s*\[(.*)\]\s*$/m)?.[1] || "";
    const triggers = [...triggerLine.matchAll(/"([^"]+)"/g)]
      .map((match) => match[1].trim())
      .filter(Boolean);
    entries.push({
      slug: directory.name,
      title,
      triggers,
      curated: curated.has(directory.name),
    });
  }
  return entries.sort((a, b) => {
    if (a.curated !== b.curated) return a.curated ? -1 : 1;
    return a.slug.localeCompare(b.slug);
  });
}

function renderContextCardRegistry(entries: ContextCardRegistryEntry[]) {
  return entries.length
    ? entries.map((entry) => [
        `- slug: ${entry.slug}`,
        `  title: ${entry.title || "(untitled)"}`,
        `  triggers: ${entry.triggers.join(" | ")}`,
      ].join("\n")).join("\n")
    : "(none)";
}

function resolveContextCardIdentities(
  cards: Array<{
    slug: string;
    triggers: string[];
    body: string;
    curate?: boolean;
  }>,
  registry: ContextCardRegistryEntry[],
) {
  const resolved = new Map<string, {
    slug: string;
    triggers: string[];
    body: string;
    curate?: boolean;
  }>();
  const liveRegistry = [...registry];
  for (const card of cards) {
    const incomingTitle = card.body.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim() || "";
    const titleKey = normalizeCardIdentity(incomingTitle);
    const triggerKeys = new Set(card.triggers.map(normalizeCardIdentity).filter(Boolean));
    const candidate = liveRegistry.find((entry) => {
      if (titleKey && normalizeCardIdentity(entry.title) === titleKey) return true;
      const existingTriggers = entry.triggers.map(normalizeCardIdentity).filter(Boolean);
      const overlap = existingTriggers.filter((trigger) => triggerKeys.has(trigger)).length;
      return overlap >= 2 || (overlap === 1 && existingTriggers.length === 1 && triggerKeys.size === 1);
    });
    const slug = candidate?.slug || card.slug;
    const triggers = [...new Set([...(candidate?.triggers || []), ...card.triggers])].slice(0, 16);
    resolved.set(slug, { ...card, slug, triggers });
    if (!candidate) {
      liveRegistry.push({
        slug,
        title: incomingTitle,
        triggers,
        curated: card.curate === true,
      });
    }
  }
  return [...resolved.values()];
}

function normalizeCardIdentity(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function quarantineUnsupportedClaims<T extends {
  sections: Record<string, string>;
  storyMemory: string;
  contextCards: Array<{ body: string }>;
  qualityNotes: string;
}>(patch: T, warnings: RuntimeWarning[]): T {
  const claims = unsupportedClaimsFromWarnings(warnings);
  if (!claims.length) return patch;
  const sanitize = (value: string) => removeUnsupportedObjectiveClaims(value, claims);
  return {
    ...patch,
    sections: Object.fromEntries(
      Object.entries(patch.sections).map(([name, content]) => [name, sanitize(content)]),
    ),
    storyMemory: sanitize(patch.storyMemory),
    contextCards: patch.contextCards.map((card) => ({ ...card, body: sanitize(card.body) })),
    qualityNotes: [
      patch.qualityNotes,
      `Shadow quarantine kept ${claims.length} unsupported durable claim(s) out of objective workset state.`,
    ].filter(Boolean).join("\n"),
  };
}

function storykeeperMaxAttempts() {
  const configured = Number(process.env.OPENOVEL_STORYKEEPER_MAX_ATTEMPTS || 2);
  return Number.isFinite(configured) ? Math.max(1, Math.min(3, Math.trunc(configured))) : 2;
}

function storykeeperCompactFirst() {
  return !/^(?:0|false|no)$/i.test(String(process.env.OPENOVEL_STORYKEEPER_COMPACT_FIRST || "true").trim());
}

async function curateContextCards(
  paths: ReturnType<FileStoryWorkspace["paths"]>,
  slugs: string[],
) {
  const current = (await readText(paths.cardsManifest, "")).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const merged = new Set(current);
  for (const slug of slugs) merged.add(`@include story/context-cards/${slug}/CARD.md`);
  await writeAtomic(paths.cardsManifest, `${[...merged].join("\n")}\n`);
}
