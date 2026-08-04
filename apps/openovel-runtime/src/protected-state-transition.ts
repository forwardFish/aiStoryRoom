export type ProtectedDocumentState = {
  entityRef: string;
  label: string;
  status: string;
  holderRef?: string | null;
};

export type ProtectedObjectState = {
  entityRef: string;
  label: string;
  contentsState?: string | null;
  closureState?: string | null;
  holderRef?: string | null;
};

export type ProtectedSceneState = {
  sceneRef?: string;
  timeLabel?: string;
  locationLabel?: string;
  presentActorRefs?: string[];
  documents: ProtectedDocumentState[];
  objects: ProtectedObjectState[];
};

export type ProtectedTransitionNarrative = {
  text: string;
  sourceRefs: string[];
  entityText?: string;
  sceneText?: string;
};

/**
 * Project the typed scene snapshot into durable predicates that are already
 * true when Narrator continuation begins. These predicates authorize factual
 * restatement only; they do not authorize a new transition.
 */
export function compileEstablishedScenePredicates(
  scene: ProtectedSceneState,
): DurablePredicate[] {
  const locationId = scene.sceneRef ? `location:${scene.sceneRef}` : "";
  const predicates: DurablePredicate[] = [];
  if (locationId) {
    for (const actorId of scene.presentActorRefs || []) {
      predicates.push({ type: "ENTITY.LOCATED_AT", entityId: actorId, locationId });
    }
  }
  for (const document of scene.documents) {
    predicates.push({
      type: "ENTITY.STATE",
      entityId: document.entityRef,
      attribute: "status",
      value: document.status,
    });
    if (document.status === "WRITTEN") {
      predicates.push({ type: "DOCUMENT.CREATED", documentId: document.entityRef });
    }
    if (document.holderRef) {
      predicates.push({
        type: "ENTITY.HELD_BY",
        entityId: document.entityRef,
        actorId: document.holderRef,
      });
    }
  }
  for (const object of scene.objects) {
    if (object.contentsState !== undefined) {
      predicates.push({
        type: "ENTITY.STATE",
        entityId: object.entityRef,
        attribute: "contentsState",
        value: object.contentsState ?? null,
      });
    }
    if (object.closureState !== undefined) {
      predicates.push({
        type: "ENTITY.STATE",
        entityId: object.entityRef,
        attribute: "closureState",
        value: object.closureState ?? null,
      });
    }
    if (object.holderRef) {
      predicates.push({
        type: "ENTITY.HELD_BY",
        entityId: object.entityRef,
        actorId: object.holderRef,
      });
    }
  }
  return [...new Map(predicates.map((predicate) => [JSON.stringify(predicate), predicate])).values()];
}

/**
 * Prefer a package-authored, player-facing beat whenever one exists. The
 * typed compiler still contributes its source refs so the atomic evidence can
 * prove which state transitions the block protects, but its deliberately
 * mechanical prose is only a fallback for worlds that did not author a
 * natural surface. This is structural precedence, not prose matching.
 */
export function selectProtectedTransitionSurface(input: {
  authoredText?: string | null;
  compiled: ProtectedTransitionNarrative;
  authoredCoversSceneTransition?: boolean;
}): ProtectedTransitionNarrative {
  const authoredText = String(input.authoredText || "").trim();
  const sceneText = input.authoredCoversSceneTransition
    ? ""
    : String(input.compiled.sceneText || "").trim();
  const text = authoredText
    ? [authoredText, sceneText].filter(Boolean).join("\n\n")
    : input.compiled.text;
  return {
    text,
    sourceRefs: [...new Set(input.compiled.sourceRefs)],
    ...(input.compiled.entityText ? { entityText: input.compiled.entityText } : {}),
    ...(input.compiled.sceneText ? { sceneText: input.compiled.sceneText } : {}),
  };
}

