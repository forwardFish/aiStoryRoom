# B0 Stage 7 Verification Trigger

- productParentSha: `27cd2719f3f47433b9d8ca371abfb29a441f18ff`
- purpose: run all exact-SHA engineering gates and both acceptance tiers after authoritative initial RoleControl binding
- engineeringDatabase: official self-hosted `supabase/postgres` in a random isolated schema
- engineeringClassification: `PASS_ENGINEERING_ONLY`; never formal C8
- formalC8Database: real managed non-production Supabase in a random isolated schema
- formalC8Provider: real DeepSeek API
- productionDataAccess: forbidden
- skipCi: false
