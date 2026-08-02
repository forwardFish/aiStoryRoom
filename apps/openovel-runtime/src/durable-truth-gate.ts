import type { CausalDelta, RuntimeWarning } from "./types.js";

/**
 * Surface Truth belongs to the Narrator. This gate rejects only explicit
 * assertions in the five durable domains owned by the server. Ambiguous prose
 * remains playable and is reported to Storykeeper as a Shadow warning.
 */
export type DurableTruthPolicy = {
  protagonistLabels?: string[];
  knownFormalArtifacts?: string[];
  evidenceSubjects?: string[];
  durableClaimSubjects?: string[];
  registeredObjects?: Array<{
    subject: string;
    contentsState?: string;
    closureState?: string;
  }>;
  secretClaims?: string[];
  trackedLocations?: string[];
};

export type DurableTruthGateResult = {
  ok: boolean;
  hardIssues: RuntimeWarning[];
  shadowWarnings: RuntimeWarning[];
};

export function validateDurableTruth(input: {
  narration: string;
  readerAction: string;
  knownContext: string;
  causalDelta: CausalDelta;
  authorizedWorldMoves?: string;
  policy?: DurableTruthPolicy;
}): DurableTruthGateResult {
  const narration = String(input.narration || "").trim();
  const knownContext = String(input.knownContext || "");
  const worldMoves = String(input.authorizedWorldMoves || "");
  const policy = input.policy || {};
  const playerAuthority = [
    input.readerAction,
    input.causalDelta.immediateIntent,
    ...(input.causalDelta.beatContract?.authorizedPlayerActions || []),
  ].filter(Boolean).join("\n");
  const durableAuthority = [playerAuthority, worldMoves, knownContext]
    .filter(Boolean)
    .join("\n");
  const hardIssues: RuntimeWarning[] = [];

  const namedActor = explicitNewNamedActor(narration, durableAuthority);
  if (namedActor) {
    hardIssues.push(blocking(
      "UNAUTHORIZED_NAMED_CHARACTER",
      "正文明确引入了没有来源的具名人物：" + namedActor,
      { name: namedActor, durableClass: "NEW_ENTITY" },
    ));
  }

  const newArtifact = explicitNewDurableArtifact(
    narration,
    durableAuthority,
    policy.knownFormalArtifacts || [],
    policy.evidenceSubjects || [],
  );
  if (newArtifact) {
    hardIssues.push(blocking(
      newArtifact.kind === "EVIDENCE"
        ? "UNAUTHORIZED_NEW_EVIDENCE"
        : "UNAUTHORIZED_FORMAL_ARTIFACT",
      "正文明确让未经授权的"
        + (newArtifact.kind === "EVIDENCE" ? "关键证据" : "正式文书或命令")
        + "进入因果链：" + newArtifact.subject,
      {
        subject: newArtifact.subject,
        clause: newArtifact.clause,
        durableClass: "NEW_ENTITY",
      },
    ));
  }

  const mutation = explicitUnauthorizedDurableMutation(
    narration,
    playerAuthority,
    worldMoves,
    policy.registeredObjects || [],
    policy.evidenceSubjects || [],
  );
  if (mutation) {
    hardIssues.push(blocking(
      "UNAUTHORIZED_DURABLE_STATE_CHANGE",
      "正文明确改变了服务器尚未结算的持久物件状态或持有人：" + mutation.clause,
      {
        subject: mutation.subject,
        axis: mutation.axis,
        clause: mutation.clause,
        durableClass: "STATE_CHANGE",
      },
    ));
  }

  const leakedSecret = explicitSecretLeak(
    narration,
    input.causalDelta.forbiddenKnowledge,
    policy.secretClaims || [],
    knownContext,
  );
  if (leakedSecret) {
    hardIssues.push(blocking(
      "SECRET_LEAK_WARNING",
      "正文把角色尚不知道的秘密明确写成了事实：" + leakedSecret,
      { claim: leakedSecret, durableClass: "KNOWLEDGE" },
    ));
  }

  const playerOverreach = explicitPlayerOverreach(
    narration,
    playerAuthority,
    policy.protagonistLabels || ["浙江总督", "总督", "制台"],
  );
  if (playerOverreach) {
    hardIssues.push(blocking(
      "PLAYER_ACTION_OVERREACH",
      "正文明确替玩家追加了没有选择的重大行动：" + playerOverreach.clause,
      {
        axis: playerOverreach.axis,
        clause: playerOverreach.clause,
        durableClass: "PLAYER_AUTHORITY",
      },
    ));
  }

  for (const missing of missingRequiredDurableResults(
    narration,
    input.causalDelta,
  )) {
    hardIssues.push(blocking(
      "MISSING_REQUIRED_DURABLE_RESULT",
      "正文漏掉了服务器已结算且本轮必须可见的结果：" + missing,
      { fact: missing, durableClass: "OMISSION" },
    ));
  }

  const shadowWarnings = [
    ...uncertainDurableCandidates({
      narration,
      durableAuthority,
      evidenceSubjects: unique([
        ...(policy.evidenceSubjects || []),
        ...(policy.durableClaimSubjects || []),
      ]),
      trackedLocations: policy.trackedLocations || [],
    }),
    ...missingSurfaceBeats(narration, input.causalDelta),
  ];
  return {
    ok: hardIssues.length === 0,
    hardIssues: deduplicate(hardIssues),
    shadowWarnings: deduplicate(shadowWarnings),
  };
}

