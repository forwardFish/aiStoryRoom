# Project Rules for AI Agents

These rules are mandatory for every Codex task, agent, sub-agent, automation,
and human-assisted workflow operating in this repository. The repository
owner's explicit instruction in the current conversation may override them.

## Branch Policy (Mandatory)

1. **All normal development happens directly on `main`.**
   - Before editing files, verify that the current branch is `main`.
   - Do not create a feature, fix, task, temporary, `codex/*`, or similarly
     named development branch as a routine precaution.
   - Do not switch development to a detached HEAD or a separate development
     worktree to avoid this rule.

2. **Creating any other development branch requires advance approval from the
   repository owner.**
   - If conflicts, concurrent Codex tasks, permissions, tooling, or worktree
     state make safe development on `main` impossible, stop before creating or
     switching branches.
   - Immediately tell the owner what is conflicting, why `main` cannot be used,
     what work is at risk, and the exact proposed branch/worktree name.
   - Wait for the owner's explicit approval. Approval is specific to that
     branch and situation; never treat earlier approval as permanent.
   - Never create the branch first and ask for approval afterward.

3. **Concurrent-task conflicts must be surfaced, not hidden.**
   - Assume multiple Codex tasks may share this checkout at the same time.
   - Inspect the current branch and working tree before editing.
   - Preserve changes owned by other tasks. Do not overwrite, reset, discard,
     or silently incorporate them.
   - If edits overlap or ownership is unclear, pause the conflicting work and
     notify the owner before proceeding.

4. **`release` is deployment-only.**
   - Do not perform feature development or ordinary fixes directly on
     `release`.
   - `main` is the development source of truth.
   - Promote only reviewed and verified commits from `main` to `release` for an
     authorized production release.
   - Do not use `release` as a conflict-resolution or temporary development
     branch.

5. **Verification clones are not development branches.**
   - A disposable clone may be used only to test the exact `main` commit in a
     clean environment.
   - Do not author changes or create commits there. If a fix is needed, return
     to `main`; if that is unsafe, follow the approval process above.

## Owner's Rule (Chinese Summary)

- 默认且正常的开发全部在 `main` 分支进行。
- 因冲突或并发任务导致无法安全地在 `main` 开发时，必须立刻通知项目所有者；说明冲突原因、风险和拟创建的分支名称，并在获得明确批准后才能创建其他分支或开发 worktree。
- 禁止先创建其他分支，再补问批准。
- `release` 分支只用于把已经审查、验证通过的 `main` 提交上线发布，不用于日常开发或临时解决冲突。
- 多个 Codex 任务并发时，不得覆盖、丢弃或擅自合并其他任务的未提交改动；无法确认归属时必须暂停并通知项目所有者。
