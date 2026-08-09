# B0 Stage 18 Runtime Workspace Evidence-Binding Verification Trigger

- productParentSha: `b79d543093ee04f881b9ee86a63fc0af319ab6e4`
- purpose: run every exact-SHA engineering gate and both acceptance tiers after binding OpenNovel publications and the acceptance proof reader to one random isolated workspace
- runtimeInvariant: child processes receive `OPENOVEL_WORKSPACE_ROOT` equal to the acceptance `OPENOVEL_RUNTIME_ROOT`
- evidenceInvariant: publication proof reads only `<isolated-root>/b0-narrative-jobs`
- regression: `acceptance binds runtime publication proof to its isolated OpenNovel workspace`
- engineeringDatabase: official self-hosted `supabase/postgres` in a random isolated schema
- engineeringClassification: `PASS_ENGINEERING_ONLY`; never formal C8
- formalC8Database: real managed non-production Supabase in a random isolated schema
- formalC8Provider: real DeepSeek API
- formalC8MissingCredentialClassification: `EXTERNAL_BLOCKED`
- productionDataAccess: forbidden
- skipCi: false
