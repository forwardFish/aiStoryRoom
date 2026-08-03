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
};

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
  const sentences: string[] = [];
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
        sentences.push(`写成的${current.label}随即交由${input.actorLabel(current.holderRef)}持有。`);
      } else if (current.status === "WRITTEN") {
        sentences.push(`${current.label}已经写成。`);
      } else if (holderChanged && current.holderRef) {
        sentences.push(`${current.label}随即交由${input.actorLabel(current.holderRef)}持有。`);
      }
    } else {
      if (current.status === "WRITTEN" && current.holderRef) {
        sentences.push(`The completed ${current.label} passed into the custody of ${input.actorLabel(current.holderRef)}.`);
      } else if (current.status === "WRITTEN") {
        sentences.push(`The ${current.label} was completed.`);
      } else if (holderChanged && current.holderRef) {
        sentences.push(`The ${current.label} passed into the custody of ${input.actorLabel(current.holderRef)}.`);
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
        sentences.push(`${subject}将${documentLabel}收入${current.label}${close}。`);
      } else if (holderChanged && holder) {
        sentences.push(`${current.label}随即由${holder}持有。`);
      } else if (closureChanged && current.closureState === "CLOSED") {
        sentences.push(`${current.label}随即合拢。`);
      }
    } else {
      if (contentsChanged && current.contentsState === "CONTAINS_DOCUMENT") {
        const subject = holder || "The authorized handler";
        const documentLabel = oneChangedDocument ? "the document" : "the authorized documents";
        const close = current.closureState === "CLOSED"
          ? ` and closed ${current.label} again`
          : "";
        sentences.push(`${subject} placed ${documentLabel} inside ${current.label}${close}.`);
      } else if (holderChanged && holder) {
        sentences.push(`${holder} took custody of ${current.label}.`);
      } else if (closureChanged && current.closureState === "CLOSED") {
        sentences.push(`The ${current.label} was closed.`);
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
  if (sceneChanged || timeChanged || locationChanged) {
    sourceRefs.push("scene:identity");
    const time = String(input.after.timeLabel || "").trim();
    const location = String(input.after.locationLabel || "").trim();
    if (locale.startsWith("zh")) {
      const destination = [time, location].filter(Boolean).join("，");
      sentences.push(destination ? `议事转至${destination}。` : "议事转入下一处已定场景。");
    } else {
      const destination = [time, location].filter(Boolean).join(", ");
      sentences.push(destination ? `The scene moved to ${destination}.` : "The scene moved to the settled destination.");
    }
  }

  const previousActors = new Set(input.before.presentActorRefs || []);
  const arrivingActors = (input.after.presentActorRefs || [])
    .filter((actorRef) => !previousActors.has(actorRef));
  if (arrivingActors.length > 0) {
    sourceRefs.push(...arrivingActors.map((actorRef) => `scene:actor:${actorRef}:present`));
    const labels = arrivingActors.map(input.actorLabel);
    if (locale.startsWith("zh")) {
      sentences.push(`${joinChineseList(labels)}已经到场。`);
    } else {
      sentences.push(`${joinEnglishList(labels)} ${labels.length === 1 ? "was" : "were"} present.`);
    }
  }

  return {
    text: sentences.join(locale.startsWith("zh") ? "" : " "),
    sourceRefs: [...new Set(sourceRefs)],
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
