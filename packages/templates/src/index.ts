export type StoryTemplateRole = {
  roleKey: string;
  roleName: string;
  identity: string;
  publicInfo: string;
  hiddenSecret: string;
  personalGoal: string;
  currentState: string;
  abilityText: string;
  arcText: string;
  knownInfo: string[];
  cannotDo: string[];
  isAiControlled?: boolean;
};

export type StoryTemplateNode = {
  title: string;
  publicNarration: string;
  nodeGoal: string;
  actionOptions: string[];
  resolutionSummary: string;
  nextHook: string;
};

export type StoryTemplate = {
  id: string;
  name: string;
  genre: string;
  hook: string;
  worldBase: string;
  tags: string[];
  recommendedPlayers: string;
  nodeCount: number;
  roles: StoryTemplateRole[];
  nodes: StoryTemplateNode[];
  initialClues: Array<{ clueKey: string; title: string; description: string }>;
};

const midnightRoles: StoryTemplateRole[] = [
  {
    roleKey: "lin_lu",
    roleName: "林鹿",
    identity: "夜班店员",
    publicInfo: "负责凌晨班，熟悉店内监控和仓库，但今晚一直心神不宁。",
    hiddenSecret: "你在一周前见过同一位没有影子的客人，当时监控也缺失了一分钟。",
    personalGoal: "确认没有影子的客人到底是不是活人，并保护店内其他人。",
    currentState: "紧张但清醒，手边有收银台钥匙和监控权限。",
    abilityText: "熟悉店铺动线，能快速找到监控、票据和库存异常。",
    arcText: "从逃避异常，到主动面对真相。",
    knownInfo: ["仓库门今晚曾经自动反锁", "收银系统里出现过 0 元小票"],
    cannotDo: ["直接宣布怪客身份", "独自离开整家便利店"]
  },
  {
    roleKey: "chen_zhou",
    roleName: "陈舟",
    identity: "外卖骑手",
    publicInfo: "雨夜进店避雨，声称只是等订单，却对店外巷口很熟。",
    hiddenSecret: "你今晚送过一单到不存在的门牌号，收件人备注是“不要回头”。",
    personalGoal: "弄清自己的订单和便利店异常是否有关，同时别被其他人怀疑。",
    currentState: "衣服湿透，手机电量只剩 12%。",
    abilityText: "熟悉附近街区，能判断路线、门牌和异常位置。",
    arcText: "从旁观者变成关键目击者。",
    knownInfo: ["巷口有一盏路灯只照人不照影子", "订单地址在地图上不存在"],
    cannotDo: ["凭空知道店内秘密", "强迫其他角色交出物品"]
  },
  {
    roleKey: "gu_yan",
    roleName: "顾言",
    identity: "民俗研究生",
    publicInfo: "来店里买电池和胶卷，对地方传闻很感兴趣。",
    hiddenSecret: "你正在调查“借影人”的传说，便利店是传闻中的第三个地点。",
    personalGoal: "收集足够证据证明传说真实，但不能让事件失控。",
    currentState: "冷静观察，随身带着旧相机和笔记本。",
    abilityText: "能识别民俗线索、旧符号和反常仪式痕迹。",
    arcText: "从研究真相，到承担干预后果。",
    knownInfo: ["没有影子的客人可能不是第一个", "旧相机能拍到肉眼忽略的痕迹"],
    cannotDo: ["直接封印异常", "替他人决定是否牺牲"]
  }
];

