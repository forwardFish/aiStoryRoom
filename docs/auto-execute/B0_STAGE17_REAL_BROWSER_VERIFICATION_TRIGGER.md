# B0 Stage 17 Real Browser Verification Trigger

- productParentSha: `31fa6d12f87b1d02c12bbd8512ff15347198269e`
- purpose: run every exact-SHA engineering gate and both acceptance tiers after promoting the artifact-verified real three-browser six-window driver, independent-worker boundary, and lease-crash recovery repair
- realBrowserContract: all human ActionContracts are previewed, confirmed, and readied through the existing `/game` DOM controls
- crashRecoveryContract: window 5 reaches B0 outbox quiescence before window 6 proves settlement lease expiry and recovery
- engineeringDatabase: official self-hosted `supabase/postgres` in a random isolated schema
- engineeringClassification: `PASS_ENGINEERING_ONLY`; never formal C8
- formalC8Database: real managed non-production Supabase in a random isolated schema
- formalC8Provider: real DeepSeek API
- formalC8MissingCredentialClassification: `EXTERNAL_BLOCKED`
- productionDataAccess: forbidden
- skipCi: false
