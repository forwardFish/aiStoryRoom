(() => {
  const STORAGE_KEY = "ai-story-room-causal-player-v3";
  const DEBUG = new URLSearchParams(window.location.search).get("debug") === "1";
  const root = document.getElementById("app");

  const ROLE_MODELS = {
    xunfu: {
      name: "浙江巡抚",
      publicGoal: "推进改桑，尽快见银",
      observable: ["总是抢在总督府前送文书", "只报进度，不主动报风险", "被压制时会把谨慎说成拖延"],
      hidden: { realGoal: "抢在总督前报功，借新政入京", fear: ["总督掌握暗账", "商会反咬", "县令公开证据"], bias: ["抢先进度", "越级报功", "被压制时反咬总督"] }
    },
    county: {
      name: "清流县令",
      publicGoal: "依法执行国策，保护地方百姓",
      observable: ["密信多于公开上书", "交证据时会留余地", "看到官商接触后信任会下降"],
      hidden: { realGoal: "查清官商夺田，同时保护自己不被牺牲", fear: ["证据被压下", "公开太早被定为扰乱国策"], bias: ["递密信", "保留副本", "等待证据完整"] }
    },
    merchant: {
      name: "江南商会",
      publicGoal: "出银助国策，稳定商路",
      observable: ["只给模糊承诺", "放粮前先要保护信号", "会同时接触多方"],
      hidden: { realGoal: "用垫银换保护，避免成为替罪羊", fear: ["被定为囤粮夺田", "被总督用完后切割"], bias: ["多边下注", "放粮换保护", "保留入府记录"] }
    },
    sili: {
      name: "司礼监",
      publicGoal: "确保丝源与银路进入内廷",
      observable: ["盯奏报口径差异", "盯商会银路", "不急于公开下场"],
      hidden: { realGoal: "绕开内阁，控制江南银路", fear: ["地方总督坐大", "内阁抢走财政叙事"], bias: ["关注银路", "利用奏报分裂", "不公开表态"] }
    }
  };

  const DAYS = {
    1: day("改桑令下", "杭州总督府 · 清晨", "京师急诏抵达浙江：江南择地改稻为桑，以丝换银，以银补国用。案头另一封海防军报写着沿海军饷已拖两月。朝廷要银，地方要粮，军中要饷，浙江这一局不能只看桑田。", "巡抚呈上嘉兴、绍兴、湖州三县名册，请你准许立即督办。三地皆为熟田，若操切推进，粮价可能先动。", "是否准许巡抚立即推进", [
      opt("A", "准许先行推进", "让巡抚负责第一批名册。", "改桑进度上升", "巡抚坐大、粮价先动", { "改桑进度": 10, "内阁疑心": -5, "巡抚敌意": -2, "粮价": 5, "民心": -4 }, "advance_policy"),
      opt("B", "要求先核田清册", "以核田安民为由要求三日后再报。", "民心暂缓，县令信任上升", "内阁疑你拖延，巡抚不满", { "民心": 4, "县令信任": 6, "改桑进度": -5, "内阁疑心": 5, "巡抚敌意": 5 }, "audit_land"),
      opt("C", "表面同意，私下查田契", "不阻止巡抚，但命幕僚暗查三县田契来源。", "短期不冲突，暗账线启动", "若被发现，会被说成暗中掣肘", { "改桑进度": 5, "总督权威": 2, "暗账完整度": 8, "粮价": 3 }, "shadow_audit")
    ]),
    2: day("地方催政", "杭州总督府 · 午后", "巡抚府昨夜发出三道公文，要求嘉兴、绍兴、湖州限期上报名册。公文措辞极重：有迟误者，以误国论。杭州米价小涨，粮铺掌柜都说只是雨水误船，但消息传得太快。", "一封未署名密信送入总督府：本县尚未丈量，已有商号执契来问桑田价。百姓未卖田，田名似已在册。幕僚认出笔迹，是嘉兴一名清流县令。", "如何处理县令密信", [
      opt("A", "保护县令继续查账", "命县令继续查账，并承诺总督府暂保其身。", "暗账线推进，县令信任上升", "巡抚敌意增加，县令可能失控", { "县令信任": 10, "暗账完整度": 15, "巡抚敌意": 8, "清算风险": 4 }, "protect_county"),
      opt("B", "要求县令停止私查", "只准县令报民情，不准继续查旧账。", "短期降低公开冲突", "暗账断裂，县令不再信任你", { "县令信任": -12, "暗账完整度": -5, "巡抚敌意": -2, "清算风险": 5 }, "suppress_county"),
      opt("C", "密令查账，但证据先送府", "给有限保护，允许查账，但证据必须先入总督府。", "你掌握证据流向", "县令会怀疑你控制清弊", { "县令信任": 5, "暗账完整度": 10, "巡抚敌意": 3, "清算风险": 2 }, "control_evidence")
    ]),
    3: day("粮价上涨", "杭州总督府 · 午后", "杭州米价三日内上涨两成。粮铺外开始有人排队，百姓口中已经把改桑和没粮连在一起。巡抚府却传出消息：第一批改桑名册已整理完成，准备急奏京师。", "驿站快马离开杭州府。有人看见巡抚幕僚亲自护送急奏北上，奏中只写改桑已有成效，不提粮价和田契争议。若这封奏疏先到内阁，巡抚便是功臣；若之后民怨爆发，你就是压不住局的人。", "如何处理巡抚急奏", [
      opt("A", "截留奏疏", "派人追上驿站，暂扣巡抚奏疏。", "阻止巡抚抢功", "巡抚可反咬你压制国策", { "总督权威": 5, "巡抚敌意": 12, "内阁疑心": 8, "皇帝信任": -2 }, "block_memorial"),
      opt("B", "追加密奏", "不阻止巡抚，但另写密奏给皇帝，说明浙江不可躁进。", "保留未来解释权", "内阁疑你越级自保", { "皇帝信任": 7, "皇帝疑心": 4, "内阁疑心": 6, "清算风险": -4, "司礼监警惕": 8 }, "secret_memorial"),
      opt("C", "放任巡抚", "让他继续抢功，等待他与商会绑定更深。", "未来可一并清算", "巡抚短期声望上升", { "巡抚敌意": -4, "总督权威": -8, "改桑进度": 5, "清算风险": 5 }, "let_xunfu_run")
    ]),
    4: day("暗账浮出", "杭州总督府 · 雨后", "嘉兴县衙递来密匣，匣中两页田契副本显示：部分田亩尚未正式改桑，就已被商会提前标注为可收桑地。另一页露出巡抚府师爷的名字。", "这份暗账不完整。它足以威慑商会，足以逼巡抚收手，却不足以直接定案。幕僚问：这刀是现在亮出来，还是先藏着？", "如何使用暗账", [
      opt("A", "密奏皇帝", "将暗账作为地方执行过激证据，直接入密奏。", "皇帝信任上升，巡抚风险增加", "内阁和司礼监都会盯上你", { "皇帝信任": 8, "巡抚敌意": 10, "司礼监警惕": 8, "内阁疑心": 6 }, "evidence_to_emperor"),
      opt("B", "威胁商会放粮出银", "不公开暗账，只用它逼商会配合。", "商会依赖上升，粮价下降", "县令信任下降，官商风险增加", { "商会依赖": 12, "粮价": -6, "县令信任": -8, "清算风险": 8 }, "merchant_blackmail"),
      opt("C", "交县令继续补证", "暂不动用，命县令查完整证据链。", "证据完整度上升，县令信任上升", "巡抚可能灭证，短期无法压局", { "暗账完整度": 15, "县令信任": 8, "巡抚敌意": 5, "清算风险": 2 }, "complete_evidence")
    ]),
    5: day("互相弹劾", "杭州总督府 · 早朝后", "京师传来消息：内阁已收到巡抚急奏。奏中称浙江改桑进度可喜，但地方推进受制于上司持重。几乎同时，司礼监织造使派人抵达杭州。", "内阁文书问：浙江改桑既有成效，为何迟迟不见银数？是地方不力，商民不从，还是督抚意见不一？幕僚说：内阁不是问进度，是问谁负责。", "如何回应内阁催问", [
      opt("A", "推给巡抚操切", "说明地方执行过急，导致粮价和民心压力。", "切割巡抚，降低清算风险", "内阁认为你督办无力", { "巡抚敌意": 12, "清算风险": -6, "内阁疑心": 6 }, "blame_xunfu"),
      opt("B", "承认进度不足，请求缓行", "以稳局为由争取时间。", "民心风险下降", "内阁疑心增加", { "民心": 8, "粮价": -4, "内阁疑心": 10, "皇帝信任": 3 }, "slow_policy"),
      opt("C", "报告商会可先垫银", "用商会银子缓解内阁压力。", "国库银上升，内阁压力下降", "商会坐大，县令信任下降", { "国库银两": 10, "商会依赖": 12, "县令信任": -8, "司礼监警惕": 6 }, "merchant_finance")
    ]),
    6: day("京师回批", "杭州总督府 · 最后一夜", "京师回批到了。皇帝没有直接裁决，只批了一句：银从何来，乱由谁止，欺朕者谁？这不是问话，是最后通牒。", "幕僚摊开四份草案：一份保巡抚，一份保县令，一份借商会，一份全推给地方执行。他问你：明日之前，您要让皇上看到哪个浙江？", "最终奏报方向", [
      opt("A", "稳局奏报", "承认改桑可行，但请求缓行，并说明你已控制粮价和民心。", "小胜概率上升", "皇帝仍会疑你可用不可纵", { "皇帝信任": 8, "清算风险": -8, "皇帝疑心": 4 }, "stability_final"),
      opt("B", "清弊奏报", "公开巡抚与商会暗账，把危机定义为地方执行腐败。", "可压倒巡抚和商会", "若证据不足会反噬", { "暗账完整度": 10, "巡抚敌意": 15, "清算风险": -4, "司礼监警惕": 6 }, "clean_corruption_final"),
      opt("C", "财政奏报", "让商会先垫银，优先解决国库压力。", "国库银上升", "商人控局，内廷盯上银路", { "国库银两": 15, "商会依赖": 15, "司礼监警惕": 12, "县令信任": -10 }, "merchant_final")
    ])
  };

  let state = loadState() || createRun();
  render();

  function day(title, location, opening, pressure, decisionTitle, options) {
    return { title, location, opening, pressure, decision: { title: decisionTitle, messageId: `day_${title}`, options } };
  }

  function opt(key, title, body, gain, risk, patch, actionType) {
    return { key, title, body, gain, risk, patch, actionType };
  }

  function createRun() {
    const currentDay = 1;
    return {
      run: { id: `local_${Date.now().toString(36)}`, title: "桑田诏：嘉靖财政危局", currentDay, currentTime: "清晨", totalDays: 7, location: DAYS[currentDay].location, status: "awaiting_decision", version: 1 },
      player: { roleName: "浙江总督", name: "郝帅彬", rank: "从四品", office: "兵部侍郎衔", fateQuestion: "你是在保浙江，还是在保自己的官位？", goals: ["稳住浙江", "压住巡抚", "不让皇帝疑你欺瞒", "避免民乱和海防失控"], resources: [["调粮权", "可用"], ["密奏权", "可用"], ["幕僚", "4人"], ["粮银", "42万两"], ["海防军报", "1封"]], leverage: ["半页田契暗账传闻", "县令密信渠道", "巡抚越级上奏倾向", "商会粮银依赖"] },
      messages: dayMessages(currentDay),
      activeDecision: DAYS[currentDay].decision,
      dashboard: initialDashboard(),
      visibleCausalCard: null,
      causalRecallMessages: [],
      decisionHistory: [],
      causalLedger: { fateSeeds: [], evidenceLedger: [], responsibilityLedger: [], narrativeFrames: [], roleDecisionModels: ROLE_MODELS, daySummaries: {}, finalJudgementInputs: {} },
      events: [event("run_created", { day: currentDay })]
    };
  }

  function initialDashboard() {
    return {
      worldState: { "国库银两": 30, "民心": 60, "粮价": 45, "改桑进度": 20, "海防军心": 50, "皇帝信任": 45, "皇帝疑心": 55 },
      roleState: { "总督权威": 60, "清算风险": 45, "内阁疑心": 35, "巡抚敌意": 30, "县令信任": 50, "商会依赖": 35, "司礼监警惕": 30, "暗账完整度": 10 },
      relationships: [{ key: "xunfu", name: "浙江巡抚", person: "刘瑾", score: 30, stance: "戒备", tone: "bad" }, { key: "county", name: "清流县令", person: "卢象升", score: 50, stance: "试探", tone: "warn" }, { key: "merchant", name: "江南商会", person: "沈会首", score: 35, stance: "观望", tone: "warn" }, { key: "sili", name: "司礼监", person: "织造使", score: 30, stance: "警惕", tone: "bad" }],
      latestChanges: [], risks: [["粮价失控", "中"], ["巡抚抢功", "高"], ["官商交易", "中"], ["司礼监介入", "中"]], traces: []
    };
  }

  function dayMessages(dayNumber) {
    const d = DAYS[dayNumber];
    return [msg("system", "系统叙事", d.title, d.opening, dayNumber, "开局"), msg("decision_prompt", "待决策", d.decision.title, d.pressure, dayNumber, "压力", true)];
  }

  function submitDecision() {
    if (!state.activeDecision) return;
    const selected = document.querySelector("input[name=decision]:checked")?.value || state.activeDecision.options[0].key;
    const custom = document.getElementById("customDecision")?.value.trim() || "";
    let selectedOption = state.activeDecision.options.find((item) => item.key === selected) || state.activeDecision.options[0];
    if (selected === "CUSTOM") {
      const guard = guardCustom(custom);
      if (guard) return renderGuard(guard);
      selectedOption = customOption(custom);
    }

    const originEventId = `evt_day${state.run.currentDay}_${selectedOption.actionType}_${state.decisionHistory.length + 1}`;
    const interpretation = interpret(selectedOption, originEventId);
    const visible = visibleCard(selectedOption, interpretation);
    const seeds = fateSeeds(selectedOption, interpretation, visible);
    const role = roleReaction(selectedOption, interpretation);

    applyPatch(selectedOption.patch);
    state.visibleCausalCard = visible;
    state.dashboard.traces = unique([...state.dashboard.traces, ...visible.tracesLeft]);
    state.dashboard.latestChanges = Object.entries(selectedOption.patch || {}).map(([name, delta]) => [name, delta]);
    state.decisionHistory.push({ day: state.run.currentDay, title: selectedOption.title, actionType: selectedOption.actionType, originEventId, patch: selectedOption.patch });
    state.causalLedger.fateSeeds.push(...seeds);
    state.causalLedger.evidenceLedger.push(...evidenceItems(visible, originEventId));
    state.causalLedger.responsibilityLedger.push(responsibilityNode(selectedOption, originEventId));
    state.causalLedger.narrativeFrames.push(narrativeFrame(selectedOption, originEventId));

    state.messages.push(msg("decision_result", "你的决定", selectedOption.title, resultText(selectedOption), state.run.currentDay, "决策后"));
    state.messages.push(msg("causal_visible", "因果回响", `你的选择留下了痕迹：${visible.decisionTitle}`, visible.playerFacingHint, state.run.currentDay, "因果落账", false, { causalCard: visible }));
    state.messages.push(msg("role_action", "角色反应", role.messageToPlayer.title, role.messageToPlayer.narrative, state.run.currentDay, "夜", false, { speaker: role.messageToPlayer.speaker, roleReaction: role }));
    state.events.push(event("decision_interpreted", interpretation));
    state.events.push(event("visible_causal_card_created", visible));
    seeds.forEach((seed) => state.events.push(event("fate_seed_created", seed)));
    state.events.push(event("role_reaction", { roleKey: role.roleKey, privateReasoningSummary: role.privateReasoningSummary, sourceEventIds: role.sourceEventIds }));

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
    return opt("CUSTOM", "自定义决策", text, "形成非标准计策", "成败取决于权力边界和因果账本", patch, inferType(text));
  }

  function inferType(text) { if (/密奏|皇帝|奏报/.test(text)) return "secret_memorial"; if (/商会|粮|放粮|粮价/.test(text)) return "merchant_grain"; if (/县令|证据|暗账|田契/.test(text)) return "evidence_control"; if (/巡抚|截留/.test(text)) return "xunfu_pressure"; return "custom_strategy"; }

  function interpret(o, originEventId) { return { originEventId, originDecisionId: originEventId.replace("evt_", "decision_"), actionType: o.actionType, surfaceAction: o.title, strategicIntent: o.gain, usedResources: resources(o), targetRoles: targets(o), publicVisibility: o.actionType === "secret_memorial" ? "visible_to_emperor_hidden_to_local_roles" : "local_pressure_visible", evidenceCreated: evidenceNames(o), riskTags: [o.risk], benefitTags: [o.gain] }; }

  function visibleCard(o, i) {
    const text = `${o.title}${o.body}`;
    if (o.actionType === "secret_memorial") return card(i, o.title, "你没有截留巡抚急奏，而是另写密奏给皇帝，说明浙江民心和粮价已有裂痕。", "你为自己留下了未来解释权，但也留下了越级自保的痕迹。", [{ roleKey: "xunfu", text: "巡抚会意识到你没有拦他，却在京师留了后手。" }, { roleKey: "sili", text: "司礼监会注意两份浙江奏报口径不一。" }], "京师将收到两份口径不同的奏报，浙江内部不一致开始被看见。", ["总督密奏", "通政司递送记录", "奏报口径不一"], ["内阁可能认为你越级自保。", "巡抚可能把你定性为拖延国策。"], "这一步能保留解释权，也会让浙江内部口径分裂被京师看见。", o.patch);
    if (/商会|粮|放粮/.test(text)) return card(i, o.title, "你用粮路或商会资源处理眼前危机。", "你短期稳住民心和粮价，但把自己和商会接触写进了未来账本。", [{ roleKey: "merchant", text: "商会会把这次接触当成护身符。" }, { roleKey: "county", text: "县令会怀疑你是在清弊，还是在控制清弊。" }], "粮价压力暂缓，但官商关系的缝隙被县衙和司礼监看见。", ["商会入府记录", "放粮传话", "粮价变化账册"], ["县令可能保留证据副本。", "商会被查时可能拿总督府传话自保。"], "你稳住了眼前粮价，也把商会变成未来可能反咬你的证人。", o.patch);
    if (/暗账|证据|田契|县令/.test(text)) return card(i, o.title, "你把暗账和县令线纳入总督府控制。", "你获得清弊路线，但也要承担证据被压下或被反咬的责任。", [{ roleKey: "county", text: "县令会继续合作，但会评估你是否真正清弊。" }, { roleKey: "xunfu", text: "巡抚会开始清理名册和旧账痕迹。" }], "改桑不再只是财政问题，开始变成官商夺田与责任归属问题。", ["田契副本", "县令密信", "胥吏名册"], ["证据不完整时公开，可能被反咬伪造。", "县令可能保留完整副本。"], "你拿到一把刀，但刀也可能割伤自己。", o.patch);
    return card(i, o.title, `你选择「${o.title}」：${o.body}`, "你改变了自己的解释空间，也改变了未来承担责任的方式。", [{ roleKey: "xunfu", text: "其他角色会根据自己的利益重新判断你的动作。" }], "浙江局势继续向御前裁决收束，奏报、粮价、暗账和银路互相牵连。", i.evidenceCreated, ["这一步可能被不同角色重新定性。"], "这不是单次选择，而是未来因果账本的一笔。", o.patch);
  }

  function card(i, decisionTitle, decisionSummary, personalEcho, othersEcho, worldEcho, tracesLeft, potentialRisks, playerFacingHint, patch) { return { originEventId: i.originEventId, decisionTitle, decisionSummary, personalEcho, othersEcho, worldEcho, stateChangesText: patchText(patch), tracesLeft, potentialRisks, playerFacingHint }; }

  function fateSeeds(o, i, c) { return [{ id: `seed_help_${i.originEventId}`, title: `${c.decisionTitle}的帮助`, status: "dormant", triggerKind: "help", triggerDay: Math.min(6, state.run.currentDay + 2), visibleHint: c.playerFacingHint, hiddenMeaning: "可成为玩家预警、控局或留后手的证据。", originEventId: i.originEventId, originDay: state.run.currentDay, relatedEvidence: c.tracesLeft, relatedRoles: i.targetRoles }, { id: `seed_backfire_${i.originEventId}`, title: `${c.decisionTitle}的反噬`, status: "dormant", triggerKind: "backfire", triggerDay: Math.min(6, state.run.currentDay + 3), visibleHint: c.playerFacingHint, hiddenMeaning: c.potentialRisks.join("；"), originEventId: i.originEventId, originDay: state.run.currentDay, relatedEvidence: c.tracesLeft, relatedRoles: i.targetRoles }]; }

  function evidenceItems(c, originEventId) { return c.tracesLeft.map((trace, index) => ({ id: `evidence_${originEventId}_${index + 1}`, title: trace, truthLevel: "true", completeness: /半页|副本|残页/.test(trace) ? 45 : 65, holderRoles: trace.includes("商会") ? ["merchant"] : ["zhejiang_governor"], knownByRoles: knownByTrace(trace), canBackfireOn: ["zhejiang_governor"], originEventId })); }
  function knownByTrace(trace) { if (trace.includes("密奏")) return ["zhejiang_governor", "emperor", "sili"]; if (trace.includes("商会")) return ["zhejiang_governor", "merchant", "county"]; if (trace.includes("田契") || trace.includes("县令")) return ["zhejiang_governor", "county"]; return ["zhejiang_governor"]; }
  function responsibilityNode(o, originEventId) { return { id: `resp_${originEventId}`, issue: o.title, possibleResponsibleRoles: [{ roleKey: "zhejiang_governor", liability: 45, reason: "总督统筹浙江军政，所有动作都会被纳入最终责任。" }, { roleKey: "xunfu", liability: o.actionType.includes("xunfu") ? 70 : 55, reason: "巡抚急奏与三县名册是当前压力源。" }, { roleKey: "merchant", liability: /商会|粮/.test(`${o.title}${o.body}`) ? 70 : 35, reason: "商会粮银和田契线可能被追责。" }], currentDominantFrame: "暂未形成统一定性", originEventId }; }
  function narrativeFrame(o, originEventId) { return { eventId: originEventId, eventTitle: o.title, frames: [{ roleKey: "zhejiang_governor", frame: "稳局、留后手、保解释权", visibility: "private" }, { roleKey: "xunfu", frame: o.actionType === "secret_memorial" ? "总督另立口径，疑似拖延" : "总督正在抢夺局势解释权", visibility: "private" }, { roleKey: "county", frame: /商会|粮/.test(`${o.title}${o.body}`) ? "总督府与商会接触过深" : "总督可能仍有清弊空间", visibility: "private" }, { roleKey: "sili", frame: "浙江口径有缝，银路有机会被内廷接管", visibility: "hidden" }], dominantFrame: "暂未形成统一定性" }; }

  function roleReaction(o, i) { const text = `${o.title}${o.body}`; if (o.actionType === "secret_memorial") return reaction("xunfu", "巡抚判断，如果自己不先把改桑有成效送到京师，等暗账浮出后就只剩解释。他不能停，必须先定义局势。", "浙江巡抚", "巡抚开始反定性", "巡抚府听说总督府另有密奏入京，幕僚连夜准备给内阁的私信，信中反复写着四个字：持重误国。", i.originEventId); if (/商会|粮/.test(text)) return reaction("merchant", "商会判断，总督需要粮，也需要可控的商路。既然官府用了商会，商会就要留下将来自保的口径。", "江南商会", "商会留下护身符", "商会放出部分平价粮，但账房特意记下总督府传话的原句。", i.originEventId); return reaction("county", "县令判断，总督能用，但未必完全可信。证据可以给一部分，完整副本必须另存。", "清流县令", "县令保留副本", "县令继续递来田契线索，却没有把完整账册一并送来。师爷低声说：总督府能用，但不能全信。", i.originEventId); }
  function reaction(roleKey, privateReasoningSummary, speaker, title, narrative, originEventId) { return { roleKey, privateReasoningSummary, chosenAction: title, surfaceReason: "公开说法仍以奉诏、稳局、查账为名。", hiddenIntent: "保护自身利益，并争夺局势定性权。", messageToPlayer: { speaker, title, narrative }, sourceEventIds: [originEventId] }; }

  function resultText(o) { if (o.actionType === "secret_memorial") return "你没有截留巡抚奏疏，而是让幕僚连夜起草密奏。奏中不直接指责巡抚，只写浙江可改，然不可躁进。"; if (/商会|粮/.test(`${o.title}${o.body}`)) return "你让幕僚与商会接触，用粮路暂压民怨。总督府没有留下正式保护文书，但这句话已经足够让商会记住。"; if (/暗账|证据|田契/.test(`${o.title}${o.body}`)) return "你把暗账线纳入总督府控制。它现在还不是定案铁证，却已经足以改变巡抚、商会和县令的判断。"; return `你决定执行「${o.title}」。这一步被幕僚写入局势账册。`; }

  function advanceDay() { if (state.run.status === "finished") return; if (state.run.currentDay >= 6) return finalizeRun(); summarizeDay(); state.run.currentDay += 1; state.run.currentTime = "清晨"; state.run.location = DAYS[state.run.currentDay].location; state.run.status = "awaiting_decision"; state.messages.push(...dayMessages(state.run.currentDay)); state.activeDecision = DAYS[state.run.currentDay].decision; triggerDueSeeds(); state.run.version += 1; saveState(); render(); }
  function triggerDueSeeds() { state.causalLedger.fateSeeds.filter((s) => s.status === "dormant" && s.triggerDay <= state.run.currentDay).forEach((seed) => { seed.status = seed.triggerKind === "help" ? "activated_help" : "activated_backfire"; const recall = { title: seed.triggerKind === "help" ? `因果回响：${seed.title}兑现` : `因果回响：${seed.title}被重新定性`, originEventIds: [seed.originEventId], recallText: `这件事并非凭空而来。第 ${seed.originDay} 天，你留下「${seed.title.replace(/的帮助|的反噬/g, "")}」。当时它的意义是：${seed.visibleHint}`, reframedBy: seed.triggerKind === "help" ? "局势本身" : actorForSeed(seed), newFrame: seed.hiddenMeaning, currentPressure: seed.triggerKind === "help" ? "它现在成为你的解释权和后手。" : "它现在开始成为对手重新定性的材料。" }; state.causalRecallMessages.push(recall); state.messages.push(msg("causal_recall", "因果回溯", recall.title, `${recall.recallText}\n现在，它被${recall.reframedBy}重新解释为：${recall.newFrame}\n结果：${recall.currentPressure}`, state.run.currentDay, "因果回响")); state.events.push(event(seed.status, recall)); }); }
  function actorForSeed(seed) { if (seed.relatedRoles.includes("xunfu")) return "浙江巡抚"; if (seed.relatedRoles.includes("merchant")) return "江南商会"; if (seed.relatedRoles.includes("county")) return "清流县令"; return "司礼监"; }
  function summarizeDay() { const dayNo = state.run.currentDay; const decisions = state.decisionHistory.filter((x) => x.day === dayNo); state.causalLedger.daySummaries[dayNo] = { day: dayNo, publicSummary: `${DAYS[dayNo].title}：${decisions.map((x) => x.title).join("、") || "局势推进"}`, playerKeyDecisions: decisions.map((x) => ({ eventId: x.originEventId, summary: x.title })), activeFateSeeds: state.causalLedger.fateSeeds.filter((s) => s.status === "dormant").map((s) => s.id), riskForTomorrow: (state.visibleCausalCard?.potentialRisks || []).slice(0, 3) }; }
  function finalizeRun() { summarizeDay(); const trust = state.dashboard.worldState["皇帝信任"]; const price = state.dashboard.worldState["粮价"]; const risk = state.dashboard.roleState["清算风险"]; const evidence = state.dashboard.roleState["暗账完整度"]; const good = trust >= 55 && price <= 70 && risk <= 55; const clean = evidence >= 55 && state.dashboard.roleState["县令信任"] >= 50; const merchant = state.dashboard.roleState["商会依赖"] >= 65 && state.dashboard.worldState["国库银两"] >= 45; const title = clean ? "国策缓行，清弊得名" : merchant ? "商人救国，商人控局" : good ? "总督稳局，帝心生疑" : "无人胜利，替罪羊诞生"; const saved = state.causalLedger.fateSeeds.filter((s) => s.status === "activated_help").map((s) => `第 ${s.originDay} 天「${s.title.replace("的帮助", "")}」`); const hurt = state.causalLedger.fateSeeds.filter((s) => s.status === "activated_backfire").map((s) => `第 ${s.originDay} 天「${s.title.replace("的反噬", "")}」`); state.causalLedger.finalJudgementInputs = { saved, hurt, worldState: state.dashboard.worldState, roleState: state.dashboard.roleState }; state.run.currentDay = 7; state.run.currentTime = "御前"; state.run.location = "京师 · 御前"; state.run.status = "finished"; state.activeDecision = null; state.messages.push(msg("final", "最终裁决", title, `皇帝看完各路奏报，只问：浙江到底是谁在办事，谁在误事？\n\n救你的几步：${saved.join("；") || "暂无"}\n害你的几步：${hurt.join("；") || "暂无明显反噬，但疑心仍在账本中。"}\n命运债：你利用了县令的清名，也借用了商会的粮路；这些都不会凭空消失。`, 7, "御前")); state.events.push(event("final_judgement", state.causalLedger.finalJudgementInputs)); saveState(); render(); }

  function render() { root.className = "causal-player-root"; root.innerHTML = `<div class="causal-shell">${topbar()}<aside class="causal-left">${playerPanel()}${ledgerMini()}${resources()}${leverage()}</aside><main class="causal-center">${stream()}${decisionPanel()}</main><aside class="causal-right">${world()}${visibleCausal()}${recalls()}${traces()}${relations()}${roleInferences()}${DEBUG ? debugPanel() : ""}</aside></div>`; bindEvents(); const el = document.getElementById("messageStream"); if (el) el.scrollTop = el.scrollHeight; }
  function topbar() { const remain = Math.max(0, state.run.totalDays - state.run.currentDay); return `<header class="causal-topbar"><div><b>${esc(state.run.title)}</b><span>${esc(state.run.location)}</span></div><div>第 ${state.run.currentDay} 天 · ${esc(state.run.currentTime)}</div><div>距离御前裁决 <b>${remain}</b> 天</div><button id="resetBtn">重开</button></header>`; }
  function playerPanel() { return `<section class="causal-panel player"><h2>我的身份</h2><div class="portrait">督</div><h3>${esc(state.player.roleName)}</h3><p>${esc(state.player.name)} · ${esc(state.player.rank)}</p><em>${esc(state.player.fateQuestion)}</em><ul>${state.player.goals.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>`; }
  function ledgerMini() { const l = state.causalLedger; return `<section class="causal-panel ledger-mini"><h2>后台因果账本</h2><div class="ledger-grid"><span>伏笔<b>${l.fateSeeds.length}</b></span><span>证据<b>${l.evidenceLedger.length}</b></span><span>责任<b>${l.responsibilityLedger.length}</b></span><span>定性<b>${l.narrativeFrames.length}</b></span></div><p>玩家只看见模糊痕迹，完整触发条件留在后台。</p></section>`; }
  function resources() { return `<section class="causal-panel"><h2>我的资源</h2>${state.player.resources.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</section>`; }
  function leverage() { return `<section class="causal-panel"><h2>我的筹码</h2><ul>${state.player.leverage.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>`; }
  function stream() { return `<section class="stream-panel"><div class="stream-head"><h1>局势消息流</h1><p>别人做的事，会被转译成你面前的剧情压力。</p></div><div class="causal-stream" id="messageStream">${state.messages.map(renderMessage).join("")}</div></section>`; }
  function renderMessage(m) { return `<article class="story-card ${m.type}"><div class="meta"><b>${esc(m.label)}</b>${m.speaker ? `<span>${esc(m.speaker)}</span>` : ""}<span>第${m.day}天 ${esc(m.time)}</span></div><h3>${esc(m.title)}</h3>${m.causalCard ? miniCausal(m.causalCard) : `<p>${esc(m.body).replace(/\n/g, "<br/>")}</p>`}</article>`; }
  function miniCausal(c) { return `<div class="mini-causal"><p>${esc(c.decisionSummary)}</p><dl><dt>个人回响</dt><dd>${esc(c.personalEcho)}</dd><dt>他人回响</dt><dd>${c.othersEcho.map((x) => esc(x.text)).join("；")}</dd><dt>世界回响</dt><dd>${esc(c.worldEcho)}</dd><dt>留下痕迹</dt><dd>${c.tracesLeft.map(esc).join("、")}</dd></dl></div>`; }
  function decisionPanel() { if (state.run.status === "finished") return `<section class="decision-zone complete"><h2>御前裁决已定</h2><button id="resetDecisionBtn">重开一局</button></section>`; if (!state.activeDecision) return `<section class="decision-zone complete"><h2>今日关键决策已落账</h2><p>你的选择已经写入因果账本。继续推进，后续会出现帮助或反噬。</p><button id="advanceBtn">进入下一天</button><button id="finalizeBtn">直接裁决</button></section>`; return `<section class="decision-zone"><h2>你要如何应对？</h2><p>${esc(state.activeDecision.title)}</p><div class="options">${state.activeDecision.options.map((x, i) => `<label class="option-card"><input type="radio" name="decision" value="${x.key}" ${i === 0 ? "checked" : ""}/><b>${x.key}. ${esc(x.title)}</b><span>${esc(x.body)}</span><small>收益：${esc(x.gain)} ｜ 风险：${esc(x.risk)}</small></label>`).join("")}<label class="option-card custom"><input type="radio" name="decision" value="CUSTOM"/><b>D. 自定义决策</b><span>自行拟定策略，ActionGuard 会校验权力边界。</span></label></div><textarea id="customDecision" placeholder="例如：不拦巡抚急奏，但另写密奏，并让县令整理粮价证据。"></textarea><div class="actions"><span id="guardText"></span><button id="submitDecision">确认此策</button></div></section>`; }
  function world() { return `<section class="causal-panel"><h2>世界状态</h2>${Object.entries(state.dashboard.worldState).map(([k, v]) => `<div class="bar-row"><div><span>${esc(k)}</span><b>${v}/100</b></div><em><i style="width:${v}%"></i></em></div>`).join("")}</section>`; }
  function visibleCausal() { const c = state.visibleCausalCard; if (!c) return `<section class="causal-panel emphasis"><h2>因果回响</h2><p>提交关键决策后，这里会显示：你改变了谁、留下了什么痕迹、未来可能被谁重新定性。</p></section>`; return `<section class="causal-panel emphasis"><h2>因果回响</h2><h3>${esc(c.decisionTitle)}</h3><p>${esc(c.decisionSummary)}</p><dl><dt>个人回响</dt><dd>${esc(c.personalEcho)}</dd><dt>他人回响</dt><dd>${c.othersEcho.map((x) => esc(x.text)).join("；")}</dd><dt>世界回响</dt><dd>${esc(c.worldEcho)}</dd><dt>状态变化</dt><dd>${c.stateChangesText.map(esc).join("；")}</dd><dt>潜在风险</dt><dd>${c.potentialRisks.map(esc).join("；")}</dd></dl></section>`; }
  function recalls() { return state.causalRecallMessages.length ? `<section class="causal-panel recall"><h2>因果回溯</h2>${state.causalRecallMessages.slice(-3).map((r) => `<article><b>${esc(r.title)}</b><p>${esc(r.recallText)}</p><p>新压力：${esc(r.currentPressure)}</p></article>`).join("")}</section>` : ""; }
  function traces() { const arr = state.dashboard.traces || []; return `<section class="causal-panel"><h2>留下的痕迹</h2>${arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p>还没有形成可追溯痕迹。</p>`}</section>`; }
  function relations() { return `<section class="causal-panel"><h2>人物关系</h2>${state.dashboard.relationships.map((x) => `<div class="rel"><b>${esc(x.name)}</b><span>${esc(x.stance)} ${x.score}</span></div>`).join("")}</section>`; }
  function roleInferences() { return `<section class="causal-panel"><h2>可见角色判断</h2>${Object.values(ROLE_MODELS).map((x) => `<details><summary>${esc(x.name)}</summary><p>公开目标：${esc(x.publicGoal)}</p><p>你能观察到：${x.observable.map(esc).join("、")}</p>${DEBUG ? `<p>DEBUG 真实目标：${esc(x.hidden.realGoal)}</p><p>DEBUG 恐惧：${x.hidden.fear.map(esc).join("、")}</p>` : ""}</details>`).join("")}</section>`; }
  function debugPanel() { return `<section class="causal-panel"><h2>DEBUG 后台账本</h2><pre>${esc(JSON.stringify(state.causalLedger, null, 2)).slice(0, 3000)}</pre></section>`; }

  function applyPatch(p = {}) { for (const [k, d] of Object.entries(p)) { if (k in state.dashboard.worldState) state.dashboard.worldState[k] = clamp(state.dashboard.worldState[k] + d); if (k in state.dashboard.roleState) state.dashboard.roleState[k] = clamp(state.dashboard.roleState[k] + d); } updateRelations(p); }
  function updateRelations(p) { const map = { "巡抚敌意": "xunfu", "县令信任": "county", "商会依赖": "merchant", "司礼监警惕": "sili" }; for (const [m, key] of Object.entries(map)) { if (!(m in p)) continue; const r = state.dashboard.relationships.find((x) => x.key === key); if (!r) continue; r.score = clamp(r.score + Number(p[m])); r.stance = stance(m, r.score); r.tone = r.score >= 65 || m.includes("敌意") || m.includes("警惕") ? "bad" : r.score <= 35 ? "warn" : "good"; } }
  function stance(m, s) { if (m.includes("敌意")) return s >= 65 ? "敌对" : s >= 45 ? "戒备" : "观望"; if (m.includes("警惕")) return s >= 65 ? "盯防" : s >= 45 ? "警惕" : "观望"; if (m.includes("信任")) return s >= 65 ? "信任" : s >= 45 ? "试探" : "不信"; if (m.includes("依赖")) return s >= 65 ? "靠拢" : s >= 45 ? "试探" : "观望"; return "观望"; }
  function resources(o) { const t = `${o.title}${o.body}`; const a = []; if (/密奏|皇帝/.test(t)) a.push("密奏权", "幕僚起草"); if (/商会|粮/.test(t)) a.push("调粮权", "商会粮路"); if (/证据|暗账|田契/.test(t)) a.push("县令密信", "田契副本"); return a.length ? a : ["总督文移", "幕僚判断"]; }
  function targets(o) { const t = `${o.title}${o.body}`; const a = ["zhejiang_governor"]; if (/巡抚|奏疏|急奏/.test(t)) a.push("xunfu"); if (/商会|粮/.test(t)) a.push("merchant"); if (/县令|证据|暗账|田契/.test(t)) a.push("county"); if (/密奏|皇帝|奏报/.test(t)) a.push("emperor", "sili"); return unique(a); }
  function evidenceNames(o) { const t = `${o.title}${o.body}`; if (/密奏/.test(t)) return ["总督密奏", "通政司递送记录", "奏报口径不一"]; if (/商会|粮/.test(t)) return ["商会入府记录", "放粮传话", "粮价变化账册"]; if (/暗账|证据|田契/.test(t)) return ["田契副本", "县令密信", "胥吏名册"]; return ["总督府文移", "幕僚记录"]; }
  function patchText(p = {}) { return Object.entries(p).map(([k, v]) => `${k} ${Number(v) >= 0 ? "+" : ""}${v}`); }
  function bindEvents() { document.getElementById("submitDecision")?.addEventListener("click", submitDecision); document.getElementById("advanceBtn")?.addEventListener("click", advanceDay); document.getElementById("finalizeBtn")?.addEventListener("click", finalizeRun); document.getElementById("resetBtn")?.addEventListener("click", resetRun); document.getElementById("resetDecisionBtn")?.addEventListener("click", resetRun); }
  function renderGuard(text) { const g = document.getElementById("guardText"); if (g) g.textContent = `ActionGuard：${text}`; }
  function resetRun() { localStorage.removeItem(STORAGE_KEY); state = createRun(); saveState(); render(); }
  function msg(type, label, title, body, dayNo, time = "", requiresDecision = false, extra = {}) { return { id: id("msg"), type, label, title, body, day: dayNo, time, requiresDecision, ...extra }; }
  function id(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`; }
  function event(type, payload = {}) { return { id: id("event"), type, payload, createdAt: new Date().toISOString() }; }
  function clamp(v) { return Math.max(0, Math.min(100, Math.round(Number(v) || 0))); }
  function unique(a) { return Array.from(new Set(a.filter(Boolean))); }
  function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function loadState() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; } }
  function esc(v) { return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
})();
