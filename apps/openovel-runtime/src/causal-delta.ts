import type {
  CausalDelta,
  OpenNovelOption,
  RuntimeWarning,
} from "./types.js";

export function normalizeReaderAction(value: string) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildCausalDelta(input: {
  turnId: string;
  action: string;
  selectedOption: OpenNovelOption | null;
}): CausalDelta {
  const readerAction = normalizeReaderAction(input.action);
  const selectedIntent = normalizeReaderAction(input.selectedOption?.effect?.intent || "");
  const immediateIntent = selectedIntent || readerAction;
  const protagonistScope = classifyProtagonistScope(readerAction, immediateIntent);
  const durableHints = (input.selectedOption?.effect?.stateHints || [])
    .filter((hint) => hint && hint.key)
    .slice(0, 8);
  const requiredNarrativeFacts = durableHints
    .filter((hint) => hint.presentThisTurn === true)
    .map((hint) => normalizeReaderAction(hint.surfaceAnchor || hint.note || ""))
    .filter(Boolean);
  const authoredKnowledgeBoundary = input.selectedOption?.effect?.knowledgeBoundary;
  const parsedKnowledgeBoundary = extractKnowledgeBoundary(selectedIntent);
  const knowledgeBoundary = authoredKnowledgeBoundary
    ? {
      allowed: normalizeKnowledgeItems(authoredKnowledgeBoundary.allowed),
      forbidden: normalizeKnowledgeItems(authoredKnowledgeBoundary.forbidden),
      subjects: normalizeKnowledgeItems(authoredKnowledgeBoundary.subjects || []),
      sourceRef: normalizeReaderAction(authoredKnowledgeBoundary.sourceRef || ""),
    }
    : parsedKnowledgeBoundary;
  const authoredBeat = input.selectedOption?.effect?.beatContract;
  const beatContract = authoredBeat
    ? {
      sourceRef: normalizeReaderAction(authoredBeat.sourceRef || ""),
      objective: normalizeReaderAction(authoredBeat.objective),
      moves: normalizeKnowledgeItems(authoredBeat.moves),
      requiredAnchorGroups: (authoredBeat.requiredAnchorGroups || [])
        .map((group) => normalizeKnowledgeItems(group))
        .filter((group) => group.length > 0)
        .slice(0, 12),
      requiredDurableAnchorGroups: (authoredBeat.requiredDurableAnchorGroups || [])
        .map((group) => normalizeKnowledgeItems(group))
        .filter((group) => group.length > 0)
        .slice(0, 12),
      authorizedPlayerActions: normalizeKnowledgeItems(
        authoredBeat.authorizedPlayerActions || [],
      ),
      constraints: normalizeKnowledgeItems(authoredBeat.constraints || []),
      stopCondition: normalizeReaderAction(authoredBeat.stopCondition),
    }
    : null;

  return {
    turnId: input.turnId,
    source: input.selectedOption ? "bound-option" : "free-text",
    readerAction,
    immediateIntent,
    protagonistScope,
    stopCondition: stopConditionForScope(protagonistScope),
    allowedKnowledge: knowledgeBoundary.allowed,
    forbiddenKnowledge: knowledgeBoundary.forbidden,
    evidenceSubjects: knowledgeBoundary.subjects,
    ...(knowledgeBoundary.sourceRef
      ? { knowledgeBoundaryRef: knowledgeBoundary.sourceRef }
      : {}),
    beatContract,
    durableHints,
    requiredNarrativeFacts: [...new Set(requiredNarrativeFacts)],
  };
}

