import assert from "node:assert/strict";
import test from "node:test";
import {
  bindManeuverInputs,
  buildManeuverCommand,
  emptyManeuverDrafts,
  prepareManeuverDraft,
  renderFourManeuverPanel,
  resolveManeuverEntry,
  synchronizeManeuverDrafts,
  validateManeuverCommand,
} from "../public/maneuver-four-ui.js";

function section(overrides = {}) {
  return {
    enabled: true,
    usedToday: false,
    count: 0,
    disabledReason: null,
    options: [],
    ...overrides,
  };
}

function panel(overrides = {}) {
  return {
    sceneKey: "scene-1",
    enabled: true,
    disabledReason: null,
    quota: { perDay: 2, usedToday: 0, remaining: 2, usedTypesToday: [] },
    contact: section(),
    investigate: section(),
    leverage: section(),
    custom: { enabled: true, usedToday: false, disabledReason: null, maxLength: 200 },
    ...overrides,
  };
}

function view(panelOverrides = {}, viewOverrides = {}) {
  return {
    run: { currentDay: 1, status: "awaiting_decision", version: 10 },
    activeDecision: { decisionKey: "scene-1" },
    maneuverPanel: panel(panelOverrides),
    ...viewOverrides,
  };
}

function state(overrides = {}) {
  return {
    activeManeuverType: null,
    maneuverDrafts: emptyManeuverDrafts(),
    maneuverPreview: null,
    maneuverGuard: null,
    busy: false,
    resolving: false,
    ...overrides,
  };
}

function optionPanel() {
  return panel({
    contact: section({
      count: 99,
      options: [
        {
          roleKey: "actor-a",
          displayName: "人物甲",
          publicIdentity: "公开身份甲",
          relevance: "当前值得联系的原因甲",
          portrait: "portrait-a",
        },
        {
          roleKey: "actor-b",
          displayName: "人物乙",
          publicIdentity: "公开身份乙",
          relevance: "当前值得联系的原因乙",
          portrait: "portrait-b",
        },
      ],
    }),
    investigate: section({
      count: 9,
      options: [{ intentKey: "trace-a", title: "调查甲", summary: "当前异常甲" }],
    }),
    leverage: section({
      count: 7,
      options: [{
        leverageKey: "card-a",
        label: "筹码甲",
        description: "一次性秘密筹码",
        consumptionLabel: "使用后消失",
        requiresTarget: true,
        targets: [{ roleKey: "actor-a", displayName: "人物甲" }],
      }],
    }),
    custom: { enabled: true, usedToday: false, disabledReason: null, maxLength: 160 },
  });
}

test("entry availability follows the authoritative panel and canonical reason priority", () => {
  const authoritative = view({
    quota: { perDay: 2, usedToday: 1, remaining: 0, usedTypesToday: ["contact"] },
    contact: section({
      enabled: false,
      usedToday: true,
      disabledReason: "当前没有可交谈人物",
      options: [{ roleKey: "still-listed" }],
    }),
  });

  assert.equal(
    resolveManeuverEntry(authoritative, state({ busy: true }), "contact").disabledReason,
    "正在处理主动谋划",
  );
  assert.equal(
    resolveManeuverEntry(authoritative, state(), "contact").disabledReason,
    "今日机会已用完",
  );

  authoritative.maneuverPanel.quota.remaining = 1;
  assert.equal(
    resolveManeuverEntry(authoritative, state(), "contact").disabledReason,
    "今日已使用人物交谈",
  );

  authoritative.maneuverPanel.contact.usedToday = false;
  authoritative.maneuverPanel.quota.usedTypesToday = [];
  assert.equal(
    resolveManeuverEntry(authoritative, state(), "contact").disabledReason,
    "当前无可交谈人物",
  );

  authoritative.maneuverPanel.enabled = false;
  authoritative.maneuverPanel.disabledReason = "故事已经结束";
  authoritative.maneuverPanel.contact.disabledReason = "故事已经结束";
  assert.equal(
    resolveManeuverEntry(authoritative, state(), "contact").disabledReason,
    "今日剧情已结束",
  );
});

test("each maneuver type displays its canonical server-disabled reason", () => {
  const p = panel({
    contact: section({ enabled: false, disabledReason: "当前没有可交谈人物" }),
    investigate: section({ enabled: false, disabledReason: "当前没有可调查事项" }),
    leverage: section({ enabled: false, disabledReason: "当前剧情没有合适的出牌时机" }),
    custom: { enabled: false, usedToday: false, disabledReason: "当前阶段不能自拟谋划", maxLength: 200 },
  });
  const current = { maneuverPanel: p };

  assert.equal(resolveManeuverEntry(current, state(), "contact").disabledReason, "当前无可交谈人物");
  assert.equal(resolveManeuverEntry(current, state(), "investigate").disabledReason, "当前无调查事项");
  assert.equal(resolveManeuverEntry(current, state(), "leverage").disabledReason, "当前无合适出牌时机");
  assert.equal(resolveManeuverEntry(current, state(), "custom").disabledReason, "当前不能自拟");
});

