import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONTENT_VERSION = "sangtian_v1_1";
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sangtianRoot = join(packageRoot, "config", "sangtian");
const outputRoot = join(sangtianRoot, "continuous-strategy-v1.1");
const checkOnly = process.argv.includes("--check");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const ROLES = {
  governor: { roleKey: "zhejiang_governor", name: "浙江总督", riskProfile: "BALANCED" },
  xunfu: { roleKey: "xunfu", name: "浙江巡抚", riskProfile: "ASSERTIVE" },
  magistrate: { roleKey: "county_magistrate", name: "清流县令", riskProfile: "CAUTIOUS" }
};
const ROLE_IDS = Object.keys(ROLES);
const VISIBILITIES = ["PUBLIC", "OBSERVABLE", "LIMITED", "PRIVATE"];
const action = (slug, title, objective, target, visibility, risk, receipt) => ({ slug, title, objective, target, visibility, risk, receipt });
const maneuver = (slug, title, objective, target, allowedTypes = ["CONTACT", "LEVERAGE"]) => ({ slug, title, objective, target, allowedTypes });

// Every brief, pressure, action title/objective/receipt and maneuver objective is deliberately authored per stage and role.
const BLUEPRINTS = [
  {
    number: 1, slug: "change_mulberry_order", title: "改桑急令", contestSlug: "review_authority", contestTitle: "执行边界与复核权", contestDescription: "三名官员共同争夺谁能定义急令的执行节奏、复核程序与证据归属。",
    system: ["tighten_merchant_credit", "商会把垫银账期缩短为十日，任何执行路线都必须承担更高的粮价与现金压力。"],
    request: { source: "magistrate", target: "governor", actionSlug: "retain_original_register", eventType: "PROTECT_EVIDENCE", defaultOutcomeKey: "default_s1_keep_register_local" },
    carriedFactKeys: [],
    publicResult: "改桑急令形成了可审计的执行边界；速度、复核和县册去向开始互相制约。",
    roles: {
      governor: { brief: "急令必须执行，但县册与巡抚催办数字互相冲突；求快会留下失察责任，求稳会被归咎迟延。", pressure: "不公开暗账线索的前提下取得执行边界与复核权。", asset: ["memorial_channel", "密奏与复核渠道"], maneuver: maneuver("cross_check_deadline", "交叉核验催办时限", "用密奏渠道核对巡抚的进度口径，并保留不公开叫停的余地。", "xunfu", ["INVESTIGATE", "LEVERAGE"]), actions: [
        action("joint_review", "设立联合复核程序", "把执行速度与证据复核同时纳入总督衙门控制。", "xunfu", "PUBLIC", "NORMAL", "复核印记已下发，巡抚催办必须留下可核验底稿。"),
        action("pause_one_county", "暂缓一县并封存底稿", "用最小范围暂缓换取真实样本，避免全省公开抗令。", "magistrate", "OBSERVABLE", "HIGH", "清流县获得短复核期，原始底稿进入封存清单。"),
        action("endorse_fast_execution", "支持强推并附追责条款", "让巡抚承担速度，同时保留日后复核的政治抓手。", "xunfu", "PUBLIC", "HIGH", "强推获得背书，每份催办令同时带上追责编号。")
      ], personalResult: "总督本轮的复核边界决定了他日后能否解释浙江执行失衡。" },
      xunfu: { brief: "京师只看进度，不会替你解释地方阻力；总督正在争夺复核权，县令可能以底册反证催办过急。", pressure: "在总督接管口径前形成可见政绩，并避免留下无法解释的催收链。", asset: ["clerk_network", "催办吏员网络"], maneuver: maneuver("probe_governor_limit", "试探总督复核底线", "通过公开进度与私下接触判断总督会容忍多大范围的暂缓。", "governor"), actions: [
        action("accelerate_orders", "抢先催办各县", "用先发命令锁定执行节奏，使总督只能在既成进度上复核。", "magistrate", "OBSERVABLE", "HIGH", "加急催办抵达清流县，县令的可用时间被压缩。"),
        action("publish_progress", "公开各县执行进度", "把进度变成公共政治事实，迫使总督承担暂缓成本。", "governor", "PUBLIC", "NORMAL", "进度榜已经公开，任何复核决定都会改变公众口径。"),
        action("reserve_review_window", "压缩复核但保留窗口", "承认有限复核以换取总督不全面叫停。", "magistrate", "LIMITED", "NORMAL", "县令得到短复核窗口，逾时材料不进入本轮奏报。")
      ], personalResult: "巡抚本轮留下的进度承诺会在后续粮价和弹劾中转化为个人责任。" },
      magistrate: { brief: "原始县册能证明部分桑田其实是粮田，但公开抗令会立即断送官位；两位上官都尚未承诺保护证据。", pressure: "保住县册和百姓生计，同时让至少一位上官对证据链承担责任。", asset: ["register_original", "清流县册原件"], maneuver: maneuver("seek_sealed_protection", "密封请求证据保护", "用县册原件作筹码，要求总督给出不公开但可追溯的保护承诺。", "governor", ["CONTACT", "LEVERAGE"]), actions: [
        action("retain_original_register", "封存并留住原始县册", "阻止原件在催办中被替换，并请求总督明确保护证据。", "governor", "PRIVATE", "HIGH", "原始县册已封存，保护请求通过密封公文送往总督衙门。"),
        action("phase_execution", "按粮田风险分批执行", "不公开抗令，但把高风险地块推迟到核验之后。", "xunfu", "OBSERVABLE", "NORMAL", "分批清单已经发出，巡抚必须回应较慢但可核验的进度。"),
        action("submit_copy_for_protection", "递交副本换取保护", "让总督掌握可核验副本，使县衙不再独自承担风险。", "governor", "LIMITED", "HIGH", "副本已经收讫，总督对证据去向产生了可追溯责任。")
      ], personalResult: "县令是否保住原件以及谁收到副本，将决定后续密信和暗账的可信度。" }
    }
  },
  {
    number: 2, slug: "county_secret_letter", title: "县令密信", contestSlug: "document_custody", contestTitle: "田契副本与保管权", contestDescription: "密信把田契副本、原件和保护承诺连接成同一条责任链。",
    system: ["offer_paid_custody", "商会提出有偿保管与转运文书，谁接受就会留下资金和接触记录。"],
    request: { source: "governor", target: "magistrate", actionSlug: "request_original", eventType: "HANDOVER_ORIGINAL", defaultOutcomeKey: "default_s2_keep_original_sealed" },
    reaction: { key: "reaction_s2_p3_original_request", source: "governor", target: "magistrate", triggerActionSlug: "request_original", responses: [["offer_sealed_copy", "只交封缄副本", "县令交出可核验副本但保留原件。"], ["retain_original", "拒交原件并说明风险", "县令保持原件封存，不替玩家交出证据。"]], fallback: "retain_original" },
    carriedFactKeys: ["fact_s1_magistrate_retain_original_register"],
    publicResult: "县令密信迫使三方明确证据由谁保管、谁能核验，以及拒绝交出原件的代价。",
    roles: {
      governor: { brief: "密信与县册线索吻合，但若由你单独收件，巡抚会指控总督衙门私藏证据。", pressure: "取得可信证据，同时避免把县令暴露为唯一来源。", asset: ["sealed_mail_channel", "总督密封收件渠道"], maneuver: maneuver("verify_letter_route", "追查密信递送路径", "核验信件是否被巡抚幕僚截取，并判断县令还保留了哪些副本。", "magistrate", ["INVESTIGATE", "CONTACT"]), actions: [
        action("receive_letter_privately", "私下接收密信", "先保护来源，再决定是否把密信转入正式证据链。", "magistrate", "PRIVATE", "NORMAL", "密信进入总督密档，县令身份暂未公开。"),
        action("dual_verification", "建立双人核验", "让两衙共同核验纸张、印记和田契编号，降低伪造争议。", "xunfu", "OBSERVABLE", "NORMAL", "双人核验程序成立，巡抚必须在记录上签名。"),
        action("request_original", "要求县令交出原件", "用原件结束真伪争论，但必须承担保管与来源保护责任。", "magistrate", "LIMITED", "HIGH", "原件交付请求已经送达，县令进入强制回应。")
      ], personalResult: "总督如何接信与核验，决定他掌握的是情报、证据还是新的政治债务。" },
      xunfu: { brief: "密信可能揭开催办链中的违规，也可能是总督和县令联手拖延的工具。", pressure: "控制泄密调查，不让幕僚往来成为别人定义你的证据。", asset: ["inspection_roster", "巡抚查验名册"], maneuver: maneuver("question_letter_witness", "接触密信见证人", "用查验名册锁定经手人，但避免公开逼迫县令撤回证词。", "magistrate", ["CONTACT", "INVESTIGATE"]), actions: [
        action("trace_leak", "追查密信泄漏路径", "查明谁绕过巡抚衙门向总督递信。", "magistrate", "OBSERVABLE", "HIGH", "经手人名单被锁定，县令的递信渠道承受压力。"),
        action("seize_drafts", "收缴催办底稿", "先控制可能与密信互证的底稿，防止责任链外流。", "governor", "LIMITED", "HIGH", "巡抚衙门收拢底稿，总督可见的原始材料减少。"),
        action("challenge_letter", "公开质疑密信完整性", "把举证责任推回县令，同时保留后续反转空间。", "magistrate", "PUBLIC", "NORMAL", "密信真伪成为公共争点，县令必须补足证据链。")
      ], personalResult: "巡抚的调查方式决定密信会成为反证、把柄还是可共同核验的事实。" },
      magistrate: { brief: "你知道密信所述真实，但交出原件会失去唯一保命筹码；拒交又可能被定性为抗拒调查。", pressure: "证明密信可信，同时保留至少一份不受他人控制的原始材料。", asset: ["contract_copy", "田契核验副本"], maneuver: maneuver("trade_copy_for_witness", "以副本交换见证保护", "只让上官核验关键编号，并换取对经手书吏的保护。", "governor", ["LEVERAGE", "CONTACT"]), actions: [
        action("send_copy", "递交可核验副本", "提供足以核验的材料，但不放弃原件控制。", "governor", "LIMITED", "NORMAL", "副本进入总督核验链，原件仍由县衙封存。"),
        action("hide_original", "转移并隐藏原件", "防止突击收缴，但承担被指控隐匿证据的风险。", "xunfu", "PRIVATE", "HIGH", "原件离开常规库房，巡抚的收缴行动扑空。"),
        action("trade_protection", "用证据交换书面保护", "要求上官先承担来源保护，再开放进一步核验。", "governor", "LIMITED", "HIGH", "保护条款与证据开放被绑定，县令不再单方面交付。")
      ], personalResult: "县令在原件、副本和保护之间的取舍，将决定暗账出现时谁拥有证据主动权。" }
    }
  },
  {
    number: 3, slug: "grain_price_crisis", title: "粮价失控", contestSlug: "grain_route", contestTitle: "粮路、官仓与责任解释", contestDescription: "粮价上涨把改桑进度、商会垫银和地方粮仓变成同一场资源争夺。",
    system: ["restrict_grain_release", "商会以银路紧张为由限制放粮，公开市场出现新的价格锚点。"],
    request: { source: "governor", target: "xunfu", actionSlug: "audit_merchants", eventType: "SHARE_MERCHANT_RECORDS", defaultOutcomeKey: "default_s3_share_public_ledger_only" },
    carriedFactKeys: ["fact_s1_xunfu_accelerate_orders", "fact_s2_magistrate_send_copy"],
    publicResult: "粮价危机将每个人此前的执行选择转换为官仓余量、商会压力和可归责的价格口径。",
    roles: {
      governor: { brief: "官仓可以暂时压价，却可能遮蔽改桑造成的粮田损失；查商会又会触发银路收缩。", pressure: "稳定价格，同时取得能够解释粮价来源的独立数据。", asset: ["granary_release_order", "官仓放粮令"], maneuver: maneuver("compare_grain_ledgers", "比对官仓与商会账", "调查两套库存数字的差额，防止单一来源垄断粮价解释。", "xunfu", ["INVESTIGATE", "LEVERAGE"]), actions: [
        action("release_granary", "限量开放官仓", "用可回收的官粮平抑价格，不掩盖真实粮田损失。", "magistrate", "PUBLIC", "NORMAL", "官仓开始限量放粮，县衙获得短期缓冲。"),
        action("audit_merchants", "联查商会库存", "要求巡抚共享商会往来记录，核验囤积与垫银。", "xunfu", "OBSERVABLE", "HIGH", "联查请求进入巡抚衙门，商会库存不再是单方口径。"),
        action("unify_price_message", "发布统一粮价口径", "先稳定恐慌，再把差异数据留给内部复核。", "xunfu", "PUBLIC", "HIGH", "统一口径压住谣言，也把后续解释责任集中到总督。")
      ], personalResult: "总督是否区分短期平粮与长期粮田损失，决定他能否在京师解释危机根源。" },
      xunfu: { brief: "商会与幕僚往来可能被粮价调查翻出，若只归责商人又无法解释催征导致的断粮。", pressure: "让执行进度继续，同时把价格责任锁定在可控制的对象上。", asset: ["merchant_summons", "米商召集令"], maneuver: maneuver("split_merchant_alliance", "分化米商同盟", "接触愿意交账的米商，以局部透明换取市场供给。", "governor", ["CONTACT", "LEVERAGE"]), actions: [
        action("blame_merchants", "公开归责囤粮商会", "把价格上涨定义为市场操纵，转移改桑责任。", "governor", "PUBLIC", "HIGH", "商会成为公开责任对象，但开始收紧银路。"),
        action("summon_dealers", "召集米商议价放粮", "用行政压力换取短期供给，并留下谈判记录。", "magistrate", "OBSERVABLE", "NORMAL", "米商同意分批放粮，县令获得可见的供应承诺。"),
        action("accelerate_levy", "加速征收补官仓", "以征收补充官仓，但把压力直接推向地方。", "magistrate", "LIMITED", "HIGH", "征收额度提高，县衙粮田与民情风险同步上升。")
      ], personalResult: "巡抚选择归责、谈判或加征，将决定商会账簿和地方民情在弹劾中的分量。" },
      magistrate: { brief: "本县粮田损失已经反映在市价上，但公开全部数据会证明改桑执行出现系统性偏差。", pressure: "保护地方粮仓和百姓口粮，并让上官承认价格与改桑之间的关系。", asset: ["grain_loss_ledger", "粮田损失册"], maneuver: maneuver("show_loss_sample", "展示粮田损失样本", "只向总督展示可核验样本，迫使其把粮田损失纳入平粮决策。", "governor", ["LEVERAGE", "CONTACT"]), actions: [
        action("publish_loss", "公布粮田损失清单", "让价格危机拥有可核验的土地来源，而非只归责商人。", "governor", "PUBLIC", "HIGH", "粮田损失进入公共视野，总督必须调整危机解释。"),
        action("organize_petitions", "汇总民情与米价证词", "用多份独立证词降低县令单方陈述的风险。", "xunfu", "OBSERVABLE", "NORMAL", "民情证词形成目录，巡抚的进度口径受到反证。"),
        action("protect_local_granary", "封存地方保命粮仓", "拒绝把最后口粮用于填补上级进度数字。", "xunfu", "LIMITED", "HIGH", "地方粮仓停止外调，巡抚可用库存下降。")
      ], personalResult: "县令是否把损失册变成公共证据，将决定百姓代价能否进入最终奏报。" }
    }
  },
  {
    number: 4, slug: "hidden_ledger", title: "暗账浮出", contestSlug: "evidence_custody", contestTitle: "暗账原件、副本与证人", contestDescription: "暗账出现后，证据持有人、见证人安全和接触记录共同决定其效力。",
    system: ["buy_witness_silence", "商会向关键书吏提出离境安置，证人安全与证词完整性同时受到影响。"],
    request: { source: "magistrate", target: "governor", actionSlug: "protect_witness", eventType: "PROTECT_WITNESS", defaultOutcomeKey: "default_s4_sealed_local_custody" },
    reaction: { key: "reaction_s4_p1_witness_protection", source: "magistrate", target: "governor", triggerActionSlug: "protect_witness", responses: [["accept_joint_protection", "接受联合保护", "总督把证人纳入双衙保护并承担公开责任。"], ["limit_to_sealed_custody", "仅提供密封保管", "总督维持证据现状，不替县令公开证人。"]], fallback: "limit_to_sealed_custody" },
    carriedFactKeys: ["fact_s2_magistrate_hide_original", "fact_s3_magistrate_publish_loss", "fact_s3_system_restrict_grain_release"],
    publicResult: "暗账的效力不再由文案决定，而由原件去向、证人保护和每次接触的可追溯记录决定。",
    roles: {
      governor: { brief: "暗账能解释粮价与催办链，但接触过早会让总督衙门承担灭证或操纵证人的嫌疑。", pressure: "建立可信保管链，并决定保护证人的范围。", asset: ["evidence_seal", "总督证据封印"], maneuver: maneuver("audit_chain_of_custody", "核对证据接触链", "调查原件、副本和证人每次转手，排除被替换的空档。", "magistrate", ["INVESTIGATE", "LEVERAGE"]), actions: [
        action("seal_evidence", "封存暗账并编号", "把原件纳入不可静默替换的正式保管链。", "magistrate", "OBSERVABLE", "NORMAL", "暗账获得封存编号，任何后续接触都必须留痕。"),
        action("protect_witness", "建立双衙证人保护", "让证人脱离单一衙门控制，降低翻供和失踪风险。", "xunfu", "LIMITED", "HIGH", "证人进入双衙保护，巡抚也获得有限核验权。"),
        action("control_access", "限制证据接触权限", "减少灭证机会，但承担被指控垄断证据的风险。", "xunfu", "PRIVATE", "HIGH", "暗账访问被收紧，巡抚只能通过登记申请核验。")
      ], personalResult: "总督对保管链与证人保护的选择，决定暗账能否在御前经受程序质疑。" },
      xunfu: { brief: "暗账可能指向你的幕僚；承认完整性会失去主动，贸然抢夺又会留下干预证据的记录。", pressure: "在暗账被定性前取得核验机会，并隔离幕僚风险。", asset: ["integrity_objection", "完整性质疑书"], maneuver: maneuver("test_ledger_sequence", "核验暗账号段", "用已掌握的商会往来编号检查暗账是否被拼接。", "governor", ["INVESTIGATE", "LEVERAGE"]), actions: [
        action("challenge_integrity", "质疑暗账完整性", "要求补足页码、印记和来源，延缓其直接成为定案证据。", "governor", "PUBLIC", "NORMAL", "暗账进入完整性复核，证据目录必须补充缺页说明。"),
        action("seize_original", "申请收缴原件复验", "取得原件控制，但承担干预保管链的高风险。", "magistrate", "OBSERVABLE", "HIGH", "收缴申请公开留痕，县令面临原件交付压力。"),
        action("cut_off_aide", "切割涉账幕僚", "承认个人往来但阻断其继续影响证据与商会。", "governor", "PUBLIC", "HIGH", "涉账幕僚被停职，巡抚失去一条执行网络。")
      ], personalResult: "巡抚能否以程序核验而非强取证据自保，将决定弹劾时的可信度。" },
      magistrate: { brief: "你掌握的原件与暗账能互证，但证人已经受到商会接触；任何转移都可能被视为灭证。", pressure: "保全原件和证人，同时把保护责任分担给上级。", asset: ["witness_roster", "证人保护名册"], maneuver: maneuver("move_witness_openly", "公开登记证人转移", "用可见登记换取安全地点，避免秘密转移被解释为操纵。", "governor", ["CONTACT", "LEVERAGE"]), actions: [
        action("send_copy", "递交暗账副本核验", "让上级验证内容，同时继续保留原件对照。", "governor", "LIMITED", "NORMAL", "副本进入总督核验链，原件位置仍未公开。"),
        action("move_original", "转移原件到中立库房", "避开巡抚突击收缴，并以第三方封条保持连续性。", "xunfu", "OBSERVABLE", "HIGH", "原件进入中立库房，巡抚无法单方取得。"),
        action("protect_witness", "请求总督保护证人", "迫使总督对证人安全作出可追溯回应。", "governor", "LIMITED", "HIGH", "证人保护请求送达，总督进入强制回应。")
      ], personalResult: "县令能否同时保全原件与证人，决定他在相互弹劾中是证据源还是替罪羊。" }
    }
  },
  {
    number: 5, slug: "mutual_impeachment", title: "相互弹劾", contestSlug: "responsibility_narrative", contestTitle: "责任叙事与奏报先后", contestDescription: "三方争夺谁先定义改桑、粮价和暗账责任，同时必须接受前序事实反证。",
    system: ["publish_counter_ledger", "商会公开一份选择性账册，试图把所有责任压回官府执行链。"],
    request: { source: "governor", target: "xunfu", actionSlug: "impeach_abuse", eventType: "ANSWER_IMPEACHMENT", defaultOutcomeKey: "default_s5_submit_schedule_only" },
    reaction: { key: "reaction_s5_p2_impeachment_reply", source: "governor", target: "xunfu", triggerActionSlug: "impeach_abuse", responses: [["submit_execution_schedule", "提交执行时序反证", "巡抚用逐日命令证明部分风险已经上报。"], ["challenge_review_delay", "反指复核拖延", "巡抚把责任重新指向总督的复核决定。"]], fallback: "submit_execution_schedule" },
    carriedFactKeys: ["fact_s3_xunfu_blame_merchants", "fact_s4_governor_seal_evidence", "fact_s4_xunfu_cut_off_aide", "fact_s4_magistrate_move_original"],
    publicResult: "弹劾不再是空泛指控；每份责任叙事都必须对应前序命令、证据接触和粮价事实。",
    roles: {
      governor: { brief: "你必须解释为何允许催办、何时开始复核，以及暗账出现后是否保护了证据。", pressure: "拆分制度责任与个人滥权，避免全局失控被归到总督失察。", asset: ["review_timeline", "总督复核时序"], maneuver: maneuver("compare_orders_and_losses", "对照命令与损失日期", "用复核时序揭示哪些损失发生在巡抚追加催办之后。", "xunfu", ["INVESTIGATE", "LEVERAGE"]), actions: [
        action("split_liability", "按时序拆分责任", "把国策、执行追加和地方违规分开归责。", "xunfu", "PUBLIC", "NORMAL", "责任表按日期展开，三方不能再用单一叙事覆盖全部事实。"),
        action("suppress_unsupported", "压下无证据弹劾", "要求所有指控绑定原始命令或账册，防止政治噪声淹没事实。", "magistrate", "OBSERVABLE", "NORMAL", "无来源指控被退回，县令的证据目录权重上升。"),
        action("impeach_abuse", "弹劾巡抚越权催办", "以时序和粮价损失要求巡抚正式答辩。", "xunfu", "PUBLIC", "HIGH", "弹劾进入正式流程，巡抚必须提交回应。")
      ], personalResult: "总督能否用时序而非权位拆分责任，将决定御前是否相信其稳局能力。" },
      xunfu: { brief: "总督掌握复核时序，县令掌握损失与暗账；你必须证明进度不是滥权，而是可追踪的政策执行。", pressure: "抢在他人之前定义执行成果，并为幕僚和商会往来建立边界。", asset: ["execution_schedule", "巡抚执行时序"], maneuver: maneuver("secure_counter_testimony", "取得执行官吏反证", "联系不涉暗账的执行官吏，证明部分催办经过合法授权。", "magistrate", ["CONTACT", "INVESTIGATE"]), actions: [
        action("impeach_delay", "弹劾总督拖延复核", "把粮价恶化归因于迟迟未定的复核边界。", "governor", "PUBLIC", "HIGH", "总督的复核时序成为公开审查对象。"),
        action("claim_credit", "提交改桑进度政绩", "用完成数字证明执行有效，但必须接受粮田损失交叉核验。", "magistrate", "PUBLIC", "NORMAL", "进度数字进入奏报，县令损失册成为必要附件。"),
        action("counter_accuse", "反指县令隐匿原件", "用原件转移记录削弱县令证据的中立性。", "magistrate", "OBSERVABLE", "HIGH", "原件保管链被质疑，县令必须公开更多接触记录。")
      ], personalResult: "巡抚的答辩是否承认真实代价，将决定政绩数字是保护还是反噬。" },
      magistrate: { brief: "两位上官都可能拿你的原件转移和地方暂缓作为攻击材料，但你掌握最完整的损失与来源链。", pressure: "证明地方行为是保全证据与民生，而非抗令或选边。", asset: ["source_index", "县令证据来源目录"], maneuver: maneuver("link_source_to_order", "逐条连接来源与命令", "把每份民情、县册和暗账来源对应到具体上级命令。", "governor", ["INVESTIGATE", "LEVERAGE"]), actions: [
        action("prove_overreach", "提交越权催办反证", "以签发时间证明部分催办超出总督授权。", "xunfu", "PUBLIC", "HIGH", "越权证据进入弹劾卷，巡抚必须解释签发依据。"),
        action("request_public_audit", "请求公开审计证据链", "让三方材料在同一规则下接受核验，减少县令被单独归责。", "governor", "PUBLIC", "NORMAL", "公开审计程序启动，证据接触记录成为共同标准。"),
        action("preserve_sources", "封存来源身份附录", "向御前证明来源存在，但暂不把证人暴露给地方争斗。", "governor", "PRIVATE", "NORMAL", "来源附录被独立封存，县令保留日后核验能力。")
      ], personalResult: "县令是否把来源与命令一一对应，决定其证据能否超越地方自辩。" }
    }
  },
  {
    number: 6, slug: "capital_reply", title: "京师回批", contestSlug: "final_memorial", contestTitle: "最终奏报与皇帝信任", contestDescription: "京师要求一份可核验奏报，三方必须选择承担、淡化或反驳哪些前序事实。",
    system: ["offer_emergency_credit", "商会提出以紧急垫银换取奏报中的免责措辞，形成最后一次利益交换。"],
    request: { source: "magistrate", target: "governor", actionSlug: "protect_sources", eventType: "PROTECT_SOURCES_IN_MEMORIAL", defaultOutcomeKey: "default_s6_anonymize_sources" },
    carriedFactKeys: ["fact_s3_magistrate_publish_loss", "fact_s4_governor_seal_evidence", "fact_s5_governor_split_liability", "fact_s5_xunfu_claim_credit", "fact_s5_magistrate_preserve_sources"],
    publicResult: "最终奏报把粮价、田契、暗账、责任和来源保护压缩为一份可被御前逐条追问的记录。",
    roles: {
      governor: { brief: "京师不接受模糊的稳局表述；你必须明确哪些决定由自己承担，哪些事实仍需地方弹性。", pressure: "形成能容纳冲突证据的主奏，同时维持皇帝对总督统筹能力的信任。", asset: ["main_memorial_seal", "主奏封印"], maneuver: maneuver("cross_reference_memorials", "交叉标注三份奏报", "把巡抚进度与县令证据逐条标入主奏，提前发现互相矛盾。", "xunfu", ["INVESTIGATE", "LEVERAGE"]), actions: [
        action("consolidate_memorial", "汇总事实形成主奏", "把进度、损失和证据链放入同一可核验结构。", "xunfu", "PUBLIC", "NORMAL", "主奏形成统一目录，巡抚必须回应其中的时序差异。"),
        action("accept_review_duty", "承担复核失察责任", "以主动承担换取对地方证据和后续修正的信任。", "magistrate", "PUBLIC", "HIGH", "总督承担复核责任，县令材料获得更高核验优先级。"),
        action("preserve_flexibility", "保留地方执行弹性", "承认政策目标但请求允许按粮田风险修正执行。", "magistrate", "OBSERVABLE", "NORMAL", "主奏加入地方弹性条款，县令的分批执行获得制度入口。")
      ], personalResult: "总督主奏是否容纳冲突事实，决定御前把他视为稳局者还是遮掩者。" },
      xunfu: { brief: "你的政绩必须经得住损失册、暗账和催办时序核验；淡化任一项都可能被另外两份奏报揭穿。", pressure: "保住执行成果，并把可以证明合法授权的材料送入京师。", asset: ["merit_memorial", "巡抚政绩密奏"], maneuver: maneuver("rebut_loss_causation", "反驳粮损因果链", "用分县时间线指出部分粮价波动早于追加催办。", "magistrate", ["INVESTIGATE", "LEVERAGE"]), actions: [
        action("secret_merit_report", "密奏执行政绩", "向皇帝直接说明完成数字和合法授权，绕开地方口径争夺。", "governor", "PRIVATE", "HIGH", "政绩密奏进入京师，但与主奏差异留下可比对痕迹。"),
        action("minimize_ledger", "淡化暗账关联", "承认幕僚失当而否认其代表巡抚政策。", "governor", "PUBLIC", "HIGH", "巡抚切割暗账责任，证据接触链成为成败关键。"),
        action("demand_closure", "请求强制结案", "以行政确定性阻止地方继续追加材料。", "magistrate", "PUBLIC", "NORMAL", "结案请求压缩县令补证时间，也把遗漏责任锁定到巡抚。")
      ], personalResult: "巡抚密奏与公开主奏之间的差异，将成为御前判断其诚信的直接依据。" },
      magistrate: { brief: "京师给了最后一次提交材料的机会；过度公开会伤害来源，过度隐匿又会让证据失去效力。", pressure: "让证据、民情和来源保护同时进入奏报，而不是只剩一段地方陈情。", asset: ["evidence_catalog", "完整证据目录"], maneuver: maneuver("verify_source_redaction", "核验来源匿名化", "与总督确认每条匿名材料仍保留可独立复核的封存编号。", "governor", ["CONTACT", "INVESTIGATE"]), actions: [
        action("submit_evidence_index", "提交完整证据目录", "让每个结论都能追溯到县册、暗账或证词。", "governor", "PUBLIC", "NORMAL", "证据目录进入主奏，所有关键结论获得来源编号。"),
        action("attach_petitions", "附上民情与粮价证词", "让百姓代价进入御前判断，而非只呈现官员责任。", "xunfu", "OBSERVABLE", "HIGH", "民情附件进入奏报，巡抚政绩必须回应真实代价。"),
        action("protect_sources", "请求保护证据来源", "要求总督以匿名编号替代公开姓名，保留后续核验。", "governor", "LIMITED", "HIGH", "来源保护请求送达，主奏必须决定匿名化边界。")
      ], personalResult: "县令是否兼顾可核验与来源安全，决定其材料在御前是证据还是未经证实的陈情。" }
    }
  },
  {
    number: 7, slug: "imperial_judgment", title: "御前裁决", contestSlug: "final_responsibility", contestTitle: "最终责任与个人命运", contestDescription: "三方必须用前六阶段真实事实为自己的路线辩护，并接受彼此选择造成的后果。",
    system: ["freeze_trade_credit", "商会在裁决前冻结新增垫银，迫使所有人面对既有选择而不能购买新的缓冲。"],
    request: { source: "xunfu", target: "governor", actionSlug: "defend_execution", eventType: "CONFIRM_SHARED_TIMELINE", defaultOutcomeKey: "default_s7_use_sealed_timeline" },
    carriedFactKeys: ["fact_s1_governor_joint_review", "fact_s2_magistrate_hide_original", "fact_s3_magistrate_publish_loss", "fact_s4_governor_seal_evidence", "fact_s5_governor_split_liability", "fact_s6_governor_consolidate_memorial", "fact_s6_magistrate_submit_evidence_index"],
    publicResult: "御前裁决以七阶段行动、跨角色影响、证据链和奏报差异为依据，形成一个公共结局与三条个人命运。",
    roles: {
      governor: { brief: "皇帝会同时追问你为何允许强推、何时启动复核，以及是否在暗账出现后保护了真相。", pressure: "用完整时序证明稳局不是遮掩，并明确自己承担的责任。", asset: ["imperial_defense_outline", "总督御前答辩提纲"], maneuver: maneuver("cross_examine_execution", "御前追问巡抚执行链", "用复核时序要求巡抚解释每次追加催办与损失之间的关系。", "xunfu", ["INVESTIGATE", "LEVERAGE"]), actions: [
        action("state_stability_case", "陈述稳局与纠偏路线", "证明官仓、复核和证据保护共同避免了更大危机。", "xunfu", "PUBLIC", "NORMAL", "总督以七阶段时序陈述稳局，巡抚进度被纳入交叉核验。"),
        action("accept_final_duty", "承担最终复核责任", "主动承担制度责任，换取对地方证据和改革建议的采信。", "magistrate", "PUBLIC", "HIGH", "总督明确承担复核责任，县令证据获得正式回应。"),
        action("defend_local_flexibility", "为地方弹性辩护", "说明分批执行和来源保护为何不是抗令。", "magistrate", "PUBLIC", "NORMAL", "地方弹性进入裁决问题，县令不再只是被动被审。")
      ], personalResult: "总督最终命运取决于他能否用前六阶段事实证明统筹、纠偏与承担同时存在。" },
      xunfu: { brief: "皇帝将比较你的密奏、公开进度和暗账回应；任何无法解释的差异都会被视为欺瞒。", pressure: "为执行路线辩护，同时承认真实代价而不让政绩彻底失效。", asset: ["execution_evidence_bundle", "巡抚执行证据束"], maneuver: maneuver("present_progress_proof", "呈递进度原始凭证", "用签发时间与收讫记录反驳总督对越权催办的概括。", "governor", ["LEVERAGE", "INVESTIGATE"]), actions: [
        action("defend_execution", "为执行路线完整辩护", "把授权、进度和风险上报连成可核验链条。", "governor", "PUBLIC", "NORMAL", "巡抚提交执行链，要求总督确认共同时间线。"),
        action("admit_costs", "承认代价并主张必要性", "承认粮价和地方损失，但证明当时存在更大财政风险。", "magistrate", "PUBLIC", "HIGH", "巡抚承认真实代价，县令材料成为必要性判断依据。"),
        action("seek_forced_acquittal", "请求以政绩结案", "要求皇帝用完成数字终止证据争议。", "magistrate", "PUBLIC", "HIGH", "巡抚把命运押在政绩数字上，未解释证据转为直接风险。")
      ], personalResult: "巡抚的结局取决于政绩、授权与代价是否能在同一证据链中自洽。" },
      magistrate: { brief: "你必须证明保护百姓、保全原件和隐去来源姓名都是同一条合法选择，而不是连续抗令。", pressure: "让证据链和民情被采信，并确保来源不会因裁决暴露。", asset: ["final_evidence_index", "县令终局证据目录"], maneuver: maneuver("protect_sources_at_hearing", "御前保全证据来源", "用封存编号证明来源存在，同时阻止地方官场获得真实姓名。", "governor", ["LEVERAGE", "CONTACT"]), actions: [
        action("submit_final_index", "提交终局证据目录", "按阶段列出每项事实、来源与影响，接受御前逐条核验。", "governor", "PUBLIC", "NORMAL", "终局目录展开，前六阶段事实进入最终裁决。"),
        action("plead_for_people", "以民情与粮损陈述保民路线", "证明地方选择减少了不可逆的民生损害。", "xunfu", "PUBLIC", "HIGH", "粮损与民情进入裁决，巡抚必须回应执行代价。"),
        action("shield_sources", "请求裁决继续保护来源", "让结案不以暴露证人和书吏为代价。", "governor", "LIMITED", "NORMAL", "来源保护成为裁决条款，证据链可核验但不公开姓名。")
      ], personalResult: "县令的命运取决于证据能否证明保民、守法和来源保护不是互相冲突的借口。" }
    }
  }
];

