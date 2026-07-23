import type { CompiledStoryContext, StoryTurnPrompt } from "./types";
import { authorizedPartOneProceduralGuidance } from "./part-one-prose-guard";

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
  const scene = context.sections.currentScene.items[0] || null;
  if (!runtime || !event) return buildLegacyPrompt(context);

  const plan = event.narrativePlan;
  const foregroundSceneStart = projectForegroundScene(plan.sceneStart);
  const foregroundSceneEnd = projectForegroundScene(plan.sceneEnd);
  const foregroundSceneStartObjectStates = (
    foregroundSceneStart.objectStates || []
  ) as Array<
    (typeof foregroundSceneStart.objectStates)[number] & {
      presenceState: "PRESENT" | "NOT_PRESENT";
    }
  >;
  const recentCanonTail = compileMinimalCanonTail(
    context.sections.recentCanon.items.map((entry) => entry.narrative)
  );
  const proceduralTexture = authorizedPartOneProceduralGuidance(event.actionText);
  const currentActionWritesDocument =
    /(?:写|落笔|签署|签名|具名|批明|批复|记入|写入|行文)/.test(event.actionText);
  const materialStateBoundary = currentActionWritesDocument
    ? {
        beforeTransition: plan.transitionAllowed
          ? "本场落笔后的墨迹只能写“未干”或“渐干”，不得在转场前写成“已干”“干透”或“渐渐干透”。"
          : "本场落笔后的墨迹只能写“未干”或“渐干”，不得写成“已干”“干透”或“渐渐干透”。",
        afterTransition: plan.transitionAllowed
          ? `只有正文明确进入 ${foregroundSceneEnd.timeLabel} ${foregroundSceneEnd.locationLabel} 后，才可写墨迹已干。`
          : "本轮没有获批的后续时段，不得让新写墨迹干透。"
      }
    : null;
  const normalizedPlayerAction = event.actionText
    .trim()
    .replace(/^[，。；：、“”‘’！？\s]+|[，。；：、“”‘’！？\s]+$/g, "");
  const fullActionSpeechAuthorized =
    plan.authorizedPlayerSpeech.includes(normalizedPlayerAction);
  const absentActionDocumentLabels = (foregroundSceneStart.documentStates || [])
    .filter((document) =>
      document.accessState === "NOT_PRESENT"
      && (
        event.actionText.includes(document.label)
        || (document.label.includes("原件") && /(?:原册|原件)/.test(event.actionText))
        || (document.label.includes("副本") && /(?:副本|抄本)/.test(event.actionText))
      )
    )
    .map((document) => document.label);
  const remoteDocumentOrderOnly = absentActionDocumentLabels.length > 0;
  const authorizedCorpus = [
    recentCanonTail,
    foregroundSceneStart.timeLabel,
    foregroundSceneStart.locationLabel,
    foregroundSceneEnd.timeLabel,
    foregroundSceneEnd.locationLabel,
    JSON.stringify(foregroundSceneStart.documentStates || []),
    JSON.stringify(foregroundSceneEnd.documentStates || []),
    JSON.stringify(foregroundSceneStart.objectStates || []),
    JSON.stringify(foregroundSceneEnd.objectStates || []),
    event.actionText,
    ...plan.confirmedEffects,
    ...plan.npcAgenda,
    ...event.authoritativeWorldMoves.map((move) => move.action)
  ].join("\n");
  const authorizedQuantities = unique([
    ...authorizedCorpus.matchAll(
      /(?:\d+|[一二三四五六七八九十百千万两半余]+)(?:成|分|钱|册|份|封|人|户|家|铺|日|夜|时辰|石|担|亩|里|县)/g
    )
  ].map((match) => match[0]));
  const authorizedObjects = unique([
    ...(foregroundSceneStart.documentStates || [])
      .filter((document) => document.accessState !== "NOT_PRESENT")
      .map((document) => document.label),
    ...foregroundSceneStartObjectStates
      .filter((object) => object.presenceState !== "NOT_PRESENT")
      .map((object) => object.label),
    ...[...authorizedCorpus.matchAll(
      /[\u4e00-\u9fff]{0,8}(?:催办公文|放行文书|往来文书|公文|密信|令牌|回文匣|县册|册页|原册|样册|封条|仓单|田契|奏报|底稿|摘要)/g
    )].map((match) => match[0])
  ]);
  const mandatoryBeats = plan.sceneBeats
    .filter((beat) => beat.mustAppear && beat.sourceType !== "PLAYER_ACTION")
    .map((beat) => ({
      beatId: beat.beatId,
      kind: beat.sourceType,
      action: beat.action,
      ceiling: beat.resultCeiling || null
    }));

  const systemPrompt = [
    "你是《桑田诏》的前台小说叙事者。只写一个连续的历史政治小说场景，不写标题、选项、解释、规则、字段名或总结。",
    "服务器已经结算事实。你的职责是把 Foreground Working Set 里的动作写成可见、可听、可感受的现场，不得替服务器续写事实。",
    "Recent Canon 是已经发生的最高连续性依据。从最后一个动作向前写，不复述旧正文，不重新介绍困境，也不得让人物把 Recent Canon 已说过的台词原样或换几个字再说一遍；本轮只呈现 MANDATORY SCENE BEATS 带来的新增动作和新增压力。",
    "ACTIVE DOCUMENT STATES 是当前文书连续性的硬事实；已经拆阅、写成或由某人收持的文书，不得写回未拆、空白或改由别人持有。",
    "ACTIVE OBJECT STATES 是当前物件持有、内容、开合与是否在场的硬事实；未结算交接时，不得让别人拿取、移动、打开、收起或改变其中内容。没有获批的收纳位置不得补写，不能擅自把令牌放进袖中、怀中或腰间。标成 NOT_PRESENT 的文书或物件只可被谈及，不得作为实物出现在现场，也不得写成玩家眼前可以触碰却没有触碰。",
    "PLAYER ACTION 已由服务器结算，但玩家还没有在正文中看见：开头一至两段必须把其中每项行动逐项表演出来，不能从“事情已经办完”之后起笔，也不能只用一句回顾带过。只表演一次，不得写成新的提议，也不得替玩家追加第二道命令、承诺、调查、态度或结论。PLAYER ACTION 若把内容写进某份已存在文书，就直接在同名文书上落笔；不得换成空白回文纸、另纸或另一类新文书。",
    "玩家台词受 AUTHORIZED PLAYER SPEECH 严格约束：若要让玩家开口，只能逐字使用其中一条；不同获批原话必须分开说，不得扩写、合并或补充细则。没有获批原话时让玩家保持沉默，用叙述动作表现。不得替玩家补上“本督亲自”“本督派人”“届时”“保证”等主语、方式或承诺。",
    "MANDATORY SCENE BEATS 必须逐项自然发生；NPC 的话和动作必须归给原人物。到期后果只有在正文真正发生后，后台才会记为兑现。",
    "NPC 的追问、警告和条件只能自然转述 NPC AGENDA 与 MANDATORY SCENE BEATS 已给出的内容；不得替 NPC 增加新的威胁、后手、场外安排，也不得拿工作集没有确认的米铺、农户、桑苗、口粮或其他社会结果作例证。",
    "场景只能从 SCENE START 推进到 SCENE END。若 TRANSITION ALLOWED 为 false，时间和地点不得变化；人物只能按 AUTHORIZED ACTOR ARRIVALS 加入，并按 AUTHORIZED ACTOR DEPARTURES 离场，名单为空就不得自行增减到场者。若转换为 true，只能使用给出的转换，途中不得另造事件。",
    "SCENE START ACTORS 和 SCENE END ACTORS 是分阶段的实体级硬边界。转场前只能让前者行动，转场后只能让后者行动；名单外人物不得本人到场、陪同入场、落座、穿戴出镜，也不得先点名后用“他”继续动作。远处上级的立场只能由名单内代表转述。",
    "人物身份只使用 ACTORS 中已有的姓名或职衔。名单若只写职衔，就始终用该职衔，不得临时补姓氏、名字、某先生、某掌柜或其他专属称呼。",
    "未知保持未知。不得新增人物、机构、文书、证据、数量、期限、路程、送达、发现、权限、鉴伪细节或场外完成结果。",
    "已授权的期限只能按工作集原样陈述，不得改写为从此刻、现在或本轮重新起算，也不得自行延长或缩短。",
    "所有带日、夜、时辰、户、家、铺、亩、石、担等单位的数量，只能逐字使用 AUTHORIZED QUANTITIES 已列出的表达。工作集若只写“连日、近来、正在加重”，正文也只能保持这种定性说法，不得换算成“已非一日、已有数日、一夜之间”等新时长。",
    "可触碰或描写的文书与证物只限 RECENT CANON、PLAYER ACTION 和 AUTHORIZED EXISTING OBJECTS 已有者。对既有文书，只写它的名称、所在或持有人，以及工作集已经给出的文字内容；除此之外不增加任何外观、物理状态或来历。场景气氛只由人物动作、停顿、脚步和厅室声响承担，不要把文书和证物当作制造气氛的道具。不得为方便场面另取一纸、另造节略、底稿、附件或第二份文书，也不得补写任何足以鉴时、鉴人、定罪或改变证据效力的属性。",
    "不要把连续性约束写给玩家看。只呈现人物能够自然看见的状态，不写“分量没有变”“仍符合原状态”“尚未改变持有人”这类后台核对语；不得用“仍空着、仍合着、仍在某人手中”连续罗列同一物件状态。物件本轮若没有新动作，不要在结尾重复核对。",
    "时代感来自官场关系、称谓、动作、停顿和言外之意，不来自堆砌古词。让权力和代价通过人物如何追问、拒绝、具名、保管和承担显出来。",
    `写四至七个自然段，段间空一行，正文遵守获批预算 ${runtime.styleProfile.narrativeBudget.minCharacters}—${runtime.styleProfile.narrativeBudget.maxCharacters} 个非空白字符，通常以五百至九百字完成。最后停在 REQUIRED END CHANGE 造成的新现场压力上，不写“你必须决定”或任何选项提示。`,
    "不要复现《大明王朝1566》的原句；只使用获批的冲突机制、人物立场与克制的历史语感。",
    "只输出正文纯文本。"
  ].join("\n");

  const userPrompt = [
    section("RECENT CANON", recentCanonTail || "开场已经结束，本轮从当前现场直接向前。"),
    section("SCENE START", foregroundSceneStart),
    section("SCENE END", foregroundSceneEnd),
    section("SCENE START ACTORS — ONLY THESE MAY ACT BEFORE TRANSITION", plan.sceneStartActorLabels),
    section("SCENE END ACTORS — ONLY THESE MAY ACT AFTER TRANSITION", plan.sceneEndActorLabels),
    section(
      "AUTHORIZED ACTOR ARRIVALS",
      plan.authorizedActorArrivals.length
        ? plan.authorizedActorArrivals
        : ["无获批人物入场"]
    ),
    section(
      "AUTHORIZED ACTOR DEPARTURES",
      plan.authorizedActorDepartures.length
        ? plan.authorizedActorDepartures
        : ["无获批人物离场"]
    ),
    section("ACTIVE DOCUMENT STATES", foregroundSceneStart.documentStates || ["本场没有额外文书状态"]),
    section("ACTIVE OBJECT STATES", foregroundSceneStart.objectStates || ["本场没有额外物件状态"]),
    materialStateBoundary
      ? section("FRESH WRITING MATERIAL-STATE BOUNDARY", materialStateBoundary)
      : "",
    section("TRANSITION ALLOWED", plan.transitionAllowed),
    section("DRAMATIC TASK", plan.dramaticTask),
    section(
      "AUTHORIZED PLAYER SPEECH",
      plan.authorizedPlayerSpeech.length
        ? plan.authorizedPlayerSpeech
        : ["无获批玩家原话；本轮不得让玩家说出新台词"]
    ),
    fullActionSpeechAuthorized
      ? section(
          "PLAYER ACTION PERFORMANCE MODE",
          remoteDocumentOrderOnly
            ? `开头一至两段由玩家逐字说出完整的 AUTHORIZED PLAYER SPEECH 来下令。${absentActionDocumentLabels.join("、")}不在现场，因此不得当场取出、换封、盖印、分割或递交封条、封样、红纸；本轮只写命令与在场人物回应。`
            : "开头一至两段由玩家逐字说出完整的 AUTHORIZED PLAYER SPEECH 来完成本轮制度宣告；不得只用眼神、摆笔或旁白解释动作含义。"
        )
      : "",
    section("CONFIRMED EFFECTS", plan.confirmedEffects),
    section("UNRESOLVED — KEEP UNKNOWN", plan.unresolvedFacts),
    section("NPC AGENDA", plan.npcAgenda),
    section("SCENE BLOCKING", plan.sceneBlocking),
    section("MANDATORY SCENE BEATS", mandatoryBeats),
    section(
      "AUTHORIZED EXISTING OBJECTS",
      authorizedObjects.length ? authorizedObjects : ["本轮没有新增可描写物件"]
    ),
    proceduralTexture.length
      ? section("AUTHORIZED PROCEDURAL TEXTURE", proceduralTexture)
      : "",
    section("AUTHORIZED QUANTITIES", authorizedQuantities.length ? authorizedQuantities : ["无新增数量"]),
    section("REQUIRED END CHANGE", plan.requiredEndChange),
    section("NARRATIVE CEILING", plan.narrativeCeiling),
    section("STYLE", [
      ...runtime.styleProfile.registerRules,
      ...runtime.styleProfile.sceneConstructionRules,
      ...runtime.styleProfile.dialogueAndSubtextRules
    ]),
    section("PLAYER ACTION — THIS HAS ALREADY HAPPENED", event.actionText),
    section("FINAL HARD LIMIT — CHECK BEFORE OUTPUT", [
      "输出前逐段计数：必须是四至七个自然段；若少于四段，在人物动作转折或说话人切换处补空行。每段最多三句，但不要把每一句对白都单独拆段。",
      `输出前再检查正文长度：去掉空白后不得少于 ${runtime.styleProfile.narrativeBudget.minCharacters} 字；不足时只扩写已授权人物当场的动作、停顿、语气、彼此观察和已授权压力的言外之意，不能用重复物件状态、规则解释或新增事实凑字。`,
      plan.authorizedPlayerSpeech.length
        ? fullActionSpeechAuthorized
          ? `玩家必须在开头逐字说出：${normalizedPlayerAction}`
          : `玩家若开口，只能逐字说：${plan.authorizedPlayerSpeech.join(" / ")}`
        : "玩家本轮保持沉默，不得给玩家增加任何引号台词。",
      "开头先完整写出 PLAYER ACTION，再逐项写出 MANDATORY SCENE BEATS；除此不增加人物、物件、文书、数字、威胁、承诺、社会现状或场外结果。场景转换前只用人物动作、对话和厅室声响，不用环境变化暗示时间流逝。",
      remoteDocumentOrderOnly
        ? "行动目标文书不在现场：只写玩家下令，不写实物操作，也不创造封条、封样、红纸或其他代用品。"
        : "",
      "最后停在 REQUIRED END CHANGE 的人物追问、到场或新动作上，不用尾段复述文书、匣子、令牌等物件的未变化状态，不写选项和规则。"
    ].filter(Boolean))
  ].filter(Boolean).join("\n\n");

  return {
    systemPrompt,
    userPrompt,
    responseMode: "TEXT",
    outputSchema: {
      type: "plain_text",
      paragraphs: { minimum: 4, maximum: 7 },
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
  // The parser already makes the final paragraph the changed present
  // situation. Feeding earlier dialogue back to the next call encourages the
  // model to repeat or inflate it; scene/object state carries the facts.
  return paragraphs.at(-1) || "";
}

function section(title: string, value: unknown) {
  const rendered = typeof value === "string"
    ? value
    : JSON.stringify(value, null, 2);
  return `【${title}】\n${rendered}`;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function projectForegroundScene<
  T extends {
    presentActorRefs?: string[];
    documentStates?: Array<Record<string, unknown> & { continuityNote?: string }>;
    objectStates?: Array<Record<string, unknown> & {
      continuityNote?: string;
      holderRef?: unknown;
    }>;
  }
>(scene: T) {
  const presentActorRefs = new Set(scene.presentActorRefs || []);
  return {
    ...scene,
    documentStates: (scene.documentStates || []).map(({ continuityNote: _continuityNote, ...state }) => ({
      ...state,
      physicalDescriptionPolicy: "NAME_HOLDER_AND_AUTHORIZED_TEXT_ONLY"
    })),
    objectStates: (scene.objectStates || []).map(({ continuityNote: _continuityNote, ...state }) => {
      const holderRef = typeof state.holderRef === "string" ? state.holderRef : null;
      return {
        ...state,
        physicalDescriptionPolicy: "AUTHORIZED_STATE_FIELDS_ONLY_NO_NEW_APPEARANCE",
        presenceState:
          holderRef && !presentActorRefs.has(holderRef)
            ? "NOT_PRESENT"
            : "PRESENT"
      };
    })
  };
}
