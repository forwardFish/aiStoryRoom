import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import {
  assertLocalAuthFixtureScope,
  cleanupFixture,
  createFixtureIdentity,
  loadPinnedTestEnvironment,
  pressureFixtureApiRequest,
  pressureSoloRunId,
  provisionVerifiedLocalAccount,
  safeFixtureRecord,
  waitForPressureFixtureDecisionReadback,
  waitForPressureFixtureProjection,
} from './fixtures/local-auth-fixture.mjs';
import gameReadAcceptanceSummaryModule from '../../../apps/api/src/pressure-chapter/observability/game-read-acceptance-summary.ts';
import gameReadObservationModule from '../../../apps/api/src/pressure-chapter/observability/game-read-observation.ts';
import pressureCanonicalModule from '../../../packages/shared/src/pressure-chapter/contracts/canonical.ts';

const {
  PRESSURE_GAME_READ_MINIMUM_WARM_SAMPLES_V1,
  summarizePressureGameReadAcceptanceV1,
} = gameReadAcceptanceSummaryModule;
const {
  validatePressureGameReadObservationV1,
} = gameReadObservationModule;
const {
  canonicalJson,
  isSha256,
} = pressureCanonicalModule;

export const PRESSURE_GAME_READ_ACCEPTANCE_SCHEMA_V1 =
  'pressure_game_read_performance_acceptance_v1';
export const PRESSURE_GAME_READ_ACCEPTANCE_STAGES_V1 = Object.freeze([
  'provision',
  'start',
  'replay',
  'shadow',
  'fast',
  'compare',
  'warm',
  'submit',
  'readback',
  'cleanup',
]);
export const PRESSURE_GAME_READ_DEFAULT_WARM_SAMPLES_V1 = 10;
export const PRESSURE_GAME_READ_FIXED_FEED_LIMIT_V1 = 10;

const OBSERVATION_LOG_ENV = Object.freeze({
  REPLAY: 'PRESSURE_GAME_READ_REPLAY_OBSERVATION_LOG',
  SHADOW: 'PRESSURE_GAME_READ_SHADOW_OBSERVATION_LOG',
  FAST: 'PRESSURE_GAME_READ_FAST_OBSERVATION_LOG',
});
const API_BASE_ENV = Object.freeze({
  REPLAY: 'PRESSURE_GAME_READ_REPLAY_API_BASE',
  SHADOW: 'PRESSURE_GAME_READ_SHADOW_API_BASE',
  FAST: 'PRESSURE_GAME_READ_FAST_API_BASE',
});
const MODES = Object.freeze(['REPLAY', 'SHADOW', 'FAST']);
const SAFE_CODE = /^[A-Z0-9_.:-]{1,120}$/u;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const MAX_EXPLICIT_WARM_SAMPLES = 1_000;
const DEFAULT_TIMEOUT_MS = 90_000;
const OBSERVATION_WAIT_MS = 5_000;
const OBSERVATION_QUIET_MS = 100;
const POLL_INTERVAL_MS = 25;

class AcceptanceStageError extends Error {
  constructor(stage, code, cause = undefined) {
    super(code, { cause });
    this.name = 'AcceptanceStageError';
    this.stage = stage;
    this.code = code;
  }
}

class ObservationLogReader {
  constructor({ filePath, expectedMode }) {
    this.filePath = path.resolve(filePath);
    this.expectedMode = expectedMode;
    this.consumedLineCount = 0;
  }

  async initializeEmpty() {
    const linkDetails = await lstat(this.filePath);
    if (linkDetails.isSymbolicLink() || !linkDetails.isFile()) {
      throw new Error('observation path must be a regular non-symlink file');
    }
    if (linkDetails.size !== 0) {
      throw new Error('observation log must be empty before acceptance starts');
    }
  }

  async takeExactlyOne({ timeoutMs = OBSERVATION_WAIT_MS } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastSize = -1;
    let quietSince = Date.now();
    while (Date.now() <= deadline) {
      const details = await stat(this.filePath);
      if (details.size !== lastSize) {
        lastSize = details.size;
        quietSince = Date.now();
      }
      const parsed = await this.#readCompleteLines();
      if (parsed === null) {
        await delay(POLL_INTERVAL_MS);
        continue;
      }
      if (parsed.length < this.consumedLineCount) {
        throw new Error('observation log was truncated or rewritten');
      }
      const unread = parsed.slice(this.consumedLineCount);
      if (unread.length > 0 && Date.now() - quietSince >= OBSERVATION_QUIET_MS) {
        if (unread.length !== 1) {
          throw new Error('one GET /game produced an unexpected observation count');
        }
        this.consumedLineCount += 1;
        return unread[0];
      }
      await delay(POLL_INTERVAL_MS);
    }
    throw new Error('timed out waiting for exactly one observation line');
  }

