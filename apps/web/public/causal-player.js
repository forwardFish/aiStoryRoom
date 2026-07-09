(() => {
  const STORAGE_KEY = "ai-story-room-causal-player-v2";
  const root = document.getElementById("app");

  const ROLE_MODELS = {
    xunfu: {
      name: "浙江巡抚",
      publicGoal: "推进改桑，尽快见银",
      realGoal: "抢在总督前报功，借新政入京",
      fear: ["总督掌握暗账", "商会反咬", "县令公开证据"],
      bias: ["抢先进度", "越级报功", "被压制时反咬总督"],
      avatar: "抚"
    },
    county: {
      name: "清流县令",
      publicGoal: "依法执行国策，保护地方百姓",
      realGoal: "查清官商夺田，同时保护自己不被牺牲",
      fear: ["证据被压下", "公开太早被定为扰乱国策"],
      bias: ["递密信", "保留副本", "等待证据完整"],
      avatar: "县"
    },
    merchant: {
      name: "江南商会",
      publicGoal: "出银助国策，稳定商路",
      realGoal: "用垫银换保护，避免成为替罪羊",
      fear: ["被定为囤粮夺田", "被总督用完后切割"],
      bias: ["多边下注", "放粮换保护", "保留入府记录"],
      avatar: "商"
    },
    sili: {
      name: "司礼监",
      publicGoal: "确保丝源与银路进入内廷",
      realGoal: "绕开内阁，控制江南银路",
      fear: ["地方总督坐大", "内阁抢走财政叙事"],
      bias: ["关注银路", "利用奏报分裂", "不公开表态"],
      avatar: "监"
    }
  };

  const DAY_BLUEPRINTS = {
    1: {
      title: "改桑令下",
      location: "杭州总督府 · 清晨",
      opening: "京师急诏抵达浙江：江南择地改稻为桑，以丝换银，以银补国用。案头另一封海防军报写着：沿海军饷已拖两月。朝廷要银，地方要粮，军中要饷，浙江这一局不能只看桑田。",
      pressure: "巡抚呈上嘉兴、绍兴、湖州三县名册，请你准许立即督办。三地皆为熟田，若操切推进，粮价可能先动。",
      decision: {
        title: "是否准许巡抚立即推进",
        messageId: "day1_xunfu_request",
        options: [
          option("A", "准许先行推进", "让巡抚负责第一批名册。", "改桑进度上升", "巡抚坐大、粮价先动", { "改桑进度": 10, "内阁疑心": -5, "巡抚敌意": -2, "粮价": 5, "民心": -4 }, "advance_policy"),
          option("B", "要求先核田清册", "以核田安民为由要求三日后再报。", "民心暂缓，县令信任上升", "内阁疑你拖延，巡抚不满", { "民心": 4, "县令信任": 6, "改桑进度": -5, "内阁疑心": 5, "巡抚敌意": 5 }, "audit_land"),
          option("C", "表面同意，私下查田契", "不阻止巡抚，但命幕僚暗查三县田契来源。", "短期不冲突，暗账线启动", "若被发现，会被说成暗中掣肘", { "改桑进度": 5, "总督权威": 2, "暗账完整度": 8, "粮价": 3 }, "shadow_audit")
        ]
      }
    },
    2: {
      title: "地方催政",
      location: "杭州总督府 · 午后",
      opening: "巡抚府昨夜发出三道公文，要求嘉兴、绍兴、湖州限期上报名册。公文措辞极重：有迟误者，以误国论。杭州米价小涨，粮铺掌柜都说只是雨水误船，但消息传得太快。",
      pressure: "一封未署名密信送入总督府：本县尚未丈量，已有商号执契来问桑田价。百姓未卖田，田名似已在册。幕僚认出笔迹，是嘉兴一名清流县令。",
      decision: {
        title: "如何处理县令密信",
        messageId: "day2_county_letter",
        options: [
          option("A", "保护县令继续查账", "命县令继续查账，并承诺总督府暂保其身。", "暗账线推进，县令信任上升", "巡抚敌意增加，县令可能失控", { "县令信任": 10, "暗账完整度": 15, "巡抚敌意": 8, "清算风险": 4 }, "protect_county"),
          option("B", "要求县令停止私查", "只准县令报民情，不准继续查旧账。", "短期降低公开冲突", "暗账断裂，县令不再信任你", { "县令信任": -12, "暗账完整度": -5, "巡抚敌意": -2, "清算风险": 5 }, "suppress_county"),
          option("C", "密令查账，但证据先送府", "给有限保护，允许查账，但证据必须先入总督府。", "你掌握证据流向", "县令会怀疑你控制清弊", { "县令信任": 5, "暗账完整度": 10, "巡抚敌意": 3, "清算风险": 2 }, "control_evidence")
        ]
      }
    },
    3: {
      title: "粮价上涨",
      location: "杭州总督府 · 午后",
      opening: "杭州米价三日内上涨两成。粮铺外开始有人排队，百姓口中已经把改桑和没粮连在一起。巡抚府却传出消息：第一批改桑名册已整理完成，准备急奏京师。",
      pressure: "驿站快马离开杭州府。有人看见巡抚幕僚亲自护送急奏北上，奏中只写改桑已有成效，不提粮价和田契争议。若这封奏疏先到内阁，巡抚便是功臣；若之后民怨爆发，你就是压不住局的人。",
      decision: {
        title: "如何处理巡抚急奏",
        messageId: "day3_secret_memorial",
        options: [
          option("A", "截留奏疏", "派人追上驿站，暂扣巡抚奏疏。", "阻止巡抚抢功", "巡抚可反咬你压制国策", { "总督权威": 5, "巡抚敌意": 12, "内阁疑心": 8, "皇帝信任": -2 }, "block_memorial"),
          option("B", "追加密奏", "不阻止巡抚，但另写密奏给皇帝，说明浙江不可躁进。", "保留未来解释权", "内阁疑你越级自保", { "皇帝信任": 7, "皇帝疑心": 4, "内阁疑心": 6, "清算风险": -4, "司礼监警惕": 8 }, "secret_memorial"),
          option("C", "放任巡抚", "让他继续抢功，等待他与商会绑定更深。", "未来可一并清算", "巡抚短期声望上升", { "巡抚敌意": -4, "总督权威": -8, "改桑进度": 5, "清算风险": 5 }, "let_xunfu_run")
        ]
      }
    },
    4: {
      title: "暗账浮出",
      location: "杭州总督府 · 雨后",
      opening: "嘉兴县衙递来密匣，匣中两页田契副本显示：部分田亩尚未正式改桑，就已被商会提前标注为可收桑地。另一页露出巡抚府师爷的名字。",
      pressure: "这份暗账不完整。它足以威慑商会，足以逼巡抚收手，却不足以直接定案。幕僚问：这刀是现在亮出来，还是先藏着？",
      decision: {
        title: "如何使用暗账",
        messageId: "day4_evidence",
        options: [
          option("A", "密奏皇帝", "将暗账作为地方执行过激证据，直接入密奏。", "皇帝信任上升，巡抚风险增加", "内阁和司礼监都会盯上你", { "皇帝信任": 8, "巡抚敌意": 10, "司礼监警惕": 8, "内阁疑心": 6 }, "evidence_to_emperor"),
          option("B", "威胁商会放粮出银", "不公开暗账，只用它逼商会配合。", "商会依赖上升，粮价下降", "县令信任下降，官商风险增加", { "商会依赖": 12, "粮价": -6, "县令信任": -8, "清算风险": 8 }, "merchant_blackmail"),
          option("C", "交县令继续补证", "暂不动用，命县令查完整证据链。", "证据完整度上升，县令信任上升", "巡抚可能灭证，短期无法压局", { "暗账完整度": 15, "县令信任": 8, "巡抚敌意": 5, "清算风险": 2 }, "complete_evidence")
        ]
      }
    },
    5: {
      title: "互相弹劾",
      location: "杭州总督府 · 早朝后",
      opening: "京师传来消息：内阁已收到巡抚急奏。奏中称浙江改桑进度可喜，但地方推进受制于上司持重。几乎同时，司礼监织造使派人抵达杭州。",
      pressure: "内阁文书问：浙江改桑既有成效，为何迟迟不见银数？是地方不力，商民不从，还是督抚意见不一？幕僚说：内阁不是问进度，是问谁负责。",
      decision: {
        title: "如何回应内阁催问",
        messageId: "day5_cabinet",
        options: [
          option("A", "推给巡抚操切", "说明地方执行过急，导致粮价和民心压力。", "切割巡抚，降低清算风险", "内阁认为你督办无力", { "巡抚敌意": 12, "清算风险": -6, "内阁疑心": 6 }, "blame_xunfu"),
          option("B", "承认进度不足，请求缓行", "以稳局为由争取时间。", "民心风险下降", "内阁疑心增加", { "民心": 8, "粮价": -4, "内阁疑心": 10, "皇帝信任": 3 }, "slow_policy"),
          option("C", "报告商会可先垫银", "用商会银子缓解内阁压力。", "国库银上升，内阁压力下降", "商会坐大，县令信任下降", { "国库银两": 10, "商会依赖": 12, "县令信任": -8, "司礼监警惕": 6 }, "merchant_finance")
        ]
      }
    },
    6: {
      title: "京师回批",
      location: "杭州总督府 · 最后一夜",
      opening: "京师回批到了。皇帝没有直接裁决，只批了一句：银从何来，乱由谁止，欺朕者谁？这不是问话，是最后通牒。",
      pressure: "幕僚摊开四份草案：一份保巡抚，一份保县令，一份借商会，一份全推给地方执行。他问你：明日之前，您要让皇上看到哪个浙江？",
      decision: {
        title: "最终奏报方向",
        messageId: "day6_final_memorial",
        options: [
          option("A", "稳局奏报", "承认改桑可行，但请求缓行，并说明你已控制粮价和民心。", "小胜概率上升", "皇帝仍会疑你可用不可纵", { "皇帝信任": 8, "清算风险": -8, "皇帝疑心": 4 }, "stability_final"),
          option("B", "清弊奏报", "公开巡抚与商会暗账，把危机定义为地方执行腐败。", "可压倒巡抚和商会", "若证据不足会反噬", { "暗账完整度": 10, "巡抚敌意": 15, "清算风险": -4, "司礼监警惕": 6 }, "clean_corruption_final"),
          option("C", "财政奏报", "让商会先垫银，优先解决国库压力。", "国库银上升", "商人控局，内廷盯上银路", { "国库银两": 15, "商会依赖": 15, "司礼监警惕": 12, "县令信任": -10 }, "merchant_final")
        ]
      }
    }
  };

  let state = loadState() || createRun();
  render();

  function option(key, title, body, gain, risk, patch, actionType) {
    return { key, title, body, gain, risk, patch, actionType };
  }

  function createRun() {
    const day = 1;
    const blueprint = DAY_BLUEPRINTS[day];
    return {
      run: {
        id: `local_${Date.now().toString(36)}`,
        title: "桑田诏：嘉靖财政危局",
        location: blueprint.location,
        currentDay: day,
        currentTime: "清晨",
        totalDays: 7,
        status: "awaiting_decision",
        version: 1
      },
      player: {
        roleName: "浙江总督",
        name: "郝帅彬",
        rank: "从四品",
        office: "兵部侍郎衔",
        fateQuestion: "你是在保浙江，还是在保自己的官位？",
        goals: ["稳住浙江", "压住巡抚", "不让皇帝疑你欺瞒", "避免民乱和海防失控"],
        resources: [["调粮权", "可用"], ["密奏权", "可用"], ["幕僚", "4人"], ["粮银", "42万两"], ["海防军报", "1封"]],
        leverage: ["半页田契暗账传闻", "县令密信渠道", "巡抚越级上奏倾向", "商会粮银依赖"]
      },
      messages: buildDayMessages(day),
      activeDecision: blueprint.decision,
      dashboard: initialDashboard(),
      decisionHistory: [],
      causalLedger: initialLedger(),
      visibleCausalCard: null,
      causalRecallMessages: [],
      events: [event("run_created", { day })]
    };
  }

  function initialDashboard() {
    return {
      worldState: {
        "国库银两": 30,
        "民心": 60,
        "粮价": 45,
        "改桑进度": 20,
        "海防军心": 50,
        "皇帝信任": 45,
        "皇帝疑心": 55
      },
      roleState: {
        "总督权威": 60,
        "清算风险": 45,
        "内阁疑心": 35,
        "巡抚敌意": 30,
        "县令信任": 50,
        "商会依赖": 35,
        "司礼监警惕": 30,
        "暗账完整度": 10
      },
      relationships: [
        { key: "xunfu", name: "浙江巡抚", person: "刘瑾", score: 30, stance: "戒备", tone: "bad" },
        { key: "county", name: "清流县令", person: "卢象升", score: 50, stance: "试探", tone: "warn" },
        { key: "merchant", name: "江南商会", person: "沈会首", score: 35, stance: "观望", tone: "warn" },
        { key: "sili", name: "司礼监", person: "织造使", score: 30, stance: "警惕", tone: "bad" }
      ],
      latestChanges: [],
      risks: [["粮价失控", "中"], ["巡抚抢功", "高"], ["官商交易", "中"], ["司礼监介入", "中"]],
      traces: []
    };
  }

  function initialLedger() {
    return {
      fateSeeds: [],
      evidenceLedger: [],
      responsibilityLedger: [],
      narrativeFrames: [],
      roleDecisionModels: ROLE_MODELS,
      daySummaries: {},
      finalJudgementInputs: {}
    };
  }

  function buildDayMessages(day) {
    const blueprint = DAY_BLUEPRINTS[day];
    return [
      message("system", "系统叙事", blueprint.title, blueprint.opening, day, "开局"),
      message("decision_prompt", "待决策", blueprint.decision.title, blueprint.pressure, day, "压力", true)
    ];
  }

  function message(type, label, title, body, day, time = "", requiresDecision = false, extra = {}) {
    return { id: id("msg"), type, label, title, body, day, time, requiresDecision, ...extra };
  }

  function submitDecision() {
    if (!state.activeDecision) return;
    const selected = document.querySelector("input[name=decision]:checked")?.value || state.activeDecision.options[0].key;
    const custom = document.getElementById("customDecision")?.value.trim() || "";
    let option = state.activeDecision.options.find((item) => item.key === selected) || state.activeDecision.options[0];
    if (selected === "CUSTOM") {
      const guard = guardCustom(custom);
      if (guard) {
        renderGuard(guard);
        return;
      }
      option = customOption(custom);
    }

    const originEventId = `evt_day${state.run.currentDay}_${option.actionType || option.key}_${state.decisionHistory.length + 1}`;
    const interpretation = interpretDecision(option, originEventId);
    const visibleCard = buildVisibleCard(option, interpretation);
    const fateSeed = buildFateSeed(option, interpretation, visibleCard);
    const evidence = buildEvidenceItems(visibleCard, originEventId, option);
    const responsibility = buildResponsibilityNode(option, originEventId);
    const frame = buildNarrativeFrame(option, originEventId);
    const reaction = buildRoleReaction(option, interpretation);

    applyPatch(option.patch);
    state.visibleCausalCard = visibleCard;
    state.dashboard.traces = unique([...state.dashboard.traces, ...visibleCard.tracesLeft]);
    state.dashboard.latestChanges = Object.entries(option.patch || {}).map(([name, delta]) => [name, delta]);
    state.decisionHistory.push({ day: state.run.currentDay, title: option.title, optionKey: option.key, actionType: option.actionType, originEventId, patch: option.patch });
    state.causalLedger.fateSeeds.push(fateSeed);
    state.causalLedger.evidenceLedger.push(...evidence);
    state.causalLedger.responsibilityLedger.push(responsibility);
    state.causalLedger.narrativeFrames.push(frame);

    state.messages.push(message("decision_result", "你的决定", option.title, resultText(option), state.run.currentDay, "决策后"));
    state.messages.push(message("causal_visible", "因果回响", `你的选择留下了痕迹：${visibleCard.decisionTitle}`, visibleCard.playerFacingHint, state.run.currentDay, "因果落账", false, { causalCard: visibleCard }));
    state.messages.push(message("role_action", "角色反应", reaction.messageToPlayer.title, reaction.messageToPlayer.narrative, state.run.currentDay, "夜", false, { speaker: reaction.messageToPlayer.speaker, roleReaction: reaction }));
    state.events.push(event("decision_interpreted", interpretation));
    state.events.push(event("visible_causal_card_created", visibleCard));
    state.events.push(event("fate_seed_created", fateSeed));
    state.events.push(event("role_reaction", { roleKey: reaction.roleKey, privateReasoningSummary: reaction.privateReasoningSummary, sourceEventIds: reaction.sourceEventIds }));
    state.activeDecision = null;
    state.run.status = "decision_resolved";
    state.run.version += 1;
    saveState();
    render();
  }

  function guardCustom(text) {
    if (!text) return "请先写明你的具体行动。";
    if (/(杀|处死|命令皇帝|直接定罪|所有人立刻|跳过|直接结局)/.test(text)) return "该决策越过总督权力边界。你可以改为：调查、密奏、施压、交易、保护或留后手。";
    return "";
  }

  function customOption(text) {
    const patch = { "总督权威": 2, "清算风险": 2 };
    if (/密奏|皇帝|奏报/.test(text)) Object.assign(patch, { "皇帝信任": 5, "皇帝疑心": 3, "内阁疑心": 5, "司礼监警惕": 5 });
    if (/商会|粮|放粮|粮价/.test(text)) Object.assign(patch, { "粮价": -6, "商会依赖": 8, "民心": 4, "县令信任": -4 });
    if (/巡抚|急奏|截留/.test(text)) Object.assign(patch, { "巡抚敌意": 8, "总督权威": 4 });
    if (/县令|证据|暗账|田契/.test(text)) Object.assign(patch, { "暗账完整度": 8, "县令信任": 5, "清算风险": -2 });
    return option("CUSTOM", "自定义决策", text, "形成非标准计策", "成败取决于权力边界和因果账本", patch, inferActionType(text));
  }

  function inferActionType(text) {
    if (/密奏|皇帝|奏报/.test(text)) return "secret_memorial";
    if (/商会|粮|放粮|粮价/.test(text)) return "merchant_grain";
    if (/县令|证据|暗账|田契/.test(text)) return "evidence_control";
    if (/巡抚|截留/.test(text)) return "xunfu_pressure";
    return "custom_strategy";
  }

  function interpretDecision(option, originEventId) {
    return {
      originEventId,
      originDecisionId: originEventId.replace("evt_", "decision_"),
      actionType: option.actionType,
      surfaceAction: option.title,
      strategicIntent: option.gain,
      usedResources: inferResources(option),
      targetRoles: inferTargets(option),
      publicVisibility: option.actionType === "secret_memorial" ? "visible_to_emperor_hidden_to_local_roles" : "local_pressure_visible",
      evidenceCreated: inferEvidence(option),
      riskTags: [option.risk],
      benefitTags: [option.gain]
    };
  }

  function inferResources(option) {
    const text = `${option.title}${option.body}`;
    const resources = [];
    if (/密奏|皇帝/.test(text)) resources.push("密奏权", "幕僚起草");
    if (/商会|粮/.test(text)) resources.push("调粮权", "商会粮路");
    if (/证据|暗账|田契/.test(text)) resources.push("县令密信", "田契副本");
    if (!resources.length) resources.push("总督文移", "幕僚判断");
    return resources;
  }

  function inferTargets(option) {
    const text = `${option.title}${option.body}`;
    const targets = ["zhejiang_governor"];
    if (/巡抚|奏疏|急奏/.test(text)) targets.push("xunfu");
    if (/商会|粮/.test(text)) targets.push("merchant");
    if (/县令|证据|暗账|田契/.test(text)) targets.push("county");
    if (/密奏|皇帝|奏报/.test(text)) targets.push("emperor", "sili");
    return unique(targets);
  }

  function inferEvidence(option) {
    const text = `${option.title}${option.body}`;
    if (/密奏/.test(text)) return ["总督密奏", "通政司递送记录", "奏报口径不一"];
    if (/商会|粮/.test(text)) return ["商会入府记录", "放粮传话", "粮价变化账册"];
    if (/暗账|证据|田契/.test(text)) return ["田契副本", "县令密信", "胥吏名册"];
    return ["总督府文移", "幕僚记录"];
  }

  function buildVisibleCard(option, interpretation) {
    const text = `${option.title}${option.body}`;
    if (option.actionType === "secret_memorial") {
      return {
        originEventId: interpretation.originEventId,
        decisionTitle: option.title,
        decisionSummary: "你没有截留巡抚急奏，而是另写密奏给皇帝，说明浙江民心和粮价已有裂痕。",
        personalEcho: "你为自己留下了未来解释权，但也留下了越级自保的痕迹。",
        othersEcho: [{ roleKey: "xunfu", text: "巡抚会意识到你没有拦他，却在京师留了后手。" }, { roleKey: "sili", text: "司礼监会注意两份浙江奏报口径不一。" }],
        worldEcho: "京师将收到两份口径不同的奏报，浙江内部不一致开始被看见。",
        stateChangesText: patchText(option.patch),
        tracesLeft: ["总督密奏", "通政司递送记录", "奏报口径不一"],
        potentialRisks: ["内阁可能认为你越级自保。", "巡抚可能把你定性为拖延国策。"],
        playerFacingHint: "这一步能保留解释权，也会让浙江内部口径分裂被京师看见。"
      };
    }
    if (/商会|粮|放粮/.test(text)) {
      return {
        originEventId: interpretation.originEventId,
        decisionTitle: option.title,
        decisionSummary: "你用粮路或商会资源处理眼前危机。",
        personalEcho: "你短期稳住民心和粮价，但把自己和商会接触写进了未来账本。",
        othersEcho: [{ roleKey: "merchant", text: "商会会把这次接触当成护身符。" }, { roleKey: "county", text: "县令会怀疑你是在清弊，还是在控制清弊。" }],
        worldEcho: "粮价压力暂缓，但官商关系的缝隙被县衙和司礼监看见。",
        stateChangesText: patchText(option.patch),
        tracesLeft: ["商会入府记录", "放粮传话", "粮价变化账册"],
        potentialRisks: ["县令可能保留证据副本。", "商会被查时可能拿总督府传话自保。"],
        playerFacingHint: "你稳住了眼前粮价，也把商会变成未来可能反咬你的证人。"
      };
    }
    if (/暗账|证据|田契|县令/.test(text)) {
      return {
        originEventId: interpretation.originEventId,
        decisionTitle: option.title,
        decisionSummary: "你把暗账和县令线纳入总督府控制。",
        personalEcho: "你获得清弊路线，但也要承担证据被压下或被反咬的责任。",
        othersEcho: [{ roleKey: "county", text: "县令会继续合作，但会评估你是否真正清弊。" }, { roleKey: "xunfu", text: "巡抚会开始清理名册和旧账痕迹。" }],
        worldEcho: "改桑不再只是财政问题，开始变成官商夺田与责任归属问题。",
        stateChangesText: patchText(option.patch),
        tracesLeft: ["田契副本", "县令密信", "胥吏名册"],
        potentialRisks: ["证据不完整时公开，可能被反咬伪造。", "县令可能保留完整副本。"],
        playerFacingHint: "你拿到一把刀，但刀也可能割伤自己。"
      };
    }
    return {
      originEventId: interpretation.originEventId,
      decisionTitle: option.title,
      decisionSummary: `你选择「${option.title}」：${option.body}`,
      personalEcho: "你改变了自己的解释空间，也改变了未来承担责任的方式。",
      othersEcho: [{ roleKey: "xunfu", text: "其他角色会根据自己的利益重新判断你的动作。" }],
      worldEcho: "浙江局势继续向御前裁决收束，奏报、粮价、暗账和银路互相牵连。",
      stateChangesText: patchText(option.patch),
      tracesLeft: interpretation.evidenceCreated,
      potentialRisks: ["这一步可能被不同角色重新定性。"],
      playerFacingHint: "这不是单次选择，而是未来因果账本的一笔。"
    };
  }

  function buildFateSeed(option, interpretation, visibleCard) {
    return {
      id: `seed_${interpretation.originEventId}`,
      originEventId: interpretation.originEventId,
      originDay: state.run.currentDay,
      title: visibleCard.decisionTitle,
      visibleHint: visibleCard.playerFacingHint,
      hiddenMeaning: visibleCard.potentialRisks.join("；"),
      helpTriggers: ["后续风险坐实时，可作为你早有预警或留有后手的依据。"],
      backfireTriggers: visibleCard.potentialRisks,
      status: "dormant",
      relatedEvidence: visibleCard.tracesLeft,
      relatedRoles: interpretation.targetRoles
    };
  }

  function buildEvidenceItems(visibleCard, originEventId, option) {
    return visibleCard.tracesLeft.map((trace, index) => ({
      id: `evidence_${originEventId}_${index + 1}`,
      title: trace,
      truthLevel: "true",
      completeness: /半页|副本|残页/.test(trace) ? 45 : 65,
      holderRoles: trace.includes("商会") ? ["merchant"] : ["zhejiang_governor"],
      knownByRoles: knownByForTrace(trace, option),
      canBackfireOn: ["zhejiang_governor"],
      originEventId
    }));
  }

  function knownByForTrace(trace, option) {
    if (trace.includes("密奏")) return ["zhejiang_governor", "emperor", "sili"];
    if (trace.includes("商会")) return ["zhejiang_governor", "merchant", "county"];
    if (trace.includes("田契") || trace.includes("县令")) return ["zhejiang_governor", "county"];
    return ["zhejiang_governor"];
  }

  function buildResponsibilityNode(option, originEventId) {
    return {
      id: `resp_${originEventId}`,
      issue: option.title,
      possibleResponsibleRoles: [
        { roleKey: "zhejiang_governor", liability: 45, reason: "总督统筹浙江军政，所有动作都会被纳入最终责任。" },
        { roleKey: "xunfu", liability: option.actionType?.includes("xunfu") ? 70 : 55, reason: "巡抚急奏与三县名册是当前压力源。" },
        { roleKey: "merchant", liability: /商会|粮/.test(`${option.title}${option.body}`) ? 70 : 35, reason: "商会粮银和田契线可能被追责。" }
      ],
      currentDominantFrame: "暂未形成统一定性",
      canBeReframedBy: {
        zhejiang_governor: "稳局、留后手、避免民变",
        xunfu: "总督持重拖延国策",
        merchant: "商会只是替朝廷分忧",
        county: "官商交易正在侵蚀民田"
      },
      originEventId
    };
  }

  function buildNarrativeFrame(option, originEventId) {
    return {
      eventId: originEventId,
      eventTitle: option.title,
      frames: [
        { roleKey: "zhejiang_governor", frame: "稳局、留后手、保解释权", visibility: "private" },
        { roleKey: "xunfu", frame: option.actionType === "secret_memorial" ? "总督另立口径，疑似拖延" : "总督正在抢夺局势解释权", visibility: "private" },
        { roleKey: "county", frame: /商会|粮/.test(`${option.title}${option.body}`) ? "总督府与商会接触过深" : "总督可能仍有清弊空间", visibility: "private" },
        { roleKey: "sili", frame: "浙江口径有缝，银路有机会被内廷接管", visibility: "hidden" }
      ],
      dominantFrame: "暂未形成统一定性"
    };
  }

  function buildRoleReaction(option, interpretation) {
    const actionText = `${option.title}${option.body}`;
    if (option.actionType === "secret_memorial") {
      return roleReaction("xunfu", ["总督追加密奏", "巡抚急奏已北上"], ["总督是否已有完整暗账"], ["自己从功臣变成责任人"], ["抢先定义浙江局势"], "巡抚判断，如果自己不先把改桑有成效送到京师，等暗账浮出后就只剩解释。他不能停，必须先定义局势。", "私下联络内阁财政派，暗示总督府持重过度。", "朝廷催银甚急，浙江不可迟疑。", "把总督谨慎改写成拖延。", "浙江巡抚", "巡抚开始反定性", "巡抚府听说总督府另有密奏入京，幕僚连夜准备给内阁的私信，信中反复写着四个字：持重误国。", interpretation.originEventId);
    }
    if (/商会|粮/.test(actionText)) {
      return roleReaction("merchant", ["总督动用商会粮路", "粮价高企"], ["总督是否会正式给保护"], ["日后成为囤粮夺田替罪羊"], ["用放粮换保护"], "商会判断，总督需要粮，也需要可控的商路。既然官府用了商会，商会就要留下将来自保的口径。", "开仓一部分平价粮，同时保留传话记录。", "商会愿为朝廷分忧。", "证明商会不是逐利，而是被总督府用于稳局。", "江南商会", "商会留下护身符", "商会放出部分平价粮，但账房特意记下总督府传话的原句。", interpretation.originEventId);
    }
    return roleReaction("county", ["总督处理暗账", "巡抚与商会线浮出"], ["总督是否会压案"], ["证据被上级控制后自己被牺牲"], ["保护百姓并保住自己"], "县令判断，总督能用，但未必完全可信。证据可以给一部分，完整副本必须另存。", "保留副本，只交部分证据。", "证据尚不完整，需继续核实。", "防止总督府压案或与商会交易后切割县令。", "清流县令", "县令保留副本", "县令继续递来田契线索，却没有把完整账册一并送来。师爷低声说：总督府能用，但不能全信。", interpretation.originEventId);
  }

  function roleReaction(roleKey, knownFacts, unknownFacts, currentFear, currentDesire, privateReasoningSummary, chosenAction, surfaceReason, hiddenIntent, speaker, title, narrative, originEventId) {
    return { roleKey, knownFacts, unknownFacts, currentFear, currentDesire, privateReasoningSummary, chosenAction, surfaceReason, hiddenIntent, messageToPlayer: { speaker, title, narrative }, sourceEventIds: [originEventId] };
  }

  function resultText(option) {
    if (option.actionType === "secret_memorial") return "你没有截留巡抚奏疏，而是让幕僚连夜起草密奏。奏中不直接指责巡抚，只写浙江可改，然不可躁进。";
    if (/商会|粮/.test(`${option.title}${option.body}`)) return "你让幕僚与商会接触，用粮路暂压民怨。总督府没有留下正式保护文书，但这句话已经足够让商会记住。";
    if (/暗账|证据|田契/.test(`${option.title}${option.body}`)) return "你把暗账线纳入总督府控制。它现在还不是定案铁证，却已经足以改变巡抚、商会和县令的判断。";
    return `你决定执行「${option.title}」。这一步被幕僚写入局势账册。`;
  }

  function applyPatch(patch = {}) {
    for (const [key, delta] of Object.entries(patch)) {
      if (key in state.dashboard.worldState) state.dashboard.worldState[key] = clamp(state.dashboard.worldState[key] + delta);
      if (key in state.dashboard.roleState) state.dashboard.roleState[key] = clamp(state.dashboard.roleState[key] + delta);
    }
    updateRelationships(patch);
  }

  function updateRelationships(patch = {}) {
    const map = { "巡抚敌意": "xunfu", "县令信任": "county", "商会依赖": "merchant", "司礼监警惕": "sili" };
    for (const [metric, roleKey] of Object.entries(map)) {
      if (!(metric in patch)) continue;
      const rel = state.dashboard.relationships.find((item) => item.key === roleKey);
      if (!rel) continue;
      rel.score = clamp(rel.score + Number(patch[metric]));
      rel.stance = relationStance(metric, rel.score);
      rel.tone = rel.score >= 65 || metric.includes("敌意") || metric.includes("警惕") ? "bad" : rel.score <= 35 ? "warn" : "good";
    }
  }

  function relationStance(metric, score) {
    if (metric.includes("敌意")) return score >= 65 ? "敌对" : score >= 45 ? "戒备" : "观望";
    if (metric.includes("警惕")) return score >= 65 ? "盯防" : score >= 45 ? "警惕" : "观望";
    if (metric.includes("信任")) return score >= 65 ? "信任" : score >= 45 ? "试探" : "不信";
    if (metric.includes("依赖")) return score >= 65 ? "靠拢" : score >= 45 ? "试探" : "观望";
    return "观望";
  }

  function advanceDay() {
    if (state.run.status === "finished") return;
    if (state.run.currentDay >= 6) return finalizeRun();
    summarizeDay();
    state.run.currentDay += 1;
    state.run.currentTime = "清晨";
    state.run.location = DAY_BLUEPRINTS[state.run.currentDay].location;
    state.run.status = "awaiting_decision";
    state.messages.push(...buildDayMessages(state.run.currentDay));
    state.activeDecision = DAY_BLUEPRINTS[state.run.currentDay].decision;
    triggerCausalRecall();
    state.run.version += 1;
    saveState();
    render();
  }

  function summarizeDay() {
    const day = state.run.currentDay;
    const decisions = state.decisionHistory.filter((item) => item.day === day);
    state.causalLedger.daySummaries[day] = {
      day,
      publicSummary: `${DAY_BLUEPRINTS[day].title}：${decisions.map((item) => item.title).join("、") || "局势推进"}`,
      playerKeyDecisions: decisions.map((item) => ({ eventId: item.originEventId, summary: item.title })),
      activeFateSeeds: state.causalLedger.fateSeeds.filter((seed) => seed.status === "dormant").map((seed) => seed.id),
      riskForTomorrow: (state.visibleCausalCard?.potentialRisks || []).slice(0, 3)
    };
  }

  function triggerCausalRecall() {
    const seed = state.causalLedger.fateSeeds.find((item) => item.status === "dormant" && Number(item.originDay) < state.run.currentDay);
    if (!seed) return;
    seed.status = state.run.currentDay >= 4 ? "activated_backfire" : "activated_help";
    const recall = {
      title: `因果回响：${seed.title}被重新定性`,
      originEventIds: [seed.originEventId],
      recallText: `这件事并非凭空而来。第 ${seed.originDay} 天，你留下「${seed.title}」。当时它的收益是：${seed.visibleHint}`,
      reframedBy: seed.relatedRoles.includes("xunfu") ? "浙江巡抚" : seed.relatedRoles.includes("merchant") ? "江南商会" : "清流县令",
      newFrame: seed.hiddenMeaning,
      currentPressure: seed.status === "activated_backfire" ? "它现在开始成为对手重新定性的材料。" : "它现在为你提供了新的解释权。"
    };
    state.causalRecallMessages.push(recall);
    state.causalLedger.causalRecallMessages ||= [];
    state.causalLedger.causalRecallMessages.push(recall);
    state.messages.push(message("causal_recall", "因果回溯", recall.title, `${recall.recallText}\n但现在，它被${recall.reframedBy}重新定性为：${recall.newFrame}\n因此，新的压力出现：${recall.currentPressure}`, state.run.currentDay, "因果回响"));
    state.events.push(event("causal_recall", recall));
  }

  function finalizeRun() {
    summarizeDay();
    const trust = state.dashboard.worldState["皇帝信任"];
    const price = state.dashboard.worldState["粮价"];
    const risk = state.dashboard.roleState["清算风险"];
    const evidence = state.dashboard.roleState["暗账完整度"];
    const good = trust >= 55 && price <= 70 && risk <= 55;
    const clean = evidence >= 55 && state.dashboard.roleState["县令信任"] >= 50;
    const merchant = state.dashboard.roleState["商会依赖"] >= 65 && state.dashboard.worldState["国库银两"] >= 45;
    const title = clean ? "国策缓行，清弊得名" : merchant ? "商人救国，商人控局" : good ? "总督稳局，帝心生疑" : "无人胜利，替罪羊诞生";
    const saved = state.decisionHistory.slice(0, 3).map((item) => `第 ${item.day} 天「${item.title}」`);
    const hurt = state.causalLedger.fateSeeds.filter((seed) => seed.status === "activated_backfire").map((seed) => `第 ${seed.originDay} 天「${seed.title}」`);
    state.causalLedger.finalJudgementInputs = { saved, hurt, worldState: state.dashboard.worldState, roleState: state.dashboard.roleState };
    state.run.currentDay = 7;
    state.run.currentTime = "御前";
    state.run.location = "京师 · 御前";
    state.run.status = "finished";
    state.activeDecision = null;
    state.messages.push(message("final", "最终裁决", title, `皇帝看完各路奏报，只问：浙江到底是谁在办事，谁在误事？\n\n救你的几步：${saved.join("；") || "暂无"}\n害你的几步：${hurt.join("；") || "暂无明显反噬，但疑心仍在账本中。"}\n命运债：你利用了县令的清名，也借用了商会的粮路；这些都不会凭空消失。`, 7, "御前"));
    state.events.push(event("final_judgement", state.causalLedger.finalJudgementInputs));
    saveState();
    render();
  }

  function resetRun() {
    localStorage.removeItem(STORAGE_KEY);
    state = createRun();
    saveState();
    render();
  }

  function render() {
    root.className = "causal-player-root";
    root.innerHTML = `
      <div class="causal-shell">
        ${renderTopbar()}
        <aside class="causal-left">
          ${renderPlayer()}
          ${renderLedgerMini()}
          ${renderResources()}
          ${renderLeverage()}
        </aside>
        <main class="causal-center">
          ${renderStream()}
          ${renderDecisionPanel()}
        </main>
        <aside class="causal-right">
          ${renderWorld()}
          ${renderVisibleCausalCard()}
          ${renderCausalRecall()}
          ${renderTraces()}
          ${renderRelations()}
          ${renderRoleModels()}
        </aside>
      </div>
    `;
    bindEvents();
    const stream = document.getElementById("messageStream");
    if (stream) stream.scrollTop = stream.scrollHeight;
  }

  function renderTopbar() {
    const remain = Math.max(0, state.run.totalDays - state.run.currentDay);
    return `<header class="causal-topbar"><div><b>${state.run.title}</b><span>${state.run.location}</span></div><div>第 ${state.run.currentDay} 天 · ${state.run.currentTime}</div><div>距离御前裁决 <b>${remain}</b> 天</div><button id="resetBtn">重开</button></header>`;
  }

  function renderPlayer() {
    return `<section class="causal-panel player"><h2>我的身份</h2><div class="portrait">督</div><h3>${state.player.roleName}</h3><p>${state.player.name} · ${state.player.rank}</p><em>${state.player.fateQuestion}</em><ul>${state.player.goals.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></section>`;
  }

  function renderLedgerMini() {
    const ledger = state.causalLedger;
    return `<section class="causal-panel ledger-mini"><h2>因果账本</h2><div class="ledger-grid"><span>伏笔<b>${ledger.fateSeeds.length}</b></span><span>证据<b>${ledger.evidenceLedger.length}</b></span><span>责任<b>${ledger.responsibilityLedger.length}</b></span><span>定性<b>${ledger.narrativeFrames.length}</b></span></div></section>`;
  }

  function renderResources() {
    return `<section class="causal-panel"><h2>我的资源</h2>${state.player.resources.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</section>`;
  }

  function renderLeverage() {
    return `<section class="causal-panel"><h2>我的筹码</h2><ul>${state.player.leverage.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></section>`;
  }

  function renderStream() {
    return `<section class="stream-panel"><div class="stream-head"><h1>局势消息流</h1><p>别人做的事，会被转译成你面前的剧情压力。</p></div><div class="causal-stream" id="messageStream">${state.messages.map(renderMessage).join("")}</div></section>`;
  }

  function renderMessage(message) {
    const card = message.causalCard ? renderMiniCausalCard(message.causalCard) : `<p>${esc(message.body).replace(/\n/g, "<br/>")}</p>`;
    return `<article class="story-card ${message.type}"><div class="meta"><b>${esc(message.label)}</b>${message.speaker ? `<span>${esc(message.speaker)}</span>` : ""}<span>第${message.day}天 ${esc(message.time)}</span></div><h3>${esc(message.title)}</h3>${card}</article>`;
  }

  function renderMiniCausalCard(card) {
    return `<div class="mini-causal"><p>${esc(card.decisionSummary)}</p><dl><dt>个人回响</dt><dd>${esc(card.personalEcho)}</dd><dt>他人回响</dt><dd>${card.othersEcho.map((x) => esc(x.text)).join("；")}</dd><dt>世界回响</dt><dd>${esc(card.worldEcho)}</dd><dt>留下痕迹</dt><dd>${card.tracesLeft.map(esc).join("、")}</dd></dl></div>`;
  }

  function renderDecisionPanel() {
    if (state.run.status === "finished") return `<section class="decision-zone complete"><h2>御前裁决已定</h2><button id="resetDecisionBtn">重开一局</button></section>`;
    if (!state.activeDecision) return `<section class="decision-zone complete"><h2>今日关键决策已落账</h2><p>你的选择已经写入因果账本。继续推进，后续会出现帮助或反噬。</p><button id="advanceBtn">进入下一天</button><button id="finalizeBtn">直接裁决</button></section>`;
    return `<section class="decision-zone"><h2>你要如何应对？</h2><p>${esc(state.activeDecision.title)}</p><div class="options">${state.activeDecision.options.map((item, index) => `<label class="option-card"><input type="radio" name="decision" value="${item.key}" ${index === 0 ? "checked" : ""}/><b>${item.key}. ${esc(item.title)}</b><span>${esc(item.body)}</span><small>收益：${esc(item.gain)} ｜ 风险：${esc(item.risk)}</small></label>`).join("")}<label class="option-card custom"><input type="radio" name="decision" value="CUSTOM"/><b>D. 自定义决策</b><span>自行拟定策略，ActionGuard 会校验权力边界。</span></label></div><textarea id="customDecision" placeholder="例如：不拦巡抚急奏，但另写密奏，并让县令整理粮价证据。"></textarea><div class="actions"><span id="guardText"></span><button id="submitDecision">确认此策</button></div></section>`;
  }

  function renderWorld() {
    const entries = Object.entries(state.dashboard.worldState);
    return `<section class="causal-panel"><h2>世界状态</h2>${entries.map(([name, value]) => `<div class="bar-row"><div><span>${esc(name)}</span><b>${value}/100</b></div><em><i style="width:${value}%"></i></em></div>`).join("")}</section>`;
  }

  function renderVisibleCausalCard() {
    const card = state.visibleCausalCard;
    if (!card) return `<section class="causal-panel emphasis"><h2>因果回响</h2><p>提交关键决策后，这里会显示：你改变了谁、留下了什么痕迹、未来可能被谁重新定性。</p></section>`;
    return `<section class="causal-panel emphasis"><h2>因果回响</h2><h3>${esc(card.decisionTitle)}</h3><p>${esc(card.decisionSummary)}</p><dl><dt>个人回响</dt><dd>${esc(card.personalEcho)}</dd><dt>他人回响</dt><dd>${card.othersEcho.map((x) => esc(x.text)).join("；")}</dd><dt>世界回响</dt><dd>${esc(card.worldEcho)}</dd><dt>状态变化</dt><dd>${card.stateChangesText.map(esc).join("；")}</dd><dt>潜在风险</dt><dd>${card.potentialRisks.map(esc).join("；")}</dd></dl></section>`;
  }

  function renderCausalRecall() {
    if (!state.causalRecallMessages.length) return "";
    return `<section class="causal-panel recall"><h2>因果回溯</h2>${state.causalRecallMessages.slice(-2).map((item) => `<article><b>${esc(item.title)}</b><p>${esc(item.recallText)}</p><p>新压力：${esc(item.currentPressure)}</p></article>`).join("")}</section>`;
  }

  function renderTraces() {
    const traces = state.dashboard.traces || [];
    return `<section class="causal-panel"><h2>留下的痕迹</h2>${traces.length ? `<ul>${traces.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : `<p>还没有形成可追溯痕迹。</p>`}</section>`;
  }

  function renderRelations() {
    return `<section class="causal-panel"><h2>人物关系</h2>${state.dashboard.relationships.map((item) => `<div class="rel"><b>${esc(item.name)}</b><span>${esc(item.stance)} ${item.score}</span></div>`).join("")}</section>`;
  }

  function renderRoleModels() {
    return `<section class="causal-panel"><h2>角色真实动机</h2>${Object.values(ROLE_MODELS).map((item) => `<details><summary>${esc(item.name)}</summary><p>公开目标：${esc(item.publicGoal)}</p><p>真实目标：${esc(item.realGoal)}</p><p>恐惧：${item.fear.map(esc).join("、")}</p><p>决策偏好：${item.bias.map(esc).join("、")}</p></details>`).join("")}</section>`;
  }

  function bindEvents() {
    document.getElementById("submitDecision")?.addEventListener("click", submitDecision);
    document.getElementById("advanceBtn")?.addEventListener("click", advanceDay);
    document.getElementById("finalizeBtn")?.addEventListener("click", finalizeRun);
    document.getElementById("resetBtn")?.addEventListener("click", resetRun);
    document.getElementById("resetDecisionBtn")?.addEventListener("click", resetRun);
  }

  function renderGuard(text) {
    const guard = document.getElementById("guardText");
    if (guard) guard.textContent = `ActionGuard：${text}`;
  }

  function patchText(patch = {}) {
    return Object.entries(patch).map(([key, value]) => `${key} ${Number(value) >= 0 ? "+" : ""}${value}`);
  }

  function clamp(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  }

  function unique(items) {
    return Array.from(new Set(items.filter(Boolean)));
  }

  function id(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
  }

  function event(type, payload = {}) {
    return { id: id("event"), type, payload, createdAt: new Date().toISOString() };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
      return null;
    }
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
