import { DEFAULT_WORLD_CATALOG, fetchWorldCatalog, normalizeWorldCatalog } from "./world-api.js";
const LOGO_ASSET = "/assets/brand/many-worlds-logo.png";
const CAROUSEL_TRANSITION_MS = 650;
const CAROUSEL_AUTOPLAY_MS = 3000;

function carouselRole(itemIndex, activeIndex, itemCount) {
  if (!itemCount) return "back";
  const offset = (itemIndex - activeIndex + itemCount) % itemCount;
  return ["center", "right-near", "right-far", "back", "left-far", "left-near"][offset];
}

const faqItems = [
  ["What is a world in Our Many Worlds?", "A world is a shared situation with roles, private information, relationships, resources, and an open-ended outcome."],
  ["How does a world begin?", "Every run starts with a designed situation and role briefings. What happens next comes from the choices people make inside it."],
  ["Can I play by myself?", "Yes. Start Solo and AI-controlled characters fill the remaining roles, so you can explore the world at your own pace."],
  ["Can I invite real people into my world?", "Yes. Invite your group to take different roles. Everyone sees what their role would realistically know and contributes to one shared outcome."],
  ["What does the AI do during a run?", "The AI responds to decisions, simulates the other roles when needed, and helps the world evolve without forcing a fixed storyline."],
  ["What are World Credits?", "Under the active-action policy, World Credits pay for successful player-directed story actions: 20 Credits to create a run, 1 for a suggested action, and 2 for a custom or complex action. Reading, AI-controlled actions, system progress, retries, and failed generations cost 0 Credits. A world still using the legacy unlock policy shows that policy before you create its room."],
  ["How can I get World Credits?", "You can buy 300 World Credits for $7.99 or 650 World Credits for $14.99. New accounts receive 50 World Credits, and eligible referrals can earn 25 World Credits."],
  ["Can I create a room for my group?", "Yes. Open a world, create a shared room, and invite people to take different roles. AI can support any roles your group does not fill."]
];

function asset(group, index) {
  const normalized = String(index).match(/^\d+/)?.[0] || String(index);
  return `/assets/${group}/${normalized}.png`;
}
function icon(index, label = "") { return `<img class="mw-icon" src="${asset("icon", index)}" alt="${label}" aria-hidden="${label ? "false" : "true"}" />`; }
function howItWorksIcon(kind) {
  const artwork = {
    world: `<g class="how-icon-art"><ellipse cx="110" cy="91" rx="31" ry="37"/><path d="M79 91h62M110 54v74M86 69c15 9 33 9 48 0M86 113c15-9 33-9 48 0M110 54c-12 10-18 22-18 37s6 27 18 37M110 54c12 10 18 22 18 37s-6 27-18 37"/><path d="M48 120c21-2 37 3 50 13v39c-13-10-29-15-50-13zM172 120c-21-2-37 3-50 13v39c13-10 29-15 50-13zM98 133c5 4 9 9 12 15 3-6 7-11 12-15"/><circle cx="110" cy="151" r="22" fill="var(--how-panel)"/><circle cx="110" cy="145" r="7"/><path d="M97 165c2-10 7-15 13-15s11 5 13 15"/></g>`,
    shared: `<g class="how-icon-art"><path d="M78 51h64a9 9 0 0 1 9 9v29a9 9 0 0 1-9 9h-22l-10 14-10-14H78a9 9 0 0 1-9-9V60a9 9 0 0 1 9-9z"/><circle cx="93" cy="74" r="2" fill="currentColor" stroke="none"/><circle cx="110" cy="74" r="2" fill="currentColor" stroke="none"/><circle cx="127" cy="74" r="2" fill="currentColor" stroke="none"/><circle cx="110" cy="128" r="18"/><circle cx="110" cy="123" r="5"/><path d="M101 138c2-7 5-10 9-10s7 3 9 10M94 134l-24 15M126 134l24 15"/><circle cx="67" cy="155" r="14"/><circle cx="153" cy="155" r="14"/><circle cx="67" cy="151" r="4"/><circle cx="153" cy="151" r="4"/><path d="M60 164c1-6 4-8 7-8s6 2 7 8M146 164c1-6 4-8 7-8s6 2 7 8"/></g>`,
    changed: `<g class="how-icon-art"><path d="M111 62v76M111 65h43l-10 14 10 14h-43M102 139h20M100 145h24"/><path d="M67 171c-1-17 14-28 37-30 35-3 54 10 47 25-5 11-27 10-35 22"/><path d="M116 188l4-1-2-4"/><path d="M67 96l3 7 7 3-7 3-3 7-3-7-7-3 7-3zM151 112l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/></g>`
  };
  return `<svg class="how-step-icon" viewBox="0 0 220 220" aria-hidden="true" focusable="false"><g class="how-icon-frame"><circle cx="110" cy="110" r="91"/><circle cx="110" cy="110" r="82" stroke-dasharray="2 7"/><path d="M110 8l8 10-8 10-8-10zM212 110l-10 8-10-8 10-8zM110 212l-8-10 8-10 8 10zM8 110l10-8 10 8-10 8z" fill="var(--how-panel)"/></g>${artwork[kind]}</svg>`;
}
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
function accountInitial(account) {
  return String(account?.email || account?.nickname || "M").trim().charAt(0).toLocaleUpperCase() || "M";
}

