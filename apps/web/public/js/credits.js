import { apiFetch, getToken } from "./api-client.js";

const root = document.querySelector("[data-credits-app]");
const query = new URLSearchParams(location.search);
const intent = query.get("intent") === "WORLD_UNLOCK" ? "WORLD_UNLOCK" : "WALLET";
const runId = query.get("runId") || "";
const canonicalReturn = runId ? `/room-game?runId=${encodeURIComponent(runId)}` : "/credits";
const requestedReturn = query.get("returnTo") || canonicalReturn;
const returnTo = requestedReturn.startsWith("/") && !requestedReturn.startsWith("//") ? requestedReturn : canonicalReturn;
const packs = { credits_300: { credits: 300, price: "$7.99" }, credits_650: { credits: 650, price: "$14.99" } };
let selectedPack = query.get("confirm") in packs ? query.get("confirm") : "";
let currentBalance = { available: 0 };
let roomContext = null;

const by = (selector) => root.querySelector(selector);
function message(text, kind = "info") { const node = by("[data-message]"); node.textContent = text || ""; node.dataset.kind = kind; }
function urlFor(pack = "") { const next = new URLSearchParams(); if (intent === "WORLD_UNLOCK") next.set("intent", intent); if (runId) next.set("runId", runId); if (returnTo !== "/credits") next.set("returnTo", returnTo); if (pack) next.set("confirm", pack); const text = next.toString(); return `/credits${text ? `?${text}` : ""}`; }
function authUrl(pack) { return `/auth?returnTo=${encodeURIComponent(urlFor(pack))}`; }
function setContext() {
  by("[data-return-link]").href = returnTo; by("[data-return-link]").textContent = runId ? "Back to room" : "Back to rooms";
  by("[data-return-bottom]").href = returnTo; by("[data-return-bottom]").textContent = runId ? "Back to room" : "Back to rooms";
  const active = intent === "WORLD_UNLOCK";
  by("[data-unlock-context]").hidden = !active;
  by("[data-context-copy]").textContent = active ? "Add Credits to your account, then return to your shared story." : "Add Credits to your account. Choose a pack to continue to secure checkout.";
  if (roomContext) {
    const title = roomContext.title || "your shared story";
    by("[data-context-room]").textContent = `Add Credits, then return to ${title}`;
    by("[data-context-round]").textContent = "Your room link will be preserved while you complete checkout.";
    by("[data-confirm-room]").textContent = `Return to ${title} after checkout`;
    by("[data-confirm-round]").textContent = "Your room link will be preserved.";
  }
  by("[data-confirm-context]").hidden = !active;
}
function render() {
  const isConfirm = Boolean(selectedPack);
  root.dataset.view = isConfirm ? "confirm" : "wallet";
  by("[data-wallet-state]").hidden = isConfirm; by("[data-confirm-state]").hidden = !isConfirm;
  by("[data-wallet-title]").hidden = isConfirm;
  by("[data-unlock-context]").hidden = isConfirm || intent !== "WORLD_UNLOCK";
  by(".credits-trust").hidden = isConfirm;
  by("[data-balance]").textContent = String(currentBalance.available);
  if (!isConfirm) return;
  const pack = packs[selectedPack];
  by("[data-confirm-credits]").textContent = String(pack.credits); by("[data-confirm-price]").textContent = pack.price;
  by("[data-confirm-current]").textContent = `${currentBalance.available} Credits`;
  by("[data-confirm-after]").textContent = `${currentBalance.available + pack.credits} Credits`;
}
async function loadAccount() {
  if (!getToken()) { render(); return; }
  try { currentBalance = await apiFetch("/v4/credits/balance"); }
  catch (error) { message(error.message || "We could not load your credit balance.", "error"); }
}
async function loadRoomContext() {
  if (!runId || intent !== "WORLD_UNLOCK" || !getToken()) return;
  try {
    const game = await apiFetch(`/v4/rooms/${encodeURIComponent(runId)}/game`);
    roomContext = { title: game.room?.title };
  } catch { roomContext = { title: "your shared story" }; }
}
function openConfirmation(key) {
  if (!getToken()) { location.assign(authUrl(key)); return; }
  selectedPack = key;
  history.pushState({}, "", urlFor(key));
  setContext();
  render();
}
async function startCheckout() {
  if (!selectedPack) return;
  const button = by("[data-confirm-purchase]"); if (button.disabled) return;
  button.disabled = true; button.textContent = "Opening secure checkout…";
  try { const result = await apiFetch("/v4/billing/checkouts", { method: "POST", body: JSON.stringify({ packKey: selectedPack, intent, runId: runId || undefined, returnTo }) }); location.assign(result.checkoutUrl); }
  catch (error) { location.assign(`/credits/failed?${new URLSearchParams({ intent, ...(runId ? { runId } : {}), ...(returnTo ? { returnTo } : {}) })}`); }
}

by("[data-confirm-purchase]").addEventListener("click", startCheckout);
root.querySelectorAll("[data-pack]").forEach((button) => button.addEventListener("click", () => openConfirmation(button.dataset.pack)));
by("[data-back-wallet]").addEventListener("click", () => {
  selectedPack = "";
  history.pushState({}, "", urlFor());
  setContext();
  render();
});
window.addEventListener("popstate", () => {
  const next = new URLSearchParams(location.search).get("confirm");
  selectedPack = next in packs ? next : "";
  setContext();
  render();
});
if (selectedPack && !getToken()) {
  location.replace(authUrl(selectedPack));
} else {
  await Promise.all([loadAccount(), loadRoomContext()]); setContext(); render();
}
