#!/usr/bin/env python3
"""Synthetic raid nights and awards strings, to rehearse the Raid Desk import (LOOT-005) before it exists.

Everything here is invented: the players, items and bosses are made up, and every id is made up. The strings follow
docs/spec/exchange-v0.md and are written with the reference writer of addon/tools/exchange_fixtures.py, so any reader that
follows the spec can read them.

  python3 addon/tools/synthetic.py night   [--seed N] [--players 24] [--items 24] [--date YYYY-MM-DD] [--size 20]
                                     [--phase 1] [--at SECONDS] [--item-ids FILE] [--roster-json FILE] [--emulator]
                                     [--plain] [--out FILE]
        a night string (what "Copy for addon" would make), to paste into the addon's import box
  python3 addon/tools/synthetic.py awards  --night FILE [--seed N] [--count 12] [--out FILE]
        an awards string for that night (what the addon's export window would make)
  python3 addon/tools/synthetic.py pack    [--seed N] [--dir DIR] [options of night]
        a whole rehearsal folder: the night, a series of awards strings that walk through every row category of the
        importer preview, broken strings that must be refused, the expected results, and a README
  python3 addon/tools/synthetic.py check   [FILE | -] [--clipboard] [--expect night|awards] [--night FILE] [--state FILE]
        read a pasted string (a night, or awards from the addon) with the reference reader, say what it holds, and with
        --state say what the importer's preview would show for each award
  python3 addon/tools/synthetic.py selftest
        make a pack and check everything it says against the reference reader and the reference preview, and that the
        fixtures in docs/spec/fixtures/synthetic/ are up to date
  python3 addon/tools/synthetic.py fixtures [--write]
        the few synthetic strings the Lua tests read (a night, three awards strings, expected.json)

The preview here (`preview`) is a reference for spec section 6.3 and docs/design/award-import.md, not the app: the app's
importer is LOOT-005. It models what the app holds as a small JSON (the roster, the priorities and the awards imported or
typed so far).

Standard library only. This file is plain ASCII.
"""

import argparse
import copy
import json
import random
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import exchange_fixtures as ef  # noqa: E402

DAY = 86400
ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"

FIRST = ["Jorren", "Mirelle", "Tavian", "Orla", "Selwyn", "Pell", "Kessa", "Brannoch", "Elsith", "Faro", "Gwenna", "Halric",
         "Ilsa", "Jory", "Kell", "Lorna", "Marrek", "Nessa", "Osric", "Perrin", "Quill", "Rhosyn", "Sorrel", "Talia", "Ulf",
         "Vessa", "Wystan", "Yara", "Zeb", "Aldwin"]
LAST = ["Ashvale", "Dunmore", "Holt", "Finch", "Crake", "Marrow", "Drummond", "Veil", "Blackwater", "Thornfield", "Oakhart",
        "Stonebrook", "Fairlow", "Hartwell", "Ironwood", "Lakeshore", "Moorcroft", "Nightingale", "Redfern", "Quillon"]
NOUNS = ["Blade", "Cloak", "Helm", "Gauntlets", "Ring", "Staff", "Band", "Boots", "Shield", "Crown", "Mantle", "Bracers",
         "Wand", "Pendant", "Greaves", "Tome", "Girdle", "Spaulders"]
OFS = ["the Fixture", "Quiet Mornings", "the Test Hall", "Many Commas", "the Hollow Lantern", "Borrowed Light", "Idle Thunder",
       "the Last Rehearsal", "Small Mercies", "Paper Dragons", "the Dry Run", "Faint Applause"]
BOSSES = ["Grimtooth the Test Boss", "Madam Placeholder", "The Sample Hydra", "Warden of Fixtures", "Lord Lorem",
          "Keeper of Drafts", "Ashenmaw the Unfinished", "Sir Rehearsal"]
CLASSES = {
    "Warrior": ["Tank", "Melee"], "Paladin": ["Tank", "Healer", "Melee"], "Hunter": ["Ranged"], "Rogue": ["Melee"],
    "Priest": ["Healer", "Ranged"], "Shaman": ["Healer", "Melee", "Ranged"], "Mage": ["Ranged"], "Warlock": ["Ranged"],
    "Druid": ["Tank", "Healer", "Melee", "Ranged"],
}
CATEGORIES = ["Error", "Skipped", "Stale", "Duplicate", "Conflict", "Possible duplicate", "Unmatched", "New"]
MESSAGES = {
    "E_NOT_IM": "This is not an Intrepid Manager string.",
    "E_VERSION": "This string was made by a newer version. Update the addon (or reload the Raid Desk) and try again.",
    "E_KIND": "This is another kind of string than this box takes.",
    "E_ENCODING": "This string uses a format this version cannot read.",
    "E_MALFORMED": "This string is damaged. Copy it again from the source.",
    "E_TRUNCATED": "Only part of the string arrived. Copy it again, all of it.",
    "E_CHARS": "The string contains characters it should not (often a word processor or chat app changed quotes).",
    "E_CHECKSUM": "The string was changed after it was copied. Copy it again from the source.",
    "E_PAYLOAD": "The string is complete but its contents cannot be read.",
    "E_SCHEMA": "This string uses a schema newer than this version reads.",
    "E_MULTIPLE": "More than one string was pasted. Paste one night string.",
}


# ---------------------------------------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------------------------------------

def base36(number):
    if number == 0:
        return "0"
    digits = []
    while number > 0:
        number, rest = divmod(number, 36)
        digits.append(BASE36[rest])
    return "".join(reversed(digits))


def rand_part(rng):
    return "".join(rng.choice(BASE36) for _ in range(4))


def iso_date(seconds):
    return time.strftime("%Y-%m-%d", time.gmtime(seconds))


def one_line(model, kind):
    return ef.string_for(kind, model)


class Ids:
    """Ids that are never used twice in one world. `emulator` roster ids are player-1, player-2, ... as in the Raid Desk's
    local emulator seed; the rest look like Firestore ids (20 characters)."""

    def __init__(self, rng, style):
        self.rng, self.style, self.used = rng, style, set()

    def firestore(self):
        while True:
            value = "".join(self.rng.choice(ALPHABET) for _ in range(20))
            if value not in self.used:
                self.used.add(value)
                return value

    def player(self, k):
        if self.style == "emulator":
            value = f"player-{k}"
            self.used.add(value)
            return value
        return self.firestore()


# ---------------------------------------------------------------------------------------------------------
# The invented world: a night, and what the app already holds
# ---------------------------------------------------------------------------------------------------------