const midnightNodes: StoryTemplateNode[] = [
  {
    title: "自动门打开",
    publicNarration: "凌晨 2:17，雨水敲在玻璃门上。自动门忽然向两侧滑开，门口却没有脚步声。",
    nodeGoal: "确认自动门为何打开，以及门口是否真的有人。",
    actionOptions: ["查看监控回放", "观察门口水迹", "询问其他人看到的细节"],
    resolutionSummary: "监控在 2:16 到 2:17 之间缺失了一分钟，地上却出现一串向店内延伸的水迹。",
    nextHook: "仓库门后传来三下敲击声，像有人在里面回应你们。"
  },
  {
    title: "仓库门后的敲击",
    publicNarration: "便利店深处响起沉闷的敲门声，仓库门缝下慢慢渗出一线水光。",
    nodeGoal: "判断仓库内是否有人，以及水迹从何而来。",
    actionOptions: ["检查门缝", "呼喊仓库里的人", "寻找备用钥匙"],
    resolutionSummary: "门缝下没有影子，水迹里却浮着一张被泡软的小票，小票时间是明天凌晨。",
    nextHook: "收银机突然打印出一张 0 元小票，购买人姓名栏写着“第五个人”。"
  },
  {
    title: "0 元小票",
    publicNarration: "收银机没有被触碰，却自己吐出热乎乎的小票。屏幕上的商品名全是空白。",
    nodeGoal: "查明小票来源，并确认“第五个人”指向谁。",
    actionOptions: ["比对收银记录", "拍下小票", "观察其他角色反应"],
    resolutionSummary: "小票二维码扫出一段店内货架画面，画面里你们身后站着一个没有影子的人。",
    nextHook: "旧相机闪光后，冷柜玻璃上映出并不存在的第五张脸。"
  },
  {
    title: "冷柜里的第五张脸",
    publicNarration: "冷柜压缩机停止运转，玻璃蒙上白雾，一张陌生的脸从雾气里慢慢贴近。",
    nodeGoal: "弄清第五张脸想传达什么，同时保护自己的秘密不被异常利用。",
    actionOptions: ["擦开冷柜雾气", "用相机拍照", "交换彼此掌握的线索"],
    resolutionSummary: "照片里出现一行反写文字：不要让它借走你们的影子。危险等级上升。",
    nextHook: "便利店灯光全部熄灭，只剩门外路灯照出四个人和第五道影子。"
  },
  {
    title: "第五道影子",
    publicNarration: "灯灭之后，所有声音都被雨吞掉。门外路灯下，多出来的影子正慢慢走向货架尽头。",
    nodeGoal: "决定如何面对第五道影子，并为本章收束真相。",
    actionOptions: ["合力逼近影子", "保护关键证据", "用各自秘密换取线索"],
    resolutionSummary: "你们没有抓住客人，却保住了影子和证据。第五个人留下下一章地址：北巷 24 号。",
    nextHook: "下一章《第五个人》将在北巷 24 号继续。"
  }
];

export const midnightStoreTemplate: StoryTemplate = {
  id: "template_midnight_store_001",
  name: "午夜便利店",
  genre: "都市悬疑",
  hook: "凌晨 2:17，便利店自动门自己打开，一位没有影子的客人走了进来。",
  worldBase: "城市边缘的 24 小时便利店，雨夜、监控盲区、消失的影子和一张不该存在的小票共同构成第一章沙盒。",
  tags: ["悬疑", "新手推荐", "3-5 人"],
  recommendedPlayers: "1-3 人",
  nodeCount: 5,
  roles: midnightRoles,
  nodes: midnightNodes,
  initialClues: [{ clueKey: "missing_minute", title: "缺失的一分钟", description: "便利店监控在凌晨 2:16 到 2:17 之间出现空白。" }]
};

