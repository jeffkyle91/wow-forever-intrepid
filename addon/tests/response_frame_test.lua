-- The raider's answer frame (IntrepidManager/ui/ResponseFrame.lua) on the strict stand-in widgets. Invented names and items only.

local UI = dofile("tests/support/strict_ui.lua")
local StockTemplates = dofile("tests/support/stock_templates.lua")
local Intact = dofile("tests/support/intact.lua")

local FILES = { "ui/Kit", "ui/ResponseFrame" }

local function row(n, change)
  local data = {
    sid = "k3f9", n = n, count = 5, item = "item:" .. (1000 + n), name = "Thing " .. n, quality = 4, icon = 133000 + n,
    remaining = 42, state = "open",
  }
  for key, value in pairs(change or {}) do data[key] = value end
  return data
end

local function model(count, change)
  local rows = {}
  for i = 1, count do rows[i] = row(i, change) end
  return { master = "Jorren Ashvale", rows = rows }
end

-- A frame in a fresh game. scene.answers records the callbacks; scene.model is what model() gives.
local function setup(options)
  options = options or {}
  local game = StockTemplates.install(UI.new())
  local scene = { game = game, answers = {}, notes = {}, tips = {}, errors = {}, modelCalls = 0, model = options.model or model(3) }
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
  scene.frame = ns.UI.ResponseFrame.new(scene.kit, {
    model = function()
      scene.modelCalls = scene.modelCalls + 1
      if type(scene.model) == "function" then return scene.model() end
      return scene.model
    end,
    answer = function(sid, n, code, note) scene.answers[#scene.answers + 1] = { sid, n, code, note } end,
    note = function(sid, n, text) scene.notes[#scene.notes + 1] = { sid, n, text } end,
  })
  scene.parts = scene.frame.parts
  return scene
end

local function state(scene, widget) return scene.game.state(widget) end
local function text(scene, widget) return state(scene, widget).text end
local function enabled(scene, widget) return state(scene, widget).enabled ~= false end
local function press(scene, widget) scene.game.fire(widget, "OnClick", "LeftButton") end

test("the words at the right of a row: time left, an answer given, time up", function()
  local statusText = setup().ns.UI.ResponseFrame.statusText
  local words, shade = statusText(row(1))
  eq(words, "42 s")
  eq(shade, "text")
  words, shade = statusText(row(1, { remaining = 10 }))
  eq(words, "10 s")
  eq(shade, "warn")
  words, shade = statusText(row(1, { state = "answered", myCode = "u", myLabel = "Upgrade" }))
  eq(words, "42 s - you answered: Upgrade")
  eq(shade, "good")
  words, shade = statusText(row(1, { state = "closed", myCode = "u", myLabel = "Upgrade" }))
  eq(words, "You answered: Upgrade")
  eq(shade, "muted")
  words, shade = statusText(row(1, { state = "closed" }))
  eq(words, "Time is up")
  eq(shade, "muted")
  words = statusText(row(1, { remaining = 0 }))
  eq(words, "Time is up")
  words = statusText(row(1, { remaining = 0, myCode = "p", myLabel = "Pass" }))
  eq(words, "You answered: Pass")
end)

test("each item is a row with its picture, its name in the color of its quality, the time and four buttons", function()
  local scene = setup()
  scene.frame.show()
  local rows = scene.parts.rows
  eq(#rows, 3)
  eq(text(scene, scene.parts.from), "Offered by Jorren Ashvale")
  eq(text(scene, rows[1].name), "1. Thing 1")
  eq(text(scene, rows[3].name), "3. Thing 3")
  local c = scene.ns.UI.Kit.QUALITY_COLORS[4]
  deep_eq(state(scene, rows[1].name).textColor, { c[1], c[2], c[3] })
  eq(state(scene, rows[1].icon.art).texture, 133001)
  eq(text(scene, rows[2].status), "42 s")
  local labels = {}
  for i, button in ipairs(rows[1].buttons) do labels[i] = text(scene, button) end
  deep_eq(labels, { "BiS", "Upgrade", "Off-spec", "Pass" })
  for _, button in ipairs(rows[1].buttons) do eq(enabled(scene, button), true) end
  scene.frame.parts.window.hide()
end)

test("your own offer, an empty frame, and rows that go away", function()
  local scene = setup({ model = { master = "you", rows = {} } })
  scene.frame.show()
  eq(text(scene, scene.parts.from), "Your offer")
  scene.frame.update({ rows = {} })
  eq(text(scene, scene.parts.from), "Nothing is on offer.")
  scene.frame.update(model(4))
  eq(#scene.parts.rows, 4)
  scene.frame.update(model(2))
  eq(scene.game.visible(scene.parts.rows[1].frame), true)
  eq(scene.game.visible(scene.parts.rows[3].frame), false)
  eq(scene.game.visible(scene.parts.rows[4].frame), false)
  eq(scene.parts.rows[3].data, nil)
end)

test("a button sends the answer (the item's own note goes with it in the session), and the row shows what was answered", function()
  local scene = setup()
  scene.frame.show()
  local rows = scene.parts.rows
  press(scene, rows[2].buttons[2])
  deep_eq(scene.answers, { { "k3f9", 2, "u" } })
  -- the model now says it was answered
  scene.model = model(3)
  scene.model.rows[2].state, scene.model.rows[2].myCode, scene.model.rows[2].myLabel = "answered", "u", "Upgrade"
  press(scene, rows[1].buttons[4])
  deep_eq(scene.answers[2], { "k3f9", 1, "p" })
  eq(text(scene, rows[2].status), "42 s - you answered: Upgrade")
  eq(enabled(scene, rows[2].buttons[2]), false) -- the answer given is the dimmed button
  eq(enabled(scene, rows[2].buttons[1]), true)
  eq(enabled(scene, rows[2].buttons[3]), true)
  eq(enabled(scene, rows[2].buttons[4]), true)
end)

test("when the time is up every button is dimmed and the row says so", function()
  local scene = setup({ model = model(2, { state = "closed", remaining = 0 }) })
  scene.frame.show()
  local rows = scene.parts.rows
  eq(text(scene, rows[1].status), "Time is up")
  for _, button in ipairs(rows[1].buttons) do eq(enabled(scene, button), false) end
  local answered = model(1, { state = "closed", remaining = 0, myCode = "o", myLabel = "Off-spec" })
  scene.frame.update(answered)
  eq(text(scene, rows[1].status), "You answered: Off-spec")
  for _, button in ipairs(rows[1].buttons) do eq(enabled(scene, button), false) end
end)

test("while the frame is shown the times run down every second, and nothing runs once it is hidden", function()
  local scene = setup()
  local start = scene.game.clock
  scene.model = function()
    local left = math.max(0, 42 - (scene.game.clock - start))
    return model(2, { remaining = left })
  end
  scene.frame.show()
  eq(text(scene, scene.parts.rows[1].status), "42 s")
  scene.game.advance(1)
  eq(text(scene, scene.parts.rows[1].status), "41 s")
  scene.game.advance(5)
  eq(text(scene, scene.parts.rows[1].status), "36 s")
  scene.game.advance(30)
  eq(text(scene, scene.parts.rows[1].status), "6 s")
  scene.game.advance(10)
  eq(text(scene, scene.parts.rows[1].status), "Time is up")
  scene.frame.hide()
  local calls = scene.modelCalls
  scene.game.advance(10)
  eq(scene.modelCalls, calls)
  -- shown again: one chain, not two
  scene.frame.show()
  local before = scene.modelCalls
  scene.game.advance(3)
  eq(scene.modelCalls - before, 3)
end)

test("hovering the picture shows the item's tooltip, leaving hides it", function()
  local scene = setup()
  scene.frame.show()
  local icon = scene.parts.rows[2].icon
  scene.game.fire(icon, "OnEnter")
  deep_eq(scene.tips, { { "owner", icon, "ANCHOR_RIGHT" }, { "link", "item:1002" }, { "show" } })
  scene.game.fire(icon, "OnLeave")
  eq(scene.tips[#scene.tips][1], "hide")
  eq(#scene.errors, 0)
end)

test("more rows than fit scroll, and the content is as tall as its rows", function()
  local scene = setup({ model = model(8) })
  scene.frame.show()
  local metrics = scene.frame.metrics
  eq(#scene.parts.rows, 8)
  eq(scene.parts.list.height, 8 * metrics.rowHeight)
  eq(scene.parts.list.view, metrics.visible * metrics.rowHeight)
  scene.parts.list.scrollTo(100)
  eq(scene.parts.list.frame:GetVerticalScroll(), 100)
end)

test("the frame holds together: inside the window, no text too wide, no buttons overlapping (compact and roomy, few rows and many)", function()
  for _, density in ipairs({ "compact", "roomy" }) do
    for _, count in ipairs({ 1, 3, 5, 8 }) do
      local scene = setup({ density = density, model = model(count, { name = "Crown of the Fallen Ones" }) })
      scene.frame.show()
      local problems = Intact.problems(scene.game, scene.frame.frame)
      deep_eq(problems, {})
      scene.frame.hide()
    end
  end
end)

test("an answered row and a closed row hold together too", function()
  local scene = setup({ model = model(3) })
  scene.model.rows[1].state, scene.model.rows[1].myCode, scene.model.rows[1].myLabel = "answered", "b", "Best in slot"
  scene.model.rows[2].state, scene.model.rows[2].remaining = "closed", 0
  scene.frame.show()
  deep_eq(Intact.problems(scene.game, scene.frame.frame), {})
end)

test("a window of the clear kind: a flat translucent panel, closed by Escape", function()
  local scene = setup()
  eq(scene.parts.window.chrome, "clear")
  local backdrop = state(scene, scene.frame.frame)
  is_true(backdrop.backdropColor[4] < 0.95)
  local found = false
  for _, name in ipairs(scene.game.env.UISpecialFrames) do
    if name == "IntrepidManagerOffers" then found = true end
  end
  is_true(found)
end)

test("the frame is as tall as its rows, one row at least and five at most, and opens at the top right", function()
  local scene = setup({ model = model(1) })
  scene.frame.show()
  local metrics = scene.frame.metrics
  local function height() return state(scene, scene.frame.frame).height end
  eq(height(), metrics.heightFor(1))
  scene.frame.update(model(3))
  eq(height(), metrics.heightFor(3))
  is_true(metrics.heightFor(3) > metrics.heightFor(1))
  eq(metrics.heightFor(3) - metrics.heightFor(1), 2 * metrics.rowHeight)
  scene.frame.update(model(8))
  eq(height(), metrics.heightFor(5)) -- five rows in view, the rest scroll
  eq(metrics.heightFor(8), metrics.heightFor(5))
  scene.frame.update({ rows = {} })
  eq(height(), metrics.heightFor(1))
  local point = state(scene, scene.frame.frame).points[1]
  eq(point.point, "TOPRIGHT")
  eq(point.x, -40)
  eq(point.y, -90)
  -- the note box follows the list, whatever its height
  scene.frame.update(model(2))
  deep_eq(Intact.problems(scene.game, scene.frame.frame), {})
end)

test("Add note opens the box for that item: Save or Enter keeps the note, Cancel or Escape leaves it, and nothing is answered", function()
  local scene = setup()
  scene.frame.show()
  local rows, parts = scene.parts.rows, scene.parts
  eq(text(scene, rows[2].noteButton), "Add note")
  eq(text(scene, rows[2].note), "")
  eq(scene.game.visible(parts.popup.frame), false)
  press(scene, rows[2].noteButton)
  eq(scene.game.visible(parts.popup.frame), true)
  eq(text(scene, parts.popupItem), "2. Thing 2")
  eq(text(scene, parts.popupHint), "The note goes with your answer.")
  eq(parts.noteBox:GetText(), "")
  deep_eq(scene.frame.editing(), { sid = "k3f9", n = 2 })
  parts.noteBox:SetText("for my off-spec")
  press(scene, parts.save)
  deep_eq(scene.notes, { { "k3f9", 2, "for my off-spec" } })
  eq(scene.game.visible(parts.popup.frame), false)
  eq(#scene.answers, 0)
  -- Cancel and Escape change nothing
  press(scene, rows[3].noteButton)
  parts.noteBox:SetText("never mind")
  press(scene, parts.cancel)
  eq(#scene.notes, 1)
  eq(scene.game.visible(parts.popup.frame), false)
  press(scene, rows[3].noteButton)
  parts.noteBox:SetText("never mind")
  scene.game.fire(parts.noteBox, "OnEscapePressed")
  eq(#scene.notes, 1)
  eq(scene.game.visible(parts.popup.frame), false)
  -- Enter saves
  press(scene, rows[1].noteButton)
  parts.noteBox:SetText("quick one")
  scene.game.fire(parts.noteBox, "OnEnterPressed")
  deep_eq(scene.notes[2], { "k3f9", 1, "quick one" })
  eq(scene.game.visible(parts.popup.frame), false)
end)

test("a row with a note says Edit note and shows it; the box opens with it; after the answer it says it goes again", function()
  local scene = setup()
  scene.model.rows[1].note = "for my off-spec" -- written, not answered yet
  scene.model.rows[2].note, scene.model.rows[2].myCode, scene.model.rows[2].myLabel, scene.model.rows[2].state = "lol", "b", "Best in slot", "answered"
  scene.frame.update(scene.model)
  scene.frame.show()
  local rows, parts = scene.parts.rows, scene.parts
  eq(text(scene, rows[1].noteButton), "Edit note")
  eq(text(scene, rows[1].note), "Note: for my off-spec (goes with your answer)")
  eq(text(scene, rows[2].note), "Note: lol")
  eq(text(scene, rows[3].noteButton), "Add note")
  press(scene, rows[2].noteButton)
  eq(parts.noteBox:GetText(), "lol")
  eq(text(scene, parts.popupHint), "Saving sends your answer again with this note.")
  parts.noteBox:SetText("")
  press(scene, parts.save)
  deep_eq(scene.notes, { { "k3f9", 2, "" } }) -- an empty note takes it out
end)

test("the note box closes when its item's time is up or the answer window closes, and a closed item has no note button", function()
  local scene = setup()
  scene.frame.show()
  local rows, parts = scene.parts.rows, scene.parts
  press(scene, rows[1].noteButton)
  eq(scene.game.visible(parts.popup.frame), true)
  scene.model = model(3, { state = "closed", remaining = 0 })
  scene.frame.update(scene.model)
  eq(scene.game.visible(parts.popup.frame), false)
  eq(scene.frame.editing(), nil)
  eq(enabled(scene, rows[1].noteButton), false)
  scene.model = model(3)
  scene.frame.update(scene.model)
  press(scene, rows[2].noteButton)
  eq(scene.game.visible(parts.popup.frame), true)
  scene.frame.hide()
  eq(scene.game.visible(parts.popup.frame), false)
  eq(#scene.notes, 0)
end)

test("the note box and rows with long notes hold together (compact and roomy)", function()
  for _, density in ipairs({ "compact", "roomy" }) do
    local scene = setup({ density = density, model = model(3, { name = "Crown of the Fallen Ones" }) })
    scene.model.rows[1].note = string.rep("a long note ", 7)
    scene.model.rows[2].note, scene.model.rows[2].myCode, scene.model.rows[2].myLabel = string.rep("x", 80), "u", "Upgrade"
    scene.frame.update(scene.model)
    scene.frame.show()
    deep_eq(Intact.problems(scene.game, scene.frame.frame), {})
    scene.game.fire(scene.parts.rows[1].noteButton, "OnClick", "LeftButton")
    deep_eq(Intact.problems(scene.game, scene.parts.popup.frame), {})
    scene.frame.hide()
  end
end)
