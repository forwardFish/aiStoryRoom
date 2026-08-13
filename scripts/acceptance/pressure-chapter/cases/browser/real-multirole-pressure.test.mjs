import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveChromeBinary } from '../../../chrome-binary-resolver.mjs';
import {
  fetchWithTimeout,
  normalizeBaseUrl,
  readJsonFixture,
  requireFixtureString,
  requireStringArray,
  skipUnlessEnvironment,
} from '../../lib/live-fixture.mjs';

test('real Chrome renders two isolated Pressure viewers without cross-seat leakage', { timeout: 120_000 }, async (t) => {
  if (skipUnlessEnvironment(t, [
    'PRESSURE_CHAPTER_ALLOW_BROWSER_TESTS',
    'PRESSURE_CHAPTER_TEST_SCOPE',
    'PRESSURE_CHAPTER_TEST_BASE_URL',
    'PRESSURE_CHAPTER_BROWSER_AUTH_FIXTURE',
  ])) return;
  assert.equal(process.env.PRESSURE_CHAPTER_ALLOW_BROWSER_TESTS, '1');
  assert.equal(process.env.PRESSURE_CHAPTER_TEST_SCOPE, 'non-production');
  assert.notEqual(process.env.NODE_ENV, 'production');

  const baseUrl = normalizeBaseUrl(process.env.PRESSURE_CHAPTER_TEST_BASE_URL);
  const fixture = await readJsonFixture(
    process.env.PRESSURE_CHAPTER_BROWSER_AUTH_FIXTURE,
    'PRESSURE_CHAPTER_BROWSER_AUTH_FIXTURE',
  );
  const runId = requireFixtureString(fixture, 'runId');
  assert.ok(Array.isArray(fixture.viewers) && fixture.viewers.length >= 2, 'browser fixture requires two or more viewers');
  const viewers = fixture.viewers.map((viewer, index) => ({
    name: requireFixtureString(viewer, 'name', `viewers[${index}]`),
    seatId: requireFixtureString(viewer, 'seatId', `viewers[${index}]`),
    cookieName: requireFixtureString(viewer, 'cookieName', `viewers[${index}]`),
    cookieValue: requireFixtureString(viewer, 'cookieValue', `viewers[${index}]`),
    privateMarkers: requireStringArray(viewer.privateMarkers ?? [], `viewers[${index}].privateMarkers`),
  }));
  assert.equal(new Set(viewers.map((viewer) => viewer.seatId)).size, viewers.length, 'browser viewers must use distinct seats');

  const ready = await fetchWithTimeout(new URL(`/api/v4/rooms/${encodeURIComponent(runId)}/game`, `${baseUrl}/`).href, {
    headers: { accept: 'application/json' },
  }, 15_000);
  assert.notEqual(ready.status, 404, 'browser fixture run does not exist');
  assert.notEqual(ready.status, 500, 'Pressure game endpoint is not ready');

  const chromeBinary = resolveChromeBinary();
  for (const viewer of viewers.slice(0, 2)) {
    const profileDirectory = await mkdtemp(path.join(os.tmpdir(), `pressure-browser-${safeName(viewer.name)}-`));
    t.after(async () => rm(profileDirectory, { recursive: true, force: true }));
    const browser = await launchBrowser(chromeBinary, profileDirectory);
    t.after(() => browser.close());
    const cdp = browser.cdp;
    await cdp.send('Network.setCookie', {
      name: viewer.cookieName,
      value: viewer.cookieValue,
      url: baseUrl,
      httpOnly: true,
      sameSite: 'Lax',
      secure: baseUrl.startsWith('https:'),
    });
    const gameUrl = new URL(`/game?runId=${encodeURIComponent(runId)}`, `${baseUrl}/`).href;
    await cdp.send('Page.navigate', { url: gameUrl });
    await waitFor(async () => await evaluate(cdp, `(() => {
      const root = document.querySelector('[data-testid="pressure-chapter-game-v1"]');
      return root?.dataset?.runId === ${JSON.stringify(runId)};
    })()`), `Pressure game root for ${viewer.name}`, 30_000);

    const page = await evaluate(cdp, `(() => {
      const root = document.querySelector('[data-testid="pressure-chapter-game-v1"]');
      return {
        href: location.href,
        runId: root?.dataset?.runId || null,
        seatId: root?.dataset?.viewerSeatId || null,
        text: document.body.innerText,
        html: document.documentElement.outerHTML,
        hasDecisionOrIdle: Boolean(document.querySelector('[data-testid="pressure-center-decision"], [data-testid="pressure-center-idle"]')),
        hasSituation: Boolean(document.querySelector('[data-testid="pressure-situation-panel"]')),
        hasWorkbench: Boolean(document.querySelector('[data-testid="pressure-workbench-host"]')),
      };
    })()`);
    assert.equal(page.runId, runId);
    assert.equal(page.seatId, viewer.seatId, `viewer ${viewer.name} received the wrong seat projection`);
    assert.equal(page.hasDecisionOrIdle, true, 'center stage did not render');
    assert.equal(page.hasSituation, true, 'situation panel did not render');
    assert.equal(page.hasWorkbench, true, 'workbench did not render');
    const serialized = `${page.text}\n${page.html}`;
    for (const other of viewers.filter((candidate) => candidate.seatId !== viewer.seatId)) {
      for (const marker of other.privateMarkers) {
        assert.equal(serialized.includes(marker), false, `${viewer.name} leaked ${other.name}'s private marker`);
      }
    }
    assert.deepEqual(browser.exceptions, [], `runtime exceptions for ${viewer.name}`);
    assert.deepEqual(
      browser.networkFailures.filter((failure) => !failure.canceled),
      [],
      `network failures for ${viewer.name}`,
    );

    if (viewer === viewers[0]) {
      const draftMarker = `pressure-reconnect-draft-${Date.now()}`;
      const draftPrepared = await evaluate(cdp, `(() => {
        const input = document.querySelector('[data-testid="pressure-decision-input"]');
        if (!input) return false;
        input.value = ${JSON.stringify(draftMarker)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return input.value === ${JSON.stringify(draftMarker)};
      })()`);
      assert.equal(draftPrepared, true, 'browser fixture must expose an active custom decision draft');
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitFor(async () => await evaluate(cdp, `(() => {
        const root = document.querySelector('[data-testid="pressure-chapter-game-v1"]');
        return root?.dataset?.runId === ${JSON.stringify(runId)};
      })()`), 'Pressure reconnect refresh', 30_000);
      const recovered = await evaluate(cdp, `(() => ({
        runId: document.querySelector('[data-testid="pressure-chapter-game-v1"]')?.dataset?.runId || null,
        seatId: document.querySelector('[data-testid="pressure-chapter-game-v1"]')?.dataset?.viewerSeatId || null,
        draft: document.querySelector('[data-testid="pressure-decision-input"]')?.value || null,
      }))()`);
      assert.equal(recovered.runId, runId);
      assert.equal(recovered.seatId, viewer.seatId);
      assert.equal(recovered.draft, draftMarker, 'reconnect/refresh lost the in-progress decision draft');

      const staleEpochResult = await evaluate(cdp, `(async () => {
        const getGame = () => fetch('/api/v4/rooms/${encodeURIComponent(runId)}/game', {
          credentials: 'include', headers: { accept: 'application/json' },
        }).then(async response => ({ response, payload: await response.json().catch(() => null) }));
        const getTransport = () => fetch('/api/v4/rooms/${encodeURIComponent(runId)}/pressure-seat-transport', {
          credentials: 'include', headers: { accept: 'application/json' },
        }).then(async response => ({ response, payload: await response.json().catch(() => null) }));
        const before = await getGame();
        const transportBefore = await getTransport();
        const ownSeat = transportBefore.payload?.seatView?.ownSeat;
        if (!before.response.ok || !transportBefore.response.ok || !before.payload?.decision || !before.payload?.viewer?.control?.canSubmit || !ownSeat?.canSubmit) {
          return { precondition: false, status: before.response.status };
        }
        const projection = before.payload;
        const optionCode = projection.decision.options?.[0]?.code ?? null;
        const staleCommand = {
          schemaVersion: 'pressure_chapter_game_command_v1',
          commandType: 'SUBMIT_DECISION',
          runId: projection.runId,
          routeHash: projection.route.routeHash,
          chapterRuntimeId: projection.chapter.chapterRuntimeId,
          chapterId: projection.chapter.chapterId,
          decisionPointId: projection.decision.decisionPointId,
          seatId: projection.viewer.seatId,
          controlEpoch: projection.viewer.control.controlEpoch,
          expectedWorkingRevision: projection.decision.expectedWorkingRevision,
          submissionFenceToken: projection.viewer.control.submissionFenceToken,
          idempotencyKey: 'browser-stale-${randomUUID()}',
          optionCode,
          customText: null,
        };
        const handoff = await fetch('/api/v4/rooms/${encodeURIComponent(runId)}/pressure-seat-transport/handoff', {
          method: 'POST', credentials: 'include', headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedControlEpoch: ownSeat.controlEpoch,
            expectedSubmissionFenceToken: ownSeat.submissionFenceToken,
            idempotencyKey: 'browser-handoff-${randomUUID()}',
          }),
        });
        const handedPayload = await handoff.json().catch(() => null);
        const handedSeat = handedPayload?.snapshot?.seatView?.ownSeat;
        const stale = handoff.ok ? await fetch('/api/v4/rooms/${encodeURIComponent(runId)}/game/action', {
          method: 'POST', credentials: 'include', headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify(staleCommand),
        }) : null;
        const reclaim = handoff.ok && handedSeat?.reclaimFenceToken
          ? await fetch('/api/v4/rooms/${encodeURIComponent(runId)}/pressure-seat-transport/reclaim', {
              method: 'POST', credentials: 'include', headers: { accept: 'application/json', 'content-type': 'application/json' },
              body: JSON.stringify({
                expectedControlEpoch: handedSeat.controlEpoch,
                expectedReclaimFenceToken: handedSeat.reclaimFenceToken,
                idempotencyKey: 'browser-reclaim-${randomUUID()}',
              }),
            })
          : null;
        const stalePayload = stale ? await stale.json().catch(() => null) : null;
        return {
          precondition: true,
          handoffStatus: handoff.status,
          handedMode: handedSeat?.controllerKind ?? null,
          staleStatus: stale?.status ?? null,
          staleCode: stalePayload?.code ?? null,
          reclaimStatus: reclaim?.status ?? null,
        };
      })()`);
      assert.equal(staleEpochResult.precondition, true, 'browser fixture must expose an active submit-capable decision');
      assert.ok(staleEpochResult.handoffStatus >= 200 && staleEpochResult.handoffStatus < 300, 'browser handoff route failed');
      assert.equal(staleEpochResult.handedMode, 'AI');
      assert.ok(staleEpochResult.staleStatus >= 400, 'old control epoch was accepted after AI takeover');
      assert.match(String(staleEpochResult.staleCode ?? ''), /STALE|FENCE|AUTHORITY|CONTROL/iu);
      assert.ok(staleEpochResult.reclaimStatus >= 200 && staleEpochResult.reclaimStatus < 300, 'browser reclaim route failed');
    }
  }
});

