import type {
  PlayerIntent,
  StoryActionTarget,
  StoryRole,
  ValidationIssue,
  ValidationResult
} from "./types";

const FORBIDDEN_TECH_TERMS = ["互联网", "手机", "卫星", "无人机", "摄像头", "电子邮件", "短信", "GPS", "宇宙飞船"];

/**
 * This validator only rejects facts the application can prove locally.
 * It deliberately does not try to decide whether Chinese prose "sounds like
 * an action" by maintaining a verb list.  Semantic ambiguity is part of the
 * single Writer call contract, not a reason to reject valid human language.
 */
export function validatePlayerIntent(
  intent: PlayerIntent,
  role: StoryRole,
  availableTargets: StoryActionTarget[] = []
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const method = intent.method.trim();

  if (!method || method.length > 500) {
    issues.push({ code: "METHOD_INVALID", message: "行动需要写明做法，并控制在 500 字以内。" });
    return { ok: false, decision: "REWRITE_NEEDED", issues };
  }
  if (!intent.targetId || !intent.targetLabel) {
    issues.push({ code: "TARGET_REQUIRED", message: "行动需要有当前局势中可以识别的对象。" });
    return { ok: false, decision: "REWRITE_NEEDED", issues };
  }

  const forbiddenTechnology = FORBIDDEN_TECH_TERMS.find((term) => method.includes(term));
  if (forbiddenTechnology) {
    issues.push({ code: "ERA_TECH_BOUNDARY", message: `当前时代不存在“${forbiddenTechnology}”这一技术。` });
    return { ok: false, decision: "REJECTED", issues };
  }

  if (availableTargets.length && intent.source !== "CUSTOM") {
    const target = availableTargets.find((candidate) => candidate.id === intent.targetId);
    if (!target || target.label !== intent.targetLabel) {
      issues.push({ code: "TARGET_NOT_AVAILABLE", message: "这个人物、地点或对象不在浙江总督当前可以接触的范围内。" });
      return { ok: false, decision: "REWRITE_NEEDED", issues };
    }
  }

  if (intent.source === "USE_LEVERAGE") {
    const missing = intent.leverageKeys.find((item) => !role.heldLeverageKeys.includes(item));
    if (missing) {
      issues.push({ code: "LEVERAGE_NOT_HELD", message: `当前角色并未持有筹码 ${missing}。` });
      return { ok: false, decision: "REWRITE_NEEDED", issues };
    }
  }

  return {
    ok: true,
    decision: intent.source === "USE_LEVERAGE" ? "ACCEPT_WITH_COST" : "ACCEPT",
    issues
  };
}
