type MvpView = Record<string, any>;
type CausalPhase = "read" | "decision" | "advance" | "finalize";

const ROLE_DECISION_MODELS = {
  xunfu: {
    roleKey: "xunfu",
    publicIdentity: "浙江巡抚",
    publicGoal: "推进改桑，尽快见银",
    realGoal: "抢在总督前报功，借新政入京",
    fear: ["总督掌握暗账", "商会反咬", "县令公开证据"],
    decisionBias: ["倾向抢先进度", "倾向越级报功", "被压制时反咬总督"],
    informationStyle: "只公开对自己有利的信息"
  },
  county_magistrate: {
    roleKey: "county_magistrate",
    publicIdentity: "清流县令",
    publicGoal: "依法执行国策，同时保护地方百姓",
    realGoal: "查清官商夺田，同时避免自己被上级牺牲",
    fear: ["证据交给总督后被压下", "公开太早被定为扰乱国策"],
    decisionBias: ["递密信", "给部分证据但保留副本", "信任下降时寻找京师渠道"],
    informationStyle: "先留证，再试探上级是否可信"
  },
  merchant: {
    roleKey: "merchant",
    publicIdentity: "江南商会会首",
    publicGoal: "出银助国策，稳定商路",
    realGoal: "用垫银换政策特权，避免最后成为替罪羊",
    fear: ["商会被定为囤粮夺田", "总督用完商会后切割"],
    decisionBias: ["谁能保护我，我靠近谁", "放粮是交易，不是善意"],
    informationStyle: "表面说为国分忧，后台保留账册和人证"
  },
  sili_jian: {
    roleKey: "sili_jian",
    publicIdentity: "司礼监织造使",
    publicGoal: "确保丝源、贡品、银两进入内廷",
    realGoal: "绕开内阁，建立江南商会到内廷银库的通道",
    fear: ["地方总督坐大", "内阁抢走财政叙事"],
    decisionBias: ["关注银路", "利用内阁与地方冲突"],
    informationStyle: "不公开表态，只向皇帝递密报"
  }
};

export function ensureMvpCausalView(payload: any, phase: CausalPhase = "read") {
  if (!payload || payload.accepted === false || !payload.run) return payload;
  const view = payload as MvpView;
  view.messages ||= [];
  view.events ||= [];
  view.decisionHistory ||= [];
  view.dashboard ||= {};
  view.dashboard.visibleCausalCard ||= null;
  view.dashboard.causalRecallMessages ||= [];
  view.dashboard.traces ||= [];
  view.causalLedger ||= {
    fateSeeds: [],
    evidenceLedger: [],
    responsibilityLedger: [],
    narrativeFrames: [],
    roleDecisionModels: ROLE_DECISION_MODELS,
    causalRecallMessages: [],
    daySummaries: {},
    finalJudgementInputs: {}
  };
  view.causalLedger.roleDecisionModels ||= ROLE_DECISION_MODELS;

  const latestDecision = view.decisionHistory[view.decisionHistory.length - 1];
  if (latestDecision && !view.dashboard.visibleCausalCard) {
    const option = normalizeHistoryOption(latestDecision);
    createCausalBundle(view, option, latestDecision.originEventId || latestDecision.eventId || `evt_day${latestDecision.day}_${latestDecision.optionKey || "choice"}`, true);
  }
  if (phase === "advance") triggerCausalRecall(view);
  if (phase === "finalize") attachFinalJudgementInputs(view);
  return view;
}

function normalizeHistoryOption(history: any) {
  return {
    key: history.optionKey || history.key || "?",
    title: history.title || "关键决策",
    body: history.body || history.decisionText || history.title || "玩家做出关键选择。",
    patch: history.patch || {}
  };
}

