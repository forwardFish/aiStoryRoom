import {
  ContinuousStoryV2LegacyStorage,
  adaptProjection,
} from "./continuous-story-v2-legacy-storage.js?v=20260809-remaining-count-v1";

const PATCH_MARK = Symbol.for("our-many-worlds:openovel-maneuver-web-v2");

export function installOpenNovelManeuverStoragePatch() {
  const proto = ContinuousStoryV2LegacyStorage.prototype;
  if (proto[PATCH_MARK]) return;
  Object.defineProperty(proto, PATCH_MARK, { value: true });

  const original = {
    restoreOrCreate: proto.restoreOrCreate,
    getRun: proto.getRun,
    submitDecision: proto.submitDecision,
    submitManeuver: proto.submitManeuver,
    changeControl: proto.changeControl,
  };

  proto.restoreOrCreate = async function(...args) {
    return augmentManeuverView(
      await original.restoreOrCreate.apply(this, args),
      this.projection,
    );
  };

  proto.getRun = async function(...args) {
    return augmentManeuverView(
      await original.getRun.apply(this, args),
      this.projection,
    );
  };

  proto.submitDecision = async function(...args) {
    return augmentManeuverView(
      await original.submitDecision.apply(this, args),
      this.projection,
    );
  };

  proto.changeControl = async function(...args) {
    return augmentManeuverView(
      await original.changeControl.apply(this, args),
      this.projection,
    );
  };

  proto.submitManeuver = async function(view, draft = {}) {
    if (!isOpenNovelManeuverProjection(this.projection)) {
      return original.submitManeuver.call(this, view, draft);
    }
    const command = maneuverRequest(this.projection, draft);
    this.__openNovelManeuverKeys ||= new Map();
    const fingerprint = JSON.stringify(command);
    const idempotencyKey = this.__openNovelManeuverKeys.get(fingerprint)
      || suppliedKey(draft.idempotencyKey)
      || uniqueKey(`openovel-maneuver-${command.maneuverType}`, this.runId);
    this.__openNovelManeuverKeys.set(fingerprint, idempotencyKey);

    let response;
    try {
      response = await this.request(
        `/api/v4/rooms/${encodeURIComponent(this.runId)}/game/maneuvers`,
        {
          method: "POST",
          body: JSON.stringify({ ...command, idempotencyKey }),
        },
      );
    } catch (error) {
      this.__openNovelManeuverKeys.delete(fingerprint);
      throw error;
    }
    this.projection = requireManeuverProjection(response.gameProjection);
    const type = String(response.result?.maneuverType || command.maneuverType);
    const nextView = augmentManeuverView(
      adaptProjection(this.projection, {
        resolution: response.resolution || null,
        decisionForm: decisionForm(type),
      }),
      this.projection,
    );
    this.__openNovelManeuverKeys.delete(fingerprint);
    if (response.accepted === false) {
      return {
        ...nextView,
        accepted: false,
        reason: response.reason || "这项谋划暂时无法执行。",
        suggestedRewrite: response.suggestedRewrite || "",
      };
    }
    return nextView;
  };

}

export function augmentManeuverView(view, projection) {
  if (!view || !isOpenNovelManeuverProjection(projection)) return view;
  const maneuverState = clone(projection.maneuverState);
  const maneuverPanel = clone(projection.maneuverPanel);
  const leverageHand = clone(projection.leverageHand);
  view.run ||= {};
  view.run.version = Number(projection.maneuverVersion);
  view.run.currentDay = Number(maneuverState.usageDay || view.run.currentDay || 1);
  view.maneuverState = maneuverState;
  view.maneuverPanel = maneuverPanel;
  view.leverageHand = leverageHand;
  view.player ||= {};
  view.player.leverage = leverageHand.items.map((item) => item.label);
  view.player.leverageKeys = leverageHand.items.map((item) => item.leverageKey);
  return view;
}

export function maneuverRequest(projection, draft = {}) {
  if (!isOpenNovelManeuverProjection(projection)) {
    throw requestError("MANEUVER_PROJECTION_REQUIRED", "主动谋划配置尚未加载。");
  }
  const maneuverType = String(draft.maneuverType || "").trim();
  const section = projection.maneuverPanel?.[maneuverType];
  if (!section?.enabled) {
    throw requestError(
      "MANEUVER_WINDOW_CLOSED",
      section?.disabledReason || projection.maneuverPanel?.disabledReason || "当前不能执行这项主动谋划。",
    );
  }
  const common = {
    version: Number(projection.maneuverVersion),
    maneuverType,
  };
  if (maneuverType === "contact") {
    return {
      ...common,
      targetRoleKey: String(draft.targetRoleKey || "").trim(),
      messageText: String(draft.messageText || "").trim(),
    };
  }
  if (maneuverType === "investigate") {
    return {
      ...common,
      intentKey: String(draft.intentKey || "").trim(),
    };
  }
  if (maneuverType === "leverage") {
    const targetRoleKey = String(draft.targetRoleKey || "").trim();
    return {
      ...common,
      leverageKey: String(draft.leverageKey || "").trim(),
      ...(targetRoleKey ? { targetRoleKey } : {}),
    };
  }
  if (maneuverType === "custom") {
    return {
      ...common,
      customText: String(draft.customText || "").trim(),
    };
  }
  throw requestError("MANEUVER_TYPE_INVALID", "不支持的主动谋划类型。");
}

function isOpenNovelManeuverProjection(value) {
  return Boolean(
    value
    && value.schemaVersion === "continuous_game_projection_v2"
    && value.room?.mode === "solo"
    && Number.isInteger(Number(value.maneuverVersion))
    && value.maneuverPanel
    && value.maneuverState
    && value.leverageHand,
  );
}

function requireManeuverProjection(value) {
  if (!isOpenNovelManeuverProjection(value)) {
    throw requestError(
      "MANEUVER_PROJECTION_INVALID",
      "故事服务没有返回可用的主动谋划状态。",
    );
  }
  return value;
}

function decisionForm(type) {
  return ({
    contact: "CONVERSATION",
    investigate: "INVESTIGATION",
    leverage: "LEVERAGE",
    custom: "CUSTOM_PLAN",
  })[type] || "CUSTOM_PLAN";
}

function requestError(code, message) {
  return Object.assign(new Error(message), { code });
}

function suppliedKey(value) {
  const key = String(value || "").trim();
  return /^[A-Za-z0-9._:-]{8,160}$/.test(key) ? key : "";
}

function uniqueKey(prefix, subject) {
  return `${prefix}:${subject}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

installOpenNovelManeuverStoragePatch();

export { ContinuousStoryV2LegacyStorage };
export { createContinuousStoryV2App } from "./continuous-story-v2-client.js?v=20260809-remaining-count-v1";
