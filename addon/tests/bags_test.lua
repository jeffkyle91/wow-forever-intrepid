-- The bag list for the loot master's queue (IntrepidManager/game/Bags.lua), against fake containers. Invented items only.

local UI = dofile("tests/support/strict_ui.lua")

local TRADE_RAW = "You may trade this item with players that were also eligible to loot this item for the next %s (including time offline)."

local function link(id, name, color)
  return "|c" .. (color or "ffa335ee") .. "|Hitem:" .. id .. "::::::::70:::::|h[" .. name .. "]|h|r"
end

-- bags: { [bag] = { [slot] = { id, name, quality, bound, trade = "3 |4hour:hrs; 59 min", raises = true } }, size = n }
local function setup(bags, size)
  local game = UI.new()
  local env = game.env
  env.C_Container = {
    GetContainerNumSlots = function(bag) return bags[bag] and (size or 8) or 0 end,
    GetContainerItemInfo = function(bag, slot)
      local entry = bags[bag] and bags[bag][slot]
      if not entry then return nil end
      if entry.raises then error("bag trouble") end
      return { hyperlink = link(entry.id, entry.name), itemID = entry.id, quality = entry.quality, isBound = entry.bound }
    end,
  }
  env.C_TooltipInfo = {
    GetBagItem = function(bag, slot)
      local entry = bags[bag] and bags[bag][slot]
      if not entry then return nil end
      local lines = { { leftText = entry.name } }
      if entry.bound then lines[#lines + 1] = { leftText = "Soulbound" } end
      if entry.trade then lines[#lines + 1] = { leftText = string.format(TRADE_RAW, entry.trade) } end
      if entry.tradeGoods then lines[#lines + 1] = { leftText = "Trade Goods" } end
      return { lines = lines }
    end,
  }
  local ns = {}
  load_core(ns, "Names", "Council")
  game.load("IntrepidManager/net/CouncilWire.lua", ns)
  game.load("IntrepidManager/game/Bags.lua", ns)
  return ns.Game.Bags, game
end

test("the time left in the trade line is read in minutes, with the raw escape or the shown word", function()
  local Bags = setup({})
  eq(Bags.tradeMinutes(string.format(TRADE_RAW, "3 |4hour:hrs; 59 min")), 239)
  eq(Bags.tradeMinutes("You may trade this item with players that were also eligible to loot this item for the next 3 hrs 59 min (including time offline)."), 239)
  eq(Bags.tradeMinutes(string.format(TRADE_RAW, "1 |4hour:hrs;")), 60)
  eq(Bags.tradeMinutes(string.format(TRADE_RAW, "45 min")), 45)
  eq(Bags.tradeMinutes(string.format(TRADE_RAW, "1 |4hour:hrs; 5 min")), 65)
  eq(Bags.tradeMinutes(string.format(TRADE_RAW, "30 sec")), 1)
  eq(Bags.tradeMinutes(string.format(TRADE_RAW, "1 |4day:days; 2 |4hour:hrs;")), 1560)
  eq(Bags.tradeMinutes("You may trade this item for the next 20 min."), 20)
  eq(Bags.tradeMinutes("You may trade this item."), nil)
  eq(Bags.tradeMinutes(nil), nil)
  eq(Bags.tradeMinutes(12), nil)
end)

test("the minutes are told as hours and minutes", function()
  local Bags = setup({})
  eq(Bags.timeText(239), "3 h 59 min")
  eq(Bags.timeText(60), "1 h")
  eq(Bags.timeText(45), "45 min")
  eq(Bags.timeText(0), "0 min")
  eq(Bags.timeText(nil), nil)
end)

test("the scan lists items with a trade time first (soonest first), then unbound ones, better first, and skips the rest", function()
  local bags = {
    [0] = {
      [1] = { id = 101, name = "Crown of the Fallen", quality = 4, bound = true, trade = "3 |4hour:hrs; 59 min" },
      [2] = { id = 102, name = "Ring of Ash", quality = 4, bound = true, trade = "20 min" },
      [3] = { id = 103, name = "Sturdy Boots", quality = 3, bound = false },
      [4] = { id = 104, name = "Linen Scrap", quality = 0, bound = false },
      [5] = { id = 105, name = "Hearthstone", quality = 1, bound = true },
      [6] = { id = 106, name = "Quest Thing", quality = 4, bound = true },
      -- [7] is an empty slot
      [8] = { id = 108, name = "Odd Cloak", quality = 2, bound = false, tradeGoods = true },
    },
    [1] = {
      [1] = { id = 201, name = "Blade of Dusk", quality = 5, bound = true, trade = "1 |4hour:hrs;" },
      [2] = { id = 202, name = "Spare Helm", quality = 4, bound = false },
    },
  }
  local Bags = setup(bags)
  local rows, errors = Bags.scan()
  eq(errors, 0)
  local names = {}
  for i, row in ipairs(rows) do names[i] = row.itemId end
  -- trade times: 20 min (102), 60 min (201), 239 min (101); then unbound: Epic 202, Rare 103, Uncommon 108
  deep_eq(names, { 102, 201, 101, 202, 103, 108 })
  eq(rows[1].minutes, 20)
  eq(rows[1].bag, 0)
  eq(rows[1].slot, 2)
  eq(rows[1].bound, true)
  eq(rows[1].item, "item:102::::::::70")
  eq(rows[1].tradeLine, true)
  eq(rows[4].bound, false)
  eq(rows[4].tradeLine, nil)
  eq(rows[4].bag, 1)
  -- the lower bound can be moved
  local all = Bags.scan({ minQuality = 0 })
  eq(#all, 7) -- the Linen Scrap joins
end)

test("a slot that raises is counted and skipped, and the others still come", function()
  local bags = { [0] = {
    [1] = { id = 101, name = "Crown of the Fallen", quality = 4, bound = true, trade = "10 min" },
    [2] = { id = 102, name = "Broken", quality = 4, bound = false, raises = true },
    [3] = { id = 103, name = "Sturdy Boots", quality = 3, bound = false },
  } }
  local Bags = setup(bags)
  local rows, errors = Bags.scan()
  eq(errors, 1)
  eq(#rows, 2)
end)

test("no more than sixty rows are listed", function()
  local slots = {}
  for i = 1, 70 do slots[i] = { id = 1000 + i, name = "Thing " .. i, quality = 3, bound = false } end
  local Bags = setup({ [0] = slots }, 70)
  local rows = Bags.scan()
  eq(#rows, 60)
end)

test("a row is told with its place, quality and time", function()
  local bags = { [0] = {
    [1] = { id = 101, name = "Crown of the Fallen", quality = 4, bound = true, trade = "3 |4hour:hrs; 59 min" },
    [2] = { id = 103, name = "Sturdy Boots", quality = 3, bound = false },
  } }
  local Bags = setup(bags)
  local rows = Bags.scan()
  eq(Bags.describe(rows[1]), "bag 0 slot 1: " .. link(101, "Crown of the Fallen") .. " (Epic), 3 h 59 min left to trade")
  eq(Bags.describe(rows[2]), "bag 0 slot 2: " .. link(103, "Sturdy Boots") .. " (Rare), not bound")
  rows[1].minutes = nil
  eq(Bags.describe(rows[1]), "bag 0 slot 1: " .. link(101, "Crown of the Fallen") .. " (Epic), can be traded for a while")
end)

test("the reagent bag is scanned, a bag after it is not, and equal rows are ordered by bag and then slot", function()
  local bags = {
    [5] = { [1] = { id = 501, name = "Reagent Bag Boots", quality = 3, bound = false } },
    [6] = { [1] = { id = 601, name = "Not Scanned", quality = 4, bound = false } },
    [1] = { [2] = { id = 102, name = "B", quality = 3, bound = false }, [1] = { id = 101, name = "A", quality = 3, bound = false } },
    [0] = { [3] = { id = 3, name = "C", quality = 3, bound = false } },
  }
  local Bags = setup(bags)
  local rows = Bags.scan()
  local ids = {}
  for i, row in ipairs(rows) do ids[i] = row.itemId end
  deep_eq(ids, { 3, 101, 102, 501 }) -- bag 0, bag 1 slot 1, bag 1 slot 2, bag 5; bag 6 is never looked at
end)

test("two trade-time rows with the same time keep their bag order, and the default quality floor is Uncommon", function()
  local bags = { [0] = {
    [1] = { id = 11, name = "One", quality = 4, bound = true, trade = "30 min" },
    [2] = { id = 12, name = "Two", quality = 4, bound = true, trade = "30 min" },
    [3] = { id = 13, name = "Common Thing", quality = 1, bound = false },
    [4] = { id = 14, name = "Uncommon Thing", quality = 2, bound = false },
  } }
  local Bags = setup(bags)
  local rows = Bags.scan()
  local ids = {}
  for i, row in ipairs(rows) do ids[i] = row.itemId end
  deep_eq(ids, { 11, 12, 14 })
  eq(Bags.MIN_QUALITY, 2)
end)
