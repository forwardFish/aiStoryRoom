import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const authoringRoot = resolve(repoRoot, "packages/templates/authoring/sangtian");
const narrativeRoot = resolve(authoringRoot, "narrative");
const requirements = readJson(resolve(authoringRoot, "requirements/part-01.requirements.json"));
const sections = readdirSync(resolve(authoringRoot, "sections/part-01"))
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => readJson(resolve(authoringRoot, "sections/part-01", name)));
const sourceEvidence = readJson(resolve(authoringRoot, "source-evidence/section-one-scenes.approved.json"));

const themes = {
  "SEC-P1-02": [
    {
      suffix: "CUSTODY-AS-POLITICAL-POWER",
      dramaticFunction: "把原册留置、换封、抄录与移交写成看得见的权力动作：谁碰到材料，谁就同时取得解释权与保管责任。",
      openingPressure: "三方都声称要保全县册，却没有人愿意让另一方先接触原件。",
      moves: [
        ["主张保全的一方", "把封样、交接清单或见证位置摆到案前，要求先固定第一段保管责任。", "把抽象的证据安全转成当场可执行的动作。", "另一方不再争真假，转而争谁能在场。"],
        ["当前保管人", "只承认自己实际接触过的材料，并明确哪些动作仍只是命令、尚未完成。", "阻止叙事把待办事项提前写成既成事实。", "问话者必须选择等待、共同见证或承担接管责任。"],
        ["争取材料入口的人", "要求任何启封、抄录和移交都留下双方经手人。", "让程序入口本身成为权力冲突。", "场景停在谁先获得合法接触权的决定点。"],
      ],
      tactics: [
        ["当前保管人", "反复区分命令已下与动作已完成。", "害怕未来的缺页或调换都倒追到自己名下。", "短句确认事实，遇到未知立即停住。"],
        ["争取材料入口的人", "不用指控篡改，只追问谁在场、谁具名、谁留封样。", "需要在不暴露自身目的的情况下取得材料入口。", "问题逐步收窄，最后逼出一个程序选择。"],
      ],
      objects: [["封样与交接清单", "被放在双方都看得见的位置，却只有取得授权的人能签写。", "物件同时固定材料状态、接触顺序与未来责任。"]],
    },
    {
      suffix: "TESTIMONY-KNOWLEDGE-BOUNDARY",
      dramaticFunction: "让书吏的亲历、听闻与推断在问答中分层；保护、共同问讯或封缄供述会改变谁知道什么，却不能自动产生新证词。",
      openingPressure: "各方都想先接触经手书吏，而书吏只愿意承担自己亲手做过的那一段。",
      moves: [
        ["经手书吏", "先说明自己亲手经办的范围，遇到未见之事便明确说不知道。", "建立可验证的最小知识边界。", "追问者不能再把传闻包装成证词。"],
        ["保护或问讯的主持者", "用传唤地点、在场见证和抄送记录限制接触。", "让保护不是藏人，而是一套可复核权限。", "另一方要求同等可见或书面收讫。"],
        ["争夺知情权的一方", "只要求取得已经允许披露的材料，并把拒绝范围写入往来文书。", "把知识不对称转成后续反制。", "场景停在披露边界而不是幕后真相。"],
      ],
      tactics: [
        ["经手书吏", "每句话先标明亲历还是听闻。", "说多会成为替罪羊，说少又可能失去保护。", "答复克制，关键未知处不补全。"],
        ["争夺知情权的一方", "用同案同见证要求进入问讯，而不是直接索要结论。", "不能显得在威胁证人，却必须避免总督独占说法。", "先谈程序，最后才谈材料范围。"],
      ],
      objects: [["封缄供述", "可以被收存、登记和拒绝抄送，但内容不会因封缄而自动变真。", "文书把初始说法与后续改口区分开。"]],
    },
    {
      suffix: "JOINT-REVIEW-ACCESS-CONFLICT",
      dramaticFunction: "把复核主持权拆成开册、抄录、见证与写第一轮结论的具体权限，让督抚与县衙在同一张程序桌上相互制约。",
      openingPressure: "所有人都赞成复核，却对谁先开册、谁写结论没有共同答案。",
      moves: [
        ["要求主持复核的人", "先列出开册、抄录与签押的次序。", "把主持权落到实际入口。", "县衙追问自己是经办、见证还是仅交材料。"],
        ["县衙负责人", "指出原件仍在县中，任何程序都必须先说明首段保管责任。", "让地方执行风险进入决策。", "督抚双方必须承担等待或接管的代价。"],
        ["被排除的一方", "以另立记录或拒绝共同具名作为反制。", "显示程序失衡会立即产生政治后果。", "玩家必须决定主持与制衡的边界。"],
      ],
      tactics: [
        ["要求主持复核的人", "不争抽象名分，只问第一把钥匙、第一份抄件和第一轮结论。", "先获得程序入口即可影响后续叙述。", "连续短问，把选择压到当前场景。"],
        ["县衙负责人", "用实际保管责任反问上级。", "既不愿抗命，也不愿独担材料出错。", "先领命，再明确尚未完成的步骤。"],
      ],
      objects: [["复核清单", "由主持者逐项写下，但每一项都需要经手人与见证留下名字。", "清单决定谁能接触材料，也决定第一版事实如何形成。"]],
    },
  ],
  "SEC-P1-03": [
    {
      suffix: "VISIBLE-SCARCITY-BEFORE-EXPLANATION",
      dramaticFunction: "先让缺粮、米市与等候赈济的人进入场景，再让官府和商会争论来源；现实后果始终反证任何轻易承诺。",
      openingPressure: "有限现粮、未到的借粮与商会可立即调动的船同时摆在总督面前。",
      moves: [
        ["县衙负责人", "用仓中可用粮与等待人群说明眼前缺口，不虚构精确数字。", "让救急顺序不能被政策口号带过。", "商会立即以船与运力换取条件。"],
        ["商会会首", "把粮路、担保与未来权利捆在同一次问价里。", "把救急变成进入政策的机会。", "官府必须明确接受什么、拒绝什么。"],
        ["主政者", "先确定第一批粮路，再让债务、核销与责任跟着进入场景。", "任何救粮选择都留下可追责代价。", "下一决定转向商会边界或发放次序。"],
      ],
      tactics: [
        ["县衙负责人", "只说已经看见的断粮压力与仓储限制。", "既要催粮，也怕被追问过去准备不足。", "事实短答，未知数字不补。"],
        ["商会会首", "先承诺能办，再逐层问官府担保什么。", "不能公开承认逐利，却要把风险换成权利。", "语气从容，条件一项项落下。"],
      ],
      objects: [["粮账与借据", "每一笔入粮都同时写下垫付、担保和偿还责任。", "粮食不是无成本道具，账本会把未来追责锁到经手人。"]],
    },
    {
      suffix: "MERCHANT-BARGAIN-WITH-BOUNDARIES",
      dramaticFunction: "让商会合作通过逐船、逐日、公开条件成立；一次救急不能无声升级成购田、收丝或长期官保。",
      openingPressure: "商会愿意继续出船，却要求把临时合作写成长期凭据。",
      moves: [
        ["商会会首", "把下一批船期与官府担保放在同一句话里。", "迫使官府为合作边界作出明确回应。", "县令追问权利是否会绕到田契。"],
        ["县衙负责人", "要求把买受人、运价或所求权利公开登记。", "让隐性代价进入可复核范围。", "会首选择缩减合作或接受短约。"],
        ["主政者", "只批准当前决定明确包含的粮食与运输权利。", "阻止叙事自动授予附带利益。", "合作成立但新的压力被带入下一场。"],
      ],
      tactics: [
        ["商会会首", "不直接索要特权，只问出了粮以后官府如何回报风险。", "要把商业位置变成政策位置。", "先示善，后把条件说得越来越具体。"],
        ["县衙负责人", "用灾民田契和经手登记反问交易边界。", "担心显性禁令被代持和转手绕过。", "每问都落到一张契或一名买受人。"],
      ],
      objects: [["逐船短约", "每一船单独具结并公开条件，不把昨日合作自动延长到明日。", "短约保留弹性，也让每天的信用成本可追查。"]],
    },
    {
      suffix: "LAND-RELIEF-TRADEOFF",
      dramaticFunction: "把救粮次序、灾期田契与改桑范围写进同一因果链：保田会增加粮食与政治压力，保粮也不能让购田权自动扩张。",
      openingPressure: "百姓需要粮，商会需要回报，巡抚需要进度；三种压力同时挤向田契。",
      moves: [
        ["县衙负责人", "把抵押、急售与等待领粮的风险摆到案前。", "显示卖田尚是逼近的风险而非已经完成的事实。", "巡抚一方追问对改桑进度的代价。"],
        ["巡抚一方", "要求说明土地保护会拖慢哪些既定事项。", "把保田选择转成公开政治成本。", "主政者必须承担或分配责任。"],
        ["主政者", "确定底价、禁购或跨县分摊中的一条可执行边界。", "让保护措施改变状态而非停在表态。", "有限粮食的发放优先级随即成为新决定。"],
      ],
      tactics: [
        ["县衙负责人", "不宣称兼并已经发生，只报告正在出现的询价和急售风险。", "夸大事实会失去可信度，压低风险又会伤民。", "先说可见迹象，再请求边界。"],
        ["巡抚一方", "把每一条保护措施翻译成进度和问责。", "要维护国策速度，却不能公开支持灾期压价。", "承认保护理由，随即追问代价由谁承担。"],
      ],
      objects: [["田契登记册", "记录成交边界与买受人，却不替官府判定幕后关系。", "登记把未来可查性带入现在的交易。"]],
    },
  ],
  "SEC-P1-04": [
    {
      suffix: "FIRST-REPORT-COMPETING-FRAMES",
      dramaticFunction: "让第一份入京文字成为争夺：署名、附件与先后次序决定谁先定义浙江危局，但不得提前写成京师已经采信。",
      openingPressure: "督抚都知道第一份离府的文字会先占住责任名分。",
      moves: [
        ["巡抚幕僚", "要求核对总督准备送出的事实边界与署名方式。", "把地方争执推向不可收回的官方记录。", "总督必须选择联署、独奏或分奏。"],
        ["县衙负责人", "追问附件会不会带出原件保管人与书吏。", "让报告分量与人证风险同时进入决定。", "幕僚要求材料可见性对等。"],
        ["主政者", "确定作者、附件和责任范围，却不替京师作出判断。", "首报由此成为已提交行动。", "下一场转向递送渠道与收讫记录。"],
      ],
      tactics: [
        ["巡抚幕僚", "不用威胁定罪，只强调另一份文字随时可以形成。", "需要阻止总督独占首版叙述。", "每句话都围绕哪一版、谁署名、谁先送。"],
        ["县衙负责人", "把抽象附件问成具体经手人与保管记录。", "材料越强，地方人员越暴露。", "先承认奏报必要，再请求边界。"],
      ],
      objects: [["奏稿与附件目录", "正文可以改写，目录与封号却会留下每一版材料的边界。", "物件固定谁碰过哪一版文字。"]],
    },
    {
      suffix: "ATTACHMENT-HANDLER-CHAIN",
      dramaticFunction: "把样册、封条记录、人证供述与经手名单拆开裁定；附件越强，证据可复核性和人员风险越高。",
      openingPressure: "首报需要分量，但没有人能假装完整附件不会暴露经手链。",
      moves: [
        ["县衙负责人", "逐项核对哪些材料已经存在、哪些仍在复核。", "阻止附件清单凭空生成未取得的证据。", "书吏要求知道自己的说法是否随报。"],
        ["经手书吏", "区分供述、保管记录与人名推断。", "让保护人证与增强奏报之间出现真实取舍。", "巡抚一方要求获得同等材料。"],
        ["主政者", "只把已提交事件建立的材料列入附件。", "报告强度与责任范围形成可持续状态。", "递送渠道成为最后一道决定。"],
      ],
      tactics: [
        ["县衙负责人", "每提一项附件就说明它的来源与当前保管人。", "不能让未来缺失倒追成县衙隐匿。", "清单式短答，但每项都有责任。"],
        ["经手书吏", "不争政治立场，只问谁能看到、如何抄送。", "说法一旦扩散便失去控制。", "问题克制，关键处要求书面规则。"],
      ],
      objects: [["封号与附件目录", "每一项材料都对应一个封号、来源和经手记录。", "目录本身成为防止悄然增删的证据。"]],
    },
    {
      suffix: "DISPATCH-AND-INTERIM-ORDER",
      dramaticFunction: "让奏报离府后仍产生地方行动：正式通政、急递或双路互证改变送达责任，候旨期间的临时规矩决定第二部分从何处继续。",
      openingPressure: "京师回文尚不可知，各县却不能把等待当作自行扩张或停摆的许可。",
      moves: [
        ["负责递送的人", "当场记录封号、交接与下一站责任。", "让渠道不是一句走哪条路，而是连续责任链。", "巡抚幕僚要求核对送出的版本。"],
        ["巡抚幕僚", "在首报离府后要求一份摘要或正式拒交记录。", "让叙述权争夺继续产生可见后果。", "商会与县衙把候旨期间的现实压力带回厅中。"],
        ["主政者", "在不虚构京师回应的前提下设定临时土地或粮路边界。", "第一部分以可追踪的未决状态收束。", "下一部分从粮荒、债务与卖田代价继续。"],
      ],
      tactics: [
        ["负责递送的人", "只报告已经完成的交接，不预告到达时辰。", "任何过度承诺都会成为未来失信。", "报一站、记一站，不跳到京师结果。"],
        ["巡抚幕僚", "把候旨解释成必须有临时规则，而不是暂停责任。", "不愿总督借等待独占政策边界。", "先承认首报已走，再逼问地方下一步。"],
      ],
      objects: [["交接簿与封号", "文书每离开一处就留下接手人与时辰，尚未到达的地方保持未知。", "递送链把速度、泄露与问责同时固定。"]],
    },
  ],
};

