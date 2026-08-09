import type { AuthenticatedUser } from "../auth/current-user.decorator";

export const ACTION_SLOT = "MAIN";
export const CHAPTER_INDEX = 1;

export type BoundOption = { id: string; label: string };

export type SubmitActionInput = {
  action?: string;
  idempotencyKey?: string;
  boundOption?: { id?: string; label?: string } | null;
  expectedStateRevision?: number;
};

export type ActionContext = {
  user: AuthenticatedUser;
  run: any;
  role: any;
  action: any;
  nodeId: string;
  actionText: string;
  boundOption: BoundOption | null;
  requestHash: string;
  expectedRevision: number;
  requestedTurnId: string;
};

export type ChargeReservation = null | {
  kind: string;
  charge?: any;
};

export type ClaimResult = {
  created: boolean;
  action: any;
  nodeId: string;
};
