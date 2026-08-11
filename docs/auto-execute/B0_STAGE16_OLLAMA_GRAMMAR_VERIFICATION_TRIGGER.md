# B0 Stage 16 Ollama Grammar Transport Verification Trigger

- productParentSha: `85d7306e4bcb40dfddcd3539886607b5ae133fea`
- purpose: run every exact-SHA engineering gate and both acceptance tiers after falling back from unsupported oversized Ollama JSON-Schema grammar repetition to JSON Object transport
- transportInvariant: ordinary loopback schemas remain `json_schema`; only grammar-unsafe schemas use `json_object`
- semanticInvariant: the authoritative B0 prose validator still enforces 20 to 6,000 characters and no fallback provider is allowed
- regression: `loopback providers use JSON Object mode when schema repetition exceeds the grammar limit`
- engineeringDatabase: official self-hosted `supabase/postgres` in a random isolated schema
- engineeringClassification: `PASS_ENGINEERING_ONLY`; never formal C8
- formalC8Database: real managed non-production Supabase in a random isolated schema
- formalC8Provider: real DeepSeek API
- productionDataAccess: forbidden
- skipCi: false
