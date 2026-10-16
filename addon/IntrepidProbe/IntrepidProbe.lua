-- Intrepid Probe: a developer tool for finding out what the client offers before we write the real loot addon.
-- It records facts into its own saved variables (IntrepidProbeDB), which the client writes to disk on /reload or logout.
--
--   /ip probe            record the client version, which APIs and events exist, the player, the group and the addons
--   /ip log on|off       record loot and boss events (loot windows, boss kills, loot rolls, trades, chat loot lines)
--   /ip log clear        forget recorded events
--   /ip msg [text]       send a test addon message (to the raid or party, or to yourself) and record the round trip
--   /ip invite Name      invite a player to the party (tests whether an addon may do this)
--   /ip ej               dump the in-game Encounter Journal (instances, bosses, loot) to the saved variables
--   /ip show             print a short summary
--
-- Nothing here changes the game. It only reads and records.

local ADDON, ns = ...
local PREFIX = "IPROBE"
local MAX_EVENTS = 800

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

-- Name of an enum value, for example the result of sending an addon message.
local function enumName(path, value)
  local enum = lookup(path)
  if type(enum) ~= "table" then return str(value) end
  for key, number in pairs(enum) do if number == value then return key .. "(" .. str(value) .. ")" end end
  return str(value)
end

-- Does a global such as "GiveMasterLoot" or a field such as "C_Item.GetItemInfo" exist?
local function lookup(path)
  local value = _G
  for part in string.gmatch(path, "[^%.]+") do
    if type(value) ~= "table" then return nil end
    value = value[part]
    if value == nil then return nil end
  end
  return value
end

local function exists(path) return lookup(path) ~= nil end

local function now() return date("%Y-%m-%d %H:%M:%S") end

local function itemId(link)
  if type(link) ~= "string" then return nil end
  return tonumber(string.match(link, "item:(%d+)"))
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
  "GetContainerItemLink", "C_Container.GetContainerNumSlots", "C_TooltipInfo", "C_Item.RequestLoadItemDataByID",
  -- trade
  "InitiateTrade", "AddTradeMoney", "GetTradePlayerItemLink", "ClickTradeButton", "AcceptTrade",
  -- group, instance and encounter data
  "IsInRaid", "IsInGroup", "GetNumGroupMembers", "GetRaidRosterInfo", "GetInstanceInfo", "GetDifficultyInfo", "UnitGroupRolesAssigned",
  "C_EncounterJournal", "EJ_GetEncounterInfo", "EJ_GetInstanceInfo", "GetSavedInstanceInfo",
  -- people
  "UnitName", "UnitFullName", "UnitClass", "UnitGUID", "GetRealmName", "GetNormalizedRealmName", "Ambiguate", "GetGuildInfo", "GetGuildRosterInfo",
  -- addon communication and timers
  "C_ChatInfo.SendAddonMessage", "C_ChatInfo.RegisterAddonMessagePrefix", "C_ChatInfo.SendAddonMessageLogged", "C_ChatInfo.InChatMessagingLockdown",
  "SendAddonMessage", "RegisterAddonMessagePrefix", "C_Timer.After", "C_Timer.NewTicker",
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

local function probe()
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
  "LOOT_OPENED", "LOOT_READY", "LOOT_CLOSED", "LOOT_SLOT_CLEARED", "LOOT_BIND_CONFIRM", "OPEN_MASTER_LOOT_LIST",
  "START_LOOT_ROLL", "CANCEL_LOOT_ROLL", "LOOT_ROLLS_COMPLETE", "LOOT_HISTORY_FULL_UPDATE", "LOOT_HISTORY_ROLL_CHANGED",
  "CHAT_MSG_LOOT", "PARTY_LOOT_METHOD_CHANGED", "GROUP_ROSTER_UPDATE",
  "ENCOUNTER_START", "ENCOUNTER_END", "BOSS_KILL", "ENCOUNTER_LOOT_RECEIVED",
  "TRADE_SHOW", "TRADE_CLOSED", "TRADE_ACCEPT_UPDATE", "PLAYER_ENTERING_WORLD", "ZONE_CHANGED_NEW_AREA",
  "ADDON_RESTRICTION_STATE_CHANGED",
}

local logging = false

