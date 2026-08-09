# B0 Stage 17 Structured Result Carry-Forward Verification Trigger

- productParentSha: `0414bc888676c8145a69beb9e1408f75febf8afd`
- purpose: run every exact-SHA engineering gate and both acceptance tiers after preserving the most recent completed structured settlement in the newly opened synchronized planning window
- projectionInvariant: the current window's own `b0-commit-envelope-v1` always takes precedence
- carryForwardInvariant: an empty successor window may project only the newest completed B0 commit envelope from the same run
- privacyInvariant: carried results are re-projected through the existing typed publication plan for the requesting actor
- regression: `C7 current window keeps the just-completed structured settlement visible`
- engineeringDatabase: official self-hosted `supabase/postgres` in a random isolated schema
- engineeringClassification: `PASS_ENGINEERING_ONLY`; never formal C8
- formalC8Database: real managed non-production Supabase in a random isolated schema
- formalC8Provider: real DeepSeek API
- productionDataAccess: forbidden
- skipCi: false
