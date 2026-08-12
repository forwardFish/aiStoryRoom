import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function skipUnlessEnvironment(t, requirements, environment = process.env) {
  const missing = requirements.filter((name) => !String(environment[name] ?? '').trim());
  if (missing.length === 0) return false;
  t.skip(`BLOCKED_BY_ENVIRONMENT: missing ${missing.join(', ')}`);
  return true;
}

export function assertNonProductionScope(environment = process.env) {
  assert.equal(
    environment.PRESSURE_CHAPTER_TEST_SCOPE,
    'non-production',
    'PRESSURE_CHAPTER_TEST_SCOPE must explicitly equal non-production',
  );
  assert.notEqual(environment.NODE_ENV, 'production', 'production execution is forbidden');
}

export function normalizeBaseUrl(raw) {
  const url = new URL(String(raw));
  assert.ok(url.protocol === 'http:' || url.protocol === 'https:', 'test base URL must use HTTP(S)');
  url.pathname = url.pathname.replace(/\/+$/u, '');
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/$/u, '');
}

export async function readJsonFixture(raw, label, repoRoot = process.cwd()) {
  const value = String(raw ?? '').trim();
  assert.ok(value, `${label} is required`);
  const text = value.startsWith('{') || value.startsWith('[')
    ? value
    : await readFile(path.resolve(repoRoot, value), 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    assert.fail(`${label} must be JSON or a path to a JSON file`);
  }
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), `${label} must contain an object`);
  return parsed;
}

export async function fetchWithTimeout(url, init = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const reason = error?.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : 'was unreachable';
    throw new Error(`live acceptance endpoint ${reason}: ${new URL(url).origin}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function requestJson(baseUrl, pathname, { cookie, method = 'GET', body, timeoutMs } = {}) {
  const url = new URL(pathname, `${baseUrl}/`).href;
  const response = await fetchWithTimeout(url, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, timeoutMs);
  const payload = await response.json().catch(() => null);
  return { response, payload, url };
}

export function requireFixtureString(record, key, label = 'fixture') {
  const value = record?.[key];
  assert.ok(typeof value === 'string' && value.trim(), `${label}.${key} must be a non-empty string`);
  return value.trim();
}

export function requireStringArray(value, label, minimum = 0) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  const result = value.map((entry, index) => {
    assert.ok(typeof entry === 'string' && entry.length > 0, `${label}[${index}] must be a non-empty string`);
    return entry;
  });
  assert.ok(result.length >= minimum, `${label} must contain at least ${minimum} item(s)`);
  return result;
}

export function encodeRoomPath(runId, suffix = 'game') {
  return `/api/v4/rooms/${encodeURIComponent(runId)}/${suffix}`;
}
