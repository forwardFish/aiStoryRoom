export const A_EMOTION_SANGTIAN_LIFECYCLE_BRIDGE_SCHEMA_VERSION = "a_emotion_sangtian_lifecycle_bridge_v1" as const;

export type AEmotionSangtianLifecycleActionV1 = {
  actionKey: string;
  effectKey: string;
  factKey: string;
  assetMutation: {
    assetKey: string;
    disposition: "CLAIM" | "SET_STATE" | "CONSUME" | "TRANSFER" | "REFERENCE";
  } | null;
  promiseOutcome: "BROKEN" | "REVEAL_EVIDENCE" | "CUSTODY_RECEIVER_FULFILLED" | null;
};

export type AEmotionSangtianLifecycleBridgeV1 = {
  schemaVersion: typeof A_EMOTION_SANGTIAN_LIFECYCLE_BRIDGE_SCHEMA_VERSION;
  templateKey: "sangtian";
  sharedObjectId: "original-grain-ledger";
  custodyAssetKey: "asset_s2_document_custody";
  promiseCode: "DELIVER_ORIGINAL_LEDGER";
  actions: AEmotionSangtianLifecycleActionV1[];
};

const BRIDGE: AEmotionSangtianLifecycleBridgeV1 = {
  schemaVersion: A_EMOTION_SANGTIAN_LIFECYCLE_BRIDGE_SCHEMA_VERSION,
  templateKey: "sangtian",
  sharedObjectId: "original-grain-ledger",
  custodyAssetKey: "asset_s2_document_custody",
  promiseCode: "DELIVER_ORIGINAL_LEDGER",
  actions: [
    {
      actionKey: "main_s2_xunfu_seize_drafts",
      effectKey: "effect_main_s2_xunfu_seize_drafts",
      factKey: "fact_s2_xunfu_seize_drafts",
      assetMutation: { assetKey: "asset_s2_document_custody", disposition: "CLAIM" },
      promiseOutcome: "BROKEN"
    },
    {
      actionKey: "main_s2_magistrate_send_copy",
      effectKey: "effect_main_s2_magistrate_send_copy",
      factKey: "fact_s2_magistrate_send_copy",
      assetMutation: { assetKey: "asset_s2_magistrate_contract_copy", disposition: "SET_STATE" },
      promiseOutcome: "BROKEN"
    },
    {
      actionKey: "main_s2_magistrate_hide_original",
      effectKey: "effect_main_s2_magistrate_hide_original",
      factKey: "fact_s2_magistrate_hide_original",
      assetMutation: { assetKey: "asset_s2_document_custody", disposition: "CLAIM" },
      promiseOutcome: "BROKEN"
    },
    {
      actionKey: "main_s2_governor_dual_verification",
      effectKey: "effect_main_s2_governor_dual_verification",
      factKey: "fact_s2_governor_dual_verification",
      assetMutation: { assetKey: "asset_s2_document_custody", disposition: "CLAIM" },
      promiseOutcome: "CUSTODY_RECEIVER_FULFILLED"
    },
    {
      actionKey: "main_s4_clerk_certify_transfer_chain",
      effectKey: "effect_main_s4_clerk_certify_transfer_chain",
      factKey: "fact_s4_clerk_certify_transfer_chain",
      assetMutation: { assetKey: "asset_s4_clerk_document_index", disposition: "CONSUME" },
      promiseOutcome: "REVEAL_EVIDENCE"
    },
    {
      actionKey: "main_s4_governor_seal_evidence",
      effectKey: "effect_main_s4_governor_seal_evidence",
      factKey: "fact_s4_governor_seal_evidence",
      assetMutation: { assetKey: "asset_s4_governor_evidence_seal", disposition: "SET_STATE" },
      promiseOutcome: "REVEAL_EVIDENCE"
    }
  ]
};

validateBridge(BRIDGE);

export function aEmotionSangtianLifecycleBridge(): AEmotionSangtianLifecycleBridgeV1 {
  return {
    ...BRIDGE,
    actions: BRIDGE.actions.map((action) => ({
      ...action,
      assetMutation: action.assetMutation ? { ...action.assetMutation } : null
    }))
  };
}

export function aEmotionSangtianLifecycleAction(actionKey: string): AEmotionSangtianLifecycleActionV1 | null {
  const action = BRIDGE.actions.find((candidate) => candidate.actionKey === actionKey);
  return action
    ? { ...action, assetMutation: action.assetMutation ? { ...action.assetMutation } : null }
    : null;
}

export function aEmotionSangtianPromiseBreakCodes() {
  const rows = BRIDGE.actions.filter((action) => action.promiseOutcome === "BROKEN");
  return {
    actionCodes: rows.map((action) => action.actionKey),
    effectCodes: rows.map((action) => action.effectKey),
    factCodes: rows.map((action) => action.factKey)
  };
}

export function aEmotionSangtianPromiseRevealFactCodes() {
  return BRIDGE.actions
    .filter((action) => action.promiseOutcome === "REVEAL_EVIDENCE")
    .map((action) => action.factKey);
}

function validateBridge(value: AEmotionSangtianLifecycleBridgeV1) {
  if (value.schemaVersion !== A_EMOTION_SANGTIAN_LIFECYCLE_BRIDGE_SCHEMA_VERSION) throw new Error("A_EMOTION_SANGTIAN_LIFECYCLE_BRIDGE_SCHEMA_INVALID");
  if (value.templateKey !== "sangtian" || value.sharedObjectId !== "original-grain-ledger" || value.custodyAssetKey !== "asset_s2_document_custody") {
    throw new Error("A_EMOTION_SANGTIAN_LIFECYCLE_BRIDGE_IDENTITY_INVALID");
  }
  const actionKeys = new Set<string>();
  const factKeys = new Set<string>();
  for (const action of value.actions) {
    if (!/^main_s\d+_[a-z0-9_]+$/u.test(action.actionKey)) throw new Error(`A_EMOTION_SANGTIAN_ACTION_KEY_INVALID:${action.actionKey}`);
    if (!/^effect_main_s\d+_[a-z0-9_]+$/u.test(action.effectKey)) throw new Error(`A_EMOTION_SANGTIAN_EFFECT_KEY_INVALID:${action.effectKey}`);
    if (!/^fact_s\d+_[a-z0-9_]+$/u.test(action.factKey)) throw new Error(`A_EMOTION_SANGTIAN_FACT_KEY_INVALID:${action.factKey}`);
    if (actionKeys.has(action.actionKey) || factKeys.has(action.factKey)) throw new Error("A_EMOTION_SANGTIAN_LIFECYCLE_BRIDGE_DUPLICATE");
    actionKeys.add(action.actionKey);
    factKeys.add(action.factKey);
    if (action.assetMutation && !/^asset_s\d+_[a-z0-9_]+$/u.test(action.assetMutation.assetKey)) {
      throw new Error(`A_EMOTION_SANGTIAN_ASSET_KEY_INVALID:${action.assetMutation.assetKey}`);
    }
  }
}
