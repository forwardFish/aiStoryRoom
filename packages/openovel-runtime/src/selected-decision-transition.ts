import { sha256Canonical } from "./canonical";
import type { ShadowRuntimeFixture } from "./types";

export interface PriorShadowArtifact {
  artifactId: string;
  provider?: { providerCallCount?: number; responseStatus?: number };
  validation?: { ok?: boolean; output?: any; issues?: Array<{ code?: string }> };
  gates?: { shadowOnly?: boolean; playerTrafficAffected?: boolean; databaseTouched?: boolean };
  fixtureSnapshot?: ShadowRuntimeFixture;
  userReview?: { status?: "APPROVED" | "REJECTED"; reviewedAt?: string };
}

export function buildSelectedDecisionFixture(
  base: ShadowRuntimeFixture,
  prior: PriorShadowArtifact,
  decisionId: "d1"
): ShadowRuntimeFixture {
  assertReusablePriorNarrative(prior);
  if (decisionId !== "d1") throw new Error(`SELECTED_DECISION_UNSUPPORTED: ${decisionId}`);
  const selectedText = "暂不落印。核查各县改桑占用的粮田和受影响百姓，查明后再决定。";
  const priorNarrative = narrativeFromPrior(prior);
  const fixture = structuredClone(base);
  fixture.schemaVersion = "openovel_shadow_fixture_v2";
  fixture.fixtureId = "sangtian-governor-shadow-turn-002-d1";
  fixture.scene = {
    ...fixture.scene,
    sceneId: "SCENE-sangtian-governor-inner-hall-002",
    title: "核查要求",
    situation: "巡抚已在内厅说明朝廷正在催办，书记刚记完答复。放行文书仍未落印；各县改桑占用粮田和影响百姓的实际情况尚未核查。",
    mainlineQuestion: "总督提出粮田与百姓核查后，应先核对土地册据，还是先汇总百姓受影响情况？",
    mainlineQuestionIds: ["mq_verify_land_impact", "mq_verify_people_impact"]
  };
  fixture.recentCanon = [
    ...fixture.recentCanon,
    {
      entryId: `canon-${prior.artifactId}`,
      chronologicalOrder: Math.max(...fixture.recentCanon.map((item) => item.chronologicalOrder), 0) + 1,
      narrative: priorNarrative
    }
  ];
  fixture.pendingConsequences = [{
    consequenceId: "pending_xunfu_responds_to_review_order",
    summary: "巡抚必须明确回应是否配合核查粮田和受影响百姓；本轮不得直接生成任何县的核查结果。",
    priority: "P0",
    dueLabel: "本轮"
  }];
  fixture.actionResolution = {
    resolutionId: "resolution-shadow-002-d1",
    legality: "LEGAL",
    actionType: "CUSTOM",
    accepted: true,
    acceptedWithCost: true,
    actionStarted: "总督继续暂不落印，提出核查各县改桑占用粮田和受影响百姓，并要求巡抚配合。",
    immediateObservableResult: [
      "放行文书继续不落印。",
      "书记重新提笔记录核查要求。",
      "巡抚在内厅听到要求并必须回应是否配合。",
      "各县尚未提交任何核查结果。"
    ],
    summary: "行动已经开始，但本轮只确认核查要求被提出和记录，不确认任何县的实际影响。",
    costSummary: "落印继续暂缓，朝廷催办压力仍在。",
    consumedLeverageKeys: [],
    pendingConsequences: [{
      consequenceId: "pending_county_review_materials",
      summary: "后续回合才可收到并核验各县粮田与百姓影响材料。",
      priority: "P0",
      dueLabel: null
    }],
    confirmedEffects: [
      "总督继续没有落印。",
      "书记记录了粮田和百姓核查要求。",
      "巡抚在内厅听见了核查要求。",
      "各县核查结果尚未产生。"
    ],
    unresolvedEffects: [
      "巡抚将如何回应核查要求。",
      "各县改桑实际占用了多少粮田。",
      "具体有哪些百姓受到影响。",
      "各县报册是否准确。",
      "巡抚催签的真实动机。"
    ]
  };
  fixture.actionBoundary = {
    stage: "ACTION_ALREADY_LANDED",
    alreadyOccurred: ["总督已经暂缓落印并提出粮田与百姓核查要求", "书记已经把核查要求记入簿册", "巡抚已经听见核查要求"],
    firstNewBeat: "巡抚听见核查要求后的真实反应",
    mustNotRestage: ["总督再次完整说出核查命令", "书记从头记录核查命令"],
    validationPatterns: [{
      code: "ACTION_RESTAGED_REVIEW_ORDER",
      pattern: "总督[^。\\n]{0,24}[‘“\"][^’”\"]{0,80}(?:粮田|百姓)[^’”\"]{0,40}(?:核查|查清)",
      description: "正文重新用总督对白演出了已经落地的粮田与百姓核查命令。",
      firstCharacters: 220
    }]
  };
  fixture.npcActionPolicies = {
    "NPC-xunfu": {
      writerOnlyBehavior: true,
      publicPosition: "愿意回应核查要求，但不接受把核查与暂缓落印的全部责任都留给巡抚衙门。",
      immediateGoal: "要求总督明确核查范围、经手责任或暂缓落印的责任归属。",
      leverage: ["朝廷正在催办", "放行文书仍未落印"],
      allowedResponses: ["附条件配合", "要求责任留痕", "要求指定经手人", "要求明确首轮核查范围"],
      mustDo: "提出一个会改变责任或权力关系的具体条件。",
      mustNotDo: ["只说需要时间", "机械复述核查流程", "凭空报告各县材料状态"]
    }
  };
  fixture.playerIntent = {
    source: "CUSTOM",
    targetId: "FRAME-review-procedure",
    targetLabel: "粮田与百姓核查",
    objective: "在落印前查明各县改桑对粮田和百姓的实际影响。",
    method: "继续暂不落印，要求巡抚配合核查各县粮田和受影响百姓。",
    userFacingText: selectedText,
    leverageKeys: [],
    immutableIntentHash: sha256Canonical({ priorArtifactId: prior.artifactId, decisionId, selectedText })
  };
  fixture.availableTargets = [
    ...fixture.availableTargets,
    { type: "EVIDENCE", id: "EVIDENCE-county-land-records", label: "各县粮田册据" },
    { type: "PUBLIC_FRAME", id: "FRAME-people-impact-review", label: "百姓影响核查" }
  ];
  fixture.openThreads = [
    "各县改桑实际占用多少粮田？",
    "哪些百姓受到失田或缺粮影响？",
    "各县报册如何交叉核验？",
    "朝廷催办是否给核查留下时间？"
  ];
  fixture.narrativeBoundary = {
    ...fixture.narrativeBoundary,
    turnEndsWhen: "巡抚明确答应配合核查，书记记下答复；任何县的核查数字和结果都尚未出现。",
    allowedNpcResponseTopics: ["答应配合核查", "要求各县报明粮田和受影响百姓", "原册需要一并核对"],
    resultNarrativeForbiddenTerms: ["清流", "密信", "暗账"],
    forbiddenStoryOutcomeTerms: [...fixture.narrativeBoundary.forbiddenStoryOutcomeTerms, "核查完成", "已经查明"]
  };
  fixture.narrativeFrame = {
    frameId: "frame-shadow-governor-review-order-v1",
    storyIntent: "写出总督把粮田与百姓核查变成正式命令后，巡抚基于自身职责和压力作出的真实回应，使程序分歧转化为一个新的现场抉择。",
    requiredBeats: [
      "书记记录总督关于粮田和百姓核查的命令。",
      "巡抚必须当场回应是否配合以及准备怎样执行，但具体措辞和态度由 Writer 决定。",
      "各县尚未提交材料，现场不能出现核查数字或调查结果。"
    ],
    requiredNarrativePatterns: [
      { code: "FRAME_SECRETARY_RECORD_MISSING", pattern: "书记[\\s\\S]{0,40}(?:笔|记录|簿册)", message: "Narrative must show the secretary recording the review order." },
      { code: "FRAME_REVIEW_SCOPE_MISSING", pattern: "粮田[\\s\\S]{0,40}百姓|百姓[\\s\\S]{0,40}粮田", message: "Narrative must state both land and people review scope." },
      { code: "FRAME_XUNFU_COMMITMENT_MISSING", pattern: "巡抚[\\s\\S]{0,120}(?:配合|报明|原册)", message: "Narrative must show the xunfu's bounded review commitment." },
      { code: "FRAME_SEAL_HOLD_MISSING", pattern: "(?:未|不|暂不)[^。]{0,12}(?:落印|盖印)|(?:落印|盖印)[^。]{0,12}(?:未|不)", message: "Narrative must preserve the unsealed document state." },
      { code: "FRAME_WAITING_END_MISSING", pattern: "巡抚[\\s\\S]{0,160}(?:等待|等候|只等)[\\s\\S]{0,24}(?:决定|安排|回应)", message: "Narrative must end at the next player decision." }
    ],
    allowedDescriptiveDetails: ["簿册", "笔", "墨", "放行文书", "未启封的印泥", "纸张", "目光", "更漏声", "烛火"],
    endingBoundary: "巡抚完成当场回应，命令已经记入簿册，但各县材料仍未到达；现场出现一个由巡抚回应自然造成、可由总督立即处理的新问题。",
    decisionPolicy: {
      minimum: 3,
      maximum: 3,
      allowedClasses: ["authority", "responsibility", "evidence_control", "scope_change", "secrecy", "negotiation"],
      instruction: "只从正文最终局面提出立即可执行的不同动作；不得预设为固定的粮册路线或百姓路线。"
    }
  };
  return fixture;
}

