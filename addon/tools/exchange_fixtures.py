#!/usr/bin/env python3
"""Reference implementation of the exchange strings in docs/spec/exchange-v0.md.

Builds the fixtures from docs/spec/fixtures/*.model.json: the good strings, the broken strings readers must
reject (cases/cases.json says what each must give) and the awarded-marks cases (marks-cases.json). Its reader
and its marks follow the spec, and `check` runs them against every case.

  python3 tools/exchange_fixtures.py build      write the fixtures
  python3 tools/exchange_fixtures.py check      fail if a fixture is out of date, or if the reference reader
                                                or the reference marks disagree with a case
  python3 tools/exchange_fixtures.py measure    print sizes for synthetic nights and exports

The Lua addon and the TypeScript app have their own implementations; this file produces and checks the shared
samples. Standard library only.
"""

import json
import random
import re
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "docs" / "spec" / "fixtures"

# Field order is the canonical order: producers write fields in this order, and fixtures compare byte for byte.
NIGHT = ["schema", "id", "at", "by", "phase", "raid", "known", "roster", "bosses", "priorities"]
RAID = ["id", "date", "name", "size"]
KNOWN = ["id", "rev"]
PLAYER = ["k", "id", "name", "surname", "class", "role", "main", "locked"]
BOSS = ["npcId", "name", "zoneId"]
PRIORITY = ["id", "item", "itemId", "encounter", "npcId", "zoneId", "note", "lines"]
LINE = ["k", "name", "text", "awarded", "done"]
AWARDS = ["schema", "id", "at", "by", "awards"]
AWARD = ["id", "rev", "session", "at", "date", "phase", "raid", "itemId", "item", "toId", "to", "pseudo", "decision",
         "priority", "encounter", "npcId", "zoneId", "note", "delivery", "status"]
DELIVERY = ["state", "at", "how"]
SCHEMAS = {"night": 1, "awards": 1}


def ordered(obj, fields, where):
    unknown = [key for key in obj if key not in fields]
    if unknown:
        raise SystemExit(f"{where}: unknown fields {unknown}")
    return {key: obj[key] for key in fields if key in obj}


def canonical(kind, model):
    """The model with every object's fields in canonical order. Stops on a field the spec does not have."""
    if kind == "night":
        out = ordered(model, NIGHT, "night")
        if "raid" in out:
            out["raid"] = ordered(out["raid"], RAID, "raid")
        if "known" in out:
            out["known"] = [ordered(k, KNOWN, f"known[{i}]") for i, k in enumerate(out["known"])]
        out["roster"] = [ordered(p, PLAYER, f"roster[{i}]") for i, p in enumerate(out.get("roster", []))]
        if "bosses" in out:
            out["bosses"] = [ordered(b, BOSS, f"bosses[{i}]") for i, b in enumerate(out["bosses"])]
        out["priorities"] = [
            dict(ordered(p, PRIORITY, f"priorities[{i}]"),
                 lines=[ordered(line, LINE, f"priorities[{i}].lines[{j}]") for j, line in enumerate(p.get("lines", []))])
            for i, p in enumerate(out.get("priorities", []))
        ]
        return out
    out = ordered(model, AWARDS, "awards")
    out["awards"] = [dict(ordered(a, AWARD, f"awards[{i}]"), **(
        {"delivery": ordered(a["delivery"], DELIVERY, f"awards[{i}].delivery")} if "delivery" in a else {}))
        for i, a in enumerate(out.get("awards", []))]
    return out


# ---------------------------------------------------------------------------------------------------------
# Writing (spec sections 1 and 3)
# ---------------------------------------------------------------------------------------------------------

