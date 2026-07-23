/**
 * Compatibility module name. Solo generation is no longer a single provider
 * call; executeSoloStoryTurn is implemented by the two-stage executor.
 */
export { executeSoloStoryTurn } from "./two-stage-executor";
