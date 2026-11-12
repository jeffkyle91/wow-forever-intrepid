-- The export window (IntrepidManager/ui/ExportWindow.lua) on the strict stand-in widgets, with the shared awards fixture of
-- docs/spec/fixtures. Invented names only.

local UI = dofile("tests/support/strict_ui.lua")
local StockTemplates = dofile("tests/support/stock_templates.lua")
local Intact = dofile("tests/support/intact.lua")

local FILES = { "ui/Kit", "ui/ExportWindow" }
local AWARDS = read_file("docs/spec/fixtures/awards-small.j.txt")

-- A window in a fresh game. Callbacks are recorded in scene.calls. options: density, chrome, known, setTextFires.
local function setup(options)
  options = options or {}
  local game = StockTemplates.install(UI.new({ known = options.known, setTextFires = options.setTextFires }))
  local ns = {}
  for _, file in ipairs(FILES) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
  local scene = { game = game, ns = ns, calls = {}, errors = {} }
  scene.kit = ns.UI.Kit.new({
    density = options.density, chrome = options.chrome, onError = function(err) scene.errors[#scene.errors + 1] = tostring(err) end,
  })
  scene.window = ns.UI.ExportWindow.new(scene.kit, {
    everything = function(on) scene.calls[#scene.calls + 1] = { "everything", on } end,
    done = function() scene.calls[#scene.calls + 1] = { "done" } end,
  })
  scene.parts = scene.window.parts
  return scene
end

local function both(name, fn)
  test(name, function() fn({}) end)
  test(name .. " (SetText runs OnTextChanged)", function() fn({ setTextFires = true }) end)
end

local function text(scene, widget) return scene.game.state(widget).text end
local function enabled(scene, widget) return scene.game.state(widget).enabled ~= false end

local function isColor(scene, widget, name)
  local c = scene.kit.colors[name]
  deep_eq(scene.game.state(widget).textColor, { c[1], c[2], c[3] })
end

-- The view-model of an export of the fixture's five awards, three new and two changed since the night was copied.
local function vm(change)
  local model = { text = AWARDS, count = 5, new = 3, changed = 2, hasNight = true, everything = false, sessionOpen = false }
  for key, value in pairs(change or {}) do model[key] = value end
  return model
end

local function press(scene, widget) scene.game.fire(widget, "OnClick", "LeftButton") end

test("the sentence about the awards: new and changed, all new, all changed, everything, no night, nothing", function()
  local summary = setup().ns.UI.ExportWindow.summary
  local function sentence(change)
    local words, any = summary(vm(change))
    eq(any, true) -- there is something to select
    return words
  end
  eq(sentence(), "5 awards: 3 new and 2 changed since the night was copied.")
  eq(sentence({ count = 1, new = 1, changed = 0 }), "1 award, all new.")
  eq(sentence({ count = 4, new = 4, changed = 0 }), "4 awards, all new.")
  eq(sentence({ count = 2, new = 0, changed = 2 }), "2 awards, all changed since the night was copied.")
  eq(sentence({ count = 5, new = 4, changed = 0 }), "5 awards: 4 new.")
  eq(sentence({ count = 5, new = 0, changed = 3 }), "5 awards: 3 changed since the night was copied.")
  eq(sentence({ count = 5, new = 0, changed = 0 }), "5 awards.")
  eq(sentence({ count = 7, everything = true }), "7 awards (everything, not only what is new).")
  eq(sentence({ hasNight = false }), "5 awards from the last 14 days (no night is loaded).")
  eq(sentence({ count = 1, hasNight = false }), "1 award from the last 14 days (no night is loaded).")
  eq(sentence({ count = 3, new = 1, changed = 1 }), "3 awards: 1 new and 1 changed since the night was copied.")
  eq((summary({ text = AWARDS, count = 2, hasNight = true })), "2 awards.") -- a view-model that says nothing of new or changed
  eq(select(2, summary({ text = AWARDS, count = 2, hasNight = true })), true)
  for _, empty in ipairs({ { text = "" }, { text = false }, { count = 0 } }) do
    local sentenceOf, any = summary(vm(empty))
    eq(sentenceOf, "Nothing to export yet.")
    eq(any, false)
  end
  local _, none = summary({})
  eq(none, false)
end)

test("a new window is closed and says there is nothing to export; Select all waits for something to select", function()
  local scene = setup()
  eq(scene.window.isShown(), false)
  eq(text(scene, scene.parts.summary), "Nothing to export yet.")
  isColor(scene, scene.parts.summary, "muted")
  eq(scene.parts.edit:GetText(), "")
  eq(text(scene, scene.parts.count), "")
  eq(enabled(scene, scene.parts.selectButton), false)
  eq(enabled(scene, scene.parts.doneButton), true)
  eq(scene.game.state(scene.parts.everything).checked, false)
  eq(text(scene, scene.parts.warning), "")
  eq(text(scene, scene.parts.intro), "Copy the awards string below and paste it into the Raid Desk importer.")
  is_true(string.find(text(scene, scene.parts.hint), "Click in the box and press Ctrl+C (Cmd+C on a Mac).", 1, true) ~= nil)
  is_true(string.find(text(scene, scene.parts.hint), "type /reload so the game writes the file.", 1, true) ~= nil)
  is_true(string.find(text(scene, scene.parts.hint), "the Raid Desk ignores what it already has", 1, true) ~= nil)
  eq(text(scene, scene.parts.heading), "AWARDS STRING")
  eq(text(scene, scene.parts.doneButton), "Done")
  eq(text(scene, scene.parts.selectButton), "Select all")
  eq(scene.game.state(scene.parts.intro).wordWrap ~= false, true) -- the intro takes two lines when it needs them
  eq(scene.game.state(scene.parts.doneButton).templates[1], "UIPanelButtonTemplate") -- the red one
  eq(scene.game.state(scene.parts.selectButton).templates[1], "UIPanelButtonGrayTemplate")
end)

both("opening the window with awards shows the string, how many characters it has and what it holds, ready to copy", function(options)
  local scene = setup(options)
  scene.window.open(vm())
  is_true(scene.window.isShown())
  eq(scene.parts.edit:GetText(), AWARDS)
  eq(text(scene, scene.parts.summary), "5 awards: 3 new and 2 changed since the night was copied.")
  isColor(scene, scene.parts.summary, "good")
  local digits = tostring(#AWARDS)
  eq(text(scene, scene.parts.count), (string.gsub(digits, "^(%d+)(%d%d%d)$", "%1,%2")) .. " characters")
  eq(enabled(scene, scene.parts.selectButton), true)
  scene.parts.scroll:SetVerticalScroll(50)
  scene.window.update(vm({ count = 4 }))
  eq(scene.parts.scroll:GetVerticalScroll(), 0)
  scene.window.update(vm({ text = "" }))
  eq(scene.parts.edit:GetText(), "")
  eq(text(scene, scene.parts.summary), "Nothing to export yet.")
  eq(text(scene, scene.parts.count), "")
  eq(enabled(scene, scene.parts.selectButton), false)
  eq(#scene.errors, 0)
  deep_eq(scene.game.audit(), {})
end)

both("the box cannot be edited: whatever the player types is put back and the string stays selected", function(options)
  local scene = setup(options)
  scene.window.open(vm())
  scene.game.fire(scene.parts.scroll, "OnMouseDown", "LeftButton")
  local highlights = scene.game.counts.HighlightText
  scene.game.paste(scene.parts.edit, "typed over everything")
  eq(scene.parts.edit:GetText(), AWARDS)
  is_true(scene.game.counts.HighlightText > highlights)
  scene.game.paste(scene.parts.edit, AWARDS .. "x")
  eq(scene.parts.edit:GetText(), AWARDS)
  highlights = scene.game.counts.HighlightText
  scene.game.paste(scene.parts.edit, AWARDS) -- the same string again is not a change: nothing to put back
  eq(scene.game.counts.HighlightText, highlights)
  scene.game.paste(scene.parts.edit, "")
  eq(scene.parts.edit:GetText(), AWARDS)
  scene.window.update(vm({ text = "a new string", count = 1, new = 1, changed = 0 })) -- the engine changes it: that stays
  eq(scene.parts.edit:GetText(), "a new string")
  eq(#scene.errors, 0)
end)

test("a click in the box, the box getting the keyboard and Select all each focus the box and select everything", function()
  local scene = setup()
  scene.window.open(vm())
  local function highlights() return scene.game.counts.HighlightText or 0 end
  local before = highlights()
  scene.game.fire(scene.parts.scroll, "OnMouseDown", "LeftButton")
  eq(scene.parts.edit:HasFocus(), true)
  is_true(highlights() > before) -- the focus and the click each select
  before = highlights()
  scene.game.fire(scene.parts.edit, "OnEditFocusGained")
  eq(highlights(), before + 1)
  scene.parts.edit:ClearFocus()
  before = highlights()
  press(scene, scene.parts.selectButton)
  eq(scene.parts.edit:HasFocus(), true)
  is_true(highlights() > before)
  -- already focused: no focus event comes, so a click and the button must select by themselves
  before = highlights()
  scene.game.fire(scene.parts.scroll, "OnMouseDown", "LeftButton")
  eq(highlights(), before + 1)
  before = highlights()
  press(scene, scene.parts.selectButton)
  eq(highlights(), before + 1)
  scene.game.fire(scene.parts.edit, "OnEscapePressed")
  eq(scene.parts.edit:HasFocus(), false)
end)

test("the box 'Everything, not only what is new' tells the engine, which builds the view-model again", function()
  local scene = setup()
  scene.window.open(vm())
  eq(scene.game.state(scene.parts.everything).checked, false)
  scene.parts.everything:SetChecked(true)
  press(scene, scene.parts.everything)
  deep_eq(scene.calls, { { "everything", true } })
  scene.window.update(vm({ everything = true, count = 7 }))
  eq(scene.game.state(scene.parts.everything).checked, true)
  eq(text(scene, scene.parts.summary), "7 awards (everything, not only what is new).")
  scene.parts.everything:SetChecked(false)
  press(scene, scene.parts.everything)
  deep_eq(scene.calls[2], { "everything", false })
  eq(text(scene, scene.parts.everything.label), "Everything, not only what is new")
end)

test("Done closes the window and tells the engine; a session that is open is said in orange", function()
  local scene = setup()
  scene.window.open(vm({ sessionOpen = true }))
  eq(text(scene, scene.parts.warning), "A loot session is open: awards given from now on are not in this string.")
  isColor(scene, scene.parts.warning, "warn")
  press(scene, scene.parts.doneButton)
  eq(scene.window.isShown(), false)
  deep_eq(scene.calls, { { "done" } })
  scene.window.open(vm())
  eq(text(scene, scene.parts.warning), "")
  local listed = false
  for _, name in ipairs(scene.game.env.UISpecialFrames) do listed = listed or name == "IntrepidManagerExport" end
  is_true(listed)
end)

test("a callback that is missing or raises does not harm the window", function()
  local scene = setup()
  scene.window = scene.ns.UI.ExportWindow.new(scene.kit, { done = function() error("boom") end })
  scene.parts = scene.window.parts
  scene.window.open(vm())
  press(scene, scene.parts.everything)
  press(scene, scene.parts.doneButton)
  eq(#scene.errors, 1)
  is_true(string.find(scene.errors[1], "boom", 1, true) ~= nil)
  local bare = scene.ns.UI.ExportWindow.new(scene.kit)
  bare.open(vm())
  press(scene, bare.parts.doneButton)
  eq(bare.isShown(), false)
end)

test("a long awards string is kept whole in the box", function()
  local scene = setup()
  local long = AWARDS .. string.rep("x", 100000)
  scene.window.open(vm({ text = long }))
  eq(#scene.parts.edit:GetText(), #long)
  eq(text(scene, scene.parts.count), "102,052 characters")
end)

test("nothing sticks out and no two controls overlap: compact, roomy, flat, in every state the window has", function()
  for _, options in ipairs({ {}, { density = "roomy" }, { chrome = "flat" }, { density = "roomy", chrome = "flat" } }) do
    local scene = setup(options)
    local function check(label)
      local problems = Intact.problems(scene.game, scene.window.window.frame)
      if #problems > 0 then
        error((options.density or "compact") .. " " .. (options.chrome or "stock") .. " " .. label .. ": " .. table.concat(problems, "; "))
      end
    end
    scene.window.open({})
    check("empty")
    scene.window.update(vm())
    check("new and changed")
    scene.window.update(vm({ everything = true, count = 12 }))
    check("everything")
    scene.window.update(vm({ hasNight = false }))
    check("no night")
    scene.window.update(vm({ sessionOpen = true, count = 1, new = 1, changed = 0 }))
    check("a session open")
    scene.window.update(vm({ text = string.rep("x", 100000), count = 12345 }))
    check("a very long string")
  end
end)