export const qingyunSectTemplate: StoryTemplate = {
  id: "template_qingyun_sect_001",
  name: "青云宗门",
  genre: "东方玄幻",
  hook: "宗门试炼夜，祖师堂的魂灯同时熄灭三盏，禁地石阶上多出一枚带血剑穗。",
  worldBase: "青云山门、祖师堂、禁地石阶、失踪弟子与被封印的旧誓构成第一章。",
  tags: ["玄幻", "宗门", "协作调查"],
  recommendedPlayers: "2-5 人",
  nodeCount: 5,
  roles: [
    {
      roleKey: "shen_qinghe",
      roleName: "沈青鹤",
      identity: "戒律堂首徒",
      publicInfo: "负责维持试炼秩序，向来按宗规行事。",
      hiddenSecret: "你曾私自放失踪弟子进入禁地外围。",
      personalGoal: "查明魂灯熄灭原因，同时避免宗门把全部责任推给无辜弟子。",
      currentState: "佩剑未出鞘，掌心仍有禁地寒气。",
      abilityText: "熟悉宗规、巡山路线与弟子令牌记录。",
      arcText: "从维护规则，到判断规则是否掩盖真相。",
      knownInfo: ["禁地石阶只会记录活人的脚步", "剑穗属于外门弟子陆知微"],
      cannotDo: ["直接判定同门有罪", "以宗规命令其他玩家交代秘密"]
    },
    {
      roleKey: "lu_zhiwei",
      roleName: "陆知微",
      identity: "外门药修",
      publicInfo: "常替试炼弟子疗伤，今晚最后见过失踪的人。",
      hiddenSecret: "你的药囊里藏着一片祖师堂禁药叶。",
      personalGoal: "救回失踪弟子，并证明禁药叶不是你偷来的。",
      currentState: "灵力不足，但能辨认血迹和药香。",
      abilityText: "能通过药香、脉象和草木变化追踪异常。",
      arcText: "从自保，到愿意公开关键线索。",
      knownInfo: ["魂灯熄灭前有药香飘过", "禁药叶会吸附誓言残响"],
      cannotDo: ["凭空治好所有伤势", "替他人承认偷药"]
    },
    {
      roleKey: "yan_wuchen",
      roleName: "燕无尘",
      identity: "藏书阁看守",
      publicInfo: "年纪轻却掌管旧卷，知道许多宗门旧事。",
      hiddenSecret: "你发现祖师旧誓曾被掌门一脉改写。",
      personalGoal: "确认旧誓真相，并决定是否让宗门知道。",
      currentState: "袖中藏着半页焚毁的誓书。",
      abilityText: "能解读旧符、誓书和封印文字。",
      arcText: "从旁证记录者，到真相的承担者。",
      knownInfo: ["三盏魂灯对应三段旧誓", "禁地封印需要同门共同验证"],
      cannotDo: ["立刻解除封印", "操控他人立誓"]
    }
  ],
  nodes: [
    { title: "魂灯三灭", publicNarration: "试炼钟声未落，祖师堂三盏魂灯一齐熄灭，堂前石阶浮出潮湿脚印。", nodeGoal: "确认魂灯熄灭与失踪弟子是否有关。", actionOptions: ["检查魂灯灯芯", "追踪石阶脚印", "询问守夜弟子"], resolutionSummary: "灯芯没有烧尽，反而像被某段誓言从内部吞掉，脚印停在禁地门前。", nextHook: "禁地门环上出现陆知微药囊的药香。" },
    { title: "禁地药香", publicNarration: "禁地门缝透出冷白雾气，药香混着血腥味沿石阶上浮。", nodeGoal: "判断药香来源并保护可能的证据。", actionOptions: ["辨认药香", "检查门环", "比对巡山记录"], resolutionSummary: "药香确来自禁药叶，但门环上还刻着被改写的戒律符。", nextHook: "藏书阁旧卷突然自燃，灰烬拼出“旧誓未完”。" },
    { title: "旧卷自燃", publicNarration: "藏书阁里一卷祖师手札无火自燃，灰烬却没有散去。", nodeGoal: "保住旧卷线索并确认誓言被谁改写。", actionOptions: ["收集灰烬", "解读残符", "核对掌门印记"], resolutionSummary: "残符显示三盏魂灯不是死亡预兆，而是在提醒旧誓被替换。", nextHook: "山门外传回失踪弟子的传音：不要相信今夜的钟声。" },
    { title: "失踪传音", publicNarration: "传音符在雨雾中亮起，失踪弟子的声音断续传来。", nodeGoal: "确认传音真假并避免被假消息带偏。", actionOptions: ["验证声纹", "追问细节", "布置护身符阵"], resolutionSummary: "传音是真的，但对方被困在宗门钟声的回响里，危险等级上升。", nextHook: "戒律钟自己敲响第五声，禁地石阶向山腹打开。" },
    { title: "第五声钟", publicNarration: "没有人撞钟，戒律钟却敲出第五声，山腹露出旧誓碑。", nodeGoal: "决定是否公开旧誓，并救回被困弟子。", actionOptions: ["合力验证旧誓", "保护失踪弟子", "记录掌门印记"], resolutionSummary: "你们救回弟子并留下旧誓证据，但真正改写誓书的人仍在高处注视。", nextHook: "下一章《掌门印》将从旧誓碑后的暗门开始。" }
  ],
  initialClues: [{ clueKey: "soul_lamps_out", title: "三盏魂灯", description: "三盏魂灯同灭，但灯芯没有自然燃尽。" }]
};

