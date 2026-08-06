from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BRANCH = os.environ.get("TARGET_BRANCH", "feat/mvp-four-maneuver-actions")


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(value.rstrip() + "\n", encoding="utf-8")


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if source.count(old) != 1:
        raise RuntimeError(f"{label}: expected one anchor, found {source.count(old)}")
    return source.replace(old, new, 1)


def replace_between(source: str, start: str, end: str, replacement: str, label: str) -> str:
    a = source.find(start)
    b = source.find(end, a + len(start)) if a >= 0 else -1
    if a < 0 or b < 0:
        raise RuntimeError(f"{label}: boundary missing")
    return source[:a] + replacement.rstrip() + "\n" + source[b:]


def run(command: str) -> None:
    print(f"$ {command}", flush=True)
    result = subprocess.run(command, cwd=ROOT, shell=True, text=True)
    if result.returncode:
        raise SystemExit(result.returncode)


MANEUVER_UI = r'''const TYPES = ["contact", "investigate", "leverage", "custom"];

export function emptyManeuverDrafts() {
  return {
    contact: { targetRoleKey: "", messageText: "" },
    investigate: { intentKey: "" },
    leverage: { leverageKey: "", targetRoleKey: "" },
    custom: { customText: "" }
  };
}

export function prepareManeuverDraft(state, view, maneuverType) {
  state.maneuverDrafts ||= emptyManeuverDrafts();
  const panel = view?.maneuverPanel || {};
  if (maneuverType === "investigate" && !state.maneuverDrafts.investigate.intentKey && panel.investigate?.options?.length === 1) {
    state.maneuverDrafts.investigate.intentKey = panel.investigate.options[0].intentKey;
  }
  if (maneuverType === "contact" && !state.maneuverDrafts.contact.targetRoleKey && panel.contact?.options?.length === 1) {
    state.maneuverDrafts.contact.targetRoleKey = panel.contact.options[0].roleKey;
  }
  if (maneuverType === "leverage" && !state.maneuverDrafts.leverage.leverageKey && panel.leverage?.options?.length === 1) {
    const option = panel.leverage.options[0];
    state.maneuverDrafts.leverage.leverageKey = option.leverageKey;
    if (option.targets?.length === 1) state.maneuverDrafts.leverage.targetRoleKey = option.targets[0].roleKey;
  }
}

export function clearManeuverDraft(state, maneuverType) {
  state.maneuverDrafts ||= emptyManeuverDrafts();
  state.maneuverDrafts[maneuverType] = emptyManeuverDrafts()[maneuverType];
  state.activeManeuverType = null;
}

export function buildManeuverCommand(state) {
  const type = state.activeManeuverType;
  const drafts = state.maneuverDrafts || emptyManeuverDrafts();
  if (type === "contact") return { maneuverType: type, ...drafts.contact };
  if (type === "investigate") return { maneuverType: type, ...drafts.investigate };
  if (type === "leverage") return { maneuverType: type, ...drafts.leverage };
  if (type === "custom") return { maneuverType: type, ...drafts.custom };
  return null;
}

export function validateManeuverCommand(command, view) {
  if (!command) return { reason: "请先选择一种主动谋划。" };
  const section = view?.maneuverPanel?.[command.maneuverType];
  if (!section?.enabled) return { reason: section?.disabledReason || view?.maneuverPanel?.disabledReason || "当前不能执行这项主动谋划。" };
  if (command.maneuverType === "contact") {
    if (!command.targetRoleKey) return { reason: "请先选择要交谈的人物。" };
    if (!String(command.messageText || "").trim()) return { reason: "请写下要对这个人物说的话。" };
  }
  if (command.maneuverType === "investigate" && !command.intentKey) return { reason: "请选择一项调查。" };
  if (command.maneuverType === "leverage") {
    if (!command.leverageKey) return { reason: "请选择一张筹码。" };
    const option = section.options?.find((item) => item.leverageKey === command.leverageKey);
    if (option?.requiresTarget && !command.targetRoleKey) return { reason: "请选择筹码使用对象。" };
  }
  if (command.maneuverType === "custom" && !String(command.customText || "").trim()) return { reason: "请写下要主动推进的一件事。" };
  return null;
}

export function bindManeuverInputs({ root, state, render, chooseManeuver }) {
  root.querySelectorAll("[data-maneuver-type]").forEach((button) => button.addEventListener("click", () => chooseManeuver(button.dataset.maneuverType)));
  root.querySelectorAll("[data-contact-role]").forEach((button) => button.addEventListener("click", () => {
    state.maneuverDrafts.contact.targetRoleKey = button.dataset.contactRole || "";
    render();
  }));
  root.querySelector("#contactMessageText")?.addEventListener("input", (event) => { state.maneuverDrafts.contact.messageText = event.target.value; });
  root.querySelectorAll("[data-investigation-key]").forEach((button) => button.addEventListener("click", () => {
    state.maneuverDrafts.investigate.intentKey = button.dataset.investigationKey || "";
    render();
  }));
  root.querySelectorAll("[data-leverage-key]").forEach((button) => button.addEventListener("click", () => {
    const leverageKey = button.dataset.leverageKey || "";
    state.maneuverDrafts.leverage.leverageKey = leverageKey;
    const option = state.view?.maneuverPanel?.leverage?.options?.find((item) => item.leverageKey === leverageKey);
    state.maneuverDrafts.leverage.targetRoleKey = option?.targets?.length === 1 ? option.targets[0].roleKey : "";
    render();
  }));
  root.querySelectorAll("[data-leverage-target]").forEach((button) => button.addEventListener("click", () => {
    state.maneuverDrafts.leverage.targetRoleKey = button.dataset.leverageTarget || "";
    render();
  }));
  root.querySelector("#customManeuverText")?.addEventListener("input", (event) => { state.maneuverDrafts.custom.customText = event.target.value; });
}

export function renderFourManeuverPanel(view, state) {
  const panel = view?.maneuverPanel || fallbackPanel(view);
  const active = state.activeManeuverType;
  const definitions = [
    ["contact", "人物交谈", `${panel.contact?.count || 0} 人`, "与当前相关人物交谈"],
    ["investigate", "派遣调查", `${panel.investigate?.count || 0} 项`, "调查当前剧情提供的异常"],
    ["leverage", "使用筹码", `${panel.leverage?.count || 0} 张`, "打出一张秘密筹码，用后消失"],
    ["custom", "自拟谋划", "", "自己决定要推进的一件事"]
  ];
  return `<section class="maneuver-panel maneuver-panel--mvp" data-testid="maneuver-panel">
    <div class="maneuver-heading"><h2>主动谋划</h2></div>
    <section class="maneuver-usage"><span>今日谋划</span><b>${number(panel.quota?.remaining)} / ${number(panel.quota?.perDay || 2)}</b><small>未使用机会将在今日结束时失效</small></section>
    <div class="maneuver-action-list">${definitions.map(([type, label, count, description]) => {
      const section = panel[type] || {};
      const disabled = !section.enabled;
      const subtitle = disabled ? section.disabledReason || panel.disabledReason || description : description;
      return `<button type="button" class="maneuver-action-card ${active === type ? "active" : ""} ${disabled ? "disabled" : ""}" data-maneuver-type="${type}" ${disabled ? "disabled" : ""} aria-pressed="${active === type}"><span><b>${label}</b><small>${escapeHtml(subtitle)}</small></span>${count ? `<em>${escapeHtml(count)}</em>` : ""}</button>`;
    }).join("")}</div>
    ${active ? renderWorkbench(view, state, active) : `<p class="maneuver-idle-hint">选择一种方式，为当前主线决策获得更多信息或创造新的条件。</p>`}
    ${state.maneuverGuard ? `<div class="maneuver-guard" data-testid="maneuver-guard"><b>这项谋划暂时不能执行</b><p>${escapeHtml(state.maneuverGuard.reason)}</p>${state.maneuverGuard.suggestedRewrite ? `<small>建议：${escapeHtml(state.maneuverGuard.suggestedRewrite)}</small>` : ""}</div>` : ""}
  </section>`;
}

function renderWorkbench(view, state, type) {
  const panel = view.maneuverPanel || {};
  const drafts = state.maneuverDrafts || emptyManeuverDrafts();
  if (type === "contact") {
    const draft = drafts.contact;
    const target = panel.contact.options?.find((item) => item.roleKey === draft.targetRoleKey);
    return `<section class="maneuver-workbench" data-testid="maneuver-contact-workbench"><div class="maneuver-workbench-head"><b>选择人物</b><small>列表里的人现在都可以交谈</small></div><div class="maneuver-option-list">${(panel.contact.options || []).map((item) => `<button type="button" class="maneuver-option-card ${draft.targetRoleKey === item.roleKey ? "selected" : ""}" data-contact-role="${escapeHtml(item.roleKey)}"><span class="contact-avatar ${escapeHtml(item.portrait || "")}" aria-hidden="true"></span><span><b>${escapeHtml(item.displayName)}</b><small>${escapeHtml(item.publicIdentity)} · ${escapeHtml(item.relevance)}</small></span></button>`).join("")}</div><textarea id="contactMessageText" maxlength="200" placeholder="你想对他说什么？">${escapeHtml(draft.messageText || "")}</textarea><button id="maneuverSubmit" type="button">${target ? `发送给${escapeHtml(target.displayName)}` : "开始交谈"}</button></section>`;
  }
  if (type === "investigate") {
    const draft = drafts.investigate;
    return `<section class="maneuver-workbench" data-testid="maneuver-investigate-workbench"><div class="maneuver-workbench-head"><b>选择调查</b><small>调查内容由当前剧情决定</small></div><div class="maneuver-option-list">${(panel.investigate.options || []).map((item) => `<button type="button" class="maneuver-option-card ${draft.intentKey === item.intentKey ? "selected" : ""}" data-investigation-key="${escapeHtml(item.intentKey)}"><span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.summary)}</small></span></button>`).join("")}</div><button id="maneuverSubmit" type="button">开始调查</button></section>`;
  }
  if (type === "leverage") {
    const draft = drafts.leverage;
    const option = panel.leverage.options?.find((item) => item.leverageKey === draft.leverageKey);
    return `<section class="maneuver-workbench" data-testid="maneuver-leverage-workbench"><div class="maneuver-workbench-head"><b>选择筹码</b><small>筹码整局有限，使用后永久消失</small></div><div class="maneuver-option-list">${(panel.leverage.options || []).map((item) => `<button type="button" class="maneuver-option-card ${draft.leverageKey === item.leverageKey ? "selected" : ""}" data-leverage-key="${escapeHtml(item.leverageKey)}"><span><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.description)}</small></span><em>${escapeHtml(item.consumptionLabel || "使用后消失")}</em></button>`).join("")}</div>${option?.requiresTarget ? `<div class="maneuver-target-list"><b>使用对象</b>${(option.targets || []).map((target) => `<button type="button" class="${draft.targetRoleKey === target.roleKey ? "selected" : ""}" data-leverage-target="${escapeHtml(target.roleKey)}">${escapeHtml(target.displayName)}</button>`).join("")}</div>` : ""}<button id="maneuverSubmit" type="button">${option ? `使用并消耗“${escapeHtml(option.label)}”` : "使用筹码"}</button></section>`;
  }
  const value = drafts.custom.customText || "";
  return `<section class="maneuver-workbench" data-testid="maneuver-custom-workbench"><div class="maneuver-workbench-head"><b>自拟谋划</b><small>写下一项当前身份和资源允许的行动</small></div><textarea id="customManeuverText" maxlength="200" placeholder="输入你的谋划……">${escapeHtml(value)}</textarea><span class="maneuver-counter">${value.length} / 200</span><button id="maneuverSubmit" type="button">执行谋划</button></section>`;
}

export function renderLeverageHand(view) {
  const items = view?.leverageHand?.items || [];
  return `<section class="causal-panel leverage-panel"><h2 class="panel-heading"><span>我的筹码</span></h2>${items.length ? `<ul>${items.map((item) => `<li><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.description)}</small></li>`).join("")}</ul>` : `<p>你的筹码已经全部使用。</p>`}</section>`;
}

function fallbackPanel(view) {
  const remaining = Number(view?.maneuverState?.maneuverOpportunitiesRemaining || 0);
  const reason = remaining > 0 ? "主动谋划配置正在加载" : "今日谋划机会已用完";
  const section = { enabled: false, usedToday: false, count: 0, disabledReason: reason, options: [] };
  return { enabled: false, disabledReason: reason, quota: { perDay: 2, remaining, usedToday: 2 - remaining, usedTypesToday: [] }, contact: section, investigate: section, leverage: section, custom: { enabled: false, usedToday: false, disabledReason: reason, maxLength: 200 } };
}

function number(value) { return Math.max(0, Number(value) || 0); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
'''

