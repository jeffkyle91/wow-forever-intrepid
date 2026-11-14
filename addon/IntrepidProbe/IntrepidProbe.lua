-- Intrepid Probe: a developer tool for finding out what the client offers before we write the real loot addon.
-- It records facts into its own saved variables (IntrepidProbeDB), which the client writes to disk on /reload or logout.
--
--   /ip probe            record the client version, which APIs and events exist, the player, the group and the addons
--   /ip log on|off       record loot and boss events (loot windows, boss kills, loot rolls, trades, chat loot lines)
--   /ip log clear        forget recorded events
--   /ip msg [text]       send a test addon message (to the raid or party, or to yourself) and record the round trip
--   /ip invite Name      invite a player to the party (tests whether an addon may do this)
--   /ip ej               dump the in-game Encounter Journal (instances, bosses, loot) to the saved variables
--   /ip bundle [label]   run every safe check in one go (see Bundle.lua), turn the event log on, and name the run
--   /ip bags             list the bound items in your bags and what their tooltips say about trading them
--   /ip give [slot who]  with the loot window open: list the slots and their master loot candidates; or give a slot to a
--                        candidate (a number or a full name) with GiveMasterLoot, and record what the game answers
--   /ip group            record who is in the group (names as their form only), who leads, and the loot master
--   /ip raid             turn the party into a raid with ConvertToRaid and record what the game answers
--   /ip history          record what the game remembers of this session's loot rolls and drops (C_LootHistory)
--   /ip run [label]      name this test run (kept in the saved file with the addon version); no label shows the current one
--   /ip paste            open a paste box and check how much text the client accepts (see tools/make-paste-tests.py)
--   /ip paste save|saved|forget   keep the last paste in the saved file, check it after /reload, drop it again
--   /ip show             print a short summary
--
-- Nothing here changes the game. It only reads and records.

local ADDON, ns = ...
local PREFIX = "IPROBE"
local MAX_EVENTS = 1500

IntrepidProbeDB = IntrepidProbeDB or {}
local db

local function out(text) print("|cff66ccffIntrepid Probe:|r " .. tostring(text)) end

local function str(value)
  if value == nil then return "nil" end
  return tostring(value)
end

-- Whether this client currently refuses outgoing addon messages (the retail client does in some situations).
local function restrictedNow()
  local fn = _G.C_ChatInfo and _G.C_ChatInfo.AreOutgoingAddonChatMessagesRestricted
  if not fn then return "n/a" end
  local ok, value = pcall(fn)
  return ok and tostring(value) or ("ERROR: " .. tostring(value))
end

-- Does a global such as "GiveMasterLoot" or a field such as "C_Item.GetItemInfo" exist?
-- (Defined before enumName: a local used before its definition is a nil global, which broke /ip msg in 0.5.)
local function lookup(path)
  local value = _G
  for part in string.gmatch(path, "[^%.]+") do
    if type(value) ~= "table" then return nil end
    value = value[part]
    if value == nil then return nil end
  end
  return value
end

-- Name of an enum value, for example the result of sending an addon message.
local function enumName(path, value)
  local enum = lookup(path)
  if type(enum) ~= "table" then return str(value) end
  for key, number in pairs(enum) do if number == value then return key .. "(" .. str(value) .. ")" end end
  return str(value)
end

local function exists(path) return lookup(path) ~= nil end

local function now() return date("%Y-%m-%d %H:%M:%S") end

local function itemId(link)
  if type(link) ~= "string" then return nil end
  return tonumber(string.match(link, "item:(%d+)"))
end

-- A copy of a value that the saved file can hold, whatever the game gave: tables are cut at `depth` levels and 40
-- entries, text at 200 characters, and anything else (a function, a number that is not a number) is written as its kind.
local function plain(value, depth)
  local kind = type(value)
  if kind == "string" then return string.sub(value, 1, 200) end
  if kind == "boolean" or kind == "nil" then return value end
  if kind == "number" then
    if value ~= value or value == math.huge or value == -math.huge then return tostring(value) end
    return value
  end
  if kind == "table" then
    if depth <= 0 then return "<table>" end
    local copy, count = {}, 0
    for key, item in pairs(value) do
      count = count + 1
      if count > 40 then
        copy["..."] = "more entries"
        break
      end
      local name = key
      if type(key) ~= "string" and type(key) ~= "number" then name = tostring(key) end
      if type(name) == "number" and (name ~= name or name == math.huge or name == -math.huge) then name = tostring(name) end
      copy[name] = plain(item, depth - 1)
    end
    return copy
  end
  return "<" .. kind .. ">"
end

-- The first value a function gives, or nil when there is no such function. Unlike `fn and fn(x) or nil` it keeps a false.
local function ask(fn, ...)
  if type(fn) ~= "function" then return nil end
  return (fn(...))
end

-- Calls fn and gives back whether it worked and every value it returned (or the error), each written as text.
local function returns(fn, ...)
  local function collect(ok, ...)
    local list = {}
    for i = 1, select("#", ...) do list[i] = tostring((select(i, ...))) end
    return ok, list
  end
  return collect(pcall(fn, ...))
end

-- "Jorren Ashvale" -> "Aaaaaa Aaaaaaa": the form of a name without the name itself (Bundle.lua keeps the same form).
local function shape(text)
  if type(text) ~= "string" then return str(text) end
  text = string.gsub(text, "[\128-\255]+", "~")
  text = string.gsub(text, "%u", "A")
  text = string.gsub(text, "%l", "a")
  text = string.gsub(text, "%d", "9")
  return text
end

local function safe(fn, ...)
  local ok, a, b, c, d, e, f, g, h = pcall(fn, ...)
  if ok then return a, b, c, d, e, f, g, h end
  return "ERROR: " .. tostring(a)
end

local frame = CreateFrame("Frame")

---------------------------------------------------------------------------------------------------------------
-- Probe
---------------------------------------------------------------------------------------------------------------

local APIS = {
  -- loot windows and master loot
  "GetLootMethod", "C_PartyInfo.GetLootMethod", "C_PartyInfo.SetLootMethod", "C_PartyInfo.SetLootThreshold", "C_PartyInfo.GetLootThreshold", "SetLootMethod", "Enum.LootMethod", "GiveMasterLoot", "GetMasterLootCandidate",
  "GetNumLootItems", "GetLootSlotInfo", "GetLootSlotLink", "GetLootSlotType", "GetLootSourceInfo", "LootSlot", "GetLootThreshold", "C_Loot",
  -- group loot rolls and history
  "RollOnLoot", "GetLootRollItemInfo", "GetLootRollItemLink", "C_LootHistory", "GetNumLootHistoryItems",
  -- items and bags
  "C_Item.GetItemInfo", "GetItemInfo", "C_Item.GetItemInfoInstant", "GetItemInfoInstant", "C_Item.GetItemQualityByID", "C_Container.GetContainerItemLink",
  "GetContainerItemLink", "C_Container.GetContainerNumSlots", "C_Container.GetContainerItemInfo", "C_TooltipInfo", "C_TooltipInfo.GetBagItem",
  "C_Item.RequestLoadItemDataByID", "C_Item.IsBound", "C_Item.EndBoundTradeable",
  -- trade
  "InitiateTrade", "AddTradeMoney", "GetTradePlayerItemLink", "GetTradeTargetItemLink", "ClickTradeButton", "AcceptTrade",
  -- group, instance and encounter data
  "IsInRaid", "IsInGroup", "GetNumGroupMembers", "GetRaidRosterInfo", "GetInstanceInfo", "GetDifficultyInfo", "UnitGroupRolesAssigned",
  "C_EncounterJournal", "EJ_GetEncounterInfo", "EJ_GetInstanceInfo", "GetSavedInstanceInfo",
  -- people
  "UnitName", "UnitFullName", "UnitClass", "UnitGUID", "GetRealmName", "GetNormalizedRealmName", "Ambiguate", "GetGuildInfo", "GetGuildRosterInfo",
  -- addon communication and timers
  "C_ChatInfo.SendAddonMessage", "C_ChatInfo.RegisterAddonMessagePrefix", "C_ChatInfo.SendAddonMessageLogged", "C_ChatInfo.InChatMessagingLockdown",
  "SendAddonMessage", "RegisterAddonMessagePrefix", "C_Timer.After", "C_Timer.NewTicker",
  -- exchange strings (docs/spec/exchange-v0.md): CRC-32 bit operations, server time, a built-in JSON decoder
  "bit", "bit.bxor", "GetServerTime", "C_EncodingUtil", "C_EncodingUtil.DeserializeJSON",
  -- addon management
  "C_AddOns.GetNumAddOns", "C_AddOns.GetAddOnInfo", "C_AddOns.GetAddOnMetadata", "C_AddOns.IsAddOnLoaded", "GetNumAddOns", "GetAddOnInfo", "IsAddOnLoaded",
  -- interface building blocks
  "CreateFrame", "BackdropTemplateMixin", "Mixin", "CreateFromMixins", "ScrollingTable", "UIDropDownMenu_Initialize", "Menu", "C_CVar", "LoggingChat",
  -- libraries other addons rely on
  "LibStub",
}

