// P00 human review decisions. Each entry is deliberately explicit and reviewable;
// no lexical rule or world-specific runtime branch consumes this file.
const ROUND_ONE_ANNOTATIONS = {
  B001: ["REAL_P0", "断言关键原册的持久所在地与既往保管状态，属于未授权持久事实。"],
  B002: ["REAL_P0", "为关键原册确定具体所在地，改变可依赖的位置事实。"],
  B003: ["REAL_P0", "无来源保证关键原册的既往保管状态，属于持久证据事实。"],
  B004: ["REAL_P0", "新增档案保管、钥匙和封条等证据访问状态，超出已知事实。"],
  B005: ["REAL_P0", "替玩家提出派员行动，同时加入未授权精确时长，构成越权承诺。"],
  B006: ["UNCERTAIN", "摘录是对钥匙归属的提问而非明确断言，缺少完整上下文判断是否落地为事实。"],
  B007: ["FALSE_POSITIVE", "墨色只是物件表面叙事纹理，没有改变证据的因果状态。"],
  B008: ["UNCERTAIN", "仅见精确数量提示，无法从脱敏摘录确认数量是否是必须持久化的事实。"],
  B009: ["REAL_P0", "同时确定县册所在地和既往保管保证，形成新的持久证据状态。"],
  B010: ["REAL_P0", "为关键田契新增明确档案位置，属于持久位置变化或断言。"],
  B011: ["REAL_P0", "凭空确认底册这一关键记录存在，属于新增关键证据。"],
  B012: ["REAL_P0", "向正式文书追加派员参与的政策权限，超出获批闭集条款。"],
  B013: ["UNCERTAIN", "只显示既有公文摆放和可见文字，可能是纹理，也可能改变文书可见状态。"],
  B014: ["UNCERTAIN", "新增书吏转述期限，但脱敏片段不足以确认这是新命令还是既有信息复述。"],
  B015: ["FALSE_POSITIVE", "“一遍”是低价值动作计数，不构成持久因果或玩家越权。"],
  B016: ["REAL_P0", "新增正式派员、查验及记录要求，属于未授权命令和程序。"],
  B017: ["REAL_P0", "遗漏本轮必须可见的试办、购田限制与对象结果，命中结果遗漏标准。"],
  B018: ["REAL_P0", "替玩家作出具报承诺和传话处置，属于未授权命令。"],
  B019: ["UNCERTAIN", "仅由写入动作同义词缺失推断遗漏，脱敏数据不足以确认结果确实不可见。"],
  B020: ["REAL_P0", "向闭集正式文书新增政策条款，构成文书内容越权。"],
  B021: ["REAL_P0", "遗漏必须展示的试办和购田限制结果，属于关键结算不可见。"],
  B022: ["REAL_P0", "无来源确定原册所在地，形成新的持久位置事实。"],
  B023: ["REAL_P0", "凭空新增正式派员参与复核要求，属于关键命令。"],
  B024: ["REAL_P0", "新增共同查验的正式命令，即使以转述呈现仍改变程序义务。"],
  B025: ["REAL_P0", "新增派员、共同查验、记录和存档程序，属于正式命令。"],
  B026: ["REAL_P0", "闭集文书条款数及政策被改写，并遗漏责任分立结果。"],
  B027: ["REAL_P0", "漏掉获批文书条款并新增派员、追责和政策内容，属于复合越权。"],
  B028: ["REAL_P0", "对正式公文关防和期限墨迹作认证状态断言，并伴随条款遗漏。"],
  B029: ["REAL_P0", "新增派员共同查验、记录和禁止补录的正式程序命令。"],
  B030: ["REAL_P0", "虽含普通折痕纹理，但同时遗漏全部获批文书条款，结果不可见。"],
  B031: ["REAL_P0", "新增巡抚派员及复核记录要求，形成未获授权的正式程序。"],
  B032: ["REAL_P0", "凭空生成三行正式记录及异议成文要求，属于新增文书事实。"],
  B033: ["REAL_P0", "新增派员存档程序、扩写文书政策并遗漏试办结果。"],
  B034: ["REAL_P0", "正式文书被追加期限内容且遗漏试办结果，不只是表面措辞。"],
  B035: ["REAL_P0", "断言正式回文无印无签押，属于关键文书认证状态。"],
  B036: ["UNCERTAIN", "数量被标为“可能”，脱敏摘录不足以确认它指向关键持久对象。"],
  B037: ["FALSE_POSITIVE", "没有拿取朱印是瞬时叙事动作，未说明印章或文书状态改变。"],
  B038: ["REAL_P0", "遗漏获批文书条款并新增册子不会挪动的保管保证。"],
  B039: ["REAL_P0", "替玩家追加派员处置并遗漏必须可见的追责后果。"],
  B040: ["REAL_P0", "新增共同开册、画押存档及价格政策，同时遗漏多项获批结果。"],
  B041: ["FALSE_POSITIVE", "“那句问”被误识别为具名人物，是明显分词误判。"],
  B042: ["REAL_P0", "遗漏必须可见的拒绝联署结果；附带时长误差不改变该结论。"],
  B043: ["REAL_P0", "遗漏本轮已结算的追责或迟疑后果，属于必要结果不可见。"],
  B044: ["FALSE_POSITIVE", "字迹是普通表面属性，未改变文书内容、认证或因果状态。"],
  B045: ["REAL_P0", "新增正式派员承诺，并遗漏试办、购田限制和写入结果。"],
  B046: ["REAL_P0", "未呈现已结算的限定试办结果，命中必要结果遗漏。"],
  B047: ["FALSE_POSITIVE", "“须记明”被误识别为人物名称，是明显词法误判。"],
  B048: ["REAL_P0", "遗漏必须可见的迟疑或耽误后果，属于结算结果缺失。"],
  B049: ["REAL_P0", "正式回文及其写入动作均未呈现，导致结算文书结果不可见。"],
  B050: ["REAL_P0", "遗漏已结算的正式放行回文，属于关键文书结果缺失。"],
  B051: ["REAL_P0", "遗漏已结算的购田限制，属于本轮必须可见的政策结果。"],
  B052: ["REAL_P0", "向获批文书追加放行政策表述，改变正式文书闭集内容。"],
  B053: ["REAL_P0", "遗漏各自成文和分别担责的必要结果，改变责任可见性。"],
  B054: ["FALSE_POSITIVE", "按纸和未碰朱印只是瞬时动作，没有落成新的认证状态。"],
  B055: ["REAL_P0", "明确断言正式文书无印无签押，属于关键认证状态。"],
  B056: ["REAL_P0", "为证据新增册尾不符内容，并可能漏掉复核这一必要结果。"],
  B057: ["REAL_P0", "凭空新增底册证据并替玩家发出对外命令。"],
  B058: ["REAL_P0", "凭空确认底稿这一关键记录存在，属于新增证据。"],
  B059: ["FALSE_POSITIVE", "“笔锋在田字末笔收住”是书写纹理，不是新增政策或权限。"],
  B060: ["REAL_P0", "向正式文书追加以某册为准的政策条件，并可能遗漏已批结果。"],
  B061: ["REAL_P0", "向正式文书追加公文留置处置，并可能遗漏多个获批结果。"],
  B062: ["FALSE_POSITIVE", "墨色是普通视觉纹理，不改变证据的内容或持久状态。"],
  B063: ["REAL_P0", "替玩家命令对方等待并承诺随后给回文，属于未授权承诺。"],
  B064: ["REAL_P0", "向获批正式文书增加试办政策内容，超出闭集合同。"],
  B065: ["UNCERTAIN", "仅有“放行期间”片段，无法确认是新政策期限还是叙事连接语。"],
  B066: ["REAL_P0", "替玩家追加调查命令、未来承诺和落印行动，并漏掉多项必要结果。"],
  B067: ["REAL_P0", "遗漏已批准的明确时点和追责结果；附带数值纹理不影响结论。"],
  B068: ["REAL_P0", "本轮三日期限未呈现，且片段引入签发处置，必要结果不可见。"],
  B069: ["REAL_P0", "遗漏本轮已结算的购田限制，属于必须可见的政策结果。"],
  B070: ["REAL_P0", "遗漏本轮已结算的复核结果，属于必须可见的行动结果。"],
  B071: ["REAL_P0", "遗漏已结算的三日期限，属于本轮必要结果不可见。"],
  B072: ["REAL_P0", "遗漏拒绝共同具名的结果；额外数值问题不是主要判定依据。"],
  B073: ["REAL_P0", "无授权改变回文匣持久状态，并遗漏拒绝联署结果。"],
  B074: ["FALSE_POSITIVE", "墨迹是普通文书表面属性，没有改变内容、认证或持久状态。"],
  B075: ["UNCERTAIN", "发言者明确否认代为承诺；缺少完整合同判断是否充分呈现拒绝联署。"],
  B076: ["REAL_P0", "新增共同查验和记录命令，同时遗漏拒绝联署的必要结果。"],
  B077: ["REAL_P0", "新增对玩家决定的未来约束与追责承诺，并遗漏联署拒绝结果。"],
  B078: ["REAL_P0", "替玩家发出携回文并请求共同具名的正式命令。"],
  B079: ["UNCERTAIN", "只是期限来源地点归属，脱敏片段不足以确认其是否为关键持久位置事实。"],
  B080: ["REAL_P0", "替玩家发出传话命令并承诺按期具报，属于未授权行动。"],
  B081: ["REAL_P0", "替玩家命令等待并隐含将给回文的未来承诺。"],
  B082: ["UNCERTAIN", "落款可能是关键文书内容，也可能只是表面描述，缺少上下文确认。"],
  B083: ["UNCERTAIN", "文本似在交付已批回文，但警告同时称结果未兑现，脱敏信息内部不足。"],
  B084: ["REAL_P0", "替玩家新增封存、禁阅、派员查验和执行政策等一组正式命令。"],
  B085: ["REAL_P0", "改变回文匣持久状态并替玩家发出对外处置命令。"],
  B086: ["REAL_P0", "尽管字迹是纹理，但多项已批准文书与政策结果没有兑现。"],
  B087: ["REAL_P0", "遗漏已批准的文书写入结果，属于必须可见的正式文书结算。"],
  B088: ["REAL_P0", "遗漏期限、分别担责和追责后果等多项必要结算结果。"],
  B089: ["REAL_P0", "遗漏已结算的具名或联署结果；地点问题不是主要判定依据。"],
  B090: ["REAL_P0", "新增责任说明文书、未来安排和明确场外时点，构成正式状态越权。"],
  B091: ["REAL_P0", "改变回文匣状态、追加交付命令并遗漏分别担责结果。"],
  B092: ["REAL_P0", "替玩家新增封存多项证据、派员到场和未来签署承诺。"],
  B093: ["FALSE_POSITIVE", "“像是背熟”是叙述者风格性推测，不是证据的明确内容。"],
  B094: ["REAL_P0", "通过问答确定关键原册所在地，仍形成无来源的持久位置事实。"],
  B095: ["REAL_P0", "连续问答落成关键原册的明确所在地，属于持久位置断言。"],
  B096: ["REAL_P0", "遗漏已批准的暂缓签发结果，属于本轮必须可见的决定。"],
  B097: ["REAL_P0", "遗漏未签发或未落印这一必要认证结果，影响文书状态。"],
  B098: ["REAL_P0", "遗漏朱印未动和公文暂压等已批准结果，导致决定不可见。"],
};

