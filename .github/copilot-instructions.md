# Intrepid Guild Raid Desk

- Before starting work, read [AGENTS.md](../AGENTS.md), the [canonical backlog](../docs/backlog.json) and the [shared work process](../CONTRIBUTING.md#shared-work-process). Use the backlog's permanent ID in issues and PRs; GitHub numbers, old lane labels and Discord posts are cross-references, not competing work lists. Check for existing claims/PRs and reconcile missing or conflicting scope with the maintainer before implementation. Update tracking with the change; a merge is not a verified release.
- This workspace is a React + TypeScript + Vite guild-loot app using Firebase Authentication and Cloud Firestore.
- Treat Firestore security rules as the authorization boundary; UI role checks only hide actions and impersonation must never grant backend access.
- Preserve immutable award snapshots of the candidate priority order and council note at decision time.
- Do not imply local browser data is shared; only authenticated Firestore data is shared with guild members.
- Run `npm run build` and `npm run lint` to validate changes.
- Only deploy to firebase when requested to limit the number of pushes to the hosting target.
- Follow [post-merge branch cleanup](../CONTRIBUTING.md#branch-cleanup-after-merge): the maintainer normally deletes remote feature branches after merging. Set **KEEP BRANCH: YES** prominently in the PR with reason, owner and dependencies when needed; contributors handle local cleanup. Assistants still need explicit approval for the exact branch before deleting it themselves and must verify no newer/ongoing work. Never bulk-delete or automatically force-delete.

- Read `AGENTS.md`, `ARCHITECTURE.md` and `CONTRIBUTING.md` before adding a feature: each tab lives in `src/features/<name>/`, is described by a `TabDefinition` in its `tab.tsx`, and is registered in `src/shell/tabs.ts`. Do not add feature code to `src/App.tsx`.
