-- The awarded marks (IntrepidManager/core/Marks.lua, docs/spec/exchange-v0.md section 7) and the shared cases in
-- docs/spec/fixtures/marks-cases.json. Invented names only. See AGENTS.md.
local ns = load_core({}, "Crc32", "Json", "Envelope", "Names", "Ids", "Check", "Night", "Marks")
local Night, Marks, Json = ns.Night, ns.Marks, ns.Json

local FIXTURES = SPEC .. "fixtures/"

local function decode(text)
  local ok, value = Json.decode(text)
  if not ok then error("decode failed: " .. tostring(value), 2) end
  return value
end

-- A night as Night.check gives it, with the edits of a case applied first.
local function nightFor(name, edits)
  local model = decode(read_file(FIXTURES .. name .. ".model.json"))
  for _, edit in ipairs(edits or {}) do apply_edit(model, edit) end
  local result = Night.check(model)
  if not result.ok then error("the night is not valid: " .. result.message) end
  if #result.rowErrors > 0 then error("the night has row errors: " .. table.concat(result.rowErrors, ", ")) end
  return result
end

-- The shared cases ------------------------------------------------------------------------------------------------

local cases = decode(read_file(FIXTURES .. "marks-cases.json"))

test("there are shared marks cases, some with their own night", function()
  is_true(#cases >= 23)
  local edited = 0
  for _, case in ipairs(cases) do
    if case.edit then edited = edited + 1 end
  end
  is_true(edited >= 6)
end)

for _, case in ipairs(cases) do
  test("shared marks case: " .. case.name, function()
    local result = Marks.compute(nightFor(case.night, case.edit), case.log)
    deep_eq(result.awarded, case.expect)
    deep_eq(result.changed, case.changed)
  end)
end

-- Beyond the shared cases ----------------------------------------------------------------------------------------

local BLADE = "Blade of the Fixture"
local MIRELLE = "AbCdEfGhIjKlMnOpQr02"

local function award(n, fields)
  local a = { id = "s-tpt2u0-q4tz-" .. n, rev = 1796866500 + n, phase = 1 }
  for key, value in pairs(fields) do a[key] = value end
  return a
end

test("the night and the log are not changed", function()
  local night = nightFor("night-small")
  local log = { award(1, { priority = "pr-blade", item = BLADE, toId = MIRELLE, to = "Mirelle Dunmore" }) }
  local nightBefore = decode(read_file(FIXTURES .. "night-small.model.json"))
  local logBefore = { award(1, { priority = "pr-blade", item = BLADE, toId = MIRELLE, to = "Mirelle Dunmore" }) }
  Marks.compute(night, log)
  deep_eq(night.model, nightBefore)
  deep_eq(log, logBefore)
  eq(night.priorities[1].lines[2].awarded, nil)
end)

test("a log with nothing in it gives the marks the night came with", function()
  local night = nightFor("night-small")
  local result = Marks.compute(night, {})
  deep_eq(result.awarded, { ["pr-blade"] = { true, false, false, false }, ["pr-cloak"] = { true, false, false }, ["pr-typed"] = { false } })
  deep_eq(result.changed, {})
end)

test("a night with no priorities and no known list works", function()
  local night = nightFor("night-empty")
  local result = Marks.compute(night, { award(1, { priority = "pr-x", item = "Thing", to = "Jorren Ashvale" }) })
  deep_eq(result.awarded, {})
  deep_eq(result.changed, {})
end)

test("two awards fill the two listings of a person in order", function()
  local night = nightFor("night-small")
  local log = {
    award(1, { priority = "pr-blade", item = BLADE, toId = "AbCdEfGhIjKlMnOpQr01", to = "Jorren Ashvale" }),
    award(2, { priority = "pr-blade", item = BLADE, toId = "AbCdEfGhIjKlMnOpQr02", to = "Mirelle Dunmore" }),
  }
  deep_eq(Marks.compute(night, log).awarded["pr-blade"], { true, true, false, true })
end)

test("awards are applied in the order of the log", function()
  -- Jorren is listed at lines 1 (already awarded) and 4: the first award takes line 4, the second finds none open.
  local night = nightFor("night-small")
  local one = { award(1, { priority = "pr-blade", item = BLADE, toId = "AbCdEfGhIjKlMnOpQr01", to = "Jorren Ashvale" }) }
  deep_eq(Marks.compute(night, one).awarded["pr-blade"], { true, false, false, true })
  local two = { one[1], award(2, { priority = "pr-blade", item = BLADE, toId = "AbCdEfGhIjKlMnOpQr01", to = "Jorren Ashvale" }) }
  deep_eq(Marks.compute(night, two).awarded["pr-blade"], { true, false, false, true })
end)

test("changed lists each award the night knows in an older revision, once", function()
  local night = nightFor("night-small") -- knows s-tpg4mo-k3p9-1 at 1796262300 and s-tpg4mo-k3p9-2 at 1796263500
  local log = {
    { id = "s-tpg4mo-k3p9-1", rev = 1796262300, phase = 1, priority = "pr-blade", item = BLADE, toId = MIRELLE, to = "Mirelle Dunmore" },
    { id = "s-tpg4mo-k3p9-2", rev = 1796263501, phase = 1, priority = "pr-blade", item = BLADE, toId = MIRELLE, to = "Mirelle Dunmore" },
  }
  local result = Marks.compute(night, log)
  deep_eq(result.changed, { "s-tpg4mo-k3p9-2" })
  deep_eq(result.awarded["pr-blade"], { true, false, false, false }) -- neither counts
end)

test("a known award of an older revision than the night's is not reported", function()
  local night = nightFor("night-small")
  local log = { { id = "s-tpg4mo-k3p9-2", rev = 1796263000, phase = 1, priority = "pr-blade", item = BLADE, toId = MIRELLE, to = "Mirelle Dunmore" } }
  deep_eq(Marks.compute(night, log).changed, {})
end)

test("a removed award or a pseudo award in the night's known list is only a known award", function()
  local night = nightFor("night-small")
  local log = { { id = "s-tpg4mo-k3p9-2", rev = 1796263600, phase = 1, status = "removed", priority = "pr-blade", item = BLADE, to = "Mirelle Dunmore" } }
  deep_eq(Marks.compute(night, log).changed, {}) -- removed awards are skipped before anything else
  log[1].status = nil
  log[1].pseudo = "disenchant"
  deep_eq(Marks.compute(night, log).changed, {})
end)

test("a toId that is in the roster but whose entry has no line on the priority marks nothing", function()
  local night = nightFor("night-small")
  local log = { award(1, { priority = "pr-blade", item = BLADE, toId = "AbCdEfGhIjKlMnOpQr05", to = "Pell" }) }
  deep_eq(Marks.compute(night, log).awarded["pr-blade"], { true, false, false, false })
end)

test("a name-only line matches the recipient's full name after the same trimming and lowercasing", function()
  local night = nightFor("night-small")
  local log = { award(1, { priority = "pr-typed", item = "Item Typed by Hand", to = "  GARRICK   vole ", decision = "other" }) }
  deep_eq(Marks.compute(night, log).awarded["pr-typed"], { true })
end)

test("the first name alone never marks a name-only line either", function()
  local night = nightFor("night-small")
  local log = { award(1, { priority = "pr-typed", item = "Item Typed by Hand", to = "Garrick", decision = "other" }) }
  deep_eq(Marks.compute(night, log).awarded["pr-typed"], { false })
end)

test("an award of another phase or with no phase is not counted", function()
  local night = nightFor("night-small")
  local log = {
    award(1, { phase = 2, priority = "pr-blade", item = BLADE, toId = MIRELLE, to = "Mirelle Dunmore" }),
    award(2, { phase = false, priority = "pr-blade", item = BLADE, toId = MIRELLE, to = "Mirelle Dunmore" }),
  }
  log[2].phase = nil
  deep_eq(Marks.compute(night, log).awarded["pr-blade"], { true, false, false, false })
end)
