import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createStoryApp } from "../public/app.js";
import { bootGamePage } from "../public/game-bootstrap.js";
import { RoomStoryStorage } from "../public/room-story-storage.js";

const roomModel = ({ mine = "role-xunfu", isHost = false, submittedRoleIds = [] } = {}) => ({
  completed: false,
  submittedRoleIds,
  access: { requiresUnlock: false },
  currentNode: { id: "node-1", nodeIndex: 1, title: "改桑急令", publicNarration: "巡抚的奏疏已经摆在案前。三方必须分别做出判断。", nodeGoal: "确认执行边界并保留复核证据。", actionOptions: ["保留证据并交叉核验", "推进本职方案并说明代价", "协调另一位角色的资源"] },
  room: {
    id: "room-1", title: "桑田诏：嘉靖财政危局", worldId: "sangtian", status: "playing", isHost,
    players: [
      { userId: "host", nickname: "two", roleId: "role-governor", roleKey: "zhejiang_governor", roleName: "浙江总督" },
      { userId: "p2", nickname: "one", roleId: "role-xunfu", roleKey: "xunfu", roleName: "浙江巡抚" },
      { userId: "p3", nickname: "three", roleId: "role-magistrate", roleKey: "county_magistrate", roleName: "清流县令" }
    ],
    roles: [
      { id: "role-governor", roleKey: "zhejiang_governor", roleName: "浙江总督", identity: "统筹全局", publicInfo: "稳定皇权、财政与民心。", personalGoal: "守住总督权责", claimedByCurrentUser: mine === "role-governor" },
      { id: "role-xunfu", roleKey: "xunfu", roleName: "浙江巡抚", identity: "交出政绩且不能留下暗账", publicInfo: "负责省内改桑执行。", personalGoal: "完成改桑并自保", claimedByCurrentUser: mine === "role-xunfu" },
      { id: "role-magistrate", roleKey: "county_magistrate", roleName: "清流县令", identity: "保护民田和粮田", publicInfo: "掌握地方田册。", personalGoal: "避免民田被吞没", claimedByCurrentUser: mine === "role-magistrate" }
    ]
  }
});

function createHarness(model) {
  const dom = new JSDOM('<!doctype html><main id="app"></main>', { url: "http://127.0.0.1:5200/game?runId=room-1&debug=1" });
  dom.window.document.cookie = "many_worlds_session_hint=1; Path=/";
  const storage = new RoomStoryStorage({ roomId: "room-1", initialModel: model, fetchImpl: async () => { throw new Error("unexpected fetch"); }, localStorage: dom.window.localStorage });
  const root = dom.window.document.querySelector("#app");
  return { dom, root, app: createStoryApp({ root, window: dom.window, storage }) };
}

test("multiplayer room reuses the original formal game renderer", async () => {
  const harness = createHarness(roomModel());
  await harness.app.boot();

  assert.ok(harness.root.querySelector('[data-testid="story-shell"]'));
  assert.ok(harness.root.querySelector(".causal-left"));
  assert.ok(harness.root.querySelector(".causal-center"));
  assert.ok(harness.root.querySelector(".maneuver-panel"), "the original maneuver center remains present");
  assert.ok(harness.root.querySelector('[data-testid="decision-zone"]'));
  assert.ok(harness.root.querySelector('[data-testid="room-party-panel"]'));
  assert.match(harness.root.querySelector(".player").textContent, /浙江巡抚/);
  assert.match(harness.root.querySelector(".player").textContent, /one/);
  assert.equal(harness.root.querySelector(".room-main-shell"), null, "the removed imitation shell must not render");
  harness.dom.window.close();
});