  async settleAndDiscard({ timeoutMs = OBSERVATION_WAIT_MS, validate = true } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastSize = -1;
    let quietSince = Date.now();
    while (Date.now() <= deadline) {
      const details = await stat(this.filePath);
      if (details.size !== lastSize) {
        lastSize = details.size;
        quietSince = Date.now();
      }
      const parsed = await this.#readCompleteLines();
      if (parsed === null) {
        await delay(POLL_INTERVAL_MS);
        continue;
      }
      if (parsed.length < this.consumedLineCount) {
        throw new Error('observation log was truncated or rewritten');
      }
      if (Date.now() - quietSince >= OBSERVATION_QUIET_MS) {
        const unread = parsed.slice(this.consumedLineCount);
        this.consumedLineCount = parsed.length;
        if (validate) {
          for (const raw of unread) {
            validateObservedRead(raw, this.expectedMode, { requireSuccess: false });
          }
        }
        return unread.length;
      }
      await delay(POLL_INTERVAL_MS);
    }
    throw new Error('observation log did not become quiescent');
  }

  async #readCompleteLines() {
    const text = await readFile(this.filePath, 'utf8');
    if (!text) return [];
    if (!text.endsWith('\n')) return null;
    const lines = text.split(/\r?\n/u).filter((line) => line.trim() !== '');
    return lines.map((line) => JSON.parse(line));
  }
}

export function parseGameReadPerformanceAcceptanceConfiguration({
  argv = process.argv.slice(2),
  environment = process.env,
  repoRoot = process.cwd(),
} = {}) {
  const args = parseNamedArguments(argv);
  const apiBases = Object.fromEntries(MODES.map((mode) => {
    const argumentName = `${mode.toLowerCase()}-api-base`;
    const raw = args.get(argumentName) ?? environment[API_BASE_ENV[mode]];
    return [mode, normalizeApiBase(raw, API_BASE_ENV[mode])];
  }));
  const origins = MODES.map((mode) => new URL(apiBases[mode]).origin);
  assert.equal(new Set(origins).size, MODES.length, 'the three API bases must use isolated origins');

  const observationLogPaths = Object.fromEntries(MODES.map((mode) => {
    const argumentName = `${mode.toLowerCase()}-observation-log`;
    const raw = args.get(argumentName) ?? environment[OBSERVATION_LOG_ENV[mode]];
    return [mode, raw === undefined || String(raw).trim() === '' ? null : path.resolve(String(raw))];
  }));
  const providedLogCount = MODES.filter((mode) => observationLogPaths[mode] !== null).length;
  assert.ok(providedLogCount === 0 || providedLogCount === MODES.length,
    'observation logs must be omitted together or provided for all three modes');
  if (providedLogCount === MODES.length) {
    assert.equal(new Set(MODES.map((mode) => observationLogPaths[mode])).size, MODES.length,
      'observation log paths must be distinct');
  }

  const warmRaw = args.get('warm-samples')
    ?? environment.PRESSURE_GAME_READ_WARM_SAMPLES
    ?? String(PRESSURE_GAME_READ_DEFAULT_WARM_SAMPLES_V1);
  const warmSampleCount = parseBoundedInteger(
    warmRaw,
    PRESSURE_GAME_READ_MINIMUM_WARM_SAMPLES_V1,
    MAX_EXPLICIT_WARM_SAMPLES,
    'warm sample count',
  );

  const unknown = [...args.keys()].filter((key) => !new Set([
    'replay-api-base',
    'shadow-api-base',
    'fast-api-base',
    'replay-observation-log',
    'shadow-observation-log',
    'fast-observation-log',
    'warm-samples',
  ]).has(key));
  assert.deepEqual(unknown, [], `unknown arguments: ${unknown.join(',')}`);

  return Object.freeze({
    repoRoot: path.resolve(repoRoot),
    apiBases: Object.freeze(apiBases),
    observationLogPaths: Object.freeze(observationLogPaths),
    warmSampleCount,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    feedLimit: PRESSURE_GAME_READ_FIXED_FEED_LIMIT_V1,
  });
}

