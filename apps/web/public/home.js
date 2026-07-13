const worlds = [
  { title: "The Silver Crisis", category: "History & Power", copy: "Navigate a dynasty's financial storm before rebellion tears the empire apart.", image: 2, meta: "4–6 roles · 2–4h" },
  { title: "The Succession Room", category: "Business & Work", copy: "The founder is stepping down. The board is divided. Everyone has a different future in mind.", image: 1, meta: "5 roles · 60–90 min", featured: true },
  { title: "The Last Night Shift", category: "Mystery", copy: "Five strangers. One shift. Different truths that never stay buried.", image: 3, meta: "5 roles · 60–90 min" },
  { title: "Ninety Days Left", category: "Crisis & Survival", copy: "Your company has 90 days to prove it can survive.", image: 4, meta: "4–6 roles · 60–90 min" },
  { title: "The Inheritance Table", category: "Relationships", copy: "Family. Fortune. One table. Everything changes at the reading.", image: 8, meta: "4–6 roles · 60–90 min" },
  { title: "Blackout Protocol", category: "Speculative Futures", copy: "A citywide blackout. Resources fade fast. Trust fades faster.", image: 5, meta: "4–6 roles · 60–90 min" },
  { title: "The Hidden Files", category: "Mystery", copy: "Old files. Cold cases. Secrets that someone still wants hidden.", image: 6, meta: "4–6 roles · 60–90 min" },
  { title: "Love in Parallel", category: "Relationships", copy: "In another timeline, you made a different choice. What if?", image: 7, meta: "3–4 roles · 60–90 min" }
];

const featurePoints = [
  ["17-user-role", "Different roles, different truths", "Each player sees only what their role would realistically know."],
  ["18-eye", "Private motives", "Everyone enters with their own goals, pressures, relationships, and limits."],
  ["11-branching-choice", "Decisions in your own words", "Negotiate, persuade, cooperate, or act, on your own terms."],
  ["05-users", "One shared world", "All actions have real effects through relationships, resources, secrets, and the wider situation."],
  ["13-infinity", "No preset ending", "Outcomes emerge from what everyone does."],
];

function asset(group, index) {
  const normalized = String(index).match(/^\d+/)?.[0] || String(index);
  return `/assets/${group}/${normalized}.png`;
}
function icon(index, label = "") { return `<img class="mw-icon" src="${asset("icon", index)}" alt="${label}" aria-hidden="${label ? "false" : "true"}" />`; }

export function createHomeApp({ root, window: browserWindow = globalThis.window } = {}) {
  if (!root) throw new TypeError("createHomeApp requires a root element");
  const gotoSolo = () => {
    const host = String(browserWindow.location?.hostname || "");
    const local = /^(127\.0\.0\.1|localhost)$/i.test(host) || browserWindow.location?.port === "5178";
    const configuredApiBase = new URLSearchParams(String(browserWindow.location?.search || "")).get("apiBase");
    const apiBase = configuredApiBase || (local ? "http://localhost:3001/api" : "");
    const api = apiBase ? `&apiBase=${encodeURIComponent(apiBase)}` : "";
    browserWindow.location.href = `/role-select?story=sangtian${api}`;
  };
  const render = () => {
    root.innerHTML = renderPage();
    root.querySelectorAll("[data-start-solo]").forEach((button) => button.addEventListener("click", gotoSolo));
    root.querySelector("[data-menu]")?.addEventListener("click", () => root.querySelector(".mobile-nav")?.classList.toggle("is-open"));
  };
  render();
  return { render, startSolo: gotoSolo };
}

