# B0 C0 Requirement Source Manifest

> Purpose: freeze the exact authoritative requirement source used for the B0 C0 audit.

- repository: `forwardFish/aiStoryRoom`
- branch: `codex/chatgpt-pro-maneuver-evidence-v1`
- baseMainSha: `e60dfd8fc9dda0459edbd37fe6be52ecd8dff1d6`
- startingCandidateSha: `d8b143186bb214fc578479102176a051e33c3bbd`
- requiredRepositoryPath: `docs/Our_Many_Worlds_B0同步结算多人博弈_完整实施开发测试与受控上线方案_v1.0.md`
- authoritativeSourceKind: `user-uploaded attachment`
- authoritativeTitle: `Our Many Worlds：B0 同步结算多人博弈完整实施、测试与受控上线方案 v1.0`
- lineCount: `3445`
- byteCount: `83438`
- sha256: `8c3e387462139bc8da07a80703ad259cd3683e756736e752572ed5dfa9af2702`
- expectedGitBlobSha: `540fd1a0d4b05c5dee23abf2327473d11a60d221`
- auditStatus: `fully read and used for C0 architecture, bypass, migration and baseline audit`

## Integrity rule

Every later B0 stage must use the requirement source whose SHA-256 is recorded above. A same-name document with a different digest is not an equivalent source and requires owner review before implementation continues.

## Connector limitation

The current GitHub connector accepts repository text supplied in the request but does not accept a local attachment path as file input. Therefore this C0 checkpoint records the exact cryptographic identity of the fully read attachment together with the complete architecture audit. The attachment bytes must be copied to the required repository path by an environment that supports local-file-to-GitHub upload before the final C9 candidate can be declared ready. This limitation does not authorize use of summaries or earlier maneuver documents as substitutes.
