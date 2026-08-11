import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  PressureActionType,
  PressureRuntimeContent,
  PressureRuntimeState,
} from "@ai-story/templates";
import { sha256Canonical } from "./canonical";

type ViewerBuildInput = {
  run: any;
  state: PressureRuntimeState;
  content: PressureRuntimeContent;
  viewerSeatId: string;
  presentationRoot?: string;
};

type PresentationSeat = {
  seatId: string;
  roleKey?: string;
  displayName?: string;
  institutionalMission?: string;
  coreQuestion?: string;
  privateOpening?: string;
  privatePressure?: string;
  keyLeverage?: string;
  defaultPrepare?: string;
  defaultCommit?: string;
  dialogueSeeds?: Array<{ dialogueSeedId?: string; text?: string }>;
};

type PresentationScene = {
  sceneId: string;
  sceneType: string;
  title?: string;
  text?: string;
  visibility?: string;
  knownBy?: string[];
};

const DEFAULT_PRESENTATION_ROOT = path.resolve(
  process.cwd(),
  "packages/templates/config/sangtian/pressure-spine-v1.0/source",
);

const ACTION_PHASE: Partial<Record<PressureRuntimeState["phase"], "PREPARE" | "COMMIT" | "REACTION">> = {
  PREPARE_OPEN: "PREPARE",
  COMMIT_OPEN: "COMMIT",
  REACTION_OPEN: "REACTION",
};

const presentationCache = new Map<string, any>();

export function classifyPressureFreeText(value: string): PressureActionType {
  const text = String(value || "").trim();
  if (!text) return "PLAN";
  if (/(睡|休息|歇|小憩|nap|sleep|rest)/iu.test(text)) return "REST";
  if (/(等一等|暂缓|拖延|不处理|不管|沉默|wait|delay|ignore|do\s+nothing)/iu.test(text)) return "DELAY";
  if (/(调查|查验|核验|查清|追查|inspect|investigate|verify)/iu.test(text)) return "INVESTIGATE";
  if (/(谈判|商议|协商|交涉|议价|negotiate|bargain)/iu.test(text)) return "NEGOTIATE";
  if (/(不行动|放弃回应|pass)/iu.test(text)) return "PASS";
  return "PLAN";
}

export function buildPressureGameProjection(input: ViewerBuildInput): Record<string, unknown> {
  const { run, state, content, viewerSeatId } = input;
  const root = input.presentationRoot || DEFAULT_PRESENTATION_ROOT;
  const presentation = loadPresentation(root, state.nodeId);
  const viewerSeat = presentation.nodeSeats.find((seat: PresentationSeat) => seat.seatId === viewerSeatId)
    || presentation.globalSeats.find((seat: PresentationSeat) => seat.seatId === viewerSeatId)
    || { seatId: viewerSeatId };
  const runtimeSeat = state.seats[viewerSeatId];
  const actionPhase = ACTION_PHASE[state.phase] || null;
  const publicScene = choosePublicScene(presentation.scenes, state, viewerSeatId);
  const privateScene = choosePrivateScene(presentation.scenes, viewerSeatId, viewerSeat);
  const latestActionFeedback = buildLatestActionFeedback(state, viewerSeatId, publicScene);
  const roleByKey = new Map((run.roles || []).map((role: any) => [role.roleKey, role]));
  const controlByRoleId = new Map((run.roleControls || []).map((control: any) => [control.roleId, control]));
  const suggestions = actionPhase ? buildSuggestions(viewerSeat, actionPhase) : [];

  return {
    schemaVersion: "pressure_game_projection_v1",
    runtimeProfile: "SANGTIAN_PRESSURE_SPINE_V1",
    projectionRevision: Number(run.version),
    run: {
      runId: state.runId,
      nodeId: state.nodeId,
      phase: state.phase,
      version: Number(run.version),
      status: run.status,
    },
    player: {
      seatId: viewerSeatId,
      roleKey: viewerSeat.roleKey || runtimeSeat?.roleKey || "",
      displayName: viewerSeat.displayName || viewerSeat.roleKey || viewerSeatId,
      mission: viewerSeat.institutionalMission || "在制度边界内回应当前历史压力。",
      coreQuestion: viewerSeat.coreQuestion || "",
      currentActorId: runtimeSeat?.currentActorId || null,
    },
    publicScene,
    privateScene,
    worldClock: {
      minutes: state.worldTimeMinutes,
      label: formatWorldClock(state.worldTimeMinutes),
    },
    pressure: {
      level: state.pressureLevel,
      triggerLabel: state.phaseDeadlineEpochMs ? `截止 ${new Date(state.phaseDeadlineEpochMs).toISOString()}` : "历史压力继续推进",
    },
    actionSurface: {
      phase: actionPhase,
      suggestedInputs: suggestions,
    },
    seats: content.seatIds.map((seatId) => {
      const runtime = state.seats[seatId];
      const authored = presentation.globalSeats.find((seat: PresentationSeat) => seat.seatId === seatId)
        || presentation.nodeSeats.find((seat: PresentationSeat) => seat.seatId === seatId)
        || { seatId };
      const role = roleByKey.get(runtime?.roleKey) as any;
      const control = controlByRoleId.get(role?.id) as any;
      return {
        seatId,
        displayName: authored.displayName || authored.roleKey || seatId,
        controller: seatId === viewerSeatId ? "HUMAN" : control?.mode?.startsWith("HUMAN") ? "HUMAN" : "AI",
        publicStatus: publicSeatStatus(state, seatId, actionPhase),
      };
    }),
    objects: Object.values(state.objects)
      .filter((object) => object.visibility === "PUBLIC" || object.visibility === "OBSERVABLE" || object.knownBySeatIds.includes(viewerSeatId) || object.custodySeatId === viewerSeatId)
      .map((object) => ({
        objectId: object.objectId,
        versionId: object.versionId,
        status: object.status,
        custodySeatId: object.custodySeatId,
        quantity: object.quantity,
      })),
    evidenceChain: Object.values(state.knowledge)
      .filter((knowledge) => knowledge.knownBySeatIds.includes(viewerSeatId))
      .map((knowledge) => ({ evidenceId: knowledge.factId, objectVersionId: knowledge.objectVersionId, provenance: knowledge.provenance })),
    latestActionFeedback,
    finale: state.phase === "FINALE_COMPUTING" || state.phase === "COMPLETED"
      ? buildFinaleReadModel(state, content)
      : null,
    projectionHash: sha256Canonical({
      runId: state.runId,
      nodeId: state.nodeId,
      phase: state.phase,
      version: run.version,
      viewerSeatId,
      publicSceneId: publicScene.sceneId,
      privateSceneId: privateScene.sceneId,
      latestActionId: latestActionFeedback?.sourceActionIds?.[0] || null,
    }),
  };
}