local EVENTS = {
  "LOOT_OPENED", "LOOT_READY", "LOOT_CLOSED", "LOOT_SLOT_CLEARED", "LOOT_SLOT_CHANGED", "LOOT_BIND_CONFIRM", "OPEN_MASTER_LOOT_LIST",
  "START_LOOT_ROLL", "CANCEL_LOOT_ROLL", "LOOT_ROLLS_COMPLETE", "LOOT_HISTORY_FULL_UPDATE", "LOOT_HISTORY_ROLL_CHANGED", "LOOT_HISTORY_AUTO_SHOW",
  "CHAT_MSG_LOOT", "CHAT_MSG_ADDON", "CHAT_MSG_ADDON_LOGGED", "PARTY_LOOT_METHOD_CHANGED", "GROUP_ROSTER_UPDATE", "RAID_ROSTER_UPDATE",
  "ENCOUNTER_START", "ENCOUNTER_END", "BOSS_KILL", "ENCOUNTER_LOOT_RECEIVED", "INSTANCE_ENCOUNTER_ENGAGE_UNIT",
  "TRADE_SHOW", "TRADE_CLOSED", "TRADE_ACCEPT_UPDATE", "TRADE_PLAYER_ITEM_CHANGED", "TRADE_TARGET_ITEM_CHANGED", "TRADE_REQUEST",
  "BAG_UPDATE_DELAYED", "ITEM_DATA_LOAD_RESULT", "GET_ITEM_INFO_RECEIVED", "PLAYER_ENTERING_WORLD", "ZONE_CHANGED_NEW_AREA",
  "ADDON_RESTRICTION_STATE_CHANGED", "CHAT_MSG_SYSTEM", "CHAT_MSG_RAID_WARNING",
}