// Round 2 re-review policy: the sanitized corpus contains validator excerpts but
// not the complete narration, actor policy, or required-result contract. A
// validator allegation alone cannot establish a gold REAL_P0 label. These sets
// are explicit human review decisions; runtime code does not infer labels from
// language, keywords, characters, or world IDs.
const FALSE_POSITIVE_SPEECH_ACTS = {
  B004: "UNKNOWN_OR_UNVERIFIED",
  B007: "NARRATIVE_TEXTURE",
  B015: "LOW_VALUE_ACTION_COUNT",
  B037: "NEGATED_TRANSIENT_ACTION",
  B041: "LEXICAL_FALSE_MATCH",
  B044: "NARRATIVE_TEXTURE",
  B047: "LEXICAL_FALSE_MATCH",
  B054: "NEGATED_TRANSIENT_ACTION",
  B059: "NARRATIVE_TEXTURE",
  B062: "NARRATIVE_TEXTURE",
  B074: "NARRATIVE_TEXTURE",
  B093: "STYLE_OR_HEDGE",
};

const UNCERTAIN_IDS = new Set([
  "B001", "B002", "B003", "B005", "B006", "B008", "B009", "B010", "B011", "B012", "B013", "B014",
  "B016", "B017", "B018", "B019", "B020", "B021", "B022", "B023", "B024", "B025", "B026", "B027",
  "B028", "B029", "B030", "B031", "B032", "B033", "B034", "B035", "B036", "B038", "B039", "B040",
  "B042", "B043", "B045", "B046", "B048", "B049", "B050", "B051", "B052", "B053", "B055", "B056",
  "B057", "B058", "B060", "B061", "B063", "B064", "B065", "B066", "B067", "B068", "B069", "B070",
  "B071", "B072", "B073", "B075", "B076", "B077", "B078", "B079", "B080", "B081", "B082", "B083",
  "B084", "B085", "B086", "B087", "B088", "B089", "B090", "B091", "B092", "B094", "B095", "B096",
  "B097", "B098",
]);

