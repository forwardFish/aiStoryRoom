export const PART_ONE_UNSUPPORTED_DISCOVERY_TERMS = [
  "田契抄本", "借阅人", "借阅过", "笔迹", "墨色", "县丞", "远亲", "口供", "供述",
  "失踪", "封条破损", "封条被动", "仓单", "账房", "暗账线索", "册面编号", "田契目录",
  "存目抄本", "重新粘贴", "页码", "主簿", "巡抚手书", "仓曹吏", "常平仓尚有存粮",
  "米铺已挂", "米铺挂出", "开仓需巡抚联署", "开仓须巡抚联署", "今日之内",
  "今日日落前", "明日午前", "明早之前", "明日之前", "今夜之前", "密信锁入",
  "把密信锁入", "密信收进", "密信封入", "亲自守在门口", "钥匙带回", "把钥匙带回",
  "米行闭门更多", "米行又多", "闭门更多了", "暂缓半日", "空白手令",
  "期限已过去半日", "期限已过半日", "期限已过半天", "期限已过一日",
  "三日期限已过一日", "不到半个时辰", "派员同往", "同往复核", "据实奏报",
  "任何人不得擅动", "封毕即回", "不得耽搁", "复核完毕即行放行", "街市隐约的喧嚷",
  "今日必须签发", "自行具题", "去而复返", "消息不断传入", "一概不得取出"
] as const;

export function containsUnauthorizedPartOneDiscovery(sentence: string, authorizedCorpus: string) {
  return PART_ONE_UNSUPPORTED_DISCOVERY_TERMS.some((term) =>
    sentence.includes(term) && !authorizedCorpus.includes(term)
  );
}
