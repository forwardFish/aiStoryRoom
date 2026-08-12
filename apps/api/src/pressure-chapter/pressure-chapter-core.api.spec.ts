/**
 * W11 acceptance aggregation for Pressure Chapter application and persistence
 * contracts that predate the `*.api.spec.ts` naming convention.
 *
 * Keep this file import-only: each owned module remains independently testable
 * and no test-only composition is allowed to become a second runtime.
 */
import "./run-router/run-router.service.spec";
import "./genesis/genesis.service.spec";
import "./http/pressure-chapter-http.facade.spec";
import "./http-production/http-production.spec";
import "./interaction/interaction-working-ledger.spec";
import "./orchestrator/chapter-orchestrator.spec";
import "./chapter-settlement/chapter-settlement.orchestrator.spec";
import "./finale/finale-application.service.spec";
import "./game-projection/game-projection.service.spec";
import "./integration/action-release.integration.spec";
import "./integration/production-composition.spec";
import "./result/read-model-composer.spec";
import "./result/result-query.service.spec";
import "./replay/replay-command.handler.spec";
import "./seat-control/seat-control.service.spec";
import "./seat-control-persistence/seat-control-persistence.spec";
import "./a-emotion-persistence/a-emotion-persistence.spec";
import "./production/run-shell-and-bridge.spec";
import "./production/start-lifecycle.spec";
import "./production-prisma/genesis-open-n1-handoff.prisma-adapter.spec";
import "./production-prisma/production-prisma.adapters.spec";
import "./persistence/capability-architecture.spec";
import "./persistence/cas.spec";
import "./persistence/chapter-settlement-source.prisma-adapter.spec";
import "./persistence/chapter-settlement.prisma-adapter.spec";
import "./persistence/migration-verifier.spec";
import "./persistence/narrative.prisma-adapter.spec";
import "./persistence/orchestrator-state.prisma-adapter.spec";
import "./persistence/replay.prisma-adapter.spec";
import "./persistence/result.prisma-adapter.spec";
import "./persistence/route-genesis.prisma-adapter.spec";
import "./persistence/terminal.prisma-adapter.spec";
import "./persistence/vocabulary.spec";
import "./persistence/working-ledger.prisma-adapter.spec";