P3_TEST = r'''import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createStoryApp } from "../public/app.js";

function panel({ remaining = 2, used = [] } = {}) {
  const disabled = (type) => remaining <= 0 || used.includes(type);
  return {
    sceneKey: "d4_1", enabled: remaining > 0, disabledReason: remaining > 0 ? null : "今日谋划机会已用完",
    quota: { perDay: 2, usedToday: 2 - remaining, remaining, usedTypesToday: used },
    contact: { enabled: !disabled("contact"), usedToday: used.includes("contact"), count: 2, disabledReason: disabled("contact") ? "今日已使用人物交谈" : null, options: [
      { roleKey: "county_magistrate", displayName: "卢象升", publicIdentity: "清流县令", relevance: "掌管本次复核涉及的县衙原册", portrait: "art-avatar-county" },
      { roleKey: "merchant", displayName: "江南商会会首", publicIdentity: "商会代表", relevance: "暗账直接涉及商会地号", portrait: "art-avatar-merchant" }
    ] },
    investigate: { enabled: !disabled("investigate"), usedToday: used.includes("investigate"), count: 1, disabledReason: disabled("investigate") ? "今日已使用派遣调查" : null, options: [{ intentKey: "inspect_land_register_binding", title: "核对田亩底册装订", summary: "复核清单与县衙旧册存在差异。" }] },
    leverage: { enabled: !disabled("leverage"), usedToday: used.includes("leverage"), count: 1, disabledReason: disabled("leverage") ? "今日已使用使用筹码" : null, options: [{ leverageKey: "land_contract_fragment", label: "田契暗账（半页）", description: "触发一次围绕具体地号的特殊回应。", consumptionLabel: "使用后消失", requiresTarget: true, targets: [{ roleKey: "merchant", displayName: "江南商会会首" }] }] },
    custom: { enabled: !disabled("custom"), usedToday: used.includes("custom"), disabledReason: disabled("custom") ? "今日已使用自拟谋划" : null, maxLength: 200 }
  };
}

class Storage {
  constructor() {
    this.calls = [];
    this.view = {
      run: { id: "run-1", title: "桑田诏", currentDay: 4, currentTime: "清晨", totalDays: 7, status: "awaiting_decision", version: 1, decisionsCompletedToday: 0, decisionsRequiredToday: 2, totalDecisionsCompleted: 6, totalDecisionsRequired: 12 },
      player: { roleName: "浙江总督", leverage: ["田契暗账（半页）"] }, leverageHand: { availableCount: 1, items: [{ leverageKey: "land_contract_fragment", label: "田契暗账（半页）", description: "触发一次围绕具体地号的特殊回应。" }] },
      messages: [{ id: "m1", day: 4, time: "清晨", type: "system", label: "剧情", title: "暗账浮出", body: "县令送来两页田契副本。" }],
      activeDecision: { messageId: "d4_1", decisionKey: "d4_1", title: "如何使用暗账", options: [{ key: "A", title: "补证" }] },
      dashboard: { worldState: [], risks: [], relationships: [] }, maneuverState: { maneuverOpportunitiesPerDay: 2, maneuversUsedToday: 0, maneuverOpportunitiesRemaining: 2, totalManeuversUsed: 0, usedLeverageKeys: [] }, maneuverPanel: panel(), decisionHistory: [], daySummary: null, daySummaries: {}, finalJudgement: null
    };
  }
  async restoreOrCreate() { return structuredClone(this.view); }
  async getRun() { return structuredClone(this.view); }
  async submitManeuver(view, input) {
    this.calls.push(input);
    const used = [...view.maneuverPanel.quota.usedTypesToday, input.maneuverType];
    this.view = structuredClone(view);
    this.view.run.version += 1;
    this.view.maneuverPanel = panel({ remaining: view.maneuverPanel.quota.remaining - 1, used });
    this.view.maneuverState.maneuverOpportunitiesRemaining -= 1;
    this.view.messages.push({ id: `r-${this.calls.length}`, day: 4, time: "主动谋划", type: "maneuver_result", label: "主动谋划", title: "谋划结果", body: "行动已经产生回应。" });
    if (input.maneuverType === "leverage") { this.view.leverageHand = { availableCount: 0, items: [] }; }
    return structuredClone(this.view);
  }
}

async function appWithStorage(storage = new Storage()) {
  const dom = new JSDOM("<!doctype html><main id=app></main>", { url: "http://game.test/game?debug=1" });
  dom.window.__AI_STORY_STREAM_IMMEDIATE__ = true;
  const root = dom.window.document.getElementById("app");
  const app = createStoryApp({ root, window: dom.window, storage });
  await app.boot();
  return { dom, root, app, storage };
}

async function flush() { await new Promise((resolve) => setTimeout(resolve, 0)); }

test("default panel keeps four actions visible and no workbench open", async () => {
  const { root } = await appWithStorage();
  assert.equal(root.querySelectorAll("[data-maneuver-type]").length, 4);
  assert.equal(root.querySelector(".maneuver-workbench"), null);
  assert.match(root.textContent, /主动谋划/);
});

test("contact sends messageText without an AI preview step", async () => {
  const { root, storage } = await appWithStorage();
  root.querySelector('[data-maneuver-type="contact"]').click();
  root.querySelector('[data-contact-role="county_magistrate"]').click();
  const input = root.querySelector("#contactMessageText");
  input.value = "原始底册是否完整？";
  input.dispatchEvent(new root.ownerDocument.defaultView.Event("input", { bubbles: true }));
  root.querySelector("#maneuverSubmit").click();
  await flush();
  assert.equal(storage.calls.length, 1);
  assert.deepEqual(storage.calls[0], { maneuverType: "contact", targetRoleKey: "county_magistrate", messageText: "原始底册是否完整？" });
});

test("investigation is fixed and has no free-text question", async () => {
  const { root, storage } = await appWithStorage();
  root.querySelector('[data-maneuver-type="investigate"]').click();
  assert.ok(root.querySelector('[data-testid="maneuver-investigate-workbench"]'));
  assert.equal(root.querySelector("textarea"), null);
  root.querySelector("#maneuverSubmit").click();
  await flush();
  assert.equal(storage.calls[0].intentKey, "inspect_land_register_binding");
});

test("leverage only selects card and target, then disappears after success", async () => {
  const { root, storage } = await appWithStorage();
  root.querySelector('[data-maneuver-type="leverage"]').click();
  root.querySelector('[data-leverage-key="land_contract_fragment"]').click();
  root.querySelector('[data-leverage-target="merchant"]').click();
  assert.equal(root.querySelector("textarea"), null);
  root.querySelector("#maneuverSubmit").click();
  await flush();
  assert.deepEqual(storage.calls[0], { maneuverType: "leverage", leverageKey: "land_contract_fragment", targetRoleKey: "merchant" });
  assert.doesNotMatch(root.textContent, /田契暗账（半页）/);
});

test("custom maneuver keeps its text when ActionGuard rejects", async () => {
  const storage = new Storage();
  storage.submitManeuver = async (_view, input) => ({ accepted: false, reason: "超出阶段边界", rewriteSuggestion: "改为暗查驿站" });
  const { root } = await appWithStorage(storage);
  root.querySelector('[data-maneuver-type="custom"]').click();
  const input = root.querySelector("#customManeuverText");
  input.value = "命令巡抚立即认罪";
  input.dispatchEvent(new root.ownerDocument.defaultView.Event("input", { bubbles: true }));
  root.querySelector("#maneuverSubmit").click();
  await flush();
  assert.match(root.textContent, /超出阶段边界/);
  assert.equal(root.querySelector("#customManeuverText").value, "命令巡抚立即认罪");
});
'''