test("global panel authority blocks validation even if a section is internally enabled", () => {
  const current = view({
    enabled: false,
    disabledReason: "故事已经结束",
    contact: section({ enabled: true, options: [{ roleKey: "actor-a" }] }),
  });
  const validation = validateManeuverCommand({
    maneuverType: "contact",
    targetRoleKey: "actor-a",
    messageText: "请说明情况。",
  }, current);

  assert.deepEqual(validation, { reason: "今日剧情已结束" });
});

test("front end does not infer enabled state from displayed counts or run fields", () => {
  const current = view({
    enabled: true,
    contact: section({
      enabled: false,
      count: 2,
      disabledReason: "当前没有可交谈人物",
      options: [{ roleKey: "actor-a" }, { roleKey: "actor-b" }],
    }),
  }, {
    run: { currentDay: 99, status: "finished", version: 99 },
    activeDecision: null,
  });

  const entry = resolveManeuverEntry(current, state(), "contact");
  assert.equal(entry.enabled, false, "section.enabled remains authoritative even with two projected options");
  assert.equal(entry.count, 2, "display count still reflects the exact authoritative option list");
});

test("entry quantities always match the candidates rendered in each workbench", () => {
  const current = { maneuverPanel: optionPanel() };
  const currentState = state();
  const closed = renderFourManeuverPanel(current, currentState);
  assert.match(closed, /data-maneuver-type="contact" data-option-count="2"/);
  assert.match(closed, /data-maneuver-type="investigate" data-option-count="1"/);
  assert.match(closed, /data-maneuver-type="leverage" data-option-count="1"/);
  assert.doesNotMatch(closed, /data-option-count="99"|data-option-count="9"|data-option-count="7"/);

  currentState.activeManeuverType = "contact";
  const contacts = renderFourManeuverPanel(current, currentState);
  assert.equal((contacts.match(/data-contact-role=/g) || []).length, 2);

  currentState.activeManeuverType = "investigate";
  const investigations = renderFourManeuverPanel(current, currentState);
  assert.equal((investigations.match(/data-investigation-key=/g) || []).length, 1);

  currentState.activeManeuverType = "leverage";
  const leverage = renderFourManeuverPanel(current, currentState);
  assert.equal((leverage.match(/data-leverage-key=/g) || []).length, 1);
});

test("disabled entries cannot switch workbenches while enabled entries only switch state", () => {
  function fakeButton(type, disabled) {
    const handlers = new Map();
    return {
      disabled,
      dataset: { maneuverType: type },
      addEventListener(name, handler) { handlers.set(name, handler); },
      click() { handlers.get("click")?.({ target: this }); },
    };
  }
  const disabled = fakeButton("contact", true);
  const enabled = fakeButton("investigate", false);
  const root = {
    querySelectorAll(selector) {
      return selector === "[data-maneuver-type]" ? [disabled, enabled] : [];
    },
    querySelector() { return null; },
  };
  const switched = [];
  let rendered = 0;
  bindManeuverInputs({
    root,
    state: state(),
    render: () => { rendered += 1; },
    chooseManeuver: (type) => switched.push(type),
  });

  disabled.click();
  enabled.click();
  assert.deepEqual(switched, ["investigate"]);
  assert.equal(rendered, 0, "opening an entry does not submit or render through an action callback");
});

