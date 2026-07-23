export type PlayerFacingNarrativeIssue = {
  code:
    | "NARRATIVE_EMBEDS_DECISION_MENU"
    | "NARRATIVE_LEAKS_INTERNAL_LANGUAGE"
    | "NARRATIVE_READS_LIKE_RULE_SUMMARY"
    | "NARRATIVE_SCENE_MOTION_MISSING";
  detail: string;
};

export type PlayerFacingNarrativeGuardInput = {
  text: string;
  forbiddenFlattening?: string[];
  requireSceneMotion?: boolean;
};

/**
 * World-independent player prose gate. Story packages provide their own
 * forbidden flattening phrases; the engine only enforces stable failure
 * shapes such as menus, internal schema language and rule-heavy summaries.
 */
export function inspectPlayerFacingNarrative(
  input: PlayerFacingNarrativeGuardInput
): PlayerFacingNarrativeIssue[] {
  const text = String(input.text || "").trim();
  const issues: PlayerFacingNarrativeIssue[] = [];

  const outsideDialogue = stripDialogue(text);
  const explicitMenu = text.match(
    /(?:必须|需要|得|尚待)(?:在[^。！？\n]{0,30})?(?:先)?(?:决定|判断|选择)[^。！？\n]{0,50}(?:是|先)[^。！？\n]{0,120}(?:还是|或是|抑或)|(?:第一步|下一步)[：:][^。！？\n]{0,120}(?:还是|或是|抑或)/
  )?.[0];
  const narratedConditionalMenu = outsideDialogue.match(
    /若[^。！？\n]{0,100}[；;，,]\s*[^。！？\n]{0,8}若[^。！？\n]{0,100}/
  )?.[0];
  const embeddedMenu = explicitMenu || narratedConditionalMenu;
  if (embeddedMenu) {
    issues.push({ code: "NARRATIVE_EMBEDS_DECISION_MENU", detail: embeddedMenu });
  }

  const internalLanguage = text.match(
    /(?:StoryCapabilityRequirement|Decision Kernel|Actor Policy|actionKey|factKey|effectKey|worldSequence|玩家选择|候选项|候选方向|系统判定|下一回合|本回合)/i
  )?.[0];
  if (internalLanguage) {
    issues.push({ code: "NARRATIVE_LEAKS_INTERNAL_LANGUAGE", detail: internalLanguage });
  }

  const packagePhrase = (input.forbiddenFlattening || []).find((phrase) => phrase && text.includes(phrase));
  if (packagePhrase) {
    issues.push({ code: "NARRATIVE_LEAKS_INTERNAL_LANGUAGE", detail: packagePhrase });
  }

  const constraintCount = text.match(/必须|只能|不能|可以|不得|需要|尚未具备|不足以/g)?.length || 0;
  const sceneMoveCount = text.match(/问|答|道|说|回|递|接|捧|放|取|起身|坐下|转身|停住|退下|领命|摇头|点头|望向|看了|听见|走到|等候|搁下|翻到|举起/g)?.length || 0;
  const continuityLedger = outsideDialogue.match(
    /(?:回文匣|空匣|匣子|公文|密信|文书|县册|原册|副本|封条|令牌)[^。！？\n]{0,70}(?:仍|没有|未)[^。！？\n]{0,26}(?:仍|没有|未)[^。！？\n]{0,26}(?:仍|没有|未)/
  )?.[0] || findObjectStateLedger(outsideDialogue);
  if (continuityLedger) {
    issues.push({
      code: "NARRATIVE_READS_LIKE_RULE_SUMMARY",
      detail: continuityLedger
    });
  } else if (constraintCount >= 4 && constraintCount > sceneMoveCount) {
    issues.push({
      code: "NARRATIVE_READS_LIKE_RULE_SUMMARY",
      detail: `constraintCount=${constraintCount};sceneMoveCount=${sceneMoveCount}`
    });
  }

  if (input.requireSceneMotion !== false && sceneMoveCount < 2) {
    issues.push({
      code: "NARRATIVE_SCENE_MOTION_MISSING",
      detail: `sceneMoveCount=${sceneMoveCount}`
    });
  }
  return uniqueIssues(issues);
}

function stripDialogue(text: string) {
  return text
    .replace(/[“"][^”"]*[”"]/g, " ")
    .replace(/‘[^’]*’/g, " ");
}

function findObjectStateLedger(text: string) {
  const objectPattern = /回文匣|空匣|匣子|公文|密信|文书|县册|原册|副本|封条|令牌/;
  const unchangedPattern = /仍|依旧|未动|不动|没有动|还在/;
  const statePatterns = [
    /空着|是空的|空匣/,
    /合着|闭着|未开|没有打开/,
    /捧着|抱着|握着|攥着|在[^，；。！？\n]{0,12}手中/,
    /未动|不动|没有动/
  ];
  const stateChangePattern =
    /打开|启开|揭开|递出|递给|交给|接过|带走|取走|拿走|放入|收入|装入|写入|落印|封入/;

  for (const sentence of text.split(/[。！？\n]+/).map((value) => value.trim()).filter(Boolean)) {
    if (!objectPattern.test(sentence) || !unchangedPattern.test(sentence) || stateChangePattern.test(sentence)) {
      continue;
    }
    const stateCount = statePatterns.filter((pattern) => pattern.test(sentence)).length;
    if (stateCount >= 2) return sentence;
  }
  return undefined;
}

function uniqueIssues(issues: PlayerFacingNarrativeIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
