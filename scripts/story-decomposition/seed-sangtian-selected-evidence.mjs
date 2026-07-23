import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  repoRoot,
  sha256Bytes,
  validateWithSchema,
  writeJson,
} from "./lib/contract-utils.mjs";

const RUN_ID = "sangtian-part-one-evidence-seed-v5";
const SOURCE_SHA256 = "04D5E8D4533D86890A79058C25252D33E001668921A2BBD8FFDE401CDD2B6238";
const sourceRoot = resolve(repoRoot, "docs/剧本/嘉靖财政危局/derived");
const outputRoot = resolve(sourceRoot, `evidence-v2/candidates/${RUN_ID}/track-a-evidence`);

const sceneSpecs = [
  {
    sceneId: "DM1566-C01-POLICY-COUNCIL",
    chapterId: "DM1566-C01",
    paragraphStartId: "DM1566-C01-P0219",
    paragraphEndId: "DM1566-C01-P0240",
    title: "御前以浙江改桑填补亏空",
    time: "嘉靖四十年正月十五御前财政会议",
    locations: ["place.xiyuan_jinshen_jingshe"],
    present: ["source.jiajing", "source.yan_song", "source.yan_shifan", "source.zhang_juzheng"],
    claims: [
      statement("CL-POLICY-RESPONSIBILITY", "source.yan_shifan", "states_ministry_and_self_have_responsibility", "严世蕃当面说工部有责任，自己也有责任。"),
      statement("CL-POLICY-HALF-LAND", "source.yan_song", "states_cabinet_half_farmland_proposal", "严嵩称内阁的意思是把浙江现有农田的一半改成桑田；当嘉靖追问口粮时，他答从外省增调粮食。", { subjectRef: "source.grand_secretariat" }),
      statement("CL-POLICY-FOOD-QUESTION", "source.jiajing", "questions_food_supply_and_willingness", "嘉靖追问农田改桑后浙江百姓吃粮、调粮价格与桑农是否愿意。"),
      statement("CL-POLICY-URGENT-DISPATCH", "source.jiajing", "orders_cabinet_to_plan_and_send_urgent_dispatch", "嘉靖命内阁回去详议方略，再给胡宗宪下急递，并说此事还得靠胡宗宪去办。"),
    ],
  },
  {
    sceneId: "DM1566-C01-LAND-RISK-COUNCIL",
    chapterId: "DM1566-C01",
    paragraphStartId: "DM1566-C01-P0339",
    paragraphEndId: "DM1566-C01-P0359",
    title: "裕王府预判改桑兼并与总督责任",
    time: "御前财政会议之后",
    locations: ["place.yuwang_residence"],
    present: ["source.yuwang", "source.xu_jie", "source.gao_gong", "source.zhang_juzheng", "source.tan_lun"],
    claims: [
      belief("CL-LAND-RISK-PREDICTION", "source.zhang_juzheng", "believes_policy_enables_land_seizure", "张居正判断改桑可能被严党与富商利用来兼并农田，并预见失田与动乱风险；这仍是人物判断，不是已经发生的事实。"),
      statement("CL-LAND-PROFIT-MECHANISM", "source.tan_lun", "explains_vertical_profit_incentive", "谭纶说明官商若同时控制桑田、蚕丝和织造，可以减少买丝环节并扩大收益。"),
      statement("CL-GOVERNOR-POLITICAL-POSITION", "source.zhang_juzheng", "describes_governor_authority_and_dependence", "张居正称胡宗宪兼总督与巡抚、受皇帝信任，也深受严嵩提携，因此既有地方权力又受政治关系约束。"),
    ],
  },
  {
    sceneId: "DM1566-C02-FORCED-REFORM",
    chapterId: "DM1566-C02",
    paragraphStartId: "DM1566-C02-P0002",
    paragraphEndId: "DM1566-C02-P0009",
    title: "堵堰踏苗强推改桑",
    time: "农历四月改桑执行初期",
    locations: ["place.xinan_river_dike", "place.chunan_fields"],
    present: ["source.ma_ningyuan", "source.chang_boxi", "source.zhang_zhiliang"],
    claims: [
      event("CL-FORCED-REFORM-ACTION", "source.hangzhou_government", "forcibly_implements_reform", "地方官员以士兵和衙役堵堰、踏毁青苗并插下桑田木牌，强制推进改稻为桑。"),
      state("CL-FORCED-REFORM-COST", "source.chunan_farmers", "suffer_immediate_crop_and_water_loss", "强制执行立即损害秧苗与灌溉，使抽象国策变成百姓眼前的生计损失。"),
    ],
  },
  {
    sceneId: "DM1566-C02-GOVERNOR-GRAIN-RESPONSIBILITY",
    chapterId: "DM1566-C02",
    paragraphStartId: "DM1566-C02-P0198",
    paragraphEndId: "DM1566-C02-P0241",
    title: "总督府承担粮食与民变责任",
    time: "农历四月地方强推改桑之后",
    locations: ["place.zhejiang_governor_office"],
    present: ["source.hu_zongxian", "source.tan_lun", "source.yang_jinshui", "source.zheng_michang", "source.he_maocai", "source.ma_ningyuan"],
    claims: [
      state("CL-GOVERNOR-PETITIONERS", "source.zhejiang_governor_office", "surrounded_by_petitioners", "从淳安跟来的百姓跪满总督衙门外大坪与官路，形成总督亲眼可见的民生压力。"),
      statement("CL-GRAIN-SOURCES-INSUFFICIENT", "source.zheng_michang", "reports_grain_borrowing_and_transfer_shortfall", "郑泌昌答称向米行借贷的粮很少，各米行都说缺粮；外省调粮仍和往年一样，不肯多给。"),
      statement("CL-GOVERNOR-ASSUMES-LIABILITY", "source.hu_zongxian", "states_both_court_and_people_will_hold_him_responsible", "胡宗宪说，朝廷要降罪都是他的罪，百姓要骂也该骂他；随即说明无粮改桑会使百姓秋后无饭并可能成为反民。"),
      event("CL-GOVERNOR-ORDERS-RELIEF", "source.hu_zongxian", "orders_release_irrigation_and_grain_credit_collection", "胡宗宪先命马宁远放人、开堰灌苗；又命布政使和按察使衙门向米行催贷粮食，并表示可在借据上加盖总督衙门印章。"),
      statement("CL-WEAVING-RESOURCE-PRESSURE", "source.yang_jinshui", "states_weaving_inventory_shortfall_and_personal_liability", "杨金水称三个织造坊库存只有十几万匹，按现有桑田赶织仍会短二十多万匹，到时宫里会追问他。"),
    ],
  },
  {
    sceneId: "DM1566-C02-REPORT-ARRIVES-YAN-HOUSE",
    chapterId: "DM1566-C02",
    paragraphStartId: "DM1566-C02-P0243",
    paragraphEndId: "DM1566-C02-P0251",
    title: "奏疏越过通政司进入严府",
    time: "胡宗宪奏疏入京之后",
    locations: ["place.grand_secretariat", "place.yan_residence"],
    present: ["source.xu_jie", "source.yan_song", "source.yan_shifan", "source.luo_longwen"],
    claims: [
      event("CL-REPORT-BYPASSES-TONGZHENG", "source.hu_zongxian_report", "arrives_at_cabinet_without_first_entering_tongzheng", "叙述明确说胡宗宪奏疏没有先送通政使司，而是直接送到西苑内阁值房。", { knownByRefs: ["source.xu_jie"] }),
      event("CL-REPORT-REACHES-YAN-HOUSE", "source.hu_zongxian_report", "is_forwarded_from_cabinet_to_yan_house", "徐阶只看奏疏封面便命书办送严府；到严府后，严世蕃先拆看奏疏。", { knownByRefs: ["source.xu_jie", "source.yan_song", "source.yan_shifan", "source.luo_longwen"] }),
      statement("CL-REPORT-CHANNEL-INTERPRETED-POLITICALLY", "source.yan_shifan", "interprets_channel_as_political_alignment", "严世蕃与罗龙文把奏疏绕过通政司、直送内阁的做法解释为胡宗宪向徐阶与裕王一方示好。", { knownByRefs: ["source.yan_song", "source.yan_shifan", "source.luo_longwen"] }),
    ],
  },
  {
    sceneId: "DM1566-C02-REPORT-AUDIENCE-FRAMING",
    chapterId: "DM1566-C02",
    paragraphStartId: "DM1566-C02-P0261",
    paragraphEndId: "DM1566-C02-P0271",
    title: "严嵩选择奏疏呈递的现场",
    time: "严府商议奏疏时",
    locations: ["place.yan_residence"],
    present: ["source.yan_song", "source.yan_shifan", "source.luo_longwen"],
    claims: [
      statement("CL-REPORT-FRAMING-AT-AUDIENCE", "source.yan_song", "orders_report_presented_during_yuwang_audience", "严嵩命严世蕃把奏疏送司礼监，请吕芳到裕王府后当面交给皇帝，让皇帝当时给旨。"),
      statement("CL-AUDIENCE-FRAMING-RATIONALE", "source.luo_longwen", "states_audience_limits_later_objections", "罗龙文称，当着裕王呈递，无论皇帝给什么旨意都可减少后患；裕王若当时不说，日后也难再说。"),
    ],
  },
  {
    sceneId: "DM1566-C02-REPORT-SUPPRESSION-RISK",
    chapterId: "DM1566-C02",
    paragraphStartId: "DM1566-C02-P0272",
    paragraphEndId: "DM1566-C02-P0276",
    title: "裕王府担心多份奏疏被选择性呈递",
    time: "谭纶来信到达裕王府时",
    locations: ["place.yuwang_residence"],
    present: ["source.yuwang", "source.xu_jie", "source.gao_gong", "source.zhang_juzheng"],
    claims: [
      statement("CL-REPORT-CAN-BE-SUPPRESSED", "source.gao_gong", "warns_multiple_reports_can_be_selectively_presented", "高拱担心胡宗宪同时上的多道奏疏中，真正重要的一道可能被压下，只把其他奏疏呈给皇帝；这是人物的风险判断。"),
      statement("CL-REPORT-WITNESS-CHANNEL-CRITIQUE", "source.gao_gong", "criticizes_failure_to_preserve_cabinet_witness", "高拱认为徐阶若直接持奏疏见严嵩，严嵩便不能不给他看，渠道中有见证就更难做手脚；这仍是高拱的判断。"),
    ],
  },
  {
    sceneId: "DM1566-C03-GOVERNOR-POLITICAL-BOUNDARY",
    chapterId: "DM1566-C03",
    paragraphStartId: "DM1566-C03-P0020",
    paragraphEndId: "DM1566-C03-P0039",
    title: "胡宗宪说明渐进执行与党争边界",
    time: "总督衙门议事之后",
    locations: ["place.zhejiang_governor_office_inner_room"],
    present: ["source.hu_zongxian", "source.tan_lun"],
    claims: [
      intention("CL-GOVERNOR-INVARIANT", "source.hu_zongxian", "intends_to_prevent_mass_land_loss", "胡宗宪表明无论谭纶是否到来，他都不愿改桑造成大规模失田与内乱；这是人物公开意图，不保证所有行动成功。"),
      statement("CL-GRADUAL-EXECUTION-OPTION", "source.hu_zongxian", "describes_gradual_execution_option", "胡宗宪称原可把一年改桑方案改为三年完成，说明地方执行存在节奏与范围上的政策空间。"),
      event("CL-REJECTION-DOCUMENT-SHOWN", "source.hu_zongxian", "shows_rejection_document", "胡宗宪向谭纶出示内阁驳回奏疏的回文，并展示持续催办改桑的公文与书信。"),
      event("CL-KNOWLEDGE-REFUSAL", "source.tan_lun", "refuses_additional_documents", "谭纶主动拒绝阅读更多私下公文，明确知识越多可能越损害胡宗宪的行动空间。"),
    ],
  },
  {
    sceneId: "DM1566-C04-JOINT-REPORT-CONTEST",
    chapterId: "DM1566-C04",
    paragraphStartId: "DM1566-C04-P0074",
    paragraphEndId: "DM1566-C04-P0110",
    title: "总督府争夺奏疏内容与署名",
    time: "水灾之后的总督署签押房",
    locations: ["place.zhejiang_governor_office_signing_room"],
    present: ["source.hu_zongxian", "source.yang_jinshui", "source.zheng_michang", "source.he_maocai", "source.ma_ningyuan"],
    claims: [
      statement("CL-REPORT-OMITS-DELAY", "source.zheng_michang", "states_local_officials_should_not_request_delay", "郑泌昌说，改桑是国策，是否延缓不该由他们说；若朝廷下旨今年不改，他们再遵旨。"),
      statement("CL-GOVERNOR-DEMANDS-REPORT-CHANGE", "source.hu_zongxian", "demands_report_include_grain_and_three_year_delay", "胡宗宪要求奏疏写明由官府请朝廷调粮借贷、让百姓赶插秧苗，并在三年还粮期间不改稻为桑。"),
      statement("CL-WEAVING-REFUSES-SIGNATURE", "source.yang_jinshui", "refuses_to_sign_three_year_delay_report", "杨金水说若奏疏照此写，他不署名；随后称织造局只管给朝廷织造丝绸。"),
      event("CL-CONFESSION-CHANGES-NEGOTIATION", "source.ma_ningyuan_confession", "is_submitted_before_report_concession", "马宁远递交写明毁堤经过、合谋者并由三人签名的供状；胡宗宪随后再问是否修改奏疏，杨金水、何茂才、郑泌昌先后同意。"),
    ],
  },
  {
    sceneId: "DM1566-C04-REPORT-AND-LETTER-REACH-YAN",
    chapterId: "DM1566-C04",
    paragraphStartId: "DM1566-C04-P0111",
    paragraphEndId: "DM1566-C04-P0120",
    title: "奏疏与地方联名信一同到达严府",
    time: "总督府同意改写奏疏数日后",
    locations: ["place.yan_residence"],
    present: ["source.yan_song", "source.yan_shifan", "source.luo_longwen", "source.yan_maoqing"],
    claims: [
      event("CL-REPORT-AND-LETTER-REACH-YAN", "source.zhejiang_report_bundle", "report_and_joint_letter_reach_yan_shifan_then_yan_song", "叙述明确说，那份奏疏与郑泌昌、何茂才联名的一封信先送到严世蕃手里，随后又由严世蕃送到严嵩手中。"),
      event("CL-REPORT-PROVOKES-IMMEDIATE-REACTION", "source.yan_shifan", "orders_impeachment_after_reading_bundle", "严世蕃看见奏疏与信后的反应是命罗龙文策动御史立刻弹劾，严嵩随即喝止。"),
    ],
  },
  {
    sceneId: "DM1566-C05-GRAIN-LAND-SAFEGUARD",
    chapterId: "DM1566-C05",
    paragraphStartId: "DM1566-C05-P0308",
    paragraphEndId: "DM1566-C05-P0325",
    title: "赈粮、田价与分散改桑的制度取舍",
    time: "高翰文赴浙江途中",
    locations: ["place.roadside_post_station"],
    present: ["source.hu_zongxian", "source.gao_hanwen"],
    claims: [
      statement("CL-LAND-PRICE-AUTHORITY-QUESTION", "source.hu_zongxian", "questions_which_office_controls_land_price", "胡宗宪追问灾后压价买田应由知府、巡抚还是藩臬衙门过问，把土地价格转成制度权限问题。"),
      statement("CL-LAND-MINIMUM-PRICE-SAFEGUARD", "source.hu_zongxian", "proposes_minimum_land_price", "胡宗宪提出受灾两县买田不得低于三十石稻谷一亩，以避免全部灾民失田。"),
      statement("CL-DISTRIBUTED-REFORM-SCOPE", "source.hu_zongxian", "proposes_distributed_reform_scope", "胡宗宪提出把不足的改桑面积分散到未受灾县份并按更高价格买田，以降低集中兼并和民乱风险。"),
      intention("CL-GOVERNOR-SEEKS-EXTERNAL-GRAIN", "source.hu_zongxian", "intends_to_borrow_external_grain", "胡宗宪表示将赴苏州向应天巡抚借粮，为地方争取田价提供短期时间；这是一项意图而非已到仓的粮食。"),
    ],
  },
  {
    sceneId: "DM1566-C06-LAND-PRICE-DEBATE",
    chapterId: "DM1566-C06",
    paragraphStartId: "DM1566-C06-P0133",
    paragraphEndId: "DM1566-C06-P0173",
    title: "官议公开争论灾民卖田与改桑指标",
    time: "浙江地方议定以改兼赈方案时",
    locations: ["place.zhejiang_government_hall"],
    present: ["source.gao_hanwen", "source.zheng_michang", "source.he_maocai", "source.hai_rui", "source.wang_yongji"],
    claims: [
      statement("CL-PLAN-OMITS-LAND-COST", "source.gao_hanwen", "contests_plan_for_omitting_land_cost", "高翰文指出议案只要求丝绸大户尽快买田，却没有规定压价买田和灾民明年生计的处理办法。"),
      statement("CL-PUBLIC-PRICE-FLOOR", "source.gao_hanwen", "asserts_public_price_floor", "高翰文主张灾县田价不得低于三十石一亩，并质疑为何全部改桑指标必须压在两个灾县。"),
      statement("CL-GRAIN-DEADLINE-COUNTERMOVE", "source.he_maocai", "uses_grain_deadline_as_countermove", "何茂才以官仓赈粮不足五日反制田价限制，把眼前饥饿与长期失田风险置于冲突。"),
      event("CL-DEBATE-LEADS-TO-SCHEDULED-RECONSIDERATION", "source.zheng_michang", "schedules_plan_reconsideration", "高翰文、海瑞与王用汲先后请免职后，郑泌昌说议案当然可以再议，要求他们了解粮、丝、买田资金等情形，并定在后天上午再议。"),
    ],
  },
  {
    sceneId: "DM1566-C07-MERCHANT-LEDGER-BARGAIN",
    chapterId: "DM1566-C07",
    paragraphStartId: "DM1566-C07-P0074",
    paragraphEndId: "DM1566-C07-P0110",
    title: "沈一石以账册内情和前程交换改桑合作",
    time: "地方议案受阻之后",
    locations: ["place.shen_yishi_account_room"],
    present: ["source.shen_yishi", "source.gao_hanwen"],
    claims: [
      statement("CL-LEDGER-ACCESS-RESTRICTED", "source.shen_yishi", "restricts_ledger_access", "沈一石称账册连浙江巡抚都不能看，只选择口述部分内容，区分实物存在、接触权和听闻内容。"),
      event("CL-LEDGER-PARTIAL-ORAL-TRANSFER", "source.shen_yishi", "orally_transfers_partial_ledger_information", "沈一石只拣部分账目口述给高翰文，高翰文由此获得有限知识，却没有取得账册保管权。"),
      statement("CL-MERCHANT-OFFERS-CAREER-EXIT", "source.shen_yishi", "offers_career_protection_for_cooperation", "沈一石建议高翰文接受灾民尽快卖田，并称可请宫中把他调离浙江，构成带交换条件的政治保护。"),
      statement("CL-MERCHANT-ARGUES-EMPLOYMENT-OFFSET", "source.shen_yishi", "argues_wage_labor_offsets_land_loss", "沈一石主张失田百姓可受雇种桑织绸，以未来雇佣机会为当前低价卖田辩护；这是商人立场，不是客观保证。"),
      intention("CL-OFFICIAL-REFUSES-PRIVATE-BARGAIN", "source.gao_hanwen", "refuses_private_bargain", "高翰文明确不愿以个人前程换取对低价卖田方案的同意。"),
    ],
  },
  {
    sceneId: "DM1566-C13-LEDGERS-BURNED",
    chapterId: "DM1566-C13",
    paragraphStartId: "DM1566-C13-P0247",
    paragraphEndId: "DM1566-C13-P0265",
    title: "郑泌昌何茂才亲手焚烧四箱账册",
    time: "原著后续，仅作证据保管机制参考",
    locations: ["place.zhejiang_official_backyard"],
    present: ["source.zheng_michang", "source.he_maocai"],
    sourceFuture: true,
    claims: [
      event("CL-FOUR-LEDGER-BOXES-BURNED", "source.zheng_michang_and_he_maocai", "personally_burn_four_boxes_of_ledgers", "郑泌昌、何茂才不让底下人帮忙，亲自把四大箱账册一本一本投入火中焚烧。"),
      statement("CL-HE-THREATENS-CONFESSION", "source.he_maocai", "threatens_to_confess_if_cornered", "何茂才说若被逼得走投无路，便自己请罪，把所有的人都供出来。"),
    ],
  },
  {
    sceneId: "DM1566-C13-OTHER-LEDGER-BOXES-HELD",
    chapterId: "DM1566-C13",
    paragraphStartId: "DM1566-C13-P0266",
    paragraphEndId: "DM1566-C13-P0273",
    title: "杨金水处另存四箱沈一石账册",
    time: "原著后续，仅作证据保管机制参考",
    locations: ["place.yang_jinshui_residence"],
    present: ["source.yang_jinshui", "source.jinyiwei"],
    sourceFuture: true,
    claims: [
      state("CL-OTHER-FOUR-LEDGER-BOXES-HELD", "source.yang_jinshui_residence", "holds_four_boxes_of_shen_yishi_ledgers", "杨金水家里另有同样四口木箱，装着沈一石二十年来所有的账册；原文没有判定这些账册与被烧账册的原副本关系。"),
      statement("CL-YANG-REFUSES-LOCAL-INSPECTION-DESTRUCTION", "source.yang_jinshui", "refuses_local_inspection_or_destruction", "杨金水说这四箱账册不能看，更不能销毁，一定要送进宫里交给老祖宗，让皇上知道。"),
      statement("CL-JINYIWEI-PROPOSES-SORTING-LEDGERS", "source.jinyiwei", "proposes_inspecting_and_sorting_ledgers", "锦衣卫提出打开账册查看，由杨金水决定哪些送上去、哪些销毁。"),
    ],
  },
  {
    sceneId: "DM1566-C23-TESTIMONY-SEALED",
    chapterId: "DM1566-C23",
    paragraphStartId: "DM1566-C23-P0125",
    paragraphEndId: "DM1566-C23-P0147",
    title: "供词画押、合卷、烤漆并下令急递",
    time: "原著后续，仅作文书保管与奏报渠道机制参考",
    locations: ["place.interrogation_room"],
    present: ["source.hai_rui", "source.wang_yongji", "source.clerk", "source.jiang_qianhu", "source.xu_qianhu"],
    sourceFuture: true,
    claims: [
      event("CL-TESTIMONY-SIGNED-BY-TWO-WITNESSES", "source.testimony", "is_signed_by_jiang_and_xu", "书办把同一份供词先移到蒋千户面前、再移到徐千户面前；两人先后画押，书办随后把供词交回王用汲。"),
      event("CL-ORIGINAL-RETRACTIONS-WITNESS-STATEMENTS-COMBINED", "source.evidence_bundle", "combines_original_retractions_witness_statements_and_signed_document", "海瑞先把发回的原供装入信封，王用汲再把郑泌昌、何茂才的翻供、蒋徐二人的供词和田有禄、王牢头签名的字据递给海瑞，海瑞一并装入。"),
      event("CL-HAI-SEALS-BUNDLE-WITH-THREE-FEATHERS", "source.hai_rui", "seals_bundle_with_personal_seal_and_three_feathers", "书办烤漆封口后，海瑞趁漆未硬盖上自己的印章，并在烤漆处粘上三根羽毛。"),
      event("CL-WANG-SEAL-NOT-ADDED", "source.wang_yongji", "prepares_but_does_not_add_seal", "王用汲取出自己的印章时，海瑞已经拿起封文，并说明原案与重审都用自己的封印；原文没有写王用汲的印章加盖在封文上。"),
      statement("CL-HAI-ORDERS-URGENT-DELIVERY-TO-ZHAO", "source.hai_rui", "orders_urgent_delivery_to_zhao", "海瑞说重审仍用自己的封印，还有一个时辰天亮，送呈赵中丞急递。"),
      statement("CL-HAI-ORDERS-PRISONERS-TO-GOVERNOR-OFFICE", "source.hai_rui", "orders_prisoners_taken_to_governor_office", "海瑞随即命人带上郑泌昌、何茂才，立刻去巡抚衙门。"),
    ],
  },
  {
    sceneId: "DM1566-C23-URGENT-DISPATCH-AT-GATE",
    chapterId: "DM1566-C23",
    paragraphStartId: "DM1566-C23-P0155",
    paragraphEndId: "DM1566-C23-P0163",
    title: "三羽急递在永定门交接",
    time: "原著后续，仅作文书保管与奏报渠道机制参考",
    locations: ["place.beijing_yongding_gate"],
    present: ["source.shi_gonggong", "source.escort_jinyiwei"],
    sourceFuture: true,
    claims: [
      event("CL-ESCORT-PRODUCES-THREE-FEATHER-DISPATCH", "source.escort_jinyiwei", "produces_three_feather_urgent_document", "押送的锦衣卫从衣襟里取出一封粘着三根羽毛的急递文书。"),
      statement("CL-ESCORT-EXPLAINS-DISPATCH-PROVENANCE", "source.escort_jinyiwei", "explains_dispatch_provenance_and_contents", "锦衣卫禀告石公公：公文是浙江巡抚衙门昨天追上来递交的，内含司礼监和内阁吩咐重审郑泌昌、何茂才所得供词，要连同杨金水一起递交司礼监。"),
      statement("CL-SHI-ORDERS-PERSONAL-DELIVERY-TO-CHEN", "source.shi_gonggong", "orders_personal_delivery_to_chen", "石公公没有查看公文，只命锦衣卫带着，亲手交给陈公公。"),
    ],
  },
];

