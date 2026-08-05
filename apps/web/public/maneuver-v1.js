const KIND_LABELS_ZH = {
  CONVERSATION: "人物交谈",
  INVESTIGATION: "派遣调查",
  CARD_LAYOUT: "筹码布局",
  CUSTOM_PLAN: "自拟谋划",
  REACTION: "应变"
};

const KIND_LABELS_EN = {
  CONVERSATION: "Conversation",
  INVESTIGATION: "Investigate",
  CARD_LAYOUT: "Card Layout",
  CUSTOM_PLAN: "Custom Maneuver",
  REACTION: "Reaction"
};

export function maneuverRulesV1ForView(view) {
  const capability = view?.capabilities?.maneuverRulesV1;
  return capability?.enabled === true ? capability : null;
}

export function createManeuverV1UiState() {
  return {
    activeKind: "CUSTOM_PLAN",
    drafts: {
      CONVERSATION: {
        targetActorId: "",
        message: "",
        purpose: "ASK",
        visibility: "LIMITED",
        attachmentAssetKeys: [],
        formalAgreementRequested: false
      },
      INVESTIGATION: {
        traceId: "",
        routeId: "",
        executorAssetKey: "",
        attachmentAssetKeys: []
      },
      CARD_LAYOUT: {
        cardAssetKey: "",
        playMode: "ACTIVE",
        targetId: "",
        triggerPatternId: ""
      },
      CUSTOM_PLAN: {
        rawText: "",
        attachmentAssetKeys: [],
        visibilityPreference: "NORMAL"
      },
      REACTION: {
        reactionId: "",
        optionId: "",
        rawText: "",
        cardAssetKey: "",
        hold: false
      }
    },
    preview: null,
    decisionResult: null,
    sourceVersion: null,
    sourceWindowVersion: null,
    busy: false,
    guard: null
  };
}

export function resetManeuverV1UiAfterCommit(ui) {
  const next = createManeuverV1UiState();
  next.activeKind = ["CONVERSATION", "INVESTIGATION", "CARD_LAYOUT", "CUSTOM_PLAN"].includes(ui?.activeKind)
    ? ui.activeKind
    : "CUSTOM_PLAN";
  return next;
}

export function createManeuverDraftV1(ui) {
  const kind = ui?.activeKind || "CUSTOM_PLAN";
  const draft = ui?.drafts?.[kind] || {};
  switch (kind) {
    case "CONVERSATION":
      return {
        schemaVersion: "maneuver_draft_v1",
        kind,
        targetActorId: String(draft.targetActorId || ""),
        message: String(draft.message || "").trim(),
        purpose: draft.purpose || "ASK",
        visibility: draft.visibility || "LIMITED",
        attachmentAssetKeys: array(draft.attachmentAssetKeys).slice(0, 1),
        formalAgreementRequested: draft.formalAgreementRequested === true
      };
    case "INVESTIGATION":
      return {
        schemaVersion: "maneuver_draft_v1",
        kind,
        traceId: String(draft.traceId || ""),
        routeId: String(draft.routeId || ""),
        ...(draft.executorAssetKey ? { executorAssetKey: String(draft.executorAssetKey) } : {}),
        attachmentAssetKeys: array(draft.attachmentAssetKeys).slice(0, 1)
      };
    case "CARD_LAYOUT":
      return {
        schemaVersion: "maneuver_draft_v1",
        kind,
        cardAssetKey: String(draft.cardAssetKey || ""),
        playMode: draft.playMode || "ACTIVE",
        targetId: String(draft.targetId || ""),
        ...(draft.playMode === "SET" && draft.triggerPatternId ? { triggerPatternId: String(draft.triggerPatternId) } : {})
      };
    case "REACTION":
      return {
        schemaVersion: "maneuver_draft_v1",
        kind,
        reactionId: String(draft.reactionId || ""),
        ...(draft.optionId ? { optionId: String(draft.optionId) } : {}),
        ...(String(draft.rawText || "").trim() ? { rawText: String(draft.rawText).trim() } : {}),
        ...(draft.cardAssetKey ? { cardAssetKey: String(draft.cardAssetKey) } : {}),
        hold: draft.hold === true
      };
    default:
      return {
        schemaVersion: "maneuver_draft_v1",
        kind: "CUSTOM_PLAN",
        rawText: String(draft.rawText || "").trim(),
        attachmentAssetKeys: array(draft.attachmentAssetKeys).slice(0, 1),
        visibilityPreference: draft.visibilityPreference || "NORMAL"
      };
  }
}