function explicitNewNamedActor(narration: string, known: string) {
  const patterns = [
    /(?:名叫|名为|唤作|自称)[“"]?([\p{Script=Han}]{2,4})[”"]?/gu,
    /姓([\p{Script=Han}])名([\p{Script=Han}]{1,3})/gu,
  ];
  for (const pattern of patterns) {
    for (const match of narration.matchAll(pattern)) {
      const name = match[2] ? String(match[1]) + String(match[2]) : String(match[1] || "");
      if (name && !known.includes(name)) return name;
    }
  }
  return "";
}

function explicitNewDurableArtifact(
  narration: string,
  known: string,
  knownFormalArtifacts: string[],
  evidenceSubjects: string[],
) {
  const formal = unique([
    ...knownFormalArtifacts,
    "奏疏", "奏报", "具报", "公文", "回文", "手令", "密令", "令牌",
    "责任说明", "供状", "口供",
  ]);
  const evidence = unique([
    ...evidenceSubjects,
    "暗账", "仓单", "田契副本", "原始名册", "原册副本", "底稿", "副本", "抄件", "密信", "县册", "田契",
  ]);
  const arrival = /(?:呈上|递上|送来|带来|取出|拿出|掏出|发现|找到|搜出|写成|拟成|签发|颁下|交出|摆出|抱着|捧着|携着|携有)/u;
  for (const sentence of sentences(narration)) {
    if (!arrival.test(sentence)) continue;
    for (const subject of evidence) {
      if (sentence.includes(subject) && !known.includes(subject)) {
        return { kind: "EVIDENCE" as const, subject, clause: sentence };
      }
    }
    for (const subject of formal) {
      if (sentence.includes(subject) && !known.includes(subject)) {
        return { kind: "FORMAL_ARTIFACT" as const, subject, clause: sentence };
      }
    }
    const introduced = introducedDocumentLikeArtifact(sentence);
    if (introduced && !introducedArtifactIsKnown(introduced.subject, known)) {
      return { ...introduced, clause: sentence };
    }
  }
  return null;
}

function introducedDocumentLikeArtifact(sentence: string) {
  const match = sentence.match(
    /(?:一|半|这|那|某|数|几|两|三|四|五|六|七|八|九|十)?(?:张|页|份|册|封|卷|通|本|件)\s*([\p{Script=Han}]{1,8}?(?:抄单|清单|名单|账单|名册|簿册|账册|卷宗|案卷|契据|凭据|票据|供状|呈文|手帖|手札|札子|批文|公文|回文|奏报|奏疏|手令|密令|函件|书信|抄件|副本|底稿))/u,
  );
  const subject = String(match?.[1] || "").trim();
  if (!subject) return null;
  const kind = /(?:抄单|清单|名单|账单|名册|簿册|账册|卷宗|案卷|契据|凭据|票据|供状|抄件|副本|底稿)$/u
    .test(subject)
    ? "EVIDENCE" as const
    : "FORMAL_ARTIFACT" as const;
  return { kind, subject };
}

function introducedArtifactIsKnown(subject: string, known: string) {
  if (known.includes(subject)) return true;
  const suffix = subject.match(
    /(?:抄单|清单|名单|账单|名册|簿册|账册|卷宗|案卷|契据|凭据|票据|供状|呈文|手帖|手札|札子|批文|公文|回文|奏报|奏疏|手令|密令|函件|书信|抄件|副本|底稿)$/u,
  )?.[0];
  return Boolean(suffix && known.includes(suffix));
}

