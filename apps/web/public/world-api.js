export const WORLD_CATALOG_API = "/api/v4/worlds";

// This is the last verified public catalog snapshot. It keeps public discovery
// available when the API proxy is temporarily unavailable; the live endpoint
// still refreshes it whenever it responds successfully.
export const DEFAULT_WORLD_CATALOG = Object.freeze([
  Object.freeze({ worldId: "sangtian", detailPath: "/worlds/sangtian", status: "playable", cardTitle: "Sangtian Edict: The Jiajing Fiscal Crisis", cardDescription: "A grain-price crisis, a court edict, and seven days to decide what to protect.", categoryLabel: "History & Power", cardCover: "/assets/game/sangtian/cover.png", durationLabel: "40–60 Minutes", minHumanPlayers: 1, maxHumanPlayers: 6, playable: true }),
  Object.freeze({ worldId: "caesar", detailPath: "/worlds/caesar", status: "playable", cardTitle: "Caesar: The Last Spring of the Republic", cardDescription: "Caesar trusts you. The conspirators need you. Rome will judge whatever survives.", categoryLabel: "History & Power", cardCover: "/assets/game/caesar/cover.png", durationLabel: "40–60 Minutes", minHumanPlayers: 1, maxHumanPlayers: 6, playable: true }),
  Object.freeze({ worldId: "last-night-shift", detailPath: "/worlds/last-night-shift", status: "coming_soon", cardTitle: "The Last Night Shift", cardDescription: "One night, one crew, and too many things that do not add up.", categoryLabel: "Mystery", cardCover: "/assets/game/last-night-shift/cover.png", durationLabel: "60–90 Minutes", minHumanPlayers: 4, maxHumanPlayers: 6, playable: false }),
  Object.freeze({ worldId: "ninety-days-left", detailPath: "/worlds/ninety-days-left", status: "coming_soon", cardTitle: "Ninety Days Left", cardDescription: "A shrinking runway, mounting pressure, and ninety days to hold the line.", categoryLabel: "Crisis & Survival", cardCover: "/assets/game/ninety-days-left/cover.png", durationLabel: "60–90 Minutes", minHumanPlayers: 4, maxHumanPlayers: 6, playable: false }),
  Object.freeze({ worldId: "inheritance-table", detailPath: "/worlds/inheritance-table", status: "coming_soon", cardTitle: "The Inheritance Table", cardDescription: "A family gathering becomes a negotiation over loyalty, memory, and control.", categoryLabel: "Relationships", cardCover: "/assets/game/inheritance-table/cover.png", durationLabel: "60–90 Minutes", minHumanPlayers: 3, maxHumanPlayers: 5, playable: false }),
  Object.freeze({ worldId: "blackout-protocol", detailPath: "/worlds/blackout-protocol", status: "coming_soon", cardTitle: "Blackout Protocol", cardDescription: "A citywide systems failure forces every decision into the open.", categoryLabel: "Speculative Futures", cardCover: "/assets/game/blackout-protocol/cover.png", durationLabel: "60–90 Minutes", minHumanPlayers: 4, maxHumanPlayers: 6, playable: false })
]);

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function positiveInteger(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function assetUrl(value) {
  const normalized = text(value);
  return /^\/assets\/game\/[a-z0-9-]+\/[a-zA-Z0-9._/?=&%-]+$/.test(normalized)
    ? normalized
    : "";
}

function playerRange(minimum, maximum) {
  return minimum === maximum ? String(maximum) : `${minimum}-${maximum}`;
}

export function normalizeWorld(source = {}) {
  const id = text(source.worldId || source.id);
  const range = text(source.roles).match(/^(\d+)(?:-(\d+))?$/);
  const minPlayers = positiveInteger(source.minHumanPlayers ?? source.minPlayers ?? range?.[1], 1);
  const maxPlayers = Math.max(minPlayers, positiveInteger(source.maxHumanPlayers ?? source.maxPlayers ?? range?.[2] ?? range?.[1], minPlayers));
  const duration = text(source.durationLabel || source.duration, "Duration TBA");
  const playable = source.playable === true || source.status === "playable";
  return Object.freeze({
    id,
    title: text(source.cardTitle || source.title, "Untitled World"),
    category: text(source.categoryLabel || source.genre || source.category, "Story World"),
    copy: text(source.cardDescription || source.description || source.copy, "A new world is taking shape."),
    imageUrl: assetUrl(source.cardCover || source.imageUrl),
    roles: playerRange(minPlayers, maxPlayers),
    duration,
    meta: `${playerRange(minPlayers, maxPlayers)} roles · ${duration.replace(/\s*Minutes$/i, " min")}`,
    playable,
    status: playable ? "playable" : text(source.status, "coming_soon"),
    href: text(source.detailPath, id ? `/worlds/${id}` : "/worlds")
  });
}

export function normalizeWorldCatalog(catalog) {
  if (!Array.isArray(catalog)) return [];
  return catalog.map(normalizeWorld).filter((world) => world.id && world.imageUrl);
}

export async function fetchWorldCatalog({ fetch: fetcher = globalThis.fetch, signal } = {}) {
  if (typeof fetcher !== "function") throw new TypeError("World catalog fetch is unavailable");
  const response = await fetcher(WORLD_CATALOG_API, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal
  });
  if (!response.ok) throw new Error(`World catalog request failed (${response.status})`);
  const payload = await response.json();
  const worlds = normalizeWorldCatalog(payload?.worlds);
  if (!worlds.length) throw new Error("World catalog is empty");
  return worlds;
}
