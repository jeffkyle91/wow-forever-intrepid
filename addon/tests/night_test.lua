-- The night string's content checks (IntrepidManager/core/Night.lua) and the shared content cases in
-- docs/spec/fixtures/content-cases.json. Invented names only. See AGENTS.md.
local ns = load_core({}, "Crc32", "Json", "Envelope", "Ids", "Check", "Night")
local Night, Json = ns.Night, ns.Json

local FIXTURES = "docs/spec/fixtures/"

local function decode(text)
  local ok, value = Json.decode(text)
  if not ok then error("decode failed: " .. tostring(value), 2) end
  return value
end

local function nightModel()
  return decode(read_file(FIXTURES .. "night-small.model.json"))
end

local function sorted(list)
  local copy = {}
  for index, value in ipairs(list) do copy[index] = value end
  table.sort(copy)
  return copy
end

-- The shared content cases ----------------------------------------------------------------------------------------

local entries = decode(read_file(FIXTURES .. "content-cases.json"))
local nightEntries = 0

for _, entry in ipairs(entries) do
  if entry.box == "night" then
    nightEntries = nightEntries + 1
    test("shared content case night/" .. entry.name, function()
      local model = nightModel()
      for _, edit in ipairs(entry.edit) do apply_edit(model, edit) end
      local result = Night.check(model)
      if result.internal then error("a bug, not bad input: " .. result.message) end
      if entry.expect == "E_PAYLOAD" then
        eq(result.ok, false)
        eq(result.code, "E_PAYLOAD")
        is_true(#result.message > 10)
      else
        if not result.ok then error("expected OK, got " .. result.code .. ": " .. result.message) end
        deep_eq(sorted(result.rowErrors), entry.rowErrors or {})
      end
    end)
  end
end

test("there are shared content cases for the night box", function()
  is_true(nightEntries >= 100)
end)

-- A good night ---------------------------------------------------------------------------------------------------------

test("the good night reads with no row errors and its parts sorted out", function()
  local result = Night.check(nightModel())
  is_true(result.ok)
  eq(result.schema, 1)
  deep_eq(result.rowErrors, {})
  deep_eq(result.problems, {})
  eq(#result.roster, 6)
  eq(result.byK[1].name, "Jorren")
  eq(result.byK[4].surname, "\195\134rinwald")
  eq(result.byK[7], nil)
  eq(#result.bosses, 2)
  eq(#result.priorities, 3)
  eq(#result.skipped, 0)
  eq(result.raid.id, "raid-1209")
  eq(#result.known, 2)
  eq(result.known[1].id, "s-tpg4mo-k3p9-1")
end)

test("a night with nothing in it is fine", function()
  local result = Night.check(decode(read_file(FIXTURES .. "night-empty.model.json")))
  is_true(result.ok)
  deep_eq(result.rowErrors, {})
  eq(#result.roster, 0)
  eq(#result.priorities, 0)
  deep_eq(result.known, {})
end)

test("a check does not change the payload", function()
  local model = nightModel()
  model.raid.size = 25 -- a wrong raid is left out of the result, not out of the payload
  table.remove(model.roster, 3)
  model.priorities[3].lines[1] = { k = 99 }
  local before = decode(read_file(FIXTURES .. "night-small.model.json"))
  before.raid.size = 25
  table.remove(before.roster, 3)
  before.priorities[3].lines[1] = { k = 99 }
  local result = Night.check(model)
  is_true(result.ok)
  eq(result.model, model)
  eq(result.raid, nil)
  deep_eq(model, before)
end)

-- Row errors and their reasons -----------------------------------------------------------------------------------

test("a skipped priority says why, with the number of the line", function()
  local model = nightModel()
  model.priorities[2].lines[#model.priorities[2].lines + 1] = { k = 99 }
  local result = Night.check(model)
  deep_eq(result.rowErrors, { "pr-cloak" })
  deep_eq(result.problems, { { name = "pr-cloak", kind = "priority", reason = "line 4: unknown player" } })
  eq(#result.priorities, 2)
  deep_eq(result.skipped, { { name = "pr-cloak", item = "Cloak of Many Commas, Semicolons; and 100% Percent", reason = "line 4: unknown player" } })
end)

test("the reasons name what is wrong", function()
  local function reasonFor(change, kind)
    local model = nightModel()
    change(model)
    local result = Night.check(model)
    for _, problem in ipairs(result.problems) do
      if problem.kind == kind then return problem.reason end
    end
    error("no problem of kind " .. kind)
  end
  eq(reasonFor(function(m) m.roster[3].k = 0 end, "roster"), "k is missing or not a whole number from 1")
  eq(reasonFor(function(m) m.roster[3].k = 2 end, "roster"), "k is used by an earlier entry")
  eq(reasonFor(function(m) m.roster[3].name = "" end, "roster"), "name is missing, blank or too long")
  eq(reasonFor(function(m) m.roster[6].id = m.roster[1].id end, "roster"), "id is used by an earlier entry")
  eq(reasonFor(function(m) m.bosses[2].npcId = m.bosses[1].npcId end, "boss"), "npcId is used by an earlier boss")
  eq(reasonFor(function(m) m.raid.date = "soon" end, "raid"), "the raid is not valid, so the string is read without it")
  eq(reasonFor(function(m) m.priorities[3].item = "" end, "priority"), "item is missing, blank or too long")
  eq(reasonFor(function(m) m.priorities[3].id = "pr-blade" end, "priority"), "id is used by an earlier priority")
  eq(reasonFor(function(m) m.priorities[3].id = "bad id" end, "priority"), "id is missing or not valid")
  eq(reasonFor(function(m) m.priorities[3].lines[1] = { k = 1, name = "x" } end, "priority"), "line 1: needs exactly one of k, name and text")
  eq(reasonFor(function(m) m.priorities[2].lines[2].awarded = true end, "priority"), "line 2: a note cannot be awarded")
  eq(reasonFor(function(m) m.priorities[1].lines[1].done = true end, "priority"), "line 1: only a note can be done")
  eq(reasonFor(function(m) m.priorities[3].lines[1].name = "" end, "priority"), "line 1: the name is blank or too long")
  eq(reasonFor(function(m) m.priorities[3].lines = {} end, "priority"), "lines are missing")
end)

test("a priority with too many lines says so", function()
  local model = nightModel()
  local lines = Json.list()
  for position = 1, 61 do lines[position] = { name = "Garrick Vole" } end
  model.priorities[3].lines = lines
  deep_eq(Night.check(model).problems, { { name = "pr-typed", kind = "priority", reason = "more than 60 lines" } })
end)

test("a priority that is not an object is named by its position and has no item to show", function()
  local model = nightModel()
  model.priorities[2] = 4
  local result = Night.check(model)
  deep_eq(result.rowErrors, { "priority:2" })
  deep_eq(result.skipped, { { name = "priority:2", reason = "id is missing or not valid" } })
end)

test("the first roster entry with a k wins, and a later one with the same id loses", function()
  local model = nightModel()
  model.roster[#model.roster + 1] = { k = 2, id = "AbCdEfGhIjKlMnOpQr09", name = "Second", surname = "Two" }
  model.roster[#model.roster + 1] = { k = 9, id = "AbCdEfGhIjKlMnOpQr01", name = "Same", surname = "Id" }
  local result = Night.check(model)
  deep_eq(sorted(result.rowErrors), { "roster:7", "roster:8" })
  eq(result.byK[2].name, "Mirelle")
  eq(result.byK[9], nil)
end)

-- Robustness -----------------------------------------------------------------------------------------------------------

test("something that is not a night is refused, never a crash", function()
  for _, junk in ipairs({ 5, "text", true }) do
    local result = Night.check(junk)
    eq(result.ok, false)
    eq(result.code, "E_PAYLOAD")
    eq(result.internal, nil)
  end
  eq(Night.check(nil).ok, false)
  eq(Night.check(Json.list()).ok, false)
  eq(Night.check({}).ok, false)
  eq(Night.check({ id = "n-1" }).ok, false)
end)

test("a bug inside the checks comes back as an internal E_PAYLOAD, not an error", function()
  local explosive = setmetatable({}, { __index = function() error("boom") end })
  local result = Night.check(explosive)
  eq(result.ok, false)
  eq(result.code, "E_PAYLOAD")
  eq(result.internal, true)
  is_true(result.message:find("internal error", 1, true) ~= nil)
  is_true(result.message:find("|", 1, true) == nil)
end)

-- Every place in a good night, replaced by something odd: the answer may be a refusal or a row error, but never a bug.
test("odd values anywhere never crash the checks", function()
  local junk = { 0, -1, 1.5, 0 / 0, math.huge, "", " ", "x", string.rep("y", 600), true, false, {}, Json.list(), { k = 1 },
    Json.list({ 1 }), "\0", "bad id" }
  local base = nightModel()
  local paths = {}
  local function collect(value, path)
    paths[#paths + 1] = path
    if type(value) == "table" then
      for key, child in pairs(value) do
        local deeper = {}
        for index, step in ipairs(path) do deeper[index] = step end
        deeper[#deeper + 1] = key
        collect(child, deeper)
      end
    end
  end
  collect(base, {})
  is_true(#paths > 100)
  local tried = 0
  for _, path in ipairs(paths) do
    if #path > 0 then
      for _, value in ipairs(junk) do
        local model = nightModel()
        local target = model
        for position = 1, #path - 1 do target = target[path[position]] end
        target[path[#path]] = value
        local result = Night.check(model)
        if result.internal then error("a bug at " .. table.concat(path, "/") .. ": " .. result.message) end
        tried = tried + 1
      end
    end
  end
  is_true(tried > 1500)
end)

-- Reading a string -------------------------------------------------------------------------------------------------

test("Night.read goes from the string to the checked night", function()
  local result = Night.read(read_file(FIXTURES .. "night-small.j.txt"))
  is_true(result.ok)
  eq(#result.roster, 6)
  deep_eq(result.rowErrors, {})
end)

test("Night.read gives the envelope's refusal when the envelope is wrong", function()
  local text = read_file(FIXTURES .. "night-small.j.txt")
  local result = Night.read((text:gsub("Jorren", "Jorrem", 1)))
  eq(result.ok, false)
  eq(result.code, "E_CHECKSUM")
  eq(Night.read(read_file(FIXTURES .. "awards-small.j.txt")).code, "E_KIND")
  eq(Night.read("hello").code, "E_NOT_IM")
end)

test("Night.read gives the content refusal when a header field is wrong", function()
  local result = Night.read(read_file(FIXTURES .. "cases/night-bad-nul-in-by.txt"))
  eq(result.ok, false)
  eq(result.code, "E_PAYLOAD")
  eq(result.internal, nil)
end)

-- The summary ------------------------------------------------------------------------------------------------------

local AT = 1796862600 -- the fixture's "at"

test("the summary of the good night", function()
  local result = Night.check(nightModel())
  local info = Night.summary(result, AT + 7205, "2026-12-09")
  eq(info.text, "Night of 2026-12-09, copied 2 hours ago: 6 players, 3 priorities.")
  eq(info.players, 6)
  eq(info.priorities, 3)
  eq(info.skipped, 0)
  eq(info.age, 7205)
  eq(info.otherDay, false)
  eq(info.old, false)
  deep_eq(info.warnings, {})
end)

test("the summary names what was skipped, with the reason", function()
  local model = nightModel()
  model.priorities[2].lines[#model.priorities[2].lines + 1] = { k = 99 }
  local info = Night.summary(Night.check(model), AT + 7205, "2026-12-09")
  eq(info.text, "Night of 2026-12-09, copied 2 hours ago: 6 players, 2 priorities. "
    .. "1 priority skipped: Cloak of Many Commas, Semicolons; and 10... (line 4: unknown player).")
  eq(info.skipped, 1)
end)

test("the summary shows three skipped priorities and counts the rest", function()
  local model = nightModel()
  for index = 4, 8 do
    model.priorities[index] = { id = "pr-extra-" .. index, item = "Extra " .. index, lines = Json.list({ { k = 99 } }) }
  end
  local info = Night.summary(Night.check(model), AT + 10, "2026-12-09")
  eq(info.skipped, 5)
  eq(info.text, "Night of 2026-12-09, copied just now: 6 players, 3 priorities. 5 priorities skipped: "
    .. "Extra 4 (line 1: unknown player); Extra 5 (line 1: unknown player); Extra 6 (line 1: unknown player) and 2 more.")
end)

test("a skipped priority with no item is shown by its name, and pipes in an item are doubled", function()
  local model = nightModel()
  model.priorities[2].item = "Pipe | Item"
  model.priorities[2].lines[#model.priorities[2].lines + 1] = { k = 99 }
  model.priorities[3] = 4
  local info = Night.summary(Night.check(model), AT, "2026-12-09")
  is_true(info.text:find("Pipe || Item (line 4: unknown player); priority:3 (id is missing or not valid)", 1, true) ~= nil)
  is_true(info.text:find("Pipe | Item", 1, true) == nil)
end)

test("rows that are ignored are counted by kind", function()
  local model = nightModel()
  model.raid.size = 25
  model.roster[3].name = ""
  model.roster[5].name = ""
  model.bosses[2].npcId = 0
  local info = Night.summary(Night.check(model), AT, "2026-12-09")
  is_true(info.text:find("Ignored: the raid, 2 roster entries, 1 boss.", 1, true) ~= nil)
  model.roster[5].name = "Pell"
  is_true(Night.summary(Night.check(model), AT, "2026-12-09").text:find("Ignored: the raid, 1 roster entry, 1 boss.", 1, true) ~= nil)
end)

test("a night without a raid is just a night", function()
  local model = nightModel()
  model.raid = nil
  local info = Night.summary(Night.check(model), AT + 90, "2026-12-09")
  eq(info.text, "Night, copied 1 minute ago: 6 players, 3 priorities.")
  eq(info.otherDay, false)
end)

test("a night for another day only warns", function()
  local info = Night.summary(Night.check(nightModel()), AT + 3600, "2026-12-10")
  eq(info.otherDay, true)
  deep_eq(info.warnings, { "The raid date (2026-12-09) is not today (2026-12-10)." })
  eq(info.text, "Night of 2026-12-09, copied 1 hour ago: 6 players, 3 priorities. The raid date (2026-12-09) is not today (2026-12-10).")
  eq(Night.summary(Night.check(nightModel()), AT + 3600, nil).otherDay, false) -- no date known, no warning
end)

test("a night copied more than 18 hours ago only warns", function()
  local info = Night.summary(Night.check(nightModel()), AT + 18 * 3600 + 1, "2026-12-09")
  eq(info.old, true)
  deep_eq(info.warnings, { "This string was copied more than 18 hours ago." })
  eq(Night.summary(Night.check(nightModel()), AT + 18 * 3600, "2026-12-09").old, false)
  local both = Night.summary(Night.check(nightModel()), AT + 3 * 86400, "2026-12-12")
  eq(#both.warnings, 2)
  is_true(both.text:find("copied 3 days ago", 1, true) ~= nil)
end)

test("the age is told in the largest whole unit", function()
  local result = Night.check(nightModel())
  local function age(seconds) return Night.summary(result, AT + seconds, nil).text:match("copied (.-):") end
  eq(age(-300), "just now") -- a clock that runs a little behind
  eq(age(0), "just now")
  eq(age(59), "just now")
  eq(age(60), "1 minute ago")
  eq(age(119), "1 minute ago")
  eq(age(120), "2 minutes ago")
  eq(age(3599), "59 minutes ago")
  eq(age(3600), "1 hour ago")
  eq(age(7199), "1 hour ago")
  eq(age(86399), "23 hours ago")
  eq(age(86400), "1 day ago")
  eq(age(172800), "2 days ago")
end)