function createCausalBundle(view: MvpView, option: any, originEventId: string, pushMessages: boolean) {
  const card = buildVisibleCausalCard(option, originEventId);
  const seed = buildFateSeed(option, originEventId, Number(view.run.currentDay || 3));
  const evidence = card.tracesLeft.map((trace: string, index: number) => ({
    id: `evidence_${originEventId}_${index + 1}`,
    title: trace,
    truthLevel: "true",
    completeness: 55,
    holderRoles: trace.includes("商会") ? ["merchant"] : ["zhejiang_governor"],
    knownByRoles: trace.includes("密奏") ? ["zhejiang_governor", "emperor", "sili_jian"] : ["zhejiang_governor"],
    canBackfireOn: ["zhejiang_governor"],
    originEventId
  }));
  const responsibility = {
    id: `resp_${originEventId}`,
    issue: option.title,
    possibleResponsibleRoles: [
      { roleKey: "zhejiang_governor", liability: 45, reason: "总督统筹浙江军政，行动会被视为最终责任的一部分。" },
      { roleKey: "xunfu", liability: isSecretMemorial(option) ? 65 : 50, reason: "巡抚急奏和三县推进是当前压力来源之一。" },
      { roleKey: "merchant", liability: String(option.body).includes("粮") ? 65 : 35, reason: "商会粮银与田契线可能被重新追责。" }
    ],
    currentDominantFrame: "暂未形成统一定性",
    originEventId
  };
  const narrativeFrame = {
    eventId: originEventId,
    eventTitle: option.title,
    frames: [
      { roleKey: "zhejiang_governor", frame: "稳局、留后手、保解释权", visibility: "private" },
      { roleKey: "xunfu", frame: isSecretMemorial(option) ? "总督另立口径，疑似拖延" : "总督正在抢夺局势解释权", visibility: "private" },
      { roleKey: "county_magistrate", frame: String(option.body).includes("商会") ? "总督府与商会接触过深" : "总督可能仍有清弊空间", visibility: "private" },
      { roleKey: "sili_jian", frame: "浙江口径有缝，银路有机会被内廷接管", visibility: "hidden" }
    ],
    dominantFrame: "暂未形成统一定性"
  };
  const roleReaction = buildRoleReaction(option, originEventId);

  view.dashboard.visibleCausalCard = card;
  view.dashboard.traces = Array.from(new Set([...(view.dashboard.traces || []), ...card.tracesLeft]));
  view.causalLedger.fateSeeds.push(seed);
  view.causalLedger.evidenceLedger.push(...evidence);
  view.causalLedger.responsibilityLedger.push(responsibility);
  view.causalLedger.narrativeFrames.push(narrativeFrame);
  view.events.push(evt("visible_causal_card_created", { originEventId, card }));
  view.events.push(evt("fate_seed_created", { originEventId, fateSeedId: seed.id }));
  view.events.push(evt("evidence_updated", { originEventId, evidenceIds: evidence.map((item) => item.id) }));
  view.events.push(evt("responsibility_updated", { originEventId, responsibilityId: responsibility.id }));
  view.events.push(evt("narrative_frame_updated", { originEventId, eventId: narrativeFrame.eventId }));
  view.events.push(evt("role_reaction", { originEventId, roleKey: roleReaction.roleKey, privateReasoningSummary: roleReaction.privateReasoningSummary }));

  if (pushMessages && !view.messages.some((message: any) => message.type === "causal_visible" && message.causalCard?.originEventId === originEventId)) {
    view.messages.push({ id: id("msg"), day: view.run.currentDay, time: "因果落账", type: "causal_visible", label: "因果回响", title: `你的选择留下了痕迹：${card.decisionTitle}`, body: card.playerFacingHint, causalCard: card });
    view.messages.push({ id: id("msg"), day: view.run.currentDay, time: "夜", type: "role_action", label: "角色反应", speaker: roleReaction.messageToPlayer.speaker, title: roleReaction.messageToPlayer.title, body: roleReaction.messageToPlayer.narrative });
  }
}

