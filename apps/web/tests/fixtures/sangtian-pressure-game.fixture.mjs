import assert from "node:assert/strict";

const seats = [
  ["seat.zhejiang_governor", "浙江总督", "HUMAN_ACTIVE"],
  ["seat.zhejiang_province", "浙江省府", "AI_ACTIVE"],
  ["seat.qingliu_law", "清流法度", "AI_ACTIVE"],
  ["seat.jiangnan_merchants", "江南商会", "AI_ACTIVE"],
  ["seat.palace_weaving", "司礼监织造", "AI_ACTIVE"],
  ["seat.cabinet_finance", "内阁财政", "AI_ACTIVE"]
];

export function createSleepPressureProjectionFixture({ settled = false, phase } = {}) {
  const runPhase = phase || (settled ? "COMMIT_OPEN" : "PREPARE_OPEN");
  const actionable = ["PREPARE_OPEN", "COMMIT_OPEN", "REACTION_OPEN"].includes(runPhase);
  const actionPhase = runPhase === "COMMIT_OPEN" ? "COMMIT" : runPhase === "REACTION_OPEN" ? "REACTION" : "PREPARE";
  return {
    schemaVersion: "pressure_game_projection_v1",
    projectionRevision: settled ? 12 : 11,
    runtimeProfile: "SANGTIAN_PRESSURE_SPINE_V1",
    run: {
      runId: "run-sleep-fixture",
      packageVersion: "sangtian_pressure_v1_0",
      nodeId: "N1",
      phase: runPhase,
      version: settled ? 4 : 3
    },
    serverNow: settled ? "1566-05-12T12:00:00.000Z" : "1566-05-12T06:00:00.000Z",
    worldClock: settled
      ? { label: "当日午后 · 半日已过", ticksUsed: 1, ticksRemaining: 1 }
      : { label: "当日清晨", ticksUsed: 0, ticksRemaining: 2 },
    pressure: settled
      ? { level: 2, triggerLabel: "九堰险情已经越过等待线", forcedSettlementAt: null }
      : { level: 1, triggerLabel: "九堰水位继续上涨", forcedSettlementAt: "1566-05-12T12:00:00.000Z" },
    player: {
      seatId: "seat.zhejiang_governor",
      roleKey: "zhejiang_governor",
      displayName: "浙江总督",
      currentActorId: "actor.hu-zongxian",
      mission: "同时守住东南军务和浙江基本秩序。"
    },
    publicScene: settled
      ? {
          sceneId: "N1.scene.emergency-wakeup",
          text: "半日后，房门被急促拍响。幕僚带着九堰险情急报闯入：堰口守军已经被其他五席的先手行动牵动，你必须立即决定兵力和命令留下什么痕迹。",
          factIds: ["fact.n1.water-rise", "fact.n1.five-seat-initiative"],
          objectVersionIds: ["object.n1.breach-order.v2"]
        }
      : {
          sceneId: "N1.scene.governor-council",
          text: "浙江总督与幕僚正在商议九堰水势。兵力、疏散和命令记录都在等你处理，但汛情不会等待讨论结束。",
          factIds: ["fact.n1.water-rise"],
          objectVersionIds: ["object.n1.breach-order.v1"]
        },
    privateScene: settled
      ? {
          sceneId: "N1.private.lost-initiative",
          text: "你确实休息了半日；这段空白已经让其他五席与现场 NPC 抢到先手。",
          knownFactIds: ["fact.n1.five-seat-initiative"],
          heldObjectVersionIds: []
        }
      : {
          sceneId: "N1.private.governor-opening",
          text: "你的幕僚判断，若上午没有正式命令，省府和织造局会各自先动。",
          knownFactIds: ["fact.n1.water-rise"],
          heldObjectVersionIds: []
        },
    slot: {
      prepare: settled ? "RESOLVED" : "OPEN",
      commit: settled ? "OPEN" : "UNAVAILABLE",
      reaction: "UNAVAILABLE"
    },
    actionSurface: {
      phase: actionPhase,
      legalActionTypes: actionable ? ["REST", "DELAY", "ALLOCATE", "DISPATCH"] : [],
      legalTargets: actionable ? [{ id: "target.n1.governor-office", displayName: "总督府内厅" }] : [],
      fourButtons: [],
      suggestedInputs: actionable ? (settled
        ? [
            suggestion("N1.commit.allocate", "调兵守住九堰，同时留下经手记录", "DEFAULT_COMMIT"),
            suggestion("N1.commit.dispatch", "派人先疏散堰下百姓", "KEY_LEVERAGE"),
            suggestion("N1.commit.sign", "要求省府在正式命令上共同具名", "DETERMINISTIC_DERIVATION")
          ]
        : [
            suggestion("N1.prepare.rest", "我先睡一下", "DIALOGUE_SEED"),
            suggestion("N1.prepare.inspect", "先派幕僚核验九堰水位和守军", "DEFAULT_PREPARE"),
            suggestion("N1.prepare.evacuate", "先通知堰下村落开始疏散", "KEY_LEVERAGE")
          ]) : []
    },
    seats: seats.map(([seatId, displayName, controller], index) => ({
      seatId,
      displayName,
      controller,
      publicStatus: settled ? "RESOLVED" : index === 0 ? "THINKING" : "THINKING"
    })),
    objects: [{ objectId: "object.n1.breach-order", displayName: settled ? "毁堤命令 · v2" : "毁堤命令 · v1" }],
    evidenceChain: [{ evidenceId: "evidence.n1.duty-record", displayName: settled ? "半日空档与五席先手记录" : "九堰值守记录" }],
    latestActionFeedback: settled ? {
      actionEcho: "你暂缓处理公务，回房休息了半日。",
      visibleReactions: [
        "浙江省府先行调动了地方差役。",
        "清流法度开始保全经手记录。",
        "江南商会改派粮船和脚夫。",
        "司礼监织造催促执行改桑命令。",
        "内阁财政要求尽快给出不影响军饷的方案。"
      ],
      changes: {
        consequence: ["准备机会已经消耗", "lost_initiative：你失去了本轮先手"],
        resource: [],
        time: ["时间推进半日"],
        pressure: ["节点压力 +1"],
        object: ["毁堤命令由 v1 推进到 v2，经手痕迹已经增加"]
      },
      nextPressure: "幕僚携九堰险情急报将你唤醒；现在必须决定兵力、疏散和命令记录。",
      sourceActionIds: ["action.n1.governor.rest.1"],
      settledEventIds: ["event.n1.time-advanced.1", "event.n1.prepare-resolved.1"],
      projectionHash: "fixture-projection-hash-after-sleep"
    } : null,
    latestFrozenSummary: null,
    resultReady: false,
    resultUrl: null
  };
}