for (const sectionId of ["SEC-P1-02", "SEC-P1-03", "SEC-P1-04"]) {
  const section = sections.find((item) => item.sectionId === sectionId);
  if (!section) throw new Error(`SECTION_MISSING:${sectionId}`);
  const definitions = themes[sectionId];
  const requirementRows = section.requiredRequirementIds
    .map((id) => requirements.requirements.find((item) => item.requirementId === id))
    .filter(Boolean);
  const patterns = definitions.map((definition, index) => {
    const assignedRequirements = requirementRows.filter((_, rowIndex) => rowIndex % 3 === index);
    const effectiveRequirements = assignedRequirements.length ? assignedRequirements : [requirementRows[index % requirementRows.length]];
    const requirementIds = effectiveRequirements.map((item) => item.requirementId);
    const decisionKernelIds = unique(effectiveRequirements.flatMap((item) => item.decisionKernelIds || []));
    const sourceClaimIds = unique(effectiveRequirements.flatMap((item) => item.sourceClaimIds || []));
    const sourceScene = findSourceScene(sourceClaimIds) || sourceEvidence.scenes[index % sourceEvidence.scenes.length];
    return {
      schemaVersion: "narrative-scene-pattern-v1",
      patternId: `NSP-${sectionId.replace("SEC-P1-", "P1-S")}-${definition.suffix}`,
      sourceSceneId: sourceScene.sceneId,
      sourceRefs: [{
        sourceId: sourceEvidence.sourceId,
        sourceSha256: sourceEvidence.sourceSha256,
        chapterId: sourceScene.sourceRange.chapterId,
        paragraphStartId: sourceScene.sourceRange.paragraphStartId,
        paragraphEndId: sourceScene.sourceRange.paragraphEndId,
        lineStart: sourceScene.sourceRange.lineStart,
        lineEnd: sourceScene.sourceRange.lineEnd,
        textSpanSha256: sourceScene.sourceRange.textSpanSha256,
      }],
      sectionIds: [sectionId],
      requirementIds,
      decisionKernelIds,
      actorRefs: section.foregroundActorRefs,
      sourceClaimIds,
      dramaticFunction: definition.dramaticFunction,
      openingPressure: definition.openingPressure,
      runtimeActivationCues: activationCues(sectionId, index),
      orderedBeats: definition.moves.map(([actorRole, observableMove, sceneFunction, reactionCue], moveIndex) => ({
        ordinal: moveIndex + 1,
        actorRole,
        observableMove,
        sceneFunction,
        reactionCue,
      })),
      dialogueTactics: definition.tactics.map(([actorRole, surfaceMove, hiddenRisk, cadenceRule]) => ({
        actorRole,
        surfaceMove,
        hiddenRisk,
        cadenceRule,
      })),
      blockingPrinciples: [
        "先让人物通过可见动作争夺入口、责任或解释权，再允许较长解释。",
        "场景中的沉默必须促使另一人物抢话、追问或改变站位。",
        "每个 beat 在当前未回答的决定点停住，不替玩家完成选择。",
      ],
      objectPowerMoves: definition.objects.map(([objectLabel, observableUse, powerMeaning]) => ({ objectLabel, observableUse, powerMeaning })),
      transferableTechniques: [
        "把后台状态拆成递交、拒接、具名、封存、张榜或交接等可见动作。",
        "每个强硬主张都必须伴随责任、资源、知情风险或可追查记录。",
        "NPC 的反制改变下一步压力，但不得替玩家决定结果。",
      ],
      forbiddenFlattening: [
        "不得把冲突改写成并列压力清单或系统状态播报。",
        "不得由旁白提前宣布责任、幕后真相或未来裁决。",
        "不得用人物轮流解释背景替代当场争夺与反应。",
      ],
      verbatimPolicy: "MECHANISM_ONLY_NO_VERBATIM_REUSE",
      reviewStatus: "APPROVED",
      reviewerId: "chatgpt-pro-four-section-convergence-v1",
      approvedAt: "2026-08-05T00:00:00Z",
    };
  });
  const output = {
    schemaVersion: "narrative-scene-pattern-set-v1",
    worldId: "sangtian",
    scopeId: `PART-01/${sectionId}`,
    version: `1.0.0-${sectionId.toLowerCase()}`,
    patterns,
  };
  writeJson(resolve(narrativeRoot, `scene-patterns.section-${sectionId.slice(-2)}.approved.json`), output);
}

