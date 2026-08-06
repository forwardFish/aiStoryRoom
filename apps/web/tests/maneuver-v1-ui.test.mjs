import assert from "node:assert/strict";
import test from "node:test";
import {
  createManeuverV1UiState,
  createManeuverDraftV1,
  renderEvidenceHandV1,
  renderManeuverV1DecisionCard,
  renderManeuverV1Panel,
  validateManeuverV1Draft
} from "../public/maneuver-v1.js";

function view() {
  return {
    run: { id: "run-1", version: 7 },
    capabilities: {
      maneuverRulesV1: {
        schemaVersion: "maneuver_rules_projection_v1",
        enabled: true,
        window: {
          status: "OPEN",
          totalOpportunities: 2,
          remainingOpportunities: 2,
          formLimits: { conversationRemaining: 1, investigationRemaining: 1 },
          version: 4
        },
        contacts: [{ actorId: "actor.xunfu", displayName: "浙江巡抚", publicIdentity: "地方主官", whyRelevant: "他声称底册仍在档房" }],
        investigationLeads: [{
          traceId: "trace.cart",
          title: "昨夜的封箱车",
          narrativeHook: "雨势正在冲淡车辙。",
          urgency: "NOW",
          expiresAtLabel: "本场景结束后可能消失",
          routes: [{
            routeId: "route.registry",
            label: "查阅后门出入簿",
            narrativeMethod: "核对时辰、登记人和领车签名",
            mayLearn: ["离开时辰", "领车人"],
            cannotProve: ["箱内内容", "巡抚本人直接下令"],
            costLabels: ["幕僚 1"],
            returnLabel: "本场景锁定前",
            possibleTrail: "档房书记可能知道有人翻查记录"
          }]
        }],
        ruleCards: [{
          cardAssetKey: "card.seal",
          label: "总督封缄令牌",
          status: "AVAILABLE",
          timing: ["ACTIVE", "SET", "REACTION"],
          guaranteedEffects: ["普通差役必须停止继续搬运"],
          limitations: ["不能追回已经离开的文件"],
          legalTargets: [{ id: "location.archive", label: "巡抚衙门档房", type: "LOCATION" }],
          triggerOptions: [{ triggerPatternId: "document_transfer_attempt", label: "有人试图转移文件" }]
        }],
        evidenceCards: [{
          evidenceId: "evidence.registry",
          title: "昨夜封箱车出门记录",
          level: "佐证",
          authenticity: "SUPPORTED",
          supports: ["子时三刻有一辆封箱车离开"],
          cannotProve: ["箱内是原始底册"],
          visibility: "PRIVATE",
          sourceLabel: "查阅后门出入簿"
        }],
        pendingActions: [],
        reactions: [{
          reactionId: "reaction.cart-moving",
          storyNotice: {
            title: "档房后门出现了封箱马车",
            narrative: "两名亲信正在把三个封箱搬上马车。你无法确认箱内装的是什么。"
          },
          options: [
            { optionId: "intercept", label: "命兵丁拦下马车", description: "公开阻止车辆离开。" }
          ],
          eligibleCardAssetKeys: ["card.seal"],
          customAllowed: true,
          holdAllowed: true
        }]
      }
    }
  };
}

test("new maneuver panel exposes exactly four bounded active entries and authoritative opportunities", () => {
  const ui = createManeuverV1UiState();
  const html = renderManeuverV1Panel(view(), ui);
  assert.match(html, /本场景谋划/);
  assert.match(html, /2 \/ 2/);
  for (const label of ["人物交谈", "派遣调查", "筹码布局", "自拟谋划"]) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, />应变</);
  assert.doesNotMatch(html, />保留</);
  assert.equal((html.match(/data-mv1-kind=/g) || []).length, 4);
});

test("investigation is trace-driven and shows route limits before preview", () => {
  const ui = createManeuverV1UiState();
  ui.activeKind = "INVESTIGATION";
  ui.drafts.INVESTIGATION.traceId = "trace.cart";
  ui.drafts.INVESTIGATION.routeId = "route.registry";
  const html = renderManeuverV1Panel(view(), ui);
  assert.match(html, /昨夜的封箱车/);
  assert.match(html, /查阅后门出入簿/);
  assert.match(html, /可能查到/);
  assert.match(html, /不能证明/);
  assert.match(html, /巡抚本人直接下令/);
  assert.equal(validateManeuverV1Draft(ui, view().capabilities.maneuverRulesV1), "");
  assert.deepEqual(createManeuverDraftV1(ui), {
    schemaVersion: "maneuver_draft_v1",
    kind: "INVESTIGATION",
    traceId: "trace.cart",
    routeId: "route.registry",
    attachmentAssetKeys: []
  });
});

