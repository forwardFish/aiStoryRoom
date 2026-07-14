const worlds = [
  { title: "Sangtian Edict: The Jiajing Fiscal Crisis", category: "History & Power", copy: "A grain-price crisis, a court edict, and seven days to decide what to protect.", image: 2, meta: "1–3 roles · 7 days" },
  { title: "Caesar: The Last Spring of the Republic", category: "History & Power", copy: "Caesar trusts you. The conspirators need you. Rome will judge whatever survives.", image: 1, meta: "1–6 roles · 40–60 min", featured: true },
  { title: "The Last Night Shift", category: "Mystery", copy: "Five strangers. One shift. Different truths that never stay buried.", image: 3, meta: "5 roles · 60–90 min" },
  { title: "Ninety Days Left", category: "Crisis & Survival", copy: "Your company has 90 days to prove it can survive.", image: 4, meta: "4–6 roles · 60–90 min" },
  { title: "The Inheritance Table", category: "Relationships", copy: "Family. Fortune. One table. Everything changes at the reading.", image: 8, meta: "4–6 roles · 60–90 min" },
  { title: "Blackout Protocol", category: "Speculative Futures", copy: "A citywide blackout. Resources fade fast. Trust fades faster.", image: 5, meta: "4–6 roles · 60–90 min" },
  { title: "The Hidden Files", category: "Mystery", copy: "Old files. Cold cases. Secrets that someone still wants hidden.", image: 6, meta: "4–6 roles · 60–90 min" },
  { title: "Love in Parallel", category: "Relationships", copy: "In another timeline, you made a different choice. What if?", image: 7, meta: "3–4 roles · 60–90 min" }
];
const LOGO_ASSET = "/assets/brand/many-worlds-logo.png";

// Keep the hero carousel focused on the six worlds shown in the catalog.
// The order is intentional: the initial frame keeps Caesar in the center.
const carouselWorlds = [worlds[0], worlds[2], worlds[1], worlds[3], worlds[5], worlds[4]];

const featurePoints = [
  ["17-user-role", "Different roles, different truths", "Each player sees only what their role would realistically know."],
  ["18-eye", "Private motives", "Everyone enters with their own goals, pressures, relationships, and limits."],
  ["11-branching-choice", "Decisions in your own words", "Negotiate, persuade, cooperate, or act, on your own terms."],
  ["05-users", "One shared world", "All actions have real effects through relationships, resources, secrets, and the wider situation."],
  ["13-infinity", "No preset ending", "Outcomes emerge from what everyone does."],
];

const faqItems = [
  ["What is a world in Many Worlds?", "A world is a shared situation with roles, private information, relationships, resources, and an open-ended outcome."],
  ["How does a world begin?", "Every run starts with a designed situation and role briefings. What happens next comes from the choices people make inside it."],
  ["Can I play by myself?", "Yes. Start Solo and AI-controlled characters fill the remaining roles, so you can explore the world at your own pace."],
  ["Can I invite real people into my world?", "Yes. Invite your group to take different roles. Everyone sees what their role would realistically know and contributes to one shared outcome."],
  ["What does the AI do during a run?", "The AI responds to decisions, simulates the other roles when needed, and helps the world evolve without forcing a fixed storyline."],
  ["How do World Credits unlock a room?", "The first three decisions are free. After that, one participant spends 100 World Credits to unlock the complete room. Invited participants can join without paying, and there is no per-turn charge after unlock."],
  ["Do World Credits expire?", "Purchased Credits never expire. Signup and referral Bonus Credits expire after 90 days."],
  ["Can I create a room for my group?", "Yes. Creating a room is free. Open a world, create a shared room, and invite people to take different roles. AI can support any roles your group does not fill."]
];

function asset(group, index) {
  const normalized = String(index).match(/^\d+/)?.[0] || String(index);
  return `/assets/${group}/${normalized}.png`;
}
function icon(index, label = "") { return `<img class="mw-icon" src="${asset("icon", index)}" alt="${label}" aria-hidden="${label ? "false" : "true"}" />`; }

