import assert from "node:assert/strict";
import test from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { StoryController } from "./story.controller";

const REF = "abcdefghijklmnopqrst";

test("Pressure failed worker lane makes readiness fail and diagnostic exposes provider mode", async () => {
  const restore = installHealthEnvironment();
  try {
    const pressure = {
      readiness: () => ({
        ready: false,
        status: "not_ready",
        code: "PRESSURE_CONTENT_NOT_READY",
        workerOwnership: {
          schemaVersion: "pressure_chapter_worker_ownership_v1",
          processRole: "api",
          configuredOwner: "embedded_api",
          configuredOwnerExplicit: false,
          topology: "embedded",
          ownsWorkerLanes: true,
          ready: true,
        },
        narrative: {
          ready: true,
          mode: "DETERMINISTIC_FALLBACK_ONLY",
          externalProviderConfigured: false,
          degraded: true,
          provider: "deterministic-fallback",
          model: null,
        },
        workers: {
          enabled: true,
          topology: "embedded",
          running: true,
          stopping: false,
          lanes: {
            decision: { enabled: true, state: "IDLE" },
            progress: { enabled: true, state: "FAILED" },
            narrative: { enabled: true, state: "IDLE" },
            aEmotion: { enabled: true, state: "IDLE" },
          },
        },
        failedLanes: ["progress"],
        notReadyLanes: ["progress"],
        content: {
          ready: false,
          code: "PRESSURE_CONTENT_NOT_READY",
        },
        release: {
          ready: true,
        },
      }),
    };
    const controller = new StoryController(
      {} as never,
      { readiness: async () => ({ ready: true, database: "connected" }) } as never,
      { readiness: () => ({ ready: true, provider: "test" }) } as never,
      pressure as never,
    );
    await assert.rejects(
      controller.ready(),
      (error: unknown) => error instanceof ServiceUnavailableException
        && (error.getResponse() as {
          pressure?: { failedLanes?: string[]; code?: string; content?: { code?: string } };
        })
          .pressure?.failedLanes?.[0] === "progress",
    );
    const diagnostic = controller.diagnostic();
    assert.equal(diagnostic.pressureDatabase.ready, true);
    assert.equal((diagnostic.pressure as ReturnType<typeof pressure.readiness>).narrative.mode, "DETERMINISTIC_FALLBACK_ONLY");
    assert.equal((diagnostic.pressure as ReturnType<typeof pressure.readiness>).content.code, "PRESSURE_CONTENT_NOT_READY");
    assert.equal((diagnostic.pressure as ReturnType<typeof pressure.readiness>).workerOwnership.configuredOwner, "embedded_api");
    assert.doesNotMatch(JSON.stringify(diagnostic), new RegExp(REF));
  } finally {
    restore();
  }
});