function statement(id, speakerRef, predicate, statementText, options = {}) {
  return claim(id, "character_statement", options.subjectRef ?? speakerRef, predicate, statementText, true, speakerRef, options.knownByRefs);
}

function belief(id, speakerRef, predicate, statementText, options = {}) {
  return claim(id, "character_belief", options.subjectRef ?? speakerRef, predicate, statementText, true, speakerRef, options.knownByRefs);
}

function intention(id, speakerRef, predicate, statementText, options = {}) {
  return claim(id, "character_intention", options.subjectRef ?? speakerRef, predicate, statementText, true, speakerRef, options.knownByRefs);
}

function event(id, subjectRef, predicate, statementText, options = {}) {
  return claim(id, "objective_event", subjectRef, predicate, statementText, false, null, options.knownByRefs);
}

function state(id, subjectRef, predicate, statementText, options = {}) {
  return claim(id, "objective_state", subjectRef, predicate, statementText, false, null, options.knownByRefs);
}

function claim(id, claimType, subjectRef, predicate, statementText, subjective, speakerRef, knownByRefs) {
  return { id, claimType, subjectRef, predicate, statementText, subjective, speakerRef, knownByRefs };
}

function readJsonLines(text) {
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

const paragraphCache = new Map();
async function loadParagraphs(chapterId) {
  if (!paragraphCache.has(chapterId)) {
    paragraphCache.set(chapterId, readJsonLines(await readFile(resolve(sourceRoot, `paragraphs/${chapterId}.jsonl`), "utf8")));
  }
  return paragraphCache.get(chapterId);
}

function buildSourceRef(chapterId, paragraphs) {
  return {
    sourceId: "dm1566-liuheping",
    sourceSha256: SOURCE_SHA256,
    chapterId,
    paragraphStartId: paragraphs[0].paragraphId,
    paragraphEndId: paragraphs.at(-1).paragraphId,
    lineStart: paragraphs[0].lineStart,
    lineEnd: paragraphs.at(-1).lineEnd,
    textSpanSha256: sha256Bytes(Buffer.from(paragraphs.map((paragraph) => paragraph.text).join("\n\n"), "utf8")),
  };
}

function evidenceItem(evidenceId, statementText, actorRefs, claimIds, sourceRefs) {
  return { evidenceId, statement: statementText, actorRefs, claimIds, sourceRefs };
}

const allClaims = [];
const allScenes = [];
const failures = [];
for (const spec of sceneSpecs) {
  const chapterParagraphs = await loadParagraphs(spec.chapterId);
  const startIndex = chapterParagraphs.findIndex((paragraph) => paragraph.paragraphId === spec.paragraphStartId);
  const endIndex = chapterParagraphs.findIndex((paragraph) => paragraph.paragraphId === spec.paragraphEndId);
  if (startIndex < 0 || endIndex < startIndex) throw new Error(`Invalid paragraph range for ${spec.sceneId}`);
  const paragraphs = chapterParagraphs.slice(startIndex, endIndex + 1).filter((paragraph) => paragraph.kind === "content");
  const sourceRefs = [buildSourceRef(spec.chapterId, paragraphs)];
  const claimIds = spec.claims.map((entry) => `${spec.chapterId}-${entry.id}`);

  const claims = spec.claims.map((entry, index) => {
    const claimId = claimIds[index];
    return {
      schemaVersion: "dm1566_evidence_claim_v2",
      claimId,
      chapterId: spec.chapterId,
      sceneId: spec.sceneId,
      claimType: entry.claimType,
      subjectRef: entry.subjectRef,
      predicate: entry.predicate,
      object: entry.statementText,
      statement: entry.statementText,
      speakerRef: entry.speakerRef,
      truthStatus: entry.subjective ? "unverified" : "supported",
      epistemicStatus: entry.claimType === "character_belief" ? "believed" : entry.claimType === "character_intention" ? "asserted" : entry.subjective ? "asserted" : "objective",
      knownBy: (entry.knownByRefs ?? spec.present).map((characterRef) => ({ characterRef, state: entry.claimType === "character_belief" ? "believed" : "known", acquiredAtSceneId: spec.sceneId, viaEventOrClaimId: null })),
      validFromSceneId: spec.sceneId,
      validUntilSceneId: null,
      runtimeAvailability: spec.sourceFuture ? "EVIDENCE_ONLY" : "PLANNER_ONLY",
      contradictsClaimIds: [],
      sourceRefs,
      certainty: "explicit",
      mustNotBeTreatedAsObjectiveFact: entry.subjective,
    };
  });

  const actorMoves = claims.map((entry, index) => evidenceItem(
    `${spec.sceneId}-MOVE-${String(index + 1).padStart(2, "0")}`,
    entry.statement,
    entry.subjectRef ? [entry.subjectRef] : [],
    [entry.claimId],
    sourceRefs,
  ));
  const scene = {
    schemaVersion: "dm1566_scene_evidence_v2",
    artifactId: `${spec.sceneId}-ARTIFACT-R1`,
    revision: 1,
    chapterId: spec.chapterId,
    sceneId: spec.sceneId,
    sourceRefs,
    title: spec.title,
    temporalState: { value: spec.time, certainty: "explicit", sourceRefs },
    locationRefs: spec.locations,
    presentCharacterRefs: spec.present,
    referencedCharacterRefs: [],
    openingState: [],
    actorMoves,
    decisions: actorMoves.filter((entry) => /orders|chooses|refuses|demands|proposes|intends|dispatches/.test(claims.find((claimEntry) => claimEntry.claimId === entry.claimIds[0])?.predicate ?? "")),
    immediateResults: [],
    claimIds,
    knowledgeDeltas: claims.filter((entry) => /knowledge|oral|shows|report|ledger/.test(entry.predicate)).map((entry, index) => evidenceItem(`${spec.sceneId}-KNOW-${index + 1}`, entry.statement, entry.subjectRef ? [entry.subjectRef] : [], [entry.claimId], sourceRefs)),
    informationTransfers: claims.filter((entry) => /shows|oral|dispatch|report|delivery/.test(entry.predicate)).map((entry, index) => evidenceItem(`${spec.sceneId}-TRANSFER-${index + 1}`, entry.statement, entry.subjectRef ? [entry.subjectRef] : [], [entry.claimId], sourceRefs)),
    relationshipDeltas: [],
    custodyDeltas: claims.filter((entry) => /ledger|sealed|signed|custody|bundle|document/.test(entry.predicate)).map((entry, index) => evidenceItem(`${spec.sceneId}-CUSTODY-${index + 1}`, entry.statement, entry.subjectRef ? [entry.subjectRef] : [], [entry.claimId], sourceRefs)),
    commitments: claims.filter((entry) => /assumes|intends|orders|proposes/.test(entry.predicate)).map((entry, index) => evidenceItem(`${spec.sceneId}-COMMIT-${index + 1}`, entry.statement, entry.subjectRef ? [entry.subjectRef] : [], [entry.claimId], sourceRefs)),
    threats: claims.filter((entry) => /countermove|pressure|forces/.test(entry.predicate)).map((entry, index) => evidenceItem(`${spec.sceneId}-THREAT-${index + 1}`, entry.statement, entry.subjectRef ? [entry.subjectRef] : [], [entry.claimId], sourceRefs)),
    plantedSetups: [],
    paidOffSetups: [],
    unresolvedQuestions: [evidenceItem(`${spec.sceneId}-OPEN-01`, "该场景所展示的机制进入游戏时仍须由当前状态、玩家行动和已提交事件决定，不能把原著后续当成必然未来。", [], claimIds, sourceRefs)],
    closingState: [],
    continuityDelta: { stateChanges: actorMoves, knowledgeChanges: [], custodyChanges: [], openThreads: [] },
    paragraphDisposition: paragraphs.map((paragraph) => ({ paragraphId: paragraph.paragraphId, disposition: "OWNED", reason: `Selected neutral evidence scope for ${spec.sceneId}` })),
  };

  const sceneSchema = await validateWithSchema("scene-evidence-v2", scene);
  if (!sceneSchema.valid) failures.push({ artifactId: scene.artifactId, errors: sceneSchema.errors });
  for (const entry of claims) {
    const claimSchema = await validateWithSchema("evidence-claim-v2", entry);
    if (!claimSchema.valid) failures.push({ artifactId: entry.claimId, errors: claimSchema.errors });
  }
  allScenes.push(scene);
  allClaims.push(...claims);
  await writeJson(resolve(outputRoot, "scenes", `${spec.sceneId}.scene.json`), scene);
  await writeJson(resolve(outputRoot, "claims", `${spec.sceneId}.claims.json`), { schemaVersion: "dm1566_evidence_claim_set_v2", sceneId: spec.sceneId, claims });
}

const manifest = {
  schemaVersion: "sangtian-selected-evidence-candidate-manifest-v1",
  runId: RUN_ID,
  sourceSha256: SOURCE_SHA256,
  sceneCount: allScenes.length,
  claimCount: allClaims.length,
  sceneArtifactIds: allScenes.map((entry) => entry.artifactId),
  claimIds: allClaims.map((entry) => entry.claimId),
  sourceFutureSceneIds: sceneSpecs.filter((entry) => entry.sourceFuture).map((entry) => entry.sceneId),
  lifecycleStatus: failures.length === 0 ? "SCHEMA_VALIDATED" : "MODEL_CANDIDATE",
};
await writeJson(resolve(outputRoot, "manifest.json"), manifest);
console.log(JSON.stringify({ outputRoot, ...manifest, schemaFailures: failures, verdict: failures.length === 0 ? "PASS" : "FAIL" }, null, 2));
if (failures.length > 0) process.exitCode = 1;
