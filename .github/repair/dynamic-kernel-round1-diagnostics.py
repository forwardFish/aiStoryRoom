from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"replacement target missing: {path}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "apps/openovel-runtime/tests/sangtian-dynamic-kernel-production.spec.ts",
    '''    const resolution = freePrepared.audit.intentResolution
      as Record<string, unknown>;''',
    '''    const resolution = freePrepared.audit.intentResolution as Record<
      string,
      unknown
    >;''',
)

replace_once(
    "apps/openovel-runtime/tests/openovel-first.spec.ts",
    '''    assert.deepEqual(
      result.options.map((option) => option.id),
      [
        "DK-P1-EXECUTION-SCOPE-OPT-01",
        "DK-P1-EXECUTION-SCOPE-OPT-03",
      ],
    );''',
    '''    const routeOptionIds = result.options.map((option) => option.id);
    if (!routeOptionIds.includes("DK-P1-EXECUTION-SCOPE-OPT-01")) {
      const routeState = JSON.parse(await readFile(
        workspace.paths(runId).partOneState,
        "utf8",
      ));
      const routeEventLines = (await readFile(
        workspace.paths(runId).partOneEvents,
        "utf8",
      )).split(/\\r?\\n/u).filter(Boolean);
      const routeEvent = JSON.parse(routeEventLines.at(-1)!);
      const runtimePackage = JSON.parse(await readFile(
        path.join(
          projectRoot,
          "packages",
          "templates",
          "config",
          "sangtian",
          "story-package",
          "part-one-runtime.json",
        ),
        "utf8",
      ));
      const routeKernelIds = new Set([
        "DK-P1-EXECUTION-SCOPE",
        "DK-P1-RESPONSIBILITY-RECORD",
      ]);
      console.error("DYNAMIC_KERNEL_ROUTE_DIAGNOSTIC", JSON.stringify({
        resultOptions: result.options.map((option) => ({
          id: option.id,
          label: option.label,
          effect: option.effect,
        })),
        committedState: {
          sectionId: routeState.sectionId,
          turnNumber: routeState.turnNumber,
          sectionTurnNumber: routeState.sectionTurnNumber,
          completedKernelIds: routeState.completedKernelIds,
          reform: routeState.reform,
          review: routeState.review,
          responsibility: routeState.responsibility,
          pendingConsequences: routeState.pendingConsequences,
          causalArcStages: routeState.causalArcStages,
          scene: routeState.scene,
        },
        committedEvent: {
          eventId: routeEvent.eventId,
          decisionKernelId: routeEvent.decisionKernelId,
          affordanceTemplateId: routeEvent.affordanceTemplateId,
          changedStatePaths: routeEvent.changedStatePaths,
          statePatch: routeEvent.statePatch,
          createdPendingConsequenceIds: routeEvent.createdPendingConsequenceIds,
          duePendingConsequenceIds: routeEvent.duePendingConsequenceIds,
          nextDecisionPoint: routeEvent.nextDecisionPoint,
          nextKernelSelection: routeEvent.nextKernelSelection,
          sectionTransitioned: routeEvent.sectionTransitioned,
        },
        sectionContract: runtimePackage.sections.find(
          (section: { sectionId: string }) => section.sectionId === routeState.sectionId,
        ),
        requirements: runtimePackage.requirements.filter(
          (requirement: { decisionKernelIds?: string[] }) => (
            requirement.decisionKernelIds?.some((id) => routeKernelIds.has(id))
          ),
        ),
        kernels: runtimePackage.assets
          .filter((asset: { assetId: string }) => routeKernelIds.has(asset.assetId))
          .map((asset: {
            assetId: string;
            requirementIds: string[];
            causalArcIds: string[];
            stateDependencies: string[];
            actorRefs: string[];
            payload: Record<string, unknown>;
          }) => ({
            assetId: asset.assetId,
            requirementIds: asset.requirementIds,
            causalArcIds: asset.causalArcIds,
            stateDependencies: asset.stateDependencies,
            actorRefs: asset.actorRefs,
            options: asset.payload.options,
            continuationDecisions: asset.payload.continuationDecisions,
          })),
      }));
    }
    assert.deepEqual(
      routeOptionIds,
      [
        "DK-P1-EXECUTION-SCOPE-OPT-01",
        "DK-P1-EXECUTION-SCOPE-OPT-03",
      ],
    );''',
)

replace_once(
    "apps/openovel-runtime/tests/p07-authored-five-turn.spec.ts",
    '''      const result = await runtime.processAction({
        runId,
        action: submittedAction,
        submissionId,
        boundOption: submittedBoundOption,
      });''',
    '''      let result: TurnResult;
      try {
        result = await runtime.processAction({
          runId,
          action: submittedAction,
          submissionId,
          boundOption: submittedBoundOption,
        });
      } catch (error) {
        const paths = workspace.paths(runId);
        const state = await readFile(paths.partOneState, "utf8")
          .then((value) => JSON.parse(value))
          .catch(() => null);
        const eventLines = await readFile(paths.partOneEvents, "utf8")
          .then((value) => value.split(/\\r?\\n/u).filter(Boolean))
          .catch(() => [] as string[]);
        const lastCommittedEvent = eventLines.length
          ? JSON.parse(eventLines.at(-1)!)
          : null;
        const snapshot = await workspace.snapshot(runId).catch(() => null);
        console.error("P07_TRANSITION_DIAGNOSTIC", JSON.stringify({
          turnNumber: turn,
          selectedOption: selected,
          submittedAction,
          submittedBoundOption,
          sceneBefore: lastCommittedEvent?.sceneAfter || state?.scene || null,
          sceneAfter: lastCommittedEvent?.narrativePlan?.sceneEnd || null,
          transitionRequired: lastCommittedEvent?.sectionTransitioned
            ?? lastCommittedEvent?.narrativePlan?.transitionAllowed
            ?? null,
          authorizedActorArrivals:
            lastCommittedEvent?.narrativePlan?.authorizedActorArrivals || [],
          authorizedActorDepartures:
            lastCommittedEvent?.narrativePlan?.authorizedActorDepartures || [],
          lastCommittedEvent,
          nextDecisionPoint: lastCommittedEvent?.nextDecisionPoint || null,
          currentState: state,
          currentOptions: snapshot?.previousOptions || [],
          error: error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
        }));
        throw error;
      }''',
)

replace_once(
    "apps/openovel-runtime/src/scene-expression.ts",
    '''  if (!manifest.transition.transitionRequired && nonEmpty(draft.slots.SCENE_TRANSITION)) {
    throw new Error("SCENE_DRAFT_UNAUTHORIZED_TRANSITION");
  }''',
    '''  if (!manifest.transition.transitionRequired && nonEmpty(draft.slots.SCENE_TRANSITION)) {
    console.error("SCENE_DRAFT_UNAUTHORIZED_TRANSITION_DIAGNOSTIC", JSON.stringify({
      draftId: draft.draftId,
      owner: draft.owner,
      sceneTransition: draft.slots.SCENE_TRANSITION,
      transition: manifest.transition,
      transitionTickets: manifest.tickets.filter(
        (ticket) => ticket.slot === "SCENE_TRANSITION",
      ),
      requiredTickets: manifest.tickets
        .filter((ticket) => ticket.required)
        .map((ticket) => ({
          ticketId: ticket.ticketId,
          slot: ticket.slot,
          expressionOwner: ticket.expressionOwner,
          requiredMeaning: ticket.requiredMeaning,
          protectedText: ticket.protectedText,
        })),
    }));
    throw new Error("SCENE_DRAFT_UNAUTHORIZED_TRANSITION");
  }''',
)
