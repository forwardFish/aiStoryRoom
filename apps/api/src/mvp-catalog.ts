import { BadRequestException, NotFoundException } from "@nestjs/common";
import { getGameDefinition } from "@ai-story/templates";

export interface MvpRoleCatalogItem {
  key: string;
  name: string;
  identity: string;
  tagline: string;
  portrait: string;
  playable: boolean;
  publicGoal: string;
  fateQuestion: string;
  rank: string;
  office: string;
  goals: string[];
  resources: Array<[string, string]>;
  leverage: string[];
  traits: Array<{ icon: string; label: string }>;
}

interface MvpStoryCard {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  cover: string;
  players: string;
  heat: number;
  tags: string[];
  badge?: string;
  status: "playable" | "preview";
}

const STORY_CARDS: MvpStoryCard[] = [
  {
    id: "sangtian",
    title: "嘉靖财政危局",
    subtitle: "7天动态权谋故事局",
    category: "权谋历史",
    cover: "/assets/stories/story-sangtian.webp",
    players: "1人 MVP / 未来5-10人",
    heat: 28941,
    tags: ["权谋斗争", "历史还原", "多结局"],
    badge: "本周首发",
    status: "playable"
  },
  {
    id: "promotion-list",
    title: "晋升名单公布前",
    subtitle: "职场权力博弈故事局",
    category: "都市职场",
    cover: "/assets/stories/story-promotion.webp",
    players: "5-8人",
    heat: 16873,
    tags: ["职场", "博弈"],
    status: "preview"
  },
  {
    id: "heir-night",
    title: "豪门继承夜",
    subtitle: "一场财产引发的家族暗战",
    category: "权谋历史",
    cover: "/assets/stories/story-heir.webp",
    players: "6-9人",
    heat: 12346,
    tags: ["家族", "继承"],
    status: "preview"
  },
  {
    id: "cultivation",
    title: "凡人修仙局",
    subtitle: "从凡人到仙途的逆袭之旅",
    category: "奇幻冒险",
    cover: "/assets/stories/story-cultivation.webp",
    players: "4-6人",
    heat: 19872,
    tags: ["宗门", "成长"],
    status: "preview"
  },
  {
    id: "missing-seven",
    title: "消失的第七人",
    subtitle: "迷雾重重，真相难觅",
    category: "悬疑推理",
    cover: "/assets/stories/story-missing.webp",
    players: "5-8人",
    heat: 9215,
    tags: ["密室", "推理"],
    status: "preview"
  },
  {
    id: "rain-night",
    title: "长安雨夜客",
    subtitle: "江湖恩怨，暗流涌动",
    category: "权谋历史",
    cover: "/assets/stories/story-rain-night.webp",
    players: "5-8人",
    heat: 8754,
    tags: ["江湖", "权谋"],
    status: "preview"
  },
  {
    id: "ten-year-pact",
    title: "十年之约",
    subtitle: "跨越时空的遗憾与重逢",
    category: "科幻未来",
    cover: "/assets/stories/story-ten-years.webp",
    players: "3-5人",
    heat: 7531,
    tags: ["时间", "情感"],
    status: "preview"
  },
  {
    id: "starship-dawn",
    title: "星舰黎明号",
    subtitle: "探索未知，寻找家园",
    category: "科幻未来",
    cover: "/assets/stories/story-starship.webp",
    players: "5-8人",
    heat: 10022,
    tags: ["星际", "生存"],
    status: "preview"
  }
];