def encode_json(model):
    """No spaces, ASCII only: Python escapes like the spec (\\n, \\u00xx, lowercase \\uxxxx, surrogate pairs).
    "|" and DEL can only occur inside strings, so replacing them everywhere is safe."""
    text = json.dumps(model, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    return text.replace("|", "\\u007c").replace("\x7f", "\\u007f")


def crc32(text):
    return f"{zlib.crc32(text.encode('utf-8')) & 0xFFFFFFFF:08x}"


def envelope(kind, payload, enc="j", version="IM1"):
    head = f"{version}:{kind}:{enc}:{len(payload)}:{payload}:"
    return head + crc32(head)


def string_for(kind, model):
    return envelope(kind, encode_json(canonical(kind, model)))


# ---------------------------------------------------------------------------------------------------------
# Reading (spec section 1.1). Works on UTF-8 bytes, as the Lua addon does.
# ---------------------------------------------------------------------------------------------------------

class ReadError(Exception):
    def __init__(self, code, detail=""):
        super().__init__(f"{code} {detail}".strip())
        self.code = code


ALLOWED = set(range(0x20, 0x7F)) - {0x7C}
HEX = set(b"0123456789abcdef")


def read_envelope(data, start, box):
    """One envelope starting at `start` (the I of IM1). Returns (model, row errors, end)."""
    parts, pos = [], start + 4
    for _ in range(3):
        end = data.find(b":", pos)
        if end < 0:
            raise ReadError("E_MALFORMED", "header")
        parts.append(data[pos:end].decode("latin-1"))
        pos = end + 1
    kind, enc, length = parts
    if not re.fullmatch(r"0|[1-9][0-9]*", length):
        raise ReadError("E_MALFORMED", "length")
    if kind != box:
        raise ReadError("E_KIND", kind)
    if enc != "j":
        raise ReadError("E_ENCODING", enc)
    stop = pos + int(length) + 9  # the payload, ":" and 8 hex digits
    for index in range(start, min(stop, len(data))):
        if data[index] not in ALLOWED:
            raise ReadError("E_CHARS", f"at character {index - start + 1}")
    if len(data) < stop:
        raise ReadError("E_TRUNCATED", f"{len(data) - start} of {stop - start}")
    payload_end = pos + int(length)
    crc = data[payload_end + 1:stop]
    if data[payload_end:payload_end + 1] != b":" or not set(crc) <= HEX:
        raise ReadError("E_MALFORMED", "checksum")
    if f"{zlib.crc32(data[start:payload_end + 1]) & 0xFFFFFFFF:08x}" != crc.decode("ascii"):
        raise ReadError("E_CHECKSUM")
    model = decode_json(data[pos:payload_end].decode("ascii"))
    schema = model.get("schema")
    if not is_int(schema):
        raise ReadError("E_PAYLOAD", "schema")
    if schema > SCHEMAS[kind] or schema < 1:
        raise ReadError("E_SCHEMA", str(schema))
    errors = check_night(model) if kind == "night" else check_awards(model)
    return model, errors, stop


def prepare(text):
    """The pasted text as bytes with CR, LF and tab removed (step 1), and where the first envelope starts (step 2)."""
    data = text.encode("utf-8")
    for strip in (b"\r", b"\n", b"\t"):
        data = data.replace(strip, b"")
    start = data.find(b"IM1:")
    if start < 0:
        raise ReadError("E_VERSION" if re.search(rb"IM[0-9]+:", data) else "E_NOT_IM")
    return data, start


def read_all(text, box):
    """The app's importer: every envelope in the pasted text, as a list of (model, row errors).
    Raises ReadError on the first error, whichever envelope it is in."""
    data, start = prepare(text)
    results = []
    while start >= 0:
        model, errors, end = read_envelope(data, start, box)
        results.append((model, errors))
        start = data.find(b"IM1:", end)
    return results


def read(text, box):
    """The addon's import box: exactly one envelope. Another "IM1:" after the first envelope is E_MULTIPLE
    (step 10), whatever follows it, so a broken second string is not looked at."""
    data, start = prepare(text)
    model, errors, end = read_envelope(data, start, box)
    if data.find(b"IM1:", end) >= 0:
        raise ReadError("E_MULTIPLE")
    return model, errors


def reject_constant(name):
    raise ReadError("E_PAYLOAD", f"{name} is not JSON")


MAX_DEPTH = 16  # levels of lists and objects, the top-level object counting as the first (spec section 3)


def depth_of(value):
    """How many levels of lists and objects `value` nests: a scalar is 0, an object with only scalars is 1."""
    deepest, stack = 0, [(value, 1)]
    while stack:
        item, level = stack.pop()
        if isinstance(item, dict):
            children = item.values()
        elif isinstance(item, list):
            children = item
        else:
            continue
        deepest = max(deepest, level)
        stack.extend((child, level + 1) for child in children)
    return deepest


def decode_json(payload):
    try:
        model = json.loads(payload, parse_constant=reject_constant)
    except (ValueError, RecursionError) as error:  # Python itself gives up on text nested a thousand levels deep
        raise ReadError("E_PAYLOAD", str(error))
    if not isinstance(model, dict):
        raise ReadError("E_PAYLOAD", "not an object")
    if depth_of(model) > MAX_DEPTH:
        raise ReadError("E_PAYLOAD", "nested too deeply")
    return normalize(model)


def normalize(value):
    """The reader rules of section 3: null and false are absent in a field, null in a list is an error, a whole
    number is an integer, a lone surrogate is an error."""
    if isinstance(value, dict):
        return {k: normalize(v) for k, v in value.items() if v is not None and v is not False}
    if isinstance(value, list):
        if any(v is None for v in value):
            raise ReadError("E_PAYLOAD", "null in a list")
        return [normalize(v) for v in value]
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and re.search("[\ud800-\udfff]", value):
        raise ReadError("E_PAYLOAD", "lone surrogate")
    return value


# Content checks (spec sections 2, 5 and 6). Text lengths are code points, which is what Python's len counts.

ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


def is_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and abs(value) <= 2 ** 53


def is_game_id(value):
    return is_int(value) and 1 <= value <= 100_000_000


def is_id(value):
    return isinstance(value, str) and ID.fullmatch(value) is not None


def is_text(value, limit, required=True):
    if value is None:
        return not required
    # A NUL is never text: the game's text handling stops at one (spec section 2).
    return (isinstance(value, str) and len(value) <= limit and "\x00" not in value
            and (not required or value.strip(" ") != ""))


def optional(value, test):
    return value is None or test(value)


def is_true(value):
    return value is None or value is True


def top_level(ok, what):
    if not ok:
        raise ReadError("E_PAYLOAD", what)


def check_night(m):
    top_level(is_id(m.get("id")) and is_int(m.get("at")) and is_text(m.get("by"), 60), "header")
    top_level(is_int(m.get("phase")) and m["phase"] >= 0, "phase")
    top_level(isinstance(m.get("roster"), list) and isinstance(m.get("priorities"), list), "roster or priorities")
    top_level(optional(m.get("known"), lambda v: isinstance(v, list) and all(
        isinstance(x, dict) and is_id(x.get("id")) and is_int(x.get("rev")) and x["rev"] >= 1 for x in v)), "known")
    top_level(optional(m.get("bosses"), lambda v: isinstance(v, list)), "bosses")
    errors = []

    raid = m.get("raid")
    if raid is not None and not (isinstance(raid, dict) and is_id(raid.get("id")) and isinstance(raid.get("date"), str)
                                 and DATE.fullmatch(raid["date"]) and is_text(raid.get("name"), 120, required=False)
                                 and raid.get("size") in (None, 10, 20, 40)):
        errors.append("raid")
        del m["raid"]

    def player_ok(p):
        return (is_id(p.get("id")) and is_text(p.get("name"), 60) and is_text(p.get("surname"), 60, required=False)
                and is_text(p.get("class"), 40, required=False) and is_text(p.get("role"), 40, required=False)
                and optional(p.get("main"), is_int) and is_true(p.get("locked")))

    # The first entry with a k or an id wins; a k whose first entry is broken makes its lines invalid.
    k_valid, ids = {}, set()
    for index, p in enumerate(m["roster"]):
        k = p.get("k") if isinstance(p, dict) else None
        if not (is_int(k) and k >= 1) or k in k_valid:
            errors.append(f"roster:{index + 1}")
            continue
        ok = player_ok(p) and p["id"] not in ids
        k_valid[k] = ok
        if ok:
            ids.add(p["id"])
        else:
            errors.append(f"roster:{index + 1}")
    valid_ks = {k for k, ok in k_valid.items() if ok}

    npcs = set()
    for index, b in enumerate(m.get("bosses", [])):
        ok = (isinstance(b, dict) and is_game_id(b.get("npcId")) and b["npcId"] not in npcs
              and is_text(b.get("name"), 120) and optional(b.get("zoneId"), is_game_id))
        if ok:
            npcs.add(b["npcId"])
        else:
            errors.append(f"boss:{index + 1}")

    def line_ok(line):
        if not isinstance(line, dict) or sum(key in line for key in ("k", "name", "text")) != 1:
            return False
        if "text" in line:
            return is_text(line["text"], 500) and "awarded" not in line and is_true(line.get("done"))
        person = line.get("k") in valid_ks if "k" in line else is_text(line.get("name"), 121)
        return person and "done" not in line and is_true(line.get("awarded"))

    seen = set()
    for index, p in enumerate(m["priorities"]):
        pid = p.get("id") if isinstance(p, dict) else None
        first = is_id(pid) and pid not in seen
        ok = (first and is_text(p.get("item"), 120) and optional(p.get("itemId"), is_game_id)
              and is_text(p.get("encounter"), 120, required=False)
              and optional(p.get("npcId"), is_game_id) and optional(p.get("zoneId"), is_game_id)
              and is_text(p.get("note"), 500, required=False) and isinstance(p.get("lines"), list)
              and len(p["lines"]) <= 60 and all(line_ok(line) for line in p["lines"]))
        if is_id(pid):
            seen.add(pid)
        if not ok:
            errors.append(pid if first else f"priority:{index + 1}")
    return errors


PSEUDO = ("disenchant", "guild-bank")
DECISIONS = ("council", "roll", "other")


def check_awards(m):
    top_level(is_id(m.get("id")) and is_int(m.get("at")) and is_text(m.get("by"), 60), "header")
    top_level(isinstance(m.get("awards"), list), "awards")
    errors, seen = [], set()
    for index, a in enumerate(m["awards"]):
        aid = a.get("id") if isinstance(a, dict) else None
        first = is_id(aid) and aid not in seen
        if is_id(aid):
            seen.add(aid)
        if not first:
            errors.append(f"award:{index + 1}")
            continue
        d = a.get("delivery")
        delivery_ok = isinstance(d, dict) and (
            d.get("state") == "assigned"
            or (d.get("state") == "received" and is_int(d.get("at")) and d.get("how") in ("master-loot", "trade", "manual")))
        ok = (is_int(a.get("rev")) and a["rev"] >= 1 and optional(a.get("session"), is_id) and is_int(a.get("at"))
              and isinstance(a.get("date"), str) and DATE.fullmatch(a["date"]) is not None
              and optional(a.get("phase"), lambda v: is_int(v) and v >= 0) and optional(a.get("raid"), is_id)
              and is_game_id(a.get("itemId")) and is_text(a.get("item"), 120)
              and optional(a.get("toId"), is_id) and is_text(a.get("to"), 121)
              and a.get("pseudo") in (None, *PSEUDO) and not (a.get("pseudo") and "toId" in a)
              and a.get("decision") in (None, *DECISIONS)
              and ("priority" in a or "pseudo" in a or "decision" in a)
              and optional(a.get("priority"), is_id) and is_text(a.get("encounter"), 120, required=False)
              and optional(a.get("npcId"), is_game_id) and optional(a.get("zoneId"), is_game_id)
              and is_text(a.get("note"), 500, required=False) and delivery_ok and a.get("status") in (None, "removed"))
        if not ok:
            errors.append(aid)
    return errors


# ---------------------------------------------------------------------------------------------------------
# Awarded marks (spec section 7)
# ---------------------------------------------------------------------------------------------------------

def name_key(text):
    """Trim and collapse ASCII spaces, lowercase ASCII letters only."""
    collapsed = re.sub(" +", " ", text.strip(" "))
    return "".join(c.lower() if "A" <= c <= "Z" else c for c in collapsed)


def marks(night, log):
    """The marks the addon shows: {priority id: [awarded per line]} and the ids of awards changed since the copy."""
    awarded = {p["id"]: [bool(line.get("awarded")) for line in p["lines"]] for p in night["priorities"]}
    known = {k["id"]: k["rev"] for k in night.get("known", [])}
    roster = night["roster"]
    by_full_name = {}
    for p in roster:
        if p.get("surname", "").strip(" "):  # a blank surname is no surname
            key = name_key(f"{p['name']} {p['surname']}")
            by_full_name[key] = None if key in by_full_name else p
    changed = []
    for award in log:
        if award.get("status") == "removed" or award.get("pseudo") or award.get("phase") != night["phase"]:
            continue
        if award["id"] in known:
            if award["rev"] > known[award["id"]]:
                changed.append(award["id"])
            continue
        if "priority" in award:
            targets = [p for p in night["priorities"] if p["id"] == award["priority"]]
        else:
            targets = [p for p in night["priorities"] if name_key(p["item"]) == name_key(award["item"])]
        for priority in targets:
            if "toId" in award:
                ks = {p["k"] for p in roster if p["id"] == award["toId"]}
                lines = [i for i, line in enumerate(priority["lines"]) if line.get("k") in ks]
            else:
                player = by_full_name.get(name_key(award["to"]))
                if player:
                    lines = [i for i, line in enumerate(priority["lines"]) if line.get("k") == player["k"]]
                else:
                    lines = [i for i, line in enumerate(priority["lines"])
                             if "name" in line and name_key(line["name"]) == name_key(award["to"])]
            for i in lines:
                if not awarded[priority["id"]][i]:
                    awarded[priority["id"]][i] = True
                    break
    return awarded, changed


def marks_cases():
    night = canonical("night", load("night-small"))
    base = {p["id"]: [bool(line.get("awarded")) for line in p["lines"]] for p in night["priorities"]}
    blade = "Blade of the Fixture"
    cloak = "Cloak of Many Commas, Semicolons; and 100% Percent"
    mirelle, jorren, tobin, zoe = (f"AbCdEfGhIjKlMnOpQr0{n}" for n in (2, 1, 3, 4))

    def award(n, **fields):
        return dict({"id": f"s-tpt2u0-q4tz-{n}", "rev": 1796866500 + n, "phase": 1}, **fields)

    def expect(**changes):
        out = json.loads(json.dumps(base))
        for pid, flags in changes.items():
            out[pid.replace("_", "-")] = flags
        return out

    cases = [
        ("an award from a priority marks that person's first open line",
         [award(1, priority="pr-blade", item=blade, toId=mirelle, to="Mirelle Dunmore")],
         expect(pr_blade=[True, True, False, False]), []),
        ("a second listing of the same person is marked by a second award",
         [award(1, priority="pr-blade", item=blade, toId=jorren, to="Jorren Ashvale")],
         expect(pr_blade=[True, False, False, True]), []),
        ("more awards than listings mark nothing more",
         [award(1, priority="pr-blade", item=blade, toId=jorren, to="Jorren Ashvale"),
          award(2, priority="pr-blade", item=blade, toId=jorren, to="Jorren Ashvale")],
         expect(pr_blade=[True, False, False, True]), []),
        ("an award the app already holds (same rev in known) does not count again",
         [{"id": "s-tpg4mo-k3p9-1", "rev": 1796262300, "phase": 1, "priority": "pr-blade", "item": blade,
           "toId": mirelle, "to": "Mirelle Dunmore"}],
         expect(), []),
        ("an award changed since the copy (higher rev than known) does not count, and is reported",
         [{"id": "s-tpg4mo-k3p9-2", "rev": 1796866999, "phase": 1, "priority": "pr-blade", "item": blade,
           "toId": mirelle, "to": "Mirelle Dunmore"}],
         expect(), ["s-tpg4mo-k3p9-2"]),
        ("a removed award does not count",
         [award(1, priority="pr-blade", item=blade, toId=mirelle, to="Mirelle Dunmore", status="removed")],
         expect(), []),
        ("an award of another phase does not count",
         [award(1, phase=0, priority="pr-blade", item=blade, toId=mirelle, to="Mirelle Dunmore")],
         expect(), []),
        ("an award made with no night loaded does not count",
         [{"id": "s-tpt2u0-q4tz-1", "rev": 1796866501, "priority": "pr-blade", "item": blade, "toId": mirelle,
           "to": "Mirelle Dunmore"}],
         expect(), []),
        ("a pseudo award never marks a line",
         [award(1, priority="pr-blade", item=blade, pseudo="disenchant", to="Disenchant")],
         expect(), []),
        ("without a priority, the item name decides (trimmed, spaces collapsed, ASCII lowercase)",
         [award(1, item="  cloak of many  commas, semicolons; and 100% percent ", toId=zoe, to="Zo\u00eb \u00c6rinwald",
                decision="roll")],
         expect(pr_cloak=[True, False, True]), []),
        ("without a toId, the unique roster full name decides",
         [award(1, priority="pr-cloak", item=cloak, to="zo\u00eb  \u00c6rinwald")],
         expect(pr_cloak=[True, False, True]), []),
        ("non-ASCII capitals are not folded, so no match",
         [award(1, priority="pr-cloak", item=cloak, to="ZO\u00cb \u00c6RINWALD")],
         expect(), []),
        ("without a toId or a roster match, a name-only line decides",
         [award(1, priority="pr-typed", item="Item Typed by Hand", to="garrick  VOLE", decision="other")],
         expect(pr_typed=[True]), []),
        ("a name-only line already awarded is not marked twice",
         [award(1, priority="pr-cloak", item=cloak, to="Garrick Vole")],
         expect(), []),
        ("an alt's award does not mark the main's line",
         [award(1, priority="pr-blade", item=blade, toId=tobin, to="Tobin Ashvale")],
         expect(), []),
        ("the first name alone matches nobody",
         [award(1, priority="pr-blade", item=blade, to="Jorren")],
         expect(), []),
        ("a priority that is not in the night: nothing is marked, even if the item name matches",
         [award(1, priority="pr-gone", item=blade, toId=mirelle, to="Mirelle Dunmore")],
         expect(), []),
    ]
    out = [{"name": name, "night": "night-small", "log": log, "expect": want, "changed": changed}
           for name, log, want, changed in cases]

    # Cases that need a different night: "edit" changes night-small first (see apply_edit).
    pell = "AbCdEfGhIjKlMnOpQr05"
    edited = [
        ("a blank surname is no surname, so the first name alone matches nobody",
         [put(["roster", 5, "surname"], " "), ["append", ["priorities", 1, "lines"], {"k": 5}]],
         [award(1, priority="pr-blade", item=blade, to="Pell")],
         expect(pr_blade=[True, False, False, False, False]), []),
        ("two roster entries with one full name match nobody, so a name-only line would decide",
         [["append", ["roster"], {"k": 7, "id": "AbCdEfGhIjKlMnOpQr07", "name": "Jorren", "surname": "Ashvale"}]],
         [award(1, priority="pr-blade", item=blade, to="Jorren Ashvale")],
         expect(), []),
        ("a toId that matches no roster entry marks nothing, whatever the name says",
         [],
         [award(1, priority="pr-blade", item=blade, toId="AbCdEfGhIjKlMnOpQr99", to="Mirelle Dunmore")],
         expect(), []),
        ("without a priority, every priority with that item name is marked",
         [["append", ["priorities"], {"id": "pr-blade-2", "item": "Blade of the Fixture", "lines": [{"k": 2}]}]],
         [award(1, item=blade, toId=mirelle, to="Mirelle Dunmore", decision="council")],
         dict(expect(pr_blade=[True, True, False, False]), **{"pr-blade-2": [True]}), []),
        ("an item name with a non-ASCII capital is not folded, so no match",
         [put(["priorities", 3, "item"], "\u00c6 Blade"), put(["priorities", 3, "lines"], [{"k": 2}])],
         [award(1, item="\u00e6 blade", toId=mirelle, to="Mirelle Dunmore", decision="council")],
         expect(pr_typed=[False]), []),
        ("a roster entry with no line on the priority marks nothing",
         [],
         [award(1, priority="pr-blade", item=blade, toId=pell, to="Pell")],
         expect(), []),
        ("one award marks only the first of a person's open lines",
         [["append", ["priorities", 1, "lines"], {"k": 2}]],
         [award(1, priority="pr-blade", item=blade, toId=mirelle, to="Mirelle Dunmore")],
         expect(pr_blade=[True, True, False, False, False]), []),
        ("the item name of the priority is trimmed, collapsed and lowercased too",
         [put(["priorities", 1, "item"], "  BLADE of   the Fixture ")],
         [award(1, item="blade of the fixture", toId=mirelle, to="Mirelle Dunmore", decision="council")],
         expect(pr_blade=[True, True, False, False]), []),
    ]
    for name, edits, log, want, changed in edited:
        out.append({"name": name, "night": "night-small", "edit": edits, "log": log, "expect": want, "changed": changed})
    return out


# ---------------------------------------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------------------------------------

def load(name):
    return json.loads((FIXTURES / f"{name}.model.json").read_text(encoding="utf-8"))


def mutated(name, change):
    model = canonical("night" if name.startswith("night") else "awards", load(name))
    change(model)
    return model


def raw_envelope(kind, payload_text):
    """An envelope around a payload written by hand (for the reader-strictness cases)."""
    return envelope(kind, payload_text)


def cases():
    """(entry, text) pairs: what a reader must answer for each pasted text."""
    night, awards = load("night-small"), load("awards-small")
    sources = {"night": night, "awards": awards}
    other = {"night": "awards", "awards": "night"}
    out = []

    def case(name, box, text, expect, row_errors=None, **extra):
        entry = {"file": f"cases/{box}-{name}.txt", "box": box, "expect": expect}
        if row_errors:
            entry["rowErrors"] = sorted(row_errors)
        entry.update(extra)
        out.append((entry, text))

    for box, model in sources.items():
        good = string_for(box, model)
        case("bad-truncated", box, good[:-300], "E_TRUNCATED")
        case("bad-altered", box, good.replace("Jorren", "Jorrem", 1), "E_CHECKSUM")
        case("bad-newer-envelope", box, "IM2" + good[3:], "E_VERSION")
        case("bad-smart-quote", box, good.replace("'", "\u2019", 1), "E_CHARS")
        case("bad-newer-schema", box, string_for(box, dict(model, schema=2)), "E_SCHEMA")
        case("bad-wrong-kind", box, string_for(other[box], sources[other[box]]), "E_KIND")
        case("bad-not-ours", box, "!WA:2!abcdef", "E_NOT_IM")
        case("bad-length", box, f"IM1:{box}:j:12x:{{}}:00000000", "E_MALFORMED")
        case("bad-unknown-encoding", box, envelope(box, "{}", enc="q"), "E_ENCODING")
        case("bad-not-an-object", box, raw_envelope(box, "[1,2]"), "E_PAYLOAD")
        case("bad-nan", box, raw_envelope(box, encode_json(canonical(box, model))[:-1] + ',"x":NaN}'), "E_PAYLOAD")
        # The envelope's own syntax (section 1.1, steps 3 to 8).
        head = f"IM1:{box}:j:"
        assert good[-8:] != good[-8:].upper(), "the sample checksum needs a letter in it for bad-checksum-uppercase"
        case("bad-length-leading-zero", box, f"{head}02:{{}}:00000000", "E_MALFORMED")
        case("bad-length-empty", box, f"{head}:{{}}:00000000", "E_MALFORMED")
        case("bad-length-sign", box, f"{head}-2:{{}}:00000000", "E_MALFORMED")
        case("bad-length-huge", box, f"{head}99999999999999999999:{{}}:00000000", "E_TRUNCATED")
        case("bad-header-short", box, f"IM1:{box}:j", "E_MALFORMED")
        case("bad-checksum-uppercase", box, good[:-8] + good[-8:].upper(), "E_MALFORMED")
        case("bad-checksum-not-hex", box, good[:-8] + "zzzzzzzz", "E_MALFORMED")
        case("bad-checksum-colon", box, good[:-9] + "X" + good[-8:], "E_MALFORMED")
        case("bad-pipe", box, good.replace("Jorren", "Jor|ren", 1), "E_CHARS")
        case("bad-non-ascii", box, good.replace("Jorren", "Jorr\N{LATIN SMALL LETTER E WITH ACUTE}n", 1), "E_CHARS")
        case("bad-kind-before-encoding", box, f"IM1:{other[box]}:q:2:{{}}:00000000", "E_KIND")
        case("bad-empty-payload", box, envelope(box, ""), "E_PAYLOAD")
        case("bad-schema-zero", box, string_for(box, dict(model, schema=0)), "E_SCHEMA")
        case("bad-schema-text", box, string_for(box, dict(model, schema="1")), "E_PAYLOAD")
        case("bad-schema-fraction", box, string_for(box, dict(model, schema=1.5)), "E_PAYLOAD")
        case("bad-schema-missing", box, string_for(box, {k: v for k, v in model.items() if k != "schema"}), "E_PAYLOAD")

        def mention_im1(m, box=box):
            target = m["priorities"][0] if box == "night" else m["awards"][0]
            target["note"] = f"see IM1:{box}:j:2:{{}}:00000000 for the format"
        case("ok-im1-inside-text", box, string_for(box, mutated(f"{box}-small", mention_im1)), "OK", envelopes=1)

        # Nesting (section 3): the top-level object is the first of at most 16 levels. The extra field is ignored.
        def deep(levels, box=box, model=model):
            return encode_json(canonical(box, model))[:-1] + ',"deep":' + "[" * levels + "]" * levels + "}"
        case("ok-nesting-at-limit", box, raw_envelope(box, deep(15)), "OK")
        case("bad-nesting-over-limit", box, raw_envelope(box, deep(16)), "E_PAYLOAD")

        # U+0000 in text (section 2): a row error in a row, E_PAYLOAD in a top-level field.
        def nul_in_row(m, box=box):
            if box == "night":
                m["roster"][4]["name"] = "Pe\u0000ll"
            else:
                m["awards"][0]["note"] = "a\u0000b"
        case("ok-nul-in-text", box, string_for(box, mutated(f"{box}-small", nul_in_row)), "OK",
             ["roster:5"] if box == "night" else ["s-tpt2u0-q4tz-1"])
        # A broken top-level field is found by the content checks (step 9), not by the envelope code (steps 1 to 8).
        case("bad-nul-in-by", box, string_for(box, dict(model, by="Raid\u0000Desk/1")), "E_PAYLOAD", layer="content")

        case("ok-wrapped", box, "\r\n".join(good[i:i + 76] for i in range(0, len(good), 76)) + "\r\n", "OK", sameAs=f"{box}-small")
        case("ok-surrounded", box, "Here's the string: " + good + "  (copied at 8pm)\n", "OK", sameAs=f"{box}-small")
        # Reader strictness (section 3): whitespace, reversed field order, "\/", upper-case escapes, a repeated key,
        # and integers written as 2.0 or 2e0 all read as the same model.
        # Spaces only: step 1 removes CR, LF and tab before the length is counted.
        relaxed = json.dumps(reverse_order(canonical(box, model)), separators=(" , ", " : "), ensure_ascii=True)
        relaxed = relaxed.replace('"Zo\\u00eb', '"Zo\\u00EB').replace('"schema" : 1', '"schema" : 1.0', 1)
        relaxed = relaxed.replace('"phase" : 1 ', '"phase" : 1e0 ', 1)
        relaxed = relaxed.replace('"id" : "', '"id" : "IGNORED" , "id" : "', 1).replace("/", "\\/")
        for fragment in ('1.0', '1e0', 'IGNORED', '\\u00EB', '\\/'):
            assert fragment in relaxed, f"ok-relaxed-json for {box} lost {fragment}"
        relaxed = relaxed.replace("|", "\\u007c").replace("\x7f", "\\u007f")
        case("ok-relaxed-json", box, raw_envelope(box, relaxed), "OK", sameAs=f"{box}-small")
        case("ok-unknown-fields", box, string_for_loose(box, model, extra_field), "OK")

    # Night box only.
    good_night = string_for("night", night)
    case("bad-two-strings", "night", good_night + " " + good_night, "E_MULTIPLE")
    case("bad-two-strings-second-broken", "night", good_night + " " + good_night.replace("Jorren", "Jorrem", 1),
         "E_MULTIPLE")
    case("ok-row-error", "night", string_for("night", mutated("night-small", lambda m: m["priorities"][1]["lines"].append({"k": 99}))),
         "OK", ["pr-cloak"])
    case("ok-false-and-null", "night", raw_envelope("night", false_and_null_night()), "OK", sameAs="night-small")
    case("bad-null-in-list", "night", raw_envelope("night", encode_json(canonical("night", night)).replace(
        '"known":[', '"known":[null,', 1)), "E_PAYLOAD")
    case("bad-lone-surrogate", "night", raw_envelope("night", encode_json(canonical("night", night)).replace(
        "Zo\\u00eb", "Zo\\ud800", 1)), "E_PAYLOAD")
    case("ok-fraction", "night", raw_envelope("night", encode_json(canonical("night", night)).replace(
        '{"k":2}', '{"k":2.5}', 1)), "OK", ["pr-blade"])
    case("ok-code-points", "night", string_for("night", mutated("night-small", lambda m: m["roster"][4].update(
        surname="\u00e9" * 60))), "OK")
    case("ok-code-points-over", "night", string_for("night", mutated("night-small", lambda m: m["roster"][4].update(
        surname="\u00e9" * 61))), "OK", ["roster:5"])

    def blanks(m):
        m["roster"].append({"k": 7, "id": "AbCdEfGhIjKlMnOpQr07", "name": "   "})          # blank: an error
        m["roster"].append({"k": 8, "id": "AbCdEfGhIjKlMnOpQr08", "name": "\u00a0Orrin"})  # a no-break space is text
    case("ok-blank-names", "night", string_for("night", mutated("night-small", blanks)), "OK", ["roster:7"])

    def duplicates(m):
        m["roster"].append({"k": 2, "id": "AbCdEfGhIjKlMnOpQr09", "name": "Second", "surname": "Two"})
        m["roster"].append({"k": 9, "id": "AbCdEfGhIjKlMnOpQr01", "name": "Same", "surname": "Id"})
        m["priorities"].append(json.loads(json.dumps(m["priorities"][0])))
    case("ok-duplicates", "night", string_for("night", mutated("night-small", duplicates)), "OK",
         ["roster:7", "roster:8", "priority:4"])
    case("ok-bad-raid", "night", string_for("night", mutated("night-small", lambda m: m["raid"].update(size=25))),
         "OK", ["raid"])
    case("ok-empty-encounter", "night", string_for("night", mutated("night-small", lambda m: m["priorities"][2].update(
        encounter=""))), "OK")

    # Awards box only.
    good_awards = string_for("awards", awards)
    case("ok-two-strings", "awards", good_awards + "\n" + string_for("awards", mutated("awards-small", second_export)),
         "OK", envelopes=2)

    def broken_awards(m):
        m["awards"][3]["delivery"]["state"] = "lost"               # not a delivery state
        del m["awards"][1]["pseudo"]                               # no priority, no pseudo, no decision
        m["awards"][1]["to"] = "Nobody"
        m["awards"].append(json.loads(json.dumps(m["awards"][0])))  # repeated id
        m["awards"].append(dict(json.loads(json.dumps(m["awards"][2])), id="s-tpt55c-j7wd-9", pseudo="guild-bank"))
    case("ok-row-errors", "awards", string_for("awards", mutated("awards-small", broken_awards)), "OK",
         ["s-tpt2u0-q4tz-2", "s-tpt55c-j7wd-2", "award:6", "s-tpt55c-j7wd-9"])
    return out


def reverse_order(value):
    if isinstance(value, dict):
        return {k: reverse_order(value[k]) for k in reversed(list(value))}
    if isinstance(value, list):
        return [reverse_order(v) for v in value]
    return value


def extra_field(model):
    model["comment"] = "a field from a newer version"
    for row in model.get("roster", []) + model.get("priorities", []) + model.get("awards", []):
        row["future"] = {"nested": [1, 2, 3]}


def string_for_loose(kind, model, change):
    model = canonical(kind, model)
    change(model)
    return envelope(kind, encode_json(model))


def false_and_null_night():
    """night-small with false and null written where the spec says they mean "absent"."""
    text = encode_json(canonical("night", load("night-small")))
    text = text.replace('{"k":2}', '{"k":2,"awarded":false,"name":null}', 1)
    text = text.replace('"name":"Pell"', '"name":"Pell","surname":null,"locked":false,"main":null', 1)
    return text.replace('"item":"Item Typed by Hand"', '"item":"Item Typed by Hand","itemId":null,"note":null', 1)


def second_export(m):
    m["id"] = "a-tpt9z9-77aa"
    m["awards"] = [dict(a, id=a["id"].replace("q4tz", "zz99")) for a in m["awards"][:2]]


# ---------------------------------------------------------------------------------------------------------
# Content cases (spec sections 2, 5.1 and 6.1): a good model with edits, and what the content checks must answer
# ---------------------------------------------------------------------------------------------------------

def apply_edit(model, edit):
    """["set", path, value], ["delete", path] or ["append", path, value]. A path is a list of keys and 1-based list
    positions, as in the row errors: ["roster", 3, "name"]. `append` takes the path of the list."""
    op, path = edit[0], edit[1]

    def step(container, key):
        return container[key - 1] if isinstance(key, int) else container[key]

    target = model
    for key in path[:-1]:
        target = step(target, key)
    last = path[-1]
    index = last - 1 if isinstance(last, int) else last
    if op == "append":
        target[index].append(edit[2])
    elif op == "set":
        target[index] = edit[2]
    elif op == "delete":
        del target[index]
    else:
        raise ValueError(op)
    return model


def put(path, value):
    return ["set", path, value]


def drop(path):
    return ["delete", path]


def add(path, value):
    return ["append", path, value]


def long(count, letter="x"):
    return letter * count


PAYLOAD = "E_PAYLOAD"
A1, A2, A3, A4, A5 = ("s-tpt2u0-q4tz-1", "s-tpt2u0-q4tz-2", "s-tpt55c-j7wd-1", "s-tpt55c-j7wd-2", "s-tpg4mo-k3p9-2")


def night_content_cases():
    """(name, edits, expect) on night-small: E_PAYLOAD when a top-level field is wrong, else the row errors."""
    lines = ["priorities", 3, "lines", 1]
    return [
        # The header and the lists: a wrong one means nothing in the string can be trusted.
        ("id-invalid", [put(["id"], "has space")], PAYLOAD),
        ("id-blank", [put(["id"], "")], PAYLOAD),
        ("at-fraction", [put(["at"], 1796862600.5)], PAYLOAD),
        ("at-missing", [drop(["at"])], PAYLOAD),
        ("by-blank", [put(["by"], "   ")], PAYLOAD),
        ("by-61", [put(["by"], long(61))], PAYLOAD),
        ("by-60", [put(["by"], long(60))], []),
        ("phase-negative", [put(["phase"], -1)], PAYLOAD),
        ("phase-zero", [put(["phase"], 0)], []),
        ("phase-missing", [drop(["phase"])], PAYLOAD),
        ("roster-missing", [drop(["roster"])], PAYLOAD),
        ("roster-not-a-list", [put(["roster"], {})], PAYLOAD),
        ("priorities-missing", [drop(["priorities"])], PAYLOAD),
        ("priorities-not-a-list", [put(["priorities"], "none")], PAYLOAD),
        ("known-not-a-list", [put(["known"], 5)], PAYLOAD),
        ("known-empty", [put(["known"], [])], []),
        ("known-entry-without-rev", [put(["known", 1], {"id": "s-a-1"})], PAYLOAD),
        ("known-rev-zero", [put(["known", 1, "rev"], 0)], PAYLOAD),
        ("known-id-invalid", [put(["known", 1, "id"], "bad id")], PAYLOAD),
        ("known-entry-not-an-object", [put(["known", 1], 7)], PAYLOAD),
        ("bosses-not-a-list", [put(["bosses"], {})], PAYLOAD),
        ("bosses-missing", [drop(["bosses"])], []),
        # The raid: a wrong one is ignored and reported.
        ("raid-date-format", [put(["raid", "date"], "12/09/2026")], ["raid"]),
        ("raid-date-missing", [drop(["raid", "date"])], ["raid"]),
        ("raid-id-invalid", [put(["raid", "id"], "bad id")], ["raid"]),
        ("raid-name-121", [put(["raid", "name"], long(121))], ["raid"]),
        ("raid-name-120", [put(["raid", "name"], long(120))], []),
        ("raid-name-missing", [drop(["raid", "name"])], []),
        ("raid-size-10", [put(["raid", "size"], 10)], []),
        ("raid-size-40", [put(["raid", "size"], 40)], []),
        ("raid-size-missing", [drop(["raid", "size"])], []),
        ("raid-size-text", [put(["raid", "size"], "20")], ["raid"]),
        ("raid-not-an-object", [put(["raid"], "tonight")], ["raid"]),
        ("raid-missing", [drop(["raid"])], []),
        # The roster. A broken entry hides the lines that name its k.
        ("roster-k-missing", [drop(["roster", 3, "k"])], ["roster:3"]),
        ("roster-k-zero", [put(["roster", 3, "k"], 0)], ["roster:3"]),
        ("roster-k-fraction", [put(["roster", 3, "k"], 2.5)], ["roster:3"]),
        ("roster-k-text", [put(["roster", 3, "k"], "3")], ["roster:3"]),
        ("roster-id-missing", [drop(["roster", 3, "id"])], ["roster:3"]),
        ("roster-id-invalid", [put(["roster", 3, "id"], "bad id")], ["roster:3"]),
        ("roster-id-of-an-earlier-entry", [put(["roster", 6, "id"], "AbCdEfGhIjKlMnOpQr01")], ["roster:6"]),
        ("roster-name-missing", [drop(["roster", 3, "name"])], ["roster:3"]),
        ("roster-name-61", [put(["roster", 3, "name"], long(61, "a"))], ["roster:3"]),
        ("roster-name-60", [put(["roster", 3, "name"], long(60, "a"))], []),
        ("roster-surname-blank", [put(["roster", 3, "surname"], " ")], []),
        ("roster-class-41", [put(["roster", 3, "class"], long(41))], ["roster:3"]),
        ("roster-class-40", [put(["roster", 3, "class"], long(40))], []),
        ("roster-role-41", [put(["roster", 3, "role"], long(41))], ["roster:3"]),
        ("roster-main-fraction", [put(["roster", 3, "main"], 1.5)], ["roster:3"]),
        ("roster-main-unknown", [put(["roster", 3, "main"], 99)], []),
        ("roster-locked-text", [put(["roster", 3, "locked"], "yes")], ["roster:3"]),
        ("roster-locked-true", [put(["roster", 3, "locked"], True)], []),
        ("roster-entry-not-an-object", [put(["roster", 3], 5)], ["roster:3"]),
        ("roster-k-of-a-broken-entry-is-taken", [put(["roster", 3, "name"], ""), add(["roster"], {
            "k": 3, "id": "AbCdEfGhIjKlMnOpQr33", "name": "Late", "surname": "Comer"})], ["roster:3", "roster:7"]),
        ("roster-id-of-a-broken-entry-is-free", [put(["roster", 3, "name"], ""), add(["roster"], {
            "k": 9, "id": "AbCdEfGhIjKlMnOpQr03", "name": "Late", "surname": "Comer"})], ["roster:3"]),
        ("roster-broken-entry-hides-its-lines", [put(["roster", 4, "name"], "")], ["pr-cloak", "roster:4"]),
        ("roster-bad-k-hides-its-lines", [put(["roster", 4, "k"], 0)], ["pr-cloak", "roster:4"]),
        ("roster-empty-hides-the-lines-of-players", [put(["roster"], [])], ["pr-blade", "pr-cloak"]),
        # The bosses.
        ("boss-npcid-missing", [drop(["bosses", 2, "npcId"])], ["boss:2"]),
        ("boss-npcid-zero", [put(["bosses", 2, "npcId"], 0)], ["boss:2"]),
        ("boss-npcid-over", [put(["bosses", 2, "npcId"], 100000001)], ["boss:2"]),
        ("boss-npcid-max", [put(["bosses", 2, "npcId"], 100000000)], []),
        ("boss-npcid-repeated", [put(["bosses", 2, "npcId"], 990001)], ["boss:2"]),
        ("boss-name-blank", [put(["bosses", 2, "name"], "")], ["boss:2"]),
        ("boss-name-121", [put(["bosses", 2, "name"], long(121))], ["boss:2"]),
        ("boss-name-120", [put(["bosses", 2, "name"], long(120))], []),
        ("boss-zoneid-zero", [put(["bosses", 2, "zoneId"], 0)], ["boss:2"]),
        ("boss-zoneid-missing", [drop(["bosses", 2, "zoneId"])], []),
        ("boss-not-an-object", [put(["bosses", 2], "x")], ["boss:2"]),
        ("boss-npcid-of-a-broken-boss-is-free", [put(["bosses", 2, "name"], ""), add(["bosses"], {
            "npcId": 990002, "name": "Second Try"})], ["boss:2"]),
        # The priorities: a wrong one is skipped whole, and named by its id when that is valid and its first use.
        ("priority-id-missing", [drop(["priorities", 3, "id"])], ["priority:3"]),
        ("priority-id-invalid", [put(["priorities", 3, "id"], "bad id")], ["priority:3"]),
        ("priority-id-repeated", [put(["priorities", 3, "id"], "pr-blade")], ["priority:3"]),
        ("priority-not-an-object", [put(["priorities", 3], 4)], ["priority:3"]),
        ("priority-id-of-a-broken-priority-is-taken", [put(["priorities", 3, "item"], ""), add(["priorities"], {
            "id": "pr-typed", "item": "Second Try", "lines": []})], ["pr-typed", "priority:4"]),
        ("priority-item-missing", [drop(["priorities", 3, "item"])], ["pr-typed"]),
        ("priority-item-blank", [put(["priorities", 3, "item"], "  ")], ["pr-typed"]),
        ("priority-item-121", [put(["priorities", 3, "item"], long(121))], ["pr-typed"]),
        ("priority-item-120", [put(["priorities", 3, "item"], long(120))], []),
        ("priority-itemid-zero", [put(["priorities", 3, "itemId"], 0)], ["pr-typed"]),
        ("priority-itemid-fraction", [put(["priorities", 3, "itemId"], 5.5)], ["pr-typed"]),
        ("priority-itemid-given", [put(["priorities", 3, "itemId"], 900009)], []),
        ("priority-encounter-121", [put(["priorities", 3, "encounter"], long(121))], ["pr-typed"]),
        ("priority-npcid-zero", [put(["priorities", 3, "npcId"], 0)], ["pr-typed"]),
        ("priority-zoneid-zero", [put(["priorities", 3, "zoneId"], 0)], ["pr-typed"]),
        ("priority-note-501", [put(["priorities", 3, "note"], long(501))], ["pr-typed"]),
        ("priority-note-500", [put(["priorities", 3, "note"], long(500))], []),
        ("priority-note-blank", [put(["priorities", 3, "note"], "")], []),
        ("priority-lines-missing", [drop(["priorities", 3, "lines"])], ["pr-typed"]),
        ("priority-lines-not-a-list", [put(["priorities", 3, "lines"], {})], ["pr-typed"]),
        ("priority-lines-empty", [put(["priorities", 3, "lines"], [])], []),
        ("priority-lines-61", [put(["priorities", 3, "lines"], [{"name": "Garrick Vole"}] * 61)], ["pr-typed"]),
        ("priority-lines-60", [put(["priorities", 3, "lines"], [{"name": "Garrick Vole"}] * 60)], []),
        # The lines: exactly one of k, name, text.
        ("line-k-and-name", [put(lines, {"k": 1, "name": "Garrick Vole"})], ["pr-typed"]),
        ("line-empty", [put(lines, {})], ["pr-typed"]),
        ("line-not-an-object", [put(lines, "Garrick Vole")], ["pr-typed"]),
        ("line-k-unknown", [put(lines, {"k": 99})], ["pr-typed"]),
        ("line-k-known", [put(lines, {"k": 6})], []),
        ("line-k-fraction", [put(["priorities", 1, "lines", 2, "k"], 2.5)], ["pr-blade"]),
        ("line-name-blank", [put(lines + ["name"], "")], ["pr-typed"]),
        ("line-name-122", [put(lines + ["name"], long(122))], ["pr-typed"]),
        ("line-name-121", [put(lines + ["name"], long(121))], []),
        ("line-awarded-text", [put(lines + ["awarded"], "yes")], ["pr-typed"]),
        ("line-awarded-true", [put(lines + ["awarded"], True)], []),
        ("line-name-with-done", [put(lines + ["done"], True)], ["pr-typed"]),
        ("line-character-with-done", [put(["priorities", 1, "lines", 1, "done"], True)], ["pr-blade"]),
        ("line-note-with-awarded", [put(["priorities", 2, "lines", 2, "awarded"], True)], ["pr-cloak"]),
        ("line-note-done-text", [put(["priorities", 2, "lines", 2, "done"], "yes")], ["pr-cloak"]),
        ("line-note-501", [put(["priorities", 2, "lines", 2, "text"], long(501))], ["pr-cloak"]),
        ("line-note-500", [put(["priorities", 2, "lines", 2, "text"], long(500))], []),
        ("line-note-blank", [put(["priorities", 2, "lines", 2, "text"], "  ")], ["pr-cloak"]),
        ("line-note-and-name", [put(["priorities", 2, "lines", 2, "name"], "Garrick Vole")], ["pr-cloak"]),
        # Several at once.
        ("several-rows-wrong", [put(["raid", "date"], "soon"), put(["roster", 3, "name"], ""), put(["bosses", 2, "npcId"], 0),
                                put(["priorities", 3, "item"], "")], ["boss:2", "pr-typed", "raid", "roster:3"]),
    ]


def awards_content_cases():
    """(name, edits, expect) on awards-small: E_PAYLOAD when a top-level field is wrong, else the row errors."""
    return [
        ("id-invalid", [put(["id"], "has space")], PAYLOAD),
        ("id-blank", [put(["id"], "")], PAYLOAD),
        ("at-fraction", [put(["at"], 1796875200.5)], PAYLOAD),
        ("at-missing", [drop(["at"])], PAYLOAD),
        ("by-blank", [put(["by"], "   ")], PAYLOAD),
        ("by-61", [put(["by"], long(61))], PAYLOAD),
        ("by-60", [put(["by"], long(60))], []),
        ("awards-missing", [drop(["awards"])], PAYLOAD),
        ("awards-not-a-list", [put(["awards"], {})], PAYLOAD),
        ("awards-empty", [put(["awards"], [])], []),
        # An award is named by its id, or by its position when the id is missing, invalid or already used.
        ("award-id-missing", [drop(["awards", 1, "id"])], ["award:1"]),
        ("award-id-invalid", [put(["awards", 1, "id"], "bad id")], ["award:1"]),
        ("award-id-repeated", [put(["awards", 2, "id"], A1)], ["award:2"]),
        ("award-not-an-object", [put(["awards", 1], 5)], ["award:1"]),
        ("award-id-of-a-broken-award-is-taken", [put(["awards", 1, "rev"], 0), add(["awards"], {
            "id": A1, "rev": 1796866531, "at": 1796866512, "date": "2026-12-09", "itemId": 900001, "item": "Blade of the Fixture",
            "to": "Mirelle Dunmore", "decision": "council", "delivery": {"state": "assigned"}})], [A1, "award:6"]),
        ("award-rev-missing", [drop(["awards", 1, "rev"])], [A1]),
        ("award-rev-zero", [put(["awards", 1, "rev"], 0)], [A1]),
        ("award-rev-fraction", [put(["awards", 1, "rev"], 1.5)], [A1]),
        ("award-session-invalid", [put(["awards", 1, "session"], "bad id")], [A1]),
        ("award-session-missing", [drop(["awards", 1, "session"])], []),
        ("award-at-missing", [drop(["awards", 1, "at"])], [A1]),
        ("award-date-format", [put(["awards", 1, "date"], "9/12/2026")], [A1]),
        ("award-date-missing", [drop(["awards", 1, "date"])], [A1]),
        ("award-phase-negative", [put(["awards", 1, "phase"], -1)], [A1]),
        ("award-phase-zero", [put(["awards", 1, "phase"], 0)], []),
        ("award-phase-missing", [drop(["awards", 1, "phase"])], []),
        ("award-raid-invalid", [put(["awards", 1, "raid"], "bad id")], [A1]),
        ("award-itemid-missing", [drop(["awards", 1, "itemId"])], [A1]),
        ("award-itemid-zero", [put(["awards", 1, "itemId"], 0)], [A1]),
        ("award-item-missing", [drop(["awards", 1, "item"])], [A1]),
        ("award-item-blank", [put(["awards", 1, "item"], " ")], [A1]),
        ("award-item-121", [put(["awards", 1, "item"], long(121))], [A1]),
        ("award-item-120", [put(["awards", 1, "item"], long(120))], []),
        ("award-toid-invalid", [put(["awards", 1, "toId"], "bad id")], [A1]),
        ("award-to-missing", [drop(["awards", 1, "to"])], [A1]),
        ("award-to-blank", [put(["awards", 1, "to"], " ")], [A1]),
        ("award-to-122", [put(["awards", 1, "to"], long(122))], [A1]),
        ("award-to-121", [put(["awards", 1, "to"], long(121))], []),
        ("award-pseudo-unknown", [put(["awards", 2, "pseudo"], "vendor")], [A2]),
        ("award-pseudo-guild-bank", [put(["awards", 2, "pseudo"], "guild-bank")], []),
        ("award-pseudo-with-toid", [put(["awards", 2, "toId"], "AbCdEfGhIjKlMnOpQr02")], [A2]),
        ("award-decision-unknown", [put(["awards", 4, "decision"], "coin-flip")], [A4]),
        ("award-decision-other", [put(["awards", 4, "decision"], "other")], []),
        ("award-decision-missing-with-nothing-else", [drop(["awards", 4, "decision"])], [A4]),
        ("award-priority-and-decision", [put(["awards", 1, "decision"], "council")], []),
        ("award-priority-invalid", [put(["awards", 1, "priority"], "bad id")], [A1]),
        ("award-encounter-121", [put(["awards", 1, "encounter"], long(121))], [A1]),
        ("award-encounter-blank", [put(["awards", 1, "encounter"], "")], []),
        ("award-npcid-zero", [put(["awards", 1, "npcId"], 0)], [A1]),
        ("award-zoneid-zero", [put(["awards", 1, "zoneId"], 0)], [A1]),
        ("award-note-501", [put(["awards", 1, "note"], long(501))], [A1]),
        ("award-note-500", [put(["awards", 1, "note"], long(500))], []),
        ("award-delivery-missing", [drop(["awards", 1, "delivery"])], [A1]),
        ("award-delivery-not-an-object", [put(["awards", 1, "delivery"], "received")], [A1]),
        ("award-delivery-state-unknown", [put(["awards", 3, "delivery", "state"], "lost")], [A3]),
        ("award-delivery-received-without-at", [drop(["awards", 1, "delivery", "at"])], [A1]),
        ("award-delivery-received-without-how", [drop(["awards", 1, "delivery", "how"])], [A1]),
        ("award-delivery-how-unknown", [put(["awards", 1, "delivery", "how"], "mail")], [A1]),
        ("award-delivery-how-trade", [put(["awards", 1, "delivery", "how"], "trade")], []),
        ("award-delivery-how-manual", [put(["awards", 1, "delivery", "how"], "manual")], []),
        ("award-delivery-assigned-ignores-how-and-at", [put(["awards", 3, "delivery", "how"], "mail"),
                                                        put(["awards", 3, "delivery", "at"], 5)], []),
        ("award-status-unknown", [put(["awards", 5, "status"], "deleted")], [A5]),
        ("award-status-removed", [put(["awards", 4, "status"], "removed")], []),
        ("award-removed-is-still-checked", [put(["awards", 5, "itemId"], 0)], [A5]),
        ("several-awards-wrong", [put(["awards", 1, "rev"], 0), put(["awards", 3, "note"], long(501)),
                                  put(["awards", 4, "to"], " ")], [A1, A3, A4]),
    ]


CONTENT_BASES = {"night": "night-small", "awards": "awards-small"}


def content_entries():
    """The entries of content-cases.json: what the content checks (after the envelope is read) must answer."""
    entries = []
    for box, cases_ in (("night", night_content_cases()), ("awards", awards_content_cases())):
        names = [name for name, _, _ in cases_]
        assert len(names) == len(set(names)), f"a repeated {box} content case"
        for name, edits, expect in cases_:
            entry = {"box": box, "name": name, "edit": edits}
            if expect == PAYLOAD:
                entry["expect"] = PAYLOAD
            else:
                entry["expect"] = "OK"
                if expect:
                    entry["rowErrors"] = sorted(expect)
            entries.append(entry)
    return entries


def content_cases_text():
    return "[\n" + ",\n".join(json.dumps(entry, ensure_ascii=True) for entry in content_entries()) + "\n]\n"


def content_answer(entry):
    """What the reference checks answer for an entry: (code or "OK", sorted row errors)."""
    model = load(CONTENT_BASES[entry["box"]])
    for edit in entry["edit"]:
        apply_edit(model, edit)
    try:
        errors = check_night(model) if entry["box"] == "night" else check_awards(model)
    except ReadError as error:
        return error.code, []
    return "OK", sorted(errors)


def wanted_files():
    files = {}
    for kind, name in [("night", "night-small"), ("night", "night-empty"), ("awards", "awards-small")]:
        files[f"{name}.j.txt"] = string_for(kind, load(name))
    entries = []
    for entry, text in sorted(cases(), key=lambda pair: pair[0]["file"]):
        files[entry["file"]] = text
        entries.append(entry)
    files["cases/cases.json"] = json.dumps(entries, indent=2) + "\n"
    files["marks-cases.json"] = json.dumps(marks_cases(), indent=1, ensure_ascii=False) + "\n"
    files["content-cases.json"] = content_cases_text()
    files["crc32-vectors.json"] = json.dumps(
        [{"text": t, "crc32": crc32(t)} for t in ["", "a", "123456789", "IM1:night:j:2:{}:", "IM1:awards:j:2:{}:"]],
        indent=2) + "\n"
    return files


def generated_files():
    """Files outside docs/spec/fixtures/ that are made from the fixtures: {path from the repository root: text}."""
    night, awards = string_for("night", load("night-small")), string_for("awards", load("awards-small"))
    for text in (night, awards):
        assert "]=]" not in text, "a sample contains the end of a Lua long string"
    # The marks the reference gives for the awards sample on the night sample: /im selftest checks the addon's own marks
    # against them inside the game.
    flags, changed = marks(canonical("night", load("night-small")), load("awards-small")["awards"])

    def lua_flags(row):
        return "{ " + ", ".join("true" if flag else "false" for flag in row) + " }"
    marks_text = ", ".join(f'["{pid}"] = {lua_flags(row)}' for pid, row in sorted(flags.items()))
    changed_text = ", ".join(f'"{award_id}"' for award_id in changed)
    changed_text = f" {changed_text} " if changed_text else ""
    lua = (
        "-- Generated by tools/exchange_fixtures.py from docs/spec/fixtures/*.j.txt. Do not edit by hand:\n"
        "-- run `python3 tools/exchange_fixtures.py build`. CI fails when this file is out of date.\n"
        "-- The sample strings are here because /im selftest runs inside the game, where files cannot be read.\n"
        "local _, ns = ...\n"
        "\n"
        "ns.SelfTestSamples = {\n"
        f"  night = [=[{night}]=],\n"
        f"  awards = [=[{awards}]=],\n"
        f"  marks = {{ awarded = {{ {marks_text} }}, changed = {{{changed_text}}} }},\n"
        "}\n"
    )
    return {"IntrepidManager/core/SelfTestSamples.lua": lua}


def write_if_changed(path, text, write):
    """True when the file at `path` is not `text` already; writes it when `write` is set."""
    # open() with newline="" keeps CR LF as written; Path.read_text only takes newline= from Python 3.13.
    if path.exists():
        with open(path, encoding="utf-8", newline="") as existing:
            if existing.read() == text:
                return False
    if write:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="") as out:
            out.write(text)
    return True