function explicitUnauthorizedDurableMutation(
  narration: string,
  playerAuthority: string,
  worldAuthority: string,
  registered: NonNullable<DurableTruthPolicy["registeredObjects"]>,
  evidenceSubjects: string[],
) {
  const subjects = unique([
    ...registered.map((item) => item.subject),
    ...evidenceSubjects,
  ]);
  const authority = playerAuthority + "\n" + worldAuthority;
  for (const sentence of sentences(narration)) {
    // Bind a durable verb only to the clause that names the durable subject.
    // Camera prose in a neighboring clause must never mutate that subject.
    for (const clause of causalClauses(sentence)) {
      const subject = subjects.find((candidate) => clause.includes(candidate));
      if (!subject) continue;
      const axis = mutationAxis(clause);
      if (!axis || authorityAllowsAxis(authority, subject, axis)) continue;
      return { subject, axis, clause };
    }
  }
  return null;
}

function causalClauses(sentence: string) {
  return sentence
    .split(/[，；;：:]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}
function mutationAxis(sentence: string) {
  const material = sentence
    .replace(/(?:目光|视线|眼神|心思|注意).{0,12}(?:移到|落到|转向|投向|停在|落在)/gu, "")
    .replace(/(?:看向|望向|盯着|端详|打量|瞥向)/gu, "");
  if (/(?:交给|交还|递还|移交|交付|带走|取走|收走|送回|转交|揣入|收入袖中)/u.test(material)) return "TRANSFER";
  if (/(?:烧毁|焚毁|撕毁|销毁|毁掉|丢弃)/u.test(material)) return "DESTROY";
  if (/(?:启封|拆封|打开|掀开|揭开|开匣|开锁)/u.test(material)) return "OPEN";
  if (/(?:封上|封好|合拢|关上|锁上|入匣|装入|塞入|放入)/u.test(material)) return "CLOSE_OR_INSERT";
  if (/(?:签发|签押|署名|落印|用印|盖印)/u.test(material)) return "AUTHENTICATE";
  return "";
}

function authorityAllowsAxis(authority: string, subject: string, axis: string) {
  if (!authority.includes(subject)) return false;
  const patterns: Record<string, RegExp> = {
    TRANSFER: /(?:交给|交还|递还|移交|交付|带走|取走|收走|送回|转交|揣入|收入)/u,
    DESTROY: /(?:烧毁|焚毁|撕毁|销毁|毁掉|丢弃)/u,
    OPEN: /(?:启封|拆封|打开|揭开|开匣|开锁)/u,
    CLOSE_OR_INSERT: /(?:封上|封好|合拢|关上|锁上|入匣|装入|塞入|放入|封存)/u,
    AUTHENTICATE: /(?:签发|签押|署名|落印|用印|盖印)/u,
  };
  return Boolean(patterns[axis] && actionAuthorized(authority, patterns[axis]));
}

function explicitSecretLeak(
  narration: string,
  forbiddenKnowledge: string[],
  policyClaims: string[],
  knownContext: string,
) {
  for (const claim of unique([...forbiddenKnowledge, ...policyClaims])) {
    if (knownContext.includes(claim)) continue;
    const sentence = sentences(narration).find((candidate) => candidate.includes(claim));
    if (sentence && assertiveClaim(sentence)) return sentence;
  }
  return sentences(narration).find((sentence) => (
    /(?:幕后主使|真正主谋|巡抚指使|商会主使).{0,10}(?:就是|正是|已经证实|果然是)/u.test(sentence)
    && !knownContext.includes(sentence)
  )) || "";
}

function assertiveClaim(sentence: string) {
  return !/(?:不知|不知道|尚不知|尚未核实|未能证实|不能确定|无法确认|也许|或许|可能|怀疑|猜测|若|倘若|是否|？|\?)/u.test(sentence);
}

function explicitPlayerOverreach(
  narration: string,
  authorization: string,
  protagonistLabels: string[],
) {
  const futureCommitment = /(?:(?:回文|公文|奏报|奏疏|答复).{0,12}(?:今晚|今日|明日|午前|稍后|随后|三日内).{0,12}(?:给|交|送|发|写成|办妥)|(?:今晚|今日|明日|午前|稍后|随后|三日内).{0,12}(?:给|交|送|发|写成|办妥).{0,12}(?:回文|公文|奏报|奏疏|答复))/u;
  const axes: Array<[string, RegExp, RegExp]> = [
    ["SIGN", /(?:签发|签押|署名|落印|用印|盖印)/u, /(?:签发|签押|署名|落印|用印|盖印)/u],
    ["PROMISE", /(?:承诺|保证|答应|担下|承担责任|具名担责)/u, /(?:承诺|保证|答应|担下|担责|承担责任)/u],
    ["ORDER", /(?:下令|命人|命其|吩咐|传令|派人|另派|调人)/u, /(?:下令|命人|命其|吩咐|传令|派人|另派|调人)/u],
    ["COERCE", /(?:扣押|拘拿|拿下|封档|封存|不许出入)/u, /(?:扣押|拘拿|拿下|封档|封存|不许出入)/u],
    ["REPORT", /(?:奏报|具报|发文|行文|知会京师|上报|(?:写|给|交|发|送)(?:回文|公文|奏疏))/u, /(?:奏报|具报|发文|行文|知会京师|上报|(?:写|给|交|发|送)(?:回文|公文|奏疏))/u],
    ["SECRECY", /(?:不必声张|不要声张|不得声张|不要知会|不得知会|不许知会|秘而不宣|不得外传|不许外传)/u, /(?:不必声张|不要声张|不得声张|不要知会|不得知会|不许知会|秘而不宣|不得外传|不许外传)/u],
    ["FUTURE_COMMITMENT", futureCommitment, futureCommitment],
  ];
  for (const span of speakerSpans(narration, protagonistLabels)) {
    if (span.speaker === "OTHER") continue;
    let priorSentenceWasProtagonist = span.speaker === "PROTAGONIST";
    for (const sentence of sentences(span.text)) {
      const explicitProtagonist = span.speaker === "PROTAGONIST"
        || unique(protagonistLabels).some((label) => sentenceStartsWithActor(sentence, label));
      if (explicitProtagonist) priorSentenceWasProtagonist = true;
      else if (startsWithOtherActor(sentence)) priorSentenceWasProtagonist = false;
      const anaphoricProtagonist = priorSentenceWasProtagonist
        && /^[“"'’]?他/u.test(sentence);
      if (!explicitProtagonist && !anaphoricProtagonist) continue;
      // Conditions and proposals do not become completed player actions.
      if (/(?:若|倘若|如果|假使|只要)/u.test(sentence)) continue;
      if (/(?:此前|先前|上一回|上回|昨日|方才|刚才|已经|早已|原已|本已)/u.test(sentence)) continue;
      for (const [axis, prosePattern, authorityPattern] of axes) {
        const match = sentence.match(prosePattern);
        if (!match || explicitlyNegated(sentence, match.index || 0)) continue;
        if (!actionAuthorized(authorization, authorityPattern)) return { axis, clause: sentence };
      }
    }
  }
  return null;
}

type SpeakerSpan = {
  text: string;
  speaker: "NARRATION" | "PROTAGONIST" | "OTHER" | "UNKNOWN";
};

function speakerSpans(narration: string, protagonistLabels: string[]): SpeakerSpan[] {
  const spans: SpeakerSpan[] = [];
  const quotePattern = /[“"]([\s\S]*?)[”"]/gu;
  let cursor = 0;
  let priorSpeaker: SpeakerSpan["speaker"] = "UNKNOWN";
  for (const match of narration.matchAll(quotePattern)) {
    const index = match.index || 0;
    const narrative = narration.slice(cursor, index);
    if (narrative.trim()) spans.push({ text: narrative, speaker: "NARRATION" });
    const inferred: SpeakerSpan["speaker"] = inferDialogueSpeaker(
      narrative,
      protagonistLabels,
      priorSpeaker,
    );
    const speaker: SpeakerSpan["speaker"] = inferred === "UNKNOWN"
      ? priorSpeaker
      : inferred;
    spans.push({ text: String(match[1] || ""), speaker });
    if (speaker !== "UNKNOWN") priorSpeaker = speaker;
    cursor = index + match[0].length;
  }
  const tail = narration.slice(cursor);
  if (tail.trim()) spans.push({ text: tail, speaker: "NARRATION" });
  return spans.length ? spans : [{ text: narration, speaker: "NARRATION" }];
}

function inferDialogueSpeaker(
  narrativeBefore: string,
  protagonistLabels: string[],
  priorSpeaker: SpeakerSpan["speaker"],
): SpeakerSpan["speaker"] {
  const paragraphs = String(narrativeBefore || "")
    .split(/\n\s*\n/gu)
    .map((item) => item.trim())
    .filter(Boolean);
  const paragraph = paragraphs.at(-1) || "";
  const stripped = paragraph.replace(/^[“"'‘’\s]+/u, "");
  const protagonist = unique(protagonistLabels)
    .find((label) => sentenceStartsWithActor(stripped, label));
  const other = stripped.match(
    /^(巡抚|书吏|亲随|幕僚|县令|守卫|轮机员|领航官|导航员|观测员|值差|随从|差役)/u,
  )?.[1];
  if (other) return "OTHER";
  if (protagonist) return "PROTAGONIST";
  if (/^(?:他|她)[^。！？\n]{0,80}(?:开(?:了)?口|说|道|问|答|接话|补(?:了)?一句)/u.test(stripped)) {
    return priorSpeaker;
  }
  return "UNKNOWN";
}
function startsWithOtherActor(sentence: string) {
  const stripped = sentence.replace(/^[“"'‘’\s]+/u, "");
  return /^(?:巡抚|书吏|亲随|幕僚|县令|守卫|轮机员|领航官|导航员|观测员|值差|随从|差役)/u.test(stripped);
}

function sentenceStartsWithActor(sentence: string, label: string) {
  const stripped = sentence.replace(/^[“"'‘’\s]+/u, "");
  const index = stripped.indexOf(label);
  if (index < 0 || index > 12) return false;
  const suffix = stripped.slice(index + label.length, index + label.length + 2);
  // A role label embedded in a place name is not the acting protagonist:
  // “总督府签押房” and “舰长室” describe locations, not player acts.
  if (/^(?:府|衙|署|门|房|室|厅|行辕|公署)/u.test(suffix)) return false;
  return !/(?:问|请|催|望|候|等|逼|向|对)/u.test(stripped.slice(0, index));
}

function actionAuthorized(authorization: string, pattern: RegExp) {
  for (const clause of sentences(authorization)) {
    const match = clause.match(pattern);
    if (!match) continue;
    if (explicitlyNegated(clause, match.index || 0)) continue;
    return true;
  }
  return false;
}
function explicitlyNegated(sentence: string, verbIndex: number) {
  const beforeVerb = sentence.slice(0, verbIndex);
  const clauseBoundary = Math.max(
    beforeVerb.lastIndexOf("，"),
    beforeVerb.lastIndexOf(","),
    beforeVerb.lastIndexOf("；"),
    beforeVerb.lastIndexOf(";"),
    beforeVerb.lastIndexOf("。"),
    beforeVerb.lastIndexOf("！"),
    beforeVerb.lastIndexOf("!"),
    beforeVerb.lastIndexOf("？"),
    beforeVerb.lastIndexOf("?"),
  );
  const currentClause = beforeVerb.slice(clauseBoundary + 1);
  return /(?:没有|并未|未曾|不曾|尚未|并不|不肯|不再|不予|暂不|先不|不替|不得|不许|不能|不要|不必).{0,16}$/u
    .test(currentClause.slice(-16));
}

function missingRequiredDurableResults(narration: string, delta: CausalDelta) {
  const missing: string[] = [];
  for (const fact of delta.requiredNarrativeFacts) {
    if (!semanticAnchorPresent(narration, fact)) missing.push(fact);
  }
  for (const group of delta.beatContract?.requiredDurableAnchorGroups || []) {
    if (!durableAnchorGroupPresent(narration, group)) {
      missing.push(group.join(" / "));
    }
  }
  return unique(missing);
}

function missingSurfaceBeats(narration: string, delta: CausalDelta) {
  const durableKeys = new Set(
    (delta.beatContract?.requiredDurableAnchorGroups || []).map((group) => group.join("\0")),
  );
  return (delta.beatContract?.requiredAnchorGroups || [])
    .filter((group) => !durableKeys.has(group.join("\0")))
    .filter((group) => !durableAnchorGroupPresent(narration, group))
    .map((group) => warning(
      "MISSING_SURFACE_BEAT",
      "正文可能没有清楚呈现建议的场面节拍：" + group.join(" / "),
      "MEDIUM",
      { anchors: group.join("|") },
    ));
}

export function durableAnchorGroupPresent(narration: string, group: string[]) {
  return group.some((anchor) => semanticAnchorPresent(narration, anchor));
}

function semanticAnchorPresent(narration: string, rawAnchor: string) {
  const exact = rawAnchor.startsWith("EXACT:");
  const anchor = rawAnchor.replace(/^EXACT:/u, "").trim();
  if (!anchor) return true;
  if (exact) return narration.includes(anchor);
  const target = normalizeSemantic(anchor);
  const source = normalizeSemantic(narration);
  if (source.includes(target)) return true;
  // Natural Chinese may place modifiers between a negation and its durable
  // action: “不在其上共同具名” is still an explicit “不具名”.
  const negative = target.match(/^(?:拒绝|不肯|不愿|不)(.{2,})$/u);
  if (negative) {
    const stem = negative[1];
    const equivalent = new RegExp(
      "(?:拒绝|不肯|不愿|不).{0,8}" + escapeRegExp(stem),
      "u",
    );
    if (equivalent.test(source)) return true;
  }
  if (target.length < 4) return false;
  const grams = chineseBigrams(target);
  const sourceGrams = new Set(chineseBigrams(source));
  return grams.length > 0
    && grams.filter((gram) => sourceGrams.has(gram)).length / grams.length >= 0.72;
}

function uncertainDurableCandidates(input: {
  narration: string;
  durableAuthority: string;
  evidenceSubjects: string[];
  trackedLocations: string[];
}) {
  const warnings: RuntimeWarning[] = [];
  let lastEvidenceSubject = "";
  for (const sentence of sentences(input.narration)) {
    const directSubject = unique(input.evidenceSubjects)
      .find((candidate) => sentence.includes(candidate)) || "";
    if (directSubject) lastEvidenceSubject = directSubject;
    const hasAnaphoricDurableClaim = (
      input.trackedLocations.some((candidate) => sentence.includes(candidate))
      || /(?:没有人|无人).{0,8}(?:碰过|动过|看过|打开过)|(?:原封未动|未曾启封|一直由|始终由)/u.test(sentence)
    );
    const subject = directSubject || (hasAnaphoricDurableClaim ? lastEvidenceSubject : "");
    if (!subject) continue;
    const quantity = sentence.match(/(?:\d+|[一二三四五六七八九十百千万两半]+)(?:次|份|页|册|封|人|日|天|时辰|亩|石|担|两|处|户)/u)?.[0];
    if (quantity && !input.durableAuthority.includes(quantity)) {
      warnings.push(warning(
        "UNVERIFIED_DURABLE_QUANTITY",
        "正文出现了尚未进入持久状态的数量候选：" + subject + " " + quantity,
        "MEDIUM",
        { subject, value: quantity, disposition: "SHADOW" },
      ));
    }
    if (
      /(?:没有人|无人).{0,8}(?:碰过|动过|看过|打开过)|(?:原封未动|未曾启封|一直由|始终由)/u.test(sentence)
      && !input.durableAuthority.includes(sentence)
    ) {
      warnings.push(warning(
        "UNVERIFIED_DURABLE_CUSTODY",
        "正文出现了尚未核实的保管或接触状态：" + subject,
        "MEDIUM",
        { subject, disposition: "SHADOW" },
      ));
    }
    const location = input.trackedLocations
      .find((candidate) => sentence.includes(candidate));
    if (
      location
      && /(?:在|存于|藏在|送到|留在|搁在|放在)/u.test(sentence)
      && !input.durableAuthority.includes(sentence)
    ) {
      warnings.push(warning(
        "UNVERIFIED_DURABLE_LOCATION",
        "正文出现了尚未确认的所在地候选：" + subject + " → " + location,
        "MEDIUM",
        { subject, location, disposition: "SHADOW" },
      ));
    }
  }
  return warnings;
}

function sentences(value: string) {
  return String(value || "")
    .split(/(?<=[。！？!?；;])|\n+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSemantic(value: string) {
  return String(value || "")
    .replace(/^EXACT:/u, "")
    .replace(/[\s，。！？；、,.!?;:“”‘’'"（）()—-]/gu, "")
    .replace(/[了着过的地得]/gu, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
function chineseBigrams(value: string) {
  const chars = [...value];
  return chars.slice(0, -1).map((char, index) => char + chars[index + 1]);
}

function blocking(code: string, message: string, details?: Record<string, string>): RuntimeWarning {
  return { code, message, severity: "HIGH", blocksPlayer: true, details };
}

function warning(
  code: string,
  message: string,
  severity: RuntimeWarning["severity"],
  details?: Record<string, string>,
): RuntimeWarning {
  return { code, message, severity, blocksPlayer: false, details };
}

function deduplicate(values: RuntimeWarning[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.code + "\0" + value.message;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}