function loadPresentation(root: string, nodeId: string) {
  const cacheKey = `${root}:${nodeId}`;
  const cached = presentationCache.get(cacheKey);
  if (cached) return cached;
  const global = readJson(path.join(root, "global", "seats.json"));
  const nodeSeats = readJson(path.join(root, "nodes", nodeId, "seat-content.json"));
  const flow = readJson(path.join(root, "nodes", nodeId, "scene-flow.json"));
  const value = {
    globalSeats: Array.isArray(global.seats) ? global.seats : [],
    nodeSeats: Array.isArray(nodeSeats.seats) ? nodeSeats.seats : [],
    scenes: Array.isArray(flow.scenes) ? flow.scenes : [],
  };
  presentationCache.set(cacheKey, value);
  return value;
}

function readJson(filePath: string): any {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function choosePublicScene(scenes: PresentationScene[], state: PressureRuntimeState, viewerSeatId: string) {
  let selected: PresentationScene | undefined;
  if (state.phase === "PREPARE_OPEN") selected = scenes.find((scene) => scene.sceneType === "OPENING" && scene.visibility === "PUBLIC");
  if (state.phase === "COMMIT_OPEN") {
    selected = state.seats[viewerSeatId]?.initiativeLost
      ? scenes.find((scene) => scene.sceneId.includes("lost_initiative"))
      : scenes.find((scene) => scene.sceneType === "AFTER_PREPARE_COMMON");
  }
  if (state.phase === "REACTION_OPEN") selected = scenes.find((scene) => scene.sceneType === "NPC_URGENT") || scenes.find((scene) => scene.sceneType === "COMMIT_CONFRONTATION");
  if (["SETTLING", "FROZEN", "PROJECTING", "FINALE_COMPUTING", "COMPLETED"].includes(state.phase)) {
    const branch = state.frozenResults.find((entry) => entry.nodeId === state.nodeId)?.branchLevel?.toLowerCase();
    selected = scenes.find((scene) => scene.sceneType === "SETTLEMENT_RESULT" && (!branch || scene.sceneId.toLowerCase().includes(branch)))
      || scenes.find((scene) => scene.sceneType === "TRANSITION")
      || selected;
  }
  selected ||= scenes.find((scene) => scene.visibility === "PUBLIC") || scenes[0];
  return {
    sceneId: selected?.sceneId || `scene.${state.nodeId.toLowerCase()}.runtime`,
    title: selected?.title || state.nodeId,
    text: selected?.text || `当前历史压力正在 ${state.nodeId} 推进。`,
  };
}

function choosePrivateScene(scenes: PresentationScene[], viewerSeatId: string, viewerSeat: PresentationSeat) {
  const selected = scenes.find((scene) => scene.sceneType === "PRIVATE_OPENING" && scene.knownBy?.includes(viewerSeatId));
  return {
    sceneId: selected?.sceneId || `private.${viewerSeatId}`,
    title: selected?.title || "席位私密压力",
    text: selected?.text || viewerSeat.privateOpening || viewerSeat.privatePressure || "你只能依据当前席位已经知道的事实行动。",
  };
}

function buildSuggestions(seat: PresentationSeat, phase: "PREPARE" | "COMMIT" | "REACTION") {
  const authored = phase === "PREPARE" ? seat.defaultPrepare : seat.defaultCommit;
  const candidates = [
    authored,
    seat.keyLeverage,
    ...(seat.dialogueSeeds || []).map((seed) => seed.text),
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const unique = [...new Set(candidates)].slice(0, 3);
  while (unique.length < 2) unique.push(unique.length ? "暂不追加命令，但承担时间推进的后果" : "先核实当前现场再作决定");
  return unique.map((displayText, index) => ({
    id: `suggestion.${seat.seatId}.${phase.toLowerCase()}.${index + 1}`,
    displayText,
    requiresPreview: true,
  }));
}

function publicSeatStatus(state: PressureRuntimeState, seatId: string, actionPhase: string | null): string {
  if (!actionPhase) return ["FINALE_COMPUTING", "COMPLETED"].includes(state.phase) ? "FROZEN" : "LOCKED";
  const actionId = state.actionIdBySeatSlot[`${state.nodeId}:${seatId}:${actionPhase}`];
  if (!actionId) return "WAITING";
  return state.sealedActions[actionId]?.command.isDefault ? "DEFAULTED" : "SEALED";
}

function buildLatestActionFeedback(state: PressureRuntimeState, viewerSeatId: string, publicScene: { text: string }) {
  const actions = Object.values(state.sealedActions)
    .filter((action) => action.command.seatId === viewerSeatId && action.resolution)
    .sort((left, right) => right.sealedAt.localeCompare(left.sealedAt));
  const action = actions[0];
  if (!action?.resolution) return null;
  const resolution = action.resolution;
  const events = state.rootEvents.filter((event) => event.sourceActionIds.includes(action.command.actionId));
  return {
    actionEcho: action.command.intentText,
    visibleReactions: [publicScene.text],
    changes: {
      consequence: [`行动结果：${resolution.status}（${resolution.reasonCode}）`],
      resource: resolution.resourceLedgerEntries.map((entry) => `${entry.resourceId} ${entry.delta >= 0 ? "+" : ""}${entry.delta}`),
      time: resolution.worldTimeDeltaMinutes ? [`世界时间推进 ${resolution.worldTimeDeltaMinutes} 分钟`] : [],
      pressure: resolution.pressureDelta ? [`压力 ${resolution.pressureDelta >= 0 ? "+" : ""}${resolution.pressureDelta}`] : [],
      object: resolution.objectVersionIds.map((versionId) => `对象版本更新：${versionId}`),
    },
    nextPressure: publicScene.text,
    sourceActionIds: [action.command.actionId],
    settledEventIds: events.map((event) => event.eventId),
    projectionHash: sha256Canonical({ actionId: action.command.actionId, resolution, eventIds: events.map((event) => event.eventId) }),
  };
}

function buildFinaleReadModel(state: PressureRuntimeState, content: PressureRuntimeContent) {
  if (state.finaleResult) {
    return {
      schemaVersion: "pressure_finale_read_model_v1",
      status: "COMPLETED",
      worldOutcomeId: state.finaleResult.worldOutcomeId,
      trackBands: state.finaleResult.trackBands,
      seatVerdicts: state.finaleResult.seatVerdicts,
      frozenResultIds: state.finaleResult.inputFrozenResultIds,
      causes: state.finaleResult.causes,
      contentHash: state.finaleResult.contentHash,
    };
  }
  const trackBands = content.worldTrackIds.map((trackId) => {
    const value = Number(state.tracks[trackId] || 0);
    return { trackId, value, band: value >= 2 ? "HIGH" : value <= -2 ? "LOW" : "MID" };
  });
  const frozen = state.frozenResults.filter((result) => /^N[1-7]$/.test(result.nodeId)).sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  return {
    schemaVersion: "pressure_finale_read_model_v1",
    status: state.phase === "COMPLETED" ? "COMPLETED" : "COMPUTING",
    trackBands,
    frozenResultIds: frozen.map((result) => result.frozenResultId),
    causes: frozen.slice(-3).map((result) => ({ nodeId: result.nodeId, branchId: result.branchId, branchLevel: result.branchLevel })),
    contentHash: sha256Canonical({ trackBands, frozen: frozen.map((result) => result.contentHash) }),
  };
}

function formatWorldClock(minutes: number): string {
  const total = Math.max(0, Number(minutes) || 0);
  const days = Math.floor(total / 1_440);
  const hours = Math.floor((total % 1_440) / 60);
  const remaining = total % 60;
  return `${days}日 ${hours}时 ${remaining}分`;
}
