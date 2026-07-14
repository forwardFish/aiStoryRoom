import { apiFetch, getToken } from "./api-client.js";

const root = document.querySelector("[data-payment-status]");
const query = new URLSearchParams(location.search);
const purchaseId = query.get("purchase_id") || "";
const checkoutId = query.get("checkout_id") || "";
const el = (name) => root.querySelector(`[data-status-${name}]`);
const destination = (context) => context?.returnTo || "/credits";

function purchaseContext(result) {
  const context = result?.context || {};
  const room = context.roomTitle || (context.runId ? "your shared room" : "World Credits");
  const round = context.round ? ` · Round ${context.round} of ${context.totalRounds || 7}` : "";
  return { room, label: `${room}${round}`, context };
}

function render(kind, title, copy, result) {
  const { room, label, context } = purchaseContext(result);
  const isPaid = kind === "paid";
  const isProcessing = kind === "processing";
  const isCancelled = kind === "cancelled";
  const creditText = result?.credits ? `${result.credits} World Credits` : "World Credits";
  const icon = el("icon");
  icon.className = `status-icon ${kind}`;
  icon.innerHTML = "<span></span>";
  el("eyebrow").textContent = isPaid ? "PAYMENT CONFIRMED" : isProcessing ? "PAYMENT PROCESSING" : isCancelled ? "PAYMENT CANCELLED" : "PAYMENT NOT COMPLETED";
  el("title").textContent = title;
  el("copy").textContent = copy;
  el("package").textContent = creditText;
  el("order").textContent = result?.orderDisplayCode || "MW-PENDING";
  const pill = el("pill");
  pill.textContent = isPaid ? "Confirmed" : isProcessing ? "Processing" : isCancelled ? "Cancelled" : "Not completed";
  pill.className = `status-pill ${kind}`;
  el("context").textContent = context.intent === "WORLD_UNLOCK" ? label : "World Credits";
  const summary = el("summary");
  summary.hidden = !isPaid;
  if (result?.credits) el("credits").textContent = `+${result.credits}`;
  const continueTo = destination(context);
  const wallet = context.intent === "WORLD_UNLOCK" ? `/credits?intent=WORLD_UNLOCK&runId=${encodeURIComponent(context.runId || "")}&returnTo=${encodeURIComponent(continueTo)}` : "/credits";
  const actions = el("actions");
  if (isPaid && context.intent === "WORLD_UNLOCK") {
    actions.innerHTML = `<a class="btn primary" href="${continueTo}">Return to unlocked room</a><a class="btn" href="${wallet}">View World Credits</a>`;
  } else if (isProcessing) {
    actions.innerHTML = `<button class="btn primary" type="button" data-continue-waiting>Continue waiting</button><a class="btn" href="${continueTo}">Return to room</a>`;
    actions.querySelector("[data-continue-waiting]").addEventListener("click", () => poll({ immediate: true }));
  } else if (isCancelled) {
    actions.innerHTML = `<a class="btn primary" href="${wallet}">Choose another pack</a><a class="btn" href="${continueTo}">Return to room</a>`;
  } else {
    actions.innerHTML = `<a class="btn primary" href="${wallet}">Try again</a><a class="btn" href="${continueTo}">Return to room</a>`;
  }
}

async function poll(options = {}) {
  if (!getToken()) { location.assign(`/auth?returnTo=${encodeURIComponent(location.pathname + location.search)}`); return; }
  const cancelled = query.get("state") === "cancelled" || location.pathname === "/credits/cancel";
  const failed = query.get("state") === "failed" || location.pathname === "/credits/failed";
  if ((cancelled || failed) && !purchaseId && !checkoutId) {
    const context = { intent: query.get("intent") === "WORLD_UNLOCK" ? "WORLD_UNLOCK" : "WALLET", runId: query.get("runId") || null, returnTo: query.get("returnTo") || "/credits" };
    render(cancelled ? "cancelled" : "failed", cancelled ? "Payment cancelled" : "Payment failed", cancelled ? "No credits were added. You can choose another pack or safely return to your room." : "No credits were added. You can safely try secure checkout again.", { context });
    return;
  }
  if (!purchaseId && !checkoutId) { render("failed", "We could not find this payment", "Return to World Credits and start a new secure checkout."); return; }
  const attempts = options.immediate ? 1 : 20;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await apiFetch(`/v4/billing/checkout-status?${purchaseId ? `purchase_id=${encodeURIComponent(purchaseId)}` : `checkout_id=${encodeURIComponent(checkoutId)}`}`);
      if (cancelled && result.status !== "PAID") { render("cancelled", "Payment cancelled", "No credits were added. You can choose another pack or safely return to your room.", result); return; }
      if (failed && result.status !== "PAID") { render("failed", "Payment failed", "No credits were added. You can safely try secure checkout again.", result); return; }
      if (result.status === "PAID") {
        if (result.context?.intent === "WORLD_UNLOCK" && result.context?.runId) {
          try {
            await apiFetch(`/v4/story-runs/${encodeURIComponent(result.context.runId)}/unlock`, { method: "POST", body: "{}" });
            render("paid", "Your room is unlocked", "Your credits were confirmed and this shared world is now unlocked for every participant.", result);
          } catch (error) {
            render("paid", "Your World Credits are ready", `Your balance has been updated. Return to the room to finish unlocking it: ${error.message || "please try again"}.`, result);
          }
        } else {
          render("paid", "Your World Credits are ready", "Your balance has been updated. Continue your story whenever you are ready.", result);
        }
        return;
      }
      if (["FAILED", "REFUNDED", "PARTIALLY_REFUNDED", "DISPUTED"].includes(result.status)) { render("failed", "Your payment was not completed", "No credits were added. You can safely try checkout again.", result); return; }
      render("processing", "Payment received. Adding your Credits.", "This usually takes a few seconds. It is safe to keep this page open or refresh it.", result);
    } catch (error) {
      render("failed", "We could not check this payment", error.message || "Please return to World Credits and try again.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

poll();