def build(write):
    wanted = wanted_files()
    stale = []
    for path in sorted(list(FIXTURES.glob("*.txt")) + list((FIXTURES / "cases").glob("*"))):
        rel = str(path.relative_to(FIXTURES))
        if rel not in wanted:
            stale.append(rel + " (no longer made)")
            if write:
                path.unlink()
    for rel, text in wanted.items():
        if write_if_changed(FIXTURES / rel, text, write):
            stale.append(rel)
    for rel, text in generated_files().items():
        if write_if_changed(ROOT / rel, text, write):
            stale.append(rel)
    return stale


def verify():
    """Every case gives the result cases.json names, good strings read back as their models, and the marks match."""
    problems = []
    models = {"night-small": canonical("night", load("night-small")), "awards-small": canonical("awards", load("awards-small"))}
    for kind, name in [("night", "night-small"), ("night", "night-empty"), ("awards", "awards-small")]:
        model, row_errors = read(string_for(kind, load(name)), kind)
        if model != canonical(kind, load(name)) or row_errors:
            problems.append(f"{name}: reads back differently ({row_errors or 'model differs'})")
    for entry, text in cases():
        try:
            results = read(text, "night") if entry["box"] == "night" else read_all(text, "awards")
            results = [results] if entry["box"] == "night" else results
            got, row_errors = "OK", sorted(e for _, errors in results for e in errors)
        except ReadError as error:
            got, row_errors, results = error.code, [], []
        wrong = got != entry["expect"] or (got == "OK" and row_errors != entry.get("rowErrors", []))
        if got == "OK" and "envelopes" in entry and len(results) != entry["envelopes"]:
            wrong = True
        if got == "OK" and "sameAs" in entry and results[0][0] != models[entry["sameAs"]]:
            wrong = True
        if wrong:
            problems.append(f"{entry['file']}: expected {entry['expect']} {entry.get('rowErrors', '')}, got {got} {row_errors}")
    for entry in content_entries():
        got, row_errors = content_answer(entry)
        if got != entry["expect"] or (got == "OK" and row_errors != entry.get("rowErrors", [])):
            problems.append(f"content case {entry['box']}/{entry['name']}: expected {entry['expect']} "
                            f"{entry.get('rowErrors', '')}, got {got} {row_errors}")
    for case in marks_cases():
        night = canonical("night", load("night-small"))
        for edit in case.get("edit", []):
            apply_edit(night, edit)
        got, changed = marks(night, case["log"])
        if got != case["expect"] or changed != case["changed"]:
            problems.append(f"marks: {case['name']}: got {got} {changed}")
    return problems


