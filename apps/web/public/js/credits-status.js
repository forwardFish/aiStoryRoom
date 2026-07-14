import { apiFetch, getToken } from "./api-client.js";

const root = document.querySelector("[data-payment-status]");
const query = new URLSearchParams(location.search);
const purchaseId = query.get("purchase_id") || "";
const checkoutId = query.get("checkout_id") || "";
const el = (name) => root.querySelector(`[data-status-${name}]`);
const destination = (context) => context?.returnTo || "/credits";
function render(kind, title, copy, result) {
  el("icon").textContent = kind === "paid" ? "✓" : kind === "failed" ? "!" : "…";
  el("icon").className = `status-icon ${kind}`; el("eyebrow").textContent = kind === "paid" ? "PAYMENT COMPLETE" : kind === "processing" ? "PAYMENT PROCESSING" : "PAYMENT NOT COMPLETED";
  el("title").textContent = title; el("copy").textContent = copy;
  const summary = el("summary"); summary.hidden = kind !== "paid";
  if (result) el("credits").textContent = `+${result.credits}`;
  const continueTo = destination(result?.context);
  const actions = el("actions");
  actions.innerHTML = kind === "paid" && result?.context?.intent === "WORLD_UNLOCK" ? `<a class="btn primary" href="${continueTo}">Return to unlocked room</a><a class="btn" href="/credits">View World Credits</a>` : `<a class="btn primary" href="${continueTo}">${kind === "failed" ? "Try again" : "Continue"}</a><a class="btn" href="/credits">World Credits</a>`;
}
async function poll() {
  if (!getToken()) { location.assign(`/auth?returnTo=${encodeURIComponent(location.pathname + location.search)}`); return; }
  if (query.get("state") === "cancelled" || location.pathname === "/credits/cancel") { render("failed", "Payment cancelled", "No credits were added. You can return to World Credits whenever you are ready."); return; }
  if (query.get("state") === "failed" || location.pathname === "/credits/failed") { render("failed", "Payment failed", "No credits were added. You can safely try secure checkout again."); return; }
  if (!purchaseId && !checkoutId) { render("failed", "We could not find this payment", "Return to World Credits and start a new secure checkout."); return; }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const result = await apiFetch(`/v4/billing/checkout-status?${purchaseId ? `purchase_id=${encodeURIComponent(purchaseId)}` : `checkout_id=${encodeURIComponent(checkoutId)}`}`);
      if (result.status === "PAID") {
        if (result.context?.intent === "WORLD_UNLOCK" && result.context?.runId) {
          try { await apiFetch(`/v4/story-runs/${encodeURIComponent(result.context.runId)}/unlock`, { method:"POST", body:"{}" }); render("paid", "Your room is unlocked", "Your credits were confirmed and this shared world is now unlocked for every participant.", result); }
          catch (error) { render("paid", "Your World Credits are ready", `Your balance has been updated. Return to the room to finish unlocking it: ${error.message || "please try again"}.`, result); }
        } else render("paid", "Your World Credits are ready", "Your balance has been updated. Continue your story whenever you are ready.", result);
        return;
      }
      if (["FAILED", "REFUNDED", "PARTIALLY_REFUNDED", "DISPUTED"].includes(result.status)) { render("failed", "Your payment was not completed", "No credits were added. You can safely try checkout again.", result); return; }
      render("processing", "Confirming your payment", "We are waiting for secure payment confirmation. This page will update automatically.", result);
    } catch (error) { render("failed", "We could not check this payment", error.message || "Please return to World Credits and try again."); return; }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  render("processing", "Payment is still processing", "It is taking a little longer than usual. You can return to World Credits; your balance will update as soon as confirmation arrives.");
}
poll();
