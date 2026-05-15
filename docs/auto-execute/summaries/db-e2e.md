# DB E2E
Generated: 05/13/2026 21:22:05
Mode: full


- Status: DOCUMENTED_BLOCKER
- Error: docker ps failed; Docker daemon is not available
- Recovery: Start Docker Desktop, ensure ports 5432/6379 are free, then run powershell -ExecutionPolicy Bypass -File .\scripts\acceptance\run-db-e2e.ps1 -Mode full
