import type {
  PressureProductionPlayerRow,
  PressureProductionPrismaClient,
  PressureProductionRoleRow,
  PressureProductionStoryRunRow,
  PressureRunLifecycleRow,
} from "./prisma-ports";

type DbState = {
  runs: Map<string, PressureProductionStoryRunRow>;
  roles: Map<string, PressureProductionRoleRow>;
  players: Map<string, PressureProductionPlayerRow>;
  lifecycles: Map<string, PressureRunLifecycleRow>;
};

export class PressureProductionPrismaFake {
  private state: DbState = emptyState();
  private tail: Promise<void> = Promise.resolve();

  get runs() { return [...this.state.runs.values()].map(clone); }
  get roles() { return [...this.state.roles.values()].map(clone); }
  get players() { return [...this.state.players.values()].map(clone); }
  get lifecycles() { return [...this.state.lifecycles.values()].map(clone); }
  get lobbyReceipts() {
    return this.lifecycles.flatMap((row) =>
      Object.values((row.lobbyJson as {
        commandReceipts?: Record<string, {
          idempotencyKey: string;
          operation: string;
          resultStateHash: string;
          responseJson: unknown;
        }>;
      }).commandReceipts ?? {}),
    );
  }

  readonly client: PressureProductionPrismaClient = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>): Promise<T> => {
      let release!: () => void;
      const previous = this.tail;
      this.tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const before = cloneState(this.state);
      try {
        return await operation(this.tx);
      } catch (error) {
        this.state = before;
        throw error;
      } finally {
        release();
      }
    },
  };

  private readonly tx = {
    storyRun: {
      findUnique: async ({ where }: any) => cloneOrNull(findOne(this.state.runs, where)),
      findFirst: async ({ where }: any) => cloneOrNull(findFirst(this.state.runs, where)),
      create: async ({ data }: any) => {
        if (this.state.runs.has(data.id) || [...this.state.runs.values()].some((row) => row.inviteCode === data.inviteCode)) {
          throw uniqueError();
        }
        const row = {
          currentDay: 1,
          version: 1,
          ...clone(data),
        } as PressureProductionStoryRunRow;
        this.state.runs.set(row.id, row);
        return clone(row);
      },
      updateMany: async ({ where, data }: any) => updateMany(this.state.runs, where, data),
    },
    storyRole: {
      findMany: async ({ where }: any) => findAll(this.state.roles, where).map(clone),
      createMany: async ({ data }: any) => {
        for (const raw of data) {
          if (
            this.state.roles.has(raw.id) ||
            [...this.state.roles.values()].some(
              (row) => row.runId === raw.runId && row.roleKey === raw.roleKey,
            )
          ) throw uniqueError();
        }
        for (const raw of data) this.state.roles.set(raw.id, clone(raw));
        return { count: data.length };
      },
      updateMany: async ({ where, data }: any) => updateMany(this.state.roles, where, data),
    },
    storyPlayer: {
      findMany: async ({ where }: any) => findAll(this.state.players, where).map(clone),
      createMany: async ({ data }: any) => {
        for (const raw of data) {
          if (
            this.state.players.has(raw.id) ||
            [...this.state.players.values()].some(
              (row) => row.runId === raw.runId && row.roleId === raw.roleId,
            )
          ) throw uniqueError();
        }
        for (const raw of data) this.state.players.set(raw.id, clone(raw));
        assertPlayerUniques(this.state.players);
        return { count: data.length };
      },
      updateMany: async ({ where, data }: any) => {
        const before = cloneMap(this.state.players);
        const result = updateMany(this.state.players, where, data);
        try {
          assertPlayerUniques(this.state.players);
        } catch (error) {
          this.state.players = before;
          throw error;
        }
        return result;
      },
    },
    pressureRunLifecycle: {
      findUnique: async ({ where }: any) => cloneOrNull(findOne(this.state.lifecycles, where)),
      create: async ({ data }: any) => {
        if (this.state.lifecycles.has(data.runId)) throw uniqueError();
        const row = clone(data) as PressureRunLifecycleRow;
        this.state.lifecycles.set(row.runId, row);
        return clone(row);
      },
      updateMany: async ({ where, data }: any) => updateMany(this.state.lifecycles, where, data),
    },
  };
}

