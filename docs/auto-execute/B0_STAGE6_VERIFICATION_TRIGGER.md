# B0 Stage 6 Verification Trigger

- productParentSha: `11cd95b1ecf77c8118af8998ab90b47cacf99c00`
- purpose: run every exact-SHA engineering gate and both acceptance tiers after the concurrent `ActionWindow.nodeId` initialization repair
- selfHostedClassification: `PASS_ENGINEERING_ONLY` when successful; never formal C8
- formalC8Requirement: real managed non-production Supabase random schema and real DeepSeek provider
- productionDataAccess: forbidden
- skipCi: false
