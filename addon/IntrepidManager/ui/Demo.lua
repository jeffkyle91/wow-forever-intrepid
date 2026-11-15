-- Intrepid Manager: the windows on sample data, for looking at them in the game before the engine exists
-- (/im window ...). Nothing here touches loot or the saved night: every callback only says what it would have done.
--
--   local demo = ns.UI.Demo.new({ out = print, db = IntrepidManagerDB })
--   demo.open("session roomy flat")      -- the words of /im window; no word opens the compact session window
--   demo.showAll()                       -- every window at once, for /im facts to measure; returns the frames
--   demo.hideAll()
--
-- The kit remembers where a window was dragged to in db.positions, and the import window's doings (a change of the box, a
-- read and how long it took, an import) are kept in db.pasteLog, the last 60: both reach the disk at the next /reload.

local _, ns = ...

local Demo = {}
ns.UI = ns.UI or {}
ns.UI.Demo = Demo

-- No pipe characters in what goes to the chat: the game reads them as the start of a color or link.
local HELP = "/im window [session, import, export, history, icons, picker or confirm] [roomy] [flat]. The session window also takes 40, "
  .. "unconfirmed, failed, observed or warning (which state it shows); the import window takes sample (the sample night is "
  .. "pasted in); the import and export windows take busy (a session is open)."

local WINDOWS = { session = true, import = true, export = true, history = true, icons = true, picker = true, confirm = true }
local EXTRAS = { ["40"] = true, unconfirmed = true, failed = true, observed = true, warning = true, busy = true, sample = true }

local ATTEMPTS = {
  unconfirmed = { state = "unconfirmed", who = "Mirelle Dunmore" },
  failed = { state = "failed", who = "Orrin Vale", reason = "Inventory is full." },
}

local LAST_WEEK = "Night of 2026-12-02, copied 7 days ago: 58 players, 87 priorities."
local MAX_LOG = 60

-- The words of /im window as { window, density, chrome, extras = { word = true } }, or nil and the first word not understood.
local function parse(argument)
  local request = { window = "session", density = "compact", chrome = "stock", extras = {} }
  for word in string.gmatch(string.lower(argument or ""), "%S+") do
    if WINDOWS[word] then
      request.window = word
    elseif word == "compact" or word == "roomy" then
      request.density = word
    elseif word == "flat" or word == "stock" then
      request.chrome = word
    elseif EXTRAS[word] then
      request.extras[word] = true
    else
      return nil, word
    end
  end
  return request
end

