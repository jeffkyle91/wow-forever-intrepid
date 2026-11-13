-- Intrepid Probe, the one-run bundle:  /ip bundle [label]
--
-- Runs every check that is safe to run in one go, one step at a time so the game never freezes, and then turns the
-- event log on. Everything lands in IntrepidProbeDB (bundle, probe, ej) when the client saves it (/reload).
--
-- Safe means: no message to another player, no chat, no change to a group. The only actions on the game are one invite
-- to a name that cannot exist (a character name has at most 12 letters; this one has 17) and, only when the player is
-- alone, one convert-to-raid. They find out whether an addon is allowed to make those calls.
--
-- Every step is protected: a step that fails or hangs is recorded as a problem and the next one runs.

local ADDON, ns = ...
local P = ns.probe
if not P then return end

local str, lookup, exists, safe = P.str, P.lookup, P.exists, P.safe

---------------------------------------------------------------------------------------------------------------
-- Helpers
---------------------------------------------------------------------------------------------------------------

local function clock()
  local f = _G.debugprofilestop
  return f and f() or nil
end

local function after(seconds, fn)
  C_Timer.After(seconds, fn)
end

-- The first value a global function returns: nil when it does not exist, "ERROR: ..." when it fails.
local function call(path, ...)
  local fn = lookup(path)
  if type(fn) ~= "function" then return nil end
  return (safe(fn, ...))
end

-- "Jorren Ashvale" -> "Aaaaaa Aaaaaaa": the form of a name without the name itself, so other people's names stay private.
local function shape(text)
  if type(text) ~= "string" then return str(text) end
  text = string.gsub(text, "[\128-\255]+", "~")
  text = string.gsub(text, "%u", "A")
  text = string.gsub(text, "%l", "a")
  text = string.gsub(text, "%d", "9")
  return text
end

-- "Player-4381-0A1B2C3D" -> "Player-9999-9A9A9A9A" style: the kind, and the form of the rest.
local function guidShape(guid)
  if type(guid) ~= "string" then return str(guid) end
  local kind, rest = string.match(guid, "^(%a+)%-(.*)$")
  if not kind then return shape(guid) end
  rest = string.gsub(rest, "[A-Fa-f]", "x")
  rest = string.gsub(rest, "%d", "9")
  return kind .. "-" .. rest
end

-- The events this file listens to, on a frame of its own.
local listeners = {}
local frame = CreateFrame("Frame")
frame:SetScript("OnEvent", function(_, event, ...)
  local fn = listeners[event]
  if fn then fn(event, ...) end
end)

local function listen(event, fn)
  listeners[event] = fn
  pcall(frame.RegisterEvent, frame, event)
end

local function unlisten(event)
  listeners[event] = nil
  pcall(frame.UnregisterEvent, frame, event)
end

-- Calls callback(timedOut) when `event` fires, or after `seconds` if it does not.
local function waitForEvent(event, seconds, callback)
  local finished = false
  local function finish(timedOut)
    if finished then return end
    finished = true
    unlisten(event)
    callback(timedOut)
  end
  listen(event, function() finish(false) end)
  after(seconds, function() finish(true) end)
end

---------------------------------------------------------------------------------------------------------------
-- Steps. Each is function(done, fail, bundle): call done(note) when finished, fail(text) when it cannot go on.
-- A step that waits for something calls them later from a timer or an event; guard() makes an error there a failure.
---------------------------------------------------------------------------------------------------------------

local function guard(fail, fn)
  return function(...)
    local ok, err = pcall(fn, ...)
    if not ok then fail("error: " .. tostring(err)) end
  end
end

local STEPS = {}