if (BLUEPRINTS.length !== 7 || BLUEPRINTS.some((stage, index) => stage.number !== index + 1)) throw new Error("GENERATOR_BLUEPRINT_STAGE_SEQUENCE_INVALID");

const roleKey = (id) => ROLES[id].roleKey;
const stageKey = (stage) => `s${stage.number}_${stage.slug}`;
const stateKey = (stage) => `state_s${stage.number}_${stage.slug}_open`;
const nextStateKey = (stage) => stage.number === 7 ? "state_run_completed" : `state_s${stage.number + 1}_${BLUEPRINTS[stage.number].slug}_open`;
const actionKey = (stage, roleId, item) => `main_s${stage.number}_${roleId}_${item.slug}`;
const factKey = (stage, roleId, item) => `fact_s${stage.number}_${roleId}_${item.slug}`;
const traceKey = (stage, roleId, item) => `trace_s${stage.number}_${roleId}_${item.slug}`;
const fallbackKey = (stage, roleId) => `fallback_s${stage.number}_${roleId}_preserve_position`;
const roleAssetKey = (stage, roleId) => `asset_s${stage.number}_${roleId}_${stage.roles[roleId].asset[0]}`;
const contestAssetKey = (stage) => `asset_s${stage.number}_${stage.contestSlug}`;
const systemActionKey = (stage) => `system_s${stage.number}_${stage.system[0]}`;
const systemFactKey = (stage) => `fact_s${stage.number}_system_${stage.system[0]}`;
const systemTraceKey = (stage) => `trace_s${stage.number}_system_${stage.system[0]}`;
const requestKey = (stage) => `request_s${stage.number}_${stage.request.eventType.toLowerCase()}`;