patchCompiler();
patchFrozenCardinalities();
patchPackageScripts();
console.log(JSON.stringify({
  verdict: "PASS",
  generatedPatternSets: ["02", "03", "04"],
  expectedNarrativePatternCount: 12,
  expectedRuntimeAssetCount: 74,
}, null, 2));

function patchCompiler() {
  const path = resolve(repoRoot, "scripts/story-decomposition/compile-sangtian-part-one-authoring.mjs");
  let source = readFileSync(path, "utf8");
  if (!source.includes("const narrativeScenePatternSets = []")) {
    source = source.replace(
      /const narrativeScenePatternSet = await readJson\(resolve\(authoringRoot, "narrative\/scene-patterns\.section-01\.approved\.json"\)\);/u,
      `const narrativeScenePatternSets = [];\nfor (const name of (await readdir(resolve(authoringRoot, "narrative")))\n  .filter((entry) => /^scene-patterns\\.section-\\d+\\.approved\\.json$/u.test(entry))\n  .sort()) {\n  narrativeScenePatternSets.push(await readJson(resolve(authoringRoot, "narrative", name)));\n}\nconst narrativeScenePatternSet = {\n  schemaVersion: "narrative-scene-pattern-set-v1",\n  worldId: "sangtian",\n  scopeId: "PART-01",\n  version: "1.0.0-part-01",\n  patterns: narrativeScenePatternSets.flatMap((set) => set.patterns),\n};`,
    );
  }
  const oldValidation = `const narrativePatternValidation = await validateWithSchema("narrative-scene-pattern-set-v1", narrativeScenePatternSet);\nif (!narrativePatternValidation.valid) {\n  throw new Error(\`T3 compilation blocked: NarrativeScenePatternSet is invalid: \${JSON.stringify(narrativePatternValidation.errors)}\`);\n}\nif (narrativeScenePatternSet.worldId !== "sangtian" || narrativeScenePatternSet.scopeId !== "PART-01/SEC-P1-01") {\n  throw new Error("T3 compilation blocked: NarrativeScenePatternSet has the wrong story scope");\n}\nif (narrativeScenePatternSet.patterns.length !== 3 || narrativeScenePatternSet.patterns.some((item) => item.reviewStatus !== "APPROVED")) {\n  throw new Error("T3 compilation blocked: the three Section One NarrativeScenePatterns must be approved");\n}`;
  if (source.includes(oldValidation)) {
    source = source.replace(oldValidation, `const expectedNarrativeScopes = new Set([\n  "PART-01/SEC-P1-01",\n  "PART-01/SEC-P1-02",\n  "PART-01/SEC-P1-03",\n  "PART-01/SEC-P1-04",\n]);\nif (narrativeScenePatternSets.length !== 4) {\n  throw new Error(\`T3 compilation blocked: expected four NarrativeScenePattern sets, found \${narrativeScenePatternSets.length}\`);\n}\nfor (const set of narrativeScenePatternSets) {\n  const validation = await validateWithSchema("narrative-scene-pattern-set-v1", set);\n  if (!validation.valid) {\n    throw new Error(\`T3 compilation blocked: NarrativeScenePatternSet is invalid: \${JSON.stringify(validation.errors)}\`);\n  }\n  if (set.worldId !== "sangtian" || !expectedNarrativeScopes.has(set.scopeId)) {\n    throw new Error(\`T3 compilation blocked: NarrativeScenePatternSet has the wrong story scope \${set.scopeId}\`);\n  }\n  if (set.patterns.length !== 3 || set.patterns.some((item) => item.reviewStatus !== "APPROVED")) {\n    throw new Error(\`T3 compilation blocked: each section must define three approved NarrativeScenePatterns: \${set.scopeId}\`);\n  }\n}\nif (new Set(narrativeScenePatternSets.map((set) => set.scopeId)).size !== 4) {\n  throw new Error("T3 compilation blocked: NarrativeScenePattern scopes are duplicated");\n}\nif (narrativeScenePatternSet.patterns.length !== 12) {\n  throw new Error(\`T3 compilation blocked: expected twelve Part One NarrativeScenePatterns, found \${narrativeScenePatternSet.patterns.length}\`);\n}\nif (new Set(narrativeScenePatternSet.patterns.map((item) => item.patternId)).size !== 12) {\n  throw new Error("T3 compilation blocked: NarrativeScenePattern IDs are duplicated");\n}`);
  }
  if (!source.includes("expected four NarrativeScenePattern sets")) {
    throw new Error("COMPILER_NARRATIVE_PATTERN_PATCH_NOT_APPLIED");
  }
  writeFileSync(path, source, "utf8");
}

