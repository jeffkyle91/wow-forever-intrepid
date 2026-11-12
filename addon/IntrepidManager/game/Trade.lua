-- Intrepid Manager: giving items by trade. The loot master's addon opens the trade window with a player (when it is not open yet),
-- puts the items (up to six) into the first free slots and says so; the loot master and the player press Trade themselves, the addon
-- never accepts. The caller says which items: the ones the loot master awarded to that player.
-- What the game does at each step is kept in IntrepidManagerDB.tradetest as shapes only (steps with their answer, the events seen and
-- when, the item id; no names), because nobody has seen yet which of these calls an addon may make: a step that is refused ends the
-- run with the reason and leaves the rest to the player.
--
-- The sequence (and the thing learned on 2026-10-22: ClickTradeButton is a click on the slot, so on a slot that holds an item it takes
-- the item back onto the cursor): open the window, clear the cursor, pick the item up from the bag, click an EMPTY slot, read the slot
-- to check, and the next one a moment later. A trade is complete when the game says so ("Trade complete.", seen in the beta on
-- 2026-10-22) or, if it says nothing we know, when the items have left the bags; the items that left are those that were in the window
-- at the last accept. What the game said is kept (with the name of the other player masked).
--
--   local trade = ns.Game.Trade.new({ out = print, db = IntrepidManagerDB })
--   trade.listen()                               -- at load: events, so that an open window is known
--   trade.give({ "item:12345::::::::70", "item:777" }, { unit = "party2", label = "Mirelle Dunmore",
--     onResult = function(result, count) end, onCompleted = function(givenItems) end })      -- (one item string works too)
--   trade.locate("item:12345::::::::70")         -- bag, slot of the item in the bags, or nil

local _, ns = ...

local Trade = {}
ns.Game = ns.Game or {}
ns.Game.Trade = Trade

local WAIT_SHOW = 3 -- seconds the game gets to open the window
local SETTLE = 0.2 -- seconds after the window shows before the item goes in
local WAIT_PLACED = 0.6 -- seconds after the click before the slot is read
local STAGGER = 0.1 -- seconds between one item and the next (RCLootCouncil leaves the same: they cannot all go in at once)
local WAIT_CLOSED = 1 -- seconds after the window closes for a late "Trade complete."
local MAX_RECORDS = 60
local MAX_EVENTS = 14
local MAX_MESSAGES = 6 -- texts of UI_INFO_MESSAGE kept per run
local FIRST_SLOT, LAST_SLOT = 1, 6 -- the player's own trade slots
local MAX_ITEMS = LAST_SLOT - FIRST_SLOT + 1
local LAST_BAG = 5

local EVENTS = {
  "TRADE_SHOW", "TRADE_CLOSED", "TRADE_PLAYER_ITEM_CHANGED", "TRADE_ACCEPT_UPDATE", "UI_ERROR_MESSAGE", "UI_INFO_MESSAGE",
  "ADDON_ACTION_FORBIDDEN", "ADDON_ACTION_BLOCKED",
}

local function round(value) return math.floor(value * 100 + 0.5) / 100 end

