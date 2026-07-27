import type { RuntimeWarning } from "./types.js";
import { openingKey } from "./foreground.js";

export type SurfaceValidation = {
  ok: boolean;
  reason?: string;
  warnings: RuntimeWarning[];
};

export function validateForegroundSurface(
  narration: string,
  previousOpening: string,
): SurfaceValidation {
  const text = String(narration || "").trim();
  if (!text) return failed("EMPTY_NARRATION", "正文为空");
  if (looksLikeStructuredOutput(text)) {
    return failed("NON_PROSE_OUTPUT", "正文是 JSON、XML、调试信息或纯选项菜单");
  }
  if (containsInternalLeak(text)) {
    return failed("INTERNAL_CONTEXT_LEAK", "正文包含明显的内部字段、Prompt 或密钥标记");
  }
  if (hasBrokenFence(text)) {
    return failed("BROKEN_RENDER_FENCE", "正文包含未闭合的渲染代码围栏");
  }
  if (looksTruncated(text)) {
    return failed("TRUNCATED_NARRATION", "正文疑似在网络传输中截断");
  }
  const warnings: RuntimeWarning[] = [];
  if (text.length < 120) {
    warnings.push(warning("SHORT_NARRATION", "正文很短，需要玩家体验确认是否形成完整 beat", "LOW"));
  }
  if (/(?:本轮|当前状态|执行边界|证据链|玩家需要|系统判定|决策选项)/.test(text)) {
    warnings.push(warning("REPORT_LIKE_PROSE", "正文可能带有状态报告或系统说明感", "MEDIUM"));
  }
  if (previousOpening && openingKey(text) === previousOpening) {
    return failed("REPEATED_OPENING", "正文完整重复上一回合开头");
  }
  return { ok: true, warnings };
}

export function shadowContinuityWarnings(narration: string, readerAction = ""): RuntimeWarning[] {
  const text = String(narration || "");
  const action = String(readerAction || "");
  const warnings: RuntimeWarning[] = [];
  if (
    /(?:暂不|不先|先不|扣下).{0,12}(?:签|落印|放行)|(?:不签|暂缓签发)/.test(action)
    && /(?:今日就签|当即签发|随即签发|落了印|用印放行|已经签发)/.test(text)
  ) {
    warnings.push(warning(
      "READER_ACTION_CONTRADICTION",
      "正文明确执行了玩家本轮要求暂缓的重大行动",
      "HIGH",
    ));
  }
  if (
    /(?:只问|先问|核对|查问|询问)/.test(action)
    && /(?:总督|他|“我|我).{0,40}(?:下令|命人|不许出入|半个时辰内发出|今日就签|当即签发)/.test(text)
  ) {
    warnings.push(warning(
      "PLAYER_ACTION_OVERREACH",
      "正文可能越过问话或核对，替玩家新增了重大命令或承诺",
      "HIGH",
    ));
  }
  const patterns: Array<[RegExp, string, string]> = [
    [/(?:暗账|田契副本|原始名册).{0,20}(?:就在|已经|原来|果然).{0,10}(?:案上|匣中|手中)/, "CRITICAL_CONTINUITY_WARNING", "正文可能无来源地引入关键证据"],
    [/(?:总督|他).{0,12}(?:当即签发|落印批准|答应承担|保证照办)/, "PLAYER_COMMITMENT_WARNING", "正文可能替玩家完成不可逆重大决定"],
    [/(?:幕后主使|真正主谋|巡抚指使|商会主使).{0,8}(?:已经|就是|正是|证实)/, "SECRET_LEAK_WARNING", "正文可能无来源揭晓关键秘密"],
  ];
  for (const [pattern, code, message] of patterns) {
    if (pattern.test(text)) warnings.push(warning(code, message, "HIGH"));
  }
  return warnings;
}

function looksLikeStructuredOutput(text: string) {
  if (/^\s*[\[{][\s\S]*[\]}]\s*$/.test(text)) return true;
  if (/^\s*<(?:(?:result|response|narration|options|debug|prompt)\b|xml\b)/i.test(text)) return true;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length >= 2 && lines.every((line) => /^(?:[-*]|\d+[.)]|[A-D][.)])\s+/.test(line));
}

function containsInternalLeak(text: string) {
  return /(?:DATABASE_URL|SUPABASE_|SOLO_STORY_API_KEY|OPENOVEL_API_KEY|DEEPSEEK_API_KEY|stateJson|settlementJson|runtimeMode|system prompt|developer message)/i.test(text);
}

function hasBrokenFence(text: string) {
  return (text.match(/```/g) || []).length % 2 !== 0;
}

function looksTruncated(text: string) {
  const final = text.slice(-1);
  if (/[。！？…”’」』）】]/.test(final)) return false;
  if (text.length < 180) return false;
  return /(?:，|、|：|；|的|了|着|把|将|却|而|便|又|仍)$/.test(text);
}

function failed(code: string, message: string): SurfaceValidation {
  return {
    ok: false,
    reason: code,
    warnings: [warning(code, message, "HIGH")],
  };
}

function warning(code: string, message: string, severity: RuntimeWarning["severity"]): RuntimeWarning {
  return { code, message, severity, blocksPlayer: false };
}