export function createHomeApp({ root, window: browserWindow = globalThis.window, catalog = null } = {}) {
  if (!root) throw new TypeError("createHomeApp requires a root element");
  const suppliedWorlds = normalizeWorldCatalog(catalog);
  const fallbackWorlds = normalizeWorldCatalog(DEFAULT_WORLD_CATALOG);
  let worlds = suppliedWorlds.length ? suppliedWorlds : fallbackWorlds;
  let carouselWorlds = worlds.slice(0, 6);
  let carouselIndex = Math.max(0, carouselWorlds.findIndex((world) => world.id === "caesar"));
  let carouselTimer = null;
  let carouselUnlockTimer = null;
  let carouselAnimating = false;
  let account = hasSessionHint(browserWindow) ? {} : null;
  const gotoSolo = () => {
    const host = String(browserWindow.location?.hostname || "");
    const local = /^(127\.0\.0\.1|localhost)$/i.test(host) || browserWindow.location?.port === "5178";
    const configuredApiBase = new URLSearchParams(String(browserWindow.location?.search || "")).get("apiBase");
    const apiBase = configuredApiBase || (local ? "/api" : "");
    const api = apiBase ? `&apiBase=${encodeURIComponent(apiBase)}` : "";
    browserWindow.location.href = `/worlds/caesar?play=solo${api}`;
  };
  const gotoWorld = () => { browserWindow.location.href = "/worlds"; };
  const pauseCarousel = () => {
    if (carouselTimer) browserWindow.clearInterval?.(carouselTimer);
    carouselTimer = null;
  };
  const syncCarousel = () => {
    const carousel = root.querySelector(".world-carousel");
    if (!carousel) return;
    carousel.dataset.activeIndex = String(carouselIndex);
    carousel.setAttribute("aria-label", `Featured world: ${carouselWorlds[carouselIndex].title}`);
    carousel.querySelectorAll("[data-carousel-item]").forEach((item) => {
      const role = carouselRole(Number(item.dataset.carouselItem), carouselIndex, carouselWorlds.length);
      item.dataset.role = role;
      item.setAttribute("aria-hidden", String(role === "back"));
      item.setAttribute("aria-current", String(role === "center"));
      item.setAttribute("aria-label", role === "center"
        ? `Current world: ${carouselWorlds[Number(item.dataset.carouselItem)].title}`
        : `Show ${carouselWorlds[Number(item.dataset.carouselItem)].title}`);
      item.tabIndex = role === "center" || role === "back" ? -1 : 0;
      const card = item.querySelector(".world-card");
      card?.classList.toggle("featured", role === "center");
      card?.classList.toggle("peek", role !== "center");
    });
  };
  const showCarouselItem = (nextIndex, restartAutoplay = false) => {
    if (!carouselWorlds.length) return;
    const normalizedIndex = (Number(nextIndex) + carouselWorlds.length) % carouselWorlds.length;
    if (normalizedIndex === carouselIndex) return;
    carouselAnimating = true;
    carouselIndex = normalizedIndex;
    syncCarousel();
    if (carouselUnlockTimer) browserWindow.clearTimeout?.(carouselUnlockTimer);
    carouselUnlockTimer = browserWindow.setTimeout?.(() => { carouselAnimating = false; }, CAROUSEL_TRANSITION_MS);
    if (restartAutoplay) startCarousel();
  };
  const advanceCarousel = () => {
    if (carouselAnimating) return;
    showCarouselItem(carouselIndex + 1);
  };
  const bindCarousel = () => {
    const carousel = root.querySelector(".world-carousel");
    if (!carousel) return;
    carousel.addEventListener("click", (event) => {
      const item = event.target.closest?.("[data-carousel-item]");
      if (!item || item.dataset.role === "center" || item.dataset.role === "back") return;
      showCarouselItem(Number(item.dataset.carouselItem), true);
    });
  };
  const startCarousel = () => {
    pauseCarousel();
    if (carouselWorlds.length < 2) return;
    carouselTimer = browserWindow.setInterval?.(advanceCarousel, CAROUSEL_AUTOPLAY_MS);
  };
  const preloadCarousel = () => {
    if (typeof browserWindow.Image !== "function") return;
    carouselWorlds.forEach((world) => {
      const image = new browserWindow.Image();
      image.src = world.imageUrl;
    });
  };
  const signOut = async (button) => {
    button.disabled = true;
    try {
      const response = await browserWindow.fetch("/api/v4/auth/logout", { method: "POST", credentials: "include", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("Logout failed");
      try { browserWindow.google?.accounts?.id?.disableAutoSelect?.(); } catch {
        // Google Identity Services may be blocked or absent; local logout must
        // still clear the Many Worlds session.
      }
      clearSessionHint(browserWindow);
      account = null;
      render();
    } catch {
      button.disabled = false;
      button.textContent = "Try logout again";
    }
  };
  const bindAccountMenu = () => {
    const control = root.querySelector("[data-account-control]");
    const trigger = root.querySelector("[data-account-trigger]");
    const menu = root.querySelector("[data-account-menu]");
    if (control && trigger && menu) {
      const close = () => { menu.hidden = true; trigger.setAttribute("aria-expanded", "false"); };
      trigger.addEventListener("click", () => {
        const open = menu.hidden;
        menu.hidden = !open;
        trigger.setAttribute("aria-expanded", String(open));
      });
      control.addEventListener("focusout", (event) => { if (!control.contains(event.relatedTarget)) close(); });
      control.addEventListener("keydown", (event) => { if (event.key === "Escape") { close(); trigger.focus(); } });
    }
    root.querySelectorAll("[data-account-logout]").forEach((button) => button.addEventListener("click", () => void signOut(button)));
  };
  const render = ({ autoplay = true } = {}) => {
    pauseCarousel();
    if (!worlds.length) {
      root.innerHTML = '<section class="page-loading" aria-live="polite"><div class="brand-orbit" aria-hidden="true"><span></span><span></span></div><p>Opening Our Many Worlds…</p></section>';
      return;
    }
    root.innerHTML = renderPage(carouselIndex, account, worlds, carouselWorlds);
    root.querySelectorAll("[data-start-solo]").forEach((button) => button.addEventListener("click", gotoSolo));
    root.querySelectorAll("[data-open-world]").forEach((button) => button.addEventListener("click", gotoWorld));
    root.querySelector("[data-menu]")?.addEventListener("click", () => root.querySelector(".mobile-nav")?.classList.toggle("is-open"));
    bindAccountMenu();
    bindCarousel();
    if (autoplay) startCarousel();
  };
  render({ autoplay: suppliedWorlds.length > 0 });
  const applyCatalog = (catalogWorlds) => {
    worlds = normalizeWorldCatalog(catalogWorlds).sort((left, right) => Number(right.playable) - Number(left.playable));
    carouselWorlds = worlds.slice(0, 6);
    carouselIndex = Math.max(0, carouselWorlds.findIndex((world) => world.id === "caesar"));
    preloadCarousel();
    render();
    return worlds;
  };
  const ready = suppliedWorlds.length
    ? Promise.resolve(applyCatalog(suppliedWorlds))
    : fetchWorldCatalog({ fetch: browserWindow.fetch.bind(browserWindow) })
      .then(applyCatalog)
      .catch(() => {
        applyCatalog(fallbackWorlds);
        return fallbackWorlds;
      });
  if (account) void Promise.all([ready.catch(() => []), loadAccount(browserWindow)]).then(([, currentAccount]) => {
    account = currentAccount;
    render();
  });
  return { render, ready, startSolo: gotoSolo };
}

function hasSessionHint(browserWindow) {
  return String(browserWindow?.document?.cookie || "").split(";").some((item) => item.trim() === "many_worlds_session_hint=1");
}

function clearSessionHint(browserWindow) {
  try { browserWindow.document.cookie = "many_worlds_session_hint=; Path=/; Max-Age=0; SameSite=Lax"; } catch {
    // A failed UI hint cleanup does not grant or revoke the HttpOnly session.
  }
}

async function loadAccount(browserWindow) {
  try {
    const response = await browserWindow.fetch("/api/v4/auth/me", { credentials: "include", headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("Session unavailable");
    const user = await response.json();
    if (!user?.id) throw new Error("Session unavailable");
    return user;
  } catch {
    clearSessionHint(browserWindow);
    return null;
  }
}

function renderPage(activeIndex = 0, account = null, worlds = [], carouselWorlds = []) {
  return `<div class="many-worlds-page">
    ${renderHeader(account)}
    <main>
      <section class="mw-hero" id="explore">
        <div class="hero-copy">
          <span class="eyebrow">AI-POWERED STORY ROOMS</span>
          <h1>Every situation looks <em>different</em><br/>from the inside.</h1>
          <p>Enter a world already in motion. Take a role, see the information only you would know, and make decisions in your own words. AI turns every choice into the next chapter of the shared story.</p>
          <div class="hero-actions"><button class="mw-primary" data-open-world>Explore Worlds ${icon(3)}</button><a class="mw-secondary" href="#how-it-works">${icon(4)} See How It Works</a></div>
          <div class="hero-proof"><span>${icon(5)} Solo or Multiplayer</span><span>${icon(6)} Different information for every role</span><span>${icon(7)} No fixed storyline</span></div>
        </div>
        ${renderHeroCarousel(activeIndex, carouselWorlds)}
      </section>

      <section class="worlds-section mw-panel" id="worlds">
        <div class="section-head"><div><h2>Worlds worth stepping into</h2><p>${worlds.length} story worlds, each beginning with a live situation, private motives, and more than one way forward.</p></div><a href="/worlds">Explore worlds ${icon(3)}</a></div>
        <div class="world-filters"><button class="active">All Worlds</button>${[...new Set(worlds.map((world) => world.category))].map((category) => `<button>${esc(category)}</button>`).join("")}</div>
        <div class="world-grid" aria-label="${worlds.length} story worlds">${worlds.slice(0, 6).map((world) => `<a class="world-card-link" href="/worlds" aria-label="Open the world lobby">${renderWorldCard(world, "grid")}</a>`).join("")}</div>
      </section>

      <section class="how-it-works-showcase" id="how-it-works" aria-labelledby="how-it-works-title">
        <header class="how-showcase-head">
          <span class="how-kicker">How It Works</span>
          <h2 id="how-it-works-title"><span>Not a story with branches.</span><em>A situation with people.</em></h2>
          <p>Choose a role. Act in your own words. See how one shared world changes.</p>
        </header>
        <div class="how-steps">
          <span class="how-connector" aria-hidden="true"><i></i><i></i></span>
          <article class="how-step">
            ${howItWorksIcon("world")}
            <span class="how-step-number">Step 01</span>
            <h3>Choose a World and Role</h3>
            <p>Enter a world already in motion. Receive the private information, goals, and relationships only your role would know.</p>
          </article>
          <article class="how-step">
            ${howItWorksIcon("shared")}
            <span class="how-step-number">Step 02</span>
            <h3>Shape One Shared World</h3>
            <p>Act in your own words. AI responds to every decision and moves the shared world forward.</p>
          </article>
          <article class="how-step">
            ${howItWorksIcon("changed")}
            <span class="how-step-number">Step 03</span>
            <h3>See What Changed</h3>
            <p>Reach an open ending and review the key decisions and consequences that shaped it.</p>
          </article>
        </div>
      </section>

      <section class="pricing wallet-pricing" id="pricing"><div class="section-head pricing-head"><div><span class="entry-label">World Credits</span><h2>Add World Credits to your account.</h2><p>Use World Credits for eligible paid experiences across Our Many Worlds. The exact Credit cost is shown before you confirm any use.</p></div><a href="/credits">Open Credits wallet ${icon(3)}</a></div><div class="wallet-offer-grid"><article class="wallet-pack-card"><small>Credit pack</small><div class="wallet-pack-amount"><h3>300</h3><span>World Credits</span></div><strong>$7.99</strong><p>A simple way to add Credits to your balance.</p><a class="mw-primary" href="/credits?confirm=credits_300">Buy 300 Credits</a></article><article class="wallet-pack-card wallet-pack-best"><small>Best value</small><div class="wallet-pack-amount"><h3>650</h3><span>World Credits</span></div><strong>$14.99</strong><p>More Credits at a lower price per Credit.</p><a class="mw-primary" href="/credits?confirm=credits_650">Buy 650 Credits</a></article><aside class="wallet-rewards" aria-label="World Credits rewards"><div><span class="reward-icon">${icon(31)}</span><div><small>New account reward</small><b>+50 World Credits</b><p>Create an account and receive 50 World Credits.</p></div></div><div><span class="reward-icon">${icon(42)}</span><div><small>Referral reward</small><b>+25 World Credits</b><p>Earn 25 World Credits through an eligible referral. Terms apply.</p></div></div></aside></div></section>

      <section class="faq-section faq-simple mw-panel" id="faq"><div class="faq-simple-head"><span class="entry-label">FAQ</span><h2>Frequently asked questions.</h2><p>Clear answers about worlds, roles, AI, and World Credits.</p></div><div class="faq-grid">${faqItems.map(([q,a]) => `<details><summary>${q}${icon(39)}</summary><p>${a}</p></details>`).join("")}</div></section>
    </main>
    ${renderLegalFooter()}
  </div>`;
}

function renderHeroCarousel(activeIndex, carouselWorlds) {
  return `<div class="world-carousel" data-carousel data-active-index="${activeIndex}" aria-label="Featured world: ${esc(carouselWorlds[activeIndex].title)}" aria-live="polite">
    ${carouselWorlds.map((world, index) => {
      const role = carouselRole(index, activeIndex, carouselWorlds.length);
      const label = role === "center" ? `Current world: ${world.title}` : `Show ${world.title}`;
      return `<button class="carousel-item" type="button" data-carousel-item="${index}" data-role="${role}" aria-hidden="${role === "back"}" aria-current="${role === "center"}" aria-label="${esc(label)}" tabindex="${role === "center" || role === "back" ? -1 : 0}">${renderWorldCard(world, role === "center" ? "featured" : "peek", true)}</button>`;
    }).join("")}
  </div>`;
}
function renderHeader(account = null) {
  const desktopAccount = account
    ? `<div class="account-control" data-account-control><button class="account-trigger" type="button" data-account-trigger aria-label="Open account menu" aria-haspopup="menu" aria-expanded="false"><span aria-hidden="true">${esc(accountInitial(account))}</span></button><div class="account-menu" data-account-menu role="menu" hidden><a href="/account" role="menuitem">My Account</a><button type="button" data-account-logout role="menuitem">Logout</button></div></div>`
    : `<a class="login" href="/auth?returnTo=%2F">Log in</a><button class="get-started" data-open-world>Get started</button>`;
  const mobileAccount = account
    ? `<a href="/account">My Account</a><button type="button" data-account-logout>Logout</button>`
    : `<a href="/auth?returnTo=%2F">Log in</a>`;
  return `<header class="mw-header"><a class="mw-brand" href="/"><img src="${LOGO_ASSET}" alt="Our Many Worlds logo"/><span>Our Many Worlds<small>Real players. Living worlds.</small></span></a><nav><a class="active" href="/worlds">Explore Worlds</a><a href="/rooms?worldId=caesar">Create</a><a href="/#how-it-works">How It Works</a><a href="/#pricing">Pricing</a><a href="/#faq">FAQ</a></nav><div class="header-right">${desktopAccount}</div><button class="menu-button" data-menu aria-label="Open menu">☰</button><div class="mobile-nav"><a href="/worlds">Explore Worlds</a><a href="/rooms?worldId=caesar">Create</a><a href="/#how-it-works">How It Works</a><a href="/#pricing">Pricing</a><a href="/#faq">FAQ</a>${mobileAccount}</div></header>`;
}
function renderWorldCard(world, variant, clean = false) { return `<article class="world-card ${variant}${clean ? " hero-card" : ""}" style="--cover:url('${esc(world.imageUrl)}')">${clean ? "" : `<span class="world-category">${esc(world.category)}</span>`}<div><h3>${esc(world.title)}</h3>${clean ? "" : `<p>${esc(world.copy)}</p>${variant === "featured" ? `<span class="featured-people">${[1,2,3,4,5].map((n) => `<img src="${asset("portrait", n)}" alt=""/>`).join("")}</span>` : ""}<small>${icon(5)} ${esc(world.meta)}</small>`}</div></article>`; }
function renderFooter() { return `<footer class="mw-footer"><div class="footer-brand"><img src="${LOGO_ASSET}" alt="Our Many Worlds logo"/><b>Our Many Worlds</b><p>Real players.<br/>Living worlds.</p></div><div><b>Product</b><a href="#worlds">Explore Worlds</a><a href="#how-it-works">How It Works</a><a href="#pricing">Pricing</a><a href="#create">Create</a></div><div><b>Support</b><a href="#faq">Help Center</a><a href="/credits#rewards">Account rewards</a></div><div><b>Legal</b><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="/refund">Refund Policy</a></div><div class="footer-social"><small>© 2026 Our Many Worlds. All rights reserved.</small></div></footer>`; }

function renderLegalFooter() { return `<footer class="mw-footer"><div class="footer-brand"><img src="${LOGO_ASSET}" alt="Our Many Worlds logo"/><b>Our Many Worlds</b><p>Real players.<br/>Living worlds.</p></div><div><b>Product</b><a href="/worlds">Explore Worlds</a><a href="/#how-it-works">How It Works</a><a href="/#pricing">World Credits</a><a href="/rooms?worldId=caesar">Open a Room</a></div><div><b>Play</b><a href="/role-select?story=caesar">Start Solo</a><a href="/rooms?worldId=caesar">Invite a Group</a><a href="/auth?returnTo=%2F">Sign in</a><a href="/#faq">FAQ</a></div><div><b>Credits</b><a href="/credits">Credits wallet</a><a href="/credits#rewards">Account rewards</a></div><div><b>Legal</b><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="/refund">Refund Policy</a></div><div class="footer-social"><small>© 2026 Our Many Worlds. All rights reserved.</small></div></footer>`; }

if (typeof window !== "undefined" && typeof document !== "undefined" && !window.__AI_STORY_DISABLE_AUTO_BOOT__) {
  const root = document.getElementById("homeApp");
  if (root) createHomeApp({ root, window });
}