SUBMIT = r'''  async function submitManeuver() {
    if (!state.view || state.busy || Number(state.view.run.currentDay) >= FINAL_DAY) return;
    const command = buildManeuverCommand(state);
    const validation = validateManeuverCommand(command, state.view);
    if (validation) {
      state.maneuverGuard = validation;
      render();
      return;
    }
    const submittedType = command.maneuverType;
    state.maneuverGuard = null;
    state.error = "";
    state.notice = "";
    state.busy = true;
    render();
    try {
      const previousView = state.view;
      const result = await storage.submitManeuver(state.view, command);
      if (result.accepted === false) {
        state.maneuverGuard = { reason: result.reason || "这项谋划暂时无法执行。", suggestedRewrite: result.rewriteSuggestion || result.suggestedRewrite || "" };
      } else {
        const resultKind = completedResultKind(previousView, result);
        acceptView(result);
        clearManeuverDraft(state, submittedType);
        if (resultKind === "maneuver") startManeuverResultStream(result);
        else if (resultKind === "decision") startResultStream(result);
      }
    } catch (error) {
      if (isVersionConflict(error)) {
        state.busy = false;
        await refresh({ conflict: true });
        return;
      }
      if (error?.code === "ACTION_BLOCKED") {
        const blocked = error.details?.message && typeof error.details.message === "object" ? error.details.message : error.details;
        state.maneuverGuard = { reason: blocked?.reason || error.message || "这项谋划暂时不能执行。", suggestedRewrite: blocked?.rewriteSuggestion || "" };
      } else {
        state.error = errorMessage(error);
      }
    } finally {
      state.busy = false;
      render();
    }
  }
'''

