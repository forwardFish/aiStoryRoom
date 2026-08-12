import assert from "node:assert/strict";
import test from "node:test";
import type {
  ChapterSettlementPrismaClient,
} from "./chapter-settlement.prisma-adapter";
import type {
  ChapterSettlementSourcePrismaClient,
} from "./chapter-settlement-source.prisma-adapter";
import type {
  NarrativeAuthorityReadPrismaClient,
  NarrativeOutboxPrismaClient,
  NarrativeProjectionPrismaClient,
} from "./narrative.prisma-adapter";
import type { ReplayReceiptTransactionV1 } from "./replay.prisma-adapter";
import type {
  OrchestratorStatePrismaClient,
} from "./orchestrator-state.prisma-adapter";
import type {
  ResultReadModelPrismaClient,
  ResultViewerPrismaClient,
} from "./result.prisma-adapter";
import type {
  AuthorityFirstTerminalPrismaClient,
  FinaleShadowAppendPrismaClient,
  N7FrozenFinaleSourcePrismaClient,
} from "./terminal.prisma-adapter";
import {
  PRESSURE_TRANSACTION_OPTIONS,
  type PressureSerializableClient,
} from "./transaction";
import type { WorkingLedgerPrismaClient } from "./working-ledger.prisma-adapter";

type TxOf<T> = T extends PressureSerializableClient<infer TTransaction>
  ? TTransaction
  : never;
type MustBeNever<T extends never> = T;
type AuthorityTable =
  | "storyRun"
  | "pressureGenesisCommit"
  | "pressureChapterSettlement"
  | "pressureFrozenChapterBundle"
  | "pressureFinaleDecision"
  | "pressureResultArtifact"
  | "pressureLegacyTerminalCommit";
type MutationMethod =
  | "create"
  | "createMany"
  | "update"
  | "updateMany"
  | "upsert"
  | "delete"
  | "deleteMany";
type MutationMethods<T> = {
  [K in keyof T]: Extract<keyof T[K], MutationMethod>;
}[keyof T];

// Compile-time architecture guards. A future delegate addition that reverses
// one of these trust boundaries makes `tsc --noEmit` fail here.
type _WorkingLedgerCannotMutateWorld = MustBeNever<
  MutationMethods<Pick<TxOf<WorkingLedgerPrismaClient>, "storyRun">>
>;
type _OrchestratorStateCannotReachAuthorityTables = MustBeNever<
  Extract<keyof TxOf<OrchestratorStatePrismaClient>, AuthorityTable>
>;
type _SettlementSourceCannotMutateReadAuthority = MustBeNever<
  MutationMethods<Pick<
    TxOf<ChapterSettlementSourcePrismaClient>,
    "storyRun" | "pressureGenesisCommit" | "pressureChapterSettlement"
  >>
>;
type _SettlementSourceCannotReachCommitAuthority = MustBeNever<
  Extract<
    keyof TxOf<ChapterSettlementSourcePrismaClient>,
    "pressureFinaleDecision" | "pressureResultArtifact"
  >
>;
type _NarrativeOutboxCannotWriteAuthority = MustBeNever<
  Extract<keyof TxOf<NarrativeOutboxPrismaClient>, AuthorityTable>
>;
type _NarrativeProjectionCannotWriteAuthority = MustBeNever<
  Extract<keyof TxOf<NarrativeProjectionPrismaClient>, AuthorityTable>
>;
type _NarrativeAuthorityReaderHasNoMutationMethods = MustBeNever<
  MutationMethods<TxOf<NarrativeAuthorityReadPrismaClient>>
>;
type _ReplayReceiptCannotWriteSourceRun = MustBeNever<
  Extract<keyof ReplayReceiptTransactionV1, "storyRun">
>;
type _N7FrozenSourceReaderHasNoMutationMethods = MustBeNever<
  MutationMethods<TxOf<N7FrozenFinaleSourcePrismaClient>>
>;
type _GenericShadowCannotWriteAuthority = MustBeNever<
  Extract<keyof TxOf<FinaleShadowAppendPrismaClient>, AuthorityTable>
>;
type _ResultReadModelHasNoMutationMethods = MustBeNever<
  MutationMethods<TxOf<ResultReadModelPrismaClient>>
>;
type _ResultViewerAuthorizerHasNoMutationMethods = MustBeNever<
  MutationMethods<TxOf<ResultViewerPrismaClient>>
>;
type _TerminalCommitterOwnsOnlyExpectedAuthority = Exclude<
  Extract<keyof TxOf<AuthorityFirstTerminalPrismaClient>, AuthorityTable>,
  | "storyRun"
  | "pressureGenesisCommit"
  | "pressureChapterSettlement"
  | "pressureFrozenChapterBundle"
  | "pressureFinaleDecision"
  | "pressureResultArtifact"
>;
type _TerminalHasNoUnexpectedAuthority = MustBeNever<
  _TerminalCommitterOwnsOnlyExpectedAuthority
>;
type _B0IsAllowedToOwnWorldAuthority = Extract<
  keyof TxOf<ChapterSettlementPrismaClient>,
  "storyRun" | "pressureChapterSettlement"
>;
const b0AuthorityKeys: Record<_B0IsAllowedToOwnWorldAuthority, true> = {
  storyRun: true,
  pressureChapterSettlement: true,
};

test("all persistence transactions use the frozen Serializable policy", () => {
  assert.equal(PRESSURE_TRANSACTION_OPTIONS.isolationLevel, "Serializable");
  assert.equal(PRESSURE_TRANSACTION_OPTIONS.maxWait, 10_000);
  assert.equal(PRESSURE_TRANSACTION_OPTIONS.timeout, 30_000);
  assert.deepEqual(Object.keys(b0AuthorityKeys).sort(), [
    "pressureChapterSettlement",
    "storyRun",
  ]);
});