export const wildVillageTemplate: StoryTemplate = {
  id: "template_wild_village_001",
  name: "穿越荒村",
  genre: "生存悬疑",
  hook: "你们醒在荒村祠堂，墙上的族谱多出了自己的名字，村外断桥在雾中消失。",
  worldBase: "荒村、祠堂、断桥、族谱和无法离开的夜构成第一章。",
  tags: ["生存", "荒村", "穿越"],
  recommendedPlayers: "1-4 人",
  nodeCount: 5,
  roles: [
    {
      roleKey: "xu_an",
      roleName: "许安",
      identity: "城市急救员",
      publicInfo: "最先醒来并检查众人伤势，习惯先保证安全。",
      hiddenSecret: "你的急救包里多出一枚写着自己名字的木牌。",
      personalGoal: "保护同伴活过这一夜，并弄清木牌为何指向自己。",
      currentState: "手电电量有限，急救包完整但药品数量异常。",
      abilityText: "擅长急救、风险判断和临时避险。",
      arcText: "从理性求生，到面对不合理的命运交换。",
      knownInfo: ["族谱上的名字会随行动变深", "祠堂门槛内侧有新鲜刮痕"],
      cannotDo: ["直接治愈致命伤", "命令所有人牺牲自己"]
    },
    {
      roleKey: "mei_ran",
      roleName: "梅冉",
      identity: "民俗播客主播",
      publicInfo: "对荒村传说有准备，随身录音笔一直亮着。",
      hiddenSecret: "你收到过匿名投稿，地图终点正是这座荒村。",
      personalGoal: "确认投稿人的身份，并判断自己是否被引到这里。",
      currentState: "录音笔能录到人耳听不见的低语。",
      abilityText: "熟悉民俗禁忌、口述传说和声音线索。",
      arcText: "从猎奇记录者，到故事中的当事人。",
      knownInfo: ["荒村忌讳在午夜点名", "录音里有第四个人的呼吸"],
      cannotDo: ["凭空知道全部村史", "代替其他角色说出名字"]
    },
    {
      roleKey: "he_qiao",
      roleName: "何桥",
      identity: "失业程序员",
      publicInfo: "带着笔记本电脑，试图用离线地图找出口。",
      hiddenSecret: "你手机里有一张未来时间拍摄的断桥照片。",
      personalGoal: "证明这不是幻觉，并找到能离开的路径。",
      currentState: "电脑只剩 9% 电量，离线地图不断重写路线。",
      abilityText: "擅长比对地图、时间戳和异常数据。",
      arcText: "从寻找技术解释，到接受自己也在规则中。",
      knownInfo: ["断桥照片的拍摄者账号是自己", "祠堂 Wi-Fi 名称会变化"],
      cannotDo: ["黑进不存在的系统", "宣布已经找到唯一出口"]
    }
  ],
  nodes: [
    { title: "族谱添名", publicNarration: "祠堂烛火摇晃，族谱末页的墨迹未干，写着你们的名字。", nodeGoal: "确认族谱为何出现你们的名字。", actionOptions: ["检查族谱纸张", "查看祠堂门槛", "互相确认醒来前记忆"], resolutionSummary: "族谱墨迹会回应你们的触碰，名字旁出现一个倒计时到天亮的刻痕。", nextHook: "祠堂外传来敲锣声，村路尽头亮起一盏白灯笼。" },
    { title: "白灯笼引路", publicNarration: "白灯笼悬在无人屋檐下，灯面写着“归”。", nodeGoal: "判断灯笼是否能指向出口或陷阱。", actionOptions: ["观察灯笼", "记录村路", "用录音笔收声"], resolutionSummary: "灯笼每走一步就后退一步，却把你们引到断桥前的旧井旁。", nextHook: "井水里浮出一张未来拍摄的断桥照片。" },
    { title: "井中照片", publicNarration: "旧井无风起浪，照片从水面翻出，背后写着“别回桥上”。", nodeGoal: "确认照片来源并决定是否靠近断桥。", actionOptions: ["比对时间戳", "检查井绳", "标记回祠堂路线"], resolutionSummary: "照片时间来自一小时后，画面里的你们少了一个影子。", nextHook: "祠堂钟声提前响起，族谱上的名字开始渗血。" },
    { title: "名字渗血", publicNarration: "族谱被风翻开，你们的名字一笔一画变红。", nodeGoal: "阻止族谱继续变化并保护个人秘密。", actionOptions: ["压住族谱", "寻找墨源", "交换手中线索"], resolutionSummary: "血色来自木牌而非人体，木牌似乎在替村子选择留下的人。危险等级上升。", nextHook: "断桥方向传来脚步声，像有另一个你们正在走回来。" },
    { title: "另一个归来", publicNarration: "雾中出现与你们相似的身影，正从断桥另一端走向村口。", nodeGoal: "决定面对另一个自己，并为本章找到暂时出口。", actionOptions: ["确认身份", "守住木牌", "合力寻找桥下路"], resolutionSummary: "你们没有离开荒村，却找到桥下暗路和匿名投稿人的旧录音。", nextHook: "下一章《桥下路》将揭开第一个回到村里的人是谁。" }
  ],
  initialClues: [{ clueKey: "genealogy_names", title: "族谱新名", description: "荒村族谱末页新增了玩家姓名，墨迹未干。" }]
};

