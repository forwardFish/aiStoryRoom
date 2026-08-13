import type { PressureChapterGameProjectionService } from "../game-projection";
import type { PressureSql7ReceiptProjectionPortV1 } from "./service";

export class PressureSql7ReceiptProjectionAdapterV1
implements PressureSql7ReceiptProjectionPortV1 {
  constructor(
    private readonly game: Pick<
      PressureChapterGameProjectionService,
      "projectFromResolvedSources"
    >,
  ) {}

  project(input: Parameters<PressureSql7ReceiptProjectionPortV1["project"]>[0]) {
    return this.game.projectFromResolvedSources(
      structuredClone(input.authority.projectionAuthority),
    );
  }
}
