#!/usr/bin/env python3
"""Known-good list of the game's API names, and a check that the addon only uses names on it.

The game is out of reach for weeks at a time (the beta is over until launch), and a call to a name the client does
not have is an error a player meets mid-raid. tools/api-known.json lists the client names we have evidence for, with
the source of the evidence, and the names we know the client lacks. `check` reads the addon's Lua files and fails on
any client name that is neither on the list nor in the "unverified" section (which carries the reason and is printed
as a to-do for the next game session).

  python3 tools/api_lint.py check                 lint IntrepidManager/ and the client globals in .luacheckrc
  python3 tools/api_lint.py selftest              test this tool and the data file (CI runs both)
  python3 tools/api_lint.py collect PATH... [--defs PATH...] [--exclude DIR...] [--ignore NAME...] [--luacheck]
                                          [--source ID --merge]
                                                  list the client names a Lua tree uses (another addon, a new
                                                  file); --merge adds the ones not yet listed, as present, with
                                                  that source
  python3 tools/api_lint.py facts FILE...         merge what saved variables of the probe, the self-test and /im facts
                                                  say exists or not (names only; nothing else is read into the list)
  python3 tools/api_lint.py widgets FILE...       write tools/api-widgets.json: the methods the game gives each widget
                                                  type, from the saved variables of /im facts (the stand-in widgets
                                                  refuse a method that the game's widget of that type does not have)
  python3 tools/api_lint.py add --kind K [--ns NS] (--source ID | --unverified NOTE) NAME...
                                                  list names by hand, with the evidence or the reason it is missing

What `check` covers: method calls (obj:Name(...)), members of listed namespaces (C_PartyInfo.GetLootMethod,
Enum.LootMethod.Group), events given to RegisterEvent/RegisterUnitEvent/UnregisterEvent, frame types and templates
given to CreateFrame, font objects given to CreateFontString, and the client globals named in .luacheckrc (luacheck
itself rejects any other global). What it cannot cover: the type of a variable (a real method on the wrong widget
type), arguments, and names built at run time (those are counted and reported). Evidence is about existence only.

Standard library only. Python 3.9 or newer.
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KNOWN_PATH = ROOT / "tools" / "api-known.json"
WIDGETS_PATH = ROOT / "tools" / "api-widgets.json"
ADDON_DIR = ROOT / "IntrepidManager"
LUACHECKRC = ROOT / ".luacheckrc"

FORMAT = 1
KINDS = ["globals", "namespaces", "events", "frame_types", "templates", "fonts", "methods"]
STATUSES = ["present", "absent", "unverified"]
NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# Every source an entry can cite. `check` and `selftest` refuse an entry that names a source not listed here.
SOURCES = {
    "probe": (
        "IntrepidProbe 0.5 to 0.6.3, run in the Forever beta on 2026-10-19 and 2026-10-20 on a Mac and a Windows PC. "
        "Its saved results say the name exists (a function, a table, a template that CreateFrame accepted) or not."
    ),
    "selftest": (
        "IntrepidManager 0.0.2 and 0.0.3 (/im selftest), run in the Forever beta on the same days. The saved result "
        "shows the call worked; its chat output was read by the person who ran it."
    ),
    "facts": (
        "IntrepidManager 0.0.4 and later (/im facts), run in the Forever beta on 2026-10-21 on a Windows PC (build 70450). "
        "The game listed the methods of each widget type (Frame, Button, CheckButton, EditBox, ScrollFrame, Slider, "
        "StatusBar, FontString, Texture), and the facts run created fonts and templates and said whether the game accepted them."
    ),
    "fl": (
        "ForeverLoot 1.0.2 (MIT, interface 16001, by Zerpy), an addon written for the Forever client. Its shipped "
        "code uses the name, so the name very likely exists. Nothing proves that code path ran, and nothing here "
        "says how the arguments work."
    ),
}

# Methods of the string library, called as ("x"):rep(2) or s:format(...). Lua 5.1 reference manual, section 5.4.
LUA51_STRING_METHODS = {
    "byte", "char", "dump", "find", "format", "gmatch", "gsub", "len", "lower", "match", "rep", "reverse", "sub", "upper",
}

EVENT_METHODS = {"RegisterEvent", "RegisterUnitEvent", "UnregisterEvent"}
MISSING = object()   # an argument that was not given
DYNAMIC = object()   # an argument that is not a plain string literal

# Roots whose members a foreign addon's code is read for (`collect`): C_ tables are always namespaces.
NAMESPACE_ROOTS = {"Enum", "Settings", "MenuUtil", "TooltipDataProcessor", "SOUNDKIT", "LinkUtil", "ScrollUtil", "TableUtil"}


# ----------------------------------------------------------------------------------------------------------------
# A Lua 5.1 tokenizer, enough to find calls without being fooled by strings and comments.

class LuaSyntaxError(Exception):
    pass


TOKEN = re.compile(
    r"(?P<ws>[ \t\r\f\v]+)"
    r"|(?P<nl>\n)"
    r"|(?P<lcomment>--\[(?P<lc>=*)\[.*?\](?P=lc)\])"
    r"|(?P<comment>--[^\n]*)"
    r"|(?P<lstring>\[(?P<ls>=*)\[.*?\](?P=ls)\])"
    r"|(?P<string>\"(?:[^\"\\\n]|\\.)*\"|'(?:[^'\\\n]|\\.)*')"
    r"|(?P<number>0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)"
    r"|(?P<name>[A-Za-z_][A-Za-z0-9_]*)"
    r"|(?P<sym>\.\.\.|\.\.|==|~=|<=|>=|[-+*/%^#<>=(){}\[\];:,.])",
    re.DOTALL,
)

ESCAPES = {"a": "\a", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v", "\\": "\\", '"': '"',
           "'": "'", "\n": "\n"}


def decode_string(raw):
    """The value of a quoted Lua string, given what is between the quotes."""
    if "\\" not in raw:
        return raw
    out = []
    i = 0
    while i < len(raw):
        char = raw[i]
        if char != "\\":
            out.append(char)
            i += 1
            continue
        i += 1
        if i >= len(raw):
            break
        char = raw[i]
        if char.isdigit():
            j = i
            while j < len(raw) and j < i + 3 and raw[j].isdigit():
                j += 1
            out.append(chr(int(raw[i:j]) % 256))
            i = j
        else:
            out.append(ESCAPES.get(char, char))
            i += 1
    return "".join(out)


def long_string_value(text):
    inner = re.match(r"\[(=*)\[(.*)\]\1\]$", text, re.DOTALL).group(2)
    return inner[1:] if inner.startswith("\n") else inner


def tokenize(text):
    """-> list of (kind, value, line); kind is name, string, number or sym. Comments and spaces are dropped."""
    tokens = []
    line = 1
    pos = 0
    end = len(text)
    while pos < end:
        match = TOKEN.match(text, pos)
        if not match:
            raise LuaSyntaxError("line %d: cannot read %r" % (line, text[pos:pos + 12]))
        kind = match.lastgroup
        piece = match.group(0)
        if kind == "nl":
            line += 1
        elif kind == "lcomment":
            line += piece.count("\n")
        elif kind == "lstring":
            tokens.append(("string", long_string_value(piece), line))
            line += piece.count("\n")
        elif kind == "string":
            tokens.append(("string", decode_string(piece[1:-1]), line))
            line += piece.count("\n")
        elif kind in ("number", "name", "sym"):
            tokens.append((kind, piece, line))
        pos = match.end()
    return tokens


# ----------------------------------------------------------------------------------------------------------------
# Finding what a file calls.

class Scan:
    """What one Lua file uses and defines."""

    def __init__(self):
        self.methods = []   # (name, line) for obj:Name(...)
        self.chains = []    # (parts, line) for A.B.C reached from a plain name
        self.events = []    # (name or DYNAMIC, line) for :RegisterEvent("NAME")
        self.frames = []    # (frame type, template, line) for CreateFrame(type, name, parent, template)
        self.fonts = []     # (font object or DYNAMIC, line) for :CreateFontString(name, layer, font)
        self.defined = set()  # names the file defines itself: function A:b(), local function c(), d = function()
        self.shadowed = set()  # names a `local` hides, so that Settings.X may be the file's own table, not the client's


def is_sym(token, value):
    return token[0] == "sym" and token[1] == value


def call_args(tokens, i):
    """tokens[i] is the "(" of a call. -> (list of token lists, one per argument, index of the matching ")")."""
    depth = 0
    args, current = [], []
    j = i
    while j < len(tokens):
        kind, value, _ = tokens[j]
        if kind == "sym" and value in ("(", "{", "["):
            depth += 1
            if depth > 1:
                current.append(tokens[j])
        elif kind == "sym" and value in (")", "}", "]"):
            depth -= 1
            if depth == 0:
                if current or args:
                    args.append(current)
                return args, j
            current.append(tokens[j])
        elif kind == "sym" and value == "," and depth == 1:
            args.append(current)
            current = []
        else:
            current.append(tokens[j])
        j += 1
    return args, j


def literal(args, index):
    """The string literal given as argument `index`, MISSING if not given, DYNAMIC if it is anything else."""
    if index >= len(args):
        return MISSING
    arg = args[index]
    if len(arg) == 1 and arg[0][0] == "string":
        return arg[0][1]
    return DYNAMIC


def scan_source(text):
    tokens = tokenize(text)
    n = len(tokens)
    sc = Scan()
    skip = set()  # tokens that are part of the name in a function definition

    for i, (kind, value, _) in enumerate(tokens):
        if kind != "name":
            continue
        if value == "function" and i + 1 < n and tokens[i + 1][0] == "name":
            last = tokens[i + 1][1]
            skip.add(i + 1)
            k = i + 2
            while k + 1 < n and tokens[k][0] == "sym" and tokens[k][1] in (".", ":") and tokens[k + 1][0] == "name":
                last = tokens[k + 1][1]
                skip.update((k, k + 1))
                k += 2
            sc.defined.add(last)
        elif i + 2 < n and is_sym(tokens[i + 1], "=") and tokens[i + 2][:2] == ("name", "function"):
            sc.defined.add(value)

    for i, (kind, value, _) in enumerate(tokens):
        if kind != "name" or value != "local" or i + 1 >= n:
            continue
        if tokens[i + 1][:2] == ("name", "function"):
            if i + 2 < n and tokens[i + 2][0] == "name":
                sc.shadowed.add(tokens[i + 2][1])
            continue
        names = []
        k = i + 1
        while k < n and tokens[k][0] == "name":
            names.append(tokens[k][1])
            k += 2 if k + 1 < n and is_sym(tokens[k + 1], ",") else 1
            if not is_sym(tokens[k - 1], ","):
                break
        if names and k < n and is_sym(tokens[k], "="):
            # `local C_Timer = C_Timer` only copies the client's global; any other value hides it
            rhs = tokens[k + 1] if k + 1 < n else ("eof", "", 0)
            after = tokens[k + 2] if k + 2 < n else ("eof", "", 0)
            copies = (len(names) == 1 and rhs[0] == "name" and rhs[1] == names[0]
                      and not (after[0] == "sym" and after[1] in (".", ":", "(")))
            if not copies:
                sc.shadowed.update(names)
        else:
            sc.shadowed.update(names)

    for i, (kind, value, line) in enumerate(tokens):
        if i in skip:
            continue
        if kind == "sym" and value == ":" and i > 0 and i + 2 < n and tokens[i + 1][0] == "name" and (i + 1) not in skip:
            after = tokens[i + 2]
            if after[0] == "string" or (after[0] == "sym" and after[1] in ("(", "{")):
                name = tokens[i + 1][1]
                sc.methods.append((name, tokens[i + 1][2]))
                if is_sym(after, "("):
                    if name in EVENT_METHODS:
                        args, _ = call_args(tokens, i + 2)
                        sc.events.append((literal(args, 0), line))
                    elif name == "CreateFontString":
                        args, _ = call_args(tokens, i + 2)
                        font = literal(args, 2)
                        if font is not MISSING:
                            sc.fonts.append((font, line))
        elif kind == "name":
            if i > 0 and tokens[i - 1][0] == "sym" and tokens[i - 1][1] in (".", ":"):
                continue  # not the start of a chain
            if value == "CreateFrame" and i + 1 < n and is_sym(tokens[i + 1], "("):
                args, _ = call_args(tokens, i + 1)
                sc.frames.append((literal(args, 0), literal(args, 3), line))
            if i + 2 < n and is_sym(tokens[i + 1], ".") and tokens[i + 2][0] == "name" and (i + 2) not in skip:
                parts = [value]
                k = i + 1
                while k + 1 < n and is_sym(tokens[k], ".") and tokens[k + 1][0] == "name":
                    parts.append(tokens[k + 1][1])
                    k += 2
                sc.chains.append((parts, line))
    sc.chains = [(parts, line) for parts, line in sc.chains if parts[0] not in sc.shadowed]
    return sc


# ----------------------------------------------------------------------------------------------------------------
# The known-good list.

def new_known():
    return {
        "format": FORMAT,
        "sources": dict(SOURCES),
        "complete_namespaces": [],
        "present": {kind: {} for kind in KINDS},
        "absent": {kind: {} for kind in KINDS},
        "unverified": {kind: {} for kind in KINDS},
    }


def emit(value, level):
    """JSON with one entry per line, keys sorted, so a diff shows exactly the entries that changed."""
    if isinstance(value, dict):
        if not value:
            return "{}"
        pad = " " * (level + 1)
        items = ["%s%s: %s" % (pad, json.dumps(key), emit(value[key], level + 1)) for key in sorted(value)]
        return "{\n" + ",\n".join(items) + "\n" + " " * level + "}"
    return json.dumps(value)


def dump_known(data):
    top = ["format", "sources", "complete_namespaces", "present", "absent", "unverified"]
    pad = " "
    parts = []
    for key in top:
        parts.append("%s%s: %s" % (pad, json.dumps(key), emit(data[key], 1)))
    return "{\n" + ",\n".join(parts) + "\n}\n"


def load_known(path=KNOWN_PATH):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def sync_sources(data):
    """The list carries the text of every source it cites: a source added to this tool shows up in the file when it is saved."""
    for key, text in SOURCES.items():
        data.setdefault("sources", {}).setdefault(key, text)


def save_known(data, path=KNOWN_PATH):
    sync_sources(data)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(dump_known(data))


def add_sources(existing, new):
    """Join two "a+b" source strings without duplicates."""
    ids = set(existing.split("+")) | set(new.split("+")) if existing else set(new.split("+"))
    return "+".join(sorted(ids))


class Known:
    def __init__(self, data):
        self.data = data
        self.complete = set(data.get("complete_namespaces", []))

    def lookup(self, kind, name, ns=None):
        """-> (status, detail) with status present, absent or unverified; (None, None) if the list says nothing."""
        for status in STATUSES:
            table = self.data[status][kind]
            entry = table.get(ns, {}).get(name) if kind == "namespaces" else table.get(name)
            if entry is not None:
                return status, entry
        return None, None

    def is_namespace(self, name):
        return any(name in self.data[status]["namespaces"] for status in STATUSES)

    def problems(self):
        """Mistakes in the data file itself."""
        data = self.data
        out = []
        if data.get("format") != FORMAT:
            out.append("format is %r, expected %d" % (data.get("format"), FORMAT))
        sources = data.get("sources", {})
        for key, text in sources.items():
            if not isinstance(text, str) or not text.strip():
                out.append("source %s has no description" % key)
        for status in STATUSES:
            section = data.get(status)
            if not isinstance(section, dict):
                out.append("section %s is missing" % status)
                continue
            for kind in KINDS:
                table = section.get(kind)
                if not isinstance(table, dict):
                    out.append("%s.%s is missing" % (status, kind))
                    continue
                entries = []
                for name, value in table.items():
                    if kind == "namespaces":
                        if not isinstance(value, dict):
                            out.append("%s.namespaces.%s is not a table of members" % (status, name))
                            continue
                        entries.extend(("%s.%s" % (name, member), member, detail) for member, detail in value.items())
                        if not all(NAME_RE.match(part) for part in name.split(".")):
                            out.append("%s.namespaces: odd name %r" % (status, name))
                    else:
                        entries.append((name, name, value))
                for label, name, detail in entries:
                    if not NAME_RE.match(name):
                        out.append("%s.%s: odd name %r" % (status, kind, label))
                    if not isinstance(detail, str) or not detail.strip():
                        out.append("%s.%s.%s: empty source or note" % (status, kind, label))
                    elif status != "unverified":
                        for source in detail.split("+"):
                            if source not in sources:
                                out.append("%s.%s.%s: unknown source %r" % (status, kind, label, source))
        if not out:
            for kind in KINDS:
                if kind == "namespaces":
                    for ns, members in data["present"][kind].items():
                        for member in members:
                            for status in ("absent", "unverified"):
                                if member in data[status][kind].get(ns, {}):
                                    out.append("%s.%s is both present and %s" % (ns, member, status))
                else:
                    for name in data["present"][kind]:
                        for status in ("absent", "unverified"):
                            if name in data[status][kind]:
                                out.append("%s %s is both present and %s" % (kind, name, status))
            for ns in self.complete:
                if ns not in data["present"]["namespaces"]:
                    out.append("complete_namespaces lists %s, which has no present members" % ns)
        return out


# ----------------------------------------------------------------------------------------------------------------
# The check.

class Report:
    def __init__(self):
        self.errors = []      # (path, line, message)
        self.unverified = []  # (path, line, message)
        self.checked = {}     # kind -> number of uses that were looked up
        self.dynamic = []     # (path, line, what)

    def count(self, kind):
        self.checked[kind] = self.checked.get(kind, 0) + 1


def how_to_fix(kind, name, ns=None):
    where = "tools/api-known.json, section present.%s" % kind
    if kind == "namespaces":
        where = "tools/api-known.json, present.namespaces.%s" % ns
    return (
        "add %s to %s with a source (a probe result, the self-test or ForeverLoot), or list it under unverified with the "
        "reason and plan a test for the next game session"
    ) % (name, where)


def judge(known, kind, name, label, ns=None, complete=False):
    """-> None if the name is fine, else ("error" or "unverified", message)."""
    status, detail = known.lookup(kind, name, ns)
    if status == "present":
        return None
    if status == "unverified":
        return "unverified", "%s is unverified: %s" % (label, detail)
    if status == "absent":
        return "error", "%s does not exist on the Forever client (source: %s)" % (label, detail)
    if complete:
        return "error", "%s is not a member of %s on the Forever client (the probe listed all of its members)" % (label, ns)
    return "error", "%s is not on the known-good list; %s" % (label, how_to_fix(kind, name, ns))


def lint_scans(known, scans):
    """scans: list of (path, Scan). -> Report."""
    report = Report()
    defined = set()
    for _, sc in scans:
        defined |= sc.defined

    def record(path, line, verdict):
        if verdict is None:
            return
        level, message = verdict
        (report.errors if level == "error" else report.unverified).append((path, line, message))

    for path, sc in scans:
        for name, line in sc.methods:
            if name in LUA51_STRING_METHODS or name in defined:
                continue
            report.count("methods")
            record(path, line, judge(known, "methods", name, "method :%s()" % name))
        for parts, line in sc.chains:
            for k in range(len(parts) - 1, 0, -1):
                prefix = ".".join(parts[:k])
                if known.is_namespace(prefix):
                    report.count("namespace members")
                    member = parts[k]
                    record(path, line, judge(known, "namespaces", member, "%s.%s" % (prefix, member), ns=prefix,
                                             complete=prefix in known.complete))
                    break
            else:
                root = parts[0]
                if root.startswith("C_") or root == "Enum":
                    report.count("namespace members")
                    record(path, line, ("error", "%s is not a namespace on the known-good list (%s.%s); list its members "
                                        "from a probe run first" % (root, parts[0], parts[1])))
        for event, line in sc.events:
            if event is DYNAMIC:
                report.dynamic.append((path, line, "event name"))
                continue
            report.count("events")
            record(path, line, judge(known, "events", event, "event %s" % event))
        for ftype, template, line in sc.frames:
            if ftype is DYNAMIC:
                report.dynamic.append((path, line, "frame type"))
            else:
                report.count("frame types")
                record(path, line, judge(known, "frame_types", ftype, "frame type %s" % ftype))
            if template is DYNAMIC:
                report.dynamic.append((path, line, "template"))
            elif template is not MISSING:
                for item in re.split(r"[,\s]+", template.strip()):
                    if item:
                        report.count("templates")
                        record(path, line, judge(known, "templates", item, "template %s" % item))
        for font, line in sc.fonts:
            if font is DYNAMIC:
                report.dynamic.append((path, line, "font object"))
                continue
            report.count("fonts")
            record(path, line, judge(known, "fonts", font, "font object %s" % font))
    return report


def luacheckrc_read_globals(text):
    """The names in the top-level read_globals = { ... } of .luacheckrc (the client globals the addon may read)."""
    tokens = tokenize(text)
    depth = 0
    names = []
    i = 0
    while i < len(tokens):
        kind, value, line = tokens[i]
        if kind == "sym" and value == "{":
            depth += 1
        elif kind == "sym" and value == "}":
            depth -= 1
        elif (depth == 0 and kind == "name" and value == "read_globals" and i + 2 < len(tokens)
              and is_sym(tokens[i + 1], "=") and is_sym(tokens[i + 2], "{")):
            j = i + 3
            while j < len(tokens) and not is_sym(tokens[j], "}"):
                if tokens[j][0] == "string":
                    names.append((tokens[j][1], tokens[j][2]))
                j += 1
            i = j
        i += 1
    return names


def lint_globals(known, names, report, path):
    for name, line in names:
        report.count("globals")
        status, detail = known.lookup("globals", name)
        if status is None and known.is_namespace(name):
            continue  # a namespace table such as C_AddOns; its members are checked where they are used
        if status is None:
            report.errors.append((path, line, "global %s is not on the known-good list; %s" % (name, how_to_fix("globals", name))))
        elif status == "absent":
            report.errors.append((path, line, "global %s does not exist on the Forever client (source: %s)" % (name, detail)))
        elif status == "unverified":
            report.unverified.append((path, line, "global %s is unverified: %s" % (name, detail)))


def lua_files(paths, exclude=()):
    files = []
    for entry in paths:
        entry = Path(entry)
        if entry.is_file():
            files.append(entry)
        else:
            for found in sorted(entry.rglob("*.lua")):
                if not any(part in exclude for part in found.relative_to(entry).parts):
                    files.append(found)
    return files


def read_scan(path):
    return scan_source(Path(path).read_text(encoding="utf-8", errors="replace"))


def display(path):
    try:
        return str(Path(path).resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def run_check(known_data=None, addon_dir=ADDON_DIR, luacheckrc=LUACHECKRC, out=print):
    """Lint the addon. -> (number of errors, Report)."""
    data = known_data if known_data is not None else load_known()
    known = Known(data)
    problems = known.problems()
    for problem in problems:
        out("tools/api-known.json: %s" % problem)
    scans = []
    for path in lua_files([addon_dir]):
        try:
            scans.append((display(path), read_scan(path)))
        except LuaSyntaxError as err:
            problems.append("%s: %s" % (display(path), err))
            out("%s: %s" % (display(path), err))
    report = lint_scans(known, scans)
    if Path(luacheckrc).exists():
        lint_globals(known, luacheckrc_read_globals(Path(luacheckrc).read_text(encoding="utf-8")), report, display(luacheckrc))
    for path, line, message in report.errors:
        out("%s:%d: %s" % (path, line, message))
    if report.unverified:
        out("Unverified names the addon uses (test these in the next game session):")
        for path, line, message in report.unverified:
            out("  %s:%d: %s" % (path, line, message))
    if report.dynamic:
        out("Not checked, built at run time: %d (%s)" % (
            len(report.dynamic), ", ".join(sorted({"%s:%d %s" % (p, l, w) for p, l, w in report.dynamic}))))
    total = sum(report.checked.values())
    summary = ", ".join("%d %s" % (count, kind) for kind, count in sorted(report.checked.items())) or "nothing"
    out("API check: %d uses looked up (%s); %d errors, %d unverified." % (total, summary, len(report.errors) + len(problems),
                                                                            len(report.unverified)))
    return len(report.errors) + len(problems), report


# ----------------------------------------------------------------------------------------------------------------
# Reading saved variables (the files the probe and the self-test leave behind) for existence facts.

def parse_saved_variables(text):
    """Parse the Lua table constructors of a saved-variables file. -> dict of the global assignments."""
    tokens = tokenize(text)
    n = len(tokens)
    pos = [0]

    def peek():
        return tokens[pos[0]] if pos[0] < n else ("eof", "", 0)

    def take():
        token = peek()
        pos[0] += 1
        return token

    def expect(value):
        token = take()
        if token[1] != value or token[0] not in ("sym", "name"):
            raise LuaSyntaxError("line %d: expected %s, found %r" % (token[2], value, token[1]))

    def number(token):
        text_value = token[1]
        if text_value[:2] in ("0x", "0X"):
            return int(text_value, 16)
        return float(text_value) if any(c in text_value for c in ".eE") else int(text_value)

    def value():
        kind, text_value, line = take()
        if kind == "string":
            return text_value
        if kind == "number":
            return number((kind, text_value, line))
        if kind == "name" and text_value in ("true", "false", "nil"):
            return {"true": True, "false": False, "nil": None}[text_value]
        if kind == "sym" and text_value == "-":
            kind2, text2, line2 = take()
            if kind2 != "number":
                raise LuaSyntaxError("line %d: expected a number after -" % line)
            return -number((kind2, text2, line2))
        if kind == "sym" and text_value == "{":
            table = {}
            index = 1
            while not is_sym(peek(), "}"):
                if peek()[0] == "eof":
                    raise LuaSyntaxError("unterminated table")
                if is_sym(peek(), "["):
                    take()
                    key = value()
                    expect("]")
                    expect("=")
                    item = value()
                    if item is not None:
                        table[key] = item
                elif peek()[0] == "name" and pos[0] + 1 < n and is_sym(tokens[pos[0] + 1], "="):
                    key = take()[1]
                    take()
                    item = value()
                    if item is not None:
                        table[key] = item
                else:
                    item = value()
                    if item is not None:
                        table[index] = item
                    index += 1
                if is_sym(peek(), ",") or is_sym(peek(), ";"):
                    take()
            take()
            return table
        raise LuaSyntaxError("line %d: cannot read a value at %r" % (line, text_value))

    result = {}
    while peek()[0] != "eof":
        kind, name, line = take()
        if kind != "name":
            raise LuaSyntaxError("line %d: expected a variable name" % line)
        expect("=")
        result[name] = value()
        if is_sym(peek(), ";"):
            take()
    return result


class Facts:
    """Existence facts read from saved variables: kind -> name -> bool (namespaces: ns -> member -> bool)."""

    def __init__(self):
        self.seen = {kind: {} for kind in KINDS}
        self.complete = set()

    def note(self, kind, name, exists, ns=None):
        if not NAME_RE.match(name) or (ns is not None and not all(NAME_RE.match(p) for p in ns.split("."))):
            return
        table = self.seen[kind].setdefault(ns, {}) if kind == "namespaces" else self.seen[kind]
        table.setdefault(name, set()).add(bool(exists))

    def update(self, other):
        """Add the outcomes of another Facts (another file of the same source)."""
        for kind in KINDS:
            if kind == "namespaces":
                for ns, table in other.seen[kind].items():
                    for name, outcomes in table.items():
                        self.seen[kind].setdefault(ns, {}).setdefault(name, set()).update(outcomes)
            else:
                for name, outcomes in other.seen[kind].items():
                    self.seen[kind].setdefault(name, set()).update(outcomes)
        self.complete |= other.complete

    def dotted(self, name, exists):
        """A name such as C_AddOns.GetAddOnInfo or CreateFrame, as probe.apis lists them."""
        parts = name.split(".")
        if len(parts) == 1:
            self.note("globals", name, exists)
            return
        ns, member = ".".join(parts[:-1]), parts[-1]
        self.note("namespaces", member, exists, ns=ns)
        if exists:
            for k in range(1, len(parts)):
                ancestor = ".".join(parts[:k])
                if k == 1:
                    self.note("globals", ancestor, True)
                else:
                    self.note("namespaces", parts[k - 1], True, ns=".".join(parts[:k - 1]))


def facts_from_saved(saved):
    """Facts from a decoded IntrepidProbe.lua or IntrepidManager.lua. Only API names and yes/no are taken."""
    facts = Facts()
    probe_db = saved.get("IntrepidProbeDB")
    if isinstance(probe_db, dict):
        bundle = probe_db.get("bundle") if isinstance(probe_db.get("bundle"), dict) else {}
        probe = probe_db.get("probe") if isinstance(probe_db.get("probe"), dict) else {}
        apis = []
        if isinstance(probe.get("apis"), dict):
            apis.append(probe["apis"])
        if isinstance(probe.get("namespaces"), dict):
            apis.append(probe["namespaces"])
        if isinstance(probe.get("enums"), dict):
            apis.append(probe["enums"])
        ui = bundle.get("ui") if isinstance(bundle.get("ui"), dict) else {}
        if isinstance(ui.get("apis"), dict):
            apis.append(ui["apis"])
        for table in apis:
            for name, value in table.items():
                if isinstance(name, str):
                    facts.dotted(name, value not in (False, "nil", None))
        if isinstance(probe.get("events"), dict):
            for event, ok in probe["events"].items():
                if isinstance(event, str) and isinstance(ok, bool):
                    facts.note("events", event, ok)
        if isinstance(probe_db.get("events"), dict):  # the log of events that fired; only their names are used
            for entry in probe_db["events"].values():
                if isinstance(entry, dict) and isinstance(entry.get("event"), str):
                    facts.note("events", entry["event"], True)
        namespaces = bundle.get("namespaces") if isinstance(bundle.get("namespaces"), dict) else {}
        for ns, members in namespaces.items():
            if not isinstance(ns, str) or not isinstance(members, dict):
                continue
            facts.dotted(ns, True)
            facts.complete.add(ns)
            for member in members.values():
                if isinstance(member, str):
                    facts.note("namespaces", member.split("=")[0], True, ns=ns)
        if isinstance(ui.get("fonts"), dict):
            for font, value in ui["fonts"].items():
                if isinstance(font, str):
                    facts.note("fonts", font, value not in (False, "nil", None))
        if isinstance(ui.get("templates"), dict):
            for label, result in ui["templates"].items():
                if not isinstance(label, str) or not isinstance(result, str):
                    continue
                ok = result.startswith("ok")
                if " + " in label:
                    ftype, template = label.split(" + ", 1)
                    facts.note("templates", template, ok)
                else:
                    ftype = label
                if ok:
                    facts.note("frame_types", ftype, True)
    manager_db = saved.get("IntrepidManagerDB")
    if isinstance(manager_db, dict) and isinstance(manager_db.get("selftest"), dict):
        selftest = manager_db["selftest"]
        info = selftest.get("info") if isinstance(selftest.get("info"), dict) else {}
        if isinstance(selftest.get("client"), dict):
            facts.note("globals", "GetBuildInfo", True)
        if selftest.get("ranAt") is not None:
            facts.note("globals", "time", True)
        if selftest.get("serverTime") is not None:
            facts.note("globals", "GetServerTime", True)
        if info.get("hasBit") is True:
            facts.note("globals", "bit", True)
        if info.get("hasBxor") is True:
            facts.note("namespaces", "bxor", True, ns="bit")
        if info.get("timer") == "debugprofilestop":
            facts.note("globals", "debugprofilestop", True)
        if selftest.get("passed") is not None:
            facts.note("globals", "print", True)  # the command prints its summary in chat; the file exists because it ran
    return facts


def facts_from_widget_facts(saved):
    """Facts from IntrepidManagerDB.facts (/im facts): method names by widget type, fonts, templates and frame types."""
    facts = Facts()
    manager_db = saved.get("IntrepidManagerDB")
    measured = manager_db.get("facts") if isinstance(manager_db, dict) else None
    if not isinstance(measured, dict):
        return facts
    methods = measured.get("methods")
    if isinstance(methods, dict):
        for entry in methods.values():
            if not isinstance(entry, dict):
                continue
            for field in ("names", "curatedPresent"):
                if isinstance(entry.get(field), str):
                    for name in entry[field].split():
                        facts.note("methods", name, True)
    fonts = measured.get("fonts")
    if isinstance(fonts, dict):
        for font, entry in fonts.items():
            if isinstance(font, str) and isinstance(entry, dict):
                facts.note("fonts", font, entry.get("missing") is not True)
    templates = measured.get("templates")
    if isinstance(templates, dict):
        for label, entry in templates.items():
            if not isinstance(label, str) or " + " not in label or not isinstance(entry, dict):
                continue
            ftype, template = label.split(" + ", 1)
            ok = "error" not in entry
            facts.note("templates", template, ok)
            if ok:
                facts.note("frame_types", ftype, True)
    return facts


def widget_methods(saved):
    """{widget type: sorted method names} from the saved variables of /im facts, for the types the game let us list."""
    manager_db = saved.get("IntrepidManagerDB")
    measured = manager_db.get("facts") if isinstance(manager_db, dict) else None
    types = {}
    methods = measured.get("methods") if isinstance(measured, dict) else None
    if isinstance(methods, dict):
        for kind, entry in methods.items():
            if isinstance(kind, str) and isinstance(entry, dict) and entry.get("listed") is True and isinstance(entry.get("names"), str):
                types[kind] = sorted({n for n in entry["names"].split() if NAME_RE.match(n)})
    return types


def merge_facts(data, facts, source, out=print):
    """Merge facts (one source) into the list in place. -> number of changes."""
    changes = 0
    for kind in KINDS:
        seen = facts.seen[kind]
        groups = seen.items() if kind == "namespaces" else [(None, seen)]
        for ns, table in groups:
            for name, outcomes in sorted(table.items()):
                label = "%s.%s" % (ns, name) if ns else name
                if outcomes == {True, False}:
                    place_unverified(data, kind, name, ns, "probe runs disagree about it (some saw it, some did not)")
                    out("conflict in the runs: %s %s (moved to unverified)" % (kind, label))
                    changes += 1
                    continue
                exists = True in outcomes
                changes += place(data, kind, name, ns, exists, source, label, out)
    for ns in sorted(facts.complete):
        if ns not in data["complete_namespaces"]:
            data["complete_namespaces"].append(ns)
            data["complete_namespaces"].sort()
            changes += 1
    return changes


def bucket(data, status, kind, ns):
    """The table that holds an entry, created if need be (for writing)."""
    table = data[status][kind]
    return table.setdefault(ns, {}) if kind == "namespaces" else table


def peek(data, status, kind, ns):
    """The same table, or an empty one that is not stored (for reading)."""
    table = data[status][kind]
    return table.get(ns, {}) if kind == "namespaces" else table


def drop(data, status, kind, name, ns):
    table = peek(data, status, kind, ns)
    if name in table:
        del table[name]
        if kind == "namespaces" and not table:
            del data[status][kind][ns]
        return True
    return False


def place_unverified(data, kind, name, ns, note):
    drop(data, "present", kind, name, ns)
    drop(data, "absent", kind, name, ns)
    bucket(data, "unverified", kind, ns)[name] = note


def place(data, kind, name, ns, exists, source, label, out):
    here, there = ("present", "absent") if exists else ("absent", "present")
    changed = 0
    other = peek(data, there, kind, ns).get(name)
    if other is not None:
        if there == "present" and set(other.split("+")) <= {"fl"}:
            # what the client says beats a "very likely" taken from another addon's code
            drop(data, there, kind, name, ns)
            out("%s %s: %s says it is missing, ForeverLoot's code uses it" % (kind, label, source))
            changed += 1
        else:
            place_unverified(data, kind, name, ns, "%s says %s, earlier sources say %s" % (source, here, there))
            out("conflict: %s %s (moved to unverified)" % (kind, label))
            return changed + 1
    drop(data, "unverified", kind, name, ns)
    table = bucket(data, here, kind, ns)
    old = table.get(name)
    new = add_sources(old, source)
    if new != old:
        table[name] = new
        changed += 1
    return changed


# ----------------------------------------------------------------------------------------------------------------
# Command line.

def used_names(scans, exclude_defined):
    """The client names a set of scans uses, minus what the tree defines itself. -> dict kind -> sorted names."""
    methods, events, frame_types, templates, fonts = set(), set(), set(), set(), set()
    chains = []
    for _, sc in scans:
        methods |= {name for name, _ in sc.methods}
        events |= {e for e, _ in sc.events if e is not DYNAMIC}
        for ftype, template, _ in sc.frames:
            if ftype is not DYNAMIC and ftype is not MISSING:
                frame_types.add(ftype)
            if template is not DYNAMIC and template is not MISSING:
                templates |= {t for t in re.split(r"[,\s]+", template.strip()) if t}
        fonts |= {f for f, _ in sc.fonts if f is not DYNAMIC}
        chains.extend(parts for parts, _ in sc.chains)
    methods = {m for m in methods if m not in LUA51_STRING_METHODS and m not in exclude_defined}
    return {"methods": methods, "events": events, "frame_types": frame_types, "templates": templates, "fonts": fonts,
            "chains": chains}


def luacheck_globals(paths, defs_paths, exclude):
    """Client globals a tree reads (or mutates, as SlashCmdList["X"] = ...) but never sets. Needs luacheck."""
    def run(targets, only, excluded):
        command = ["luacheck", *[str(t) for t in targets], "--no-config", "--std", "lua51", "--formatter", "plain",
                   "--codes", "--only", *only]
        if excluded:
            command += ["--exclude-files", *["**/%s/**" % d for d in excluded]]
        done = subprocess.run(command, capture_output=True, text=True)
        names = set()
        for line in done.stdout.splitlines():
            match = re.search(r"\(W(\d+)\) .*variable '([^']+)'", line)
            if match:
                names.add((match.group(1), match.group(2)))
        return names

    used = run(paths, ["112", "113"], exclude)
    defined = {name for _, name in run(list(paths) + list(defs_paths), ["111"], [])}
    return sorted({name for _, name in used} - defined)


def cmd_check(args):
    errors, _ = run_check()
    return 1 if errors else 0


def cmd_collect(args):
    exclude = set(args.exclude or [])
    files = lua_files(args.paths, exclude)
    scans = [(display(p), read_scan(p)) for p in files]
    defs = set()
    for _, sc in scans:
        defs |= sc.defined
    for _, sc in [(display(p), read_scan(p)) for p in lua_files(args.defs or [], set())]:
        defs |= sc.defined
    names = used_names(scans, defs | set(args.ignore or []))
    ignore = set(args.ignore or [])
    globals_read = [g for g in (luacheck_globals(args.paths, args.defs or [], exclude) if args.luacheck else [])
                    if g not in ignore]

    members = {}
    for parts in names["chains"]:
        root = parts[0]
        if root in ignore:
            continue
        if root.startswith("C_") or root in NAMESPACE_ROOTS:
            for k in range(1, len(parts)):
                members.setdefault(".".join(parts[:k]), set()).add(parts[k])

    data = load_known() if KNOWN_PATH.exists() else new_known()
    known = Known(data)
    result = {
        "globals": set(globals_read),
        "namespaces": members,
        "events": names["events"],
        "frame_types": names["frame_types"],
        "templates": names["templates"],
        "fonts": names["fonts"],
        "methods": names["methods"],
    }
    added = 0
    for kind in KINDS:
        if kind == "namespaces":
            for ns, found in sorted(members.items()):
                new = sorted(m for m in found if known.lookup("namespaces", m, ns)[0] is None)
                print("%s: %d used, %d not listed%s" % (ns, len(found), len(new), (": " + " ".join(new)) if new else ""))
                if args.merge:
                    for member in new:
                        bucket(data, "present", "namespaces", ns)[member] = args.source
                        added += 1
            continue
        found = sorted(result[kind])
        new = [name for name in found if known.lookup(kind, name)[0] is None]
        print("%s: %d used, %d not listed" % (kind, len(found), len(new)))
        for name in new:
            print("  " + name)
        if args.merge:
            for name in new:
                data["present"][kind][name] = args.source
                added += 1
    if args.merge:
        if args.source not in data["sources"]:
            print("unknown source %r; known: %s" % (args.source, ", ".join(sorted(data["sources"]))))
            return 1
        save_known(data)
        print("added %d entries to %s" % (added, display(KNOWN_PATH)))
    return 0


def cmd_facts(args):
    data = load_known() if KNOWN_PATH.exists() else new_known()
    batches = {}
    seen_files = set()
    for name in args.files:
        text = Path(name).read_bytes()
        if text in seen_files:
            continue
        seen_files.add(text)
        saved = parse_saved_variables(text.decode("utf-8", errors="replace"))
        source = "selftest" if "IntrepidManagerDB" in saved else "probe"
        batches.setdefault(source, Facts()).update(facts_from_saved(saved))
        batches.setdefault("facts", Facts()).update(facts_from_widget_facts(saved))
    total = 0
    for source in sorted(batches):
        total += merge_facts(data, batches[source], source)
    save_known(data)
    print("%d changes written to %s" % (total, display(KNOWN_PATH)))
    return 0


def dump_widgets(data):
    """tools/api-widgets.json as text: one method name to a line, types in order, plain ASCII."""
    return json.dumps(data, indent=1, sort_keys=True, ensure_ascii=True) + "\n"


def load_widgets(path=WIDGETS_PATH):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def cmd_widgets(args):
    data = load_widgets() if WIDGETS_PATH.exists() else {"format": 1, "build": "", "types": {}}
    added = 0
    for name in args.files:
        saved = parse_saved_variables(Path(name).read_text(encoding="utf-8", errors="replace"))
        for kind, names in widget_methods(saved).items():
            merged = sorted(set(data["types"].get(kind, [])) | set(names))
            added += len(merged) - len(data["types"].get(kind, []))
            data["types"][kind] = merged
        manager_db = saved.get("IntrepidManagerDB")
        measured = manager_db.get("facts") if isinstance(manager_db, dict) else None
        client = (measured or {}).get("client", {}).get("client") if isinstance(measured, dict) else None
        if isinstance(client, dict) and 2 in client:
            data["build"] = "build %s, addon %s" % (client[2], measured.get("version", "?"))
    WIDGETS_PATH.write_text(dump_widgets(data), encoding="utf-8", newline="\n")
    print("%d method names added; %d widget types in %s" % (added, len(data["types"]), display(WIDGETS_PATH)))
    return 0


def cmd_add(args):
    data = load_known() if KNOWN_PATH.exists() else new_known()
    if args.kind == "namespaces" and not args.ns:
        print("--ns NAMESPACE is needed for kind namespaces")
        return 1
    if not args.unverified and args.source not in data["sources"]:
        print("--source must be one of: %s (or use --unverified NOTE)" % ", ".join(sorted(data["sources"])))
        return 1
    for name in args.names:
        if not NAME_RE.match(name):
            print("%r is not a plain name" % name)
            return 1
        status, detail = Known(data).lookup(args.kind, name, args.ns)
        if status == "absent":
            print("%s is listed as missing from the client (%s); remove that entry first if the client has changed" % (name, detail))
            return 1
        if args.unverified:
            place_unverified(data, args.kind, name, args.ns, args.unverified)
        else:
            drop(data, "unverified", args.kind, name, args.ns)
            table = bucket(data, "present", args.kind, args.ns)
            table[name] = add_sources(table.get(name), args.source)
    save_known(data)
    print("%d entries written to %s" % (len(args.names), display(KNOWN_PATH)))
    return 0


def cmd_selftest(args):
    return selftest()


def main():
    parser = argparse.ArgumentParser(description="Known-good list of the game's API names.")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("check")
    sub.add_parser("selftest")
    collect = sub.add_parser("collect")
    collect.add_argument("paths", nargs="+")
    collect.add_argument("--defs", nargs="*")
    collect.add_argument("--exclude", nargs="*")
    collect.add_argument("--luacheck", action="store_true")
    collect.add_argument("--ignore", nargs="*", help="names to leave out (another addon's globals and methods)")
    collect.add_argument("--source")
    collect.add_argument("--merge", action="store_true")
    facts = sub.add_parser("facts")
    facts.add_argument("files", nargs="+")
    widgets = sub.add_parser("widgets")
    widgets.add_argument("files", nargs="+")
    add = sub.add_parser("add")
    add.add_argument("--kind", required=True, choices=KINDS)
    add.add_argument("--ns", help="the namespace, for kind namespaces (C_PartyInfo, Enum.LootMethod)")
    add.add_argument("--source", help="where the evidence comes from (a key of sources in the list)")
    add.add_argument("--unverified", metavar="NOTE", help="list the names as unverified, with the reason")
    add.add_argument("names", nargs="+")
    args = parser.parse_args()
    command = args.command or "check"
    if command == "check":
        return cmd_check(args)
    if command == "selftest":
        return cmd_selftest(args)
    if command == "collect":
        if args.merge and not args.source:
            parser.error("--merge needs --source")
        return cmd_collect(args)
    if command == "widgets":
        return cmd_widgets(args)
    if command == "add":
        if not args.source and not args.unverified:
            parser.error("add needs --source or --unverified")
        return cmd_add(args)
    return cmd_facts(args)


# ----------------------------------------------------------------------------------------------------------------
# Tests of this tool. `python3 tools/api_lint.py selftest` runs them and the data-file checks.

def selftest():
    failures = []
    count = [0]

    def check(name, condition, detail=""):
        count[0] += 1
        if not condition:
            failures.append("%s %s" % (name, detail))

    def tiny_known():
        data = new_known()
        data["present"]["methods"].update({"SetPoint": "fl", "Show": "fl", "RegisterEvent": "fl", "RegisterUnitEvent": "fl",
                                           "CreateFontString": "fl"})
        data["present"]["globals"].update({"CreateFrame": "probe"})
        data["present"]["namespaces"].update({"C_Demo": {"Good": "probe"}, "Enum.Kind": {"One": "probe"}, "Enum": {"Kind": "probe"}})
        data["complete_namespaces"] = ["C_Demo"]
        data["present"]["events"].update({"LOOT_OPENED": "probe"})
        data["present"]["frame_types"].update({"Frame": "probe", "Button": "probe"})
        data["present"]["templates"].update({"UIPanelButtonTemplate": "probe", "BasicFrameTemplate": "probe"})
        data["present"]["fonts"].update({"GameFontNormal": "probe"})
        data["absent"]["globals"].update({"EasyMenu": "probe"})
        data["absent"]["templates"].update({"OptionsCheckButtonTemplate": "probe"})
        data["unverified"]["globals"].update({"MaybeThere": "fallback only"})
        data["unverified"]["methods"].update({"SetMaybe": "never run in the game"})
        return data

    def lint(source, data=None):
        known = Known(data or tiny_known())
        return lint_scans(known, [("t.lua", scan_source(source))])

    def messages(report):
        return [m for _, _, m in report.errors]

    # Tokenizer: strings, comments and numbers do not confuse it.
    tokens = tokenize('local a = "x:Foo()" -- b:Bar()\n--[[ c:Baz()\n]] d:Qux()\nlocal s = [==[ e:Zap() ]==]')
    check("a long comment hides the lines inside it", scan_source("--[[ one\nc:Baz()\n]] d:Qux()").methods == [("Qux", 3)],
          str(scan_source("--[[ one\nc:Baz()\n]] d:Qux()").methods))
    check("a long string hides the lines inside it", scan_source("x = [[ one\nc:Baz()\n]] d:Qux()").methods == [("Qux", 3)])
    check("tokenizer ignores strings and comments", [t[1] for t in tokens if t[0] == "name"] == ["local", "a", "d", "Qux", "local", "s"],
          str(tokens))
    sc = scan_source('local a = "x:Foo()" -- b:Bar()\n--[[ c:Baz()\n]] d:Qux()\nlocal s = [==[ e:Zap() ]==]')
    check("methods come from code only", [m for m, _ in sc.methods] == ["Qux"], str(sc.methods))
    check("line numbers count lines inside comments", sc.methods and sc.methods[0][1] == 3, str(sc.methods))
    check("escaped quotes stay in the string", scan_source('x = "a\\"b:Foo()" y:Bar()').methods == [("Bar", 1)])
    check("decode_string handles escapes", decode_string("a\\n\\65\\\\") == "a\nA\\")
    check("a method with a string argument counts", [m for m, _ in scan_source('x:Print"hi"').methods] == ["Print"])
    check("a method with a table argument counts", [m for m, _ in scan_source("x:Build{1}").methods] == ["Build"])
    check("a method without a call does not count", scan_source("local f = x:y").methods == [])

    # Definitions are not calls, and what the tree defines is allowed.
    sc = scan_source("function A.B:run() end\nlocal function helper() end\nns.go = function() end\nA:run()")
    check("definitions are collected", sc.defined == {"run", "helper", "go"}, str(sc.defined))
    check("a definition is not a call", [m for m, _ in sc.methods] == ["run"], str(sc.methods))

    # A local that hides a namespace name is not the client's table; a plain copy of the global is.
    sc = scan_source("local Settings = FL.Settings\nSettings.GetFont()\nlocal C_Timer = C_Timer\nC_Timer.After()\nlocal Enum = ns.Enum\nlocal a, Gone = 1, 2\nGone.x()")
    check("a local that hides a name hides its chains", [p for p, _ in sc.chains] == [["FL", "Settings"], ["C_Timer", "After"], ["ns", "Enum"]],
          str(sc.chains))
    sc = scan_source("local C_Timer = C_Timer.After\nC_Timer.x")
    check("a local that takes a member hides the namespace in that file", sc.shadowed == {"C_Timer"} and sc.chains == [], str(sc.chains))

    # Chains, events, frames, fonts.
    sc = scan_source("C_Demo.Good(1)\nEnum.Kind.One\nlocal x = a.b.c")
    check("chains are collected", [p for p, _ in sc.chains] == [["C_Demo", "Good"], ["Enum", "Kind", "One"], ["a", "b", "c"]], str(sc.chains))
    sc = scan_source('f:RegisterEvent("LOOT_OPENED")\nf:RegisterEvent(name)\nf:RegisterUnitEvent("UNIT_X", "player")')
    check("events: literal and dynamic", sc.events == [("LOOT_OPENED", 1), (DYNAMIC, 2), ("UNIT_X", 3)], str(sc.events))
    sc = scan_source('CreateFrame("Frame", "n", UIParent, "BasicFrameTemplate, UIPanelButtonTemplate")\nCreateFrame(kind)\nCreateFrame("Button")')
    check("frames: type and template", sc.frames[0] == ("Frame", "BasicFrameTemplate, UIPanelButtonTemplate", 1), str(sc.frames))
    check("frames: dynamic type", sc.frames[1][0] is DYNAMIC and sc.frames[1][1] is MISSING)
    check("frames: no template", sc.frames[2] == ("Button", MISSING, 3))
    sc = scan_source('f:CreateFontString(nil, "OVERLAY", "GameFontNormal")\nf:CreateFontString()')
    check("fonts: the third argument", sc.fonts == [("GameFontNormal", 1)], str(sc.fonts))

    sc = scan_source('CreateFrame("Frame", nil, Foo(a, {b, c}), "BasicFrameTemplate")')
    check("call arguments nest", sc.frames == [("Frame", "BasicFrameTemplate", 1)], str(sc.frames))

    # The data file's own rules.
    def broken(edit):
        data = new_known()
        edit(data)
        return Known(data).problems()
    check("a good list has no problems", Known(tiny_known()).problems() == [])
    check("a wrong format number is a data error", any("format is" in x for x in broken(lambda d: d.update(format=2))))
    check("an unknown source is a data error",
          any("unknown source" in x for x in broken(lambda d: d["present"]["methods"].update(SetPoint="nowhere"))))
    check("an empty source is a data error",
          any("empty source or note" in x for x in broken(lambda d: d["unverified"]["methods"].update(SetPoint=""))))
    check("an odd name is a data error",
          any("odd name" in x for x in broken(lambda d: d["present"]["methods"].update({"Bad Name": "fl"}))))
    check("a missing section is a data error", any("absent.events is missing" in x for x in broken(lambda d: d["absent"].pop("events"))))
    check("a namespace that is not a table is a data error",
          any("not a table of members" in x for x in broken(lambda d: d["present"]["namespaces"].update(C_X="fl"))))

    def both(data):
        data["present"]["methods"]["SetPoint"] = "fl"
        data["absent"]["methods"]["SetPoint"] = "fl"
    check("present and absent at once is a data error", any("both present and absent" in x for x in broken(both)))

    def both_ns(data):
        data["present"]["namespaces"]["C_X"] = {"A": "fl"}
        data["unverified"]["namespaces"]["C_X"] = {"A": "a note"}
    check("a namespace member present and unverified is a data error", any("both present and unverified" in x for x in broken(both_ns)))
    check("a complete namespace without members is a data error",
          any("complete_namespaces lists" in x for x in broken(lambda d: d.update(complete_namespaces=["C_Nope"]))))

    # Verdicts.
    report = lint("frame:SetPoint('TOP')\nframe:Show()\nlocal s = x:format('%d')")
    check("known methods pass, string methods pass", messages(report) == [], str(messages(report)))
    report = lint("frame:SetPoin('TOP')")
    check("a typo in a method name fails", len(report.errors) == 1 and "SetPoin" in report.errors[0][2], str(messages(report)))
    check("the failure says how to fix it", "api-known.json" in messages(report)[0])
    report = lint("function Window:SetPoin() end\nframe:SetPoin()")
    check("a method the tree defines passes", messages(report) == [])
    report = lint("frame:SetMaybe()")
    check("an unverified method passes but is reported", messages(report) == [] and len(report.unverified) == 1)
    report = lint("C_Demo.Good()\nC_Demo.Bad()\nC_Other.Thing()\nEnum.Kind.One\nEnum.Kind.Two")
    check("namespace members are checked", len(report.errors) == 3, str(messages(report)))
    check("a complete namespace says so", any("listed all of its members" in m for m in messages(report)))
    check("an unknown C_ namespace fails", any("C_Other" in m for m in messages(report)))
    report = lint('f:RegisterEvent("LOOT_OPENED")\nf:RegisterEvent("LOOT_OPENEDD")\nf:RegisterEvent(x)')
    check("events are checked", len(report.errors) == 1 and "LOOT_OPENEDD" in report.errors[0][2], str(messages(report)))
    check("run-time events are counted", len(report.dynamic) == 1)
    report = lint('CreateFrame("Frame", nil, nil, "OptionsCheckButtonTemplate")\nCreateFrame("Fraem")\nCreateFrame("Button", nil, nil, "UIPanelButtonTemplate")')
    check("an absent template is named as absent", any("does not exist on the Forever client" in m for m in messages(report)), str(messages(report)))
    check("an unknown frame type fails", any("Fraem" in m for m in messages(report)))
    check("a known frame with a known template passes", len(report.errors) == 2, str(messages(report)))
    report = lint('CreateFrame("Frame", nil, nil, "BasicFrameTemplate, NoSuchTemplate")\nCreateFrame("Button", nil, nil, "UIPanelButtonTemplate")')
    check("every template in a list is looked up, split at commas and spaces",
          len(report.errors) == 1 and "NoSuchTemplate" in report.errors[0][2] and "BasicFrameTemplate," not in report.errors[0][2],
          str(messages(report)))
    report = lint('f:CreateFontString(nil, "OVERLAY", "GameFontNormal")\nf:CreateFontString(nil, "OVERLAY", "GameFontNormaI")')
    check("fonts are checked", len(report.errors) == 1, str(messages(report)))

    # .luacheckrc.
    rc = 'stds.wow = { read_globals = { "assert" } }\nglobals = { "Mine" }\nread_globals = {\n  "CreateFrame", -- x\n  "EasyMenu",\n}\n'
    names = luacheckrc_read_globals(rc)
    check("only the top-level read_globals is read", [n for n, _ in names] == ["CreateFrame", "EasyMenu"], str(names))
    report = Report()
    lint_globals(Known(tiny_known()), [("CreateFrame", 1), ("EasyMenu", 2), ("Nope", 3), ("MaybeThere", 4), ("C_Demo", 5)], report, "rc")
    check("globals: present passes, a namespace table passes", len([e for e in report.errors if "CreateFrame" in e[2] or "C_Demo" in e[2]]) == 0)
    check("globals: absent and unknown fail", len(report.errors) == 2, str(report.errors))
    check("globals: unverified is reported", len(report.unverified) == 1)

    # Saved variables.
    saved = parse_saved_variables('A = {\n["x"] = {\n"a", -- [1]\n"b", -- [2]\n},\n["n"] = -1.5,\n["t"] = true,\n["z"] = "q\\"r",\nplain = 3,\n}\nB = "s"\n')
    check("saved variables parse", saved["A"]["x"] == {1: "a", 2: "b"} and saved["A"]["n"] == -1.5 and saved["A"]["t"] is True, str(saved))
    check("saved variables: strings, names, a second variable", saved["A"]["z"] == 'q"r' and saved["A"]["plain"] == 3 and saved["B"] == "s")
    db = {"IntrepidProbeDB": {"probe": {"apis": {"CreateFrame": "function", "C_Demo.Good": "function", "C_Demo.Gone": False,
                                                 "EasyMenu": False},
                                        "events": {"LOOT_OPENED": True, "LOOT_GONE": False}},
                              "bundle": {"namespaces": {"C_Demo": {1: "Good", 2: "Other"}, "Enum.Kind": {1: "One=1"}},
                                         "ui": {"templates": {"Frame + BasicFrameTemplate": "ok", "CheckButton + Old": "ERROR: x",
                                                              "StatusBar": "ok"}, "fonts": {"GameFontNormal": "table"},
                                                "apis": {"LibStub": "nil"}}}}}
    facts = facts_from_saved(db)
    data = new_known()
    merge_facts(data, facts, "probe", out=lambda *_: None)
    check("facts: globals", data["present"]["globals"].get("CreateFrame") == "probe" and "EasyMenu" in data["absent"]["globals"]
          and "LibStub" in data["absent"]["globals"] and "C_Demo" in data["present"]["globals"], str(data["present"]["globals"]))
    check("facts: namespace members and completeness", data["present"]["namespaces"]["C_Demo"].keys() >= {"Good", "Other"}
          and "Gone" in data["absent"]["namespaces"]["C_Demo"] and "C_Demo" in data["complete_namespaces"])
    check("facts: enum members lose their values", "One" in data["present"]["namespaces"]["Enum.Kind"])
    check("facts: the ancestors of a dotted namespace exist too",
          "Enum" in data["present"]["globals"] and "Kind" in data["present"]["namespaces"]["Enum"],
          str(data["present"]["namespaces"].get("Enum")))
    logged = facts_from_saved({"IntrepidProbeDB": {"events": {1: {"event": "UI_ERROR_MESSAGE", "args": {1: "text"}}, 2: {"x": 1}}}})
    check("facts: the event log says which events fired, by name only", logged.seen["events"] == {"UI_ERROR_MESSAGE": {True}},
          str(logged.seen["events"]))
    check("facts: events, templates, frame types, fonts", data["present"]["events"] == {"LOOT_OPENED": "probe"}
          and data["absent"]["events"] == {"LOOT_GONE": "probe"} and "BasicFrameTemplate" in data["present"]["templates"]
          and "Old" in data["absent"]["templates"] and "StatusBar" in data["present"]["frame_types"]
          and "GameFontNormal" in data["present"]["fonts"])
    check("facts: the merged list is valid", Known(data).problems() == [], str(Known(data).problems()))
    data["present"]["globals"]["FromFl"] = "fl"
    later = Facts()
    later.note("globals", "FromFl", False)
    merge_facts(data, later, "probe", out=lambda *_: None)
    check("facts: the client beats another addon's code", "FromFl" in data["absent"]["globals"] and "FromFl" not in data["present"]["globals"])
    batch = Facts()
    batch.note("globals", "Split", True)
    batch.note("globals", "Split", False)
    merge_facts(data, batch, "probe", out=lambda *_: None)
    check("facts: files of one batch that disagree become unverified",
          "Split" in data["unverified"]["globals"] and "Split" not in data["present"]["globals"])
    again = Facts()
    again.note("globals", "CreateFrame", False)
    merge_facts(data, again, "probe", out=lambda *_: None)
    check("facts: two runs that disagree become unverified", "CreateFrame" in data["unverified"]["globals"])
    sources = add_sources("fl", "probe")
    check("sources join without duplicates", sources == "fl+probe" and add_sources(sources, "fl") == "fl+probe")
    out = dump_known(new_known())
    check("the file is plain ASCII", all(ord(c) < 128 for c in out))
    check("the writer round-trips", json.loads(out) == new_known())

    # What /im facts measured: method names by widget type, fonts, templates.
    measured = {"IntrepidManagerDB": {"facts": {
        "methods": {
            "Button": {"listed": True, "names": "SetText Show Hide", "curatedPresent": "SetShown", "curatedMissing": "SetFocus"},
            "EditBox": {"listed": True, "names": "SetFocus SetText Bad-Name"},
            "Slider": {"listed": False, "curatedPresent": "SetValue"},
            "Texture": {"error": "no"},
        },
        "fonts": {"GameFontNormal": {"size": 12}, "NoFont": {"missing": True}},
        "templates": {"Button + UIPanelButtonTemplate": {"width": 40}, "Frame + NoTemplate": {"error": "not on the list"}},
    }}}
    seen = facts_from_widget_facts(measured).seen
    check("widget facts: names of every type count as existing",
          set(seen["methods"]) == {"SetText", "Show", "Hide", "SetShown", "SetFocus", "SetValue"}, str(sorted(seen["methods"])))
    check("widget facts: a font the game lacks is a miss, one it has is a hit",
          seen["fonts"] == {"GameFontNormal": {True}, "NoFont": {False}}, str(seen["fonts"]))
    check("widget facts: a template the game refused is a miss, and only an accepted one proves the frame type",
          seen["templates"] == {"UIPanelButtonTemplate": {True}, "NoTemplate": {False}} and seen["frame_types"] == {"Button": {True}},
          str(seen["templates"]) + str(seen["frame_types"]))
    check("widget facts: a file with none of it says nothing", facts_from_widget_facts({"IntrepidManagerDB": {}}).seen["methods"] == {})
    check("widget methods: only the types the game let us list, with names that are names",
          widget_methods(measured) == {"Button": ["Hide", "SetText", "Show"], "EditBox": ["SetFocus", "SetText"]}, str(widget_methods(measured)))
    data = tiny_known()
    merge_facts(data, facts_from_widget_facts(measured), "facts", out=lambda *_: None)
    check("widget facts: a name the list had from another addon's code gets the new source too",
          data["present"]["methods"]["Show"] == "facts+fl" and data["present"]["methods"]["SetText"] == "facts", str(data["present"]["methods"]))
    check("widget facts: a template the game refused is listed as missing", data["absent"]["templates"].get("NoTemplate") == "facts")

    # The data file.
    if WIDGETS_PATH.exists():
        widgets = load_widgets()
        check("tools/api-widgets.json has the format and the types", widgets.get("format") == 1 and isinstance(widgets.get("types"), dict))
        for kind, names in sorted(widgets.get("types", {}).items()):
            check("api-widgets.json %s: sorted names without duplicates" % kind,
                  names == sorted(set(names)) and all(NAME_RE.match(n) for n in names), kind)
            check("api-widgets.json %s: the game lists more than a few methods" % kind, len(names) >= 100, "%s has %d" % (kind, len(names)))
        check("tools/api-widgets.json is written the way this tool writes it",
              WIDGETS_PATH.read_text(encoding="utf-8") == dump_widgets(widgets), "run: python3 tools/api_lint.py widgets FILE")
        check("the widgets file is plain ASCII", all(ord(c) < 128 for c in WIDGETS_PATH.read_text(encoding="utf-8")))
    if KNOWN_PATH.exists():
        problems = Known(load_known()).problems()
        check("tools/api-known.json is valid", problems == [], "; ".join(problems[:5]))
        check("tools/api-known.json is written the way this tool writes it", KNOWN_PATH.read_text(encoding="utf-8") == dump_known(load_known()),
              "run: python3 tools/api_lint.py facts (or re-save) to normalize it")
        text = KNOWN_PATH.read_text(encoding="utf-8")
        check("the data file is plain ASCII", all(ord(c) < 128 for c in text))
    else:
        check("tools/api-known.json exists", False)

    # End to end on a temporary addon: a typo must fail, the same file without it must pass.
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp) / "Addon"
        folder.mkdir()
        rc_path = Path(tmp) / ".luacheckrc"
        rc_path.write_text('read_globals = {\n "CreateFrame",\n}\n', encoding="utf-8")
        (folder / "good.lua").write_text('local f = CreateFrame("Frame")\nf:SetPoint("TOP")\nf:RegisterEvent("LOOT_OPENED")\n', encoding="utf-8")
        lines = []
        errors, _ = run_check(tiny_known(), folder, rc_path, out=lines.append)
        check("end to end: a clean addon passes", errors == 0, "; ".join(lines))
        (folder / "bad.lua").write_text('local f = CreateFrame("Frame")\nf:SetPoin("TOP")\n', encoding="utf-8")
        lines = []
        errors, _ = run_check(tiny_known(), folder, rc_path, out=lines.append)
        check("end to end: a typo fails and names file and line", errors == 1 and any("bad.lua:2" in l and "SetPoin" in l for l in lines), "; ".join(lines))
        wrong = tiny_known()
        wrong["format"] = 2
        lines = []
        errors, _ = run_check(wrong, folder, rc_path, out=lines.append)
        check("end to end: a broken list fails the check and says why", errors >= 1 and any("format is" in l for l in lines), "; ".join(lines))
        rc_path.write_text('read_globals = {\n "CreateFrame",\n "EasyMenu",\n}\n', encoding="utf-8")
        (folder / "bad.lua").unlink()
        lines = []
        errors, _ = run_check(tiny_known(), folder, rc_path, out=lines.append)
        check("end to end: a global the client lacks fails", errors == 1 and any("EasyMenu" in l for l in lines), "; ".join(lines))

    for failure in failures:
        print("FAIL  " + failure)
    print("api_lint selftest: %d checks, %d failed" % (count[0], len(failures)))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
