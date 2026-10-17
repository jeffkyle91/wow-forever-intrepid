# Patch notes

Member-facing changes, grouped by verified production release. See [contribution rules](CONTRIBUTING.md#backlog-patch-notes-and-publishing) for maintenance and [the backlog](docs/backlog.json) for remaining work.

Earlier releases have not been reconstructed here. These entries do not assert that Discord patch notes were published.

## Unreleased

- Members can submit and withdraw character-change requests on My dashboard, including new or existing alts, renames, class/spec changes and alt-to-main promotion. Guild Leaders review requests and optional notes in Member access. Approval preserves character IDs, team assignments and historical snapshots; spec changes apply the default raid role. Request history is private to the requester and Guild Leaders. Pending merge and Functions/rules/Hosting deployment (MEMBER-002).
- Character requests use class-colored character cards and specialization icons, defined current/requested sections, highlighted field changes and separate member-note and leader-review areas in light and dark themes (MEMBER-002).
- Character-request lists identify the member by their main character, with the affected character shown underneath, including requests for new alts (MEMBER-002).
- Guild Leaders can remove and restore guild access with confirmation. Removal unlinks the account and blocks guild access without deleting characters or history; restoration grants unlinked Member access. Removed accounts see a dedicated no-access screen. Pending merge and rules/Hosting deployment.
- Right-aligned the My dashboard raider-type, help and attendance controls on mobile, including when they wrap.
- Fixed raid edits with ten selected zones being rejected by Firestore's rule-expression limit, while preserving complete zone validation and truthful, atomic audit entries. Pending merge and rules deployment.
- Loot priorities has a new Browse drops button: pick a dungeon to see which creature drops which item, with each item's name, icon and full tooltip read live from Wowhead. Point at an item with a mouse, or tap or select it, to read its tooltip. The nine dungeons are practice data for the beta; leaders cannot edit them in the app yet (LOOT-007, LOOT-008).
- Guild and Raid Leaders can now build the loot list from Browse drops: a ticked item is on the priority list. Tick the items (or all of a creature's items) to add them, or use Add all for a whole dungeon, and untick an item that is on the list (or use Remove all) to take it off; the bar at the bottom applies the changes, and asks once more if a removal would lose assigned players. Each added item shows on Loot priorities with its real name, icon and tooltip, marked Needs players, with an Assign players button. An item can be on the list only once (LOOT-009).
- Loot priorities is now grouped by dungeon and then by boss, in the order the bosses are met, with a count on each heading. Switch to One list for the plain list. Priorities typed by hand are grouped too, by their "dungeon · boss" text (LOOT-009).
- Loot priorities can now be filtered by item slot (Head, Chest, 1H Weapon, Trinket and so on, with Other for bags and recipes) and by dungeon or a single boss: the encounter list shows each dungeon with its bosses beneath it. The class filter and the Needs players button are gone; an item with no players still shows Needs players on its row (LOOT-009).

## 2026-10-16 - f42a14d

Production deployments through f42a14d and live release assets verified. This summarizes changes since the ec45641 Discord announcement.

- Guild roster now supports sorting by name, class, role or team, in either direction. Keep alts under their mains or mix them into the sorted list. Sort choices last for the browser session.
- Raid Teams has All characters / Hide alts for the available roster and Add from guild roster lists. Assigned alts remain visible; assignments, assigned counts and buff/debuff coverage are unchanged.
- Class-colored character styling now extends to Raid Teams, loot candidate and recipient names, dashboard characters, Member Access and sign-up team previews.

- Dashboard Casual/Hardcore descriptions now have a separate tap-accessible help button; reading help does not change your selection. Tap the attendance chip for its explanation.
- Roster comment panels and coverage details use shared tap/click/keyboard-accessible popovers. Coverage spell details now open by explicit activation rather than hover.
- Help panels close on outside interaction, Escape, focus leaving, navigation, surrounding page/table scrolling and viewport changes. Long panel content remains scrollable without changing roster row heights.
- Fixed sideways scrolling into blank space on mobile, and prevented narrow header text from pushing account controls off-screen. Wide tables and the mobile tab bar still scroll independently.

Sources: PRs #58-#65, #68 and #70. RAID-009 is delivered. UX-002/UX-003 have deployed improvements; physical-device checks and the broader mobile workflow pass remain open. RAID-007 game-data verification is still outstanding.

Developer progress, not new live app functionality: PRs #67/#69 add validated practice loot captures for nine dungeons; loot-table selection/import UI is not delivered. The on-request two-channel Discord publisher (PRs #51/#52) has been adopted and verified with live posting and editing; it is not a raid bot.

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
