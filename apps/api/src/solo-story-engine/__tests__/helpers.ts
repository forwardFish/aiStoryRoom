import type {
  ActivePressure,
  ExecuteSoloStoryTurnInput,
  PendingConsequence,
  RawPlayerAction,
  RecentCanonEntry,
  ScriptCard,
  StoryFact,
  StoryActionTarget,
  StoryRole,
  StoryScene,
  StoryTurnTransport
} from "../types";
import { normalizePlayerIntent } from "../player-intent";

export function baseRole(): StoryRole {
  return {
    roleId: "zhejiang_governor",
    roleName: "浙江总督",
    identity: "统筹浙江军政的封疆大吏",
    goal: "稳住浙江局势，避免皇帝认定你欺瞒。",
    permissions: ["调卷", "传令", "召见", "派亲随"],
    knownFactIds: ["fact_public_order", "fact_archive_breakin"],
    heldLeverageKeys: ["asset:governor_seal", "asset:memorial_channel"]
  };
}

export function baseScene(): StoryScene {
  return {
    sceneId: "scene_2",
    title: "没有影子的客人",
    timeLabel: "嘉靖三十五年五月初八",
    locationLabel: "杭州·总督府",
    situation: "清流县田契档房遭人潜入，巡抚催促尽快复核，证据与程序都在争夺中。",
    mainlineQuestion: "总督要先稳住执行节奏，还是先抢救证据链？",
    mainlineQuestionIds: ["mq_test"],
    directedBeat: { beatId: "beat_courier", summary: "城西又传来一封催办副本，巡抚衙门的人已经在路上。" }
  };
}

export function baseTargets(): StoryActionTarget[] {
  return [
    { type: "ROLE", id: "xunfu", label: "浙江巡抚" },
    { type: "LOCATION", id: "archive_room", label: "清流县田契档房" },
    { type: "PUBLIC_FRAME", id: "public_frame", label: "当前局势" }
  ];
}

export function baseFacts(): StoryFact[] {
  return [
    {
      factId: "fact_public_order",
      content: "朝廷限期催办改桑，地方执行已经出现裂缝。",
      visibility: "PUBLIC",
      knownByRoleIds: [],
      priority: "P0"
    },
    {
      factId: "fact_archive_breakin",
      content: "清流县田契档房昨夜被人潜入，现场留有空白桑田契纸。",
      visibility: "ROLE_PRIVATE",
      knownByRoleIds: ["zhejiang_governor"],
      priority: "P0"
    },
    {
      factId: "fact_secret_transfer",
      content: "巡抚衙门已安排人提前转移副本。",
      visibility: "ROLE_PRIVATE",
      knownByRoleIds: ["xunfu"],
      priority: "P0"
    }
  ];
}

export function baseCanon(): RecentCanonEntry[] {
  return [
    {
      entryId: "canon_1",
      chronologicalOrder: 1,
      narrative: "总督刚收起便条，案上的空白契纸仍压在公文袋边。巡抚来报，催办文书不能再拖。"
    }
  ];
}

export function basePending(): PendingConsequence[] {
  return [
    {
      consequenceId: "pending_1",
      summary: "档房潜入一事必须在下一段剧情里出现实际回响。",
      priority: "P0",
      dueLabel: "本轮"
    }
  ];
}

export function basePressures(): ActivePressure[] {
  return [
    {
      pressureId: "pressure_1",
      summary: "三日期限已经过了半日。",
      priority: "P0"
    }
  ];
}

export function baseCards(): ScriptCard[] {
  return [
    {
      cardId: "card_1",
      title: "程序与证据不能同时失手",
      summary: "若先签副本，证据链可能被彻底改写；若先查证据，巡抚会借延误反咬。",
      tags: ["程序", "证据"],
      priority: "P1",
      groundedFactIds: ["fact_archive_breakin"]
    }
  ];
}

export function transportWith(output: string, calls: { count: number }): StoryTurnTransport {
  return {
    async generate() {
      calls.count += 1;
      return {
        rawText: output,
        model: "deepseek-test",
        usage: { inputTokens: 1200, outputTokens: 800 }
      };
    }
  };
}

export function buildExecuteInput(rawAction: RawPlayerAction, transport: StoryTurnTransport): ExecuteSoloStoryTurnInput {
  return {
    attemptId: "attempt_test_1",
    role: baseRole(),
    scene: baseScene(),
    facts: baseFacts(),
    recentCanon: baseCanon(),
    pendingConsequences: basePending(),
    activePressures: basePressures(),
    relevantScriptCards: baseCards(),
    availableTargets: baseTargets(),
    rawAction,
    transport,
    maxTokenEstimate: 6_000
  };
}