export function validateManeuverV1Draft(ui, capability, en = false) {
  const draft = createManeuverDraftV1(ui);
  if (draft.kind === "REACTION") {
    const reaction = array(capability?.reactions).find((item) => item.reactionId === draft.reactionId);
    if (!reaction) return en ? "This reaction window is no longer available." : "这项应变窗口已经关闭。";
    if (!draft.hold && !draft.optionId && !draft.rawText && !draft.cardAssetKey) {
      return en ? "Choose a response, use a reaction card, write a bounded response, or hold." : "请选择应变选项、使用应变牌、写下有限回应，或暂不应变。";
    }
    return "";
  }
  if (!capability?.window || capability.window.status !== "OPEN") {
    return en ? "The maneuver window is closed." : "当前场景的谋划窗口已经关闭。";
  }
  if (Number(capability.window.remainingOpportunities || 0) <= 0) {
    return en ? "No maneuver opportunities remain." : "本场景的谋划机会已经用尽。";
  }
  if (draft.kind === "CONVERSATION") {
    if (Number(capability.window.formLimits?.conversationRemaining || 0) <= 0) return en ? "You already opened one conversation this scene." : "本场景已经主动发起过一次人物交谈。";
    if (!draft.targetActorId) return en ? "Choose one person." : "请先选择一名可接触人物。";
    if (!draft.message) return en ? "Write what you want to say." : "请写下你准备说的话。";
  }
  if (draft.kind === "INVESTIGATION") {
    if (Number(capability.window.formLimits?.investigationRemaining || 0) <= 0) return en ? "You already sent one investigation this scene." : "本场景已经派遣过一次调查。";
    if (!draft.traceId) return en ? "Choose one trace." : "请先选择一条真实存在的痕迹。";
    if (!draft.routeId) return en ? "Choose one investigation route." : "请选择具体调查路线。";
  }
  if (draft.kind === "CARD_LAYOUT") {
    if (!draft.cardAssetKey) return en ? "Choose one rule card." : "请先选择一张当前可用的规则筹码。";
    if (!draft.targetId) return en ? "Choose a legal target." : "请选择这张筹码要作用的对象。";
    if (draft.playMode === "SET" && !draft.triggerPatternId) return en ? "Choose a trigger." : "伏置筹码必须选择牌面允许的触发条件。";
  }
  if (draft.kind === "CUSTOM_PLAN" && !draft.rawText) {
    return en ? "Describe one action you will actually take." : "请写下你准备真正执行的一件事。";
  }
  return "";
}

export function applySuggestedManeuverDraftV1(ui, draft) {
  if (!draft?.kind || !ui?.drafts?.[draft.kind]) return false;
  ui.activeKind = draft.kind;
  if (draft.kind === "CONVERSATION") {
    ui.drafts.CONVERSATION = {
      targetActorId: draft.targetActorId || "",
      message: draft.message || "",
      purpose: draft.purpose || "ASK",
      visibility: draft.visibility || "LIMITED",
      attachmentAssetKeys: array(draft.attachmentAssetKeys),
      formalAgreementRequested: draft.formalAgreementRequested === true
    };
  } else if (draft.kind === "INVESTIGATION") {
    ui.drafts.INVESTIGATION = {
      traceId: draft.traceId || "",
      routeId: draft.routeId || "",
      executorAssetKey: draft.executorAssetKey || "",
      attachmentAssetKeys: array(draft.attachmentAssetKeys)
    };
  } else if (draft.kind === "CARD_LAYOUT") {
    ui.drafts.CARD_LAYOUT = {
      cardAssetKey: draft.cardAssetKey || "",
      playMode: draft.playMode || "ACTIVE",
      targetId: draft.targetId || "",
      triggerPatternId: draft.triggerPatternId || ""
    };
  } else if (draft.kind === "REACTION") {
    ui.drafts.REACTION = {
      reactionId: draft.reactionId || "",
      optionId: draft.optionId || "",
      rawText: draft.rawText || "",
      cardAssetKey: draft.cardAssetKey || "",
      hold: draft.hold === true
    };
  } else {
    ui.drafts.CUSTOM_PLAN = {
      rawText: draft.rawText || "",
      attachmentAssetKeys: array(draft.attachmentAssetKeys),
      visibilityPreference: draft.visibilityPreference || "NORMAL"
    };
  }
  ui.preview = null;
  ui.decisionResult = null;
  ui.guard = null;
  return true;
}