local function record(event, extra, ...)
  db.events = db.events or {}
  local args = {}
  for i = 1, select("#", ...) do args[i] = str((select(i, ...))) end
  local instanceName, _, difficultyID, _, maxPlayers = GetInstanceInfo()
  local entry = { t = now(), up = GetTime and string.format("%.1f", GetTime()) or nil, event = event, args = args, zone = instanceName, difficulty = difficultyID, size = maxPlayers }
  if extra then entry.extra = extra end
  local list = db.events
  list[#list + 1] = entry
  if #list > MAX_EVENTS then table.remove(list, 1) end
end

local function lootWindow()
  local slots = {}
  local count = exists("GetNumLootItems") and GetNumLootItems() or 0
  for slot = 1, count do
    local icon, name, quantity, currencyID, quality, locked
    if exists("GetLootSlotInfo") then icon, name, quantity, currencyID, quality, locked = GetLootSlotInfo(slot) end
    local link = exists("GetLootSlotLink") and GetLootSlotLink(slot) or nil
    local slotType = exists("GetLootSlotType") and GetLootSlotType(slot) or nil
    local candidates = 0
    if exists("GetMasterLootCandidate") then
      for index = 1, 40 do if GetMasterLootCandidate(slot, index) then candidates = candidates + 1 end end
    end
    local sourceGuid = exists("GetLootSourceInfo") and (GetLootSourceInfo(slot)) or nil
    local npcId = sourceGuid and tonumber(string.match(tostring(sourceGuid), "^Creature%-%d+%-%d+%-%d+%-%d+%-(%d+)")) or nil
    slots[#slots + 1] = { slot = slot, name = name, itemId = itemId(link), link = link, quantity = quantity, quality = quality, locked = locked, slotType = slotType, masterLootCandidates = candidates, sourceGuid = sourceGuid, npcId = npcId }
  end
  local target = UnitName and UnitName("target") or nil
  return { slots = slots, target = target, targetGuid = UnitGUID and UnitGUID("target") or nil }
end

local function onEvent(_, event, ...)
  if event == "ADDON_LOADED" then
    if select(1, ...) ~= ADDON then return end
    IntrepidProbeDB = IntrepidProbeDB or {}
    db = IntrepidProbeDB
    pcall(frame.RegisterEvent, frame, "CHAT_MSG_ADDON") -- always on, so the message test can show what comes back
    pcall(frame.RegisterEvent, frame, "ADDON_RESTRICTION_STATE_CHANGED")
    local registerPrefix = lookup("C_ChatInfo.RegisterAddonMessagePrefix") or lookup("RegisterAddonMessagePrefix")
    if registerPrefix then db.prefixRegisteredAtLoad = enumName("Enum.RegisterAddonMessagePrefixResult", safe(registerPrefix, PREFIX)) end
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
  if event == "LOOT_OPENED" or event == "LOOT_READY" then
    record(event, safe(lootWindow), ...)
  elseif event == "ENCOUNTER_END" or event == "ENCOUNTER_START" or event == "BOSS_KILL" then
    record(event, nil, ...)
  elseif event == "CHAT_MSG_LOOT" then
    local text = ...
    record(event, { itemId = itemId(text) }, ...)
  else
    record(event, nil, ...)
  end
end

local function setLogging(on)
  logging = on
  for _, name in ipairs(LOG_EVENTS) do
    if on then pcall(frame.RegisterEvent, frame, name) else pcall(frame.UnregisterEvent, frame, name) end
  end
  db.loggingSince = on and now() or nil
  out("Event log " .. (on and "ON. Do the thing you want to test (open a corpse, kill a boss, trade), then /reload." or "OFF.") .. " Events recorded so far: " .. (db.events and #db.events or 0))
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

local function dumpEncounterJournal()
  db.ej = { at = now(), instances = {}, notes = {} }
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
    out("Encounter Journal functions missing: see /ip show after /reload. Nothing dumped.")
    return
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
  for tier = 1, math.min(tiers, 30) do
    pcall(EJ_SelectTier, tier)
    for _, isRaid in ipairs({ false, true }) do
      for index = 1, 80 do
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
        end
      end
    end
  end
  out(string.format("Encounter Journal: %d tiers, %d instances, %d bosses, %d items. Type /reload to save.", tiers, instanceCount, bossCount, itemCount))
end

---------------------------------------------------------------------------------------------------------------
-- Commands
---------------------------------------------------------------------------------------------------------------

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
  elseif command == "show" then
    local build = db.probe and db.probe.build
    out("probe: " .. (db.probe and db.probe.at or "not run") .. (build and (" (interface " .. str(build.interface) .. ")") or ""))
    out("events recorded: " .. (db.events and #db.events or 0) .. ", messages: " .. (db.messages and #db.messages or 0) .. ", logging: " .. (logging and "on" or "off"))
    local lines = {}
    for prefix, row in pairs(db.traffic or {}) do lines[#lines + 1] = prefix .. " x" .. row.count end
    out("addon messages received so far, by prefix: " .. (#lines > 0 and table.concat(lines, ", ") or "none"))
  else
    out("/ip probe, /ip log on|off|clear, /ip msg [text], /ip whisper First Surname [text], /ip ej, /ip invite First Surname, /ip show")
  end
end

SlashCmdList["INTREPIDPROBE"] = function(input)
  local ok, err = pcall(handle, input)
  if not ok then
    out("ERROR: " .. tostring(err))
    if db then db.lastError = { at = now(), command = tostring(input), error = tostring(err) } end
  end
end

frame:RegisterEvent("ADDON_LOADED")
frame:SetScript("OnEvent", onEvent)