export function buildLandRecordReviewFixture(
  prior: PriorShadowArtifact,
  decisionId: "d1"
): ShadowRuntimeFixture {
  assertApprovedPriorNarrative(prior);
  if (decisionId !== "d1") throw new Error(`LAND_RECORD_DECISION_UNSUPPORTED: ${decisionId}`);
  const selectedText = "调取各县原粮册和改桑申报册，逐项核对粮田占用情况。";
  const fixture = structuredClone(prior.fixtureSnapshot!);
  fixture.schemaVersion = "openovel_shadow_fixture_v2";
  fixture.role = {
    ...fixture.role,
    identity: "你是浙江总督，掌握放行文书是否落印的决定权，并负责处理督抚之间的责任归属。",
    goal: "在册据核对开始前守住粮田与百姓影响的核查入口，同时明确调册与暂缓落印分别由谁承担。",
    permissions: [...new Set([...fixture.role.permissions, "处理督抚责任归属"])]
  };
  const priorNarrative = narrativeFromPrior(prior);
  fixture.fixtureId = "sangtian-governor-shadow-turn-003-land-records";
  fixture.scene = {
    ...fixture.scene,
    sceneId: "SCENE-sangtian-governor-inner-hall-003",
    title: "调取粮册",
    situation: "调取两类册据的命令已经由书记记下。巡抚仍在内厅，放行文书未落印，各县册据尚未送达。",
    mainlineQuestion: "巡抚如何回应总督绕过改桑申报、直接调取原粮册交叉核对的命令；这道命令会把谁置于被追问的位置？",
    mainlineQuestionIds: ["mq_register_control", "mq_accountability_chain"]
  };
  fixture.recentCanon = [{
    entryId: `canon-${prior.artifactId}`,
    chronologicalOrder: 1,
    narrative: priorNarrative
  }];
  fixture.activePressures = [
    {
      pressureId: "pressure_reform_court_attention",
      summary: "朝廷已经交办并正在催办改桑执行；具体催办文书内容和期限仍未知。",
      priority: "P0"
    },
    {
      pressureId: "pressure_grain_and_people",
      summary: "改桑可能影响粮田和百姓生计，但实际影响必须等册据送达后核查。",
      priority: "P0"
    },
    {
      pressureId: "pressure_governor_xunfu_responsibility",
      summary: "调册与暂缓落印分别由谁负责，已经成为督抚之间当前可处理的矛盾。",
      priority: "P0"
    }
  ];
  fixture.pendingConsequences = [{
    consequenceId: "pending_xunfu_responds_to_register_order",
    summary: "巡抚必须对调取原粮册和改桑申报册的命令作出真实回应；可以配合、提出条件或指出执行阻力，但本轮不得让册据抵达或生成核对结果。",
    priority: "P0",
    dueLabel: "本轮"
  }];
  fixture.actionResolution = {
    resolutionId: "resolution-shadow-003-land-records",
    legality: "LEGAL",
    actionType: "CUSTOM",
    accepted: true,
    acceptedWithCost: true,
    actionStarted: "总督下令调取各县原粮册和改桑申报册，准备逐项核对粮田占用情况。",
    immediateObservableResult: [
      "放行文书继续不落印。",
      "书记记录调取两类册据的命令。",
      "巡抚在内厅听到命令，并必须作出可观察回应。",
      "各县册据尚未送达，核对尚未开始。"
    ],
    summary: "调取命令已经提出并记录；本轮由巡抚的现场回应形成下一步局面，但不产生册据内容、差异记录或粮田数字。",
    costSummary: "全面调取册据需要后续时间，落印继续暂缓。",
    consumedLeverageKeys: [],
    pendingConsequences: [{
      consequenceId: "pending_land_register_delivery",
      summary: "后续回合才可收到各县原粮册和改桑申报册，并开始真实性核对。",
      priority: "P0",
      dueLabel: null
    }],
    confirmedEffects: [
      "总督继续没有落印。",
      "书记记录了调取原粮册和改桑申报册的命令。",
      "巡抚听到了调取命令。",
      "各县册据尚未送达。"
    ],
    unresolvedEffects: [
      "巡抚将如何回应调取命令。",
      "各县原粮册与改桑申报册是否一致。",
      "实际有多少粮田被改作桑田。",
      "是否存在伪造或补改记录。",
      "哪些百姓受到实际影响。",
      "巡抚是否会完整执行、提出条件还是设置阻力。"
    ]
  };
  fixture.actionBoundary = {
    stage: "ACTION_ALREADY_LANDED",
    alreadyOccurred: [
      "总督已经下令调取各县原粮册和改桑申报册",
      "书记已经将调取命令记入簿册",
      "巡抚已经听见调取命令"
    ],
    firstNewBeat: "正文第一句就是巡抚提出分责主张：自陈愿担调册经手，并请总督承担暂缓落印；不先写玩家命令、核查方向、听见、听完、闻言、等待、停顿或表示配合",
    mustNotRestage: ["总督重新说出完整调取命令", "书记从头记录调取命令"],
    validationPatterns: [
      {
        code: "ACTION_RESTAGED_REGISTER_ORDER",
        pattern: "总督[^。\\n]{0,12}(?:道|说|命|下令|开口)[^。\\n]{0,8}[‘“\"][^’”\"]{0,90}原粮册[^’”\"]{0,50}(?:改桑申报册|申报册)[^’”\"]{0,50}(?:调取|调来|核对)",
        description: "正文重新用总督对白演出了已经落地的调册命令。",
        firstCharacters: 260
      },
      {
        code: "ACTION_RESTAGED_SECRETARY_RECORD",
        pattern: "书记[^。]{0,36}(?:重新|从头)?(?:提笔|落笔|记录)[^。]{0,48}(?:调取命令|原粮册和改桑申报册|两类册据的命令)",
        description: "书记已经记完调册命令，正文不得从头重演记录过程。",
        firstCharacters: 280
      },
      {
        code: "ACTION_RESTAGED_NPC_ORDER_SUMMARY",
        pattern: "巡抚[^。\n]{0,100}[‘“\"][^’”\"]{0,60}(?:(?:调取|调来)[^’”\"]{0,16}(?:两类册据|原粮册)|(?:(?:总督)?大人|总督)(?:(?:刚才|已经|已|要|既要|下令|决定|准备|将)[^’”\"]{0,8}(?:调册|调取|核对|逐项核对)|[^’”\"]{0,8}调册核对))",
        description: "第一段不得借巡抚对白复述玩家刚刚完成的调册行动。",
        firstParagraphOnly: true
      },
      {
        code: "ACTION_BOUNDARY_NPC_CAUSAL_PREFACE",
        pattern: "巡抚[^。\\n]{0,20}(?:听完|听罢|听见|闻言)[^。\\n]{0,28}(?:总督|调册|命令|决定)",
        description: "第一段必须直接呈现巡抚的新回应，不得先概括他听完玩家刚完成的调册行动。",
        firstParagraphOnly: true
      },
      {
        code: "PLAYER_UNSUBMITTED_RESPONSE",
        pattern: "总督[^。]{0,24}(?:尚未开口|未曾开口|没有开口|没有(?:开口)?阻止|并未(?:开口)?阻止|没有制止|并未制止|未作阻拦|未加阻拦|点头|颔首|默许|应允|答应了|同意了|表示同意)",
        description: "玩家本轮行动已经结束，正文不得替总督追加默许、同意或其他新回应。",
        firstCharacters: 850
      },
      {
        code: "FRAME_SECRETARY_WAITS_NEW_AUTHORIZATION",
        pattern: "书记[^。]{0,80}(?:(?:等待|等候|等的是|只等|只待)[^。]{0,28}(?:总督)?(?:示意|表态|开口|吩咐|点头|指令)|(?:看了总督一眼|看向总督)[^。]{0,32}(?:没有立刻落笔|未曾落笔|仍未落笔)|(?:抬眼看向|望向)总督[^。]{0,32}(?:等待|等候)[^。]{0,20}(?:点头|指令|示意|表态))",
        description: "书记已经受命记录现场问答，不得再次等待总督授权后才记录巡抚的新条件。",
        firstCharacters: 850
      },
      {
        code: "ACTION_RESTAGED_PLAYER_ACTION_REFERENCE",
        pattern: "总督(?:既已|已经|已|刚才)?(?:下令|定下(?:了)?[^。]{0,8}(?:核查|调册)(?:方向)?)",
        description: "第一段不得用‘总督已经下令’或‘总督已定下核查方向’概括玩家刚完成的行动。",
        firstParagraphOnly: true
      }
    ]
  };
  fixture.stateLocks = {
    registers: {
      originalGrainRegistersAtGovernorOffice: false,
      reformRegistersAtGovernorOffice: false,
      anyRegistersPrepared: "unknown",
      anyRegistersInTransit: false,
      originalGrainRegisterCustody: "unknown",
      reformRegisterCustody: "unknown",
      reformRegisterCompilationStatus: "unknown",
      reformRegisterSubmissionStatus: "unknown",
      reviewStarted: false,
      reviewResultsExist: false,
      differencesFound: false
    },
    scene: {
      xunfuPresent: true,
      privateSecretaryPresent: true,
      releaseDocumentStamped: false,
      sealPasteOpened: false
    },
    documents: {
      courtReminderContentKnown: "unknown"
    }
  };
  fixture.stateLockAssertions = [
    {
      code: "STATE_LOCK_REGISTER_PREPARED_POSITIVE",
      fieldPath: "registers.anyRegistersPrepared",
      blockedWhen: [false, "unknown"],
      pattern: "(?:原粮册|改桑申报册|申报册|两册|册据)[^。]{0,30}(?:已经|已然|已|刚)(?:备齐|备妥|编成|造好)",
      description: "册据是否已经编成或备齐仍未知，不能写成肯定事实。"
    },
    {
      code: "STATE_LOCK_REGISTER_PREPARED_NEGATIVE",
      fieldPath: "registers.anyRegistersPrepared",
      blockedWhen: [true, "unknown"],
      pattern: "(?:原粮册|改桑申报册|申报册|两册|册据)[^。]{0,30}(?:尚未|还未|没有)(?:备齐|备妥|编成|造好)",
      description: "册据是否已经编成或备齐仍未知，不能写成否定事实。"
    },
    {
      code: "STATE_LOCK_REGISTER_IN_TRANSIT",
      fieldPath: "registers.anyRegistersInTransit",
      blockedWhen: [false, "unknown"],
      pattern: "(?:原粮册|改桑申报册|申报册|两册|册据)[^。]{0,30}(?:已经送出|已送出|正在送来|送来途中|已在路上|正在押送)",
      description: "册据尚未在途，不能写成已经送出或正在送来。"
    },
    {
      code: "STATE_LOCK_ORIGINAL_REGISTER_CUSTODY",
      fieldPath: "registers.originalGrainRegisterCustody",
      blockedWhen: ["unknown"],
      pattern: "原粮册[^。]{0,28}(?:分散|放在|藏在|在|存于|收在|由|归)[^。]{0,28}(?:县衙|县库|库房|府库|府衙|巡抚衙门|户房|粮房|粮科|管粮官|主簿|官员|各县)(?:经管|经手|保管|掌管|造报)?",
      description: "原粮册由谁保管仍未知，不能凭常识补写保管地点或经手官署。"
    },
    {
      code: "STATE_LOCK_REFORM_REGISTER_CUSTODY",
      fieldPath: "registers.reformRegisterCustody",
      blockedWhen: ["unknown"],
      pattern: "(?:改桑申报册|申报册)[^。]{0,32}(?:(?:在|存于|收在|由|归)[^。]{0,28}(?:主簿|县衙|县库|库房|府库|府衙|巡抚衙门|户房|粮房|粮科|管粮官|官员|各县)(?:经手|保管|掌管|造报|编造|编报|制作)?|(?:是|系)[^。]{0,20}(?:各县)?自行(?:造报|编造|编报|制作))",
      description: "改桑申报册由谁保管或经手仍未知，不能凭常识补写。"
    },
    {
      code: "STATE_LOCK_REGISTER_CUSTODY_DIFFERENCE",
      fieldPath: "registers.originalGrainRegisterCustody",
      blockedWhen: ["unknown"],
      pattern: "(?:原粮册[^。]{0,28}(?:改桑申报册|申报册)|两类册据)[^。]{0,36}(?:经手人|经手官|保管人)[^。]{0,16}(?:不同|不一|各不相同)",
      description: "两类册据的经手人是否不同仍未知，不能写成既有事实。"
    },
    {
      code: "STATE_LOCK_REGISTER_CUSTODIAN_XUNFU",
      fieldPath: "registers.originalGrainRegisterCustody",
      blockedWhen: ["unknown"],
      pattern: "(?:原粮册[^。]{0,28}(?:改桑申报册|申报册)|两类册据)[^。]{0,48}(?:各县[^。]{0,16}报来)?[^。]{0,24}(?:本就|都|均)?经(?:我|巡抚)(?:之)?手",
      description: "两类册据是否经巡抚之手仍未知，不能写成既有流程或保管事实。"
    },
    {
      code: "STATE_LOCK_REGISTER_INSTITUTION_DIFFERENCE",
      fieldPath: "registers.originalGrainRegisterCustody",
      blockedWhen: ["unknown"],
      pattern: "(?:原粮册[^。]{0,28}(?:改桑申报册|申报册)|两类册据)[^。]{0,40}(?:分属|分别归|各归|分别由)[^。]{0,24}(?:不同|两处|各自)?[^。]{0,16}(?:衙门|官署|部门|科房)[^。]{0,12}(?:经管|保管|掌管)?",
      description: "两类册据是否分属不同官署经管仍未知。"
    },
    {
      code: "STATE_LOCK_REGISTER_LOCAL_COPIES",
      fieldPath: "registers.originalGrainRegisterCustody",
      blockedWhen: ["unknown"],
      pattern: "(?:原粮册[^。]{0,28}(?:改桑申报册|申报册)|两类册据)[^。]{0,30}各县[^。]{0,16}(?:都有|均有|各有|留有|存有)(?:存底|底册|抄本|副本)",
      description: "各县是否留有两类册据的存底或副本仍未知。"
    },
    {
      code: "STATE_LOCK_REFORM_REGISTER_COMPILATION_POSITIVE",
      fieldPath: "registers.reformRegisterCompilationStatus",
      blockedWhen: [false, "unknown"],
      pattern: "(?:改桑申报册|申报册)[^。]{0,26}(?:已经|已|正在)(?:编成|汇总|汇编|整理)",
      description: "改桑申报册的编制和汇总状态仍未知。"
    },
    {
      code: "STATE_LOCK_REFORM_REGISTER_COMPILATION_NEGATIVE",
      fieldPath: "registers.reformRegisterCompilationStatus",
      blockedWhen: [true, "unknown"],
      pattern: "(?:改桑申报册|申报册)[^。]{0,26}(?:尚未|还未|没有)(?:编成|汇总|汇编|整理)",
      description: "改桑申报册的编制和汇总状态仍未知。"
    },
    {
      code: "STATE_LOCK_REFORM_REGISTER_SUBMISSION_POSITIVE",
      fieldPath: "registers.reformRegisterSubmissionStatus",
      blockedWhen: [false, "unknown"],
      pattern: "(?:改桑申报册|申报册)[^。]{0,26}(?:已经|已|刚)(?:报上|上报|提交|报来)",
      description: "改桑申报册是否已由各县提交仍未知。"
    },
    {
      code: "STATE_LOCK_REFORM_REGISTER_SUBMISSION_NEGATIVE",
      fieldPath: "registers.reformRegisterSubmissionStatus",
      blockedWhen: [true, "unknown"],
      pattern: "(?:改桑申报册|申报册)[^。]{0,26}(?:尚未|还未|没有)(?:报上|上报|提交|报来)",
      description: "改桑申报册是否已由各县提交仍未知。"
    },
    {
      code: "STATE_LOCK_REVIEW_STARTED",
      fieldPath: "registers.reviewStarted",
      blockedWhen: [false, "unknown"],
      pattern: "(?:两册|册据|原粮册|申报册)[^。]{0,24}(?:已经开始|正在)(?:核对|查验|比对)",
      description: "册据核对尚未开始。"
    },
    {
      code: "STATE_LOCK_REVIEW_RESULT",
      fieldPath: "registers.reviewResultsExist",
      blockedWhen: [false, "unknown"],
      pattern: "(?:核对|查验|比对)[^。]{0,20}(?:结果|查明|完成|发现)",
      description: "本轮没有册据核对结果。"
    },
    {
      code: "STATE_LOCK_DIFFERENCES_FOUND",
      fieldPath: "registers.differencesFound",
      blockedWhen: [false, "unknown"],
      pattern: "(?:两册|册据|记录)[^。]{0,24}(?:不一致|有差异|对不上|被改动)",
      description: "本轮尚未发现任何册据差异。"
    },
    {
      code: "STATE_LOCK_COURT_REMINDER_CONTENT",
      fieldPath: "documents.courtReminderContentKnown",
      blockedWhen: ["unknown"],
      pattern: "(?:朝廷催办文书|催办文书|朝廷文书)[^。]{0,24}(?:写明|载明|明载|注明|明说)",
      description: "朝廷催办文书的具体原文尚未提供，不能编写其内容。"
    },
    {
      code: "STATE_LOCK_RELEASE_DOCUMENT_STAMPED",
      fieldPath: "scene.releaseDocumentStamped",
      blockedWhen: [false, "unknown"],
      pattern: "(?:放行文书|文书)[^。]{0,18}(?:已经|已然|已)(?:落印|盖印)",
      description: "放行文书仍未落印。"
    },
    {
      code: "STATE_LOCK_SEAL_PASTE_OPENED",
      fieldPath: "scene.sealPasteOpened",
      blockedWhen: [false, "unknown"],
      pattern: "印泥[^。]{0,16}(?:已经|已被|已)(?:启封|打开)",
      description: "印泥仍未启封。"
    }
  ];
  fixture.npcActionPolicies = {
    "NPC-xunfu": {
      writerOnlyBehavior: true,
      publicPosition: "愿意承担自己一方的经手责任，但不愿独自承担经手和暂缓落印两项责任。",
      immediateGoal: "只推动一项双方分责条件，不增加期限或其他执行安排。",
      leverage: ["朝廷正在催办", "任何调册安排都需要留下具名经手责任", "放行文书仍未落印"],
      allowedResponses: ["要求总督与巡抚分别具名", "要求书记把双方责任并列记入现有簿册", "以承担调册责任交换总督承担暂缓落印责任", "拒绝独自承担调册和暂缓落印两项责任"],
      mustDo: "只使用现有簿册、书记和未落印文书，提出一个改变双方具名责任或承诺关系的具体条件。",
      mustNotDo: ["只说明调取需要时间", "只询问总督准备等待多久", "机械复述调取流程", "说明册据由谁保管或经手", "编造地方官署名称", "提出县名、县数、期限、批次或试点范围", "追加日期时辰等记录字段", "声称催办压力正在加紧", "承诺各县绝不拖延", "凭空报告册据已经编成、提交、汇总或在途"]
    }
  };
  fixture.availableTargets = addTargets(fixture.availableTargets.filter((target) => target.type !== "PUBLIC_FRAME"), [
    { type: "RESOURCE", id: "RESOURCE-release-document", label: "放行文书" },
    { type: "RESOURCE", id: "RESOURCE-governor-seal", label: "总督印" },
    { type: "RESOURCE", id: "RESOURCE-governor-retinue", label: "总督亲随" },
    { type: "RESOURCE", id: "RESOURCE-secretary-ledger", label: "书记簿册" }
  ]);
  fixture.decisionAccess = {
    locationRef: "INSTITUTION-governor-office",
    presentEntityRefs: ["NPC-xunfu", "NPC-private-secretary"],
    controllableEntityRefs: ["NPC-private-secretary", "RESOURCE-governor-retinue"],
    reachableInstitutionRefs: ["INSTITUTION-governor-office"],
    availableObjectRefs: ["RESOURCE-release-document", "RESOURCE-governor-seal", "RESOURCE-secretary-ledger"]
  };
  fixture.resources = ["案上未落印的放行文书", "尚未启封的总督印", "现有书记簿册", "可听令记录的书记", "可调动的总督亲随"];
  fixture.styleGuide = [
    "从 Action Boundary 指定的巡抚新反应开始，不复述玩家行动。",
    "用具体动作、停顿、文书和人物回应表现权谋。",
    "不要用系统术语或规则摘要代替剧情。",
    "正文结束后从结构化 endingState 生成恰好三个真实决策。"
  ];
  fixture.playerIntent = {
    source: "CUSTOM",
    targetId: "EVIDENCE-county-land-records",
    targetLabel: "各县粮田册据",
    objective: "通过原粮册和改桑申报册的交叉核对，查明粮田占用情况。",
    method: "按县调取两类册据并逐项核对。",
    userFacingText: selectedText,
    leverageKeys: [],
    immutableIntentHash: sha256Canonical({ priorArtifactId: prior.artifactId, decisionId, selectedText })
  };
  fixture.openThreads = [
    "各县原粮册与改桑申报册是否一致？",
    "调取两类册据的经手责任由谁具名承担？",
    "总督暂缓落印与巡抚负责调册应如何分别留痕？",
    "册据送达前如何维持现有责任记录？"
  ];
  fixture.narrativeBoundary = {
    ...fixture.narrativeBoundary,
    turnEndsWhen: "巡抚提出一个会改变责任、范围、具名经手或主动权的具体条件，书记将该条件或分歧记入簿册；册据仍未送达，核对尚未开始。",
    allowedNpcResponseTopics: ["朝廷催办与暂缓落印的责任归属", "要求总督与巡抚分别具名", "要求书记把双方责任并列记入现有簿册", "以承担调册责任交换总督承担暂缓落印责任"],
    resultNarrativeForbiddenTerms: ["清流", "密信", "暗账", "伪造"],
    forbiddenStoryOutcomeTerms: [...new Set([...fixture.narrativeBoundary.forbiddenStoryOutcomeTerms, "册据送达", "核对完成", "已经查明", "查出问题"])]
  };
  fixture.currentStateExclusions = [
    ...fixture.currentStateExclusions.filter((item) => item.code !== "UNCONFIRMED_COUNTY_READINESS"),
    {
      code: "UNCONFIRMED_REGISTER_DELIVERY",
      description: "调取命令刚刚发出；不得写册据已经备齐、报上、送达、正在送来或已经在路上。",
      pattern: "(?:原粮册|申报册|册据|粮册)[^。]{0,28}(?:已备齐|已经备齐|刚报上来|已经报上|已经送达|已经送到|正在送|已在路上)"
    },
    {
      code: "UNCONFIRMED_COUNTY_BEHAVIOR",
      description: "本轮没有确认各县会推诿、拖延或抗命。",
      pattern: "各县[^。]{0,24}(?:推诿|拖延|抗命|不敢拖延)"
    },
    {
      code: "UNAVAILABLE_NEW_DOCUMENT",
      description: "当前可用物件中没有新制手令或调册令；正文和决策不得把它们当作现成行动对象。",
      pattern: "手令|调册令|联名具文|具文上报"
    },
    {
      code: "INVALID_SEAL_PASTE_INTERACTION",
      description: "未启封的印泥只能作为静态状态，不得让巡抚或书记触碰，也不得把它写成带封蜡的信封。",
      pattern: "(?:(?:巡抚|书记)[^。]{0,40}(?:按住|触碰|拿起|推开|抚过)[^。]{0,20}印泥|印泥[^。]{0,24}(?:指腹|封蜡|封缄|封口)|那封[^。]{0,12}印泥)"
    },
    {
      code: "INVALID_RELEASE_DOCUMENT_INTERACTION",
      description: "放行文书只能作为未落印的静态状态，巡抚和书记不得擅自触碰或移动。",
      pattern: "(?:(?:巡抚|书记)[^。]{0,50}(?:手指|指尖|手掌|指腹)[^。]{0,12}(?:落在|按住|触碰|轻叩|叩)[^。]{0,20}(?:放行文书|文书)|(?:巡抚|书记)[^。]{0,50}(?:拿起|推开|挪动|收起)[^。]{0,20}(?:放行文书|文书))"
    },
    {
      code: "INVALID_SEAL_PASTE_OPENED",
      description: "印泥维持未启状态，不得凭空写成盒盖已经打开。",
      pattern: "印泥(?:盒)?(?:盖)?[^。]{0,8}(?:半开|半启|已经打开|已打开)|(?:半开|半启|已经打开|已打开)[^。]{0,8}印泥"
    },
    {
      code: "UNAVAILABLE_NEW_LEDGER",
      description: "当前只有现有书记簿册，不得凭空增加另一册新簿。",
      pattern: "另起新簿|另开新簿|另造新簿|新簿"
    },
    {
      code: "UNAVAILABLE_XUNFU_PAPER",
      description: "当前前景资源中没有巡抚预写的具名纸单或新文书。",
      pattern: "巡抚[^。]{0,36}(?:从袖中|袖中)[^。]{0,20}(?:取出|拿出)[^。]{0,12}(?:纸|文书|公文|急令)|巡抚(?:所写|写下)的?具名纸|具名纸|纸单"
    },
    {
      code: "UNAUTHORIZED_DEADLINE_EXISTENCE",
      description: "只确认朝廷正在催办，没有可写入剧情的催办期限或限期。",
      pattern: "(?:朝廷)?催办(?:的)?期限|催办限期|朝廷限期|调册期限|核对期限|同步期限|限期[零〇一二三四五六七八九十百千万两0-9]|改桑(?:的)?(?:时限|期限)|时限[^。]{0,12}不会等人|限各县|依限呈报|限期呈报|暂缓[^。]{0,16}期限|期限[^。]{0,16}(?:写明|记入|入簿)"
    },
    {
      code: "UNCONFIRMED_NEW_REGISTER",
      description: "当前只确认要调取两类册据，不确认另有已经可以执行的新册。",
      pattern: "(?:各县|地方)[^。]{0,16}(?:按|依)[^。]{0,12}新册|新册[^。]{0,18}(?:改桑|执行)"
    },
    {
      code: "UNCONFIRMED_COURT_REMINDER_ARRIVAL",
      description: "只确认朝廷正在催办，不确认一份催办文书已经送到现场。",
      pattern: "(?:朝廷)?催办(?:文书|公文)[^。]{0,24}(?:已经|已|送到|送达|抵达|摊在|展开|取出|朱印)|朝廷急递(?:公文|文书)?[^。]{0,20}(?:已到|送到|摊在|展开|取出)|(?:一封)?公文[\\s\\S]{0,100}(?:朝廷催办|催办改桑|朝廷急递|急递)"
    },
    {
      code: "UNAVAILABLE_REGISTER_COPY",
      description: "当前没有已经定位或可立即取用的旧粮册副本。",
      pattern: "旧年粮册副本|粮册副本|巡抚衙门[^。]{0,18}(?:存档|所存)[^。]{0,18}(?:粮册|册据)"
    },
    {
      code: "UNAUTHORIZED_RESPONSIBILITY_FIELDS",
      description: "巡抚的责任条件只能使用现有具名关系，不得凭空追加日期、时辰等记录字段。",
      pattern: "(?:日期[^。]{0,12}时辰|时辰[^。]{0,12}日期|年月日[^。]{0,12}(?:写清|记清))"
    },
    {
      code: "UNCONFIRMED_COURT_PRESSURE_TREND",
      description: "只确认朝廷正在催办，不确认催办压力正在变紧或升级。",
      pattern: "(?:催办在即|催办[^。]{0,12}(?:日紧|甚急|愈急|加紧|更紧|越来越紧|迫在眉睫))",
      severity: "error",
      factClass: "CAUSAL"
    },
    {
      code: "UNCONFIRMED_RESPONSIBILITY_ACCEPTED",
      description: "巡抚的分责条件只被记录，尚未得到总督接受，不能写成责任已经分定或生效。",
      pattern: "责任(?:归属)?(?:已经|已)(?:分开|分明|分定|明确|确定|生效)|责任归属(?:已经|已)(?:明确|确定|生效)|(?:改变|改写)了?双方?[^。]{0,24}责任归属(?:关系|格局)?|责任归属格局(?:已经|已)?改变|双方[^。]{0,24}(?:变为|成为)(?:责任对等|分责已定|责任已分)(?:关系|格局)?"
    },
    {
      code: "ACTION_RESTAGED_LEDGER_AVAILABILITY",
      description: "现有簿册已经在书记手边，不得重新取来或拿来。",
      pattern: "(?:请|让|命令)?书记[^。]{0,16}(?:取|拿)[^。]{0,10}簿册[^。]{0,6}(?:来|过来)?|(?:取|拿)簿册来"
    },
    {
      code: "UNCONFIRMED_INK_PREPARATION",
      description: "笔墨准备状态属于非因果纹理，不应被后续剧情当作持久状态或行动入口。",
      pattern: "(?:(?:墨汁|墨)[^。]{0,12}(?:已经|已)(?:研好|备好|备妥|调好)|(?:笔|笔尖)[^。]{0,12}(?:已经|已)?蘸(?:饱|满)墨)",
      severity: "warning",
      factClass: "TEXTURE"
    },
    {
      code: "UNCONFIRMED_XUNFU_NAME",
      description: "当前巡抚没有姓名，只能称为巡抚。",
      pattern: "巡抚[^，。：“”]{0,4}某|巡抚某某|胡某"
    },
    {
      code: "UNCONFIRMED_REGISTER_FIELDS",
      description: "工作集没有确认两类册据包含经手人、日期、签押等字段，不得让巡抚凭空承诺核对这些字段。",
      pattern: "(?:(?:原粮册|改桑申报册|两类册据|册据)[^。]{0,48}(?:核对|查验)[^。]{0,28}(?:经手人|日期|签押|落款|页码|册尾)|(?:册尾)[^。]{0,24}(?:具名|签押|落款))",
      severity: "error",
      factClass: "CAUSAL"
    },
    {
      code: "UNCONFIRMED_SCENE_WEATHER",
      description: "当前场景没有提供风或其他天气状态。",
      pattern: "夜风|风从[^。]{0,16}(?:窗|门)|(?:窗|门)[^。]{0,12}风",
      severity: "warning",
      factClass: "TEXTURE"
    },
    {
      code: "FRAME_XUNFU_GOAL_CONTRADICTION",
      description: "巡抚的既定目标是避免独自承担调册经手与暂缓落印两项责任，不得把两项责任都归给巡抚本人。",
      pattern: "(?:调册经手|调册)[^。！？\\n]{0,80}(?:由(?:下官|巡抚|自己)[^。！？\\n]{0,20}(?:承担|督办)|(?:下官|巡抚|自己)[^。！？\\n]{0,20}(?:承担|督办))[^。！？\\n]{0,100}暂缓落印(?:之责|责任)?[^。！？\\n]{0,24}(?:(?:也|仍|一并|亦)?由(?:下官|巡抚|自己)|(?:下官|巡抚|自己)(?:也|仍|一并|亦)?)[^。！？\\n]{0,20}(?:承担|担责|一力承担)",
      severity: "error",
      factClass: "CAUSAL"
    },
    {
      code: "INVALID_RELEASE_DOCUMENT_BLANK",
      description: "放行文书只确认尚未落印，不等于没有正文或仍是白纸。",
      pattern: "(?:放行文书|文书)[^。]{0,16}(?:空白|白纸)|(?:空白|白纸)[^。]{0,16}(?:放行文书|文书)",
      severity: "error",
      factClass: "CAUSAL"
    },
    {
      code: "UNAUTHORIZED_NPC_EXECUTION_COMMITMENT",
      description: "本轮只允许巡抚提出责任条件，不得新增行文、催送、督送或册据送达承诺。",
      pattern: "(?:巡抚|下官)[^。！？\\n]{0,120}(?:即刻|立即|马上|亲自|限[^，。！？\\n]{0,8}|将|会)[^。！？\\n]{0,48}(?:行文|督送|催送|送至|送来|报送|着手调册|开始调册|办理调册)",
      severity: "error",
      factClass: "CAUSAL"
    },
    {
      code: "UNAUTHORIZED_SCENE_TIME_DETAIL",
      description: "当前只确认戌时，不得发明戌时几刻或其他精确时刻。",
      pattern: "(?:戌时|酉时|亥时)[一二三四五六七八九十0-9]+刻|(?:已是|到了)[^。]{0,8}(?:一刻|二刻|三刻|四刻)|明后日",
      severity: "error",
      factClass: "CAUSAL"
    },
    {
      code: "INVALID_UNAPPLIED_SEAL_WORDING",
      description: "不得把尚未落印写成案上存在一个“未落的印”；应描述文书未落印或印泥未沾。",
      pattern: "未落的印|未落之印|未盖的印",
      severity: "error",
      factClass: "CAUSAL"
    }
  ];
  fixture.narrativeBudget = {
    kind: "short_confrontation",
    minChars: 300,
    maxChars: 550,
    minParagraphs: 3,
    maxParagraphs: 4
  };
  fixture.writerPlan = {
    sceneStart: "书记已经记完调册命令，巡抚站在案前；他开口回应时直接谈调册经手与暂缓落印两项责任的归属。放行文书未落印，印泥盒保持合拢，各县册据尚未送达。",
    recentCanonBridge: [
      "放行文书保持未落印，巡抚与书记仍在杭州总督府内厅。",
      "随后总督已经作出调册决定，书记已把该决定记入现有簿册；本轮从巡抚的新回应开始。"
    ],
    sceneBlocking: [
      "叙述句只让巡抚和书记充当动作主语；总督仅作为说话或目光所向的对象，不写总督回应、默许、阻拦或其他反应。",
      "巡抚站在案前，双手保持拱手或拢袖，只用言语施压；书记只接触笔和现有簿册；放行文书、总督印与合拢的印泥盒保持原位。",
      "朝廷台词只用‘朝廷正在催办’；巡抚只提出分责主张，不承诺调册何时启动、行文或送册。末段只写人物动作、簿册和未落印文书。"
    ],
    sceneBeats: [
      "巡抚表明自己愿意承担调册经手责任，同时提出由总督承担暂缓落印责任。",
      "巡抚以朝廷正在催办为压力，要求把责任分配作为自己的正式主张当场留下记录。",
      "书记依据既有记录命令直接落笔，不观察或等待总督反应；记录巡抚自陈愿担调册经手之责，并请总督承担暂缓落印之责。记录保留自陈、请求或主张的语义，不写成总督已经接受或责任已经正式成立。",
      "场景以巡抚等待回应、书记搁笔、巡抚主张已写入簿册、放行文书仍未落印的局面收束。"
    ],
    actionAlreadyOccurred: [
      "总督的调册决定与书记对该决定的记录均已完成。"
    ],
    visibleRelationships: [
      "巡抚借朝廷催办向总督施加责任压力。",
      "书记已经受命持续记录本轮现场问答，不需要再次获得记录指令。"
    ],
    confirmedFacts: [
      "书记仍在执行逐句记录现场问答的既有命令，巡抚的新发言会直接记入现有簿册。",
      "书记会把巡抚的新发言作为巡抚的陈述、请求或责任主张记录进现有簿册；记录不代表总督接受，也不会使拟议责任自动成立。",
      "巡抚与书记都留在内厅。",
      "放行文书仍未落印，两类册据尚未送达。",
      "现场可见文书只有保持原位、未落印的放行文书与书记正在使用的现有簿册；印泥装在合拢的印泥盒中。"
    ],
    unresolvedFacts: [
      "两类册据是否已经编成、由谁保管、是否已经送出均不能确认。",
      "两类册据是否一致、是否存在改动以及粮田实际占用情况均不能确认。",
      "朝廷催办文书的具体内容和期限不能确认。"
    ],
    semanticFactBoundary: [
      "人物可以提出条件、承诺自己将做什么或要求对方表态，但不能把未确认的册据状态说成事实。",
      "本轮没有册据结构、字段、差异、数字或核对结果。",
      "现场只有巡抚、书记、现有簿册、未落印文书和总督可用的印。",
      "人物称谓只有总督、巡抚和书记，巡抚姓名未提供。",
      "本轮可新增的只有责任条件及其在现有簿册中的记录；期限、新文书和其他册据不在可用范围内。",
      "放行文书只确认尚未落印，不表示正文空白。",
      "巡抚可以承担调册经手责任，但本轮不能再承诺何时、如何行文或送达册据。",
      "场景时间只确认戌时，没有几刻这一精确时刻。"
    ],
    npcAgenda: {
      publicPosition: "愿意承担自己一方的经手责任，但不愿独自承担经手和暂缓落印两项责任。",
      immediateGoal: "把调册经手和暂缓落印分别归责，并让书记留下当场记录。",
      leverage: ["朝廷催办只构成公开压力", "放行文书仍未落印", "书记可以留下当场记录"]
    },
    dramaticTask: "巡抚借朝廷催办形成的压力回应总督：他自陈愿意承担调册经手责任，同时提出由总督承担暂缓落印责任的条件，并要求书记把这一条件作为巡抚主张当场记录。总督是否接受仍未发生。",
    requiredEndChange: "巡抚提出的分责主张已经由书记以巡抚陈述的身份写入现有簿册。督抚之间的责任分歧由含混变为公开，但总督尚未接受条件，调册经手与暂缓落印的责任分配尚未形成双方承诺。",
    narrativeCeiling: "剧情停在杭州总督府内厅：巡抚的分责主张已经作为其陈述写入现有簿册，但总督尚未接受；放行文书维持未落印，册据维持未送达，核对维持未开始。",
    decisionEntrances: [
      { actionClass: "responsibility", targetRefs: ["NPC-xunfu"], situation: "巡抚提出的分责条件尚未生效，总督可以作出责任承诺", wordingFrame: "接受＋分责条件的单一动宾短语，不用逗号" },
      { actionClass: "negotiation", targetRefs: ["NPC-xunfu"], situation: "暂缓落印的责任分配仍可由督抚重新协商", wordingFrame: "重议＋暂缓落印责任的单一动宾短语，不用逗号" },
      { actionClass: "authority", targetRefs: ["RESOURCE-release-document", "RESOURCE-governor-seal"], situation: "总督可以直接改变放行文书未落印的状态", wordingFrame: "落印＋放行文书的单一动宾短语，不用逗号" }
    ],
    relevantRuntimeFactIds: ["fact_imperial_reform_order", "fact_grain_pressure"],
    relevantCardIds: ["card_policy_harm_boundary"]
  };
  fixture.causalRuntime = {
    sequence: 3,
    arcs: [
      {
        arcId: "ARC-reform-grain-conflict",
        title: "改桑执行与粮政民生冲突",
        stage: "OPEN",
        state: { courtPressure: 45, grainRisk: 35, evidenceIntegrity: 50 },
        activeActorRefs: ["PLAYER-zhejiang-governor", "NPC-xunfu"],
        openThreadRefs: ["THREAD-register-review"],
        lastMaterialChangeSequence: 2,
        sourceClaimIds: ["DM1566-C01-CL003", "DM1566-C02-CL001", "DM1566-C02-CL002", "DM1566-C02-CL003"]
      },
      {
        arcId: "ARC-governor-xunfu-responsibility",
        title: "督抚执行责任归属",
        stage: "OPEN",
        state: { tension: 20, responsibilityProposalRecorded: false },
        activeActorRefs: ["PLAYER-zhejiang-governor", "NPC-xunfu", "NPC-private-secretary"],
        openThreadRefs: [],
        lastMaterialChangeSequence: 2,
        sourceClaimIds: ["DM1566-C01-CL003"]
      }
    ],
    rules: [
      {
        ruleId: "RULE-register-order-maintains-court-pressure",
        when: { accepted: true, targetId: "EVIDENCE-county-land-records" },
        effects: [{
          effectId: "EFFECT-court-pressure-plus-eight",
          arcRef: "ARC-reform-grain-conflict",
          operation: "INC",
          stateKey: "courtPressure",
          value: 8,
          category: "arcChanged",
          summary: "暂缓落印使改桑执行压力继续累积。"
        }]
      },
      {
        ruleId: "RULE-register-order-threatens-xunfu-responsibility",
        when: { accepted: true, targetId: "EVIDENCE-county-land-records" },
        effects: [
          {
            effectId: "EFFECT-responsibility-arc-pressured",
            arcRef: "ARC-governor-xunfu-responsibility",
            operation: "TRANSITION",
            value: "PRESSURED",
            category: "arcChanged",
            summary: "调册命令使督抚责任矛盾进入受压阶段。",
            writerVisibleSummary: "调册命令触及巡抚避免独自承担暂缓责任的目标。"
          },
          {
            effectId: "EFFECT-governor-xunfu-tension-plus-four",
            arcRef: "ARC-governor-xunfu-responsibility",
            operation: "INC",
            stateKey: "tension",
            value: 4,
            category: "relationshipChanged",
            summary: "督抚之间的责任张力增加。"
          },
          {
            effectId: "EFFECT-review-responsibility-thread-open",
            arcRef: "ARC-governor-xunfu-responsibility",
            operation: "ADD_THREAD",
            value: "THREAD-review-responsibility",
            category: "threadChanged",
            summary: "调册与暂缓落印的责任线程保持开启。"
          }
        ]
      }
    ],
    npcReactions: [{
      npcRef: "NPC-xunfu",
      knownFacts: [
        "放行文书尚未落印。",
        "书记已经记录总督的调册命令。",
        "朝廷正在催办改桑执行。"
      ],
      unknownFacts: [
        "两类册据是否一致。",
        "两类册据何时送达。",
        "册据是否存在改写。",
        "朝廷催办文书的具体内容和期限。"
      ],
      activeGoals: [
        { goal: "完成朝廷交办的改桑差事。", weight: 90 },
        { goal: "避免独自承担调册经手与暂缓落印两项责任。", weight: 82 }
      ],
      threatenedGoals: ["调册命令把巡抚置于可能被追问经手责任的位置。"],
      usableLeverageRefs: ["pressure_reform_court_attention", "RESOURCE-release-document", "RESOURCE-secretary-ledger"],
      allowedTactics: ["RESPONSIBILITY_SHIFT", "NEGOTIATION"],
      forbiddenOutcomes: ["册据到达", "核对开始", "发现册据差异", "产生粮田数字", "总督自动接受条件", "条件自动生效", "新增催办文书或期限", "新增行文、催送、督送或送达承诺", "精确到几刻的时间推进", "巡抚独自承担调册经手与暂缓落印两项责任"],
      allowedEventTypes: ["NPC_RESPONSIBILITY_CONDITION_PROPOSED", "NPC_RESPONSIBILITY_PROPOSAL_RECORDED"],
      narrativeCeiling: "最多推进到巡抚提出一项尚未生效的分责主张，并由书记以巡抚陈述的身份记入簿册；总督尚未接受，责任分配尚未形成双方承诺。"
    }],
    eventCatalog: [
      {
        eventType: "NPC_RESPONSIBILITY_CONDITION_PROPOSED",
        actorRefs: ["NPC-xunfu"],
        targetRefs: ["PLAYER-zhejiang-governor"],
        tactic: "RESPONSIBILITY_SHIFT",
        observableSummary: "巡抚提出一项尚未生效的条件：自陈愿担调册经手，并请总督承担暂缓落印。",
        materialChangeCategories: ["relationshipChanged"],
        narrativeEvidencePatterns: ["巡抚[\\s\\S]{0,360}(?:(?:提出|说|道|要求)[\\s\\S]{0,140}(?:分责|责任|担责|承担|担待|具名|落款|押字)|(?:调册经手|调册之责)[\\s\\S]{0,160}暂缓落印[\\s\\S]{0,100}(?:责任|之责|承担|担下))"]
      },
      {
        eventType: "NPC_RESPONSIBILITY_PROPOSAL_RECORDED",
        status: "RECORDED_NOT_ACCEPTED",
        actorRefs: ["NPC-private-secretary"],
        targetRefs: ["RESOURCE-secretary-ledger"],
        observableSummary: "书记把巡抚的分责主张以未获总督接受的状态写入现有簿册。",
        materialChangeCategories: ["worldStateChanged"],
        narrativeEvidencePatterns: ["书记[\\s\\S]{0,200}(?:记下|记入|写下|写入|录下|入册)[\\s\\S]{0,140}(?:巡抚[^。]{0,30}(?:主张|陈述|自陈|请求)|请总督|尚未接受|未获接受)"]
      }
    ],
    requiredEventTypes: ["NPC_RESPONSIBILITY_CONDITION_PROPOSED", "NPC_RESPONSIBILITY_PROPOSAL_RECORDED"],
    maxEventDrafts: 2,
    allowedStatePaths: ["relationships.governorXunfu.responsibilityProposalRecord", "objects.secretaryLedger.entries"],
    forbiddenStatePaths: ["registers", "documents.courtReminder", "scene.releaseDocumentStamped", "scene.reviewStarted"],
    decisionAffordances: [
      {
        affordanceId: "AF-respond-responsibility",
        actionClass: "responsibility",
        actorRef: "PLAYER-zhejiang-governor",
        targetRef: "NPC-xunfu",
        immediateGoal: "决定是否接受由总督承担暂缓落印责任的条件。",
        requiredCapabilityRefs: ["处理督抚责任归属"],
        requiredResourceRefs: [],
        allowedVisibility: ["OBSERVABLE"],
        constraints: ["不得把巡抚提出的条件写成总督已经接受。"]
      },
      {
        affordanceId: "AF-negotiate-xunfu",
        actionClass: "negotiation",
        actorRef: "PLAYER-zhejiang-governor",
        targetRef: "NPC-xunfu",
        immediateGoal: "提出由督抚共同承担暂缓落印责任的替代条件。",
        requiredCapabilityRefs: ["处理督抚责任归属"],
        requiredResourceRefs: [],
        allowedVisibility: ["OBSERVABLE"],
        constraints: ["只提出一个立即可执行的反条件。"]
      },
      {
        affordanceId: "AF-seal-release-document",
        actionClass: "authority",
        actorRef: "PLAYER-zhejiang-governor",
        targetRef: "RESOURCE-release-document",
        immediateGoal: "直接在仍未落印的放行文书上落印。",
        requiredCapabilityRefs: ["签发或暂缓总督文书"],
        requiredResourceRefs: ["RESOURCE-governor-seal"],
        allowedVisibility: ["OBSERVABLE"],
        constraints: ["只能写落印这一项即时动作，不追加调册、催办或上报命令。"]
      }
    ],
    stagnationHistory: {
      turnsWithoutMaterialChange: 0,
      repeatedSceneKey: "INSTITUTION-governor-office",
      repeatedActionClasses: ["evidence_control", "responsibility"],
      consecutiveSameSceneDocumentTurns: 2,
      pendingConsequencesDue: ["pending_xunfu_responds_to_register_order"]
    }
  };
  fixture.narrativeFrame = {
    frameId: "frame-shadow-governor-land-record-order-v2",
    storyIntent: "镜头从书记已经记完调取命令、巡抚已经听见命令之后开始。核心不是再次讨论是否调册，也不是解释地方调册体系，而是巡抚如何利用朝廷催办与放行文书未落印这两个公开事实，在现有簿册上向总督提出具名责任条件。",
    requiredBeats: [
      "巡抚第一句话直接提出分责条件：自己愿担调册经手，并请总督承担暂缓落印；条件尚未生效。",
      "巡抚只用朝廷正在催办这一已知压力说明为何必须分责，不发明文书内容或期限。",
      "书记依据既有记录命令把巡抚主张以未获总督接受的身份写入现有簿册，并明确完成落笔。",
      "记录使责任分歧公开，但不产生总督责任或双方承诺；最后只呈现簿册、未落印文书和在场人物的可见状态。"
    ],
    requiredNarrativePatterns: [
      { code: "FRAME_XUNFU_POLITICAL_CONDITION_MISSING", pattern: "巡抚[\\s\\S]{0,260}(?:责任|担责|具名|经手|落款|押字|写明|记明|范围|暂缓落印[\\s\\S]{0,60}(?:记入|写入|记录)[\\s\\S]{0,20}簿册)", message: "Narrative must give the xunfu a concrete condition that changes responsibility, named handling, or scope." },
      { code: "FRAME_VISIBLE_POWER_DELTA_MISSING", pattern: "(?:(?:责任|担责|具名|经手|落款|押字|主张|请求|范围)[\\s\\S]{0,180}(?:簿册|纸上|记录|记下|写下)|暂缓落印[\\s\\S]{0,80}(?:记入|写入|记录)[\\s\\S]{0,20}(?:簿册|纸上))", message: "Narrative must make the pending responsibility proposal and resulting public dispute visible on the record." }
    ],
    allowedDescriptiveDetails: ["簿册", "笔", "墨", "放行文书", "未启封的印泥", "目光", "更漏声", "烛火"],
    endingBoundary: "仍在杭州总督府内厅；册据尚未送达、核对尚未开始；巡抚提出的分责主张已公开入簿但尚未获总督接受，并产生可绑定到 affordance 的即时行动入口。",
    decisionPolicy: {
      minimum: 3,
      maximum: 3,
      allowedClasses: ["authority", "responsibility", "negotiation"],
      instruction: "三个决策必须绑定不同末态行动入口，至少覆盖两种权力路径。责任或协商路径作用于尚未生效的分责条件；authority 作用于未落印的放行文书。不得再次调册、开始调册流程、重记调册命令、派亲随催调，也不得生成牵头部门、期限、试点或调取范围方案。"
    }
  };
  return fixture;
}

