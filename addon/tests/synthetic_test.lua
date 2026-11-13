-- The synthetic strings of tools/synthetic.py (docs/spec/fixtures/synthetic/) read, checked and written again by the Lua code:
-- the addon's reader agrees with the reference reader on a larger, more varied night than the hand-made fixtures, and the
-- addon's writer makes the same bytes as the reference writer. Invented names only. See AGENTS.md.
local ns = load_core({}, "Crc32", "Json", "Envelope", "Ids", "Check", "Night", "Awards")
local Json, Envelope, Night, Awards = ns.Json, ns.Envelope, ns.Night, ns.Awards

local DIR = SPEC .. "fixtures/synthetic/"

local function decode(text)
  local ok, value = Json.decode(text)
  if not ok then error("decode failed: " .. tostring(value), 2) end
  return value
end

local function fixture(name) return (string.gsub(read_file(DIR .. name), "\n$", "")) end

local expected = decode(read_file(DIR .. "expected.json"))

local function sorted(list)
  local copy = {}
  for i, v in ipairs(list) do copy[i] = v end
  table.sort(copy)
  return copy
end

test("the synthetic night reads, with as many players, priorities and known awards as the reference says", function()
  local result = Night.read(fixture("night.j.txt"))
  is_true(result.ok)
  eq(#result.model.roster, expected.night.roster)
  eq(#result.model.priorities, expected.night.priorities)
  eq(#result.model.known, expected.night.known)
  eq(result.model.phase, expected.night.phase)
  deep_eq(sorted(result.rowErrors), sorted(expected.night.rowErrors))
end)

test("the awkward roster entries are in the night: no surname, one full name twice, an alt, and letters outside ASCII", function()
  local roster = Night.read(fixture("night.j.txt")).model.roster
  local without, twins, alts, outside = 0, 0, 0, 0
  local seen = {}
  for _, player in ipairs(roster) do
    if player.surname == nil then without = without + 1 end
    if player.main then alts = alts + 1 end
    if player.name:find("[\128-\255]") then outside = outside + 1 end
    if player.surname then
      local full = player.name .. " " .. player.surname
      seen[full] = (seen[full] or 0) + 1
      if seen[full] == 2 then twins = twins + 1 end
    end
  end
  eq(without, 1)
  eq(alts, 1)
  eq(outside, 1)
  eq(twins, 1)
end)

for _, name in ipairs({ "awards-first.j.txt", "awards-later.j.txt", "awards-edge.j.txt" }) do
  test("the synthetic " .. name .. " reads, has the row errors the reference found, and the addon writes it back byte for byte", function()
    local text = fixture(name)
    local result = Envelope.read(text, "awards")
    is_true(result.ok)
    local checked = Awards.check(result.model)
    is_true(checked.ok)
    eq(#result.model.awards, expected[name].awards)
    deep_eq(sorted(checked.rowErrors), sorted(expected[name].rowErrors))
    eq(Awards.encode(result.model), text)
  end)
end

test("the Lua reader refuses what the reference refuses: the night is not an awards string, and the awards are not a night", function()
  local night, awards = fixture("night.j.txt"), fixture("awards-first.j.txt")
  eq(Envelope.read(night, "awards").code, "E_KIND")
  eq(Envelope.read(awards, "night").code, "E_KIND")
end)

test("what an export holds against the synthetic night: the first export is all new, a later one holds only what changed or is new", function()
  local nightResult = Night.read(fixture("night.j.txt"))
  local first = Envelope.read(fixture("awards-first.j.txt"), "awards").model.awards
  local later = Envelope.read(fixture("awards-later.j.txt"), "awards").model.awards
  local now = 1796876000
  -- the night knows only the four awards of the earlier session: all twelve are new
  local selected = Awards.select(first, nightResult, now, false)
  eq(selected.count, 12)
  eq(selected.new, 12)
  eq(selected.changed, 0)
  -- the app imported the first export and copied a new night: its known list has the twelve at their revisions
  local known = {}
  for _, award in ipairs(first) do known[#known + 1] = { id = award.id, rev = award.rev } end
  local copied = { model = nightResult.model, known = known }
  selected = Awards.select(later, copied, now, false)
  -- What the later export should hold, counted from the two strings themselves (draft 3's preview has no "Changed" category:
  -- a later revision is a Conflict there, and pseudo awards are Skipped, but the addon still exports both): an award the
  -- first export had at an older revision is changed, one it did not have is new, and one at the same revision is left out.
  local firstRev = {}
  for _, award in ipairs(first) do firstRev[award.id] = award.rev end
  local changed, new = 0, 0
  for _, award in ipairs(later) do
    if firstRev[award.id] == nil then new = new + 1
    elseif award.rev > firstRev[award.id] then changed = changed + 1 end
  end
  is_true(changed > 0 and new > 0) -- the fixture still walks through both
  eq(selected.count, changed + new)
  eq(selected.changed, changed)
  eq(selected.new, new)
  -- everything, whatever the night knows
  eq(Awards.select(later, copied, now, true).count, #later)
end)