export function createHomeApp({ root, window: browserWindow = globalThis.window } = {}) {
  if (!root) throw new TypeError("createHomeApp requires a root element");
  let carouselIndex = 2;
  let carouselTimer = null;
  const gotoSolo = () => {
    const host = String(browserWindow.location?.hostname || "");
    const local = /^(127\.0\.0\.1|localhost)$/i.test(host) || browserWindow.location?.port === "5178";
    const configuredApiBase = new URLSearchParams(String(browserWindow.location?.search || "")).get("apiBase");
    const apiBase = configuredApiBase || (local ? "/api" : "");
    const api = apiBase ? `&apiBase=${encodeURIComponent(apiBase)}` : "";
    browserWindow.location.href = `/role-select?story=caesar${api}`;
  };
  const gotoWorld = () => { browserWindow.location.href = "/worlds/caesar"; };
  const gotoRooms = () => { browserWindow.location.href = "/rooms?worldId=caesar"; };
  const pauseCarousel = () => {
    if (carouselTimer) browserWindow.clearInterval?.(carouselTimer);
    carouselTimer = null;
  };
  const bindCarousel = () => {
    const carousel = root.querySelector(".world-carousel");
    if (!carousel) return;
    carousel.querySelector("[data-carousel-prev]")?.addEventListener("click", () => {
      carouselIndex = (carouselIndex - 1 + carouselWorlds.length) % carouselWorlds.length;
      renderCarousel();
      startCarousel();
    });
    carousel.querySelector("[data-carousel-next]")?.addEventListener("click", () => {
      carouselIndex = (carouselIndex + 1) % carouselWorlds.length;
      renderCarousel();
      startCarousel();
    });
    carousel.addEventListener("mouseenter", pauseCarousel);
    carousel.addEventListener("mouseleave", startCarousel);
    carousel.addEventListener("focusin", pauseCarousel);
    carousel.addEventListener("focusout", (event) => {
      if (!carousel.contains(event.relatedTarget)) startCarousel();
    });
  };
  const renderCarousel = () => {
    const carousel = root.querySelector(".world-carousel");
    if (!carousel) return;
    carousel.outerHTML = renderHeroCarousel(carouselIndex);
    bindCarousel();
  };
  const startCarousel = () => {
    pauseCarousel();
    carouselTimer = browserWindow.setInterval?.(() => {
      carouselIndex = (carouselIndex + 1) % carouselWorlds.length;
      renderCarousel();
    }, 4800);
  };
  const render = () => {
    pauseCarousel();
    root.innerHTML = renderPage(carouselIndex);
    root.querySelectorAll("[data-start-solo]").forEach((button) => button.addEventListener("click", gotoSolo));
    root.querySelectorAll("[data-open-world]").forEach((button) => button.addEventListener("click", gotoWorld));
    root.querySelectorAll("[data-open-rooms]").forEach((button) => button.addEventListener("click", gotoRooms));
    root.querySelector("[data-menu]")?.addEventListener("click", () => root.querySelector(".mobile-nav")?.classList.toggle("is-open"));
    bindCarousel();
    startCarousel();
  };
  render();
  return { render, startSolo: gotoSolo };
}

