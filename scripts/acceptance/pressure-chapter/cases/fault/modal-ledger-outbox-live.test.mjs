import assert from 'node:assert/strict';
import test from 'node:test';

import { readJsonFixture, requireFixtureString, skipUnlessEnvironment } from '../../lib/live-fixture.mjs';

const ENV = [
  'PRESSURE_CHAPTER_ALLOW_MODAL_TRIGGER_TESTS',
  'PRESSURE_CHAPTER_ALLOW_FAULT_TESTS',
  'PRESSURE_CHAPTER_TEST_SCOPE',
  'PRESSURE_CHAPTER_DB_SCOPE',
  'PRESSURE_CHAPTER_DATABASE_PROVIDER',
  'DATABASE_URL',
  'PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256',
  'PRESSURE_MODAL_TRIGGER_LIVE_FIXTURE',
];

test('real PrismaWorkingLedgerRepository seam rolls back ledger/outbox at both injected boundaries', { timeout: 120_000 }, async (t) => {
  if (skipUnlessEnvironment(t, ENV)) return;
  assert.equal(process.env.PRESSURE_CHAPTER_ALLOW_MODAL_TRIGGER_TESTS, '1');
  assert.equal(process.env.PRESSURE_CHAPTER_ALLOW_FAULT_TESTS, '1');
  assert.equal(process.env.PRESSURE_CHAPTER_TEST_SCOPE, 'non-production');
  assert.equal(process.env.PRESSURE_CHAPTER_DB_SCOPE, 'non-production');
  assert.equal(process.env.PRESSURE_CHAPTER_DATABASE_PROVIDER, 'supabase');
  assert.notEqual(process.env.NODE_ENV, 'production');

  const { assertSafePressureDatabaseScope } = await import('../../../../../apps/api/src/pressure-chapter/persistence/database-contract.ts');
  const { PrismaWorkingLedgerRepository } = await import('../../../../../apps/api/src/pressure-chapter/persistence/working-ledger.prisma-adapter.ts');
  const scope = assertSafePressureDatabaseScope({
    databaseUrl: process.env.DATABASE_URL,
    explicitScope: process.env.PRESSURE_CHAPTER_DB_SCOPE,
    allowedSupabaseProjectSha256: process.env.PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256,
  });
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: scope.databaseUrl } } });
  t.after(async () => prisma.$disconnect());

  const fixture = await readJsonFixture(process.env.PRESSURE_MODAL_TRIGGER_LIVE_FIXTURE, 'PRESSURE_MODAL_TRIGGER_LIVE_FIXTURE');
  const transaction = fixture.faultTransaction;
  const runId = requireFixtureString(transaction, 'runId', 'faultTransaction');
  const chapterRuntimeId = requireFixtureString(transaction, 'chapterRuntimeId', 'faultTransaction');
  assert.ok(Array.isArray(transaction.events) && transaction.events.length > 0, 'faultTransaction.events must contain a provisioned uncommitted Working Ledger append');
  assert.ok(transaction.events.every((event) => event.runId === runId && event.chapterRuntimeId === chapterRuntimeId));
  const append = {
    key: { runId, chapterRuntimeId },
    expectedHeadHash: transaction.expectedHeadHash ?? null,
    events: structuredClone(transaction.events),
  };
  const eventIds = append.events.map((event) => {
    const eventHash = requireFixtureString(event, 'eventHash', 'faultTransaction.events[]');
    assert.match(eventHash, /^[a-f0-9]{64}$/u);
    return `pressure_ledger_${eventHash.slice(0, 32)}`;
  });
  const baseline = await persistedCounts(prisma, runId, eventIds, []);

  for (const faultPoint of ['AFTER_LEDGER_BEFORE_OUTBOX', 'AFTER_OUTBOX_BEFORE_COMMIT']) {
    const attempted = { ledger: [], outbox: [] };
    const repository = new PrismaWorkingLedgerRepository(faultInjectingPrisma(prisma, faultPoint, attempted));
    await assert.rejects(
      () => repository.append(structuredClone(append)),
      (error) => error?.code === 'PRESSURE_ACCEPTANCE_INJECTED_TRANSACTION_FAULT',
      `${faultPoint} did not cross the real repository transaction seam`,
    );
    assert.ok(attempted.ledger.length > 0, `${faultPoint} never reached Working Ledger persistence`);
    if (faultPoint === 'AFTER_OUTBOX_BEFORE_COMMIT') {
      assert.ok(attempted.outbox.length > 0, `${faultPoint} never reached Pressure Outbox persistence`);
    }
    const outboxKeys = attempted.outbox.map((row) => row.dedupeKey).filter(Boolean);
    assert.deepEqual(
      await persistedCounts(prisma, runId, eventIds, outboxKeys),
      baseline,
      `${faultPoint} left a partial real Supabase commit`,
    );
  }

  const committedWrites = { ledger: [], outbox: [] };
  const repository = new PrismaWorkingLedgerRepository(faultInjectingPrisma(prisma, null, committedWrites));
  const committed = await repository.append(structuredClone(append));
  assert.equal(committed.status, 'APPENDED');
  assert.ok(committedWrites.outbox.length > 0, 'successful append emitted no Pressure Outbox work');
  const committedOutboxKeys = committedWrites.outbox.map((row) => row.dedupeKey).filter(Boolean);
  const afterCommit = await persistedCounts(prisma, runId, eventIds, committedOutboxKeys);
  assert.equal(afterCommit.ledger, baseline.ledger + append.events.length, 'Working Ledger did not commit exactly once');
  assert.equal(afterCommit.outbox, baseline.outbox + committedOutboxKeys.length, 'Pressure Outbox did not commit exactly once');

  const replay = await repository.append(structuredClone(append));
  assert.equal(replay.status, 'HEAD_MISMATCH', 'same append replay unexpectedly wrote a second authority chain');
  assert.deepEqual(await persistedCounts(prisma, runId, eventIds, committedOutboxKeys), afterCommit, 'replay duplicated ledger/outbox rows');
});

