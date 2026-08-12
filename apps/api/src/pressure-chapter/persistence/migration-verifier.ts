export interface PressureMigrationVerificationResult {
  ok: boolean;
  issues: string[];
}

export const REQUIRED_PRESSURE_MODELS = Object.freeze([
  "PressureRunLifecycle",
  "PressureRunRouteSnapshot",
  "PressureGenesisCommit",
  "PressureChapterRuntime",
  "PressureDecisionAction",
  "PressureChapterSettlement",
  "PressureFinaleDecision",
  "PressureLegacyTerminalCommit",
  "PressureNarrativeProjection",
  "PressureOutboxTask",
  "PressureReplayCommandReceipt",
  "PressureSeatControlSnapshot",
] as const);

export const RETIRED_PRESSURE_MODELS = Object.freeze([
  "PressureLobbyCommandReceipt",
  "PressureGenesisSnapshot",
  "PressureDecisionPointInstance",
  "PressureDecisionActionRevision",
  "PressureChapterWorkingLedgerEntry",
  "PressureResourceReservation",
  "PressureBeatResolution",
  "PressureFrozenChapterBundle",
  "PressureSeatArcSnapshot",
  "PressureFinaleSeatOutcome",
  "PressureFinaleShadowComparison",
  "PressureNarrativeArtifact",
  "PressureResultArtifact",
  "PressureSeatControlFrozenPolicy",
  "PressureSeatControlSeatSnapshot",
  "PressureSeatControlEvent",
  "PressureSeatControlCommandReceipt",
  "PressureSeatPresenceRecord",
  "PressureSeatDefaultDirective",
  "PressureSeatDecisionProof",
  "PressureSeatPrivateProjection",
] as const);

export function verifyPressurePersistenceArtifacts(
  schema: string,
  migrationSql: string,
): PressureMigrationVerificationResult {
  const issues: string[] = [];
  for (const model of REQUIRED_PRESSURE_MODELS) {
    if (!new RegExp(`\\bmodel\\s+${model}\\s*\\{`).test(schema)) {
      issues.push(`schema missing model ${model}`);
    }
    if (!migrationSql.includes(`CREATE TABLE \"${model}\"`)) {
      issues.push(`migration missing table ${model}`);
    }
  }
  for (const model of RETIRED_PRESSURE_MODELS) {
    if (new RegExp(`\\bmodel\\s+${model}\\s*\\{`).test(schema)) {
      issues.push(`schema retains retired model ${model}`);
    }
    if (migrationSql.includes(`CREATE TABLE \"${model}\"`)) {
      issues.push(`migration creates retired table ${model}`);
    }
  }

  const createdPressureTables = [
    ...migrationSql.matchAll(/CREATE TABLE \"(Pressure[^\"]+)\"/g),
  ].map((match) => match[1]);
  if (createdPressureTables.length !== REQUIRED_PRESSURE_MODELS.length) {
    issues.push(
      `migration must create exactly ${REQUIRED_PRESSURE_MODELS.length} Pressure tables; found ${createdPressureTables.length}`,
    );
  }

  const forbidden = [
    /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX)\b/i,
    /\bTRUNCATE\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bUPDATE\s+\"/i,
    /\bINSERT\s+INTO\b/i,
    /\bRENAME\b/i,
    /\bALTER\s+COLUMN\b/i,
    /\bSET\s+NOT\s+NULL\b/i,
    /\bALTER\s+TABLE\s+"StoryRun"\b/i,
    /\bALTER\s+TABLE\s+"ActionWindow"\b/i,
    /\bALTER\s+TABLE\s+"ActorThread"\b/i,
  ];
  for (const expression of forbidden) {
    if (expression.test(migrationSql)) issues.push(`migration is not expand-only: ${expression}`);
  }

  const requiredSqlFragments = [
    'CREATE INDEX "pc_lifecycle_state_updated_idx"',
    'CONSTRAINT "pc_lifecycle_run_fkey"',
    'CREATE UNIQUE INDEX "pc_route_run_key"',
    'CREATE UNIQUE INDEX "pc_route_hash_run_key"',
    'CREATE UNIQUE INDEX "pc_genesis_commit_run_key"',
    'CREATE UNIQUE INDEX "pc_chapter_run_sequence_key"',
    '"decisionStateJson" JSONB NOT NULL',
    '"ledgerProjectionJson" JSONB NOT NULL',
    'CREATE UNIQUE INDEX "pc_action_run_idempotency_key"',
    'CREATE UNIQUE INDEX "pc_action_authority_event_key"',
    'CREATE UNIQUE INDEX "pc_settlement_chapter_key"',
    'CREATE UNIQUE INDEX "pc_settlement_bundle_hash_key"',
    'CREATE UNIQUE INDEX "pc_finale_run_key"',
    'CREATE UNIQUE INDEX "pc_narrative_projection_logical_key"',
    '"artifactJson" JSONB',
    '"artifactContentHash" TEXT',
    'CREATE UNIQUE INDEX "pc_outbox_dedupe_key"',
    'CREATE UNIQUE INDEX "pc_replay_source_idempotency_key"',
    'CREATE UNIQUE INDEX "pc_seat_snapshot_run_key"',
    'CONSTRAINT "pc_chapter_route_fkey"',
    'CONSTRAINT "pc_finale_route_fkey"',
    'CONSTRAINT "pc_seat_snapshot_run_fkey"',
  ];
  for (const fragment of requiredSqlFragments) {
    if (!migrationSql.includes(fragment)) issues.push(`migration missing invariant: ${fragment}`);
  }

  return { ok: issues.length === 0, issues };
}
