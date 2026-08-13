#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Chrome DOM-seam verification for Pressure Chapter Phase 1 v4.

Evidence class: LOCAL_DOM_SEAM_FIXTURE. This is deliberately not presented as
an authenticated real `/game` screenshot or production E2E run.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
VIEWER = "zhejiang_governor"
HASH = "a" * 64
FENCE = "b" * 64


def resolve_chrome(repo_root: Path = ROOT) -> str | None:
    """Resolve Chrome/Chromium using repo tooling, env, then OS probes."""

    for name in (
        "AI_STORY_CHROME_BIN",
        "CHROME_BIN",
        "GOOGLE_CHROME_BIN",
        "CHROMIUM_BIN",
        "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
        "EDGE_BIN",
    ):
        value = os.environ.get(name, "").strip()
        if value and Path(value).is_file():
            return value

    resolver = repo_root / "scripts/acceptance/chrome-binary-resolver.mjs"
    if resolver.is_file():
        try:
            module_url = json.dumps(resolver.as_uri())
            completed = subprocess.run(
                [
                    "node",
                    "--input-type=module",
                    "--eval",
                    f'import {{ resolveChromeBinary }} from {module_url}; process.stdout.write(resolveChromeBinary());',
                ],
                cwd=repo_root,
                check=True,
                capture_output=True,
                text=True,
                timeout=15,
            )
            candidate = completed.stdout.strip()
            if candidate and Path(candidate).is_file():
                return candidate
        except (OSError, subprocess.SubprocessError):
            pass

    for relative in (
        ".cache/browser/chrome-path.txt",
        ".cache/chrome-path.txt",
        "tmp/browser/chrome-path.txt",
    ):
        marker = repo_root / relative
        if marker.is_file():
            value = marker.read_text(encoding="utf-8").strip()
            if value and Path(value).is_file():
                return value

    for command in (
        "google-chrome-stable",
        "google-chrome",
        "chrome",
        "chromium",
        "chromium-browser",
        "microsoft-edge",
        "msedge",
    ):
        resolved = shutil.which(command)
        if resolved:
            return resolved

    candidates = [
        Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        Path("/Applications/Chromium.app/Contents/MacOS/Chromium"),
        Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
    ]
    for base in filter(None, (
        os.environ.get("PROGRAMFILES"),
        os.environ.get("PROGRAMFILES(X86)"),
        os.environ.get("LOCALAPPDATA"),
    )):
        root = Path(base)
        candidates.extend((
            root / "Google/Chrome/Application/chrome.exe",
            root / "Chromium/Application/chrome.exe",
            root / "Microsoft/Edge/Application/msedge.exe",
        ))
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return None


def action(code: str, label: str, entry: str, consumes: bool = True) -> dict[str, Any]:
    return {
        "code": code,
        "label": label,
        "preferredEntry": entry,
        "consumesManeuverOnSubmit": consumes,
    }