export async function runGameReadPerformanceAcceptance(configuration, dependencyOverrides = {}) {
  const dependencies = Object.freeze({ ...defaultDependencies(), ...dependencyOverrides });
  const stages = Object.fromEntries(PRESSURE_GAME_READ_ACCEPTANCE_STAGES_V1.map((stage) => [stage, 'NOT_RUN']));
  const clientWallTimes = [];
  const observationSamples = [];
  const comparisonObservations = {};
  const observationReaders = {};
  let currentStage = 'provision';
  let workflowFailure = null;
  let scope = null;
  let identity = null;
  let account = null;
  let fixture = null;
  let runId = null;
  let replayProjection = null;
  let fastProjection = null;
  let comparisonResult = null;
  let observationSummary = null;
  let transitionResult = null;
  let provisionMutationStarted = false;
  let fixtureCreatedAt = null;
  let cleanupRequired = false;

  const executeStage = async (stage, fallbackCode, action) => {
    currentStage = stage;
    try {
      const result = await action();
      stages[stage] = 'PASS';
      return result;
    } catch (error) {
      stages[stage] = 'FAIL';
      if (error instanceof AcceptanceStageError) throw error;
      throw new AcceptanceStageError(stage, fallbackCode, error);
    }
  };

  try {
    await executeStage('provision', 'PROVISION_FAILED', async () => {
      validateRuntimeConfiguration(configuration);
      if (hasObservationLogs(configuration)) {
        for (const mode of MODES) {
          const reader = new ObservationLogReader({
            filePath: configuration.observationLogPaths[mode],
            expectedMode: mode,
          });
          await reader.initializeEmpty();
          observationReaders[mode] = reader;
        }
      }
      scope = await dependencies.loadScope(configuration);
      identity = dependencies.createIdentity();
      fixtureCreatedAt = new Date().toISOString();
      provisionMutationStarted = true;
      account = await dependencies.provision({
        apiBase: configuration.apiBases.REPLAY,
        mailSink: scope.mailSink,
        identity,
      });
      assert.ok(typeof account?.cookie === 'string' && account.cookie, 'account cookie is missing');
      assert.ok(typeof account?.userId === 'string' && account.userId, 'account user id is missing');
      runId = dependencies.deriveRunId(account.userId, identity.idempotencyKey);
      fixture = dependencies.makeFixture({
        identity,
        userId: account.userId,
        runIds: [runId],
        projectFingerprint: scope.projectFingerprint,
        status: 'M5C_RUNNING',
        createdAt: fixtureCreatedAt,
      });
      cleanupRequired = true;
    });

    await executeStage('start', 'START_FAILED', async () => {
      const created = await dependencies.request(configuration.apiBases.REPLAY, '/v4/rooms/solo', {
        method: 'POST',
        cookie: account.cookie,
        body: {
          worldId: 'sangtian',
          idempotencyKey: identity.idempotencyKey,
          resumeExisting: false,
        },
        expectedStatuses: [200, 201],
        timeoutMs: configuration.timeoutMs,
      });
      const returnedRunId = String(created.body?.runId || created.body?.roomId || created.body?.id || '');
      assert.equal(returnedRunId, runId, 'Solo start returned an unexpected run id');
      const projection = await dependencies.waitProjection({
        apiBase: configuration.apiBases.REPLAY,
        cookie: account.cookie,
        runId,
        chapterId: 'N1',
        timeoutMs: configuration.timeoutMs,
      });
      validateInitialN1Projection(projection, runId);
      await settleAndDiscardAll(observationReaders);
      return projection;
    });

    replayProjection = await executeStage('replay', 'REPLAY_READ_FAILED', async () => {
      const sample = await readPublicProjection({
        mode: 'REPLAY',
        configuration,
        dependencies,
        cookie: account.cookie,
        runId,
        observationReaders,
      });
      comparisonObservations.REPLAY = sample.observation;
      return sample.projection;
    });

    const shadowProjection = await executeStage('shadow', 'SHADOW_READ_FAILED', async () => {
      const sample = await readPublicProjection({
        mode: 'SHADOW',
        configuration,
        dependencies,
        cookie: account.cookie,
        runId,
        observationReaders,
      });
      comparisonObservations.SHADOW = sample.observation;
      return sample.projection;
    });

    fastProjection = await executeStage('fast', 'FAST_READ_FAILED', async () => {
      const sample = await readPublicProjection({
        mode: 'FAST',
        configuration,
        dependencies,
        cookie: account.cookie,
        runId,
        observationReaders,
      });
      comparisonObservations.FAST = sample.observation;
      return sample.projection;
    });

    comparisonResult = await executeStage('compare', 'PROJECTION_COMPARISON_FAILED', async () => {
      assert.deepStrictEqual(shadowProjection, replayProjection);
      assert.deepStrictEqual(fastProjection, replayProjection);
      const replayCanonical = canonicalJson(replayProjection);
      assert.equal(canonicalJson(shadowProjection), replayCanonical);
      assert.equal(canonicalJson(fastProjection), replayCanonical);
      const explicit = validateExplicitProjectionBindings(replayProjection);
      return Object.freeze({
        deepEqual: true,
        canonicalJsonEqual: true,
        explicit,
      });
    });

    await executeStage('warm', 'FAST_SAMPLING_FAILED', async () => {
      if (configuration.warmSampleCount < PRESSURE_GAME_READ_MINIMUM_WARM_SAMPLES_V1) {
        throw new AcceptanceStageError('warm', 'INSUFFICIENT_WARM_SAMPLE_CONFIGURATION');
      }
      const total = 1 + configuration.warmSampleCount;
      for (let index = 0; index < total; index += 1) {
        const samplePhase = index === 0 ? 'COLD' : 'WARM';
        const sample = await readPublicProjection({
          mode: 'FAST',
          configuration,
          dependencies,
          cookie: account.cookie,
          runId,
          observationReaders,
        });
        assert.deepStrictEqual(sample.projection, fastProjection, 'FAST sample projection drifted before submit');
        assert.equal(canonicalJson(sample.projection), canonicalJson(fastProjection),
          'FAST sample canonical JSON drifted before submit');
        clientWallTimes.push(sample.clientWallTimeMs);
        if (sample.observation) {
          assert.equal(sample.observation.scenarioDigest, comparisonObservations.FAST.scenarioDigest,
            'FAST sample observation uses a mixed scenario');
          observationSamples.push(Object.freeze({
            sampleIndex: index,
            samplePhase,
            observation: sample.observation,
          }));
        }
      }
      return Object.freeze({
        coldSampleCount: 1,
        warmSampleCount: configuration.warmSampleCount,
        clientWallTimeMs: nearestRankStatistics(clientWallTimes.slice(1)),
      });
    });

    const submittedCommand = await executeStage('submit', 'DECISION_SUBMIT_FAILED', async () => {
      const command = buildDecisionCommand(replayProjection, identity.marker);
      const submitted = await dependencies.request(
        configuration.apiBases.FAST,
        `/v4/rooms/${encodeURIComponent(runId)}/game/action`,
        {
          method: 'POST',
          cookie: account.cookie,
          body: command,
          expectedStatuses: [200, 201],
          timeoutMs: configuration.timeoutMs,
        },
      );
      assert.equal(submitted.body?.schemaVersion, 'pressure_chapter_submit_decision_http_response_v1');
      assert.equal(submitted.body?.idempotencyKey, command.idempotencyKey);
      return command;
    });

    transitionResult = await executeStage('readback', 'DECISION_READBACK_FAILED', async () => {
      const readback = await dependencies.waitReadback({
        apiBase: configuration.apiBases.FAST,
        cookie: account.cookie,
        runId,
        before: replayProjection,
        timeoutMs: configuration.timeoutMs,
      });
      validatePublicProjection(readback, runId, { requireDecision: false });
      assert.equal(readback.viewer?.seatId, replayProjection.viewer.seatId, 'readback changed viewer seat');
      const chapterAdvanced = readback.chapter?.chapterId === 'N2';
      const revisionAdvanced = Number.isSafeInteger(readback.chapter?.workingRevision)
        && readback.chapter.workingRevision > replayProjection.chapter.workingRevision;
      const runtimeAdvanced = readback.chapter?.chapterRuntimeId !== replayProjection.chapter.chapterRuntimeId;
      const decisionPointAdvanced = readback.decision?.decisionPointId !== submittedCommand.decisionPointId;
      assert.ok(chapterAdvanced || revisionAdvanced,
        'FAST readback did not reach N2 or a newer working revision');
      await settleAndDiscardAll(observationReaders);
      return Object.freeze({
        decisionSubmitted: true,
        decisionReadBack: true,
        chapterAdvanced,
        revisionAdvanced,
        runtimeAdvanced,
        decisionPointAdvanced,
      });
    });

    if (hasObservationLogs(configuration)) {
      currentStage = 'warm';
      try {
        observationSummary = summarizePressureGameReadAcceptanceV1({ samples: observationSamples });
        if (observationSummary.status !== 'READY') {
          throw new AcceptanceStageError('warm', 'M5A_SUMMARY_NOT_READY');
        }
        assert.equal(observationSummary.coldSampleCount, 1);
        assert.equal(observationSummary.warmSampleCount, configuration.warmSampleCount);
        assert.equal(observationSummary.mode, 'FAST');
      } catch (error) {
        stages.warm = 'FAIL';
        if (error instanceof AcceptanceStageError) throw error;
        throw new AcceptanceStageError('warm', 'M5A_SUMMARY_FAILED', error);
      }
    }

  } catch (error) {
    workflowFailure = normalizeWorkflowFailure(error, currentStage);
  } finally {
    let cleanupFailure = null;
    try {
      currentStage = 'cleanup';
      if (cleanupRequired) {
        await dependencies.cleanup({ fixture, scope });
      } else if (provisionMutationStarted) {
        throw new AcceptanceStageError('cleanup', 'CLEANUP_CONTEXT_UNAVAILABLE');
      }
      stages.cleanup = 'PASS';
    } catch (error) {
      stages.cleanup = 'FAIL';
      cleanupFailure = normalizeWorkflowFailure(
        error instanceof AcceptanceStageError
          ? error
          : new AcceptanceStageError('cleanup', 'CLEANUP_FAILED', error),
        'cleanup',
      );
    }

    const status = cleanupFailure
      ? 'CLEANUP_FAIL'
      : workflowFailure
        ? 'FAIL_CLEANED'
        : 'PASS_CLEANED';
    return sanitizeAcceptanceResult({
      status,
      stages,
      workflowFailure,
      cleanupFailure,
      configuration,
      runId,
      replayProjection,
      comparisonResult,
      clientWallTimes,
      observationSummary,
      transitionResult,
    });
  }
}