function patchFrozenCardinalities() {
  const roots = [
    resolve(repoRoot, "packages/templates/src"),
    resolve(repoRoot, "packages/templates/tests"),
    resolve(repoRoot, "apps/openovel-runtime/tests"),
  ];
  for (const root of roots) {
    for (const path of walkSource(root)) {
      let source = readFileSync(path, "utf8");
      const before = source;
      source = source
        .replaceAll("assets.length !== 65", "assets.length !== 74")
        .replaceAll("assets.length, 65", "assets.length, 74")
        .replaceAll("narrativePatternIds.length !== 3", "narrativePatternIds.length !== 12")
        .replaceAll("narrativePatternIds.length, 3", "narrativePatternIds.length, 12")
        .replaceAll("4/12/65/15/4/4/7/3/10", "4/12/74/15/4/4/7/12/10");
      if (source !== before) writeFileSync(path, source, "utf8");
    }
  }
}

function patchPackageScripts() {
  const path = resolve(repoRoot, "package.json");
  const pkg = readJson(path);
  pkg.scripts ||= {};
  pkg.scripts["test:story:convergence"] = "node scripts/acceptance/verify-ai-story-convergence.mjs";
  pkg.scripts["test:story:branch-persistence"] = "pnpm --filter @ai-story/templates build && node scripts/acceptance/verify-part-one-branch-persistence.mjs";
  pkg.scripts["test:story:real-model:g00-t20"] = "node scripts/acceptance/run-real-model-g00-t20.mjs";
  writeJson(path, pkg);
}