function renderPage(activeIndex = 2) {
  return `<div class="many-worlds-page">
    ${renderHeader()}
    <main>
      <section class="mw-hero" id="explore">
        <div class="hero-copy">
          <span class="eyebrow">AI-POWERED STORY ROOMS</span>
          <h1>Every situation<br/>looks <em>different</em><br/>from the inside.</h1>
          <p>Enter a world already in motion. Take a role, see the information only you would know, and make decisions in your own words. AI turns every choice into the next chapter of the shared story.</p>
          <div class="hero-actions"><button class="mw-primary" data-open-world>Explore Worlds ${icon(3)}</button><a class="mw-secondary" href="#how-it-works">${icon(4)} See How It Works</a></div>
          <div class="hero-proof"><span>${icon(5)} Solo or Multiplayer</span><span>${icon(6)} Different information for every role</span><span>${icon(7)} No fixed storyline</span></div>
        </div>
        ${renderHeroCarousel(activeIndex)}
      </section>

      <section class="worlds-section mw-panel" id="worlds">
        <div class="section-head"><div><h2>Worlds worth stepping into</h2><p>Six story worlds, each beginning with a live situation, private motives, and more than one way forward.</p></div><a href="/worlds/caesar">Explore worlds ${icon(3)}</a></div>
        <div class="world-filters"><button class="active">All Worlds</button><button>History &amp; Power</button><button>Business &amp; Work</button><button>Mystery</button><button>Crisis &amp; Survival</button><button>Speculative Futures</button><button>Relationships</button></div>
        <div class="world-grid" aria-label="Six story worlds">${worlds.slice(0, 6).map((world) => renderWorldCard(world, "grid")).join("")}</div>
      </section>

      <section class="principles" id="how-it-works"><h2>Not a story with branches. <span>A situation with people.</span></h2><p>The opening is designed. Everything after that emerges from what everyone does.</p><div class="principle-grid">${featurePoints.map(([i, title, copy]) => `<article>${icon(i)}<b>${title}</b><p>${copy}</p></article>`).join("")}</div></section>

      <section class="entry-grid"><article class="entry-card solo"><div><span class="entry-label">Enter alone.</span><h2>Start Solo</h2><p>Step into a world now. AI-controlled characters fill the remaining roles while you test your first decision.</p><ul><li>Choose one role</li><li>Read your private briefing</li><li>Make decisions at your pace</li><li>See how the situation responds</li></ul><button class="mw-primary" data-start-solo>Start Solo</button></div><div class="role-stack"><div class="role-ghost portrait-01"></div><div class="role-ghost portrait-02"></div><div class="role-main portrait-03"><span>${icon(14)}</span></div></div></article><article class="entry-card invite"><div><span class="entry-label">Bring others in.</span><h2>Host a Room</h2><p>Open a shared room and invite people into different roles. Everyone sees their own side of the situation and shapes one shared outcome.</p><ul><li>Private role briefings</li><li>Live or asynchronous sessions</li><li>Independent decisions</li><li>One shared outcome</li></ul><button class="mw-secondary" data-open-rooms>Open a Room ${icon(3)}</button></div><div class="avatar-orbit">${[1,2,3,4,5,6].map((n) => `<img src="${asset("portrait", n)}" alt=""/>`).join("")}<span>${icon(42)}</span></div></article></section>

      <section class="flow-section mw-panel" id="flow"><div class="section-head"><div><h2>How a world unfolds</h2><p>Every situation develops from the people inside it.</p></div></div><div class="flow-grid">${[[16,"Choose a World","Pick a world that excites you and read its situation."],[17,"Take a Role","Receive your role identity, briefing, relationships, and private information."],[18,"Learn Your Side","Understand what you know, what you don't, and your motivation."],[19,"Make Your Decision","Talk, investigate, negotiate, cooperate, or act, on your own terms."],[20,"Watch the World Respond","AI simulates how every character and event evolves."],[21,"See Where It Leads","Discover the outcome together and review how it all came to be."]].map(([i,t,c],idx)=>`<article><span class="flow-number">${idx+1}</span>${icon(i)}<b>${t}</b><p>${c}</p></article>`).join("")}</div></section>

      <section class="build-world" id="create"><div><span class="entry-label">Host a shared situation.</span><h2>Open a room, not a script.</h2><p>Choose a world, open a shared room, and give every player a different position, motive, and piece of information.</p><div class="build-tags"><span>${icon(22)} AI-supported roles</span><span>${icon(23)} Shared room setup</span><span>${icon(24)} Review the full outcome</span></div><button class="mw-primary" data-open-rooms>Create a Room</button> <a href="#worlds">Explore World Examples</a></div><div class="overview-card"><h4>Room Overview</h4><p>A republic at a breaking point.<br/>Power, loyalty, and reform.<br/>Every role has a stake.</p><div class="mini-avatars">${[7,8,9,10,11].map((n) => `<img src="${asset("portrait", n)}" alt=""/>`).join("")}</div></div><div class="overview-card tensions"><h4>Room Tensions</h4><p>• Competing loyalties<br/>• Private objectives<br/>• Limited time<br/>• Uncertain outcome</p></div><div class="build-art"></div></section>

      <section class="ending-section mw-panel"><div class="section-head"><div><h2>When the run ends, see what really happened</h2><p>Review the story from every role and uncover how the world changed.</p></div></div><div class="ending-grid"><div class="ending-list">${[[25,"Your decision trail","See what you did and why."],[26,"Major turning points","Key moments that changed everything."],[27,"Hidden information revealed","Discover what others knew and kept secret."],[28,"Relationship changes","See how alliances and rivalries evolved."],[29,"A shareable world recap","Export the full run to read or share."]].map(([i,t,c])=>`<article>${icon(i)}<span><b>${t}</b><small>${c}</small></span></article>`).join("")}</div><div class="impact-card"><span>${icon(30)}</span><b>Example impact</b><p>You convinced the board to delay the succession vote.</p><strong>Two weeks later,<br/>the founder resigned.</strong><em>Consequence unlocked</em></div></div></section>

      <section class="faq-section mw-panel" id="faq"><div class="faq-layout"><div class="faq-intro"><span class="entry-label">FAQ</span><h2>Everything you need before the first decision.</h2><p>Many Worlds is a shared, AI-powered story room. Choose a role, bring in your group, and let the outcome emerge from what everyone does.</p><div class="faq-notes"><article><span>${icon(14)}</span><div><b>Start Solo</b><small>AI fills the remaining roles while you learn the world.</small></div></article><article><span>${icon(42)}</span><div><b>Invite your group</b><small>One participant unlocks the room; invited players join the same outcome.</small></div></article><article><span>${icon(43)}</span><div><b>Use World Credits</b><small>The first three decisions are free. 100 Credits unlocks the room; there is no per-turn charge after unlock.</small></div></article></div><a class="mw-secondary faq-cta" href="/credits.html">View World Credits ${icon(3)}</a></div><div class="faq-content"><div class="faq-content-head"><span class="entry-label">Common questions</span><p>Clear answers about worlds, roles, AI, and the Credits wallet.</p></div><div class="faq-grid">${faqItems.map(([q,a]) => `<details><summary>${q}${icon(39)}</summary><p>${a}</p></details>`).join("")}</div></div></div></section>

      <section class="pricing" id="pricing"><div class="section-head pricing-head"><div><span class="entry-label">World Credits</span><h2>One participant unlocks the room. Everyone else can join.</h2><p>The first three decisions are free. Pay once to unlock the shared room; there is no subscription or per-turn charge after unlock.</p></div><a href="/credits.html">Open Credits wallet ${icon(3)}</a></div><div class="price-grid credit-grid"><article><small>New player bonus</small><h3>50 <span>Bonus Credits</span></h3><p>Verify your account and claim 50 Bonus Credits to start exploring. Bonus Credits expire after 90 days.</p><a class="mw-secondary" href="/credits.html">Claim your bonus</a></article><article class="price-highlight"><small>Shared room unlock</small><h3>100 <span>Credits / room</span></h3><p>The first three decisions are free. One participant unlocks the complete room for every role; after unlock, actions and AI turns are not charged separately.</p><button class="mw-primary" data-open-world>Open a World</button></article><article><small>Purchase a pack</small><h3>300 <span>Credits · $7.99</span></h3><p>Need more for your next room? Choose 650 Credits for $14.99. Purchased Credits never expire.</p><a class="mw-primary" href="/credits.html">Buy World Credits</a></article><article class="one-time"><b>Earn Bonus Credits with qualified invites.</b><p>Get 25 Bonus Credits after a new friend verifies and completes the opening. Up to two reward slots. Sharing alone does not grant credits.</p><a class="mw-secondary" href="/credits.html">View bonus rules</a></article></div></section>
    </main>
    ${renderLegalFooter()}
  </div>`;
}

