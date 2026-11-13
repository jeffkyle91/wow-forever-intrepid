-- The loot history (IntrepidManager/core/History.lua): rows from the awards log, raids by place and time, the wording of dates and
-- times, and the search. Invented names, items and places only. See AGENTS.md.
local ns = load_core({}, "History")
local History = ns.History

-- The clock of the tests: UTC, so a test gives the same answer in every time zone.
local function clock(at) return os.date("!*t", at) end

-- 2026-12-09 20:05 UTC is a Wednesday.
local WED = 1796846700 -- 2026-12-09 20:05:00 UTC
local HOUR, DAY = 3600, 86400

local function award(n, options)
  options = options or {}
  local a = {
    id = "s-tpt2u0-q4tz-" .. n, rev = 1, at = options.at or WED, date = options.date or os.date("!%Y-%m-%d", options.at or WED),
    itemId = options.itemId or 900000 + n,
    item = options.item or ("Test Blade " .. n), to = options.to or "Jorren Ashvale", decision = "council",
    delivery = { state = options.received and "received" or "assigned" }, place = options.place,
  }
  if options.at == false then a.at = nil end
  if options.removed then a.status = "removed" end
  if options.pseudo then
    a.pseudo, a.to = options.pseudo, options.pseudo == "disenchant" and "Disenchant" or "Guild bank"
  end
  return a
end

test("the clock of the tests: WED is Wednesday, December 9, 2026, 8:05 PM", function()
  local t = clock(WED)
  eq(t.year, 2026)
  eq(t.month, 12)
  eq(t.day, 9)
  eq(t.hour, 20)
  eq(t.min, 5)
  eq(t.wday, 4)
end)

test("the day of the week without the client's clock agrees with the clock", function()
  for days = -800, 800, 37 do
    local t = clock(WED + days * DAY)
    eq(History.weekday(t.year, t.month, t.day), t.wday)
  end
  eq(History.weekday(2026, 12, 9), 4) -- Wednesday
  eq(History.weekday(2024, 2, 29), 5) -- Thursday
  eq(History.weekday(2000, 1, 1), 7) -- Saturday
end)

test("dates and times are written the American way, without leading zeros", function()
  eq(History.dayText(clock(WED)), "Wed, Dec 9, 2026")
  eq(History.timeText(clock(WED)), "8:05 PM")
  eq(History.whenText(clock(WED)), "Wed, Dec 9, 2026, 8:05 PM")
  eq(History.timeText({ hour = 0, min = 7 }), "12:07 AM")
  eq(History.timeText({ hour = 12, min = 0 }), "12:00 PM")
  eq(History.timeText({ hour = 9, min = 42 }), "9:42 AM")
  eq(History.dayText({ year = 2027, month = 1, day = 15 }), "Fri, Jan 15, 2027") -- no wday: worked out
end)

test("a date as YYYY-MM-DD is read, anything else is not", function()
  deep_eq(History.parseDate("2026-12-09"), { year = 2026, month = 12, day = 9 })
  eq(History.parseDate("2026-13-09"), nil)
  eq(History.parseDate("12/09/2026"), nil)
  eq(History.parseDate(nil), nil)
end)

