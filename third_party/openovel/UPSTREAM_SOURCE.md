# OpenNovel upstream source

- Repository: https://github.com/Feed-Scription/openovel
- Pinned commit: `1b4404e85d03d1e41e5d745e303372333b29c610`
- License: Apache License 2.0
- Snapshot date: 2026-07-27

This directory records the exact upstream revision used by the
`apps/openovel-runtime` adaptation. Only the small source files needed to
compare the context-capsule and post-narration registration behavior are
vendored here. The TypeScript implementation under `apps/openovel-runtime`
contains explicit modification notices and does not copy Electron, media,
export, desktop-library, or packaging modules.
