import { actionConflict, actionRejected } from "./runtime-errors.js";
import type { BoundOption, OpenNovelOption } from "./types.js";

export type ActionGatewayInput = {
  runId: string;
  rawAction: unknown;
  expectedStateRevision?: number;
  currentStateRevision: number;
};

export type ValidatedPlayerAction = {
  runId: string;
  action: string;
  stateRevision: number;
};

/**
 * The action gateway owns request-level validation only. It does not settle
 * story facts, choose a beat, or rewrite player intent.
 */
export interface ActionGatewayModule {
  readonly moduleId: string;
  validate(input: ActionGatewayInput): ValidatedPlayerAction;
  resolveBoundOption(
    bound: BoundOption | null,
    options: OpenNovelOption[],
    action: string,
  ): OpenNovelOption | null;
}

export class DefaultActionGateway implements ActionGatewayModule {
  readonly moduleId = "openovel.action-gateway.v1";

  validate(input: ActionGatewayInput): ValidatedPlayerAction {
    const action = String(input.rawAction || "").trim();
    if (!action) throw actionRejected("ACTION_REQUIRED");
    if (action.length > 2_000) throw actionRejected("ACTION_TOO_LONG");
    if (
      input.expectedStateRevision !== undefined
      && input.expectedStateRevision !== input.currentStateRevision
    ) {
      throw actionConflict("STATE_REVISION_CONFLICT");
    }
    return {
      runId: input.runId,
      action,
      stateRevision: input.currentStateRevision,
    };
  }

  resolveBoundOption(
    bound: BoundOption | null,
    options: OpenNovelOption[],
    action: string,
  ): OpenNovelOption | null {
    if (!bound) return null;
    const match = options.find((option) => option.id === bound.id && option.label === bound.label);
    if (!match || match.label !== action) return null;
    return match;
  }
}