const stages = [];
const roleStages = [];
const systemActions = [];
const policies = [];
const fallbackActions = [];
const maneuverStrategies = [];
const reactionScenarios = [];
const publicStageRules = [];
const personalStageRules = [];

for (const stage of BLUEPRINTS) {
  const sKey = stageKey(stage);
  const currentStateKey = stateKey(stage);
  const next = nextStateKey(stage);
  const facts = [];
  const traces = [];
  const assets = [
    { assetKey: contestAssetKey(stage), kind: "CONTESTED_AUTHORITY", initialOwnerRoleKey: null },
    ...ROLE_IDS.map((id) => ({ assetKey: roleAssetKey(stage, id), kind: "ROLE_LEVERAGE", initialOwnerRoleKey: roleKey(id) })),
    { assetKey: `asset_s${stage.number}_merchant_system_resource`, kind: "SYSTEM_RESOURCE", initialOwnerRoleKey: "merchant" }
  ];
  const interactionRequestKey = requestKey(stage);

  for (const roleId of ROLE_IDS) {
    const role = stage.roles[roleId];
    const cards = role.actions.map((item, actionIndex) => {
      const key = actionKey(stage, roleId, item);
      const fact = factKey(stage, roleId, item);
      const trace = traceKey(stage, roleId, item);
      facts.push({ factKey: fact, visibility: item.visibility });
      traces.push({ traceKey: trace, description: item.receipt });
      const isRequestTrigger = stage.request.source === roleId && stage.request.actionSlug === item.slug;
      return {
        actionKey: key,
        title: item.title,
        objective: item.objective,
        visibility: item.visibility,
        risk: item.risk,
        fallbackActionKey: fallbackKey(stage, roleId),
        targetRoleKey: roleKey(item.target),
        receipt: { receiptKey: `receipt_${key}`, text: item.receipt },
        effect: {
          effectKey: `effect_${key}`,
          factKeys: [fact],
          influenceEdges: [{ affectedRoleKey: roleKey(item.target), effectKey: `influence_${key}_to_${item.target}`, visibility: item.visibility }],
          observableTraceKeys: [trace],
          interactionRequestKeys: isRequestTrigger ? [interactionRequestKey] : [],
          nextStateKey: next
        },
        assetMutations: [{
          assetKey: actionIndex === 1 ? contestAssetKey(stage) : roleAssetKey(stage, roleId),
          mutationType: actionIndex === 0 ? "SET_STATE" : actionIndex === 1 ? "CLAIM" : "SPEND",
          delta: actionIndex === 1 ? 1 : actionIndex === 2 ? -1 : 0,
          toRoleKey: actionIndex === 2 ? null : roleKey(roleId)
        }]
      };
    });
    roleStages.push({ stageKey: sKey, roleKey: roleKey(roleId), privateBrief: role.brief, personalPressure: role.pressure, mainCards: cards });
    const fallback = fallbackKey(stage, roleId);
    const fallbackFact = `fact_s${stage.number}_${roleId}_fallback_preserve_position`;
    facts.push({ factKey: fallbackFact, visibility: roleId === "magistrate" ? "PRIVATE" : "OBSERVABLE" });
    fallbackActions.push({ actionKey: fallback, stageKey: sKey, roleKey: roleKey(roleId), actionSlot: "MAIN", objective: `在${stage.title}中维持${role.asset[1]}的可核验状态，不替角色交出、公开或销毁关键资源。`, factKeys: [fallbackFact], nextStateKey: next, assetMutations: [{ assetKey: roleAssetKey(stage, roleId), mutationType: "SET_STATE", delta: 0, toRoleKey: roleKey(roleId) }] });
    policies.push({
      stageKey: sKey,
      roleKey: roleKey(roleId),
      policyVersion: `${CONTENT_VERSION}:s${stage.number}:${roleId}:v1`,
      goals: [{ goalKey: `goal_s${stage.number}_${roleId}_${role.actions[0].slug}`, weight: 100 }, { goalKey: `goal_s${stage.number}_${roleId}_${role.actions[1].slug}`, weight: 80 }],
      riskProfile: ROLES[roleId].riskProfile,
      assetPriority: [roleAssetKey(stage, roleId), contestAssetKey(stage)],
      actionWeights: role.actions.map((item, index) => ({ actionKey: actionKey(stage, roleId, item), weight: [100, 80, 65][index] })),
      fallbackBySlot: { MAIN: fallback, MANEUVER: "PASS" }
    });
    maneuverStrategies.push({
      maneuverStrategyKey: `maneuver_s${stage.number}_${roleId}_${role.maneuver.slug}`,
      stageKey: sKey,
      roleKey: roleKey(roleId),
      title: role.maneuver.title,
      objective: role.maneuver.objective,
      allowedTargetRoleKeys: [roleKey(role.maneuver.target)],
      leverageAssetKeys: [roleAssetKey(stage, roleId), contestAssetKey(stage)],
      allowedTypes: role.maneuver.allowedTypes,
      fallbackActionKey: fallback
    });
    personalStageRules.push({ ruleKey: `personal_result_s${stage.number}_${roleId}`, stageKey: sKey, roleKey: roleKey(roleId), candidateFactKeys: role.actions.map((item) => factKey(stage, roleId, item)), summary: role.personalResult });
  }

  facts.push({ factKey: systemFactKey(stage), visibility: "PUBLIC" });
  traces.push({ traceKey: systemTraceKey(stage), description: stage.system[1] });
  if (stage.reaction) {
    for (const response of stage.reaction.responses) facts.push({ factKey: `fact_s${stage.number}_reaction_${response[0]}`, visibility: "LIMITED" });
    reactionScenarios.push({
      reactionKey: stage.reaction.key,
      stageKey: sKey,
      sourceRoleKey: roleKey(stage.reaction.source),
      targetRoleKey: roleKey(stage.reaction.target),
      triggerActionKey: actionKey(stage, stage.reaction.source, stage.roles[stage.reaction.source].actions.find((item) => item.slug === stage.reaction.triggerActionSlug)),
      interactionRequestKey,
      responseOptions: stage.reaction.responses.map((response) => ({ actionKey: `reaction_s${stage.number}_${stage.reaction.target}_${response[0]}`, title: response[1], factKey: `fact_s${stage.number}_reaction_${response[0]}`, nextStateKey: next })),
      fallbackResponseActionKey: `reaction_s${stage.number}_${stage.reaction.target}_${stage.reaction.fallback}`,
      passAllowed: false
    });
  }
  const allStageActionFacts = ROLE_IDS.flatMap((id) => stage.roles[id].actions.map((item) => factKey(stage, id, item)));
  stages.push({
    stageKey: sKey,
    stageNumber: stage.number,
    title: stage.title,
    playableRoleKeys: ROLE_IDS.map(roleKey),
    systemRoleKey: "merchant",
    commonContest: { contestKey: `contest_s${stage.number}_${stage.contestSlug}`, title: stage.contestTitle, assetKey: contestAssetKey(stage), description: stage.contestDescription },
    stateCatalog: [{ stateKey: currentStateKey, description: `${stage.title}行动窗口已经开启。` }, { stateKey: next, description: stage.number === 7 ? "七阶段规则与投影已经完成。" : `${BLUEPRINTS[stage.number].title}等待开启。` }],
    factCatalog: facts,
    assetCatalog: assets,
    traceCatalog: traces,
    interactionRequestCatalog: [{ requestKey: interactionRequestKey, sourceRoleKey: roleKey(stage.request.source), targetRoleKey: roleKey(stage.request.target), eventType: stage.request.eventType, defaultOutcomeKey: stage.request.defaultOutcomeKey }],
    carriedFactKeys: stage.carriedFactKeys,
    systemActionKey: systemActionKey(stage),
    nextStateKey: next,
    minimumDistinctPlayableInfluenceSources: 2
  });
  systemActions.push({ systemActionKey: systemActionKey(stage), stageKey: sKey, roleKey: "merchant", inputStateKeys: [currentStateKey], factKeys: [systemFactKey(stage)], observableTraceKeys: [systemTraceKey(stage)], visiblePressure: stage.system[1], claimable: false, controllerMode: "SYSTEM", assetMutations: [{ assetKey: `asset_s${stage.number}_merchant_system_resource`, mutationType: "SET_STATE", delta: -1, toRoleKey: "merchant" }], nextStateKey: next });
  publicStageRules.push({ ruleKey: `public_result_s${stage.number}`, stageKey: sKey, candidateFactKeys: allStageActionFacts, outcomeStateKey: next, summary: stage.publicResult });
}

