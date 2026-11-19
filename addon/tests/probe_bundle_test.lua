-- The probe's /ip bundle (IntrepidProbe/Bundle.lua) against stand-ins for the game: a full client, ones that
-- block or break things, and one that has almost nothing. A helper runs the bundle once on their own computer, so it has
-- to finish and save whatever the client does. Invented names only. See AGENTS.md.

local FILES = { "IntrepidProbe", "Items", "Bundle" }
local PLAYER_FIRST, PLAYER_SURNAME = "Zzyxel", "Quorrin"
local GUILD_NAMES = { "Mirelle Dunmore", "Tobin Ashvale", "Orrin Vale" }

local function newWidget()
  local widget = { _events = {}, _scripts = {} }
  -- every method that is not defined below exists and does nothing
  setmetatable(widget, { __index = function() return function() end end })
  widget.RegisterEvent = function(self, event) self._events[event] = true end
  widget.UnregisterEvent = function(self, event) self._events[event] = nil end
  widget.SetScript = function(self, name, fn) self._scripts[name] = fn end
  widget.Hide = function(self) self._hidden = true end
  return widget
end

-- A game with a clock that moves by one millisecond per reading, timers that run when pump() is called, and events
-- that run when fire() is called.
local function newGame(options)
  options = options or {}
  local game = { printed = {}, timers = {}, seconds = 0, clockMs = 0, frames = {}, requested = {}, seq = 0 }
  local env = { _G = nil }
  env._G = env
  setmetatable(env, { __index = _G })

  env.print = function(text) game.printed[#game.printed + 1] = tostring(text) end
  env.SlashCmdList = {}
  local dateReads = 0
  env.date = function() -- a different time on every reading, so a timestamp that is renewed by mistake shows
    dateReads = dateReads + 1
    return string.format("2026-10-19 22:%02d:%02d", math.floor(dateReads / 60) % 60, dateReads % 60)
  end
  env.time = function() return 1792461216 end
  env.GetTime = function() return game.seconds end
  env.GetServerTime = function() return 1792461216 end
  env.GetFramerate = function() return 60 end
  if not options.noClock then
    env.debugprofilestop = function()
      game.clockMs = game.clockMs + (options.clockStep or 1)
      return game.clockMs
    end
  end
  if not options.noTimer then
    env.C_Timer = { After = function(seconds, fn)
      game.seq = game.seq + 1
      game.timers[#game.timers + 1] = { at = game.seconds + seconds, fn = fn, seq = game.seq }
    end }
  end

  env.CreateFrame = function(_, _, _, template)
    if template and (options.allTemplatesBad or (options.badTemplates and options.badTemplates[template])) then
      error('Couldn\'t find inherited node "' .. template .. '"')
    end
    local widget = newWidget()
    game.frames[#game.frames + 1] = widget
    return widget
  end
  if not options.hostile then
    env.UIParent = newWidget()
    env.UIParent.GetScale = function() return 0.9 end
  end

  env.GetBuildInfo = function() return "1.60.1", "70450", "Oct 15 2026", 16001 end
  env.GetLocale = function() return "enUS" end
  env.GetCVar = function(name) return ({ portal = "test", useUiScale = "1", uiScale = "0.9", autoLootDefault = "0" })[name] end
  local members = options.members or {} -- unit -> { first, full, leader, assistant, level, class, role, connected }
  env.UnitName = function(unit) return members[unit] and members[unit].first or PLAYER_FIRST end
  env.GetUnitName = function(unit, full)
    if members[unit] then return full and members[unit].full or members[unit].first end
    return full and (PLAYER_FIRST .. " " .. PLAYER_SURNAME) or PLAYER_FIRST
  end
  env.UnitExists = function(unit) return unit == "player" or members[unit] ~= nil end
  env.UnitIsGroupLeader = function(unit)
    if members[unit] then return members[unit].leader == true end
    return not options.notLeader
  end
  env.UnitIsGroupAssistant = function(unit) return members[unit] ~= nil and members[unit].assistant == true end
  env.UnitIsConnected = function(unit) return not (members[unit] and members[unit].connected == false) end
  env.UnitGroupRolesAssigned = function(unit) return members[unit] and members[unit].role or "NONE" end
  env.IsInInstance = function() return options.inInstance ~= false, "party" end
  env.GetRaidRosterInfo = function(index)
    if options.rosterRaises then error("boom from the roster") end
    local row = options.roster and options.roster[index]
    if not row then return nil end
    return row.full, row.rank, row.subgroup, row.level, row.className, row.fileName, "Stub Zone", row.online, false, row.role, row.isML, row.combatRole
  end
  env.UnitFullName = function() return PLAYER_FIRST, PLAYER_SURNAME end
  env.UnitClass = function() return "Warrior", "WARRIOR", 1 end
  env.UnitLevel = function(unit) return members[unit] and members[unit].level or options.level or 20 end
  env.UnitGUID = function() return "Player-4381-0A1B2C3D" end
  env.GetRealmName = function() return PLAYER_SURNAME end
  env.GetNormalizedRealmName = function() return PLAYER_SURNAME end
  env.Ambiguate = function(name) return name end
  env.GetGuildInfo = function() return "Test Guild Name" end
  env.IsInGroup = function() return options.inGroup == true end
  env.IsInRaid = function() return game.raid == true end
  env.GetNumGroupMembers = function() return options.groupSize or (options.inGroup and 2 or 0) end
  env.GetInstanceInfo = function() return "Stub Dungeon", "party", 1, "Normal", 5, 0, false, 33 end
  env.IsInGuild = function() return options.noGuild ~= true end
  env.IsWindowsClient = function() return true end
  env.IsMacClient = function() return false end

  env.Enum = { LootMethod = { Freeforall = 0, Group = 3 }, ItemQuality = { Poor = 0, Common = 1, Uncommon = 2 } }
  env.C_ChatInfo = { AreOutgoingAddonChatMessagesRestricted = function() return true end, RegisterAddonMessagePrefix = function() return 0 end }
  env.C_AddOns = {
    GetNumAddOns = function() return 2 end,
    GetAddOnInfo = function(i) return ({ "IntrepidProbe", "OtherAddon" })[i] end,
    IsAddOnLoaded = function() return true end,
    GetAddOnMetadata = function(_, field) return field == "Version" and "0.6.2" or nil end,
    LoadAddOn = function() end,
  }
  env.C_PartyInfo = {
    GetLootMethod = function()
      if options.lootMethodReturns then return unpack(options.lootMethodReturns, 1, options.lootMethodReturns.n or #options.lootMethodReturns) end
      return 3
    end,
    IsLootMethodAvailable = function() return true end,
    CanInvite = function() return true end,
    InviteUnit = function(name)
      if options.inviteRaises then error("boom from the invite") end
      game.invited = name
      if options.inviteBlocked then game.fire("ADDON_ACTION_FORBIDDEN", "IntrepidProbe", "InviteUnit") end
    end,
    ConvertToRaid = function()
      game.converted = (game.converted or 0) + 1
      if options.raidRaises then error(type(options.raidRaises) == "string" and options.raidRaises or "boom from ConvertToRaid") end
      if options.raidBlocked then game.fire("ADDON_ACTION_FORBIDDEN", "IntrepidProbe", "ConvertToRaid") return end
      if options.raidError then game.fire("UI_ERROR_MESSAGE", 77, "You cannot do that in a dungeon group.") return end
      if options.raidFlood then
        for n = 1, 40 do game.fire("UI_ERROR_MESSAGE", n, "Too many things.") end
        return
      end
      if options.raidSilent or not options.inGroup then return end
      if env.C_Timer then
        env.C_Timer.After(0.2, function()
          game.raid = true
          game.fire("GROUP_ROSTER_UPDATE")
          game.fire("CHAT_MSG_SYSTEM", "You have converted the party to a raid group.")
        end)
      else
        game.raid = true
      end
    end,
  }
  if options.hostile then env.C_PartyInfo = {} end

  if not options.hostile then
    env.EJ_GetNumTiers = function() return 1 end
    env.EJ_SelectTier = function() end
    env.EJ_GetInstanceByIndex = function(index, isRaid)
      if not isRaid and index <= 2 then return 100 + index, "Stub Dungeon " .. index end
    end
    env.EJ_SelectInstance = function() end
    env.EJ_GetEncounterInfoByIndex = function(e) if e <= 3 then return "Boss " .. e, "", 1000 + e end end
    env.EJ_SelectEncounter = function() end
    env.EJ_GetNumLoot = function() return 4 end
    env.C_EncounterJournal = { GetLootInfoByIndex = function(i) return { itemID = 5000 + i, name = "Stub Item " .. i } end }

    local function idOf(arg)
      if type(arg) == "number" then return arg end
      return tonumber(string.match(tostring(arg), "item:(%d+)"))
    end
    local function known(id) return id and id < 250000 end
    env.C_Item = {
      RequestLoadItemDataByID = function(id) game.requested[#game.requested + 1] = id end,
      GetItemInfo = function(arg)
        local id = idOf(arg)
        if known(id) then return "Item " .. id, "link", 2, 10, 5, "Armor", "Cloth", 1, "INVTYPE_CHEST", 123, 100, 4, 1, 1 end
      end,
      GetItemInfoInstant = function(arg)
        local id = idOf(arg)
        if id and id < 290000 then return id, "Armor", "Cloth", "INVTYPE_CHEST", 123, 4, 1 end
      end,
    }
    env.C_GuildInfo = { GuildRoster = function()
      game.rosterRequested = true
      if not options.noRosterEvent then env.C_Timer.After(0.5, function() game.fire("GUILD_ROSTER_UPDATE") end) end
    end }
    env.GetNumGuildMembers = function()
      if options.guildRaises then error("boom from the guild roster") end
      return #GUILD_NAMES, 2
    end
    env.GetGuildRosterInfo = function(i) return GUILD_NAMES[i], "Rank", i - 1, 20 + i, "Priest", "Zone", "", "", i < 3, 0, "PRIEST" end

    -- two item slots; with moneySlot the first of three slots is money; with noLoot there is no window
    local function isMoney(slot) return options.moneySlot and slot == 1 end
    env.GetNumLootItems = function()
      if options.noLoot then return 0 end
      return options.moneySlot and 3 or 2
    end
    env.GetLootSlotInfo = function(slot) return 1, "Stub " .. slot, 1, nil, 2, false end
    env.GetLootSlotLink = function(slot)
      if isMoney(slot) then return nil end
      return "|cff1eff00|Hitem:" .. (1000 + slot) .. "::::::::20:::::::::|h[Stub " .. slot .. "]|h|r"
    end
    env.GetLootSlotType = function(slot) return isMoney(slot) and 2 or 1 end
    if not options.noRollApi then
      env.GetLootRollItemLink = function(id)
        if options.rollRaises then error("boom from the roll") end
        return "|cff1eff00|Hitem:" .. (4000 + id) .. "::::::::20:::::::::|h[Stub Roll " .. id .. "]|h|r"
      end
      -- every field differs from its neighbors, so a value read from the wrong place shows
      env.GetLootRollItemInfo = function(id) return 135, "Stub Roll " .. id, 3, 2, true, false, true, false, "Cannot need this", nil, "Not an enchanter", 300, true end
      env.C_Loot = { GetLootRollDuration = function() return 60 end }
    end
    if options.history then
      game.historyReads, game.historyCalls = 0, {} -- how often the list was read, and what the probe asked for
      env.C_LootHistory = {
        GetAllEncounterInfos = function()
          if options.historyRaises then error("boom from the history") end
          game.historyReads = game.historyReads + 1
          -- an encounter as a bare number, as a function, with encounterID, and as a list with the id first
          if options.historyOdd then return { 3495, function() end, { encounterID = 7, junk = 0 / 0 }, { 8, "a list" } } end
          if options.historyHuge then
            local loop, many = {}, {}
            loop.me = loop
            for n = 1, 60 do many[n] = n end
            return { { encounterID = 3495, encounterName = string.rep("x", 300), deep = { deeper = { deepest = { bottom = 1 } } }, loop = loop, many = many } }
          end
          return { { encounterID = 3495, encounterName = "Stub Boss", startTime = game.historyReads } }
        end,
        GetSortedDropsForEncounter = function(id)
          game.historyCalls[#game.historyCalls + 1] = { "drops", id }
          if options.historyOdd then return { 5, { 6, "a list" }, { lootListID = 7 } } end
          return { { lootListID = 1, itemHyperlink = "|cff1eff00|Hitem:5001::::::::20:::::::::|h[Stub Drop]|h|r" } }
        end,
        GetSortedInfoForDrop = function(id, lootListID)
          game.historyCalls[#game.historyCalls + 1] = { "info", id, lootListID }
          return { lootListID = lootListID, winner = { playerName = "Mirelle Dunmore", roll = 77, state = 4 }, rollInfos = { { playerName = "Mirelle Dunmore", roll = 77 }, { playerName = "Tobin Ashvale", roll = 12 } } }
        end,
      }
    end
    if not options.noGive then
      env.GiveMasterLoot = function(slot, index)
        game.gave = game.gave or {}
        game.gave[#game.gave + 1] = { slot = slot, index = index }
        if options.giveRaises then error(type(options.giveRaises) == "string" and options.giveRaises or "boom from GiveMasterLoot") end
        if options.giveBlocked then game.fire("ADDON_ACTION_FORBIDDEN", "IntrepidProbe", "GiveMasterLoot") return end
        if options.giveProtected then game.fire("ADDON_ACTION_BLOCKED", "IntrepidProbe", "GiveMasterLoot") return end
        if options.giveChatOnly then
          env.C_Timer.After(0.3, function() game.fire("CHAT_MSG_LOOT", "Mirelle Dunmore receives loot: [Stub " .. slot .. "].") end)
          return
        end
        if options.giveConfirms then game.fire("CONFIRM_LOOT_DISTRIBUTION", slot, "Mirelle Dunmore") return end
        if options.giveErrors then game.fire("UI_ERROR_MESSAGE", 99, "Inventory is full.") return end
        if options.giveFlood then
          for n = 1, 40 do game.fire("UI_ERROR_MESSAGE", n, "Too many things.") end
          return
        end
        if options.giveSilent then return end
        if env.C_Timer then
          env.C_Timer.After(0.3, function()
            game.fire("LOOT_SLOT_CLEARED", slot)
            game.fire("CHAT_MSG_LOOT", "Mirelle Dunmore receives loot: [Stub " .. slot .. "].")
          end)
        end
      end
    end
    env.GetMasterLootCandidate = function(_, index) return options.candidates and options.candidates[index] or nil end
    env.GetLootThreshold = function() return 2 end
    env.GetTradePlayerItemLink = function(slot)
      if options.tradeRaises then error("boom from the trade window") end
      return game.trade and game.trade.player[slot] or nil
    end
    env.GetTradeTargetItemLink = function(slot) return game.trade and game.trade.target[slot] or nil end
    if options.bags then
      local function entry(bag, slot) return options.bags[bag] and options.bags[bag][slot] end
      env.C_Container = {
        GetContainerNumSlots = function(bag)
          local highest = 0
          for slot in pairs(options.bags[bag] or {}) do if slot > highest then highest = slot end end
          return highest
        end,
        GetContainerItemInfo = function(bag, slot)
          local found = entry(bag, slot)
          if found and found.raises then error("boom from the bag") end
          return found and found.info or nil
        end,
      }
      if not options.noTooltipApi then
        env.C_TooltipInfo = { GetBagItem = function(bag, slot)
          local found = entry(bag, slot)
          if not (found and found.tip) then return nil end
          local lines = {}
          for index, text in ipairs(found.tip) do lines[index] = { leftText = text } end
          return { lines = lines }
        end }
      end
    end
    env.GetLootSourceInfo = function() return "Creature-0-4381-33-5-644-0000ABCDEF" end
    env.UnitGUID = function() return "Player-4381-0A1B2C3D" end
    env.LOOT_ITEM_SELF = "You receive loot: %s."
    env.LOOT_ROLL_NEED = "%s has selected Need for: %s"
    env.ERR_TRADE_COMPLETE = "Trade complete."
    env.BIND_TRADE_TIME_REMAINING = "You may trade this item with players that were eligible to loot it for the next %s."
    env.ITEM_SOULBOUND = "Soulbound"
    env.UNRELATED_TEXT = "not wanted"
  end

  function game.fire(event, ...)
    for _, widget in ipairs(game.frames) do
      if widget._events[event] and widget._scripts.OnEvent then widget._scripts.OnEvent(widget, event, ...) end
    end
  end

  -- Runs the pending timers in time order until none is left (or until `limit` seconds of game time).
  function game.pump(limit)
    limit = limit or 600
    for _ = 1, 100000 do
      local best, bestIndex
      for index, timer in ipairs(game.timers) do
        if not best or timer.at < best.at or (timer.at == best.at and timer.seq < best.seq) then best, bestIndex = timer, index end
      end
      if not best or best.at > limit then return end
      table.remove(game.timers, bestIndex)
      if best.at > game.seconds then game.seconds = best.at end
      best.fn()
    end
    error("the timers never ran out")
  end

  env.IntrepidProbeDB = options.savedDb -- what the client loaded from the saved file, if there was one
  local ns = {}
  for _, name in ipairs(FILES) do
    local chunk = assert(loadfile("IntrepidProbe/" .. name .. ".lua"))
    setfenv(chunk, env)
    chunk("IntrepidProbe", ns)
  end
  game.env, game.ns = env, ns
  game.fire("ADDON_LOADED", "IntrepidProbe")
  function game.say(text) env.SlashCmdList.INTREPIDPROBE(text) end
  function game.output() return table.concat(game.printed, "\n") end
  function game.db() return env.IntrepidProbeDB end
  return game
end

-- Whether a value can be saved by the client: strings, finite numbers, booleans and tables with such keys, no cycles.
local function assertSavable(value, path, ancestors)
  local kind = type(value)
  if kind == "string" or kind == "boolean" then return end
  if kind == "number" then
    if value ~= value or value == math.huge or value == -math.huge then error(path .. ": not a finite number", 0) end
    return
  end
  if kind ~= "table" then error(path .. ": a " .. kind .. " cannot be saved", 0) end
  ancestors = ancestors or {}
  if ancestors[value] then error(path .. ": a table that contains itself", 0) end
  ancestors[value] = true
  for key, item in pairs(value) do
    local keyKind = type(key)
    if keyKind ~= "string" and keyKind ~= "number" then error(path .. ": a key of type " .. keyKind, 0) end
    assertSavable(item, path .. "." .. tostring(key), ancestors)
  end
  ancestors[value] = nil
end

local function contains(value, needle)
  if type(value) == "string" then return value:find(needle, 1, true) ~= nil end
  if type(value) ~= "table" then return false end
  for key, item in pairs(value) do
    if contains(key, needle) or contains(item, needle) then return true end
  end
  return false
end

local function sizeOf(value)
  if type(value) == "string" then return #value + 4 end
  if type(value) ~= "table" then return 8 end
  local total = 8
  for key, item in pairs(value) do total = total + sizeOf(key) + sizeOf(item) end
  return total
end

local function runBundle(game, label)
  game.say("bundle " .. (label or "tester"))
  game.pump()
  return game.db()
end

local STEP_NAMES = { "client and group", "names and screen", "guild", "window templates", "invite and raid conversion",
  "message texts", "API names", "Encounter Journal", "item ids from the loot tables" }

-- The item ids the bundle asks about.
local function itemIds()
  local ns = {}
  assert(loadfile("IntrepidProbe/Items.lua"))("IntrepidProbe", ns)
  return ns.ITEM_IDS
end

test("the files load and the commands are there", function()
  local game = newGame()
  is_true(type(game.env.SlashCmdList.INTREPIDPROBE) == "function")
  is_true(type(game.ns.bundle.run) == "function")
  eq(#game.ns.bundle.steps, #STEP_NAMES)
  for index, name in ipairs(STEP_NAMES) do eq(game.ns.bundle.steps[index].name, name) end
  eq(game.db().addonVersion, "0.6.2")
end)

test("a full client: every step finishes without a problem and the log is switched on", function()
  local game = newGame()
  local db = runBundle(game, "tester")
  local bundle = db.bundle
  is_true(bundle.finishedAt ~= nil)
  eq(bundle.problems, 0)
  eq(bundle.label, "tester")
  eq(db.run.label, "tester")
  for _, name in ipairs(STEP_NAMES) do
    if not bundle.steps[name] then error("no record of the step " .. name) end
    eq(bundle.steps[name].ok, true)
  end
  is_true(game.ns.probe.isLogging())
  is_true(db.loggingSince ~= nil)
  is_true(game.output():find("Bundle finished: 9 steps, 0 with a problem.", 1, true) ~= nil)
  is_true(game.output():find("/reload", 1, true) ~= nil)
  eq(game.output():find("Ignore", 1, true) ~= nil, true)
end)

test("what the steps record", function()
  local game = newGame()
  local bundle = runBundle(game).bundle
  eq(bundle.names.unitName, "Aaaaaa")
  eq(bundle.names.unitNameWithRealm, "Aaaaaa Aaaaaaa")
  eq(bundle.names.guid, "Player-9999-9x9x9x9x")
  eq(bundle.platform.windows, true)
  eq(bundle.platform.mac, false)
  eq(bundle.platform.locale, "enUS")
  eq(bundle.platform.uiScale, 0.9)

  eq(bundle.guild.total, 3)
  eq(bundle.guild.online, 2)
  eq(#bundle.guild.members, 3)
  eq(bundle.guild.members[1].name, "Aaaaaaa Aaaaaaa")
  eq(bundle.guild.members[1].class, "PRIEST")
  eq(bundle.guild.members[1].online, true)
  eq(bundle.guild.members[3].online, false)
  eq(bundle.guild.members[2].level, 22)
  eq(bundle.guild.members[2].rankIndex, 1)

  eq(bundle.ui.templates["Frame + BackdropTemplate"], "ok")
  eq(bundle.ui.templates["StatusBar"], "ok")
  eq(bundle.ui.fonts.GameFontNormal, "nil")
  eq(bundle.ui.apis.SendChatMessage, "nil")

  eq(bundle.strings.LOOT_ITEM_SELF, "You receive loot: %s.")
  is_true(bundle.strings.BIND_TRADE_TIME_REMAINING ~= nil)
  eq(bundle.strings.UNRELATED_TEXT, nil)

  is_true(bundle.namespaces.C_Item[1] ~= nil)
  eq(bundle.namespaces.C_Secrets, false)
  local qualities = table.concat(bundle.namespaces["Enum.ItemQuality"], ",")
  is_true(qualities:find("Poor=0", 1, true) ~= nil)
end)

test("the invite and the raid conversion are tried safely", function()
  local game = newGame()
  local protected = runBundle(game).bundle.protected
  eq(game.invited, "Intrepidprobetest")
  eq(#game.invited > 12, true) -- a character name has at most 12 letters, so this one cannot exist
  eq(protected.alone, true)
  eq(protected.invite.called, true)
  eq(protected.invite.api, "C_PartyInfo.InviteUnit")
  eq(protected.convert.called, true)
  eq(game.converted, 1)
  eq(protected.blockedCount, 0)

  local grouped = newGame({ inGroup = true })
  local inGroup = runBundle(grouped).bundle.protected
  eq(inGroup.alone, false)
  is_true(inGroup.convert.skipped ~= nil)
  eq(grouped.converted, nil) -- never converts a group the player is in
  eq(grouped.invited, "Intrepidprobetest")
end)

test("a blocked call is noticed, and a call that raises is recorded, not fatal", function()
  local blocked = newGame({ inviteBlocked = true })
  local db = runBundle(blocked)
  eq(db.bundle.protected.blockedCount, 1)
  eq(db.bundle.protected.messages[1].event, "ADDON_ACTION_FORBIDDEN")
  eq(db.bundle.protected.messages[1].args[2], "InviteUnit")
  is_true(db.bundle.steps["invite and raid conversion"].note:find("BLOCKED", 1, true) ~= nil)
  eq(db.bundle.problems, 0)

  local raising = newGame({ inviteRaises = true })
  local after = runBundle(raising)
  eq(after.bundle.protected.invite.called, false)
  is_true(after.bundle.protected.invite.result:find("boom from the invite", 1, true) ~= nil)
  is_true(after.bundle.finishedAt ~= nil)
end)

test("the Encounter Journal and the item ids", function()
  local game = newGame()
  local db = runBundle(game)
  eq(db.ej.counts.instances, 2)
  eq(db.ej.counts.bosses, 6)
  eq(db.ej.counts.items, 24)
  eq(db.ej.playerLevel, 20)

  local ids = itemIds()
  eq(#ids, 309)
  eq(db.bundle.items.asked, 309)
  eq(#game.requested, 309)
  eq(#db.bundle.items.rows + #db.bundle.items.unknown, 309)
  local expectedKnown = 0
  for _, id in ipairs(ids) do if id < 250000 then expectedKnown = expectedKnown + 1 end end
  eq(#db.bundle.items.rows, expectedKnown)
  local above, aboveKnown = 0, 0
  for _, id in ipairs(ids) do
    if id > 200000 then
      above = above + 1
      if id < 250000 then aboveKnown = aboveKnown + 1 end
    end
  end
  eq(db.bundle.items.idsAbove200000.known, aboveKnown)
  eq(db.bundle.items.idsAbove200000.unknown, above - aboveKnown)
  local row = db.bundle.items.rows[1]
  eq(row.equipLoc, "INVTYPE_CHEST")
  eq(row.classID, 4)
  eq(row.bindType, 1)
  eq(row.quality, 2)
  is_true(db.bundle.items.unknown[1].instant ~= nil)
end)

test("the Encounter Journal stops at its time budget", function()
  local game = newGame({ clockStep = 6000 })
  local instances = game.ns.probe.dumpEncounterJournal(true, 10000)
  is_true(instances >= 1)
  local notes = game.db().ej.notes
  is_true(notes[1] ~= nil and notes[1]:find("time budget", 1, true) ~= nil)
end)

test("the saved data is plain, small, and holds no names", function()
  local game = newGame()
  local db = runBundle(game)
  assertSavable(db, "IntrepidProbeDB")
  is_true(sizeOf(db) < 600000)
  for _, name in ipairs({ PLAYER_FIRST, PLAYER_SURNAME, "Mirelle", "Dunmore", "Tobin", "Ashvale", "Orrin" }) do
    if contains(db.bundle, name) then error("the bundle's data holds the name " .. name) end
  end
end)

test("everything printed is safe for the chat window", function()
  local game = newGame()
  runBundle(game)
  for _, line in ipairs(game.printed) do
    local rest = line:gsub("^|cff66ccffIntrepid Probe:|r ", "")
    eq(rest:find("|", 1, true), nil)
    is_true(#line < 260)
  end
end)

test("the log records loot with the details of the item, after the bundle turned it on", function()
  local game = newGame()
  local db = runBundle(game)
  game.fire("LOOT_OPENED", false)
  game.fire("ENCOUNTER_END", 644, "Stub Boss", 1, 5, 1)
  game.fire("PLAYER_REGEN_DISABLED")
  eq(#db.events, 3)
  local loot = db.events[1]
  eq(loot.event, "LOOT_OPENED")
  eq(loot.mapID, 33)
  eq(#loot.extra.slots, 2)
  eq(loot.extra.slots[1].itemId, 1001)
  eq(loot.extra.slots[1].npcId, 644)
  eq(loot.extra.slots[1].details.equipLoc, "INVTYPE_CHEST")
  eq(loot.extra.slots[1].details.bindType, 1)
  eq(loot.extra.autoLoot, "0")
  eq(db.events[2].args[2], "Stub Boss")
  eq(db.events[3].event, "PLAYER_REGEN_DISABLED")
  assertSavable(db, "IntrepidProbeDB")
end)

local function copyOf(value)
  if type(value) ~= "table" then return value end
  local copy = {}
  for key, item in pairs(value) do copy[key] = copyOf(item) end
  return copy
end

test("the log is still on after a /reload, and keeps what it recorded", function()
  local first = newGame()
  local db = runBundle(first)
  first.fire("LOOT_OPENED", false)
  eq(#db.events, 1)
  -- the client saves the file and loads it again after the reload
  local second = newGame({ savedDb = copyOf(db) })
  is_true(second.ns.probe.isLogging())
  is_true(second.output():find("ON again after the reload", 1, true) ~= nil)
  second.fire("LOOT_OPENED", false)
  eq(#second.db().events, 2)
  eq(second.db().loggingSince, db.loggingSince) -- it is the same recording, not a new one
end)

test("a log that was switched off stays off after a /reload", function()
  local first = newGame()
  runBundle(first)
  first.say("log off")
  local second = newGame({ savedDb = copyOf(first.db()) })
  eq(second.ns.probe.isLogging(), false)
  eq(second.db().loggingOn, nil)
end)

local function registered(game, event)
  for _, widget in ipairs(game.frames) do
    if widget._events[event] then return true end
  end
  return false
end

test("probing the events does not switch off what must stay on: the always-on listeners and the running log", function()
  local game = newGame()
  is_true(registered(game, "CHAT_MSG_ADDON"))
  is_true(registered(game, "ADDON_RESTRICTION_STATE_CHANGED"))
  game.say("probe")
  is_true(registered(game, "CHAT_MSG_ADDON"))
  is_true(registered(game, "ADDON_RESTRICTION_STATE_CHANGED"))
  eq(registered(game, "LOOT_OPENED"), false) -- the log is off, so it is not registered
  game.say("log on")
  is_true(registered(game, "LOOT_OPENED"))
  game.say("probe") -- with the log running
  is_true(registered(game, "LOOT_OPENED"))
  is_true(registered(game, "ENCOUNTER_END"))
  eq(registered(game, "BAG_UPDATE_DELAYED"), false) -- tested events that are not part of the log stay off
  -- the same after a whole bundle, run twice
  game.say("bundle again")
  game.pump()
  game.say("bundle and again")
  game.pump()
  is_true(registered(game, "CHAT_MSG_ADDON"))
  is_true(registered(game, "LOOT_OPENED"))
  is_true(registered(game, "PLAYER_REGEN_DISABLED"))
end)

test("the bundle stops listening to its events when it is done", function()
  local game = newGame()
  runBundle(game)
  -- frames[1] is the probe's own frame, which listens to UI_ERROR_MESSAGE for the log (the bundle turned the log on)
  for _, event in ipairs({ "ADDON_ACTION_FORBIDDEN", "ADDON_ACTION_BLOCKED", "UI_ERROR_MESSAGE", "GUILD_ROSTER_UPDATE" }) do
    for index, widget in ipairs(game.frames) do
      if index > 1 and widget._events[event] then error("something still listens to " .. event) end
    end
  end
end)

test("the older commands still work", function()
  local game = newGame()
  game.say("probe")
  game.say("show")
  game.say("run label-one")
  game.say("log on")
  game.say("log off")
  game.say("ej")
  game.say("invite First Surname")
  game.say("")
  eq(game.db().lastError, nil)
  eq(game.db().run.label, "label-one")
  is_true(game.output():find("/ip bundle [label]", 1, true) ~= nil)
  eq(game.db().ej.counts.instances, 2)
end)

test("an API that raises is recorded as data, and the run goes on", function()
  local game = newGame({ guildRaises = true })
  local db = runBundle(game)
  eq(db.bundle.steps["guild"].ok, true)
  is_true(tostring(db.bundle.guild.total):find("boom from the guild roster", 1, true) ~= nil)
  is_true(db.bundle.steps["guild"].note:find("ERROR", 1, true) ~= nil)
  eq(db.bundle.steps["item ids from the loot tables"].ok, true)
  is_true(db.bundle.finishedAt ~= nil)
end)

test("a step that fails later, in a timer, is recorded and the next ones still run", function()
  local game = newGame()
  local bundle = game.ns.bundle
  table.insert(bundle.steps, 3, { name = "a step that raises in a timer", limit = 30, fn = function(_, fail)
    game.env.C_Timer.After(1, bundle.guard(fail, function() error("boom later") end))
  end })
  local db = runBundle(game)
  eq(db.bundle.steps["a step that raises in a timer"].ok, false)
  is_true(db.bundle.steps["a step that raises in a timer"].note:find("boom later", 1, true) ~= nil)
  eq(db.bundle.steps["item ids from the loot tables"].ok, true)
  eq(db.bundle.problems, 1)
  is_true(db.bundle.finishedAt ~= nil)
  is_true(game.output():find("PROBLEM", 1, true) ~= nil)
end)

test("waiting for an event: it fires, or the time runs out, but the callback comes only once", function()
  local game = newGame()
  local calls = {}
  game.ns.bundle.waitForEvent("SOME_EVENT", 5, function(timedOut) calls[#calls + 1] = timedOut end)
  game.fire("SOME_EVENT")
  game.fire("SOME_EVENT")
  game.pump()
  deep_eq(calls, { false })
  game.ns.bundle.waitForEvent("OTHER_EVENT", 5, function(timedOut) calls[#calls + 1] = timedOut end)
  game.pump()
  game.fire("OTHER_EVENT")
  deep_eq(calls, { false, true })
end)

test("a step that never ends is given up on, and the run goes on", function()
  local game = newGame()
  table.insert(game.ns.bundle.steps, 3, { name = "a step that hangs", limit = 5, fn = function() end })
  local db = runBundle(game)
  eq(db.bundle.steps["a step that hangs"].ok, false)
  eq(db.bundle.steps["a step that hangs"].note, "timed out")
  eq(db.bundle.steps["item ids from the loot tables"].ok, true)
  is_true(db.bundle.finishedAt ~= nil)
end)

test("a step that raises when it starts is a failure too", function()
  local game = newGame()
  table.insert(game.ns.bundle.steps, 2, { name = "a step that raises", limit = 5, fn = function() error("boom at the start") end })
  local db = runBundle(game)
  eq(db.bundle.steps["a step that raises"].ok, false)
  is_true(db.bundle.steps["a step that raises"].note:find("boom at the start", 1, true) ~= nil)
  is_true(db.bundle.finishedAt ~= nil)
end)

test("a guild whose roster never answers is read after the wait", function()
  local game = newGame({ noRosterEvent = true })
  local db = runBundle(game)
  eq(db.bundle.steps["guild"].ok, true)
  is_true(db.bundle.steps["guild"].note:find("no update event", 1, true) ~= nil)
  eq(db.bundle.guild.total, 3)
end)

test("no guild, no templates, a client with almost nothing: it still finishes and saves", function()
  local game = newGame({ hostile = true, noGuild = true, allTemplatesBad = true, noClock = true, level = 5 })
  local db = runBundle(game)
  is_true(db.bundle.finishedAt ~= nil)
  eq(db.bundle.guild.inGuild, false)
  is_true(tostring(db.bundle.ui.templates["Frame + BackdropTemplate"]):find("ERROR", 1, true) ~= nil)
  eq(db.bundle.protected.invite.api, "missing")
  eq(db.bundle.protected.convert.api, "missing")
  eq(db.bundle.items.asked, 309)
  eq(#db.bundle.items.rows, 0)
  eq(#db.bundle.items.unknown, 309)
  eq(db.ej.counts, nil) -- the journal functions are missing: nothing dumped
  is_true(db.ej.notes[1]:find("functions missing", 1, true) ~= nil)
  assertSavable(db, "IntrepidProbeDB")
end)

test("a guild whose members cannot be read", function()
  local game = newGame({ hostile = true })
  game.env.IsInGuild = function() return true end
  local db = runBundle(game)
  eq(db.bundle.steps["guild"].ok, true)
  eq(#db.bundle.guild.members, 0)
end)

test("without C_Timer the bundle says so instead of failing", function()
  local game = newGame({ noTimer = true })
  game.say("bundle tester")
  is_true(game.output():find("no C_Timer.After", 1, true) ~= nil)
  eq(game.db().bundle, nil)
  eq(game.db().lastError, nil)
end)

test("starting the bundle twice at once is refused", function()
  local game = newGame()
  game.say("bundle one")
  game.say("bundle two")
  is_true(game.output():find("already running", 1, true) ~= nil)
  game.pump()
  eq(game.db().bundle.label, "one")
  -- and once it has finished, it can be run again
  game.say("bundle three")
  game.pump()
  eq(game.db().bundle.label, "three")
end)

test("the bundle works without a label too", function()
  local game = newGame()
  game.say("bundle")
  game.pump()
  eq(game.db().bundle.label, nil)
  is_true(game.db().bundle.finishedAt ~= nil)
end)

test("name shapes keep the form and nothing else", function()
  local shape = newGame().ns.bundle.shape
  eq(shape("Jorren Ashvale"), "Aaaaaa Aaaaaaa")
  eq(shape("Zo\195\171 O'Neil-2"), "Aa~ A'Aaaa-9")
  eq(shape(nil), "nil")
  eq(shape(12), "12")
  local guid = newGame().ns.bundle.guidShape
  eq(guid("Creature-0-4381-33-5-644-0000ABCDEF"), "Creature-9-9999-99-9-999-9999xxxxxx")
  eq(guid("Player-4381-0A1B2C3D"), "Player-9999-9x9x9x9x")
  eq(guid(nil), "nil")
end)

-- Probe 0.6.1: what the log keeps for the Master Looter and trade tests -------------------------------------------

local CANDIDATES = { [1] = "Mirelle Dunmore", [3] = "Tobin Ashvale" } -- a number can be empty

test("loot windows record the threshold and the form of each candidate name under its number", function()
  local game = newGame({ candidates = CANDIDATES })
  game.say("log on")
  game.fire("LOOT_OPENED", false)
  local db = game.db()
  local window = db.events[1].extra
  eq(window.threshold, "2")
  local slot = window.slots[1]
  eq(slot.masterLootCandidates, 2)
  eq(slot.candidateShapes[1], "Aaaaaaa Aaaaaaa")
  eq(slot.candidateShapes[2], nil)
  eq(slot.candidateShapes[3], "Aaaaa Aaaaaaa")
  is_true(not contains(db, "Mirelle"))
  is_true(not contains(db, "Ashvale"))
  assertSavable(db, "IntrepidProbeDB")
  -- nobody to give the item to: no shapes, a count of 0
  local alone = newGame()
  alone.say("log on")
  alone.fire("LOOT_OPENED", false)
  eq(alone.db().events[1].extra.slots[1].masterLootCandidates, 0)
  eq(alone.db().events[1].extra.slots[1].candidateShapes, nil)
end)

test("the Master Looter events are logged with the loot window as it is at that moment", function()
  local game = newGame({ candidates = CANDIDATES })
  game.say("log on")
  game.fire("OPEN_MASTER_LOOT_LIST")
  game.fire("CONFIRM_LOOT_DISTRIBUTION", 1, "Mirelle Dunmore")
  game.fire("LOOT_BIND_CONFIRM", 1)
  game.fire("LOOT_SLOT_CHANGED", 2)
  local events = game.db().events
  eq(#events, 4)
  for index, name in ipairs({ "OPEN_MASTER_LOOT_LIST", "CONFIRM_LOOT_DISTRIBUTION", "LOOT_BIND_CONFIRM", "LOOT_SLOT_CHANGED" }) do
    eq(events[index].event, name)
    eq(#events[index].extra.slots, 2)
    eq(events[index].extra.slots[1].candidateShapes[3], "Aaaaa Aaaaaaa")
  end
  eq(events[2].args[1], "1")
  eq(events[2].args[2], "Mirelle Dunmore") -- the game's own argument, kept as it came
  assertSavable(game.db(), "IntrepidProbeDB")
end)

test("trade events record what is in the trade window", function()
  local game = newGame()
  game.say("log on")
  local mine = "|cffa335ee|Hitem:2001::::::::20:::::::::|h[Stub Blade]|h|r"
  local theirs = "|cffa335ee|Hitem:2002::::::::20:::::::::|h[Stub Ring]|h|r"
  game.fire("TRADE_SHOW")
  game.trade = { player = { [1] = mine }, target = {} }
  game.fire("TRADE_PLAYER_ITEM_CHANGED", 1)
  game.trade.target[2] = theirs
  game.fire("TRADE_TARGET_ITEM_CHANGED", 2)
  game.fire("TRADE_ACCEPT_UPDATE", 1, 1)
  game.trade = nil
  game.fire("TRADE_CLOSED")
  local events = game.db().events
  eq(#events, 5)
  eq(events[1].extra.player[1], nil)
  eq(events[2].extra.player[1], mine)
  eq(events[2].args[1], "1")
  eq(events[3].extra.target[2], theirs)
  eq(events[4].extra.player[1], mine)
  eq(events[4].extra.target[2], theirs)
  eq(events[4].args[2], "1")
  eq(events[5].event, "TRADE_CLOSED")
  eq(events[5].extra, nil) -- the window is already empty when it closes
  assertSavable(game.db(), "IntrepidProbeDB")
end)

test("a trade window function that raises leaves no error text among the items", function()
  local game = newGame({ tradeRaises = true })
  game.say("log on")
  game.trade = { player = { [1] = "|cffa335ee|Hitem:2001::::::::20:::::::::|h[Stub Blade]|h|r" }, target = { [3] = "|cffa335ee|Hitem:2002::::::::20:::::::::|h[Stub Ring]|h|r" } }
  game.fire("TRADE_SHOW")
  local extra = game.db().events[1].extra
  eq(next(extra.player), nil) -- nothing from the side that raised
  eq(extra.target[3], "|cffa335ee|Hitem:2002::::::::20:::::::::|h[Stub Ring]|h|r") -- the other side still read
  eq(game.db().lastError, nil)
end)

-- One message for each word the filter looks for, and a few that must stay out of the log.
local WANTED_MESSAGES = {
  "You can't loot that yet.", "You cannot do that with a soulbound item.", "This item will bind to you.", "Inventory is full.",
  "That player already has one of those unique items.", "You were not eligible for that.", "Cannot invite that player.",
  "You are not in a group.", "Your party is full.", "The raid is full.", "Only the master may do that.", "Your bags are full.",
}
local UNWANTED_MESSAGES = { "Target is out of range.", "Quest accepted: Stub Quest", "Ability is not ready yet.", "Not enough mana." }

test("the game's small messages are logged only when they are about loot, trading, binding or groups", function()
  local game = newGame()
  game.say("log on")
  game.fire("UI_INFO_MESSAGE", 0, "Trade complete.") -- the informational kind as well as the error kind
  game.fire("UI_INFO_MESSAGE", 0, UNWANTED_MESSAGES[2])
  for index, message in ipairs(WANTED_MESSAGES) do game.fire("UI_ERROR_MESSAGE", 50 + index, message) end
  for index, message in ipairs(UNWANTED_MESSAGES) do game.fire("UI_ERROR_MESSAGE", 80 + index, message) end
  game.fire("UI_ERROR_MESSAGE", 99) -- no text at all
  local events = game.db().events
  eq(#events, 1 + #WANTED_MESSAGES)
  eq(events[1].event, "UI_INFO_MESSAGE")
  eq(events[1].args[2], "Trade complete.")
  for index, message in ipairs(WANTED_MESSAGES) do
    eq(events[1 + index].event, "UI_ERROR_MESSAGE")
    eq(events[1 + index].args[2], message)
  end
end)

test("the log listens to the new events while it is on, and not when it is off", function()
  local game = newGame()
  local added = { "CONFIRM_LOOT_DISTRIBUTION", "OPEN_MASTER_LOOT_LIST", "LOOT_SLOT_CHANGED", "TRADE_PLAYER_ITEM_CHANGED", "TRADE_TARGET_ITEM_CHANGED", "UI_INFO_MESSAGE", "UI_ERROR_MESSAGE" }
  for _, event in ipairs(added) do eq(registered(game, event), false) end
  game.say("log on")
  for _, event in ipairs(added) do is_true(registered(game, event)) end
  game.say("log off")
  for _, event in ipairs(added) do eq(registered(game, event), false) end
  game.fire("UI_INFO_MESSAGE", 0, "Trade complete.")
  eq(game.db().events, nil)
end)

local function link(id) return "|cffa335ee|Hitem:" .. id .. "::::::::20:::::::::|h[Stub " .. id .. "]|h|r" end

test("/ip bags lists the bound items and the tooltip lines about trading them", function()
  local game = newGame({ bags = { [0] = {
    [1] = { info = { itemID = 3001, hyperlink = link(3001), isBound = true, quality = 4 },
      tip = { "Stub 3001", "Soulbound", "You may trade this item with players that were also eligible to loot this item for the next 1 hour 58 min." } },
    [2] = { info = { itemID = 3002, hyperlink = link(3002), isBound = false, quality = 1 }, tip = { "Stub 3002", "Cloth", "Trade Goods" } },
    [3] = { info = { itemID = 3003, hyperlink = link(3003), isBound = true, quality = 2 }, tip = { "Stub 3003", "Soulbound" } },
    [4] = { info = { itemID = 3004, hyperlink = link(3004), isBound = false, quality = 2 }, tip = { "Stub 3004", "You may trade this item with players that were also eligible to loot this item for the next 20 min." } },
    [5] = { raises = true },
    [6] = {},
  }, [2] = {
    [1] = { info = { itemID = 3005, hyperlink = link(3005), isBound = true, quality = 3 }, tip = { "Stub 3005", "Soulbound" } },
  }, [5] = {
    [1] = { info = { itemID = 3006, hyperlink = link(3006), isBound = true, quality = 4 },
      tip = { "Stub 3006", "You may trade this item with players that were also eligible to loot this item for the next 3 hours." } },
  } } })
  game.say("bags")
  local scan = game.db().bags[1]
  -- 3001 (bound, a trade line), 3003 (bound), 3004 (a trade line, not bound), then 3005 in the third bag and 3006 in the
  -- last one; 3002 only says "Trade Goods"
  eq(#scan.rows, 5)
  eq(scan.rows[1].itemId, 3001)
  eq(scan.rows[1].bag, 0)
  eq(scan.rows[1].slot, 1)
  eq(scan.rows[1].isBound, true)
  eq(scan.rows[1].tooltipLines, 3)
  eq(#scan.rows[1].tradeLines, 1)
  is_true(scan.rows[1].tradeLines[1]:find("1 hour 58 min", 1, true) ~= nil)
  eq(scan.rows[2].itemId, 3003)
  eq(scan.rows[2].tradeLines, nil)
  eq(scan.rows[3].itemId, 3004)
  eq(scan.rows[3].isBound, false)
  eq(scan.rows[4].itemId, 3005)
  eq(scan.rows[4].bag, 2)
  eq(scan.rows[5].itemId, 3006)
  eq(scan.rows[5].bag, 5)
  is_true(scan.rows[5].tradeLines[1]:find("3 hours", 1, true) ~= nil)
  eq(#scan.errors, 1) -- the slot whose bag function raised did not stop the scan
  is_true(game.output():find("5 items listed", 1, true) ~= nil)
  is_true(game.output():find("3 with a tooltip line about trading", 1, true) ~= nil)
  eq(game.db().lastError, nil)
  assertSavable(game.db(), "IntrepidProbeDB")
  game.say("bags")
  eq(#game.db().bags, 2) -- every scan is kept
end)

test("/ip bags says so when the client has no bag functions, and copes with no tooltip function", function()
  local game = newGame()
  game.say("bags")
  is_true(game.output():find("do not exist", 1, true) ~= nil)
  eq(game.db().bags, nil)
  eq(game.db().lastError, nil)
  local second = newGame({ noTooltipApi = true, bags = { [0] = { [1] = { info = { itemID = 1, hyperlink = link(1), isBound = true } } } } })
  second.say("bags")
  eq(#second.db().bags[1].rows, 1)
  eq(second.db().bags[1].rows[1].tooltipLines, nil)
  eq(second.db().lastError, nil)
end)

test("the new command is in the help text and nothing printed breaks the chat window", function()
  local game = newGame({ bags = { [0] = { [1] = { info = { itemID = 1, hyperlink = link(1), isBound = true } } } } })
  game.say("")
  game.say("bags")
  is_true(game.output():find("/ip bags", 1, true) ~= nil)
  for _, line in ipairs(game.printed) do
    local rest = line:gsub("^|cff66ccffIntrepid Probe:|r ", "")
    eq(rest:find("|", 1, true), nil)
    is_true(#line < 260)
  end
end)


-- Probe 0.6.2: /ip give ----------------------------------------------------------------------------------------------

local function noGive(game)
  eq(game.gave, nil)
  eq(game.db().gives, nil)
  eq(game.db().lastError, nil)
end

test("/ip give with nothing after it lists the item slots and who can get them", function()
  local game = newGame({ candidates = CANDIDATES, moneySlot = true })
  game.say("give")
  local text = game.output()
  is_true(text:find("slot 2: Stub 2 (quality 2), candidates: 1 Mirelle Dunmore, 3 Tobin Ashvale", 1, true) ~= nil)
  is_true(text:find("slot 3: Stub 3", 1, true) ~= nil)
  eq(text:find("slot 1:", 1, true), nil) -- the first slot is money
  is_true(text:find("Give one with /ip give <slot> <candidate number or full name>.", 1, true) ~= nil)
  noGive(game)
end)

test("/ip give says so when there is no loot window, only money, or no master looter", function()
  local none = newGame({ candidates = CANDIDATES, noLoot = true })
  none.say("give")
  is_true(none.output():find("There is no loot window open", 1, true) ~= nil)
  none.say("give 1 1")
  noGive(none)
  local notMaster = newGame()
  notMaster.say("give")
  is_true(notMaster.output():find("none (you are not the master looter here)", 1, true) ~= nil)
  notMaster.say("give 1 1")
  is_true(notMaster.output():find("Slot 1 has no candidates", 1, true) ~= nil)
  noGive(notMaster)
end)

test("/ip give hands a slot to a candidate and records what the game answered", function()
  local game = newGame({ candidates = CANDIDATES, moneySlot = true })
  game.say("give 2 3")
  eq(#game.gave, 1)
  eq(game.gave[1].slot, 2)
  eq(game.gave[1].index, 3)
  is_true(game.output():find("giving slot 2 (Stub 2) to candidate 3 (Tobin Ashvale)", 1, true) ~= nil)
  is_true(registered(game, "CHAT_MSG_LOOT")) -- listening while the answer comes
  game.pump()
  local record = game.db().gives[1]
  eq(record.slot, 2)
  eq(record.candidate, 3)
  eq(record.candidateShape, "Aaaaa Aaaaaaa")
  eq(record.itemId, 1002)
  eq(record.item, "Stub 2")
  eq(record.quality, 2)
  eq(record.called, true)
  eq(record.result, "nil")
  eq(record.lootMethod, "3")
  eq(record.threshold, "2")
  eq(record.loggingWasOn, false)
  eq(#record.events, 2)
  eq(record.events[1].event, "LOOT_SLOT_CLEARED")
  eq(record.events[1].args[1], "2")
  eq(record.events[1].after, "0.3") -- seconds after the call
  eq(record.events[2].event, "CHAT_MSG_LOOT")
  eq(record.outcome, "the slot was cleared, so the item was given")
  is_true(game.output():find("give result: the slot was cleared, so the item was given. 2 events recorded.", 1, true) ~= nil)
  is_true(not contains(record, "Tobin")) -- the candidate is kept as a shape, not as a name
  eq(registered(game, "CHAT_MSG_LOOT"), false) -- and it stops listening
  game.fire("LOOT_SLOT_CLEARED", 3)
  eq(#record.events, 2)
  assertSavable(game.db(), "IntrepidProbeDB")
end)

test("/ip give takes a candidate by full name, in any case and spacing", function()
  local game = newGame({ candidates = CANDIDATES })
  game.say("give 2 tobin    ASHVALE ")
  eq(game.gave[1].index, 3)
  game.pump()
  game.say("give 1 Mirelle Dunmore")
  eq(game.gave[2].slot, 1)
  eq(game.gave[2].index, 1)
  game.pump()
  eq(#game.db().gives, 2)
  eq(game.db().gives[2].candidateShape, "Aaaaaaa Aaaaaaa")
end)

test("/ip give refuses what it cannot do, and does not call GiveMasterLoot then", function()
  local game = newGame({ candidates = CANDIDATES, moneySlot = true })
  game.say("give 1 1") -- money
  is_true(game.output():find("Slot 1 has no item", 1, true) ~= nil)
  game.say("give 9 1")
  is_true(game.output():find("Slot 9 has no item", 1, true) ~= nil)
  game.say("give 0 1")
  is_true(game.output():find("Slot 0 has no item", 1, true) ~= nil)
  game.say("give 2 2") -- the candidates are numbered 1 and 3
  is_true(game.output():find("There is no candidate number 2 for slot 2", 1, true) ~= nil)
  game.say("give 2 Nobody Atall")
  is_true(game.output():find("No candidate has that name for slot 2", 1, true) ~= nil)
  game.say("give x")
  game.say("give 2")
  game.say("give two 1")
  is_true(game.output():find("Use /ip give to list the slots", 1, true) ~= nil)
  noGive(game)
  local missing = newGame({ candidates = CANDIDATES, noGive = true })
  missing.say("give 1 1")
  is_true(missing.output():find("GiveMasterLoot does not exist here", 1, true) ~= nil)
  noGive(missing)
end)

test("/ip give notices when the game blocks the call", function()
  local game = newGame({ candidates = CANDIDATES, giveBlocked = true })
  game.say("give 1 1")
  game.pump()
  local record = game.db().gives[1]
  eq(record.called, true)
  eq(record.events[1].event, "ADDON_ACTION_FORBIDDEN")
  eq(record.events[1].args[2], "GiveMasterLoot")
  eq(record.outcome, "the game BLOCKED the call")
  is_true(game.output():find("give result: the game BLOCKED the call", 1, true) ~= nil)
  local protected = newGame({ candidates = CANDIDATES, giveProtected = true })
  protected.say("give 1 1")
  protected.pump()
  eq(protected.db().gives[1].events[1].event, "ADDON_ACTION_BLOCKED")
  eq(protected.db().gives[1].outcome, "the game BLOCKED the call")
end)

test("/ip give records a call that raises, and does not stop", function()
  local game = newGame({ candidates = CANDIDATES, giveRaises = true })
  game.say("give 1 1")
  game.pump()
  local record = game.db().gives[1]
  eq(record.called, false)
  is_true(record.result:find("boom from GiveMasterLoot", 1, true) ~= nil)
  is_true(record.outcome:find("the call raised an error: ", 1, true) == 1)
  eq(#record.events, 0)
  eq(game.db().lastError, nil)
  for _, line in ipairs(game.printed) do eq(line:gsub("^|cff66ccffIntrepid Probe:|r ", ""):find("|", 1, true), nil) end
  -- a pipe in the game's error text must not reach the chat window as an escape code
  local piped = newGame({ candidates = CANDIDATES, giveRaises = "oops |cffff0000red|r text" })
  piped.say("give 1 1")
  piped.pump()
  is_true(piped.db().gives[1].result:find("|cffff0000", 1, true) ~= nil) -- the file keeps it as it came
  is_true(piped.output():find("the call raised an error: ", 1, true) ~= nil)
  is_true(piped.output():find("oops ?cffff0000red?r text", 1, true) ~= nil) -- the error text has a position in front of it
  for _, line in ipairs(piped.printed) do eq(line:gsub("^|cff66ccffIntrepid Probe:|r ", ""):find("|", 1, true), nil) end
end)

test("/ip give tells a confirmation, an error message and silence apart", function()
  local confirms = newGame({ candidates = CANDIDATES, giveConfirms = true })
  confirms.say("give 1 1")
  confirms.pump()
  eq(confirms.db().gives[1].events[1].event, "CONFIRM_LOOT_DISTRIBUTION")
  is_true(confirms.db().gives[1].outcome:find("asks for a confirmation", 1, true) ~= nil)
  local errors = newGame({ candidates = CANDIDATES, giveErrors = true })
  errors.say("give 1 1")
  errors.pump()
  eq(errors.db().gives[1].events[1].args[2], "Inventory is full.")
  is_true(errors.db().gives[1].outcome:find("error message", 1, true) ~= nil)
  local chatOnly = newGame({ candidates = CANDIDATES, giveChatOnly = true })
  chatOnly.say("give 1 1")
  chatOnly.pump()
  eq(chatOnly.db().gives[1].outcome, "the slot was cleared, so the item was given")
  local silent = newGame({ candidates = CANDIDATES, giveSilent = true })
  silent.say("give 1 1")
  silent.pump()
  eq(silent.db().gives[1].outcome, "no answer within 3 seconds")
  eq(#silent.db().gives[1].events, 0)
end)

test("/ip give records one give at a time, and a flood of events is cut off", function()
  local game = newGame({ candidates = CANDIDATES })
  game.say("give 1 1")
  game.say("give 2 1") -- too soon
  is_true(game.output():find("Still recording the last give", 1, true) ~= nil)
  eq(#game.gave, 1)
  game.pump()
  game.say("give 2 1")
  eq(#game.gave, 2)
  game.pump()
  eq(#game.db().gives, 2)
  local flood = newGame({ candidates = CANDIDATES, giveFlood = true })
  flood.say("give 1 1")
  flood.pump()
  eq(#flood.db().gives[1].events, 30)
  assertSavable(flood.db(), "IntrepidProbeDB")
end)

test("/ip give without a timer finishes at once", function()
  local game = newGame({ candidates = CANDIDATES, noTimer = true, giveSilent = true })
  game.say("give 1 1")
  eq(game.db().gives[1].outcome, "no answer within 3 seconds")
  eq(registered(game, "CHAT_MSG_LOOT"), false)
  game.say("give 2 1") -- not stuck
  eq(#game.gave, 2)
end)

test("the help text names /ip give", function()
  local game = newGame()
  game.say("")
  is_true(game.output():find("/ip give", 1, true) ~= nil)
end)


-- Probe 0.6.3: rolls, the loot history, the group, the raid ----------------------------------------------------------

test("a group roll is logged with what it offers", function()
  local game = newGame()
  game.say("log on")
  game.fire("START_LOOT_ROLL", 7, 60000)
  local entry = game.db().events[1]
  eq(entry.event, "START_LOOT_ROLL")
  eq(entry.args[1], "7")
  eq(entry.extra.rollId, 7)
  eq(entry.extra.itemId, 4007)
  eq(entry.extra.name, "Stub Roll 7")
  eq(entry.extra.quality, 2)
  eq(entry.extra.count, 3)
  eq(entry.extra.bindOnPickUp, true)
  eq(entry.extra.canNeed, false)
  eq(entry.extra.canGreed, true)
  eq(entry.extra.canDisenchant, false)
  eq(entry.extra.reasonNeed, "Cannot need this")
  eq(entry.extra.reasonGreed, nil)
  eq(entry.extra.reasonDisenchant, "Not an enchanter")
  eq(entry.extra.deSkillRequired, 300)
  eq(entry.extra.canTransmog, true)
  eq(entry.extra.duration, "60")
  assertSavable(game.db(), "IntrepidProbeDB")
end)

test("a group roll is still logged when the roll functions are missing or fail", function()
  local missing = newGame({ noRollApi = true })
  missing.say("log on")
  missing.fire("START_LOOT_ROLL", 7, 60000)
  eq(missing.db().events[1].event, "START_LOOT_ROLL")
  eq(missing.db().events[1].extra.rollId, 7)
  eq(missing.db().events[1].extra.link, nil)
  local raising = newGame({ rollRaises = true })
  raising.say("log on")
  raising.fire("START_LOOT_ROLL", 7, 60000)
  is_true(tostring(raising.db().events[1].extra):find("boom from the roll", 1, true) ~= nil)
  eq(raising.db().lastError, nil)
end)

test("/ip history records what the game remembers of rolls and drops, as it comes", function()
  local game = newGame({ history = true })
  game.say("history")
  local record = game.db().history[1]
  eq(record.all[1].encounterID, 3495)
  eq(record.encounters[1].encounter.encounterName, "Stub Boss")
  eq(record.encounters[1].dropList[1].lootListID, 1)
  local drop = record.encounters[1].drops[1]
  eq(drop.winner.roll, 77)
  eq(drop.rollInfos[2].roll, 12)
  is_true(game.output():find("loot history: 1 encounters recorded", 1, true) ~= nil)
  assertSavable(game.db(), "IntrepidProbeDB")
  -- each encounter is asked about by its id, and each drop by the id of the encounter and its own list id
  deep_eq(game.historyCalls, { { "drops", 3495 }, { "info", 3495, 1 } })
end)

test("/ip history cuts what is too long, too deep or too big, and survives a table that contains itself", function()
  local game = newGame({ history = true, historyHuge = true })
  game.say("history")
  local record = game.db().history[1]
  local encounter = record.all[1]
  eq(#encounter.encounterName, 200)
  eq(record.encounters[1].encounter.encounterName, string.rep("x", 200))
  eq(encounter.deep.deeper, "<table>") -- the list, the encounter and one more level are kept (3 levels in all)
  eq(encounter.loop.me, "<table>")
  eq(encounter.many[40], 40)
  eq(encounter.many[41], nil)
  eq(encounter.many["..."], "more entries")
  local keys = 0
  for _ in pairs(encounter.many) do keys = keys + 1 end
  eq(keys, 41)
  eq(game.db().lastError, nil)
  assertSavable(game.db(), "IntrepidProbeDB")
end)

test("/ip history keeps the newest 30 records and drops the oldest", function()
  local game = newGame({ history = true })
  for _ = 1, 35 do game.say("history") end
  eq(#game.db().history, 30)
  eq(game.db().history[1].all[1].startTime, 6)
  eq(game.db().history[30].all[1].startTime, 35)
end)

test("/ip history copes with a missing history, failures and an odd shape", function()
  local none = newGame()
  none.say("history")
  is_true(none.output():find("C_LootHistory does not exist here", 1, true) ~= nil)
  eq(none.db().history, nil)
  local raising = newGame({ history = true, historyRaises = true })
  raising.say("history")
  is_true(tostring(raising.db().history[1].all):find("ERROR: ", 1, true) == 1)
  eq(#raising.db().history[1].encounters, 0)
  eq(raising.db().lastError, nil)
  local odd = newGame({ history = true, historyOdd = true })
  odd.say("history")
  local record = odd.db().history[1]
  eq(record.all[1], 3495) -- an encounter given as a bare number is read as its id
  eq(record.all[2], "<function>")
  eq(type(record.all[3].junk), "string") -- a NaN is written as text; Linux prints it as "-nan", macOS as "nan"
  is_true(record.all[3].junk:find("nan", 1, true) ~= nil)
  eq(record.all[4][1], 8)
  eq(#record.encounters, 4)
  assertSavable(odd.db(), "IntrepidProbeDB")
  -- the id is read from a bare number, from encounterID or from the first place of a list; a drop likewise
  local calls = odd.historyCalls
  eq(#calls, 16)
  deep_eq(calls[1], { "drops", 3495 })
  deep_eq(calls[2], { "info", 3495, 5 })
  deep_eq(calls[3], { "info", 3495, 6 })
  deep_eq(calls[4], { "info", 3495, 7 })
  eq(type(calls[5][2]), "function") -- the function in the list is handed on as it is
  deep_eq(calls[9], { "drops", 7 })
  deep_eq(calls[10], { "info", 7, 5 })
  deep_eq(calls[13], { "drops", 8 })
  deep_eq(calls[16], { "info", 8, 7 })
end)

test("a finished roll keeps the history while it is fresh, up to 20 times", function()
  local game = newGame({ history = true })
  game.say("log on")
  game.fire("LOOT_ROLLS_COMPLETE")
  eq(#game.db().history, 1)
  game.fire("LOOT_HISTORY_ROLL_COMPLETE")
  eq(#game.db().history, 2)
  for _ = 1, 30 do game.fire("LOOT_ROLLS_COMPLETE") end
  eq(#game.db().history, 20)
  eq(game.db().events[1].event, "LOOT_ROLLS_COMPLETE")
  eq(registered(game, "LOOT_HISTORY_ROLL_COMPLETE"), true)
end)

local PARTY = {
  party1 = { first = "Mirelle", full = "Mirelle Dunmore", level = 14, class = "PRIEST", role = "HEALER" },
  party2 = { first = "Tobin", full = "Tobin Ashvale", level = 12, leader = false, connected = false },
}
local ROSTER = {
  { full = "Zzyxel Quorrin", rank = 2, subgroup = 1, level = 20, className = "Warrior", fileName = "WARRIOR", online = true, role = "NONE", isML = true, combatRole = "TANK" },
  { full = "Mirelle Dunmore", rank = 0, subgroup = 1, level = 14, className = "Priest", fileName = "PRIEST", online = true, role = "NONE", isML = false, combatRole = "HEALER" },
}

test("/ip group records the members as shapes, who leads and who the master looter is", function()
  local game = newGame({ inGroup = true, groupSize = 3, members = PARTY, roster = ROSTER, lootMethodReturns = { 2, 0, nil, n = 3 } })
  game.say("group")
  local snap = game.db().groups[1]
  eq(snap.inGroup, true)
  eq(snap.inRaid, false)
  eq(snap.size, 3)
  eq(snap.leader, true)
  eq(snap.inInstance, true)
  deep_eq(snap.lootMethod, { "2", "0", "nil" })
  eq(snap.threshold, "2")
  eq(#snap.units, 3)
  eq(snap.units[1].unit, "player")
  eq(snap.units[1].name, "Aaaaaa Aaaaaaa")
  eq(snap.units[1].first, "Aaaaaa")
  eq(snap.units[2].unit, "party1")
  eq(snap.units[2].name, "Aaaaaaa Aaaaaaa")
  eq(snap.units[2].level, 14)
  eq(snap.units[2].class, "WARRIOR")
  eq(snap.units[2].role, "HEALER")
  eq(snap.units[3].connected, false)
  eq(#snap.roster, 2)
  eq(snap.rosterEmpty, 1) -- a third member, and no row for it
  eq(snap.roster[1].name, "Aaaaaa Aaaaaaa")
  eq(snap.roster[1].isMasterLooter, "true")
  eq(snap.roster[2].isMasterLooter, "false")
  eq(snap.roster[1].rank, "2")
  eq(snap.roster[1].class, "WARRIOR")
  is_true(not contains(game.db().groups, "Mirelle"))
  is_true(not contains(game.db().groups, "Tobin"))
  is_true(game.output():find("group: a party of 3, you are the leader, loot method returns [2,0,nil], 3 units and 2 roster rows read, master looter on roster row 1", 1, true) ~= nil)
  assertSavable(game.db(), "IntrepidProbeDB")
end)

test("/ip group works alone, in a raid and when the game's functions fail", function()
  local alone = newGame()
  alone.say("group")
  local snap = alone.db().groups[1]
  eq(snap.inGroup, false)
  eq(#snap.units, 1)
  eq(#snap.roster, 0)
  is_true(alone.output():find("group: no group of 0", 1, true) ~= nil)
  local raid = newGame({ inGroup = true, groupSize = 2, members = { raid1 = { first = "Zzyxel", full = "Zzyxel Quorrin", leader = true }, raid2 = PARTY.party1 }, roster = ROSTER })
  raid.say("raid")
  raid.pump()
  raid.say("group")
  local inRaid = raid.db().groups[1]
  eq(inRaid.inRaid, true)
  eq(inRaid.units[2].unit, "raid1")
  eq(inRaid.units[3].unit, "raid2")
  local broken = newGame({ inGroup = true, groupSize = 2, roster = ROSTER, rosterRaises = true })
  broken.say("group")
  is_true(broken.db().groups[1].roster[1].error:find("boom from the roster", 1, true) ~= nil)
  eq(broken.db().lastError, nil)
end)

test("/ip raid converts the party to a raid and records the answer", function()
  local game = newGame({ inGroup = true, groupSize = 3, lootMethodReturns = { 2 } })
  game.say("raid")
  eq(game.converted, 1)
  is_true(game.output():find("converting the party of 3 to a raid", 1, true) ~= nil)
  is_true(registered(game, "GROUP_ROSTER_UPDATE")) -- listening while the answer comes
  game.pump()
  local record = game.db().raids[1]
  eq(record.called, true)
  eq(record.result, "nil")
  eq(record.inRaidBefore, false)
  eq(record.inRaidAfter, true)
  eq(record.sizeBefore, 3)
  eq(record.sizeAfter, 3)
  eq(record.inInstance, true)
  eq(record.lootMethodBefore, "2")
  eq(record.lootMethodAfter, "2")
  eq(record.loggingWasOn, false)
  eq(record.events[1].event, "GROUP_ROSTER_UPDATE")
  eq(record.events[1].after, "0.2")
  eq(record.events[2].event, "CHAT_MSG_SYSTEM")
  eq(record.outcome, "the group is now a raid")
  is_true(game.output():find("raid result: the group is now a raid. Loot method before [2], after [2].", 1, true) ~= nil)
  eq(registered(game, "GROUP_ROSTER_UPDATE"), false) -- and it stops listening
  assertSavable(game.db(), "IntrepidProbeDB")
end)

test("/ip raid refuses what it cannot do, and does not call ConvertToRaid then", function()
  local alone = newGame()
  alone.say("raid")
  is_true(alone.output():find("You are not in a group", 1, true) ~= nil)
  local already = newGame({ inGroup = true })
  already.raid = true
  already.say("raid")
  is_true(already.output():find("already a raid", 1, true) ~= nil)
  local follower = newGame({ inGroup = true, notLeader = true })
  follower.say("raid")
  is_true(follower.output():find("Only the party leader can convert it", 1, true) ~= nil)
  for _, game in ipairs({ alone, already, follower }) do
    eq(game.converted, nil)
    eq(game.db().raids, nil)
    eq(game.db().lastError, nil)
  end
  local hostile = newGame({ inGroup = true })
  hostile.env.C_PartyInfo.ConvertToRaid = nil
  hostile.say("raid")
  is_true(hostile.output():find("ConvertToRaid does not exist here", 1, true) ~= nil)
end)

test("/ip raid tells a block, an error, a raise and silence apart", function()
  local blocked = newGame({ inGroup = true, raidBlocked = true })
  blocked.say("raid")
  blocked.pump()
  eq(blocked.db().raids[1].events[1].event, "ADDON_ACTION_FORBIDDEN")
  eq(blocked.db().raids[1].outcome, "the game BLOCKED the call")
  local errored = newGame({ inGroup = true, raidError = true })
  errored.say("raid")
  errored.pump()
  eq(errored.db().raids[1].events[1].args[2], "You cannot do that in a dungeon group.")
  is_true(errored.db().raids[1].outcome:find("error message", 1, true) ~= nil)
  eq(errored.db().raids[1].inRaidAfter, false)
  local raising = newGame({ inGroup = true, raidRaises = "oops |cffff0000red|r" })
  raising.say("raid")
  raising.pump()
  eq(raising.db().raids[1].called, false)
  is_true(raising.db().raids[1].outcome:find("the call raised an error: ", 1, true) == 1)
  is_true(raising.output():find("oops ?cffff0000red?r", 1, true) ~= nil)
  for _, line in ipairs(raising.printed) do eq(line:gsub("^|cff66ccffIntrepid Probe:|r ", ""):find("|", 1, true), nil) end
  eq(raising.db().lastError, nil)
  local silent = newGame({ inGroup = true, raidSilent = true })
  silent.say("raid")
  silent.pump()
  eq(silent.db().raids[1].outcome, "no change within 3 seconds")
end)

test("/ip raid keeps the first 30 events of a flood and still says what happened", function()
  local game = newGame({ inGroup = true, raidFlood = true })
  game.say("raid")
  game.pump()
  local record = game.db().raids[1]
  eq(#record.events, 30)
  eq(record.events[1].args[1], "1")
  eq(record.events[30].args[1], "30")
  is_true(record.outcome:find("error message", 1, true) ~= nil)
  eq(game.db().lastError, nil)
  assertSavable(game.db(), "IntrepidProbeDB")
end)

test("/ip raid records one conversion at a time, and without a timer it finishes at once", function()
  local game = newGame({ inGroup = true, raidSilent = true })
  game.say("raid")
  game.say("raid")
  is_true(game.output():find("Still recording the last conversion", 1, true) ~= nil)
  eq(game.converted, 1)
  game.pump()
  game.say("raid")
  eq(game.converted, 2)
  local plainGame = newGame({ inGroup = true, raidSilent = true, noTimer = true })
  plainGame.say("raid")
  eq(plainGame.db().raids[1].outcome, "no change within 3 seconds")
  eq(registered(plainGame, "GROUP_ROSTER_UPDATE"), false)
end)

test("the help text names the new commands and nothing printed breaks the chat window", function()
  local game = newGame({ inGroup = true, members = PARTY, roster = ROSTER, history = true })
  game.say("")
  game.say("group")
  game.say("history")
  local text = game.output()
  for _, name in ipairs({ "/ip group", "/ip raid", "/ip history" }) do is_true(text:find(name, 1, true) ~= nil) end
  for _, line in ipairs(game.printed) do
    local rest = line:gsub("^|cff66ccffIntrepid Probe:|r ", "")
    eq(rest:find("|", 1, true), nil)
    is_true(#line < 260)
  end
end)