function renderPage() {
  return `<div class="many-worlds-page">
    ${renderHeader()}
    <main>
      <section class="mw-hero" id="explore">
        <div class="hero-copy">
          <span class="eyebrow">AI-POWERED MULTIPLAYER SIMULATIONS</span>
          <h1>Every situation<br/>looks <em>different</em><br/>from the inside.</h1>
          <p>Step into complex worlds with other people. Each of you takes a different role, sees a different part of the truth, and makes decisions in your own words. AI simulates how the shared situation unfolds.</p>
          <div class="hero-actions"><button class="mw-primary" data-start-solo>Explore Worlds ${icon(3)}</button><a class="mw-secondary" href="#how-it-works">${icon(4)} See How It Works</a></div>
          <div class="hero-proof"><span>${icon(5)} Solo or Multiplayer</span><span>${icon(6)} Different information for every role</span><span>${icon(7)} No fixed storyline</span></div>
        </div>
        <div class="world-carousel" aria-label="Featured worlds">
          <div class="world-peek left">${renderWorldCard(worlds[0], "peek")}</div>
          <div class="world-peek">${renderWorldCard(worlds[2], "peek")}</div>
          <div class="world-featured">${renderWorldCard(worlds[1], "featured")}</div>
          <div class="world-peek">${renderWorldCard(worlds[3], "peek")}</div>
          <div class="world-peek right">${renderWorldCard(worlds.find((world) => world.title === "Blackout Protocol"), "peek")}</div>
          <div class="carousel-controls"><button aria-label="Previous world">${icon(8)}</button><i></i><i></i><i class="active"></i><i></i><button aria-label="Next world">${icon(9)}</button></div>
        </div>
      </section>

      <section class="worlds-section mw-panel" id="worlds">
        <div class="section-head"><div><h2>Worlds worth stepping into</h2><p>History, business, work, relationships and crisis—each world begins with a situation already in motion.</p></div><a href="#worlds">View all worlds ${icon(3)}</a></div>
        <div class="world-filters"><button class="active">All Worlds</button><button>History &amp; Power</button><button>Business &amp; Work</button><button>Mystery</button><button>Crisis &amp; Survival</button><button>Speculative Futures</button><button>Relationships</button></div>
        <div class="world-grid">${worlds.map((world) => renderWorldCard(world, "grid")).join("")}</div>
      </section>

      <section class="principles" id="how-it-works"><h2>Not a story with branches. <span>A situation with people.</span></h2><p>The opening is designed. Everything after that emerges from what everyone does.</p><div class="principle-grid">${featurePoints.map(([i, title, copy]) => `<article>${icon(i)}<b>${title}</b><p>${copy}</p></article>`).join("")}</div></section>

      <section class="entry-grid"><article class="entry-card solo"><div><span class="entry-label">Enter alone.</span><h2>Start Solo</h2><p>Step into any world immediately, AI-controlled characters fill the remaining roles while you own the pace.</p><ul><li>Start instantly</li><li>Explore any role</li><li>Pause and continue later</li><li>Ideal for learning a world</li></ul><button class="mw-primary" data-start-solo>Start Solo</button></div><div class="role-stack"><div class="role-ghost portrait-01"></div><div class="role-ghost portrait-02"></div><div class="role-main portrait-03"><span>${icon(14)}</span></div></div></article><article class="entry-card invite"><div><span class="entry-label">Bring others in</span><h2>Invite Others</h2><p>Invite real people to take the other roles. Everyone receives different information and makes decisions from their own position.</p><ul><li>Private role briefings</li><li>Live or asynchronous sessions</li><li>Independent decisions</li><li>One shared outcome</li></ul><button class="mw-secondary" data-start-solo>Invite Your Group ${icon(3)}</button></div><div class="avatar-orbit">${[1,2,3,4,5,6].map((n) => `<img src="${asset("portrait", n)}" alt=""/>`).join("")}<span>${icon(42)}</span></div></article></section>

      <section class="flow-section mw-panel" id="flow"><div class="section-head"><div><h2>How a world unfolds</h2><p>Every situation develops from the people inside it.</p></div></div><div class="flow-grid">${[[16,"Choose a World","Pick a world that excites you and read its situation."],[17,"Take a Role","Receive your role identity, briefing, relationships, and private information."],[18,"Learn Your Side","Understand what you know, what you don't, and your motivation."],[19,"Make Your Decision","Talk, investigate, negotiate, cooperate, or act, on your own terms."],[20,"Watch the World Respond","AI simulates how every character and event evolves."],[21,"See Where It Leads","Discover the outcome together and review how it all came to be."]].map(([i,t,c],idx)=>`<article><span class="flow-number">${idx+1}</span>${icon(i)}<b>${t}</b><p>${c}</p></article>`).join("")}</div></section>

      <section class="build-world"><div><span class="entry-label">Create your own situation</span><h2>Build a world, not a script.</h2><p>Define the setting, roles, tensions, resources, secrets and rules. Leave the future open.</p><div class="build-tags"><span>${icon(22)} AI-assisted world building</span><span>${icon(23)} Flexible rules &amp; scenarios</span><span>${icon(24)} Share privately or publish</span></div><button class="mw-primary" data-start-solo>Create a World</button><a href="#worlds">View Creator Examples</a></div><div class="overview-card"><h4>World Overview</h4><p>A boardroom at a global company.<br/>Leadership change ahead.<br/>Divided priorities.</p><div class="mini-avatars">${[7,8,9,10,11].map((n) => `<img src="${asset("portrait", n)}" alt=""/>`).join("")}</div></div><div class="overview-card tensions"><h4>World Tensions</h4><p>• Power transition<br/>• Conflicting visions<br/>• Divided priorities<br/>• Limited time</p></div><div class="build-art"></div></section>

      <section class="ending-section mw-panel"><div class="section-head"><div><h2>When the world ends, see what really happened</h2><p>Review the story from all sides and uncover the full picture.</p></div></div><div class="ending-grid"><div class="ending-list">${[[25,"Your decision trail","See what you did and why."],[26,"Major turning points","Key moments that changed everything."],[27,"Hidden information revealed","Discover what others knew and kept secret."],[28,"Relationship changes","Explore alliances and rivalries evolved."],[29,"A shareable world recap","Export a full summary to read or share."]].map(([i,t,c])=>`<article>${icon(i)}<span><b>${t}</b><small>${c}</small></span></article>`).join("")}</div><div class="impact-card"><span>${icon(30)}</span><b>Example impact</b><p>You pushed the investor to delay funding.</p><strong>Two weeks later,<br/>the CFO resigned.</strong><em>Consequence unlocked</em></div><div class="faq"><h3>Frequently asked questions</h3>${["Are the stories prewritten?","Can I enter a world alone?","Do we need to be online at the same time?","What does AI do?","Is Many Worlds only about history?","Do invited participants need to pay?"].map((q) => `<details><summary>${q}${icon(39)}</summary><p>Each world begins with a designed situation. The shared outcome is generated from roles, information and decisions.</p></details>`).join("")}</div></div></section>

      <section class="pricing"><div><h2>One host unlocks the world. Everyone else joins.</h2><p>Choose the way you want to experience Many Worlds.</p></div><div class="price-grid"><article><small>Free</small><h3>Explore for free</h3><p>Play one public world, join a public session or explore one AI session.</p><button class="mw-primary" data-start-solo>Get Started Free</button></article><article class="price-highlight"><small>World Pass</small><h3>$9.99 <span>/ world</span></h3><p>Unlock a world for your group.</p><button class="mw-primary" data-start-solo>Unlock a World</button></article><article><small>Many Worlds Plus</small><h3>$19.99 <span>/ month</span></h3><p>Create, host and save worlds with full replay tools.</p><button class="mw-primary" data-start-solo>Start Plus</button></article><article class="one-time"><b>Prefer one-time adventures?</b><p>Unlock any world without a subscription.</p><button class="mw-secondary" data-start-solo>Unlock a World</button></article></div></section>
    </main>
    ${renderLegalFooter()}
  </div>`;
}

