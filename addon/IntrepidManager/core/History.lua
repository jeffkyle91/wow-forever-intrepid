-- Intrepid Manager: the loot history (/im history). Pure Lua 5.1 with no client calls: it turns the awards log into rows, puts them
-- in raids, words the dates and times, and searches them. ui/HistoryWindow draws what it makes.
--
-- A raid here is a dungeon or raid of the game and a time, never a raid of the Raid Desk: the awards made in one place, each within
-- History.GAP of the one before, are one raid ("Molten Core - Wed, Dec 9, 2026, 8:05 PM"). The place is the dungeon or raid the loot
-- master was in when they awarded (`place` on the award, written by game/Exchange.lua). An award with no place was made outside a
-- dungeon or raid, or before the addon wrote places.
--
--   local history = History.build(log, clock)   -- log: the awards log, oldest first; clock(at): date("*t", at), the local time
--   history.rows                                 -- newest first
--   history.raids                                -- newest first, each with its rows' count
--   History.search(history, "dec 9 cloak", raid) -- the rows that match, newest first; raid: one of history.raids, or nil for all
--   History.raidCounts(rows)                     -- raid -> how many of these rows are in it
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
    return a.order < b.order
  end)
  local raids, open = {}, {} -- open: place -> the raid still taking awards
  for _, row in ipairs(rows) do
    local key = row.placeText
    local raid = open[key]
    if raid and row.at and raid.last and row.at - raid.last <= History.GAP then
      raid.last = row.at
      raid.count = raid.count + 1
    elseif raid and not row.at and not raid.first and raid.day == row.day then
      raid.count = raid.count + 1 -- an award with a date and no time joins the raid of its place and day
    else
      raid = { place = row.place, placeText = row.placeText, first = row.at, last = row.at, count = 1, day = row.day or "?", time = row.time }
      raid.label = raid.placeText .. " - " .. raid.day .. (raid.time and (", " .. raid.time) or "")
      raid.key = raid.placeText .. "@" .. tostring(row.at or raid.day) -- the same raid after the history is built again
      raid.search = haystack({ raid.placeText, raid.day })
      raids[#raids + 1] = raid
      open[key] = raid
    end
    row.raid = raid
  end
  -- newest first, for the window
  local newestRows, newestRaids = {}, {}
  for i = #rows, 1, -1 do newestRows[#newestRows + 1] = rows[i] end
  for i = #raids, 1, -1 do
    local raid = raids[i]
    raid.index = #newestRaids + 1
    newestRaids[#newestRaids + 1] = raid
  end
  return { rows = newestRows, raids = newestRaids }
end

-- Does the row have every word of the search (as the start of one of its words)?
local function matches(row, words)
  for _, word in ipairs(words) do
    if not string.find(row.search, " " .. word, 1, true) then return false end
  end
  return true
end

-- The rows of `history` that match the search text, in one raid (or in all of them when `raid` is nil). Newest first.
function History.search(history, text, raid)
  local words = History.words(text)
  local found = {}
  for _, row in ipairs(history.rows) do
    if (raid == nil or row.raid == raid) and matches(row, words) then found[#found + 1] = row end
  end
  return found
end

-- How many of `rows` each raid holds: raid -> count.
function History.raidCounts(rows)
  local counts = {}
  for _, row in ipairs(rows) do counts[row.raid] = (counts[row.raid] or 0) + 1 end
  return counts
end

-- "Dec 9, 9:42 PM" for a row of this year (`year`), "Dec 9, 2025" for an older one: the WHEN column of the window.
function History.shortWhen(row, year)
  if not row.month then return "?" end
  local day = MONTHS[row.month] .. " " .. string.format("%.0f", row.mday)
  if row.year ~= year then return day .. ", " .. string.format("%.0f", row.year) end
  return row.time and (day .. ", " .. row.time) or day
end