function buildVisibleCausalCard(option: any, originEventId: string) {
  const title = option.title || "关键决策";
  if (isSecretMemorial(option)) {
    return {
      decisionTitle: title,
      decisionSummary: "你没有截留巡抚急奏，而是另写密奏给皇帝，说明浙江民心与粮价已有裂痕。",
      personalEcho: "你保留了未来解释权：如果粮价和民怨后来坐实，你可以证明自己早已预警。",
      othersEcho: [{ roleKey: "xunfu", text: "巡抚会意识到你没有拦他，却在京师留了另一套说法。" }],
      worldEcho: "京师将收到两份口径不同的浙江奏报，司礼监开始注意浙江内部并不一致。",
      stateChangesText: patchToText(option.patch),
      tracesLeft: ["总督密奏", "通政司递送记录", "奏报口径不一"],
      potentialRisks: ["内阁可能认为你越级自保。", "巡抚可能把你定性为拖延国策。"],
      playerFacingHint: "这一步能保留解释权，也会让浙江内部口径分裂被京师看见。",
      originEventId
    };
  }
  if (String(option.title).includes("商会") || String(option.body).includes("商会") || String(option.body).includes("粮")) {
    return {
      decisionTitle: title,
      decisionSummary: `你选择以「${title}」处理粮价与商会压力。`,
      personalEcho: "你短期获得稳粮筹码，但也让商会有机会把自己包装成替朝廷分忧的人。",
      othersEcho: [{ roleKey: "merchant", text: "商会会保留这次接触作为未来护身符。" }, { roleKey: "county_magistrate", text: "县令会怀疑你是在清弊，还是在控制清弊。" }],
      worldEcho: "粮价可能暂缓，但官商关系的缝隙开始被县衙与司礼监同时看见。",
      stateChangesText: patchToText(option.patch),
      tracesLeft: ["商会入府记录", "放粮传话", "粮价变化账册"],
      potentialRisks: ["县令可能保留证据副本。", "商会被查时可能拿总督府传话自保。"],
      playerFacingHint: "你稳住了眼前粮价，也把商会变成未来可能反咬你的证人。",
      originEventId
    };
  }
  return {
    decisionTitle: title,
    decisionSummary: `你选择「${title}」：${option.body || "总督府开始执行这一步。"}`,
    personalEcho: "你改变了总督府的解释空间，也调整了自己承担责任的方式。",
    othersEcho: [{ roleKey: "xunfu", text: "巡抚府会根据你的动作重新判断总督府是否准备压制首功。" }],
    worldEcho: "浙江局势继续向御前裁决收束，奏报、粮价和暗账开始互相牵连。",
    stateChangesText: patchToText(option.patch),
    tracesLeft: ["总督府文移", "幕僚记录", "相关角色目击"],
    potentialRisks: ["这一步可能被不同角色重新定性。"],
    playerFacingHint: "这不是单次选择，而是未来因果账本的一笔。",
    originEventId
  };
}

function buildFateSeed(option: any, originEventId: string, day: number) {
  const memorial = isSecretMemorial(option);
  const merchant = String(option.title).includes("商会") || String(option.body).includes("商会") || String(option.body).includes("粮");
  return {
    id: `seed_${originEventId}`,
    originEventId,
    originDay: day,
    title: memorial ? "总督密奏" : merchant ? "商会入局" : `${option.title}的后续定性`,
    visibleHint: memorial ? "你没有拦巡抚，却在京师留下了自己的口径。" : merchant ? "这次商会接触没有写成承诺，但看见的人未必少。" : "幕僚已经把这一步写入局势账册。",
    hiddenMeaning: memorial ? "密奏既是解释权，也是越级自保嫌疑。" : merchant ? "商会把总督视为潜在保护伞，县令会提高戒心。" : "该行动未来可能被其他角色重新解释。",
    helpTriggers: [{ condition: "相关风险坐实", effect: "该选择成为玩家预警或留后手的证据。" }],
    backfireTriggers: [{ condition: "叙事权被对手夺走", effect: "该选择被重新定性为自保、拖延或官商交易。" }],
    status: "dormant",
    relatedRoles: memorial ? ["emperor", "xunfu", "cabinet", "sili_jian"] : ["xunfu", "county_magistrate", "merchant", "sili_jian"]
  };
}