function renderHeader() { return `<header class="mw-header"><a class="mw-brand" href="/"><img src="${asset("icon", 1)}" alt=""/><span>Many Worlds<small>AI-powered social simulations</small></span></a><nav><a class="active" href="#explore">Explore Worlds</a><a href="#worlds">Create</a><a href="#how-it-works">How It Works</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a></nav><div class="header-right"><button class="language">${icon(2)} English⌄</button><a class="login" href="#explore">Log in</a><button class="get-started" data-start-solo>Get started</button></div><button class="menu-button" data-menu aria-label="Open menu">☰</button><div class="mobile-nav"><a href="#explore">Explore Worlds</a><a href="#worlds">Create</a><a href="#how-it-works">How It Works</a></div></header>`; }
function renderWorldCard(world, variant) { return `<article class="world-card ${variant}" style="--cover:url('${asset("bg", world.image)}')"><span class="world-category">${world.category}</span><div><h3>${world.title}</h3><p>${world.copy}</p>${variant === "featured" ? `<span class="featured-people">${[1,2,3,4,5].map((n) => `<img src="${asset("portrait", n)}" alt=""/>`).join("")}</span>` : ""}<small>${icon(5)} ${world.meta}</small></div></article>`; }
function renderFooter() { return `<footer class="mw-footer"><div class="footer-brand"><img src="${asset("icon", 1)}" alt=""/><b>Many Worlds</b><p>Complex worlds.<br/>Human choices.<br/>No fixed ending.</p></div><div><b>Product</b><a href="#worlds">Explore Worlds</a><a href="#how-it-works">How It Works</a><a href="#flow">Pricing</a><a href="#worlds">Create</a></div><div><b>Company</b><a href="#explore">About</a><a href="#explore">Contact</a><a href="#explore">Creators</a><a href="#explore">Careers</a></div><div><b>Support</b><a href="#faq">Help Center</a><a href="#faq">Community</a><a href="#faq">Status</a></div><div><b>Legal</b><a href="#explore">Terms of Service</a><a href="#explore">Privacy Policy</a><a href="#explore">Accessibility</a></div><div class="footer-social">${icon(32)} ${icon(33)} ${icon(34)} ${icon(35)} ${icon(36)}<small>© 2024 Many Worlds. All rights reserved.</small></div></footer>`; }

function renderLegalFooter() { return `<footer class="mw-footer"><div class="footer-brand"><img src="${asset("icon", 1)}" alt=""/><b>Many Worlds</b><p>Complex worlds.<br/>Human choices.<br/>No fixed ending.</p></div><div><b>Product</b><a href="#worlds">Explore Worlds</a><a href="#how-it-works">How It Works</a><a href="#flow">Pricing</a><a href="#worlds">Create</a></div><div><b>Company</b><a href="#explore">About</a><a href="#explore">Contact</a><a href="#explore">Creators</a><a href="#explore">Careers</a></div><div><b>Support</b><a href="#faq">Help Center</a><a href="#faq">Community</a><a href="#faq">Status</a></div><div><b>Legal</b><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="/refund">Refund Policy</a></div><div class="footer-social">${icon(32)} ${icon(33)} ${icon(34)} ${icon(35)} ${icon(36)}<small>© 2026 Many Worlds. All rights reserved.</small></div></footer>`; }

if (typeof window !== "undefined" && typeof document !== "undefined" && !window.__AI_STORY_DISABLE_AUTO_BOOT__) {
  const root = document.getElementById("homeApp");
  if (root) createHomeApp({ root, window });
}
