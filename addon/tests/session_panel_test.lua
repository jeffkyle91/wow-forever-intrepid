-- The loot master's session window (IntrepidManager/ui/SessionPanel.lua) on the strict stand-in widgets. Invented names and items only.

local UI = dofile("tests/support/strict_ui.lua")
local StockTemplates = dofile("tests/support/stock_templates.lua")
local Intact = dofile("tests/support/intact.lua")

local FILES = { "ui/Kit", "ui/SessionPanel" }

local function item(n, change)
  local data = {
    n = n, item = "item:" .. (3000 + n), name = "Thing " .. n, quality = 4, icon = 133000 + n,
    counts = { b = 0, u = 0, o = 0, p = 0, total = 0 },
  }
  for key, value in pairs(change or {}) do data[key] = value end
  return data
end

local function model(state, count, change)
  local items = {}
  for i = 1, count do items[i] = item(i) end
  local data = { state = state, timer = 60, items = items, hellos = 0, group = 2 }
  if state == "running" then data.remaining = 42 data.responders = 0 end
  for key, value in pairs(change or {}) do data[key] = value end
  return data
end

local function answer(who, code, label, note, class)
  return { who = who, code = code, label = label, note = note or "", class = class }
end

-- A window in a fresh game. scene.model and scene.answers (by item number) are what the callbacks give; scene.calls records the rest.
local function setup(options)
  options = options or {}
  local game = StockTemplates.install(UI.new())
  local scene = { game = game, calls = {}, errors = {}, tips = {}, model = options.model or model("none", 0), answers = options.answers or {} }
  game.env.GameTooltip = {
    SetOwner = function(_, owner, anchor) scene.tips[#scene.tips + 1] = { "owner", owner, anchor } end,
    SetHyperlink = function(_, link) scene.tips[#scene.tips + 1] = { "link", link } end,
    Show = function() scene.tips[#scene.tips + 1] = { "show" } end,
    Hide = function() scene.tips[#scene.tips + 1] = { "hide" } end,
  }
  local ns = {}
  load_core(ns, "Names", "Council")
  for _, file in ipairs(FILES) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
  scene.ns = ns
  scene.kit = ns.UI.Kit.new({ density = options.density, onError = function(err) scene.errors[#scene.errors + 1] = tostring(err) end })
  local function record(name) return function(...) scene.calls[#scene.calls + 1] = { name, ... } end end
  scene.panel = ns.UI.SessionPanel.new(scene.kit, {
    model = function()
      if type(scene.model) == "function" then return scene.model() end
      return scene.model
    end,
    rows = function(n) return scene.answers[n] or {} end,
    bags = record("bags"), remove = record("remove"), start = record("start"), finish = record("finish"), reset = record("reset"),
    award = record("award"), unaward = record("unaward"), trade = record("trade"), versions = record("versions"),
    importNight = record("importNight"), exportAwards = record("exportAwards"),
  })
  scene.parts = scene.panel.parts
  return scene
end

local function state(scene, widget) return scene.game.state(widget) end
local function text(scene, widget) return state(scene, widget).text end
local function enabled(scene, widget) return state(scene, widget).enabled ~= false end
local function shown(scene, widget) return scene.game.visible(widget) end
local function press(scene, widget) scene.game.fire(widget, "OnClick", "LeftButton") end

test("the sentences: before the start, running, over; and the counts", function()
  local SessionPanel = setup().ns.UI.SessionPanel
  eq(SessionPanel.statusText(model("none", 0)), "Nothing queued yet.")
  eq(SessionPanel.statusText(model("building", 1)), "1 item queued. The timer is 60 seconds.")
  eq(SessionPanel.statusText(model("building", 3, { timer = 90 })), "3 items queued. The timer is 90 seconds.")
  eq(SessionPanel.statusText(model("running", 3, { responders = 2, hellos = 5, group = 8 })), "Running - 42 s left - 2 answered - 5 of 8 have the addon")
  eq(SessionPanel.statusText(model("running", 3, { group = 0 })), "Running - 42 s left - 0 answered")
  eq(SessionPanel.statusText(model("closed", 3, { responders = 4 })), "Over - 4 answered")
  eq(SessionPanel.countsText({ b = 1, u = 2, o = 0, p = 3, total = 6 }), "BiS 1   Upgrade 2   Off-spec 0   Pass 3")
  eq(SessionPanel.countsText(nil), "BiS 0   Upgrade 0   Off-spec 0   Pass 0")
end)

test("with nothing queued it explains what to do, and Start waits", function()
  local scene = setup()
  scene.panel.show()
  eq(text(scene, scene.parts.status), "Nothing queued yet.")
  eq(shown(scene, scene.parts.hint), true)
  eq(shown(scene, scene.parts.start), true)
  eq(enabled(scene, scene.parts.start), false)
  eq(shown(scene, scene.parts.finish), false)
  eq(shown(scene, scene.parts.new), false)
  eq(enabled(scene, scene.parts.add), true)
  eq(text(scene, scene.parts.timer), "60")
end)

test("the queue is a row for each item with its picture, its name in the color of its quality and a button to take it out", function()
  local scene = setup({ model = model("building", 3, { timer = 90 }) })
  scene.panel.show()
  local rows = scene.parts.leftRows
  eq(#rows, 3)
  eq(text(scene, rows[1].name), "1. Thing 1")
  local c = scene.ns.UI.Kit.QUALITY_COLORS[4]
  deep_eq(state(scene, rows[1].name).textColor, { c[1], c[2], c[3] })
  eq(state(scene, rows[2].icon.art).texture, 133002)
  eq(shown(scene, rows[1].remove), true)
  eq(text(scene, rows[1].count), "")
  eq(shown(scene, scene.parts.hint), false)
  eq(enabled(scene, scene.parts.start), true)
  eq(text(scene, scene.parts.timer), "90")
  eq(text(scene, scene.parts.status), "3 items queued. The timer is 90 seconds.")
  -- the first item is the one whose answers show
  eq(scene.panel.selected(), 1)
  eq(text(scene, scene.parts.answersHead), "ANSWERS - Thing 1")
  eq(shown(scene, rows[1].selected), true)
  eq(shown(scene, rows[2].selected), false)
end)

test("the buttons call what they should: Add from bags, take out, Start with the timer, End, New session", function()
  local scene = setup({ model = model("building", 2) })
  scene.panel.show()
  press(scene, scene.parts.add)
  press(scene, scene.parts.leftRows[2].remove)
  scene.parts.timer:SetText("90")
  press(scene, scene.parts.start)
  deep_eq(scene.calls, { { "bags" }, { "remove", 2 }, { "start", 90 } })
  scene.model = model("running", 2)
  scene.panel.update(scene.model)
  press(scene, scene.parts.finish)
  scene.model = model("closed", 2, { responders = 1 })
  scene.panel.update(scene.model)
  press(scene, scene.parts.new)
  deep_eq({ scene.calls[4], scene.calls[5] }, { { "finish" }, { "reset" } })
end)

test("a timer that is not a number from 5 to 600 is refused in the window and nothing is started", function()
  local scene = setup({ model = model("building", 1) })
  scene.panel.show()
  for _, bad in ipairs({ "4", "601", "abc", "" }) do
    scene.parts.timer:SetText(bad)
    press(scene, scene.parts.start)
    eq(text(scene, scene.parts.status), "The timer is 5 to 600 seconds.")
  end
  eq(#scene.calls, 0)
  scene.parts.timer:SetText("5")
  press(scene, scene.parts.start)
  scene.parts.timer:SetText("600")
  press(scene, scene.parts.start)
  deep_eq(scene.calls, { { "start", 5 }, { "start", 600 } })
end)

test("a click on an item picks it and the answers to it show, in the colors of the raiders' classes and of their claims", function()
  local scene = setup({
    model = model("running", 2, { responders = 3, hellos = 3, group = 3 }),
    answers = {
      [1] = { answer("Selwyn Crake", "b", "Best in slot", "", "WARRIOR"), answer("Mirelle Dunmore", "u", "Upgrade", "my first one", "MAGE") },
      [2] = { answer("Tavian Holt", "p", "Pass") },
    },
  })
  scene.model.items[1].counts = { b = 1, u = 1, o = 0, p = 0, total = 2 }
  scene.panel.show()
  eq(text(scene, scene.parts.answersHead), "ANSWERS - Thing 1")
  eq(text(scene, scene.parts.countsLine), "BiS 1   Upgrade 1   Off-spec 0   Pass 0")
  local rows = scene.parts.rightRows
  eq(#rows, 2)
  eq(text(scene, rows[1].who), "Selwyn Crake")
  deep_eq(state(scene, rows[1].who).textColor, { 0.78, 0.61, 0.43 }) -- a warrior
  deep_eq(state(scene, rows[2].who).textColor, { 0.41, 0.8, 0.94 }) -- a mage
  eq(text(scene, rows[1].claim), "Best in slot")
  local gold = scene.kit.colors.gold
  deep_eq(state(scene, rows[1].claim).textColor, { gold[1], gold[2], gold[3] })
  local good = scene.kit.colors.good
  deep_eq(state(scene, rows[2].claim).textColor, { good[1], good[2], good[3] })
  eq(text(scene, rows[2].note), "my first one")
  eq(text(scene, scene.parts.leftRows[1].count), "2")
  -- the second item
  press(scene, scene.parts.leftRows[2].frame)
  eq(scene.panel.selected(), 2)
  eq(text(scene, scene.parts.answersHead), "ANSWERS - Thing 2")
  eq(#rows, 2)
  eq(shown(scene, rows[1].frame), true)
  eq(shown(scene, rows[2].frame), false)
  eq(text(scene, rows[1].who), "Tavian Holt")
  local plain = scene.kit.colors.text
  deep_eq(state(scene, rows[1].who).textColor, { plain[1], plain[2], plain[3] }) -- a class the hello did not tell: the plain color
end)

test("while it runs the remove buttons go, End shows, the timer box is locked; when it is over New session shows", function()
  local scene = setup({ model = model("running", 2) })
  scene.panel.show()
  eq(shown(scene, scene.parts.leftRows[1].remove), false)
  eq(shown(scene, scene.parts.start), false)
  eq(shown(scene, scene.parts.finish), true)
  eq(shown(scene, scene.parts.new), false)
  eq(enabled(scene, scene.parts.timer), false)
  eq(enabled(scene, scene.parts.add), false)
  eq(text(scene, scene.parts.status), "Running - 42 s left - 0 answered - 0 of 2 have the addon")
  scene.model = model("closed", 2, { responders = 1 })
  scene.panel.update(scene.model)
  eq(shown(scene, scene.parts.finish), false)
  eq(shown(scene, scene.parts.new), true)
  eq(text(scene, scene.parts.status), "Over - 1 answered")
  scene.model = model("none", 0)
  scene.panel.update(scene.model)
  eq(shown(scene, scene.parts.new), false)
  eq(shown(scene, scene.parts.start), true)
  eq(scene.panel.selected(), nil)
  eq(text(scene, scene.parts.answersHead), "ANSWERS")
end)

test("while the window is shown the time and the answers are read again every second, and nothing runs once it is hidden", function()
  local scene = setup()
  local start = scene.game.clock
  local calls = 0
  scene.model = function()
    calls = calls + 1
    local left = math.max(0, 42 - (scene.game.clock - start))
    return model("running", 1, { remaining = left })
  end
  scene.panel.show()
  eq(text(scene, scene.parts.status), "Running - 42 s left - 0 answered - 0 of 2 have the addon")
  scene.game.advance(1)
  eq(text(scene, scene.parts.status), "Running - 41 s left - 0 answered - 0 of 2 have the addon")
  scene.game.advance(10)
  eq(text(scene, scene.parts.status), "Running - 31 s left - 0 answered - 0 of 2 have the addon")
  scene.panel.hide()
  local before = calls
  scene.game.advance(10)
  eq(calls, before)
end)

test("hovering an item shows its tooltip", function()
  local scene = setup({ model = model("building", 2) })
  scene.panel.show()
  local row = scene.parts.leftRows[2]
  scene.game.fire(row.frame, "OnEnter")
  deep_eq(scene.tips, { { "owner", row.frame, "ANCHOR_RIGHT" }, { "link", "item:3002" }, { "show" } })
  scene.game.fire(row.frame, "OnLeave")
  eq(scene.tips[#scene.tips][1], "hide")
  eq(#scene.errors, 0)
end)

test("the window holds together in every state: inside, no text too wide, no controls overlapping (compact and roomy)", function()
  for _, density in ipairs({ "compact", "roomy" }) do
    for _, state_ in ipairs({ "none", "building", "running", "closed" }) do
      for _, count in ipairs({ 0, 3, 14 }) do
        local answers = {}
        if count > 0 then
          answers[1] = {}
          for i = 1, 20 do answers[1][i] = answer("Raider Number " .. i, "u", "Best in slot", "a fairly long note about the item", "PRIEST") end
          answers[1][2].winner = true
          answers[1][3].winner, answers[1][3].given = true, true
          answers[1][4] = { who = "A Winner Without An Answer", label = "No answer", note = "", winner = true }
        end
        local data = model(state_, count, { responders = 20, hellos = 20, group = 25 })
        for _, entry in ipairs(data.items) do entry.name = "A Rather Long Item Name Indeed" end
        if data.items[1] then data.items[1].winner = "Raider Number 2" end
        if data.items[2] then data.items[2].winner, data.items[2].given = "Raider Number 3", true end
        data.notice = (count == 3 and state_ == "closed") and "2 awarded items are not given yet. Press New session again to drop them." or nil
        local scene = setup({ density = density, model = data, answers = answers })
        scene.panel.show()
        local problems = Intact.problems(scene.game, scene.panel.frame)
        if #problems > 0 then print(density, state_, count, table.concat(problems, "\n")) end
        deep_eq(problems, {})
      end
    end
  end
end)

test("each answer has the picture of the raider's class beside the name, none for a class without one, and the window opens at the top left", function()
  local scene = setup({
    model = model("running", 1, { responders = 3 }),
    answers = { [1] = {
      answer("Selwyn Crake", "b", "Best in slot", "", "WARRIOR"), answer("Orla Finch", "u", "Upgrade", "", "DEATHKNIGHT"), answer("Tavian Holt", "p", "Pass"),
    } },
  })
  scene.panel.show()
  local rows = scene.parts.rightRows
  eq(state(scene, rows[1].classIcon).texture, "Interface\\Icons\\ClassIcon_Warrior")
  eq(shown(scene, rows[1].classIcon), true)
  eq(shown(scene, rows[2].classIcon), false) -- a class whose picture was not seen to draw
  eq(shown(scene, rows[3].classIcon), false) -- the hello did not tell the class
  local point = state(scene, scene.panel.frame).points[1]
  eq(point.point, "TOPLEFT")
  eq(point.x, 40)
  eq(point.y, -90)
end)

test("each answer has an Award button while the session runs or is over, and it awards the picked item to that raider", function()
  local answers = { [2] = { answer("Selwyn Crake", "b", "Best in slot", "", "WARRIOR"), answer("Orla Finch", "u", "Upgrade") } }
  local scene = setup({ model = model("running", 3, { responders = 2 }), answers = answers })
  scene.panel.show()
  press(scene, scene.parts.leftRows[2].frame) -- the second item
  local rows = scene.parts.rightRows
  eq(shown(scene, rows[1].award), true)
  eq(text(scene, rows[1].award), "Award")
  eq(shown(scene, rows[1].trade), false) -- nothing is traded before an award
  eq(shown(scene, rows[1].undo), false)
  eq(shown(scene, rows[1].given), false)
  eq(shown(scene, rows[1].winnerBg), false)
  press(scene, rows[2].award)
  press(scene, rows[1].award)
  deep_eq(scene.calls, { { "award", 2, "Orla Finch" }, { "award", 2, "Selwyn Crake" } })
  scene.model = model("closed", 3, { responders = 2 })
  scene.panel.update(scene.model)
  eq(shown(scene, rows[1].award), true) -- still, when the session is over
  scene.model = model("building", 3)
  scene.panel.update(scene.model)
  scene.answers[2] = { answer("Selwyn Crake", "b", "Best in slot") }
  scene.panel.update(scene.model)
  eq(shown(scene, rows[1].award), false) -- nothing to award before the session starts
end)

test("the winner's row is marked and has Trade and an x that takes the award back; the others can still be awarded the item", function()
  local winner = answer("Orla Finch", "u", "Upgrade")
  winner.winner = true
  local answers = { [1] = { answer("Selwyn Crake", "b", "Best in slot", "", "WARRIOR"), winner } }
  local data = model("running", 2, { responders = 2, pending = 1 })
  data.items[1].winner = "Orla Finch"
  local scene = setup({ model = data, answers = answers })
  scene.panel.show()
  local rows = scene.parts.rightRows
  eq(shown(scene, rows[1].award), true)
  eq(shown(scene, rows[1].winnerBg), false)
  eq(shown(scene, rows[2].award), false)
  eq(shown(scene, rows[2].trade), true)
  eq(text(scene, rows[2].trade), "Trade")
  eq(shown(scene, rows[2].undo), true)
  eq(text(scene, rows[2].undo), "x")
  eq(shown(scene, rows[2].winnerBg), true)
  eq(shown(scene, rows[2].given), false)
  press(scene, rows[2].trade)
  press(scene, rows[2].undo)
  deep_eq(scene.calls, { { "trade", "Orla Finch" }, { "unaward", 1 } })
  eq(text(scene, scene.parts.leftRows[1].count), "won")
  local gold = scene.kit.colors.gold
  deep_eq(state(scene, scene.parts.leftRows[1].count).textColor, { gold[1], gold[2], gold[3] })
  eq(text(scene, scene.parts.leftRows[2].count), "0")
  eq(text(scene, scene.parts.status), "Running - 42 s left - 2 answered - 0 of 2 have the addon - 1 awarded")
end)

test("once the trade went through the winner's row says given, nobody else can be awarded that item, and the list says given", function()
  local winner = answer("Orla Finch", "u", "Upgrade")
  winner.winner, winner.given = true, true
  local answers = { [1] = { answer("Selwyn Crake", "b", "Best in slot"), winner } }
  local data = model("closed", 2, { responders = 2, pending = 0 })
  data.items[1].winner, data.items[1].given = "Orla Finch", true
  local scene = setup({ model = data, answers = answers })
  scene.panel.show()
  local rows = scene.parts.rightRows
  eq(shown(scene, rows[1].award), false)
  eq(shown(scene, rows[2].award), false)
  eq(shown(scene, rows[2].trade), false)
  eq(shown(scene, rows[2].undo), false)
  eq(shown(scene, rows[2].given), true)
  eq(text(scene, rows[2].given), "given")
  eq(shown(scene, rows[2].winnerBg), true)
  eq(text(scene, scene.parts.leftRows[1].count), "given")
  local good = scene.kit.colors.good
  deep_eq(state(scene, scene.parts.leftRows[1].count).textColor, { good[1], good[2], good[3] })
  eq(text(scene, scene.parts.status), "Over - 2 answered")
end)

test("a winner who did not answer shows as a row of their own, and the status counts what still has to be traded", function()
  local winner = { who = "Tavian Holt", label = "No answer", note = "", winner = true }
  local data = model("closed", 2, { responders = 1, pending = 2 })
  data.items[2].winner = "Tavian Holt"
  local scene = setup({ model = data, answers = { [2] = { winner } } })
  scene.panel.show()
  press(scene, scene.parts.leftRows[2].frame)
  local rows = scene.parts.rightRows
  eq(text(scene, rows[1].who), "Tavian Holt")
  eq(text(scene, rows[1].claim), "No answer")
  eq(shown(scene, rows[1].trade), true)
  eq(text(scene, scene.parts.status), "Over - 1 answered - 2 to trade")
end)

test("the warning about awards that are not given yet takes the place of the status line, in red", function()
  local data = model("closed", 2, { responders = 1, pending = 2, notice = "2 awarded items are not given yet. Press New session again to drop them." })
  local scene = setup({ model = data })
  scene.panel.show()
  eq(text(scene, scene.parts.status), "2 awarded items are not given yet. Press New session again to drop them.")
  local bad = scene.kit.colors.bad
  deep_eq(state(scene, scene.parts.status).textColor, { bad[1], bad[2], bad[3] })
  scene.model = model("closed", 2, { responders = 1, pending = 2 })
  scene.panel.update(scene.model)
  eq(text(scene, scene.parts.status), "Over - 1 answered - 2 to trade")
end)

test("the Versions button asks for the version window in every state of the session", function()
  for _, state_ in ipairs({ "none", "building", "running", "closed" }) do
    local scene = setup({ model = model(state_, 1) })
    scene.panel.show()
    eq(text(scene, scene.parts.versions), "Versions")
    eq(shown(scene, scene.parts.versions), true)
    eq(state(scene, scene.parts.versions).enabled ~= false, true)
    press(scene, scene.parts.versions)
    deep_eq(scene.calls, { { "versions" } })
  end
end)

test("the Import night and Export awards buttons ask for their windows in every state of the session", function()
  for _, state_ in ipairs({ "none", "building", "running", "closed" }) do
    local scene = setup({ model = model(state_, 1) })
    scene.panel.show()
    eq(text(scene, scene.parts.importNight), "Import night")
    eq(text(scene, scene.parts.exportAwards), "Export awards")
    eq(shown(scene, scene.parts.importNight), true)
    eq(shown(scene, scene.parts.exportAwards), true)
    press(scene, scene.parts.importNight)
    press(scene, scene.parts.exportAwards)
    deep_eq(scene.calls, { { "importNight" }, { "exportAwards" } })
  end
end)