const sangtianRoles: StoryTemplateRole[] = [
  {
    roleKey: "zhejiang_governor", roleName: "浙江总督", identity: "统筹浙江军政的封疆大吏", publicInfo: "你必须在皇权、财政、民心与海防之间稳住全局。", hiddenSecret: "你掌握一条尚未公开的田契暗账线索。", personalGoal: "稳住浙江并避免皇帝认定你欺瞒。", currentState: "粮价不稳，巡抚越级，京师催报。", abilityText: "可调度总督衙门、密奏与赈济资源。", arcText: "从维持局势到承担裁决。", knownInfo: ["改桑时限", "县令密信渠道"], cannotDo: ["越过朝廷直接改写国策"], isAiControlled: false
  },
  {
    roleKey: "xunfu", roleName: "浙江巡抚", identity: "督办改桑新政的地方大员", publicInfo: "你要尽快交出政绩，但也不能让暗账反噬。", hiddenSecret: "你的幕僚与商会有一笔未入册的往来。", personalGoal: "推进新政并抢在总督之前坐实功劳。", currentState: "改桑阻力上升，地方催缴失控。", abilityText: "可调动执行官吏与上报渠道。", arcText: "从争功到面对代价。", knownInfo: ["改桑名册", "内阁财政派联络"], cannotDo: ["替县令销毁证据"], isAiControlled: false
  },
  {
    roleKey: "county_magistrate", roleName: "清流县令", identity: "直接面对百姓的地方官", publicInfo: "你既不能抗旨，也不能坐视民田和粮田被吞没。", hiddenSecret: "你留有半页田契副本，足以牵动多人。", personalGoal: "保护民田并补全暗账证据。", currentState: "乡里恐慌，征收与粮价同时压来。", abilityText: "可收集民情、田契与县衙文书。", arcText: "从自保到公开证据。", knownInfo: ["民田风险清单", "田契副本"], cannotDo: ["强迫百姓承担国策代价"], isAiControlled: false
  },
  {
    roleKey: "merchant", roleName: "江南商会", identity: "掌握粮仓、丝路和垫银能力的商会", publicInfo: "谁能保护商路，商会就向谁下注。", hiddenSecret: "商会账簿记录了与官员的往来。", personalGoal: "维持商路并避免成为替罪羊。", currentState: "粮价和银路都在失控边缘。", abilityText: "可平粮、筹银与交换消息。", arcText: "从观望到选边。", knownInfo: ["商路库存"], cannotDo: ["决定官员任免"], isAiControlled: true
  }
];

