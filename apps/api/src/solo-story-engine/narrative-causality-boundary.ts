import type { NarrativeTextureAllowance } from "@ai-story/templates";

export type NarrativeCausalityLevel =
  | "L0_TEXTURE"
  | "L1_EPHEMERAL_SCENE_DETAIL"
  | "L2_DURABLE_ENTITY"
  | "L3_EVIDENCE_OR_AUTHORITY";

export type NarrativeActorAliases = {
  actorRef: string;
  aliases: readonly string[];
};

export type ExplicitObjectManipulation = {
  actorRef: string;
  fragment: string;
  level: "L2_DURABLE_ENTITY";
  predicate: "OBJECT_MANIPULATION";
};

const CREATION_SUBSTRATE_PATTERN =
  /(?:另取|取过|拿过|抽出|铺开|摊开|在|于)?[^。！？]{0,8}(?:一张纸|一页纸|一纸|白纸|空笺|空白笺纸|空白纸页|空白纸张|尚未落字的笺纸|尚未落字的纸页|回文纸|文纸|札纸|纸页|纸张|笺纸)/;

const CREATION_ACTION_PATTERN =
  /(?:提笔|落笔|挥笔|蘸墨|落字|写成|写就|写下|写明|书成|绘成|刻成|打印成|制成|录成)/;

const INDEPENDENT_CAUSAL_ARTIFACT_PATTERN =
  /(?:第二份|另一份|另成一份|另作一份|作为(?:附页|附件|底稿|副本|抄本|存根|证物|证据)|(?:另留|另存|留存|抄存|备存|复制|复印)[^。！？]{0,10}(?:一份|一纸|底稿|副本|抄本|附件|证物|证据))/;

/**
 * A creation substrate is prose texture only when the same local clause:
 * 1. names an already-authorized target entity;
 * 2. visibly creates that target; and
 * 3. does not give the substrate an independent causal role.
 *
 * The rule is world-neutral. Story packages authorize the target entity;
 * language adapters recognize how the creation is narrated.
 */
export function isAuthorizedIncidentalCreationTexture(
  fragment: string,
  allowances: readonly NarrativeTextureAllowance[] = []
) {
  if (!CREATION_SUBSTRATE_PATTERN.test(fragment)) return false;
  if (!CREATION_ACTION_PATTERN.test(fragment)) return false;
  if (INDEPENDENT_CAUSAL_ARTIFACT_PATTERN.test(fragment)) return false;

  return allowances.some((allowance) =>
    allowance.textureClass === "CREATION_SUBSTRATE"
    && allowance.lifecycle === "CONSUMED_INTO_TARGET"
    && fragment.includes(allowance.targetEntityLabel)
  );
}

export function creationTextureTargetLabels(
  allowances: readonly NarrativeTextureAllowance[] = []
) {
  return allowances
    .filter((allowance) =>
      allowance.textureClass === "CREATION_SUBSTRATE"
      && allowance.lifecycle === "CONSUMED_INTO_TARGET"
    )
    .map((allowance) => allowance.targetEntityLabel);
}

/**
 * Detects an explicit, durable object manipulation by someone other than the
 * authorized holder.
 *
 * This deliberately does not infer causality from a nearby noun or verb. It
 * requires:
 * 1. an actor parsed as the grammatical subject of the sentence/clause;
 * 2. a physical manipulation predicate applied to the durable object; and
 * 3. no negation, hypothetical framing, reported dialogue, gaze, light, sound,
 *    or other L0 narrative texture.
 *
 * An explicitly parsed subject may carry through omitted-subject continuation
 * clauses such as "写毕，放入匣中". A mere mention such as
 * "把目光从总督脸上移到匣上" never establishes 总督 as the subject.
 */
export function findExplicitUnauthorizedObjectManipulation(input: {
  prose: string;
  objectLabels: readonly string[];
  authorizedHolderRef: string | null;
  actors: readonly NarrativeActorAliases[];
}): ExplicitObjectManipulation | null {
  if (!input.authorizedHolderRef || input.objectLabels.length === 0) return null;

  const proseOutsideDialogue = stripQuotedDialogue(input.prose);
  let precedingExplicitActorRef: string | null = null;

  for (const rawSentence of proseOutsideDialogue.split(/[。！？\n]+/)) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;

    const clauses = sentence
      .split(/[，；]+/)
      .map((clause) => clause.trim())
      .filter(Boolean);
    if (clauses.length === 0) continue;

    let sentenceActorRef: string | null = null;
    const firstSubject = explicitClauseSubject(clauses[0]!, input.actors);
    if (firstSubject) {
      sentenceActorRef = firstSubject.actorRef;
      precedingExplicitActorRef = firstSubject.actorRef;
    } else if (
      precedingExplicitActorRef
      && isOmittedSubjectContinuation(clauses[0]!)
    ) {
      sentenceActorRef = precedingExplicitActorRef;
    } else {
      precedingExplicitActorRef = null;
    }

    for (const clause of clauses) {
      const explicitSubject = explicitClauseSubject(clause, input.actors);
      if (explicitSubject) {
        sentenceActorRef = explicitSubject.actorRef;
        precedingExplicitActorRef = explicitSubject.actorRef;
      } else if (startsWithUnresolvedPronoun(clause) && !sentenceActorRef) {
        continue;
      }

      if (
        !sentenceActorRef
        || sentenceActorRef === input.authorizedHolderRef
        || isNegatedOrHypotheticalPhysicalAction(clause)
      ) {
        continue;
      }

      if (containsExplicitPhysicalObjectManipulation(clause, input.objectLabels)) {
        return {
          actorRef: sentenceActorRef,
          fragment: clause,
          level: "L2_DURABLE_ENTITY",
          predicate: "OBJECT_MANIPULATION"
        };
      }
    }
  }

  return null;
}