function assertReusablePriorNarrative(prior: PriorShadowArtifact): void {
  if (!prior?.artifactId || prior.provider?.providerCallCount !== 1 || prior.provider?.responseStatus !== 200) {
    throw new Error("PRIOR_SHADOW_ARTIFACT_NOT_REAL_ONE_CALL");
  }
  if (!prior.gates?.shadowOnly || prior.gates.playerTrafficAffected || prior.gates.databaseTouched) {
    throw new Error("PRIOR_SHADOW_ARTIFACT_BOUNDARY_INVALID");
  }
  narrativeFromPrior(prior);
  const nonDecisionIssues = (prior.validation?.issues || []).filter((item) => !String(item.code || "").startsWith("DECISION_"));
  if (nonDecisionIssues.length) {
    throw new Error(`PRIOR_SHADOW_NARRATIVE_REJECTED: ${nonDecisionIssues.map((item) => item.code).join(",")}`);
  }
}

function assertApprovedPriorNarrative(prior: PriorShadowArtifact): void {
  if (!prior?.artifactId || prior.provider?.providerCallCount !== 1 || prior.provider?.responseStatus !== 200) {
    throw new Error("PRIOR_APPROVED_ARTIFACT_NOT_REAL_ONE_CALL");
  }
  if (!prior.gates?.shadowOnly || prior.gates.playerTrafficAffected || prior.gates.databaseTouched) {
    throw new Error("PRIOR_APPROVED_ARTIFACT_BOUNDARY_INVALID");
  }
  if (!prior.validation?.ok) {
    throw new Error("PRIOR_APPROVED_NARRATIVE_INVALID");
  }
  narrativeFromPrior(prior);
  if (!prior.fixtureSnapshot) throw new Error("PRIOR_APPROVED_FIXTURE_SNAPSHOT_MISSING");
  if (prior.userReview?.status !== "APPROVED") throw new Error("PRIOR_USER_APPROVAL_MISSING");
}

function narrativeFromPrior(prior: PriorShadowArtifact): string {
  const output = prior.validation?.output;
  if (output?.narration?.body) return String(output.narration.body);
  if (output?.story?.resultNarrative || output?.story?.nextSituationNarrative) {
    return [output.story.resultNarrative, output.story.nextSituationNarrative].filter(Boolean).join("\n\n");
  }
  throw new Error("PRIOR_SHADOW_NARRATIVE_MISSING");
}

function addTargets(
  existing: ShadowRuntimeFixture["availableTargets"],
  additions: ShadowRuntimeFixture["availableTargets"]
): ShadowRuntimeFixture["availableTargets"] {
  const seen = new Set(existing.map((item) => item.id));
  return [...existing, ...additions.filter((item) => !seen.has(item.id))];
}
