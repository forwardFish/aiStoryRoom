/**
 * Public Sangtian character cards are a presentation boundary.
 *
 * Pressure uses six canonical institutional seat ids internally.  The public
 * world and role-selection pages, however, keep the established six
 * character portraits and public-facing copy.  The canonical key is never
 * changed here, so new runs still persist only Pressure seat ids.
 */
const SANGTIAN_PUBLIC_ROLE_PRESENTATIONS = Object.freeze({
  zhejiang_governor: {
    name: "浙江总督",
    identity: "统筹浙江军政的封疆大吏",
    publicInfo: "你必须在皇权、财政、民心与海防之间稳住全局。",
    portrait: "/assets/game/sangtian/generated/role-governor-scene-v1.png",
  },
  zhejiang_administration: {
    name: "浙江巡抚",
    identity: "督办改桑新政的地方大员",
    publicInfo: "你要尽快交出政绩，但也不能让暗账反噬。",
    portrait: "/assets/game/sangtian/generated/role-xunfu-scene-v1.png",
  },
  qingliu_law: {
    name: "清流县令",
    identity: "直接面对百姓的地方官",
    publicInfo: "你既不能抗旨，也不能坐视民田和粮田被吞没。",
    portrait: "/assets/game/sangtian/generated/governor-scene-v1.png",
  },
  cabinet_finance: {
    name: "改桑书吏",
    identity: "经手田亩名册、催办底稿与驿站文书的关键书吏",
    publicInfo: "你没有高位，却知道每一笔数字是谁改的、每一道命令是谁补签的。",
    portrait: "/assets/game/sangtian/generated/role-clerk-scene-v1.png",
  },
  jiangnan_merchant: {
    name: "江南商会会首",
    identity: "掌握粮仓、丝路、垫银与官商往来账的商会领袖",
    publicInfo: "谁能保护商路与契约，商会就向谁提供粮银；但每笔援手都有代价。",
    portrait: "/assets/game/sangtian/generated/role-merchant-scene-v1.png",
  },
  sili_weaving: {
    name: "司礼监织造使",
    identity: "代表内廷巡视浙江银路、织造与奏报真伪的皇帝耳目",
    publicInfo: "你奉旨查的是银路与欺瞒，但所有人都担心你借调查控制江南。",
    portrait: "/assets/game/sangtian/generated/role-spy-scene-v1.png",
  },
} as const);

export interface PublicWorldRolePresentationV1 {
  name: string;
  identity: string;
  publicInfo: string;
  portrait: string;
}

export function publicWorldRolePresentation(
  worldId: string,
  roleKey: string,
  fallback: PublicWorldRolePresentationV1,
): PublicWorldRolePresentationV1 {
  if (worldId !== "sangtian") return fallback;
  return SANGTIAN_PUBLIC_ROLE_PRESENTATIONS[
    roleKey as keyof typeof SANGTIAN_PUBLIC_ROLE_PRESENTATIONS
  ] ?? fallback;
}

export function publicWorldRolePortrait(
  worldId: string,
  roleKey: string,
  canonicalPortrait: string,
): string {
  return publicWorldRolePresentation(worldId, roleKey, {
    name: "",
    identity: "",
    publicInfo: "",
    portrait: canonicalPortrait,
  }).portrait;
}
