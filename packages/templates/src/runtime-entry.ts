import runtimeFacade from "./runtime-facade.js";

export * from "./index.js";

/**
 * Explicit export wins over the star-exported base implementation. This keeps
 * native ESM named imports, CommonJS namespace imports, and the default runtime
 * namespace on the same capability-aware settlement function.
 */
export const settlePartOneAction = runtimeFacade.settlePartOneAction;

export default runtimeFacade;
