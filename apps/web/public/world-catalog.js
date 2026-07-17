export const worlds = Object.freeze([
  Object.freeze({
    id: "sangtian",
    title: "Sangtian Edict: The Jiajing Fiscal Crisis",
    category: "History & Power",
    copy: "A grain-price crisis, a court edict, and seven days to decide what to protect.",
    detail: "In a seven-stage fiscal crisis, every public claim, private pressure, and preserved record changes what the other roles can do next.",
    rolePreview: Object.freeze([
      Object.freeze({ name: "\u6d59\u6c5f\u603b\u7763", copy: "Hold the whole province together.", portrait: "/assets/portrait/1.png" }),
      Object.freeze({ name: "\u6d59\u6c5f\u5de1\u629a", copy: "Reform cannot outrun the evidence.", portrait: "/assets/portrait/2.png" }),
      Object.freeze({ name: "\u6e05\u6d41\u53bf\u4ee4", copy: "Protect the people and preserve the records.", portrait: "/assets/portrait/3.png" }),
      Object.freeze({ name: "\u6c5f\u5357\u5546\u4f1a", copy: "Grain and silver have their own politics.", portrait: "/assets/portrait/4.png" }),
      Object.freeze({ name: "\u53f8\u793c\u76d1\u7ec7\u9020\u4f7f", copy: "The court watches every silver road.", portrait: "/assets/portrait/5.png" })
    ]),
    image: 2,
    roles: "1-3",
    duration: "40-60 Minutes",
    meta: "1-3 roles - 40-60 min",
    playable: true,
    href: "/worlds/sangtian"
  }),
  Object.freeze({
    id: "caesar",
    title: "Caesar: The Last Spring of the Republic",
    category: "History & Power",
    copy: "Caesar trusts you. The conspirators need you. Rome will judge whatever survives.",
    detail: "The Republic teeters on a knife's edge. Ambition clashes with loyalty, and every choice writes a different history.",
    rolePreview: Object.freeze([
      Object.freeze({ name: "Brutus", copy: "I serve Rome, not any man.", portrait: "/assets/portrait/1.png" }),
      Object.freeze({ name: "Caesar", copy: "I came, I saw, I changed Rome.", portrait: "/assets/portrait/2.png" }),
      Object.freeze({ name: "Cassius", copy: "Liberty isn't given. It's taken.", portrait: "/assets/portrait/3.png" }),
      Object.freeze({ name: "Mark Antony", copy: "I speak for Rome. And I remember.", portrait: "/assets/portrait/4.png" }),
      Object.freeze({ name: "Decimus", copy: "I watch. I learn. I will decide.", portrait: "/assets/portrait/5.png" }),
      Object.freeze({ name: "Cicero", copy: "Words are my sharpest weapon.", portrait: "/assets/portrait/6.png" })
    ]),
    image: 1,
    roles: "1-6",
    duration: "40-60 Minutes",
    meta: "1-6 roles - 40-60 min",
    playable: true,
    featured: true,
    href: "/worlds/caesar"
  }),
  Object.freeze({
    id: "last-night-shift",
    title: "The Last Night Shift",
    category: "Mystery",
    copy: "One night, one crew, and too many things that do not add up.",
    image: 3,
    roles: "4-6",
    duration: "60-90 Minutes",
    meta: "4-6 roles - 60-90 min",
    playable: false
  }),
  Object.freeze({
    id: "ninety-days-left",
    title: "Ninety Days Left",
    category: "Crisis & Survival",
    copy: "A shrinking runway, mounting pressure, and ninety days to hold the line.",
    image: 4,
    roles: "4-6",
    duration: "60-90 Minutes",
    meta: "4-6 roles - 60-90 min",
    playable: false
  }),
  Object.freeze({
    id: "inheritance-table",
    title: "The Inheritance Table",
    category: "Relationships",
    copy: "A family gathering becomes a negotiation over loyalty, memory, and control.",
    image: 8,
    roles: "3-4",
    duration: "60-90 Minutes",
    meta: "3-4 roles - 60-90 min",
    playable: false
  }),
  Object.freeze({
    id: "blackout-protocol",
    title: "Blackout Protocol",
    category: "Speculative Futures",
    copy: "A citywide systems failure forces every decision into the open.",
    image: 5,
    roles: "4-6",
    duration: "60-90 Minutes",
    meta: "4-6 roles - 60-90 min",
    playable: false
  }),
  Object.freeze({
    id: "hidden-files",
    title: "The Hidden Files",
    category: "Mystery",
    copy: "Old files. Cold cases. Secrets that someone still wants hidden.",
    image: 6,
    roles: "4-6",
    duration: "60-90 Minutes",
    meta: "4-6 roles - 60-90 min",
    playable: false
  }),
  Object.freeze({
    id: "love-in-parallel",
    title: "Love in Parallel",
    category: "Relationships",
    copy: "In another timeline, you made a different choice. What if?",
    image: 7,
    roles: "3-4",
    duration: "60-90 Minutes",
    meta: "3-4 roles - 60-90 min",
    playable: false
  })
]);

globalThis.MANY_WORLDS_CATALOG = worlds;
