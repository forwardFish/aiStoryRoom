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

export const midnightStoreTemplate: StoryTemplate = {
  id: "template_midnight_store_001",
  name: "午夜便利店",
  genre: "都市悬疑",
  hook: "凌晨 2:17，便利店自动门自己打开，一位没有影子的客人走了进来。",
  worldBase:
    "城市边缘的 24 小时便利店，雨夜、监控盲区、消失的影子和一张不该存在的小票共同构成第一章沙盒。",
  tags: ["悬疑", "新手推荐", "3-5 人"],
  recommendedPlayers: "1-3 人",
  nodeCount: 5,
  roles: [
    {
      roleKey: "lin_lu",
      roleName: "林鹿",
      identity: "夜班店员",
      publicInfo: "负责凌晨班，熟悉店内监控和仓库，但今晚一直心神不宁。",
      hiddenSecret: "你在一周前见过同一个客人，当时监控也缺失了一分钟。",
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
      personalGoal: "弄清自己订单和便利店异常是否有关，同时别被其他人怀疑。",
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
  ],
  nodes: [
    {
      title: "自动门打开",
      publicNarration: "凌晨 2:17，雨水敲在玻璃门上。自动门忽然向两侧滑开，门口却没有脚步声。",
      nodeGoal: "确认自动门为何打开，以及门口是否真的有人。",
      actionOptions: ["查看监控回放", "观察门口水迹", "询问其他人看到什么"],
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
  ],
  initialClues: [
    {
      clueKey: "missing_minute",
      title: "缺失的一分钟",
      description: "便利店监控在凌晨 2:16 到 2:17 之间出现空白。"
    }
  ]
};

export const qingyunSectTemplate: StoryTemplate = {
  id: "template_qingyun_sect_001",
  name: "青云宗门",
  genre: "东方玄幻",
  hook: "宗门试炼夜，祖师堂的魂灯同时熄灭三盏。",
  worldBase: "云雾山门、禁地石阶、失踪弟子和被封印的旧誓。",
  tags: ["玄幻", "协作", "调查"],
  recommendedPlayers: "2-5 人",
  nodeCount: 5,
  roles: [],
  nodes: [],
  initialClues: []
};

export const wildVillageTemplate: StoryTemplate = {
  id: "template_wild_village_001",
  name: "穿越荒村",
  genre: "生存悬疑",
  hook: "你们醒在荒村祠堂，墙上的族谱多出了自己的名字。",
  worldBase: "荒村、断桥、祠堂、族谱和无法离开的夜。",
  tags: ["生存", "荒村", "悬疑"],
  recommendedPlayers: "1-4 人",
  nodeCount: 5,
  roles: [],
  nodes: [],
  initialClues: []
};

export const templates = [midnightStoreTemplate, qingyunSectTemplate, wildVillageTemplate];

export function getTemplate(templateId: string): StoryTemplate {
  const template = templates.find((item) => item.id === templateId);
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`);
  }
  return template;
}