function defaultDependencies() {
  return {
    async loadScope(configuration) {
      const pinned = await loadPinnedTestEnvironment(configuration.repoRoot);
      const smoke = assertLocalAuthFixtureScope({
        testEnvironment: pinned.values,
        runtimeEnvironment: process.env,
        operation: 'smoke',
      });
      const cleanup = assertLocalAuthFixtureScope({
        testEnvironment: pinned.values,
        runtimeEnvironment: process.env,
        operation: 'cleanup',
      });
      assert.deepEqual(cleanup, smoke, 'smoke and cleanup scopes differ');
      return smoke;
    },
    createIdentity: () => createFixtureIdentity(),
    provision: (input) => provisionVerifiedLocalAccount(input),
    deriveRunId: (userId, idempotencyKey) => pressureSoloRunId(userId, idempotencyKey),
    makeFixture: (input) => safeFixtureRecord(input),
    request: (apiBase, pathname, options) => pressureFixtureApiRequest(apiBase, pathname, options),
    waitProjection: (input) => waitForPressureFixtureProjection(input),
    waitReadback: (input) => waitForPressureFixtureDecisionReadback(input),
    cleanup: ({ fixture, scope }) => cleanupFixture({
      fixture,
      databaseUrl: scope.databaseUrl,
      mailSink: scope.mailSink,
    }),
  };
}

