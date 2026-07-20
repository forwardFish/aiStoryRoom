import { renderTransitionScreen } from "./transition-screen.js";

export function renderContinuousStoryV2(root, state) {
  const p = state.projection;
  const turn = p.currentTurn;
  root.innerHTML = `<div class="causal-shell continuous-game-shell story-v2-shell" data-testid="continuous-story-v2-shell">
    <header class="causal-topbar"><a class="mw-brand" href="/">Our Many Worlds</a><div class="top-day">${turn ? `宏观阶段 ${turn.stageIndex} · ${esc(turn.title)}` : "我的故事已经完成"}</div><div class="top-actions"><span>世界事件 #${p.worldSequence}</span><a href="/">返回主页</a></div></header>
    <div class="status-strip continuous-status-strip"><span>我的角色 <b>${esc(p.player.roleName)}</b></span><span>宏观剧情阶段 <b>${turn?.stageIndex || 7} / 7</b></span><span>本角色第 <b>${turn?.turnIndex || "—"}</b> 次行动</span><span class="metric-gold">行动后立即单独推演</span></div>
    <aside class="causal-left">${identity(p)}${facts(turn)}${holdings(p)}${timeline(p.timeline)}</aside>
    <main class="causal-center continuous-center">${center(p, state)}</main>
    <aside class="causal-right continuous-right">${actors(p)}${commitments(p)}${conditions(p)}${control(p, state)}</aside>
    ${state.error ? `<div class="banner error-banner" data-testid="v2-error"><span>${esc(state.error)}</span><button data-v2-dismiss type="button">×</button></div>` : ""}
    ${state.notice ? `<div class="banner notice-banner" data-testid="v2-notice"><span>${esc(state.notice)}</span></div>` : ""}
  </div>`;
}