export function renderCausalDelta(delta: CausalDelta) {
  const narrativeIntent = authorizedNarrativeIntent(delta.immediateIntent);
  const lines = [
    `- 本轮已授权行动：${delta.readerAction}`,
  ];
  if (
    delta.source === "bound-option"
    && narrativeIntent
    && narrativeIntent !== delta.readerAction
  ) {
    lines.push(`- 该选择绑定的即时意图：${narrativeIntent}`);
  }
  lines.push(`- 主角行动边界：${delta.protagonistScope}`);
  lines.push(`- 本回合停点：${delta.stopCondition}`);
  if (delta.allowedKnowledge.length) {
    lines.push(`- NPC 本轮只可确认：${delta.allowedKnowledge.join("；")}`);
  }
  if (delta.forbiddenKnowledge.length) {
    lines.push("- 本轮知识上限：只写前述可确认内容；未列入的证据细节让人物如实说不知，不要枚举、猜测或补全。");
  }
  if (delta.beatContract) {
    lines.push(`- 本回合场面目标：${delta.beatContract.objective}`);
    lines.push(`- 场面顺序：${delta.beatContract.moves.join(" → ")}`);
    if (delta.beatContract.constraints?.length) {
      lines.push(`- 本回合结果上限：${delta.beatContract.constraints.join("；")}`);
    }
    lines.push(`- 自然收束点：${delta.beatContract.stopCondition}`);
  }
  if (delta.requiredNarrativeFacts.length) {
    lines.push(`- 本轮必须在场面中兑现：${delta.requiredNarrativeFacts.join("；")}`);
  }
  return lines.join("\n");
}

/**
 * The foreground Narrator needs a small playable instruction, not the complete
 * settlement/audit envelope. Keep only the action, the world move that must be
 * visible now, a few durable boundaries, and the natural stop point.
 */
