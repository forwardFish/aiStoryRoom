import { ConflictException, NotFoundException } from "@nestjs/common";
import type { MvpStoryEvent, MvpView } from "./mvp-types";
import type { MvpStoryStorage } from "./mvp-storage";

type PrismaLike = {
  user: any;
  worldTemplate: any;
  storyRun: any;
  storyEvent: any;
  aiTask: any;
  $transaction<T>(callback: (tx: PrismaLike) => Promise<T>): Promise<T>;
};

type StoredState = Omit<MvpView, "events">;

/** Authoritative v4 persistence when DATABASE_URL is configured. */
export class PrismaMvpStoryStorage implements MvpStoryStorage {
  constructor(private readonly prisma: PrismaLike) {}

  async create(view: MvpView) {
    await this.prisma.$transaction(async (tx) => {
      const owner = await tx.user.upsert({
        where: { openid: "mvp-system-owner" },
        update: {},
        create: { openid: "mvp-system-owner", nickname: "AI Story Room" }
      });
      await tx.worldTemplate.upsert({
        where: { id: "sangtian" },
        update: { status: "published" },
        create: {
          id: "sangtian",
          name: "桑田诏",
          genre: "historical",
          hook: view.run.title,
          worldBase: view.run.location,
          status: "published",
          configJson: { templateKey: "sangtian", schemaVersion: "1.1" }
        }
      });
      await tx.storyRun.create({
        data: {
          id: view.run.id,
          templateId: "sangtian",
          ownerUserId: owner.id,
          userId: owner.id,
          templateKey: "sangtian",
          selectedRoleKey: "zhejiang_governor",
          title: view.run.title,
          hook: view.run.location,
          mode: "solo",
          status: view.run.status,
          currentDay: view.run.currentDay,
          totalDays: view.run.totalDays,
          version: view.run.version,
          currentChapter: 1,
          maxPlayers: 1,
          activeHumanCount: 1,
          aiPlayerCount: 0,
          dangerLevel: 1,
          maxDangerLevel: 5,
          chapterCount: 0,
          completedNodeCount: 0,
          stateJson: packState(view),
          visibility: "private",
          inviteCode: `mvp-${view.run.id}`
        }
      });
      await appendEvents(tx, view.run.id, view.events);
    });
  }

  async load(runId: string) {
    const row = await this.prisma.storyRun.findUnique({
      where: { id: runId },
      include: { storyEvents: { orderBy: { createdAt: "asc" } } }
    });
    if (!row) throw new NotFoundException("mvp story run not found");
    const state = structuredClone(row.stateJson as StoredState) as MvpView;
    state.run.version = row.version;
    state.run.currentDay = row.currentDay;
    state.run.totalDays = row.totalDays;
    state.run.status = row.status;
    state.events = row.storyEvents.map((event: any) => ({
      id: event.id,
      type: event.type,
      payload: event.payloadJson,
      createdAt: event.createdAt.toISOString()
    }));
    return state;
  }

  async save(view: MvpView, expectedVersion: number) {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.storyRun.updateMany({
        where: { id: view.run.id, version: expectedVersion },
        data: {
          stateJson: packState(view),
          version: view.run.version,
          currentDay: view.run.currentDay,
          totalDays: view.run.totalDays,
          status: view.run.status
        }
      });
      if (updated.count !== 1) {
        throw new ConflictException({ code: "VERSION_CONFLICT", message: "story run version conflict", expectedVersion });
      }
      const existing = await tx.storyEvent.findMany({ where: { runId: view.run.id }, select: { id: true } });
      const existingIds = new Set(existing.map((item: { id: string }) => item.id));
      await appendEvents(tx, view.run.id, view.events.filter((event) => !existingIds.has(event.id)));
    });
  }

  async recordAiTask(task: {
    runId: string;
    eventId: string;
    taskType: string;
    status: string;
    provider: string;
    inputJson: Record<string, unknown>;
    resultJson: Record<string, unknown>;
    errorMessage?: string;
  }) {
    await this.prisma.aiTask.create({
      data: {
        runId: task.runId,
        eventId: task.eventId,
        taskType: task.taskType,
        modelType: task.provider,
        provider: task.provider,
        modelName: task.provider,
        status: task.status,
        inputJson: task.inputJson,
        resultJson: task.resultJson,
        outputJson: task.resultJson,
        normalizedJson: task.resultJson,
        tokenUsageJson: (task.resultJson as any).tokenUsage || {},
        inputTokens: Number((task.resultJson as any).tokenUsage?.inputTokens || 0) || null,
        outputTokens: Number((task.resultJson as any).tokenUsage?.outputTokens || 0) || null,
        cost: Number((task.resultJson as any).tokenUsage?.costMinor || 0) || null,
        startedAt: new Date(),
        completedAt: new Date(),
        errorMessage: task.errorMessage
      }
    });
  }
}

function packState(view: MvpView): StoredState {
  const { events: _events, ...state } = structuredClone(view);
  return state;
}

async function appendEvents(tx: PrismaLike, runId: string, events: MvpStoryEvent[]) {
  if (!events.length) return;
  await tx.storyEvent.createMany({
    data: events.map((event) => ({
      id: event.id,
      runId,
      day: Number(event.payload.day || 1),
      type: event.type,
      messageType: typeof event.payload.messageType === "string" ? event.payload.messageType : event.type,
      roleKey: typeof event.payload.roleKey === "string" ? event.payload.roleKey : null,
      visibility: typeof event.payload.visibility === "string" ? event.payload.visibility : "player_visible",
      payloadJson: event.payload,
      createdAt: new Date(event.createdAt)
    })),
    skipDuplicates: true
  });
}
