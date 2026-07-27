import type { PartOneNarrativePlan } from "@ai-story/templates";
import type { CompiledStoryContext, StoryTurnPrompt } from "./types";
import { resolvePartOneNarrativeBudget } from "./narrative-budget";

/**
 * OpenNovel-style foreground Writer context.
 *
 * The server has already decided what happened. The model receives a compact
 * scene plan, the latest canon tail and one player action at the very end.
 * Decision routes, state patches, source-review metadata and validator rules
 * never enter the prose call.
 */
export function buildSoloNarratorPrompt(context: CompiledStoryContext): StoryTurnPrompt {
  const runtime = context.sections.partOneRuntime.items[0] || null;
  const event = context.sections.partOneSettlement.items[0] || null;
  if (!runtime || !event) return buildLegacyPrompt(context);

  const plan = event.narrativePlan;
  const recentCanonTail = compileMinimalCanonTail(
    context.sections.recentCanon.items.map((entry) => entry.narrative)
  );
  const visibleBeats = plan.sceneBeats.filter((beat) => beat.mustAppear);
  const finalBeat = visibleBeats.at(-1);
  const postActionChoreography = renderPostActionChoreography(visibleBeats);
  const foregroundBoundary = compileNarratorForegroundBoundary(
    runtime.decisionAffordances,
    plan
  );
  const narrativeBudget = resolvePartOneNarrativeBudget(
    plan,
    runtime.styleProfile.narrativeBudget
  );

  const systemPrompt = [
    "你是《桑田诏》的前台小说叙事者。写一个连续的历史政治小说场景，只输出正文。",
    "最近正文是已经发生的最高连续性依据；从它最后一刻直接向前，不复述开场，不重演旧对白。",
    "后台已经结算玩家行动和本场回应。第一自然段只负责完整演出已结算行动及其直接承接动作；从第二自然段开始，才依次表演工作集给出的新增人物反应和压力。",
    "进入第二自然段后，不得再让玩家角色下令、答复、追问、承诺、批准或决定新事项；玩家可以留在现场观察、沉默或等待，但不能替他回答本轮新出现的压力。",
    "玩家选择的是行动，不等于玩家亲口说出的台词。除非工作集列出玩家原话，否则只用动作和间接叙述呈现玩家处置，不替玩家编写引号台词。",
    "工作集只提供本场可用事实。未知保持未知；不另造人物、文书、证据、具体数字、期限或场外完成结果。",
    "人物只能知道自己有渠道得知的事，并按自己的身份、利益与风险说话。让权力关系通过称谓、动作、停顿、追问和言外之意显出来，不解释后台规则。",
    "只使用当前现场列出的文书和物件。它们没有新动作时不盘点状态，也不把连续性核对写进正文。",
    "结尾必须把最后场景节拍演出来，并停在该人物最后一句话或最后一个动作上；之后不再总结形势、清点尚未发生的事，也不替玩家列出选择。",
    "语言克制、具体、自然，有明代官场与财政危局的语感，但不堆砌假古文，不复现《大明王朝1566》的原句。",
    "输出格式是两阶段正文合同：第一自然段完整演出玩家已经结算的行动；第二自然段起只写世界反应和变化后的现场。必须用一个空行分隔自然段，全文至少两个自然段；最后一个自然段只写变化后的当下场面。",
    "只输出正文纯文本。"
  ].join("\n");

  const userPrompt = [
    section("最近正文", recentCanonTail || "开场已经结束，本轮从当前现场直接向前。"),
    section("当前现场", renderWriterScene(plan)),
    section(
      "在场人物说话边界",
      renderActiveCharacterVoices(
        runtime.styleProfile.characterVoiceAnchors,
        plan,
        foregroundBoundary.futureDecisionTerms
      )
    ),
    section(
      "原著场面机制",
      renderSceneCraft(
        runtime.narrativeScenePatterns,
        plan,
        foregroundBoundary.futureDecisionTerms
      )
    ),
    section(
      "玩家行动呈现方式",
      plan.playerSpeechMode === "EXACT_QUOTE_ALLOWED"
        ? [
            "玩家亲自写明了以下原话；如需直接引语，只能逐字使用这些原话，不得增补：",
            ...plan.authorizedPlayerSpeech,
            "必须让玩家刚刚选择的行动在正文中明确完成，不能只写成准备、意向、暗示或由其他人物转述。"
          ]
        : plan.playerSpeechMode === "INDIRECT_SPEECH_REQUIRED"
          ? [
              "玩家选择中包含必须传达给在场对象的命令、追问或答复。",
              `用“命、吩咐、告知、答复、追问”等间接叙述明确写出${context.role.roleName}传达了什么；不能改成点头、递物、敲案、指向或其他手势暗示，也不让${context.role.roleName}说引号台词。`,
              "必须让玩家刚刚选择的行动在正文中明确完成，不能只写成准备、意向、暗示或由其他人物转述。"
            ]
          : [
              `用动作和间接叙述写清处置，不让${context.role.roleName}说引号台词。`,
              "必须让玩家刚刚选择的行动在正文中明确完成，不能只写成准备、意向、暗示或由其他人物转述。"
            ]
    ),
    section("事实边界", renderFactBoundary(plan)),
    section(
      "收束方式",
      finalBeat
        ? "把“玩家行动之后必须发生的场景推进”的最后一步演成正文最后一个新增动作，并停在该人物的最后一句话或动作上。"
        : "玩家行动表演完成后，在当前人物的可见反应上停笔。"
    ),
    section("本场边界", renderNarrativeBoundary(plan)),
    section("文风", [
      ...filterNarratorStyleLines(
        runtime.styleProfile.registerRules,
        foregroundBoundary
      ),
      ...filterNarratorStyleLines(
        runtime.styleProfile.sceneConstructionRules,
        foregroundBoundary
      ),
      ...filterNarratorStyleLines(
        runtime.styleProfile.dialogueAndSubtextRules,
        foregroundBoundary
      ),
      ...sanitizeTerminologyRulesForCurrentScene(
        runtime.styleProfile.terminologyRules,
        foregroundBoundary
      )
    ]),
    section(
      "本场篇幅",
      `${narrativeBudget.kind}：建议 ${narrativeBudget.targetCharacters.minimum}—${narrativeBudget.targetCharacters.maximum} 字，硬范围 ${narrativeBudget.minCharacters}—${narrativeBudget.maxCharacters} 字；${narrativeBudget.minParagraphs}—${narrativeBudget.maxParagraphs} 个自然段。把相连的对白、反应和动作组织在同一完整段落里，不把每句短对白单独拆段。篇幅不足时宁可停在完整的短场景，也不要用状态总结凑字。`
    ),
    // Mirror OpenNovel's foreground ordering: stable working-state and the
    // world's post-action moves come first; the latest player action is the
    // final, immediate instruction. Unlike an opaque compound sentence, the
    // settled action is compiled into actor-explicit semantic beats. This keeps
    // a multi-part choice atomic while preventing the narrator from treating
    // an NPC's later paraphrase as if the player had performed every part.
    section(
      "玩家行动事实边界",
      renderPlayerActionBoundaries(visibleBeats)
    ),
    section(
      "玩家行动之后必须发生的场景推进",
      postActionChoreography
    ),
    section(
      "玩家刚刚选择的行动（已经结算；以下步骤属于同一选择，正文开头依次明确发生）",
      renderForegroundPlayerAction(
        visibleBeats,
        context.role.roleName,
        plan.actionAlreadyOccurred
      )
    ),
    section(
      "正文两阶段边界",
      [
        "第一自然段必须把上述每一步全部演完；可以写动作接受者的即时接令或离场，但不得提前表演后面的追问。",
        "“玩家行动之后必须发生的场景推进”从第二自然段开始。",
        `${context.role.roleName}在第二自然段之后不再下令、答复、追问、承诺、批准或决定新事项；新的压力留给下一组玩家决策。`
      ]
    )
  ].filter(Boolean).join("\n\n");

  return {
    systemPrompt,
    userPrompt,
    responseMode: "TEXT",
    outputSchema: {
      type: "plain_text",
      paragraphs: {
        minimum: narrativeBudget.minParagraphs,
        maximum: narrativeBudget.maxParagraphs
      },
      finalParagraph: "the changed present situation, without a decision menu"
    }
  };
}

