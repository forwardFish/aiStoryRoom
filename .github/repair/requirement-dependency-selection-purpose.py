# The current baseline already separates the current reaction plan from the
# finalized next-turn plan in dynamic-kernel-lite-settlement.ts. The original
# migration targeted an older reactionWorkingSet variable shape and is not
# applicable here. Deterministic preflight decides whether the explicit
# SettledReactionContract extension is required.
print("selection purpose migration not required for current baseline")