function center(p, state) {
  if (state.result) return resultView(state.result);
  const latestResult = [...p.timeline].reverse().find((entry) => entry.kind === "RESULT");
  if (p.completed) return `<section class="v2-story-stage"><article class="v2-complete" data-testid="v2-complete"><span>你的角色故事已经走完</span><h1>七个宏观阶段中的每次真实行动，已经写入这条人生线</h1><p>行动次数由故事实际发展决定，并不固定为七次。其他角色可以继续自己的故事；你不需要等他们结束，就能查看自己的完整经历。</p><button class="continuous-primary" data-v2-result type="button">查看我的完整故事</button></article>${latestResult ? `<article class="v2-last-result" data-testid="v2-latest-result"><span>最后一次行动的真实结果 · 世界事件 #${latestResult.worldSequence}</span><div>${paragraphs(latestResult.content)}</div></article>` : ""}</section>`;
  const turn = p.currentTurn;
  if (!turn) return renderTransitionScreen({
    eyebrow: "STORY SYNC",
    title: "Restoring Your Storyline",
    description: "Rebuilding the latest world events and the consequences visible to your role.",
    status: "Synchronizing your story...",
    testId: "v2-restoring-story",
    inline: true
  });
  const locked = !p.control.canHumanAct || state.busy || p.access.state === "REQUIRES_UNLOCK";
  const intentReady = Boolean(state.intent?.objective?.trim() && state.intent?.method?.trim()?.length >= 6 && state.intent?.target?.id);
  return `<section class="v2-story-stage" data-testid="v2-story-and-decisions">
    ${latestResult ? `<article class="v2-last-result" data-testid="v2-latest-result"><span>上一行动的真实结果 · 世界事件 #${latestResult.worldSequence}</span><p>${paragraphs(latestResult.content)}</p></article>` : ""}
    ${interactionRequests(p, locked)}
    <article class="v2-situation" data-testid="v2-current-story"><span>你此刻看到的局势</span><h1>${esc(turn.title)}</h1><div>${paragraphs(turn.narrative)}</div></article>
    ${p.access.state === "REQUIRES_UNLOCK" ? unlock(p, state) : `<section class="v2-decisions" data-testid="v2-current-decisions"><header><div><span>你的真实决策</span><h2>${esc(turn.framing || "在这个情境里，你准备怎么做？")}</h2></div><small>这些行动来自当前剧情、你的身份权限和已知事实</small></header>
      <div class="v2-decision-list">${turn.decisions.map((decision, index) => decisionCard(decision, index, state.selectedCandidateId, locked)).join("")}</div>
      ${turn.customActionAllowed ? `<button class="v2-custom-start" data-v2-custom-start type="button" ${locked ? "disabled" : ""}>不用建议，我要自己决定</button>` : ""}
      ${state.intent ? intentEditor(p, state, locked) : `<div class="v2-intent-empty"><b>先选一项真实行动，或选择“自己决定”</b><span>选项只是可编辑的行动草案，不是固定答案。</span></div>`}
      <button class="continuous-primary" data-v2-submit type="button" ${locked || !intentReady || (!state.selectedCandidateId && !state.customAction.trim()) ? "disabled" : ""}>${state.busy ? "正在推演这次行动……" : state.interactionId ? "回应并立即推演" : "作出决策并立即推演"}</button>
    </section>`}
    ${!p.control.canHumanAct ? `<div class="v2-agent-state"><b>角色 Agent 正在沿着这条剧情线继续行动</b><span>它不等待其他角色；你也可以随时接管回来。</span></div>` : ""}
  </section>`;
}

function identity(p) {
  return `<section class="causal-panel player continuous-identity"><h2>我的身份</h2><h3>${esc(p.player.roleName)}</h3><p>${esc(p.player.identity)}</p><b>真正想守住的东西</b><p>${esc(p.player.personalGoal)}</p></section>`;
}

function facts(turn) {
  const values = turn?.visibleFacts || [];
  return `<section class="causal-panel v2-facts"><h2>我现在确实知道</h2>${values.length ? `<ul>${values.map((fact) => `<li>${esc(fact.content)}</li>`).join("")}</ul>` : "<p>暂时没有新增的可靠事实。</p>"}</section>`;
}

function holdings(p) {
  const values = p.visibleAssets || [];
  return `<section class="causal-panel v2-holdings"><h2>我真正持有的筹码</h2>${values.length ? values.map((asset) => `<article><b>${esc(asset.label)}</b><span>${esc(asset.kind)} · ${asset.quantity} · ${esc(asset.status)}</span></article>`).join("") : "<p>当前没有可直接投入的筹码；不能凭空使用未持有资源。</p>"}</section>`;
}

function timeline(entries) {
  const values = entries.slice(-8).reverse();
  return `<section class="causal-panel continuous-history v2-timeline"><h2>我的故事时间线</h2>${values.map((entry) => `<article><b>#${entry.worldSequence}</b><span>${esc(entry.title)}</span><em>${esc(short(entry.content, 54))}</em></article>`).join("")}</section>`;
}

function actors(p) {
  return `<section class="maneuver-panel continuous-party"><div class="maneuver-heading"><h2>同一世界里的角色</h2><span>各自推进</span></div><div class="room-formal-party-list">${p.otherActors.map((actor) => `<article class="${actor.roleId === p.player.roleId ? "mine" : ""}"><div><b>${esc(actor.roleName)}</b><small>自己的故事走到第 ${actor.stageIndex} 章</small></div><em>${actor.controllerKind === "AI" ? "Agent" : "真人"}</em></article>`).join("")}</div><p class="room-party-help">任何角色都不用等其他人交卷。跨角色影响会以故事事件进入对方尚未决定的局势。</p></section>`;
}

function commitments(p) {
  const values = p.commitments || [];
  return `<section class="maneuver-panel v2-commitments"><div class="maneuver-heading"><h2>真实承诺</h2><span>${values.length}</span></div>${values.length ? values.map((item) => `<article><b>${esc(item.issuerRoleName)} → ${esc(item.receiverRoleName)}</b><p>${esc(item.content)}</p><small>${esc(item.status)}${item.expiresAtStage ? ` · 第 ${item.expiresAtStage} 阶段前` : ""}</small></article>`).join("") : "<p>尚无需要追踪履行或背弃的承诺。</p>"}</section>`;
}

function conditions(p) {
  const values = p.armedConditions || [];
  return `<section class="maneuver-panel v2-conditions"><div class="maneuver-heading"><h2>已经布置的后手</h2><span>${values.length}</span></div>${values.length ? values.map((item) => `<article><b>当“${esc(item.eventType)}”发生</b><p>${esc(item.fallbackMethod || "按已登记的办法行动")}</p><small>${item.expiresAtStage ? `最迟第 ${item.expiresAtStage} 阶段` : "持续有效"}</small></article>`).join("") : "<p>尚未布置条件行动。</p>"}</section>`;
}

function control(p, state) {
  const human = p.control.canHumanAct;
  return `<section class="maneuver-panel continuous-control"><div class="maneuver-heading"><h2>角色控制</h2><span>${human ? "由我决定" : "Agent 推进中"}</span></div><p>${human ? "你的下一次提交会立即产生结果剧情和新的局势。" : "Agent 只能使用这个角色当前获准知道的事实和能力。"}</p><button type="button" ${state.busy ? "disabled" : ""} class="${human ? "continuous-danger" : "continuous-primary compact"}" ${human ? "data-v2-handoff" : "data-v2-reclaim"}>${human ? "暂时交给 Agent" : "立即接管我的角色"}</button></section>`;
}

function decisionCard(value, index, selected, locked) {
  return `<button type="button" data-v2-decision="${esc(value.id)}" class="continuous-action-card ${selected === value.id ? "selected" : ""}" ${locked ? "disabled" : ""}><b>${String.fromCharCode(65 + index)}</b><span><strong>${esc(value.label)}</strong><small>${esc(value.description)}</small><em>${value.targetRoleName ? `对象：${esc(value.targetRoleName)} · ` : ""}风险：${risk(value.risk)} · 公开度：${visibility(value.visibility)} · 依据：${esc(value.authorityBasis)}</em><i>想得到：${esc(value.intendedOutcome || value.intent)}</i><i>实际代价：${esc(value.concreteCost || "行动会留下可追查的责任")}</i><i>对方可能：${esc(value.expectedCountermove || "根据自己的处境回应")}</i></span></button>`;
}

function interactionRequests(p, locked) {
  const values = p.pendingInteractions || [];
  if (!values.length) return "";
  return `<section class="v2-interactions" data-testid="v2-pending-interactions"><header><span>有人正在等你的真实回应</span><h2>回应不会阻塞任何人的剧情线</h2></header>${values.map((item) => `<article><b>${esc(item.sourceRoleName)}提出：${esc(item.pressure)}</b>${item.observableTrace ? `<p>${esc(item.observableTrace)}</p>` : ""}<div>${item.responseOptions.map((option) => `<button type="button" data-v2-interaction="${esc(item.id)}" data-v2-interaction-option="${esc(option.id)}" ${locked ? "disabled" : ""}><strong>${esc(option.label)}</strong><span>${esc(option.description)}</span></button>`).join("")}</div></article>`).join("")}</section>`;
}

function intentEditor(p, state, locked) {
  const intent = state.intent;
  const selectedTarget = `${intent.target?.type || ""}:${intent.target?.id || ""}`;
  const targets = p.currentTurn?.availableTargets || [];
  const assets = p.visibleAssets || [];
  const fallback = intent.fallback?.method || "";
  const condition = intent.condition?.eventType || "";
  return `<section class="v2-intent-editor" data-testid="v2-intent-editor">
    <header><div><span>${state.interactionId ? "你准备怎样回应" : state.selectedCandidateId ? "检查并修改这项行动" : "写下你真正要做的行动"}</span><h3>系统裁决结果，但不能替你改目标</h3></div><small>目标、对象、方法、筹码、公开度和后手会原样进入推演</small></header>
    <label><b>我要改变什么</b><input data-v2-objective maxlength="600" value="${esc(intent.objective || "")}" ${locked ? "disabled" : ""} placeholder="例如：在日落前固定两册粮账矛盾的责任人"></label>
    <label><b>我要对谁或什么行动</b><select data-v2-target ${locked ? "disabled" : ""}>${targets.map((target) => `<option value="${esc(`${target.type}:${target.id}`)}" ${selectedTarget === `${target.type}:${target.id}` ? "selected" : ""}>${esc(target.label)}</option>`).join("")}</select></label>
    <label class="wide"><b>我实际怎么做</b><textarea data-v2-custom maxlength="1200" ${locked ? "disabled" : ""} placeholder="写清经手人、文书或交涉路径；不要直接宣布成功。">${esc(intent.method || "")}</textarea></label>
    <label><b>行动公开到什么程度</b><select data-v2-visibility ${locked ? "disabled" : ""}>${visibilityOptions(intent.visibility)}</select></label>
    <label><b>我愿意承担的风险</b><select data-v2-risk ${locked ? "disabled" : ""}>${riskOptions(intent.riskTolerance)}</select></label>
    <fieldset class="wide"><legend>本次真正投入的筹码</legend>${assets.length ? assets.map((asset) => `<label><input type="checkbox" data-v2-leverage value="${esc(asset.assetKey)}" ${intent.leverageKeys?.includes(asset.assetKey) ? "checked" : ""} ${locked || asset.status !== "ACTIVE" || asset.quantity < 1 ? "disabled" : ""}>${esc(asset.label)}（${asset.quantity}）</label>`).join("") : "<span>没有可投入筹码；系统不会凭空补给。</span>"}</fieldset>
    <label class="wide"><b>如果第一方案受阻，我的后手</b><input data-v2-fallback maxlength="600" value="${esc(fallback)}" ${locked ? "disabled" : ""} placeholder="可留空；填写时说明受阻后实际改用什么办法"></label>
    <label class="wide"><b>只有发生什么，才自动执行后手</b><input data-v2-condition maxlength="120" value="${esc(condition)}" ${locked ? "disabled" : ""} placeholder="可留空；例如：巡抚公开否认收到粮册"></label>
  </section>`;
}

function visibilityOptions(value) { return [["PRIVATE", "只有我知道"], ["LIMITED", "只让相关角色知道"], ["OBSERVABLE", "别人只看得到痕迹"], ["PUBLIC", "公开行动和立场"]].map(([key, label]) => `<option value="${key}" ${value === key ? "selected" : ""}>${label}</option>`).join(""); }
function riskOptions(value) { return [["LOW", "低：优先保全"], ["MEDIUM", "中：接受可控代价"], ["HIGH", "高：接受公开问责或失去筹码"]].map(([key, label]) => `<option value="${key}" ${value === key ? "selected" : ""}>${label}</option>`).join(""); }
function visibility(value) { return value === "PUBLIC" ? "公开" : value === "OBSERVABLE" ? "只留痕迹" : value === "LIMITED" ? "有限知情" : "秘密"; }

function unlock(p, state) {
  return `<section class="v2-unlock"><h2>这条故事线需要真人授权继续</h2><p>解锁属于同一个世界状态，不会把角色拉回“等待其他人”的公共回合。</p><button type="button" class="continuous-primary" data-v2-unlock ${!p.access.canCurrentUserUnlock || state.busy ? "disabled" : ""}>使用 ${p.access.requiredCredits} 点继续</button></section>`;
}

function resultView(value) {
  return `<section class="v2-result" data-testid="v2-personal-result"><span>${esc(value.player?.roleName || "我的角色")}</span><h1>我的完整故事</h1>${(value.story || []).map((entry) => `<article><small>世界事件 #${entry.worldSequence ?? 0}</small><div>${paragraphs(entry.content)}</div></article>`).join("")}<p>剧情质量检查：${value.quality?.passed || 0} / ${value.quality?.total || 0} 通过</p><a class="continuous-primary" href="/rooms">返回我的故事局</a></section>`;
}

function paragraphs(value) { return String(value || "").split(/\n{2,}/).filter(Boolean).map((part) => `<p>${esc(part)}</p>`).join(""); }
function risk(value) { return value === "HIGH" ? "高" : value === "LOW" ? "低" : "中"; }
function short(value, length) { const text = String(value || "").replace(/\s+/g, " "); return text.length > length ? `${text.slice(0, length)}…` : text; }
function esc(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;"); }