function explicitClauseSubject(
  clause: string,
  actors: readonly NarrativeActorAliases[]
) {
  const discoursePrefix =
    /^(?:(?:却|但|而|随后|随即|于是|这时|此时|当下|说罢|话毕|只见|待到|转身|抬手|伸手|又|便|遂|继而|然后)\s*)*/;
  const prefixLength = clause.match(discoursePrefix)?.[0].length || 0;
  const subjectSlice = clause.slice(prefixLength);
  const candidates = actors
    .flatMap((actor) =>
      actor.aliases.map((alias) => ({ actorRef: actor.actorRef, alias }))
    )
    .sort((left, right) => right.alias.length - left.alias.length);

  for (const candidate of candidates) {
    const match = subjectSlice.match(
      new RegExp(
        `^(?:(?:那名|这名|一旁的|站在[^，；。！？]{0,8}的)\\s*)?${escapeRegExp(candidate.alias)}(?:本人)?(?=$|[\\s的把将从向对给同与和朝看望问答说取拿接收递推送放搁打开启合盖扣写折])`
      )
    );
    if (match) {
      return {
        actorRef: candidate.actorRef,
        subjectEnd: prefixLength + match[0].length
      };
    }
  }
  return null;
}

function containsExplicitPhysicalObjectManipulation(
  clause: string,
  objectLabels: readonly string[]
) {
  const labels = objectLabels
    .filter(Boolean)
    .map(escapeRegExp)
    .sort((left, right) => right.length - left.length)
    .join("|");
  if (!labels) return false;

  const physicalVerb =
    "(?:搁下?|放下?|推(?:出|过|向|到)?|递(?:出|过|向|到)?|送(?:出|过|向|到)?|收起|拿起|取走|取过|拿过|接过|打开|开启|启开|合上|合拢|盖好|扣上)";
  const objectFirst = new RegExp(
    `(?:把|将)[^，；。！？]{0,10}(?:${labels})[^，；。！？]{0,12}${physicalVerb}`
  );
  const verbFirst = new RegExp(
    `${physicalVerb}[^，；。！？]{0,10}(?:${labels})`
  );
  const containerInsertion = new RegExp(
    `(?:放入|收入|纳入|装入|塞入)[^，；。！？]{0,10}(?:${labels}|匣中|匣内|盒中|盒内|箱中|箱内)`
  );
  const containerClosure = new RegExp(
    `(?:合上|合拢|盖好|扣上)(?:了)?(?:匣盖|盖子|盒盖|箱盖)`
  );

  return objectFirst.test(clause)
    || verbFirst.test(clause)
    || containerInsertion.test(clause)
    || containerClosure.test(clause);
}

function stripQuotedDialogue(text: string) {
  return text.replace(/[“"][^”"]*[”"]/g, (quoted) => " ".repeat(quoted.length));
}

function isOmittedSubjectContinuation(clause: string) {
  return /^(?:写毕|写罢|说毕|说罢|话毕|看罢|读罢|做完|办完|随后|随即|接着|继而|于是|便|遂|又|再|然后|转身|抬手|伸手|将|把|取|拿|接|收|递|推|送|放|搁|打开|开启|启开|合上|合拢|盖好|扣上)/.test(
    clause
  );
}

function startsWithUnresolvedPronoun(clause: string) {
  return /^(?:他|她|其|那人|此人)(?:便|又|遂|随即|随后|却|仍|再)?/.test(clause);
}

function isNegatedOrHypotheticalPhysicalAction(clause: string) {
  return /^(?:若|如果|假使|倘若|要是|一旦)|(?:没有|并未|未曾|不曾|不肯|不可|不能|不得|不许|不要|莫要|尚未)[^，；。！？]{0,12}(?:搁|放|推|递|送|收|拿|取|接|打开|开启|启开|合上|合拢|盖好|扣上)|(?:想要|打算|准备|意欲|欲要|将要|会再|可能)[^，；。！？]{0,12}(?:搁|放|推|递|送|收|拿|取|接|打开|开启|启开|合上|合拢|盖好|扣上)/.test(
    clause
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