function renderHeroCarousel(activeIndex) {
  const cardAt = (offset) => carouselWorlds[(activeIndex + offset + carouselWorlds.length) % carouselWorlds.length];
  return `<div class="world-carousel" data-carousel aria-label="Featured worlds" aria-live="polite">
    <div class="world-peek left">${renderWorldCard(cardAt(-2), "peek", true)}</div>
    <div class="world-peek">${renderWorldCard(cardAt(-1), "peek", true)}</div>
    <div class="world-featured">${renderWorldCard(cardAt(0), "featured", true)}</div>
    <div class="world-peek">${renderWorldCard(cardAt(1), "peek", true)}</div>
    <div class="world-peek right">${renderWorldCard(cardAt(2), "peek", true)}</div>
    <div class="carousel-controls"><button type="button" data-carousel-prev aria-label="Previous world">${icon(8)}</button>${carouselWorlds.map((world, index) => `<i class="${index === activeIndex ? "active" : ""}" aria-label="${world.title}"></i>`).join("")}<button type="button" data-carousel-next aria-label="Next world">${icon(9)}</button></div>
  </div>`;
}
function renderHeader() { return `<header class="mw-header"><a class="mw-brand" href="/"><img src="${LOGO_ASSET}" alt="Many Worlds logo"/><span>Many Worlds<small>AI-powered story rooms</small></span></a><nav><a class="active" href="#worlds">Explore Worlds</a><a href="#create">Create</a><a href="#how-it-works">How It Works</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a></nav><div class="header-right"><a class="login" href="/auth?returnTo=%2F">Log in</a><button class="get-started" data-open-world>Get started</button></div><button class="menu-button" data-menu aria-label="Open menu">☰</button><div class="mobile-nav"><a href="#worlds">Explore Worlds</a><a href="#create">Create</a><a href="#how-it-works">How It Works</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a><a href="/auth?returnTo=%2F">Log in</a></div></header>`; }
function renderWorldCard(world, variant, clean = false) { return `<article class="world-card ${variant}${clean ? " hero-card" : ""}" style="--cover:url('${asset("bg", world.image)}')">${clean ? "" : `<span class="world-category">${world.category}</span>`}<div><h3>${world.title}</h3>${clean ? "" : `<p>${world.copy}</p>${variant === "featured" ? `<span class="featured-people">${[1,2,3,4,5].map((n) => `<img src="${asset("portrait", n)}" alt=""/>`).join("")}</span>` : ""}<small>${icon(5)} ${world.meta}</small>`}</div></article>`; }
function renderFooter() { return `<footer class="mw-footer"><div class="footer-brand"><img src="${LOGO_ASSET}" alt="Many Worlds logo"/><b>Many Worlds</b><p>Complex worlds.<br/>Human choices.<br/>No fixed ending.</p></div><div><b>Product</b><a href="#worlds">Explore Worlds</a><a href="#how-it-works">How It Works</a><a href="#flow">Pricing</a><a href="#worlds">Create</a></div><div><b>Company</b><a href="#explore">About</a><a href="#explore">Contact</a><a href="#explore">Creators</a><a href="#explore">Careers</a></div><div><b>Support</b><a href="#faq">Help Center</a><a href="#faq">Community</a><a href="#faq">Status</a></div><div><b>Legal</b><a href="#explore">Terms of Service</a><a href="#explore">Privacy Policy</a><a href="#explore">Accessibility</a></div><div class="footer-social">${icon(32)} ${icon(33)} ${icon(34)} ${icon(35)} ${icon(36)}<small>© 2024 Many Worlds. All rights reserved.</small></div></footer>`; }