const globalClassifications = [
  { endingKey: "global_reform_and_audit", title: "新政复核与责任重建", minimumScore: 38 },
  { endingKey: "global_stable_but_watched", title: "危局暂稳但京师持续监视", minimumScore: 28 },
  { endingKey: "global_progress_without_people", title: "数字完成而民生受损", minimumScore: 18 },
  { endingKey: "global_scapegoat", title: "以替罪者封住危局", minimumScore: 0 }
];
const personalTitles = {
  governor: ["统筹与纠偏被采信", "稳局有功但担责", "失察留任观察", "以失察获罪"],
  xunfu: ["执行与诚信兼得", "政绩获认可但受审计", "执行有功责任未清", "越权催办获罪"],
  magistrate: ["保民与证据链被采信", "证据有功来源受限", "地方自保获宽宥", "抗令与隐证获罪"]
};
const endingRules = {
  schemaVersion: "continuous_strategy_ending_rules_v1",
  contentVersion: CONTENT_VERSION,
  globalEndingRule: { ruleKey: "global_ending_sangtian_v1_1", metric: "PUBLIC_OR_OBSERVABLE_FACTS_PLUS_CROSS_ROLE_INFLUENCES", evidenceStageRange: [1, 6], classifications: globalClassifications },
  personalEndingRules: ROLE_IDS.map((id) => ({ ruleKey: `personal_ending_${id}_sangtian_v1_1`, roleKey: roleKey(id), metric: "SEALED_ACTIONS_PLUS_MANEUVERS_PLUS_AUTHORIZED_INFLUENCES", evidenceStageRange: [1, 6], classifications: [14, 11, 8, 0].map((minimumScore, index) => ({ endingKey: `personal_${id}_${["s", "a", "b", "c"][index]}`, title: personalTitles[id][index], minimumScore })) }))
};