test("Caesar reuses the same main-game renderer with its own script-backed English world data", async () => {
  const harness = createHarness(caesarRoomModel());
  await harness.app.boot();

  const shell = harness.root.querySelector('[data-testid="story-shell"]');
  assert.ok(shell);
  assert.equal(shell.getAttribute("data-game-locale"), "en");
  assert.match(shell.getAttribute("style"), /assets\/game\/caesar\/room-banner\.png/);
  assert.match(harness.root.querySelector(".player .portrait").getAttribute("style"), /game-player-portrait/);
  assert.match(harness.root.querySelector(".player").textContent, /My Role/);
  assert.match(harness.root.querySelector(".player").textContent, /Marcus Junius Brutus/);
  assert.match(harness.root.querySelector(".status-strip").textContent, /Caesar's Authority\s*78/);
  assert.match(harness.root.querySelector(".status-strip").textContent, /Senate Legitimacy\s*48/);
  assert.match(harness.root.textContent, /Maneuver Board/);
  assert.equal(harness.app.getState().view.run.title, "Caesar: The Last Spring of the Republic");
  assert.doesNotMatch(harness.root.textContent, /杭州总督府|国库银|改桑进度|桑田诏/);
  harness.dom.window.close();
});

test("submitted host sees the formal waiting narrative and can resolve when all players are ready", async () => {
  const model = roomModel({ mine: "role-governor", isHost: true, submittedRoleIds: ["role-governor", "role-xunfu", "role-magistrate"] });
  const harness = createHarness(model);
  await harness.app.boot();

  assert.ok(harness.root.querySelector('[data-testid="room-waiting"]'));
  assert.ok(harness.root.querySelector(".top-context-cluster"));
  assert.ok(harness.root.querySelector(".top-phase-cluster"));
  assert.ok(harness.root.querySelector(".room-stage-card"));
  assert.equal(harness.root.querySelector("[data-room-resolve]").disabled, false);
  assert.equal(harness.root.querySelectorAll("[data-room-resolve]").length, 1, "the host sees one primary round action");
  assert.match(harness.root.querySelector(".room-party-status").textContent, /中央舞台/);
  assert.equal(harness.root.querySelectorAll(".room-formal-party-list article.submitted").length, 3);
  assert.match(harness.root.querySelector(".player").textContent, /浙江总督/);
  harness.dom.window.close();
});

test("game bootstrap injects room storage into the original story app", async () => {
  const dom = new JSDOM('<!doctype html><main id="app"></main>', { url: "http://127.0.0.1:5200/game?runId=room-1" });
  dom.window.document.cookie = "many_worlds_session_hint=1; Path=/";
  const payload = roomModel();
  let storageConstructed = false;
  let formalAppBooted = false;

  await bootGamePage({
    root: dom.window.document.querySelector("#app"), window: dom.window,
    fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }),
    loadRoomStorage: async () => ({ RoomStoryStorage: class { constructor({ initialModel }) { storageConstructed = initialModel?.room?.id === "room-1"; } } }),
    loadSolo: async () => ({ createStoryApp: ({ storage }) => ({ boot: async () => { formalAppBooted = Boolean(storage); }, getState: () => ({ view: null }), refresh: async () => {} }) })
  });

  assert.equal(storageConstructed, true);
  assert.equal(formalAppBooted, true);
  dom.window.dispatchEvent(new dom.window.Event("pagehide"));
  dom.window.close();
});

test("game bootstrap fails closed when an explicit room run does not exist", async () => {
  const dom = new JSDOM('<!doctype html><main id="app"></main>', { url: "http://127.0.0.1:5200/game?runId=missing-room" });
  let soloLoaded = false;
  const result = await bootGamePage({
    root: dom.window.document.querySelector("#app"), window: dom.window,
    fetchImpl: async () => new Response(JSON.stringify({ code: "ROOM_NOT_FOUND" }), { status: 404, headers: { "content-type": "application/json" } }),
    loadRoomStorage: async () => { throw new Error("room storage should not load"); },
    loadSolo: async () => { soloLoaded = true; throw new Error("solo must not load"); }
  });
  assert.equal(result, null);
  assert.equal(soloLoaded, false);
  assert.ok(dom.window.document.querySelector('[data-testid="fatal-error"]'));
  dom.window.close();
});

