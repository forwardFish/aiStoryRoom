import test from "node:test";
import assert from "node:assert/strict";
import { PressureWorkerRuntimeServiceV1 } from "./service";
import type {
  PressureWorkerClockPortV1,
  PressureWorkerLanePortV1,
  PressureWorkerSchedulerPortV1,
  PressureWorkerStepResultV1,
  PressureWorkerTimerHandleV1,
} from "./ports";

test("onModuleInit schedules one short poll and unrefs timer", async () => {
  const scheduler = new FakeScheduler();
  const service = new PressureWorkerRuntimeServiceV1(
    {
      clock: new FixedClock(),
      scheduler,
      progress: new ScriptedLane([{ kind: "IDLE" }]),
    },
    { pollMs: 250, perLaneLimit: 2 },
  );

  await service.onModuleInit();

  assert.equal(scheduler.scheduled.length, 1);
  assert.equal(scheduler.scheduled[0]!.delayMs, 250);
  assert.equal(scheduler.scheduled[0]!.unrefCount, 1);
});

test("single instance is not reentrant while a tick is active", async () => {
  const scheduler = new FakeScheduler();
  const gate = new GateLane();
  const service = new PressureWorkerRuntimeServiceV1(
    {
      clock: new FixedClock(),
      scheduler,
      progress: gate,
    },
    { autoStart: false, pollMs: 250, perLaneLimit: 1 },
  );

  const first = service.tickOnce();
  const second = service.tickOnce();
  gate.release({ kind: "IDLE" });
  const [a, b] = await Promise.all([first, second]);

  assert.equal(gate.calls, 1);
  assert.deepEqual(a, b);
});

test("decision runs before progress, narrative, and aEmotion", async () => {
  const order: string[] = [];
  const service = new PressureWorkerRuntimeServiceV1(
    {
      clock: new FixedClock(),
      scheduler: new FakeScheduler(),
      decision: new NamedLane("decision", order),
      progress: new NamedLane("progress", order),
      narrative: new NamedLane("narrative", order),
      aEmotion: new NamedLane("aEmotion", order),
    },
    { autoStart: false, perLaneLimit: 1 },
  );

  await service.tickOnce();

  assert.deepEqual(order, ["decision", "progress", "narrative", "aEmotion"]);
});

test("lane failures are isolated and later lanes still run", async () => {
  const order: string[] = [];
  const service = new PressureWorkerRuntimeServiceV1(
    {
      clock: new FixedClock(),
      scheduler: new FakeScheduler(),
      decision: new NamedLane("decision", order),
      progress: new ThrowingLane("PROGRESS_FAIL", order, "progress"),
      narrative: new NamedLane("narrative", order),
      aEmotion: new NamedLane("aEmotion", order),
    },
    { autoStart: false, perLaneLimit: 1 },
  );

  const report = await service.tickOnce();
  const health = service.health();

  assert.deepEqual(order, ["decision", "progress", "narrative", "aEmotion"]);
  assert.equal(report.lanes[1]!.state, "FAILED");
  assert.equal(report.lanes[1]!.errorCode, "PROGRESS_FAIL");
  assert.equal(report.lanes[2]!.state, "IDLE");
  assert.equal(health.lanes.progress.failures, 1);
  assert.equal(health.lanes.narrative.runs, 1);
});

test("stop cancels timer and does not interrupt in-flight tick", async () => {
  const scheduler = new FakeScheduler();
  const gate = new GateLane();
  const service = new PressureWorkerRuntimeServiceV1(
    {
      clock: new FixedClock(),
      scheduler,
      progress: gate,
    },
    { autoStart: false, pollMs: 250, perLaneLimit: 1 },
  );

  await service.start();
  const tick = service.tickOnce();
  const stop = service.stop();
  assert.equal(scheduler.scheduled[0]!.cancelCount, 1);
  gate.release({ kind: "IDLE" });
  await Promise.all([tick, stop]);

  const health = service.health();
  assert.equal(health.running, false);
  assert.equal(health.lanes.progress.state, "STOPPED");
});