async function readPublicProjection({
  mode,
  configuration,
  dependencies,
  cookie,
  runId,
  observationReaders,
}) {
  const startedAt = performance.now();
  const response = await dependencies.request(
    configuration.apiBases[mode],
    `/v4/rooms/${encodeURIComponent(runId)}/game?feedLimit=${configuration.feedLimit}`,
    {
      cookie,
      expectedStatuses: [200],
      timeoutMs: configuration.timeoutMs,
    },
  );
  const clientWallTimeMs = roundMilliseconds(performance.now() - startedAt);
  validatePublicProjection(response.body, runId);
  const observation = observationReaders[mode]
    ? validateObservedRead(await observationReaders[mode].takeExactlyOne({
      timeoutMs: Math.min(OBSERVATION_WAIT_MS, configuration.timeoutMs),
    }), mode, { requireSuccess: true })
    : null;
  return Object.freeze({ projection: response.body, clientWallTimeMs, observation });
}

function validateObservedRead(raw, expectedMode, { requireSuccess }) {
  const observation = validatePressureGameReadObservationV1(raw);
  assert.equal(observation.mode, expectedMode, 'observation mode does not match its API process');
  assert.equal(observation.observabilityFailure, false, 'observer reported observabilityFailure');
  if (requireSuccess) {
    assert.equal(observation.outcome, 'SUCCESS', 'sampled GET /game observation was not successful');
  }
  if (expectedMode === 'SHADOW' && requireSuccess && observation.shadowStatus !== 'MATCH') {
    throw new AcceptanceStageError('shadow', 'SHADOW_OBSERVATION_NOT_MATCH');
  }
  return observation;
}

async function settleAndDiscardAll(readers) {
  for (const mode of MODES) {
    if (readers[mode]) await readers[mode].settleAndDiscard();
  }
}