test("contact workbench keeps the established layout and uses only projected public fields", () => {
  const current = { maneuverPanel: optionPanel() };
  const currentState = state({ activeManeuverType: "contact" });

  const beforeSelection = renderFourManeuverPanel(current, currentState);
  assert.match(beforeSelection, /人物甲/);
  assert.match(beforeSelection, /公开身份甲/);
  assert.match(beforeSelection, /当前值得联系的原因甲/);
  assert.match(beforeSelection, /portrait-a/);
  assert.doesNotMatch(beforeSelection, /预计回应|暴露风险|接触方式|证据权限/);
  assert.equal(beforeSelection.includes("id=\"contactMessageText\""), true);
  assert.match(beforeSelection, /开始交谈/);
  assert.match(beforeSelection, /class="contact-row/);

  currentState.maneuverDrafts.contact.targetRoleKey = "actor-a";
  currentState.maneuverDrafts.contact.messageText = "请说明当前记录。";
  const selected = renderFourManeuverPanel(current, currentState);
  assert.match(selected, /id="contactMessageText"/);
  assert.match(selected, /请说明当前记录。/);
  assert.match(selected, /开始与人物甲交谈/);
  assert.equal((selected.match(/class="contact-row selected"/g) || []).length, 1);
});

test("contact validation and command building preserve the real messageText", () => {
  const current = { maneuverPanel: optionPanel() };
  const currentState = state({ activeManeuverType: "contact" });

  assert.deepEqual(
    validateManeuverCommand(buildManeuverCommand(currentState), current),
    { reason: "请先选择要交谈的人物。" },
  );
  currentState.maneuverDrafts.contact.targetRoleKey = "actor-a";
  assert.deepEqual(
    validateManeuverCommand(buildManeuverCommand(currentState), current),
    { reason: "请写下要对这个人物说的话。" },
  );
  currentState.maneuverDrafts.contact.messageText = "  请说明当前记录。  ";
  const command = buildManeuverCommand(currentState);
  assert.deepEqual(command, {
    maneuverType: "contact",
    targetRoleKey: "actor-a",
    messageText: "  请说明当前记录。  ",
  });
  assert.equal(validateManeuverCommand(command, current), null);
});

test("other workbenches use only projected resources and action-specific copy", () => {
  const current = { maneuverPanel: optionPanel() };
  const currentState = state({ activeManeuverType: "investigate" });
  prepareManeuverDraft(currentState, current, "investigate");
  const investigate = renderFourManeuverPanel(current, currentState);
  assert.match(investigate, /调查甲/);
  assert.match(investigate, /当前异常甲/);
  assert.match(investigate, />派遣调查</);
  assert.doesNotMatch(investigate, /textarea/);

  currentState.activeManeuverType = "leverage";
  prepareManeuverDraft(currentState, current, "leverage");
  const leverage = renderFourManeuverPanel(current, currentState);
  assert.match(leverage, /筹码甲/);
  assert.match(leverage, /一次性秘密筹码/);
  assert.match(leverage, /使用“筹码甲”/);
  assert.doesNotMatch(leverage, /textarea/);

  currentState.activeManeuverType = "custom";
  const custom = renderFourManeuverPanel(current, currentState);
  assert.match(custom, /maxlength="160"/);
  assert.match(custom, /0 \/ 160/);
  assert.match(custom, />执行谋划</);
});

test("missing authoritative projection closes an already-open workbench", () => {
  const currentState = state({ activeManeuverType: "contact" });
  const html = renderFourManeuverPanel({ maneuverState: { maneuverOpportunitiesRemaining: 2 } }, currentState);

  assert.equal(currentState.activeManeuverType, null);
  assert.equal(html.includes("maneuver-contact-workbench"), false);
  assert.match(html, /主动谋划暂不可用，请刷新页面后重试/);
});

test("latest projection replaces stale selections while preserving user text", () => {
  const currentState = state({ activeManeuverType: "contact" });
  currentState.maneuverDrafts.contact = {
    targetRoleKey: "actor-a",
    messageText: "这段草稿必须保留。",
  };
  const first = { run: { version: 10 }, maneuverPanel: optionPanel() };
  synchronizeManeuverDrafts(currentState, first);
  assert.equal(currentState.maneuverDrafts.contact.targetRoleKey, "actor-a");

  const nextPanel = optionPanel();
  nextPanel.contact = section({
    enabled: true,
    count: 1,
    options: [{
      roleKey: "actor-c",
      displayName: "人物丙",
      publicIdentity: "公开身份丙",
      relevance: "新投影中的唯一候选",
    }],
  });
  const next = { run: { version: 11 }, maneuverPanel: nextPanel };
  const html = renderFourManeuverPanel(next, currentState);

  assert.equal(currentState.maneuverDrafts.contact.targetRoleKey, "");
  assert.equal(currentState.maneuverDrafts.contact.messageText, "这段草稿必须保留。");
  assert.match(html, /data-maneuver-type="contact" data-option-count="1"/);
  assert.match(html, /人物丙/);
  assert.doesNotMatch(html, /人物甲|人物乙/);

  nextPanel.contact.enabled = false;
  nextPanel.contact.disabledReason = "今日已使用人物交谈";
  renderFourManeuverPanel(next, currentState);
  assert.equal(currentState.activeManeuverType, null, "Confirm/refresh projection closes a now-disabled workbench");
});