# ---------------------------------------------------------------------------------------------------------
# Measurement: synthetic data shaped like a real night (invented names; ids shaped like the app's)
# ---------------------------------------------------------------------------------------------------------

def synthetic_night(items, roster_size=60, lines_per_item=8, known=20, seed=1):
    rng = random.Random(seed)
    letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    fid = lambda: "".join(rng.choice(letters) for _ in range(20))  # Firestore ids are 20 characters
    firsts = ["Jorren", "Mirelle", "Tobin", "Arwyn", "Calder", "Brisa", "Dovan", "Elsith", "Faro", "Gwenna"]
    lasts = ["Ashvale", "Dunmore", "Blackwater", "Thornfield", "Greywind", "Oakhart"]
    classes = [("Warrior", "Tank"), ("Priest", "Healer"), ("Mage", "Ranged"), ("Rogue", "Melee"), ("Druid", "Healer")]
    roster = []
    for k in range(1, roster_size + 1):
        cls, role = rng.choice(classes)
        roster.append({"k": k, "id": fid(), "name": f"{rng.choice(firsts)}{k}", "surname": rng.choice(lasts),
                       "class": cls, "role": role, "locked": k <= 40})
    bosses = [{"npcId": 10000 + b, "name": f"Boss Number {b}", "zoneId": 2000} for b in range(1, 16)]
    priorities = []
    for i in range(1, items + 1):
        boss = bosses[i % len(bosses)]
        lines = [{"k": rng.randint(1, roster_size)} for _ in range(lines_per_item)]
        lines[0]["awarded"] = True
        if i % 5 == 0:
            lines.append({"text": "any caster who did not get the cloak"})
        priority = {"id": fid(), "item": f"Generated Item of the Night {i}", "itemId": 200000 + i,
                    "encounter": boss["name"], "npcId": boss["npcId"], "zoneId": boss["zoneId"], "lines": lines}
        if i % 3 == 0:
            priority["note"] = "Tanks first, then whoever attends most."
        priorities.append(priority)
    return {"schema": 1, "id": "n-" + fid()[:12], "at": 1796866200, "by": "RaidDesk/2026.12.09", "phase": 0,
            "known": [{"id": f"s-tpt2u0-{fid()[:4].lower()}-{n}", "rev": 1796866200 + n} for n in range(1, known + 1)],
            "roster": roster, "bosses": bosses, "priorities": priorities}


