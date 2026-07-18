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
    { id: "caesar", firstRole: "brutus", selectedRole: "caesar" },
    { id: "sangtian", firstRole: "zhejiang_governor", selectedRole: "xunfu" }
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
      localStorage: { setItem: (key, value) => storedRuns.set(key, value) }
    };
    const banner = `/assets/game/${world.id}/room-banner.png`;
    const firstPortrait = `/assets/game/${world.id}/${world.firstRole}.png`;
    const fetchImpl = async (url, options = {}) => {
      requests.push({ url, options });
      const payload = options.method === "POST"
        ? { id: `solo-${world.id}` }
        : {
            id: world.id,
            title: `Title ${world.id}`,
            roleSelectionBanner: banner,
            roles: [
              { key: world.firstRole, name: "First", portrait: firstPortrait, playableSolo: true },
              { key: world.selectedRole, name: "Second", portrait: `/assets/game/${world.id}/second.png`, playableSolo: true }
            ]
          };
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    };

    const app = createRoleSelectApp({ root: dom.window.document.querySelector("#roleApp"), window: browserWindow, fetchImpl });
    await app.boot();
    assert.equal(dom.window.document.querySelector(".mw-room-banner")?.getAttribute("src"), banner);
    assert.equal(dom.window.document.querySelector(".mw-room-role-card img")?.getAttribute("src"), firstPortrait);
    app.selectRole(world.selectedRole);
    await app.createRun();

    assert.equal(requests[0].url, `/api/v4/worlds/${world.id}`);
    assert.equal(requests[1].url, "/api/v4/rooms/solo");
    assert.equal(requests[1].options.method, "POST");
    assert.equal(requests[1].options.credentials, "include");
    assert.deepEqual(JSON.parse(requests[1].options.body), { worldId: world.id, roleKey: world.selectedRole });
    assert.deepEqual([...storedRuns.values()], [`solo-${world.id}`]);
    assert.equal(location.href, `/game?runId=solo-${world.id}`);
    dom.window.close();
  }
});

test("three-role and six-role inputs keep intrinsic Caesar-sized grid rows", async () => {
  const css = await readFile(new URL("../public/room-role-selection.css", import.meta.url), "utf8");
  assert.match(css, /\.mw-room-role-grid\s*\{[^}]*grid-auto-rows:\s*max-content;[^}]*align-content:\s*start;[^}]*align-self:\s*start;/s);

  const three = renderRoomSelectionPage({ mode: "multiplayer", worldId: "sangtian", roles, selectedRole: "brutus" });
  const six = renderRoomSelectionPage({ mode: "multiplayer", worldId: "caesar", roles: [...roles, ...roles.map((role, index) => ({ ...role, key: `${role.key}-${index}` }))], selectedRole: "brutus" });
  for (const html of [three, six]) {
    assert.match(html, /class="mw-room-role-grid"/);
    assert.match(html, /class="mw-room-current-choice"/);
  }
});
