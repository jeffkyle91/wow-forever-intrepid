# Exchange strings, v0 (ADDON-001)

Status: **draft 2, 2026-10-19.** It fixes the findings of the first review (three readers and a skeptic). The loot owner decided the encoding (JSON), pseudo recipients (a new award field), past-phase imports (allowed), items still owed (later) and award decisions (picked by the loot master).

Four small additions came from writing the Lua reader on the same day: the nesting limit (section 3), U+0000 in text (section 2), the E_KIND wording and E_MULTIPLE without reading the second string (section 1.1). The Lua checksum, JSON reader and writer, and envelope reader are built and pass all the fixtures. Nothing else is built yet.

This spec covers the two strings that stage v0 needs, and nothing else:

| String | Direction | Made by | Pasted into |
| --- | --- | --- | --- |
| **night** | app to addon, before the raid | the Raid Desk's "Copy for addon" button | the addon's import box (loot master) |
| **awards** | addon to app, after the raid or after a boss | the addon's export window | the Raid Desk's importer (LOOT-005) |

Council messages, response buttons, timers, assignments, strategies and the list of items still owed from earlier nights get their own specs later. Readers ignore unknown fields ([section 9](#9-versioning)), so new fields never break an older reader.

The [fixtures/](fixtures/) folder holds sample strings, the broken strings a reader must reject, test cases for the content checks (one edit to a good model each) and test cases for the awarded marks. [tools/exchange_fixtures.py](../../tools/exchange_fixtures.py) builds and checks them; it is the reference implementation of this spec. The Lua and TypeScript tests use the fixtures.

Several rules here need changes in the app (new award fields, Firestore rules). They are listed in [section 8](#8-app-work-this-spec-needs-loot-005) for LOOT-005.

## 1. Envelope

Every string has the same envelope, one line of text:

```
IM1:<kind>:<encoding>:<length>:<payload>:<crc>
```

| Part | Value |
| --- | --- |
| `IM1` | Fixed. "Intrepid Manager, envelope version 1." Changes only if the envelope itself changes. |
| `kind` | `night` or `awards`. |
| `encoding` | `j`: the payload is JSON ([section 3](#3-the-payload-json)). `jz` is reserved for a compressed form and is not defined. |
| `length` | The number of characters in the payload, in decimal, without leading zeros. An empty payload has length `0`. |
| `payload` | Exactly `length` characters. It may contain `:`. |
| `crc` | CRC-32 of every character from the `I` of `IM1` up to and including the `:` before the checksum, as 8 lowercase hex digits. |

**Characters.** The whole envelope uses printable ASCII only: codes 0x20 to 0x7E, **except `|`** (0x7C). The game's text widgets treat `|` as the start of an escape code (colors, links). The payload escapes `|`, non-ASCII letters and control characters, so names such as "Zoë Ærinwald" travel safely. Producers never write CR, LF or tab.

**CRC-32.** The common one (zlib, PNG): reflected polynomial `0xEDB88320`, start value `0xFFFFFFFF`, final XOR `0xFFFFFFFF`. The check value of `123456789` is `cbf43926`. Test vectors, including values with the high bit set, are in [fixtures/crc32-vectors.json](fixtures/crc32-vectors.json). In Lua, see [section 10](#10-notes-for-the-addon).

The checksum only catches accidents, such as a cut-off paste or a word processor's "smart" quote. It is not a signature: anyone can edit a string and recompute it. The app's importer treats every pasted string as untrusted and previews it before saving.

### 1.1 Reading a string

A reader (the addon's import box, the app's importer) runs these steps in order and stops at the first error:

1. Remove every CR, LF and tab character from the pasted text, wherever it occurs. A string that a chat window or an email wrapped still reads.
2. Find the first `IM1:`. Text before it is ignored, so "Here's the string: IM1:…" reads.
   - No `IM1:`, but `IM` followed by another number and a `:` → **E_VERSION**.
   - Otherwise → **E_NOT_IM**.
3. Read `kind`, `encoding` and `length` up to the fourth `:`.
   - A part is missing, or `length` is not a decimal number → **E_MALFORMED**.
   - `kind` is not the one this box takes (including a kind this version does not know) → **E_KIND**.
   - Unknown `encoding` → **E_ENCODING**.
4. The envelope should end `length` + 9 characters after the fourth `:` (the payload, a `:` and 8 hex digits). A character outside the allowed set anywhere between `IM1` and that point → **E_CHARS**.
5. Check the rest of the envelope.
   - The text ends before that point → **E_TRUNCATED**.
   - No `:` after the payload, or a checksum that is not 8 lowercase hex digits → **E_MALFORMED**.
6. Compute the CRC. A different value → **E_CHECKSUM**.
7. Decode the payload ([section 3](#3-the-payload-json)). Anything that is not a JSON object, or that breaks the rules of section 3 → **E_PAYLOAD**.
8. A `schema` the reader does not know → **E_SCHEMA**. A missing `schema` is E_PAYLOAD.
9. Check the content ([section 5](#5-the-night-string-app-to-addon) or [6](#6-the-awards-string-addon-to-app)).
   - A broken top level → **E_PAYLOAD**.
   - A broken row → a row error: the reader rejects that row and keeps the rest.
10. Look for another `IM1:` after the end of this envelope.
    - The addon's import box takes exactly one night → **E_MULTIPLE**, without reading the second string. A broken second string is E_MULTIPLE too.
    - The app's importer reads every envelope it finds and previews them together, so two loot masters' strings pasted at once both import. It applies steps 3 to 9 to each.

Step 4 runs before the length is trusted, for a reason. Lua counts bytes and JavaScript counts UTF-16 units, so a pasted "smart" quote would shift the payload differently in each. Everything before the first disallowed character is ASCII, so both sides find that character at the same position and give the same answer. The reference reader works on bytes, as Lua does.

The same codes and messages are used on both sides:

| Code | Message (the reader adds details in parentheses) |
| --- | --- |
| E_NOT_IM | This is not an Intrepid Manager string. |
| E_VERSION | This string was made by a newer version. Update the addon (or reload the Raid Desk) and try again. |
| E_KIND | This is a (or an, before a vowel) *kind* string; this box takes *expected* strings. Then, for the kind that was found: night → "Paste night strings into the addon."; awards → "Paste awards strings into the Raid Desk importer." |
| E_ENCODING | This string uses a format this version cannot read. Update the addon (or reload the Raid Desk). |
| E_MALFORMED | This string is damaged. Copy it again from the source. |
| E_TRUNCATED | Only part of the string arrived (*got* of *expected* characters). Copy it again, all of it. |
| E_CHARS | The string contains characters it should not (often a word processor or chat app changed quotes). Copy it again from the source. |
| E_CHECKSUM | The string was changed after it was copied. Copy it again from the source. |
| E_PAYLOAD | The string is complete but its contents cannot be read (*detail*). Tell the addon maintainers. |
| E_SCHEMA | This string uses schema *n*; this version reads up to *m*. Update the addon (or reload the Raid Desk). |
| E_MULTIPLE | More than one string was pasted. Paste one night string. |

## 2. Shared rules

**Times.** An `at` field is whole seconds since 1970-01-01 UTC. The addon takes it from `GetServerTime()` when that exists, else `time()`. A **date** is written `YYYY-MM-DD`.

**Ids.** All ids (string ids, award ids, roster ids, priority ids) are opaque strings of 1 to 64 characters from `A-Z a-z 0-9 _ -`. Readers compare them exactly, case included, and never parse them. There is no `.`, so an award id can be a Firestore document id and an audit `targetId` as it stands. The app's 20-character Firestore ids fit.

**Producer.** `by` names the program that made the string and its version, as `<name>/<version>`: `RaidDesk/2026.12.09`, `IntrepidManager/0.1.0`. It is 1 to 60 characters and never a person's name.

**Text.** Lengths are counted in **Unicode code points** on every side. Lua counts bytes, and TypeScript counts UTF-16 units, so both must convert. "Blank" means empty after removing leading and trailing ASCII spaces (0x20). Other whitespace, such as a no-break space, counts as text. A value over its limit makes its row a row error. A text that contains U+0000 (NUL) is invalid, because the game's text handling stops at a NUL: in a row it makes the row a row error, and in a top-level field (`by`) it makes the whole string E_PAYLOAD. Other control characters are allowed.

| Field | Limit | Why |
| --- | --- | --- |
| Roster `name`, `surname` | 60 | |
| Full names (name-only lines, `to`) | 121 | The app stores at most 60 in `recipient`; the importer flags longer ones. |
| `item` | 1 to 120 | The app's limit |
| `encounter` (priorities and awards), boss names | 0 to 120; empty allowed | The app allows an empty encounter. |
| Priority `note`, award `note` | 500 | The app's `councilNote` and `awardNote` |
| Note lines (`text`) | 500 | |
| Lines per priority | 60 | The app's limit |
| `class`, `role` | 40 | Shown, never checked against a list |
| `itemId`, `npcId`, `zoneId` | integers from 1 to 100,000,000 | The app's `validGameId` |

**Names and matching.** Characters have a first name and a surname ("Jorren Ashvale"); the second word is not a realm. A game character matches a roster entry when their **full names** are equal after:
- removing leading and trailing ASCII spaces;
- collapsing runs of spaces;
- lowercasing **ASCII letters only**.

The addon's `Names.normalize` already does this. The app's `nameKey` lowercases all letters, so the importer must use the ASCII-only rule when it matches addon names.
- **Never match on the first name alone.** A roster entry without a surname matches no game character, and a blank surname counts as none. "Copy for addon" warns about such entries.
- Two roster entries with the same full name match nobody (as the app's `makeWho` does).
- Non-ASCII letters must match exactly, case included.

**Row errors** are named as follows; the order of the list does not matter, and the fixtures' `rowErrors` use these names (sorted):
- a priority or an award: by its `id` when that is valid and its first use, else `priority:4` or `award:5`;
- a roster entry or a boss: always by kind and position from 1, `roster:3` or `boss:2`;
- the raid: `raid`.

**Duplicates.** The first row with a given key wins. A later row with the same key is a row error, named by position. The keys are a roster entry's `k`, a roster entry's `id`, a priority's `id`, and an award's `id`.

## 3. The payload: JSON

**Producers** write one JSON object (RFC 8259):
- **No spaces.** No spaces or line breaks between tokens.
- **Field order.** Fields come in the order the tables below list them (the canonical order). The producer tests compare their output byte for byte with the fixtures.
- **Integers only.** Numbers are integers written without a fraction or an exponent. Lua writes them with `%.0f` ([section 10](#10-notes-for-the-addon)).
- **Absent values.** An absent value is left out. Producers never write `null`, and write a boolean only when it is `true`.
- **String escapes:**

  | Characters | Written as |
  | --- | --- |
  | `"` and `\` | `\"` and `\\` |
  | Backspace, form feed, line feed, carriage return, tab | `\b`, `\f`, `\n`, `\r`, `\t` |
  | Other control characters (below 0x20) | `\u00xx` |
  | `\|`, DEL (0x7F) and every non-ASCII character | `\uxxxx`, lowercase hex |
  | Characters above U+FFFF | a surrogate pair |
  | `/` and everything else | as is |

  In TypeScript that is `JSON.stringify(value)` followed by `.replace(/[\u007f-\uffff|]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))`. Without the `u` flag, a character above U+FFFF matches as two halves, each escaped, which gives the right pair.

**Readers** accept what `JSON.parse` accepts, so the TypeScript, Python and Lua readers agree. Then they apply these rules:
- **Formatting.** Spaces between tokens, any field order, `\/`, and escapes in upper or lower case are all fine. Line breaks and tabs cannot appear: step 1 of section 1.1 removes them before the length is checked.
- **Repeated keys.** If an object repeats a key, the last value wins.
- **`null`.** In a field, `null` is the same as leaving the field out. As an element of a list (`known`, `roster`, `bosses`, `priorities`, `lines`, `awards`), it is E_PAYLOAD.
- **`false`.** It is the same as leaving the field out.
- **Lone surrogates.** An escaped surrogate without its pair is E_PAYLOAD. Neither Lua nor Firestore can store one.
- **Nesting.** More than 16 levels of lists and objects, counting the top-level object as the first, is E_PAYLOAD. The real strings nest 5 deep.
- **Integers.** An integer is a number whose value is whole and between -2^53 and 2^53. So `2.0` and `2e0` are 2, and `2.5` is a wrong type.
- **Wrong types.** A wrong type in a top-level field is E_PAYLOAD. In a row, it is a row error.
- **Unknown fields** are ignored.

The addon needs its own decoder (for the night string) and encoder (for the awards string), about 150 lines of Lua, with unit tests on the fixtures. A Lua table cannot tell `[]` from `{}`, so the decoder marks the lists it reads, and the encoder writes lists and objects from the field tables of this spec, not by guessing.

## 4. Raid-night rules

These are the rules the reviewers found missing, gathered in one place:

- **Never break loot mid-raid.** A failed import keeps the current night. While a loot session is open, the addon refuses to import a night ("Finish or cancel the open session first"). A night string that is old or for another day only warns, and never blocks:
  - when `raid.date` is not today in the loot master's time zone;
  - when `at` is more than 18 hours ago.
- **Awarded and received are different.** In this spec, a priority line is **awarded** (the `awarded` field) when an award counts for it. The item can still be on its way: *received* means the item is in the player's bags (`delivery.state`). The addon's hand-out list shows the awards that are not yet received.
- **Handing over mid-raid.** The first loot master exports, a leader imports, and the leader copies a new night for the second loot master. Without that, the second loot master's marks do not show the first one's awards.
- **Crash safety.** The game writes the addon's saved file only on `/reload`, logout or exit, so a crash loses everything since the last write. The addon:
  - never resumes a session or reuses an award number after a load;
  - starts each load with a new random session part;
  - makes every revision number larger than any before it ([section 6.1](#61-content)).

  After exporting, the addon suggests a `/reload` when out of combat, and never forces one. The importer's Conflict and Possible duplicate rows catch what a crash leaves behind.

## 5. The night string (app to addon)

### 5.1 Content

Top level, in canonical order:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `schema` | integer | yes | `1` |
| `id` | id | yes | This string's own id, new each time "Copy for addon" runs. |
| `at` | time | yes | When it was made. |
| `by` | text | yes | The producer. |
| `phase` | integer, 0 or more | yes | The app's phase number (`phaseNo`). Every priority in the string belongs to this phase. |
| `raid` | object | no | The raid night: `id` (id), `date` (date), `name` (text, 120), `size` (10, 20 or 40). A `raid` that fails these checks is ignored and reported as the row error `raid`. |
| `known` | list | no | The addon-made awards the app holds for this phase, removed ones included. Each entry is `{"id": …, "rev": …}`, with the `rev` the app last imported ([section 7](#7-awarded-marks)). |
| `roster` | list | yes | Players, below. May be empty. |
| `bosses` | list | no | Creatures the addon can name from a corpse: `npcId` (required), `name` (required), `zoneId`. |
| `priorities` | list | yes | Loot priorities, below. May be empty. |

A **roster entry**:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `k` | integer, 1 or more | yes | This entry's number inside this string. Priority lines refer to it. |
| `id` | id | yes | The app's roster id (`PlayerRecord.id`). Exported awards carry it as `toId`. |
| `name` | text | yes | First name. |
| `surname` | text | no | Surname. Without it, the entry matches no game character. |
| `class` | text | no | `PlayerRecord.className`. The addon shows `?` when it is missing. |
| `role` | text | no | `PlayerRecord.role`. The addon shows `?` when it is missing. |
| `main` | integer | no | The `k` of this alt's main. Ignored when no entry has that `k`. |
| `locked` | boolean | no | On the night's locked roster (RAID-001), when the app has one. |

Only `k`, `id` and `name` are required. A roster entry that is a row error invalidates every line that names its `k`, which hides those priorities. Keeping the requirements small keeps that rare.

The app includes the night's locked roster, every character a priority line or a `main` refers to, and, simplest, the whole active roster. That costs about 7,300 characters for 60 players.

A **priority**:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | id | yes | `PriorityRecord.id`. Exported awards carry it as `priority`. |
| `item` | text | yes | `PriorityRecord.item`. |
| `itemId` | integer | no | Wowhead item id; none for a priority typed by hand. The addon uses it to find the priority when loot opens. |
| `encounter` | text | no | `PriorityRecord.encounter` (may be empty in the app). |
| `npcId`, `zoneId` | integer | no | As in the app. |
| `note` | text | no | The council note (`councilNote`). |
| `lines` | list | yes | The candidate lines, in priority order. May be empty. |

A **line** is exactly one of:

| Line | Fields | Meaning |
| --- | --- | --- |
| Character | `k`, `awarded` (optional) | A roster character. `awarded`: this listing is already satisfied by an award. |
| Name only | `name`, `awarded` (optional) | A line that resolves to no roster character in the app (an old name, a deleted character). |
| Note | `text`, `done` (optional) | An open note ("any warlock who didn't get the cloak"), or a finished one (`done`). |

**What the app sends.** Only priorities of the current phase, never hidden ones. The app's rules refuse awards on any other priority, so sending one would invite an award that cannot be saved. The leader may narrow the list by zone, never widen it beyond that.

For each priority, the producer computes:
- **The awarded marks**, the same way the award dialog does (`AwardModal.tsx`): `listingProgress(priority, every award of every phase including removed ones, priorityLookup(every priority including hidden ones), makeWho(the whole roster))`. Line *i* is `awarded` when `received[i]` is true.
- **The lines.** A line whose key (`makeWho.lineKey`) is a roster character in the string becomes a character line. Any other character line becomes a name-only line with its stored name.

### 5.2 Example

From [fixtures/night-small.j.txt](fixtures/night-small.j.txt), shortened. Line breaks are added here for reading; the real string is one line, and the fixture is the authority.

```
IM1:night:j:1687:{"schema":1,"id":"n-7fq2kd91xw","at":1796862600,"by":"RaidDesk/2026.12.09","phase":1,
"raid":{"id":"raid-1209","date":"2026-12-09","name":"Wednesday Test Night","size":20},
"known":[{"id":"s-tpg4mo-k3p9-1","rev":1796262300},{"id":"s-tpg4mo-k3p9-2","rev":1796263500}],
"roster":[{"k":1,"id":"AbCdEfGhIjKlMnOpQr01","name":"Jorren","surname":"Ashvale","class":"Warrior","role":"Tank","locked":true},
…{"k":4,"id":"AbCdEfGhIjKlMnOpQr04","name":"Zo\u00eb","surname":"\u00c6rinwald","class":"Mage","role":"Ranged","locked":true},…],
"bosses":[{"npcId":990001,"name":"Grimtooth the Test Boss","zoneId":991},…],
"priorities":[{"id":"pr-blade","item":"Blade of the Fixture","itemId":900001,"encounter":"Grimtooth the Test Boss",
"npcId":990001,"zoneId":991,"note":"Tanks first; then DPS, see \u007cnotes\u007c in Discord",
"lines":[{"k":1,"awarded":true},{"k":2},{"text":"any warlock who didn't get the cloak"},{"k":1}]},…]}:b4a179a5
```

### 5.3 What the addon does with it

1. Read it (section 1.1). On any E_ code, show the message and keep the current night.
2. Check the rows (sections 2 and 5.1). **A priority with a bad line is skipped whole.** Showing it without that line would tell the council a wrong order.
3. Show a summary and wait for **Import**. For example: "Night of 2026-12-09, copied 2 hours ago: 58 players, 87 priorities. 1 priority skipped: Cloak of Many Commas… (line 4: unknown player)." Add the age and date warnings of section 4.
4. On Import, replace the previous night entirely (no merging). The addon's own awards live in its log, not in the night, and are not touched.

## 6. The awards string (addon to app)

### 6.1 Content

Top level:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `schema` | integer | yes | `1` |
| `id` | id | yes | This export's id. |
| `at` | time | yes | When it was made. |
| `by` | text | yes | The producer. |
| `awards` | list | yes | Awards, below. May be empty. |

An **award**, in canonical order:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | id | yes | The award's source id. Made by the addon, unique forever, never reused, not even after a removal. |
| `rev` | integer, 1 or more | yes | This award's revision. Every change sets it to max(previous `rev` + 1, server time now), so it always rises, even across a crash. A new award starts at the server time. |
| `session` | id | no | The loot session (one corpse, or one batch of items). |
| `at` | time | yes | When it was awarded. |
| `date` | date | yes | The loot master's local date at `at`. Used when the raid is not known. |
| `phase` | integer | no | The night's `phase` when the award was made. None when no night was loaded. |
| `raid` | id | no | The night's `raid.id` when the award was made. |
| `itemId` | integer | yes | From the item link. |
| `item` | text | yes | The item name as the game showed it. |
| `toId` | id | no | The roster id when the recipient matched a roster entry. |
| `to` | text | yes | The recipient's full name as the game showed it, or the pseudo recipient's label. |
| `pseudo` | `disenchant` or `guild-bank` | no | A pseudo recipient: `toId` is absent, and `to` is `Disenchant` or `Guild bank`. |
| `decision` | `council`, `roll` or `other` | no | How the loot master says it was decided, picked in the game. Required for an award without a `priority` that is not a pseudo award. |
| `priority` | id | no | The priority the award was made from. |
| `encounter` | text | no | The boss name, from the corpse's NPC id. |
| `npcId`, `zoneId` | integer | no | From the corpse. |
| `note` | text | no | The loot master's note. |
| `delivery` | object | yes | `state`: `assigned` or `received`. When received, `at` (time) and `how` (`master-loot`, `trade` or `manual`) are required; when assigned, they are ignored. |
| `status` | `removed` | no | The loot master removed the award in the game. |

An unknown `pseudo`, `decision`, `delivery.state`, `delivery.how` or `status` value is a row error. So are a `pseudo` with a `toId`, and an award with neither `priority` nor `pseudo` nor `decision`.

**What a revision may change:** `delivery`, `note`, `decision`, and `status` (to `removed`).
- **Recipient, item or priority.** To change any of these, the addon removes the award (a new `rev` with `status: removed`) and makes a new award with a new `id`. The app's award edit cannot change a priority award's priority or snapshots anyway.
- **No un-removing.** A removed award stays removed. The loot master makes a new award instead.

**Making ids.** A session id is:
- `s-`;
- the session's start time in base 36;
- `-`;
- four random base-36 characters made when the addon loads.

For example: `s-tpt2u0-q4tz`. An award id is the session id, `-`, and its number in the session: `s-tpt2u0-q4tz-1`. The random part keeps two loot masters apart, and keeps one loot master's runs apart across a crash.

**Which awards an export holds.** By default, every award of the night's `phase` (and every award with no phase) that the loaded night's `known` list does not already have: an `id` that is not in it, or is in it with a lower `rev` (the "changed since the night was copied" ones). The same `rev` or a higher one is left out, because the app has that version or a newer one. With no night loaded, every award of the last 14 days. The window shows the count ("23 awards, 4 changed since the night was copied"). The loot master can pick "everything". Exporting more than needed is harmless (section 6.3).

### 6.2 Example

From [fixtures/awards-small.j.txt](fixtures/awards-small.j.txt), one award:

```
IM1:awards:j:2025:{"schema":1,"id":"a-tpt9k0-8vbn","at":1796875200,"by":"IntrepidManager/0.1.0",
"awards":[{"id":"s-tpt2u0-q4tz-1","rev":1796866530,"session":"s-tpt2u0-q4tz","at":1796866512,"date":"2026-12-09",
"phase":1,"raid":"raid-1209","itemId":900001,"item":"Blade of the Fixture","toId":"AbCdEfGhIjKlMnOpQr02",
"to":"Mirelle Dunmore","priority":"pr-blade","encounter":"Grimtooth the Test Boss","npcId":990001,"zoneId":991,
"delivery":{"state":"received","at":1796866530,"how":"master-loot"}},…]}:850c1b68
```

### 6.3 What the app's importer does with it (LOOT-005)

The importer previews every row before saving anything. It saves each confirmed row in its own batch (the award plus its audit entry), so a row the rules refuse never sinks other rows. The award's document id is `addon-` + `id`: a second import of the same row, in another tab or by another leader, fails on the existing document instead of making a copy.

**Preview categories.** When a row fits more than one, the first one in this order wins:

| Category | When | Saving does |
| --- | --- | --- |
| **Error** | A row error | Nothing; shows why. |
| **Conflict** | The same `id` with the same `rev` but different content (a crash left two versions), or a higher `rev` for an award a leader has edited in the app since it was imported | Nothing until a leader picks a version for each differing field. A field edited in the app is never overwritten without that choice. |
| **Duplicate** | The same `id`, same `rev`, same content | Nothing. Importing a string twice adds nothing. |
| **Stale** | The same `id`, lower `rev` | Nothing (an older export pasted after a newer one). |
| **Changed** | The same `id`, higher `rev`, not edited in the app since | Applies `delivery`, `note` (`awardNote`) and `decision`. A removal sets `status: removed` with the reason "Removed in the addon". |
| **Possible duplicate** | No `id` match, but the app has an award with the same recipient, the same item (`itemId`, or the name when either has no id) and an `awardedAt` within one day | Waits for a leader: the same award (link it, which stores the source id on it), a new one, or skip. Catches awards typed into the app while the addon was down, and awards redone after a crash. |
| **Unmatched** | No `toId`, not a pseudo award, and `to` matches no roster character (section 2) | Waits for a leader to pick the character. The pick is remembered for that `id`, so a later `rev` does not ask again. |
| **New** | Anything else | Creates the award, as below. |

A New row with `status: removed` is skipped: it never reached the app, so there is nothing to remove.

**How a new award is written:**

| App field | From |
| --- | --- |
| `recipientId` | `toId` (or the leader's pick) |
| `recipient` | **The roster entry's current `name`** (the app's rules require it), not `to`. `to` is shown in the preview. |
| `item`, `encounter` | For a priority award, **copied from the app's priority** (the rules require it). Otherwise, `item` and `encounter` from the string. The game's names are shown in the preview. |
| `awardedAt` | The date of the raid `raid` names, when the app has it; else `date`. A raid past midnight keeps its own date. |
| `phaseNo` | `phase`; when absent, the leader picks it (default: the current phase). |
| `priorityId` and snapshots | `priority`. `prioritySnapshot`, `prioritySnapshotIds` and `councilNoteSnapshot` are filled from **the app's own** priority, never from the string. |
| `decision` | `decision`, for an award without a priority. |
| `awardNote` | `note` |
| new fields (section 8) | `sourceId` (= `id`), `sourceRev` (= `rev`), `pseudo`, `itemId`, `npcId`, `zoneId`, the delivery fields |

**When the app's rules would refuse a priority award**, the preview says so and offers the fallback:

| Case | Fallback |
| --- | --- |
| The priority no longer exists | Save as a manual award (needs `decision`; the leader picks when it is missing). |
| The priority is hidden | Ask: unhide it first, save as a manual award, or skip. |
| The recipient is not on the list, but the list has an open note | Record it through the note (`receiveThroughNote` in `candidates.ts`): the character takes the note's place. |
| The recipient is not on the list and there is no open note | Save as a manual award, with a warning that the priority's marks will not show it. |
| The award's `phase` differs from the priority's | Error row. The addon only offers priorities of the night's phase, so this means a broken string. |

A **pseudo award** is always saved without a priority (section 8). Its `priority`, if any, is shown in the preview only, and it never marks a line.

## 7. Awarded marks

The addon shows the same marks as the app. The app's rule is positional completion (`listingProgress` in `src/shared/game/completion.ts`): for one priority and one person P, let A be the number of P's active awards that count for that priority. The first A of P's lines are awarded; the rest are open. The marks key on the recipient, so an alt's award never marks the main's line, in the app or in the addon.

**The app computes the marks; the addon adds only its own awards since.** Carry-over between phases, removed awards and older awards are already settled in each line's `awarded` flag, so none of that logic is ported to Lua. In the addon:

1. Start from each line's `awarded`.
2. Take each award in the addon's log that:
   - is not removed;
   - has a `phase` equal to the night's `phase` (an award made with no night loaded does not count);
   - is not a pseudo award;
   - is not in the night's `known` list at all.

   An award in `known` with a lower `rev` than the addon's own does not count either: the app already counted the older version. The addon shows "changed since the night was copied: export and copy again for correct marks".
3. Find the priority the award counts for:
   - with `priority`, that priority, when it is in the night;
   - without one, as the app does: every priority whose `item` equals the award's `item` after trimming, collapsing spaces and lowercasing.

   (The addon lowercases ASCII only; the app lowercases all letters. They can differ only for item names with non-ASCII capital letters.)
4. Find the person's lines on that priority:
   - with `toId`, the character lines whose roster entry has that `id`;
   - without one, the character lines of the single roster entry whose full name matches `to` (section 2);
   - failing that, the name-only lines whose name matches `to`.
5. Mark the first of those lines that is not yet marked. When all are marked, nothing changes.

The `known` list keeps an award from counting twice. After the night's awards are imported, a new "Copy for addon" already counts them in `awarded` and lists their `id` and `rev` in `known`. **The app must list every addon-made award of the phase it holds, removed ones included**: a removed award is not in `awarded`, and must not be counted again by the addon.

**Size.** `known` grows by one entry (about 40 characters) per addon award in the phase. Even 500 awards cost about 20,000 characters. If a phase ever exceeds 1,000 addon awards, revisit this.

The fixture [fixtures/marks-cases.json](fixtures/marks-cases.json) holds the cases both sides run: a night (`night-small`, with the `edit` list of the case applied first when it has one), the addon's log, and the expected marks per priority.

## 8. App work this spec needs (LOOT-005)

These belong in LOOT-005 through the Raid Desk's own work process. They are listed here so that nothing is assumed silently.

1. **New award fields:**
   - `sourceId` and `sourceRev`. The app's own `rev` is the audit revision and stays separate.
   - `itemId`, `npcId`, `zoneId`.
   - Delivery: `deliveryState`, `deliveredAt`, `deliveredHow`.
   - `pseudo`.
2. **Pseudo recipients** (the loot owner, 2026-10-19: a new field). The rules accept an award with `pseudo` in `disenchant` or `guild-bank`, `recipient` `Disenchant` or `Guild bank`, and no `recipientId`. Pseudo awards count toward nobody's marks.
3. **Importing into a past phase** (the loot owner, 2026-10-19: allowed). Today a create needs `phaseNo` equal to the current phase. An import may write an award into a finished phase, audited as an import.
4. **The `addon-<sourceId>` document id** for imported awards. Linking a Possible duplicate stores `sourceId` on an existing award.
5. **"Copy for addon"** builds the night string as in section 5.1, including `known`. It needs the source ids of every addon-made award of the phase.
6. **Items still owed** (the loot owner, 2026-10-19: later). Once the delivery fields exist, a later night schema can carry the awards not yet received.

## 9. Versioning

- **Envelope version** (`IM1`): changes only if the envelope's syntax changes. Not expected.
- **Schema** (`schema`, per kind): a reader accepts schemas up to the newest it knows, and refuses a newer one with E_SCHEMA.
  - **No new schema** for a new optional field. Readers ignore what they do not know.
  - **A new schema** when a field changes meaning, a new field becomes required, or a field gets a new allowed value.
- **Mixed versions.** The app reads every awards schema it ever accepted, so an old addon's export always imports. The addon reads the newest night schema and, while practical, the one before.

## 10. Notes for the addon

- **CRC-32 in Lua 5.1.** Only `bit.bxor` is needed: shifts and masks are plain arithmetic. Use the client's `bit.bxor` when it exists, and an xor written in plain arithmetic otherwise. The unit tests run the plain one, and also stand-ins that return signed and unsigned numbers.
  - **The Forever beta client's `bit.bxor` returns unsigned numbers** (0 to 2^32 - 1), on the Mac and on Windows (`/im selftest`, 2026-10-19). That is not what the original LuaBitOp library does: it returns signed 32-bit values, with -1 for 0xFFFFFFFF. The code accepts both and brings every result into 0 to 2^32 - 1 with `% 2^32`, so it works whichever the client gives, now or at launch.
  - Format it as `string.format("%04x%04x", math.floor(c / 65536), c % 65536)`. `%x` and `%d` pass through a C `long`, which is 32 bits on Windows.
  - The Forever beta client has `bit` (a table) and `bit.bxor` (a function), on the Mac and on Windows (probe 0.5.5, 2026-10-19). Only `bit.bxor` is used, so `bit.band` and `bit.rshift` need not be checked.
- **Integers.** Write integers with `string.format("%.0f", n)`. `tostring` switches to exponent form above about 10^14.
- **Pipes in game text.** To show a text that contains `|` in a FontString, write it as `||`. An EditBox returns a typed `|` as `||` from `GetText`, so turn `||` back into `|` before storing it.
- **`C_EncodingUtil`.** The Forever beta client has `C_EncodingUtil.DeserializeJSON`, on both clients (probe 0.5.5). Its behavior is not tested in CI, and nobody has checked it against section 3's reader rules (null, false, repeated keys, lone surrogates), so keep our own decoder as the reference.
- **Names.** Record the full name with `GetUnitName(unit, true)`, and match it with `Names.normalize`.

## 11. Measurements

Measured with `python3 tools/exchange_fixtures.py measure` on synthetic data shaped like a real night. The data has 60 roster entries with 20-character ids, 8 lines per item, a council note on one item in three, 15 bosses, and 20 known awards.

| Items in the night string | Characters |
| --- | --- |
| 10 | 11,702 |
| 50 | 22,251 |
| **100** | **35,479** |
| 200 | 61,986 |
| 400 | 115,048 |
| 100, with 500 known awards instead of 20 | 56,520 |

| Awards in the export | Characters |
| --- | --- |
| 10 | 4,098 |
| 40 | 16,099 |
| 100 | 40,101 |

- **Paste limit.** 100,000 characters pasted intact into the game on both clients, and survived `/reload` (probe 0.5.3, 2026-10-19). Nothing larger was tested.
- **Speed in the game** (`/im selftest`, Mac and Windows, 2026-10-19, build 70450, fastest of 3 runs, with `bit.bxor`). Reading a 100-item night string (33,890 characters, checksum and decoding) took 8.6 ms on the Mac and 9.7 ms on Windows; 400 items (108,531 characters) took 28 and 31 ms. Writing an export of 100 awards (40,105 characters) took 7.6 and 8.2 ms. The checksum alone is about five times faster with `bit.bxor` than with the plain xor. A typical night fits in one or two frames, so nothing needs to be spread over several frames.
- **Headroom.** At under 100 items per night, the night string stays far below that. JSON passes 100,000 characters only beyond about 350 items. "Copy for addon" refuses to make a string over 100,000 characters and asks the leader to narrow the zones.
- **Encoding.** The loot owner chose JSON on 2026-10-19. The line-based alternative of draft 1 was 45 percent smaller, but harder to extend and to read when something goes wrong; it is removed.

## 12. Tests both sides run

- **Readers:**
  - every file in [fixtures/cases/](fixtures/cases/) gives the result [fixtures/cases/cases.json](fixtures/cases/cases.json) names: an E_ code, or OK with the listed row errors. Where a case gives `sameAs`, it must also decode to that model; where it gives `envelopes`, the importer must find that many strings; where it gives `layer: content`, the error comes from the content checks of step 9 (section 5 or 6), so code that has only the envelope steps (1 to 8) accepts the string;
  - the good fixtures decode to their `.model.json`.
- **Producers:** encoding a `.model.json` gives the fixture string byte for byte (the app for the night string, the addon for the awards string).
- **Content checks:** every case in [fixtures/content-cases.json](fixtures/content-cases.json) names a good model (`night-small` or `awards-small`, from its `.model.json`), a list of edits and the answer. Apply the edits, then run the content checks of step 9: the answer is `E_PAYLOAD` (a top-level field is wrong) or `OK` with the sorted `rowErrors` (none when the key is missing). An edit is `["set", path, value]`, `["delete", path]` or `["append", path, value]`; a path is a list of keys and 1-based list positions, so `["roster", 3, "name"]` is the name of the third roster entry, the one the row error `roster:3` names. The cases are built from data in the tool, so a TypeScript importer reads the same file.
- **Marks:** every case in [fixtures/marks-cases.json](fixtures/marks-cases.json) gives its expected marks and warnings.
- **CRC-32:** [fixtures/crc32-vectors.json](fixtures/crc32-vectors.json).
- **Synthetic nights and awards:** [tools/synthetic.py](../../tools/synthetic.py) makes larger, varied strings (an invented roster with awkward names, a series of awards strings for every row category of section 6.3) with the same reference writer; a few are in [fixtures/synthetic/](fixtures/synthetic/) and the Lua tests read them. Its preview is a reference for section 6.3, not the app.
- **Fixtures up to date:** `python3 tools/exchange_fixtures.py check` fails when a fixture no longer matches its model, or when the reference reader, the reference content checks or the reference marks disagree with a case. Edit a `.model.json` or the cases in the tool, then run `python3 tools/exchange_fixtures.py build`.

## 13. Still open

1. **Settled 2026-10-19 (probe 0.5.5, Mac and Windows):** `bit`, `bit.bxor`, `GetServerTime`, `C_EncodingUtil` and `C_EncodingUtil.DeserializeJSON` all exist on the beta client. Recheck at launch (2026-11-04).
2. **Accented names.** Whether Forever allows them at all. The matching rule above handles them exactly, without case folding.
3. **The player GUID.** An optional field on awards would help with renamed characters and same-name entries. It can be added later without a new schema.