const artifacts = {
  "stages.json": { schemaVersion: "continuous_strategy_stages_v1", contentVersion: CONTENT_VERSION, stages },
  "role-stage-content.json": { schemaVersion: "continuous_strategy_role_stage_content_v1", contentVersion: CONTENT_VERSION, roleStages },
  "maneuver-strategies.json": { schemaVersion: "continuous_strategy_maneuvers_v1", contentVersion: CONTENT_VERSION, maneuverStrategies },
  "reaction-scenarios.json": { schemaVersion: "continuous_strategy_reactions_v1", contentVersion: CONTENT_VERSION, reactionScenarios },
  "system-actions.json": { schemaVersion: "continuous_strategy_system_actions_v1", contentVersion: CONTENT_VERSION, systemActions },
  "agent-policies.json": { schemaVersion: "continuous_strategy_agent_policies_v1", contentVersion: CONTENT_VERSION, policies, fallbackActions },
  "result-rules.json": { schemaVersion: "continuous_strategy_result_rules_v1", contentVersion: CONTENT_VERSION, publicStageRules, personalStageRules },
  "ending-rules.json": endingRules
};
const schemaPaths = ["manifest.schema.json", "stages.schema.json", "role-stage-content.schema.json", "maneuver-strategies.schema.json", "reaction-scenarios.schema.json", "system-actions.schema.json", "agent-policies.schema.json", "result-rules.schema.json", "ending-rules.schema.json", "strategy-registry.schema.json"].map((name) => `schemas/${name}`);
const artifactStrings = Object.fromEntries(Object.entries(artifacts).map(([path, value]) => [path, json(value)]));
const manifestFiles = [
  ...Object.entries(artifactStrings).map(([path, value]) => ({ path, sha256: sha256(value) })),
  ...schemaPaths.map((path) => ({ path, sha256: sha256(readFileSync(join(outputRoot, path), "utf8")) }))
];
const manifest = { schemaVersion: "continuous_strategy_manifest_v1", contentVersion: CONTENT_VERSION, templateKey: "sangtian", releaseStatus: "published", stageCoverage: [1, 2, 3, 4, 5, 6, 7], files: manifestFiles };
const manifestString = json(manifest);
const registry = { schemaVersion: "strategy_registry_v1", defaultStrategyVersion: CONTENT_VERSION, strategies: { [CONTENT_VERSION]: { artifactDirectory: "continuous-strategy-v1.1", manifestSha256: sha256(manifestString), status: "published" } } };
const expected = { ...artifactStrings, "manifest.json": manifestString };