export const SANGTIAN_ROLES: MvpRoleCatalogItem[] = [
  {
    key: "zhejiang_governor",
    name: "浙江总督",
    identity: "总督浙江军政，必须在皇权、财政、民心与海防之间稳住全局。",
    tagline: "统筹全局",
    portrait: "/assets/roles/zhejiang-governor.webp",
    playable: true,
    publicGoal: "稳定浙江、配合改桑、避免民乱与海防失饷。",
    fateQuestion: "你是在保浙江，还是在保自己的官位？",
    rank: "封疆大吏",
    office: "总督浙江军政",
    goals: ["稳定浙江局势", "不让巡抚坐大", "避免皇帝认定自己欺瞒"],
    resources: [["银两", "42万两"], ["粮草", "23万石"], ["兵丁", "4/5"], ["幕僚", "4人"], ["密报", "2条"]],
    leverage: ["总督节制权", "县令密信渠道", "向御前密奏的资格"],
    traits: [{ icon: "strategy", label: "统筹全局" }, { icon: "power", label: "高权力" }, { icon: "risk", label: "中风险" }]
  },
  {
    key: "xunfu",
    name: "浙江巡抚",
    identity: "负责实际推进改桑，表面奉诏急办，真实目标是抢在总督之前坐实政绩。",
    tagline: "争功晋进",
    portrait: "/assets/roles/zhejiang-xunfu.webp",
    playable: false,
    publicGoal: "推进改桑，尽快向朝廷见银。",
    fateQuestion: "你是国策执行者，还是掠夺江南的刀？",
    rank: "巡抚",
    office: "督办改桑新政",
    goals: ["抢先报功", "避免暗账暴露", "借新政进入京师"],
    resources: [["名册", "三县"], ["幕僚", "6人"], ["内阁门路", "1条"]],
    leverage: ["改桑执行权", "内阁财政派联络", "地方胥吏网络"],
    traits: [{ icon: "reputation", label: "晋升强" }, { icon: "power", label: "中权力" }, { icon: "risk", label: "高风险" }]
  },
  {
    key: "county_magistrate",
    name: "清流县令",
    identity: "直接面对百姓的地方官，既不能抗旨，也不能眼看田契与粮田被吞。",
    tagline: "清流查账",
    portrait: "/assets/roles/county-magistrate.webp",
    playable: false,
    publicGoal: "依法执行国策，同时保护百姓不被夺田。",
    fateQuestion: "当忠于朝廷和忠于百姓冲突时，你选谁？",
    rank: "县令",
    office: "嘉兴地方官",
    goals: ["保护民田", "补全暗账", "避免成为替罪羊"],
    resources: [["田契副本", "半页"], ["书吏", "2人"], ["民情", "密报"]],
    leverage: ["百姓口碑", "田契证据", "清流名声"],
    traits: [{ icon: "evidence", label: "证据强" }, { icon: "reputation", label: "清名高" }, { icon: "risk", label: "高风险" }]
  },
  {
    key: "merchant",
    name: "江南商会",
    identity: "掌握粮仓、丝路和垫银能力，谁能保护商会，商会就向谁下注。",
    tagline: "逐利观望",
    portrait: "/assets/roles/jiangnan-merchant.webp",
    playable: false,
    publicGoal: "出银助国策，维持江南商路。",
    fateQuestion: "你是财政的救命钱袋，还是百姓的吸血者？",
    rank: "商会会首",
    office: "江南粮丝商路",
    goals: ["用垫银换保护", "控制桑田与丝路", "避免成为替罪羊"],
    resources: [["粮仓", "三成可放"], ["银票", "充足"], ["商路", "江南"]],
    leverage: ["平粮能力", "官员借据", "织造局通道"],
    traits: [{ icon: "wealth", label: "资源多" }, { icon: "insight", label: "观望强" }, { icon: "risk", label: "中风险" }]
  },
  {
    key: "sili_jian",
    name: "司礼监织造使",
    identity: "代表内廷巡视江南银路，真正关心的是谁能绕开内阁把银子送进宫。",
    tagline: "暗中监视",
    portrait: "/assets/roles/sili-jian.webp",
    playable: false,
    publicGoal: "确保丝源、贡品和银两进入内廷。",
    fateQuestion: "你是在替皇帝查银路，还是借银路控制江南？",
    rank: "织造使",
    office: "司礼监江南耳目",
    goals: ["控制银路", "利用督抚冲突", "防止地方坐大"],
    resources: [["内廷密报", "直达"], ["织造局", "可调"], ["耳目", "多处"]],
    leverage: ["皇帝近侍身份", "织造银路", "商会求护"],
    traits: [{ icon: "insight", label: "情报强" }, { icon: "power", label: "隐权力" }, { icon: "risk", label: "中风险" }]
  }
];

const SANGTIAN_GAME = getGameDefinition("sangtian");
const SANGTIAN_DETAIL = {
  id: SANGTIAN_GAME.worldId,
  title: SANGTIAN_GAME.catalog.title,
  displayTitle: SANGTIAN_GAME.catalog.title,
  description: SANGTIAN_GAME.catalog.description,
  subtitle: SANGTIAN_GAME.catalog.subtitle,
  category: SANGTIAN_GAME.catalog.genre,
  heroCover: SANGTIAN_GAME.catalog.heroCover,
  roleSelectionBanner: SANGTIAN_GAME.presentation.sceneBackground,
  totalDays: SANGTIAN_GAME.engine.fixedRules?.stageCount || 7,
  modeLabel: SANGTIAN_GAME.modes.multiplayer ? "单人 / 多人" : "单人",
  durationLabel: SANGTIAN_GAME.catalog.durationLabel,
  tags: SANGTIAN_GAME.catalog.tags,
  roles: registryRoles("sangtian", SANGTIAN_ROLES)
};

