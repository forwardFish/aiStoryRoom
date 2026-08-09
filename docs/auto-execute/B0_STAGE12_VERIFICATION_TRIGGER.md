# B0 Stage 12 Verification Trigger

- productParentSha: `d52c24044ed7383bf0852b4726c3adc79c730d4a`
- purpose: run every exact-SHA engineering gate and both acceptance tiers after making the expired-deadline acceptance fixture satisfy the authoritative ActionWindow time-order constraint
- engineeringDatabase: official self-hosted `supabase/postgres` in a random isolated schema
- engineeringClassification: `PASS_ENGINEERING_ONLY`; never formal C8
- formalC8Database: real managed non-production Supabase in a random isolated schema
- formalC8Provider: real DeepSeek API
- productionDataAccess: forbidden
- skipCi: false