test("narrative preview card separates what starts from what remains uncertain", () => {
  const ui = createManeuverV1UiState();
  ui.currentVersion = 7;
  ui.currentWindowVersion = 4;
  ui.sourceVersion = 7;
  ui.sourceWindowVersion = 4;
  ui.decisionResult = {
    decision: "READY",
    previewId: "preview-1",
    presentation: {
      eyebrow: "浙江总督 · 私密谋划",
      title: "让沈砚查阅昨夜后门出入簿",
      narrative: "夜色落下后，你把沈砚叫进内厅。",
      sections: [
        { kind: "CAN_DO", label: "这一步可能查清", lines: ["封箱车离开的时辰"] },
        { kind: "CANNOT_GUARANTEE", label: "这一步不能证明", lines: ["箱内装的是原始底册"] },
        { kind: "MAY_LEAVE", label: "可能留下", lines: ["档房书记可能察觉"] }
      ],
      chips: [
        { kind: "COST", label: "1 次谋划" },
        { kind: "VISIBILITY", label: "结果仅你可见" }
      ],
      confirmLabel: "派沈砚去查",
      editLabel: "返回修改"
    }
  };
  const html = renderManeuverV1DecisionCard(ui);
  assert.match(html, /浙江总督 · 私密谋划/);
  assert.match(html, /这一步不能证明/);
  assert.match(html, /箱内装的是原始底册/);
  assert.match(html, /派沈砚去查/);
  assert.doesNotMatch(html, /targetId|worldSequence|contextHash/);
});

test("private evidence hand always states support and limits", () => {
  const html = renderEvidenceHandV1(view());
  assert.match(html, /情报与证据/);
  assert.match(html, /昨夜封箱车出门记录/);
  assert.match(html, /能够支持/);
  assert.match(html, /不能证明/);
  assert.match(html, /仅你可见/);
});

test("reaction is event-triggered and hold is not exposed as a fifth permanent action", () => {
  const ui = createManeuverV1UiState();
  const noticeHtml = renderManeuverV1Panel(view(), ui);
  assert.match(noticeHtml, /档房后门出现了封箱马车/);
  assert.match(noticeHtml, /data-mv1-open-reaction="reaction\.cart-moving"/);
  assert.equal((noticeHtml.match(/data-mv1-kind=/g) || []).length, 4);

  ui.activeKind = "REACTION";
  ui.drafts.REACTION.reactionId = "reaction.cart-moving";
  ui.drafts.REACTION.hold = true;
  const workbenchHtml = renderManeuverV1Panel(view(), ui);
  assert.match(workbenchHtml, /暂不应变/);
  assert.equal(validateManeuverV1Draft(ui, view().capabilities.maneuverRulesV1), "");
  assert.deepEqual(createManeuverDraftV1(ui), {
    schemaVersion: "maneuver_draft_v1",
    kind: "REACTION",
    reactionId: "reaction.cart-moving",
    hold: true
  });
});

test("split and reroute responses keep the user inside bounded rules", () => {
  const splitUi = createManeuverV1UiState();
  splitUi.decisionResult = {
    decision: "SPLIT_REQUIRED",
    reason: "这段谋划包含两项独立行动。",
    splitOptions: [
      { optionId: "seal", label: "封锁档房", draft: { schemaVersion: "maneuver_draft_v1", kind: "CUSTOM_PLAN", rawText: "封锁档房", attachmentAssetKeys: [] } },
      { optionId: "inspect", label: "核对记录", draft: { schemaVersion: "maneuver_draft_v1", kind: "INVESTIGATION", traceId: "trace.cart", routeId: "route.registry", attachmentAssetKeys: [] } }
    ]
  };
  const splitHtml = renderManeuverV1DecisionCard(splitUi);
  assert.match(splitHtml, /一次只能落一子/);
  assert.match(splitHtml, /data-mv1-split-option="seal"/);
  assert.match(splitHtml, /data-mv1-split-option="inspect"/);

  const rerouteUi = createManeuverV1UiState();
  rerouteUi.decisionResult = {
    decision: "REROUTE_REQUIRED",
    rerouteKind: "INVESTIGATION",
    reason: "这项谋划的主要效果是获得信息。",
    suggestedDraft: { schemaVersion: "maneuver_draft_v1", kind: "INVESTIGATION", traceId: "trace.cart", routeId: "route.registry", attachmentAssetKeys: [] }
  };
  const rerouteHtml = renderManeuverV1DecisionCard(rerouteUi);
  assert.match(rerouteHtml, /规则归类/);
  assert.match(rerouteHtml, /按建议规则继续/);
});

test("a preview becomes visibly stale and cannot be committed after the authoritative window changes", () => {
  const ui = createManeuverV1UiState();
  ui.sourceVersion = 7;
  ui.currentVersion = 8;
  ui.sourceWindowVersion = 4;
  ui.currentWindowVersion = 5;
  ui.decisionResult = {
    decision: "READY",
    previewId: "preview-stale",
    presentation: {
      eyebrow: "角色 · 私密落子",
      title: "封锁档房",
      narrative: "命令尚未提交。",
      sections: [],
      chips: [],
      confirmLabel: "确认封锁档房",
      editLabel: "返回修改"
    }
  };
  const html = renderManeuverV1DecisionCard(ui);
  assert.match(html, /局势已变化/);
  assert.match(html, /data-testid="action-preview-stale"/);
  assert.match(html, /data-mv1-preview-commit[^>]*disabled/);
});