def card(card_type: str, event_id: str) -> dict[str, Any]:
    catalog: dict[str, tuple[Any, ...]] = {
        "CROSS_IMPACT": (
            "PURPLE",
            "他人的行动影响了你的处境",
            "送达总督府的粮册出现异常，部分页面可能被替换。",
            {"title": "影响", "lines": ["改桑进度暂时停滞", "皇帝信任下降 6"]},
            {"title": "你知道", "lines": ["来源尚未确认", "巡抚与县令都接触过账册"]},
            [
                action("INVESTIGATE_SOURCE", "派遣调查", "INVESTIGATE"),
                action("PUBLIC_QUESTION", "公开质问", "TALK"),
                action("DEFER", "暂不回应", "DEFER", False),
            ],
        ),
        "PROMISE_BROKEN": (
            "ORANGE_RED",
            "承诺破裂",
            "巡抚没有兑现承诺，县令只交出了转抄副本。",
            {"title": "结果", "lines": ["改革进度受阻", "皇帝信任风险上升"]},
            {"title": "你获得", "lines": ["巡抚手令抄录", "一次公开质问机会"]},
            [
                action("RETALIATE_NOW", "立即反击", "TALK"),
                action("HIDE_FOR_NOW", "暂时隐瞒", "PLAN"),
                action("HANDLE_LATER", "稍后处理", "DEFER", False),
            ],
        ),
        "CRISIS": (
            "ORANGE_RED",
            "你正在失去主持权",
            "皇帝信任已进入危险区间，再出现一次公开治理失败，你将失去改革主持权。",
            {"title": "危险来源", "lines": ["账册异常被朝廷注意", "巡抚提交的副本仍有疑点"]},
            {"title": "你可以", "lines": ["使用筹码稳定信任", "立即派遣调查"]},
            [
                action("RESPOND_NOW", "立刻应对", "TOKEN"),
                action("HANDLE_LATER", "稍后处理", "DEFER", False),
                action("VIEW_DETAILS", "查看详情", "INVESTIGATE", False),
            ],
        ),
        "STAGE_VICTORY": (
            "GREEN",
            "你夺回了主动权",
            "原始粮册已经落入你手中，巡抚暂时无法继续控制奏报口径。",
            {"title": "收益", "lines": ["改桑进度 +12", "你获得新的质问主动权"]},
            {"title": "对手受限", "lines": ["巡抚难以继续控制口径", "县令开始动摇"]},
            [
                action("CONTINUE_ADVANCE", "继续推进", "PLAN"),
                action("VIEW_LATER", "稍后查看", "DEFER", False),
                action("KEEP_LOW_PROFILE", "先保持低调", "DEFER", False),
            ],
        ),
    }
    accent, title, summary, block_a, block_b, actions = catalog[card_type]
    return {
        "id": f"card:{event_id}:{card_type}",
        "type": card_type,
        "accent": accent,
        "title": title,
        "summary": summary,
        "blockA": block_a,
        "blockB": block_b,
        "primaryAction": actions[0],
        "secondaryAction": actions[1],
        "tertiaryAction": actions[2],
        "sourceEventId": event_id,
    }


def feed_item(
    sequence: int,
    card_type: str = "CROSS_IMPACT",
    *,
    severity: str = "MAJOR",
    modal: bool = False,
) -> dict[str, Any]:
    event_id = f"evt-{card_type.lower()}-{sequence}"
    center = card(card_type, event_id)
    trigger_id = f"trigger-{card_type.lower()}"
    key_modal = None
    if modal:
        key_modal = {
            "id": f"modal:{event_id}",
            "type": card_type,
            "priority": {"CRISIS": 300, "PROMISE_BROKEN": 200, "STAGE_VICTORY": 100}[card_type],
            "triggerId": trigger_id,
            "stateVersion": sequence,
            "dedupeKey": f"{VIEWER}:{card_type}:{trigger_id}:{sequence}",
            "card": center,
        }
    return {
        "schemaVersion": "a_emotion_viewer_projection_v1",
        "eventId": event_id,
        "projectionVersion": 1,
        "roomId": "run-pressure",
        "runId": "run-pressure",
        "viewerSeatId": VIEWER,
        "category": "RELATED",
        "disclosure": "CONFIRMED" if modal else "HIDDEN",
        "severity": severity,
        "title": center["title"],
        "safeSummary": center["summary"],
        "statusLabel": "已确认" if modal else "来源未知",
        "visibleImpacts": [{"effectCode": "EMPEROR_TRUST_DELTA", "label": "皇帝信任", "value": "-6"}],
        "knownFactRefs": ["fact.viewer.safe"],
        "responseOptions": [center["primaryAction"], center["secondaryAction"], center["tertiaryAction"]],
        "recommendedPresentation": "KEY_MODAL" if modal else "FEED_ONLY",
        "centerCard": center,
        "keyModal": key_modal,
        "eventSequence": sequence,
        "occurredAt": "2026-08-12T12:00:00.000Z",
        "projectionHash": HASH,
        "isUnread": True,
        "isAcknowledged": False,
        "isResolved": False,
    }