const sangtianNodes: StoryTemplateNode[] = [
  ["改桑急令", "改桑期限压下，巡抚与县令的执行方案正面冲突。", "确认执行边界并留存复核证据。", "田契与限期将同时约束三方。"],
  ["县令密信", "一封县令密信指向地方催收与田契副本。", "决定证据由谁保管、如何核验。", "密信牵出粮价与商会。"],
  ["粮价失控", "杭州粮价上涨，商会被怀疑囤积居奇。", "平粮、追责或公开数据。", "暗账原件浮出水面。"],
  ["暗账浮出", "暗账副本与原件的去向成为新的冲突。", "建立可追溯的证据链。", "弹劾和灭证风险逼近。"],
  ["相互弹劾", "三份互相矛盾的奏报送往京师。", "以事实或指控争取先机。", "京师要求最终奏报。"],
  ["京师回批", "御前要求在限定时间内呈交可核验的结果。", "整合粮价、田契和执行证据。", "御前裁决开始。"],
  ["御前裁决", "每个人都必须为七日选择承担后果。", "提交最终陈述。", "全局结局与个人结局被写入史册。"]
].map(([title, narration, goal, hook]) => ({ title, publicNarration: narration, nodeGoal: goal, actionOptions: ["保留证据并交叉核验", "推进本职方案并说明代价", "协调另一位角色的资源"], resolutionSummary: `${title}后的选择改变了三方的信任、资源与下一轮压力。`, nextHook: hook }));

export const sangtianTemplate: StoryTemplate = {
  id: "template_sangtian_001", name: "桑田诏：嘉靖财政危局", genre: "历史权谋", hook: "嘉靖朝财政危局中，七日内的每一次选择都会改写浙江与三位官员的命运。", worldBase: "嘉靖年间的浙江，改桑、粮价、田契、暗账与京师裁决同时迫近。", tags: ["历史", "权谋", "多人"], recommendedPlayers: "1-3 人", nodeCount: 7, roles: sangtianRoles, nodes: sangtianNodes, initialClues: [{ clueKey: "sangtian_edict", title: "改桑急令", description: "朝廷限期催办改桑，地方执行已出现裂缝。" }]
};

