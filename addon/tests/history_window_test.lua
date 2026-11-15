-- The loot history window (IntrepidManager/ui/HistoryWindow.lua) on the strict stand-in widgets, with histories made by the real
-- core/History.lua. Invented names, items and places only. See AGENTS.md.

local UI = dofile("tests/support/strict_ui.lua")
local StockTemplates = dofile("tests/support/stock_templates.lua")
local Intact = dofile("tests/support/intact.lua")

local FILES = { "core/History", "ui/Kit", "ui/HistoryWindow" }
local WED = 1796846700 -- 2026-12-09 20:05:00 UTC, a Wednesday
local HOUR, DAY = 3600, 86400

local function setup(options)
  options = options or {}
  local game = StockTemplates.install(UI.new({ setTextFires = options.setTextFires }))
  local scene = { game = game, errors = {}, tips = {} }
  game.env.GameTooltip = {
    SetOwner = function(_, owner, anchor) scene.tips[#scene.tips + 1] = { "owner", owner, anchor } end,
    SetHyperlink = function(_, link) scene.tips[#scene.tips + 1] = { "link", link } end,
    SetText = function(_, words, r, g, b) scene.tips[#scene.tips + 1] = { "title", words, r, g, b } end,
    AddLine = function(_, words, r, g, b, wrap) scene.tips[#scene.tips + 1] = { "line", words, r, g, b, wrap } end,
    AddDoubleLine = function(_, left, right, lr, lg, lb, rr, rg, rb)
      scene.tips[#scene.tips + 1] = { "pair", left, right, { lr, lg, lb }, { rr, rg, rb } }
    end,
    Show = function() scene.tips[#scene.tips + 1] = { "show" } end,
    Hide = function() scene.tips[#scene.tips + 1] = { "hide" } end,
  }
  local ns = {}
  for _, file in ipairs(FILES) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
  scene.ns = ns
  scene.kit = ns.UI.Kit.new({
    density = options.density, chrome = options.chrome, onError = function(err) scene.errors[#scene.errors + 1] = tostring(err) end,
  })
  scene.calls = {}
  scene.window = ns.UI.HistoryWindow.new(scene.kit, { export = function(pick) scene.calls[#scene.calls + 1] = pick end })
  scene.parts = scene.window.parts
  return scene
end

local function clock(at) return os.date("!*t", at) end

local function award(n, options)
  options = options or {}
  local at = options.at or (WED + n * 60)
  return {
    id = "s-tpt2u0-q4tz-" .. n, rev = 1, at = at, date = os.date("!%Y-%m-%d", at), itemId = 900000 + n,
    item = options.item or ("Test Blade " .. n), to = options.to or "Jorren Ashvale", decision = "council",
    delivery = { state = options.received and "received" or "assigned" }, place = options.place or "Molten Test Core",
    status = options.removed and "removed" or nil,
  }
end

-- A night in Molten Test Core (3 awards), one in Onyx Test Lair the week after (2 awards).
local function twoRaids()
  return {
    award(1, { to = "Jorren Ashvale", item = "Cloak of Fixtures", received = true }),
    award(2, { to = "Mirabel Quint", item = "Test Blade of Ages", removed = true }),
    award(3, { to = "Mirabel Quint", item = "Helm of Samples" }),
    award(4, { place = "Onyx Test Lair", at = WED + 7 * DAY, item = "Cloak of Fixtures", to = "Bram Tollet" }),
    award(5, { place = "Onyx Test Lair", at = WED + 7 * DAY + HOUR, item = "Ring of Stand-ins", to = "Jorren Ashvale" }),
  }
end

local function vm(scene, log, change)
  local model = { history = scene.ns.History.build(log, clock), year = 2026, limit = 10000 }
  for key, value in pairs(change or {}) do model[key] = value end
  return model
end

local function text(scene, widget) return scene.game.state(widget).text end
local function shown(scene, widget)
  local up = widget
  while up do
    local s = scene.game.state(up)
    if s.shown == false then return false end
    up = s.parent
  end
  return true
end
local function press(scene, widget) scene.game.fire(widget, "OnClick", "LeftButton") end
local function typeSearch(scene, words)
  scene.game.state(scene.parts.searchBox).text = words
  scene.game.fire(scene.parts.searchBox, "OnTextChanged", true)
end

-- The words of the award lines on screen, top to bottom: "WHEN | ITEM | WINNER | RAID | STATE".
local function awardLines(scene)
  local lines = {}
  for _, line in ipairs(scene.parts.awardList.lines) do
    if shown(scene, line.frame) then
      lines[#lines + 1] = table.concat({ text(scene, line.when), text(scene, line.item), text(scene, line.who), text(scene, line.raid), text(scene, line.state) }, " | ")
    end
  end
  return lines
end

-- The raid lines on screen: "first line / second line / count".
local function raidLines(scene)
  local lines = {}
  for _, line in ipairs(scene.parts.raidList.lines) do
    if shown(scene, line.frame) then
      lines[#lines + 1] = text(scene, line.day) .. " / " .. text(scene, line.place) .. " / " .. text(scene, line.count)
    end
  end
  return lines
end

test("the status line, the count and the raid's second line, in words", function()
  local W = setup().ns.UI.HistoryWindow
  eq(W.countText(5, 5), "5 awards")
  eq(W.countText(1, 1), "1 award")
  eq(W.countText(24, 1234), "24 of 1,234 awards")
  eq(W.countText(0, 10000), "0 of 10,000 awards")
  eq(W.status({ history = { rows = {} }, limit = 10000 }), "Nothing kept yet (the history keeps up to 10,000 awards).")
  eq(W.raidLine({ placeText = "Molten Test Core", time = "8:05 PM" }), "Molten Test Core, 8:05 PM")
  eq(W.raidLine({ placeText = "Molten Test Core" }), "Molten Test Core")
end)

test("opened: every award newest first, the raids newest first under All raids, the count and the status", function()
  local scene = setup()
  scene.window.open(vm(scene, twoRaids()))
  eq(scene.window.isShown(), true)
  deep_eq(awardLines(scene), {
    "Dec 16, 9:05 PM | Ring of Stand-ins | Jorren Ashvale | Onyx Test Lair | Awarded",
    "Dec 16, 8:05 PM | Cloak of Fixtures | Bram Tollet | Onyx Test Lair | Awarded",
    "Dec 9, 8:08 PM | Helm of Samples | Mirabel Quint | Molten Test Core | Awarded",
    "Dec 9, 8:07 PM | Test Blade of Ages | Mirabel Quint | Molten Test Core | Taken back",
    "Dec 9, 8:06 PM | Cloak of Fixtures | Jorren Ashvale | Molten Test Core | Given",
  })
  deep_eq(raidLines(scene), {
    "All raids / 5 awards / ",
    "Wed, Dec 16, 2026 / Onyx Test Lair, 8:05 PM / 2",
    "Wed, Dec 9, 2026 / Molten Test Core, 8:06 PM / 3",
  })
  eq(text(scene, scene.parts.count), "5 awards")
  eq(text(scene, scene.parts.status), "5 awards kept here since Wed, Dec 9, 2026 (up to 10,000; after that the oldest drop off).")
  eq(text(scene, scene.parts.emptyLine), "")
  deep_eq(scene.errors, {})
end)

test("a taken-back award is muted with its state in red; a given one says Given in green", function()
  local scene = setup()
  scene.window.open(vm(scene, twoRaids()))
  local colors = scene.kit.colors
  local lines = scene.parts.awardList.lines
  local taken, given = lines[4], lines[5]
  deep_eq({ scene.game.state(taken.item).textColor[1], scene.game.state(taken.item).textColor[2] }, { colors.muted[1], colors.muted[2] })
  deep_eq({ scene.game.state(taken.state).textColor[1], scene.game.state(taken.state).textColor[2] }, { colors.bad[1], colors.bad[2] })
  deep_eq({ scene.game.state(given.state).textColor[1], scene.game.state(given.state).textColor[2] }, { colors.good[1], colors.good[2] })
  deep_eq({ scene.game.state(given.item).textColor[1], scene.game.state(given.item).textColor[2] }, { colors.gold[1], colors.gold[2] })
end)

test("picking a raid shows only its awards; All raids shows them all again", function()
  local scene = setup()
  scene.window.open(vm(scene, twoRaids()))
  local raidLine = scene.parts.raidList.lines[3]
  press(scene, raidLine.frame)
  eq(#awardLines(scene), 3)
  eq(text(scene, scene.parts.count), "3 of 5 awards")
  eq(scene.game.state(raidLine.selected).shown ~= false, true)
  eq(scene.game.state(scene.parts.raidList.lines[2].selected).shown, false)
  press(scene, scene.parts.raidList.lines[1].frame)
  eq(#awardLines(scene), 5)
  local _, _, picked = scene.window.shown()
  eq(picked, nil)
end)

-- Every test of the search box runs twice: the game may or may not run OnTextChanged for SetText.
local function both(name, fn)
  test(name, function() fn({}) end)
  test(name .. " (SetText runs OnTextChanged)", function() fn({ setTextFires = true }) end)
end

both("typing narrows the awards and the raids; Clear brings everything back", function(options)
  local scene = setup(options)
  scene.window.open(vm(scene, twoRaids()))
  typeSearch(scene, "cloak")
  deep_eq(awardLines(scene), {
    "Dec 16, 8:05 PM | Cloak of Fixtures | Bram Tollet | Onyx Test Lair | Awarded",
    "Dec 9, 8:06 PM | Cloak of Fixtures | Jorren Ashvale | Molten Test Core | Given",
  })
  deep_eq(raidLines(scene), {
    "All raids / 2 awards / ",
    "Wed, Dec 16, 2026 / Onyx Test Lair, 8:05 PM / 1",
    "Wed, Dec 9, 2026 / Molten Test Core, 8:06 PM / 1",
  })
  eq(text(scene, scene.parts.count), "2 of 5 awards")
  typeSearch(scene, "dec 16")
  eq(#awardLines(scene), 2)
  deep_eq(raidLines(scene), { "All raids / 2 awards / ", "Wed, Dec 16, 2026 / Onyx Test Lair, 8:05 PM / 2" })
  typeSearch(scene, "nobody by this name")
  eq(#awardLines(scene), 0)
  eq(text(scene, scene.parts.emptyLine), "Nothing matches.")
  press(scene, scene.parts.clearButton)
  eq(text(scene, scene.parts.searchBox), "")
  eq(#awardLines(scene), 5)
  eq(text(scene, scene.parts.emptyLine), "")
end)

both("a raid picked and a search together; the raid stays listed when nothing in it matches", function(options)
  local scene = setup(options)
  scene.window.open(vm(scene, twoRaids()))
  press(scene, scene.parts.raidList.lines[3].frame) -- Molten Test Core
  typeSearch(scene, "mirabel")
  eq(#awardLines(scene), 2)
  typeSearch(scene, "bram")
  eq(#awardLines(scene), 0)
  deep_eq(raidLines(scene), {
    "All raids / 1 award / ",
    "Wed, Dec 16, 2026 / Onyx Test Lair, 8:05 PM / 1",
    "Wed, Dec 9, 2026 / Molten Test Core, 8:06 PM / 0",
  })
end)

both("opened with words: they go in the search box", function(options)
  local scene = setup(options)
  scene.window.open(vm(scene, twoRaids(), { search = "jorren" }))
  eq(text(scene, scene.parts.searchBox), "jorren")
  eq(#awardLines(scene), 2)
end)

test("an empty history says how awards get there", function()
  local scene = setup()
  scene.window.open(vm(scene, {}))
  eq(#awardLines(scene), 0)
  deep_eq(raidLines(scene), { "All raids / 0 awards / " })
  is_true(string.find(text(scene, scene.parts.emptyLine), "practice awards never are", 1, true) ~= nil)
  eq(text(scene, scene.parts.status), "Nothing kept yet (the history keeps up to 10,000 awards).")
end)

-- The tooltip's calls without the colors: "link item:1", "title Cloak", "pair Winner: Jorren", "line  ", "show".
local function tipWords(scene)
  local words = {}
  for _, call in ipairs(scene.tips) do
    if call[1] == "link" or call[1] == "title" or call[1] == "line" then
      words[#words + 1] = call[1] .. " " .. call[2]
    elseif call[1] == "pair" then
      words[#words + 1] = "pair " .. call[2] .. ": " .. call[3]
    elseif call[1] ~= "owner" then
      words[#words + 1] = call[1]
    end
  end
  return words
end

local function findCall(scene, kind, first)
  for _, call in ipairs(scene.tips) do
    if call[1] == kind and call[2] == first then return call end
  end
  return nil
end

test("hovering an award the game knows: the item's tooltip, then the award in full; leaving hides it", function()
  local scene = setup()
  scene.window.open(vm(scene, twoRaids()))
  local line = scene.parts.awardList.lines[1]
  scene.game.fire(line.frame, "OnEnter")
  eq(scene.tips[1][1], "owner")
  eq(scene.tips[1][2], line.frame)
  deep_eq(tipWords(scene), {
    "link item:900005", "line  ",
    "pair Winner: Jorren Ashvale",
    "pair When: Wed, Dec 16, 2026, 9:05 PM",
    "pair Raid: Onyx Test Lair - Wed, Dec 16, 2026, 8:05 PM",
    "pair Decided by: Council",
    "pair State: Awarded, not given yet",
    "show",
  })
  scene.game.fire(line.frame, "OnLeave")
  eq(scene.tips[#scene.tips][1], "hide")
  deep_eq(scene.errors, {})
end)

test("hovering an award of an item the game doesn't know: the item's name as the title, in gold", function()
  local scene = setup()
  scene.game.env.C_Item = { GetItemInfoInstant = function(id) return id < 900000 and id or nil end }
  scene.window.open(vm(scene, twoRaids()))
  scene.game.fire(scene.parts.awardList.lines[1].frame, "OnEnter")
  local title = scene.tips[2]
  eq(title[1], "title")
  eq(title[2], "Ring of Stand-ins")
  deep_eq({ title[3], title[4], title[5] }, { 1, 0.82, 0 })
  is_true(findCall(scene, "link", "item:900005") == nil)
  eq(tipWords(scene)[2], "pair Winner: Jorren Ashvale")
  deep_eq(scene.errors, {})
end)

test("the tooltip's state: given (green) with how and when, taken back (red)", function()
  local scene = setup()
  local log = twoRaids()
  log[1].delivery = { state = "received", at = WED + 60 + 5 * 60, how = "trade" }
  scene.window.open(vm(scene, log))
  local lines = scene.parts.awardList.lines
  scene.game.fire(lines[5].frame, "OnEnter") -- award 1, the oldest
  local state = findCall(scene, "pair", "State")
  eq(state[3], "Given in a trade, 8:11 PM")
  deep_eq(state[5], { scene.kit.colors.good[1], scene.kit.colors.good[2], scene.kit.colors.good[3] })
  scene.tips = {}
  scene.game.fire(lines[4].frame, "OnEnter") -- award 2, taken back
  state = findCall(scene, "pair", "State")
  eq(state[3], "Taken back")
  deep_eq(state[5], { scene.kit.colors.bad[1], scene.kit.colors.bad[2], scene.kit.colors.bad[3] })
  deep_eq(scene.errors, {})
end)

test("the award's lines: the boss when there is one, no decision on a pseudo award, the note last", function()
  local scene = setup()
  local HistoryWindow, History = scene.ns.UI.HistoryWindow, scene.ns.History
  local log = {
    award(1, { item = "Cloak of Fixtures" }),
    award(2, { to = "Disenchant" }),
  }
  log[1].encounter, log[1].note = "Test Lord of Embers", "Promised to the tanks first."
  log[2].pseudo, log[2].decision = "disenchant", nil
  log[2].delivery = { state = "received", at = WED + 2 * DAY, how = "manual" }
  local rows = History.build(log, clock).rows
  local lines, note = HistoryWindow.details(rows[2])
  deep_eq(lines, {
    { "Winner", "Jorren Ashvale" }, { "When", "Wed, Dec 9, 2026, 8:06 PM" }, { "Raid", "Molten Test Core - Wed, Dec 9, 2026, 8:06 PM" },
    { "Boss", "Test Lord of Embers" }, { "Decided by", "Council" }, { "State", "Awarded, not given yet" },
  })
  eq(note, "Promised to the tanks first.")
  lines, note = HistoryWindow.details(rows[1])
  deep_eq(lines, {
    { "Winner", "Disenchant" }, { "When", "Wed, Dec 9, 2026, 8:07 PM" }, { "Raid", "Molten Test Core - Wed, Dec 9, 2026, 8:06 PM" },
    { "State", "Given by hand, Fri, Dec 11, 2026, 8:05 PM" },
  })
  eq(note, nil)
  -- the note goes last, wrapped
  scene.window.open(vm(scene, log))
  scene.game.fire(scene.parts.awardList.lines[2].frame, "OnEnter")
  local last = scene.tips[#scene.tips - 1]
  deep_eq({ last[1], last[2], last[6] }, { "line", "Promised to the tanks first.", true })
  deep_eq(scene.errors, {})
end)

test("ten thousand awards: only twenty lines are made, and the wheel moves through them", function()
  local log = {}
  for n = 1, 10000 do log[n] = award(n, { at = WED + n * 600, to = "Player " .. (n % 40) }) end
  local scene = setup()
  local before = #scene.game.frames
  scene.window.open(vm(scene, log))
  eq(#scene.game.frames, before) -- opening makes no frames
  eq(#scene.parts.awardList.lines, 20)
  eq(text(scene, scene.parts.count), "10,000 awards")
  local first = text(scene, scene.parts.awardList.lines[1].item)
  eq(first, "Test Blade 10000")
  scene.game.fire(scene.parts.awardList.frame, "OnMouseWheel", -1)
  eq(text(scene, scene.parts.awardList.lines[1].item), "Test Blade 9997")
  for _ = 1, 4000 do scene.game.fire(scene.parts.awardList.frame, "OnMouseWheel", -1) end
  eq(text(scene, scene.parts.awardList.lines[20].item), "Test Blade 1")
  scene.game.fire(scene.parts.awardList.frame, "OnMouseWheel", 1)
  eq(text(scene, scene.parts.awardList.lines[20].item), "Test Blade 4")
  -- a new search starts at the top again
  typeSearch(scene, "player 7")
  eq(text(scene, scene.parts.awardList.lines[1].who), "Player 7")
  eq(scene.parts.awardList.offset, 0)
  deep_eq(scene.errors, {})
end)

test("a new award while the window is open: the raid picked, the search and the place in the list stay", function()
  local scene = setup()
  local log = twoRaids()
  scene.window.open(vm(scene, log))
  press(scene, scene.parts.raidList.lines[3].frame) -- Molten Test Core, Dec 9
  log[#log + 1] = award(6, { at = WED + 4 * 60, item = "Late Test Bracers" })
  scene.window.update(vm(scene, log))
  local rows, _, picked = scene.window.shown()
  eq(#rows, 4)
  eq(picked.kind, "night") -- a night of one raid is listed as the night
  eq(picked.raids[1].placeText, "Molten Test Core")
  eq(text(scene, scene.parts.awardList.lines[1].item), "Late Test Bracers")
end)

test("the window holds together: compact and roomy, stock and flat, empty and full, long names", function()
  for _, density in ipairs({ "compact", "roomy" }) do
    for _, chrome in ipairs({ "stock", "flat" }) do
      for _, count in ipairs({ 0, 3, 60 }) do
        local log = {}
        for n = 1, count do
          log[n] = award(n, {
            at = WED + n * 3 * HOUR, place = n % 2 == 0 and "The Temple of a Very Long Test Name Indeed" or "Molten Test Core",
            item = "A Really Rather Long Item Name of the Fixtures", to = "Bartholomew-Longname Testington", removed = n % 5 == 0,
          })
        end
        local scene = setup({ density = density, chrome = chrome })
        scene.window.open(vm(scene, log, { search = count == 60 and "" or nil }))
        local problems = Intact.problems(scene.game, scene.window.window.frame)
        if #problems > 0 then print(density, chrome, count, table.concat(problems, "\n")) end
        deep_eq(problems, {})
        for _, button in ipairs({ scene.parts.raiderButton, scene.parts.datesButton }) do
          scene.game.fire(button, "OnClick", "LeftButton")
          problems = Intact.problems(scene.game, scene.window.window.frame)
          if #problems > 0 then print(density, chrome, count, "a dropdown open", table.concat(problems, "\n")) end
          deep_eq(problems, {})
        end
        if count > 0 then
          scene.game.fire(scene.parts.raidList.lines[2].frame, "OnClick", "LeftButton")
          deep_eq(Intact.problems(scene.game, scene.window.window.frame), {})
        end
        deep_eq(scene.errors, {})
      end
    end
  end
end)

-- Molten Test Core then Onyx Test Lair on Dec 9 (one night, two raids), Hollow Test Keep alone on Dec 16.
local function nightsLog()
  return {
    award(1, { to = "Jorren Ashvale", item = "Cloak of Fixtures", received = true }),
    award(2, { to = "Mirabel Quint", item = "Test Blade of Ages" }),
    award(3, { to = "Jorren Ashvale", item = "Helm of Samples" }),
    award(4, { place = "Onyx Test Lair", at = WED + 2 * HOUR, to = "Bram Tollet", item = "Ring of Stand-ins" }),
    award(5, { place = "Hollow Test Keep", at = WED + 7 * DAY, to = "Mirabel Quint", item = "Mantle of Mock Data" }),
  }
end

local function dec16(scene) return scene.ns.History.dayNumber(2026, 12, 16) end

-- The lines of a dropdown's list on screen: "text count", with " *" for the one picked now.
local function choiceLines(scene, list)
  local lines = {}
  for _, line in ipairs(list.lines) do
    if shown(scene, line.frame) then
      local picked = scene.game.state(line.selected).shown ~= false
      lines[#lines + 1] = text(scene, line.text) .. " " .. text(scene, line.count) .. (picked and " *" or "")
    end
  end
  return lines
end

local function pressChoice(scene, list, words)
  for _, line in ipairs(list.lines) do
    if shown(scene, line.frame) and text(scene, line.text) == words then return press(scene, line.frame) end
  end
  error("no choice " .. words)
end

test("a night of two raids is listed with its raids under it; a night of one raid as that raid", function()
  local scene = setup()
  scene.window.open(vm(scene, nightsLog()))
  deep_eq(raidLines(scene), {
    "All raids / 5 awards / ",
    "Wed, Dec 16, 2026 / Hollow Test Keep, 8:05 PM / 1",
    "Wed, Dec 9, 2026 / 2 raids, 8:06 PM to 10:05 PM / 4",
    "Molten Test Core / 8:06 PM to 8:08 PM / 3",
    "Onyx Test Lair / 10:05 PM / 1",
  })
  local W = scene.ns.UI.HistoryWindow
  eq(W.raidSpan({ time = "8:05 PM", lastTime = "8:05 PM" }), "8:05 PM")
  eq(W.raidSpan({}), "")
  eq(text(scene, scene.parts.raidsHead), "NIGHTS AND RAIDS")
  deep_eq(scene.errors, {})
end)

test("Export: off under All raids, Export night or Export raid once one is picked, and the engine is told which", function()
  local scene = setup()
  scene.window.open(vm(scene, nightsLog()))
  local export = scene.parts.exportButton
  eq(text(scene, export), "Export")
  eq(scene.game.state(export).enabled, false)
  press(scene, export)
  deep_eq(scene.calls, {})
  press(scene, scene.parts.raidList.lines[3].frame) -- the night of Dec 9
  eq(#awardLines(scene), 4)
  eq(text(scene, scene.parts.count), "4 of 5 awards")
  eq(text(scene, export), "Export night")
  eq(scene.game.state(export).enabled, true)
  press(scene, export)
  eq(scene.calls[1].kind, "night")
  eq(scene.calls[1].label, "Wed, Dec 9, 2026: Molten Test Core, Onyx Test Lair")
  local _, _, picked = scene.window.shown()
  eq(scene.calls[1].key, picked.key)
  press(scene, scene.parts.raidList.lines[4].frame) -- Molten Test Core of that night
  eq(#awardLines(scene), 3)
  eq(text(scene, export), "Export raid")
  press(scene, export)
  deep_eq({ scene.calls[2].kind, scene.calls[2].label }, { "raid", "Molten Test Core - Wed, Dec 9, 2026, 8:06 PM" })
  is_true(scene.game.state(scene.parts.raidList.lines[4].selected).shown ~= false)
  eq(scene.game.state(scene.parts.raidList.lines[3].selected).shown, false)
  press(scene, scene.parts.raidList.lines[2].frame) -- a night of one raid: exported as a night
  eq(text(scene, export), "Export night")
  press(scene, scene.parts.raidList.lines[1].frame)
  eq(scene.game.state(export).enabled, false)
  deep_eq(scene.errors, {})
end)

test("the Raider dropdown: every winner with a count, a find box, and the pick narrows both lists", function()
  local scene = setup()
  scene.window.open(vm(scene, nightsLog()))
  eq(text(scene, scene.parts.raiderButton), "Raider: All")
  eq(shown(scene, scene.parts.raiderPopup), false)
  press(scene, scene.parts.raiderButton)
  eq(shown(scene, scene.parts.raiderPopup), true)
  deep_eq(choiceLines(scene, scene.parts.raiderList), { "All raiders 5 *", "Bram Tollet 1", "Jorren Ashvale 2", "Mirabel Quint 2" })
  scene.game.state(scene.parts.raiderFind).text = "mir"
  scene.game.fire(scene.parts.raiderFind, "OnTextChanged", true)
  deep_eq(choiceLines(scene, scene.parts.raiderList), { "All raiders 5 *", "Mirabel Quint 2" })
  scene.game.state(scene.parts.raiderFind).text = "quint mir"
  scene.game.fire(scene.parts.raiderFind, "OnTextChanged", true)
  deep_eq(choiceLines(scene, scene.parts.raiderList), { "All raiders 5 *", "Mirabel Quint 2" })
  pressChoice(scene, scene.parts.raiderList, "Mirabel Quint")
  eq(shown(scene, scene.parts.raiderPopup), false)
  eq(text(scene, scene.parts.raiderButton), "Raider: Mirabel Quint")
  deep_eq(awardLines(scene), {
    "Dec 16, 8:05 PM | Mantle of Mock Data | Mirabel Quint | Hollow Test Keep | Awarded",
    "Dec 9, 8:07 PM | Test Blade of Ages | Mirabel Quint | Molten Test Core | Awarded",
  })
  deep_eq(raidLines(scene), {
    "All raids / 2 awards / ",
    "Wed, Dec 16, 2026 / Hollow Test Keep, 8:05 PM / 1",
    "Wed, Dec 9, 2026 / 2 raids, 8:06 PM to 10:05 PM / 1",
    "Molten Test Core / 8:06 PM to 8:08 PM / 1",
  })
  eq(text(scene, scene.parts.count), "2 of 5 awards")
  -- opened again: the find box is empty and the pick is marked
  press(scene, scene.parts.raiderButton)
  eq(text(scene, scene.parts.raiderFind), "")
  eq(choiceLines(scene, scene.parts.raiderList)[4], "Mirabel Quint 2 *")
  -- its button again closes it, and so does picking a night
  press(scene, scene.parts.raiderButton)
  eq(shown(scene, scene.parts.raiderPopup), false)
  press(scene, scene.parts.raiderButton)
  press(scene, scene.parts.raidList.lines[2].frame)
  eq(shown(scene, scene.parts.raiderPopup), false)
  deep_eq(scene.errors, {})
end)

test("the Dates dropdown: the last days count back from today, a month is that month; one dropdown open at a time", function()
  local scene = setup()
  scene.window.open(vm(scene, nightsLog(), { today = dec16(scene) }))
  press(scene, scene.parts.raiderButton)
  press(scene, scene.parts.datesButton)
  eq(shown(scene, scene.parts.raiderPopup), false)
  eq(shown(scene, scene.parts.datesPopup), true)
  deep_eq(choiceLines(scene, scene.parts.datesList), {
    "Any date  *", "Last 7 days ", "Last 30 days ", "Last 90 days ", "December 2026 ",
  })
  pressChoice(scene, scene.parts.datesList, "Last 7 days")
  eq(text(scene, scene.parts.datesButton), "Dates: Last 7 days")
  deep_eq(awardLines(scene), { "Dec 16, 8:05 PM | Mantle of Mock Data | Mirabel Quint | Hollow Test Keep | Awarded" })
  press(scene, scene.parts.datesButton)
  pressChoice(scene, scene.parts.datesList, "December 2026")
  eq(#awardLines(scene), 5)
  press(scene, scene.parts.datesButton)
  pressChoice(scene, scene.parts.datesList, "Any date")
  eq(text(scene, scene.parts.datesButton), "Dates: Any")
  local _, _, _, _, period = scene.window.shown()
  eq(period, nil)
  deep_eq(scene.errors, {})
end)

both("Clear forgets the words, the raider, the dates and the pick; opening again closes a dropdown", function(options)
  local scene = setup(options)
  scene.window.open(vm(scene, nightsLog(), { today = dec16(scene) }))
  press(scene, scene.parts.raidList.lines[3].frame)
  press(scene, scene.parts.raiderButton)
  pressChoice(scene, scene.parts.raiderList, "Jorren Ashvale")
  press(scene, scene.parts.datesButton)
  pressChoice(scene, scene.parts.datesList, "Last 30 days")
  typeSearch(scene, "helm")
  eq(#awardLines(scene), 1)
  press(scene, scene.parts.raiderButton)
  press(scene, scene.parts.clearButton)
  eq(shown(scene, scene.parts.raiderPopup), false)
  eq(#awardLines(scene), 5)
  eq(text(scene, scene.parts.raiderButton), "Raider: All")
  eq(text(scene, scene.parts.datesButton), "Dates: Any")
  eq(text(scene, scene.parts.searchBox), "")
  local _, _, picked, raider, period = scene.window.shown()
  deep_eq({ picked, raider, period }, { nil, nil, nil })
  press(scene, scene.parts.datesButton)
  scene.window.open(vm(scene, nightsLog()))
  eq(shown(scene, scene.parts.datesPopup), false)
end)

test("picking a night far down the list keeps the list where it was scrolled to", function()
  local log = {}
  for n = 1, 30 do log[n] = award(n, { at = WED + n * DAY }) end
  local scene = setup()
  scene.window.open(vm(scene, log))
  for _ = 1, 3 do scene.game.fire(scene.parts.raidList.frame, "OnMouseWheel", -1) end
  local offset = scene.parts.raidList.offset
  is_true(offset > 0)
  local line = scene.parts.raidList.lines[5]
  local day = text(scene, line.day)
  press(scene, line.frame)
  eq(scene.parts.raidList.offset, offset)
  eq(text(scene, line.day), day)
  is_true(scene.game.state(line.selected).shown ~= false)
  eq(#awardLines(scene), 1)
end)

test("a new award while a night is picked: it stays picked, and a night that grows to two raids lists both", function()
  local scene = setup()
  local log = nightsLog()
  scene.window.open(vm(scene, log))
  press(scene, scene.parts.raidList.lines[2].frame) -- Hollow Test Keep, a night of one raid
  log[#log + 1] = award(6, { place = "Onyx Test Lair", at = WED + 7 * DAY + HOUR, item = "Belt of Invented Names" })
  scene.window.update(vm(scene, log))
  local _, _, picked = scene.window.shown()
  eq(picked.kind, "night")
  eq(#picked.raids, 2)
  eq(#awardLines(scene), 2)
  eq(raidLines(scene)[3], "Hollow Test Keep / 8:05 PM / 1")
end)
