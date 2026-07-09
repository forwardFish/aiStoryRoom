(() => {
  const state = {
    lastDecisionTitle: "",
    hasDecisionResult: false,
    hasRecall: false
  };

  const ROLE_MODELS = [
    "巡抚：害怕总督掌握暗账，倾向抢先进度、越级报功，被压制时会反咬总督。",
    "县令：害怕证据被压下，倾向递密信、保留副本、等待更完整证据。",
    "商会：害怕成为替罪羊，倾向用粮银换保护，并保留入府记录。",
    "司礼监：关注银路与奏报差异，会把口径不一视为介入机会。"
  ];

  function getText(selector) {
    return Array.from(document.querySelectorAll(selector)).map((node) => node.textContent || "").join("\n");
  }

  function inferCurrentDecision() {
    const text = getText(".message-card, .decision-panel");
    const history = getText(".message-card.decision_result");
    if (/追加密奏|密奏/.test(text)) return "追加密奏";
    if (/商会|平粮|放粮/.test(text)) return "借商会平粮";
    if (/暗账|田契|证据/.test(text)) return "处理暗账证据";
    if (/截留奏疏|截留/.test(text)) return "截留奏疏";
    return history.match(/执行「([^」]+)」/)?.[1] || "关键决策";
  }

  function buildCausalCard(title) {
    if (/密奏/.test(title)) {
      return {
        decisionTitle: "追加密奏",
        decisionSummary: "你没有截留巡抚急奏，而是另写密奏给皇帝，建立浙江不可躁进的口径。",
        personalEcho: "你保留了未来解释权：如果粮价和民怨后来坐实，你可以证明自己早已预警。",
        othersEcho: "巡抚会意识到你没有拦他，却在京师留了另一套说法。",
        worldEcho: "京师将收到两份口径不同的浙江奏报，司礼监开始注意浙江内部并不一致。",
        traces: ["总督密奏", "通政司递送记录", "奏报口径不一"],
        risks: ["内阁可能认为你越级自保", "巡抚可能把你定性为拖延国策"]
      };
    }
    if (/商会|粮/.test(title)) {
      return {
        decisionTitle: title,
        decisionSummary: "你动用了商会或粮路来稳住眼前局势。",
        personalEcho: "你短期获得稳粮筹码，但也让商会有机会把自己包装成替朝廷分忧的人。",
        othersEcho: "商会会保留接触记录，县令会怀疑你是在清弊还是在控制清弊。",
        worldEcho: "粮价可能暂缓，但官商关系的缝隙开始被县衙与司礼监同时看见。",
        traces: ["商会入府记录", "放粮传话", "粮价变化账册"],
        risks: ["县令可能保留证据副本", "商会被查时可能拿总督府传话自保"]
      };
    }
    return {
      decisionTitle: title,
      decisionSummary: `你选择「${title}」，这一步被写入局势账本。`,
      personalEcho: "你改变了总督府的解释空间，也调整了自己承担责任的方式。",
      othersEcho: "巡抚、县令、商会会根据自己的利益重新判断你。",
      worldEcho: "浙江局势继续向御前裁决收束，奏报、粮价和暗账开始互相牵连。",
      traces: ["总督府文移", "幕僚记录", "相关角色目击"],
      risks: ["这一步可能被不同角色重新定性"]
    };
  }

  function panel(title, body, extraClass = "") {
    return `<section class="side-panel ${extraClass}"><h2>${title}</h2>${body}</section>`;
  }

  function renderCard(card) {
    return panel("因果回响", `
      <span class="causal-overlay-badge">CausalVisibilityEngine</span>
      <h3>${escapeHtml(card.decisionTitle)}</h3>
      <p class="causal-summary">${escapeHtml(card.decisionSummary)}</p>
      <dl>
        <dt>个人回响</dt><dd>${escapeHtml(card.personalEcho)}</dd>
        <dt>他人回响</dt><dd>${escapeHtml(card.othersEcho)}</dd>
        <dt>世界回响</dt><dd>${escapeHtml(card.worldEcho)}</dd>
        <dt>潜在风险</dt><dd>${escapeHtml(card.risks.join("；"))}</dd>
      </dl>
    `, "causal-overlay-panel");
  }

  function renderTrace(card) {
    return panel("留下的痕迹", `<ul class="token-list">${card.traces.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`, "trace-overlay-panel");
  }

  function renderRoleModel() {
    return panel("角色真实动机", `<ul class="risk-list">${ROLE_MODELS.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`, "role-model-overlay-panel");
  }

  function renderRecall(card) {
    const hasAdvanced = /因果回响|暗账浮出|局势继续推进|第 4 天/.test(getText(".message-card, .top-day"));
    if (!hasAdvanced) return "";
    return panel("因果回溯", `
      <p>这件事并非凭空而来。你之前的「${escapeHtml(card.decisionTitle)}」当时有合理收益：${escapeHtml(card.personalEcho)}</p>
      <p class="pressure">但现在，它也可能被重新定性为：${escapeHtml(card.risks[0] || "对手叙事的一部分")}。</p>
    `, "recall-overlay-panel");
  }

  function renderOverlay() {
    const rightRail = document.querySelector(".right-rail");
    if (!rightRail) return;
    const decisionResultText = getText(".message-card.decision_result, .message-card.causal_visible");
    const hasDecision = Boolean(decisionResultText.trim());
    const title = inferCurrentDecision();
    const card = buildCausalCard(title);

    document.querySelectorAll("[data-causal-overlay]").forEach((node) => node.remove());
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-causal-overlay", "true");
    wrapper.innerHTML = hasDecision
      ? `${renderCard(card)}${renderRecall(card)}${renderTrace(card)}${renderRoleModel()}`
      : panel("因果回响", "<p>提交关键决策后，这里会显示：你改变了谁、留下了什么痕迹、未来可能被谁重新定性。</p>", "causal-overlay-panel empty") + renderRoleModel();
    rightRail.insertBefore(wrapper, rightRail.children[1] || null);

    if (hasDecision && !state.hasDecisionResult) {
      state.hasDecisionResult = true;
      appendCausalMessage(card);
    }
  }

  function appendCausalMessage(card) {
    const stream = document.getElementById("messageStream");
    if (!stream || stream.querySelector("[data-generated-causal-message]")) return;
    const article = document.createElement("article");
    article.className = "message-card causal_visible";
    article.setAttribute("data-generated-causal-message", "true");
    article.innerHTML = `
      <div class="message-content">
        <div class="message-meta"><span class="type-badge">因果回响</span><span>决策后</span></div>
        <h3>你的选择留下了痕迹：${escapeHtml(card.decisionTitle)}</h3>
        <p>${escapeHtml(card.decisionSummary)}<br/>个人回响：${escapeHtml(card.personalEcho)}<br/>他人回响：${escapeHtml(card.othersEcho)}<br/>世界回响：${escapeHtml(card.worldEcho)}<br/>留下痕迹：${escapeHtml(card.traces.join("、"))}</p>
      </div>
      <b class="message-seal">因果</b>
    `;
    stream.appendChild(article);
    stream.scrollTop = stream.scrollHeight;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const observer = new MutationObserver(() => {
    window.requestAnimationFrame(renderOverlay);
  });

  function start() {
    observer.observe(document.body, { childList: true, subtree: true });
    renderOverlay();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
