# Acceptance Checklist

- [x] M00 baseline SHA/status/archive/scan/branch evidence
- [x] M01 contracts, schemas, adapter routing
- [ ] M02 stable Solo OpenNovel dependency and existing V2 regression. Multiplayer
      does not change Solo publication; final M02 waits for the owner's stable
      Solo chain to be integrated into the frozen shared interface.
- [x] M03 three isolated role workspaces, locks, recovery
- [x] M04 one world sequence and unique resolution
- [x] M05 zero role-knowledge leakage
- [x] M06 interaction and character-protection rules
- [x] M07 triggered AI, epoch, batch, candidate-only safety
- [x] M08 provider-call budgets
- [x] M09 concurrency, idempotency, lease, outbox recovery. Current-head
      single-SQL evidence is in `openovel-db-concurrency-20260803-150641` and
      `openovel-db-fault-20260803-151236`: parallel roles commit exact sequences
      `1,2`; same-turn double submit writes one record set; contested asset
      failure leaves no sequence gap; expired leases write nothing; a replacement
      worker commits once; pre-commit terminal failure opens a replacement turn
      without changing the world; runtime-before-DB crash recovery remains
      exactly-once and identity conflicts fail closed.
- [ ] M10 fresh 10-15 event three-role E2E after the epoch-scoped Agent task
      identity, immutable disconnect Standing Policy snapshot, heartbeat, and
      reclaim-fencing changes. `openovel-db-three-role-20260803-151654` remains
      valid historical evidence for the earlier single-SQL architecture, but it
      is not a PASS for the current source. The newest attempt stopped before
      room creation with remote PostgreSQL `P1001`; one final lightweight
      connectivity check is permitted before this route must stop.
- [x] Failure-loop policy: one failure signature is verified no more than three
      times; each attempt has a distinct hypothesis and new evidence; a third
      failure stops the path and records the invalid underlying assumption
      before repair and any later retest.
- [ ] M11 three-origin visible browser/player-quality evidence plus owner-participated three-role acceptance and explicit sign-off
- [ ] M12 full rerun, code review, evidence integrity, SHA parity
- [x] Performance section 25.1 world-resolution SLA and 100-concurrency
      correctness. The replacement single-SQL atomic world-commit path passed
      at `openovel-db-performance-20260803-150756`: 60 provider-excluded formal
      commits had min `90.12ms`, p50 `106.42ms`, p95 `283.82ms`, and max
      `313.60ms` against the `<1000ms` limit. The separate 100-concurrent
      correctness stress committed 100/100 immutable entries across 34
      three-role room shapes with exact per-room `1..N` sequences and no
      duplicates or holes. SSE establishment latency is verified separately by
      the transport evidence below rather than inferred from world-commit time.
- [x] SSE section 25.1 transport and reconnect. Real authenticated HTTP evidence
      at `openovel-db-transport-20260803-152651` opens 60 first frames with min
      `437.57ms`, p50 `440.62ms`, p95 `448.37ms`, and max `531.65ms` against
      `<1000ms`; reconnecting after delivery sequence 1 duplicates zero events,
      and a non-member event feed is rejected with 403. Current Web transport
      tests pass backfill, safe-cursor application, writing-time deferral, and
      polling recovery after SSE failure.

Pure PASS requires every item. Mock evidence is labeled mock; live-model evidence is separate.

M11 is not complete from automation alone. After code and automated gates pass, the repository owner participates through three independent browser sessions as governor, xunfu, and magistrate. The guided journey must include real choices/free input, an interaction request and reply, offline/AI takeover/reclaim, distinct role Canon, cross-impact visibility, and a privacy check. Final acceptance requires the owner's explicit sign-off.

M11 must run on the actual existing `/game` page. A newly added page, an altered test-only page, inline fixture HTML, or an injected parallel main-game panel is disallowed as acceptance evidence.