export class DeterministicSleepPressureStorage {
  constructor() {
    this.currentProjection = createSleepPressureProjectionFixture();
    this.previewCalls = [];
    this.confirmCalls = [];
    this.getRunCalls = 0;
  }

  async restoreOrCreate() {
    return structuredClone(this.currentProjection);
  }

  async getRun() {
    this.getRunCalls += 1;
    return structuredClone(this.currentProjection);
  }

  async previewPressureAction(projection, command) {
    assert.equal(projection.runtimeProfile, "SANGTIAN_PRESSURE_SPINE_V1");
    assert.equal(command.expectedRunVersion, 3);
    assert.equal(command.expectedProjectionRevision, 11);
    assert.equal(command.expectedPhase, "PREPARE");
    assert.equal(command.expectedSeatId, "seat.zhejiang_governor");
    assert.equal(command.input.freeText, "我先睡一下");
    assert.equal(Object.hasOwn(command.input, "effect"), false);
    assert.equal(Object.hasOwn(command.input, "statePatch"), false);
    this.previewCalls.push(structuredClone(command));
    return {
      previewId: "preview.sleep.1",
      previewToken: "signed-preview-token.sleep.1",
      requestFingerprint: "fingerprint.sleep.1",
      normalizedIntent: {
        summary: "暂缓处理公务并休息半日",
        actionType: "REST",
        intentCategory: "DELAY"
      },
      compiledAction: {
        actionType: "REST",
        secondaryActionType: "DELAY",
        targetIds: ["target.n1.governor-office"]
      },
      validation: "ACCEPT_WITH_COST",
      timeCost: "半日",
      opportunityCost: "其他五席与 NPC 获得先手",
      expiresAt: "1566-05-12T06:05:00.000Z",
      currentProjectionRevision: 11
    };
  }

  async confirmPressureAction(projection, command) {
    assert.equal(projection.projectionRevision, 11);
    assert.equal(command.previewToken, "signed-preview-token.sleep.1");
    assert.equal(command.requestFingerprint, "fingerprint.sleep.1");
    assert.equal(command.expectedPhase, "PREPARE");
    this.confirmCalls.push(structuredClone(command));
    this.currentProjection = createSleepPressureProjectionFixture({ settled: true });
    return { projection: structuredClone(this.currentProjection) };
  }
}

function suggestion(id, displayText, sourceKind) {
  return {
    id,
    displayText,
    sourceRefs: [{ kind: "CONTENT_ID", id }],
    sourceKind,
    requiresPreview: true
  };
}