export function renderNarratorCausalDelta(delta: CausalDelta) {
  const lines = [`- 玩家现在要做：${compactNarratorLine(delta.readerAction, 220)}`];
  if (String(delta.beatContract?.settledNarrative || "").trim()) {
    lines.push("- 已结算动作已由 Settled Action Draft 写成；只续写其后的 NPC 回应和世界行动，不得重写文书、条款、认证状态或去向。");
  }
  if (
    delta.source === "bound-option"
    && delta.immediateIntent
    && delta.immediateIntent !== delta.readerAction
  ) {
    lines.push(`- 行动意图：${compactNarratorLine(
      authorizedNarrativeIntent(delta.immediateIntent),
      220,
    )}`);
  }
  const boundedKnowledgeMoves = delta.forbiddenKnowledge.length
    ? (delta.beatContract?.moves || [])
      .filter((move) => (
        /(?:只让|只答|只复述|复述|如实说不知道|如实说不知|不再追问|尚未.{0,8}核实)/u
          .test(move)
      ))
      .slice(0, 3)
      .map((move) => compactNarratorLine(move, 180))
    : [];
  if (boundedKnowledgeMoves.length) {
    lines.push(`- 已审定问答节拍：${boundedKnowledgeMoves.join("；")}`);
  }
  const sceneMove = (delta.beatContract?.moves || [])
    .find((move) => /(?:议事|场面|镜头).{0,12}(?:转到|移到|进入)|(?:转到|进入).{0,28}(?:府|县|厅|房|衙|仓|码头|市)/u.test(move));
  const orderedCausalMoves = (delta.beatContract?.moves || [])
    .map((move) => ({
      action: narrativeBeatAction(move),
      full: normalizeReaderAction(move),
    }))
    .filter((move) => Boolean(move.action))
    .filter((move) => move.action !== delta.readerAction)
    .filter((move) => !(
      move.action.length >= 8
      && delta.readerAction.includes(move.action)
    ))
    .filter((move) => move.action !== narrativeBeatAction(sceneMove || ""))
    .filter((move) => !boundedKnowledgeMoves.includes(compactNarratorLine(move.action, 180)))
    .slice(0, 3);
  const sceneConstraints = (delta.beatContract?.constraints || [])
    .filter((constraint) => (
      /(?:完成旧场|收束旧场).{0,40}(?:转到|进入)|转场后的现场只允许|(?:新场|转场).{0,20}(?:在场|不得随转场)/u
        .test(constraint)
    ))
    .slice(0, 2);
  if (sceneMove) {
    lines.push(`- 场景承接：${compactNarratorLine(
      sceneMove.split(/具体兑现[：:]/u)[0].trim(),
      180,
    )}`);
  }
  if (sceneConstraints.length) {
    lines.push(`- 转场边界：${sceneConstraints
      .map((constraint) => compactNarratorLine(constraint, 180))
      .join("；")}`);
  }
  const sceneDocumentConstraint = (delta.beatContract?.constraints || [])
    .find((constraint) => /新场.{0,48}(?:正式文书|证据容器)/u.test(constraint));
  if (sceneDocumentConstraint) {
    lines.push(`- 新场因果物件：${compactNarratorLine(sceneDocumentConstraint, 220)}`);
  }
  const formalDocumentBoundaries = (delta.beatContract?.constraints || [])
    .filter(isClosedFormalDocumentBoundary)
    .slice(0, 1)
    .map((constraint) => compactNarratorLine(constraint, 280));
  if (formalDocumentBoundaries.length) {
    lines.push(`- 正式文书闭集：${formalDocumentBoundaries.join("；")}`);
  }
  const documentKnowledgeBoundaries = (delta.beatContract?.constraints || [])
    .filter(isDocumentKnowledgeBoundary)
    .slice(0, 2)
    .map((constraint) => compactNarratorLine(constraint, 320));
  if (documentKnowledgeBoundaries.length) {
    lines.push(`- 文书知情边界：${documentKnowledgeBoundaries.join("；")}`);
  }
  const durableBoundaries = (delta.beatContract?.constraints || [])
    .filter((constraint) => (
      isNarratorDurableBoundary(constraint)
      && !isClosedFormalDocumentBoundary(constraint)
      && !isDocumentKnowledgeBoundary(constraint)
    ))
    .slice(0, 2)
    .map((constraint) => compactNarratorLine(constraint, 180));
  if (durableBoundaries.length) {
    lines.push(`- 持久事实边界：${durableBoundaries.join("；")}`);
  }
  if (orderedCausalMoves.length) {
    lines.push(`- 已审批场面节拍（依次写成动作与对话）：${orderedCausalMoves
      .map((move, index) => `${index + 1}. ${compactNarratorLine(move.full, 440)}`)
      .join("；")}`);
  }
  const authoredStop = normalizeReaderAction(delta.beatContract?.stopCondition || "");
  if (authoredStop && authoredStop !== delta.readerAction) {
    if (formalDocumentBoundaries.length) {
      lines.push("- 先后边界：先完成并移交上述闭集文书；其后人物才口头提出新的要求。口头反制不得倒写进已经完成的文书。");
    }
    lines.push(`- 场面自然回应到：${compactNarratorLine(authoredStop, 220)}`);
  }
  if (delta.allowedKnowledge.length) {
    lines.push(`- 人物目前可确认：${delta.allowedKnowledge.slice(0, 4).join("；")}`);
  }
  if (delta.forbiddenKnowledge.length) {
    lines.push("- 未核实的证据细节仍属未知；人物可以说不知道，不要替故事补出答案。");
  }
  if (delta.requiredNarrativeFacts.length) {
    lines.push(`- 已结算并须在镜头中看见：${delta.requiredNarrativeFacts.join("；")}`);
  }
  const requiredDurableAnchors = delta.beatContract?.requiredDurableAnchorGroups || [];
  if (requiredDurableAnchors.length && orderedCausalMoves.length === 0) {
    lines.push(`- 玩家已结算行动必须写实：${requiredDurableAnchors
      .map((group) => group[0])
      .filter(Boolean)
      .join("；")}。不得用“照办”“写了几行”或类似省略代替。`);
  }
  lines.push(`- 写到这里停：${compactNarratorLine(
    delta.beatContract?.stopCondition || delta.stopCondition,
    220,
  )}`);
  return lines.join("\n");
}

function isNarratorDurableBoundary(value: string) {
  return /(?:具名人物|关键证据|正式文书|命令|回文|奏报|奏疏|公文|责任说明|签发|签押|落印|用印|持有人|保管|移交|交给|递给|封存|启封|损毁|知情|秘密|只写|不得.{0,24}(?:新增|确认|签|承诺|移交|公开|泄露))/u
    .test(String(value || ""));
}