function Trade.new(context)
  local out = context.out or print
  local db = context.db or {}
  local self = {}

  local frame
  local open = false -- the trade window is open (TRADE_SHOW seen, TRADE_CLOSED not yet)
  local ownWindow -- who this addon opened the open window for (the label given), or nil
  local run -- the give in progress

  local function say(text) out("Trade: " .. text) end

  local function store()
    if not db.tradetest then db.tradetest = { schema = 1, runs = {} } end
    return db.tradetest
  end

  local function itemKey(link)
    if type(link) ~= "string" then return nil end
    return ns.Net.CouncilWire.itemString(link)
  end

  -- A player's name for comparing: without a realm, ignoring case and extra spaces.
  local function nameKey(name)
    if type(name) ~= "string" then return nil end
    return ns.Names.key(string.match(name, "^([^%-]*)"))
  end

  -- Is the open window with this player? Yes when this addon opened it for them, or when the game says that "npc" (the other party
  -- of a trade) is them. A window that cannot be placed is never used: the items would go to the wrong player.
  local function windowIsWith(label)
    local wanted = nameKey(label)
    if not wanted or wanted == "" then return false end
    if ownWindow and nameKey(ownWindow) == wanted then return true end
    local ok, name = pcall(UnitName, "npc")
    return ok and nameKey(name) == wanted
  end

  -- The bag and slot of the first item in the bags with this item string (or else the same item id), or nil; and the third value is
  -- how many bag slots hold this item id. `used` (optional) is a set of "bag:slot" that are taken already by an earlier item.
  function self.locate(item, used)
    local wanted = ns.Council.itemId(item)
    local exact, fallback
    local holding = 0
    for bag = 0, LAST_BAG do
      local okCount, total = pcall(C_Container.GetContainerNumSlots, bag)
      if okCount and type(total) == "number" then
        for slot = 1, total do
          local ok, info = pcall(C_Container.GetContainerItemInfo, bag, slot)
          if ok and type(info) == "table" and info.hyperlink then
            local key = itemKey(info.hyperlink)
            if key and ns.Council.itemId(key) == wanted then
              holding = holding + 1
              if not (used and used[bag .. ":" .. slot]) then
                if key == item then exact = exact or { bag, slot } end
                fallback = fallback or { bag, slot }
              end
            end
          end
        end
      end
    end
    local found = exact or fallback
    if found then return found[1], found[2], holding end
  end

  local function step(name, ok, detail)
    if not run then return end
    run.record.steps[#run.record.steps + 1] = { s = name, ok = ok and true or false, d = detail, after = round(GetTime() - run.started) }
  end

  local function mark(event, detail)
    if not run or #run.record.events >= MAX_EVENTS then return end
    run.record.events[#run.record.events + 1] = { e = event, after = round(GetTime() - run.started), d = detail }
  end

  -- A game message for the record with the name of the other player left out (the whole name, and each word of it).
  local function masked(text, label)
    text = string.sub(tostring(text), 1, 60)
    if type(label) == "string" and label ~= "" then
      local function plain(word) return (string.gsub(word, "%W", "%%%0")) end
      text = string.gsub(text, plain(label), "<name>")
      for word in string.gmatch(label, "%S+") do
        if #word >= 3 then text = string.gsub(text, plain(word), "<name>") end
      end
    end
    return text
  end

  local function sameKey(key, item)
    return key == item or ns.Council.itemId(key) == ns.Council.itemId(item)
  end

  -- What is in the player's trade slots now: a list of item strings.
  local function windowItems()
    local list = {}
    for slot = FIRST_SLOT, LAST_SLOT do
      local ok, link = pcall(GetTradePlayerItemLink, slot)
      local key = ok and itemKey(link) or nil
      if key then list[#list + 1] = key end
    end
    return list
  end

  -- Remember what is in the window (once the window closes its slots are empty again). Taken at every change and every accept.
  local function snapshot()
    if run and #run.placedList > 0 then run.inWindow = windowItems() end
  end

  -- The requested items that left with the trade: those that were placed and were still in the window at the last accept (all the
  -- placed ones when no accept was seen). A list of item strings as they were asked for.
  local function givenItems(current)
    local pool = {}
    for _, key in ipairs(current.inWindow or {}) do pool[#pool + 1] = key end
    local given = {}
    for _, entry in ipairs(current.placedList) do
      if not current.inWindow then
        given[#given + 1] = entry.item
      else
        for i, key in ipairs(pool) do
          if sameKey(key, entry.item) then
            table.remove(pool, i)
            given[#given + 1] = entry.item
            break
          end
        end
      end
    end
    return given
  end

  -- The placed items that left the bags (fewer bag slots hold their id than before the run), as item strings.
  local function leftItems(current)
    local now, taken, list = {}, {}, {}
    for _, entry in ipairs(current.placedList) do
      local id = ns.Council.itemId(entry.item)
      if now[id] == nil then
        local _, _, holding = self.locate(entry.item)
        now[id] = holding or 0
      end
      taken[id] = (taken[id] or 0) + 1
      if taken[id] <= (current.before[id] or 0) - now[id] then list[#list + 1] = entry.item end
    end
    return list
  end

  -- The trade went through (the game said so, or the items left the bags): tell whoever waits for it, once, with the items given.
  local function markCompleted(current, how, given)
    current.completed = true
    current.record.completedBy = how
    given = given or givenItems(current)
    current.record.givenCount = #given
    local callback = current.onCompleted
    current.onCompleted = nil
    if callback then callback(given) end
  end

  -- End the run with a result word and the sentence for the chat.
  local function finish(current, result, words)
    if run ~= current then return end
    run = nil
    current.record.result = result
    local saved = store()
    if #saved.runs < MAX_RECORDS then saved.runs[#saved.runs + 1] = current.record end
    say(words)
    if current.onResult then current.onResult(result) end
  end

  local function firstEmptySlot()
    for slot = FIRST_SLOT, LAST_SLOT do
      local ok, link = pcall(GetTradePlayerItemLink, slot)
      if ok and not link then return slot end
    end
  end

  local function sameItem(link, item)
    local key = itemKey(link)
    return key ~= nil and (key == item or ns.Council.itemId(key) == ns.Council.itemId(item))
  end

  -- Say that the items are in the window, and tell whoever asked.
  local function reportPlaced(current)
    local n = #current.placedList
    local words = n == 1 and "the item: it is" or (n .. " items: they are")
    say(tostring(current.label or "the player") .. " can have " .. words .. " in the trade window. Press Trade, and the other player accepts.")
    current.record.placedCount = n
    local callback = current.onResult
    current.onResult = nil
    if callback then callback(current.partial and "partial" or "placed", n) end
  end

  -- An item could not be added. With nothing in the window yet the run ends; with some items in, they stay and the rest is told.
  local function failed(current, result, words)
    if #current.placedList == 0 then return finish(current, result, words) end
    current.partial = result
    current.record.partial = result
    say(words)
    reportPlaced(current)
  end

  -- The next item goes in: pick it up from its bag slot, click an empty trade slot, read the slot; then the one after it.
  local function place(current)
    if run ~= current or current.closing then return end
    current.waiting = nil
    local entry = current.entries[current.index]
    local slot = firstEmptySlot()
    if not slot then return failed(current, "no free slot", "all six trade slots are taken. Make room, then try again.") end
    -- The item may have moved since it was found.
    local ok, info = pcall(C_Container.GetContainerItemInfo, entry.bag, entry.slot)
    if not (ok and type(info) == "table" and sameItem(info.hyperlink, entry.item)) then
      local bag, bagSlot = self.locate(entry.item, current.used)
      if not bag then return failed(current, "item gone", "the item is no longer in your bags.") end
      entry.bag, entry.slot = bag, bagSlot
      current.used[bag .. ":" .. bagSlot] = true
      ok, info = pcall(C_Container.GetContainerItemInfo, bag, bagSlot)
    end
    if ok and type(info) == "table" and info.isLocked then
      step("locked", false, nil)
      return failed(current, "locked", "the item is locked (it may be in another trade or being moved). Try again in a moment.")
    end
    pcall(ClearCursor) -- (something else on the cursor would be dropped into the trade)
    local picked, problem = pcall(C_Container.PickupContainerItem, entry.bag, entry.slot)
    step("pickup", picked, picked and nil or string.sub(tostring(problem), 1, 60))
    local cursor = GetCursorInfo()
    step("cursor", cursor == "item", cursor)
    if not picked or cursor ~= "item" then
      pcall(ClearCursor)
      return failed(current, "not picked up", "the item did not come up from the bag (it may be locked or the call was refused).")
    end
    local clicked, why = pcall(ClickTradeButton, slot)
    step("click", clicked, clicked and nil or string.sub(tostring(why), 1, 60))
    if current.blocked then
      pcall(ClearCursor)
      return failed(current, "blocked", "the game blocked the click on the trade slot (" .. tostring(current.blocked) .. ").")
    end
    C_Timer.After(WAIT_PLACED, function()
      if run ~= current then return end
      local linked, link = pcall(GetTradePlayerItemLink, slot)
      local placed = linked and link ~= nil and sameItem(link, entry.item)
      step("placed", placed, slot)
      if GetCursorInfo() then pcall(ClearCursor) end
      if not placed then
        return failed(current, "slot empty", "the click did not put the item in the trade slot.")
      end
      current.placedList[#current.placedList + 1] = entry
      current.placed = true
      if current.index < #current.entries then
        current.index = current.index + 1
        C_Timer.After(STAGGER, function() place(current) end)
      else
        reportPlaced(current)
        -- The run stays open until the window closes, to see whether the trade went through.
      end
    end)
  end

  -- The window is open (it was, or it just opened): wait a moment for it to settle, then place the item.
  local function windowReady(current)
    step("window", true, nil)
    C_Timer.After(SETTLE, function() place(current) end)
  end

  local function onEvent(event, ...)
    if event == "TRADE_SHOW" then
      open = true
      mark(event)
      if run and run.waiting == "show" then
        run.waiting = nil
        ownWindow = run.label
        windowReady(run)
      end
    elseif event == "TRADE_CLOSED" then
      open = false
      ownWindow = nil
      mark(event)
      local current = run
      if current and current.placed and not current.closing then
        current.closing = true
        C_Timer.After(WAIT_CLOSED, function()
          if run ~= current then return end
          if not current.completed then
            local left = leftItems(current)
            if #left > 0 then markCompleted(current, "bags", left) end
          end
          if current.completed then
            finish(current, "completed", "trade complete.")
          else
            finish(current, "cancelled", "the trade window closed without a completed trade.")
          end
        end)
      elseif current and current.waiting == "show" then
        mark("closed while opening")
      end
    elseif event == "UI_INFO_MESSAGE" then
      local _, text = ...
      if run and text ~= nil then
        local messages = run.record.messages
        if not messages then
          messages = {}
          run.record.messages = messages
        end
        if #messages < MAX_MESSAGES then messages[#messages + 1] = { text = masked(text, run.label), after = round(GetTime() - run.started) } end
        if text == ERR_TRADE_COMPLETE then
          mark(event, "complete")
          markCompleted(run, "message")
        end
      end
    elseif event == "UI_ERROR_MESSAGE" then
      local _, text = ...
      if run then
        run.lastError = type(text) == "string" and string.sub(text, 1, 60) or nil
        mark(event, run.lastError)
      end
    elseif event == "ADDON_ACTION_FORBIDDEN" or event == "ADDON_ACTION_BLOCKED" then
      if run then
        run.blocked = event
        mark(event)
      end
    elseif event == "TRADE_ACCEPT_UPDATE" then
      local player, target = ...
      mark(event, tostring(player) .. "," .. tostring(target)) -- who has pressed Trade (the player's and the other's)
      snapshot()
    else
      mark(event) -- TRADE_PLAYER_ITEM_CHANGED
      snapshot()
    end
  end

  function self.listen()
    if frame then return end
    frame = CreateFrame("Frame")
    for _, event in ipairs(EVENTS) do pcall(frame.RegisterEvent, frame, event) end
    frame:SetScript("OnEvent", function(_, event, ...)
      -- Never let an error here reach the player mid-raid: keep it in the record.
      local ok, problem = pcall(onEvent, event, ...)
      if not ok then
        local saved = store()
        saved.errorCount = (saved.errorCount or 0) + 1
        saved.lastError = string.sub(tostring(problem), 1, 120)
      end
    end)
  end

  -- Give items: an item string or a list of them (six at most go into one window). options.unit (a unit token: "target", "party2",
  -- "raid7"), options.label (who, for the chat), options.onResult(result, count) (called with "placed" when the items are in the
  -- window, "partial" when only some are, or with the reason none is), options.onCompleted(given) when the trade went through, with
  -- the list of the item strings that left. Returns true when it started.
  function self.give(items, options)
    options = options or {}
    if type(items) == "string" then items = { items } end
    items = items or {}
    self.listen()
    if open and not windowIsWith(options.label) then
      say("a trade window is open, and it is not clear that it is with " .. tostring(options.label or "that player") .. ". Close it, then try again.")
      return false
    end
    if run and run.placed then finish(run, "left open", "the earlier item is still in the open window.") end
    if run then
      say("still busy with the last one.")
      return false
    end
    local entries, used, before, missing = {}, {}, {}, 0
    for _, item in ipairs(items) do
      if #entries >= MAX_ITEMS then break end
      local bag, slot, holding = self.locate(item, used)
      if bag then
        used[bag .. ":" .. slot] = true
        local id = ns.Council.itemId(item)
        if before[id] == nil then before[id] = holding end
        entries[#entries + 1] = { item = item, bag = bag, slot = slot }
      else
        missing = missing + 1
      end
    end
    if #entries == 0 then
      say(#items <= 1 and "that item is not in your bags." or "none of those items is in your bags.")
      return false
    end
    if missing == 1 then
      say("one of the items is not in your bags and is left out.")
    elseif missing > 1 then
      say(missing .. " of the items are not in your bags and are left out.")
    end
    local waiting = #items - missing - #entries
    if waiting > 0 then say("only six items fit in one trade: " .. waiting .. " more wait for the next one.") end
    local record = { at = round(GetTime()), item = ns.Council.itemId(entries[1].item), count = #entries, steps = {}, events = {}, windowWasOpen = open }
    run = {
      entries = entries, index = 1, placedList = {}, used = used, before = before, record = record, started = GetTime(),
      label = options.label, onResult = options.onResult, onCompleted = options.onCompleted,
    }
    local current = run
    step("locate", true, nil)
    if open then
      windowReady(current)
      return true
    end
    local ok, problem = pcall(InitiateTrade, options.unit or "target")
    step("initiate", ok, ok and nil or string.sub(tostring(problem), 1, 60))
    if not ok then
      finish(current, "raised", "the game would not open a trade: " .. string.sub(tostring(problem), 1, 60))
      return false
    end
    if current.blocked then
      finish(current, "blocked", "the game blocked opening the trade (" .. tostring(current.blocked) .. "). Open it yourself and drag the item.")
      return false
    end
    if open then -- (the window came up while the call was still running)
      ownWindow = current.label
      windowReady(current)
      return true
    end
    current.waiting = "show"
    C_Timer.After(WAIT_SHOW, function()
      if run == current and current.waiting == "show" then
        local why = current.lastError and (" The game said: " .. current.lastError) or ""
        finish(current, "no window", "the trade window did not open." .. why)
      end
    end)
    return true
  end

  function self.stop()
    if not run then
      say("nothing is running.")
      return
    end
    finish(run, "stopped", "stopped.")
  end

  function self.isOpen() return open end
  function self.running() return run ~= nil end
  self.frame = function() return frame end
  return self
end
