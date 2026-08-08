from pathlib import Path

path = Path("apps/openovel-runtime/tests/openovel-first.spec.ts")
text = path.read_text(encoding="utf-8")
old = '''    const authoredT02Delta = buildCausalDelta({
      turnId: "T02",
      action: limitedTrial.label,
      selectedOption: limitedTrial,
    });
    assert.equal(
      validateRequiredNarrativeFacts(
        String(provider.script.narrator[0] || ""),
        authoredT02Delta,
      ).some((warning) => warning.code === "MISSING_REQUIRED_DURABLE_RESULT"),
      true,
      "the old free-running narration is invalid because it omits the server-selected next beat",
    );
    const secondResult = await runtime.processAction({'''
new = '''    const publishedT02Delta = buildCausalDelta({
      turnId: "T02",
      action: limitedTrial.label,
      selectedOption: limitedTrial,
    });
    assert.equal(
      publishedT02Delta.beatContract,
      null,
      "the published next WorkingSet is a decision surface, not current-action causal authority",
    );
    const limitedTrialPrepared = await sangtianDecisionAdapter.prepare(
      workspace,
      {
        runId,
        turnNumber: 2,
        action: limitedTrial.label,
        selectedOption: limitedTrial,
      },
    );
    assert.ok(limitedTrialPrepared);
    assert.ok(limitedTrialPrepared.selectedOption);
    const settledT02Delta = buildCausalDelta({
      turnId: "T02",
      action: limitedTrial.label,
      selectedOption: limitedTrialPrepared.selectedOption,
    });
    assert.ok(settledT02Delta.beatContract);
    assert.equal(
      validateRequiredNarrativeFacts(
        String(provider.script.narrator[0] || ""),
        settledT02Delta,
      ).some((warning) => warning.code === "MISSING_REQUIRED_DURABLE_RESULT"),
      true,
      "the old free-running narration remains invalid against the settled current-action contract",
    );
    const secondResult = await runtime.processAction({'''
if old not in text:
    raise SystemExit("settlement-authority regression target missing")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