const caesarRoles: StoryTemplateRole[] = [
  ["brutus", "Brutus", "A senator torn between friendship and the Republic.", "You serve Rome, not any man.", "You have seen Caesar's private pledge.", "Prevent an unrestrained dictatorship.", "The Senate is divided.", "Build coalitions and set boundaries.", "From restraint to authorship.", ["Senate votes", "Caesar's trust"], ["Command the legions"], false],
  ["caesar", "Caesar", "Victor of Rome and the center of every alliance.", "I came, I saw, I changed Rome.", "Your enemies know your calendar.", "Preserve Rome without becoming its master.", "Triumph has made every promise costly.", "Call allies and make public commitments.", "From power to limits.", ["Legion loyalty", "popular support"], ["Know conspirators' private plans"], false],
  ["cassius", "Cassius", "A senator who calls fear by its true name.", "Liberty isn't given. It's taken.", "Your strongest ally doubts violence.", "Keep the Republic from submission.", "The conspiracy lacks a public mandate.", "Expose danger and recruit support.", "From anger to consequence.", ["Senate anxiety"], ["Force another player to betray"], false],
  ["mark_antony", "Mark Antony", "Caesar's ally and Rome's most dangerous speaker.", "I speak for Rome. And I remember.", "You can calm crowds or inflame them.", "Keep Rome from civil war.", "The Forum is waiting.", "Mobilize popular support.", "From loyalty to responsibility.", ["Forum mood"], ["Read sealed Senate letters"], true],
  ["decimus", "Decimus", "A commander trusted by both camps.", "I watch. I learn. I will decide.", "You know the roads to the Capitol.", "Avoid a point of no return.", "Every route can become a trap.", "Control timing and access.", "From observer to decision maker.", ["Capitol routes"], ["Guarantee any outcome"], true],
  ["cicero", "Cicero", "An orator whose words can still change the vote.", "Words are my sharpest weapon.", "You hold drafts of a compromise.", "Keep institutions alive.", "The Senate needs language for restraint.", "Draft terms and rally senators.", "From witness to architect.", ["Compromise draft"], ["Command soldiers"], true]
].map(([roleKey, roleName, identity, publicInfo, hiddenSecret, personalGoal, currentState, abilityText, arcText, knownInfo, cannotDo, isAiControlled]): StoryTemplateRole => ({ roleKey: String(roleKey), roleName: String(roleName), identity: String(identity), publicInfo: String(publicInfo), hiddenSecret: String(hiddenSecret), personalGoal: String(personalGoal), currentState: String(currentState), abilityText: String(abilityText), arcText: String(arcText), knownInfo: knownInfo as string[], cannotDo: cannotDo as string[], isAiControlled: Boolean(isAiControlled) }));

const caesarNodes: StoryTemplateNode[] = [
  ["The Crown Refused", "Rome waits to see whether Caesar's victory becomes a crown.", "Set the first boundary on power.", "The Senate calls an emergency session."],
  ["A Senate Divided", "Every ally asks what the new order will cost.", "Build a coalition without forcing submission.", "A private warning reaches the Forum."],
  ["The Ides Approach", "Rumors multiply and every invitation becomes evidence.", "Separate fear from proof.", "The roads to the Capitol close."],
  ["Terms of Restraint", "A compromise can preserve both dignity and law.", "Negotiate terms that can survive public scrutiny.", "The crowd gathers outside the Senate."],
  ["The Forum Speaks", "A single speech may prevent panic or trigger it.", "Keep the Forum from violence.", "A final vote is called."],
  ["The Final Vote", "The Republic must choose its limits in public.", "Secure a legitimate decision.", "Rome awaits its verdict."],
  ["A Republic Without a Master", "The surviving terms will define Rome's next spring.", "Accept the consequences of every alliance.", "The session's final history is written."]
].map(([title, narration, goal, hook]) => ({ title, publicNarration: narration, nodeGoal: goal, actionOptions: ["Seek a public compromise", "Protect a private ally", "Make a principled appeal"], resolutionSummary: `${title} changes the balance between power, liberty, and public trust.`, nextHook: hook }));

export const caesarTemplate: StoryTemplate = {
  id: "template_caesar_001", name: "Caesar: The Last Spring of the Republic", genre: "Alternate History", hook: "In the final days of the Republic, every alliance and restraint writes a different Rome.", worldBase: "Rome, 44 BC: Caesar, the Senate, and the Forum approach a decision no one can escape.", tags: ["History", "Power", "Alternate History"], recommendedPlayers: "1-6 players", nodeCount: 7, roles: caesarRoles, nodes: caesarNodes, initialClues: [{ clueKey: "caesar_crown", title: "The refused crown", description: "A public gesture has not ended private fear." }]
};

export const templates = [midnightStoreTemplate, qingyunSectTemplate, wildVillageTemplate, sangtianTemplate, caesarTemplate];

export function getTemplate(templateId: string): StoryTemplate {
  const template = templates.find((item) => item.id === templateId);
  if (!template) throw new Error(`Unknown template: ${templateId}`);
  return template;
}