const caesarWorld = {
  schemaVersion: "game_page_world_v1",
  worldId: "caesar",
  title: "Caesar: The Last Spring of the Republic",
  locale: "en",
  totalStages: 7,
  presentation: {
    locationLabel: "Rome · The Senate", roundLabel: "Scene", finaleLabel: "The Republic's Verdict",
    sceneBackground: "/assets/game/caesar/room-banner.png", accent: "#6b4ce6", accentSoft: "#f3f0ff",
    statusMetrics: [
      { key: "caesar_authority", label: "Caesar's Authority", value: 78, suffix: "", tone: "crown" },
      { key: "senate_legitimacy", label: "Senate Legitimacy", value: 48, suffix: "", tone: "default" },
      { key: "public_support", label: "Public Support", value: 68, suffix: "", tone: "green" },
      { key: "legion_loyalty", label: "Legion Loyalty", value: 72, suffix: "", tone: "gold" },
      { key: "civil_war_risk", label: "Civil War Risk", value: 46, suffix: "", tone: "default" }
    ]
  },
  roles: [{
    roleKey: "brutus", roleName: "Brutus", identity: "A senator torn between friendship and the Republic.",
    publicInfo: "You serve Rome, not any man.", personalGoal: "Prevent an unrestrained dictatorship.",
    currentState: "The Senate is divided.", abilityText: "Build coalitions and set boundaries.", arcText: "From restraint to authorship.",
    knownInfo: ["Senate votes", "Caesar's trust"], cannotDo: ["Command the legions"], portrait: "/assets/game/caesar/brutus.png",
    gameplayProfile: {
      characterName: "Marcus Junius Brutus", rank: "Senator · Urban Praetor", office: "Voice of an old republican house",
      fateQuestion: "Do you oppose a tyrant, or your fear that one might emerge?",
      goals: ["Preserve republican institutions", "Prevent Caesar from becoming king", "Keep Rome from another civil war"],
      resources: [{ label: "Republican Reputation", value: "72" }, { label: "Caesar's Trust", value: "66" }],
      leverage: ["Caesar's pardon and promotion", "Evidence that Cassius is testing you"]
    }
  }]
};

function caesarRoomModel() {
  const role = { id: "role-brutus", ...caesarWorld.roles[0], claimedByCurrentUser: true };
  return {
    world: caesarWorld, completed: false, submittedRoleIds: [], access: { requiresUnlock: false },
    currentNode: {
      id: "caesar-node-1", nodeIndex: 1, title: "The Crown", publicNarration: "Caesar refused the crown, but Rome did not stop fearing a king.",
      nodeGoal: "Decide what the crown ceremony means for the Republic.",
      actionOptions: ["Defend Caesar's refusal", "Demand a public limit", "Question Cassius in private"]
    },
    room: {
      id: "caesar-room", title: caesarWorld.title, worldId: "caesar", world: caesarWorld, status: "playing", isHost: true,
      players: [{ userId: "host", nickname: "lin", roleId: role.id, roleKey: "brutus", roleName: "Brutus" }],
      roles: [role]
    }
  };
}

test("unavailable shared room uses the approved recovery screen", async () => {
  const dom = new JSDOM('<!doctype html><main id="app"></main>', { url: "http://127.0.0.1:5200/game?runId=unavailable-room" });
  await bootGamePage({
    root: dom.window.document.querySelector("#app"), window: dom.window,
    fetchImpl: async () => new Response(JSON.stringify({ code: "SERVICE_UNAVAILABLE" }), { status: 503, headers: { "content-type": "application/json" } })
  });

  const error = dom.window.document.querySelector('[data-testid="fatal-error"]');
  assert.ok(error);
  assert.equal(error.querySelector("h1")?.innerHTML, "Unable to enter the<br>shared story room");
  assert.match(error.textContent, /We can't load this shared story room right now/);
  assert.equal(error.querySelector(".seal"), null);
  assert.equal(error.querySelector("[data-boot-retry]")?.textContent.trim(), "↻Reconnect");
  assert.equal(error.querySelector(".room-back-button")?.getAttribute("href"), "/rooms");
  dom.window.close();
});
