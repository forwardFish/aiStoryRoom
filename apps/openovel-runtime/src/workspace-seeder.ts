import type { WorkspacePaths } from "./paths.js";
import type { OpenNovelOption, RunMetadata } from "./types.js";

export interface WorkspaceRunSeeder {
  supports(input: { worldId: string; roleId: string }): boolean;
  seed(
    paths: WorkspacePaths,
    metadata: RunMetadata,
    projectRoot: string,
  ): Promise<{
    openingOptions: OpenNovelOption[];
    prologueNarrative?: string;
  }>;
}
