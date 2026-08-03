import argparse
import json
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright


FORBIDDEN_UI_MARKERS = [
    "statePatch",
    "settlementJson",
    "raw provider payload",
    "ROLE WORKING SET",
    "CONFIRMED RESOLUTION",
    "system prompt",
    "developer message",
    "chain of thought",
]


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stack", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def compact(text):
    return re.sub(r"\s+", " ", text or "").strip()


def main():
    args = parse_args()
    stack = json.loads(Path(args.stack).read_text(encoding="utf-8-sig"))
    output_dir = Path(args.output).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    password = os.environ.get("OPENOVEL_M11_PASSWORD", "")
    if not password:
        raise RuntimeError("OPENOVEL_M11_PASSWORD is required")

    roles = ["governor", "xunfu", "magistrate"]
    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        try:
            for role in roles:
                context = browser.new_context(viewport={"width": 1440, "height": 1000})
                page = context.new_page()
                console_errors = []
                page_errors = []
                failed_requests = []
                bad_responses = []
                page.on("console", lambda message, target=console_errors: target.append(message.text) if message.type == "error" else None)
                page.on("pageerror", lambda error, target=page_errors: target.append(str(error)))
                page.on("requestfailed", lambda request, target=failed_requests: target.append({
                    "url": request.url,
                    "failure": request.failure,
                }))
                page.on("response", lambda response, target=bad_responses: target.append({
                    "status": response.status,
                    "url": response.url,
                }) if response.status >= 400 and "/api/" in response.url else None)

                page.goto(stack["urls"][role], wait_until="domcontentloaded", timeout=30_000)
                page.locator(
                    '[data-auth-form], [data-testid="continuous-story-v2-shell"]'
                ).first.wait_for(timeout=30_000)
                if page.locator('[data-auth-form]').count():
                    page.locator('input[name="email"]').fill(stack["accounts"][role])
                    page.locator('input[name="password"]').fill(password)
                    page.locator('[data-auth-form] button[type="submit"]').click()
                    page.wait_for_url(
                        lambda url: url.startswith(
                            stack["urls"][role].split("?", 1)[0] + "?"
                        ) and "runId=" in url,
                        timeout=30_000,
                    )

                page.locator('[data-testid="continuous-story-v2-shell"]').wait_for(timeout=30_000)
                page.locator('[data-testid="v2-current-story"]').wait_for(timeout=30_000)
                page.wait_for_timeout(2_000)

                body = compact(page.locator("body").inner_text())
                identity = compact(page.locator(".continuous-identity").inner_text())
                story = compact(page.locator('[data-testid="v2-current-story"]').inner_text())
                latest_result = compact(page.locator('[data-testid="v2-latest-result"]').inner_text()) if page.locator('[data-testid="v2-latest-result"]').count() else ""
                controls = compact(page.locator(".continuous-control").inner_text())
                timeline_count = page.locator(".v2-timeline article").count()
                decision_count = page.locator("[data-v2-decision]").count()
                custom_action_available = page.locator("[data-v2-custom-start]").count() == 1
                pending_interactions = page.locator('[data-testid="v2-pending-interactions"] article').count()
                forbidden = [marker for marker in FORBIDDEN_UI_MARKERS if marker.casefold() in body.casefold()]
                other_accounts = [
                    email for other_role, email in stack["accounts"].items()
                    if other_role != role and email.casefold() in body.casefold()
                ]
                screenshot = output_dir / f"{role}.png"
                page.screenshot(path=str(screenshot), full_page=True)

                checks = {
                    "actualGameRoute": page.url.startswith(stack["urls"][role]),
                    "identityVisible": bool(identity),
                    "storyVisible": len(story) >= 40,
                    "timelineVisible": timeline_count > 0,
                    "humanControlVisible": "由我决定" in controls,
                    "freeInputAvailable": custom_action_available,
                    "noForbiddenUiMarkers": not forbidden,
                    "noOtherAccountLeak": not other_accounts,
                    "noConsoleErrors": not console_errors,
                    "noPageErrors": not page_errors,
                    "noFailedApiResponses": not bad_responses,
                }
                results.append({
                    "role": role,
                    "url": page.url,
                    "identity": identity,
                    "storyExcerpt": story[:500],
                    "latestResultExcerpt": latest_result[:500],
                    "control": controls,
                    "timelineCount": timeline_count,
                    "decisionCount": decision_count,
                    "pendingInteractions": pending_interactions,
                    "forbiddenMarkers": forbidden,
                    "otherAccountLeaks": other_accounts,
                    "consoleErrors": console_errors,
                    "pageErrors": page_errors,
                    "failedRequests": failed_requests,
                    "badApiResponses": bad_responses,
                    "screenshot": str(screenshot),
                    "checks": checks,
                })
                context.close()
        finally:
            browser.close()

    identities = {item["identity"] for item in results}
    stories = {item["storyExcerpt"] for item in results}
    cross_role_checks = {
        "threeDistinctIdentities": len(identities) == 3,
        "threeDistinctPovStories": len(stories) == 3,
        "threeOrigins": len({item["url"].split("/", 3)[2] for item in results}) == 3,
    }
    passed = all(all(item["checks"].values()) for item in results) and all(cross_role_checks.values())
    report = {
        "schemaVersion": "openovel_mp_browser_evidence_v1",
        "status": "PASS" if passed else "FAIL",
        "engine": "Google Chrome via Playwright channel=chrome",
        "runId": stack["runId"],
        "stack": str(Path(args.stack).resolve()),
        "roles": results,
        "crossRoleChecks": cross_role_checks,
        "ownerSignoffRequired": True,
    }
    report_path = output_dir / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "status": report["status"],
        "report": str(report_path),
        "crossRoleChecks": cross_role_checks,
        "roleChecks": {item["role"]: item["checks"] for item in results},
    }, ensure_ascii=False, indent=2))
    raise SystemExit(0 if passed else 1)


if __name__ == "__main__":
    main()