function faultInjectingPrisma(prisma, faultPoint, attempted) {
  return {
    $transaction(operation, options) {
      return prisma.$transaction(async (tx) => {
        const result = await operation(transactionProxy(tx, faultPoint, attempted));
        if (faultPoint === 'AFTER_OUTBOX_BEFORE_COMMIT') {
          assert.ok(attempted.outbox.length > 0, 'fault seam did not observe an outbox write');
          throw injectedFault(faultPoint);
        }
        return result;
      }, options);
    },
  };
}

function transactionProxy(tx, faultPoint, attempted) {
  return new Proxy(tx, {
    get(target, property, receiver) {
      if (property === 'storyEvent') {
        return delegateProxy(Reflect.get(target, property, receiver), async (input, call) => {
          const result = await call(input);
          if (input?.data?.type === 'PRESSURE_WORKING_LEDGER_EVENT') attempted.ledger.push(structuredClone(input.data));
          return result;
        });
      }
      if (property === 'pressureOutboxTask') {
        return delegateProxy(Reflect.get(target, property, receiver), async (input, call) => {
          if (faultPoint === 'AFTER_LEDGER_BEFORE_OUTBOX') {
            assert.ok(attempted.ledger.length > 0, 'outbox boundary was reached before a ledger write');
            throw injectedFault(faultPoint);
          }
          const result = await call(input);
          attempted.outbox.push(structuredClone(input.data));
          return result;
        });
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function delegateProxy(delegate, interceptCreate) {
  return new Proxy(delegate, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property === 'create') return (input) => interceptCreate(input, value.bind(target));
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function injectedFault(point) {
  return Object.assign(new Error(`injected transaction fault at ${point}`), {
    code: 'PRESSURE_ACCEPTANCE_INJECTED_TRANSACTION_FAULT',
  });
}

async function persistedCounts(prisma, runId, eventIds, outboxKeys) {
  const [ledger, outbox] = await Promise.all([
    prisma.storyEvent.count({ where: { runId, id: { in: eventIds } } }),
    outboxKeys.length === 0 ? 0 : prisma.pressureOutboxTask.count({ where: { runId, dedupeKey: { in: outboxKeys } } }),
  ]);
  return { ledger, outbox };
}