export function renderManeuverV1Panel(view, ui, { busy = false, en = false } = {}) {
  const capability = maneuverRulesV1ForView(view);
  if (!capability) return "";
  const windowState = capability.window || {};
  const remaining = Number(windowState.remainingOpportunities || 0);
  const total = Number(windowState.totalOpportunities || 2);
  const disabled = busy || ui?.busy || windowState.status !== "OPEN" || remaining <= 0;
  const labels = en ? KIND_LABELS_EN : KIND_LABELS_ZH;
  const kinds = ["CONVERSATION", "INVESTIGATION", "CARD_LAYOUT", "CUSTOM_PLAN"];
  const active = ui?.activeKind || "CUSTOM_PLAN";
  const workbenchDisabled = disabled
    || active === "CONVERSATION" && Number(windowState.formLimits?.conversationRemaining || 0) <= 0
    || active === "INVESTIGATION" && Number(windowState.formLimits?.investigationRemaining || 0) <= 0;
  const workbench = active === "CONVERSATION"
    ? renderConversationWorkbench(capability, ui, workbenchDisabled, en)
    : active === "INVESTIGATION"
      ? renderInvestigationWorkbench(capability, ui, workbenchDisabled, en)
      : active === "CARD_LAYOUT"
        ? renderCardLayoutWorkbench(capability, ui, workbenchDisabled, en)
        : active === "REACTION"
          ? renderReactionWorkbench(capability, ui, busy || ui?.busy, en)
          : renderCustomPlanWorkbench(capability, ui, workbenchDisabled, en);
  const pending = array(capability.pendingActions).slice(-6).reverse();
  const reactionNotice = renderReactionNotice(capability, ui, busy || ui?.busy, en);
  return `<section class="maneuver-panel maneuver-v1-panel" data-testid="maneuver-panel" data-maneuver-v1="true">
    <div class="maneuver-heading"><h2>${en ? "Maneuver Board" : "谋划中枢"}</h2><button class="help-dot" type="button" title="${en ? "Every committed maneuver has one bounded primary effect" : "每项落子只执行一个有限主要效果"}">?</button></div>
    ${reactionNotice}
    <section class="maneuver-usage" data-testid="maneuver-opportunities"><span>${en ? "This Scene" : "本场景谋划"}</span><b>${remaining} / ${total}</b><div class="opportunity-dots" aria-label="${en ? "Remaining opportunities" : "剩余机会"}">${Array.from({ length: total }, (_, index) => `<i class="${index >= remaining ? "spent" : ""}"></i>`).join("")}</div><small>${en ? "Unused opportunities expire when the scene advances" : "进入下一场景后不结转"}</small></section>
    <div class="maneuver-type-grid" aria-label="${en ? "Choose maneuver type" : "选择谋划类型"}">${kinds.map((kind) => {
      const formDisabled = kind === "CONVERSATION" && Number(windowState.formLimits?.conversationRemaining || 0) <= 0
        || kind === "INVESTIGATION" && Number(windowState.formLimits?.investigationRemaining || 0) <= 0;
      return `<button type="button" data-mv1-kind="${kind}" data-testid="maneuver-kind-${kind.toLowerCase().replaceAll("_", "-")}" class="${active === kind ? "active" : ""}" aria-pressed="${active === kind}" ${disabled || formDisabled ? "disabled" : ""}>${escapeHtml(labels[kind])}</button>`;
    }).join("")}</div>
    <div class="maneuver-active-label">${en ? "Current" : "当前"}：${escapeHtml(labels[active] || labels.CUSTOM_PLAN)}</div>
    ${workbench}
    ${renderManeuverV1Guard(ui?.guard, en)}
    <details class="maneuver-progress" ${pending.some((item) => item.status === "PENDING" || item.status === "ARMED") ? "open" : ""}><summary>${en ? "Actions & Evidence" : "行动与证据"} <span>${pending.length}</span></summary>${pending.length ? pending.map((item) => `<div class="progress-row" data-source-action-id="${escapeHtml(item.actionId)}"><span>${escapeHtml(item.title)}</span><b class="${item.status === "PENDING" ? "" : item.status === "ARMED" ? "warning-text" : ""}">${escapeHtml(statusLabel(item.status, en))}</b>${item.revealsAtLabel ? `<small>${escapeHtml(item.revealsAtLabel)}</small>` : ""}</div>`).join("") : `<p class="maneuver-v1-empty">${en ? "No maneuver has been committed in this story yet." : "还没有已经落子的谋划。"}</p>`}</details>
  </section>`;
}