const specialRationales = {
  B004: "摘录明确说保管人、钥匙和封条状态均未核实；它表达未知，没有断言这些持久状态。",
  B005: "派员文字是玩家角色的疑问，不是命令或承诺；另一项“一年”警告缺少原句和合同，整体只能暂不确定。",
};

export const MANUAL_ANNOTATIONS = Object.fromEntries(
  Object.entries(ROUND_ONE_ANNOTATIONS).map(([auditId, [, previousRationale]]) => {
    const speechAct = FALSE_POSITIVE_SPEECH_ACTS[auditId] ?? "INSUFFICIENT_SANITIZED_CONTEXT";
    const classification = FALSE_POSITIVE_SPEECH_ACTS[auditId] ? "FALSE_POSITIVE" : "UNCERTAIN";
    if (!FALSE_POSITIVE_SPEECH_ACTS[auditId] && !UNCERTAIN_IDS.has(auditId)) {
      throw new Error(`Round 2 classification missing for ${auditId}`);
    }
    const rationale = specialRationales[auditId] ?? (classification === "FALSE_POSITIVE"
      ? previousRationale
      : `脱敏记录缺少完整正文、Actor Policy 与本轮结算合同，不能用 validator 警告独立证实 P0；待核实事项：${previousRationale}`);
    return [auditId, {
      classification,
      rationale,
      speechAct,
      assertedPredicate: classification === "FALSE_POSITIVE"
        ? "摘录本身没有断言受保护的持久因果变化或玩家行动。"
        : "validator 声称存在受保护谓词，但脱敏记录不足以独立重建该谓词。",
      expectedPredicateEvidence: classification === "FALSE_POSITIVE"
        ? "无需额外 P0 证据；若要推翻误报结论，须提供明确肯定断言及其因果对象。"
        : "需要完整相关正文、说话者归属、Actor Policy，以及本轮 required-result/causal contract。",
    }];
  }),
);