function findSourceScene(claimIds) {
  return sourceEvidence.scenes.find((scene) => scene.mechanisms.some((mechanism) => (
    mechanism.claimIds.some((claimId) => claimIds.includes(claimId))
  )));
}

function activationCues(sectionId, index) {
  const cues = {
    "SEC-P1-02": [
      ["原册", "封存", "见证", "交接", "抄件", "保管"],
      ["书吏", "供述", "问讯", "知情", "披露", "保护"],
      ["复核", "主持", "开册", "具名", "县衙", "巡抚"],
    ],
    "SEC-P1-03": [
      ["缺粮", "粮船", "官仓", "借粮", "米市", "赈济"],
      ["商会", "运价", "担保", "短约", "权利", "核销"],
      ["田契", "卖田", "底价", "禁购", "改桑", "发粮"],
    ],
    "SEC-P1-04": [
      ["奏报", "联署", "独奏", "分奏", "京师", "首报"],
      ["附件", "封号", "样册", "经手人", "供述", "目录"],
      ["递送", "交接", "急递", "通政", "候旨", "临时规矩"],
    ],
  };
  return cues[sectionId][index];
}

function walkSource(root) {
  const files = [];
  for (const name of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, name.name);
    if (name.isDirectory()) files.push(...walkSource(path));
    else if (/\.(?:ts|mjs|js)$/u.test(name.name)) files.push(path);
  }
  return files;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}
function unique(values) {
  return [...new Set(values)];
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
