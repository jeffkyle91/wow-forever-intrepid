-- Intrepid Manager: the bags, for the loot master's queue. It lists the items in the bags that can still be offered to the group: items
-- that carry the game's line about trading them ("You may trade this item with players that were also eligible to loot this item for
-- the next 3 hrs 59 min (including time offline)"), and items that are not bound at all, of Uncommon quality or better. Nothing is
-- changed. How the game answers was seen by the probe (C_Container.GetContainerItemInfo for the link and isBound,
-- C_TooltipInfo.GetBagItem for the lines; 2026-10-20, Addon-Handoff.md section 7).
--
--   local rows = ns.Game.Bags.scan()   -- { { bag, slot, link, item, itemId, name, icon, quality, bound, minutes }, ... }
--   ns.Game.Bags.describe(rows[1])     -- "bag 1 slot 3: [Crown of the Fallen] (Epic), 3 h 59 min left to trade"

local _, ns = ...

local Bags = {}
ns.Game = ns.Game or {}
ns.Game.Bags = Bags

Bags.MAX_ROWS = 60
Bags.MIN_QUALITY = 2 -- Uncommon: below this, an unbound item is not offered
local LAST_BAG = 5 -- the backpack is 0, the bags 1 to 4, and 5 is the reagent bag where the client has one

local QUALITY_NAMES = { [0] = "Poor", [1] = "Common", [2] = "Uncommon", [3] = "Rare", [4] = "Epic", [5] = "Legendary" }

-- The minutes left in the game's line about trading (rounded up), or nil when the line holds no time. The raw line keeps a plural
-- escape ("3 |4hour:hrs; 59 min"); the shown line has the word. Both are read. English only: other locales have other words.
function Bags.tradeMinutes(text)
  if type(text) ~= "string" then return nil end
  text = string.gsub(text, "|4([^:;]*):([^;]*);", "%1")
  local span = string.match(text, "[Nn]ext%s+(.-)%s*%(") or string.match(text, "[Nn]ext%s+(.-)%.?%s*$") or text
  local days = tonumber(string.match(span, "(%d+)%s*d")) or 0
  local hours = tonumber(string.match(span, "(%d+)%s*h")) or 0
  local minutes = tonumber(string.match(span, "(%d+)%s*m")) or 0
  local seconds = tonumber(string.match(span, "(%d+)%s*s")) or 0
  if days == 0 and hours == 0 and minutes == 0 and seconds == 0 then return nil end
  return days * 1440 + hours * 60 + minutes + (seconds > 0 and 1 or 0)
end

-- The lines of an item's tooltip as plain strings, or nil when the tooltip functions are missing or fail.
local function tooltipLines(bag, slot)
  local ok, data = pcall(C_TooltipInfo.GetBagItem, bag, slot)
  if not ok or type(data) ~= "table" or type(data.lines) ~= "table" then return nil end
  local lines = {}
  for _, line in ipairs(data.lines) do
    local text = type(line) == "table" and (line.leftText or line.text) or nil
    if type(text) == "string" then lines[#lines + 1] = text end
  end
  return lines
end

-- A line about trading the item to others, but not the item class "Trade Goods".
local function mentionsTrading(text)
  local lower = string.lower(text)
  return string.find(lower, "trad", 1, true) ~= nil and string.find(lower, "trade goods", 1, true) == nil
end

-- One bag slot as a row, or nil when it is empty or nothing could be offered from it.
local function rowOf(bag, slot, minQuality)
  local info = C_Container.GetContainerItemInfo(bag, slot)
  if type(info) ~= "table" or not info.hyperlink then return nil end
  local item = ns.Net.CouncilWire.itemString(info.hyperlink)
  if not item then return nil end
  local row = {
    bag = bag, slot = slot, link = info.hyperlink, item = item, itemId = info.itemID, quality = info.quality or 0,
    bound = info.isBound and true or false, name = string.match(info.hyperlink, "|h%[(.-)%]|h"), icon = info.iconFileID,
  }
  local lines = tooltipLines(bag, slot)
  for _, text in ipairs(lines or {}) do
    if mentionsTrading(text) then
      row.minutes = Bags.tradeMinutes(text)
      row.tradeLine = true
      break
    end
  end
  if row.tradeLine or (not row.bound and row.quality >= minQuality) then return row end
  return nil
end

-- The items that can be offered: those with a trade time first (the soonest to run out first), then unbound ones, better first.
-- Returns the rows and the number of slots that raised an error (told, not hidden).
function Bags.scan(options)
  options = options or {}
  local minQuality = options.minQuality or Bags.MIN_QUALITY
  local rows, errors = {}, 0
  for bag = 0, LAST_BAG do
    local okCount, total = pcall(C_Container.GetContainerNumSlots, bag)
    if okCount and type(total) == "number" then
      for slot = 1, total do
        local ok, row = pcall(rowOf, bag, slot, minQuality)
        if not ok then
          errors = errors + 1
        elseif row and #rows < Bags.MAX_ROWS then
          rows[#rows + 1] = row
        end
      end
    end
  end
  table.sort(rows, function(a, b)
    if a.tradeLine ~= b.tradeLine then return a.tradeLine == true end
    if a.tradeLine then
      local ma, mb = a.minutes or 1e9, b.minutes or 1e9
      if ma ~= mb then return ma < mb end
    elseif a.quality ~= b.quality then
      return a.quality > b.quality
    end
    if a.bag ~= b.bag then return a.bag < b.bag end
    return a.slot < b.slot
  end)
  return rows, errors
end

-- "3 h 59 min" for 239 minutes.
function Bags.timeText(minutes)
  if not minutes then return nil end
  local hours = math.floor(minutes / 60)
  local rest = minutes - hours * 60
  if hours == 0 then return rest .. " min" end
  if rest == 0 then return hours .. " h" end
  return hours .. " h " .. rest .. " min"
end

-- One row for the chat.
function Bags.describe(row)
  local text = "bag " .. row.bag .. " slot " .. row.slot .. ": " .. row.link .. " (" .. (QUALITY_NAMES[row.quality] or ("quality " .. row.quality)) .. ")"
  if row.tradeLine then
    local left = Bags.timeText(row.minutes)
    text = text .. ", " .. (left and (left .. " left to trade") or "can be traded for a while")
  else
    text = text .. ", not bound"
  end
  return text
end