function validateInitialN1Projection(value, expectedRunId) {
  validatePublicProjection(value, expectedRunId);
  assert.equal(value.chapter?.chapterId, 'N1', 'initial projection is not N1');
  assert.equal(value.route?.participantMode, 'SOLO', 'initial run is not SOLO');
  assert.equal(value.viewer?.control?.canSubmit, true, 'N1 viewer cannot submit');
  assert.ok(Number.isSafeInteger(value.viewer?.control?.controlEpoch)
    && value.viewer.control.controlEpoch >= 0, 'N1 controlEpoch is invalid');
  assert.ok(nonEmptyText(value.viewer?.control?.submissionFenceToken),
    'N1 submission fence is missing');
  assert.equal(value.capabilities?.canSubmitDecision, true, 'N1 decision capability is disabled');
  assert.ok(value.decision?.decisionPointId, 'N1 decision point is missing');
  assert.ok(Number.isSafeInteger(value.decision?.expectedWorkingRevision)
    && value.decision.expectedWorkingRevision >= 0, 'N1 expectedWorkingRevision is invalid');
  assert.equal(value.decision.expectedWorkingRevision, value.chapter.workingRevision,
    'N1 decision revision is not bound to the chapter revision');
  assert.ok(value.decision?.options?.[0]?.code, 'N1 has no legal decision option');
}

function validatePublicProjection(value, expectedRunId, { requireDecision = true } = {}) {
  assert.ok(isPlainRecord(value), 'projection must be a plain JSON object');
  assert.equal(value.schemaVersion, 'pressure_chapter_game_projection_v1');
  assert.equal(value.runId, expectedRunId, 'projection runId does not match the single fixture run');
  assert.equal(value.roomId, expectedRunId, 'projection roomId does not match the single fixture run');
  canonicalJson(value);
  validateExplicitProjectionBindings(value, { requireDecision });
  return value;
}

function validateExplicitProjectionBindings(projection, { requireDecision = true } = {}) {
  assert.ok(isSha256(projection.projectionHash), 'projectionHash is not SHA-256');
  assert.ok(nonEmptyText(projection.viewer?.seatId), 'viewer seat is missing');
  assert.ok(isSha256(projection.route?.routeHash), 'routeHash is not SHA-256');
  assert.ok(nonEmptyText(projection.chapter?.chapterRuntimeId), 'chapterRuntimeId is missing');
  assert.ok(Number.isSafeInteger(projection.chapter?.workingRevision)
    && projection.chapter.workingRevision >= 0, 'workingRevision is invalid');
  for (const key of ['projectionKind', 'sourceAuthority', 'sourceId', 'sourceCommitHash']) {
    assert.ok(nonEmptyText(projection.narrative?.[key]), `narrative.${key} is missing`);
  }
  assert.ok(isPlainRecord(projection.capabilities), 'capabilities are missing');
  assert.ok(Array.isArray(projection.capabilities.allowedActionTypes),
    'capabilities.allowedActionTypes are missing');
  assert.ok(Array.isArray(projection.resources), 'resources are missing');
  assert.ok(Array.isArray(projection.tokens), 'tokens are missing');
  if (requireDecision) {
    assert.ok(Array.isArray(projection.decision?.options), 'decision options are missing');
  } else {
    assert.ok(projection.decision === null || Array.isArray(projection.decision?.options),
      'readback decision is neither null nor a decision object');
  }
  assert.equal(projection.feedPage?.roomId, projection.roomId,
    'Feed page room differs from the projection');
  assert.equal(projection.feedPage?.runId, projection.runId,
    'Feed page run differs from the projection');
  assert.equal(projection.feedPage?.viewerSeatId, projection.viewer.seatId,
    'Feed page audience differs from the viewer seat');
  assert.ok(Array.isArray(projection.feedPage?.items), 'Feed items are missing');
  for (const item of projection.feedPage.items) {
    assert.equal(item?.roomId, projection.roomId, 'Feed item room differs from the projection');
    assert.equal(item?.runId, projection.runId, 'Feed item run differs from the projection');
    assert.equal(item?.viewerSeatId, projection.viewer.seatId,
      'Feed item audience differs from the viewer seat');
  }
  return Object.freeze({
    projectionHash: true,
    seat: true,
    routeHash: true,
    chapterRuntimeId: true,
    workingRevision: true,
    narrativeSource: true,
    capabilities: true,
    resources: true,
    tokens: true,
    decisionOptions: true,
    feedAudience: true,
  });
}

function buildDecisionCommand(projection, marker) {
  validateInitialN1Projection(projection, projection.runId);
  const option = projection.decision.options[0];
  return Object.freeze({
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
    idempotencyKey: `pc-action:${marker}`,
    optionCode: option.code,
    customText: null,
    sourceEventId: null,
  });
}

