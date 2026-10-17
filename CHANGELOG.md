# Patch notes

Member-facing changes, grouped by verified production release. See [contribution rules](CONTRIBUTING.md#backlog-patch-notes-and-publishing) for maintenance and [the backlog](docs/backlog.json) for remaining work.

Earlier releases have not been reconstructed here. These entries do not assert that Discord patch notes were published.

## Unreleased

No member-facing changes queued. Developer tools and planning documentation do not imply a production feature release.

## 2026-10-16 - ec45641

Production deployment and live release assets verified. This update also summarizes the roster improvements deployed since the previous Discord announcement.

- Raid Teams now includes a buff and debuff coverage checklist for 10-, 20- and 40-player teams, with spell icons, descriptions and a detailed provider/source panel.
- Coverage distinguishes estimated results, talent-dependent possibilities and unknown party coverage. Game data is provisional or unverified, not a guarantee that buffs are active; in-game verification remains outstanding.
- Guild roster now has a Show Comments toggle: review Public comments, plus Leadership comments for Guild and Raid Leaders. Authors still edit comments on their dashboard. Read comment opens a floating panel without expanding the row.
- Roster rows now have class-colored stripes, shading and character names.

Sources: PRs #53, #54 and #57. MEMBER-004 is delivered; RAID-007's checklist is deployed, but game-data verification remains in progress. Mobile tooltip access and consistent dismissal on scroll remain planned November 4 improvements (UX-002 and UX-003).

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
