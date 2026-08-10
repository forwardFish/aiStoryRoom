# Generic Endgame v3 — S0 Contract Evidence Source

This directory is committed evidence **source**, not a claim that later runtime stages are complete.

## Frozen baseline

```text
3771822db5dada5fc898c7c5b78cc0821a1e825b
```

## Formal contract files

```text
docs/Our_Many_Worlds_Generic_Endgame_MVP_配置驱动通用终局引擎_完整实现测试方案_v3.0.md
packages/shared/schemas/endgame/endgame-package-v1.schema.json
packages/shared/src/endgame/endgame-package-v1.contract.mjs
packages/shared/tests/generic-endgame-package-v1.s0.spec.mjs
packages/templates/config/endgame/examples/sangtian.endgame.example.json
packages/templates/config/endgame/examples/caesar.endgame.example.json
packages/templates/config/endgame/fixtures/neutral-synthetic.endgame.fixture.json
```

## Required clean-clone command

```bash
node --test packages/shared/tests/generic-endgame-package-v1.s0.spec.mjs
```

Expected frozen result:

```text
tests = 92
pass = 92
fail = 0
skipped = 0
todo = 0
exitCode = 0
```

The push-triggered workflow `.github/workflows/generic-endgame-s0.yml` performs an explicit remote clone of the exact commit SHA, validates local/tracking/ls-remote identity, runs the S0 contract suite plus shared typecheck/build, and uploads its logs as a GitHub Actions artifact.

## Scope statement

S0 contains no Generic Endgame runtime integration, no API integration, no Web integration, no database migration, no deployment, and no main/release changes.
