export type CreditControlProjection = {
  policyVersion: "world_unlock_v1" | "active_action_v1";
  meteringMode: "OFF" | "SHADOW" | "ENFORCED";
  available: number;
  personalAvailable?: number;
  runAllowanceAvailable: number;
  minimumActionCost: number;
  standardActionCost: number;
  customActionCost: number;
  canRequestSponsor: boolean;
  sponsorshipRequestStatus: "NONE" | "PENDING" | "APPROVED" | "DECLINED" | "EXPIRED";
};