def synthetic_awards(count, seed=2):
    rng = random.Random(seed)
    awards = []
    for n in range(1, count + 1):
        awards.append({"id": f"s-tpt2u0-q4tz-{n}", "rev": 1796866260 + n * 60, "session": "s-tpt2u0-q4tz",
                       "at": 1796866200 + n * 60, "date": "2026-12-09", "phase": 1, "raid": "raid-1209",
                       "itemId": 200000 + n, "item": f"Generated Item of the Night {n}",
                       "toId": "".join(rng.choice("abcdefghij0123456789") for _ in range(20)),
                       "to": "Jorren Ashvale", "priority": "".join(rng.choice("klmnop456789") for _ in range(20)),
                       "encounter": "Boss Number 3", "npcId": 10003, "zoneId": 2000,
                       "delivery": {"state": "received", "at": 1796866260 + n * 60, "how": "master-loot"}})
    return {"schema": 1, "id": "a-tpt9k0-q4tz", "at": 1796876000, "by": "IntrepidManager/0.1.0", "awards": awards}


def measure():
    print("night strings (60 roster entries, 8 lines per item, 15 bosses, 20 known awards)")
    for items in [10, 50, 100, 200, 400]:
        print(f"{items:>6} items {len(string_for('night', synthetic_night(items))):>9,}")
    print(f"   100 items with 500 known awards {len(string_for('night', synthetic_night(100, known=500))):>9,}")
    print("awards strings")
    for count in [10, 40, 100]:
        print(f"{count:>6} awards {len(string_for('awards', synthetic_awards(count))):>8,}")


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "check"
    if command == "build":
        changed = build(write=True)
        print(f"{len(changed)} fixture files written or removed" if changed else "fixtures already up to date")
    elif command == "check":
        stale = build(write=False)
        if stale:
            print("out of date (run: python3 tools/exchange_fixtures.py build):\n  " + "\n  ".join(stale))
            sys.exit(1)
        problems = verify()
        if problems:
            print("the reference implementation disagrees with the fixtures:\n  " + "\n  ".join(problems))
            sys.exit(1)
        print(f"fixtures up to date; the reference reader agrees with all {len(cases())} cases, the reference content "
              f"checks with all {len(content_entries())} content cases and the reference marks with all "
              f"{len(marks_cases())} marks cases")
    elif command == "measure":
        measure()
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
