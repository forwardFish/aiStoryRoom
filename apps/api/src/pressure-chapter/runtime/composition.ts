import { PressureChapterOrchestratorService } from "../orchestrator/chapter-orchestrator.service";
import type {
  AuthoredChapterContentPort,
  ChapterOrchestratorStatePort,
  ChapterSettlementPort,
  ChapterWorkingSeedPort,
  DecisionBeatResolutionPort,
  DecisionCloseEvaluatorPort,
  DeterministicDefaultActionPort,
  FinaleRequestPort,
  FormalActionSubmissionPort,
  WorkingLedgerOpeningPort,
  WorkingProjectionReaderPort,
} from "../orchestrator/contracts";
import type {
  PressureChapterRuntimeDependenciesV1,
  RuntimeChapterHandoffStartPortV1,
  RuntimeFinalePortV1,
  RuntimeGenesisN1HandoffPortV1,
  RuntimeGenesisPortV1,
  RuntimeNarrativePortV1,
  RuntimeReplayCommandPortV1,
  RuntimeResultQueryPortV1,
} from "./contracts";
import { PressureChapterRuntimeFacade } from "./pressure-chapter-runtime.facade";

/**
 * Explicit W4 composition. W5 supplies ledger/formal-action/beat ports. W6 is
 * reachable only through settlement. The concrete W4-to-W6 adapter must seal
 * and persist through W6; this root never translates or evaluates a rule.
 */
export interface PressureChapterOrchestratorWiringV1 {
  states: ChapterOrchestratorStatePort;
  content: AuthoredChapterContentPort;
  seeds: ChapterWorkingSeedPort;
  ledgerOpening: WorkingLedgerOpeningPort;
  projections: WorkingProjectionReaderPort;
  formalActions: FormalActionSubmissionPort;
  beatResolution: DecisionBeatResolutionPort;
  decisionClose: DecisionCloseEvaluatorPort;
  defaults: DeterministicDefaultActionPort;
  settlement: ChapterSettlementPort;
  finaleRequest: FinaleRequestPort;
}

export interface PressureChapterRuntimeCompositionV1 {
  genesis: RuntimeGenesisPortV1;
  /** Binds the durable Genesis OPEN_CHAPTER consumer to the sole N1 start capability. */
  n1Handoff: (
    starter: RuntimeChapterHandoffStartPortV1,
  ) => RuntimeGenesisN1HandoffPortV1;
  chapter: PressureChapterOrchestratorWiringV1;
  finale: RuntimeFinalePortV1;
  narrative: RuntimeNarrativePortV1;
  result: RuntimeResultQueryPortV1;
  replay: RuntimeReplayCommandPortV1;
}

/**
 * Thin composition root. W8-to-W10 authority projection and W9 presentation
 * refresh remain adapters behind result/narrative, never a second state here.
 */
export function composePressureChapterRuntimeV1(
  input: PressureChapterRuntimeCompositionV1,
): PressureChapterRuntimeFacade {
  const chapters = new PressureChapterOrchestratorService(
    input.chapter.states,
    input.chapter.content,
    input.chapter.seeds,
    input.chapter.ledgerOpening,
    input.chapter.projections,
    input.chapter.formalActions,
    input.chapter.beatResolution,
    input.chapter.decisionClose,
    input.chapter.defaults,
    input.chapter.settlement,
    input.chapter.finaleRequest,
  );
  const dependencies: PressureChapterRuntimeDependenciesV1 = {
    genesis: input.genesis,
    genesisN1Handoff: input.n1Handoff(chapters),
    chapters,
    finale: input.finale,
    narrative: input.narrative,
    result: input.result,
    replay: input.replay,
  };
  return new PressureChapterRuntimeFacade(dependencies);
}
