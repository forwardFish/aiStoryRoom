import type { RuntimeWarning } from "./types.js";
import { openingKey } from "./foreground.js";
import { classifyProtagonistScope } from "./causal-delta.js";

export type SurfaceValidation = {
  ok: boolean;
  reason?: string;
  warnings: RuntimeWarning[];
};

export type DurableBoundaryPolicy = {
  protectedSubjects: string[];
  evidenceSubjects?: string[];
  existingEvidenceSubjects?: string[];
  allowedFormalArtifacts?: string[];
  trackedLocations?: string[];
  forbidLatinWords?: boolean;
  registeredObjectStates?: Array<{
    subject: string;
    contentsState?: string;
    closureState?: string;
  }>;
  incidentalTextureAllowances?: Array<{
    textureClass: "CREATION_SUBSTRATE";
    lifecycle: "CONSUMED_INTO_TARGET";
    targetEntityKind: "DOCUMENT" | "OBJECT";
    targetEntityRef: string;
    targetEntityLabel: string;
  }>;
};

export function normalizeNarrativeSurface(value: string) {
  return String(value || "")
    .replace(/(?:^|\n)\s*(?:-{3,}|—{2,}|_{3,}|\*{3,})\s*(?=\n|$)/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function normalizeCanonicalRoleTerms(
  value: string,
  worldId: string,
  roleId: string,
) {
  const text = String(value || "");
  if (worldId !== "sangtian" || roleId !== "zhejiang_governor") return text;
  return text.replace(/[“"]([^”"\n]{1,500})[”"]/gu, (quoted, speech: string) => {
    let normalized = String(speech || "")
      .replace(/(敢请|敬请|须请|还请|请|禀请)中堂(?=(?:大人)?(?:[，,:：]|示知|明示|裁示|有何|如何|可否|若|在))/gu, "$1制台")
      .replace(/(催|请|禀|回禀|答复|恭候|等候|请示|问)中堂(?=(?:大人)?(?:[，,:：。；;！？!?]|$))/gu, "$1制台")
      .replace(/^中堂(?=(?:大人)?(?:[，,:：]|示知|明示|裁示|有何|如何|可否|若))/u, "制台");
    if (/^中丞(?:大人)?[，,].{0,16}卑职/u.test(normalized)) {
      normalized = normalized
        .replace(/^中丞(?:大人)?(?=[，,])/u, "制台")
        .replace(/中丞(?=(?:若|要|可|请|有|未|暂|已经|尚))/gu, "制台");
    }
    const opening = quoted.startsWith("“") ? "“" : '"';
    const closing = quoted.endsWith("”") ? "”" : '"';
    return `${opening}${normalized}${closing}`;
  });
}

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
  if (containsPlayerChoiceLeak(text)) {
    return failed("PLAYER_CHOICE_LEAK", "正文替玩家总结或呈现了下一步选择");
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

export function shadowContinuityWarnings(
  narration: string,
  readerAction = "",
  authorizedCausalMoves = "",
  establishedCanon = "",
): RuntimeWarning[] {
  const text = String(narration || "");
  const action = String(readerAction || "");
  const warnings: RuntimeWarning[] = [];
  const unauthorizedNpcDocumentAuthorship = authorizedCausalMoves
    ? extractUnauthorizedNpcFormalDocumentAuthorship(
        text,
        authorizedCausalMoves,
        establishedCanon,
      )
    : null;
  const unsupportedExternalMove = unauthorizedNpcDocumentAuthorship
    || (authorizedCausalMoves
      ? extractUnsupportedExternalActorMove(text, authorizedCausalMoves, establishedCanon)
      : null);
  if (unsupportedExternalMove) {
    warnings.push(warning(
      "UNAUTHORIZED_EXTERNAL_ACTOR_MOVE",
      `正文凭空新增了未获当前剧情合同授权的场外行动：${unsupportedExternalMove.clause}`,
      "HIGH",
      unsupportedExternalMove,
      true,
    ));
  }
  const texturePromotion = authorizedCausalMoves
    ? extractUnauthorizedTexturePromotion(text, authorizedCausalMoves)
    : null;
  if (texturePromotion) {
    warnings.push(warning(
      "NARRATIVE_TEXTURE_PROMOTED_TO_CAUSAL_FACT",
      `正文把普通叙事动作无授权地升级成了正式追责事实：${texturePromotion.clause}`,
      "HIGH",
      texturePromotion,
      true,
    ));
  }
  const unauthorizedNarratedMaterialAction = extractNarratedPlayerMaterialActions(text)
    .find((item) => !actionAxisPattern(item.axis).test(action));
  if (unauthorizedNarratedMaterialAction) {
    warnings.push(warning(
      "PLAYER_ACTION_OVERREACH",
      `正文替玩家新增了未授权的重大行动：${unauthorizedNarratedMaterialAction.text}`,
      "HIGH",
      unauthorizedNarratedMaterialAction,
      true,
    ));
  }
  if (
    /(?:暂不|不先|先不|扣下).{0,12}(?:签|落印|放行)|(?:不签|暂缓签发)/.test(action)
    && /(?:今日就签|当即签发|随即签发|落了印|用印放行|已经签发)/.test(text)
  ) {
    warnings.push(warning(
      "READER_ACTION_CONTRADICTION",
      "正文明确执行了玩家本轮要求暂缓的重大行动",
      "HIGH",
      undefined,
      true,
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
      undefined,
      true,
    ));
  }
  const patterns: Array<[RegExp, string, string]> = [
    [/(?:暗账|田契副本|原始名册).{0,20}(?:就在|已经|原来|果然).{0,10}(?:案上|匣中|手中)/, "UNAUTHORIZED_NEW_EVIDENCE", "正文无来源地引入了关键证据"],
    [/(?:总督|督宪|制台).{0,12}(?:当即签发|落印批准|答应承担|保证照办)/, "PLAYER_COMMITMENT_WARNING", "正文替玩家完成了不可逆重大决定"],
    [/(?:幕后主使|真正主谋|巡抚指使|商会主使).{0,8}(?:已经|就是|正是|证实)/, "SECRET_LEAK_WARNING", "正文无来源揭晓了关键秘密"],
  ];
  for (const [pattern, code, message] of patterns) {
    if (pattern.test(text)) warnings.push(warning(code, message, "HIGH", undefined, true));
  }
  const unauthorizedPromise = extractPlayerCommitments(text)
    .find((promise) => !actionAuthorizesPromise(action, promise));
  if (unauthorizedPromise) {
    warnings.push(warning(
      "PLAYER_COMMITMENT_WARNING",
      `正文替玩家新增了未授权的未来承诺：${unauthorizedPromise}`,
      "HIGH",
      { promise: unauthorizedPromise },
      true,
    ));
  }
  const inquiryEscalation = classifyProtagonistScope(action) === "inquiry-only"
    ? extractInquiryEscalation(text)
    : "";
  if (inquiryEscalation) {
    warnings.push(warning(
      "PLAYER_ACTION_OVERREACH",
      `正文把玩家的问话或核对擅自升级成了重大处置：${inquiryEscalation}`,
      "HIGH",
      { action: inquiryEscalation },
      true,
    ));
  }
  const unsupportedDirective = extractPlayerDirectives(text)
    .find((directive) => !actionAuthorizesDirective(action, directive));
  if (unsupportedDirective) {
    warnings.push(warning(
      "PLAYER_ACTION_OVERREACH",
      `正文替玩家新增了未授权的命令或处置：${unsupportedDirective}`,
      "HIGH",
      { action: unsupportedDirective },
      true,
    ));
  }
  return warnings;
}

function extractUnauthorizedNpcFormalDocumentAuthorship(
  value: string,
  authorizedMoves: string,
  establishedCanon: string,
) {
  const formalDocument = "(?:回文|公文|奏报|奏疏|责任说明|责任文书|航行令|命令|批文|手帖|札文)";
  const authorship = new RegExp(
    `(?:写|拟|草拟|起草|誊写|补写|改写|添写|写进|写入|记入).{0,12}${formalDocument}|${formalDocument}.{0,12}(?:写|拟|草拟|起草|誊写|补写|改写|添写|写进|写入|记入)`,
    "u",
  );
  const firstPerson = /(?:我|卑职|小的|下官|末将|属下|本官|本舰长|本船长|本指挥官)/u;
  const authorizedAuthorship = authorship.test(String(authorizedMoves || ""));
  const canonAuthorship = authorship.test(String(establishedCanon || ""));
  if (authorizedAuthorship || canonAuthorship) return null;

  const text = String(value || "");
  for (const match of text.matchAll(/[“"]([^”"\n]{2,220})[”"]/gu)) {
    const speech = String(match[1] || "").trim();
    if (!firstPerson.test(speech) || !authorship.test(speech)) continue;
    const start = match.index || 0;
    const end = start + String(match[0] || "").length;
    if (quoteAttributedToPlayer(text, start, end, speech)) continue;
    const attribution = text
      .slice(Math.max(0, start - 80), start)
      .split(/[。！？!?\n]/u)
      .at(-1)
      ?.trim() || "";
    return {
      actor: attribution || "在场 NPC",
      clause: `${attribution}${String(match[0] || "")}`.slice(0, 180),
      axis: "document-author",
    };
  }
  return null;
}

/**
 * Preserve a complete, already valid narrative beat when a model appends one
 * unsupported causal assertion at the tail. This never rewrites the claim:
 * it cuts from the first offending sentence (or its immediately preceding
 * question) and lets the caller run every guard again before publication.
 */
export function safeNarrativePrefixForWarning(
  narration: string,
  warning: RuntimeWarning,
  minChars = 120,
) {
  const text = String(narration || "").trim();
  const details = warning.details || {};
  const sourceCode = String(details.sourceCode || warning.code);
  if (!/(?:CAUSAL_KNOWLEDGE_BOUNDARY|UNSUPPORTED_|UNAUTHORIZED_|PLAYER_ACTION_OVERREACH|PLAYER_COMMITMENT_WARNING)/u.test(
    `${warning.code}\n${sourceCode}`,
  )) {
    return "";
  }
  const anchors = [
    details.location,
    details.value,
    details.assertion,
    details.action,
    details.promise,
    details.artifact,
    details.name,
    details.detail,
  ]
    .map((value) => String(value || "").trim())
    .filter((value) => value.length >= 2)
    .sort((left, right) => right.length - left.length);
  const sentences = sentenceSpans(text);
  const offendingIndex = sentences.findIndex((sentence) => (
    anchors.some((anchor) => sentence.text.includes(anchor))
  ));
  if (offendingIndex < 0) return "";
  let cutIndex = sentences[offendingIndex].start;
  const subject = String(details.subject || "").trim();
  if (subject) {
    for (
      let questionIndex = offendingIndex - 1;
      questionIndex >= Math.max(0, offendingIndex - 3);
      questionIndex -= 1
    ) {
      const candidate = sentences[questionIndex];
      if (
        /[？?]/u.test(candidate.text)
        && candidate.text.includes(subject)
      ) {
        cutIndex = candidate.start;
        break;
      }
    }
  }
  const prefix = text.slice(0, cutIndex).trim();
  if (prefix.length < Math.max(40, minChars)) return "";
  if (!/[。！？…”’」』）】"']$/u.test(prefix)) return "";
  if (!quotesBalanced(prefix)) return "";
  return prefix;
}

/**
 * Remove one self-contained prop-placement sentence when it introduces an
 * unauthorized formal artifact or evidence container but carries none of the
 * approved causal beat. This is deliberately narrower than prose rewriting:
 * dialogue, decisions, responses, and investigative claims are never edited.
 * The caller must run every guard again before publication.
 */
export function projectUnsupportedIncidentalSentence(
  narration: string,
  warningValue: RuntimeWarning,
) {
  const text = String(narration || "").trim();
  const sourceCode = String(
    warningValue.details?.sourceCode || warningValue.code || "",
  );
  const projectsUnauthorizedProp = /(?:UNAUTHORIZED_FORMAL_ARTIFACT|UNAUTHORIZED_NEW_EVIDENCE)/u
    .test(sourceCode);
  const projectsEpistemicAside = /(?:UNSUPPORTED_DURABLE_LOCATION|UNSUPPORTED_CUSTODY_ASSERTION)/u
    .test(sourceCode);
  const projectsAuthenticationAside = sourceCode === "UNSUPPORTED_DOCUMENT_AUTHENTICATION";
  if (!projectsUnauthorizedProp && !projectsEpistemicAside && !projectsAuthenticationAside) {
    return "";
  }
  const anchor = String(
    warningValue.details?.artifact || warningValue.details?.subject || "",
  ).trim();
  if (anchor.length < 2) return "";
  const removable = sentenceSpans(text).find((span) => {
    const sentence = span.text.trim();
    const following = text.slice(span.end, Math.min(text.length, span.end + 140));
    if (projectsAuthenticationAside) {
      const marker = String(warningValue.details?.marker || "").trim();
      return (
        sentence.includes(anchor)
        && (!marker || sentence.includes(marker))
        && sentence.length <= 120
        && !/[“”"']/u.test(sentence)
        && /(?:没有|并未|未曾|不曾).{0,12}(?:去拿|去碰|伸手|动|触碰)|(?:目光|视线).{0,20}(?:掠过|移开|停了一息)/u.test(sentence)
        && !/(?:写完|写成|签发|落印|盖上|钤上|按下|交给|递给|收进|放入|确认|发现|查明|核实|鉴定)/u.test(sentence)
      );
    }
    if (projectsEpistemicAside) {
      const location = String(warningValue.details?.location || "").trim();
      return (
        sentence.includes(anchor)
        && (!location || sentence.includes(location))
        && sentence.length <= 180
        && !/[“”"']/u.test(sentence)
        && /(?:心里|心下|想来|料想|显然|可见|应当|大约|多半|还在|仍在|不在.{0,16}(?:案上|手里|眼前))/u.test(sentence)
        && !/(?:发现|查明|核实|亲见|亲眼|当面答|回报|禀报|呈上|递上|交出|取来|送到|封存完成|启封)/u.test(sentence)
      );
    }
    return (
      sentence.includes(anchor)
      && sentence.length <= 120
      && !/[“”"']/u.test(sentence)
      && /(?:抱着|捧着|提着|携着|拿着|挟着|取出|亮出|放在|放到|递到|呈到|搁在|摊在|压在|推到|推入)/u.test(sentence)
      && !/(?:拒绝|答复|要求|命令|下令|签发|具名|复核|封存|启封|查验|证明|发现|确认)/u.test(sentence)
      && !/(?:这是|就是|乃是).{0,20}(?:原话|交代|手书|批示|凭据|证据)|(?:上面|纸上|笺上).{0,12}(?:写着|载着|记着)|(?:照着|按着).{0,12}(?:念|宣读)/u.test(following)
    );
  });
  if (!removable) return "";
  const projected = `${text.slice(0, removable.start)}${text.slice(removable.end)}`;
  return normalizeNarrativeSurface(projected);
}

/**
 * Normalize only the visible extent of an already-authorized closed-list
 * document. The claim count comes from the deterministic action contract, not
 * from model inference. Every durable/content guard must still run afterward,
 * so an extra policy clause remains a hard failure.
 */
export function projectClosedFormalDocumentExtent(
  narration: string,
  authorizedAction: string,
) {
  const text = String(narration || "").trim();
  const allowedCount = exclusiveDocumentClaimCount(authorizedAction);
  if (allowedCount === null) return "";
  const allowedClaims = extractExclusiveDocumentClaims(authorizedAction);
  const countLabel = smallChineseCountLabel(allowedCount);
  let changed = false;
  const observedPattern = "([零〇一二两三四五六七八九十百\\d]+|十几|数|好几)";
  const replaceWhenMismatched = (whole: string, prefix: string, observed: string, unit: string) => {
    const parsed = parseSmallChineseCount(observed);
    if (parsed !== null && parsed === allowedCount) return whole;
    changed = true;
    return `${prefix}${countLabel}${unit}`;
  };

  let projected = text.replace(
    new RegExp(`(写完|写了|写下)${observedPattern}(行字|行正文|行)(?=[，,。；;：:])`, "gu"),
    replaceWhenMismatched,
  );
  projected = projected.replace(
    new RegExp(`${observedPattern}(行字|行正文)(?=[，,。；;：:])`, "gu"),
    (whole, observed: string) => {
      const parsed = parseSmallChineseCount(observed);
      if (parsed !== null && parsed === allowedCount) return whole;
      changed = true;
      return `只写了${countLabel}条`;
    },
  );
  projected = projected.replace(
    new RegExp(`((?:正文|文中|纸上|笺上|写|载|列|落笔)[^，,。！？；;\\n]{0,20})${observedPattern}(条|项|款)`, "gu"),
    replaceWhenMismatched,
  );
  projected = projected.replace(
    /([“"])([^”"\n]{2,100})([”"])([零〇一二两三四五六七八九十百\d]+)个字/gu,
    (whole, opening: string, quotedClaim: string, closing: string, observed: string) => {
      const normalizedClaim = normalizeDocumentClause(quotedClaim);
      if (!isDocumentClauseSupported(normalizedClaim, allowedClaims)) return whole;
      const observedCount = parseSmallChineseCount(observed);
      const actualCount = [...quotedClaim].filter((character) => /[\p{Script=Han}]/u.test(character)).length;
      if (observedCount === actualCount) return whole;
      changed = true;
      return `${opening}${quotedClaim}${closing}一句`;
    },
  );
  return changed ? normalizeNarrativeSurface(projected) : "";
}

/**
 * Render an already-settled closed list when the Narrator depicted the writing
 * action and artifact but omitted every approved clause. This is deterministic
 * settlement rendering, not model-authored state: only the exact claims from
 * the bound action may be inserted, and the caller reruns all hard guards.
 */
export function projectClosedFormalDocumentClaims(
  narration: string,
  authorizedAction: string,
) {
  const text = String(narration || "").trim();
  const allowedCount = exclusiveDocumentClaimCount(authorizedAction);
  const allowedClaims = extractExclusiveDocumentClaims(authorizedAction);
  if (
    allowedCount === null
    || allowedClaims.length !== allowedCount
    || !/(?:回文|公文|奏报|奏疏|责任说明|责任文书|航行令|命令|文书)/u.test(text)
  ) {
    return "";
  }
  const documentClaimSurface = sentenceSpans(text)
    .filter((span) => /(?:写(?:明|下|入|进|道|的是|了)?|载明|记载|列明|正文|文中|纸上|笺上|念道|念出|读道|宣读)/u.test(span.text))
    .map((span) => span.text)
    .join("\n");
  const visibleClaims = allowedClaims.filter((claim) => (
    narrativeContainsApprovedDocumentClaim(documentClaimSurface, claim)
  ));
  // Never duplicate or guess around a partial rendering. A partially visible
  // closed list remains a hard validation problem for the original prose.
  const visibleMaterialClauses = sentenceSpans(documentClaimSurface)
    .flatMap((span) => splitMaterialDocumentClauses(span.text))
    .filter(isMaterialDocumentClause);
  if (visibleClaims.length > 0 || visibleMaterialClauses.length > 0) return "";
  const writingSpan = sentenceSpans(text).find((span) => (
    /(?:提笔|下笔|落笔|写(?:下|入|进|了|得|完|成)?|搁(?:了)?笔|收笔|停笔)/u.test(span.text)
    && /(?:搁(?:了)?笔|收笔|停笔|写完|写成|折|递|交)/u.test(span.text)
  ));
  if (!writingSpan) return "";
  const countLabel = smallChineseCountLabel(allowedCount);
  const renderedClaims = allowedClaims.join("；");
  const inserted = `\n\n纸上只写了${countLabel}项：${renderedClaims}。`;
  return normalizeNarrativeSurface(
    `${text.slice(0, writingSpan.end)}${inserted}${text.slice(writingSpan.end)}`,
  );
}

function narrativeContainsApprovedDocumentClaim(text: string, claim: string) {
  const normalizedText = normalizeDocumentClause(text);
  if (normalizedText.includes(claim) || claim.includes(normalizedText)) return true;
  return splitMaterialDocumentClauses(text)
    .some((clause) => isDocumentClauseSupported(clause, [claim]));
}

/**
 * Remove a self-contained negative checklist that merely verbalizes a hidden
 * knowledge constraint (for example “he did not ask where the ledger was or
 * who handled it”).  A natural “he did not ask again” remains untouched.  The
 * projection never edits dialogue or a positive investigation/result.
 */
export function projectBackstageConstraintSentence(narration: string) {
  const text = String(narration || "").trim();
  const removable = sentenceSpans(text).find((span) => {
    const sentence = span.text.trim();
    const negativeKnowledgeChecklist = (
      /(?:总督|督宪|制台|主角|他).{0,28}(?:没有|并未|未曾|不曾|没有再|未再|不再).{0,10}(?:问|追问|查问|查验|核对|命查)/u.test(sentence)
      && /(?:何处|何人|谁|哪一|是否|有没有|所在|经手|保管|来源|真伪|户头|笔迹)/u.test(sentence)
      && /(?:、|以及|或者|或是|和|与)/u.test(sentence)
    );
    const negativeFutureChecklist = (
      /(?:总督|督宪|制台|主角|他).{0,28}(?:没有|并未|未曾|不曾|未再|不再).{0,16}(?:说|交代|说明|解释)/u.test(sentence)
      && /(?:后续|日后|随后|何时|何日|几时)/u.test(sentence)
      && /(?:补押|签押|落印|用印|签发|签署|派员|移交|封存|启封|回文|具报|呈报)/u.test(sentence)
    );
    const negativeDocumentChecklist = (
      (
        /(?:没有|并未|未曾|不曾).{0,8}(?:写|载|列|添|补)/u.test(sentence)
        || countBackstageDocumentAbsences(sentence) >= 2
      )
      && /(?:依据|条件|期限|罚则|处罚|程序|范围|数量|数字|经手|保管|主持|落款|印章)/u.test(sentence)
      && /(?:、|以及|或者|或是|和|与|，|,)/u.test(sentence)
    );
    return (
      sentence.length <= 140
      && !/[“”"']/u.test(sentence)
      && (negativeKnowledgeChecklist || negativeFutureChecklist || negativeDocumentChecklist)
    );
  });
  if (!removable) return "";
  return normalizeNarrativeSurface(
    `${text.slice(0, removable.start)}${text.slice(removable.end)}`,
  );
}

function countBackstageDocumentAbsences(value: string) {
  return (String(value || "").match(
    /(?:没有|并无|未有|未写|未载|未列|不含|不载)[^，,。！？；;]{0,12}(?:依据|条件|执行细则|细则|期限|罚则|处罚|程序|范围|数量|数字|经手|保管|主持|落款|印章)/gu,
  ) || []).length;
}

/**
 * A model may put one authorized immediate instruction and one unauthorized
 * promise in the same player quote. Keep the authorized clauses, discard the
 * extra commitment, and let the caller run every guard again. This projection
 * never invents replacement prose and never touches NPC dialogue or narration.
 */
export function projectPlayerSpeechToAuthorizedAction(
  narration: string,
  authorizedAction: string,
  offendingSpeech: string,
) {
  const text = String(narration || "");
  const speech = String(offendingSpeech || "").trim();
  if (!speech) return "";
  const quoteMatch = [...text.matchAll(/[“"]([^”"\n]{2,500})[”"]/gu)]
    .find((match) => String(match[1] || "").includes(speech));
  if (!quoteMatch) return "";
  const quoted = String(quoteMatch[0] || "");
  const fullSpeech = String(quoteMatch[1] || "").trim();
  const rawClauses = fullSpeech
    .split(/[，,。；;！？!?]+/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const clauses: string[] = [];
  for (let index = 0; index < rawClauses.length; index += 1) {
    const clause = rawClauses[index]!;
    const next = rawClauses[index + 1] || "";
    if (
      /(?:回去|带回去|原样带回|转告|告诉|传话)/u.test(clause)
      && /(?:请|要求|恳请|转请)[^。！？；]{0,40}(?:共同具名|具名|联署|参加复核|参与复核|答复)/u.test(next)
    ) {
      clauses.push(`${clause}，${next}`);
      index += 1;
      continue;
    }
    clauses.push(clause);
  }
  if (clauses.length < 2) return "";
  const kept = clauses.filter((clause) => {
    if (looksLikeFutureCommitment(clause) && !actionAuthorizesPromise(authorizedAction, clause)) {
      return false;
    }
    return actionAuthorizesDirective(authorizedAction, clause);
  });
  if (kept.length === 0 || kept.length === clauses.length) return "";
  const replacementSpeech = `${kept.join("；")}。`;
  const replacement = quoted.startsWith("“")
    ? `“${replacementSpeech}”`
    : `"${replacementSpeech}"`;
  return text.replace(quoted, replacement).trim();
}

/**
 * Keep an already-authorized NPC move when the same quoted speech appends one
 * independently detectable, unauthorized causal axis.  The projection never
 * invents replacement content: it removes only the smallest comma-delimited
 * fragments that express the blocking axis, then the caller reruns every hard
 * boundary.  If no authorized causal move remains, the narration is rejected.
 */
export function projectExternalActorSpeechToAuthorizedMoves(
  narration: string,
  authorizedMoves: string,
  offendingClause: string,
  offendingAxis: string,
) {
  const text = String(narration || "");
  const clause = String(offendingClause || "").trim();
  const axis = String(offendingAxis || "").trim();
  if (!clause || !axis) return "";
  const authorizedAxes = new Set(externalDirectiveAxes(authorizedMoves, false));
  if (authorizedAxes.size === 0) return "";
  const quoteMatch = [...text.matchAll(/[“"]([^”"\n]{2,500})[”"]/gu)]
    .find((match) => {
      const speech = String(match[1] || "").trim();
      return clause.includes(speech) || speech.includes(clause) || (
        speech.length >= 16 && clause.includes(speech.slice(0, 16))
      );
    });
  if (!quoteMatch) return "";
  const speech = String(quoteMatch[1] || "").trim();
  const fragments = speech
    .split(/[，,。！？；;]+/u)
    .map((fragment) => fragment.trim())
    .filter(Boolean);
  const removed = fragments.filter((fragment) => (
    externalDirectiveAxes(fragment, true).includes(axis)
  ));
  const kept = fragments.filter((fragment) => (
    !externalDirectiveAxes(fragment, true).includes(axis)
  ));
  if (removed.length === 0 || kept.length === 0) return "";
  const projectedSpeech = kept.join("，");
  const remainingAxes = externalDirectiveAxes(projectedSpeech, true);
  if (!remainingAxes.some((candidate) => authorizedAxes.has(candidate))) return "";
  const quoted = String(quoteMatch[0] || "");
  const replacement = quoted.startsWith("“")
    ? `“${projectedSpeech}。”`
    : `"${projectedSpeech}。"`;
  return normalizeNarrativeSurface(text.replace(quoted, replacement));
}

/**
 * Durable Truth is narrower than prose continuity. Ordinary objects and
 * gestures remain free, while new quantified business facts, prior custody
 * guarantees, and secret institutional restrictions require an existing
 * source or explicit player authorization.
 */
export function validateDurableBoundary(
  narration: string,
  readerAction: string,
  knownContext: string,
  policy: DurableBoundaryPolicy,
): SurfaceValidation {
  const text = String(narration || "");
  const action = String(readerAction || "");
  const context = `${String(knownContext || "")}\n${action}`;
  const positiveContext = positiveEvidenceContext(context);
  const findings: RuntimeWarning[] = [];

  const unauthorizedFormalArtifactMutation = extractUnauthorizedFormalArtifactMutation(
    text,
    action,
    knownContext,
  );
  if (unauthorizedFormalArtifactMutation) {
    return failed(
      "UNAUTHORIZED_FORMAL_ARTIFACT_MUTATION",
      `正文无授权地在既有正式文书上写入了新内容：${unauthorizedFormalArtifactMutation.clause}`,
      unauthorizedFormalArtifactMutation,
    );
  }

  const objectStateConflict = validateRegisteredObjectInvariants(
    text,
    action,
    knownContext,
    policy.registeredObjectStates,
  );
  if (objectStateConflict) {
    return failed(
      "REGISTERED_OBJECT_STATE_CONTRADICTION",
      `正文无授权地改变了已登记持久物件状态：${objectStateConflict.subject} ${objectStateConflict.state}`,
      objectStateConflict,
    );
  }

  const unsupportedAuthentication = extractUnsupportedDocumentAuthentication(
    text,
    context,
  );
  if (unsupportedAuthentication) {
    return failed(
      "UNSUPPORTED_DOCUMENT_AUTHENTICATION",
      `正文无来源地断言了文书或证据的认证状态：${unsupportedAuthentication.clause}`,
      unsupportedAuthentication,
    );
  }

  const introducedName = extractExplicitlyIntroducedName(text)
    .find((name) => !context.includes(name));
  if (introducedName) {
    return failed(
      "UNAUTHORIZED_NAMED_CHARACTER",
      `正文凭空引入了新的具名人物：${introducedName}`,
      { name: introducedName },
    );
  }

  const unauthorizedArtifact = extractCreatedFormalArtifacts(text)
    .find((artifact) => (
      !(policy.allowedFormalArtifacts || []).includes(artifact)
      && !action.includes(artifact)
      && !knownContext.includes(artifact)
    ));
  if (unauthorizedArtifact) {
    return failed(
      "UNAUTHORIZED_FORMAL_ARTIFACT",
      `正文凭空创建了未经授权的正式文书或命令：${unauthorizedArtifact}`,
      { artifact: unauthorizedArtifact },
    );
  }
  const informationBearingPaper = extractInformationBearingPaperArrival(text);
  if (
    informationBearingPaper
    && !(policy.allowedFormalArtifacts || []).includes(informationBearingPaper)
    && !action.includes(informationBearingPaper)
    && !positiveContext.includes(informationBearingPaper)
  ) {
    return failed(
      "UNAUTHORIZED_FORMAL_ARTIFACT",
      `正文让普通纸张无来源地升级成了承载指令或证据的正式物件：${informationBearingPaper}`,
      { artifact: informationBearingPaper, truthLayer: "DURABLE" },
    );
  }

  const unsupportedFormalDocumentClause = extractUnsupportedExclusiveDocumentClause(
    text,
    action,
  );
  if (unsupportedFormalDocumentClause) {
    return failed(
      "UNSUPPORTED_FORMAL_DOCUMENT_CONTENT",
      `正文替获批文书增加了契约之外的政策、权限或处置：${unsupportedFormalDocumentClause.clause}`,
      unsupportedFormalDocumentClause,
    );
  }
  const strictQuantity = extractStrictlyForbiddenQuantity(text, action, positiveContext);
  if (strictQuantity) {
    return failed(
      "UNSUPPORTED_DURABLE_QUANTITY",
      `正文补充了当前因果契约明确禁止的新数量：${strictQuantity}`,
      { value: strictQuantity, truthLayer: "DURABLE" },
    );
  }
  const unsupportedSocialPressure = [
    "人心浮动",
    "民怨沸腾",
    "群情激愤",
    "百姓聚集",
    "民众聚集",
    "抢粮",
    "哄抢",
    "民变",
    "暴乱",
  ].find((state) => text.includes(state) && !positiveContext.includes(state));
  if (unsupportedSocialPressure) {
    return failed(
      "UNSUPPORTED_SOCIAL_PRESSURE",
      `正文把既有民生压力擅自升级成了新的社会状态：${unsupportedSocialPressure}`,
      { value: unsupportedSocialPressure, truthLayer: "DURABLE" },
    );
  }

  const unauthorizedEvidence = extractNewEvidenceArrivals(text)
    .find((subject) => (
      !(policy.existingEvidenceSubjects || []).includes(subject)
      && !action.includes(subject)
    ));
  if (unauthorizedEvidence) {
    return failed(
      "UNAUTHORIZED_NEW_EVIDENCE",
      `正文凭空让新的关键证据进入现场：${unauthorizedEvidence}`,
      { subject: unauthorizedEvidence },
    );
  }
  const unauthorizedEvidenceReference = extractCriticalEvidenceReferences(text)
    .find((subject) => (
      !(policy.existingEvidenceSubjects || []).includes(subject)
      && !positiveContext.includes(subject)
      && !action.includes(subject)
    ));
  if (unauthorizedEvidenceReference) {
    return failed(
      "UNAUTHORIZED_NEW_EVIDENCE",
      `正文凭空确认了新的关键证据或记录存在：${unauthorizedEvidenceReference}`,
      { subject: unauthorizedEvidenceReference },
    );
  }
  const unsupportedEvidenceExistence = extractUnsupportedEvidenceExistence(
    text,
    positiveContext,
    action,
  );
  if (unsupportedEvidenceExistence) {
    return failed(
      "UNSUPPORTED_EVIDENCE_EXISTENCE",
      `正文无来源地确认了关键证据是否存在：${unsupportedEvidenceExistence.subject} ${unsupportedEvidenceExistence.state}`,
      unsupportedEvidenceExistence,
    );
  }

  const unsupportedAccessDetail = extractAccessControlAssertions(text)
    .map((assertion) => ({
      assertion,
      detail: firstUnsupportedAccessDetail(assertion, knownContext),
    }))
    .find((entry) => entry.detail);
  if (unsupportedAccessDetail) {
    findings.push(warning(
      "UNSUPPORTED_EVIDENCE_ACCESS_DETAIL",
      `正文可能补充了尚未核实的证据保管或档案访问细节：${unsupportedAccessDetail.detail}`,
      "HIGH",
      {
        detail: unsupportedAccessDetail.detail,
        assertion: unsupportedAccessDetail.assertion.slice(0, 240),
        truthLayer: "DURABLE_CANDIDATE",
        disposition: "SHADOW_UNTIL_VERIFIED",
      },
    ));
  }

  if (policy.forbidLatinWords && /[A-Za-z]{3,}/.test(text)) {
    findings.push(warning(
      "WORLD_LANGUAGE_MISMATCH",
      "正文混入了当前世界不匹配的拉丁字母词语",
      "LOW",
    ));
  }

  if (
    /(?:不得|不许|不要|严禁|不必|莫要|无需).{0,16}(?:知会|行文|外传|声张|禀报|上报|告知|通知)/.test(text)
    && !/(?:保密|秘密|暗中|密令|不声张|不许外传|不得知会|不要行文|不得上报)/.test(action)
  ) {
    return failed(
      "UNAUTHORIZED_SECRECY_ORDER",
      "正文替玩家新增了未授权的保密、禁报或禁止知会命令",
    );
  }

  const subjects = policy.protectedSubjects
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const evidenceSubjects = (policy.evidenceSubjects || [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const trackedLocations = (policy.trackedLocations || [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const ellipticalLocationClaim = extractEllipticalLocationClaim(
    text,
    subjects,
    trackedLocations,
  );
  if (
    ellipticalLocationClaim
    && !contextSupportsTrackedLocation(
      context,
      ellipticalLocationClaim.subject,
      ellipticalLocationClaim.location,
    )
  ) {
    findings.push(warning(
      "UNSUPPORTED_DURABLE_LOCATION",
      `正文通过连续问答为${ellipticalLocationClaim.subject}新增了无来源的明确所在地：${ellipticalLocationClaim.location}`,
      "HIGH",
      {
        subject: ellipticalLocationClaim.subject,
        location: ellipticalLocationClaim.location,
        attributed: "true",
      },
    ));
  }
  if (evidenceSubjects.length > 0) {
    const evidencePattern = new RegExp(evidenceSubjects.map(escapeRegExp).join("|"));
    const unsupportedProcedureQuantity = extractUnsupportedEvidenceProcedureQuantity(
      text,
      evidenceSubjects,
      context,
    );
    if (unsupportedProcedureQuantity) {
      findings.push(warning(
        "UNSUPPORTED_DURABLE_QUANTITY",
        `正文可能为证据核验程序补充了尚未核实的精确次数：${unsupportedProcedureQuantity.value}`,
        "HIGH",
        unsupportedProcedureQuantity,
      ));
    }
    const unsupportedRelation = extractUnsupportedEvidenceRelation(
      text,
      evidenceSubjects,
      context,
    );
    if (unsupportedRelation) {
      return failed(
        "UNSUPPORTED_EVIDENCE_DETAIL",
        `正文为证据差异新增了无来源的方向关系：${unsupportedRelation.value}`,
        unsupportedRelation,
      );
    }
    const unsupportedFacet = extractUnsupportedEvidenceFacets(
      text,
      evidenceSubjects,
      context,
      action,
      policy.incidentalTextureAllowances,
    )[0];
    if (unsupportedFacet) {
      return failed(
        "UNSUPPORTED_EVIDENCE_DETAIL",
        `正文为既有证据新增了无来源的具体属性：${unsupportedFacet.value}`,
        {
          subject: unsupportedFacet.subject,
          category: unsupportedFacet.category,
          value: unsupportedFacet.value,
        },
      );
    }
    const unsupportedQuote = extractAttributedDocumentQuotes(
      text,
      evidenceSubjects,
    ).find((quote) => !documentQuoteGrounded(quote, context));
    if (unsupportedQuote) {
      return failed(
        "UNSUPPORTED_DOCUMENT_CONTENT",
        `正文为既有证据或文书新增了无来源的明确内容：${unsupportedQuote}`,
        { value: unsupportedQuote },
      );
    }
  }
  if (subjects.length === 0) {
    return { ok: true, reason: findings[0]?.code, warnings: findings };
  }
  const subjectPattern = new RegExp(subjects.map(escapeRegExp).join("|"));
  const clauses = text.split(/[。！？；\n]+/).map((value) => value.trim()).filter(Boolean);
  for (const clause of clauses) {
    if (!subjectPattern.test(clause)) continue;
    const quantities = extractDurableQuantities(clause);
    const unsupported = quantities.find((quantity) => !context.includes(quantity));
    if (unsupported) {
      findings.push(warning(
        "UNSUPPORTED_DURABLE_QUANTITY",
        `正文可能为持久事实补充了尚未核实的精确数量：${unsupported}`,
        "HIGH",
        {
          value: unsupported,
          truthLayer: "DURABLE_CANDIDATE",
          disposition: "SHADOW_UNTIL_VERIFIED",
        },
      ));
      continue;
    }
    const locationClaim = extractTrackedLocationClaim(
      clause,
      subjects,
      trackedLocations,
    );
    if (
      locationClaim
      && !looksInterrogativeClause(clause)
      && !contextSupportsTrackedLocation(
        context,
        locationClaim.subject,
        locationClaim.location,
      )
    ) {
      findings.push(warning(
        "UNSUPPORTED_DURABLE_LOCATION",
        `正文为${locationClaim.subject}新增了无来源的明确所在地：${locationClaim.location}`,
        "HIGH",
        {
          subject: locationClaim.subject,
          location: locationClaim.location,
          attributed: String(looksAttributedClaim(clause)),
        },
      ));
    }
    const custody = clause.match(new RegExp(
      `(${subjects.map(escapeRegExp).join("|")}).{0,30}${custodyStatePattern()}.{0,12}${custodyVerbPattern()}|`
      + `${custodyStatePattern()}.{0,12}${custodyVerbPattern()}.{0,30}(${subjects.map(escapeRegExp).join("|")})`,
    ));
    const custodySubject = custody?.[1] || custody?.[2];
    if (
      custodySubject
      && !looksInterrogativeClause(clause)
      && !contextSupportsCustody(context, custodySubject)
    ) {
      const custodyState = clause.match(new RegExp(
        `${custodyStatePattern()}.{0,12}${custodyVerbPattern()}`,
      ))?.[0] || "";
      findings.push(warning(
        "UNSUPPORTED_CUSTODY_ASSERTION",
        `正文为${custodySubject}新增了无来源的既往保管保证`,
        "HIGH",
        {
          subject: custodySubject,
          attributed: String(looksAttributedClaim(clause)),
          ...(custodyState ? { state: custodyState } : {}),
        },
      ));
    }
    const transfer = clause.match(
      new RegExp(`(${subjects.map(escapeRegExp).join("|")}).{0,24}(?:递还|交还|交给|带走|揣入|收走|取走|送回|移交|交付)|`
        + `(?:递还|交还|交给|带走|揣入|收走|取走|送回|移交|交付).{0,24}(${subjects.map(escapeRegExp).join("|")})`),
    );
    const transferredSubject = transfer?.[1] || transfer?.[2];
    if (transferredSubject && !actionAuthorizesTransfer(action, transferredSubject)) {
      return failed(
        "UNAUTHORIZED_DURABLE_TRANSFER",
        `正文无授权地改变了${transferredSubject}的保管或持有人`,
        { subject: transferredSubject },
      );
    }
  }
  return { ok: true, reason: findings[0]?.code, warnings: deduplicateWarnings(findings) };
}

function documentQuoteGrounded(quote: string, context: string) {
  if (context.includes(quote)) return true;
  const normalize = (value: string) => String(value || "")
    .replace(/[\s，。；、！？,.!?;:'"“”‘’（）()]/gu, "")
    // These are grammatical expansions, not additional evidence facets.
    // Removing them lets “合计与册尾不符” match the already authorised
    // “所得合计与册尾所列总数不符”, while a new year, number, location,
    // person, seal, ink feature, or custody claim still cannot match.
    .replace(/(?:所得|所列|总数)/gu, "");
  const normalizedQuote = normalize(quote);
  return normalizedQuote.length >= 5 && normalize(context).includes(normalizedQuote);
}

function looksLikeStructuredOutput(text: string) {
  if (/^\s*[\[{][\s\S]*[\]}]\s*$/.test(text)) return true;
  if (/^\s*<(?:(?:result|response|narration|options|debug|prompt)\b|xml\b)/i.test(text)) return true;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length >= 2 && lines.every((line) => /^(?:[-*]|\d+[.)]|[A-D][.)])\s+/.test(line));
}

export function containsInternalLeak(text: string) {
  const normalized=String(text||"")
    .replace(/([a-z0-9])([A-Z])/g,"$1 $2")
    .replace(/[_-]+/g," ")
    .replace(/\s+/g," ")
    .trim()
    .toLowerCase();
  return /(?:database url|supabase|solo story api key|openovel api key|deepseek api key|state json|settlement json|state patch|raw provider payload|raw payload|runtime mode|system prompt|developer message|developer prompt|chain of thought|\brationale\b|internal working set|role working set|confirmed resolution|reader action|visible events|visible interactions|secret marker|key marker|api key|secret key|begin system|begin prompt|begin internal|<\/?\s*(?:system|developer|rationale|state patch)>|\bprompt\s*:)/i.test(normalized);
}

export function containsInternalLeakLeaf(value:unknown):boolean{
  if(typeof value==="string")return containsInternalLeak(value);
  if(Array.isArray(value))return value.some(containsInternalLeakLeaf);
  if(value&&typeof value==="object")return Object.values(value as Record<string,unknown>).some(containsInternalLeakLeaf);
  return false;
}

function containsPlayerChoiceLeak(text: string) {
  return /(?:玩家|读者|主角|总督|他|她).{0,10}(?:得|必须|须|需要|不得不).{0,6}(?:决定|选择|拿主意|作出选择)(?:下一步|接下来)?|(?:下一步|接下来).{0,8}(?:是[^。！？\n]{1,80}还是|可选择|可以选择)/.test(text);
}

function looksAttributedClaim(value: string) {
  return /(?:称|说|报称|据称|转述|声称|自称|据.+所言|信中写|文中写|答道|回道)/.test(value);
}

function hasBrokenFence(text: string) {
  return (text.match(/```/g) || []).length % 2 !== 0;
}

function looksTruncated(text: string) {
  const straightQuotes = (text.match(/(?<!\\)"/g) || []).length;
  const openChineseQuotes = (text.match(/“/g) || []).length;
  const closeChineseQuotes = (text.match(/”/g) || []).length;
  if (straightQuotes % 2 !== 0 || openChineseQuotes !== closeChineseQuotes) return true;
  const final = text.slice(-1);
  if (/[。！？…”’」』）】]/.test(final)) return false;
  if (text.length < 180) return false;
  return /(?:，|、|：|；|的|了|着|把|将|却|而|便|又|仍)$/.test(text);
}

function sentenceSpans(value: string) {
  const spans: Array<{ start: number; end: number; text: string }> = [];
  const pattern = /[^。！？!?]+[。！？!?]+[”"’'」』）】]?|[^。！？!?]+$/gu;
  for (const match of String(value || "").matchAll(pattern)) {
    const text = String(match[0] || "");
    const start = match.index || 0;
    spans.push({ start, end: start + text.length, text });
  }
  return spans;
}

function quotesBalanced(value: string) {
  const pairs: Array<[RegExp, RegExp]> = [
    [/“/gu, /”/gu],
    [/‘/gu, /’/gu],
    [/「/gu, /」/gu],
    [/『/gu, /』/gu],
  ];
  if (pairs.some(([open, close]) => (
    (value.match(open) || []).length !== (value.match(close) || []).length
  ))) {
    return false;
  }
  return (value.match(/(?<!\\)"/gu) || []).length % 2 === 0
    && (value.match(/(?<!\\)'/gu) || []).length % 2 === 0;
}

function extractDurableQuantities(value: string) {
  const pattern = /(?:\d+(?:\.\d+)?%?|[零〇一二两三四五六七八九十百千万]+(?:成[零〇一二两三四五六七八九]?|家|户|亩|石|两|把|份|册|卷|道|人|日|月|年|倍|文|贯|度))/g;
  const matches: string[] = [];
  for (const match of value.matchAll(pattern)) {
    const index = match.index || 0;
    const before = value.slice(Math.max(0, index - 4), index);
    if (/(?:哪|何|多少|几)$/u.test(before)) continue;
    const quantity = String(match[0] || "");
    if (/(?:把|份|道|人)$/u.test(quantity)) {
      const after = value.slice(index + quantity.length, index + quantity.length + 12);
      // Ambiguous counters become durable only when they directly count a
      // causal object or actor.  "两份纸" and "两把椅子" remain narrative
      // texture even if the same sentence also mentions a protected document;
      // "两份田契" or "两把钥匙" still require source support.
      if (!/^(?:密信|书信|县册|原册|副本|册页|田契|仓单|账册|暗账|公文|回文|奏报|奏疏|责任说明|航行令|命令|批文|手帖|札文|封条|印章|钥匙|经手人|证人|官员|差役)/u.test(after)) {
        continue;
      }
    }
    matches.push(quantity);
  }
  return [...new Set(matches.filter(Boolean))];
}

function extractUnsupportedEvidenceProcedureQuantity(
  value: string,
  subjects: string[],
  context: string,
) {
  const orderedSubjects = [...subjects].sort((left, right) => right.length - left.length);
  const procedurePattern = /(?:核对|核验|复核|查验|比对|校验|清点|相加|合计|加过|算过|对了)/u;
  const quantityPattern = /(?:\d+|[零〇一二两三四五六七八九十百千万]+)(?:次|遍)/gu;
  let inheritedSubject = "";
  let remainingAnswerSentences = 0;
  for (const span of sentenceSpans(String(value || ""))) {
    const clause = span.text.trim();
    const explicitSubject = orderedSubjects.find((subject) => clause.includes(subject)) || "";
    if (/[？?]/u.test(clause) && explicitSubject) {
      inheritedSubject = explicitSubject;
      remainingAnswerSentences = 2;
      continue;
    }
    const subject = explicitSubject || (remainingAnswerSentences > 0 ? inheritedSubject : "");
    if (remainingAnswerSentences > 0) remainingAnswerSentences -= 1;
    if (!subject || !procedurePattern.test(clause)) continue;
    for (const match of clause.matchAll(quantityPattern)) {
      const quantity = String(match[0] || "");
      if (quantity && !context.includes(quantity)) {
        return { subject, value: quantity, category: "procedureCount" };
      }
    }
  }
  return null;
}

function extractUnsupportedEvidenceRelation(
  value: string,
  subjects: string[],
  context: string,
) {
  const orderedSubjects = [...subjects].sort((left, right) => right.length - left.length);
  const directionPattern = /(?:多出|少于|多于|超过|超出|低于|高于|大于|小于|缺少|少了|多了)/u;
  for (const span of sentenceSpans(String(value || ""))) {
    const clause = span.text.trim();
    const subject = orderedSubjects.find((candidate) => clause.includes(candidate));
    const direction = clause.match(directionPattern)?.[0] || "";
    if (
      subject
      && direction
      && !/[？?]/u.test(clause)
      && !context.includes(direction)
    ) {
      return { subject, value: direction, category: "relationDirection" };
    }
  }
  return null;
}

function extractPlayerCommitments(value: string) {
  const candidates: string[] = [];
  const quotes = [...value.matchAll(/[“"]([^”"\n]{2,100})[”"]/g)];
  for (const match of quotes) {
    const speech = String(match[1] || "").trim();
    const start = match.index || 0;
    const end = start + String(match[0] || "").length;
    const playerAttributed = quoteAttributedToPlayer(value, start, end, speech);
    if (playerAttributed && looksLikeFutureCommitment(speech)) candidates.push(speech);
  }
  return [...new Set(candidates)];
}

function looksLikeFutureCommitment(value: string) {
  return (
    /(?:仍|继续|一概|一律|都|照旧)?照办/u.test(value)
    || /(?:答应|保证|承诺|允准|准了|照办|自会|定会|必会|一定).{0,24}(?:给|交|送|回|签|发|办|查|封|放|承担|行文|呈报|具报|上奏|奏报)/
      .test(value)
    || /(?:今晚|今日|午前|明日|届时|随后|即刻|这就).{0,18}(?:给|交|送|回|签|发|办|查|封|放)/
      .test(value)
    || /(?:给|交|送|回|签|发|办|查|封|放).{0,18}(?:今晚|今日|午前|明日|届时|随后|即刻|这就)/
      .test(value)
    || /(?:三日内|限期内|届期前|期满前).{0,18}(?:另有处置|另作处置|自有处置|再作处置)/u
      .test(value)
    || /(?:等|候|等候).{0,12}(?:后续|另行|再行|随后)(?:公文|行文|回文|札文|批文|命令)|(?:后续|另行|再行|随后)(?:公文|行文|回文|札文|批文|命令).{0,12}(?:再说|再办|照办|办理|处置)/u
      .test(value)
    || new RegExp(
      `${playerSelfReferencePattern().source}.{0,24}(?:要核|要查|会|将|另派|派人|命人|不会动|不许|不得|准了|允了)`,
    ).test(value)
  );
}

function extractInquiryEscalation(value: string) {
  const selfCommitment = extractPlayerCommitments(value)[0];
  if (selfCommitment) return selfCommitment;
  const explicitNarration = sentenceSpans(value)
    .map((span) => span.text.trim())
    .filter((clause) => !looksInterrogativeClause(clause))
    .map((clause) => clause.match(
      /(?:总督|督宪|制台|主角|玩家角色).{0,48}(?:下令|命人|吩咐|传令|派人|另派|调人|封存|封档|签发|落印|批准|准许|扣押|拘拿|放行|放走)/,
    )?.[0] || "")
    .find(Boolean) || "";
  if (explicitNarration) return explicitNarration;
  const explicitDismissal = value.match(
    /(?:总督|督宪|制台|主角|玩家角色).{0,32}[“"](?:去吧|退下|回去|告退|你可以走了)[”"]/,
  )?.[0];
  return explicitDismissal || "";
}

function extractUnsupportedExternalActorMove(
  value: string,
  authorizedMoves: string,
  establishedCanon = "",
) {
  const externalNarration = stripPlayerAttributedSpeech(value);
  const actorAliasGroups = [
    ["浙江巡抚", "巡抚", "中丞"],
    ["巡抚幕僚", "幕僚"],
    ["江南商会", "商会", "商会会首", "会首"],
    ["清流县令", "县令", "县尊"],
  ];
  const movePattern = /(?:托人|派人|派员|命人|差人|送人|遣人|要求|答复|回绝|拒绝|开仓|闭仓|囤粮|买田|购田|调走|收买|扣押|拘拿|签押|画押|联署|同签|会签|共同签署|存档|归档|入档|存查|留档|入卷|归卷|补录|补记|追记|倒填)/u;
  const authorizedAxes = new Set(externalDirectiveAxes(authorizedMoves, false));
  const sentenceClauses = sentenceSpans(externalNarration).map((span) => span.text.trim());
  const quotedClauses = [...externalNarration.matchAll(/[“"]([^”"\n]{2,500})[”"]/gu)]
    .map((match) => {
      const start = match.index || 0;
      const attribution = externalNarration
        .slice(Math.max(0, start - 80), start)
        .split(/[。！？!?\n]/u)
        .at(-1)
        ?.trim() || "";
      return `${attribution}${String(match[1] || "").trim()}`;
    });
  for (const clause of [...new Set([...sentenceClauses, ...quotedClauses])]) {
    const operativeClause = stripDocumentStateFromActorClause(clause);
    if (!movePattern.test(operativeClause) && !hasOperativeReportAction(operativeClause)) continue;
    const group = actorAliasGroups.find((aliases) => (
      aliases.some((alias) => operativeClause.includes(alias))
    ));
    if (!group) continue;
    if (externalActorMoveEstablishedInCanon(operativeClause, group, establishedCanon)) {
      continue;
    }
    if (group.some((alias) => authorizedMoves.includes(alias))) {
      const unsupportedAxis = externalDirectiveAxes(operativeClause, true)
        .find((axis) => !authorizedAxes.has(axis));
      if (!unsupportedAxis) continue;
      return {
        actor: group.find((alias) => clause.includes(alias)) || group[0]!,
        clause: clause.slice(0, 180),
        axis: unsupportedAxis,
      };
    }
    return {
      actor: group.find((alias) => clause.includes(alias)) || group[0]!,
      clause: clause.slice(0, 180),
      axis: "actor",
    };
  }
  return null;
}

function externalActorMoveEstablishedInCanon(
  clause: string,
  actorAliases: string[],
  establishedCanon: string,
) {
  if (!establishedCanon.trim()) return false;
  const clauseAxes = externalDirectiveAxes(clause, true);
  const concepts = [
    "复核",
    "派员",
    "派人",
    "到场",
    "查验",
    "记录",
    "具名",
    "联署",
    "签押",
    "存档",
    "报部",
    "上奏",
    "具报",
    "开仓",
    "闭仓",
    "买田",
    "购田",
    "封存",
  ].filter((concept) => clause.includes(concept));
  if (clauseAxes.length === 0 || concepts.length < 2) return false;
  return sentenceSpans(establishedCanon).some((span) => {
    const prior = stripDocumentStateFromActorClause(span.text.trim());
    if (!actorAliases.some((alias) => prior.includes(alias))) return false;
    const priorAxes = new Set(externalDirectiveAxes(prior, true));
    return (
      clauseAxes.every((axis) => priorAxes.has(axis))
      && concepts.every((concept) => prior.includes(concept))
    );
  });
}

function stripPlayerAttributedSpeech(value: string) {
  const text = String(value || "");
  let cursor = 0;
  let output = "";
  for (const match of text.matchAll(/[“"]([^”"\n]{2,180})[”"]/gu)) {
    const start = match.index || 0;
    const quoted = String(match[0] || "");
    const end = start + quoted.length;
    output += text.slice(cursor, start);
    output += quoteAttributedToPlayer(text, start, end, String(match[1] || "").trim())
      ? "“”"
      : quoted;
    cursor = end;
  }
  return `${output}${text.slice(cursor)}`;
}

function stripDocumentStateFromActorClause(clause: string) {
  return String(clause || "").replace(
    /(?:纸|纸张|回文|公文|文书|奏报|奏疏|责任说明|航行令).{0,28}?(?:没有|并无|未有|未见|未落|未签|未押|无).{0,10}?(?:印|落印|用印|签押|画押|署名|具名)(?:(?:，|、|,|；|;)?(?:也)?(?:没有|并无|未有|未见|未落|未签|未押|无).{0,10}?(?:印|落印|用印|签押|画押|署名|具名))*/gu,
    "",
  );
}

const OPERATIVE_REPORT_ACTION_PATTERN = /(?:(?:已|已经|当即|即刻|旋即|随后|早已|便|就|将|把|须|要|当|会|自会|定会|只好|只能|欲|拟|准备|以便|以备)[^，,。！？；;]{0,10}(?:呈报|具报|报部|上奏|奏报)|(?:要求|命|催(?!办)|请)[^，,。！？；;]{0,6}(?:呈报|具报|报部|上奏|奏报)|(?:呈报|具报|报部|上奏|奏报)(?:了|过|给|送|递|往|向|至))/u;

function hasOperativeReportAction(value: string) {
  return OPERATIVE_REPORT_ACTION_PATTERN.test(String(value || ""));
}

function extractUnauthorizedTexturePromotion(value: string, authorizedMoves: string) {
  const texturePattern = /(停过笔|停了笔|搁过笔|笔尖.{0,8}停|手指.{0,8}(?:抖|顿|停)|目光.{0,12}(?:躲|移开|闪避)|脸色.{0,8}(?:变|白|沉))/u;
  for (const match of String(value || "").matchAll(new RegExp(texturePattern.source, "gu"))) {
    const texture = String(match[0] || "");
    if (!texture) continue;
    if (authorizedMoves.includes(texture) || /(?:停笔|笔尖|手指|目光|脸色)/u.test(authorizedMoves)) {
      continue;
    }
    const start = match.index || 0;
    const clause = sentenceSpans(value).find((span) => (
      start >= span.start && start < span.end
    ))?.text.trim() || "";
    if (
      /(?:记入|记进|记在|追责|问责|定罪|证据|凭据|把柄|入档|存查)/u.test(clause)
      || hasOperativeReportAction(clause)
    ) {
      return { texture, clause: clause.slice(0, 180) };
    }
  }
  return null;
}

function externalDirectiveAxes(value: string, includeNegativeDirectives: boolean) {
  const rawValue = String(value || "");
  const operativeValue = includeNegativeDirectives
    ? rawValue
    : rawValue.replace(
      /(?:不得|不可|不许|不必|无需|尚未|仍未|并未|未曾|没有|不曾|不予|未予|不)(?:再|另行|共同|双方|当场|立即|即刻|一并)?(?:托人|派人|派员|命人|差人|送人|遣人|签押|画押|联署|同签|会签|共同签署|落印|用印|签发|签署|批准|存档|归档|入档|存查|留档|入卷|归卷|补录|补记|追记|倒填|开仓|闭仓|囤粮|买田|购田|调走|收买|扣押|拘拿)/gu,
      "",
    );
  const materiallyScopedAxes = new Set([
    "dispatch",
    "seal",
    "sign",
    "detain",
    "procedure",
    "report",
  ]);
  const axes = new Set(
    directiveAxes(operativeValue).filter((axis) => materiallyScopedAxes.has(axis)),
  );
  if (/(?:签押|画押|联署|同签|会签|共同签署)/u.test(operativeValue)) axes.add("sign");
  if (/(?:存档|归档|入档|存查|留档|入卷|归卷)/u.test(operativeValue)) axes.add("archive");
  if (/(?:当场|即时|随即).{0,12}(?:记录|记入|录入)|(?:事后)?(?:补录|补记|追记)|倒填(?:日期|时日)/u.test(operativeValue)) axes.add("record-timing");
  if (/(?:派人|派员|命人|差人|送人|遣人)/u.test(operativeValue)) axes.add("dispatch");
  return [...axes];
}

function playerSelfReferencePattern() {
  return /(?:本督|本官|本将|本帅|本王|本座|本舰长?|本船长|本指挥官)/;
}

function actionAuthorizesPromise(action: string, promise: string) {
  if (/(?:暂不|不先|先不|不予|扣下).{0,16}(?:签|发|给|回|交|送|办|封|放)/.test(action)) {
    return false;
  }
  if (/(?:仍|继续|一概|一律|都|照旧)?照办/u.test(promise)) {
    return /(?:仍|继续|一概|一律|都|照旧)?照办/u.test(action);
  }
  if (/(?:三日内|限期内|届期前|期满前).{0,18}(?:另有处置|另作处置|自有处置|再作处置)/u.test(promise)) {
    return /(?:三日内|限期内|届期前|期满前).{0,18}(?:另有处置|另作处置|自有处置|再作处置)/u.test(action);
  }
  const futureDocument = /(?:等|候|等候).{0,12}(?:后续|另行|再行|随后)(?:公文|行文|回文|札文|批文|命令)|(?:后续|另行|再行|随后)(?:公文|行文|回文|札文|批文|命令).{0,12}(?:再说|再办|照办|办理|处置)/u;
  if (futureDocument.test(promise)) return futureDocument.test(action);
  const promiseAxes = directiveAxes(promise);
  if (
    promiseAxes.length > 0
    && classifyProtagonistScope(action) !== "inquiry-only"
    && promiseAxes.every((axis) => actionAxisPattern(axis).test(action))
  ) {
    return true;
  }
  const objects = ["回文", "答复", "回话", "公文", "放行文书", "县册", "原册", "具报", "奏报"];
  const sharedObject = objects.some((object) => promise.includes(object) && action.includes(object));
  return sharedObject && /(?:签|发|给|回|交|送|答复|回话|承诺|保证|限于|定于|今日|今晚|午前|明日)/.test(action);
}

function extractExplicitlyIntroducedName(value: string) {
  const values: string[] = [];
  const pattern = /(?:名叫|叫做|唤作|自称为?|报上姓名(?:是|为)?)[“"']?([\p{Script=Han}]{2,4})[”"']?/gu;
  for (const match of value.matchAll(pattern)) {
    const name = String(match[1] || "").trim();
    if (name) values.push(name);
  }
  const titledName = /(?:经承书办|县衙书办|改桑书吏|书办|经承|书吏|县令|县丞|知县|巡抚幕僚|幕僚|主簿|典史|师爷|账房|掌柜|会首|差役|吏目|校尉|百户|千户|巡检|管事)[\s，,]?[“"']?([\p{Script=Han}]{2,4})(?=(?:看管|掌管|值守|说道|答道|答|说|来|去|在|把|将|从|已|正|便|仍|又|未|不|，|。|、|：|:|\s))/gu;
  for (const match of value.matchAll(titledName)) {
    const name = String(match[1] || "").trim();
    if (name && looksLikePersonalName(name)) values.push(name);
  }
  return [...new Set(values)];
}

function extractUnsupportedDocumentAuthentication(text: string, knownContext: string) {
  const subjectPattern = /(密信|书信|信件|公文|回文|奏报|奏疏|县册|原册|副本|田契|仓单|账册|卷宗|档案|手帖|手札|批文|文书|证词|口供|星图|边注|航行令|命令)/u;
  const markerPattern = /(署名|具名|落款|签押|画押|印章|朱印|官印|县印|衙印|府印|私印|钤印|用印|盖印|具结|押缝|骑缝|关防)/u;
  for (const span of sentenceSpans(text)) {
    const clause = span.text.trim();
    const subject = clause.match(subjectPattern)?.[1] || "";
    const markerMatch = clause.match(markerPattern);
    const marker = markerMatch?.[1] || "";
    if (!subject || !marker) continue;
    if (
      marker === "签押"
      && /^(?:房|处|堂|厅|司)/u.test(
        clause.slice((markerMatch?.index || 0) + marker.length),
      )
    ) {
      continue;
    }
    if (!documentAuthenticationRelation(clause, subject, marker)) {
      continue;
    }
    const supported = sentenceSpans(knownContext).some((contextSpan) => {
      const contextClause = contextSpan.text.trim();
      return documentAuthenticationRelation(contextClause, subject, marker);
    }) || contextSupportsExplicitNegativeAuthentication(
      knownContext,
      clause,
      subject,
      marker,
    );
    if (!supported) {
      return { subject, marker, clause: clause.slice(0, 180) };
    }
  }
  return null;
}

function contextSupportsExplicitNegativeAuthentication(
  knownContext: string,
  clause: string,
  subject: string,
  marker: string,
) {
  const negativeAssertion = new RegExp(
    `(?:${escapeRegExp(subject)}).{0,36}(?:没有|并无|未有|未见|未署|未具|未落|未签|未押|未钤|未盖|无).{0,10}(?:${escapeRegExp(marker)})`,
    "u",
  ).test(clause);
  if (!negativeAssertion) return false;
  const closedKind = exclusiveDocumentKind(knownContext);
  if (!closedKind || (closedKind !== subject && closedKind !== "文书")) return false;
  const signatureMarker = /(?:署名|具名|落款|签押|画押)/u.test(marker);
  const sealMarker = /(?:印章|朱印|官印|县印|衙印|府印|私印|钤印|用印|盖印|关防)/u.test(marker);
  if (signatureMarker) {
    return /(?:本回合|该文|此文|文书|回文|公文|奏报|奏疏|责任说明|航行令|命令)?[^。！？\n]{0,24}(?:不|未)(?:签押|画押|署名|具名|落款)/u
      .test(knownContext);
  }
  if (sealMarker) {
    return /(?:本回合|该文|此文|文书|回文|公文|奏报|奏疏|责任说明|航行令|命令)?[^。！？\n]{0,24}(?:不|未)(?:落印|用印|盖印|钤印|盖章)/u
      .test(knownContext);
  }
  return false;
}

function documentAuthenticationRelation(clause: string, subject: string, marker: string) {
  const escapedSubject = escapeRegExp(subject);
  const escapedMarker = escapeRegExp(marker);
  // A seal or stamp can be an ordinary physical prop beside the document.
  // Do not turn “the document was set down; the governor did not touch the
  // seal beside the inkstone” into an assertion that the seal is already on
  // that document. Authentication requires a surface/possession relation,
  // not merely two nouns occurring in one compound sentence.
  const markerIsSeparateProp = new RegExp(
    `(?:砚台|砚池|印盒|案边|案旁|案角|桌边|手边|控制台旁).{0,10}(?:那方|那枚|那块|那面|一方|一枚|一块|一面)?(?:${escapedMarker})`,
    "u",
  ).test(clause);
  const markerIsOnDocument = new RegExp(
    `(?:${escapedSubject}).{0,28}(?:上|末页|末尾|纸面|卷尾|封面).{0,16}(?:${escapedMarker})`,
    "u",
  ).test(clause);
  if (markerIsSeparateProp && !markerIsOnDocument) return false;
  return new RegExp(
    `(?:${escapedSubject}).{0,28}(?:上|末页|末尾|纸面|卷尾|封面).{0,12}(?:没有|并无|未有|未见|无|有|带有|留有|写有|盖有|钤有|印有)?(?:${escapedMarker})|`
    + `(?:${escapedSubject}).{0,20}(?:没有|并无|未有|未见|未署|未具|未落|未签|未押|未钤|未盖|无|有|带有|留有|写有|署有|盖有|钤有|印有).{0,8}(?:${escapedMarker})|`
    + `(?:${escapedSubject}).{0,28}(?:露出|现出|可见).{0,12}(?:${escapedMarker})|`
    + `(?:${escapedMarker}).{0,16}(?:在|落在|盖在|钤在|印在|见于).{0,12}(?:${escapedSubject})`,
    "u",
  ).test(clause);
}

function validateRegisteredObjectInvariants(
  narration: string,
  action: string,
  knownContext: string,
  registeredObjectStates: DurableBoundaryPolicy["registeredObjectStates"] = [],
) {
  const parsedInvariants = [...knownContext.matchAll(
    /持久物件事实：([^；。\n]{2,24})当前([^；。\n]+)/gu,
  )].map((match) => ({
    subject: String(match[1] || "").trim(),
    state: String(match[2] || "").trim(),
  }));
  const latestParsedBySubject = new Map<string, { subject: string; state: string }>();
  for (const invariant of parsedInvariants) {
    latestParsedBySubject.set(invariant.subject, invariant);
  }
  const invariants = registeredObjectStates?.length
    ? registeredObjectStates.map((item) => ({
        subject: String(item.subject || "").trim(),
        state: [
          String(item.contentsState || "").trim(),
          String(item.closureState || "").trim(),
        ].filter(Boolean).join(" "),
      }))
    : [...latestParsedBySubject.values()];
  for (const invariant of invariants) {
    const aliases = objectAliases(invariant.subject);
    const aliasPattern = aliases.map(escapeRegExp).join("|");
    if (!aliasPattern) continue;
    const actionChangesState = new RegExp(
      `(?:${aliasPattern}).{0,24}(?:开|启|掀|装入|放入|置入|塞入|收进)|`
      + `(?:开|启|掀|装入|放入|置入|塞入|收进).{0,24}(?:${aliasPattern})`,
    ).test(action);
    if (actionChangesState) continue;
    if (
      /合拢|关闭|闭合|CLOSED/u.test(invariant.state)
      && new RegExp(
        `(?:${aliasPattern}).{0,40}(?:没合严|未合严|没有合严|(?<!没)(?<!未)(?<!没有)(?<!并未)(?<!不曾)(?:打开|开着|敞开|掀开|开启|半开))|`
        + `(?:没合严|未合严|没有合严|(?<!没)(?<!未)(?<!没有)(?<!并未)(?<!不曾)(?:打开|开着|敞开|掀开|开启|半开)).{0,24}(?:${aliasPattern})`,
      ).test(narration)
    ) {
      return { subject: invariant.subject, state: "CLOSED" };
    }
    if (
      /为空|空置|EMPTY/u.test(invariant.state)
      && (
        new RegExp(
          `(?:${aliasPattern}|匣盖|盒盖|箱盖).{0,60}(?:露出|装着|盛着|夹着|已有|放着).{0,20}(?:回文|回笺|纸笺|字条|文书|信件)`,
        ).test(narration)
        || new RegExp(
          `(?:回文(?!匣|盒|箱)|回笺|纸笺|字条|文书|信件).{0,30}(?:装在|放在|置于|收入).{0,20}(?:${aliasPattern})`,
        ).test(narration)
      )
    ) {
      return { subject: invariant.subject, state: "EMPTY" };
    }
  }
  return null;
}

function objectAliases(subject: string) {
  const aliases = new Set([subject]);
  const suffix = subject.match(/([\p{Script=Han}]{1,5}(?:匣|盒|箱|袋|囊|柜|令牌|印))$/u)?.[1];
  if (suffix) aliases.add(suffix);
  return [...aliases].filter(Boolean);
}

function looksLikePersonalName(value: string) {
  if (!/^[\p{Script=Han}]{2,4}$/u.test(value)) return false;
  const commonSurnames = "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于傅皮卞齐康伍余元卜顾孟平黄穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房裘缪干解应宗丁宣邓郁单杭洪包诸左石崔吉龚程邢裴陆荣翁荀羊甄曲封芮储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶黎乔苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍郤璩桑桂濮牛寿通边扈燕冀浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公";
  if (!commonSurnames.includes(value[0])) return false;
  if (/^(?:那|这|其|前|后|上|下|本|此|一|两|几|每|哪)/u.test(value)) return false;
  // A title is commonly followed directly by an auxiliary or verb in prose
  // (for example “幕僚须记明在案” or “县令应当面说明”).  Without this
  // grammatical boundary the title+name recognizer turns the following
  // predicate into a person merely because its first character is also a rare
  // surname.  Keep real names protected, but do not promote predicates to
  // durable character entities.
  if (/^(?:须|需|应|当|要|可|会|得|敢|愿|肯|曾|已|正|仍|又|未|不|只|先|再|便|即|遂|乃|却|亦|还)(?:要|须|需|应|当|可|会|得|敢|愿|肯|曾|已|正|仍|又|未|不|只|先|再|便|即|遂|乃|却|亦|还|记|说|问|答|看|听|写|取|拿|把|将|去|来|在|向|从|与|为|按|依|照|留|退|进|出|立|坐|跪|呈|报|请|命|催|查|办|守|候)/u.test(value)) return false;
  if (/(?:句问|句话|番话|所问|此问|一问|两问)$/u.test(value)) return false;
  if (/^(?:终于|随即|当即|于是|低声|抬眼|缓缓|微微|已经|仍然|只是|没有|不敢|可以|不能|最后|先后|亲手|答得|说道|问道|看着|听见|走到|退后)/u.test(value)) return false;
  return !/^[\p{Script=Han}](?:的|了|着|口|手|嘴|眼|身|头|腰|脚|脸|开|起|下|上|前|后)/u.test(value);
}

function extractAccessControlAssertions(value: string) {
  const assertions = value
    .split(/[。！？；\n]+/)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .filter((clause) => (
      /(?:档房|库房|案库|卷库|册库|原册|县册|卷宗)/u.test(clause)
      && (
        /(?:钥匙|掌钥).{0,36}(?:在|存于|由|归|交给|掌管|拿着|保管)/u.test(clause)
        || /(?:由|归).{0,36}(?:值守|看守|看管|掌钥|保管)/u.test(clause)
        || /(?:封条).{0,24}(?:完好|破损|加贴|贴上|未动|动过|拆过|重封)/u.test(clause)
        || /(?:档房|库房|案库|卷库|册库|原册|县册|卷宗|柜|门|匣).{0,48}(?:贴着|贴有|加了|已有).{0,12}(?:封条)/u.test(clause)
        || /(?:正门|侧门|后门).{0,36}(?:钥匙|出入|开门|启闭|进出)/u.test(clause)
        || /(?:出入).{0,20}(?:登簿|登记|留名|验牌)/u.test(clause)
      )
    ))
    .filter((clause) => (
      !/(?:不知|不知道|说不准|不敢断|无从得知|不得而知|尚不清楚|仍不清楚|没有核实|尚未核实|仍未核实|未曾(?:见|听|问|经手))(?![^。！？；\n]{0,24}(?:只听|听说|据说|却说|但说))/u.test(clause)
      && !/(?:谁|何人|哪一|何处|是否|有没有|在不在)/u.test(clause)
    ));
  return [...new Set(assertions)];
}

function extractPlayerDirectives(value: string) {
  const directives: string[] = [];
  for (const match of value.matchAll(/[“"]([^”"\n]{2,120})[”"]/gu)) {
    const speech = String(match[1] || "").trim();
    const start = match.index || 0;
    const end = start + String(match[0] || "").length;
    // Quotation marks also delimit clauses that the protagonist writes into
    // an approved formal document.  Those clauses are causal content, not a
    // fresh spoken command.  Keep the distinction structural: a nearby
    // writing/line marker exempts only this quoted span, while an actual
    // dialogue attribution ("...道：") remains subject to directive checks.
    if (quoteIsWrittenDocumentClause(value, start, end)) continue;
    const playerAttributed = quoteAttributedToPlayer(value, start, end, speech);
    if (!playerAttributed) continue;
    const clauses = speech
      .split(/[。！？；]+/u)
      .map((item) => item.trim())
      .filter(Boolean);
    for (const clause of clauses) {
      if (directiveAxes(clause).length > 0) directives.push(clause);
    }
  }
  const narrated = value.match(
    /(?:总督|督宪|制台|主角|玩家角色)[^。！？\n“”"]{0,16}(?:下令|传令|吩咐|命人|命其|命亲随|命书吏|命差役)[^。！？\n]{0,64}/gu,
  ) || [];
  directives.push(...narrated.map((item) => item.trim()));
  return [...new Set(directives)];
}

function quoteIsWrittenDocumentClause(
  value: string,
  start: number,
  end: number,
) {
  const before = value.slice(Math.max(0, start - 140), start);
  const after = value.slice(end, Math.min(value.length, end + 48));
  if (/^\s*(?:第[一二三四五六七八九十\d]+|头一|末一)?(?:行|条|款|项|句)(?:[。；，,:：\s]|$)/u.test(after)) {
    return true;
  }
  if (/(?:道|说|答|问|开口|吩咐|命)[：:,，\s]*$/u.test(before)) {
    return false;
  }
  return /(?:落笔|提笔|写下|写入|写在|写道|载明|列明|正文|文书中|令中|说明中)[^。！？\n“”"]{0,28}$/u.test(before);
}

function quoteAttributedToPlayer(
  value: string,
  start: number,
  end: number,
  speech: string,
) {
  if (/(?:卑职|小的|小人|在下|下官|末将|奴婢|奴才)/u.test(speech)) {
    return false;
  }
  if (/(?:总督大人|督宪大人|制台大人|制台|部堂大人|部堂)/u.test(speech)) {
    return false;
  }
  if (/(?:中丞|巡抚大人|抚台)(?:说|交代|吩咐|命|要卑职|让卑职)/u.test(speech)) {
    return false;
  }
  if (playerSelfReferencePattern().test(speech)) return true;
  const before = value.slice(Math.max(0, start - 260), start);
  const after = value.slice(end, Math.min(value.length, end + 52));
  const playerDirect = /(?:总督|督宪|制台)[^。！？\n“”"]{0,48}(?:道|说|答|问|开口|吩咐|命|沉声|抬眼|搁下|放下|转向|看向)[：,，\s]*$/u.test(before)
    || /^(?:\s|，|,)*(?:总督|督宪|制台)[^。！？\n“”"]{0,32}(?:道|说|答|问|开口|吩咐|命|沉声|语气)/u.test(after);
  const playerAddressesNpc = /(?:总督|督宪|制台)[^。！？\n“”"]{0,24}(?:看着|转向|看向|对着?|朝着?)[^。！？\n“”"]{0,20}(?:书吏|亲随|县令|幕僚|会首|掌柜)(?:(?:道|说|问)[：,，\s]*|[：:]\s*)$/u
    .test(before);
  const npcDirect = /(?:书吏|亲随|县令|巡抚(?!公文|衙门|书吏|幕僚|催办)|中丞|管事|差役|幕僚|会首|掌柜)[^。！？\n“”"]{0,48}(?:道|说|答|问|开口|躬身|低头|抬头)[：,，\s]*$/u.test(before)
    || /^(?:\s|，|,)*(?:书吏|亲随|县令|巡抚(?!公文|衙门|书吏|幕僚|催办)|中丞|管事|差役|幕僚|会首|掌柜)[^。！？\n“”"]{0,32}(?:道|说|答|问|开口)/u.test(after);
  if (playerAddressesNpc) return true;
  if (npcDirect) return false;
  if (playerDirect) return true;
  const followsExplicitNpcTurn = /(?:书吏|亲随|县令|巡抚|中丞|管事|差役|幕僚|会首|掌柜)[^。！？\n“”"]{0,24}(?:道|说|答|问|开口)[：,，\s]*[“"][^”"\n]{1,160}[”"]\s*$/u
    .test(before);
  if (
    followsExplicitNpcTurn
    && /(?:总督|督宪|制台)/u.test(speech)
  ) {
    return true;
  }

  // Dialogue can continue after the listener only looks up, shifts posture,
  // or otherwise reacts without speaking. In that case the previous explicit
  // speaker keeps the floor; the listener's nearby name must not steal the
  // next quote. Resolve the preceding quote recursively, then require an
  // actual speech verb before changing speakers.
  const previousQuotes = [...before.matchAll(/[“"]([^”"\n]{2,180})[”"]/gu)];
  const previousQuote = previousQuotes.at(-1);
  if (previousQuote) {
    const beforeOffset = Math.max(0, start - 260);
    const previousStart = beforeOffset + (previousQuote.index || 0);
    const previousQuoted = String(previousQuote[0] || "");
    const previousEnd = previousStart + previousQuoted.length;
    const intervening = value.slice(previousEnd, start);
    const playerActuallySpoke = /(?:总督|督宪|制台)[^。！？\n“”"]{0,36}(?:道|说|答|问|开口|吩咐|命)/u
      .test(intervening);
    if (
      !playerActuallySpoke
      && !quoteAttributedToPlayer(
        value,
        previousStart,
        previousEnd,
        String(previousQuote[1] || "").trim(),
      )
    ) {
      return false;
    }
  }

  const playerAliases = ["总督", "督宪", "制台"];
  const npcAliases = [
    "巡抚书吏",
    "县令亲随",
    "巡抚幕僚",
    "改桑书吏",
    "清流县令",
    "书吏",
    "亲随",
    "幕僚",
    "县令",
    "中丞",
    "会首",
    "掌柜",
  ];
  const lastPlayer = Math.max(...playerAliases.map((alias) => before.lastIndexOf(alias)));
  const lastNpc = Math.max(...npcAliases.map((alias) => before.lastIndexOf(alias)));
  return lastPlayer >= 0 && lastPlayer > lastNpc;
}

function extractNarratedPlayerMaterialActions(value: string) {
  const results: Array<{ axis: string; text: string }> = [];
  const clauses = String(value || "")
    .split(/[。！？；\n]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  for (const clause of clauses) {
    if (!/(?:总督|督宪|制台)/u.test(clause)) continue;
    if (
      /(?:(?:若|倘|假使|要是).{0,8}(?:总督|督宪|制台)|(?:总督|督宪|制台).{0,4}(?:若|倘|假使|要是)).{0,20}(?:落印|签发|签押|用印|批准)/u.test(clause)
    ) {
      continue;
    }
    if (
      /(?:落印|用印|盖(?:上|下)?(?:总督)?印|钤印|签押(?!房)|签发|签署|批准|准许放行)/u.test(clause)
      && !/(?:暂缓|暂不|没有|未曾|尚未|不曾|并未|未予|不予).{0,12}(?:落印|用印|盖(?:上|下)?(?:总督)?印|钤印|签押(?!房)|签发|签署|批准|准许放行)/u.test(clause)
    ) {
      results.push({ axis: "sign", text: clause.slice(0, 160) });
    }
  }
  return results;
}

function actionAuthorizesDirective(action: string, directive: string) {
  if (classifyProtagonistScope(action) === "inquiry-only") return false;
  const relayRecipientAliases = extractRelayRecipientAliases(directive);
  if (
    relayRecipientAliases.length > 0
    && !/(?:告诉|转告|转请|传话|传令|回报|禀告)/u.test(action)
    && !relayRecipientAliases.some((alias) => action.includes(alias))
  ) {
    return false;
  }
  const requiredAxes = directiveAxes(directive);
  const unsupportedAxes = requiredAxes.filter(
    (axis) => !actionAxisPattern(axis).test(action),
  );
  if (unsupportedAxes.length === 0) return true;
  return (
    unsupportedAxes.every((axis) => axis === "dispatch")
    && /(?:回去|带回去|原样带回|转告|告诉|传话)/u.test(directive)
    && /(?:请|要求|恳请|转请)[^。！？；]{0,40}(?:共同具名|具名|联署|参加复核|参与复核|答复)/u.test(directive)
    && /(?:请|要求|恳请|转请)[^。！？；]{0,40}(?:共同具名|具名|联署|参加复核|参与复核|答复)/u.test(action)
  );
}

function extractRelayRecipientAliases(value: string) {
  const match = String(value || "").match(
    /(?:告诉|转告|转请|传话给?|传令给?|回报给?|禀告)(?:你家|你们)?([\p{Script=Han}]{1,8}?(?:令|尊|丞|抚|僚|首|柜|长|员|官|尉|将|师|主|王|后|帝))(?=[，,。；;：:\s]|$)/u,
  );
  const recipient = String(match?.[1] || "").trim();
  if (!recipient) return [];
  const groups = [
    ["县尊", "县令", "清流县令"],
    ["中丞", "巡抚", "浙江巡抚"],
    ["会首", "商会会首"],
  ];
  return groups.find((group) => group.includes(recipient)) || [recipient];
}

function directiveAxes(value: string) {
  // A double-negative conversational reassurance ("不是不给你") is not an
  // instruction to create, sign, or transfer the object. Only its independently
  // operative clauses (for example "你且等着") may contribute an action axis.
  // This keeps the gate focused on material world changes rather than treating
  // every mention of a future-facing noun as a new command.
  const operativeValue = value.replace(
    /(?:并非|不是)不(?:给|写|送|带回|取回|签|发|办|查|封|放)/gu,
    "",
  );
  const axes: string[] = [];
  const definitions: Array<[string, RegExp]> = [
    ["stay", /(?:候着|留下|留在|不许走|不得离开)/u],
    ["dispatch", /(?:回去|前往|赶往|去往|告诉|转告|传话|传令|差人|派人|命人|命查|查实|调查|送去|取来|带来|带回|发下)/u],
    ["summon", /(?:让|叫|请)(?:他|她|其|中丞|巡抚|县令|幕僚|会首|掌柜|本人|自己).{0,8}(?:亲自)?(?:来|去|回)(?:府|衙|厅|县|这里|此处|见|说|答|复)?/u],
    ["seal", /(?:封存|封档|封好|加封|贴封|不许.{0,16}(?:调阅|接触|出入|开柜|启封))/u],
    ["reply", /(?:回文|答复|回话).{0,16}(?:写|给|送|带回|取回|今日|明日|午前)|(?:若问|问起).{0,24}(?:便说|就说|回说)/u],
    ["sign", /(?:签发|落印|用印|批准|准许放行)/u],
    ["detain", /(?:扣押|拘拿|拿下|看押|软禁)/u],
    ["dismiss", /(?:退下|告退|你可以走|放他走|放人)/u],
    ["procedure", /(?:拟定|制定).{0,12}(?:格式|条目|规则|办法)|以.{0,24}为准|缺一.{0,8}(?:不开|不办|不行|作废)|(?:开册|启封|查验|核验|复核).{0,20}(?:同在|到场|缺一)|(?:同在|到场).{0,20}(?:开册|启封|查验|核验|复核)/u],
  ];
  for (const [axis, pattern] of definitions) {
    if (pattern.test(operativeValue)) axes.push(axis);
  }
  if (hasOperativeReportAction(operativeValue)) axes.push("report");
  return axes;
}

function actionAxisPattern(axis: string) {
  const patterns: Record<string, RegExp> = {
    stay: /(?:留下|留住|留在|候着|等候)/u,
    dispatch: /(?:回去|前往|赶往|去往|告诉|转告|传话|传令|派人|命人|命查|查实|调查|交给|递给|送|取|带|发下)/u,
    summon: /(?:让|叫|请)(?:他|她|其|中丞|巡抚|县令|幕僚|会首|掌柜|本人|自己).{0,8}(?:亲自)?(?:来|去|回)(?:府|衙|厅|县|这里|此处|见|说|答|复)?/u,
    seal: /(?:封存|封档|封好|加封|贴封|保护档房|保护原册|不许.{0,16}(?:调阅|接触|出入|开柜|启封))/u,
    reply: /(?:回文|答复|回话)/u,
    sign: /(?:签发|签押|签署|落印|用印|盖(?:上|下)?(?:总督)?印|钤印|批准|准许放行)/u,
    detain: /(?:扣押|拘拿|拿下|看押|软禁)/u,
    report: OPERATIVE_REPORT_ACTION_PATTERN,
    dismiss: /(?:退下|告退|放走|放人|让.{0,12}(?:离开|回去))/u,
    procedure: /(?:拟定|制定).{0,12}(?:格式|条目|规则|办法)|以.{0,24}为准|缺一.{0,8}(?:不开|不办|不行|作废)|(?:开册|启封|查验|核验|复核).{0,20}(?:同在|到场|缺一)|(?:同在|到场).{0,20}(?:开册|启封|查验|核验|复核)/u,
  };
  return patterns[axis] || /$a/u;
}

function firstUnsupportedAccessDetail(assertion: string, knownContext: string) {
  const details = [
    ...(assertion.match(/[\p{Script=Han}]{2,4}(?=(?:看管|掌管|值守|说道|答道))/gu) || []),
    ...(assertion.match(/[零〇一二两三四五六七八九十百千万\d]+(?:把|份|册|卷|道|人)/gu) || []),
    ...(assertion.match(/(?:经承|书办|书吏|县丞|主簿|典史|师爷|幕僚|账房|掌柜|会首|知县|巡检|管事)/gu) || []),
    ...(assertion.match(/(?:正门|侧门|后门|封条完好|封条破损|加贴封条|出入登簿|出入登记)/gu) || []),
  ].filter(Boolean);
  const missing = [...new Set(details)].find((detail) => !knownContext.includes(detail));
  if (missing) return missing;
  // Knowing an actor or an object does not authorize a new relationship
  // between them (for example "县令" is known, but "县令亲手贴封条" is not).
  // Questions and explicit "I do not know" answers are filtered out before
  // this point, so a remaining positive assertion needs authoritative support
  // as a whole.
  if (!knownContext.includes(assertion)) {
    return assertion.slice(0, 120);
  }
  return "";
}

function extractCreatedFormalArtifacts(value: string) {
  const values: string[] = [];
  const pattern = /(?:另行|当即|随即|连夜|重新|新近)?(?:拟成|拟出|草拟|写成|签发|颁下|发出|取出|亮出|交出|呈上).{0,12}(令箭|钧帖|批帖|批文|密令|敕令|手令|行牌|牌票|札书|札文|手札|手帖|告示|奏报|奏疏|回文|公文)/g;
  for (const match of value.matchAll(pattern)) {
    const artifact = String(match[1] || "").trim();
    if (artifact) values.push(artifact);
  }
  const placedPattern = /(?:把|将|先把|先将)?(?:一纸|一封|一份|一通|一只)?(?:封好的|封着的|密封的)?(手札|手帖|札书|札文|批文|密令|敕令|手令|告示|奏报|奏疏|回文|公文).{0,16}(?:放在|放到|递到|呈到|搁在|摊在|压在|推到|推入)/gu;
  for (const match of value.matchAll(placedPattern)) {
    const artifact = String(match[1] || "").trim();
    if (artifact) values.push(artifact);
  }
  return [...new Set(values)];
}

function extractUnauthorizedFormalArtifactMutation(
  narration: string,
  authorizedAction: string,
  knownContext: string,
) {
  const artifactPattern = "(公文|密信|奏报|奏疏|回文|责任说明|航行令|命令)";
  const relationPatterns = [
    new RegExp(`${artifactPattern}.{0,16}(?:背面|反面|背后).{0,16}(?:起稿|写|落笔|题|添|补)`, "u"),
    new RegExp(`(?:在|把|将).{0,16}${artifactPattern}.{0,16}(?:背面|反面|背后).{0,16}(?:起稿|写|落笔|题|添|补)`, "u"),
    new RegExp(`(?:起稿|写|落笔|题|添|补).{0,16}${artifactPattern}.{0,16}(?:背面|反面|背后)`, "u"),
  ];
  for (const span of sentenceSpans(String(narration || ""))) {
    const clause = span.text.trim();
    const relation = relationPatterns.map((pattern) => clause.match(pattern)).find(Boolean);
    const artifact = String(relation?.[1] || "").trim();
    if (!artifact || !String(knownContext || "").includes(artifact)) continue;
    const authorizedRelation = new RegExp(
      `${artifact}.{0,24}(?:背面|反面|背后).{0,24}(?:起稿|写|落笔|题|添|补)|`
      + `(?:背面|反面|背后).{0,24}${artifact}.{0,24}(?:起稿|写|落笔|题|添|补)`,
      "u",
    );
    if (authorizedRelation.test(String(authorizedAction || ""))) continue;
    return { artifact, clause: clause.slice(0, 180) };
  }
  return null;
}

function extractInformationBearingPaperArrival(value: string) {
  const text = String(value || "");
  const paperPattern = /(小笺|纸条|纸片|便笺|笺纸|一纸)/u;
  for (const span of sentenceSpans(text)) {
    const sentence = span.text.trim();
    const paper = sentence.match(paperPattern)?.[1] || "";
    if (!paper) continue;
    if (!/(?:取出|掏出|抽出|亮出|呈上|递上|放在|放到|平放|摊开|压在|搁在)/u.test(sentence)) {
      continue;
    }
    const neighborhood = `${sentence}${text.slice(span.end, Math.min(text.length, span.end + 160))}`;
    if (
      /(?:这是|就是|乃是).{0,24}(?:原话|交代|手书|批示|凭据|证据)|(?:上面|纸上|笺上).{0,16}(?:写着|载着|记着)|(?:照着|按着).{0,16}(?:念|宣读)|(?:中丞|巡抚|县令|会首).{0,16}(?:原话|手书|批示)/u.test(neighborhood)
    ) {
      return paper;
    }
  }
  return "";
}

function extractNewEvidenceArrivals(value: string) {
  const values: string[] = [];
  const pattern = /(?:忽然|当即|随即|已经|果然)?(?:发现|找出|取出|掏出|呈上|递上|送来|翻出).{0,16}(暗账|田契副本|原始名册|口供|仓单|密令|账册副本)/g;
  for (const match of value.matchAll(pattern)) {
    const subject = String(match[1] || "").trim();
    if (subject) values.push(subject);
  }
  // A record-specific container carried into an evidence hearing is not an
  // ordinary prop: it implies that documentary material has arrived. Keep
  // generic boxes, sleeves, paper and desk texture free, but require an
  // authorized source for containers explicitly named for registers/files.
  const evidenceContainerPattern = /(?:抱着|捧着|提着|携着|拿着|挟着).{0,10}(册页匣|册匣|卷宗匣|案卷袋|档案袋)/gu;
  for (const match of value.matchAll(evidenceContainerPattern)) {
    const subject = String(match[1] || "").trim();
    if (subject) values.push(subject);
  }
  return [...new Set(values)];
}

function extractCriticalEvidenceReferences(value: string) {
  const values: string[] = [];
  const pattern = /(暗账|田契副本|原始名册|口供|仓单|密令|账册副本|户房底稿|底稿|底册|抄本|汇总册|汇总表册|对照册|副簿)/gu;
  for (const clause of String(value || "").split(/[。！？；\n]+/u)) {
    if (/(?:没有|并无|未附|未带|没带|未曾见|不知|不知道).{0,16}(?:暗账|田契副本|原始名册|口供|仓单|密令|账册副本|户房底稿|底稿|底册|抄本|汇总册|汇总表册|对照册|副簿)/u.test(clause)) {
      continue;
    }
    for (const match of clause.matchAll(pattern)) {
      const subject = String(match[1] || "").trim();
      if (subject) values.push(subject);
    }
  }
  return [...new Set(values)];
}

function extractUnsupportedEvidenceExistence(
  value: string,
  positiveContext: string,
  authorizedAction = "",
) {
  const subjectPattern = "(?:副本|抄本|底稿|底册|汇总册|汇总表册|对照册|副簿|附页)";
  const directPatterns = [
    new RegExp(`(?:没有|并无|未有)(?:另抄|留存|存下|备下|备存)?(?:任何|一份|一册)?(${subjectPattern})`, "u"),
    new RegExp(`(?:不曾另抄|未曾另抄|从未另抄|不敢另抄).{0,8}(${subjectPattern})`, "u"),
    new RegExp(`(${subjectPattern}).{0,18}(?:不存在|没有|并无|未有|从未有)`, "u"),
    new RegExp(`(?:已有|另有|另抄|留有|存有|备有).{0,18}(${subjectPattern})`, "u"),
    new RegExp(`(${subjectPattern}).{0,18}(?:已有|另有|留有|存有|备有)`, "u"),
  ];
  for (const clause of String(value || "").split(/[。！？；\n]+/u)) {
    if (looksInterrogativeClause(clause)) continue;
    for (const pattern of directPatterns) {
      const match = clause.match(pattern);
      const subject = String(match?.[1] || "").trim();
      if (!subject) continue;
      const state = /(?:没有|并无|未有|不曾|未曾|从未|不存在)/u.test(String(match?.[0] || ""))
        ? "ABSENT"
        : "PRESENT";
      if (
        positiveContext.includes(subject)
        || actionAuthorizesEvidenceExistence(authorizedAction, subject, state)
      ) {
        continue;
      }
      return { subject, state };
    }
  }
  const questionAnswer = String(value || "").match(new RegExp(
    `(?:可曾|是否|有没有|有无).{0,20}(${subjectPattern})[^？?]{0,12}[？?][\\s\\S]{0,100}?[“"]?(不曾|没有|并无|未曾|有|已有|另有)[。！？”"\\s]`,
    "u",
  ));
  const subject = String(questionAnswer?.[1] || "").trim();
  if (!subject || positiveContext.includes(subject)) return null;
  const answer = String(questionAnswer?.[2] || "");
  const state = /^(?:有|已有|另有)$/u.test(answer) ? "PRESENT" : "ABSENT";
  if (actionAuthorizesEvidenceExistence(authorizedAction, subject, state)) return null;
  return {
    subject,
    state,
  };
}

function actionAuthorizesEvidenceExistence(
  action: string,
  subject: string,
  state: "ABSENT" | "PRESENT",
) {
  const escaped = escapeRegExp(subject);
  const absence = new RegExp(
    `(?:没有|并无|未有|尚未|不曾|未曾|从未|不存在|未制作|未呈到|不得写成已经).{0,24}${escaped}|`
    + `${escaped}.{0,24}(?:没有|并无|未有|尚未|不曾|未曾|从未|不存在|未制作|未呈到|不得写成已经)`,
    "u",
  );
  const presence = new RegExp(
    `(?:已有|另有|另抄|留有|存有|备有|已经呈到|已经在案).{0,24}${escaped}|`
    + `${escaped}.{0,24}(?:已有|另有|另抄|留有|存有|备有|已经呈到|已经在案)`,
    "u",
  );
  return (state === "ABSENT" ? absence : presence).test(String(action || ""));
}

function contextSupportsCustody(context: string, subject: string) {
  const escaped = escapeRegExp(subject);
  return new RegExp(
    `${escaped}.{0,60}${custodyStatePattern()}.{0,16}${custodyVerbPattern()}|`
    + `${custodyStatePattern()}.{0,16}${custodyVerbPattern()}.{0,60}${escaped}`,
  ).test(context);
}

function custodyStatePattern() {
  return "(?:一直|从未|未曾|尚未|未敢|不敢|没有人|无人|原封(?:未|没))";
}

function custodyVerbPattern() {
  return "(?:擅动|动过|碰过|取出|调换|启封|拆封|挪动|离(?:开|县|府|库|仓|院|署|房|手)?|动|碰|取|改|换|开|阅)";
}

function extractTrackedLocationClaim(
  clause: string,
  subjects: string[],
  locations: string[],
) {
  if (subjects.length === 0 || locations.length === 0) return null;
  const candidates: Array<{ subject: string; location: string; distance: number; index: number }> = [];
  for (const subject of subjects) {
    for (const location of locations) {
      const direct = clause.match(new RegExp(
        `${escapeRegExp(subject)}([^，,。；：！？!?\n]{0,16})(?:(?:仍|尚|还|依旧|现)?在|留在|存于|置于|放在|收在|保管在)[^，,。；：！？!?\n]{0,16}${escapeRegExp(location)}`,
      ));
      if (direct?.index !== undefined) {
        candidates.push({
          subject,
          location,
          distance: String(direct[1] || "").length,
          index: direct.index,
        });
      }
      const reverse = clause.match(new RegExp(
        `${escapeRegExp(location)}([^，,。；：！？!?\n]{0,16})(?:存有|放有|收有|保管着|留着)[^，,。；：！？!?\n]{0,16}${escapeRegExp(subject)}`,
      ));
      if (reverse?.index !== undefined) {
        candidates.push({
          subject,
          location,
          distance: String(reverse[1] || "").length,
          index: reverse.index,
        });
      }
    }
  }
  return candidates.sort((a, b) => a.distance - b.distance || a.index - b.index)[0] || null;
}

function extractEllipticalLocationClaim(
  text: string,
  subjects: string[],
  locations: string[],
) {
  if (subjects.length === 0 || locations.length === 0) return null;
  const sentences = String(text || "")
    .match(/[^。！？!?]+[。！？!?]?/gu)
    ?.map((value) => value.trim())
    .filter(Boolean) || [];
  const orderedLocations = [...locations].sort((left, right) => right.length - left.length);
  for (let index = 0; index < sentences.length - 1; index += 1) {
    const question = sentences[index];
    if (!/[？?]/u.test(question)) continue;
    const subject = [...subjects]
      .sort((left, right) => right.length - left.length)
      .find((candidate) => question.includes(candidate));
    if (!subject) continue;
    for (
      let answerIndex = index + 1;
      answerIndex <= Math.min(index + 2, sentences.length - 1);
      answerIndex += 1
    ) {
      const answer = sentences[answerIndex];
      if (/[？?]/u.test(answer)) break;
      const location = orderedLocations.find((candidate) => (
        answer.includes(candidate)
        && new RegExp(
          `(?:仍|还|尚|现在|现|就)?在.{0,12}${escapeRegExp(candidate)}|`
          + `${escapeRegExp(candidate)}(?:里|内|那里)?(?:仍|还|尚)?(?:放着|存着|留着)?`,
          "u",
        ).test(answer)
      ));
      if (location) return { subject, location };
    }
  }
  return null;
}

function contextSupportsTrackedLocation(
  context: string,
  subject: string,
  location: string,
) {
  const escapedSubject = escapeRegExp(subject);
  const escapedLocation = escapeRegExp(location);
  return new RegExp(
    `${escapedSubject}.{0,40}(?:(?:仍|尚|还|依旧|现)?在|留在|存于|置于|放在|收在|保管在).{0,20}${escapedLocation}|`
    + `${escapedLocation}.{0,40}(?:存有|放有|收有|保管着|留着).{0,20}${escapedSubject}`,
  ).test(context);
}

function actionAuthorizesTransfer(action: string, subject: string) {
  const escaped = escapeRegExp(subject);
  return new RegExp(
    `${escaped}.{0,40}(?:封存|递|交|还|带|送|取|移)|`
    + `(?:封存|递|交|还|带|送|取|移).{0,40}${escaped}`,
  ).test(action);
}

function extractAttributedDocumentQuotes(text: string, subjects: string[]) {
  const values: string[] = [];
  const subjectPattern = new RegExp(subjects.map(escapeRegExp).join("|"), "u");
  const quotePatterns = [
    /“([^”\n]{2,120})”/gu,
    /"([^"\n]{2,120})"/gu,
    /‘([^’\n]{2,120})’/gu,
    /'([^'\n]{2,120})'/gu,
  ];
  for (const pattern of quotePatterns) {
    for (const match of String(text || "").matchAll(pattern)) {
      const value = String(match[1] || "").trim();
      if (!value) continue;
      const start = match.index || 0;
      const before = text.slice(Math.max(0, start - 100), start);
      const after = text.slice(start + String(match[0] || "").length, start + String(match[0] || "").length + 36);
      const subjectBefore = subjectPattern.test(before);
      const explicitIntroduction = (
        subjectBefore
        && /(?:写(?:着|有|了|道)?|载明|记(?:着|有|载)?|注明|列明|只写|所写|内容(?:是|为)|字样|只有)[：:，,\s]*$/u.test(before)
      );
      const explicitClosing = (
        subjectBefore
        && /^(?:这|那)?(?:二字|四字|一句|一语|字样)?(?:收尾|结尾|写在|列在|记在)/u.test(after)
      );
      if (explicitIntroduction || explicitClosing) values.push(value);
    }
  }
  return [...new Set(values)];
}

/**
 * An authored action may explicitly say that a formal document may contain
 * only a closed list of claims. Prose around the writing remains free, but
 * quoted document clauses must be lexically grounded in that list. This is a
 * generic causal boundary: it does not create lifecycle records for paper,
 * pens, desks, envelopes, or other narrative texture.
 */
function extractUnsupportedExclusiveDocumentClause(
  text: string,
  authorizedAction: string,
) {
  const allowedClaims = extractExclusiveDocumentClaims(authorizedAction);
  const closedDocumentKind = exclusiveDocumentKind(authorizedAction);
  if (allowedClaims.length === 0) return null;
  const unsupportedExtent = extractUnsupportedExclusiveDocumentExtent(
    text,
    authorizedAction,
    closedDocumentKind,
  );
  if (unsupportedExtent) {
    return {
      clause: unsupportedExtent,
      allowedClaims: allowedClaims.join("；"),
    };
  }

  const quotePatterns = [
    /“([^”\n]{2,240})”/gu,
    /"([^"\n]{2,240})"/gu,
    /‘([^’\n]{2,240})’/gu,
    /'([^'\n]{2,240})'/gu,
  ];
  for (const pattern of quotePatterns) {
    for (const match of String(text || "").matchAll(pattern)) {
      const start = match.index || 0;
      const beforeWindow = text.slice(Math.max(0, start - 180), start);
      const before = beforeWindow.split(/[。！？!?\n]/u).at(-1) || "";
      if (!looksLikeWrittenDocumentIntroduction(before)) continue;
      if (refersToDifferentFormalDocument(before, closedDocumentKind)) continue;
      const clauses = splitMaterialDocumentClauses(String(match[1] || ""));
      for (const clause of clauses) {
        if (!isMaterialDocumentClause(clause)) continue;
        if (normalizeDocumentClause(authorizedAction).includes(clause)) continue;
        if (isDocumentClauseSupported(clause, allowedClaims)) continue;
        return {
          clause,
          allowedClaims: allowedClaims.join("；"),
        };
      }
    }
  }
  return extractUnsupportedReportedDocumentClause(
    text,
    authorizedAction,
    allowedClaims,
    closedDocumentKind,
  )
    || extractUnsupportedIndirectDocumentClause(
      text,
      authorizedAction,
      allowedClaims,
      closedDocumentKind,
    );
}

function extractUnsupportedExclusiveDocumentExtent(
  text: string,
  authorizedAction: string,
  closedDocumentKind = "",
) {
  const allowedCount = exclusiveDocumentClaimCount(authorizedAction);
  if (allowedCount === null) return "";
  for (const span of sentenceSpans(String(text || ""))) {
    const clause = span.text.trim();
    if (refersToDifferentFormalDocument(clause, closedDocumentKind)) continue;
    const countMatch = clause.match(
      /([零〇一二两三四五六七八九十百\d]+|十几|数|好几)(?:行字|行正文)/u,
    ) || clause.match(
      /(?:正文|文中|纸上|笺上|写|载|列|落笔).{0,20}([零〇一二两三四五六七八九十百\d]+|十几|数|好几)(?:条|项|款)/u,
    );
    if (!countMatch) continue;
    const observedCount = parseSmallChineseCount(countMatch[1] || "");
    if (observedCount === null || observedCount !== allowedCount) {
      return clause.slice(0, 180);
    }
  }
  return "";
}

function exclusiveDocumentClaimCount(authorizedAction: string) {
  const allowedMatch = String(authorizedAction || "").match(
    /(?:正文|文中|其中|回文中|奏报中|公文中|责任说明中|航行令中)只(?:写|载|列|包含|准)([零〇一二两三四五六七八九十百\d]+)项/u,
  );
  return parseSmallChineseCount(allowedMatch?.[1] || "");
}

function smallChineseCountLabel(value: number) {
  const labels = ["零", "一", "两", "三", "四", "五", "六", "七", "八", "九", "十"];
  return labels[value] || String(value);
}

function parseSmallChineseCount(value: string): number | null {
  const text = String(value || "").trim();
  if (!text || /(?:几|数|好)/u.test(text)) return null;
  if (/^\d+$/u.test(text)) return Number(text);
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (text === "十") return 10;
  if (text.includes("百")) return null;
  if (text.includes("十")) {
    const [tens, ones] = text.split("十");
    return (tens ? digits[tens] : 1) * 10 + (ones ? digits[ones] : 0);
  }
  return digits[text] ?? null;
}

function extractUnsupportedReportedDocumentClause(
  text: string,
  authorizedAction: string,
  allowedClaims: string[],
  closedDocumentKind: string,
) {
  const reportedMarker = /(?:回文|奏报|奏疏|公文|责任说明|航行令)(?:里|中).{0,16}(?:写|载|列)/u;
  for (const quoteMatch of String(text || "").matchAll(/[“"]([^”"\n]{2,320})[”"]/gu)) {
    const speech = String(quoteMatch[1] || "").trim();
    if (!reportedMarker.test(speech)) continue;
    if (refersToDifferentFormalDocument(speech, closedDocumentKind)) continue;
    const unsupported = firstUnsupportedReportedClause(speech, authorizedAction, allowedClaims);
    if (unsupported) return unsupported;
  }
  for (const span of sentenceSpans(text)) {
    const sentence = span.text.trim();
    if (!reportedMarker.test(sentence)) continue;
    if (refersToDifferentFormalDocument(sentence, closedDocumentKind)) continue;
    const unsupported = firstUnsupportedReportedClause(sentence, authorizedAction, allowedClaims);
    if (unsupported) return unsupported;
  }
  return null;
}

function exclusiveDocumentKind(authorizedAction: string) {
  const text = String(authorizedAction || "");
  const marker = text.search(
    /(?:正文|文中|其中|回文中|奏报中|公文中|责任说明中|航行令中)只(?:写|载|列|包含|准)/u,
  );
  const neighborhood = marker >= 0
    ? text.slice(Math.max(0, marker - 96), marker + 48)
    : text;
  const kinds = [...neighborhood.matchAll(/(责任说明|航行令|奏报|奏疏|回文|公文|札文|命令|文书)/gu)]
    .map((match) => String(match[1] || ""));
  return kinds.at(-1) || "";
}

function refersToDifferentFormalDocument(value: string, closedDocumentKind: string) {
  if (!closedDocumentKind || closedDocumentKind === "文书") return false;
  const mentionedKinds = [...String(value || "").matchAll(
    /(责任说明|航行令|奏报|奏疏|回文|公文|札文|命令|文书)(?=(?:里|中|正文|上|内容))/gu,
  )].map((match) => String(match[1] || ""));
  return mentionedKinds.length > 0 && !mentionedKinds.includes(closedDocumentKind);
}

function firstUnsupportedReportedClause(
  value: string,
  authorizedAction: string,
  allowedClaims: string[],
) {
  const material = value.replace(
    /^.*?(?:回文|奏报|奏疏|公文|责任说明|航行令)(?:里|中).{0,16}(?:写|载|列)(?:了)?(?:一层|一项|两项|三项)?[：:——，,\s]*/u,
    "",
  );
  for (const clause of splitMaterialDocumentClauses(material)) {
    if (!isMaterialDocumentClause(clause)) continue;
    if (normalizeDocumentClause(authorizedAction).includes(clause)) continue;
    if (isDocumentClauseSupported(clause, allowedClaims)) continue;
    return { clause, allowedClaims: allowedClaims.join("；") };
  }
  return null;
}

function extractUnsupportedIndirectDocumentClause(
  text: string,
  authorizedAction: string,
  allowedClaims: string[],
  closedDocumentKind: string,
) {
  let insideWrittenContent = false;
  let awaitingReportedContent = false;
  for (const span of sentenceSpans(text)) {
    const sentence = span.text.trim();
    if (/(?:提笔|落笔|(?<!搁)(?<!放)下笔|写下|写得不多|另起一行|添了一句)/u.test(sentence)) {
      insideWrittenContent = true;
    }
    const reportedContent = /(?:纸面|笺上|牍上|文中|上面).{0,24}(?:只|共|列|写|载).{0,12}[：:]/u.test(sentence);
    if (
      (insideWrittenContent || awaitingReportedContent)
      && refersToDifferentFormalDocument(sentence, closedDocumentKind)
    ) {
      insideWrittenContent = false;
      awaitingReportedContent = false;
      continue;
    }
    if ((insideWrittenContent || awaitingReportedContent) && reportedContent) {
      const material = sentence.replace(
        /^.*?(?:纸面|笺上|牍上|文中|上面).{0,24}(?:只|共|列|写|载).{0,12}[：:]/u,
        "",
      );
      for (const clause of splitMaterialDocumentClauses(material)) {
        if (!isMaterialDocumentClause(clause)) continue;
        if (normalizeDocumentClause(authorizedAction).includes(clause)) continue;
        if (isDocumentClauseSupported(clause, allowedClaims)) continue;
        return {
          clause,
          allowedClaims: allowedClaims.join("；"),
        };
      }
      awaitingReportedContent = false;
      insideWrittenContent = false;
      continue;
    }
    if (/(?:写完|写罢|写毕|写成后|落笔后|搁笔|收笔|停笔|没有(?:再|第[零〇一二两三四五六七八九十百\d]+)(?:添字|加字|行)|不再添字|通看一遍|(?:把|将)?(?:公文纸|回文|公文|文书|纸|笺).{0,12}(?:折作|折好|折起|收起)|(?:把|将)?笔.{0,8}(?:搁回|放回))/u.test(sentence)) {
      insideWrittenContent = false;
      awaitingReportedContent = true;
      continue;
    }
    if (awaitingReportedContent) awaitingReportedContent = false;
    if (!insideWrittenContent) continue;
    if (
      /(?:总督|舰长|书吏|亲随|幕僚|县令|掌柜|守卫|轮机员).{0,20}(?:开口|说道|答道|问道|只说|说|问|道)[：:]/u.test(sentence)
      || /(?:交给|递给|放入|装入|装进|收进).{0,24}(?:书吏|亲随|幕僚|县令|守卫|匣|盒|箱)/u.test(sentence)
      || /(?:书吏|亲随|幕僚|县令|守卫).{0,24}(?:接过|收下|装入|装进|收进)/u.test(sentence)
    ) {
      break;
    }
    const material = sentence
      .replace(/^.*?(?:写得不多|另起一行|添了一句)[：:，,\s]*/u, "")
      .replace(/^.*?(?:提笔|落笔|下笔|写下)[^：:。！？]{0,40}[：:，,\s]*/u, "");
    for (const clause of splitMaterialDocumentClauses(material)) {
      if (!isMaterialDocumentClause(clause)) continue;
      if (normalizeDocumentClause(authorizedAction).includes(clause)) continue;
      if (isDocumentClauseSupported(clause, allowedClaims)) continue;
      return {
        clause,
        allowedClaims: allowedClaims.join("；"),
      };
    }
  }
  return null;
}

function isMaterialDocumentClause(value: string) {
  return /(?:只准|准予|先办|试办|候批|候核|待核|暂缓|核后|不得|不许|违者|究治|限期|责令|派员|封存|签发|签押|落印|移交|交付|呈报|具报|改作|改为|改成|划作|调作|征用|没收|以.{0,24}为(?:本|准)|(?:须|应|务必)?照.{0,16}(?:市值|市价|估价|折算))/u
    .test(String(value || ""));
}

function extractStrictlyForbiddenQuantity(text: string, authorizedAction: string, context: string) {
  if (!/(?:不得|不许).{0,40}(?:新增|补出|另造|换算为).{0,24}(?:数量|精确数字|数字|频率|次数|遍数)|只能定性/u.test(authorizedAction)) {
    return "";
  }
  const pattern = /(?:\d+(?:\.\d+)?%?|[零〇一二两三四五六七八九十百千万]+(?:成[零〇一二两三四五六七八九]?|家|户|亩|石|两|文|贯|倍|分|次|遍|日|月|年|度))/gu;
  for (const span of sentenceSpans(String(text || ""))) {
    const clause = span.text.trim();
    for (const match of clause.matchAll(pattern)) {
      const quantity = String(match[0] || "");
      if (!quantity || context.includes(quantity) || authorizedAction.includes(quantity)) continue;
      const quantityStart = match.index || 0;
      const localWindow = clause.slice(
        Math.max(0, quantityStart - 20),
        Math.min(clause.length, quantityStart + quantity.length + 20),
      );
      const verificationCountBound = /(?:次|遍)$/u.test(quantity)
        ? (
            /(?:核过|核验|查验|比对|相加|合计)[^，,。！？；;]{0,6}$/u.test(
              clause.slice(Math.max(0, quantityStart - 14), quantityStart),
            )
            || /^(?:核过|核验|查验|比对|相加|合计)/u.test(
              clause.slice(quantityStart + quantity.length, quantityStart + quantity.length + 8),
            )
          )
        : /(?:粮价|米价|牌价|米铺|田价|地价|田亩|亩数|库存|仓粮|核过|核验|相加|合计|差额)/u.test(localWindow);
      if (!verificationCountBound) {
        continue;
      }
      const before = clause.slice(Math.max(0, (match.index || 0) - 6), match.index || 0);
      if (/(?:哪|何|多少|几)$/u.test(before)) continue;
      return quantity;
    }
  }
  return "";
}

function extractExclusiveDocumentClaims(value: string) {
  const text = String(value || "");
  const claims: string[] = [];
  for (const match of text.matchAll(
    /正文只载(?:[零一二两三四五六七八九十\d]+项)?[：:,，\s]*([^。\n]+)/gu,
  )) {
    claims.push(...splitAuthorizedClaims(String(match[1] || "")));
  }
  for (const match of text.matchAll(
    /(?:文中|其中|回文中|奏报中|公文中|札文中|文书中|责任说明中|航行令中)只(?:写|载|列|包含|准)(?:[零一二两三四五六七八九十\d]+项)?[：:，,\s]*([^。\n]+)/gu,
  )) {
    claims.push(...splitAuthorizedClaims(String(match[1] || "")));
  }
  for (const match of text.matchAll(
    /(?:回文|奏报|奏疏|公文|札文|文书)(?:里|中)?写明[：:，,\s]*([^；。\n]+)/gu,
  )) {
    claims.push(...splitAuthorizedClaims(String(match[1] || "")));
  }
  return [...new Set(claims.map(normalizeDocumentClause).filter((item) => item.length >= 4))];
}

function splitAuthorizedClaims(value: string) {
  return String(value || "")
    // Bare “与” and “和” are ordinary word characters in phrases such as
    // “参与复核” and “共和国”. Treating them as list delimiters truncates an
    // approved claim and turns a faithful paraphrase into a false rejection.
    .split(/(?:以及|并且|并在|、|；|;)/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitMaterialDocumentClauses(value: string) {
  return String(value || "")
    .split(/[，,。；;！？!?]/u)
    .map(normalizeDocumentClause)
    .filter((item) => item.length >= 4);
}

function looksLikeWrittenDocumentIntroduction(before: string) {
  return /(?:提笔|落笔|下笔|续写|写下|写了|写道|写成|落下|笔尖|笔锋|纸上|笺上|文中).{0,120}$/u
    .test(before);
}

function isDocumentClauseSupported(clause: string, allowedClaims: string[]) {
  if (allowedClaims.some((claim) => (
    claim.includes(clause)
    || clause.includes(claim)
  ))) {
    return true;
  }
  // “Only A may start” naturally entails that the remaining places wait.
  // This complement does not add a new institution, quantity, sanction, or
  // procedure, so it is a semantic paraphrase of the same closed policy.
  if (
    /(?:其余|余).{0,8}(?:县|地|舰|队|部门).{0,8}(?:候|待|暂缓).{0,8}(?:核|批|令|议|定)?/u.test(clause)
    && allowedClaims.some((claim) => /(?:先办|先行|试办|执行)/u.test(claim))
  ) {
    return true;
  }
  const clauseBigrams = chineseBigrams(clause);
  if (clauseBigrams.length === 0) return false;
  return allowedClaims.some((claim) => {
    const allowed = new Set(chineseBigrams(claim));
    const overlap = clauseBigrams.filter((gram) => allowed.has(gram)).length;
    return overlap >= 3 && overlap / clauseBigrams.length >= 0.25;
  });
}

function normalizeDocumentClause(value: string) {
  return String(value || "")
    .replace(/[“”"'‘’（）()\s]/gu, "")
    .replace(/^(?:文中|其中|回文中|奏报中|公文中)/u, "")
    // A narrator may describe the visible layout before stating the actual
    // clauses ("一行抬头，再两行正文——...").  Layout is not a third policy
    // claim, so remove only that leading presentation phrase.  The remaining
    // material clauses still pass through the same closed-list hard gate.
    .replace(/^(?:先)?(?:[零〇一二两三四五六七八九十百\d]+行抬头[,，])?(?:再)?[零〇一二两三四五六七八九十百\d]+(?:行正文|条|项)[—:：-]*/u, "")
    .replace(/准(?=先办)/gu, "")
    .replace(/第(?=[零〇一二两三四五六七八九十百\d]+批)/gu, "")
    .trim();
}

function chineseBigrams(value: string) {
  const chars = [...normalizeDocumentClause(value)]
    .filter((char) => /[\p{Script=Han}0-9]/u.test(char));
  const grams: string[] = [];
  for (let index = 0; index < chars.length - 1; index += 1) {
    grams.push(`${chars[index]}${chars[index + 1]}`);
  }
  return [...new Set(grams)];
}

const EVIDENCE_FACET_CATEGORIES = {
  recordScope: [
    "总数",
    "分户之数",
    "分户数",
    "各里",
    "花户",
    "实报之数",
    "实报数",
    "实报",
    "分项合计",
  ],
  edition: [
    "旧册",
    "新册",
    "新造册",
    "正册",
    "副册",
    "底册",
    "抄本",
    "汇总册",
    "总册",
    "分册",
  ],
  placement: [
    "页码",
    "行次",
    "册页位置",
    "哪一页",
    "哪一行",
  ],
  inkOrHand: [
    "墨色",
    "墨迹",
    "笔迹",
    "字迹",
    "朱墨",
  ],
  tampering: [
    "刮擦",
    "涂改",
    "挖补",
    "洗改",
  ],
  authentication: [
    "落款",
    "署名",
    "亲笔",
    "画押",
    "私章",
    "私印",
    "印章",
    "官印",
    "手印",
    "印泥",
    "押印",
    "盖印",
    "骑缝",
    "真伪",
    "伪造",
  ],
  material: [
    "纸色",
    "纸张",
    "水印",
    "折痕",
  ],
} as const;

function extractUnsupportedEvidenceFacets(
  text: string,
  subjects: string[],
  context: string,
  action = "",
  incidentalTextureAllowances: DurableBoundaryPolicy["incidentalTextureAllowances"] = [],
) {
  const subjectPattern = new RegExp(subjects.map(escapeRegExp).join("|"), "u");
  const paragraphs = String(text || "")
    .split(/\n{2,}/u)
    .map((value) => value.trim())
    .filter((value) => value && subjectPattern.test(value));
  const supportedContext = positiveEvidenceContext(context);
  const findings: Array<{ subject: string; category: string; value: string }> = [];
  for (const paragraph of paragraphs) {
    const clauses = paragraph.split(/(?<=[。！？；!?])/u).map((value) => value.trim()).filter(Boolean);
    for (const clause of clauses) {
      if (isEvidenceQuestionOrExplicitAbsence(clause)) continue;
      for (const [category, values] of Object.entries(EVIDENCE_FACET_CATEGORIES)) {
        const found = values.find((value) => clause.includes(value));
        if (!found) continue;
        if (category === "inkOrHand" && !isCausalInkOrHandAssertion(clause, found)) {
          continue;
        }
        if (category === "material" && found === "折痕" && !isCausalFoldAssertion(clause)) {
          continue;
        }
        const subject = subjects.find((candidate) => (
          clause.includes(candidate)
          && evidenceFacetBoundToSubject(clause, candidate, found)
        ));
        if (!subject) continue;
        if (
          category === "material"
          && isAuthorizedCreationTexture(
            clause,
            subject,
            found,
            action,
            incidentalTextureAllowances,
          )
        ) {
          continue;
        }
        if (values.some((value) => supportedContext.includes(value))) continue;
        findings.push({ subject, category, value: found });
      }
    }
  }
  return findings.filter((finding, index, values) => (
    values.findIndex((candidate) => (
      candidate.category === finding.category
      && candidate.value === finding.value
      && candidate.subject === finding.subject
    )) === index
  ));
}

function isAuthorizedCreationTexture(
  clause: string,
  subject: string,
  facet: string,
  action: string,
  allowances: DurableBoundaryPolicy["incidentalTextureAllowances"] = [],
) {
  if (facet === "水印") return false;
  const allowance = (allowances || []).find((candidate) => (
    candidate.textureClass === "CREATION_SUBSTRATE"
    && candidate.lifecycle === "CONSUMED_INTO_TARGET"
    && candidate.targetEntityKind === "DOCUMENT"
    && Boolean(candidate.targetEntityLabel)
    && action.includes(candidate.targetEntityLabel)
    && (
      candidate.targetEntityLabel.includes(subject)
      || subject.includes(candidate.targetEntityLabel)
      || /^(?:公文|文书|回文|纸|纸张)$/u.test(subject)
    )
  ));
  if (!allowance) return false;
  if (!/(?:抽出|取出|取来|铺开|展平|提笔|落笔|写下|写成|书写|吹干|晾干|对折|折起|折好|压平|收入|装入)/u.test(clause)) {
    return false;
  }
  return !/(?:比对|核验|查验|鉴定|验出|可疑|有异|异常|伪造|真伪|证明|说明|可见|显见|由此|据此|新旧|前后不一|相同|不同|不似|出自|认出|辨出|看出)/u.test(clause);
}

function isCausalInkOrHandAssertion(clause: string, facet: string) {
  const text = String(clause || "");
  const facetIndex = text.indexOf(facet);
  if (facetIndex < 0) return false;
  const window = text.slice(Math.max(0, facetIndex - 28), facetIndex + facet.length + 36);
  return (
    /(?:浓淡|深浅|新旧|前后不一|相同|不同|不似|出自|认出|辨出|看出|比对|核验|查验|鉴定|验出|可疑|有异|异常|伪造|真伪|证明|说明|可见|显见|由此|据此|亲笔|代笔)/u.test(window)
    || /(?:像是|疑似).{0,16}(?:亲笔|所书|代笔|伪造|后补|添写|改写)/u.test(window)
  );
}

function isCausalFoldAssertion(clause: string) {
  return /(?:旧折痕|原有折痕|新旧|前后不一|相同|不同|吻合|不合|对不上|比对|核验|查验|鉴定|验出|可疑|有异|异常|调换|伪造|真伪|证明|说明|可见|显见|由此|据此)/u
    .test(String(clause || ""));
}

function evidenceFacetBoundToSubject(clause: string, subject: string, facet: string) {
  const subjectIndex = clause.indexOf(subject);
  const facetIndex = clause.indexOf(facet);
  if (subjectIndex < 0 || facetIndex < 0) return false;
  const gap = facetIndex >= subjectIndex
    ? facetIndex - (subjectIndex + subject.length)
    : subjectIndex - (facetIndex + facet.length);
  if (gap <= 20) return true;
  const subjectPattern = escapeRegExp(subject);
  const facetPattern = escapeRegExp(facet);
  return (
    new RegExp(`${subjectPattern}.{0,48}(?:的|上|中|内|所载|显示|可见).{0,8}${facetPattern}`, "u").test(clause)
    || new RegExp(`${facetPattern}.{0,16}(?:属于|见于|出现在|来自).{0,16}${subjectPattern}`, "u").test(clause)
  );
}

function positiveEvidenceContext(value: string) {
  let excludedSection = false;
  const kept: string[] = [];
  for (const line of String(value || "").split(/\r?\n/u)) {
    const heading = line.trim().match(/^#{1,6}\s+(.+)$/u)?.[1] || "";
    if (heading) {
      excludedSection = /(?:Forbidden|Knowledge Boundary|禁止|未知边界)/iu.test(heading);
      continue;
    }
    if (excludedSection) continue;
    for (const clause of line.split(/[。；]/u)) {
      if (/(?:不得|不能|不可|不许|禁止|严禁|未知|尚未核实|未经核实|没有(?:写|列|附|说明|提及)|未(?:写|列|说明|明示|提及))/u.test(clause)) {
        continue;
      }
      kept.push(clause);
    }
  }
  return kept.join("\n");
}

function isEvidenceQuestionOrExplicitAbsence(value: string) {
  return /[？?]/u.test(value)
    || /(?:哪一|何处|何种|是否|有没有|有无|谁|多少|几处)/u.test(value)
    || /(?:不知|不知道|未曾见|不曾见|没有(?:写|列|附|说明|开列|提及)|未(?:写|列|说明|明示|提及)|一个字都没有|并无|不敢妄言)/u.test(value);
}

function looksInterrogativeClause(value: string) {
  return /(?:问|追问|查问|你说|可曾|是否|谁|何处|何人|哪一|有没有|在不在|吗|么|(?:究竟|到底).{0,32}(?:还是|或是))/u.test(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function failed(
  code: string,
  message: string,
  details?: Record<string, string>,
): SurfaceValidation {
  return {
    ok: false,
    reason: code,
    warnings: [warning(code, message, "HIGH", details, true)],
  };
}

function warning(
  code: string,
  message: string,
  severity: RuntimeWarning["severity"],
  details?: Record<string, string>,
  blocksPlayer = false,
): RuntimeWarning {
  return { code, message, severity, blocksPlayer, ...(details ? { details } : {}) };
}

function deduplicateWarnings(values: RuntimeWarning[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.code}:${JSON.stringify(value.details || {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