/**
 * Compile consequential scene-state transitions into trusted prose before the
 * Narrator runs. Natural-language validation is deliberately absent: the
 * compiler compares stable entity references and typed before/after fields.
 */
export function compileProtectedSceneTransition(input: {
  before: ProtectedSceneState;
  after: ProtectedSceneState;
  actorLabel: (actorRef: string) => string;
  locale?: string;
}): ProtectedTransitionNarrative {
  const locale = String(input.locale || "zh-CN").toLowerCase();
  const beforeDocuments = new Map(input.before.documents.map((item) => [item.entityRef, item]));
  const beforeObjects = new Map(input.before.objects.map((item) => [item.entityRef, item]));
  const sourceRefs: string[] = [];
  const entitySentences: string[] = [];
  const sceneSentences: string[] = [];
  const changedDocuments: ProtectedDocumentState[] = [];

  for (const current of input.after.documents) {
    const previous = beforeDocuments.get(current.entityRef);
    const statusChanged = previous?.status !== current.status;
    const holderChanged = (previous?.holderRef || null) !== (current.holderRef || null);
    if (!statusChanged && !holderChanged) continue;
    changedDocuments.push(current);
    if (statusChanged) sourceRefs.push(`document:${current.entityRef}:status`);
    if (holderChanged) sourceRefs.push(`document:${current.entityRef}:holder`);

    if (locale.startsWith("zh")) {
      if (current.status === "WRITTEN" && current.holderRef) {
        entitySentences.push(`写成的${current.label}随即交由${input.actorLabel(current.holderRef)}持有。`);
      } else if (current.status === "WRITTEN") {
        entitySentences.push(`${current.label}已经写成。`);
      } else if (holderChanged && current.holderRef) {
        entitySentences.push(`${current.label}随即交由${input.actorLabel(current.holderRef)}持有。`);
      }
    } else {
      if (current.status === "WRITTEN" && current.holderRef) {
        entitySentences.push(`The completed ${current.label} passed into the custody of ${input.actorLabel(current.holderRef)}.`);
      } else if (current.status === "WRITTEN") {
        entitySentences.push(`The ${current.label} was completed.`);
      } else if (holderChanged && current.holderRef) {
        entitySentences.push(`The ${current.label} passed into the custody of ${input.actorLabel(current.holderRef)}.`);
      }
    }
  }

  for (const current of input.after.objects) {
    const previous = beforeObjects.get(current.entityRef);
    const contentsChanged = (previous?.contentsState || null) !== (current.contentsState || null);
    const closureChanged = (previous?.closureState || null) !== (current.closureState || null);
    const holderChanged = (previous?.holderRef || null) !== (current.holderRef || null);
    if (!contentsChanged && !closureChanged && !holderChanged) continue;
    if (contentsChanged) sourceRefs.push(`object:${current.entityRef}:contents`);
    if (closureChanged || (contentsChanged && current.closureState === "CLOSED")) {
      sourceRefs.push(`object:${current.entityRef}:closure`);
    }
    if (holderChanged) sourceRefs.push(`object:${current.entityRef}:holder`);

    const holder = current.holderRef ? input.actorLabel(current.holderRef) : "";
    const oneChangedDocument = changedDocuments.length === 1;
    if (locale.startsWith("zh")) {
      if (contentsChanged && current.contentsState === "CONTAINS_DOCUMENT") {
        const subject = holder || "在场经手人";
        const documentLabel = oneChangedDocument ? "这份文书" : "获批文书";
        const close = current.closureState === "CLOSED"
          ? `，并将${current.label}重新合拢`
          : "";
        entitySentences.push(`${subject}将${documentLabel}收入${current.label}${close}。`);
      } else if (holderChanged && holder) {
        entitySentences.push(`${current.label}随即由${holder}持有。`);
      } else if (closureChanged && current.closureState === "CLOSED") {
        entitySentences.push(`${current.label}随即合拢。`);
      }
    } else {
      if (contentsChanged && current.contentsState === "CONTAINS_DOCUMENT") {
        const subject = holder || "The authorized handler";
        const documentLabel = oneChangedDocument ? "the document" : "the authorized documents";
        const close = current.closureState === "CLOSED"
          ? ` and closed ${current.label} again`
          : "";
        entitySentences.push(`${subject} placed ${documentLabel} inside ${current.label}${close}.`);
      } else if (holderChanged && holder) {
        entitySentences.push(`${holder} took custody of ${current.label}.`);
      } else if (closureChanged && current.closureState === "CLOSED") {
        entitySentences.push(`The ${current.label} was closed.`);
      }
    }
  }

  const sceneChanged = Boolean(
    input.after.sceneRef
    && input.before.sceneRef !== input.after.sceneRef,
  );
  const timeChanged = Boolean(
    input.after.timeLabel
    && input.before.timeLabel !== input.after.timeLabel,
  );
  const locationChanged = Boolean(
    input.after.locationLabel
    && input.before.locationLabel !== input.after.locationLabel,
  );
  const sceneTransitioned = sceneChanged || timeChanged || locationChanged;
  const previousActors = new Set(input.before.presentActorRefs || []);
  const arrivingActors = (input.after.presentActorRefs || [])
    .filter((actorRef) => !previousActors.has(actorRef));
  const arrivingLabels = arrivingActors.map(input.actorLabel);

  if (sceneTransitioned) {
    sourceRefs.push("scene:identity");
    const time = String(input.after.timeLabel || "").trim();
    const location = String(input.after.locationLabel || "").trim();
    if (locale.startsWith("zh")) {
      if (time && location && arrivingLabels.length) {
        sceneSentences.push(`到了${time}，${joinChineseList(arrivingLabels)}已经在${location}候着。`);
      } else if (time && location) {
        sceneSentences.push(`到了${time}，事情已在${location}继续。`);
      } else {
        const destination = [time, location].filter(Boolean).join("，");
        sceneSentences.push(destination ? `到了${destination}。` : "事情已在下一处既定场景继续。");
      }
    } else if (time && location && arrivingLabels.length) {
      sceneSentences.push(`By ${time}, ${joinEnglishList(arrivingLabels)} ${arrivingLabels.length === 1 ? "was" : "were"} waiting in ${location}.`);
    } else if (time && location) {
      sceneSentences.push(`By ${time}, events had continued in ${location}.`);
    } else {
      const destination = [time, location].filter(Boolean).join(", ");
      sceneSentences.push(destination ? `By ${destination}, events had moved on.` : "Events had continued in the settled scene.");
    }
  } else if (arrivingActors.length > 0) {
    if (locale.startsWith("zh")) {
      sceneSentences.push(`${joinChineseList(arrivingLabels)}已经到场。`);
    } else {
      sceneSentences.push(`${joinEnglishList(arrivingLabels)} ${arrivingLabels.length === 1 ? "was" : "were"} present.`);
    }
  }
  if (arrivingActors.length > 0) {
    sourceRefs.push(...arrivingActors.map((actorRef) => `scene:actor:${actorRef}:present`));
  }

  const separator = locale.startsWith("zh") ? "" : " ";
  const entityText = entitySentences.join(separator);
  const sceneText = sceneSentences.join(separator);
  return {
    text: [entityText, sceneText].filter(Boolean).join(separator),
    sourceRefs: [...new Set(sourceRefs)],
    ...(entityText ? { entityText } : {}),
    ...(sceneText ? { sceneText } : {}),
  };
}

function joinChineseList(values: string[]) {
  if (values.length < 2) return values[0] || "获批人物";
  return `${values.slice(0, -1).join("、")}和${values.at(-1)}`;
}

function joinEnglishList(values: string[]) {
  if (values.length < 2) return values[0] || "The authorized character";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}
import type { DurablePredicate } from "@ai-story/templates";