function buildRoleReaction(option: any, originEventId: string) {
  if (isSecretMemorial(option)) {
    return {
      roleKey: "xunfu",
      privateReasoningSummary: "巡抚判断，总督没有拦截急奏，却在京师留下另一套口径。若巡抚现在退让，就等于承认自己操切；因此他会继续向内阁强调进度。",
      chosenAction: "私下联络内阁财政派，暗示总督府持重过度。",
      surfaceReason: "浙江不可迟疑，朝廷要的是银子。",
      hiddenIntent: "抢先定义浙江局势，把总督谨慎改写成拖延。",
      messageToPlayer: { speaker: "浙江巡抚", title: "巡抚开始反定性", narrative: "巡抚府听说总督府另有密奏入京，幕僚连夜准备给内阁的私信，信中反复写着四个字：持重误国。" },
      sourceEventIds: [originEventId]
    };
  }
  return {
    roleKey: "county_magistrate",
    privateReasoningSummary: "县令判断，总督的行动可能有稳局价值，但也可能只是控制证据流向。为了不被牺牲，他会继续给部分证据，同时保留完整副本。",
    chosenAction: "保留副本，只交部分证据给总督府。",
    surfaceReason: "证据尚不完整，需继续核实。",
    hiddenIntent: "防止总督府压案或与商会交易后切割县令。",
    messageToPlayer: { speaker: "清流县令", title: "县令保留副本", narrative: "县令继续递来田契线索，却没有把完整账册一并送来。师爷低声说：总督府能用，但不能全信。" },
    sourceEventIds: [originEventId]
  };
}

function triggerCausalRecall(view: MvpView) {
  const seed = view.causalLedger.fateSeeds.find((item: any) => item.status === "dormant");
  if (!seed || Number(view.run.currentDay) < 4) return;
  seed.status = "activated_backfire";
  const recall = {
    title: `因果回响：${seed.title}被重新定性`,
    originEventIds: [seed.originEventId],
    recallText: `这件事并非凭空而来。第 ${seed.originDay} 天，你曾经留下「${seed.title}」这枚伏笔。当时它有合理收益：${seed.visibleHint}`,
    reframedBy: seed.relatedRoles?.includes("xunfu") ? "浙江巡抚" : "清流县令",
    newFrame: seed.hiddenMeaning,
    currentPressure: seed.relatedRoles?.includes("xunfu") ? "巡抚开始把你的谨慎说成拖延。" : "县令开始保留副本，不再完全信任总督府。",
    visibility: "player_visible"
  };
  view.causalLedger.causalRecallMessages.push(recall);
  view.dashboard.causalRecallMessages = view.causalLedger.causalRecallMessages;
  view.messages.push({ id: id("msg"), day: view.run.currentDay, time: "因果回响", type: "causal_recall", label: "因果回溯", title: recall.title, body: `${recall.recallText}\n但现在，它被重新定性为：“${recall.newFrame}”\n因此，今日出现新的压力：${recall.currentPressure}` });
  view.events.push(evt("causal_recall", recall));
}

function attachFinalJudgementInputs(view: MvpView) {
  const saved = view.decisionHistory.slice(0, 3).map((item: any) => `第 ${item.day} 天「${item.title}」留下了可解释的因果锚点。`);
  const hurt = (view.causalLedger.fateSeeds || []).filter((item: any) => String(item.status).includes("backfire")).map((item: any) => `第 ${item.originDay} 天「${item.title}」被重新定性。`);
  view.causalLedger.finalJudgementInputs = { keyMovesThatSavedYou: saved, keyMovesThatHurtYou: hurt, fateSeedCount: view.causalLedger.fateSeeds.length };
  const finalMessage = [...(view.messages || [])].reverse().find((item: any) => item.type === "final");
  if (finalMessage && !String(finalMessage.body || "").includes("救你的几步")) {
    finalMessage.body = `${finalMessage.body}\n\n救你的几步：${saved.join("；") || "暂无"}\n害你的几步：${hurt.join("；") || "暂无明显反噬，但疑心仍在账本中。"}\n命运债：你利用了县令的清名，也借用了商会的粮路；这些都不会凭空消失。`;
  }
  view.events.push(evt("final_judgement_inputs", view.causalLedger.finalJudgementInputs));
}

function isSecretMemorial(option: any) {
  return String(option.title).includes("密奏") || String(option.body).includes("密奏");
}

function patchToText(patch: Record<string, number> = {}) {
  return Object.entries(patch).map(([key, value]) => `${key} ${Number(value) >= 0 ? "+" : ""}${value}`);
}

function id(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

function evt(type: string, payload: Record<string, unknown> = {}) {
  return { id: id("event"), type, payload, createdAt: new Date().toISOString() };
}
