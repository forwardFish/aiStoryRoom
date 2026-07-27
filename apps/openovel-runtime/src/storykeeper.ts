/*
 * This slow-loop organization is derived from Feed-Scription/openovel:
 * src/workflows/storykeeperContext.js, src/workflows/storykeeperWorkflow.js,
 * and src/runtime/sessionProcessor.js. Licensed under Apache-2.0.
 * Modified for Our Many Worlds on 2026-07-27.
 */
import path from "node:path";
import { appendText, compactText, readText, writeAtomic } from "./io.js";
import { composeForeground } from "./foreground.js";
import type { FileStoryWorkspace } from "./workspace.js";
import type { OpenNovelProvider, StorykeeperInboxItem } from "./types.js";

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
    while (true) {
      const { items, state } = await this.workspace.inbox(runId);
      const item = items.find((candidate) => !state.processed.includes(candidate.id));
      if (!item) {
        await this.workspace.writeJobState(runId, {
          storykeeper: { status: "IDLE", updatedAt: new Date().toISOString() },
        });
        return;
      }
      await this.workspace.writeJobState(runId, {
        storykeeper: {
          status: "RUNNING",
          itemId: item.id,
          turnId: item.turnId,
          updatedAt: new Date().toISOString(),
        },
      });
      try {
        await this.processItem(runId, item);
        await this.workspace.markInbox(runId, item.id, { processed: true });
      } catch (error) {
        const message = String((error as Error).message || error);
        await this.workspace.markInbox(runId, item.id, { processed: false, error: message });
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
  }

  private async processItem(runId: string, item: StorykeeperInboxItem) {
    const snapshot = await this.workspace.snapshot(runId);
    const messages = buildStorykeeperMessages(item, snapshot);
    const result = await this.provider.generate({
      profile: "storykeeper",
      messages,
      temperature: 0.35,
      maxTokens: 8_000,
      json: true,
      stream: false,
    });
    await this.workspace.recordModelCall(
      runId,
      item.turnId,
      "storykeeper",
      {
        profile: "storykeeper",
        messages,
        temperature: 0.35,
        maxTokens: 8_000,
        json: true,
        stream: false,
      },
      result,
    );
    const patch = parseStorykeeperPatch(result.text);
    const paths = this.workspace.paths(runId);
    for (const card of patch.contextCards) {
      await writeContextCard(paths, card);
    }
    if (patch.contextCards.some((card) => card.curate)) {
      await curateContextCards(paths, patch.contextCards.filter((card) => card.curate).map((card) => card.slug));
    }
    for (const [name, content] of Object.entries(patch.sections)) {
      if (!SECTION_FILES.has(name)) continue;
      await writeAtomic(path.join(paths.frontendDir, name), `${String(content || "").trim()}\n`);
    }
    if (patch.optionsGuidance?.trim()) {
      await writeAtomic(paths.optionsGuidance, `${patch.optionsGuidance.trim()}\n`);
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
        ...Object.keys(patch.sections),
        ...patch.contextCards.map((card) => `context-cards/${card.slug}/CARD.md`),
      ],
      summary: patch.summary,
    });
  }
}

