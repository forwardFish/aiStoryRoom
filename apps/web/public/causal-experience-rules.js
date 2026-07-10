// AI 多人局 v4.1 体验规则校验
// 目的：防止 MVP 退化成 AI 小说 + 数值变化
window.CausalExperienceRules = {
  validateDecisionResult(result) {
    const required = [
      'decisionTitle',
      'personalEcho',
      'othersEcho',
      'worldEcho',
      'tracesLeft',
      'potentialRisks'
    ];
    return required.every((key) => result && result[key]);
  },
  validateRoleReaction(reaction) {
    return Boolean(
      reaction &&
      reaction.knownFacts &&
      reaction.privateReasoningSummary &&
      reaction.chosenAction &&
      reaction.surfaceReason &&
      reaction.hiddenIntent
    );
  },
  validateCausalRecall(recall) {
    return Boolean(
      recall &&
      recall.originEventIds &&
      recall.reframedBy &&
      recall.currentPressure
    );
  }
};
