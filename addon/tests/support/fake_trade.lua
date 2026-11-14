-- A stand-in for the trade window and the bags, for tests on a stand-in game (tests/support/strict_ui.lua). It gives the game the
-- functions the trade code calls (C_Container.GetContainerNumSlots, GetContainerItemInfo and PickupContainerItem, GetCursorInfo,
-- ClearCursor, InitiateTrade, ClickTradeButton, GetTradePlayerItemLink, ERR_TRADE_COMPLETE) and plays what was seen in the game:
-- ClickTradeButton is a click on the trade slot, so with an item on the cursor it drops the item into an EMPTY slot, and on a slot that
-- holds an item it takes the item back onto the cursor (the loot owner's test, 2026-10-22).
--
--   local world = FakeTrade.install(game, { bags = { [0] = { [1] = { id = 401, name = "Crown", quality = 4 } } }, opens = "yes" })
--   world.slots, world.cursor, world.calls   -- what is in the trade window, on the cursor, and the calls made
--   world.openWindow() / world.accept() / world.cancel()     -- what the players do
--
-- world.partner is who the open window is with (default "Mirelle Dunmore"; options.partner), as UnitName("npc") tells while it is open;
-- options.partnerUnknown makes UnitName("npc") tell nothing.
--
-- options: bags (an entry may have locked = true: the bag slot reports isLocked; level = 80: another link level), opens ("yes" opens the window 0.3 s after
-- InitiateTrade, "sync" opens it during the call, "tooFar" answers with an error message, "never" does nothing), blocked
-- (InitiateTrade fires ADDON_ACTION_FORBIDDEN), raises (InitiateTrade raises this error), locked (picking up from a bag does
-- nothing), clickBlocked (ClickTradeButton fires ADDON_ACTION_BLOCKED), clickInert (it does nothing), showDelay (default 0.3).
--
-- world.accept({ silent = true }) is a trade that goes through without the message "Trade complete.": the items leave the bags;
-- noFlags = true leaves out the TRADE_ACCEPT_UPDATE events.

local FakeTrade = {}

function FakeTrade.link(id, name, level)
  return "|cffa335ee|Hitem:" .. id .. "::::::::" .. (level or 70) .. ":::::|h[" .. (name or ("Thing " .. id)) .. "]|h|r"
end

function FakeTrade.install(game, options)
  options = options or {}
  local env = game.env
  local world = {
    slots = {}, slotFrom = {}, cursor = nil, calls = {}, open = false, cleared = 0, bags = options.bags or {},
    partner = options.partner or "Mirelle Dunmore",
  }

  local function call(name, ...) world.calls[#world.calls + 1] = { name, ... } end

  env.ERR_TRADE_COMPLETE = "Trade complete."
  env.C_Container = env.C_Container or {}
  env.C_Container.GetContainerNumSlots = function(bag) return world.bags[bag] and 6 or 0 end
  env.C_Container.GetContainerItemInfo = function(bag, slot)
    local entry = world.bags[bag] and world.bags[bag][slot]
    if not entry then return nil end
    return { hyperlink = FakeTrade.link(entry.id, entry.name, entry.level), itemID = entry.id, quality = entry.quality or 4, isBound = true, isLocked = entry.locked }
  end
  env.C_Container.PickupContainerItem = function(bag, slot)
    call("pickup", bag, slot)
    local entry = world.bags[bag] and world.bags[bag][slot]
    if options.locked or not entry or world.cursor then return end
    world.cursor = { id = entry.id, link = FakeTrade.link(entry.id, entry.name, entry.level), from = { bag, slot } }
  end
  env.GetCursorInfo = function()
    if world.cursor then return "item", world.cursor.id, world.cursor.link end
  end
  env.ClearCursor = function()
    world.cleared = world.cleared + 1
    world.cursor = nil
  end
  env.GetTradePlayerItemLink = function(slot) return world.slots[slot] end
  env.UnitName = function(unit)
    if unit == "npc" and world.open and not options.partnerUnknown then return world.partner end
  end

  function world.openWindow()
    world.open = true
    game.send("TRADE_SHOW")
  end

  env.InitiateTrade = function(unit)
    call("initiate", unit)
    if options.raises then error(options.raises) end
    if options.blocked then
      game.send("ADDON_ACTION_FORBIDDEN", "IntrepidManager", "InitiateTrade()")
      return
    end
    if options.opens == "sync" then
      world.openWindow()
    elseif options.opens == "tooFar" then
      game.send("UI_ERROR_MESSAGE", 50, "Target is too far away.")
    elseif options.opens ~= "never" then
      env.C_Timer.After(options.showDelay or 0.3, world.openWindow)
    end
  end

  env.ClickTradeButton = function(slot)
    call("click", slot)
    if options.clickBlocked then
      game.send("ADDON_ACTION_BLOCKED", "IntrepidManager", "ClickTradeButton()")
      return
    end
    if options.clickInert or not world.open then return end
    if world.cursor and not world.slots[slot] then
      world.slots[slot] = world.cursor.link
      world.slotFrom[slot] = world.cursor.from
      world.cursor = nil
      game.send("TRADE_PLAYER_ITEM_CHANGED", slot)
    elseif world.slots[slot] and not world.cursor then
      local link = world.slots[slot]
      world.cursor = { id = tonumber(string.match(link, "item:(%d+)")), link = link, from = world.slotFrom[slot] }
      world.slots[slot] = nil
      world.slotFrom[slot] = nil
      game.send("TRADE_PLAYER_ITEM_CHANGED", slot)
    end
  end

  -- Both players press Trade: the items leave the bags, the message comes (unless silent), the window closes (it sends TRADE_CLOSED
  -- twice, as the game did).
  function world.accept(how)
    how = how or {}
    if not how.noFlags then
      game.send("TRADE_ACCEPT_UPDATE", 1, 0)
      game.send("TRADE_ACCEPT_UPDATE", 1, 1)
    end
    for slot, from in pairs(world.slotFrom) do
      if world.slots[slot] and from and world.bags[from[1]] then world.bags[from[1]][from[2]] = nil end
    end
    world.slots, world.slotFrom = {}, {}
    world.open = false
    if not how.silent then game.send("UI_INFO_MESSAGE", 251, "Trade complete.") end
    game.send("TRADE_CLOSED")
    game.send("TRADE_CLOSED")
  end

  function world.cancel()
    world.slots, world.slotFrom = {}, {}
    world.open = false
    game.send("TRADE_CLOSED")
  end

  return world
end

return FakeTrade
