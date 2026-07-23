export const PART_ONE_UNSUPPORTED_DISCOVERY_TERMS = [
  "田契抄本", "借阅人", "借阅过", "笔迹", "墨色", "朱批", "无异议", "县丞", "远亲", "口供", "供述",
  "病吏", "病信", "督标", "门役",
  "失踪", "封条破损", "封条被动", "仓单", "账房", "暗账线索", "册面编号", "田契目录",
  "存目抄本", "重新粘贴", "页码", "主簿", "巡抚手书", "仓曹吏", "常平仓尚有存粮",
  "米铺已挂", "米铺已经挂", "米铺挂出", "开仓需巡抚联署", "开仓须巡抚联署", "今日之内",
  "今日日落前", "明日午前", "明早之前", "明日之前", "今夜之前", "密信锁入",
  "把密信锁入", "密信收进", "密信封入", "亲自守在门口", "钥匙带回", "把钥匙带回",
  "米行闭门更多", "米行又多", "闭门更多了", "暂缓半日", "空白手令",
  "期限已过去半日", "期限已过半日", "期限已过半天", "期限已过一日",
  "三日期限已过一日", "不到半个时辰", "派员同往", "同往复核", "据实奏报",
  "任何人不得擅动", "封毕即回", "不得耽搁", "复核完毕即行放行", "街市隐约的喧嚷",
  "今日必须签发", "自行具题", "再遣人", "另遣人", "去而复返", "消息不断传入", "一概不得取出",
  "墨迹未干", "墨迹尚新", "墨迹极新", "今早才添", "临时写就", "早已备好", "预先备好",
  "另行递交", "异议文书", "催问条陈", "已有底稿", "备好的底稿", "经手底簿", "另留一份",
  "另取一纸", "另书一纸", "另纸", "附页",
  "便笺", "札纸", "札子", "字条", "白皮文书", "塘报", "公文匣", "回文匣", "批文", "手令", "公函",
  "行文底稿", "用印后的正本", "正本", "副本", "清单", "原件", "节略",
  "驿报", "急报", "密奏", "粮道", "钱塘县", "仁和县",
  "南京户部", "都察院", "部里追下来", "县丞", "粮户", "地头蛇", "粮船", "仓廪", "卫所",
  "托人带话", "私下托人", "虫蛀", "发脆", "残损",
  "推说遗失", "已经封入", "沿驿路北上", "连夜把田契", "田契往县衙",
  "田赋折征比例", "漕粮截留数目", "屯田清丈时限", "行粮方案",
  "申时", "来得比预想", "查哪几项", "由何人经办", "何时报结",
  "约莫半个时辰", "鱼鳞册", "实征底册", "推收票据", "经手书吏的名单",
  "名单备好", "一个不许少", "不许搬动", "不许誊抄", "不许任何人单独进入",
  "不再由县衙独自掌管", "不许再动", "消息已经传到", "总督关防",
  "正面铸", "背面铸", "正面刻", "背面刻", "铸着", "刻着",
  "签纸", "田赋底册", "推收票根", "过割号簿", "封存时刻", "写在牌面",
  "不许移动", "不许翻阅", "任何人翻阅", "一应文书", "甲衣",
  "本督会派人", "本督派人赴", "带去复核范围", "必有书面回复", "自有书面回复",
  "原地等候本督下一步指令", "等候本督下一步指令"
] as const;

export function containsUnauthorizedPartOneDiscovery(sentence: string, authorizedCorpus: string) {
  return PART_ONE_UNSUPPORTED_DISCOVERY_TERMS.some((term) =>
    sentence.includes(term)
    && !authorizedCorpus.includes(term)
    && !isFigurativeEvidenceComparison(sentence, term)
    && !isNonEvidentiaryDocumentTexture(sentence, term, authorizedCorpus)
    && !isPreparedSpeechTexture(sentence, term)
  );
}

function isFigurativeEvidenceComparison(sentence: string, term: string) {
  if (!["口供", "供述"].includes(term)) return false;
  let index = sentence.indexOf(term);
  while (index >= 0) {
    const prefix = sentence.slice(Math.max(0, index - 24), index);
    if (/(?:像|仿佛|如同|犹如|好似)[^。！？]{0,20}$/.test(prefix)) return true;
    index = sentence.indexOf(term, index + term.length);
  }
  return false;
}

