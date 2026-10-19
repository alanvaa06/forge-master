# Memory

> Architecture decisions. One line each. Format: `# decision: sentence`. Cap enforced by hook.

# containment: forge subagent limits live in plugin hooks/hooks.json keyed on agent_type (plugin agents ignore frontmatter hooks/permissionMode)
# evidence: done requires verify=pass:<tree> equal to the HEAD tree minus docs/forge and docs/context; --force --reason is the only escape
# lifecycle: run lock and finished marker live in <git-common-dir>/forge/; finished is also a committed [meta] state line
# reconcile: counts only `P<n>: <exact phase name>` subjects, because merged earlier plans reuse P<n> ids
# parallel: worktree verify uses the run-root state (--state); integration squash-merges and commits P<n> only after run-branch verify