test("content integrity failure returns 503 with a safe pressure code and no raw error detail", async () => {
  const restore = installHealthEnvironment();
  try {
    const controller = new StoryController(
      {} as never,
      { readiness: async () => ({ ready: true, database: "connected" }) } as never,
      { readiness: () => ({ ready: true, provider: "test" }) } as never,
      {
        readiness: () => ({
          ready: false,
          status: "not_ready",
          code: "PRESSURE_CONTENT_NOT_READY",
          workerOwnership: {
            schemaVersion: "pressure_chapter_worker_ownership_v1",
            processRole: "api",
            configuredOwner: "embedded_api",
            configuredOwnerExplicit: false,
            topology: "embedded",
            ownsWorkerLanes: true,
            ready: true,
          },
          narrative: {
            ready: true,
            mode: "DETERMINISTIC_FALLBACK_ONLY",
            externalProviderConfigured: false,
            degraded: true,
            provider: "deterministic-fallback",
            model: null,
          },
          workers: {
            enabled: true,
            topology: "embedded",
            running: true,
            stopping: false,
            lanes: {
              decision: { enabled: true, state: "IDLE" },
              progress: { enabled: true, state: "IDLE" },
              narrative: { enabled: true, state: "IDLE" },
              aEmotion: { enabled: true, state: "IDLE" },
            },
          },
          failedLanes: [],
          notReadyLanes: [],
          content: {
            ready: false,
            code: "PRESSURE_CONTENT_NOT_READY",
          },
          release: {
            ready: true,
          },
        }),
      } as never,
    );
    await assert.rejects(
      controller.ready(),
      (error: unknown) => {
        if (!(error instanceof ServiceUnavailableException)) return false;
        const response = error.getResponse() as {
          code?: string;
          pressure?: { code?: string; content?: { code?: string } };
        };
        assert.equal(response.code, "DEPENDENCY_NOT_READY");
        assert.equal(response.pressure?.code, "PRESSURE_CONTENT_NOT_READY");
        assert.equal(response.pressure?.content?.code, "PRESSURE_CONTENT_NOT_READY");
        assert.doesNotMatch(JSON.stringify(response), /hash|sha|path|ENOENT|Error:/i);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("release integrity failure returns 503 with a safe pressure code and no raw release detail", async () => {
  const restore = installHealthEnvironment();
  try {
    const controller = new StoryController(
      {} as never,
      { readiness: async () => ({ ready: true, database: "connected" }) } as never,
      { readiness: () => ({ ready: true, provider: "test" }) } as never,
      {
        readiness: () => ({
          ready: false,
          status: "not_ready",
          code: "PRESSURE_RELEASE_NOT_READY",
          workerOwnership: {
            schemaVersion: "pressure_chapter_worker_ownership_v1",
            processRole: "api",
            configuredOwner: "embedded_api",
            configuredOwnerExplicit: false,
            topology: "embedded",
            ownsWorkerLanes: true,
            ready: true,
          },
          narrative: {
            ready: true,
            mode: "DETERMINISTIC_FALLBACK_ONLY",
            externalProviderConfigured: false,
            degraded: true,
            provider: "deterministic-fallback",
            model: null,
          },
          workers: {
            enabled: true,
            topology: "embedded",
            running: true,
            stopping: false,
            lanes: {
              decision: { enabled: true, state: "IDLE" },
              progress: { enabled: true, state: "IDLE" },
              narrative: { enabled: true, state: "IDLE" },
              aEmotion: { enabled: true, state: "IDLE" },
            },
          },
          failedLanes: [],
          notReadyLanes: [],
          content: {
            ready: true,
          },
          release: {
            ready: false,
            code: "PRESSURE_RELEASE_NOT_READY",
          },
        }),
      } as never,
    );
    await assert.rejects(
      controller.ready(),
      (error: unknown) => {
        if (!(error instanceof ServiceUnavailableException)) return false;
        const response = error.getResponse() as {
          code?: string;
          pressure?: {
            code?: string;
            release?: { code?: string };
          };
        };
        assert.equal(response.code, "DEPENDENCY_NOT_READY");
        assert.equal(response.pressure?.code, "PRESSURE_RELEASE_NOT_READY");
        assert.equal(response.pressure?.release?.code, "PRESSURE_RELEASE_NOT_READY");
        assert.doesNotMatch(JSON.stringify(response), /hash|sha|path|ENOENT|Error:|routeRegistry/i);
        return true;
      },
    );
  } finally {
    restore();
  }
});

function installHealthEnvironment(): () => void {
  const values: Record<string, string> = {
    NODE_ENV: "development",
    DATABASE_URL: `postgresql://postgres.${REF}:secret@aws-0-ap-northeast-1.pooler.supabase.com/postgres`,
    SUPABASE_DATABASE_URL: `postgresql://postgres.${REF}:secret@aws-0-ap-northeast-1.pooler.supabase.com/postgres`,
    SUPABASE_URL: `https://${REF}.supabase.co`,
    SUPABASE_PROJECT_REF: REF,
    CREEM_MODE: "test",
    CREEM_MOCK_MODE: "true",
    CREEM_ALLOW_MOCK_CHECKOUT: "true",
  };
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