function isNonEvidentiaryDocumentTexture(
  sentence: string,
  term: string,
  authorizedCorpus: string
) {
  if (!["墨色", "笔迹"].includes(term)) return false;
  if (/(?:县册|册页|原册|田契|补写|添写|改写|伪造|鉴定|鉴伪|可疑|异样|有异|不像|不似|新添|后添)/.test(sentence)) {
    return false;
  }
  if (term === "墨色") {
    return /两(?:纸|封)[^。！？]{0,18}墨色[^。！？]{0,18}(?:一浓一淡|浓淡不一)/.test(
      sentence
    );
  }
  return /密信[^。！？]{0,36}(?:清流县令|县令)[^。！？]{0,20}笔迹/.test(sentence)
    && /清流县令密信/.test(authorizedCorpus);
}

function isPreparedSpeechTexture(sentence: string, term: string) {
  if (!["早已备好", "预先备好"].includes(term)) return false;
  if (/(?:文书|公文|手本|底稿|条陈|札子|纸|册|清单|批文|附件)/.test(sentence)) {
    return false;
  }
  return /(?:一句|一番|一套|那些)?(?:话|说辞|答话|回话|口气|措辞)/.test(sentence);
}

/**
 * Minimal procedure that is semantically contained in an already-settled
 * action. These phrases may make an action performable on the page, but they
 * must not add a new document class, named witness, date range, discovery or
 * completed off-screen result.
 */
export function authorizedPartOneProceduralDerivations(eventText: string) {
  const derivations: string[] = [];
  if (/(?:封存档房|封档|档房先行封存)/.test(eventText)) {
    derivations.push(
      "一应册籍",
      "册籍原地不动",
      "不许移动",
      "不得移动",
      "不许誊抄",
      "不得誊抄",
      "不许任何人调阅",
      "不得擅自调阅",
      "清流县令亲随接过令牌",
      "清流县令亲随接了令牌"
    );
  }
  if (/(?:写|签|记|落笔|递交|行文|文书)/.test(eventText)) {
    derivations.push(
      "墨迹未干",
      "墨迹尚新",
      "墨迹很新",
      "墨迹极新",
      "墨迹渐干",
      "墨迹将干未干",
      "墨迹还没干透",
      "墨迹尚未干透",
      "墨色未干",
      "墨色尚新",
      "墨色渐干"
    );
  }
  if (eventText.includes("巡抚书吏")) {
    derivations.push("回文匣");
  }
  if (eventText.includes("清流县令亲随")) {
    derivations.push("封套");
  }
  return [...new Set(derivations)];
}

export function authorizedPartOneProceduralGuidance(eventText: string) {
  const guidance: string[] = [];
  if (/(?:封存档房|封档|档房先行封存)/.test(eventText)) {
    const receiver = eventText.includes("清流县令亲随")
      ? "清流县令亲随"
      : "受命者";
    guidance.push(
      `可写${receiver}当场接过已有令牌；可把“封存”最低限度表演为册籍原地不动、不得擅自移动、誊抄或调阅。`,
      "令牌只作为已经获批的权力道具递交、接过和收持；不得新增它的材质、尺寸、正反面、刻字、字号、纹样或其他可供鉴别的外观属性。",
      "只写受命者接过并持有令牌，不补写把令牌收入袖中、怀中、腰间或其他未经结算的收纳位置。",
      "不得在此基础上新增具体册名、年份范围、田赋项目、见证人、封条样式、登记方法、抵达时刻或封存已经完成的回报。"
    );
  }
  if (eventText.includes("同一份回文")) {
    guidance.push(
      "责任分歧只能写进现场已有的同一份回文；不得另取纸张、另作附页、附件、异议文书或第二份公文。"
    );
  }
  if (/(?:写|签|记|落笔|递交|行文|文书)/.test(eventText)) {
    guidance.push(
      "可用现场笔砚完成已经结算的书写，只写落笔、搁笔、已经写入的字句和人物回应；不要增加其他书写器物，也不要借纸面外观推出新证据。",
      "新写墨迹在同一现场只能写未干或渐干；只有明确跨到获批的次日场景后，才可写成已经干透。"
    );
  }
  return guidance;
}