function Demo.new(context)
  local out = context.out or print
  local db = context.db or {}
  local self = {}
  local kit, kitKey
  local session, import, export, icons, history -- the windows, once built (they belong to one kit)
  local exportEverything = false   -- the export window's box "Everything, not only what is new"
  local options, given, removed    -- what the session window shows now, and what was "given" in the demo

  -- What the import window did with a paste, for the saved variables.
  local function remember(entry)
    db.pasteLog = db.pasteLog or {}
    entry.at = GetTime and GetTime() or nil
    db.pasteLog[#db.pasteLog + 1] = entry
    while #db.pasteLog > MAX_LOG do table.remove(db.pasteLog, 1) end
  end

  -- A new kit (and new windows) when the density or the frame changes; the old windows are hidden.
  local function kitFor(request)
    local key = request.density .. "/" .. request.chrome
    if key ~= kitKey then
      if session then
        session.hide()
        session.confirm.hide()
        session.picker.hide()
      end
      if import then import.hide() end
      if export then export.hide() end
      if icons then icons.hide() end
      if history then history.hide() end
      session, import, export, icons, history = nil, nil, nil, nil, nil
      db.positions = db.positions or {}
      kit = ns.UI.Kit.new({
        density = request.density, chrome = request.chrome, positions = db.positions,
        onError = function(err) out("error: " .. tostring(err)) end,
      })
      kitKey = key
    end
    return kit
  end

  -----------------------------------------------------------------------------------------------------------
  -- The session window: a small pretend session where Give marks an item as given and nothing else happens
  -----------------------------------------------------------------------------------------------------------
  local function buildVm()
    local vm = ns.UI.Sample.session(options)
    local awarded = 0
    for index, item in ipairs(vm.items) do
      if given[index] then item.state, item.to = "awarded", given[index] end
      if removed[index] then item.state = "removed" end
      if item.state == "awarded" then awarded = awarded + 1 end
    end
    local selected = vm.items[vm.selected]
    vm.item.state, vm.item.to = selected.state, selected.to
    vm.summary = awarded .. " of " .. #vm.items .. " awarded"
    return vm
  end

  local function refresh()
    session.update(buildVm())
  end

  local function sessionCallbacks()
    local function say(text) out("Demo: " .. text .. " Nothing was given.") end
    local function nameOf(index) return ns.UI.Sample.session().items[index].name end
    return {
      select = function(index)
        options.selected = index
        refresh()
      end,
      preview = function(_, who) return { ok = true, recipient = who, lines = { "Demo only: nothing is given." } } end,
      give = function(index, who, choice)
        given[index] = who
        say("would give " .. nameOf(index) .. " to " .. who .. " (" .. tostring(choice and choice.decision) .. ").")
        refresh()
      end,
      pseudo = function(index, kind)
        given[index] = kind == "disenchant" and "Disenchanted" or "Guild bank"
        say("would send " .. nameOf(index) .. " to " .. kind .. ".")
        refresh()
      end,
      remove = function(index)
        removed[index] = true
        say("would remove " .. nameOf(index) .. " from the session.")
        refresh()
      end,
      restore = function(index)
        removed[index] = nil
        refresh()
      end,
      finish = function() say("the session would finish.") end,
      retry = function(index, who) say("would try " .. nameOf(index) .. " for " .. who .. " again.") end,
      markReceived = function(index, who)
        options.attempt = nil
        say("would mark " .. nameOf(index) .. " as received by " .. who .. ".")
        refresh()
      end,
      confirmObserved = function() options.observed = nil refresh() end,
      dismissObserved = function() options.observed = nil refresh() end,
    }
  end

  local function showSession(request, together)
    kitFor(request)
    if not together then -- one main window at a time, unless they are all wanted
      if import then import.hide() end
      if export then export.hide() end
      if icons then icons.hide() end
    end
    if not session then session = ns.UI.SessionWindow.new(kit, sessionCallbacks()) end
    local extras = request.extras
    options = {
      lines = extras["40"] and 40 or 12, warnings = extras.warning and { "A roll for this item is still running." } or nil,
      attempt = (extras.unconfirmed and ATTEMPTS.unconfirmed) or (extras.failed and ATTEMPTS.failed) or nil,
      observed = extras.observed and { { id = "o1", who = "Garrick Vole", item = "Blade of the Fixture" } } or nil,
      busy = extras.busy == true, selected = 1,
    }
    given, removed = {}, {}
    refresh()
    session.show()
    return session
  end

  -----------------------------------------------------------------------------------------------------------
  -- The import window: it reads for real; Import only says what it would have done
  -----------------------------------------------------------------------------------------------------------
  local function showImport(request, together)
    kitFor(request)
    if not together then
      if session then
        session.hide()
        session.confirm.hide()
        session.picker.hide()
      end
      if export then export.hide() end
      if icons then icons.hide() end
    end
    if not import then
      import = ns.UI.ImportWindow.new(kit, {
        import = function(text)
          out("Demo: would import " .. #text .. " characters. Nothing was imported.")
          return { ok = true, message = "Demo only: nothing was imported." }
        end,
      }, { log = remember })
    end
    if request.extras.sample then
      import.parts.edit:SetText(ns.SelfTestSamples.night)
    end
    import.open({ current = LAST_WEEK, sessionOpen = request.extras.busy == true })
    return import
  end

  -----------------------------------------------------------------------------------------------------------
  -- The export window: the sample awards string, five awards, three new and two changed (seven in all with the box ticked)
  -----------------------------------------------------------------------------------------------------------
  local function exportVm(request)
    return {
      text = ns.SelfTestSamples.awards, count = exportEverything and 7 or 5, new = 3, changed = 2, hasNight = true,
      everything = exportEverything, sessionOpen = request.extras.busy == true,
    }
  end

  local function makeExport(request)
    if not export then
      export = ns.UI.ExportWindow.new(kit, {
        everything = function(on)
          exportEverything = on
          export.update(exportVm(request))
          out("Demo: the export would hold " .. (on and "everything" or "what is new") .. ".")
        end,
        done = function() out("Demo: Done. After a real export the addon would suggest a /reload, never force one.") end,
      })
    end
    return export
  end

  local function showExport(request, together)
    kitFor(request)
    if not together then
      if session then
        session.hide()
        session.confirm.hide()
        session.picker.hide()
      end
      if import then import.hide() end
      if icons then icons.hide() end
    end
    exportEverything = false
    makeExport(request)
    export.open(exportVm(request))
    return export
  end

  -----------------------------------------------------------------------------------------------------------
  -- The icon test window: class icons, item icons, gear and tooltips, to look at in the game
  -----------------------------------------------------------------------------------------------------------
  local function showIcons(request)
    kitFor(request)
    if session then
      session.hide()
      session.confirm.hide()
      session.picker.hide()
    end
    if import then import.hide() end
    if export then export.hide() end
    if not icons then icons = ns.UI.IconWindow.new(kit) end
    icons.open()
    return icons
  end

  -----------------------------------------------------------------------------------------------------------
  -- The loot history window: four weeks of invented raids (ui/Sample.lua), in the player's local time
  -----------------------------------------------------------------------------------------------------------
  local function clock(at) return date("*t", at) end

  -- Export in the demo's history: the export window with every award of the night or raid picked, written for real from the
  -- invented log (without `place`, which never leaves the addon), so the string reads back like a real one.
  local function exportPicked(request, log, pick)
    local ids, awards = ns.History.idsOf(ns.History.build(log, clock), pick.kind, pick.key), {}
    for _, award in ipairs(log) do
      if ids[award.id] then
        local copy = {}
        for key, value in pairs(award) do
          if key ~= "place" then copy[key] = value end
        end
        awards[#awards + 1] = copy
      end
    end
    local now = GetServerTime and GetServerTime() or 1796866200
    local text = #awards > 0 and ns.Awards.encode({
      schema = 1, id = ns.Ids.exportId(now, function() return 1 end), at = now, by = "IntrepidManager/demo", awards = awards,
    }) or nil
    kitFor(request)
    makeExport(request)
    export.open({ text = text, count = #awards, new = #awards, changed = 0, hasNight = false, session = pick.label })
    out("Demo: the export window holds the " .. #awards .. " invented awards of " .. pick.label .. ".")
  end

  local shownLog, shownRequest -- what the history window shows now, for its Export
  local function showHistory(request)
    kitFor(request)
    local now = GetServerTime and GetServerTime() or 1796866200
    local log = ns.UI.Sample.historyLog(now)
    shownLog, shownRequest = log, request
    if not history then
      history = ns.UI.HistoryWindow.new(kit, { export = function(pick) exportPicked(shownRequest, shownLog, pick) end })
    end
    local today = date("*t", now)
    history.open({
      history = ns.History.build(log, clock), year = today.year, today = ns.History.dayNumber(today.year, today.month, today.day),
      limit = 10000, search = "",
    })
    return history
  end

  -----------------------------------------------------------------------------------------------------------
  -- Outside
  -----------------------------------------------------------------------------------------------------------
  function self.open(argument)
    local request, unknown = parse(argument)
    if not request then
      out("I do not know '" .. unknown .. "'. " .. HELP)
      return
    end
    if request.window == "import" then
      showImport(request)
    elseif request.window == "export" then
      showExport(request)
    elseif request.window == "icons" then
      showIcons(request)
    elseif request.window == "history" then
      showHistory(request)
    else
      showSession(request)
      if request.window == "picker" then
        session.picker.open(buildVm().item.candidates, function(entry) out("Demo: picked " .. entry.name .. ".") end)
      elseif request.window == "confirm" then
        local Kit = ns.UI.Kit
        session.confirm.ask({
          item = Kit.colored(Kit.qualityColor(4), "Blade of the Fixture"), quality = 4, icon = "Interface\\Icons\\INV_Sword_27",
          recipient = Kit.colored(Kit.classColor("Druid"), "Garrick Vole"), lines = { "Decision: council" },
          warnings = { "Garrick Vole already got a cloak from this boss." },
        }, function() out("Demo: confirmed. Nothing was given.") end)
      end
    end
    out("Showing the " .. request.window .. " window (" .. request.density .. ", " .. request.chrome .. " frame) on sample data. "
      .. "Nothing is given or imported. Escape closes it.")
  end

  -- Every window at once, as /im facts measures them. Returns their frames.
  function self.showAll()
    local request = { window = "session", density = "compact", chrome = "stock", extras = { unconfirmed = true } } -- with its banner
    showSession(request, true)
    session.picker.open(buildVm().item.candidates, function() end)
    local Kit = ns.UI.Kit
    session.confirm.ask({
      item = Kit.colored(Kit.qualityColor(4), "Blade of the Fixture"), quality = 4, icon = "Interface\\Icons\\INV_Sword_27",
      recipient = Kit.colored(Kit.classColor("Druid"), "Garrick Vole"), lines = { "Decision: council" },
      warnings = { "Garrick Vole already got a cloak from this boss." },
    }, function() end)
    request.extras = { sample = true }
    showImport(request, true)
    showExport(request, true)
    return {
      session = session.window.frame, picker = session.picker.window.frame, confirm = session.confirm.window.frame,
      import = import.window.frame, export = export.window.frame,
    }
  end

  function self.hideAll()
    if session then
      session.hide()
      session.confirm.hide()
      session.picker.hide()
    end
    if import then import.hide() end
    if export then export.hide() end
    if icons then icons.hide() end
    if history then history.hide() end
  end

  -- The windows built so far ({ session, import, export, icons, history }), for the tests and for /im facts.
  function self.windows() return { session = session, import = import, export = export, icons = icons, history = history } end

  self.parse = parse
  self.HELP = HELP
  return self
end