test('real /game preserves frozen layout and modal lifecycle across close, refresh, BFCache and reconnect', { timeout: 240_000 }, async (t) => {
  if (skipUnlessEnvironment(t, [
    'PRESSURE_CHAPTER_ALLOW_BROWSER_TESTS',
    'PRESSURE_CHAPTER_ALLOW_MODAL_TRIGGER_TESTS',
    'PRESSURE_CHAPTER_TEST_SCOPE',
    'PRESSURE_CHAPTER_TEST_BASE_URL',
    'PRESSURE_CHAPTER_BROWSER_AUTH_FIXTURE',
    'PRESSURE_MODAL_TRIGGER_VISUAL_REFERENCE_DIR',
  ])) return;
  assert.equal(process.env.PRESSURE_CHAPTER_ALLOW_BROWSER_TESTS, '1');
  assert.equal(process.env.PRESSURE_CHAPTER_ALLOW_MODAL_TRIGGER_TESTS, '1');
  assert.equal(process.env.PRESSURE_CHAPTER_TEST_SCOPE, 'non-production');
  assert.notEqual(process.env.NODE_ENV, 'production');

  const baseUrl = normalizeBaseUrl(process.env.PRESSURE_CHAPTER_TEST_BASE_URL);
  const fixture = await readJsonFixture(process.env.PRESSURE_CHAPTER_BROWSER_AUTH_FIXTURE, 'PRESSURE_CHAPTER_BROWSER_AUTH_FIXTURE');
  const scenarios = fixture.modalScenarios;
  assert.ok(scenarios && typeof scenarios === 'object', 'browser fixture requires modalScenarios');
  const expected = {
    layout: { reference: '01', cardType: null, modalType: null },
    feed: { reference: '02', cardType: null, modalType: null },
    center: { reference: '03', cardType: 'CROSS_IMPACT', modalType: null },
    promise: { reference: '04', cardType: 'PROMISE_BROKEN', modalType: 'PROMISE_BROKEN' },
    crisis: { reference: '05', cardType: 'CRISIS', modalType: 'CRISIS' },
    victory: { reference: '06', cardType: 'STAGE_VICTORY', modalType: 'STAGE_VICTORY' },
  };
  const referenceDirectory = path.resolve(process.env.PRESSURE_MODAL_TRIGGER_VISUAL_REFERENCE_DIR);
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'pressure-modal-visual-'));
  t.after(async () => rm(outputDirectory, { recursive: true, force: true }));
  const chromeBinary = resolveChromeBinary();

  for (const [name, contract] of Object.entries(expected)) {
    const scenario = scenarios[name];
    const runId = requireFixtureString(scenario, 'runId', `modalScenarios.${name}`);
    const cookieName = requireFixtureString(scenario, 'cookieName', `modalScenarios.${name}`);
    const cookieValue = requireFixtureString(scenario, 'cookieValue', `modalScenarios.${name}`);
    const referencePath = await resolveReference(referenceDirectory, contract.reference);
    const profileDirectory = await mkdtemp(path.join(os.tmpdir(), `pressure-modal-${name}-`));
    t.after(async () => rm(profileDirectory, { recursive: true, force: true }));
    const browser = await launchBrowser(chromeBinary, profileDirectory);
    t.after(() => browser.close());
    const { cdp } = browser;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Network.setCookie', {
      name: cookieName, value: cookieValue, url: baseUrl, httpOnly: true,
      sameSite: 'Lax', secure: baseUrl.startsWith('https:'),
    });
    const gameUrl = new URL(`/game?runId=${encodeURIComponent(runId)}`, `${baseUrl}/`).href;
    await cdp.send('Page.navigate', { url: gameUrl });
    await waitForGame(cdp, runId, `${name} initial render`);
    const dom = await inspectModalDom(cdp);
    assert.equal(dom.path, '/game', `${name}: acceptance must use real /game`);
    assert.equal(dom.columnCount, 3, `${name}: frozen three-column layout changed`);
    assert.equal(dom.feedTabCount, 3, `${name}: frozen Feed tabs changed`);
    assert.equal(dom.cardType, contract.cardType, `${name}: center card mismatch`);
    assert.equal(dom.modalType, contract.modalType, `${name}: modal mismatch`);
    assert.equal(dom.modalCount, contract.modalType ? 1 : 0, `${name}: duplicate modal DOM`);

    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
    const actualPath = path.join(outputDirectory, `${contract.reference}-${name}.png`);
    await writeFile(actualPath, Buffer.from(screenshot.data, 'base64'));
    execFileSync(process.env.PYTHON || 'python3', [
      'scripts/acceptance/pressure-chapter/modal-trigger-visual-diff.py',
      referencePath,
      actualPath,
    ], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    if (contract.modalType) {
      const shownRequestsBefore = modalShownRequests(browser.requests, runId).length;
      const closeResult = await evaluate(cdp, `(() => {
        const close = document.querySelector('[data-testid="pressure-modal-close"]');
        if (!close) return false;
        close.click();
        return true;
      })()`);
      assert.equal(closeResult, true, `${name}: modal close control absent`);
      await waitFor(async () => (await inspectModalDom(cdp)).modalCount === 0, `${name} modal close`, 10_000);
      await waitFor(
        async () => modalShownRequests(browser.requests, runId).length === shownRequestsBefore + 1,
        `${name} server MODAL_SHOWN receipt`,
        10_000,
      );
      const shownRequest = modalShownRequests(browser.requests, runId).at(-1);
      assert.deepEqual(
        Object.keys(shownRequest.body).sort(),
        ['commandType', 'eventId', 'idempotencyKey', 'operation', 'projectionVersion', 'schemaVersion'].sort(),
        `${name}: MODAL_SHOWN sent client authority or omitted the projected event binding`,
      );
      assert.equal(shownRequest.body.commandType, 'DELIVERY_MARK');
      assert.equal(shownRequest.body.operation, 'MODAL_SHOWN');
      assert.equal(typeof shownRequest.body.eventId, 'string');
      assert.equal(Number.isSafeInteger(shownRequest.body.projectionVersion), true);
      assert.equal((await inspectModalDom(cdp)).cardType, contract.cardType, `${name}: closing modal removed center card`);
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitForGame(cdp, runId, `${name} refresh`);
      const refreshed = await inspectModalDom(cdp);
      assert.equal(refreshed.modalCount, 0, `${name}: acknowledged modal repeated after refresh`);
      assert.equal(refreshed.cardType, contract.cardType, `${name}: center card did not persist after refresh`);

      const freshProfileDirectory = await mkdtemp(path.join(os.tmpdir(), `pressure-modal-fresh-${name}-`));
      t.after(async () => rm(freshProfileDirectory, { recursive: true, force: true }));
      const freshBrowser = await launchBrowser(chromeBinary, freshProfileDirectory);
      t.after(() => freshBrowser.close());
      await freshBrowser.cdp.send('Network.setCookie', {
        name: cookieName, value: cookieValue, url: baseUrl, httpOnly: true,
        sameSite: 'Lax', secure: baseUrl.startsWith('https:'),
      });
      await freshBrowser.cdp.send('Page.navigate', { url: gameUrl });
      await waitForGame(freshBrowser.cdp, runId, `${name} fresh-profile projection`);
      const freshProfileDom = await inspectModalDom(freshBrowser.cdp);
      assert.equal(freshProfileDom.modalCount, 0, `${name}: server one-shot failed in a fresh browser profile`);
      assert.equal(freshProfileDom.cardType, contract.cardType, `${name}: fresh profile lost the retained center card`);
      freshBrowser.close();
    }

    if (name === 'center') {
      const doubleClick = await evaluate(cdp, `(() => {
        const action = document.querySelector('[data-testid="pressure-center-card"] [data-response-action]');
        if (!action) return { clicked: false };
        action.click(); action.click();
        return { clicked: true, workbenches: document.querySelectorAll('[data-testid="pressure-workbench-host"] .maneuver-workbench').length };
      })()`);
      assert.equal(doubleClick.clicked, true, 'center card response control absent');
      assert.ok(doubleClick.workbenches <= 1, 'duplicate click opened duplicate workspaces');

      const responsePostsBefore = responseSubmissionRequests(browser.requests, runId).length;
      const submittedTwice = await evaluate(cdp, `(() => {
        const submit = document.querySelector('#maneuverSubmit, [data-testid="pressure-workbench-submit"]');
        if (!submit) return false;
        submit.click(); submit.click();
        return true;
      })()`);
      assert.equal(submittedTwice, true, 'existing workbench submit control absent');
      await waitFor(
        async () => responseSubmissionRequests(browser.requests, runId).length > responsePostsBefore,
        'duplicate response network submission',
        15_000,
      );
      const responsePosts = responseSubmissionRequests(browser.requests, runId).slice(responsePostsBefore);
      assert.equal(responsePosts.length, 1, 'duplicate response click emitted more than one HTTP submission');
      const responseBody = responsePosts[0].body;
      assert.equal(typeof responseBody.sourceEventId, 'string');
      assert.equal(typeof responseBody.responseActionCode, 'string');
      for (const forbidden of ['seatId', 'viewerSeatId', 'evidenceRefs', 'projectionHash', 'submissionFenceToken', 'provider']) {
        assert.equal(Object.hasOwn(responseBody, forbidden), false, `response payload leaked ${forbidden}`);
      }

      await cdp.send('Page.navigate', { url: new URL('/', `${baseUrl}/`).href });
      await waitFor(async () => (await evaluate(cdp, 'location.pathname')) === '/', 'BFCache away navigation', 15_000);
      const history = await cdp.send('Page.getNavigationHistory');
      const gameEntry = [...history.entries]
        .slice(0, history.currentIndex)
        .reverse()
        .find((entry) => new URL(entry.url).pathname === '/game');
      assert.ok(gameEntry?.id, 'CDP navigation history did not retain the real /game entry');
      await cdp.send('Page.navigateToHistoryEntry', { entryId: gameEntry.id });
      await waitForGame(cdp, runId, 'BFCache return');
      assert.equal((await inspectModalDom(cdp)).cardType, 'CROSS_IMPACT', 'BFCache return lost center card');

      const beforeReconnect = await readGameProjectionInPage(cdp, runId);
      await cdp.send('Network.emulateNetworkConditions', {
        offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
      });
      const observedDisconnect = await evaluate(cdp, `(async () => {
        try {
          await fetch('/api/v4/rooms/${encodeURIComponent(runId)}/game', { credentials: 'include', cache: 'no-store' });
          return false;
        } catch {
          return true;
        }
      })()`);
      assert.equal(observedDisconnect, true, 'offline phase did not observe a real transport failure');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
      });
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitForGame(cdp, runId, 'disconnect/reconnect');
      assert.equal((await inspectModalDom(cdp)).cardType, 'CROSS_IMPACT', 'reconnect lost center card');
      const afterReconnect = await readGameProjectionInPage(cdp, runId);
      assert.ok(afterReconnect.serverSequence >= beforeReconnect.serverSequence, 'reconnect regressed serverSequence');
      assert.equal(new Set(afterReconnect.eventIds).size, afterReconnect.eventIds.length, 'reconnect duplicated feed eventId');
      for (const eventId of beforeReconnect.eventIds) {
        assert.ok(afterReconnect.eventIds.includes(eventId), `reconnect lost feed event ${eventId}`);
      }
    }
    assert.deepEqual(browser.exceptions, [], `${name}: runtime exceptions`);
    assert.deepEqual(browser.networkFailures.filter((failure) => !failure.canceled), [], `${name}: network failures`);
    browser.close();
  }
});