const CAESAR_ROLES: MvpRoleCatalogItem[] = [
  ["brutus", "Brutus", "A senator torn between friendship and the Republic.", "I serve Rome, not any man.", "Prevent an unrestrained dictatorship."],
  ["caesar", "Caesar", "Victor of Rome and the center of every alliance.", "I came, I saw, I changed Rome.", "Preserve Rome without becoming its master."],
  ["cassius", "Cassius", "A senator who calls fear by its true name.", "Liberty isn't given. It's taken.", "Keep the Republic from submission."],
  ["mark_antony", "Mark Antony", "Caesar's ally and Rome's most dangerous speaker.", "I speak for Rome. And I remember.", "Keep Rome from civil war."],
  ["decimus", "Decimus", "A commander trusted by both camps.", "I watch. I learn. I will decide.", "Avoid a point of no return."],
  ["cicero", "Cicero", "An orator whose words can still change the vote.", "Words are my sharpest weapon.", "Keep institutions alive."]
].map(([key, name, identity, tagline, goal], index) => ({
  key, name, identity, tagline, portrait: `/assets/portrait/${index + 1}.png`, playable: key === "brutus", publicGoal: goal,
  fateQuestion: "What must Rome become after this choice?", rank: "Roman Republic", office: "Rome, 44 BC", goals: [goal],
  resources: [["Influence", "Senate"], ["Time", "Seven scenes"]], leverage: ["Public argument", "Private alliance"],
  traits: [{ icon: "strategy", label: "Political judgment" }, { icon: "risk", label: "High stakes" }]
}));

const CAESAR_GAME = getGameDefinition("caesar");
const CAESAR_DETAIL = {
  id: CAESAR_GAME.worldId, title: CAESAR_GAME.catalog.title, displayTitle: CAESAR_GAME.catalog.title,
  description: CAESAR_GAME.catalog.description, subtitle: CAESAR_GAME.catalog.subtitle,
  category: CAESAR_GAME.catalog.genre, heroCover: CAESAR_GAME.catalog.heroCover, roleSelectionBanner: CAESAR_GAME.presentation.sceneBackground, totalDays: CAESAR_GAME.engine.fixedRules?.stageCount || 7, modeLabel: "Solo / Multiplayer", durationLabel: CAESAR_GAME.catalog.durationLabel,
  tags: CAESAR_GAME.catalog.tags, roles: registryRoles("caesar", CAESAR_ROLES)
};

function registryRoles(worldId: string, legacyRoles: MvpRoleCatalogItem[]): MvpRoleCatalogItem[] {
  const game = getGameDefinition(worldId);
  return game.roles.map((definition) => {
    const legacy = legacyRoles.find((role) => role.key === definition.roleKey);
    return {
      key: definition.roleKey,
      name: definition.roleName,
      identity: definition.identity,
      tagline: definition.publicInfo,
      portrait: definition.portrait,
      playable: true,
      publicGoal: definition.personalGoal,
      fateQuestion: legacy?.fateQuestion || definition.arcText,
      rank: legacy?.rank || game.catalog.genre,
      office: legacy?.office || game.presentation.locationLabel,
      goals: legacy?.goals || [definition.personalGoal],
      resources: legacy?.resources || definition.knownInfo.map((value) => [value, "Known"] as [string, string]),
      leverage: legacy?.leverage || [definition.abilityText],
      traits: legacy?.traits || [{ icon: "strategy", label: definition.arcText }]
    };
  });
}

export function listMvpStories() {
  return {
    productName: "AI 故事局",
    announcement: "新功能上线：多人 AI 梦想对话开启，支持跨时区游玩！",
    categories: ["全部", "权谋历史", "都市职场", "悬疑推理", "科幻未来", "奇幻冒险", "情感沉浸", "成长励志"],
    featured: {
      ...SANGTIAN_DETAIL,
      cover: SANGTIAN_DETAIL.heroCover,
      sideLeft: STORY_CARDS.find((item) => item.id === "promotion-list"),
      sideRight: {
        title: "末日救援小队",
        subtitle: "生存协作故事局",
        cover: "/assets/stories/story-starship.webp"
      }
    },
    sections: [
      { title: "官方精选", icon: "star", tone: "purple", stories: [{ id: "caesar", title: CAESAR_DETAIL.title, subtitle: CAESAR_DETAIL.subtitle, category: CAESAR_DETAIL.category, cover: CAESAR_DETAIL.heroCover, players: "1-6", heat: 0, tags: CAESAR_DETAIL.tags, status: "playable" }, ...STORY_CARDS.slice(0, 4)] },
      { title: "热门故事局", icon: "hot", tone: "red", stories: STORY_CARDS.slice(4) }
    ]
  };
}

export function getMvpStory(storyId: string) {
  if (storyId === CAESAR_DETAIL.id) return CAESAR_DETAIL;
  if (storyId !== SANGTIAN_DETAIL.id) {
    const preview = STORY_CARDS.find((item) => item.id === storyId);
    if (preview) {
      throw new BadRequestException(`《${preview.title}》仍在剧本库预览阶段，当前 Web MVP 只开放《桑田诏》。`);
    }
    throw new NotFoundException("story not found");
  }
  return SANGTIAN_DETAIL;
}

export function getMvpStoryRoles(storyId: string) {
  return getMvpStory(storyId).roles;
}

export function assertPlayableMvpRole(storyId: string, roleKey: string) {
  const story = getMvpStory(storyId);
  const role = story.roles.find((item) => item.key === roleKey);
  if (!role) throw new BadRequestException("unknown story role");
  if (!role.playable) {
    throw new BadRequestException(`角色“${role.name}”将在多人异步版本开放；当前单人 MVP 只开放浙江总督。`);
  }
  return role;
}