function renderLegalFooter() { return `<footer class="mw-footer"><div class="footer-brand"><img src="${LOGO_ASSET}" alt="Many Worlds logo"/><b>Many Worlds</b><p>Complex worlds.<br/>Human choices.<br/>No fixed ending.</p></div><div><b>Product</b><a href="#worlds">Explore Worlds</a><a href="#how-it-works">How It Works</a><a href="#pricing">World Credits</a><a href="/rooms?worldId=caesar">Open a Room</a></div><div><b>Play</b><a href="/role-select?story=caesar">Start Solo</a><a href="/rooms?worldId=caesar">Invite a Group</a><a href="/auth?returnTo=%2F">Sign in</a><a href="#faq">FAQ</a></div><div><b>Credits</b><a href="/credits.html">Credits wallet</a><a href="#pricing">Bonus Credits</a><a href="/credits.html#invite">Invite rules</a></div><div><b>Legal</b><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="/refund">Refund Policy</a></div><div class="footer-social">${icon(32)} ${icon(33)} ${icon(34)} ${icon(35)} ${icon(36)}<small>© 2026 Many Worlds. All rights reserved.</small></div></footer>`; }

if (typeof window !== "undefined" && typeof document !== "undefined" && !window.__AI_STORY_DISABLE_AUTO_BOOT__) {
  const root = document.getElementById("homeApp");
  if (root) createHomeApp({ root, window });
}