function emptyState(): DbState {
  return {
    runs: new Map(),
    roles: new Map(),
    players: new Map(),
    lifecycles: new Map(),
  };
}

function cloneState(state: DbState): DbState {
  return {
    runs: cloneMap(state.runs),
    roles: cloneMap(state.roles),
    players: cloneMap(state.players),
    lifecycles: cloneMap(state.lifecycles),
  };
}

function cloneMap<T>(map: Map<string, T>): Map<string, T> {
  return new Map([...map.entries()].map(([key, value]) => [key, clone(value)]));
}

function findOne<T>(map: Map<string, T>, where: Record<string, unknown>): T | null {
  if ("id" in where && typeof where.id === "string") {
    const value = map.get(where.id);
    return value && matches(value, where) ? value : null;
  }
  if ("runId" in where && typeof where.runId === "string") {
    const direct = map.get(where.runId);
    if (direct && matches(direct, where)) return direct;
  }
  return findFirst(map, where);
}

function findFirst<T>(map: Map<string, T>, where: Record<string, unknown>): T | null {
  return [...map.values()].find((value) => matches(value, where)) ?? null;
}

function findAll<T>(map: Map<string, T>, where: Record<string, unknown>): T[] {
  return [...map.values()].filter((value) => matches(value, where));
}

function updateMany<T extends object>(
  map: Map<string, T>,
  where: Record<string, unknown>,
  data: Record<string, unknown>,
): { count: number } {
  let count = 0;
  for (const [key, value] of map) {
    if (!matches(value, where)) continue;
    const next = clone(value) as Record<string, unknown>;
    for (const [field, update] of Object.entries(data)) {
      if (isRecord(update) && typeof update.increment === "number") {
        next[field] = Number(next[field] ?? 0) + update.increment;
      } else {
        next[field] = clone(update);
      }
    }
    map.set(key, next as T);
    count += 1;
  }
  return { count };
}

function matches(value: unknown, where: Record<string, unknown>): boolean {
  const record = value as Record<string, unknown>;
  for (const [field, expected] of Object.entries(where)) {
    if (field === "OR" && Array.isArray(expected)) {
      if (!expected.some((branch) => matches(record, branch as Record<string, unknown>))) return false;
      continue;
    }
    const actual = record[field];
    if (isRecord(expected)) {
      if ("in" in expected && Array.isArray(expected.in) && !expected.in.includes(actual)) return false;
      if ("lte" in expected && compare(actual, expected.lte) > 0) return false;
      if ("gt" in expected && compare(actual, expected.gt) <= 0) return false;
      if (!("in" in expected) && !("lte" in expected) && !("gt" in expected)) {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) return false;
      }
    } else if (actual !== expected) return false;
  }
  return true;
}

function compare(left: unknown, right: unknown): number {
  const leftValue = left instanceof Date ? left.getTime() : Number(left);
  const rightValue = right instanceof Date ? right.getTime() : Number(right);
  return leftValue - rightValue;
}

function assertPlayerUniques(players: Map<string, PressureProductionPlayerRow>): void {
  const users = new Set<string>();
  const roles = new Set<string>();
  for (const player of players.values()) {
    const roleKey = `${player.runId}:${player.roleId}`;
    if (roles.has(roleKey)) throw uniqueError();
    roles.add(roleKey);
    if (player.userId !== null) {
      const userKey = `${player.runId}:${player.userId}`;
      if (users.has(userKey)) throw uniqueError();
      users.add(userKey);
    }
  }
}

function uniqueError(): Error & { code: string } {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cloneOrNull<T>(value: T | null): T | null {
  return value === null ? null : clone(value);
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