test("drain repeats until no lane reports LIMIT", async () => {
  const progress = new SequenceLane([
    { kind: "ACKNOWLEDGED" },
    { kind: "ACKNOWLEDGED" },
    { kind: "IDLE" },
  ]);
  const service = new PressureWorkerRuntimeServiceV1(
    {
      clock: new FixedClock(),
      scheduler: new FakeScheduler(),
      progress,
    },
    { autoStart: false, perLaneLimit: 1 },
  );

  const reports = await service.drain(5);

  assert.equal(reports.length, 3);
  assert.deepEqual(
    reports.map((item) => item.lanes[1]!.stoppedBecause),
    ["LIMIT", "LIMIT", "IDLE"],
  );
});

test("explicitly disabled lanes stay disabled and independent topology is surfaced", async () => {
  const service = new PressureWorkerRuntimeServiceV1(
    {
      clock: new FixedClock(),
      scheduler: new FakeScheduler(),
      progress: new NamedLane("progress", []),
    },
    {
      autoStart: false,
      topology: "independent",
      lanes: { decision: false, progress: true, narrative: false, aEmotion: false },
    },
  );

  const report = await service.tickOnce();
  const health = service.health();

  assert.equal(health.topology, "independent");
  assert.equal(report.lanes[0]!.state, "DISABLED");
  assert.equal(report.lanes[2]!.state, "DISABLED");
  assert.equal(report.lanes[3]!.state, "DISABLED");
});

class FixedClock implements PressureWorkerClockPortV1 {
  private value = Date.parse("2026-08-11T00:00:00.000Z");
  nowMs(): number {
    this.value += 1;
    return this.value;
  }
}

class FakeTimer implements PressureWorkerTimerHandleV1 {
  public cancelCount = 0;
  public unrefCount = 0;
  constructor(
    public readonly delayMs: number,
    public readonly callback: () => void,
  ) {}
  cancel(): void {
    this.cancelCount += 1;
  }
  unref(): void {
    this.unrefCount += 1;
  }
}

class FakeScheduler implements PressureWorkerSchedulerPortV1 {
  public readonly scheduled: FakeTimer[] = [];
  schedule(delayMs: number, callback: () => void): PressureWorkerTimerHandleV1 {
    const timer = new FakeTimer(delayMs, callback);
    this.scheduled.push(timer);
    return timer;
  }
}

class ScriptedLane implements PressureWorkerLanePortV1 {
  private index = 0;
  constructor(private readonly script: PressureWorkerStepResultV1[]) {}
  async tick(): Promise<PressureWorkerStepResultV1> {
    return this.script[Math.min(this.index++, this.script.length - 1)]!;
  }
}

class SequenceLane implements PressureWorkerLanePortV1 {
  constructor(private readonly script: PressureWorkerStepResultV1[]) {}
  async tick(): Promise<PressureWorkerStepResultV1> {
    return this.script.shift() ?? { kind: "IDLE" };
  }
}

class NamedLane implements PressureWorkerLanePortV1 {
  constructor(
    private readonly name: string,
    private readonly order: string[],
  ) {}
  async tick(): Promise<PressureWorkerStepResultV1> {
    this.order.push(this.name);
    return { kind: "IDLE" };
  }
}

class ThrowingLane implements PressureWorkerLanePortV1 {
  constructor(
    private readonly code: string,
    private readonly order: string[],
    private readonly name: string,
  ) {}
  async tick(): Promise<PressureWorkerStepResultV1> {
    this.order.push(this.name);
    throw Object.assign(new Error(this.code), { code: this.code });
  }
}

class GateLane implements PressureWorkerLanePortV1 {
  public calls = 0;
  private queued: PressureWorkerStepResultV1 | null = null;
  private pending: {
    resolve: (value: PressureWorkerStepResultV1) => void;
  } | null = null;

  async tick(): Promise<PressureWorkerStepResultV1> {
    this.calls += 1;
    if (this.queued) {
      const queued = this.queued;
      this.queued = null;
      return queued;
    }
    return await new Promise<PressureWorkerStepResultV1>((resolve) => {
      this.pending = { resolve };
    });
  }

  release(value: PressureWorkerStepResultV1): void {
    if (this.pending) {
      this.pending.resolve(value);
      this.pending = null;
      return;
    }
    this.queued = value;
  }
}