function validateRuntimeConfiguration(configuration) {
  assert.ok(isPlainRecord(configuration), 'configuration must be a plain object');
  assert.equal(configuration.feedLimit, PRESSURE_GAME_READ_FIXED_FEED_LIMIT_V1,
    'feed query must use the fixed limit');
  assert.ok(Number.isSafeInteger(configuration.timeoutMs) && configuration.timeoutMs > 0,
    'timeout must be a positive integer');
  assert.ok(Number.isSafeInteger(configuration.warmSampleCount)
    && configuration.warmSampleCount >= 0
    && configuration.warmSampleCount <= MAX_EXPLICIT_WARM_SAMPLES,
  'warm sample count is outside the bounded acceptance range');
  for (const mode of MODES) {
    assert.equal(
      configuration.apiBases?.[mode],
      normalizeApiBase(configuration.apiBases?.[mode], API_BASE_ENV[mode]),
      `${API_BASE_ENV[mode]} must be normalized`,
    );
  }
  const origins = MODES.map((mode) => new URL(configuration.apiBases[mode]).origin);
  assert.equal(new Set(origins).size, MODES.length, 'the three API bases must use isolated origins');
  const provided = MODES.filter((mode) => configuration.observationLogPaths?.[mode]).length;
  assert.ok(provided === 0 || provided === MODES.length,
    'observation logs must be omitted together or provided for all three modes');
  if (provided === MODES.length) {
    const resolvedLogs = MODES.map((mode) => path.resolve(configuration.observationLogPaths[mode]));
    assert.equal(new Set(resolvedLogs).size, MODES.length, 'observation log paths must be distinct');
  }
}

function sanitizeAcceptanceResult({
  status,
  stages,
  workflowFailure,
  cleanupFailure,
  configuration,
  runId,
  replayProjection,
  comparisonResult,
  clientWallTimes,
  observationSummary,
  transitionResult,
}) {
  const result = {
    schemaVersion: PRESSURE_GAME_READ_ACCEPTANCE_SCHEMA_V1,
    status,
    failedStage: cleanupFailure?.stage ?? workflowFailure?.stage ?? null,
    failureCode: cleanupFailure?.code ?? workflowFailure?.code ?? null,
    workflowFailure: workflowFailure
      ? Object.freeze({ stage: workflowFailure.stage, code: workflowFailure.code })
      : null,
    cleanupFailure: cleanupFailure
      ? Object.freeze({ stage: cleanupFailure.stage, code: cleanupFailure.code })
      : null,
    stages: Object.freeze({ ...stages }),
    fixture: Object.freeze({
      credentialsPersisted: false,
      cookiePersisted: false,
      cleanupAttempted: stages.cleanup !== 'NOT_RUN',
      cleanupSucceeded: stages.cleanup === 'PASS',
    }),
    scenario: replayProjection && runId
      ? Object.freeze({
        runDigest: digestOpaque(runId),
        viewerDigest: digestOpaque(replayProjection.viewer?.seatId),
        participantMode: replayProjection.route?.participantMode ?? null,
        chapterBefore: replayProjection.chapter?.chapterId ?? null,
        feedLimit: Number.isSafeInteger(configuration?.feedLimit) ? configuration.feedLimit : null,
      })
      : null,
    equivalence: comparisonResult,
    sampling: clientWallTimes.length > 0
      ? Object.freeze({
        coldSampleCount: 1,
        warmSampleCount: Math.max(0, clientWallTimes.length - 1),
        warmSampleCountConfigured: Number.isSafeInteger(configuration?.warmSampleCount)
          ? configuration.warmSampleCount
          : null,
        clientWarmWallTimeMs: clientWallTimes.length > 1
          ? nearestRankStatistics(clientWallTimes.slice(1))
          : null,
        observation: Object.freeze({
          provided: hasObservationLogs(configuration),
          summary: observationSummary,
        }),
      })
      : null,
    transition: transitionResult,
  };
  const serialized = JSON.stringify(result);
  assertNoCredentialMaterial(serialized);
  return Object.freeze(result);
}

function normalizeWorkflowFailure(error, fallbackStage) {
  if (error instanceof AcceptanceStageError) {
    return Object.freeze({
      stage: PRESSURE_GAME_READ_ACCEPTANCE_STAGES_V1.includes(error.stage) ? error.stage : fallbackStage,
      code: SAFE_CODE.test(error.code) ? error.code : 'ACCEPTANCE_STAGE_FAILED',
    });
  }
  return Object.freeze({
    stage: PRESSURE_GAME_READ_ACCEPTANCE_STAGES_V1.includes(fallbackStage) ? fallbackStage : 'provision',
    code: 'ACCEPTANCE_STAGE_FAILED',
  });
}

