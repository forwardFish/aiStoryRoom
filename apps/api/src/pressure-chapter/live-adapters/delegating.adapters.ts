import type { AEmotionFeedServiceV1 } from "../a-emotion/feed.service";
import type {
  PressureGameAEmotionFeedPort,
  PressureGameChapterReaderPort,
} from "../game-projection/contracts";
import {
  SangtianPressureGameChapterReaderAdapterV1,
} from "../integration/game-projection.adapters";
import type { SangtianPressureGameContentMapperV1 } from "../integration/content.adapters";
import type {
  AuthoredChapterContentPort,
  ChapterOrchestratorStatePort,
  WorkingProjectionReaderPort,
} from "../orchestrator/contracts";
import type { StoredRunRouteReaderPort } from "../run-router";

/** Read-only narrowing: the adapter cannot ingest or mark A-Emotion records. */
export class AEmotionPressureGameFeedReaderAdapterV1
implements PressureGameAEmotionFeedPort {
  constructor(
    private readonly feed: Pick<AEmotionFeedServiceV1, "list">,
  ) {}

  list(input: Parameters<PressureGameAEmotionFeedPort["list"]>[0]) {
    return this.feed.list({
      roomId: input.roomId,
      runId: input.runId,
      viewerSeatId: input.viewerSeatId,
      cursor: input.cursor,
      limit: input.limit,
    });
  }
}

export interface ViewerScopedChapterReaderDependenciesV1 {
  routes: StoredRunRouteReaderPort;
  states: ChapterOrchestratorStatePort;
  working: WorkingProjectionReaderPort;
  content: AuthoredChapterContentPort;
  mapper: SangtianPressureGameContentMapperV1;
}

/** Wires the current viewerSeatId-bearing ChapterReader; no run-only shim. */
export function createViewerScopedPressureGameChapterReaderV1(
  dependencies: ViewerScopedChapterReaderDependenciesV1,
): SangtianPressureGameChapterReaderAdapterV1 {
  return new SangtianPressureGameChapterReaderAdapterV1(
    dependencies.routes,
    dependencies.states,
    dependencies.working,
    dependencies.content,
    dependencies.mapper,
  );
}