function buildLegacyPrompt(context: CompiledStoryContext): StoryTurnPrompt {
  const scene = context.sections.currentScene.items[0] || null;
  const recentCanonTail = compileMinimalCanonTail(
    context.sections.recentCanon.items.map((entry) => entry.narrative)
  );
  return {
    systemPrompt: [
      "你是互动历史政治小说的前台叙事者。只输出正文纯文本。",
      "从 Recent Canon 最后一刻继续，把已经结算的玩家行动与直接可见结果写成一个场景。",
      "不得新增事实、证据、人物、承诺或下一步决定。写四至六个自然段。"
    ].join("\n"),
    userPrompt: [
      section("RECENT CANON", recentCanonTail),
      section("CURRENT SCENE", scene),
      section("CONFIRMED EFFECTS", context.actionResolution.immediateObservableResult),
      section("PLAYER ACTION — THIS HAS ALREADY HAPPENED", context.actionResolution.actionStarted)
    ].join("\n\n"),
    responseMode: "TEXT",
    outputSchema: {
      type: "plain_text",
      paragraphs: { minimum: 4, maximum: 6 },
      finalParagraph: "the changed present situation, without a decision menu"
    }
  };
}

function compileMinimalCanonTail(entries: string[]) {
  const latest = String(entries.at(-1) || "").trim();
  if (!latest) return "";
  const paragraphs = latest
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  // Keep the complete changed-present paragraph. A final sentence such as
  // “他把回文匣往前一送” is not independently resolvable: trimming away the
  // named actor makes the next narrator transfer that gesture to the player.
  // This mirrors OpenNovel's continuous-prose Recent Canon tail while still
  // excluding earlier resolved-action paragraphs.
  const finalParagraph = paragraphs.at(-1) || "";
  if (finalParagraph.length <= 620) return finalParagraph;
  const sentences = finalParagraph
    .match(/[^。！？]+[。！？](?:[”’"])?|[^。！？]+$/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) || [];
  const selected: string[] = [];
  let length = 0;
  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const sentence = sentences[index]!;
    if (selected.length && length + sentence.length > 620) break;
    selected.unshift(sentence);
    length += sentence.length;
  }
  return selected.join("") || finalParagraph.slice(-620);
}

function section(title: string, value: unknown) {
  const rendered = typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value.map((item) => `- ${String(item)}`).join("\n")
      : JSON.stringify(value, null, 2);
  return `【${title}】\n${rendered}`;
}

function renderWriterScene(plan: PartOneNarrativePlan) {
  const actorLabels = new Map<string, string>();
  const presentActorRefs = new Set(plan.sceneStart.presentActorRefs);
  plan.sceneStart.presentActorRefs.forEach((ref, index) => {
    actorLabels.set(ref, plan.sceneStartActorLabels[index] || ref);
  });
  plan.sceneEnd.presentActorRefs.forEach((ref, index) => {
    actorLabels.set(ref, plan.sceneEndActorLabels[index] || actorLabels.get(ref) || ref);
  });
  const holderLabel = (ref: string | null) =>
    ref ? actorLabels.get(ref) || "场外持有人" : "无人持有";
  const lines = [
    `${plan.sceneStart.timeLabel}，${plan.sceneStart.locationLabel}。`,
    `开场在场人物：${plan.sceneStartActorLabels.join("、")}。`,
  ];

  for (const document of plan.sceneStart.documentStates || []) {
    if (document.accessState === "NOT_PRESENT") {
      lines.push(`${document.label}不在当前现场。`);
      continue;
    }
    const state = {
      SEALED: "仍封着，尚未拆阅",
      OPENED: "已经拆开",
      READ: "已经读过",
      WRITTEN: "已经写成"
    }[document.accessState];
    lines.push(`${document.label}由${holderLabel(document.holderRef)}持有，${state}。`);
  }
  const sceneStartDocuments = new Map(
    (plan.sceneStart.documentStates || []).map((document) => [
      document.documentRef,
      document
    ])
  );
  const authorizedDocumentChanges = (plan.sceneEnd.documentStates || []).filter(
    (document) => {
      const before = sceneStartDocuments.get(document.documentRef);
      return !before
        || before.accessState !== document.accessState
        || before.holderRef !== document.holderRef;
    }
  );
  if (authorizedDocumentChanges.length === 0) {
    lines.push("本场文书保持开场状态；催问只通过人物当面对话发生。");
  } else {
    const changedDocumentRefs = new Set(
      authorizedDocumentChanges.map((document) => document.documentRef)
    );
    const unchangedCurrentDocuments = (plan.sceneStart.documentStates || [])
      .filter((document) =>
        document.accessState !== "NOT_PRESENT"
        && !changedDocumentRefs.has(document.documentRef)
      )
      .map((document) => document.label);
    const authorizedChanges = authorizedDocumentChanges.map((document) => {
      const before = sceneStartDocuments.get(document.documentRef);
      if (!before && document.accessState === "WRITTEN") {
        return `${document.label}将在本场写成，写成后由${holderLabel(document.holderRef)}持有`;
      }
      const accessState = {
        NOT_PRESENT: "离开现场",
        SEALED: "保持封存",
        OPENED: "拆开",
        READ: "读过",
        WRITTEN: "写成"
      }[document.accessState];
      return `${document.label}将在本场${accessState}，随后由${holderLabel(document.holderRef)}持有`;
    });
    lines.push(
      `本场唯一发生变化的文书：${authorizedChanges.join("；")}。`
    );
    const newlyWrittenDocuments = authorizedDocumentChanges
      .filter((document) =>
        !sceneStartDocuments.has(document.documentRef)
        && document.accessState === "WRITTEN"
      )
      .map((document) => document.label);
    if (newlyWrittenDocuments.length) {
      const textureTargets = new Set(
        (plan.incidentalTextureAllowances || [])
          .filter((allowance) =>
            allowance.textureClass === "CREATION_SUBSTRATE"
            && allowance.lifecycle === "CONSUMED_INTO_TARGET"
          )
          .map((allowance) => allowance.targetEntityLabel)
      );
      const mayShowCreationTexture = newlyWrittenDocuments.some((label) =>
        textureTargets.has(label)
      );
      lines.push(
        `${newlyWrittenDocuments.join("、")}由浙江总督在本场当面提笔写成；`
        + `落字后直接称“${newlyWrittenDocuments.join("、")}”，写成后按上句移交。`
        + (mayShowCreationTexture
          ? "书写时，普通纸张与笔墨可以短暂作为一次性过程细节出现；它们落字后就是同一份已获批文书，不得另成第二份文书、底稿、证据或后续物件。"
          : "")
      );
    }
    if (unchangedCurrentDocuments.length) {
      lines.push(
        `其余现有文书只作为原状背景：${unchangedCurrentDocuments.join("、")}；`
        + "本场没有续写或移交动作。"
      );
    }
  }

  const activeCorpus = [
    plan.actionAlreadyOccurred,
    ...plan.sceneBeats.map((beat) => beat.action)
  ].join("\n");
  const endObjects = new Map(
    (plan.sceneEnd.objectStates || []).map((object) => [object.objectRef, object])
  );
  const foregroundObjects: string[] = [];
  const authorizedObjectChanges: string[] = [];
  const authorizedObjectChoreography: string[] = [];
  const renderObjectState = (
    object: NonNullable<typeof plan.sceneStart.objectStates>[number]
  ) => {
    const physicalState = [
      object.closureState === "CLOSED"
        ? "合拢"
        : object.closureState === "OPEN"
          ? "打开"
          : object.closureState === "UNKNOWN"
            ? "开合状态不明"
            : null,
      object.contentsState === "EMPTY"
        ? "里面是空的"
        : object.contentsState === "CONTAINS_DOCUMENT"
          ? "里面已有文书"
          : object.contentsState === "UNKNOWN"
            ? "里面有什么尚不明确"
            : null
    ].filter(Boolean);
    return `${holderLabel(object.holderRef)}持有`
      + (physicalState.length ? `，${physicalState.join("、")}` : "");
  };
  for (const object of plan.sceneStart.objectStates || []) {
    const end = endObjects.get(object.objectRef);
    const changed = Boolean(end) && (
      end!.holderRef !== object.holderRef
      || end!.contentsState !== object.contentsState
      || end!.closureState !== object.closureState
    );
    const heldByPresentActor = Boolean(
      object.holderRef && presentActorRefs.has(object.holderRef)
    );
    if (!changed && !heldByPresentActor && !activeCorpus.includes(object.label)) continue;
    if (changed && end) {
      authorizedObjectChanges.push(
        `${object.label}起初由${renderObjectState(object)}；本场结束时由${renderObjectState(end)}`
      );
      const insertedDocuments = authorizedDocumentChanges.filter((document) =>
        document.accessState === "WRITTEN"
        && document.holderRef === object.holderRef
        && !sceneStartDocuments.has(document.documentRef)
      );
      if (
        object.holderRef
        && object.holderRef === end.holderRef
        && object.contentsState === "EMPTY"
        && end.contentsState === "CONTAINS_DOCUMENT"
        && object.closureState === "CLOSED"
        && end.closureState === "CLOSED"
        && insertedDocuments.length === 1
      ) {
        const document = insertedDocuments[0]!;
        const playerLabel =
          actorLabels.get("actor.zhejiang_governor")
          || plan.sceneStartActorLabels[0]
          || "玩家角色";
        const custodianLabel = holderLabel(object.holderRef);
        authorizedObjectChoreography.push(
          `${playerLabel}当场写成${document.label}并递给${custodianLabel}；`
          + `${custodianLabel}始终捧持${object.label}，由${custodianLabel}本人启开匣盖、收入${document.label}并重新合拢`
        );
      }
    } else {
      foregroundObjects.push(`${object.label}由${renderObjectState(object)}`);
    }
  }
  if (authorizedObjectChanges.length) {
    lines.push(
      `本场授权的物件变化：${authorizedObjectChanges.join("；")}。`
      + "按上述起点、经手顺序和终点演出必要动作。"
    );
  }
  if (authorizedObjectChoreography.length) {
    lines.push(`本场物件经手顺序：${authorizedObjectChoreography.join("；")}。`);
  }
  if (foregroundObjects.length) {
    lines.push(
      `当前可用动作落点：${foregroundObjects.join("；")}。`
      + "人物可以继续捧持、按住或收紧手指；物件持有人、开合和内容沿用上句状态。"
    );
  }

  if (plan.transitionAllowed) {
    lines.push(
      `完成当前现场的动作后，故事才可转到${plan.sceneEnd.timeLabel}的${plan.sceneEnd.locationLabel}。`
    );
    lines.push(`转场后在场人物：${plan.sceneEndActorLabels.join("、")}。`);
  } else {
    lines.push(`本场始终停留在${plan.sceneStart.locationLabel}，不跨越当前时刻。`);
    lines.push(`本场结束时仍在场人物：${plan.sceneEndActorLabels.join("、")}。`);
  }
  if (plan.authorizedActorArrivals.length) {
    lines.push(`本场会到场：${plan.authorizedActorArrivals.join("、")}。`);
  }
  if (plan.authorizedActorDepartures.length) {
    lines.push(`本场会离开当前房间：${plan.authorizedActorDepartures.join("、")}；只写出门，不写抵达或办结。`);
  }
  return lines.join("\n");
}

function renderNarrativeBoundary(plan: PartOneNarrativePlan) {
  const lines = [
    "只写玩家行动、已经确定的可见变化和本场人物回应；不要继续推演下一项处置。",
    "不在工作集中的发现、证据、数量、期限和幕后事实保持未知。",
    "最后节拍发生后立即停笔，不再写一段局势说明或物件状态清单。"
  ];
  if (!plan.transitionAllowed) {
    lines.unshift(`时间地点不变：${plan.sceneStart.timeLabel}，${plan.sceneStart.locationLabel}。`);
  }
  return lines.join("\n");
}

function renderPostActionChoreography(
  beats: PartOneNarrativePlan["sceneBeats"]
) {
  const steps = beats
    .filter((beat) => beat.sourceType !== "PLAYER_ACTION")
    .map((beat) => renderNonPlayerBeatForWriter(beat.action, beat.resultCeiling));
  return steps.length
    ? steps.map((step, index) => `${index + 1}. ${step}`).join("\n")
    : "玩家行动写完后，停在其造成的新现场，不追加下一项处置。";
}

function renderPlayerActionBoundaries(
  beats: PartOneNarrativePlan["sceneBeats"]
) {
  const boundaries = [...new Set(
    beats
      .filter((beat) => beat.sourceType === "PLAYER_ACTION")
      .map((beat) => beat.resultCeiling?.trim())
      .filter(Boolean)
  )] as string[];
  return boundaries.length
    ? boundaries.map((boundary) => `- ${boundary}`).join("\n")
    : "只把玩家选择的行动写到已经结算的范围，不增添新的承诺、程序或结果。";
}

function renderForegroundPlayerAction(
  beats: PartOneNarrativePlan["sceneBeats"],
  actorLabel: string,
  fallbackAction: string
) {
  const playerBeats = beats.filter((beat) => beat.sourceType === "PLAYER_ACTION");
  if (playerBeats.length === 0) return fallbackAction;
  return [
    "这些步骤是一个不可拆分的已结算行动，不是多个新选择；每一步都必须由下列行动者亲自完成，不能只让其他人物事后提及或转述：",
    ...playerBeats.map((beat, index) =>
      `${index + 1}. 行动者：${actorLabel}。已完成：${beat.action.trim()}`
    )
  ].join("\n");
}

function renderNonPlayerBeatForWriter(
  action: string,
  resultCeiling?: string
) {
  const rendered = sanitizeBeatAction(action);
  return resultCeiling
    ? `${rendered}\n本项边界：${resultCeiling}`
    : rendered;
}

function sanitizeBeatAction(action: string) {
  return action
    .replace(/完成本轮获批的现场动作后/g, "接令后")
    .replace(/按来府前所受交代当场追问：正式催办总督，催问/g, "当场追问总督")
    .replace(/[；;](?:只写|不得)[^。！？]*[。！？]?$/u, "")
    .trim();
}

function renderActiveCharacterVoices(
  anchors: Record<string, string[]>,
  plan: PartOneNarrativePlan,
  futureDecisionTerms: Set<string>
) {
  const labels = new Map<string, string>();
  plan.sceneStart.presentActorRefs.forEach((actorRef, index) => {
    labels.set(actorRef, plan.sceneStartActorLabels[index] || actorRef);
  });
  plan.sceneEnd.presentActorRefs.forEach((actorRef, index) => {
    labels.set(actorRef, plan.sceneEndActorLabels[index] || labels.get(actorRef) || actorRef);
  });
  const actorRefs = [...new Set([
    ...plan.sceneStart.presentActorRefs,
    ...plan.sceneEnd.presentActorRefs
  ])];
  const lines = actorRefs.flatMap((actorRef) => {
    const voice = filterNarratorForegroundLines(
      anchors[actorRef]?.slice(0, 2) || [],
      futureDecisionTerms
    );
    return voice.length
      ? [`${labels.get(actorRef) || actorRef}：${voice.join("；")}`]
      : [];
  });
  return lines.length
    ? lines
    : ["人物只按当前身份、已知事实和眼前风险说话。"];
}

function renderSceneCraft(
  patterns: Array<{ payload: Record<string, unknown> }>,
  plan: PartOneNarrativePlan,
  futureDecisionTerms: Set<string>
) {
  const currentText = [
    plan.actionAlreadyOccurred,
    ...plan.npcAgenda,
    ...plan.sceneBeats.filter((beat) => beat.mustAppear).map((beat) => beat.action)
  ].join("\n");
  const selected = [...patterns]
    .map((pattern) => ({
      payload: pattern.payload,
      activationScore: activationCueScore(
        currentText,
        stringArray(pattern.payload.runtimeActivationCues)
      ),
      semanticScore: overlapScore(
        currentText,
        [
          String(pattern.payload.dramaticFunction || ""),
          String(pattern.payload.openingPressure || ""),
          ...stringArray(pattern.payload.transferableTechniques)
        ].join("\n")
      )
    }))
    .sort((left, right) =>
      right.activationScore - left.activationScore
      || right.semanticScore - left.semanticScore
    )[0]?.payload;
  if (!selected) {
    return ["让冲突通过人物动作、追问和停顿发生，不用旁白解释规则。"];
  }

  const transferableTechniques = filterNarratorForegroundLines(
    stringArray(selected.transferableTechniques),
    futureDecisionTerms
  ).filter((line) =>
    !(
      hasStrictObjectChoreography(plan)
      && /(?:递交|交给|推递|接过|拒绝)[^。！？]{0,18}(?:物件|文书|材料)/.test(line)
    )
    && !introducesUnsupportedSceneCraftAction(line, currentText)
  );
  const matchingTechnique = bestMatchingLine(transferableTechniques, currentText);
  if (!matchingTechnique) {
    return ["让冲突通过人物动作、追问和停顿发生，不用旁白解释规则。"];
  }
  return [
    "只借用以下场面机制，不借用原著人物、事件、台词或未进入工作集的事实。",
    matchingTechnique
  ];
}

function activationCueScore(currentText: string, cues: string[]) {
  return cues.reduce(
    (score, cue) => score + (currentText.includes(cue) ? 1 : 0),
    0
  );
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function bestMatchingLine(lines: string[], currentText: string) {
  const best = [...lines]
    .map((line) => ({ line, score: overlapScore(currentText, line) }))
    .sort((left, right) => right.score - left.score)[0];
  return best && best.score > 0 ? best.line : "";
}

const FUTURE_DECISION_CONCEPTS = [
  {
    routeTerms: ["共同具名", "具名", "联署"],
    foregroundTerms: ["共同具名", "具名", "联署", "署名", "画押", "姓名在上", "名字写在"]
  },
  {
    routeTerms: ["另具正式回文"],
    foregroundTerms: ["另具正式回文", "另具回文", "另作正式回文"]
  },
  {
    routeTerms: ["逐项写明", "逐项列明"],
    foregroundTerms: ["逐项写明", "逐条写明", "逐项列明", "逐条列明"]
  }
] as const;

function compileNarratorForegroundBoundary(
  decisionAffordances: Array<{
    actionText: string;
    title?: string;
    method?: string;
    immediateIntent?: string;
  }>,
  plan: PartOneNarrativePlan
) {
  const routeCorpus = decisionAffordances
    .flatMap((route) => [
      route.actionText,
      route.title || "",
      route.method || "",
      route.immediateIntent || ""
    ])
    .join("\n");
  const authoritativeCurrentCorpus = [
    plan.actionAlreadyOccurred,
    ...plan.confirmedEffects,
    ...plan.npcAgenda,
    ...plan.sceneBlocking,
    ...plan.sceneBeats.filter((beat) => beat.mustAppear).map((beat) => beat.action),
    plan.requiredEndChange
  ].join("\n");
  const futureDecisionTerms = new Set<string>();
  for (const concept of FUTURE_DECISION_CONCEPTS) {
    if (!concept.routeTerms.some((term) => routeCorpus.includes(term))) continue;
    if (concept.foregroundTerms.some((term) => authoritativeCurrentCorpus.includes(term))) {
      continue;
    }
    concept.foregroundTerms.forEach((term) => futureDecisionTerms.add(term));
  }
  return {
    futureDecisionTerms,
    authoritativeCurrentCorpus,
    strictObjectChoreography: hasStrictObjectChoreography(plan)
  };
}

function filterNarratorForegroundLines(
  lines: string[],
  futureDecisionTerms: Set<string>
) {
  if (futureDecisionTerms.size === 0) return lines;
  return lines.filter((line) =>
    ![...futureDecisionTerms].some((term) => line.includes(term))
  );
}

function filterNarratorStyleLines(
  lines: string[],
  boundary: {
    futureDecisionTerms: Set<string>;
    strictObjectChoreography: boolean;
  }
) {
  return filterNarratorForegroundLines(lines, boundary.futureDecisionTerms)
    .filter((line) =>
      !(
        boundary.strictObjectChoreography
        && /递交、拒绝|递交或拒绝|接过、推递/.test(line)
      )
    );
}

function sanitizeTerminologyRulesForCurrentScene(
  rules: string[],
  boundary: {
    futureDecisionTerms: Set<string>;
    authoritativeCurrentCorpus: string;
    strictObjectChoreography: boolean;
  }
) {
  return filterNarratorForegroundLines(rules, boundary.futureDecisionTerms)
    .map((rule) => {
      const match = rule.match(/^用(.+)，不用(.+)$/);
      if (!match) return rule;
      const positiveTerms = match[1]!
        .split(/[、或]/)
        .map((term) => term.trim())
        .filter(Boolean);
      const relevantTerms = positiveTerms.filter((term) =>
        boundary.authoritativeCurrentCorpus.includes(term)
      );
      if (relevantTerms.length === 0) return "";
      return `用${relevantTerms.join("、")}，不用${match[2]}`;
    })
    .filter(Boolean);
}

const SCENE_CRAFT_ACTION_CONCEPTS = [
  ["具名", "共同具名", "联署", "署名", "画押"],
  ["递交", "交给", "推递", "接过"],
  ["拒绝", "不接"],
  ["领命", "接令"],
  ["急递", "催办"],
  ["下令", "命"],
  ["出示", "拿到面前"],
  ["阅读", "看过", "查看"],
  ["开仓", "放粮"],
  ["调粮", "借粮"],
  ["抓人", "扣押"],
  ["释放", "放人"]
] as const;

function introducesUnsupportedSceneCraftAction(line: string, currentText: string) {
  return SCENE_CRAFT_ACTION_CONCEPTS.some((aliases) => {
    if (!aliases.some((term) => line.includes(term))) return false;
    return !aliases.some((term) => currentText.includes(term));
  });
}

function hasStrictObjectChoreography(plan: PartOneNarrativePlan) {
  const beforeByRef = new Map(
    (plan.sceneStart.objectStates || []).map((state) => [state.objectRef, state])
  );
  return (plan.sceneEnd.objectStates || []).some((after) => {
    const before = beforeByRef.get(after.objectRef);
    if (!before || !before.holderRef || before.holderRef !== after.holderRef) return false;
    return (
      before.contentsState !== after.contentsState
      || before.closureState !== after.closureState
    );
  });
}

function overlapScore(left: string, right: string) {
  const leftBigrams = chineseBigrams(left);
  const rightBigrams = chineseBigrams(right);
  let score = 0;
  for (const bigram of leftBigrams) {
    if (rightBigrams.has(bigram)) score += 1;
  }
  return score;
}

function chineseBigrams(value: string) {
  const text = String(value || "").replace(/[^\p{Script=Han}]/gu, "");
  const result = new Set<string>();
  for (let index = 0; index < text.length - 1; index += 1) {
    result.add(text.slice(index, index + 2));
  }
  return result;
}

function renderFactBoundary(plan: PartOneNarrativePlan) {
  const primary = plan.unresolvedFacts.find((fact) =>
    /只能证明|不能直接证明|保持未知|尚未查明|不足以/.test(fact)
  );
  return [
    primary || "现有材料只能支持本场已经列出的动作，不能据此给任何人定罪。",
    "幕后主使、暗账全貌和未呈到的证据都还没有查明。"
  ].join("\n");
}