function renderConversationWorkbench(capability, ui, disabled, en) {
  const draft = ui.drafts.CONVERSATION;
  const contacts = array(capability.contacts);
  const evidence = array(capability.evidenceCards);
  return `<section class="maneuver-workbench maneuver-contact-workbench" data-testid="maneuver-contact-workbench">
    <div class="maneuver-workbench-head"><span>${en ? "Reachable People" : "当前可接触人物"}</span><small>${en ? "One initiated conversation per scene" : "每场景最多主动发起一次"}</small></div>
    <div class="maneuver-v1-card-list">${contacts.map((contact) => `<button class="contact-row ${draft.targetActorId === contact.actorId ? "selected" : ""}" type="button" data-mv1-contact="${escapeHtml(contact.actorId)}" ${disabled ? "disabled" : ""}><span class="contact-avatar" aria-hidden="true">${escapeHtml(String(contact.displayName || "人").slice(0, 1))}</span><span><b>${escapeHtml(contact.displayName)}</b><small>${escapeHtml(contact.whyRelevant || contact.publicIdentity)}</small></span><em>${en ? "Choose" : "选择"}</em></button>`).join("") || `<p class="maneuver-v1-empty">${en ? "No one can be reached right now." : "此刻没有可以正式接触的人物。"}</p>`}</div>
    <label class="maneuver-v1-field"><span>${en ? "What will you say?" : "你准备原样说什么"}</span><textarea id="mv1ConversationMessage" maxlength="500" placeholder="${en ? "Ask, test, persuade, exchange, pressure, or propose a term…" : "询问、试探、说服、交换、施压，或提出条件……"}">${escapeHtml(draft.message || "")}</textarea></label>
    <div class="maneuver-v1-field-row"><label><span>${en ? "Purpose" : "主要目的"}</span><select id="mv1ConversationPurpose"><option value="ASK" ${selected(draft.purpose, "ASK")}>${en ? "Ask" : "询问"}</option><option value="TEST" ${selected(draft.purpose, "TEST")}>${en ? "Test" : "试探"}</option><option value="PERSUADE" ${selected(draft.purpose, "PERSUADE")}>${en ? "Persuade" : "说服"}</option><option value="EXCHANGE" ${selected(draft.purpose, "EXCHANGE")}>${en ? "Exchange" : "交换"}</option><option value="PRESSURE" ${selected(draft.purpose, "PRESSURE")}>${en ? "Pressure" : "施压"}</option><option value="PROPOSE_TERM" ${selected(draft.purpose, "PROPOSE_TERM")}>${en ? "Propose terms" : "提出条件"}</option></select></label><label><span>${en ? "Visibility" : "交谈范围"}</span><select id="mv1ConversationVisibility"><option value="LIMITED" ${selected(draft.visibility, "LIMITED")}>${en ? "Private" : "仅双方"}</option><option value="PUBLIC" ${selected(draft.visibility, "PUBLIC")}>${en ? "Public" : "公开"}</option></select></label></div>
    ${renderAttachmentSelect("mv1ConversationAttachment", draft.attachmentAssetKeys?.[0], capability, en)}
    <label class="maneuver-v1-check"><input id="mv1FormalAgreement" type="checkbox" ${draft.formalAgreementRequested ? "checked" : ""}/><span>${en ? "Ask the system to identify a formal agreement proposal" : "若内容包含双向条件，尝试建立正式协议提议"}</span></label>
    ${previewButton(disabled, en)}
  </section>`;
}

function renderInvestigationWorkbench(capability, ui, disabled, en) {
  const draft = ui.drafts.INVESTIGATION;
  const leads = array(capability.investigationLeads);
  const selectedLead = leads.find((lead) => lead.traceId === draft.traceId) || null;
  const routes = array(selectedLead?.routes);
  return `<section class="maneuver-workbench maneuver-investigate-workbench" data-testid="maneuver-investigate-workbench">
    <div class="maneuver-workbench-head"><span>${en ? "Traceable Clues" : "当前可追查痕迹"}</span><small>${en ? "Choose what to spend your tempo on" : "选择你愿意押上一次机会的线"}</small></div>
    <div class="maneuver-v1-card-list" data-testid="investigation-lead-list">${leads.map((lead) => `<button class="maneuver-choice-card investigation-lead-card ${draft.traceId === lead.traceId ? "selected" : ""}" type="button" data-mv1-trace="${escapeHtml(lead.traceId)}" ${disabled ? "disabled" : ""}><b>${escapeHtml(lead.title)}</b><small>${escapeHtml(lead.narrativeHook)}</small><em>${escapeHtml(urgencyLabel(lead, en))}</em></button>`).join("") || `<p class="maneuver-v1-empty">${en ? "There is no real trace your role can pursue." : "当前没有你的角色能够追查的真实痕迹。"}</p>`}</div>
    ${selectedLead ? `<div class="maneuver-workbench-head maneuver-route-head"><span>${en ? "How will you pursue it?" : "你准备从哪里追下去"}</span><small>${escapeHtml(selectedLead.expiresAtLabel || (en ? "This trace persists" : "这条痕迹暂时不会消失"))}</small></div><div class="maneuver-v1-card-list" data-testid="investigation-route-list">${routes.map((route) => `<button class="maneuver-choice-card investigation-route-card ${draft.routeId === route.routeId ? "selected" : ""}" type="button" data-mv1-route="${escapeHtml(route.routeId)}" ${disabled ? "disabled" : ""}><b>${escapeHtml(route.label)}</b><small>${escapeHtml(route.narrativeMethod)}</small><span><strong>${en ? "May learn" : "可能查到"}</strong>${route.mayLearn.map(escapeHtml).join("、")}</span><span><strong>${en ? "Cannot prove" : "不能证明"}</strong>${route.cannotProve.map(escapeHtml).join("、")}</span><em>${escapeHtml([array(route.costLabels).join(" · "), route.returnLabel].filter(Boolean).join(" · "))}</em>${route.possibleTrail ? `<i>${en ? "May leave" : "可能留下"}：${escapeHtml(route.possibleTrail)}</i>` : ""}</button>`).join("")}</div>` : ""}
    ${renderAttachmentSelect("mv1InvestigationAttachment", draft.attachmentAssetKeys?.[0], capability, en, true)}
    ${previewButton(disabled, en)}
  </section>`;
}