CHOOSE = r'''  function chooseManeuver(maneuverType) {
    const section = state.view?.maneuverPanel?.[maneuverType];
    state.maneuverGuard = null;
    if (!section?.enabled) {
      state.maneuverGuard = { reason: section?.disabledReason || state.view?.maneuverPanel?.disabledReason || "当前不能执行这项主动谋划。" };
      render();
      return false;
    }
    state.activeManeuverType = state.activeManeuverType === maneuverType ? null : maneuverType;
    if (state.activeManeuverType) prepareManeuverDraft(state, state.view, maneuverType);
    render();
    return true;
  }
'''

CSS = r'''
/* Simplified four-maneuver MVP */
.maneuver-panel--mvp { padding: 14px; }
.maneuver-action-list { display: grid; gap: 8px; margin-top: 10px; }
.maneuver-action-card { width: 100%; min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 12px; border: 1px solid #d8c3a5; border-radius: 7px; background: rgba(255,251,244,.88); color: #493522; text-align: left; }
.maneuver-action-card span { display: grid; gap: 4px; }
.maneuver-action-card b { font-size: 15px; }
.maneuver-action-card small { color: #77624a; font-size: 12px; line-height: 1.35; }
.maneuver-action-card em { min-width: 36px; color: #8d6632; font-style: normal; font-weight: 700; text-align: right; }
.maneuver-action-card.active { border-color: #9d7339; box-shadow: inset 3px 0 #9d7339; background: #fbf0dc; }
.maneuver-action-card.disabled { opacity: .52; }
.maneuver-idle-hint { margin: 12px 2px 2px; color: #7a6750; font-size: 12px; line-height: 1.5; }
.maneuver-workbench { display: grid; gap: 9px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #ddcbb2; }
.maneuver-workbench-head { display: flex; align-items: end; justify-content: space-between; gap: 10px; }
.maneuver-workbench-head small { color: #806b53; font-size: 11px; text-align: right; }
.maneuver-option-list { display: grid; gap: 7px; }
.maneuver-option-card { width: 100%; display: flex; align-items: center; gap: 9px; padding: 9px; border: 1px solid #dfcdb5; border-radius: 6px; background: #fffaf1; color: #4c3926; text-align: left; }
.maneuver-option-card > span:not(.contact-avatar) { display: grid; gap: 3px; flex: 1; }
.maneuver-option-card small { color: #78634b; font-size: 11px; line-height: 1.4; }
.maneuver-option-card em { color: #9b7137; font-size: 11px; font-style: normal; }
.maneuver-option-card.selected, .maneuver-target-list button.selected { border-color: #9d7339; background: #f8ead1; box-shadow: inset 3px 0 #9d7339; }
.maneuver-workbench textarea { width: 100%; min-height: 76px; padding: 9px 10px; resize: vertical; border: 1px solid #d7c3a6; border-radius: 6px; background: #fffaf1; color: #3f2e1d; }
.maneuver-workbench > button#maneuverSubmit { min-height: 40px; border: 1px solid #8f6734; border-radius: 6px; background: #9b7138; color: #fffaf0; font-weight: 700; }
.maneuver-target-list { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.maneuver-target-list > b { width: 100%; font-size: 12px; }
.maneuver-target-list button { padding: 6px 9px; border: 1px solid #d8c3a5; border-radius: 5px; background: #fffaf1; color: #55402a; }
.maneuver-counter { justify-self: end; color: #8a745a; font-size: 11px; }
.leverage-panel li { display: grid; gap: 3px; margin: 8px 0; }
.leverage-panel li small { color: #75624d; font-size: 11px; line-height: 1.4; }
'''