def projection(items: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "schemaVersion": "pressure_chapter_game_projection_v1",
        "projectionVersion": 1,
        "roomId": "run-pressure",
        "runId": "run-pressure",
        "route": {
            "routeHash": HASH,
            "participantMode": "SOLO",
            "runtimeProfile": "PRESSURE_CHAPTER_V1",
            "contentPackageVersion": "sangtian-pressure-v1",
            "controlTopologyVersion": "six-seat-control-v1",
        },
        "chapter": {
            "chapterRuntimeId": "run-pressure:N1",
            "chapterId": "N1",
            "chapterNumber": 1,
            "title": "九堰将决",
            "phase": "ACTIVE",
            "workingRevision": 0,
        },
        "viewer": {
            "seatId": VIEWER,
            "roleName": "浙江总督",
            "control": {
                "mode": "HUMAN_ACTIVE",
                "controlEpoch": 1,
                "canSubmit": True,
                "canReclaim": False,
                "submissionFenceToken": FENCE,
                "reclaimFenceToken": None,
            },
        },
        "metrics": [
            {"trackId": "fiscal_military", "label": "国库银两", "value": 42, "displayValue": "42", "tone": "DEFAULT"},
            {"trackId": "civilian_land", "label": "民心", "value": 55, "displayValue": "55", "tone": "GOOD"},
            {"trackId": "evidence_responsibility", "label": "粮价", "value": 72, "displayValue": "72", "tone": "WARN"},
            {"trackId": "mulberry_silk", "label": "改桑进度", "value": 0, "displayValue": "0%", "tone": "GOOD"},
            {"trackId": "court_imperial_face", "label": "皇帝信任", "value": 43, "displayValue": "43", "tone": "DEFAULT"},
        ],
        "situation": {
            "goal": "获取原始粮册，保全治理合法权",
            "risk": "朝廷已关注账册异常",
            "judgment": "巡抚与县令都接触过账册",
        },
        "resources": [
            {"resourceId": "silver", "label": "银两", "value": 42, "displayValue": "42 万两"},
            {"resourceId": "grain", "label": "粮草", "value": 23, "displayValue": "23 万石"},
            {"resourceId": "soldiers", "label": "兵丁", "value": 4, "displayValue": "4/5"},
            {"resourceId": "staff", "label": "幕僚", "value": 4, "displayValue": "4 人"},
            {"resourceId": "reports", "label": "密报", "value": 2, "displayValue": "2 条"},
        ],
        "tokens": [{"tokenId": "seal", "label": "田契图纸（半页）", "description": "可作为田亩凭证", "quantity": 1, "available": True}],
        "decision": {
            "decisionPointId": "run-pressure:decision:N1",
            "mode": "SOLO_BEAT",
            "requirement": "REQUIRED",
            "title": "你要如何应对？",
            "summary": "你的选择会立即改变局势。",
            "expectedWorkingRevision": 0,
            "options": [
                {"code": "INVESTIGATE_SOURCE", "label": "由总督府复核清单", "description": "巡抚和县令只能派见证人参加。", "actionType": "INVESTIGATE_SOURCE", "preferredEntry": "INVESTIGATE"},
                {"code": "PUBLIC_QUESTION", "label": "先公开质问经手方", "description": "要求相关方说明账册流转。", "actionType": "PUBLIC_QUESTION", "preferredEntry": "TALK"},
                {"code": "RESPOND_NOW", "label": "使用筹码稳定信任", "description": "以现有凭证压住风险。", "actionType": "RESPOND_NOW", "preferredEntry": "TOKEN"},
                {"code": "CONTINUE_ADVANCE", "label": "继续推进", "description": "利用阶段成果规划下一步。", "actionType": "CONTINUE_ADVANCE", "preferredEntry": "PLAN"},
            ],
            "submitLabel": "提交决策",
            "customActionAllowed": True,
        },
        "capabilities": {
            "canSubmitDecision": True,
            "canTalk": True,
            "canInvestigate": True,
            "canUseToken": True,
            "canPlan": True,
            "canReclaimControl": False,
            "allowedActionTypes": ["INVESTIGATE_SOURCE", "PUBLIC_QUESTION", "RESPOND_NOW", "CONTINUE_ADVANCE", "RETALIATE_NOW", "HIDE_FOR_NOW", "VIEW_DETAILS"],
        },
        "narrative": {
            "status": "PUBLISHED",
            "projectionKind": "GENESIS_NARRATIVE",
            "sourceAuthority": "GENESIS",
            "sourceId": "run-pressure:genesis",
            "sourceCommitHash": HASH,
            "text": "嘉靖三十五年，粮册风波已经进入总督府。",
            "contentHash": HASH,
            "renderMode": "AUTHORED_FALLBACK",
        },
        "feedPage": {
            "schemaVersion": "a_emotion_feed_page_v1",
            "roomId": "run-pressure",
            "runId": "run-pressure",
            "viewerSeatId": VIEWER,
            "items": items,
            "unreadCount": sum(1 for item in items if item["isUnread"]),
            "nextCursor": None,
            "serverSequence": max([0, *[item["eventSequence"] for item in items]]),
        },
        "projectionHash": HASH,
    }