function renderCardLayoutWorkbench(capability, ui, disabled, en) {
  const draft = ui.drafts.CARD_LAYOUT;
  const cards = array(capability.ruleCards);
  const card = cards.find((item) => item.cardAssetKey === draft.cardAssetKey) || null;
  const modes = card ? card.timing.filter((timing) => timing === "ACTIVE" || timing === "SET") : [];
  const effectiveMode = modes.includes(draft.playMode) ? draft.playMode : modes[0] || "ACTIVE";
  const legalTargets = array(card?.legalTargets);
  const triggers = array(card?.triggerOptions);
  return `<section class="maneuver-workbench maneuver-leverage-workbench" data-testid="maneuver-card-layout-workbench">
    <div class="maneuver-workbench-head"><span>${en ? "Rule Cards" : "可用规则筹码"}</span><small>${en ? "Play now or set a bounded trigger" : "现在打出，或按牌面伏置"}</small></div>
    <div class="maneuver-v1-card-list">${cards.map((item) => `<button class="maneuver-choice-card rule-card ${draft.cardAssetKey === item.cardAssetKey ? "selected" : ""}" type="button" data-mv1-card="${escapeHtml(item.cardAssetKey)}" ${disabled || item.status !== "AVAILABLE" ? "disabled" : ""}><b>${escapeHtml(item.label)}</b><small>${escapeHtml(array(item.guaranteedEffects).join("；"))}</small><span><strong>${en ? "Limits" : "边界"}</strong>${escapeHtml(array(item.limitations).join("；"))}</span><em>${escapeHtml(cardStatusLabel(item, en))}</em></button>`).join("") || `<p class="maneuver-v1-empty">${en ? "No rule card is available." : "当前没有满足时机的规则筹码。"}</p>`}</div>
    ${card ? `<div class="maneuver-v1-field-row"><label><span>${en ? "Timing" : "出牌时机"}</span><select id="mv1CardMode">${modes.map((mode) => `<option value="${mode}" ${selected(effectiveMode, mode)}>${mode === "SET" ? (en ? "Set secretly" : "暗中伏置") : (en ? "Play now" : "现在打出")}</option>`).join("")}</select></label><label><span>${en ? "Target" : "作用对象"}</span><select id="mv1CardTarget"><option value="">${en ? "Choose…" : "请选择……"}</option>${legalTargets.map((target) => `<option value="${escapeHtml(target.id)}" ${selected(draft.targetId, target.id)}>${escapeHtml(target.label)}</option>`).join("")}</select></label></div>${effectiveMode === "SET" ? `<label class="maneuver-v1-field"><span>${en ? "Trigger" : "牌面触发条件"}</span><select id="mv1CardTrigger"><option value="">${en ? "Choose a trigger…" : "请选择触发条件……"}</option>${triggers.map((trigger) => `<option value="${escapeHtml(trigger.triggerPatternId)}" ${selected(draft.triggerPatternId, trigger.triggerPatternId)}>${escapeHtml(trigger.label)}</option>`).join("")}</select></label>` : ""}` : ""}
    ${previewButton(disabled, en)}
  </section>`;
}

