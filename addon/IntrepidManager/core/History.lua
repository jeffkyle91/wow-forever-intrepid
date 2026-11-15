-- Intrepid Manager: the loot history (/im history). Pure Lua 5.1 with no client calls: it turns the awards log into rows, puts them
-- in raids, words the dates and times, and searches them. ui/HistoryWindow draws what it makes.
--
-- A raid here is a dungeon or raid of the game and a time, never a raid of the Raid Desk: the awards made in one place, each within
-- History.GAP of the one before, are one raid ("Molten Core - Wed, Dec 9, 2026, 8:05 PM"). The place is the dungeon or raid the loot
-- master was in when they awarded (`place` on the award, written by game/Exchange.lua). An award with no place was made outside a
-- dungeon or raid, or before the addon wrote places.
--
-- A night is an evening of loot, wherever it was: the awards each within History.GAP of the one before, in any place. It holds the
-- raids of that evening (Molten Core, then Onyxia's Lair); a raid never spans two nights. A night or a raid is what the loot master
-- exports for the Raid Desk on its own.
--
--   local history = History.build(log, clock)   -- log: the awards log, oldest first; clock(at): date("*t", at), the local time
--   history.rows                                 -- newest first
--   history.raids                                -- newest first, each with its rows' count
--   history.nights                               -- newest first, each with its raids in the order they happened
--   History.filter(history, { text = "dec 9 cloak", to = "Jorren Ashvale", period = { days = 30 }, today = n, raid = r,
--     night = n })                               -- the rows that pass every filter given, newest first
--   History.search(history, "dec 9 cloak", raid) -- the same, with the words and one raid (or nil for all) only
--   History.raidCounts(rows)                     -- raid or night -> how many of these rows are in it
--   History.winners(history)                     -- every winner once, with their awards' count: the raider filter
--   History.periods(history)                     -- the choices of the date filter
--   History.idsOf(history, "night", key)          -- the award ids of a night or a raid: what its Export holds
--
-- A search is words. A row matches when every word starts a word of the row: the winner, the item, the place, or the date (written
-- "Wed, Dec 9, 2026" and "2026-12-09"). So "dec 9" finds December 9 and not December 19, and "jorren cloak" finds Jorren's cloak.
-- The time of day is not searched: "9" would find every award made at 9 o'clock.

local _, ns = ...

local History = {}
ns.History = History

History.GAP = 6 * 3600 -- the longest wait between two awards of one raid
History.NO_PLACE = "Outside a dungeon or raid"

local DAYS = { "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat" }
local MONTHS = { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" }
local MONTH_NAMES = {
  "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
}

local DECISIONS = { council = "Council", roll = "Roll", other = "Other" }
local GIVEN = { ["master-loot"] = "by master loot", trade = "in a trade", manual = "by hand" }

-- The day of the week (1 Sunday to 7 Saturday) of a date, without the client's clock (Zeller's rule).
function History.weekday(year, month, day)
  local y, m = year, month
  if m < 3 then
    m = m + 12
    y = y - 1
  end
  local k, j = y % 100, math.floor(y / 100)
  local h = (day + math.floor(13 * (m + 1) / 5) + k + math.floor(k / 4) + math.floor(j / 4) + 5 * j) % 7
  -- h: 0 Saturday, 1 Sunday ... 6 Friday
  return ((h + 6) % 7) + 1
end

-- The number of a date: days since January 1, 1970, so that "the last 7 days" is a subtraction (H. Hinnant's days_from_civil).
function History.dayNumber(year, month, day)
  local y = month <= 2 and year - 1 or year
  local era = math.floor(y / 400)
  local yearOfEra = y - era * 400
  local dayOfYear = math.floor((153 * ((month + 9) % 12) + 2) / 5) + day - 1
  local dayOfEra = yearOfEra * 365 + math.floor(yearOfEra / 4) - math.floor(yearOfEra / 100) + dayOfYear
  return era * 146097 + dayOfEra - 719468
end

-- "Wed, Dec 9, 2026" for a table with year, month and day (and wday, else it is worked out).
function History.dayText(t)
  local wday = t.wday or History.weekday(t.year, t.month, t.day)
  return DAYS[wday] .. ", " .. MONTHS[t.month] .. " " .. string.format("%.0f", t.day) .. ", " .. string.format("%.0f", t.year)
end

-- "9:42 PM" for a table with hour and min.
function History.timeText(t)
  local hour = t.hour % 12
  if hour == 0 then hour = 12 end
  return string.format("%.0f:%02.0f %s", hour, t.min, t.hour < 12 and "AM" or "PM")
end

-- "Wed, Dec 9, 2026, 9:42 PM".
function History.whenText(t)
  return History.dayText(t) .. ", " .. History.timeText(t)
end

-- The year, month and day of "2026-12-09", or nil.
function History.parseDate(text)
  if type(text) ~= "string" then return nil end
  local year, month, day = string.match(text, "^(%d%d%d%d)%-(%d%d)%-(%d%d)$")
  if not year then return nil end
  year, month, day = tonumber(year), tonumber(month), tonumber(day)
  if month < 1 or month > 12 or day < 1 or day > 31 then return nil end
  return { year = year, month = month, day = day }
end

-- The words of a text for the search: lower case, cut at spaces and punctuation. Letters beyond plain ASCII (accents) stay in
-- their word as they are.
function History.words(text)
  local words = {}
  for word in string.gmatch(string.lower(tostring(text or "")), "[^%s%p]+") do words[#words + 1] = word end
  return words
end

local function haystack(parts)
  local words = {}
  for _, part in ipairs(parts) do
    for _, word in ipairs(History.words(part)) do words[#words + 1] = word end
  end
  return " " .. table.concat(words, " ")
end

local function filled(text)
  if type(text) == "string" and text ~= "" then return text end
  return nil
end

-- The row of one award of the log. `clock(at)` is the local time as date("*t", at) gives it.
local function rowOf(award, clock)
  local delivery = type(award.delivery) == "table" and award.delivery or {}
  local row = {
    id = award.id, at = award.at, date = award.date, item = award.item or "?", itemId = award.itemId, to = award.to or "?",
    pseudo = award.pseudo, place = award.place, removed = award.status == "removed", received = delivery.state == "received",
    encounter = filled(award.encounter), note = filled(award.note),
  }
  row.placeText = row.place or History.NO_PLACE
  row.how = DECISIONS[award.decision] or ""
  local t = type(award.at) == "number" and clock and clock(award.at) or nil
  if t then
    row.day, row.time = History.dayText(t), History.timeText(t)
    row.year, row.month, row.mday = t.year, t.month, t.day
  else
    local d = History.parseDate(award.date)
    if d then
      row.day = History.dayText(d)
      row.year, row.month, row.mday = d.year, d.month, d.day
    end
  end
  if row.year then row.dayNum = History.dayNumber(row.year, row.month, row.mday) end
  row.when = row.day and (row.day .. (row.time and (", " .. row.time) or ""))
  if row.received then
    row.givenHow = GIVEN[delivery.how]
    local given = type(delivery.at) == "number" and clock and clock(delivery.at) or nil
    if given then -- the time alone on the day of the award, else the day too
      local sameDay = given.year == row.year and given.month == row.month and given.day == row.mday
      row.givenWhen = sameDay and History.timeText(given) or History.whenText(given)
    end
  end
  if row.removed then
    row.state = "Taken back"
  elseif row.received then
    row.state = "Given"
  else
    row.state = "Awarded"
  end
  row.search = haystack({ row.to, row.item, row.placeText, row.day, row.date })
  return row
end

-- The rows (newest first) and the raids (newest first) of the awards log.
function History.build(log, clock)
  local rows = {}
  for _, award in ipairs(log or {}) do
    if type(award) == "table" then rows[#rows + 1] = rowOf(award, clock) end
  end
  -- oldest first to make the raids: by time, then by the log's order (the order the awards were made in)
  for index, row in ipairs(rows) do row.order = index end
  table.sort(rows, function(a, b)
    local at, bt = a.at or 0, b.at or 0
    if at ~= bt then return at < bt end
    -- awards with a date and no time come first, by date, so that a day's are together
    local ad, bd = not a.at and tostring(a.date) or "", not b.at and tostring(b.date) or ""
    if ad ~= bd then return ad < bd end
    return a.order < b.order
  end)
  -- Does `row` carry on `group` (a raid or a night): within the gap of its last award, or, with a date and no time, the same day?
  local function joins(group, row)
    if not group then return false end
    if row.at and group.last then return row.at - group.last <= History.GAP end
    return not row.at and not group.first and group.day == row.day
  end
  local raids, nights, open, night = {}, {}, {}, nil -- open: place -> the raid still taking awards; night: the night still taking them
  for _, row in ipairs(rows) do
    if joins(night, row) then
      night.last = row.at or night.last
      night.count = night.count + 1
      if row.time then night.lastTime = row.time end
    else
      night = {
        kind = "night", first = row.at, last = row.at, count = 1, day = row.day or "?", time = row.time, lastTime = row.time, raids = {},
      }
      night.key = "night@" .. tostring(row.at or night.day) -- the same night after the history is built again
      nights[#nights + 1] = night
    end
    row.night = night
    local raid = open[row.placeText]
    if joins(raid, row) then
      raid.last = row.at or raid.last
      raid.count = raid.count + 1
      if row.time then raid.lastTime = row.time end
    else
      raid = {
        kind = "raid", place = row.place, placeText = row.placeText, first = row.at, last = row.at, count = 1, day = row.day or "?",
        time = row.time, lastTime = row.time, night = night,
      }
      raid.label = raid.placeText .. " - " .. raid.day .. (raid.time and (", " .. raid.time) or "")
      raid.key = raid.placeText .. "@" .. tostring(row.at or raid.day) -- the same raid after the history is built again
      raid.search = haystack({ raid.placeText, raid.day })
      raids[#raids + 1] = raid
      night.raids[#night.raids + 1] = raid
      open[row.placeText] = raid
    end
    row.raid = raid
  end
  -- A night of one raid is named as that raid; a longer one by its day and its places.
  for _, each in ipairs(nights) do
    if #each.raids == 1 then
      each.label = each.raids[1].label
    else
      local places = {}
      for _, raid in ipairs(each.raids) do places[#places + 1] = raid.placeText end
      each.label = each.day .. ": " .. table.concat(places, ", ")
    end
  end
  -- newest first, for the window
  local function newestFirst(list)
    local out = {}
    for i = #list, 1, -1 do
      list[i].index = #out + 1
      out[#out + 1] = list[i]
    end
    return out
  end
  local newestRows = {}
  for i = #rows, 1, -1 do newestRows[#newestRows + 1] = rows[i] end
  return { rows = newestRows, raids = newestFirst(raids), nights = newestFirst(nights) }
end

-- Does the row have every word of the search (as the start of one of its words)?
local function matches(row, words)
  for _, word in ipairs(words) do
    if not string.find(row.search, " " .. word, 1, true) then return false end
  end
  return true
end

-- Is the row in the period of the date filter: { days = 7 } the last 7 days up to `today` (a History.dayNumber), or
-- { year = 2026, month = 12 } one month? No period: every row is.
local function inPeriod(row, period, today)
  if not period then return true end
  if period.days then
    return row.dayNum ~= nil and today ~= nil and row.dayNum > today - period.days and row.dayNum <= today
  end
  return row.year == period.year and row.month == period.month
end

-- The rows of `history` that pass every filter given, newest first. `filter`: text (the search words), to (one winner, as the
-- rows write it), period and today (the date filter), raid or night (one of history.raids or history.nights).
function History.filter(history, filter)
  filter = filter or {}
  local words = History.words(filter.text)
  local found = {}
  for _, row in ipairs(history.rows) do
    if (filter.raid == nil or row.raid == filter.raid) and (filter.night == nil or row.night == filter.night)
      and (filter.to == nil or row.to == filter.to) and inPeriod(row, filter.period, filter.today) and matches(row, words) then
      found[#found + 1] = row
    end
  end
  return found
end

-- The rows of `history` that match the search text, in one raid (or in all of them when `raid` is nil). Newest first.
function History.search(history, text, raid)
  return History.filter(history, { text = text, raid = raid })
end

-- How many of `rows` each raid and each night holds: raid or night -> count.
function History.raidCounts(rows)
  local counts = {}
  for _, row in ipairs(rows) do
    counts[row.raid] = (counts[row.raid] or 0) + 1
    if row.night then counts[row.night] = (counts[row.night] or 0) + 1 end
  end
  return counts
end

-- The award ids of a night or a raid of `history`, found by its kind ("night" or "raid") and key: id -> true, and the night or
-- raid (nil when the history no longer has it). What Export of the loot history puts in the string.
function History.idsOf(history, kind, key)
  local picked
  for _, entry in ipairs((kind == "night" and history.nights or history.raids) or {}) do
    if entry.key == key then picked = entry end
  end
  local ids = {}
  if picked then
    for _, row in ipairs(history.rows) do
      if row.night == picked or row.raid == picked then ids[row.id] = true end
    end
  end
  return ids, picked
end

-- Every winner of the history once, with how many awards they have: the raiders by name (A to Z, any case), then Disenchant and
-- Guild bank. Each is { name = "Jorren Ashvale", count = 12, pseudo = nil or "disenchant" }.
function History.winners(history)
  local byName, list = {}, {}
  for _, row in ipairs(history.rows or {}) do
    local entry = byName[row.to]
    if not entry then
      entry = { name = row.to, count = 0, pseudo = row.pseudo }
      byName[row.to] = entry
      list[#list + 1] = entry
    end
    entry.count = entry.count + 1
  end
  table.sort(list, function(a, b)
    if (a.pseudo ~= nil) ~= (b.pseudo ~= nil) then return a.pseudo == nil end
    local al, bl = string.lower(a.name), string.lower(b.name)
    if al ~= bl then return al < bl end
    return a.name < b.name
  end)
  return list
end

-- The choices of the date filter: any date, the last 7, 30 and 90 days, then every month that has an award, newest first. Each is
-- { label = "Last 30 days", days = 30 } or { label = "December 2026", year = 2026, month = 12 } ({ label = "Any date" } for none).
function History.periods(history)
  local list = {
    { label = "Any date" }, { label = "Last 7 days", days = 7 }, { label = "Last 30 days", days = 30 }, { label = "Last 90 days", days = 90 },
  }
  local seen, months = {}, {}
  for _, row in ipairs(history.rows or {}) do
    if row.year and row.month then
      local key = row.year * 100 + row.month
      if not seen[key] then
        seen[key] = true
        months[#months + 1] = key
      end
    end
  end
  table.sort(months, function(a, b) return a > b end)
  for _, key in ipairs(months) do
    local year, month = math.floor(key / 100), key % 100
    list[#list + 1] = { label = MONTH_NAMES[month] .. " " .. string.format("%.0f", year), year = year, month = month }
  end
  return list
end

-- "Dec 9, 9:42 PM" for a row of this year (`year`), "Dec 9, 2025" for an older one: the WHEN column of the window.
function History.shortWhen(row, year)
  if not row.month then return "?" end
  local day = MONTHS[row.month] .. " " .. string.format("%.0f", row.mday)
  if row.year ~= year then return day .. ", " .. string.format("%.0f", row.year) end
  return row.time and (day .. ", " .. row.time) or day
end
