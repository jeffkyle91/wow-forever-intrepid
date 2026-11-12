-- The awards string: the writer, the content checks and the choice of what an export holds (docs/spec/exchange-v0.md,
-- section 6). Invented names only. See AGENTS.md.
local ns = load_core({}, "Crc32", "Json", "Envelope", "Ids", "Check", "Night", "Awards")
local Json, Envelope, Awards, Night = ns.Json, ns.Envelope, ns.Awards, ns.Night

local FIXTURES = "docs/spec/fixtures/"

local function decode(text)
  local ok, value = Json.decode(text)
  if not ok then error("decode failed: " .. tostring(value), 2) end
  return value
end

test("the awards fixture is written byte for byte, envelope and checksum included", function()
  local model = decode(read_file(FIXTURES .. "awards-small.model.json"))
  eq(Awards.encode(model), read_file(FIXTURES .. "awards-small.j.txt"))
end)

test("what the writer makes, the reader gives back", function()
  local model = decode(read_file(FIXTURES .. "awards-small.model.json"))
  local result = Envelope.read(Awards.encode(model), "awards")
  is_true(result.ok)
  deep_eq(result.model, model)
end)

test("an export with no awards is a list, not an object", function()
  local text = Awards.encode({ schema = 1, id = "a-empty", at = 1796876000, by = "IntrepidManager/0.0.1", awards = {} })
  local result = Envelope.read(text, "awards")
  is_true(result.ok)
  is_true(Json.isList(result.model.awards))
  eq(#result.model.awards, 0)
end)

test("a field the spec does not have is a bug in the caller, not a quietly dropped field", function()
  local ok, message = pcall(Awards.encode, { schema = 1, id = "a-1", at = 1, by = "x", awards = {}, extra = true })
  eq(ok, false)
  is_true(tostring(message):find("extra", 1, true) ~= nil)
  eq((pcall(Awards.encode, { schema = 1, id = "a-1", at = 1, by = "x", awards = { { id = "s-1", mystery = 1 } } })), false)
end)

test("booleans are written only when true, and absent fields are left out", function()
  local text = Awards.encode({
    schema = 1, id = "a-1", at = 1, by = "x",
    awards = { { id = "s-1", rev = 2, itemId = 5, item = "Thing", to = "Disenchant", pseudo = "disenchant",
                 delivery = { state = "assigned" }, note = false } },
  })
  local result = Envelope.read(text, "awards")
  is_true(result.ok)
  local award = result.model.awards[1]
  eq(award.note, nil)
  eq(award.priority, nil)
  eq(award.delivery.state, "assigned")
end)

-- The content checks -----------------------------------------------------------------------------------------------

local function awardsModel()
  return decode(read_file(FIXTURES .. "awards-small.model.json"))
end

local function sorted(list)
  local copy = {}
  for index, value in ipairs(list) do copy[index] = value end
  table.sort(copy)
  return copy
end

local entries = decode(read_file(FIXTURES .. "content-cases.json"))
local awardsEntries = 0

for _, entry in ipairs(entries) do
  if entry.box == "awards" then
    awardsEntries = awardsEntries + 1
    test("shared content case awards/" .. entry.name, function()
      local model = awardsModel()
      for _, edit in ipairs(entry.edit) do apply_edit(model, edit) end
      local result = Awards.check(model)
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

test("there are shared content cases for the awards box", function()
  is_true(awardsEntries >= 55)
end)

test("the good awards pass with nothing to report", function()
  local result = Awards.check(awardsModel())
  is_true(result.ok)
  eq(result.schema, 1)
  deep_eq(result.rowErrors, {})
  deep_eq(result.problems, {})
  eq(#result.awards, 5)
  eq(result.awards[1].id, "s-tpt2u0-q4tz-1")
end)

test("an award the spec would refuse is not in the list that passed", function()
  local model = awardsModel()
  model.awards[2].pseudo = "vendor"
  model.awards[5].rev = 0
  local result = Awards.check(model)
  deep_eq(result.rowErrors, { "s-tpt2u0-q4tz-2", "s-tpg4mo-k3p9-2" })
  eq(#result.awards, 3)
  deep_eq(result.problems[1], { name = "s-tpt2u0-q4tz-2", kind = "award", reason = "pseudo is not disenchant or guild-bank" })
  eq(result.problems[2].reason, "rev is missing or not a whole number from 1")
end)

test("the reasons name what is wrong", function()
  local function reasonFor(change)
    local model = awardsModel()
    change(model)
    local result = Awards.check(model)
    return result.problems[1] and result.problems[1].reason
  end
  eq(reasonFor(function(m) m.awards[1].id = "bad id" end), "id is missing or not valid")
  eq(reasonFor(function(m) m.awards[2].id = m.awards[1].id end), "id is used by an earlier award")
  eq(reasonFor(function(m) m.awards[1] = 5 end), "id is missing or not valid")
  eq(reasonFor(function(m) m.awards[1].date = "soon" end), "date is missing or not YYYY-MM-DD")
  eq(reasonFor(function(m) m.awards[1].itemId = 0 end), "itemId is missing or not a valid id")
  eq(reasonFor(function(m) m.awards[2].toId = "AbCdEfGhIjKlMnOpQr02" end), "a pseudo award has no toId")
  eq(reasonFor(function(m) m.awards[4].decision = nil end), "needs a priority, a pseudo or a decision")
  eq(reasonFor(function(m) m.awards[1].delivery = nil end), "delivery is missing")
  eq(reasonFor(function(m) m.awards[3].delivery.state = "lost" end), "delivery.state is not assigned or received")
  eq(reasonFor(function(m) m.awards[1].delivery.at = nil end), "a received award needs delivery.at")
  eq(reasonFor(function(m) m.awards[1].delivery.how = "mail" end), "delivery.how is missing or unknown")
  eq(reasonFor(function(m) m.awards[5].status = "deleted" end), "status is not removed")
end)

test("an awards check does not change the payload", function()
  local model = awardsModel()
  model.awards[2].pseudo = "vendor"
  local before = awardsModel()
  before.awards[2].pseudo = "vendor"
  local result = Awards.check(model)
  eq(result.model, model)
  deep_eq(model, before)
end)

test("something that is not an awards payload is refused, never a crash", function()
  for _, junk in ipairs({ 5, "text", true }) do
    local result = Awards.check(junk)
    eq(result.ok, false)
    eq(result.code, "E_PAYLOAD")
    eq(result.internal, nil)
  end
  eq(Awards.check(nil).ok, false)
  eq(Awards.check(Json.list()).ok, false)
  eq(Awards.check({}).ok, false)
end)

test("a bug inside the awards checks comes back as an internal E_PAYLOAD, not an error", function()
  local explosive = setmetatable({}, { __index = function() error("boom") end })
  local result = Awards.check(explosive)
  eq(result.ok, false)
  eq(result.code, "E_PAYLOAD")
  eq(result.internal, true)
  is_true(result.message:find("|", 1, true) == nil)
end)

test("odd values anywhere never crash the awards checks", function()
  local junk = { 0, -1, 1.5, 0 / 0, math.huge, "", " ", "x", string.rep("y", 600), true, false, {}, Json.list(), { state = "assigned" },
    Json.list({ 1 }), "\0", "bad id" }
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
  collect(awardsModel(), {})
  local tried = 0
  for _, path in ipairs(paths) do
    if #path > 0 then
      for _, value in ipairs(junk) do
        local model = awardsModel()
        local target = model
        for position = 1, #path - 1 do target = target[path[position]] end
        target[path[#path]] = value
        local result = Awards.check(model)
        if result.internal then error("a bug at " .. table.concat(path, "/") .. ": " .. result.message) end
        tried = tried + 1
      end
    end
  end
  is_true(tried > 1000)
end)

test("what the writer makes passes the checks", function()
  local result = Awards.check(Envelope.read(Awards.encode(awardsModel()), "awards").model)
  is_true(result.ok)
  deep_eq(result.rowErrors, {})
end)

-- Which awards an export holds -------------------------------------------------------------------------------------

local NOW = 1796900000
local DAY = 86400

local function award(id, rev, phase, at)
  return { id = id, rev = rev, phase = phase, at = at or NOW - 3600 }
end

local function loadedNight(phase, known)
  local model = decode(read_file(FIXTURES .. "night-small.model.json"))
  model.phase = phase
  local list = Json.list()
  for _, entry in ipairs(known) do list[#list + 1] = { id = entry[1], rev = entry[2] } end
  model.known = list
  return Night.check(model)
end

local function ids(selection)
  local list = {}
  for index, a in ipairs(selection.awards) do list[index] = a.id end
  return list
end

test("with a night loaded, an export holds its phase's awards that the night does not know yet", function()
  local log = {
    award("s-a-1", 10, 1), -- known, same revision: the app has it
    award("s-a-2", 12, 1), -- known, older revision there: changed since the night was copied
    award("s-a-3", 5, 1), -- not known: new
    award("s-a-4", 5, 2), -- another phase
    award("s-a-5", 5, nil), -- made with no night loaded: held, as it may belong to this night
    award("s-a-6", 7, 1), -- known with a newer revision: the app has more than we do
  }
  local night = loadedNight(1, { { "s-a-1", 10 }, { "s-a-2", 11 }, { "s-a-6", 9 } })
  local selection = Awards.select(log, night, NOW, false)
  deep_eq(ids(selection), { "s-a-2", "s-a-3", "s-a-5" })
  eq(selection.count, 3)
  eq(selection.new, 2)
  eq(selection.changed, 1)
end)

test("an export of everything holds every award", function()
  local log = { award("s-a-1", 10, 1), award("s-a-2", 12, 1), award("s-a-3", 5, 2), award("s-a-4", 5, nil, NOW - 100 * DAY) }
  local night = loadedNight(1, { { "s-a-1", 10 }, { "s-a-2", 11 } })
  local selection = Awards.select(log, night, NOW, true)
  eq(selection.count, 4)
  eq(selection.new, 2) -- s-a-3 and s-a-4
  eq(selection.changed, 1) -- s-a-2
end)

test("with no night loaded, an export holds the awards of the last 14 days", function()
  local log = {
    award("s-a-1", 1, nil, NOW - 1 * DAY),
    award("s-a-2", 1, 3, NOW - 14 * DAY),
    award("s-a-3", 1, 3, NOW - 14 * DAY - 1),
    award("s-a-4", 1, nil, NOW - 30 * DAY),
    award("s-a-5", 1, nil, NOW + 100),
  }
  local selection = Awards.select(log, nil, NOW, false)
  deep_eq(ids(selection), { "s-a-1", "s-a-2", "s-a-5" })
  eq(selection.new, 3)
  eq(selection.changed, 0)
  eq(Awards.select(log, nil, NOW, true).count, 5)
end)

test("a night that knows nothing holds every award of its phase and of no phase", function()
  local log = { award("s-a-1", 1, 1), award("s-a-2", 1, 2), award("s-a-3", 1, nil) }
  local selection = Awards.select(log, loadedNight(1, {}), NOW, false)
  deep_eq(ids(selection), { "s-a-1", "s-a-3" })
end)

test("an empty log gives an empty selection", function()
  local selection = Awards.select({}, loadedNight(1, {}), NOW, false)
  eq(selection.count, 0)
  deep_eq(selection.awards, {})
  eq(Awards.select({}, nil, NOW, false).count, 0)
end)

test("a removed award is held like any other: the app needs to hear about the removal", function()
  local removed = award("s-a-1", 20, 1)
  removed.status = "removed"
  local selection = Awards.select({ removed }, loadedNight(1, { { "s-a-1", 19 } }), NOW, false)
  eq(selection.count, 1)
  eq(selection.changed, 1)
end)