function renderReactionNotice(capability, ui, disabled, en) {
  const reaction = array(capability.reactions)[0];
  if (!reaction) return "";
  const active = ui?.activeKind === "REACTION" && ui?.drafts?.REACTION?.reactionId === reaction.reactionId;
  return `<article class="reaction-window-card ${active ? "active" : ""}" data-testid="reaction-window">
    <p>${en ? "A situation is waiting for your response" : "剧情出现了可应变的变化"}</p>
    <h3>${escapeHtml(reaction.storyNotice?.title || (en ? "Reaction window" : "应变窗口"))}</h3>
    <span>${escapeHtml(reaction.storyNotice?.narrative || "")}</span>
    <button type="button" data-mv1-open-reaction="${escapeHtml(reaction.reactionId)}" ${disabled ? "disabled" : ""}>${en ? "Review response" : "查看应变选择"}</button>
  </article>`;
}

function renderReactionWorkbench(capability, ui, disabled, en) {
  const draft = ui.drafts.REACTION;
  const reaction = array(capability.reactions).find((item) => item.reactionId === draft.reactionId) || array(capability.reactions)[0];
  if (!reaction) return `<p class="maneuver-v1-empty">${en ? "This reaction window has closed." : "这项应变窗口已经关闭。"}</p>`;
  const eligibleCards = array(capability.ruleCards).filter((card) => array(reaction.eligibleCardAssetKeys).includes(card.cardAssetKey));
  return `<section class="maneuver-workbench maneuver-reaction-workbench" data-testid="maneuver-reaction-workbench">
    <div class="maneuver-workbench-head"><span>${en ? "Reaction" : "应变"}</span><small>${en ? "This is not a fifth permanent action" : "应变由剧情触发，不占常驻入口"}</small></div>
    <article class="reaction-story-notice"><h3>${escapeHtml(reaction.storyNotice?.title || "")}</h3><p>${escapeHtml(reaction.storyNotice?.narrative || "")}</p></article>
    <div class="maneuver-v1-card-list">${array(reaction.options).map((option) => `<button type="button" class="maneuver-choice-card ${draft.optionId === option.optionId && !draft.hold ? "selected" : ""}" data-mv1-reaction-option="${escapeHtml(option.optionId)}"><b>${escapeHtml(option.label)}</b><small>${escapeHtml(option.description)}</small></button>`).join("")}</div>
    ${reaction.customAllowed ? `<label class="maneuver-v1-field"><span>${en ? "Or respond in your own words" : "或用自己的话应变"}</span><textarea id="mv1ReactionText" maxlength="500" placeholder="${en ? "Describe one response to this situation…" : "只描述对当前变化的一项回应……"}">${escapeHtml(draft.rawText || "")}</textarea></label>` : ""}
    ${eligibleCards.length ? `<label class="maneuver-v1-field"><span>${en ? "Reaction card" : "可用应变牌"}</span><select id="mv1ReactionCard"><option value="">${en ? "Do not use a card" : "不使用应变牌"}</option>${eligibleCards.map((card) => `<option value="${escapeHtml(card.cardAssetKey)}" ${selected(draft.cardAssetKey, card.cardAssetKey)}>${escapeHtml(card.label)}</option>`).join("")}</select></label>` : ""}
    <div class="reaction-action-row">${reaction.holdAllowed ? `<button type="button" data-mv1-reaction-hold>${en ? "Hold this response" : "暂不应变，保留机会"}</button>` : ""}<button id="mv1PreviewReaction" type="button" ${disabled ? "disabled" : ""}>${en ? "Preview response" : "预演这次应变"}</button></div>
  </section>`;
}

function renderCustomPlanWorkbench(capability, ui, disabled, en) {
  const draft = ui.drafts.CUSTOM_PLAN;
  return `<section class="maneuver-workbench maneuver-custom-workbench" data-testid="maneuver-custom-workbench">
    <div class="maneuver-workbench-head"><span>${en ? "Custom Maneuver" : "自拟谋划"}</span><small>${en ? "Unlimited expression, one bounded primary effect" : "表达可以自由，一次只执行一个主要效果"}</small></div>
    <label class="maneuver-v1-field"><span>${en ? "What will you actually do?" : "你准备真正做什么"}</span><textarea id="mv1CustomPlan" maxlength="500" placeholder="${en ? "Example: send one guard unit to seal the archive…" : "例如：调一队人手封锁存放关键文件的库房……"}">${escapeHtml(draft.rawText || "")}</textarea><small>${String(draft.rawText || "").length} / 500</small></label>
    <label class="maneuver-v1-field"><span>${en ? "Visibility preference" : "行动倾向"}</span><select id="mv1CustomVisibility"><option value="QUIET" ${selected(draft.visibilityPreference, "QUIET")}>${en ? "Quiet, but may leave traces" : "尽量隐蔽，但仍可能留痕"}</option><option value="NORMAL" ${selected(draft.visibilityPreference, "NORMAL")}>${en ? "Follow the normal rule" : "按行动默认规则"}</option><option value="PUBLIC" ${selected(draft.visibilityPreference, "PUBLIC")}>${en ? "Public" : "公开行动"}</option></select></label>
    ${renderAttachmentSelect("mv1CustomAttachment", draft.attachmentAssetKeys?.[0], capability, en)}
    ${previewButton(disabled, en, en ? "Parse & Preview" : "解析并预演")}
  </section>`;
}