function nearestRankStatistics(values) {
  assert.ok(values.length > 0, 'statistics require at least one value');
  const sorted = [...values].sort((left, right) => left - right);
  return Object.freeze({
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: nearestRank(sorted, 0.5),
    p95: nearestRank(sorted, 0.95),
    percentileMethod: 'NEAREST_RANK',
  });
}

function nearestRank(sorted, percentile) {
  return sorted[Math.max(1, Math.ceil(sorted.length * percentile)) - 1];
}

function roundMilliseconds(value) {
  return Math.round(value * 1_000) / 1_000;
}

function hasObservationLogs(configuration) {
  return MODES.every((mode) => Boolean(configuration.observationLogPaths?.[mode]));
}

function normalizeApiBase(raw, name) {
  assert.ok(typeof raw === 'string' && raw.trim(), `${name} is required`);
  const parsed = new URL(raw.trim());
  assert.equal(parsed.protocol, 'http:', `${name} must use http on loopback`);
  assert.ok(LOOPBACK_HOSTS.has(parsed.hostname), `${name} must use a loopback hostname`);
  assert.equal(parsed.username, '', `${name} must not embed credentials`);
  assert.equal(parsed.password, '', `${name} must not embed credentials`);
  assert.equal(parsed.search, '', `${name} must not contain a query`);
  assert.equal(parsed.hash, '', `${name} must not contain a fragment`);
  assert.ok(parsed.port, `${name} must use an explicit isolated port`);
  const normalizedPath = parsed.pathname.replace(/\/+$/u, '') || '/';
  assert.equal(normalizedPath, '/api', `${name} must end at the API /api base`);
  parsed.pathname = '/api';
  return parsed.toString().replace(/\/$/u, '');
}

function parseNamedArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    assert.ok(token.startsWith('--'), `unexpected positional argument at index ${index}`);
    const withoutPrefix = token.slice(2);
    const equalIndex = withoutPrefix.indexOf('=');
    const key = equalIndex >= 0 ? withoutPrefix.slice(0, equalIndex) : withoutPrefix;
    const inlineValue = equalIndex >= 0 ? withoutPrefix.slice(equalIndex + 1) : null;
    const value = inlineValue ?? argv[++index];
    assert.ok(key && value !== undefined && !String(value).startsWith('--'), `missing value for --${key}`);
    assert.equal(values.has(key), false, `duplicate argument --${key}`);
    values.set(key, String(value));
  }
  return values;
}

function parseBoundedInteger(raw, minimum, maximum, label) {
  assert.match(String(raw), /^[0-9]+$/u, `${label} must be an integer`);
  const value = Number(raw);
  assert.ok(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    `${label} must be between ${minimum} and ${maximum}`);
  return value;
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function nonEmptyText(value) {
  return typeof value === 'string' && value.length > 0;
}

function digestOpaque(value) {
  return typeof value === 'string' && value
    ? createHash('sha256').update(value, 'utf8').digest('hex')
    : null;
}

function assertNoCredentialMaterial(serialized) {
  const lower = serialized.toLowerCase();
  for (const forbidden of [
    'set-cookie',
    'authorization:',
    'bearer ',
    'postgres://',
    'postgresql://',
    'supabase.co:',
  ]) {
    assert.equal(lower.includes(forbidden), false, `sanitized output contains forbidden material: ${forbidden}`);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  let result;
  try {
    const configuration = parseGameReadPerformanceAcceptanceConfiguration();
    result = await runGameReadPerformanceAcceptance(configuration);
  } catch (error) {
    const failure = normalizeWorkflowFailure(error, 'provision');
    result = Object.freeze({
      schemaVersion: PRESSURE_GAME_READ_ACCEPTANCE_SCHEMA_V1,
      status: 'FAIL_CLEANED',
      failedStage: failure.stage,
      failureCode: failure.code,
      workflowFailure: failure,
      cleanupFailure: null,
      stages: Object.freeze(Object.fromEntries(
        PRESSURE_GAME_READ_ACCEPTANCE_STAGES_V1.map((stage) => [stage, stage === failure.stage ? 'FAIL' : 'NOT_RUN']),
      )),
      fixture: Object.freeze({
        credentialsPersisted: false,
        cookiePersisted: false,
        cleanupAttempted: false,
        cleanupSucceeded: true,
      }),
      scenario: null,
      equivalence: null,
      sampling: null,
      transition: null,
    });
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === 'PASS_CLEANED' ? 0 : 1;
}

const directUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (directUrl === import.meta.url) {
  await main();
}
