-- Intrepid Manager: /im loot. A first slice of the loot window code: it reads the master loot window, finds a candidate by number or
-- by name, gives a slot with GiveMasterLoot and watches what the game answers, and it can sweep every item up to a quality (the
-- grays, by default) to one player, one item at a time. It is for the test builds; the session window is not wired to it yet.
-- Everything it did is kept in IntrepidManagerDB.loottest as shapes only (item ids, qualities, slot and candidate numbers, the
-- events seen and when): no player names. A name typed or printed in the chat is not saved.
--
--   local loot = ns.Game.LootWindow.new({ out = print, db = IntrepidManagerDB })
--   loot.command("")                -- list the slots of the open loot window and who can get them
--   loot.command("give 3 other")    -- give slot 3 to the other player (a number, a name, "me" or "other")
--   loot.command("sweep other")     -- give every Poor item to the other player, one at a time
--   loot.command("sweep other uncommon")   -- every item up to Uncommon
--   loot.command("stop")
--
-- What the game does (probe 0.6.2, 2026-10-20): GiveMasterLoot(slot, candidate) clears the slot within 0.1 to 0.2 seconds
-- (LOOT_SLOT_CLEARED); when the receiver's bags are full the loot master's client hears nothing at all (the error shows on the
-- receiver's client only), so "no answer" is the only sign. Candidate numbers differ from group to group: always look them up.

local _, ns = ...

local LootWindow = {}
ns.Game = ns.Game or {}
ns.Game.LootWindow = LootWindow

local ITEM = 1 -- GetLootSlotType: an item (2 is money, 3 a currency)
local MAX_CANDIDATES = 40
local WAIT = 2.5 -- seconds the game gets to clear a slot after the call
local GAP = 0.3 -- seconds between two gives of a sweep
local MAX_RECORDS = 500
local MAX_EVENTS = 12
local MAX_SEEN = 200

LootWindow.QUALITY_WORDS = {
  poor = 0, gray = 0, grey = 0, common = 1, white = 1, uncommon = 2, green = 2, rare = 3, blue = 3, epic = 4, purple = 4,
}
local QUALITY_NAMES = { [0] = "Poor", [1] = "Common", [2] = "Uncommon", [3] = "Rare", [4] = "Epic", [5] = "Legendary" }

-- A name made comparable: no spaces at the ends, one space between words, lower case.
local function comparable(text)
  text = string.gsub(tostring(text), "^%s+", "")
  text = string.gsub(text, "%s+$", "")
  text = string.gsub(text, "%s+", " ")
  return string.lower(text)
end
LootWindow.comparable = comparable

local function qualityName(quality)
  return QUALITY_NAMES[quality] or ("quality " .. tostring(quality))
end

local function round(value) return math.floor(value * 100 + 0.5) / 100 end

function LootWindow.new(context)
  local out = context.out or print
  local db = context.db or {}
  local self = {}

  local frame
  local attempt -- the give in flight: { slot, index, record, started, token, onResult }
  local sweeping -- the sweep in progress: { cancelled }
  local tokens = 0

  local function say(text) out("Loot: " .. text) end

  local function store()
    if not db.loottest then db.loottest = { schema = 1, gives = {}, sweeps = {}, seen = {} } end
    db.loottest.seen = db.loottest.seen or {}
    return db.loottest
  end

  local function keep(list, record)
    if #list < MAX_RECORDS then list[#list + 1] = record end
  end

  ---------------------------------------------------------------------------------------------------------------
  -- Reading the window
  ---------------------------------------------------------------------------------------------------------------

  -- The master loot candidates of a slot in the game's own numbering: { { index = 1, name = "First Surname" }, ... }.
  local function candidatesOf(slot)
    local list = {}
    for index = 1, MAX_CANDIDATES do
      local name = GetMasterLootCandidate(slot, index)
      if name then list[#list + 1] = { index = index, name = name } end
    end
    return list
  end

  -- The item slots of the open loot window: { { slot, link, name, quantity, quality, itemId, candidates }, ... }.
  function self.snapshot()
    local count = GetNumLootItems() or 0
    local slots = {}
    for slot = 1, count do
      if GetLootSlotType(slot) == ITEM then
        local _, name, quantity, _, quality = GetLootSlotInfo(slot)
        local link = GetLootSlotLink(slot)
        slots[#slots + 1] = {
          slot = slot, link = link, name = name, quantity = quantity, quality = quality,
          itemId = tonumber(string.match(link or "", "item:(%d+)")), candidates = candidatesOf(slot),
        }
      end
    end
    return { count = count, slots = slots }
  end

  local function myFirstName()
    local name = UnitName("player")
    return name and comparable(name) or nil
  end

  -- Is this candidate me? Names are "First Surname"; UnitName gives the first word.
  local function isMe(candidate, first)
    if not first then return false end
    local name = comparable(candidate.name)
    return name == first or string.sub(name, 1, #first + 1) == first .. " "
  end

  -- The candidate of a list that `what` names: a number from the list, "me", "other", or a name (the whole name, or the start
  -- of it when only one candidate fits). Returns the candidate and how it was named ("number", "me", "other", "name"), or nil and why.
  local function resolve(list, what)
    what = comparable(what or "")
    if what == "" then return nil, "Say who gets it: a number from the list, a name, or the word me or other." end
    if #list == 0 then return nil, "Nobody can be given this: you are not the master looter here, or nobody is in range." end
    if string.find(what, "^%d+$") then
      local number = tonumber(what)
      for _, candidate in ipairs(list) do
        if candidate.index == number then return candidate, "number" end
      end
      return nil, "There is no candidate number " .. what .. ". Type /im loot to see the list."
    end
    local first = myFirstName()
    if what == "me" or what == "self" or what == "myself" then
      local found
      for _, candidate in ipairs(list) do
        if isMe(candidate, first) then
          if found then return nil, "More than one candidate starts like your name. Use a number." end
          found = candidate
        end
      end
      if not found then return nil, "You are not on the candidate list." end
      return found, "me"
    end
    if what == "other" then
      local found
      for _, candidate in ipairs(list) do
        if not isMe(candidate, first) then
          if found then return nil, "There is more than one other player. Use a number or a name." end
          found = candidate
        end
      end
      if not found then return nil, "There is no other player on the candidate list." end
      return found, "other"
    end
    for _, candidate in ipairs(list) do
      if comparable(candidate.name) == what then return candidate, "name" end
    end
    local found
    for _, candidate in ipairs(list) do
      local name = comparable(candidate.name)
      if string.sub(name, 1, #what) == what then
        if found then return nil, "More than one candidate starts with '" .. what .. "'. Type more of the name, or a number." end
        found = candidate
      end
    end
    if found then return found, "name" end
    return nil, "No candidate is called '" .. what .. "'. Type /im loot to see the list."
  end

  ---------------------------------------------------------------------------------------------------------------
  -- Giving one slot and watching what the game answers
  ---------------------------------------------------------------------------------------------------------------

  local function lootMethod()
    local ok, method = pcall(C_PartyInfo.GetLootMethod)
    if ok and method ~= nil then return tostring(method) end
  end

  local function finishAttempt(current, result)
    if attempt ~= current then return end
    attempt = nil
    current.record.result = result
    current.record.seconds = round(GetTime() - current.started)
    keep(store().gives, current.record)
    current.onResult(result, current.record)
  end

  -- The game's own loot lines, as shapes: who got what (me or somebody else, by loot or as an item), when. No names, no text. Both the
  -- loot master and the receiver keep them, so a missing "You receive loot" on one side shows in the file.
  local function onLootLine(text)
    if type(text) ~= "string" then return end
    local who, via
    if string.find(text, "^You receive loot") then who, via = "self", "loot"
    elseif string.find(text, "^You receive item") then who, via = "self", "item"
    elseif string.find(text, " receives loot", 1, true) then who, via = "other", "loot"
    elseif string.find(text, " receives item", 1, true) then who, via = "other", "item"
    else return end
    local list = store().seen
    if #list >= MAX_SEEN then return end
    list[#list + 1] = { t = round(GetTime()), who = who, via = via, itemId = tonumber(string.match(text, "|Hitem:(%d+)")) }
  end

  local function onEvent(event, ...)
    if event == "CHAT_MSG_LOOT" then return onLootLine(...) end
    local current = attempt
    if not current then return end
    local row = { e = event, after = round(GetTime() - current.started) }
    if event == "LOOT_SLOT_CLEARED" then
      row.slot = ...
    elseif event == "UI_ERROR_MESSAGE" then
      local _, message = ...
      row.text = type(message) == "string" and string.sub(message, 1, 60) or nil
    end
    if #current.record.events < MAX_EVENTS then current.record.events[#current.record.events + 1] = row end
    if event == "LOOT_SLOT_CLEARED" and row.slot == current.slot then
      finishAttempt(current, "cleared")
    elseif event == "LOOT_CLOSED" then
      finishAttempt(current, "window closed")
    end
  end

  local function listen()
    if frame then return end
    frame = CreateFrame("Frame")
    frame:RegisterEvent("LOOT_SLOT_CLEARED")
    frame:RegisterEvent("LOOT_CLOSED")
    frame:RegisterEvent("UI_ERROR_MESSAGE")
    frame:RegisterEvent("CHAT_MSG_LOOT")
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

  -- Calls GiveMasterLoot for one slot and tells onResult(result, record) what came of it. result: "cleared" (the slot emptied, so
  -- the item was given), "no answer" (nothing in WAIT seconds), "window closed", or "error: ..." (the call raised an error).
  local function giveSlot(slotInfo, candidate, kind, onResult)
    listen()
    tokens = tokens + 1
    local record = {
      slot = slotInfo.slot, itemId = slotInfo.itemId, quality = slotInfo.quality, candidate = candidate.index, who = kind,
      method = lootMethod(), threshold = GetLootThreshold(), members = GetNumGroupMembers(), events = {},
    }
    local current = { slot = slotInfo.slot, token = tokens, record = record, started = GetTime(), onResult = onResult }
    attempt = current
    local ok, problem = pcall(GiveMasterLoot, slotInfo.slot, candidate.index)
    if not ok then
      return finishAttempt(current, "error: " .. string.sub(tostring(problem), 1, 80))
    end
    C_Timer.After(WAIT, function()
      if attempt == current then finishAttempt(current, "no answer") end
    end)
  end

  local function resultText(result)
    if result == "cleared" then return "given" end
    if result == "no answer" then
      return "not given: the game said nothing for " .. WAIT .. " seconds (a full bag on their side is the usual reason; only they see the message)"
    end
    if result == "window closed" then return "not given: the loot window closed" end
    return "not given: " .. result
  end

  ---------------------------------------------------------------------------------------------------------------
  -- Commands
  ---------------------------------------------------------------------------------------------------------------

  local function busy()
    if attempt or sweeping then
      say("still working on the last one. Type /im loot stop to end a sweep.")
      return true
    end
    return false
  end

  local function noWindow()
    say("there is no loot window open. Open a corpse first.")
  end

  function self.list()
    local snap = self.snapshot()
    if snap.count == 0 then return noWindow() end
    if #snap.slots == 0 then
      say("the window has no items, only money.")
      return
    end
    -- Candidates are usually the same for every slot: print them once then.
    local same = true
    local function names(slotInfo)
      local parts = {}
      for _, candidate in ipairs(slotInfo.candidates) do parts[#parts + 1] = candidate.index .. " " .. candidate.name end
      return table.concat(parts, ", ")
    end
    local shared = names(snap.slots[1])
    for _, slotInfo in ipairs(snap.slots) do
      if names(slotInfo) ~= shared then same = false end
    end
    for _, slotInfo in ipairs(snap.slots) do
      local line = "slot " .. slotInfo.slot .. ": " .. tostring(slotInfo.link or slotInfo.name) .. (slotInfo.quantity and slotInfo.quantity > 1 and (" x" .. slotInfo.quantity) or "")
        .. " (" .. qualityName(slotInfo.quality) .. ")"
      if not same then line = line .. ", candidates: " .. (names(slotInfo) ~= "" and names(slotInfo) or "none") end
      say(line)
    end
    if same then
      say("candidates, for every slot: " .. (shared ~= "" and shared or "none (you are not the master looter here, or nobody is in range)"))
    end
    say("give one with /im loot give <slot> <number, name, me or other>; every Poor item with /im loot sweep <who>.")
  end

  function self.give(slot, what)
    if busy() then return end
    local snap = self.snapshot()
    if snap.count == 0 then return noWindow() end
    local info
    for _, slotInfo in ipairs(snap.slots) do
      if slotInfo.slot == slot then info = slotInfo end
    end
    if not info then
      say("slot " .. tostring(slot) .. " has no item. Type /im loot to see the slots.")
      return
    end
    local candidate, kind = resolve(info.candidates, what)
    if not candidate then return say(kind) end
    say("giving slot " .. slot .. " (" .. tostring(info.link or info.name) .. ") to " .. candidate.name .. "...")
    giveSlot(info, candidate, kind, function(result)
      say("slot " .. slot .. ": " .. resultText(result) .. ". Type /reload to save the record.")
    end)
  end

  -- Gives every item of the open window up to maxQuality (inclusive) to one player, one at a time. The player is found by name in
  -- each slot's own list. It stops at the first item that is not given: the same full bag would stop every one after it.
  function self.sweep(what, maxQuality)
    if busy() then return end
    local snap = self.snapshot()
    if snap.count == 0 then return noWindow() end
    local plan = {}
    for _, slotInfo in ipairs(snap.slots) do
      if slotInfo.quality and slotInfo.quality <= maxQuality then plan[#plan + 1] = slotInfo end
    end
    if #plan == 0 then
      say("nothing of quality " .. qualityName(maxQuality) .. " or lower in the window.")
      return
    end
    local candidate, kind = resolve(plan[1].candidates, what)
    if not candidate then return say(kind) end
    local wanted = comparable(candidate.name)
    local current = { cancelled = false }
    sweeping = current
    local record = { maxQuality = maxQuality, planned = #plan, given = 0, who = kind, items = {} }
    keep(store().sweeps, record)
    say("giving " .. #plan .. (#plan == 1 and " item" or " items") .. " of quality " .. qualityName(maxQuality) .. " or lower to " .. candidate.name .. "...")

    local function finish(why)
      if sweeping ~= current then return end
      sweeping = nil
      record.stopped = why
      if why then
        say("stopped after " .. record.given .. " of " .. #plan .. ": " .. why .. ". Type /reload to save the record.")
      else
        say("done: " .. record.given .. " of " .. #plan .. " given. Type /reload to save the record.")
      end
    end

    local function step(index)
      if sweeping ~= current then return end
      if current.cancelled then return finish("you stopped it") end
      local item = plan[index]
      if not item then return finish(nil) end -- (the game closes the window by itself with the last item: that is done, not stopped)
      if (GetNumLootItems() or 0) == 0 then return finish("the loot window closed") end
      -- The slot must still hold what the plan saw, and the player must still be on its list.
      if GetLootSlotLink(item.slot) ~= item.link or GetLootSlotType(item.slot) ~= ITEM then
        record.items[#record.items + 1] = { slot = item.slot, itemId = item.itemId, quality = item.quality, result = "slot changed" }
        return step(index + 1)
      end
      local target
      for _, entry in ipairs(candidatesOf(item.slot)) do
        if comparable(entry.name) == wanted then target = entry end
      end
      if not target then return finish("that player is no longer on the list for slot " .. item.slot) end
      giveSlot(item, target, kind, function(result, given)
        record.items[#record.items + 1] = { slot = item.slot, itemId = item.itemId, quality = item.quality, result = result, seconds = given.seconds }
        if result ~= "cleared" then
          say("slot " .. item.slot .. " (" .. tostring(item.link or item.name) .. "): " .. resultText(result))
          return finish(result == "window closed" and "the loot window closed" or ("slot " .. item.slot .. " was not given"))
        end
        record.given = record.given + 1
        say("slot " .. item.slot .. " (" .. tostring(item.link or item.name) .. "): given (" .. record.given .. " of " .. #plan .. ")")
        C_Timer.After(GAP, function() step(index + 1) end)
      end)
    end
    step(1)
  end

  function self.stop()
    if sweeping then
      sweeping.cancelled = true
      say("stopping after the item in flight.")
    elseif attempt then
      say("one give is in flight; it ends by itself in a moment.")
    else
      say("nothing is running.")
    end
  end

  -- What follows /im loot.
  function self.command(argument)
    argument = string.gsub(argument or "", "^%s+", "")
    argument = string.gsub(argument, "%s+$", "")
    local word, rest = string.match(argument, "^(%S*)%s*(.-)$")
    word = string.lower(word or "")
    if word == "" or word == "list" then
      self.list()
    elseif word == "give" then
      local slot, what = string.match(rest, "^(%d+)%s+(.+)$")
      if not slot then
        say("use /im loot give <slot> <number, name, me or other>. Type /im loot to see the slots.")
        return
      end
      self.give(tonumber(slot), what)
    elseif word == "sweep" then
      local maxQuality = 0
      local who = rest
      local last = string.match(rest, "(%S+)$")
      if last and LootWindow.QUALITY_WORDS[string.lower(last)] then
        maxQuality = LootWindow.QUALITY_WORDS[string.lower(last)]
        who = string.gsub(rest, "%s*%S+$", "")
      end
      if who == "" then
        say("use /im loot sweep <number, name, me or other> [poor, common or uncommon].")
        return
      end
      self.sweep(who, maxQuality)
    elseif word == "stop" then
      self.stop()
    else
      say("commands: /im loot (the slots), /im loot give <slot> <who>, /im loot sweep <who> [quality], /im loot stop. <who> is a number, a name, me or other.")
    end
  end

  self.resolve = resolve
  self.listen = listen -- called at load, so the receiving side keeps the game's loot lines too
  return self
end