local function probe(quiet)
  db.probe = { at = now() }
  local p = db.probe

  local version, build, buildDate, toc = GetBuildInfo()
  p.build = { version = version, build = build, date = buildDate, interface = toc }
  p.project = {
    WOW_PROJECT_ID = _G.WOW_PROJECT_ID,
    MAINLINE = _G.WOW_PROJECT_MAINLINE, CLASSIC = _G.WOW_PROJECT_CLASSIC, BC = _G.WOW_PROJECT_BURNING_CRUSADE_CLASSIC,
    WRATH = _G.WOW_PROJECT_WRATH_CLASSIC, CATA = _G.WOW_PROJECT_CATACLYSM_CLASSIC, MISTS = _G.WOW_PROJECT_MISTS_OF_PANDARIA_CLASSIC,
  }
  p.locale = GetLocale and GetLocale() or nil
  p.portal = GetCVar and safe(GetCVar, "portal") or nil

  p.apis = {}
  for _, path in ipairs(APIS) do p.apis[path] = exists(path) and (type(lookup(path))) or false end

  -- Control: a made-up event name. If registering it "works", the table below cannot tell real events from unknown ones.
  p.eventCheckControlAccepted = pcall(frame.RegisterEvent, frame, "INTREPID_PROBE_NOT_A_REAL_EVENT")
  if p.eventCheckControlAccepted then pcall(frame.UnregisterEvent, frame, "INTREPID_PROBE_NOT_A_REAL_EVENT") end
  p.events = {}
  for _, name in ipairs(EVENTS) do
    local ok = pcall(frame.RegisterEvent, frame, name)
    p.events[name] = ok
    if ok then pcall(frame.UnregisterEvent, frame, name) end
  end

  -- The loop above registered and unregistered each event to see whether it exists, which also switched off what must
  -- stay on: the two always-on listeners, and the event log when it is running. Put those back.
  pcall(frame.RegisterEvent, frame, "CHAT_MSG_ADDON")
  pcall(frame.RegisterEvent, frame, "ADDON_RESTRICTION_STATE_CHANGED")
  if ns.probe and ns.probe.refreshLogging then ns.probe.refreshLogging() end

  local playerName, playerRealm
  if UnitFullName then playerName, playerRealm = UnitFullName("player") end
  local _, classFile = UnitClass("player")
  p.names = {
    unitName = safe(UnitName, "player"), unitNameWithRealm = GetUnitName and safe(GetUnitName, "player", true) or nil,
    getRealmName = GetRealmName and safe(GetRealmName) or nil, normalizedRealm = GetNormalizedRealmName and safe(GetNormalizedRealmName) or nil,
    ambiguateNone = Ambiguate and UnitName and safe(Ambiguate, (GetUnitName and GetUnitName("player", true) or "?"), "none") or nil,
  }
  p.player = {
    name = playerName, realm = playerRealm or (GetRealmName and GetRealmName()), class = classFile, level = UnitLevel and UnitLevel("player"),
    guild = GetGuildInfo and (GetGuildInfo("player")),
  }

  local method = "n/a"
  if exists("C_PartyInfo.GetLootMethod") then method = str(safe(C_PartyInfo.GetLootMethod))
  elseif exists("GetLootMethod") then method = str(safe(GetLootMethod)) end
  p.restrictions = {
    outgoingAddonMessagesRestricted = exists("C_ChatInfo.AreOutgoingAddonChatMessagesRestricted") and str(safe(C_ChatInfo.AreOutgoingAddonChatMessagesRestricted)) or "n/a",
    messagingLockdown = exists("C_ChatInfo.InChatMessagingLockdown") and str(safe(C_ChatInfo.InChatMessagingLockdown)) or "n/a",
  }
  p.lootMethods = {}
  if exists("Enum.LootMethod") and exists("C_PartyInfo.IsLootMethodAvailable") then
    for key, value in pairs(Enum.LootMethod) do p.lootMethods[key] = str(safe(C_PartyInfo.IsLootMethodAvailable, value)) end
  end
  if exists("C_PartyInfo.GetAvailableLootMethods") then
    local available = safe(C_PartyInfo.GetAvailableLootMethods)
    if type(available) == "table" then
      p.availableLootMethods = {}
      for key, value in pairs(available) do p.availableLootMethods[tostring(key)] = tostring(value) end
    else p.availableLootMethods = str(available) end
  end
  p.group = {
    inGroup = exists("IsInGroup") and IsInGroup() or false, inRaid = exists("IsInRaid") and IsInRaid() or false,
    size = exists("GetNumGroupMembers") and GetNumGroupMembers() or 0, lootMethod = method,
    lootThreshold = exists("GetLootThreshold") and str(safe(GetLootThreshold)) or "n/a",
  }
  if exists("Enum.LootMethod") then
    p.lootMethodEnum = {}
    for key, value in pairs(Enum.LootMethod) do p.lootMethodEnum[key] = value end
  end

  local instanceName, instanceType, difficultyID, difficultyName, maxPlayers, _, _, instanceMapID = GetInstanceInfo()
  p.instance = { name = instanceName, type = instanceType, difficultyID = difficultyID, difficultyName = difficultyName, maxPlayers = maxPlayers, mapID = instanceMapID }

  p.enums = {}
  for _, path in ipairs({ "Enum.SendAddonMessageResult", "Enum.RegisterAddonMessagePrefixResult", "Enum.AddOnRestrictionType", "Enum.AddOnRestrictionState" }) do
    local enum = lookup(path)
    if type(enum) == "table" then
      p.enums[path] = {}
      for key, value in pairs(enum) do p.enums[path][key] = value end
    end
  end

  p.namespaces = {}
  for _, space in ipairs({ "C_PartyInfo", "C_LootHistory", "C_Loot", "C_ChatInfo", "C_EncounterJournal", "Enum.SendAddonMessageResult" }) do
    local table_ = lookup(space)
    if type(table_) == "table" then
      local names = {}
      for key in pairs(table_) do names[#names + 1] = tostring(key) end
      table.sort(names)
      p.namespaces[space] = names
    end
  end

  p.addons = {}
  local count = exists("C_AddOns.GetNumAddOns") and C_AddOns.GetNumAddOns() or (exists("GetNumAddOns") and GetNumAddOns() or 0)
  for i = 1, count do
    local name, loaded
    if exists("C_AddOns.GetAddOnInfo") then
      local info = C_AddOns.GetAddOnInfo(i)
      if type(info) == "table" then name = info.name else name = info end
      loaded = exists("C_AddOns.IsAddOnLoaded") and C_AddOns.IsAddOnLoaded(i) or nil
    elseif exists("GetAddOnInfo") then
      name = GetAddOnInfo(i)
      loaded = exists("IsAddOnLoaded") and IsAddOnLoaded(i) or nil
    end
    if name then p.addons[#p.addons + 1] = { name = name, loaded = loaded and true or false } end
  end

  if quiet then return end -- /ip bundle prints its own summary

  -- Short summary to the chat window.
  out(string.format("client %s build %s interface %s (project id %s)", str(version), str(build), str(toc), str(_G.WOW_PROJECT_ID)))
  local missing = {}
  for _, path in ipairs(APIS) do if not p.apis[path] then missing[#missing + 1] = path end end
  out(#APIS - #missing .. " of " .. #APIS .. " APIs exist. Missing: " .. (#missing > 0 and table.concat(missing, ", ") or "none"))
  local badEvents = {}
  for _, name in ipairs(EVENTS) do if not p.events[name] then badEvents[#badEvents + 1] = name end end
  out("Unknown events: " .. (#badEvents > 0 and table.concat(badEvents, ", ") or "none") .. (p.eventCheckControlAccepted and " (note: this client accepts made-up event names, so this list proves nothing)" or ""))
  out("Loot method: " .. method .. ". Group size: " .. p.group.size .. ". Addons listed: " .. #p.addons .. ".")
  out("Now type /reload so the client saves this to disk, then tell Claude.")
end

---------------------------------------------------------------------------------------------------------------
-- Event log
---------------------------------------------------------------------------------------------------------------

local LOG_EVENTS = {
  "LOOT_OPENED", "LOOT_READY", "LOOT_CLOSED", "LOOT_SLOT_CLEARED", "LOOT_SLOT_CHANGED", "LOOT_BIND_CONFIRM", "OPEN_MASTER_LOOT_LIST",
  "CONFIRM_LOOT_DISTRIBUTION",
  "START_LOOT_ROLL", "CANCEL_LOOT_ROLL", "LOOT_ROLLS_COMPLETE", "LOOT_HISTORY_FULL_UPDATE", "LOOT_HISTORY_ROLL_CHANGED",
  "CHAT_MSG_LOOT", "PARTY_LOOT_METHOD_CHANGED", "GROUP_ROSTER_UPDATE",
  "ENCOUNTER_START", "ENCOUNTER_END", "BOSS_KILL", "ENCOUNTER_LOOT_RECEIVED",
  "TRADE_SHOW", "TRADE_CLOSED", "TRADE_ACCEPT_UPDATE", "TRADE_PLAYER_ITEM_CHANGED", "TRADE_TARGET_ITEM_CHANGED",
  "PLAYER_ENTERING_WORLD", "ZONE_CHANGED_NEW_AREA",
  "ADDON_RESTRICTION_STATE_CHANGED", "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED", "CHAT_MSG_SYSTEM",
  "UI_INFO_MESSAGE", "UI_ERROR_MESSAGE", "LOOT_HISTORY_ROLL_COMPLETE",
}

-- The game shows many small messages ("Out of range."). Only the ones about loot, trading, binding and groups are
-- worth a line in the log, and keeping the rest out leaves room for the events that matter.
local MESSAGE_WORDS = { "trade", "loot", "bound", "bind", "inventory", "unique", "eligible", "invite", "group", "party", "raid", "master", "bag" }

local function interestingMessage(...)
  for i = 1, select("#", ...) do
    local value = select(i, ...)
    if type(value) == "string" then
      local lower = string.lower(value)
      for _, word in ipairs(MESSAGE_WORDS) do
        if string.find(lower, word, 1, true) then return true end
      end
    end
  end
  return false
end

local logging = false

local function record(event, extra, ...)
  db.events = db.events or {}
  local args = {}
  for i = 1, select("#", ...) do args[i] = str((select(i, ...))) end
  local instanceName, _, difficultyID, _, maxPlayers, _, _, mapID = GetInstanceInfo()
  local entry = { t = now(), up = GetTime and string.format("%.1f", GetTime()) or nil, event = event, args = args, zone = instanceName, difficulty = difficultyID, size = maxPlayers, mapID = mapID }
  if extra then entry.extra = extra end
  local list = db.events
  list[#list + 1] = entry
  if #list > MAX_EVENTS then table.remove(list, 1) end
end

-- What the game says about an item, for the loot windows: level, type, equip slot, bind type. Nil when it is not known (yet).
local function itemDetails(link)
  if not link then return nil end
  local get = lookup("C_Item.GetItemInfo") or lookup("GetItemInfo")
  if not get then return nil end
  local result = { pcall(get, link) }
  if not result[1] then return nil end
  local first = result[2]
  if type(first) == "table" then
    return { itemLevel = first.itemLevel, minLevel = first.itemMinLevel or first.minLevel, type = first.itemType or first.type, subType = first.itemSubType or first.subType,
      equipLoc = first.itemEquipLoc or first.equipLoc, classID = first.classID, subClassID = first.subclassID or first.subClassID, bindType = first.bindType }
  end
  if not first then return nil end
  return { itemLevel = result[5], minLevel = result[6], type = result[7], subType = result[8], equipLoc = result[10], classID = result[13], subClassID = result[14], bindType = result[15] }
end

local function lootWindow()
  local slots = {}
  local count = exists("GetNumLootItems") and GetNumLootItems() or 0
  for slot = 1, count do
    local icon, name, quantity, currencyID, quality, locked
    if exists("GetLootSlotInfo") then icon, name, quantity, currencyID, quality, locked = GetLootSlotInfo(slot) end
    local link = exists("GetLootSlotLink") and GetLootSlotLink(slot) or nil
    local slotType = exists("GetLootSlotType") and GetLootSlotType(slot) or nil
    -- The candidates are numbered 1 to 40 and a number can be empty, so the form of each name is kept under its number
    -- (the number is what GiveMasterLoot takes), and the name itself is not.
    local candidates, candidateShapes = 0, nil
    if exists("GetMasterLootCandidate") then
      for index = 1, 40 do
        local candidate = GetMasterLootCandidate(slot, index)
        if candidate then
          candidates = candidates + 1
          candidateShapes = candidateShapes or {}
          candidateShapes[index] = shape(candidate)
        end
      end
    end
    local sourceGuid = exists("GetLootSourceInfo") and (GetLootSourceInfo(slot)) or nil
    local npcId = sourceGuid and tonumber(string.match(tostring(sourceGuid), "^Creature%-%d+%-%d+%-%d+%-%d+%-(%d+)")) or nil
    slots[#slots + 1] = { slot = slot, name = name, itemId = itemId(link), link = link, quantity = quantity, quality = quality, locked = locked, slotType = slotType, masterLootCandidates = candidates, candidateShapes = candidateShapes, sourceGuid = sourceGuid, npcId = npcId, details = itemDetails(link) }
  end
  local target = UnitName and UnitName("target") or nil
  local lootMethod = exists("C_PartyInfo.GetLootMethod") and safe(C_PartyInfo.GetLootMethod) or nil
  local threshold = exists("GetLootThreshold") and safe(GetLootThreshold) or nil
  return { slots = slots, target = target, targetGuid = UnitGUID and UnitGUID("target") or nil, autoLoot = GetCVar and safe(GetCVar, "autoLootDefault") or nil,
    lootMethod = lootMethod and str(lootMethod) or nil, threshold = threshold ~= nil and str(threshold) or nil, inGroup = IsInGroup and IsInGroup() or false }
end

-- What is in the trade window right now, by slot: the items you put in and the items the other player put in.
-- Slots 1 to 6 are traded; slot 7 is the "will not be traded" slot.
local function tradeItems()
  local items = { player = {}, target = {} }
  local fromPlayer, fromTarget = lookup("GetTradePlayerItemLink"), lookup("GetTradeTargetItemLink")
  for slot = 1, 7 do
    local mine = fromPlayer and safe(fromPlayer, slot) or nil
    if type(mine) == "string" and string.sub(mine, 1, 6) ~= "ERROR:" then items.player[slot] = mine end
    local theirs = fromTarget and safe(fromTarget, slot) or nil
    if type(theirs) == "string" and string.sub(theirs, 1, 6) ~= "ERROR:" then items.target[slot] = theirs end
  end
  return items
end

-- What a group roll offers when it starts: the item, which buttons are allowed (and why not), and how long it lasts.
local function rollDetails(rollId)
  local link = exists("GetLootRollItemLink") and GetLootRollItemLink(rollId) or nil
  local info = exists("GetLootRollItemInfo") and { GetLootRollItemInfo(rollId) } or {}
  local duration = exists("C_Loot.GetLootRollDuration") and safe(C_Loot.GetLootRollDuration, rollId) or nil
  return {
    rollId = rollId, link = link, itemId = itemId(link), name = info[2], count = info[3], quality = info[4], bindOnPickUp = info[5],
    canNeed = info[6], canGreed = info[7], canDisenchant = info[8], reasonNeed = info[9], reasonGreed = info[10],
    reasonDisenchant = info[11], deSkillRequired = info[12], canTransmog = info[13],
    duration = duration ~= nil and str(duration) or nil,
  }
end

-- What the game remembers of the loot rolls and drops of this session (C_LootHistory), copied as it comes, because the shape
-- is not known: the list of encounters, then each encounter's drops, then each drop's details (who rolled what, who won).
local MAX_HISTORY_ENCOUNTERS, MAX_HISTORY_DROPS, MAX_HISTORY_KEPT, MAX_AUTO_HISTORY = 12, 20, 30, 20
local autoHistory = 0

local function dumpLootHistory(quiet)
  local history = _G.C_LootHistory
  if type(history) ~= "table" then
    if not quiet then out("C_LootHistory does not exist here.") end
    return
  end
  local function call(name, ...)
    local fn = history[name]
    if type(fn) ~= "function" then return nil, "missing" end
    local ok, result = pcall(fn, ...)
    if not ok then return nil, "ERROR: " .. string.sub(tostring(result), 1, 120) end
    return result
  end
  local record = { at = now(), encounters = {} }
  local infos, why = call("GetAllEncounterInfos")
  record.all = infos ~= nil and plain(infos, 3) or why
  for index, info in ipairs(type(infos) == "table" and infos or {}) do
    if index > MAX_HISTORY_ENCOUNTERS then break end
    local id = type(info) == "table" and (info.encounterID or info[1]) or info
    local entry = { encounter = plain(info, 2), drops = {} }
    local drops, dropsWhy = call("GetSortedDropsForEncounter", id)
    entry.dropList = drops ~= nil and plain(drops, 3) or dropsWhy
    for dropIndex, drop in ipairs(type(drops) == "table" and drops or {}) do
      if dropIndex > MAX_HISTORY_DROPS then break end
      local lootListId = type(drop) == "table" and (drop.lootListID or drop[1]) or drop
      local detail, detailWhy = call("GetSortedInfoForDrop", id, lootListId)
      entry.drops[dropIndex] = detail ~= nil and plain(detail, 4) or detailWhy
    end
    record.encounters[index] = entry
  end
  db.history = db.history or {}
  db.history[#db.history + 1] = record
  if #db.history > MAX_HISTORY_KEPT then table.remove(db.history, 1) end
  if not quiet then out("loot history: " .. #record.encounters .. " encounters recorded. /reload to save it.") end
end

local function onEvent(_, event, ...)
  if event == "ADDON_LOADED" then
    if select(1, ...) ~= ADDON then return end
    IntrepidProbeDB = IntrepidProbeDB or {}
    db = IntrepidProbeDB
    -- Stamp the file with the addon version, so a results file always says which build wrote it.
    local metadata = lookup("C_AddOns.GetAddOnMetadata") or lookup("GetAddOnMetadata")
    db.addonVersion = metadata and str(safe(metadata, ADDON, "Version")) or "unknown"
    db.luaVersion = _VERSION
    db.loadedAt = now()
    pcall(frame.RegisterEvent, frame, "CHAT_MSG_ADDON") -- always on, so the message test can show what comes back
    pcall(frame.RegisterEvent, frame, "ADDON_RESTRICTION_STATE_CHANGED")
    local registerPrefix = lookup("C_ChatInfo.RegisterAddonMessagePrefix") or lookup("RegisterAddonMessagePrefix")
    if registerPrefix then db.prefixRegisteredAtLoad = enumName("Enum.RegisterAddonMessagePrefixResult", safe(registerPrefix, PREFIX)) end
    -- setLogging is defined further down this file, so it is reached through ns.probe, which is filled in by then.
    if db.loggingOn and ns.probe and ns.probe.setLogging then ns.probe.setLogging(true, true) end
    return
  end
  if event == "ADDON_RESTRICTION_STATE_CHANGED" then
    local list = {}
    for i = 1, select("#", ...) do list[i] = str((select(i, ...))) end
    out("addon restriction state changed: " .. table.concat(list, ", ") .. " (outgoing restricted now: " .. restrictedNow() .. ")")
    db.restrictionChanges = db.restrictionChanges or {}
    db.restrictionChanges[#db.restrictionChanges + 1] = { t = now(), args = list, outgoingRestricted = restrictedNow() }
    return
  end
  if not db then return end

  if event == "CHAT_MSG_ADDON" then
    local prefix, text, channel, sender = ...
    -- Count every addon message that arrives, from any addon, to see whether receiving works at all.
    db.traffic = db.traffic or {}
    local key = tostring(prefix)
    local row = db.traffic[key]
    if not row then
      row = { count = 0, firstAt = now(), channel = str(channel), sender = str(sender), sample = string.sub(str(text), 1, 50) }
      db.traffic[key] = row
    end
    row.count = row.count + 1
    row.lastAt = now()
    if prefix == PREFIX then
      db.messages = db.messages or {}
      db.messages[#db.messages + 1] = { t = now(), event = "received", text = text, channel = channel, sender = sender }
      out("received test message from " .. str(sender) .. " via " .. str(channel) .. ": " .. str(text))
    end
    return
  end

  if not logging then return end
  if event == "LOOT_OPENED" or event == "LOOT_READY" or event == "LOOT_SLOT_CHANGED" or event == "OPEN_MASTER_LOOT_LIST"
    or event == "CONFIRM_LOOT_DISTRIBUTION" or event == "LOOT_BIND_CONFIRM" then
    record(event, safe(lootWindow), ...)
  elseif event == "TRADE_SHOW" or event == "TRADE_ACCEPT_UPDATE" or event == "TRADE_PLAYER_ITEM_CHANGED" or event == "TRADE_TARGET_ITEM_CHANGED" then
    record(event, safe(tradeItems), ...)
  elseif event == "START_LOOT_ROLL" then
    record(event, safe(rollDetails, (...)), ...)
  elseif event == "LOOT_ROLLS_COMPLETE" or event == "LOOT_HISTORY_ROLL_COMPLETE" then
    record(event, nil, ...)
    if autoHistory < MAX_AUTO_HISTORY then -- keep what the game says about the roll while it is fresh
      autoHistory = autoHistory + 1
      pcall(dumpLootHistory, true)
    end
  elseif event == "UI_INFO_MESSAGE" or event == "UI_ERROR_MESSAGE" then
    if interestingMessage(...) then record(event, nil, ...) end
  elseif event == "ENCOUNTER_END" or event == "ENCOUNTER_START" or event == "BOSS_KILL" then
    record(event, nil, ...)
  elseif event == "CHAT_MSG_LOOT" then
    local text = ...
    record(event, { itemId = itemId(text) }, ...)
  else
    record(event, nil, ...)
  end
end

-- restored: the log was on when the game was last saved, so it is switched on again after a /reload or a login.
local function setLogging(on, restored)
  logging = on
  for _, name in ipairs(LOG_EVENTS) do
    if on then pcall(frame.RegisterEvent, frame, name) else pcall(frame.UnregisterEvent, frame, name) end
  end
  db.loggingOn = on or nil -- remembered in the saved file, so a /reload does not switch the log off
  if not restored then db.loggingSince = on and now() or nil end
  local count = db.events and #db.events or 0
  if restored then
    out("Event log is ON again after the reload. Events recorded so far: " .. count)
  else
    out("Event log " .. (on and "ON. Do the thing you want to test (open a corpse, kill a boss, trade), then /reload." or "OFF.") .. " Events recorded so far: " .. count)
  end
end

---------------------------------------------------------------------------------------------------------------
-- Message test
---------------------------------------------------------------------------------------------------------------

local function sendTest(text)
  text = (text and text ~= "") and text or ("hello " .. now())
  local register = lookup("C_ChatInfo.RegisterAddonMessagePrefix") or lookup("RegisterAddonMessagePrefix")
  local send = lookup("C_ChatInfo.SendAddonMessage") or lookup("SendAddonMessage")
  if not register or not send then out("This client has no addon message API.") return end
  local registered = register(PREFIX)
  local channel
  if IsInRaid and IsInRaid() then channel = "RAID"
  elseif IsInGroup and IsInGroup() then channel = "PARTY"
  elseif IsInGuild and IsInGuild() then channel = "GUILD" end
  local target
  if not channel then out("Nobody to send to: join a party or a guild first (the game does not allow whispering yourself).") return end
  db.messages = db.messages or {}
  local before = restrictedNow()
  local result = safe(send, PREFIX, text, channel, target)
  local resultName = enumName("Enum.SendAddonMessageResult", result)
  db.messages[#db.messages + 1] = { t = now(), event = "sent", text = text, channel = channel, target = target, prefixRegistered = enumName("Enum.RegisterAddonMessagePrefixResult", registered), result = resultName, restrictedBefore = before, restrictedAfter = restrictedNow() }
  out("sent via " .. channel .. (target and (" to " .. target) or "") .. ": result " .. resultName .. ", outgoing restricted: " .. before .. ". If it arrives you will see a 'received' line.")
  local sendLogged = lookup("C_ChatInfo.SendAddonMessageLogged")
  if sendLogged then
    local loggedResult = enumName("Enum.SendAddonMessageResult", safe(sendLogged, PREFIX, text .. " (logged)", channel, target))
    db.messages[#db.messages + 1] = { t = now(), event = "sent-logged", text = text .. " (logged)", channel = channel, target = target, result = loggedResult }
    out("logged variant: result " .. loggedResult)
  end
end

---------------------------------------------------------------------------------------------------------------
-- Encounter Journal dump: could give us boss loot tables straight from the game, with no website
---------------------------------------------------------------------------------------------------------------

-- quiet: print nothing (the bundle prints its own lines). budgetMs: stop after this many milliseconds (needs debugprofilestop).
-- Returns the number of instances, bosses and items it found.
local function dumpEncounterJournal(quiet, budgetMs)
  local function say(text) if not quiet then out(text) end end
  local started = budgetMs and _G.debugprofilestop and _G.debugprofilestop() or nil
  local function overBudget() return started ~= nil and _G.debugprofilestop() - started > budgetMs end
  db.ej = { at = now(), instances = {}, notes = {}, playerLevel = UnitLevel and UnitLevel("player") or nil }
  local ej = db.ej
  if exists("C_AddOns.LoadAddOn") then pcall(C_AddOns.LoadAddOn, "Blizzard_EncounterJournal") end
  local needed = { "EJ_GetNumTiers", "EJ_SelectTier", "EJ_GetInstanceByIndex", "EJ_SelectInstance", "EJ_GetEncounterInfoByIndex", "EJ_SelectEncounter", "EJ_GetNumLoot" }
  ej.functions = {}
  local complete = true
  for _, name in ipairs(needed) do ej.functions[name] = exists(name); if not exists(name) then complete = false end end
  ej.functions["EJ_GetLootInfoByIndex"] = exists("EJ_GetLootInfoByIndex")
  ej.functions["C_EncounterJournal.GetLootInfoByIndex"] = exists("C_EncounterJournal.GetLootInfoByIndex")
  if not (ej.functions["EJ_GetLootInfoByIndex"] or ej.functions["C_EncounterJournal.GetLootInfoByIndex"]) then complete = false end
  if not complete then
    say("Encounter Journal functions missing: see /ip show after /reload. Nothing dumped.")
    ej.notes[#ej.notes + 1] = "functions missing: nothing dumped"
    return 0, 0, 0
  end
  local function lootAt(i)
    if exists("C_EncounterJournal.GetLootInfoByIndex") then
      local info = C_EncounterJournal.GetLootInfoByIndex(i)
      if type(info) == "table" then return info.itemID, info.name end
    end
    if exists("EJ_GetLootInfoByIndex") then
      local first, _, name = EJ_GetLootInfoByIndex(i)
      if type(first) == "table" then return first.itemID, first.name end
      return first, name
    end
  end
  local tiers = EJ_GetNumTiers() or 0
  ej.tiers = tiers
  local itemCount, bossCount, instanceCount = 0, 0, 0
  local stopped = false
  for tier = 1, math.min(tiers, 30) do
    if stopped then break end
    pcall(EJ_SelectTier, tier)
    for _, isRaid in ipairs({ false, true }) do
      if stopped then break end
      for index = 1, 80 do
        if stopped then break end
        local instanceID, instanceName = EJ_GetInstanceByIndex(index, isRaid)
        if not instanceID then break end
        instanceCount = instanceCount + 1
        local inst = { tier = tier, raid = isRaid, id = instanceID, name = instanceName, encounters = {} }
        ej.instances[#ej.instances + 1] = inst
        pcall(EJ_SelectInstance, instanceID)
        for e = 1, 40 do
          local encounterName, _, encounterID = EJ_GetEncounterInfoByIndex(e)
          if not encounterName then break end
          bossCount = bossCount + 1
          local enc = { id = encounterID, name = encounterName, items = {} }
          inst.encounters[#inst.encounters + 1] = enc
          pcall(EJ_SelectEncounter, encounterID)
          local count = EJ_GetNumLoot() or 0
          for i = 1, math.min(count, 120) do
            local itemID, itemName = lootAt(i)
            if itemID then enc.items[#enc.items + 1] = { id = itemID, name = itemName }; itemCount = itemCount + 1 end
          end
          if overBudget() then
            stopped = true
            ej.notes[#ej.notes + 1] = "stopped early: time budget of " .. tostring(budgetMs) .. " ms"
            break
          end
        end
      end
    end
  end
  ej.counts = { tiers = tiers, instances = instanceCount, bosses = bossCount, items = itemCount }
  say(string.format("Encounter Journal: %d tiers, %d instances, %d bosses, %d items. Type /reload to save.", tiers, instanceCount, bossCount, itemCount))
  return instanceCount, bossCount, itemCount
end

---------------------------------------------------------------------------------------------------------------
-- Commands
---------------------------------------------------------------------------------------------------------------

---------------------------------------------------------------------------------------------------------------
-- Paste size test
---------------------------------------------------------------------------------------------------------------

-- Test strings look like "IPASTE:<n>:<n characters>:END" and the characters repeat a fixed 64-character pattern
-- (tools/make-paste-tests.py writes them with the same rule). Checking one tells us whether all of it arrived intact.
local PASTE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local pasteBlock

local function pasteBlockText()
  if pasteBlock then return pasteBlock end
  local parts = {}
  for i = 1, 64 do
    local k = (i * 7 + 3) % 64 + 1
    parts[i] = string.sub(PASTE_ALPHABET, k, k)
  end
  pasteBlock = table.concat(parts)
  return pasteBlock
end

local function checkPaste(text)
  local result = { bytes = #text }
  local count, headerEnd = string.match(text, "^IPASTE:(%d+):()")
  if not count then
    result.isTestString = false
    return result
  end
  result.isTestString = true
  local n = tonumber(count)
  result.declared = n
  local payload = string.sub(text, headerEnd, headerEnd + n - 1)
  result.payloadLength = #payload
  result.trailerOk = string.sub(text, headerEnd + n, headerEnd + n + 3) == ":END"
  local block = pasteBlockText()
  local mismatches, first = 0, nil
  local pos = 1
  while pos <= #payload do
    local chunk = string.sub(payload, pos, pos + 63)
    if chunk ~= string.sub(block, 1, #chunk) then
      for j = 1, #chunk do
        if string.sub(chunk, j, j) ~= string.sub(block, j, j) then
          mismatches = mismatches + 1
          first = first or (pos + j - 1)
        end
      end
    end
    pos = pos + 64
  end
  result.mismatches = mismatches
  result.firstMismatch = first
  result.ok = (#payload == n) and result.trailerOk and mismatches == 0
  return result
end

local function describePaste(r)
  if not r.isTestString then return r.bytes .. " characters. Not a test string (no IPASTE header)." end
  return string.format("%d characters. Test string declares %d: payload %d, trailer %s, mismatches %d%s => %s",
    r.bytes, r.declared, r.payloadLength, r.trailerOk and "ok" or "MISSING", r.mismatches,
    r.firstMismatch and (", first at " .. r.firstMismatch) or "", r.ok and "INTACT" or "DAMAGED")
end

local pasteFrame, pasteEdit, pasteStatus, lastPasted

local function recordPaste(r, edit, source)
  r.t = now()
  r.source = source
  r.run = db.run and db.run.label or nil
  if edit and edit.GetNumLetters then r.letters = edit:GetNumLetters() end
  db.paste = db.paste or {}
  db.paste[#db.paste + 1] = r
end

local function makeButton(parent, label, x, onClick)
  local ok, button = pcall(CreateFrame, "Button", nil, parent, "UIPanelButtonTemplate")
  if not ok or not button then
    button = CreateFrame("Button", nil, parent)
    button:SetNormalFontObject(_G.GameFontNormal)
  end
  button:SetSize(110, 24)
  button:SetPoint("BOTTOMLEFT", x, 14)
  button:SetText(label)
  button:SetScript("OnClick", onClick)
  return button
end

local function buildPasteFrame()
  local ok, f = pcall(CreateFrame, "Frame", "IntrepidProbePasteFrame", UIParent, "BasicFrameTemplateWithInset")
  if not ok or not f then
    f = CreateFrame("Frame", "IntrepidProbePasteFrame", UIParent)
    local background = f:CreateTexture(nil, "BACKGROUND")
    background:SetAllPoints()
    background:SetColorTexture(0, 0, 0, 0.85)
  end
  f:SetSize(640, 420)
  f:SetPoint("CENTER")
  f:SetFrameStrata("DIALOG")
  f:EnableMouse(true)
  f:SetMovable(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", f.StartMoving)
  f:SetScript("OnDragStop", f.StopMovingOrSizing)

  local title = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  title:SetPoint("TOP", 0, -6)
  title:SetText("Intrepid Probe: paste test")

  local okScroll, scroll = pcall(CreateFrame, "ScrollFrame", "IntrepidProbePasteScroll", f, "UIPanelScrollFrameTemplate")
  if not okScroll or not scroll then scroll = CreateFrame("ScrollFrame", nil, f) end
  scroll:SetPoint("TOPLEFT", 14, -34)
  scroll:SetPoint("BOTTOMRIGHT", -34, 76)

  local edit = CreateFrame("EditBox", nil, scroll)
  edit:SetMultiLine(true)
  edit:SetAutoFocus(false)
  edit:SetMaxLetters(0)
  edit:SetFontObject(_G.ChatFontNormal or _G.GameFontHighlight)
  edit:SetWidth(560)
  edit:SetHeight(300)
  edit:SetScript("OnEscapePressed", edit.ClearFocus)
  scroll:SetScrollChild(edit)
  -- A multi-line edit box only takes clicks on its own text line. Let a click anywhere in the box focus it.
  scroll:EnableMouse(true)
  scroll:SetScript("OnMouseDown", function() edit:SetFocus() end)
  scroll:SetScript("OnSizeChanged", function(_, width, height)
    edit:SetWidth(width)
    edit:SetHeight(math.max(height, 60))
  end)

  local status = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  status:SetPoint("BOTTOMLEFT", 16, 46)
  status:SetWidth(600)
  status:SetJustifyH("LEFT")
  status:SetText("Paste a test string above, then press Check.")

  makeButton(f, "Check", 16, function()
    local text = edit:GetText() or ""
    lastPasted = text
    local r = checkPaste(text)
    recordPaste(r, edit, "check")
    status:SetText(describePaste(r))
    out(describePaste(r))
  end)
  makeButton(f, "Clear", 136, function()
    edit:SetText("")
    status:SetText("Cleared.")
  end)
  makeButton(f, "Close", 256, function() f:Hide() end)

  pasteFrame, pasteEdit, pasteStatus = f, edit, status
end

local function openPasteFrame()
  if not pasteFrame then buildPasteFrame() end
  pasteFrame:Show()
  if pasteEdit then pasteEdit:SetFocus() end
end

local function pasteCommand(sub)
  sub = string.lower(sub or "")
  if sub == "" then
    openPasteFrame()
  elseif sub == "save" then
    if not lastPasted then out("Open /ip paste, paste a string and press Check first.") return end
    db.pasteSaved = { t = now(), length = #lastPasted, text = lastPasted }
    out("Saved " .. #lastPasted .. " characters in the saved file. /reload, then /ip paste saved to check it survived, then /ip paste forget.")
  elseif sub == "saved" then
    if not db.pasteSaved or not db.pasteSaved.text then out("Nothing saved. Use /ip paste save after a Check.") return end
    local r = checkPaste(db.pasteSaved.text)
    recordPaste(r, nil, "saved after reload")
    out("Saved copy: " .. describePaste(r))
  elseif sub == "forget" then
    db.pasteSaved = nil
    out("Saved paste removed. /reload so the file shrinks again.")
  else
    out("Use /ip paste, /ip paste save, /ip paste saved or /ip paste forget.")
  end
end

---------------------------------------------------------------------------------------------------------------
-- Bag scan: the bound items you carry, and what their tooltips say about trading them (the trade window of
-- bind-on-pickup loot, if this client has one). Nothing is changed; the result lands in IntrepidProbeDB.bags.
---------------------------------------------------------------------------------------------------------------

local MAX_BAG_ROWS = 80

-- The lines of an item's tooltip as plain strings, or nil when the tooltip functions are missing or fail.
local function tooltipLines(bag, slot)
  local getTip = lookup("C_TooltipInfo.GetBagItem")
  if not getTip then return nil end
  local ok, data = pcall(getTip, bag, slot)
  if not ok or type(data) ~= "table" or type(data.lines) ~= "table" then return nil end
  local lines = {}
  for _, line in ipairs(data.lines) do
    local text = type(line) == "table" and (line.leftText or line.text) or nil
    if type(text) == "string" then lines[#lines + 1] = text end
  end
  return lines
end

-- A line about trading ("You may trade this item with ... for the next 1 hour"), but not the item class "Trade Goods".
local function mentionsTrading(text)
  local lower = string.lower(text)
  return string.find(lower, "trad", 1, true) ~= nil and string.find(lower, "trade goods", 1, true) == nil
end

-- One bag slot as a row, or nil when it is empty or neither bound nor about trading.
local function bagRow(bag, slot, getInfo)
  local info = getInfo(bag, slot)
  if type(info) ~= "table" then return nil end
  local lines = tooltipLines(bag, slot)
  local tradeLines
  for _, text in ipairs(lines or {}) do
    if mentionsTrading(text) then
      tradeLines = tradeLines or {}
      tradeLines[#tradeLines + 1] = string.sub(text, 1, 160)
    end
  end
  if not (info.isBound or tradeLines) then return nil end
  return { bag = bag, slot = slot, itemId = info.itemID, link = info.hyperlink, quality = info.quality, isBound = info.isBound,
    tooltipLines = lines and #lines or nil, tradeLines = tradeLines }
end

local function scanBags()
  local numSlots, getInfo = lookup("C_Container.GetContainerNumSlots"), lookup("C_Container.GetContainerItemInfo")
  if not (numSlots and getInfo) then out("The bag functions (C_Container) do not exist here.") return end
  local rows, errors, trading = {}, {}, 0
  for bag = 0, 5 do
    local okCount, total = pcall(numSlots, bag)
    if okCount and type(total) == "number" then
      for slot = 1, total do
        local ok, row = pcall(bagRow, bag, slot, getInfo)
        if not ok then
          if #errors < 5 then errors[#errors + 1] = string.sub(tostring(row), 1, 120) end
        elseif row and #rows < MAX_BAG_ROWS then
          rows[#rows + 1] = row
          if row.tradeLines then trading = trading + 1 end
        end
      end
    end
  end
  db.bags = db.bags or {}
  db.bags[#db.bags + 1] = { at = now(), rows = rows, errors = #errors > 0 and errors or nil }
  out("bag scan: " .. #rows .. " items listed (bound, or with a line about trading), " .. trading .. " with a tooltip line about trading" .. (#errors > 0 and (", " .. #errors .. " errors, see the file") or "") .. ". /reload to save it.")
end

---------------------------------------------------------------------------------------------------------------
-- Give: hand a loot slot to a master loot candidate with GiveMasterLoot, to find out whether an addon may do that
-- and what the game answers. The loot master types it with the loot window open. It is the one command here that
-- changes the game, exactly as clicking a name in the master loot list does.
---------------------------------------------------------------------------------------------------------------

local GIVE_EVENTS = {
  "ADDON_ACTION_FORBIDDEN", "ADDON_ACTION_BLOCKED", "UI_ERROR_MESSAGE", "CONFIRM_LOOT_DISTRIBUTION", "LOOT_BIND_CONFIRM",
  "LOOT_SLOT_CLEARED", "CHAT_MSG_LOOT", "LOOT_CLOSED",
}
local GIVE_SECONDS = 3
local MAX_GIVE_EVENTS = 30
local giveFrame, giving, giveStarted

-- The master loot candidates of a slot, in the game's numbering: { { index = 1, name = "First Surname" }, ... }.
local function lootCandidates(slot)
  local list = {}
  if not exists("GetMasterLootCandidate") then return list end
  for index = 1, 40 do
    local name = GetMasterLootCandidate(slot, index)
    if name then list[#list + 1] = { index = index, name = name } end
  end
  return list
end

-- A name made comparable: no spaces at the ends, one space between words, lower case.
local function comparable(text)
  text = string.gsub(tostring(text), "^%s+", "")
  text = string.gsub(text, "%s+$", "")
  text = string.gsub(text, "%s+", " ")
  return string.lower(text)
end

-- /ip give with nothing after it: what is in the loot window and who can get it.
local function listLootSlots()
  local count = exists("GetNumLootItems") and GetNumLootItems() or 0
  if count == 0 then out("There is no loot window open. Open a corpse, then type /ip give.") return end
  local shown = 0
  for slot = 1, count do
    local slotType = exists("GetLootSlotType") and GetLootSlotType(slot) or nil
    if slotType == 1 then
      shown = shown + 1
      local name, quality
      if exists("GetLootSlotInfo") then
        local _, itemName, _, _, itemQuality = GetLootSlotInfo(slot)
        name, quality = itemName, itemQuality
      end
      local names = {}
      for _, candidate in ipairs(lootCandidates(slot)) do names[#names + 1] = candidate.index .. " " .. candidate.name end
      out("slot " .. slot .. ": " .. str(name) .. " (quality " .. str(quality) .. "), candidates: "
        .. (#names > 0 and table.concat(names, ", ") or "none (you are not the master looter here)"))
    end
  end
  if shown == 0 then out("The window has no items, only money.") return end
  out("Give one with /ip give <slot> <candidate number or full name>.")
end

-- The candidate of a slot that `what` names: a number from the list, or a full name.
local function findCandidate(slot, what)
  local list = lootCandidates(slot)
  if #list == 0 then return nil, "Slot " .. slot .. " has no candidates: you are not the master looter here, or nobody is in range." end
  local trimmed = string.gsub(what, "^%s+", "")
  trimmed = string.gsub(trimmed, "%s+$", "")
  local digits = string.match(trimmed, "^%d+$")
  if digits then
    local number = tonumber(digits)
    for _, candidate in ipairs(list) do
      if candidate.index == number then return candidate end
    end
    return nil, "There is no candidate number " .. digits .. " for slot " .. slot .. ". Type /ip give to see them."
  end
  local wanted = comparable(trimmed)
  for _, candidate in ipairs(list) do
    if comparable(candidate.name) == wanted then return candidate end
  end
  return nil, "No candidate has that name for slot " .. slot .. ". Type /ip give to see them."
end

-- What happened in the seconds after the call, in a few words.
local function giveOutcome(record)
  local seen = {}
  for _, e in ipairs(record.events) do seen[e.event] = true end
  if seen.ADDON_ACTION_FORBIDDEN or seen.ADDON_ACTION_BLOCKED then return "the game BLOCKED the call" end
  if not record.called then return "the call raised an error: " .. string.gsub(string.sub(record.result, 1, 80), "|", "?") end
  if seen.CONFIRM_LOOT_DISTRIBUTION or seen.LOOT_BIND_CONFIRM then return "the game asks for a confirmation (answer it in the window)" end
  if seen.UI_ERROR_MESSAGE then return "the game answered with an error message (see the file)" end
  if seen.LOOT_SLOT_CLEARED or seen.CHAT_MSG_LOOT then return "the slot was cleared, so the item was given" end
  return "no answer within " .. GIVE_SECONDS .. " seconds"
end

local function finishGive(record)
  if giveFrame then
    for _, event in ipairs(GIVE_EVENTS) do pcall(giveFrame.UnregisterEvent, giveFrame, event) end
  end
  if giving == record then giving = nil end
  record.outcome = giveOutcome(record)
  out("give result: " .. record.outcome .. ". " .. #record.events .. " events recorded. /reload to save them.")
end

local function startGive(slot, what)
  if giving then out("Still recording the last give. Wait " .. GIVE_SECONDS .. " seconds.") return end
  local give = lookup("GiveMasterLoot")
  if type(give) ~= "function" then out("GiveMasterLoot does not exist here.") return end
  local count = exists("GetNumLootItems") and GetNumLootItems() or 0
  if count == 0 then out("There is no loot window open. Open a corpse first.") return end
  local link, slotType
  if slot >= 1 and slot <= count then
    link = exists("GetLootSlotLink") and GetLootSlotLink(slot) or nil
    slotType = exists("GetLootSlotType") and GetLootSlotType(slot) or nil
  end
  if not link or slotType ~= 1 then
    out("Slot " .. slot .. " has no item. Type /ip give to see the slots.")
    return
  end
  local candidate, why = findCandidate(slot, what)
  if not candidate then out(why) return end

  local itemName, quality
  if exists("GetLootSlotInfo") then
    local _, name, _, _, itemQuality = GetLootSlotInfo(slot)
    itemName, quality = name, itemQuality
  end
  local method = exists("C_PartyInfo.GetLootMethod") and safe(C_PartyInfo.GetLootMethod) or nil
  local threshold = exists("GetLootThreshold") and safe(GetLootThreshold) or nil
  local record = {
    t = now(), slot = slot, candidate = candidate.index, candidateShape = shape(candidate.name), itemId = itemId(link),
    item = itemName, quality = quality, lootMethod = method ~= nil and str(method) or nil,
    threshold = threshold ~= nil and str(threshold) or nil, loggingWasOn = logging, events = {},
  }
  db.gives = db.gives or {}
  db.gives[#db.gives + 1] = record

  giving = record
  giveStarted = GetTime and GetTime() or 0
  if not giveFrame then
    giveFrame = CreateFrame("Frame")
    giveFrame:SetScript("OnEvent", function(_, event, ...)
      local current = giving
      if not current or #current.events >= MAX_GIVE_EVENTS then return end
      local args = {}
      for i = 1, select("#", ...) do args[i] = str((select(i, ...))) end
      local after = GetTime and string.format("%.1f", GetTime() - giveStarted) or nil
      current.events[#current.events + 1] = { event = event, after = after, args = args }
    end)
  end
  for _, event in ipairs(GIVE_EVENTS) do pcall(giveFrame.RegisterEvent, giveFrame, event) end

  out("giving slot " .. slot .. " (" .. str(itemName) .. ") to candidate " .. candidate.index .. " (" .. candidate.name .. ")...")
  local ok, result = pcall(give, slot, candidate.index)
  record.called, record.result = ok, str(result)
  if C_Timer and C_Timer.After then
    C_Timer.After(GIVE_SECONDS, function() finishGive(record) end)
  else
    finishGive(record)
  end
end

local function giveCommand(rest)
  rest = rest or ""
  if rest == "" then listLootSlots() return end
  local slot, what = string.match(rest, "^(%d+)%s+(.+)$")
  if not slot then out("Use /ip give to list the slots, then /ip give <slot> <candidate number or full name>.") return end
  startGive(tonumber(slot), what)
end

---------------------------------------------------------------------------------------------------------------
-- Group: who is in the group, in the game's own terms (names kept as their form only), and who the loot master is.
---------------------------------------------------------------------------------------------------------------

local MAX_GROUP_ROWS = 40

-- One group member by unit name ("player", "party1", "raid7").
local function unitRow(unit)
  local _, classToken = UnitClass(unit)
  return {
    unit = unit, name = shape(GetUnitName(unit, true)), first = shape(UnitName(unit)),
    leader = ask(UnitIsGroupLeader, unit), assistant = ask(UnitIsGroupAssistant, unit),
    level = UnitLevel(unit), class = classToken, connected = ask(UnitIsConnected, unit),
    role = ask(UnitGroupRolesAssigned, unit),
  }
end

local function groupSnapshot()
  local snap = {
    at = now(), inGroup = IsInGroup and IsInGroup() or false, inRaid = IsInRaid and IsInRaid() or false,
    size = GetNumGroupMembers and GetNumGroupMembers() or 0, leader = ask(UnitIsGroupLeader, "player"),
    inInstance = ask(IsInInstance), units = {}, roster = {},
  }
  -- every value the loot method function returns (the master looter may be in the second or third)
  local method = lookup("C_PartyInfo.GetLootMethod")
  if method then
    local ok, list = returns(method)
    snap.lootMethod = ok and list or { "ERROR: " .. (list[1] or "") }
  end
  if exists("GetLootThreshold") then snap.threshold = str(safe(GetLootThreshold)) end

  local units = { "player" }
  if snap.inRaid then
    for index = 1, math.min(snap.size, MAX_GROUP_ROWS) do units[#units + 1] = "raid" .. index end
  else
    for index = 1, 4 do units[#units + 1] = "party" .. index end
  end
  for _, unit in ipairs(units) do
    if UnitExists and UnitExists(unit) then
      local ok, row = pcall(unitRow, unit)
      snap.units[#snap.units + 1] = ok and row or { unit = unit, error = string.sub(tostring(row), 1, 120) }
    end
  end

  -- the raid roster, which also says who the master looter is (the eleventh value)
  if exists("GetRaidRosterInfo") then
    for index = 1, math.min(snap.size, MAX_GROUP_ROWS) do
      local ok, list = returns(GetRaidRosterInfo, index)
      if ok and list[1] == "nil" then
        snap.rosterEmpty = (snap.rosterEmpty or 0) + 1 -- the game had no row for this number (a party, perhaps)
      elseif ok then
        snap.roster[#snap.roster + 1] = {
          index = index, name = shape(list[1]), rank = list[2], subgroup = list[3], level = list[4], class = list[6],
          online = list[8], dead = list[9], role = list[10], isMasterLooter = list[11], combatRole = list[12], values = #list,
        }
      else
        snap.roster[#snap.roster + 1] = { index = index, error = string.sub(list[1] or "", 1, 120) }
      end
    end
  end
  return snap
end

local function groupCommand()
  local snap = groupSnapshot()
  db.groups = db.groups or {}
  db.groups[#db.groups + 1] = snap
  local masters = {}
  for _, row in ipairs(snap.roster) do
    if row.isMasterLooter == "true" then masters[#masters + 1] = row.index end
  end
  out(string.format("group: %s of %d, you %s the leader, loot method returns [%s], %d units and %d roster rows read, master looter on roster row %s. /reload to save it.",
    snap.inRaid and "a raid" or (snap.inGroup and "a party" or "no group"), snap.size, snap.leader and "are" or "are not",
    table.concat(snap.lootMethod or {}, ","), #snap.units, #snap.roster, #masters > 0 and table.concat(masters, ",") or "none"))
end

---------------------------------------------------------------------------------------------------------------
-- Raid: turn the party into a raid with ConvertToRaid, to find out whether an addon may and what the game answers.
---------------------------------------------------------------------------------------------------------------

local RAID_EVENTS = { "ADDON_ACTION_FORBIDDEN", "ADDON_ACTION_BLOCKED", "UI_ERROR_MESSAGE", "GROUP_ROSTER_UPDATE", "PARTY_LOOT_METHOD_CHANGED", "CHAT_MSG_SYSTEM" }
local RAID_SECONDS = 3
local MAX_RAID_EVENTS = 30
local raidFrame, converting, raidStarted

local function raidOutcome(record)
  local seen = {}
  for _, e in ipairs(record.events) do seen[e.event] = true end
  if seen.ADDON_ACTION_FORBIDDEN or seen.ADDON_ACTION_BLOCKED then return "the game BLOCKED the call" end
  if not record.called then return "the call raised an error: " .. string.gsub(string.sub(record.result, 1, 80), "|", "?") end
  if record.inRaidAfter then return "the group is now a raid" end
  if seen.UI_ERROR_MESSAGE then return "the game answered with an error message (see the file)" end
  return "no change within " .. RAID_SECONDS .. " seconds"
end

local function lootMethodNow()
  local method = lookup("C_PartyInfo.GetLootMethod")
  if not method then return nil end
  local ok, list = returns(method)
  return ok and table.concat(list, ",") or nil
end

local function finishRaid(record)
  if raidFrame then
    for _, event in ipairs(RAID_EVENTS) do pcall(raidFrame.UnregisterEvent, raidFrame, event) end
  end
  if converting == record then converting = nil end
  record.inRaidAfter = IsInRaid and IsInRaid() or false
  record.sizeAfter = GetNumGroupMembers and GetNumGroupMembers() or 0
  record.lootMethodAfter = lootMethodNow()
  record.outcome = raidOutcome(record)
  out("raid result: " .. record.outcome .. ". Loot method before [" .. str(record.lootMethodBefore) .. "], after [" .. str(record.lootMethodAfter) .. "]. /reload to save it.")
end

local function startRaid()
  if converting then out("Still recording the last conversion. Wait " .. RAID_SECONDS .. " seconds.") return end
  local convert = lookup("C_PartyInfo.ConvertToRaid") or lookup("ConvertToRaid")
  if type(convert) ~= "function" then out("ConvertToRaid does not exist here.") return end
  if not (IsInGroup and IsInGroup()) then out("You are not in a group. Invite someone first.") return end
  if IsInRaid and IsInRaid() then out("The group is already a raid.") return end
  if UnitIsGroupLeader and not UnitIsGroupLeader("player") then out("Only the party leader can convert it. You are not the leader.") return end

  local record = {
    t = now(), inRaidBefore = false, sizeBefore = GetNumGroupMembers and GetNumGroupMembers() or 0,
    inInstance = ask(IsInInstance), lootMethodBefore = lootMethodNow(), loggingWasOn = logging, events = {},
  }
  db.raids = db.raids or {}
  db.raids[#db.raids + 1] = record

  converting = record
  raidStarted = GetTime and GetTime() or 0
  if not raidFrame then
    raidFrame = CreateFrame("Frame")
    raidFrame:SetScript("OnEvent", function(_, event, ...)
      local current = converting
      if not current or #current.events >= MAX_RAID_EVENTS then return end
      local args = {}
      for i = 1, select("#", ...) do args[i] = str((select(i, ...))) end
      local after = GetTime and string.format("%.1f", GetTime() - raidStarted) or nil
      current.events[#current.events + 1] = { event = event, after = after, args = args }
    end)
  end
  for _, event in ipairs(RAID_EVENTS) do pcall(raidFrame.RegisterEvent, raidFrame, event) end

  out("converting the party of " .. record.sizeBefore .. " to a raid...")
  local ok, result = pcall(convert)
  record.called, record.result = ok, str(result)
  if C_Timer and C_Timer.After then
    C_Timer.After(RAID_SECONDS, function() finishRaid(record) end)
  else
    finishRaid(record)
  end
end

SLASH_INTREPIDPROBE1 = "/ip"
SLASH_INTREPIDPROBE2 = "/intrepidprobe"
local function handle(input)
  local command, rest = string.match(input or "", "^(%S*)%s*(.-)$")
  command = string.lower(command or "")
  if not db then out("Not ready yet.") return end
  if command == "probe" then
    probe()
  elseif command == "log" then
    rest = string.lower(rest or "")
    if rest == "on" then setLogging(true)
    elseif rest == "off" then setLogging(false)
    elseif rest == "clear" then db.events = {}; db.messages = {}; out("Cleared.")
    else out("Use /ip log on, /ip log off or /ip log clear.") end
  elseif command == "msg" then
    sendTest(rest)
  elseif command == "ej" then
    dumpEncounterJournal()
  elseif command == "whisper" then
    local first, last, text = string.match(rest or "", "^(%S+)%s+(%S+)%s*(.*)$")
    if not first then out("Use /ip whisper First Surname [text]") return end
    local register = lookup("C_ChatInfo.RegisterAddonMessagePrefix")
    local send = lookup("C_ChatInfo.SendAddonMessage")
    if not send then out("No addon message API.") return end
    if register then pcall(register, PREFIX) end
    local target = first .. " " .. last
    local result = enumName("Enum.SendAddonMessageResult", safe(send, PREFIX, (text ~= "" and text or "hello by whisper"), "WHISPER", target))
    db.messages = db.messages or {}
    db.messages[#db.messages + 1] = { t = now(), event = "sent-whisper", target = target, result = result, restrictedBefore = restrictedNow() }
    out("whisper to " .. target .. ": result " .. result .. ", outgoing restricted: " .. restrictedNow())
  elseif command == "invite" then
    if rest == "" then out("Use /ip invite First Surname") return end
    local fn = lookup("C_PartyInfo.InviteUnit")
    if not fn then out("C_PartyInfo.InviteUnit does not exist here.") return end
    local ok, result = pcall(fn, rest)
    db.invites = db.invites or {}
    db.invites[#db.invites + 1] = { t = now(), name = rest, ok = ok, result = str(result) }
    out("invite " .. rest .. ": " .. (ok and ("called, returned " .. str(result)) or ("failed: " .. str(result))))
  elseif command == "bundle" then
    if ns.bundle and ns.bundle.run then
      ns.bundle.run(rest)
    else
      out("Bundle.lua did not load. Check that the whole IntrepidProbe folder was copied, then restart the game.")
    end
  elseif command == "paste" then
    pasteCommand(rest)
  elseif command == "bags" then
    scanBags()
  elseif command == "give" then
    giveCommand(rest)
  elseif command == "group" then
    groupCommand()
  elseif command == "raid" then
    startRaid()
  elseif command == "history" then
    dumpLootHistory()
  elseif command == "run" then
    if rest == "" then
      out("run label: " .. (db.run and db.run.label or "none") .. " (addon " .. str(db.addonVersion) .. ")")
    else
      db.run = { label = rest, startedAt = now(), version = db.addonVersion }
      db.runs = db.runs or {}
      db.runs[#db.runs + 1] = db.run
      out("run label set: " .. rest .. " (addon " .. str(db.addonVersion) .. "). Give each test its own label, then /reload when it is done.")
    end
  elseif command == "show" then
    out("addon " .. str(db.addonVersion) .. ", run: " .. (db.run and db.run.label or "none"))
    local build = db.probe and db.probe.build
    out("probe: " .. (db.probe and db.probe.at or "not run") .. (build and (" (interface " .. str(build.interface) .. ")") or ""))
    out("events recorded: " .. (db.events and #db.events or 0) .. ", messages: " .. (db.messages and #db.messages or 0) .. ", logging: " .. (logging and "on" or "off"))
    local lines = {}
    for prefix, row in pairs(db.traffic or {}) do lines[#lines + 1] = prefix .. " x" .. row.count end
    out("addon messages received so far, by prefix: " .. (#lines > 0 and table.concat(lines, ", ") or "none"))
  else
    out("/ip bundle [label], /ip probe, /ip log on, /ip log off, /ip log clear, /ip msg [text], /ip whisper First Surname [text], /ip ej, /ip invite First Surname")
    out("/ip bags, /ip give, /ip group, /ip raid, /ip history, /ip run [label], /ip paste, /ip show")
  end
end

SlashCmdList["INTREPIDPROBE"] = function(input)
  local ok, err = pcall(handle, input)
  if not ok then
    out("ERROR: " .. tostring(err))
    if db then db.lastError = { at = now(), command = tostring(input), error = tostring(err) } end
  end
end

-- What Bundle.lua (loaded after this file) needs from here.
ns.probe = {
  out = out, str = str, lookup = lookup, exists = exists, safe = safe, now = now, itemId = itemId,
  prefix = PREFIX,
  getDb = function() return db end,
  probe = probe,
  dumpEncounterJournal = dumpEncounterJournal,
  setLogging = setLogging,
  isLogging = function() return logging end,
  -- Registers the log's events again (when the log is on), after something else has unregistered them.
  refreshLogging = function()
    if not logging then return end
    for _, name in ipairs(LOG_EVENTS) do pcall(frame.RegisterEvent, frame, name) end
  end,
}

frame:RegisterEvent("ADDON_LOADED")
frame:SetScript("OnEvent", onEvent)
