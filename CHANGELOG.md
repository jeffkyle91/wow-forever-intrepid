# Patch notes

Member-facing changes, grouped by verified production release. See [contribution rules](CONTRIBUTING.md#backlog-patch-notes-and-publishing) for maintenance and [the backlog](docs/backlog.json) for remaining work.

Earlier releases have not been reconstructed here. These entries do not assert that Discord patch notes were published.

## Unreleased

- Loot priorities: the pencil on each priority is now a labelled Edit Prio button, and a priority without a council note says to use Edit Prio to add one.
- Loot priorities: a candidate who has received the item is faded instead of crossed out, keeping the class color and stripe and the green Received tag, so the name stays easy to read.
- Drop list editor: the "Creature number" field is now "Creature ID", with a line saying where to find it (the number after npc= in the creature's Wowhead address).
- Loot priorities: candidates are picked from the roster instead of typed. Search it, order it by class (with the class colors) or by name, tick several characters and add them at once, move them up and down or take them off. A priority can also hold a note line for something that is not a person, for example "Any warlock who didn't get the Test Staff last phase"; it can be reworded and marked finished (crossed off).
- Loot priorities: recording an award through a note puts the winner on the list where the note was and moves the note down, so the list shows who has received it and the note stays for the next one. The award dialog offers the people on the list and, under each open note, the rest of the roster.
- Characters keep their loot when renamed: priorities, completion, the filters, the Log's player filter and My dashboard follow the character, while award rows and Log lines keep the name they were written with. An older priority is converted to roster characters the next time a leader edits it (a name the roster does not have stays as a note).
- My dashboard shows the priorities and awards of every phase up to the current one, the latest first, with a received mark and the phase for earlier ones.

## 2026-10-17 - 92dbc71

Production deployments through 92dbc71 and matching live HTML/assets verified. This summarizes changes since the f42a14d announcement. Refresh open tabs before using the updated loot workflow.

- Members can submit and withdraw private character-change requests on My dashboard: new/existing alt links, renames, class/spec changes and main promotion. Guild Leaders review with optional notes in Member access. Approval preserves character IDs, teams and historical snapshots; spec changes apply the default raid role. Decisions appear in resolved request history, without automatic notifications (MEMBER-002).
- Character requests use class-colored character cards and specialization icons, defined current/requested sections, highlighted field changes and separate member-note and leader-review areas in light and dark themes (MEMBER-002).
- Character-request lists identify the member by their main character, with the affected character shown underneath, including requests for new alts (MEMBER-002).

- Guild Leaders can remove and restore guild access with confirmation. Removal unlinks and blocks the account without deleting characters or history; restoration grants unlinked Member access. Removed accounts see a dedicated no-access screen (MEMBER-001).
- Right-aligned the My dashboard raider-type, help and attendance controls on mobile, including when they wrap.
- Fixed ten-zone raid edits being rejected by Firestore's expression limit while preserving complete zone validation and truthful, atomic audit entries (RAID-008).

- **Browse drops** shows dungeon/creature drops with item names, icons and full tooltips from Wowhead, accessible by mouse, tap or selection. Bundled dungeon lists remain beta practice data, not a verified Forever database (LOOT-007).
- Guild and Raid Leaders build priorities by ticking items in Browse drops, including a creature's drops or a whole dungeon. New items show **Needs players** and **Assign players**. Candidates are still typed; stable roster selection remains planned. Each item is listed once per phase (LOOT-009).
- Loot priorities is now grouped by dungeon and then by boss, in the order the bosses are met, with a count on each heading. Switch to One list for the plain list. Priorities typed by hand are grouped too, by their "dungeon · boss" text (LOOT-009).

- Loot priorities can now be filtered by item slot (Head, Chest, 1H Weapon, Trinket and so on, with Other for bags and recipes) and by dungeon or a single boss: the encounter list shows each dungeon with its bosses beneath it. The class filter and the Needs players button are gone; an item with no players still shows Needs players on its row (LOOT-009).
- A **Phase** selector opens current priorities and read-only earlier lists. Leaders can prepare next-phase lists; awards wait until that phase starts. Dashboard counts and received marks follow the phase, and older records belong to the first phase. Guild Leaders start phases from **Settings > Loot phases** with typed confirmation, or reopen the previous phase when eligible.

- **Log** replaces Award history and is readable by all members. It shows awards (including legacy records), priority and phase changes, actors and before/after details, with search, player/slot/encounter filters and sort order. Priority/award writes and phase changes require truthful, atomic audit entries; entries cannot be edited or deleted. The old local-data import is removed (LOOT-001).
- Loot priorities has a **Carry over** button for leaders. Pick an earlier phase and tick the items to bring into the phase you are looking at (the current one, or the next one you are preparing). Each becomes a new priority with the same item, boss, note and the whole candidate list: players who already got it show as received, and the ones who still need it stay on it. The earlier phase is not changed, and each carried item is in the Change log. An item already on the list cannot be carried twice.

- Loot priorities no longer has an **Add priority** button: new items are added by ticking them in **Browse drops** (or carried over from an earlier phase). A priority that exists can still be edited with its pencil.
- Browse drops changes one phase at a time. Taking an item with assigned players off the list asks for confirmation and **keeps** its priorities, note and awards; putting it back restores that work. An item without players is removed. Both actions are logged.
- Guild and Raid Leaders can **Edit the drop lists** by phase: paste item IDs or Wowhead links with name previews, add/reorder creatures, and add/remove/restore zones or items. Earlier phases keep their lists, later phases inherit changes, and edits are logged under **Drop lists**. Bundled files are unchanged. Full capture-file import remains planned (LOOT-008).

Sources: PRs #72-#76, #78-#89 and catch-ups #90-#93. RAID-008, MEMBER-001, MEMBER-002 and LOOT-001 are delivered. LOOT-007/008/009 and LOOT-004 have partial delivery with remaining scope in the backlog. Manual-award rules are live, but the standalone recording form is not delivered (LOOT-002). Stable-ID loot selection/migration remains LOOT-003.

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