export function validModelOutput(resolutionId = "resolution:test", paidConsequenceIds: string[] = ["pending_1"]) {
  return JSON.stringify({
    schemaVersion: "solo-story-turn-v1",
    resultType: "PUBLISHED_TURN",
    story: {
      title: "封条之前",
      resultNarrative: "总督把桌上的空白契纸推到烛光下，命亲随立刻出门，另令书吏封好往来文簿。巡抚听完命令，只是垂眼应了一声，话里却把三日期限又压回总督肩上。院外脚步声杂沓，城西回来的差役称，档房门栓已换过一次，像是有人抢在官差前动了手。巡抚没有阻拦亲随，却叫自己的书办紧跟着出门，显然也要争夺第一份现场口供。",
      nextSituationNarrative: "夜色压到总督府檐下，亲随尚未回报，巡抚书办已经追了出去。案上剩下两份笔迹不同的催办公文，而廊下的清流县差役正等着被问话。总督现在必须决定先控制人证，还是先用公文程序把巡抚留在府内。"
    },
    resolution: {
      confirmedResolutionId: resolutionId,
      outcome: "APPLIED",
      observableOutcome: "亲随已领命出发，巡抚当场表示要派书办跟随。"
    },
    endingState: {
      timeLabel: "嘉靖三十五年五月初八，夜色将落",
      locationLabel: "杭州总督府内厅",
      tension: "总督抢到了先手，但巡抚也开始防反。",
      presentEntityRefs: ["xunfu", "public_frame"],
      visibleChanges: ["亲随已经出发", "巡抚感到警觉"],
      surfacedConsequenceIds: [...paidConsequenceIds]
    },
    decisions: [
      {
        decisionId: "d1",
        label: "请巡抚留在内厅，当面对照两份催办公文的经手记录",
        description: "先把巡抚留在自己视线内，再让书吏逐项核对笔迹、递送时间和经手人。",
        intent: "拖住巡抚并核清两份公文为何出现不同笔迹。",
        targetRef: { type: "ROLE", id: "xunfu", label: "浙江巡抚" },
        method: "召浙江巡抚留在府内，当面对照档房封条和昨夜值守名册。",
        leverageKeys: [],
        visibility: "LIMITED",
        riskTolerance: "MEDIUM",
        distinctAxis: "control_people",
        concreteCost: "公开召见会惊动县衙，使暗中查验更难保密。",
        expectedCountermove: "巡抚可能要求派自己的人陪审，借机统一县令口径。",
        groundingIds: ["scene:scene_2", "fact:fact_archive_breakin"]
      },
      {
        decisionId: "d2",
        label: "先压下催办副本，要求巡抚衙门把先前往来底稿一并送来对照",
        description: "用两份催办公文的笔迹差异追查经手人，同时拖住巡抚离府。",
        intent: "用程序反制巡抚，拖住他改口和转移证据的空间。",
        targetRef: { type: "PUBLIC_FRAME", id: "public_frame", label: "当前局势" },
        method: "暂缓签押催办副本，并要求把此前往来底稿送到内厅逐份对照。",
        leverageKeys: [],
        visibility: "OBSERVABLE",
        riskTolerance: "HIGH",
        distinctAxis: "control_procedure",
        concreteCost: "暂压催办副本会留下拖延政令的把柄。",
        expectedCountermove: "巡抚会以三日期限施压，并可能拒绝交出衙门底稿。",
        groundingIds: ["action-resolution", "card:card_1"]
      }
    ],
    grounding: {
      usedScriptSourceIds: ["fact_archive_breakin"],
      usedStoryCardIds: ["card_1"],
      usedCanonFactIds: ["fact_archive_breakin"],
      advancedMainlineQuestionIds: ["mq_test"],
      paidPendingConsequenceIds: [...paidConsequenceIds],
      stagedDirectedBeatId: "beat_courier",
      deferredConsequences: []
    }
  });
}

export function resolutionIdFor(rawAction: RawPlayerAction) {
  const normalized = normalizePlayerIntent(rawAction);
  if (!normalized.ok) throw new Error("test action did not normalize");
  return `resolution:${normalized.intent.immutableIntentHash.slice(0, 24)}`;
}

export function consequenceIdFor(rawAction: RawPlayerAction) {
  const normalized = normalizePlayerIntent(rawAction);
  if (!normalized.ok) throw new Error("test action did not normalize");
  return `pc:${normalized.intent.immutableIntentHash.slice(0, 16)}`;
}