test("a row says when, what, who, where and whether it was given or taken back", function()
  local history = History.build({
    award(1, { place = "Molten Test Core", received = true }),
    award(2, { place = "Molten Test Core", at = WED + 600, removed = true }),
    award(3, { place = "Molten Test Core", at = WED + 900, pseudo = "disenchant" }),
  }, clock)
  local rows = history.rows
  eq(#rows, 3)
  -- newest first
  eq(rows[1].id, "s-tpt2u0-q4tz-3")
  eq(rows[1].to, "Disenchant")
  eq(rows[1].state, "Awarded")
  eq(rows[2].state, "Taken back")
  eq(rows[2].removed, true)
  eq(rows[3].state, "Given")
  eq(rows[3].day, "Wed, Dec 9, 2026")
  eq(rows[3].time, "8:05 PM")
  eq(rows[3].placeText, "Molten Test Core")
  eq(rows[3].how, "Council")
end)

test("a raid is one place, each award within 6 hours of the one before; the raids come newest first", function()
  local log = {
    award(1, { place = "Molten Test Core", at = WED }),
    award(2, { place = "Molten Test Core", at = WED + 2 * HOUR }),
    award(3, { place = "Onyx Test Lair", at = WED + 2 * HOUR + 60 }), -- another place the same night
    award(4, { place = "Molten Test Core", at = WED + 7 * HOUR + 60 }), -- 5 hours after award 2: the same raid
    award(5, { place = "Molten Test Core", at = WED + 7 * DAY }), -- a week later: another raid
    award(6, { at = WED + 7 * DAY + 60 }), -- no place
  }
  local history = History.build(log, clock)
  local raids = history.raids
  eq(#raids, 4)
  eq(raids[1].placeText, History.NO_PLACE)
  eq(raids[2].label, "Molten Test Core - Wed, Dec 16, 2026, 8:05 PM")
  eq(raids[2].count, 1)
  eq(raids[3].label, "Onyx Test Lair - Wed, Dec 9, 2026, 10:06 PM")
  eq(raids[4].label, "Molten Test Core - Wed, Dec 9, 2026, 8:05 PM")
  eq(raids[4].count, 3)
  -- every row knows its raid
  for _, row in ipairs(history.rows) do is_true(row.raid ~= nil) end
  eq(history.rows[#history.rows].raid, raids[4])
  -- more than 6 hours apart: two raids
  local apart = History.build({ award(1, { place = "Molten Test Core" }), award(2, { place = "Molten Test Core", at = WED + 6 * HOUR + 1 }) }, clock)
  eq(#apart.raids, 2)
end)

test("a raid keeps its key when the history is built again with more awards", function()
  local log = { award(1, { place = "Molten Test Core" }) }
  local before = History.build(log, clock).raids[1].key
  log[2] = award(2, { place = "Molten Test Core", at = WED + 600 })
  local after = History.build(log, clock).raids[1]
  eq(after.key, before)
  eq(after.count, 2)
end)

test("awards in the same second keep the order they were made in", function()
  local history = History.build({ award(1, {}), award(2, {}), award(3, {}) }, clock)
  eq(history.rows[1].id, "s-tpt2u0-q4tz-3")
  eq(history.rows[3].id, "s-tpt2u0-q4tz-1")
end)

test("an award with a date and no time still has its day, and joins the raid of its place and day", function()
  local history = History.build({
    award(1, { at = false, date = "2026-12-09", place = "Molten Test Core" }),
    award(2, { at = false, date = "2026-12-09", place = "Molten Test Core" }),
    award(3, { at = false, date = "2026-12-10", place = "Molten Test Core" }),
  }, clock)
  eq(history.rows[1].day, "Thu, Dec 10, 2026")
  eq(history.rows[1].time, nil)
  eq(#history.raids, 2)
  eq(history.raids[2].count, 2)
  eq(history.raids[2].label, "Molten Test Core - Wed, Dec 9, 2026")
end)

test("an empty log, a missing log and a broken entry give an empty history without an error", function()
  eq(#History.build({}, clock).rows, 0)
  eq(#History.build(nil, clock).raids, 0)
  eq(#History.build({ "not an award" }, clock).rows, 0)
end)

test("the words of a search: lower case, cut at spaces and punctuation, accents kept", function()
  deep_eq(History.words("Dec 9, 2026"), { "dec", "9", "2026" })
  deep_eq(History.words("  2026-12-09 "), { "2026", "12", "09" })
  deep_eq(History.words("Zo\195\171"), { "zo\195\171" })
  deep_eq(History.words(""), {})
end)

local function searchLog()
  return History.build({
    award(1, { place = "Molten Test Core", to = "Jorren Ashvale", item = "Cloak of Fixtures" }),
    award(2, { place = "Molten Test Core", to = "Mirabel Quint", item = "Test Blade of Ages", at = WED + 600 }),
    award(3, { place = "Onyx Test Lair", to = "Jorren Ashvale", item = "Helm of Samples", at = WED + 10 * DAY }), -- Dec 19
    award(4, { place = "Molten Test Core", to = "Zo\195\171 \195\134rinwald", item = "Cloak of Fixtures", at = WED + 365 * DAY }),
  }, clock)
end

local function ids(rows)
  local list = {}
  for _, row in ipairs(rows) do list[#list + 1] = tonumber(string.match(row.id, "(%d+)$")) end
  return list
end

test("a search finds a player, an item, a place, and words of two of them", function()
  local history = searchLog()
  deep_eq(ids(History.search(history, "jorren", nil)), { 3, 1 })
  deep_eq(ids(History.search(history, "cloak", nil)), { 4, 1 })
  deep_eq(ids(History.search(history, "onyx", nil)), { 3 })
  deep_eq(ids(History.search(history, "Jorren CLOAK", nil)), { 1 })
  deep_eq(ids(History.search(history, "jor", nil)), { 3, 1 }) -- the start of a word
  deep_eq(ids(History.search(history, "orren", nil)), {}) -- not the middle of one
  deep_eq(ids(History.search(history, "zo\195\171", nil)), { 4 })
  deep_eq(ids(History.search(history, "", nil)), { 4, 3, 2, 1 })
  deep_eq(ids(History.search(history, "   ", nil)), { 4, 3, 2, 1 })
end)

test("a search finds a date: dec 9 is not dec 19, and a date as 2026-12-09 or 12/9 works too", function()
  local history = searchLog()
  deep_eq(ids(History.search(history, "dec 9", nil)), { 4, 2, 1 }) -- award 4 is Dec 9, 2027
  deep_eq(ids(History.search(history, "dec 9 2026", nil)), { 2, 1 })
  deep_eq(ids(History.search(history, "dec 19", nil)), { 3 })
  deep_eq(ids(History.search(history, "2026-12-09", nil)), { 2, 1 })
  deep_eq(ids(History.search(history, "2027", nil)), { 4 })
  deep_eq(ids(History.search(history, "sat", nil)), { 3 }) -- Saturday, Dec 19
  -- the time of day is not searched: "8" finds no award made at 8 PM
  deep_eq(ids(History.search(history, "8", nil)), {})
end)

test("a search in one raid, and the counts of the raids that have a match", function()
  local history = searchLog()
  local first = history.raids[#history.raids] -- Molten Test Core, Dec 9, 2026
  deep_eq(ids(History.search(history, "", first)), { 2, 1 })
  deep_eq(ids(History.search(history, "cloak", first)), { 1 })
  local counts = History.raidCounts(History.search(history, "cloak", nil))
  eq(counts[first], 1)
  eq(counts[history.raids[1]], 1)
  eq(counts[history.raids[2]], nil)
end)

test("the WHEN column: the time for this year, the year for an older award", function()
  local history = searchLog()
  local row = history.rows[#history.rows]
  eq(History.shortWhen(row, 2026), "Dec 9, 8:05 PM")
  eq(History.shortWhen(row, 2027), "Dec 9, 2026")
  eq(History.shortWhen({ }, 2026), "?")
  local undated = History.build({ award(1, { at = false }) }, clock).rows[1]
  eq(History.shortWhen(undated, 2026), "Dec 9")
end)

test("ten thousand awards build and search in well under a second here", function()
  local log = {}
  for n = 1, 10000 do
    log[n] = award(n, { place = (n % 3 == 0) and "Onyx Test Lair" or "Molten Test Core", at = WED + n * 300, to = "Player " .. (n % 40) })
  end
  local started = os.clock()
  local history = History.build(log, clock)
  local found = History.search(history, "player 7", nil)
  local spent = os.clock() - started
  eq(#history.rows, 10000)
  is_true(#found > 0)
  is_true(spent < 2)
end)
