import assert from "node:assert/strict";
import test from "node:test";
import { getGameDefinition } from "@ai-story/templates";
import { PrismaService } from "../prisma.service";
import {
  applyOpenNovelManeuverPlan,
  compileOpenNovelManeuverPlan,
  projectOpenNovelManeuvers,
  type OpenNovelManeuverPlan,
} from "./openovel-maneuver";
import { sangtianOpenNovelManeuverPackage } from "./sangtian-openovel-maneuver.package";
import { recoverOpenNovelManeuverRun } from "./openovel-maneuver-state-recovery";

const maneuverPackage = sangtianOpenNovelManeuverPackage;
const game = getGameDefinition("sangtian");

function requirePlan(
  value: ReturnType<typeof compileOpenNovelManeuverPlan>,
): OpenNovelManeuverPlan {
  if ("accepted" in value) throw new Error(`expected plan: ${value.reason}`);
  return value;
}

function createPrismaDouble(events: Array<{ type: string; payloadJson: unknown }>) {
  let updateCalls = 0;
  const prisma = Object.defineProperties(Object.create(PrismaService.prototype), {
    storyEvent: {
      value: {
        findMany: async () => events,
      },
    },
    storyRun: {
      value: {
        updateMany: async () => {
          updateCalls += 1;
          return { count: 1 };
        },
      },
    },
  }) as PrismaService;
  return {
    prisma,
    get updateCalls() { return updateCalls; },
  };
}

function authoritativeEvent() {
  const projection = projectOpenNovelManeuvers({
    stateJson: {},
    turnNumber: 0,
    runtimeStatus: "READY",
    mainDecisionOpen: true,
    canHumanAct: true,
    maneuverPackage,
  });
  const plan = requirePlan(compileOpenNovelManeuverPlan({
    command: {
      maneuverType: "investigate",
      intentKey: "inspect_first_register_timing",
    },
    projection,
    game,
    roleKey: "zhejiang_governor",
    turnNumber: 0,
    maneuverPackage,
  }));
  const applied = applyOpenNovelManeuverPlan({
    state: projection.state,
    plan,
    result: {
      id: "state-recovery-event",
      turnNumber: 0,
      title: plan.title,
      narrative: plan.fallbackNarrative,
      idempotencyKey: "state-recovery-idempotency",
      requestFingerprint: "state-recovery-fingerprint",
      createdAt: "2026-08-07T00:00:00.000Z",
    },
  });
  return {
    type: "openovel_maneuver_result",
    payloadJson: applied.result,
  };
}

const run = {
  id: "solo_ovl_state_recovery",
  templateKey: "sangtian",
  stateJson: {},
  version: 9,
};

test("in-memory recovery gives Preview an authoritative state without writing", async () => {
  const double = createPrismaDouble([authoritativeEvent()]);
  const recovered = await recoverOpenNovelManeuverRun({
    prisma: double.prisma,
    run,
    turnNumber: 0,
    maneuverPackage,
    persist: false,
  });

  assert.equal(double.updateCalls, 0);
  assert.equal(recovered.needsPersistence, true);
  assert.deepEqual(recovered.state.usedTypesToday, ["investigate"]);
  assert.equal(recovered.state.maneuverOpportunitiesRemaining, 1);
  assert.ok(recovered.state.discoveredFactKeys.includes("first_registers_prepared_early"));
});

test("projection recovery may repair the stateJson mirror without bumping the action version", async () => {
  const double = createPrismaDouble([authoritativeEvent()]);
  const recovered = await recoverOpenNovelManeuverRun({
    prisma: double.prisma,
    run,
    turnNumber: 0,
    maneuverPackage,
  });

  assert.equal(double.updateCalls, 1);
  assert.equal(recovered.persisted, true);
  assert.equal(recovered.run.version, run.version);
  assert.equal(recovered.state.totalManeuversUsed, 1);
});