function isClosedFormalDocumentBoundary(value: string) {
  return /(?:(?:文中|其中|回文中|奏报中|公文中|责任说明中|航行令中)只(?:写|载)|正文只载)/u
    .test(String(value || ""));
}

function isDocumentKnowledgeBoundary(value: string) {
  const text = String(value || "");
  return /(?:文书|公文|回文|奏报|奏疏|责任说明|航行令|命令).{0,48}(?:只由.{0,20}知晓|只知道.{0,20}存在|未经.{0,24}(?:出示|宣读|移交)|不得让.{0,24}(?:看见|复述|依据))/u
    .test(text);
}

function compactNarratorLine(value: string, maxChars: number) {
  const text = normalizeReaderAction(value);
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

function narrativeBeatAction(value: string) {
  return normalizeReaderAction(value)
    .split(/。具体兑现[：:]/u)[0]
    .replace(/[。；]+$/u, "")
    .trim();
}

export function authorizedNarrativeIntent(value: string) {
  return normalizeReaderAction(value)
    .split(/[。；]/u)
    .map((clause) => clause.trim())
    .map((clause) => clause
      .replace(
        /[，,]\s*(?:不替(?:玩家|主角|总督)|(?:不能|不得|不可|不许|不要|切勿|勿|莫要)(?:再|继续|擅自)?).+$/u,
        "",
      )
      .trim())
    .filter(Boolean)
    .filter((clause) => (
      !/(?:不能|不得|不可|不许).{0,16}(?:补充|提供|确定|断言|声称)/u.test(clause)
      && !/(?:留给玩家|下一回合|下一步决定|尚未决定|仍待决定|是否.{0,40}(?:决定|留给))/u.test(clause)
    ))
    .join("；");
}

export function classifyProtagonistScope(
  readerAction: string,
  immediateIntent = readerAction,
): CausalDelta["protagonistScope"] {
  const action = normalizeReaderAction(readerAction);
  const intent = normalizeReaderAction(immediateIntent);
  const combined = `${action}\n${intent}`;
  const consequential = /(?:下令|命人|命其|命[\p{Script=Han}]{1,16}|吩咐|传令|派人|另派|调人|护住|封档|封存|签发|落印|批准|准许|扣押|拘拿|正式答复|知会|回文|写札|发文|让.{0,12}(?:离开|退下|回去|告退))/u;
  const explicitFollowupDirective = /(?:并|再|然后|同时|继而|问后|问完).{0,16}(?:下令|命人|命其|吩咐|传令|派人|另派|调人|封档|封存|签发|落印|批准|准许|扣押|拘拿|正式答复|知会|写札|发文)/u;
  const standaloneMaterialAction = /(?:^|[，；。]\s*)(?:(?:暂不|先不|不予|扣下).{0,16}(?:签发|落印|用印|放行)|(?:留下|留住|留在|候着).{0,16}(?:书吏|亲随|证人|来人)|(?:封档|封存|扣押|拘拿|正式答复|知会|写札|发文))/u;
  if (
    /(?:问|询问|追问|查问|核对|打听|请教)/.test(action)
    && !standaloneMaterialAction.test(action)
    && !explicitFollowupDirective.test(action)
  ) {
    return "inquiry-only";
  }
  if (
    /(?:看|观察|查看|翻看|阅读|听|等待|留意|思量|考虑)/.test(action)
    && !consequential.test(combined)
  ) {
    return "observation-only";
  }
  return "bounded-action";
}

function stopConditionForScope(scope: CausalDelta["protagonistScope"]) {
  if (scope === "inquiry-only") {
    return "主角只完成本次发问或核对；写出对方的直接回应和现场即时反应后立刻停下。不得再替主角答复、下令、承诺、派遣、签署、放人或离场。";
  }
  if (scope === "observation-only") {
    return "主角只完成观察、阅读、等待或思量；一旦出现需要处置的新情况就停下。不得替主角作出新的命令、承诺、派遣或签署。";
  }
  return "只兑现 Reader Action 与已绑定即时意图；在下一项未获授权的主角重大动作之前停下，让玩家决定。";
}

export function validateRequiredNarrativeFacts(
  narration: string,
  delta: CausalDelta,
): RuntimeWarning[] {
  const text = String(narration || "");
  const sceneDocumentPolicy = parseSceneDocumentPolicy(
    delta.beatContract?.constraints || [],
  );
  const unauthorizedSceneDocument = sceneDocumentPolicy.restricted
    ? extractUnauthorizedSceneDocument(
      transitionedSceneText(text, delta.beatContract?.constraints || []),
      sceneDocumentPolicy.allowed,
    )
    : "";
  const sceneDocumentWarnings: RuntimeWarning[] = unauthorizedSceneDocument
    ? [{
      code: "UNAUTHORIZED_SCENE_DOCUMENT",
      message: `正文让未获批的正式文书或证据容器进入新场：${unauthorizedSceneDocument}`,
      severity: "HIGH",
      blocksPlayer: true,
      details: {
        artifact: unauthorizedSceneDocument,
        truthLayer: "DURABLE",
      },
    }]
    : [];
  const factWarnings = delta.requiredNarrativeFacts
    .filter((fact) => !text.includes(fact))
    .map((fact) => ({
      code: "MISSING_REQUIRED_DURABLE_RESULT",
      message: `正文没有呈现本轮已确定的持久结果：${fact}`,
      severity: "HIGH" as const,
      blocksPlayer: true,
      details: { fact },
    }));
  const durableAnchorGroups = delta.beatContract?.requiredDurableAnchorGroups || [];
  const durableAnchorWarnings = durableAnchorGroups
    .filter((group) => !narrativeSatisfiesAnchorGroup(text, group, durableAnchorGroups))
    .map((group) => ({
      code: "MISSING_REQUIRED_DURABLE_RESULT",
      message: `正文没有呈现本轮已结算的关键行动、回应或到期后果：${group.join(" / ")}`,
      severity: "HIGH" as const,
      blocksPlayer: true,
      details: {
        anchors: group.join("|"),
        truthLayer: "DURABLE",
      },
    }));
  const durableAnchorKeys = new Set(durableAnchorGroups.map((group) => group.join("|")));
  const anchorWarnings = (delta.beatContract?.requiredAnchorGroups || [])
    .filter((group) => !durableAnchorKeys.has(group.join("|")))
    .filter((group) => !narrativeSatisfiesAnchorGroup(
      text,
      group,
      delta.beatContract?.requiredAnchorGroups || [],
    ))
    .map((group) => ({
      code: "MISSING_REQUIRED_BEAT_OUTCOME",
      message: `正文可能没有清楚呈现已批准剧情 beat：${group.join(" / ")}`,
      severity: "MEDIUM" as const,
      // A lexical or camera-level omission is Surface Truth. Preserve the
      // playable prose and ask Storykeeper to surface the unresolved beat on
      // the next turn. Only an explicit presentThisTurn durable result above
      // remains a publication blocker.
      blocksPlayer: false,
      details: {
        anchors: group.join("|"),
        truthLayer: "SURFACE",
        disposition: "REPAIR_NEXT_TURN",
      },
    }));
  return [
    ...sceneDocumentWarnings,
    ...factWarnings,
    ...durableAnchorWarnings,
    ...anchorWarnings,
  ];
}

function parseSceneDocumentPolicy(constraints: string[]) {
  const joined = constraints.join("\n");
  if (/新场没有获批的正式文书或证据容器在案/u.test(joined)) {
    return { restricted: true, allowed: [] as string[] };
  }
  const allowedMatch = joined.match(
    /新场获批在场的正式文书或证据容器仅有[：:]([^；。\n]+)/u,
  );
  const allowed = allowedMatch
    ? String(allowedMatch[1] || "")
      .split(/[、，,和与及]/u)
      .map((value) => value.trim())
      .filter(Boolean)
    : [];
  return { restricted: Boolean(allowedMatch), allowed };
}

function transitionedSceneText(text: string, constraints: string[]) {
  const location = constraints.join("\n").match(
    /(?:转到|进入)[^；。\n]{0,80}(签押房|内厅|档房|库房|公堂|码头|粮仓|议事厅|舰桥|观测舱)/u,
  )?.[1];
  if (!location) return text;
  const index = text.indexOf(location);
  return index >= 0 ? text.slice(index) : text;
}

function extractUnauthorizedSceneDocument(text: string, allowed: string[] = []) {
  const artifactPattern = /(督抚责任说明|责任说明|核验单|查验单|复核单|手帖|手札|批文|公文|正式文书|文书|簿册|册簿|账册|卷宗|案卷|书册|令签|令牌|腰牌|印信|关防|册页匣|册匣|卷宗匣|案卷袋|档案袋)/u;
  for (const span of String(text || "").split(/[。！？；\n]+/u)) {
    const clause = span.trim();
    if (!clause || !artifactPattern.test(clause)) continue;
    const artifact = [...clause.matchAll(new RegExp(artifactPattern.source, "gu"))]
      .map((match) => String(match[1] || "").trim())
      .find((candidate) => !allowed.some((item) => (
        item.includes(candidate) || candidate.includes(item)
      ))) || "";
    if (!artifact) continue;
    if (/(?:没有|并无|未有|未见|未带|未呈|尚未呈|不在案|没有带文书)/u.test(clause)) {
      continue;
    }
    if (
      /(?:案上|案边|案角|桌上|手边|怀中|袖中|侧案|面前).{0,44}(?:放着|摆着|摊着|摊开|搁着|取出|拿出|抱着|捧着|有|未启封|封好的|空白).{0,20}(督抚责任说明|责任说明|核验单|查验单|复核单|手帖|手札|批文|公文|正式文书|文书|令签|令牌|腰牌|印信|关防|册页匣|册匣|卷宗匣|案卷袋|档案袋)/u.test(clause)
      || /(?:几份|数份|若干|一份|一封|一通|一支|一枚|一方|一面|一块|一件).{0,12}(?:未启封的|封好的|空白的|巡抚的|总督的)?(督抚责任说明|责任说明|核验单|查验单|复核单|手帖|手札|批文|公文|正式文书|文书|令签|令牌|腰牌|印信|关防)/u.test(clause)
      || /(?:递出|递了|呈出|呈了|持着|拿着|亮出|出示).{0,20}(令签|令牌|腰牌|印信|关防)/u.test(clause)
      || /(?:包袱|行囊|匣|箱|袋|怀中|袖中|胸前).{0,28}(?:里头|里面|内|装着|藏着|包着|放着|是).{0,16}(簿册|册簿|账册|卷宗|案卷|书册)/u.test(clause)
    ) {
      return artifact;
    }
  }
  return "";
}

function narrativeSatisfiesAnchorGroup(
  text: string,
  group: string[],
  relatedGroups: string[][] = [],
) {
  if (isWritingActionAnchorGroup(group)) {
    return narrativeEstablishesWritingAction(text, group);
  }
  if (group.some((anchor) => narrativeContainsAnchor(text, anchor))) {
    return true;
  }
  if (narrativeEstablishesFormalArtifact(text, group, relatedGroups)) {
    return true;
  }
  if (narrativeEstablishesWritingAction(text, group)) {
    return true;
  }
  const groupText = group.join("\n");
  if (
    /(?:没有去拿印|朱印未动|公文暂压|公文往案|暂缓签发|暂不签发|扣下不签|未即刻签发|没有即刻签发|没有落印|没有碰印盒)/u
      .test(groupText)
  ) {
    return (
      /(?:没有|并未|未曾|尚未|不曾|没).{0,18}(?:拿印|碰.{0,6}(?:印|印盒|朱批)|落印|签发|签押|用印)/u.test(text)
      || /(?:暂缓|暂不|未即刻|没有即刻).{0,8}(?:签发|落印|用印)/u.test(text)
      || /(?:催办)?公文.{0,32}(?:推|压|搁|扣|按住|留在案上)/u.test(text)
      || /(?:推|压|搁|扣|按住).{0,32}(?:催办)?公文/u.test(text)
    );
  }
  const limitedTrialAnchor = group
    .map((anchor) => anchor.match(/^([\p{Script=Han}]{2,10})先办一批$/u))
    .find(Boolean);
  if (limitedTrialAnchor) {
    return new RegExp(
      `${escapeRegExp(String(limitedTrialAnchor[1] || ""))}(?:只)?(?:准|准予)?(?:先办|先行(?:改桑)?)(?:第)?一批`,
      "u",
    ).test(text);
  }
  return false;
}

function narrativeEstablishesWritingAction(text: string, group: string[]) {
  if (!isWritingActionAnchorGroup(group)) return false;
  
  // A completed writing action may be narrated through ordinary Chinese
  // aspect/result complements rather than an authored registry phrase:
  // “写得不快，两行之后搁笔” still establishes that the writing occurred.
  // Match only an unnegated action occurrence so “没有落笔” remains missing.
  const actionPattern = /(?:提笔|下笔|落笔|搁笔|落字|写下|写入|写进|写了|写得|写完|写成|书明|批明|另起一行|补入|添入|补写)/gu;
  for (const match of text.matchAll(actionPattern)) {
    const prefix = text.slice(Math.max(0, (match.index || 0) - 12), match.index || 0);
    if (!/(?:未|没有|没|不曾|尚未|并未|未曾|并没有)[^，。；！？\n]{0,3}$/u.test(prefix)) {
      return true;
    }
  }
  return false;
}

function isWritingActionAnchorGroup(group: string[]) {
  const writingAnchors = new Set([
    "写明",
    "书明",
    "写进",
    "写入",
    "写下",
    "写的是",
    "写了",
    "落笔",
    "落字",
    "提笔",
    "批明",
    "另起一行",
    "补入",
    "添入",
    "补写",
  ]);
  return group.some((anchor) => (
    !anchor.startsWith("EXACT:") && writingAnchors.has(anchor)
  ));
}

function narrativeEstablishesFormalArtifact(
  text: string,
  group: string[],
  relatedGroups: string[][],
) {
  const suffixPattern = /(回文|公文|奏报|奏疏|责任说明|责任文书|记录|清单|手帖|手札|批文|文书|命令|令)$/u;
  const candidates = group
    .filter((anchor) => !anchor.startsWith("EXACT:"))
    .map((anchor) => anchor.match(suffixPattern)
      ? {
        anchor,
        stem: anchor.replace(suffixPattern, ""),
      }
      : null)
    .filter((candidate): candidate is { anchor: string; stem: string } => Boolean(candidate))
    .sort((left, right) => right.stem.length - left.stem.length);
  const completedWriting = (
    /(?:提笔|落笔|落字|写下|写了|写完|写成|另起|具文|具报|成文)/u.test(text)
    && /(?:纸|笺|牍|卷|折|匣|封|递|交|呈|收进|放入|搁进|装进)/u.test(text)
  );
  if (!completedWriting) return false;
  const candidate = candidates.find(({ stem }) => stem.length >= 2 && text.includes(stem));
  if (candidate) return true;

  // A narrator need not repeat the registry name after the player selected it.
  // The identity can instead be proven compositionally: the approved contents
  // are rendered and the resulting writing is materially handed over.  Requiring
  // two independent sibling anchors prevents an arbitrary sheet of paper from
  // being promoted to the registered artifact.
  if (!candidates.length || !/(?:折|匣|封|递|交|呈|收进|放入|搁进|装进)/u.test(text)) {
    return false;
  }
  const supportingGroups = relatedGroups
    .filter((related) => related !== group)
    .filter((related) => !related.some((anchor) => /(回文|公文|奏报|奏疏|责任说明|责任文书|记录|清单|手帖|手札|批文|文书|命令|令)$/u.test(anchor)))
    .filter((related) => related.some((anchor) => narrativeContainsAnchor(text, anchor)));
  return supportingGroups.length >= 2;
}

function narrativeContainsAnchor(text: string, rawAnchor: string) {
  const anchor = String(rawAnchor || "").trim();
  if (!anchor) return false;
  if (anchor.startsWith("EXACT:")) {
    return text.includes(anchor.slice("EXACT:".length));
  }
  if (text.includes(anchor)) return true;

  // Chinese aspect particles are routinely inserted inside an otherwise
  // identical action phrase (for example “耽误国策” -> “耽误了国策”).
  // They do not change the causal proposition, so authored semantic anchors
  // should survive this ordinary narration inflection.  Keep punctuation,
  // actors and substantive words exact; only admit the four aspect particles.
  if (!/^[\p{Script=Han}]{3,12}$/u.test(anchor)) return false;
  const flexible = [...anchor]
    .map((character) => escapeRegExp(character))
    .join("(?:了|的|着|过)?");
  return new RegExp(flexible, "u").test(text);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function enforceCausalKnowledgeBoundary(
  warnings: RuntimeWarning[],
  delta: CausalDelta,
) {
  const limit = delta.forbiddenKnowledge.length
    ? delta.forbiddenKnowledge.join("；")
    : `${delta.immediateIntent}\n${delta.stopCondition}`;
  if (
    delta.forbiddenKnowledge.length === 0
    && !/(?:不能|不得|不可).{0,100}(?:补充|提供|确定|断言|声称)/u.test(limit)
  ) {
    return warnings;
  }
  return warnings.map((item) => {
    const relevant = (
      /(?:档房|所在|位置)/u.test(limit)
        && /(?:LOCATION|ACCESS_DETAIL)/u.test(item.code)
    ) || (
      /(?:保管|封存|启封|动过)/u.test(limit)
        && /(?:CUSTODY|ACCESS_DETAIL)/u.test(item.code)
    ) || (
      /(?:钥匙|封条)/u.test(limit)
        && /ACCESS_DETAIL/u.test(item.code)
    ) || (
      /(?:内容|证据|原册|县册|文书)/u.test(limit)
        && /(?:DOCUMENT_CONTENT|EVIDENCE_DETAIL|NEW_EVIDENCE)/u.test(item.code)
    ) || (
      /(?:田亩|数字|数量)/u.test(limit)
        && /DURABLE_QUANTITY/u.test(item.code)
    ) || (
      /(?:经手|人名|人物)/u.test(limit)
        && /(?:NAMED_CHARACTER|ACCESS_DETAIL)/u.test(item.code)
    );
    if (!relevant) return item;
    return {
      ...item,
      code: "CAUSAL_KNOWLEDGE_BOUNDARY",
      message: `正文越过了本轮已审定的知识上限：${item.message}`,
      severity: "HIGH" as const,
      blocksPlayer: true,
      details: {
        ...(item.details || {}),
        sourceCode: item.code,
      },
    };
  });
}

function extractKnowledgeBoundary(intent: string) {
  const text = normalizeReaderAction(intent);
  const allowedText = text.match(
    /(?:已知边界|可确认(?:的|为)?|只可确认(?:的|为)?)[：:]([^。；]+)/u,
  )?.[1] || "";
  const forbiddenText = text.match(
    /(?:不能|不得|不可)(?:再|擅自)?补充([^。；]+)/u,
  )?.[1] || "";
  return {
    allowed: splitKnowledgeItems(allowedText),
    forbidden: splitKnowledgeItems(forbiddenText),
    subjects: [],
    sourceRef: "",
  };
}

function splitKnowledgeItems(value: string) {
  return String(value || "")
    .split(/[、，,]|或/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 8);
}

function normalizeKnowledgeItems(values: unknown) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((item) => normalizeReaderAction(String(item || "")))
    .filter((item) => item.length >= 2))]
    .slice(0, 16);
}