def main() -> None:
    run("git config user.name 'ChatGPT Pro Stage Runner'")
    run("git config user.email 'actions@users.noreply.github.com'")

    write("apps/web/public/maneuver-four-ui.js", MANEUVER_UI)
    write("apps/web/tests/maneuver-ui.test.mjs", P3_TEST)

    storage_path = "apps/web/public/api-story-storage.js"
    storage = read(storage_path)
    storage = replace_between(storage, "  async submitManeuver(view, input) {", "\n  async startCriticalResponse", '''  async submitManeuver(view, input) {
    this.assertView(view);
    const maneuverType = String(input?.maneuverType || "");
    const body = maneuverType === "contact"
      ? { maneuverType, targetRoleKey: String(input.targetRoleKey || ""), messageText: String(input.messageText || "").trim() }
      : maneuverType === "investigate"
        ? { maneuverType, intentKey: String(input.intentKey || "") }
        : maneuverType === "leverage"
          ? { maneuverType, leverageKey: String(input.leverageKey || ""), targetRoleKey: String(input.targetRoleKey || "") }
          : { maneuverType: "custom", customText: String(input.customText || "").trim() };
    const payload = await this.request(`/v4/story-runs/${encodeURIComponent(view.run.id)}/maneuvers`, {
      method: "POST",
      body: {
        ...body,
        version: view.run.version,
        idempotencyKey: input.idempotencyKey || globalThis.crypto?.randomUUID?.() || `maneuver-${Date.now()}`
      }
    });
    if (payload?.accepted === false) return payload;
    this.assertView(payload);
    return payload;
  }
''', "ApiStoryStorage submitManeuver")
    write(storage_path, storage)

    app_path = "apps/web/public/app.js"
    app = read(app_path)
    app = replace_once(app, 'import { navigateToFreshSoloRun, renderPlayAgainDialog } from "./solo-run-lifecycle.js?v=20260806-play-again-v3";\n', 'import { navigateToFreshSoloRun, renderPlayAgainDialog } from "./solo-run-lifecycle.js?v=20260806-play-again-v3";\nimport { bindManeuverInputs, buildManeuverCommand, clearManeuverDraft, emptyManeuverDrafts, prepareManeuverDraft, renderFourManeuverPanel, renderLeverageHand, validateManeuverCommand } from "./maneuver-four-ui.js?v=20260806-mvp-four-v1";\n', "maneuver ui import")
    app = replace_once(app, '    maneuverDraft: { maneuverType: "custom", targetRoleKey: "county_magistrate", intentKey: "", leverageKey: "", customText: "" },\n', '    activeManeuverType: null,\n    maneuverDrafts: emptyManeuverDrafts(),\n', "maneuver state")
    app = replace_between(app, "  async function submitManeuver() {", "\n  async function startCriticalResponse", SUBMIT, "submit maneuver")
    app = replace_between(app, "  function chooseManeuver(", "\n  async function advanceDay", CHOOSE, "choose maneuver")
    app = replace_once(app, '  function acceptView(view) {\n    stopResultStream();\n    stopOpeningStream();\n    state.view = view;\n', '  function acceptView(view) {\n    const previousSceneKey = state.view?.maneuverPanel?.sceneKey || null;\n    stopResultStream();\n    stopOpeningStream();\n    state.view = view;\n    if (previousSceneKey && previousSceneKey !== view?.maneuverPanel?.sceneKey) state.activeManeuverType = null;\n', "accept view scene reset")
    old_bind = '''    root.querySelectorAll("[data-maneuver-type]:not([data-maneuver-direct])").forEach((button) => button.addEventListener("click", () => chooseManeuver(button.dataset.maneuverType, button.dataset.targetRole || "", button.dataset.leverageKey || "")));
    root.querySelectorAll("[data-maneuver-direct]").forEach((button) => button.addEventListener("click", () => {
      chooseManeuver(button.dataset.maneuverType, button.dataset.targetRole || "", button.dataset.leverageKey || "", button.dataset.intentKey || "");
    }));
    root.querySelector("#maneuverType")?.addEventListener("change", (event) => { state.maneuverDraft.maneuverType = event.target.value; render(); });
    root.querySelector("#maneuverTarget")?.addEventListener("change", (event) => { state.maneuverDraft.targetRoleKey = event.target.value; });
    root.querySelector("#maneuverLeverage")?.addEventListener("change", (event) => { state.maneuverDraft.leverageKey = event.target.value; });
    root.querySelector("#maneuverCustomText")?.addEventListener("input", (event) => { state.maneuverDraft.customText = event.target.value; });
'''
    app = replace_once(app, old_bind, '    bindManeuverInputs({ root, state, render, chooseManeuver });\n', "maneuver bindings")
    app = replace_between(app, "function renderManeuverPanel(view, state) {", "\nfunction renderManeuverGuard", 'function renderManeuverPanel(view, state) {\n  return renderFourManeuverPanel(view, state);\n}\n', "render maneuver panel")
    app = replace_between(app, "function renderLeverage(view) {", "\nfunction renderRisks", 'function renderLeverage(view) {\n  return renderLeverageHand(view);\n}\n', "render leverage hand")
    write(app_path, app)

    css_path = "apps/web/public/main-game.css"
    css = read(css_path)
    if "/* Simplified four-maneuver MVP */" not in css:
      css += CSS
    write(css_path, css)

    package_path = "apps/web/package.json"
    package = json.loads(read(package_path))
    if "public/maneuver-four-ui.js" not in package["scripts"]["typecheck"]:
      package["scripts"]["typecheck"] = package["scripts"]["typecheck"].replace("node --check public/api-story-storage.js", "node --check public/api-story-storage.js && node --check public/maneuver-four-ui.js")
    write(package_path, json.dumps(package, ensure_ascii=False, indent=2))

    run("pnpm --filter @apps/web typecheck")
    run("node --test --test-isolation=none apps/web/tests/maneuver-ui.test.mjs")

    (ROOT / ".github/workflows/maneuver-p3.yml").unlink(missing_ok=True)
    (ROOT / "scripts/automation/apply-maneuver-p3.py").unlink(missing_ok=True)
    run("git add -A")
    run("git commit -m 'feat(web): implement simplified four-maneuver flows'")
    run(f"git push origin HEAD:{BRANCH}")


if __name__ == "__main__":
    main()
