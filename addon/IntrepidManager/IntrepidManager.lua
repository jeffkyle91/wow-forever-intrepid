-- Intrepid Manager: entry point. Everything that does not need the client lives in core/ and is unit tested.

local ADDON, ns = ...

local function out(text) print("|cff66ccffIntrepid Manager:|r " .. tostring(text)) end

local function addonVersion()
  local get = (C_AddOns and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata
  if get then
    local ok, value = pcall(get, ADDON, "Version")
    if ok and value then return value end
  end
  return "unknown"
end
ns.version = addonVersion

-- /im selftest [label]: runs the exchange code (checksum, JSON, envelope) inside the game and times it. The result is
-- kept in IntrepidManagerDB.selftest and reaches the disk at the next /reload; tools/pull-results.sh then collects it,
-- with the label in the folder name.
local function runSelfTest(argument)
  if InCombatLockdown and InCombatLockdown() then
    out("Not in combat, please. Try again when the fight is over.")
    return
  end
  local label = string.match(argument or "", "^%s*(.-)%s*$")
  label = string.sub(string.gsub(label, "[^%w_-]+", "_"), 1, 24) -- it ends up in a folder name

  local env = { bit = bit, memory = function() return collectgarbage("count") end }
  if debugprofilestop then
    env.now, env.timer = debugprofilestop, "debugprofilestop"
  end
  out("Running the self-test. The game may pause for a second or two.")
  local result = ns.SelfTest.run(env)

  result.version = addonVersion()
  result.label = label ~= "" and label or nil
  result.ranAt = time and time() or nil
  result.serverTime = GetServerTime and GetServerTime() or nil
  if GetBuildInfo then
    local ok, version, build, _, interface = pcall(GetBuildInfo)
    if ok then result.client = { version = version, build = build, interface = interface } end
  end

  IntrepidManagerDB = IntrepidManagerDB or {}
  IntrepidManagerDB.selftest = result
  IntrepidManagerDB.run = label ~= "" and { label = label } or nil
  for _, line in ipairs(ns.SelfTest.summary(result)) do out(line) end
  out("Type /reload to save the results to a file.")
end

-- /im window [session|import|picker|confirm] [roomy] [flat]: the windows on sample data (ui/Demo.lua), to look at in the game
-- before the engine exists. Nothing is given or imported.
local demo
local function getDemo()
  if not demo then
    IntrepidManagerDB = IntrepidManagerDB or {}
    demo = ns.UI.Demo.new({ out = out, db = IntrepidManagerDB })
  end
  return demo
end

-- /im inspect: asks the game to inspect your target and records what came back (ui/Inspect.lua), for the test builds.
local inspect
local function getInspect()
  if not inspect then
    IntrepidManagerDB = IntrepidManagerDB or {}
    inspect = ns.UI.Inspect.new({ out = out, db = IntrepidManagerDB })
  end
  return inspect
end

-- /im loot [give <slot> <who>, sweep <who> [quality], stop]: reads the master loot window and gives items to a player, one at a time
-- (game/LootWindow.lua). A first slice for the test builds; nothing is wired to the session window yet.
local loot
local function getLoot()
  if not loot then
    IntrepidManagerDB = IntrepidManagerDB or {}
    loot = ns.Game.LootWindow.new({ out = out, db = IntrepidManagerDB })
  end
  return loot
end

-- The exchange with the Raid Desk (game/Exchange.lua): the night the loot master imported (/im import) and the awards the sessions make,
-- which /im export turns into the awards string to paste into the Raid Desk.
local council
local exchange
local exportEverything = false
local function getExchange()
  if not exchange then
    IntrepidManagerDB = IntrepidManagerDB or {}
    exchange = ns.Game.Exchange.new({
      db = IntrepidManagerDB, version = addonVersion(),
      -- (the ids of a load must differ from the ids of the loads before: the clock's milliseconds are mixed into the random numbers)
      random = function(n) return (math.floor(math.random() * n + (GetTime() % 1) * 1000) % n) + 1 end,
      sessionOpen = function() return council ~= nil and council.sessionOpen() end,
    })
  end
  return exchange
end

-- The view-model of the import window: the night the addon has, and whether a session blocks a new one.
local function importModel()
  return { current = getExchange().nightText(), sessionOpen = council ~= nil and council.sessionOpen() }
end

-- /im session [add, bags, bag, list, remove, start, results, end], /im respond <item> <bis, up, os or pass> [note], /im offers: the council
-- session (game/CouncilSession.lua). Every client listens for offers from the moment the addon loads (see ADDON_LOADED below).
local function getCouncil()
  if not council then
    IntrepidManagerDB = IntrepidManagerDB or {}
    council = ns.Game.CouncilSession.new({ out = out, db = IntrepidManagerDB, version = addonVersion(), exchange = getExchange() })
  end
  return council
end

-- The council windows (ui/SessionPanel, ui/BagPicker, ui/ResponseFrame) sit on the session above. They are made when first needed:
-- the session tells them through its hooks, an offer from the loot master opens the raider's frame by itself, and /im session
-- (with no word) opens the loot master's window.
local councilWindows
local function getCouncilWindows()
  if councilWindows then return councilWindows end
  IntrepidManagerDB = IntrepidManagerDB or {}
  IntrepidManagerDB.positions = IntrepidManagerDB.positions or {}
  local session = getCouncil()
  local kit = ns.UI.Kit.new({
    density = "compact", chrome = "stock", positions = IntrepidManagerDB.positions,
    onError = function(err) out("window error: " .. tostring(err)) end,
  })
  local windows = {}
  windows.picker = ns.UI.BagPicker.new(kit, {
    rows = function(all) return session.scanBags(all) end,
    add = function(rows) session.addRows(rows) end,
  })
  windows.panel = ns.UI.SessionPanel.new(kit, {
    model = session.masterModel, rows = session.rowsModel,
    bags = function() windows.picker.show() end,
    remove = session.removeItem, start = function(seconds) session.start(tostring(seconds)) end,
    finish = session.finish, reset = session.reset, award = session.award, unaward = session.unaward, trade = session.trade,
    versions = session.versions,
    importNight = function() windows.import.open(importModel()) end,
    exportAwards = function() windows.export.open(getExchange().exportModel(exportEverything)) end,
  })
  windows.versions = ns.UI.VersionWindow.new(kit, { model = session.versionsModel, check = session.checkVersions })
  -- The night from the Raid Desk, and the awards back to it (docs/spec/exchange-v0.md). The import window shows the new night at once.
  windows.import = ns.UI.ImportWindow.new(kit, {
    import = function(_, result)
      local answer = getExchange().importNight(result)
      windows.import.update(importModel())
      return answer
    end,
  })
  windows.export = ns.UI.ExportWindow.new(kit, {
    everything = function(on)
      exportEverything = on
      windows.export.update(getExchange().exportModel(on))
    end,
    done = function()
      out(InCombatLockdown and InCombatLockdown() and "Type /reload when the fight is over, so the game writes your awards to its file."
        or "Type /reload so the game writes your awards to its file.")
    end,
  })
  windows.offers = ns.UI.ResponseFrame.new(kit, {
    model = session.offerModel,
    answer = function(sid, n, code, note) session.answer(n, code, note, sid) end,
  })
  councilWindows = windows
  return windows
end

-- What the session tells the windows. They are only made when something needs one, and only repainted when they are on screen.
local function wireCouncilWindows()
  local session = getCouncil()
  local function repaintPanel()
    if councilWindows and councilWindows.panel.isShown() then councilWindows.panel.update(session.masterModel()) end
  end
  local function repaintOffers()
    if councilWindows and councilWindows.offers.isShown() then councilWindows.offers.update(session.offerModel()) end
  end
  local hooks = session.hooks
  hooks.onOffer = function()
    local windows = getCouncilWindows()
    windows.offers.update(session.offerModel())
    windows.offers.show()
  end
  hooks.onOfferChanged = repaintOffers
  hooks.onQueueChanged = repaintPanel
  hooks.onSessionStarted = repaintPanel
  hooks.onResponse = repaintPanel
  hooks.onHello = repaintPanel
  -- An award or a delivery changes the awards string: the export window, when it is on screen, shows the new one.
  local function repaintExport()
    if councilWindows and councilWindows.export.isShown() then councilWindows.export.update(getExchange().exportModel(exportEverything)) end
  end
  hooks.onAwarded = function()
    repaintPanel()
    repaintExport()
  end
  hooks.onGiven = hooks.onAwarded
  hooks.onEnd = function()
    repaintPanel()
    repaintOffers()
  end
  -- Every offer is over (the time ran out or the loot master ended the session): the answer window shows what was answered for a
  -- moment and closes by itself.
  hooks.onOffersClosed = function()
    if not councilWindows then return end
    councilWindows.offers.update(session.offerModel())
    C_Timer.After(2, function()
      if councilWindows and session.openOffers() == 0 then councilWindows.offers.hide() end
    end)
  end
  hooks.onOpen = function()
    local windows = getCouncilWindows()
    windows.panel.update(session.masterModel())
    windows.panel.show()
  end
  -- The versions heard changed (an announce, an answer to the check, the group): repaint the version window when it is on screen.
  hooks.onVersions = function()
    if councilWindows and councilWindows.versions.isShown() then councilWindows.versions.update(session.versionsModel()) end
  end
  hooks.onVersionsOpen = function()
    local windows = getCouncilWindows()
    windows.versions.update(session.versionsModel())
    windows.versions.show()
  end
end

-- /im msgtest [run, stop or clear]: measures addon messages between two clients in a group (net/MsgTest.lua). The client that does
-- not run it still listens and answers from the start (see ADDON_LOADED below), so the second client needs no command.
local msgtest
local function getMsgTest()
  if not msgtest then
    IntrepidManagerDB = IntrepidManagerDB or {}
    msgtest = ns.Net.MsgTest.new({ out = function(text) out(text) end, db = IntrepidManagerDB })
  end
  return msgtest
end

-- /im facts [label]: opens the sample windows, measures what the game's own widgets and fonts and those windows really are
-- (ui/Facts.lua) and keeps the result in IntrepidManagerDB.facts. Like the self-test, it reaches the disk at the next /reload.
local function runFacts(argument)
  if InCombatLockdown and InCombatLockdown() then
    out("Not in combat, please. Try again when the fight is over.")
    return
  end
  local label = string.match(argument or "", "^%s*(.-)%s*$")
  label = string.sub(string.gsub(label, "[^%w_-]+", "_"), 1, 24) -- it ends up in a folder name
  local current = getDemo()
  local frames = current.showAll()
  out("Measuring the game's widgets and the sample windows. This takes a couple of seconds.")
  local result = ns.UI.Facts.run({
    windows = frames,
    done = function(finished)
      current.hideAll()
      for _, line in ipairs(ns.UI.Facts.summary(finished)) do out(line) end
      out("Type /reload to save the results to a file.")
    end,
  })
  result.version = addonVersion()
  result.label = label ~= "" and label or nil
  result.ranAt = time and time() or nil
  IntrepidManagerDB.facts = result
  IntrepidManagerDB.run = label ~= "" and { label = label } or nil
end

local function handle(input)
  local command, argument = string.match(input or "", "^%s*(%S*)%s*(.-)%s*$")
  command = string.lower(command or "")
  if command == "version" then
    out("version " .. addonVersion())
  elseif command == "selftest" then
    runSelfTest(argument)
  elseif command == "window" then
    getDemo().open(argument)
  elseif command == "facts" then
    runFacts(argument)
  elseif command == "inspect" then
    getInspect().run()
  elseif command == "msgtest" then
    getMsgTest().command(argument)
  elseif command == "loot" then
    getLoot().command(argument)
  elseif command == "session" then
    getCouncil().command(argument)
  elseif command == "versions" then
    getCouncil().versions()
  elseif command == "respond" then
    getCouncil().respond(argument)
  elseif command == "import" then
    getCouncilWindows().import.open(importModel())
  elseif command == "export" then
    local vm = getExchange().exportModel(exportEverything)
    out(vm.count == 0 and "No awards to export yet." or (vm.count .. (vm.count == 1 and " award" or " awards") .. " to export."))
    getCouncilWindows().export.open(vm)
  elseif command == "award" then
    getCouncil().awardCommand(argument)
  elseif command == "trade" then
    getCouncil().tradeCommand(argument)
  elseif command == "offers" then
    getCouncil().offers()
    local windows = getCouncilWindows()
    windows.offers.update(getCouncil().offerModel())
    windows.offers.show()
  else
    out("version " .. addonVersion() .. ". Commands: /im version, /im selftest [label], /im window [session, import, export, icons, picker or confirm] [roomy] [flat], /im facts [label], /im inspect, /im msgtest [run, stop or clear], /im loot [give, sweep or stop], /im session [add, bags, start, results or end], /im respond, /im offers, /im award <item> <name>, /im trade <name>, /im versions, /im import, /im export")
  end
end

SLASH_INTREPIDMANAGER1 = "/im"
SLASH_INTREPIDMANAGER2 = "/intrepidmanager"
SlashCmdList["INTREPIDMANAGER"] = function(input)
  -- Never let an error here reach the player mid-raid.
  local ok, err = pcall(handle, input)
  if not ok then out("error: " .. tostring(err)) end
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("ADDON_LOADED")
frame:SetScript("OnEvent", function(_, event, name)
  if event == "ADDON_LOADED" and name == ADDON then
    IntrepidManagerDB = IntrepidManagerDB or {}
    IntrepidManagerDB.schema = IntrepidManagerDB.schema or 1
    IntrepidManagerDB.addonVersion = addonVersion() -- so a saved file says which build wrote it
    local ok, err = pcall(function() getMsgTest().listen() end)
    if not ok then out("message test could not start listening: " .. tostring(err)) end
    local lootOk, lootErr = pcall(function() getLoot().listen() end)
    if not lootOk then out("the loot test could not start listening: " .. tostring(lootErr)) end
    local councilOk, councilErr = pcall(function()
      getCouncil().listen()
      wireCouncilWindows()
    end)
    if not councilOk then out("the council session could not start listening: " .. tostring(councilErr)) end
  end
end)