function buildStorykeeperMessages(item: StorykeeperInboxItem, snapshot: Awaited<ReturnType<FileStoryWorkspace["snapshot"]>>) {
  return [
    {
      role: "system" as const,
      content: [
        "你是互动小说的后台 Storykeeper。前景正文已经发布，绝不能修改、否定或重写 Canon。",
        "你的任务是读取玩家行动、真实正文、Recent Canon、BRIEF 和当前 Foreground Guidance，维护下一轮的小型工作集。",
        "更新 Scene、Active Characters、Relationships、Constants、Open Threads、Active Pressures、Pending Consequence、Forbidden；只写跨回合仍有用的结论，不写逐句摘要和内部分析。",
        "Recent Canon 决定当前镜头。Guidance 若与最新正文的站位、时间或刚发生的事冲突，以 Canon 为准。",
        "recent_canon_before 是本轮正文提交前的 Canon；recent_canon 已包含 published_narration。published_narration 出现在 recent_canon 里是正常提交结果，绝不能据此判定复写。判断本轮是否重演旧场景，只比较 recent_canon_before 与 published_narration。",
        "Constants 只放持久事实。普通纸张、目光、衣袖、灯火和临时站位不升级为状态实体。",
        "Context Card 只用于会在后续继续被准确引用、其身份或状态会改变行为的持续实体。匿名差役、一次性路人和普通叙事物件不要建卡；如果正文误给匿名职役临时起名，不要用建卡固化错误，而要在下一轮 Guidance 恢复其匿名职役称呼。",
        "更新已有实体时必须复用既有 slug；只有 Canon 首次建立了真正持续的新实体时，才在 contextCards 返回新卡。curate=true 仅用于接下来数轮都必须在前景中的卡。",
        "玩家选择的隐藏 consequence 只作为未来影响线索，不能把尚未发生的结果写成既成事实。",
        "逐字比较 reader_action 与 published_narration：如果正文替玩家多签、下令、承诺或反做了玩家明确暂缓的事，必须在 qualityNotes 标为玩家代理权错误，并在下一轮 Guidance 限制继续扩大；不得把它美化成“部分转化”。",
        "在 qualityNotes 记录重复、报告腔、角色被动或连续性问题，并通过下一轮 Guidance 修根因；不要修改已发布正文。",
        "只返回严格 JSON：{\"summary\":string,\"sections\":{\"scene.md\"?:string,\"tone.md\"?:string,\"active-characters.md\"?:string,\"relationships.md\"?:string,\"constants.md\"?:string,\"open-threads.md\"?:string,\"active-pressures.md\"?:string,\"directed-beat.md\"?:string,\"pending-consequence.md\"?:string,\"forbidden.md\"?:string},\"contextCards\"?:Array<{\"slug\":string,\"triggers\":string[],\"body\":string,\"curate\"?:boolean}>,\"optionsGuidance\"?:string,\"qualityNotes\"?:string}",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `<brief>\n${compactText(snapshot.brief, 6_000)}\n</brief>`,
        `<foreground_guidance>\n${compactText(snapshot.foregroundGuidance, 18_000)}\n</foreground_guidance>`,
        `<recent_canon_before>\n${compactText(item.recentCanonBefore || "", 12_000)}\n</recent_canon_before>`,
        `<recent_canon>\n${compactText(snapshot.recentCanon, 12_000)}\n</recent_canon>`,
        `<reader_action>\n${item.action}\n</reader_action>`,
        `<published_narration>\n${item.narration}\n</published_narration>`,
        item.selectedEffect
          ? `<selected_effect>\n${JSON.stringify(item.selectedEffect)}\n</selected_effect>`
          : "",
      ].filter(Boolean).join("\n\n"),
    },
  ];
}

function parseStorykeeperPatch(raw: string) {
  const text = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Storykeeper did not return a JSON object");
  const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const rawSections = parsed.sections && typeof parsed.sections === "object"
    ? parsed.sections as Record<string, unknown>
    : {};
  const sections: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawSections)) {
    if (SECTION_FILES.has(name) && typeof value === "string") sections[name] = value;
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
    contextCards,
    optionsGuidance: typeof parsed.optionsGuidance === "string" ? parsed.optionsGuidance : "",
    qualityNotes: typeof parsed.qualityNotes === "string" ? parsed.qualityNotes : "",
  };
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

async function curateContextCards(
  paths: ReturnType<FileStoryWorkspace["paths"]>,
  slugs: string[],
) {
  const current = (await readText(paths.cardsManifest, "")).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const merged = new Set(current);
  for (const slug of slugs) merged.add(`@include story/context-cards/${slug}/CARD.md`);
  await writeAtomic(paths.cardsManifest, `${[...merged].join("\n")}\n`);
}