local function step(name, limit, fn)
  STEPS[#STEPS + 1] = { name = name, limit = limit, fn = fn }
end

step("client and group", 10, function(done)
  P.probe(true)
  local p = P.getDb().probe
  done(string.format("client %s build %s, level %s", str(p.build and p.build.version), str(p.build and p.build.build), str(p.player and p.player.level)))
end)

step("names and screen", 10, function(done, _, b)
  local first, realm
  if UnitFullName then first, realm = safe(UnitFullName, "player") end
  b.names = {
    unitName = shape(call("UnitName", "player")),
    unitNameWithRealm = shape(call("GetUnitName", "player", true)),
    unitFullName = { shape(first), shape(realm) },
    guid = guidShape(call("UnitGUID", "player")),
  }
  b.platform = {
    windows = call("IsWindowsClient"), mac = call("IsMacClient"), linux = call("IsLinuxClient"),
    locale = call("GetLocale"), portal = call("GetCVar", "portal"),
    uiScale = safe(function() return UIParent:GetScale() end),
    screenWidth = call("GetScreenWidth"), screenHeight = call("GetScreenHeight"),
    useUiScale = call("GetCVar", "useUiScale"), uiScaleCvar = call("GetCVar", "uiScale"), autoLoot = call("GetCVar", "autoLootDefault"),
    serverTime = call("GetServerTime"), localTime = call("time"), framerate = call("GetFramerate"),
    luaMemoryKB = safe(collectgarbage, "count"),
  }
  done()
end)

step("guild", 12, function(done, fail, b)
  if not (IsInGuild and IsInGuild()) then
    b.guild = { inGuild = false }
    return done("not in a guild")
  end
  local function read()
    local g = { inGuild = true, members = {} }
    b.guild = g
    local count = lookup("GetNumGuildMembers") or lookup("C_GuildInfo.GetNumGuildMembers")
    if count then g.total, g.online = safe(count) end
    local info = lookup("GetGuildRosterInfo") or lookup("C_GuildInfo.GetGuildRosterInfo")
    if info and type(g.total) == "number" then
      for i = 1, math.min(g.total, 15) do
        -- safe() passes on only eight values and this function returns more, so collect them here (r[1] is pcall's flag).
        local r = { pcall(info, i) }
        if r[1] then
          g.members[#g.members + 1] = { name = shape(r[2]), rankIndex = r[4], level = r[5], online = r[10], class = r[12] }
        else
          g.members[#g.members + 1] = { error = string.sub(tostring(r[2]), 1, 80) }
        end
      end
    end
    return g
  end
  waitForEvent("GUILD_ROSTER_UPDATE", 6, guard(fail, function(timedOut)
    local g = read()
    done(string.format("%s members, %s online%s", str(g.total), str(g.online), timedOut and " (no update event came; read what was there)" or ""))
  end))
  local request = lookup("C_GuildInfo.GuildRoster") or lookup("GuildRoster")
  if request then pcall(request) end
end)

local FRAME_TEMPLATES = {
  { "Frame", "BackdropTemplate" }, { "Frame", "BasicFrameTemplate" }, { "Frame", "BasicFrameTemplateWithInset" },
  { "Frame", "UIPanelDialogTemplate" }, { "Frame", "DialogBoxFrame" }, { "Frame", "TooltipBackdropTemplate" },
  { "Button", "UIPanelButtonTemplate" }, { "Button", "UIPanelCloseButton" }, { "Button", "UIPanelButtonGrayTemplate" },
  { "Button", "SecureActionButtonTemplate" }, { "ScrollFrame", "UIPanelScrollFrameTemplate" }, { "EditBox", "InputBoxTemplate" },
  { "CheckButton", "UICheckButtonTemplate" }, { "CheckButton", "OptionsCheckButtonTemplate" },
  { "CheckButton", "ChatConfigCheckButtonTemplate" }, { "Frame", "UIDropDownMenuTemplate" }, { "Slider", "OptionsSliderTemplate" },
  { "Frame", "WowScrollBoxList" }, { "EventFrame", "MinimalScrollBar" }, { "Frame", "ScrollingEditBoxTemplate" },
  { "StatusBar", nil }, { "Cooldown", "CooldownFrameTemplate" },
}
local FONTS = { "GameFontNormal", "GameFontHighlight", "GameFontHighlightSmall", "GameFontNormalSmall", "GameFontNormalLarge",
  "ChatFontNormal", "NumberFontNormal", "GameTooltipText" }
local UI_APIS = { "PlaySound", "SOUNDKIT", "FlashClientIcon", "GameTooltip", "StaticPopup_Show", "StaticPopupDialogs", "Settings",
  "Settings.RegisterCanvasLayoutCategory", "InterfaceOptions_AddCategory", "Menu", "MenuUtil", "CreateScrollBoxListLinearView",
  "ScrollUtil", "CreateDataProvider", "RAID_CLASS_COLORS", "C_ClassColor", "GetClassColor", "Mixin", "CreateFromMixins",
  "SendChatMessage", "C_ChatInfo.SendChatMessage", "issecretvalue", "C_Secrets", "C_RestrictedActions", "SetPortraitTexture",
  "GetItemQualityColor", "C_Item.GetItemQualityColor", "BackdropTemplateMixin", "UIDropDownMenu_Initialize", "EasyMenu",
  "ToggleDropDownMenu", "CloseDropDownMenus", "UISpecialFrames", "tinsert", "strsplit", "wipe", "CopyTable", "TableUtil",
  "GetTimePreciseSec", "IsShiftKeyDown", "InCombatLockdown", "C_Timer.NewTicker", "LibStub", "ScrollingTable" }

step("window templates", 10, function(done, _, b)
  local ui = { templates = {}, fonts = {}, apis = {} }
  b.ui = ui
  for _, spec in ipairs(FRAME_TEMPLATES) do
    local ok, result = pcall(CreateFrame, spec[1], nil, UIParent, spec[2])
    local label = spec[1] .. (spec[2] and (" + " .. spec[2]) or "")
    ui.templates[label] = ok and "ok" or ("ERROR: " .. string.sub(tostring(result), 1, 80))
    if ok and type(result) == "table" and result.Hide then pcall(result.Hide, result) end
  end
  for _, name in ipairs(FONTS) do ui.fonts[name] = type(_G[name]) end
  for _, path in ipairs(UI_APIS) do ui.apis[path] = type(lookup(path)) end
  done()
end)

local PROTECTED_EVENTS = { "ADDON_ACTION_FORBIDDEN", "ADDON_ACTION_BLOCKED", "UI_ERROR_MESSAGE", "CHAT_MSG_SYSTEM" }

step("invite and raid conversion", 10, function(done, fail, b)
  local seen = {}
  local function collect(event, ...)
    if #seen >= 30 then return end
    local args = {}
    for i = 1, select("#", ...) do args[i] = str((select(i, ...))) end
    seen[#seen + 1] = { event = event, args = args }
  end
  for _, event in ipairs(PROTECTED_EVENTS) do listen(event, collect) end

  local alone = not (IsInGroup and IsInGroup())
  local r = { alone = alone, inGuild = IsInGuild and IsInGuild() or false }
  b.protected = r

  local inviteName = exists("C_PartyInfo.InviteUnit") and "C_PartyInfo.InviteUnit" or "InviteUnit"
  local invite = lookup(inviteName)
  if invite then
    local ok, result = pcall(invite, "Intrepidprobetest")
    r.invite = { api = inviteName, called = ok, result = str(result) }
  else
    r.invite = { api = "missing" }
  end

  local convertName = exists("C_PartyInfo.ConvertToRaid") and "C_PartyInfo.ConvertToRaid" or "ConvertToRaid"
  local convert = lookup(convertName)
  if not convert then
    r.convert = { api = "missing" }
  elseif not alone then
    r.convert = { api = convertName, skipped = "in a group: converting would change the group" }
  else
    local ok, result = pcall(convert)
    r.convert = { api = convertName, called = ok, result = str(result) }
  end
  r.canInvite = call("C_PartyInfo.CanInvite")

  after(2.5, guard(fail, function()
    for _, event in ipairs(PROTECTED_EVENTS) do unlisten(event) end
    local blocked = 0
    for _, row in ipairs(seen) do
      if row.event == "ADDON_ACTION_FORBIDDEN" or row.event == "ADDON_ACTION_BLOCKED" then blocked = blocked + 1 end
    end
    r.messages = seen
    r.blockedCount = blocked
    done(blocked > 0 and "the game BLOCKED a call (see the file)" or "no call was blocked")
  end))
end)

-- Name patterns of the client's own message texts: loot lines, rolls, trades, groups, invites, binding.
local STRING_PATTERNS = { "^LOOT_", "^ERR_TRADE", "^ERR_.*GROUP", "^ERR_.*PARTY", "^ERR_.*RAID", "^ERR_.*INVITE", "^ERR_.*LEADER",
  "^ERR_.*LOOT", "^ERR_.*MASTER", "^ERR_CHAT_PLAYER", "^BIND_", "^ITEM_BIND", "^ITEM_SOULBOUND", "^TRADE_" }

step("message texts", 10, function(done, _, b)
  local strings, count = {}, 0
  b.strings = strings
  for name, value in pairs(_G) do
    if type(name) == "string" and type(value) == "string" and count < 600 then
      for _, pattern in ipairs(STRING_PATTERNS) do
        if string.find(name, pattern) then
          strings[name] = string.sub(value, 1, 240)
          count = count + 1
          break
        end
      end
    end
  end
  done(count .. " texts")
end)

local NAMESPACES = { "C_Item", "C_Container", "C_GuildInfo", "C_Secrets", "C_RestrictedActions", "C_TooltipInfo", "C_Timer", "C_CVar",
  "C_Loot", "C_LootHistory", "C_PartyInfo", "C_ChatInfo", "C_EncounterJournal", "C_AddOns", "Enum.ItemQuality", "Enum.ItemBind",
  "Enum.ItemClass", "Enum.LootMethod" }

step("API names", 10, function(done, _, b)
  local spaces, found = {}, 0
  b.namespaces = spaces
  for _, space in ipairs(NAMESPACES) do
    local t = lookup(space)
    if type(t) == "table" then
      local names = {}
      for key, value in pairs(t) do
        if #names < 500 then
          names[#names + 1] = (type(value) == "number") and (tostring(key) .. "=" .. tostring(value)) or tostring(key)
        end
      end
      table.sort(names)
      spaces[space] = names
      found = found + 1
    else
      spaces[space] = false
    end
  end
  done(found .. " of " .. #NAMESPACES .. " exist")
end)

step("Encounter Journal", 30, function(done)
  local instances, bosses, items = P.dumpEncounterJournal(true, 10000)
  local level = P.getDb().ej and P.getDb().ej.playerLevel
  done(string.format("%s instances, %s bosses, %s items (character level %s)", str(instances), str(bosses), str(items), str(level)))
end)

-- One item as the game describes it: nil when the game has no data for it (yet).
local function readItem(getInfo, id)
  if not getInfo then return nil end
  local r = { pcall(getInfo, id) }
  if not r[1] then return nil end
  local first = r[2]
  if type(first) == "table" then
    return { name = first.itemName or first.name, quality = first.itemQuality or first.quality, itemLevel = first.itemLevel,
      minLevel = first.itemMinLevel or first.minLevel, type = first.itemType or first.type, subType = first.itemSubType or first.subType,
      equipLoc = first.itemEquipLoc or first.equipLoc, classID = first.classID, subClassID = first.subclassID or first.subClassID,
      bindType = first.bindType }
  end
  if not first then return nil end
  return { name = first, quality = r[4], itemLevel = r[5], minLevel = r[6], type = r[7], subType = r[8], equipLoc = r[10],
    classID = r[13], subClassID = r[14], bindType = r[15] }
end

step("item ids from the loot tables", 40, function(done, fail, b)
  local ids = ns.ITEM_IDS
  if type(ids) ~= "table" or #ids == 0 then return done("no item list (Items.lua did not load)") end
  local request = lookup("C_Item.RequestLoadItemDataByID")
  local getInfo = lookup("C_Item.GetItemInfo") or lookup("GetItemInfo")
  local getInstant = lookup("C_Item.GetItemInfoInstant") or lookup("GetItemInfoInstant")
  local results = { asked = #ids, rows = {}, unknown = {} }
  b.items = results

  local function summarize()
    local rows, unknown = {}, {}
    for _, id in ipairs(ids) do
      local row = readItem(getInfo, id)
      if row and row.name then
        row.id = id
        rows[#rows + 1] = row
      else
        local entry = { id = id }
        if getInstant then
          local instant = { pcall(getInstant, id) }
          entry.instant = (instant[1] and instant[2]) and { type = instant[3], subType = instant[4], equipLoc = instant[5], classID = instant[7], subClassID = instant[8] } or false
        end
        unknown[#unknown + 1] = entry
      end
    end
    return rows, unknown
  end

  local waited = 0
  local function poll()
    local rows, unknown = summarize()
    if #unknown == 0 or waited >= 10 then
      results.rows, results.unknown, results.waitedSeconds = rows, unknown, waited
      local newKnown, newUnknown = 0, 0
      for _, row in ipairs(rows) do if row.id > 200000 then newKnown = newKnown + 1 end end
      for _, entry in ipairs(unknown) do if entry.id > 200000 then newUnknown = newUnknown + 1 end end
      results.idsAbove200000 = { known = newKnown, unknown = newUnknown }
      return done(string.format("%d of %d known to the game; ids above 200000: %d known, %d unknown", #rows, #ids, newKnown, newUnknown))
    end
    waited = waited + 1
    after(1, guard(fail, poll))
  end

  -- Ask for the data in batches of 40 so the server is not flooded, then read what came back.
  local nextId = 1
  local function requestMore()
    if request then
      for i = nextId, math.min(nextId + 39, #ids) do pcall(request, ids[i]) end
    end
    nextId = nextId + 40
    if nextId <= #ids then after(0.25, guard(fail, requestMore)) else after(2, guard(fail, poll)) end
  end
  requestMore()
end)

---------------------------------------------------------------------------------------------------------------
-- Running the steps
---------------------------------------------------------------------------------------------------------------

local active = false

local function finishBundle()
  local db = P.getDb()
  local b = db.bundle
  b.finishedAt = P.now()
  local total, problems = 0, 0
  for _, row in pairs(b.steps) do
    total = total + 1
    if not row.ok then problems = problems + 1 end
  end
  b.problems = problems
  if not P.isLogging() then P.setLogging(true) end
  P.out(string.format("Bundle finished: %d steps, %d with a problem.", total, problems))
  P.out("Now type /reload (this saves what was found). Then play normally for 20 to 30 minutes: kill things, loot, a dungeon if you like. The event log is on.")
  active = false
end

local function runStep(index)
  local def = STEPS[index]
  if not def then return finishBundle() end
  local b = P.getDb().bundle
  local finished = false
  local startedAt = clock()

  local function conclude(ok, note)
    if finished then return end
    finished = true
    local took = startedAt and clock() and math.floor(clock() - startedAt + 0.5) or nil
    b.steps[def.name] = { n = index, ok = ok, ms = took, note = note }
    P.out(string.format("  %d/%d %s: %s%s", index, #STEPS, def.name, ok and "ok" or "PROBLEM", note and (" (" .. tostring(note) .. ")") or ""))
    after(0.1, function() runStep(index + 1) end)
  end

  local function done(note) conclude(true, note) end
  local function fail(note) conclude(false, note) end

  local ok, err = pcall(def.fn, done, fail, b)
  if not ok then return fail("error: " .. string.sub(tostring(err), 1, 200)) end
  after(def.limit or 20, function() fail("timed out") end)
end

local function run(label)
  local db = P.getDb()
  if not db then P.out("Not ready yet.") return end
  if not (C_Timer and C_Timer.After) then
    P.out("This client has no C_Timer.After, so the bundle cannot run. Use /ip probe, /ip ej and /ip log on instead.")
    return
  end
  if active then P.out("The bundle is already running.") return end
  active = true
  label = (label or ""):match("^%s*(.-)%s*$")
  if label ~= "" then
    db.run = { label = label, startedAt = P.now(), version = db.addonVersion }
    db.runs = db.runs or {}
    db.runs[#db.runs + 1] = db.run
  end
  db.bundle = { startedAt = P.now(), version = db.addonVersion, label = label ~= "" and label or nil, steps = {} }
  P.out("Running the bundle: " .. #STEPS .. " steps, about 20 seconds. Stay where you are, out of combat, and do not type commands until it says finished.")
  P.out("If a window says an addon action was blocked, click Ignore (do not click Disable).")
  runStep(1)
end

ns.bundle = { run = run, steps = STEPS, shape = shape, guidShape = guidShape, guard = guard, waitForEvent = waitForEvent }
