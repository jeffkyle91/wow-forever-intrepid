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
    Show = function() scene.tips[#scene.tips + 1] = { "show" } end,
    Hide = function() scene.tips[#scene.tips + 1] = { "hide" } end,
  }
  local ns = {}
  for _, file in ipairs(FILES) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
  scene.ns = ns
  scene.kit = ns.UI.Kit.new({
    density = options.density, chrome = options.chrome, onError = function(err) scene.errors[#scene.errors + 1] = tostring(err) end,
  })
  scene.window = ns.UI.HistoryWindow.new(scene.kit)
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

test("hovering an award shows the item's tooltip; leaving hides it", function()
  local scene = setup()
  scene.window.open(vm(scene, twoRaids()))
  local line = scene.parts.awardList.lines[1]
  scene.game.fire(line.frame, "OnEnter")
  deep_eq(scene.tips[2], { "link", "item:900005" })
  eq(scene.tips[3][1], "show")
  scene.game.fire(line.frame, "OnLeave")
  eq(scene.tips[4][1], "hide")
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
  eq(picked.placeText, "Molten Test Core")
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
        deep_eq(scene.errors, {})
      end
    end
  end
end)
