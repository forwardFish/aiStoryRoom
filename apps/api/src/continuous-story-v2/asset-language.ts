const ASSET_NAMES: Record<string, string> = {
  review_authority: "复核权",
  governor_memorial_channel: "总督密奏渠道",
  xunfu_clerk_network: "巡抚幕僚查验人脉",
  magistrate_register_original: "县衙原始田册",
  court_pressure_system_resource: "朝廷催办压力",
  clerk_document_index: "胥吏文书索引",
  merchant_trade_ledger: "商会往来账簿",
  sili_imperial_channel: "司礼监御前递送渠道",
  document_custody: "文书保管权",
  governor_sealed_mail_channel: "总督密封驿递渠道",
  xunfu_inspection_roster: "巡抚巡查名册",
  magistrate_contract_copy: "县衙田契副本",
  grain_route: "粮路调度权",
  governor_granary_release_order: "总督官仓放粮令",
  xunfu_merchant_summons: "巡抚商会传讯令",
  magistrate_grain_loss_ledger: "县衙粮耗账册",
  evidence_custody: "证据保管权",
  governor_evidence_seal: "总督证据封印",
  xunfu_integrity_objection: "巡抚廉正异议书",
  magistrate_witness_roster: "县衙证人名册",
  responsibility_narrative: "责任解释权",
  governor_review_timeline: "总督复核时序表",
  xunfu_execution_schedule: "巡抚执行日程",
  magistrate_source_index: "县衙证据来源索引",
  final_memorial: "最终奏疏",
  governor_main_memorial_seal: "总督主奏封印",
  xunfu_merit_memorial: "巡抚请功奏疏",
  magistrate_evidence_catalog: "县衙证据目录",
  final_responsibility: "最终责任裁断权",
  governor_imperial_defense_outline: "总督御前答辩提纲",
  xunfu_execution_evidence_bundle: "巡抚执行证据卷",
  magistrate_final_evidence_index: "县衙最终证据索引"
};

export function assetDisplayName(assetKey: string): string {
  const stableName = String(assetKey || "").replace(/^asset_s\d+_/, "");
  return ASSET_NAMES[stableName] || "当前可用筹码";
}

export function containsRawEngineToken(content: string): boolean {
  return /(?:^|[^A-Za-z0-9_])(?:asset_s\d+_|fact_s\d+_|state_s\d+_|main_s\d+_|fallback_s\d+_|role_|WORLD_FACT|PUBLIC_FRAME|effectKey|nextStateKey)/i.test(content);
}
