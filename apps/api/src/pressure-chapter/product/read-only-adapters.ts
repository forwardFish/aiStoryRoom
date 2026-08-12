import type {
  PressureChapterHttpActionPort,
  PressureChapterHttpReplayPort,
  PressureChapterHttpResultPort,
  PressureChapterHttpRoutePort,
} from "../http";
import type { PressureChapterRuntimeFacade } from "../runtime/pressure-chapter-runtime.facade";
import type {
  PressureResultReadModelInputReaderPort,
  AuthoritativeResultReaderPort,
} from "../result";

/** HTTP route projection without the RunRouter.create capability. */
export function pressureHttpRouteReadPortV1(
  routes: PressureChapterHttpRoutePort,
): PressureChapterHttpRoutePort {
  return Object.freeze({
    readStoredRoute: routes.readStoredRoute.bind(routes),
    resolveGame: routes.resolveGame.bind(routes),
    resolveAction: routes.resolveAction.bind(routes),
    resolveResult: routes.resolveResult.bind(routes),
    resolveReplay: routes.resolveReplay.bind(routes),
  });
}

/** Command/read facets prevent HTTP DI from receiving the complete runtime. */
export function pressureHttpRuntimeFacetsV1(runtime: PressureChapterRuntimeFacade): {
  actions: PressureChapterHttpActionPort;
  result: PressureChapterHttpResultPort;
  replay: PressureChapterHttpReplayPort;
} {
  return Object.freeze({
    actions: Object.freeze({
      submitAction: runtime.submitAction.bind(runtime),
    }),
    result: Object.freeze({
      getResult: runtime.getResult.bind(runtime),
    }),
    replay: Object.freeze({
      replay: runtime.replay.bind(runtime),
    }),
  });
}

/** Replay reads authority only; it cannot obtain Narrative presentation rows. */
export class PressureAuthoritativeResultReaderAdapterV1
implements AuthoritativeResultReaderPort {
  constructor(
    private readonly inputs: PressureResultReadModelInputReaderPort,
  ) {}

  async readFinalized(runId: string): Promise<unknown | null> {
    const source = await this.inputs.readConsistentSource(runId);
    if (source === null) return null;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return null;
    }
    const record = source as Record<string, unknown>;
    return "authority" in record ? structuredClone(record.authority) : null;
  }
}
