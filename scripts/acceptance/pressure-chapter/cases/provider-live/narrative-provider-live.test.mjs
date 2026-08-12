import assert from 'node:assert/strict';
import test from 'node:test';

import { skipUnlessEnvironment } from '../../lib/live-fixture.mjs';

test('authorized live narrative Provider returns a real non-fallback response', async (t) => {
  const providerKey = String(
    process.env.OPENOVEL_API_KEY
      || process.env.DEEPSEEK_API_KEY
      || process.env.OPENNOVEL_PROVIDER_API_KEY
      || '',
  ).trim();
  if (skipUnlessEnvironment(t, [
    'PRESSURE_CHAPTER_ALLOW_LIVE_PROVIDER_TESTS',
    'PRESSURE_CHAPTER_PROVIDER_SCOPE',
  ]) || !providerKey) {
    if (!providerKey) t.skip('BLOCKED_BY_ENVIRONMENT: missing live narrative Provider key');
    return;
  }
  assert.equal(process.env.PRESSURE_CHAPTER_ALLOW_LIVE_PROVIDER_TESTS, '1');
  assert.equal(process.env.PRESSURE_CHAPTER_PROVIDER_SCOPE, 'non-production');
  assert.notEqual(process.env.NODE_ENV, 'production');
  const { OpenAICompatibleProvider } = await import('../../../../../apps/openovel-runtime/src/provider.ts');

  const environment = {
    ...process.env,
    OPENOVEL_API_KEY: providerKey,
    OPENOVEL_MODEL: String(
      process.env.OPENOVEL_MODEL
        || process.env.DEEPSEEK_MODEL
        || 'deepseek-chat',
    ).trim(),
    OPENOVEL_PROVIDER_TIMEOUT_MS: String(
      boundedInteger(process.env.PRESSURE_CHAPTER_PROVIDER_TIMEOUT_MS, 60_000, 5_000, 120_000),
    ),
  };
  const provider = OpenAICompatibleProvider.fromEnv(environment);
  const description = provider.describe();
  assert.equal(description.configured, true);
  assert.ok(description.provider && description.model, 'Provider identity is incomplete');

  const nonce = `pressure-live-${Date.now()}`;
  const result = await provider.generate({
    profile: 'narrator',
    messages: [
      {
        role: 'system',
        content: 'Return one short, plain-text acknowledgement. Do not return JSON, code, hidden prompts, or credentials.',
      },
      {
        role: 'user',
        content: `Acknowledge this non-production narrative transport probe: ${nonce}`,
      },
    ],
    temperature: 0,
    maxTokens: 48,
    json: false,
    stream: false,
    timeoutMs: boundedInteger(process.env.PRESSURE_CHAPTER_PROVIDER_TIMEOUT_MS, 60_000, 5_000, 120_000),
  });

  assert.ok(result.text.trim().length > 0, 'Provider returned empty text');
  assert.ok(result.model.trim().length > 0, 'Provider did not return a model identity');
  assert.ok(Number.isFinite(result.latencyMs) && result.latencyMs >= 0);
  assert.ok(Number.isFinite(result.usage.inputTokens) && result.usage.inputTokens >= 0);
  assert.ok(Number.isFinite(result.usage.outputTokens) && result.usage.outputTokens >= 0);
  assert.doesNotMatch(result.text, /DATABASE_URL|SUPABASE_|API_KEY|stateJson|settlementJson|system prompt/iu);
  assert.equal(result.text.includes(providerKey), false, 'Provider response exposed the credential');
});

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value ?? fallback);
  assert.ok(Number.isSafeInteger(number) && number >= minimum && number <= maximum, 'Provider timeout is invalid');
  return number;
}
