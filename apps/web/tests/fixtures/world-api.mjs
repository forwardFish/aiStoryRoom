export const worldApiPayload = Object.freeze({
  worlds: Object.freeze([
    Object.freeze({ worldId: "sangtian", status: "playable", playable: true, cardTitle: "Sangtian Edict: The Jiajing Fiscal Crisis", cardDescription: "A grain-price crisis, a court edict, and seven days to decide what to protect.", categoryLabel: "History & Power", cardCover: "/assets/game/sangtian/catalog-cover.png", durationLabel: "40–60 Minutes", minHumanPlayers: 1, maxHumanPlayers: 6, detailPath: "/worlds/sangtian" }),
    Object.freeze({ worldId: "caesar", status: "playable", playable: true, cardTitle: "Caesar: The Last Spring of the Republic", cardDescription: "Caesar trusts you. The conspirators need you. Rome will judge whatever survives.", categoryLabel: "History & Power", cardCover: "/assets/game/caesar/catalog-cover.png", durationLabel: "40–60 Minutes", minHumanPlayers: 1, maxHumanPlayers: 6, detailPath: "/worlds/caesar" }),
    Object.freeze({ worldId: "last-will", status: "coming_soon", playable: false, cardTitle: "The Last Will: Heirs to the Empire", cardDescription: "The will opens in 48 hours. Before then, the family must decide who controls the empire.", categoryLabel: "Family & Business", cardCover: "/assets/game/last-will/catalog-cover.png", durationLabel: "40–60 Minutes", minHumanPlayers: 1, maxHumanPlayers: 6, detailPath: "/worlds/last-will" }),
    Object.freeze({ worldId: "ten-years-later", status: "coming_soon", playable: false, cardTitle: "Ten Years Later: Reunion Night", cardDescription: "At midnight, the recording goes public. Everyone remembers that night differently.", categoryLabel: "Relationships & Mystery", cardCover: "/assets/game/ten-years-later/catalog-cover.png", durationLabel: "35–55 Minutes", minHumanPlayers: 1, maxHumanPlayers: 6, detailPath: "/worlds/ten-years-later" }),
    Object.freeze({ worldId: "romeo-and-juliet", status: "coming_soon", playable: false, cardTitle: "Romeo & Juliet: Before Dawn", cardDescription: "Everyone knows how the tragedy ends. This time, Verona is still unwritten.", categoryLabel: "Literature & Romance", cardCover: "/assets/game/romeo-and-juliet/catalog-cover.png", durationLabel: "40–60 Minutes", minHumanPlayers: 1, maxHumanPlayers: 6, detailPath: "/worlds/romeo-and-juliet" }),
    Object.freeze({ worldId: "hamlet", status: "coming_soon", playable: false, cardTitle: "Hamlet: The Ghost Beneath the Crown", cardDescription: "The dead king has named his murderer. Denmark may not survive the truth.", categoryLabel: "Literature & Power", cardCover: "/assets/game/hamlet/catalog-cover.png", durationLabel: "45–65 Minutes", minHumanPlayers: 1, maxHumanPlayers: 6, detailPath: "/worlds/hamlet" })
  ])
});

export function worldApiFetch(payload = worldApiPayload) {
  return async (url) => {
    if (String(url) !== "/api/v4/worlds") return new Response("Not found", { status: 404 });
    return Response.json(payload);
  };
}