function renderAttachmentSelect(id, selectedValue, capability, en, cardsOnly = false) {
  const cards = array(capability.ruleCards).filter((card) => card.status === "AVAILABLE" && card.timing.includes("ATTACH"));
  const evidence = cardsOnly ? [] : array(capability.evidenceCards);
  if (!cards.length && !evidence.length) return "";
  return `<label class="maneuver-v1-field"><span>${en ? "Optional attachment" : "可选附加一项筹码或证据"}</span><select id="${id}"><option value="">${en ? "None" : "不附加"}</option>${cards.map((card) => `<option value="${escapeHtml(card.cardAssetKey)}" ${selected(selectedValue, card.cardAssetKey)}>${en ? "Card" : "筹码"} · ${escapeHtml(card.label)}</option>`).join("")}${evidence.map((card) => `<option value="${escapeHtml(card.evidenceId)}" ${selected(selectedValue, card.evidenceId)}>${en ? "Evidence" : "证据"} · ${escapeHtml(card.title)}</option>`).join("")}</select></label>`;
}

function previewButton(disabled, en, label) {
  return `<div class="maneuver-form-row"><button id="mv1PreviewAction" type="button" ${disabled ? "disabled" : ""}>${escapeHtml(label || (en ? "Preview This Move" : "预演这一步"))}</button></div>`;
}

export function renderManeuverV1DecisionCard(ui, { busy = false, en = false } = {}) {
  const result = ui?.decisionResult;
  if (!result) return "";
  if (result.decision === "READY" && result.presentation) return renderReadyPreview(result, busy, en, ui);
  if (result.decision === "SPLIT_REQUIRED") {
    return `<section class="action-preview-layer" data-testid="action-preview-card"><article class="action-preview-card action-preview-card--split"><p class="action-preview-eyebrow">${en ? "ONE MOVE AT A TIME" : "一次只能落一子"}</p><h2>${en ? "This plan contains several actions" : "这段谋划包含多个主要行动"}</h2><p>${escapeHtml(result.reason || "")}</p><div class="action-preview-split-list">${array(result.splitOptions).map((option) => `<button type="button" data-mv1-split-option="${escapeHtml(option.optionId)}"><b>${escapeHtml(option.label)}</b><span>${en ? "Use this as the current move" : "把这一项作为本次谋划"}</span></button>`).join("")}</div><div class="action-preview-actions"><button type="button" data-mv1-preview-edit>${en ? "Back to edit" : "返回修改"}</button></div></article></section>`;
  }
  if (result.decision === "REROUTE_REQUIRED") {
    return `<section class="action-preview-layer" data-testid="action-preview-card"><article class="action-preview-card action-preview-card--reroute"><p class="action-preview-eyebrow">${en ? "RULE ROUTING" : "规则归类"}</p><h2>${en ? "This belongs to another maneuver rule" : "这项谋划应按另一种规则执行"}</h2><p>${escapeHtml(result.reason || "")}</p><div class="action-preview-actions"><button type="button" data-mv1-preview-edit>${en ? "Keep editing" : "继续修改"}</button>${result.suggestedDraft ? `<button type="button" data-mv1-apply-suggestion>${en ? "Use the suggested rule" : "按建议规则继续"}</button>` : ""}</div></article></section>`;
  }
  return `<section class="action-preview-layer" data-testid="action-preview-card"><article class="action-preview-card action-preview-card--blocked"><p class="action-preview-eyebrow">${en ? "MOVE NOT READY" : "这一步还不能落子"}</p><h2>${result.decision === "BLOCKED" ? (en ? "This move crosses a rule boundary" : "这项谋划越过了规则边界") : (en ? "Narrow this move" : "请把这一步收窄")}</h2><p>${escapeHtml(result.reason || "")}</p><div class="action-preview-actions"><button type="button" data-mv1-preview-edit>${en ? "Back to edit" : "返回修改"}</button></div></article></section>`;
}