FIXTURE_HTML = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"></head>
<body><main id="app" class="causal-player-root"><div class="causal-shell" data-testid="story-shell">
<header class="causal-topbar"><b>Our Many Worlds</b><span>第 1 章</span></header>
<div class="status-strip"><span>国库银两 42</span><span>民心 55</span><span>粮价 72</span><span>改桑进度 0%</span><span>皇帝信任 43</span></div>
<aside class="causal-left"><section>当前目标</section><section>我的资源</section><section>我的筹码</section></aside>
<main class="causal-center"><section data-testid="decision-zone">你要如何应对？</section></main>
<aside class="causal-right"><section data-testid="situation-feed" aria-label="局势动向"><button id="feed-event" type="button">既有 Feed 事件</button></section><section data-testid="maneuver-panel" class="maneuver-panel"><div id="existing-workbench">既有工作区</div></section></aside>
</div></main></body></html>"""

# Test-only geometry for the already-approved shell seams. This is not a
# product renderer and is never represented as authenticated /game evidence.
FIXTURE_SHELL_CSS = """
:root { color-scheme: light; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
body { font-family: "Noto Sans SC", "Microsoft YaHei", "PingFang SC", Arial, sans-serif; color: #17204d; }
#app, .causal-shell { width: 100%; height: 100%; box-sizing: border-box; }
.causal-shell {
  display: grid;
  grid-template-columns: 292px minmax(0, 1fr) 350px;
  grid-template-rows: 58px 62px minmax(0, 1fr);
  gap: 12px;
  padding: 0 12px 12px;
  background: #fbfcff;
}
.causal-topbar { grid-column: 1 / -1; grid-row: 1; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid #e5e8f3; background: #fff; }
.status-strip { grid-column: 1 / -1; grid-row: 2; display: flex; align-items: center; justify-content: space-around; border: 1px solid #e3e7f2; border-radius: 12px; background: #fff; }
.causal-left { grid-column: 1; grid-row: 3; min-height: 0; overflow: auto; border: 1px solid #e3e7f2; border-radius: 12px; background: #fff; }
.causal-center { grid-column: 2; grid-row: 3; position: relative; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid #e3e7f2; border-radius: 12px; background: linear-gradient(180deg, #fbfcff, #f5f7fd); }
.causal-right { grid-column: 3; grid-row: 3; min-height: 0; overflow: auto; border: 1px solid #e3e7f2; border-radius: 12px; background: #fff; }
.causal-left > section, .causal-right > section { padding: 16px; border-bottom: 1px solid #edf0f7; }
[data-testid="decision-zone"] { box-sizing: border-box; width: min(560px, 86%); margin: 120px auto 0; padding: 24px; border: 1px solid #dddff0; border-radius: 18px; background: #fff; text-align: center; }
"""

MOUNT_SCRIPT = r"""
(() => {
  const memory = new Map();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem(key) { return memory.has(key) ? memory.get(key) : null; },
      setItem(key, value) { memory.set(key, String(value)); },
      removeItem(key) { memory.delete(key); },
      clear() { memory.clear(); }
    }
  });
  window.mountFixture = (projection) => {
    window.__enhancement?.destroy?.();
    window.__posts = [];
    window.__failReads = false;
    const { PressureMainGameStorageV1, attachPressureChapterEnhancementsV1 } = window.__PressureModule;
    const storage = new PressureMainGameStorageV1({
      runId: projection.runId,
      initialProjection: projection,
      createIdempotencyKey: () => 'browser-response-key',
      fetchImpl: async (_url, init = {}) => {
        if (String(init.method || 'GET').toUpperCase() === 'POST') {
          const body = JSON.parse(init.body);
          window.__posts.push(body);
          await new Promise((resolve) => setTimeout(resolve, 30));
          return new Response(JSON.stringify({ schemaVersion: 'pressure_chapter_submit_decision_http_response_v1', idempotencyKey: body.idempotencyKey, projection }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (window.__failReads) return new Response(JSON.stringify({ code: 'TEMPORARY_UNAVAILABLE' }), { status: 503, headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify(projection), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    });
    const state = { activeManeuverType: null, maneuverDrafts: {}, view: storage.toView() };
    const app = {
      getState: () => state,
      chooseManeuver(type) {
        state.activeManeuverType = type;
        this.render();
        return true;
      },
      render() {
        const panel = document.querySelector('[data-testid="maneuver-panel"]');
        if (state.activeManeuverType === 'investigate') panel.innerHTML = '<section data-testid="maneuver-investigate-workbench"><button type="button" data-investigation-key="INVESTIGATE_SOURCE">核查原册递送</button><textarea id="fixture-draft"></textarea><button id="fixture-submit" type="button">派遣调查</button></section>';
        else if (state.activeManeuverType === 'contact') panel.innerHTML = '<section data-testid="maneuver-contact-workbench"><button type="button" data-contact-role="PUBLIC_QUESTION">相关经手方</button><textarea id="contactMessageText"></textarea></section>';
        else if (state.activeManeuverType === 'leverage') panel.innerHTML = '<section data-testid="maneuver-leverage-workbench"><button type="button" data-leverage-key="seal">田契图纸</button></section>';
        else if (state.activeManeuverType === 'custom') panel.innerHTML = '<section data-testid="maneuver-custom-workbench"><textarea id="customManeuverText"></textarea></section>';
      }
    };
    const first = projection.feedPage.items[0];
    const feedButton = document.querySelector('#feed-event');
    delete feedButton.dataset.pressureFeedEventId;
    if (first) feedButton.dataset.pressureFeedEventId = first.eventId;
    const enhancement = attachPressureChapterEnhancementsV1({ root: document.querySelector('#app'), window, storyApp: app, storage });
    enhancement.boot();
    window.__storage = storage;
    window.__storyApp = app;
    window.__enhancement = enhancement;
    return true;
  };
})();
"""


def browser_bundle() -> str:
    workbench = (ROOT / "apps/web/public/pressure-chapter-workbench-v1.js").read_text(encoding="utf-8")
    game = (ROOT / "apps/web/public/pressure-chapter-game-v1.js").read_text(encoding="utf-8")
    import_end = game.find(";", game.find("import"))
    if import_end < 0:
        raise AssertionError("Pressure game import block was not found")
    game = game[import_end + 1 :]
    workbench = workbench.replace("export ", "")
    game = game.replace("export ", "")
    expose = "\nwindow.__PressureModule = { PressureMainGameStorageV1, attachPressureChapterEnhancementsV1 };\n"
    return workbench + "\n" + game + expose


def prepare_page(context: Any, css: str, bundle: str, value: dict[str, Any]) -> Any:
    page = context.new_page()
    page.set_content(FIXTURE_HTML, wait_until="load")
    page.add_style_tag(content=FIXTURE_SHELL_CSS)
    page.add_style_tag(content=css)
    page.add_script_tag(content=bundle)
    page.add_script_tag(content=MOUNT_SCRIPT)
    page.evaluate("value => window.mountFixture(value)", value)
    page.wait_for_timeout(15)
    return page


MOJIBAKE_MARKERS = tuple(chr(value) for value in (0x951B, 0x93C4, 0x9428, 0x7EDB, 0x6D5C, 0x9359, 0x6D63, 0x93C8, 0x7487, 0x93B4, 0x934F, 0x7F01, 0x68F0, 0x95C4, 0x9A73, 0xFFFD))


def assert_readable_chinese(page: Any) -> None:
    text = page.locator("body").inner_text()
    for expected in ("当前目标", "我的资源", "你要如何应对"):
        assert expected in text, f"missing readable Chinese text: {expected}"
    assert not any(marker in text for marker in MOJIBAKE_MARKERS), "mojibake detected in rendered Chinese"


def computed_accent(page: Any, selector: str) -> str:
    return page.locator(selector).evaluate(
        "element => getComputedStyle(element).getPropertyValue('--pressure-accent').trim().toLowerCase()"
    )


def rectangles_overlap(left: dict[str, float], right: dict[str, float], tolerance: float = 0.5) -> bool:
    return not (
        left["x"] + left["width"] <= right["x"] + tolerance
        or right["x"] + right["width"] <= left["x"] + tolerance
        or left["y"] + left["height"] <= right["y"] + tolerance
        or right["y"] + right["height"] <= left["y"] + tolerance
    )


def assert_modal_suppresses_center(page: Any, modal_test_id: str) -> None:
    page.get_by_test_id(modal_test_id).wait_for()
    assert page.locator("[data-pressure-key-modal-layer]").count() == 1
    assert page.locator("[data-pressure-center-enhancement]").count() == 0
    assert page.get_by_test_id("pressure-center-card").count() == 0
    root = page.locator("#app")
    assert root.get_attribute("data-pressure-modal-active") == "true"
    assert "pressure-modal-active" in (root.get_attribute("class") or "").split()
    # The frozen existing shell remains behind the modal; only its enhancement
    # surface is suppressed.
    assert page.locator(".causal-topbar").count() == 1
    assert page.locator(".causal-left").count() == 1
    assert page.locator(".causal-center").count() == 1
    assert page.locator(".causal-right").count() == 1
    assert page.locator('[data-testid="decision-zone"]').count() == 1
    assert page.locator('[data-testid="maneuver-panel"]').count() == 1


def assert_restored_single_center_card(page: Any, card_type: str) -> None:
    assert page.locator("[data-pressure-key-modal-layer]").count() == 0
    assert page.locator("[data-pressure-center-enhancement]").count() == 1
    assert page.get_by_test_id("pressure-center-card").count() == 1
    assert page.get_by_test_id("pressure-center-card").get_attribute("data-card-type") == card_type
    root = page.locator("#app")
    assert root.get_attribute("data-pressure-modal-active") is None
    assert "pressure-modal-active" not in (root.get_attribute("class") or "").split()


def assert_cross_card_geometry(page: Any) -> None:
    card_box = page.get_by_test_id("pressure-center-card").bounding_box()
    center_box = page.locator(".causal-center").bounding_box()
    topbar_box = page.locator(".causal-topbar").bounding_box()
    left_box = page.locator(".causal-left").bounding_box()
    right_box = page.locator(".causal-right").bounding_box()
    viewport = page.viewport_size
    assert card_box and center_box and topbar_box and left_box and right_box and viewport
    epsilon = 1.0
    assert card_box["x"] >= -epsilon
    assert card_box["y"] >= -epsilon
    assert card_box["x"] + card_box["width"] <= viewport["width"] + epsilon
    assert card_box["y"] + card_box["height"] <= viewport["height"] + epsilon
    assert card_box["x"] >= center_box["x"] - epsilon
    assert card_box["y"] >= center_box["y"] - epsilon
    assert card_box["x"] + card_box["width"] <= center_box["x"] + center_box["width"] + epsilon
    assert card_box["y"] + card_box["height"] <= center_box["y"] + center_box["height"] + epsilon
    assert not rectangles_overlap(card_box, topbar_box)
    assert not rectangles_overlap(card_box, left_box)
    assert not rectangles_overlap(card_box, right_box)


def run() -> int:
    chrome = resolve_chrome()
    if not chrome:
        print("BLOCKED_CHROME_NOT_FOUND")
        return 77

    css = (ROOT / "apps/web/public/pressure-chapter-game-v1.css").read_text(encoding="utf-8")
    bundle = browser_bundle()
    print(f"CHROME_EXECUTABLE={chrome}")
    print("EVIDENCE_CLASS=LOCAL_DOM_SEAM_FIXTURE")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=chrome, headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        context = browser.new_context(viewport={"width": 1440, "height": 900})

        # Major cross-impact: only the center seam changes.
        major = feed_item(1, severity="MAJOR")
        page = prepare_page(context, css, bundle, projection([major]))
        page.get_by_test_id("pressure-center-card").wait_for()
        assert_readable_chinese(page)
        assert computed_accent(page, '[data-testid="pressure-center-card"]') == "#5b3bd8"
        assert page.locator('[data-pressure-title-icon="CROSS_IMPACT"]').inner_text() == "✦"
        assert_cross_card_geometry(page)
        print("CROSS_GEOMETRY_1440X900=PASS")
        assert page.locator(".causal-topbar").count() == 1
        assert page.locator(".causal-left").count() == 1
        assert page.locator(".causal-right").count() == 1
        assert page.locator('[data-testid="decision-zone"]').count() == 1
        assert page.locator('[data-testid="maneuver-panel"]').count() == 1
        assert page.locator(".pc-left-rail, .pc-center-stage, .pc-right-rail").count() == 0
        feed_before = page.locator('[data-testid="situation-feed"]').inner_html()

        # Card action opens the single existing workbench and submits once.
        page.locator('[data-pressure-card-action="primary"]').click()
        page.get_by_test_id("maneuver-investigate-workbench").wait_for()
        assert page.locator('[data-testid="maneuver-panel"]').count() == 1
        page.locator("#fixture-draft").fill("核查原册递送")
        page.evaluate("""() => Promise.all([
          window.__storage.submitManeuver(window.__storage.toView(), { maneuverType: 'investigate', intentKey: 'INVESTIGATE_SOURCE' }),
          window.__storage.submitManeuver(window.__storage.toView(), { maneuverType: 'investigate', intentKey: 'INVESTIGATE_SOURCE' })
        ])""")
        posts = page.evaluate("window.__posts")
        assert len(posts) == 1
        assert posts[0]["sourceEventId"] == major["eventId"]
        assert posts[0]["optionCode"] == "INVESTIGATE_SOURCE"
        assert page.locator('[data-testid="situation-feed"]').inner_html() == feed_before
        page.close()

        # Minor impact stays Feed-first and existing Feed markup is untouched on click.
        minor = feed_item(2, severity="MINOR")
        page = prepare_page(context, css, bundle, projection([minor]))
        assert page.locator("[data-pressure-center-enhancement]").count() == 0
        feed_before = page.locator('[data-testid="situation-feed"]').inner_html()
        page.locator("#feed-event").click()
        page.get_by_test_id("pressure-center-card").wait_for()
        assert page.locator('[data-testid="situation-feed"]').inner_html() == feed_before
        page.close()

        # Each approved modal suppresses the retained center DOM surface while
        # active, then restores exactly one card when it closes.
        modal_cases = [
            ("PROMISE_BROKEN", "CRITICAL", "pressure-modal-promise-broken", "tertiary"),
            ("CRISIS", "CRITICAL", "pressure-modal-crisis", "secondary"),
            ("STAGE_VICTORY", "MAJOR", "pressure-modal-stage-victory", "secondary"),
        ]
        for sequence, (modal_type, severity, test_id, close_slot) in enumerate(modal_cases, start=10):
            modal_item = feed_item(sequence, modal_type, severity=severity, modal=True)
            single_page = prepare_page(context, css, bundle, projection([modal_item]))
            assert_modal_suppresses_center(single_page, test_id)
            single_page.locator(f'[data-pressure-modal-action="{close_slot}"]').click()
            single_page.wait_for_timeout(10)
            assert_restored_single_center_card(single_page, modal_type)
            single_page.close()
        print("MODAL_SINGLE_HIDE_RESTORE=PASS")

        # Modal priority, local dedupe, and queue hand-off without a center-card
        # frame appearing between CRISIS -> PROMISE -> VICTORY.
        stage = feed_item(3, "STAGE_VICTORY", severity="MAJOR", modal=True)
        promise = feed_item(2, "PROMISE_BROKEN", severity="CRITICAL", modal=True)
        crisis = feed_item(1, "CRISIS", severity="CRITICAL", modal=True)
        page = prepare_page(context, css, bundle, projection([stage, promise, crisis]))
        assert_modal_suppresses_center(page, "pressure-modal-crisis")
        assert_readable_chinese(page)
        assert computed_accent(page, '[data-testid="pressure-modal-crisis"]') == "#e24c2e"
        assert page.locator('[data-testid="pressure-modal-crisis"] [data-pressure-title-icon="CRISIS"]').inner_text() == "!"
        page.locator('[data-pressure-modal-action="secondary"]').click()
        assert_modal_suppresses_center(page, "pressure-modal-promise-broken")
        assert computed_accent(page, '[data-testid="pressure-modal-promise-broken"]') == "#6a36d5"
        assert page.locator('[data-testid="pressure-modal-promise-broken"] [data-pressure-title-icon="PROMISE_BROKEN"]').inner_text() == "◆"
        page.locator('[data-pressure-modal-action="tertiary"]').click()
        assert_modal_suppresses_center(page, "pressure-modal-stage-victory")
        assert computed_accent(page, '[data-testid="pressure-modal-stage-victory"]') == "#176b3a"
        victory_icon = page.locator('[data-testid="pressure-modal-stage-victory"] [data-pressure-title-icon="STAGE_VICTORY"]')
        assert victory_icon.inner_text() == "✓"
        assert victory_icon.evaluate("element => getComputedStyle(element).borderRadius") == "50%"
        primary_box = page.locator('[data-testid="pressure-modal-stage-victory"] [data-pressure-modal-action="primary"]').bounding_box()
        secondary_box = page.locator('[data-testid="pressure-modal-stage-victory"] [data-pressure-modal-action="secondary"]').bounding_box()
        assert primary_box and secondary_box and primary_box["height"] > secondary_box["height"]
        page.locator('[data-pressure-modal-action="secondary"]').click()
        assert_restored_single_center_card(page, "STAGE_VICTORY")
        print("MODAL_QUEUE_GHOST_SUPPRESSION=PASS")
        page.evaluate("""() => {
          window.__enhancement.destroy();
          const {attachPressureChapterEnhancementsV1} = window.__PressureModule;
          window.__enhancement = attachPressureChapterEnhancementsV1({root: document.querySelector('#app'), window, storyApp: window.__storyApp, storage: window.__storage});
          window.__enhancement.boot();
        }""")
        page.wait_for_timeout(15)
        assert page.locator("[role=dialog]").count() == 0

        # Failed read leaves the existing draft and center card intact.
        page.evaluate("eventId => document.querySelector('#app').dispatchEvent(new CustomEvent('pressure:aemotion:open-center-card', {detail: {eventId}}))", stage["eventId"])
        page.wait_for_timeout(10)
        page.locator('[data-pressure-card-action="primary"]').click()
        page.get_by_test_id("maneuver-custom-workbench").wait_for()
        textarea = page.locator("#customManeuverText")
        textarea.fill("断线后必须保留的工作区草稿")
        page.evaluate("window.__failReads = true")
        page.evaluate("window.__storage.getRun().catch(() => null)")
        page.wait_for_timeout(20)
        assert textarea.input_value() == "断线后必须保留的工作区草稿"
        assert page.get_by_test_id("pressure-center-card").count() == 1
        page.close()

        context.close()
        browser.close()
    print("LOCAL_DOM_SEAM_FIXTURE_V4: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(run())