test('real /game backfills more than ten Feed items with an opaque cursor and global unread count', { timeout: 120_000 }, async (t) => {
  if (skipUnlessEnvironment(t, [
    'PRESSURE_CHAPTER_ALLOW_BROWSER_TESTS',
    'PRESSURE_CHAPTER_ALLOW_MODAL_TRIGGER_TESTS',
    'PRESSURE_CHAPTER_TEST_SCOPE',
    'PRESSURE_CHAPTER_TEST_BASE_URL',
    'PRESSURE_CHAPTER_BROWSER_AUTH_FIXTURE',
  ])) return;
  assert.equal(process.env.PRESSURE_CHAPTER_TEST_SCOPE, 'non-production');
  assert.notEqual(process.env.NODE_ENV, 'production');
  const baseUrl = normalizeBaseUrl(process.env.PRESSURE_CHAPTER_TEST_BASE_URL);
  const fixture = await readJsonFixture(process.env.PRESSURE_CHAPTER_BROWSER_AUTH_FIXTURE, 'PRESSURE_CHAPTER_BROWSER_AUTH_FIXTURE');
  const scenario = fixture.feedPaginationScenario;
  const runId = requireFixtureString(scenario, 'runId', 'feedPaginationScenario');
  const cookieName = requireFixtureString(scenario, 'cookieName', 'feedPaginationScenario');
  const cookieValue = requireFixtureString(scenario, 'cookieValue', 'feedPaginationScenario');
  const profileDirectory = await mkdtemp(path.join(os.tmpdir(), 'pressure-feed-pagination-'));
  t.after(async () => rm(profileDirectory, { recursive: true, force: true }));
  const browser = await launchBrowser(resolveChromeBinary(), profileDirectory);
  t.after(() => browser.close());
  await browser.cdp.send('Network.setCookie', {
    name: cookieName, value: cookieValue, url: baseUrl, httpOnly: true,
    sameSite: 'Lax', secure: baseUrl.startsWith('https:'),
  });
  const gameUrl = new URL(`/game?runId=${encodeURIComponent(runId)}`, `${baseUrl}/`).href;
  await browser.cdp.send('Page.navigate', { url: gameUrl });
  await waitForGame(browser.cdp, runId, 'paginated Feed initial render');
  const first = await readGameProjectionInPage(browser.cdp, runId, { feedLimit: 10 });
  assert.equal(first.eventIds.length, 10, 'pagination fixture must expose a full first page');
  assert.equal(typeof first.nextCursor, 'string', 'first page must expose an opaque nextCursor');
  assert.ok(first.unreadCount > first.pageUnreadCount, 'unreadCount must be global, not current-page unread');
  const older = await readGameProjectionInPage(browser.cdp, runId, { feedLimit: 10, feedCursor: first.nextCursor });
  assert.ok(older.eventIds.length > 0, 'nextCursor returned no older Feed items');
  assert.equal(new Set([...first.eventIds, ...older.eventIds]).size, first.eventIds.length + older.eventIds.length, 'cursor pages overlap by eventId');

  const clicked = await evaluate(browser.cdp, `(() => {
    const button = document.querySelector('[data-testid="pressure-feed-load-older"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(clicked, true, 'real /game has no existing Load older/backfill control');
  await waitFor(async () => {
    const rendered = await evaluate(browser.cdp, `Array.from(document.querySelectorAll('[data-pressure-feed-event-id]')).map(node => node.dataset.pressureFeedEventId)`);
    return older.eventIds.every((eventId) => rendered.includes(eventId));
  }, 'older Feed items rendered', 20_000);
});

async function waitForGame(cdp, runId, label) {
  await waitFor(async () => await evaluate(cdp, `document.querySelector('[data-testid="pressure-chapter-game-v1"]')?.dataset?.runId === ${JSON.stringify(runId)}`), label, 30_000);
}

async function inspectModalDom(cdp) {
  return evaluate(cdp, `(() => ({
    path: location.pathname,
    columnCount: document.querySelectorAll('[data-testid="pressure-left-rail"], [data-testid="pressure-center-stage"], [data-testid="pressure-right-rail"]').length,
    feedTabCount: document.querySelectorAll('[data-testid="pressure-feed"] [data-feed-category]').length,
    cardType: document.querySelector('[data-testid="pressure-center-card"]')?.dataset?.cardType || null,
    modalType: document.querySelector('[data-testid="pressure-key-modal"]')?.dataset?.modalType || null,
    modalCount: document.querySelectorAll('[data-testid="pressure-key-modal"]').length,
  }))()`);
}

async function readGameProjectionInPage(cdp, runId, query = {}) {
  const params = new URLSearchParams();
  if (query.feedLimit !== undefined) params.set('feedLimit', String(query.feedLimit));
  if (query.feedCursor !== undefined && query.feedCursor !== null) params.set('feedCursor', query.feedCursor);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return evaluate(cdp, `(async () => {
    const response = await fetch('/api/v4/rooms/${encodeURIComponent(runId)}/game${suffix}', {
      credentials: 'include', cache: 'no-store', headers: { accept: 'application/json' },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error('game projection HTTP ' + response.status);
    const items = payload.feedPage?.items || [];
    return {
      eventIds: items.map(item => item.eventId),
      pageUnreadCount: items.filter(item => item.isUnread === true).length,
      unreadCount: payload.feedPage?.unreadCount,
      nextCursor: payload.feedPage?.nextCursor,
      serverSequence: payload.feedPage?.serverSequence,
    };
  })()`);
}

function parsedPostRequests(requests, runId) {
  const suffix = `/api/v4/rooms/${encodeURIComponent(runId)}/game/action`;
  return requests.flatMap((request) => {
    if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith(suffix) || !request.postData) return [];
    try { return [{ ...request, body: JSON.parse(request.postData) }]; } catch { return []; }
  });
}

function modalShownRequests(requests, runId) {
  return parsedPostRequests(requests, runId).filter((request) => (
    request.body.commandType === 'DELIVERY_MARK'
    && request.body.operation === 'MODAL_SHOWN'
  ));
}

function responseSubmissionRequests(requests, runId) {
  return parsedPostRequests(requests, runId).filter((request) => (
    typeof request.body.sourceEventId === 'string'
    && typeof request.body.responseActionCode === 'string'
  ));
}

async function resolveReference(directory, stem) {
  for (const extension of ['png', 'jpg', 'jpeg', 'webp']) {
    const candidate = path.join(directory, `${stem}.${extension}`);
    try { await access(candidate); return candidate; } catch {}
  }
  assert.fail(`missing visual reference ${stem}.(png|jpg|jpeg|webp) in ${directory}`);
}

async function launchBrowser(executable, profileDirectory) {
  const port = await reservePort();
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profileDirectory}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, 20_000);
  let page = (await waitForJson(`http://127.0.0.1:${port}/json/list`, 10_000)).find((entry) => entry.type === 'page');
  if (!page?.webSocketDebuggerUrl) {
    page = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json());
  }
  assert.ok(version.Browser, 'CDP did not identify a real browser');
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  const exceptions = [];
  const networkFailures = [];
  const requests = [];
  cdp.on('Runtime.exceptionThrown', (params) => exceptions.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? 'runtime exception'));
  cdp.on('Network.loadingFailed', (params) => networkFailures.push({
    url: params.url ?? null,
    errorText: params.errorText,
    canceled: params.canceled === true,
  }));
  cdp.on('Network.requestWillBeSent', (params) => requests.push({
    url: params.request.url,
    method: params.request.method,
    postData: params.request.postData ?? null,
  }));
  return {
    cdp,
    exceptions,
    networkFailures,
    requests,
    close() {
      cdp.close();
      child.kill();
    },
  };
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (event) => this.receive(JSON.parse(event.data.toString())));
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new Cdp(socket);
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  receive(message) {
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
}

async function waitFor(predicate, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function waitForJson(url, timeoutMs) {
  let lastError;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`CDP did not start: ${lastError?.message ?? 'unknown error'}`);
}

async function reservePort() {
  const { createServer } = await import('node:net');
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function safeName(value) {
  return value.replace(/[^a-z0-9_-]+/giu, '-').slice(0, 30) || 'viewer';
}