function renderReadyPreview(result, busy, en, ui) {
  const presentation = result.presentation;
  const stale = ui.sourceVersion !== null && ui.sourceVersion !== ui.currentVersion || ui.sourceWindowVersion !== null && ui.sourceWindowVersion !== ui.currentWindowVersion;
  return `<section class="action-preview-layer" data-testid="action-preview-card"><article class="action-preview-card ${stale ? "action-preview-card--stale" : ""}"><div class="action-preview-head"><p class="action-preview-eyebrow">${escapeHtml(presentation.eyebrow)}</p><span>${stale ? (en ? "STALE" : "局势已变化") : (en ? "NOT COMMITTED" : "尚未提交")}</span></div><h2>${escapeHtml(presentation.title)}</h2><p class="action-preview-narrative">${lineBreaks(presentation.narrative)}</p><div class="action-preview-sections">${array(presentation.sections).map((section) => `<section data-preview-section="${escapeHtml(section.kind)}"><h3>${escapeHtml(section.label)}</h3>${array(section.lines).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</section>`).join("")}</div><div class="action-preview-chips">${array(presentation.chips).map((chip) => `<span data-chip-kind="${escapeHtml(chip.kind)}">${escapeHtml(chip.label)}</span>`).join("")}</div>${stale ? `<div class="action-preview-stale" data-testid="action-preview-stale">${en ? "The world changed after this preview. Re-preview before committing." : "预演后局势已经变化，系统不会按旧理解执行。请重新预演。"}</div>` : ""}<div class="action-preview-actions"><button type="button" data-mv1-preview-edit ${busy ? "disabled" : ""}>${escapeHtml(presentation.editLabel || (en ? "Back" : "返回修改"))}</button><button type="button" data-mv1-preview-commit data-testid="action-preview-confirm" ${busy || stale ? "disabled" : ""}>${busy ? (en ? "Committing…" : "正在落子……") : escapeHtml(presentation.confirmLabel || (en ? "Commit" : "确认"))}</button></div></article></section>`;
}

export function renderEvidenceHandV1(view, { en = false } = {}) {
  const capability = maneuverRulesV1ForView(view);
  const evidence = array(capability?.evidenceCards);
  if (!capability) return "";
  return `<section class="info-panel evidence-hand-panel" data-testid="evidence-hand"><h2>${en ? "Intelligence & Evidence" : "情报与证据"}</h2>${evidence.length ? `<div class="evidence-hand-list">${evidence.map((card) => `<details class="evidence-card" data-testid="evidence-card-${escapeHtml(card.evidenceId)}"><summary><span><b>${escapeHtml(card.title)}</b><small>${escapeHtml(card.level)} · ${escapeHtml(card.visibility === "PRIVATE" ? (en ? "Private" : "仅你可见") : card.visibility)}</small></span><em>${escapeHtml(card.authenticity)}</em></summary><section><h3>${en ? "Can support" : "能够支持"}</h3>${array(card.supports).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}<h3>${en ? "Cannot prove" : "不能证明"}</h3>${array(card.cannotProve).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}<small>${en ? "Source route" : "取得路线"}：${escapeHtml(card.sourceLabel)}</small></section></details>`).join("")}</div>` : `<p class="evidence-empty">${en ? "Investigations can turn world traces into private evidence cards." : "派遣调查后，世界痕迹会变成你可以隐瞒、交换或公开的私人证据牌。"}</p>`}</section>`;
}

function renderManeuverV1Guard(guard, en) {
  if (!guard) return "";
  return `<div class="maneuver-guard" data-testid="maneuver-guard"><b>${en ? "This move is not ready" : "这项谋划暂时不能预演"}</b><p>${escapeHtml(guard)}</p></div>`;
}

function urgencyLabel(lead, en) {
  if (lead.urgency === "NOW") return en ? "Fading now" : "正在消失";
  if (lead.urgency === "THIS_TURN") return en ? "This scene" : "本场景有效";
  return en ? "Persistent" : "持续存在";
}

function cardStatusLabel(card, en) {
  if (card.status === "AVAILABLE") return en ? "Available" : "可用";
  if (card.status === "COOLDOWN") return en ? "Cooling down" : "冷却中";
  if (card.status === "LOCKED") return en ? "Set / locked" : "已伏置或锁定";
  return en ? "Consumed" : "已消耗";
}

function statusLabel(status, en) {
  const labels = en
    ? { PENDING: "In progress", ARMED: "Set", RESOLVED: "Resolved", EXPIRED: "Expired" }
    : { PENDING: "推进中", ARMED: "已伏置", RESOLVED: "已揭晓", EXPIRED: "已失效" };
  return labels[status] || status;
}

function selected(current, value) {
  return current === value ? "selected" : "";
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function lineBreaks(value) {
  return escapeHtml(value).replaceAll("\n", "<br>");
}
