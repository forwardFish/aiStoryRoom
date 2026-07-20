import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createRoleSelectApp } from "../public/role-select.js";
import { renderRoomSelectionPage, roomRoleArtwork } from "../public/room-role-selection-view.js";

const roles = [
  { key: "brutus", name: "Brutus", tagline: "The conspirator", traits: ["Resolve"], selected: true },
  { key: "caesar", name: "Caesar", tagline: "The dictator", disabled: true },
  { key: "cicero", name: "Cicero", tagline: "The orator" }
];

test("solo and multiplayer render the same shared room role-selection skeleton", () => {
  const solo = renderRoomSelectionPage({ mode: "solo", worldId: "caesar", title: "The Ides", roles, selectedRole: "brutus" });
  const multiplayer = renderRoomSelectionPage({ mode: "multiplayer", worldId: "caesar", title: "The Ides", roles, selectedRole: "brutus", players: [{ name: "Ada", ready: true }], inviteCode: "ROME42", isHost: true });

  for (const html of [solo, multiplayer]) {
    assert.match(html, /class="mw-room-page"/);
    assert.match(html, /mw-room-header/);
    assert.match(html, /mw-room-info/);
    assert.match(html, /mw-room-role-grid/);
    assert.match(html, /mw-room-current-choice/);
    assert.match(html, /data-room-role-key="brutus"/);
  }
  assert.match(solo, /id="enterRole"/);
  assert.doesNotMatch(solo, /mw-room-roster/);
  assert.match(multiplayer, /mw-room-roster/);
  assert.match(multiplayer, /Invite code/);
  assert.match(multiplayer, /data-action="share-invite"/);
  assert.match(multiplayer, /data-action="ready"/);
  assert.match(multiplayer, /data-action="start-game"/);
  assert.doesNotMatch(solo, /mw-room-brand|mw-room-back/);
  assert.match(solo, /mw-room-button mw-room-button-secondary" href="\/"/);
});

test("role status and disabled controls communicate selected, taken, and available states", () => {
  const html = renderRoomSelectionPage({ mode: "multiplayer", worldId: "caesar", roles, selectedRole: "brutus", isHost: false });
  assert.match(html, /mw-room-role-card is-selected/);
  assert.match(html, />Selected</);
  assert.match(html, /mw-room-role-card is-taken is-disabled/);
  assert.match(html, />Taken</);
  assert.match(html, />Available</);
  assert.match(html, /data-room-role-key="caesar"[^>]*aria-pressed="false" disabled/);
  assert.doesNotMatch(html, /data-action="start-game"/);
});

test("dynamic room role content is escaped in text and attributes", () => {
  const html = renderRoomSelectionPage({
    mode: "multiplayer", title: '<img src=x onerror=1>', inviteCode: 'A" onfocus="x',
    roles: [{ key: 'x" onclick="x', name: "<script>alert(1)</script>", artwork: '" onerror="x', selected: true }],
    players: [{ name: "<b>Player</b>" }], isHost: true
  });
  assert.doesNotMatch(html, /<script>|onerror="x|onclick="x/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /data-room-role-key="x&quot; onclick=&quot;x"/);
  assert.match(html, /src="&quot; onerror=&quot;x"/);
  assert.match(html, /&lt;b&gt;Player&lt;\/b&gt;/);
});

test("the shared component has no world-specific artwork lookup", async () => {
  const source = await readFile(new URL("../public/room-role-selection-view.js", import.meta.url), "utf8");
  const soloCss = await readFile(new URL("../public/role-select.css", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CAESAR_ARTWORK|SANGTIAN_ARTWORK|worldId === ["'](?:caesar|sangtian)/);
  assert.doesNotMatch(soloCss, /assets\/game\/(?:caesar|sangtian)|art-zhejiang|role-card-grid|story-banner/);
  assert.equal(roomRoleArtwork("caesar", "brutus", 8), "/assets/portrait/2.png");
  assert.equal(roomRoleArtwork("sangtian", "zhejiang_governor", 8), "/assets/portrait/2.png");
  assert.equal(roomRoleArtwork("other", "unknown", 8), "/assets/portrait/2.png");
});

test("both worlds use one Solo flow and render standard banner and portrait inputs", async () => {
  for (const world of [
    {
      id: "caesar", selectedRole: "caesar",
      roles: ["brutus", "caesar", "cassius", "mark_antony", "decimus", "cicero"].map((key) => ({ key, portrait: `/assets/game/caesar/${key.replace("_", "-")}.png` }))
    },
    {
      id: "sangtian", selectedRole: "xunfu",
      roles: [
        ["zhejiang_governor", "/assets/game/sangtian/generated/role-governor-scene-v1.png"],
        ["xunfu", "/assets/game/sangtian/generated/role-xunfu-scene-v1.png"],
        ["county_magistrate", "/assets/game/sangtian/generated/governor-scene-v1.png"],
        ["clerk", "/assets/game/sangtian/generated/role-clerk-scene-v1.png"],
        ["merchant", "/assets/game/sangtian/generated/role-merchant-scene-v1.png"],
        ["sili_jian", "/assets/game/sangtian/generated/role-spy-scene-v1.png"]
      ].map(([key, portrait]) => ({ key, portrait }))
    }
  ]) {
    const dom = new JSDOM('<!doctype html><main id="roleApp"></main>');
    const requests = [];
    const storedRuns = new Map();
    const location = {
      href: `http://127.0.0.1:5178/role-select?story=${world.id}`,
      hostname: "127.0.0.1",
      search: `?story=${world.id}`
    };
    const browserWindow = {
      location,
      localStorage: {
        getItem: (key) => storedRuns.get(key) || null,
        setItem: (key, value) => storedRuns.set(key, value),
        removeItem: (key) => storedRuns.delete(key)
      }
    };
    const banner = `/assets/game/${world.id}/room-banner.png`;
    const firstPortrait = world.roles[0].portrait;
    const fetchImpl = async (url, options = {}) => {
      requests.push({ url, options });
      const payload = options.method === "POST"
        ? { runId: `solo-${world.id}`, roomId: `solo-${world.id}` }
        : {
            id: world.id,
            title: `Title ${world.id}`,
            presentation: { sceneBackground: banner },
            roles: world.roles.map((role, index) => ({ ...role, name: `Role ${index + 1}`, publicInfo: `Public role ${index + 1}`, playableSolo: true }))
          };
      return new Response(JSON.stringify(payload), { status: options.method === "POST" ? 201 : 200, headers: { "content-type": "application/json" } });
    };

    const app = createRoleSelectApp({ root: dom.window.document.querySelector("#roleApp"), window: browserWindow, fetchImpl });
    await app.boot();
    assert.equal(dom.window.document.querySelector(".mw-room-banner")?.getAttribute("src"), banner);
    assert.equal(dom.window.document.querySelector(".mw-room-role-card img")?.getAttribute("src"), firstPortrait);
    assert.equal(dom.window.document.querySelector(".mw-room-role-card em")?.textContent, "Public role 1");
    assert.equal(dom.window.document.querySelectorAll(".mw-room-role-card").length, 6);
    app.selectRole(world.selectedRole);
    await app.createRun();

    assert.equal(requests[0].url, `/api/v4/worlds/${world.id}`);
    assert.equal(requests[1].url, "/api/v4/rooms/solo");
    assert.equal(requests[1].options.method, "POST");
    assert.equal(requests[1].options.credentials, "include");
    const createBody = JSON.parse(requests[1].options.body);
    assert.deepEqual({ worldId: createBody.worldId, roleKey: createBody.roleKey }, { worldId: world.id, roleKey: world.selectedRole });
    assert.match(createBody.idempotencyKey, /^solo-create:/);
    assert.deepEqual([...storedRuns.values()], [`solo-${world.id}`]);
    assert.equal(location.href, `/game?runId=solo-${world.id}`);
    dom.window.close();
  }
});

test("a failed Solo request reuses its idempotency key and accepts roomId on retry", async () => {
  const dom = new JSDOM('<!doctype html><main id="roleApp"></main>');
  const values = new Map();
  const postBodies = [];
  const location = { href: "http://game.test/role-select?story=sangtian", hostname: "game.test", search: "?story=sangtian" };
  const browserWindow = {
    location,
    crypto: { randomUUID: () => "retry-key-0000-0000-0000-000000000001" },
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key)
    }
  };
  const fetchImpl = async (_url, options = {}) => {
    if (options.method !== "POST") {
      return new Response(JSON.stringify({
        id: "sangtian", title: "嘉靖财政危局",
        roles: [{ key: "zhejiang_governor", name: "浙江总督", playableSolo: true }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    postBodies.push(JSON.parse(options.body));
    if (postBodies.length === 1) return new Response(JSON.stringify({ message: "temporary failure" }), { status: 503, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ roomId: "solo-replayed" }), { status: 201, headers: { "content-type": "application/json" } });
  };

  const app = createRoleSelectApp({ root: dom.window.document.querySelector("#roleApp"), window: browserWindow, fetchImpl });
  await app.boot();
  await app.createRun();
  assert.equal(app.getState().busy, false);
  await app.createRun();

  assert.equal(postBodies.length, 2);
  assert.equal(postBodies[0].idempotencyKey, postBodies[1].idempotencyKey);
  assert.equal(postBodies[0].idempotencyKey, "solo-create:retry-key-0000-0000-0000-000000000001");
  assert.equal(location.href, "/game?runId=solo-replayed");
  dom.window.close();
});

test("start=new explicitly creates a fresh Solo run instead of resuming the active one", async () => {
  const dom = new JSDOM('<!doctype html><main id="roleApp"></main>');
  const location = { href: "http://game.test/role-select?story=sangtian&start=new", hostname: "game.test", search: "?story=sangtian&start=new" };
  let createBody = null;
  const browserWindow = {
    location,
    crypto: { randomUUID: () => "fresh-run-0000-0000-0000-000000000001" },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  };
  const fetchImpl = async (_url, options = {}) => {
    if (options.method === "POST") {
      createBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ runId: "solo-fresh" }), { status: 201, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ id: "sangtian", title: "??????", roles: [{ key: "zhejiang_governor", name: "????", playableSolo: true }] }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const app = createRoleSelectApp({ root: dom.window.document.querySelector("#roleApp"), window: browserWindow, fetchImpl });
  await app.boot();
  await app.createRun();

  assert.equal(createBody.resumeExisting, false);
  assert.equal(location.href, "/game?runId=solo-fresh");
  dom.window.close();
});

test("both six-role multiplayer worlds keep compact cards beside the side panels", async () => {
  const css = await readFile(new URL("../public/room-role-selection.css", import.meta.url), "utf8");
  assert.match(css, /data-room-mode="multiplayer"[^}]*\.mw-room-body\s*\{[^}]*min-height:\s*396px;/s);
  assert.match(css, /data-room-mode="multiplayer"[^}]*\.mw-room-role-card\s*\{[^}]*min-height:\s*198px;/s);
  assert.match(css, /data-room-mode="multiplayer"[^}]*\.mw-room-role-portrait\s*\{[^}]*width:\s*49%;[^}]*height:\s*124px;/s);
  assert.match(css, /data-room-mode="multiplayer"[^}]*\.mw-room-role-status\s*\{[^}]*width:\s*calc\(100%\s*-\s*24px\);[^}]*min-height:\s*44px;/s);
  assert.doesNotMatch(css, /data-room-mode="multiplayer"[^}]*\.mw-room-role-card\s*\{[^}]*height:\s*100%;/s);

  const sixRoles = [...roles, ...roles.map((role, index) => ({ ...role, key: `${role.key}-${index}` }))];
  const sangtian = renderRoomSelectionPage({ mode: "multiplayer", worldId: "sangtian", roles: sixRoles, selectedRole: "brutus" });
  const caesar = renderRoomSelectionPage({ mode: "multiplayer", worldId: "caesar", roles: sixRoles, selectedRole: "brutus" });
  for (const html of [sangtian, caesar]) {
    assert.match(html, /class="mw-room-role-grid"/);
    assert.match(html, /class="mw-room-current-choice"/);
    assert.equal((html.match(/class="mw-room-role-card/g) || []).length, 6);
  }
});