function writeOrCheck(path, value) {
  const absolute = join(outputRoot, path);
  if (checkOnly) {
    const actual = readFileSync(absolute, "utf8");
    if (actual !== value) throw new Error(`GENERATED_CONTENT_DRIFT:${path}`);
  } else {
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, value, "utf8");
  }
}
for (const [path, value] of Object.entries(expected)) writeOrCheck(path, value);
const registryString = json(registry);
const registryPath = join(sangtianRoot, "strategy-registry.json");
if (checkOnly) {
  if (readFileSync(registryPath, "utf8") !== registryString) throw new Error("GENERATED_CONTENT_DRIFT:strategy-registry.json");
} else writeFileSync(registryPath, registryString, "utf8");

console.log(JSON.stringify({ status: "PASS", mode: checkOnly ? "check" : "write", contentVersion: CONTENT_VERSION, stages: stages.length, roleStages: roleStages.length, mainCards: roleStages.flatMap((entry) => entry.mainCards).length, maneuvers: maneuverStrategies.length, reactions: reactionScenarios.length, systemActions: systemActions.length, policies: policies.length, publicResults: publicStageRules.length, personalResults: personalStageRules.length, globalEndings: 1, personalEndings: endingRules.personalEndingRules.length, manifestSha256: sha256(manifestString) }));
