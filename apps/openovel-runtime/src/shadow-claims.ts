import { readText } from "./io.js";
import type { WorkspacePaths } from "./paths.js";
import type { RuntimeWarning } from "./types.js";

export type UnsupportedClaim = {
  code: string;
  subject: string;
  value: string;
};

export async function readShadowWarnings(paths: WorkspacePaths) {
  const sceneLog = await readText(paths.sceneLog, "");
  return sceneLog.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const event = JSON.parse(line) as RuntimeWarning & { type?: string };
      return event.type === "shadow_warning" ? [event] : [];
    } catch {
      return [];
    }
  });
}

export function unsupportedClaimsFromWarnings(warnings: RuntimeWarning[]) {
  return warnings.flatMap(unsupportedClaimFromWarning);
}

export function removeUnsupportedObjectiveClaims(
  value: string,
  claims: UnsupportedClaim[],
) {
  return String(value || "")
    .split(/\r?\n/)
    .flatMap((line) => {
      if (!line.trim() || /^#{1,6}\s/.test(line.trim())) return [line];
      const sentences = line.match(/[^。！？!?]+[。！？!?]?/g) || [line];
      const kept = sentences.filter((sentence) => !claims.some((claim) => {
        if (claim.subject && !sentence.includes(claim.subject)) return false;
        if (hasExplicitAttributionOrUncertainty(sentence)) return false;
        const containsRecordedValue = Boolean(
          claim.value && sentence.includes(claim.value),
        );
        if (claim.code === "UNSUPPORTED_CUSTODY_ASSERTION") {
          return containsRecordedValue
            || /(?:未曾|从未|一直|没有人|无人|原封|未敢|不敢|尚未|未).{0,16}(?:动|碰|取|改|换|开|阅|离|封|护|存|保管)/.test(sentence)
            || /(?:仍|尚|一直|依旧)?(?:在|留在|存放(?:在|于)?|收在|藏在|置于).{0,24}/.test(sentence);
        }
        if (claim.code === "UNSUPPORTED_DURABLE_LOCATION") {
          return containsRecordedValue
            || /(?:仍|尚|一直|依旧)?(?:在|留在|存放(?:在|于)?|收在|藏在|置于).{0,24}/.test(sentence);
        }
        if (claim.code === "UNAUTHORIZED_DURABLE_TRANSFER") {
          return /(?:递还|交还|交给|带走|收走|取走|送回|移交|交付)/.test(sentence);
        }
        return containsRecordedValue;
      }));
      const content = kept.join("").trim();
      return content ? [content] : [];
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unsupportedClaimFromWarning(warning: RuntimeWarning): UnsupportedClaim[] {
  const details = warning.details || {};
  if (warning.code === "UNSUPPORTED_DURABLE_LOCATION") {
    const legacy = warning.message.match(/^正文为(.+?)新增了无来源的明确所在地：(.+)$/);
    const subject = details.subject || legacy?.[1] || "";
    const value = details.location || legacy?.[2] || "";
    return subject && value ? [{ code: warning.code, subject, value }] : [];
  }
  if (warning.code === "UNSUPPORTED_CUSTODY_ASSERTION") {
    const subject = details.subject
      || warning.message.match(/^正文为(.+?)新增了无来源的既往保管保证$/)?.[1]
      || "";
    return subject ? [{
      code: warning.code,
      subject,
      value: details.state || "",
    }] : [];
  }
  if (warning.code === "UNSUPPORTED_DURABLE_QUANTITY") {
    const value = details.value
      || warning.message.match(/无来源精确数量：(.+)$/)?.[1]
      || "";
    return value ? [{ code: warning.code, subject: "", value }] : [];
  }
  if (warning.code === "UNSUPPORTED_DOCUMENT_CONTENT") {
    const value = details.value
      || warning.message.match(/无来源的明确内容：(.+)$/)?.[1]
      || "";
    return value ? [{ code: warning.code, subject: "", value }] : [];
  }
  if (warning.code === "UNAUTHORIZED_DURABLE_TRANSFER") {
    const subject = details.subject
      || warning.message.match(/^正文无授权地改变了(.+?)的保管或持有人$/)?.[1]
      || "";
    return subject ? [{ code: warning.code, subject, value: "" }] : [];
  }
  return [];
}

function hasExplicitAttributionOrUncertainty(value: string) {
  return /(?:称|说|报称|据称|转述|声称|自称|据.+所言|尚未核实|未经核实|仍待查|有待查|是否.+待查|传令|下令|命.+(?:传|告|令)|要求)/.test(value);
}