def make_roster(rng, ids, players, size, tricky):
    pairs = [(first, last) for first in FIRST for last in LAST]
    rng.shuffle(pairs)
    tanks, healers = max(1, players // 10), max(2, players // 4)
    roles = ["Tank"] * tanks + ["Healer"] * healers + [("Melee" if i % 2 == 0 else "Ranged") for i in range(players - tanks - healers)]
    roster = []
    for k, role in enumerate(roles, 1):
        first, last = pairs[k - 1]
        entry = {"k": k, "id": ids.player(k), "name": first, "surname": last,
                 "class": rng.choice([c for c, can in CLASSES.items() if role in can]), "role": role}
        if k <= size:
            entry["locked"] = True
        roster.append(entry)
    regular = len(roster)
    if tricky:
        # Entries that test the matching rules of the spec (section 2): no surname, two with one full name, an alt, and
        # a name with letters outside ASCII (matched exactly, case included).
        healer = next(p for p in roster if p["role"] == "Healer")
        extras = [
            {"name": "Wanderer", "class": "Rogue", "role": "Melee"},
            {"name": "Dovan", "surname": "Greywind", "class": "Hunter", "role": "Ranged"},
            {"name": "Dovan", "surname": "Greywind", "class": "Warlock", "role": "Ranged"},
            {"name": "Brisa", "surname": "Wintermere", "class": "Druid", "role": "Healer", "main": healer["k"]},
            {"name": "Zo" + chr(0xEB), "surname": chr(0xC6) + "rinwald", "class": "Mage", "role": "Ranged", "locked": True},
        ]
        for extra in extras:
            k = len(roster) + 1
            roster.append(dict({"k": k, "id": ids.player(k)}, **extra))
    return roster, regular


def item_names(rng, count):
    combos = [f"{noun} of {of}" for noun in NOUNS for of in OFS]
    rng.shuffle(combos)
    return combos[:count]


def read_item_ids(path):
    """Lines of `id` or `id name` (a # starts a comment): the items the priorities should be about."""
    found = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            parts = line.split(None, 1)
            found.append((int(parts[0]), parts[1] if len(parts) > 1 else f"Item {parts[0]}"))
    return found


def full_name(entry):
    return f"{entry['name']} {entry['surname']}" if entry.get("surname") else entry["name"]


def make_award(session, number, at, item_id, item, who=None, pseudo=None, decision=None, priority=None, rng=None,
               raid=None, phase=None, date=None, note=None, delivered=None, how=None):
    """One award in the shape of spec section 6.1. `delivered` is None (assigned) or the seconds after `at`."""
    award = {"id": f"{session}-{number}", "rev": at, "session": session, "at": at, "date": date or iso_date(at)}
    if phase is not None:
        award["phase"] = phase
    if raid:
        award["raid"] = raid
    award["itemId"], award["item"] = item_id, item
    if pseudo:
        award["pseudo"] = pseudo
        award["to"] = "Disenchant" if pseudo == "disenchant" else "Guild bank"
    else:
        award["toId"], award["to"] = who["id"], full_name(who)
    if not decision and priority and not pseudo:
        decision = "council"  # spec draft 3: an award made from a priority says council
    if decision:
        award["decision"] = decision
    if priority:
        award["priority"] = priority["id"]
        for key in ("encounter", "npcId", "zoneId"):
            if key in priority:
                award[key] = priority[key]
    if note:
        award["note"] = note
    if delivered is None:
        award["delivery"] = {"state": "assigned"}
    else:
        award["delivery"] = {"state": "received", "at": at + delivered, "how": how or "master-loot"}
        award["rev"] = at + delivered
    return award


def make_world(seed=1, players=24, items=24, date="2026-12-09", size=20, phase=1, at=None, ids="random", tricky=True,
               prior=4, item_ids=None, roster_json=None):
    """The night model, and the awards the app already holds for it (state)."""
    rng = random.Random(seed)
    at = int(time.time()) if at is None else at
    idgen = Ids(rng, ids)
    if roster_json:
        roster = [dict(p, k=k) for k, p in enumerate(json.loads(Path(roster_json).read_text(encoding="utf-8")), 1)]
        for p in roster:
            if p["k"] <= size:
                p["locked"] = True
        regular = len(roster)
    else:
        roster, regular = make_roster(rng, idgen, players, size, tricky)
    bosses = [{"npcId": 990001 + n, "name": name, "zoneId": 991} for n, name in enumerate(BOSSES)]
    names = item_names(rng, items)
    candidates = roster[:regular]
    priorities = []
    for i in range(items):
        boss = bosses[i % len(bosses)]
        item_id, name = item_ids[i] if item_ids and i < len(item_ids) else (900001 + i, names[i])
        chosen = rng.sample(candidates, min(len(candidates), rng.randint(3, 6)))
        lines = [{"k": p["k"]} for p in chosen]
        if i % 4 == 3:
            lines.append({"text": f"any {rng.choice(list(CLASSES)).lower()} who did not get the {name.split()[0].lower()}"})
        if i % 6 == 5:
            lines.append({"name": "Hesper Quillon"})  # a player who is no longer on the roster
        priority = {"id": idgen.firestore(), "item": name, "itemId": item_id, "encounter": boss["name"], "npcId": boss["npcId"],
                    "zoneId": boss["zoneId"]}
        if i % 3 == 2:
            priority["note"] = "Tanks first, then whoever attends most."
        priority["lines"] = lines
        priorities.append(priority)

    # Earlier awards of this phase, already in the app: the first line of some priorities got its item in an earlier session.
    earlier_start = at - 2 * 3600
    session = f"s-{base36(earlier_start)}-{rand_part(rng)}"
    held = []
    by_k = {p["k"]: p for p in roster}
    for number, index in enumerate(range(0, min(len(priorities), prior * 2), 2), 1):
        if number > prior:
            break
        priority = priorities[index]
        who = by_k[priority["lines"][0]["k"]]
        award = make_award(session, number, earlier_start + number * 240, priority["itemId"], priority["item"], who=who,
                           decision="council", priority=priority, raid=f"raid-{date.replace('-', '')}", phase=phase, date=date,
                           delivered=rng.randint(20, 90), how="master-loot")
        priority["lines"][0]["awarded"] = True
        held.append(award)
    night = {"schema": 1, "id": "n-" + idgen.firestore()[:12], "at": at, "by": "Synthetic/night-1", "phase": phase,
             "raid": {"id": f"raid-{date.replace('-', '')}", "date": date, "name": "Synthetic Test Night", "size": size},
             "known": [{"id": a["id"], "rev": a["rev"]} for a in held], "roster": roster, "bosses": bosses,
             "priorities": priorities}
    world = {"night": night, "held": held, "session_start": at + 600, "seed": seed, "regular": regular,
             "used": {a["itemId"] for a in held}}
    return world


def world_from_night(night):
    """A world around a night that was made elsewhere (the awards command): nothing awarded yet."""
    regular = max([p["k"] for p in night["roster"] if str(p.get("surname", "")).strip(" ")] or [len(night["roster"])])
    return {"night": night, "held": [], "session_start": night["at"] + 600, "seed": 0, "regular": regular, "used": set()}


def app_state(world):
    """What the app is assumed to hold when the night was copied: the roster, the priorities of the phase and the awards
    that were imported already (the `known` ones)."""
    night = world["night"]
    state = {"roster": [{"id": p["id"], "name": p["name"], "surname": p.get("surname", "")} for p in night["roster"]],
             "priorities": [], "awards": []}
    for p in night["priorities"]:
        state["priorities"].append({
            "id": p["id"], "phase": night["phase"], "hidden": False, "item": p["item"], "itemId": p["itemId"],
            "recipientIds": [night["roster"][line["k"] - 1]["id"] for line in p["lines"] if "k" in line],
            "openNote": any("text" in line and not line.get("done") for line in p["lines"]),
        })
    for award in world["held"]:
        state["awards"].append(state_award(award))
    return state


def state_award(award):
    return {"sourceId": award["id"], "sourceRev": award["rev"], "content": copy.deepcopy(award), "editedInApp": False,
            "recipientId": award.get("toId"), "itemId": award["itemId"], "item": award["item"], "awardedAt": award["at"]}


# ---------------------------------------------------------------------------------------------------------
# A session of awards (what the addon's export holds)
# ---------------------------------------------------------------------------------------------------------

def make_session_awards(world, rng, count=12, session_start=None):
    """`count` awards for one loot session: priority awards, a pseudo award at every fifth place, and an off-priority award
    (decided by roll or otherwise) at the seventh and twelfth. Every award is for another item; the items of the night that
    were awarded are remembered in world["used"], so that later sessions take new ones."""
    night = world["night"]
    start = session_start or world["session_start"]
    session = f"s-{base36(start)}-{rand_part(rng)}"
    raid, phase, date = night["raid"]["id"], night["phase"], night["raid"]["date"]
    pool = [p for p in night["priorities"] if p["itemId"] not in world["used"]]
    rng.shuffle(pool)
    roster = {p["k"]: p for p in night["roster"]}
    awards, at = [], start
    for n in range(1, count + 1):
        at += rng.randint(60, 140)
        delivered = None if n in (2, 4, 9, 11) else rng.randint(15, 240)
        how = rng.choice(["master-loot", "master-loot", "trade", "trade", "manual"])
        common = dict(raid=raid, phase=phase, date=date, delivered=delivered, how=how)
        spare = 910000 + start % 9000 + n  # items that are on no priority
        if n % 5 == 0:
            awards.append(make_award(session, n, at, spare, f"Spare Cloth Scrap {spare}",
                                     pseudo=("disenchant" if n % 10 == 5 else "guild-bank"), **common))
        elif n in (7, 12):
            awards.append(make_award(session, n, at, spare, f"Spare Trinket {spare} of the Dry Run",
                                     who=roster[rng.randint(1, world["regular"])], decision=("roll" if n == 7 else "other"), **common))
        else:
            if not pool:
                break
            p = pool.pop()
            world["used"].add(p["itemId"])
            lines = [line for line in p["lines"] if "k" in line and not line.get("awarded")] or [line for line in p["lines"] if "k" in line]
            pick = lines[0] if rng.random() < 0.75 else rng.choice(lines)
            note = "Best in slot for the tank set." if rng.random() < 0.2 else None
            awards.append(make_award(session, n, at, p["itemId"], p["item"], who=roster[pick["k"]],
                                     decision=("council" if rng.random() < 0.5 else None), priority=p, note=note, **common))
    return awards


def awards_model(awards, at, by="Synthetic/awards-1", rng=None, ident=None):
    rng = rng or random.Random(at)
    return {"schema": 1, "id": ident or f"a-{base36(at)}-{rand_part(rng)}", "at": at, "by": by, "awards": awards}


# ---------------------------------------------------------------------------------------------------------
# The reference preview (spec section 6.3): what the importer should say about each award
# ---------------------------------------------------------------------------------------------------------

def roster_names(roster):
    index = {}
    for p in roster:
        if str(p.get("surname", "")).strip(" "):
            index.setdefault(ef.name_key(f"{p['name']} {p['surname']}"), []).append(p)
    return index


def same_item(entry, award):
    if entry.get("itemId") is not None and award.get("itemId") is not None:
        return entry["itemId"] == award["itemId"]
    return ef.name_key(entry.get("item", "")) == ef.name_key(award.get("item", ""))


def differences(old, new):
    """What an award edit could change between the award the app imported (`old`) and a row (`new`): the character,
    the raid date, the decision, the note and the removal (spec section 6.3). Delivery is not stored by the app yet."""
    def who(a):
        return ("id", a.get("toId")) if a.get("toId") else ("name", ef.name_key(a.get("to", "")))
    parts = []
    if who(old) != who(new):
        parts.append("character")
    if old.get("date") != new.get("date") or old.get("raid") != new.get("raid"):
        parts.append("raid date")
    if old.get("decision") != new.get("decision"):
        parts.append("decision")
    if old.get("note") != new.get("note"):
        parts.append("note")
    if (old.get("status") == "removed") != (new.get("status") == "removed"):
        parts.append("removed in the addon" if new.get("status") == "removed" else "restored in the addon")
    return parts


def classify(award, state, names, by_id, by_source):
    """(category, detail) for one award that has no row error, in the order of spec section 6.3."""
    existing = by_source.get(award["id"])
    if award.get("pseudo"):
        return "Skipped", f"pseudo award ({award['pseudo']}): not recorded in the app until pseudo recipients exist"
    if existing is None and award.get("status") == "removed":
        return "Skipped", "removed in the addon before it reached the app"
    if existing:
        if award["rev"] < existing["sourceRev"]:
            return "Stale", "an older copy of an award already imported"
        diff = differences(existing["content"], award)
        if not diff:
            if award["rev"] > existing["sourceRev"]:
                return "Duplicate", "already imported; only the delivery changed, which the app does not store yet"
            return "Duplicate", "already imported"
        what = "differs: " + ", ".join(diff)
        if existing.get("editedInApp"):
            return "Conflict", what + "; changed in the app since the import, no suggestion"
        if award["rev"] == existing["sourceRev"]:
            return "Conflict", what + "; the same revision with other content, no suggestion"
        return "Conflict", what + "; changed in the addon since the import, suggested: use the import's"
    recipient = None
    if not award.get("pseudo"):
        recipient = by_id.get(award["toId"]) if award.get("toId") else None
        if recipient is None and not award.get("toId"):
            found = names.get(ef.name_key(award["to"]), [])
            recipient = found[0] if len(found) == 1 else None
        if recipient is not None:
            for entry in state["awards"]:
                if (entry.get("recipientId") == recipient["id"] and same_item(entry, award)
                        and abs(entry["awardedAt"] - award["at"]) <= DAY):
                    return "Possible duplicate", "the app has an award for this recipient and item within a day: same, new or skip"
        if not award.get("toId") and recipient is None:
            many = len(names.get(ef.name_key(award["to"]), [])) > 1
            return "Unmatched", ("two roster characters have this full name" if many else "no roster character has this full name") + ": a leader picks the character"
    if "priority" in award:
        return "New", f"manual award (decision {award['decision']}); priority {award['priority']} kept for reference only"
    return "New", f"manual award (decision {award.get('decision')})"


def preview(text, state):
    """The importer's preview for pasted text: a list of rows { envelope, id, item, to, category, detail, skip }, or raises
    ef.ReadError. Rows with a row error are category Error with the name the spec gives them."""
    names = roster_names(state["roster"])
    by_id = {p["id"]: p for p in state["roster"]}
    by_source = {e["sourceId"]: e for e in state["awards"] if e.get("sourceId")}
    rows = []
    for number, (model, errors) in enumerate(ef.read_all(text, "awards"), 1):
        bad = set(errors)
        seen = set()
        for index, award in enumerate(model["awards"], 1):
            aid = award.get("id") if isinstance(award, dict) else None
            name = aid if (isinstance(aid, str) and aid not in seen) else f"award:{index}"
            if isinstance(aid, str):
                seen.add(aid)
            row = {"envelope": number, "id": name, "item": str(award.get("item", ""))[:40] if isinstance(award, dict) else "",
                   "to": str(award.get("to", ""))[:40] if isinstance(award, dict) else ""}
            if name in bad:
                row.update(category="Error", detail="a field is missing or wrong (" + (explain_award(award) or "see the spec") + ")", skip=True)
            else:
                category, detail = classify(award, state, names, by_id, by_source)
                # The rehearsal's leader saves the New rows and takes every suggestion; other conflicts stay unanswered.
                row.update(category=category, detail=detail,
                           skip=not (category == "New" or (category == "Conflict" and "suggested: use the import's" in detail)))
            row["award"] = award
            rows.append(row)
    return rows


def explain_award(a):
    """The first thing wrong with an award, in words (the same order of checks as the Lua addon)."""
    if not isinstance(a, dict):
        return "not an object"
    d = a.get("delivery")
    checks = [
        (ef.is_int(a.get("rev")) and a["rev"] >= 1, "rev is missing or not a whole number from 1"),
        (ef.is_int(a.get("at")), "at is missing"),
        (isinstance(a.get("date"), str) and ef.DATE.fullmatch(a["date"]) is not None, "date is missing or not YYYY-MM-DD"),
        (ef.is_game_id(a.get("itemId")), "itemId is missing or out of range"),
        (ef.is_text(a.get("item"), 120), "item is missing or too long"),
        (ef.is_text(a.get("to"), 121), "to is missing or too long"),
        (not (a.get("pseudo") and "toId" in a), "a pseudo award cannot have a toId"),
        (a.get("pseudo") in (None, "disenchant", "guild-bank"), "pseudo is not disenchant or guild-bank"),
        (a.get("decision") in (None, "council", "roll", "other"), "decision is not council, roll or other"),
        ("pseudo" in a or "decision" in a, "an award that is not a pseudo award needs a decision"),
        (isinstance(d, dict) and (d.get("state") == "assigned" or (d.get("state") == "received" and ef.is_int(d.get("at"))
                                                                  and d.get("how") in ("master-loot", "trade", "manual"))),
         "delivery is missing or wrong"),
        (a.get("status") in (None, "removed"), "status is not removed"),
    ]
    for ok, why in checks:
        if not ok:
            return why
    return None


def apply_rows(state, rows):
    """The state after the leader saves the New rows and the conflicts with a suggestion ("use the import's")."""
    state = copy.deepcopy(state)
    names = roster_names(state["roster"])
    by_source = {e["sourceId"]: e for e in state["awards"] if e.get("sourceId")}
    for row in rows:
        if row["skip"]:
            continue
        award = row["award"]
        if row["category"] == "Conflict":
            by_source[award["id"]].update(sourceRev=award["rev"], content=copy.deepcopy(award))
        elif row["category"] == "New":
            entry = state_award(award)
            if award.get("pseudo"):
                entry["recipientId"] = None
            elif not award.get("toId"):
                found = names.get(ef.name_key(award["to"]), [])
                entry["recipientId"] = found[0]["id"] if len(found) == 1 else None
            state["awards"].append(entry)
    return state


def counts(rows):
    result = {}
    for row in rows:
        result[row["category"]] = result.get(row["category"], 0) + 1
    return result


# ---------------------------------------------------------------------------------------------------------
# The rehearsal: a series of pastes that walks through every row category
# ---------------------------------------------------------------------------------------------------------

def bump(award, at, **changes):
    """A later revision of an award: the changes, and a revision above the old one."""
    new = copy.deepcopy(award)
    for key, value in changes.items():
        if value is None:
            new.pop(key, None)
        else:
            new[key] = value
    new["rev"] = max(award["rev"] + 1, at)
    return new


def rehearsal(world, seed=1):
    """The steps of the rehearsal: each has a file name, the pasted text, what to do and what the preview must show."""
    rng = random.Random(seed * 1000 + 7)
    night = world["night"]
    state = app_state(world)
    by_id = {p["id"]: p for p in night["roster"]}
    base = make_session_awards(world, rng)
    export_at = base[-1]["rev"] + 300
    raid, phase, date = night["raid"]["id"], night["phase"], night["raid"]["date"]
    steps = []

    def add(file, title, text, before=None, manual=None, note=""):
        nonlocal state
        if before:
            before(state)
        rows = preview(text, state)
        steps.append({"file": file, "title": title, "text": text, "manual": manual, "note": note, "rows": rows,
                      "counts": counts(rows), "state_before": copy.deepcopy(state)})
        state = apply_rows(state, rows)

    def text_of(awards, at=None, ident=None):
        return one_line(awards_model(awards, at or export_at, rng=random.Random(export_at), ident=ident), "awards")

    add("awards-01-first-export.txt", "The first export of the night", text_of(base),
        note="Every award is new except the two pseudo awards (Disenchant, Guild bank), which are Skipped until pseudo recipients exist.")
    add("awards-02-same-again.txt", "The same export again", text_of(base),
        note="Importing a string twice adds nothing: every saved row is a duplicate, and the pseudo awards are still Skipped.")

    # A later export: three deliveries, a note, a removal, three new awards.
    later = copy.deepcopy(base)
    changed = [i for i, a in enumerate(later) if a["delivery"]["state"] == "assigned"][:3]
    for i in changed:
        later[i] = bump(later[i], export_at + 400, delivery={"state": "received", "at": export_at + 400, "how": "trade"})
    plain = [i for i, a in enumerate(later) if i not in changed and a.get("note") is None and "priority" in a]
    later[plain[0]] = bump(later[plain[0]], export_at + 410, note="Council changed its mind about the tank set.")
    later[plain[1]] = bump(later[plain[1]], export_at + 420, status="removed")
    session2 = make_session_awards(world, random.Random(seed * 1000 + 8), count=3, session_start=export_at + 900)
    assert len(changed) == 3 and len(plain) >= 2 and len(session2) == 3, "the world is too small for the rehearsal"
    later_text = text_of(later + session2, export_at + 1500)
    add("awards-03-later-export.txt", "A later export: changes, a removal and new awards", later_text,
        note=("Five awards changed in the addon. The note and the removal are conflicts with the suggestion \"use the import's\"; "
              "the three deliveries are duplicates, because the app does not store delivery yet. Three are new."))

    add("awards-04-older-export.txt", "The first export pasted again after the later one", text_of(base),
        note="An older export pasted after a newer one: the two awards changed by the conflicts taken in the step before are stale, the rest are duplicates.")

    # Conflicts: the same id and revision with different content.
    twin = [a for a in later if a.get("toId") and a["id"] not in {later[i]["id"] for i in changed}][:2]
    conflicting = []
    for a in twin:
        other = next(p for p in night["roster"] if p["id"] != a["toId"] and p.get("surname") and p["k"] <= world["regular"])
        c = copy.deepcopy(a)
        c["toId"], c["to"] = other["id"], full_name(other)
        conflicting.append(c)
    steady = [a for a in later[:4] if a not in twin][:2]
    add("awards-05-conflict.txt", "The same id and revision with different content", text_of(conflicting + steady, export_at + 1600),
        note="Two awards carry another recipient than the app has for the same revision: conflicts with no suggestion. The others are duplicates.")

    edited = next(a for a in later if "priority" in a and a["id"] not in {x["id"] for x in conflicting} and a.get("status") != "removed")
    edited_new = bump(edited, export_at + 1800, note="Addon note after the leader edited this award.")

    def edit_in_app(st):
        for e in st["awards"]:
            if e["sourceId"] == edited["id"]:
                e["editedInApp"] = True

    add("awards-05b-conflict-edited-in-app.txt", "A newer revision of an award a leader edited in the app",
        text_of([edited_new], export_at + 1900), before=edit_in_app,
        manual=f"First edit the note of the award for \"{edited['item']}\" in the app (any change), then paste.",
        note="A higher revision for an award that was edited in the app since it was imported: a conflict with no suggestion, never overwritten silently.")

    # The edge rows.
    rows_in = []
    n = 100
    session_edge = f"s-{base36(export_at + 3000)}-{rand_part(rng)}"
    regular = [p for p in night["roster"] if p["k"] <= world["regular"]]
    prios = [p for p in night["priorities"] if p["itemId"] not in world["used"]]
    open_note = next((p for p in prios if any("text" in x for x in p["lines"])), None)
    plain_prio = next((p for p in prios if not any("text" in x for x in p["lines"]) and p is not open_note), prios[-1])
    world["used"].update(p["itemId"] for p in (open_note, plain_prio) if p)
    off_list = next(p for p in regular if all(p["k"] != line.get("k") for line in plain_prio["lines"]))
    edge_at = export_at + 3000

    def edge(label, **kw):
        nonlocal n
        n += 1
        at = edge_at + n
        award = make_award(session_edge, n - 100, at, kw.pop("item_id", 900900 + n), kw.pop("item", f"Edge Case Item {n - 100}"),
                           raid=raid, phase=phase, date=date, delivered=kw.pop("delivered", None), **kw)
        rows_in.append((label, award))
        return award

    jorren = regular[0]
    edge("a name that is on no roster", who={"id": "unused", "name": "Nobody", "surname": "Atall"}, decision="roll").pop("toId")
    edge("a roster entry without a surname", who={"id": "unused", "name": "Wanderer"}, decision="roll").pop("toId")
    edge("two roster entries with one full name", who={"id": "unused", "name": "Dovan", "surname": "Greywind"}, decision="roll").pop("toId")
    zo = next(p for p in night["roster"] if p["name"] == "Zo" + chr(0xEB))
    edge("non-ASCII letters, exact match", who={"id": "unused", "name": zo["name"], "surname": zo["surname"]}, decision="roll").pop("toId")
    shout = edge("the same non-ASCII name with another case", who={"id": "unused", "name": zo["name"], "surname": zo["surname"]}, decision="roll")
    shout.pop("toId")
    shout["to"] = "Zo" + chr(0xCB) + " " + chr(0xC6) + "rinwald"
    loud = edge("ASCII case and extra spaces", who={"id": "unused", "name": jorren["name"], "surname": jorren["surname"]}, decision="other")
    loud.pop("toId")
    loud["to"] = "  " + jorren["name"].upper() + "    " + jorren["surname"].lower() + " "
    gone = {"id": "pr-deleted-after-copy", "encounter": "Grimtooth the Test Boss", "npcId": 990001, "zoneId": 991}
    edge("a priority that no longer exists: a manual award, the priority kept for reference", who=regular[1], decision="council",
         priority=gone)
    edge("a recipient who is not on the priority's list: a manual award like any other", who=off_list, priority=plain_prio,
         item_id=plain_prio["itemId"], item=plain_prio["item"])
    edge("a pseudo award that names a priority", pseudo="guild-bank", decision="other", priority=plain_prio)
    removed = edge("an award removed before the app ever saw it", who=regular[3], decision="roll")
    removed["status"] = "removed"
    removed["rev"] += 5
    dupe_target = regular[4]
    edge("typed into the app by hand while the addon was away", who=dupe_target, decision="roll", item_id=900777, item="Typed By Hand Trinket")
    # Rows with an error of their own
    one = edge("an award without an item name", who=regular[6], decision="roll")
    one.pop("item")
    two = edge("a received award without how", who=regular[7], decision="roll", delivered=30)
    two["delivery"] = {"state": "received", "at": two["at"] + 30}
    three = edge("an award with nothing that says how it was decided", who=regular[8])
    four = edge("a pseudo award with a toId", pseudo="disenchant")
    four["toId"] = regular[9]["id"]
    edge_awards = [award for _, award in rows_in]
    manual = {"sourceId": None, "sourceRev": None, "content": None, "editedInApp": False, "recipientId": dupe_target["id"],
              "itemId": 900777, "item": "Typed By Hand Trinket", "awardedAt": edge_at + 100 - 3600}

    def edge_state(st):
        st["awards"].append(manual)

    edge_text = text_of(edge_awards, edge_at + 400)
    add("awards-06-edge-rows.txt", "One row of every unusual kind", edge_text, before=edge_state,
        manual=(f"The app must hold one award typed by hand: {full_name(dupe_target)} got \"Typed By Hand Trinket\" on the night "
                f"(any decision). It is in states/awards-06-edge-rows.json."),
        note="Each row shows its own category; the labels of the rows are in README.md.")
    steps[-1]["edge_labels"] = [label for label, _ in rows_in]

    # Two loot masters pasted together.
    a = make_session_awards(world, random.Random(seed * 1000 + 21), count=3, session_start=export_at + 6000)
    b = make_session_awards(world, random.Random(seed * 1000 + 22), count=3, session_start=export_at + 6600)
    two_text = text_of(a, export_at + 7000) + "\n" + text_of(b, export_at + 7200)
    add("awards-07-two-loot-masters.txt", "Two loot masters' strings pasted at once", two_text,
        note="The importer reads every string it finds and previews them together: six new awards.")

    return steps, state


def broken_strings(good_awards, good_night):
    """Strings an importer must refuse, and the code each must give."""
    out = {}
    payload_start = good_awards.index(":", good_awards.index(":", good_awards.index(":", 4) + 1) + 1) + 1
    flipped = good_awards[:payload_start + 30] + ("x" if good_awards[payload_start + 30] != "x" else "y") + good_awards[payload_start + 31:]
    out["broken-checksum.txt"] = (flipped, "E_CHECKSUM")
    out["broken-truncated.txt"] = (good_awards[:-25], "E_TRUNCATED")
    out["broken-smart-quote.txt"] = (good_awards.replace('"', chr(0x201C), 1), "E_CHARS")
    out["broken-wrong-box.txt"] = (good_night, "E_KIND")
    out["broken-newer-envelope.txt"] = ("IM2" + good_awards[3:], "E_VERSION")
    out["broken-not-ours.txt"] = ("hello, this is not a string", "E_NOT_IM")
    return out


def wrapped(text, width=100):
    return "\n".join(text[i:i + width] for i in range(0, len(text), width))


# ---------------------------------------------------------------------------------------------------------
# The pack
# ---------------------------------------------------------------------------------------------------------

def write_pack(directory, seed, options):
    if options.get("items", 24) < 24 or options.get("players", 24) < 12:
        raise SystemExit("the pack needs at least 12 players and 24 items (priorities): the rehearsal awards a different item each time")
    options = dict(options)
    if options.get("at") is None:
        options["at"] = int(time.time())  # fixed here, so that the README can say how to make the same pack again
    world = make_world(seed=seed, **options)
    steps, final = rehearsal(world, seed)
    night_text = one_line(world["night"], "night")
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    expected = {"seed": seed, "nightId": world["night"]["id"], "files": {}}
    (directory / "night.txt").write_text(night_text + "\n", encoding="utf-8")
    (directory / "states").mkdir(exist_ok=True)
    for step in steps:
        (directory / step["file"]).write_text(step["text"] + "\n", encoding="utf-8")
        state_file = "states/" + step["file"].replace(".txt", ".json")
        (directory / state_file).write_text(json.dumps(step["state_before"], indent=1) + "\n", encoding="utf-8")
        expected["files"][step["file"]] = {
            "title": step["title"], "stateBefore": state_file, "counts": step["counts"],
            "rows": [{"id": r["id"], "category": r["category"], "detail": r["detail"]} for r in step["rows"]],
        }
    first_text = steps[0]["text"]
    broken = broken_strings(first_text, night_text)
    for name, (text, code) in broken.items():
        (directory / name).write_text(text + "\n", encoding="utf-8")
        expected["files"][name] = {"title": "Must be refused", "error": code}
    (directory / "good-wrapped-by-chat.txt").write_text(wrapped(first_text) + "\n", encoding="utf-8")
    expected["files"]["good-wrapped-by-chat.txt"] = {"title": "Line breaks added by a chat window: still reads", "counts": steps[0]["counts"]}
    (directory / "expected.json").write_text(json.dumps(expected, indent=1) + "\n", encoding="utf-8")
    (directory / "README.md").write_text(readme(world, steps, seed, options, broken), encoding="utf-8")
    return world, steps, expected


def regenerate_command(seed, options):
    parts = ["python3 addon/tools/synthetic.py pack", f"--seed {seed}", f"--players {options['players']}", f"--items {options['items']}",
             f"--date {options['date']}", f"--size {options['size']}", f"--phase {options['phase']}", f"--at {options['at']}"]
    if options.get("ids") == "emulator":
        parts.append("--emulator")
    if not options.get("tricky", True):
        parts.append("--plain")
    if options.get("item_ids"):
        parts.append("--item-ids <the same list of items>")
    if options.get("roster_json"):
        parts.append("--roster-json <the same roster file>")
    return " ".join(parts) + " --dir <folder>"


def readme(world, steps, seed, options, broken):
    night = world["night"]
    lines = [
        "# Synthetic raid night: a rehearsal pack", "",
        f"Seed {seed}. Everything is invented (players, items, bosses, ids). The same command makes the same files again: "
        f"`{regenerate_command(seed, options)}`.", "",
        f"The night: {night['raid']['name']} on {night['raid']['date']}, phase {night['phase']}, {len(night['roster'])} roster entries, "
        f"{len(night['priorities'])} priorities, {len(night['known'])} awards the app already holds (the `known` list). "
        "The roster has a few awkward entries on purpose: one without a surname, two with one full name, an alt, and a name with "
        "letters outside ASCII.", "",
        "## 1. The addon (app to addon)", "",
        "`night.txt` is a night string, what the Raid Desk's \"Copy for addon\" will make. Paste it into the addon's import box "
        "(`/im window import` shows the window today). It should read, and say how many players and priorities it holds.", "",
        "## 2. The Raid Desk importer (addon to app)", "",
        "The importer is LOOT-005 and is not built yet. These files are what it has to handle. Paste them **in this order**; "
        "after each paste save the New rows and take every suggested conflict choice (\"use the import's\"). The folder `states/` has, for "
        "each file, the state the expected results assume just before that paste: the roster and priorities of the night, "
        "and the awards imported so far. `expected.json` lists the rows each paste must give.", "",
        "The awards carry the roster ids and priority ids of **this** invented night. A real app only knows them if it was "
        "filled from the same data (a test guild seeded from `states/awards-01-first-export.json`, or an importer unit test "
        "that is given that state). Against a real guild, make a night with its own \"Copy for addon\" string and run "
        "`python3 addon/tools/synthetic.py awards --night <that string's file>` to get awards that fit it.", "",
        "| File | What it is | Expected preview |", "| --- | --- | --- |",
    ]
    for step in steps:
        lines.append(f"| `{step['file']}` | {step['title']} | {', '.join(f'{v} {k}' for k, v in step['counts'].items())} |")
    lines += ["", "Notes per file:", ""]
    for step in steps:
        lines.append(f"- **`{step['file']}`** {step['note']}" + (f" _Manual step: {step['manual']}_" if step["manual"] else ""))
    edge = next(s for s in steps if "edge_labels" in s)
    lines += ["", "### The rows of `awards-06-edge-rows.txt`, in order", "", "| # | Row | Category | What the preview says |", "| --- | --- | --- | --- |"]
    for index, (label, row) in enumerate(zip(edge["edge_labels"], edge["rows"]), 1):
        lines.append(f"| {index} | {label} | {row['category']} | {row['detail']} |")
    lines += [
        "", "One row depends on an award typed by hand: a real database can only be put into that state by hand. "
        "`states/awards-06-edge-rows.json` is the state the reference preview assumed.", "",
        "## 3. Strings that must be refused", "",
        "| File | Must give |", "| --- | --- |",
    ]
    for name, (_, code) in broken.items():
        message = kind_message("night", "awards") if code == "E_KIND" else MESSAGES[code]
        lines.append(f"| `{name}` | {code}: {message} |")
    lines += ["| `good-wrapped-by-chat.txt` | Reads normally: line breaks are removed before anything else. |", "",
              "## 4. Check what the addon exported", "",
              "Copy the awards string from the addon's export window and run `python3 addon/tools/synthetic.py check --clipboard` "
              "(`--night night.txt --state states/awards-01-first-export.json` adds the preview).", ""]
    return "\n".join(lines)


# ---------------------------------------------------------------------------------------------------------
# Fixtures for the Lua tests: the same world every time
# ---------------------------------------------------------------------------------------------------------

FIXTURE_DIR = ef.FIXTURES / "synthetic"
FIXTURE_SEED = 7
FIXTURE_OPTIONS = dict(players=24, items=24, date="2026-12-09", size=20, phase=1, at=1796866200, ids="random", tricky=True,
                       prior=4, item_ids=None, roster_json=None)
FIXTURE_FILES = {"awards-01-first-export.txt": "awards-first.j.txt", "awards-03-later-export.txt": "awards-later.j.txt",
                 "awards-06-edge-rows.txt": "awards-edge.j.txt"}


def fixture_files():
    """name -> text of the committed fixtures: a night, three awards strings, and what a reader must find in them."""
    world = make_world(seed=FIXTURE_SEED, **FIXTURE_OPTIONS)
    steps, _ = rehearsal(world, FIXTURE_SEED)
    night_text = one_line(world["night"], "night")
    model, night_errors = ef.read(night_text, "night")
    files = {"night.j.txt": night_text + "\n"}
    expected = {"night": {"roster": len(model["roster"]), "priorities": len(model["priorities"]), "known": len(model["known"]),
                          "rowErrors": night_errors, "phase": model["phase"]}}
    for step in steps:
        if step["file"] in FIXTURE_FILES:
            short = FIXTURE_FILES[step["file"]]
            files[short] = step["text"] + "\n"
            envelopes = ef.read_all(step["text"], "awards")
            expected[short] = {"awards": len(envelopes[0][0]["awards"]), "rowErrors": sorted(envelopes[0][1]), "preview": step["counts"]}
    files["expected.json"] = json.dumps(expected, indent=1, sort_keys=True) + "\n"
    return files


def fixtures(write):
    """The names of the fixture files that are out of date (and written afresh when `write`)."""
    wanted = fixture_files()
    stale = []
    for name, text in wanted.items():
        path = FIXTURE_DIR / name
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            stale.append(name)
            if write:
                FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8")
    for path in sorted(FIXTURE_DIR.glob("*")) if FIXTURE_DIR.exists() else []:
        if path.name not in wanted:
            stale.append(path.name)
            if write:
                path.unlink()
    return stale


# ---------------------------------------------------------------------------------------------------------
# check: read a pasted string and say what it holds
# ---------------------------------------------------------------------------------------------------------

def kind_message(found, expected):
    """E_KIND as the spec words it (section 1.1)."""
    article = "an" if found[0] in "aeiou" else "a"
    tail = "Paste night strings into the addon." if found == "night" else "Paste awards strings into the Raid Desk importer."
    return f"This is {article} {found} string; this box takes {expected} strings. {tail}"


def find_kind(text):
    data = text.replace("\r", "").replace("\n", "").replace("\t", "")
    start = data.find("IM1:")
    if start < 0:
        return None
    parts = data[start + 4:].split(":", 2)
    return parts[0] if parts and parts[0] in ("night", "awards") else None


def describe_night(model, errors):
    lines = [f"  made by {model.get('by')}, id {model.get('id')}, phase {model.get('phase')}",
             f"  {len(model['roster'])} roster entries, {len(model['priorities'])} priorities, {len(model.get('known', []))} known awards, "
             f"{len(model.get('bosses', []))} bosses"]
    if model.get("raid"):
        raid = model["raid"]
        lines.append(f"  raid {raid.get('name')} on {raid.get('date')} ({raid.get('size')} players)")
    unnamed = [p for p in model["roster"] if not str(p.get("surname", "")).strip(" ")]
    if unnamed:
        lines.append(f"  {len(unnamed)} roster entries have no surname and match no game character")
    return lines


def describe_awards(model, errors):
    awards = [a for a in model["awards"] if isinstance(a, dict)]
    by_decision = {}
    for a in awards:
        key = "pseudo " + a["pseudo"] if a.get("pseudo") else (a.get("decision") or ("priority" if a.get("priority") else "?"))
        by_decision[key] = by_decision.get(key, 0) + 1
    delivery = {}
    for a in awards:
        d = a.get("delivery") or {}
        key = d.get("state", "?") + (f" ({d.get('how')})" if d.get("how") else "")
        delivery[key] = delivery.get(key, 0) + 1
    removed = sum(1 for a in awards if a.get("status") == "removed")
    return [f"  made by {model.get('by')}, id {model.get('id')}, at {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(model.get('at', 0)))} UTC",
            "  by decision: " + ", ".join(f"{k} {v}" for k, v in sorted(by_decision.items())),
            "  delivery: " + ", ".join(f"{k} {v}" for k, v in sorted(delivery.items())) + (f"; removed {removed}" if removed else "")]


def check_text(text, night_path=None, state_path=None, out=print, expect=None):
    """Returns the number of problems found (0: it reads and has no row errors). `expect` is the kind the box takes."""
    kind = find_kind(text)
    if expect and kind and kind != expect:
        out(f"cannot read it: E_KIND: {kind_message(kind, expect)}")
        return 1
    if kind is None:
        try:
            ef.read_all(text, "awards")
        except ef.ReadError as error:
            out(f"cannot read it: {error.code}: {MESSAGES.get(error.code, '')}")
            return 1
    problems = 0
    try:
        envelopes = ef.read_all(text, kind)
    except ef.ReadError as error:
        out(f"cannot read it: {error.code} {error.args[0][len(error.code):].strip()}: {MESSAGES.get(error.code, '')}")
        return 1
    out(f"{kind} string: {len(envelopes)} envelope{'s' if len(envelopes) != 1 else ''}, it reads")
    for number, (model, errors) in enumerate(envelopes, 1):
        if len(envelopes) > 1:
            out(f"envelope {number}:")
        for line in (describe_night if kind == "night" else describe_awards)(model, errors):
            out(line)
        if errors:
            problems += len(errors)
            out(f"  {len(errors)} row error{'s' if len(errors) != 1 else ''}: {', '.join(errors)}")
            if kind == "awards":
                for index, award in enumerate(model["awards"], 1):
                    aid = award.get("id") if isinstance(award, dict) else None
                    if aid in errors or f"award:{index}" in errors:
                        out(f"    {aid or f'award:{index}'}: {explain_award(award)}")
    if kind == "awards" and state_path:
        state = json.loads(Path(state_path).read_text(encoding="utf-8"))
        rows = preview(text, state)
        out("preview against the state:")
        for row in rows:
            out(f"  {row['category']:<18} {row['id']:<24} {row['item']:<30} {row['to']:<22} {row['detail']}")
        out("  " + ", ".join(f"{v} {k}" for k, v in counts(rows).items()))
    if kind == "awards" and night_path:
        night = ef.read(Path(night_path).read_text(encoding="utf-8"), "night")[0]
        priorities = {p["id"] for p in night["priorities"]}
        ids = {p["id"] for p in night["roster"]}
        awards = [a for model, _ in envelopes for a in model["awards"] if isinstance(a, dict)]
        out(f"against the night: {sum(1 for a in awards if a.get('toId') in ids)} of {sum(1 for a in awards if a.get('toId'))} "
            f"recipients are on its roster, {sum(1 for a in awards if a.get('priority') in priorities)} of "
            f"{sum(1 for a in awards if a.get('priority'))} priorities are in it")
    return problems


# ---------------------------------------------------------------------------------------------------------
# The command line
# ---------------------------------------------------------------------------------------------------------

def world_options(args):
    options = {"players": args.players, "items": args.items, "date": args.date, "size": args.size, "phase": args.phase,
               "at": args.at, "ids": "emulator" if args.emulator else "random", "tricky": not args.plain,
               "item_ids": read_item_ids(args.item_ids) if args.item_ids else None, "roster_json": args.roster_json}
    return options


def add_world_args(parser):
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--players", type=int, default=24)
    parser.add_argument("--items", type=int, default=24)
    parser.add_argument("--date", default=time.strftime("%Y-%m-%d"))
    parser.add_argument("--size", type=int, default=20, choices=[10, 20, 40])
    parser.add_argument("--phase", type=int, default=1)
    parser.add_argument("--at", type=int, default=None, help="seconds since 1970 (default: now)")
    parser.add_argument("--item-ids", help="a file with lines `itemId name`: the priorities are about these items")
    parser.add_argument("--roster-json", help="a JSON list of {id, name, surname, class, role} to use as the roster")
    parser.add_argument("--emulator", action="store_true", help="roster ids player-1, player-2, ... as in the Raid Desk emulator seed")
    parser.add_argument("--plain", action="store_true", help="leave out the awkward roster entries")


def emit(text, out):
    if out:
        Path(out).write_text(text + "\n", encoding="utf-8")
        print(f"wrote {out} ({len(text):,} characters)", file=sys.stderr)
    else:
        print(text)


def selftest():
    failures = []

    def expect(ok, what):
        if not ok:
            failures.append(what)

    options = dict(players=24, items=24, date="2026-12-09", size=20, phase=1, at=1796866200, ids="random", tricky=True,
                   prior=4, item_ids=None, roster_json=None)
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        world, steps, expected = write_pack(tmp, 7, {k: v for k, v in options.items()})
        again = write_pack(Path(tmp) / "again", 7, dict(options))[2]
        expect(json.dumps(expected, sort_keys=True) == json.dumps(again, sort_keys=True), "the pack is not deterministic")
        for step in steps:
            text = step["text"]
            try:
                envelopes = ef.read_all(text, "awards")
            except ef.ReadError as error:
                failures.append(f"{step['file']} does not read: {error}")
                continue
            if step["file"] != "awards-06-edge-rows.txt":
                expect(all(not errors for _, errors in envelopes), f"{step['file']} has row errors")
        # the counts the README promises
        by_file = {s["file"]: s["counts"] for s in steps}
        expect(by_file["awards-01-first-export.txt"] == {"New": 10, "Skipped": 2}, f"01: {by_file['awards-01-first-export.txt']}")
        expect(by_file["awards-02-same-again.txt"] == {"Duplicate": 10, "Skipped": 2}, f"02: {by_file['awards-02-same-again.txt']}")
        expect(by_file["awards-03-later-export.txt"] == {"Conflict": 2, "Duplicate": 8, "Skipped": 2, "New": 3}, f"03: {by_file['awards-03-later-export.txt']}")
        expect(by_file["awards-04-older-export.txt"] == {"Stale": 2, "Duplicate": 8, "Skipped": 2}, f"04: {by_file['awards-04-older-export.txt']}")
        expect(by_file["awards-05-conflict.txt"] == {"Conflict": 2, "Duplicate": 2}, f"05: {by_file['awards-05-conflict.txt']}")
        expect(by_file["awards-05b-conflict-edited-in-app.txt"] == {"Conflict": 1}, f"05b: {by_file['awards-05b-conflict-edited-in-app.txt']}")
        expect(by_file["awards-07-two-loot-masters.txt"] == {"New": 6}, f"07: {by_file['awards-07-two-loot-masters.txt']}")
        edge = next(s for s in steps if s["file"] == "awards-06-edge-rows.txt")
        categories = {c for c in (r["category"] for r in edge["rows"])}
        expect({"Unmatched", "Possible duplicate", "New", "Skipped", "Error"} <= categories, f"06 categories: {categories}")
        # the broken strings give the codes they promise
        for name, (text, code) in broken_strings(steps[0]["text"], one_line(world["night"], "night")).items():
            try:
                ef.read_all(text, "awards")
                failures.append(f"{name} was accepted")
            except ef.ReadError as error:
                expect(error.code == code, f"{name}: {error.code} instead of {code}")
        said = []
        expect(check_text(one_line(world["night"], "night"), out=said.append, expect="awards") == 1 and "E_KIND" in said[0],
               "check --expect awards accepted a night")
        wrapped_ok = ef.read_all(wrapped(steps[0]["text"]), "awards")
        expect(len(wrapped_ok[0][0]["awards"]) == 12, "the wrapped string does not read")
        # the night reads, for the box of the addon
        try:
            model, errors = ef.read(one_line(world["night"], "night"), "night")
            expect(not errors, f"night row errors: {errors}")
        except ef.ReadError as error:
            failures.append(f"the night does not read: {error}")
    # other seeds and sizes make strings that read
    for seed in range(1, 9):
        for players, items in ((12, 24), (24, 30), (40, 60)):
            world = make_world(seed=seed, players=players, items=items, date="2026-12-09", size=20, at=1796866200)
            try:
                _, errors = ef.read(one_line(world["night"], "night"), "night")
                expect(not errors, f"seed {seed} {players}x{items}: night row errors {errors}")
                steps, _ = rehearsal(world, seed)
                for step in steps:
                    if step["file"] != "awards-06-edge-rows.txt":
                        for _, errs in ef.read_all(step["text"], "awards"):
                            expect(not errs, f"seed {seed} {step['file']}: row errors {errs}")
            except (ef.ReadError, StopIteration, IndexError, KeyError) as error:
                failures.append(f"seed {seed} {players}x{items}: {type(error).__name__} {error}")
    stale = fixtures(write=False)
    if stale:
        failures.append("out of date (run: python3 addon/tools/synthetic.py fixtures --write): " + ", ".join(stale))
    if failures:
        print("synthetic selftest FAILED:\n  " + "\n  ".join(failures))
        sys.exit(1)
    print("synthetic selftest ok: the pack is deterministic, every string reads, the previews give the counts the README says, "
          "the broken strings give their codes")


def main():
    parser = argparse.ArgumentParser(description="Synthetic nights and awards for rehearsing the Raid Desk import.")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("night")
    add_world_args(p)
    p.add_argument("--out")
    p = sub.add_parser("awards")
    p.add_argument("--night", required=True)
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--count", type=int, default=12)
    p.add_argument("--out")
    p = sub.add_parser("pack")
    add_world_args(p)
    p.add_argument("--dir", default="synthetic-pack")
    p = sub.add_parser("check")
    p.add_argument("file", nargs="?", default="-")
    p.add_argument("--clipboard", action="store_true")
    p.add_argument("--night")
    p.add_argument("--state")
    p.add_argument("--expect", choices=["night", "awards"], help="the kind of string the box takes: another kind is refused (E_KIND)")
    sub.add_parser("selftest")
    p = sub.add_parser("fixtures")
    p.add_argument("--write", action="store_true")
    args = parser.parse_args()

    if args.command == "night":
        options = world_options(args)
        world = make_world(seed=args.seed, **options)
        emit(one_line(world["night"], "night"), args.out)
    elif args.command == "awards":
        night = ef.read(Path(args.night).read_text(encoding="utf-8"), "night")[0]
        awards = make_session_awards(world_from_night(night), random.Random(args.seed), count=args.count)
        emit(one_line(awards_model(awards, awards[-1]["rev"] + 300, rng=random.Random(args.seed)), "awards"), args.out)
    elif args.command == "pack":
        options = world_options(args)
        world, steps, expected = write_pack(args.dir, args.seed, options)
        print(f"wrote {len(expected['files']) + 3} files to {args.dir}; start with README.md")
    elif args.command == "check":
        if args.clipboard:
            text = subprocess.run(["pbpaste"], capture_output=True, text=True, check=True).stdout
        elif args.file == "-":
            text = sys.stdin.read()
        else:
            text = Path(args.file).read_text(encoding="utf-8")
        sys.exit(1 if check_text(text, args.night, args.state, expect=args.expect) else 0)
    elif args.command == "selftest":
        selftest()
    elif args.command == "fixtures":
        stale = fixtures(write=args.write)
        print((f"{len(stale)} fixture files " + ("written or removed" if args.write else "out of date: " + ", ".join(stale))) if stale
              else "fixtures already up to date")
        if stale and not args.write:
            sys.exit(1)


if __name__ == "__main__":
    main()
