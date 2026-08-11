import { DEFAULT_WORLD_CATALOG, fetchWorldCatalog, normalizeWorldCatalog } from "./world-api.js";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}

function worldCard(world) {
  const body = `<div class="world-card-art">
      <img src="${esc(world.imageUrl)}" alt="${esc(world.title)}" />
      <span class="world-category">${esc(world.category)}</span>
      ${world.playable ? "" : '<span class="world-coming-badge">Coming Soon</span>'}
    </div>
    <div class="world-card-body">
      <h2>${esc(world.title)}</h2>
      <p>${esc(world.copy)}</p>
      <div class="world-card-footer">
        <div class="world-meta"><img src="/assets/icon/5.png" alt="" /><span>${esc(world.roles)} Roles</span><img src="/assets/icon/6.png" alt="" /><span>${esc(world.duration)}</span></div>
        ${world.playable ? '<span class="world-playable"><i></i>Playable</span><span class="view-world">View World</span>' : '<span class="coming-label">Coming Soon</span>'}
      </div>
    </div>`;
  if (world.playable) {
    return `<a class="world-card is-playable" data-world-id="${esc(world.id)}" href="${esc(world.href)}" aria-label="View ${esc(world.title)}">${body}</a>`;
  }
  return `<article class="world-card is-coming" data-world-id="${esc(world.id)}" aria-disabled="true">${body}</article>`;
}

export function renderWorldCatalog(documentRef = document, catalog = []) {
  const grid = documentRef.querySelector("[data-world-catalog]");
  if (!grid) return;
  const worlds = normalizeWorldCatalog(catalog);
  grid.innerHTML = worlds.map(worldCard).join("");
}

export async function loadWorldCatalog(documentRef = document, windowRef = window) {
  const grid = documentRef.querySelector("[data-world-catalog]");
  if (!grid) return [];
  const fallbackWorlds = normalizeWorldCatalog(DEFAULT_WORLD_CATALOG);
  if (!grid.querySelector(".world-card")) renderWorldCatalog(documentRef, fallbackWorlds);
  grid.setAttribute("aria-busy", "true");
  try {
    const worlds = await fetchWorldCatalog({ fetch: windowRef.fetch.bind(windowRef) });
    renderWorldCatalog(documentRef, worlds);
    return worlds;
  } catch (error) {
    renderWorldCatalog(documentRef, fallbackWorlds);
    grid.insertAdjacentHTML("beforeend", '<p class="worlds-fallback-note" role="status">Showing the latest verified world catalog.</p>');
    return fallbackWorlds;
  } finally {
    grid.removeAttribute("aria-busy");
  }
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  renderWorldCatalog(document, DEFAULT_WORLD_CATALOG);
  void loadWorldCatalog(document, window);
}
