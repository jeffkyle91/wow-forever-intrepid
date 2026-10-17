# Patch notes

Member-facing changes, grouped by verified production release. See [contribution rules](CONTRIBUTING.md#backlog-patch-notes-and-publishing) for maintenance and [the backlog](docs/backlog.json) for remaining work.

## Unreleased

No member-facing changes queued. Developer tools and planning documentation do not imply a production feature release.

## 2026-10-16 - bbefbc2

Production deployment verified and confirmed by the maintainer.

- Dashboard raid actions now show your saved response, with matching response colors and a compact centered layout.
- Sign-up actions stay in a consistent location relative to unavailable/cancelled badges.
- A divider separates raid instructions from the last sign-up action.

Source: PR #49. This predates backlog IDs; no IDs were invented retroactively.

## 2026-10-16 - 9d609e3

Production deployment verified and confirmed by the maintainer.

- Unavailable dates force Absent and prevent response changes until all covering events are removed. Removing those events retains Absent until you choose another response.
- Fixed raid saves incorrectly rejecting unchanged selected zones because of field ordering.
- Loot priorities now track repeated candidate listings one receipt at a time, show received/completed progress, and offer encounter, player, class and completion filters.

Sources: PRs #46 and #47. This predates backlog IDs. Automatic starting roster snapshots are not included.

Earlier releases have not been reconstructed here. These entries do not assert that Discord patch notes were published.
