-- The import window (IntrepidManager/ui/ImportWindow.lua) on the strict stand-in widgets, with the shared night fixtures of
-- docs/spec/fixtures. Invented names only.

local UI = dofile("tests/support/strict_ui.lua")
local StockTemplates = dofile("tests/support/stock_templates.lua")
local Intact = dofile("tests/support/intact.lua")
local Metrics = dofile("tests/support/metrics.lua")

local FILES = { "core/Crc32", "core/Json", "core/Envelope", "core/Ids", "core/Check", "core/Night", "ui/Kit", "ui/ImportWindow" }
local FIXTURES = "docs/spec/fixtures/"
local AT = 1796862600      -- when the fixture night was copied
local TODAY = "2026-12-09" -- the fixture night's raid date
local GOOD = read_file(FIXTURES .. "night-small.j.txt")

local function case(name) return read_file(FIXTURES .. "cases/" .. name .. ".txt") end

-- A window in a fresh game, two hours after the fixture night was copied, on the raid's day. Imports are recorded in
-- scene.imports and answered with scene.answer; errors the window reports are collected in scene.errors.
-- options: density, chrome, clock, known (a changed list), setTextFires, deps (to replace the defaults).
local function setup(options)
  options = options or {}
  local game = StockTemplates.install(UI.new({
    known = options.known, setTextFires = options.setTextFires, clock = options.clock or AT + 2 * 3600,
  }))
  local ns = {}
  for _, file in ipairs(FILES) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
  local scene = { game = game, ns = ns, imports = {}, errors = {}, answer = { ok = true, message = "Imported." } }
  local callbacks = {
    import = function(text, result)
      scene.imports[#scene.imports + 1] = { text = text, result = result }
      return scene.answer
    end,
  }
  scene.kit = ns.UI.Kit.new({
    density = options.density, chrome = options.chrome, onError = function(err) scene.errors[#scene.errors + 1] = tostring(err) end,
  })
  scene.window = ns.UI.ImportWindow.new(scene.kit, callbacks, options.deps or { today = function() return TODAY end })
  scene.parts = scene.window.parts
  return scene
end

-- Every test runs twice: the game may or may not run OnTextChanged for SetText, and the window must work either way.
local function both(name, fn)
  test(name, function() fn({}) end)
  test(name .. " (SetText runs OnTextChanged)", function() fn({ setTextFires = true }) end)
end

local function text(scene, widget) return scene.game.state(widget).text end
local function shown(scene, widget) return scene.game.state(widget).shown end
local function enabled(scene, widget) return scene.game.state(widget).enabled ~= false end

local function isColor(scene, widget, name)
  local c = scene.kit.colors[name]
  deep_eq(scene.game.state(widget).textColor, { c[1], c[2], c[3] })
end

-- A player clicks into the box (opening the window first if need be) and pastes, then waits `wait` seconds (default:
-- long enough for the string to be read; false: not at all).
local function paste(scene, string_, wait)
  if not scene.window.isShown() then scene.window.open() end
  if not scene.parts.edit:HasFocus() then scene.game.fire(scene.parts.scroll, "OnMouseDown", "LeftButton") end
  scene.game.paste(scene.parts.edit, string_)
  if wait ~= false then scene.game.advance(wait or 0.31) end
end

local function press(scene, button) scene.game.fire(button, "OnClick", "LeftButton") end

-- The summary the window should show for a string: what Night.summary says at that moment.
local function summaryOf(scene, string_, today)
  local result = scene.ns.Night.read(string_)
  return scene.ns.Night.summary(result, scene.game.env.GetServerTime(), today or TODAY).text
end

local function grouped(count)
  local digits = tostring(count)
  while true do
    local more, changed = string.gsub(digits, "^(%d+)(%d%d%d)", "%1,%2")
    if changed == 0 then return digits end
    digits = more
  end
end

test("a new window is closed; opening it shows how to use it, an empty box with the keyboard focus, and nothing to import", function()
  local scene = setup()
  eq(scene.window.isShown(), false)
  eq(text(scene, scene.parts.status), "Nothing pasted yet.") -- all of it is ready before the window is opened
  eq(text(scene, scene.parts.current), "No night has been imported yet.")
  eq(shown(scene, scene.parts.placeholder), true)
  eq(enabled(scene, scene.parts.importButton), false)
  eq(enabled(scene, scene.parts.clearButton), false)
  scene.window.open()
  is_true(scene.window.isShown())
  eq(scene.parts.edit:HasFocus(), true)
  eq(text(scene, scene.parts.status), "Nothing pasted yet.")
  isColor(scene, scene.parts.status, "muted")
  is_true(string.find(text(scene, scene.parts.intro), 'Paste the night string from the Raid Desk ("Copy for addon")', 1, true) ~= nil)
  is_true(string.find(text(scene, scene.parts.intro), "replaces the one the addon has now", 1, true) ~= nil)
  eq(text(scene, scene.parts.current), "No night has been imported yet.")
  eq(text(scene, scene.parts.count), "")
  eq(shown(scene, scene.parts.placeholder), true)
  eq(enabled(scene, scene.parts.importButton), false)
  eq(enabled(scene, scene.parts.clearButton), false)
  eq(enabled(scene, scene.parts.closeButton), true)
  eq(text(scene, scene.parts.hint), "")
  eq(text(scene, scene.parts.importButton), "Import")
  eq(scene.window.isShown(), true)
  press(scene, scene.parts.closeButton)
  eq(scene.window.isShown(), false)
end)

test("the paste box is built as the probe's paste window was: multi-line, no letter limit, in a scroll frame, a click anywhere focuses it", function()
  local scene = setup()
  local state = scene.game.state
  local edit = scene.parts.edit
  eq(state(edit).kind, "EditBox")
  eq(state(edit).multiLine, true)
  eq(state(edit).maxLetters, 0)
  eq(state(edit).autoFocus, false)
  eq(state(edit).size, 10) -- the density's text font: an edit box has none until it is given one
  eq(state(edit).fontPath, "Fonts\\FRIZQT__.TTF")
  eq(state(scene.parts.scroll).kind, "ScrollFrame")
  eq(state(scene.parts.scroll).templates[1], "UIPanelScrollFrameTemplate")
  eq(state(scene.parts.scroll).scrollChild, edit)
  eq(state(edit).parent, scene.parts.scroll)
  eq(state(edit).width, state(scene.parts.scroll).width) -- the box fills its scroll frame
  eq(state(edit).height, state(scene.parts.scroll).height)
  eq(state(edit).scripts.OnEnterPressed, nil) -- Enter is a new line in this box, and nothing else
  scene.window.open()
  edit:ClearFocus()
  eq(edit:HasFocus(), false)
  scene.game.fire(scene.parts.scroll, "OnMouseDown", "LeftButton") -- a click on the box, not on a line of text
  eq(edit:HasFocus(), true)
  scene.game.fire(edit, "OnEscapePressed")
  eq(edit:HasFocus(), false)
  local listed = false
  for _, name in ipairs(scene.game.env.UISpecialFrames) do
    if name == "IntrepidManagerImport" then listed = true end
  end
  is_true(listed)
  deep_eq(scene.game.audit(), {})
end)

test("the heading is gold, the box and the status have their own backgrounds, and Import is the red button", function()
  local scene = setup()
  local state = scene.game.state
  eq(text(scene, scene.parts.heading), "NIGHT STRING")
  eq(state(scene.parts.heading).fontObject, "GameFontNormalSmall")
  local function fillOf(frame) -- the color the frame's own texture has
    for _, region in ipairs(state(frame).regions) do
      if state(region).color then return state(region).color end
    end
  end
  deep_eq(fillOf(scene.parts.region), scene.kit.colors.panelAlt)
  deep_eq(fillOf(scene.parts.statusPanel), scene.kit.colors.panel)
  deep_eq(state(scene.parts.edit).textInsets, { 4, 4, 3, 3 })
  eq(state(scene.parts.status).maxLines, 6)
  eq(state(scene.parts.importButton).templates[1], "UIPanelButtonTemplate")
  eq(state(scene.parts.clearButton).templates[1], "UIPanelButtonGrayTemplate")
  eq(state(scene.parts.closeButton).templates[1], "UIPanelButtonGrayTemplate")
end)

both("pasting shows Reading... at once, and the result comes 0.3 seconds after the last change", function(options)
  local scene = setup(options)
  paste(scene, GOOD, false)
  eq(text(scene, scene.parts.status), "Reading...")
  isColor(scene, scene.parts.status, "muted")
  eq(text(scene, scene.parts.count), grouped(#GOOD) .. " characters")
  eq(shown(scene, scene.parts.placeholder), false)
  eq(enabled(scene, scene.parts.importButton), false)
  eq(enabled(scene, scene.parts.clearButton), true)
  scene.game.advance(0.29)
  eq(text(scene, scene.parts.status), "Reading...")
  scene.game.advance(0.02)
  local expected = summaryOf(scene, GOOD)
  eq(text(scene, scene.parts.status), expected)
  is_true(string.find(expected, "Night of 2026-12-09, copied 2 hours ago: ", 1, true) == 1)
  isColor(scene, scene.parts.status, "good")
  eq(enabled(scene, scene.parts.importButton), true)
  eq(#scene.errors, 0)
end)

both("a change within the delay starts the wait again, so the last text is read once", function(options)
  local reads = 0
  local scene
  scene = setup({
    setTextFires = options.setTextFires,
    deps = { today = function() return TODAY end, read = function(string_) reads = reads + 1 return scene.ns.Night.read(string_) end },
  })
  paste(scene, "IM1:night:j", false)
  scene.game.advance(0.2)
  paste(scene, GOOD, false)
  scene.game.advance(0.2)
  eq(reads, 0)
  eq(text(scene, scene.parts.status), "Reading...")
  scene.game.advance(0.11)
  eq(reads, 1)
  eq(text(scene, scene.parts.status), summaryOf(scene, GOOD))
  eq(#scene.game.timers, 0)
end)

both("a night with something to look at is orange and says what; it can still be imported", function(options)
  local scene = setup(options)
  paste(scene, case("night-ok-row-error"))
  is_true(string.find(text(scene, scene.parts.status), "1 priority skipped", 1, true) ~= nil)
  eq(text(scene, scene.parts.status), summaryOf(scene, case("night-ok-row-error")))
  isColor(scene, scene.parts.status, "warn")
  eq(enabled(scene, scene.parts.importButton), true)

  local other = setup({ setTextFires = options.setTextFires, deps = { today = function() return "2026-12-10" end } })
  paste(other, GOOD)
  is_true(string.find(text(other, other.parts.status), "The raid date (2026-12-09) is not today (2026-12-10).", 1, true) ~= nil)
  isColor(other, other.parts.status, "warn")
  eq(enabled(other, other.parts.importButton), true)

  local old = setup({ setTextFires = options.setTextFires, clock = AT + 19 * 3600 })
  paste(old, GOOD)
  is_true(string.find(text(old, old.parts.status), "This string was copied more than 18 hours ago.", 1, true) ~= nil)
  isColor(old, old.parts.status, "warn")
  eq(enabled(old, old.parts.importButton), true)
end)

test("every night string the shared cases refuse is answered with the reader's own words, in red, with Import off", function()
  local scene = setup()
  local ok, cases = scene.ns.Json.decode(read_file(FIXTURES .. "cases/cases.json"))
  is_true(ok)
  local refused = 0
  for _, entry in ipairs(cases) do
    if entry.box == "night" and entry.expect ~= "OK" then
      refused = refused + 1
      local string_ = read_file(FIXTURES .. entry.file)
      local result = scene.ns.Night.read(string_)
      eq(result.ok, false)
      paste(scene, string_)
      if text(scene, scene.parts.status) ~= result.message then error(entry.file .. ": the window says: " .. text(scene, scene.parts.status)) end
      isColor(scene, scene.parts.status, "bad")
      if enabled(scene, scene.parts.importButton) then error(entry.file .. ": Import is on") end
    end
  end
  is_true(refused >= 30)
  eq(#scene.imports, 0)
  eq(#scene.errors, 0)
end)

test("a cut string says how much arrived, and the night you have now is kept when there is one", function()
  local scene = setup()
  paste(scene, case("night-bad-truncated"))
  local message = scene.ns.Night.read(case("night-bad-truncated")).message
  is_true(string.find(message, "Only part of the string arrived", 1, true) == 1)
  eq(text(scene, scene.parts.status), message)
  scene.window.update({ current = "Night of 2026-12-08, copied 2 days ago: 58 players, 87 priorities." })
  eq(text(scene, scene.parts.current), "In the addon now: Night of 2026-12-08, copied 2 days ago: 58 players, 87 priorities.")
  paste(scene, case("night-bad-altered"))
  eq(text(scene, scene.parts.status), scene.ns.Night.read(case("night-bad-altered")).message .. " The night you have now is kept.")
  paste(scene, GOOD)
  isColor(scene, scene.parts.status, "good")
  is_true(string.find(text(scene, scene.parts.status), "kept", 1, true) == nil)
end)

test("an awards string pasted by mistake is turned away and told where it belongs", function()
  local scene = setup()
  paste(scene, read_file(FIXTURES .. "awards-small.j.txt"))
  is_true(string.find(text(scene, scene.parts.status), "This is an awards string; this box takes night strings.", 1, true) == 1)
  is_true(string.find(text(scene, scene.parts.status), "Raid Desk importer", 1, true) ~= nil)
  isColor(scene, scene.parts.status, "bad")
  eq(enabled(scene, scene.parts.importButton), false)
end)

both("nothing but white space counts as nothing", function(options)
  local scene = setup(options)
  paste(scene, GOOD)
  eq(enabled(scene, scene.parts.importButton), true)
  paste(scene, "  \n\t ", false) -- no waiting needed to know that
  eq(text(scene, scene.parts.status), "Nothing pasted yet.")
  isColor(scene, scene.parts.status, "muted")
  eq(enabled(scene, scene.parts.importButton), false)
  scene.game.advance(1)
  eq(text(scene, scene.parts.status), "Nothing pasted yet.")
end)

test("the count is in groups of three and says character for one", function()
  local scene = setup()
  for _, row in ipairs({ { 1, "1 character" }, { 12, "12 characters" }, { 999, "999 characters" }, { 1000, "1,000 characters" },
      { 12345, "12,345 characters" }, { 1234567, "1,234,567 characters" } }) do
    paste(scene, string.rep("x", row[1]), false)
    eq(text(scene, scene.parts.count), row[2])
  end
end)

both("Import hands over the text and its reading, empties the box and shows the answer", function(options)
  local scene = setup(options)
  paste(scene, GOOD)
  scene.answer = { ok = true, message = "Imported the night of 2026-12-09: 12 players." }
  scene.parts.scroll:SetVerticalScroll(40)
  press(scene, scene.parts.importButton)
  eq(scene.parts.scroll:GetVerticalScroll(), 0)
  eq(#scene.imports, 1)
  eq(scene.imports[1].text, GOOD)
  eq(scene.imports[1].result.ok, true)
  eq(scene.imports[1].result.raid.date, "2026-12-09")
  eq(scene.parts.edit:GetText(), "")
  eq(text(scene, scene.parts.status), "Imported the night of 2026-12-09: 12 players.")
  isColor(scene, scene.parts.status, "good")
  eq(text(scene, scene.parts.count), "")
  eq(shown(scene, scene.parts.placeholder), true)
  eq(enabled(scene, scene.parts.importButton), false)
  eq(enabled(scene, scene.parts.clearButton), false)
  scene.game.advance(2) -- nothing waiting changes the message
  eq(text(scene, scene.parts.status), "Imported the night of 2026-12-09: 12 players.")
  scene.answer = nil
  paste(scene, GOOD)
  press(scene, scene.parts.importButton) -- the engine answered nothing: said so, and kept the box
  eq(text(scene, scene.parts.status), "Nothing is connected to import with.")
  isColor(scene, scene.parts.status, "bad")
  eq(scene.parts.edit:GetText(), GOOD)
end)

both("an import the engine refuses keeps the box, shows the reason in red and leaves Import on to try again", function(options)
  local scene = setup(options)
  paste(scene, GOOD)
  scene.answer = { ok = false, message = "The night could not be saved." }
  press(scene, scene.parts.importButton)
  eq(text(scene, scene.parts.status), "The night could not be saved.")
  isColor(scene, scene.parts.status, "bad")
  eq(scene.parts.edit:GetText(), GOOD)
  eq(enabled(scene, scene.parts.importButton), true)
  scene.answer = { ok = false }
  press(scene, scene.parts.importButton)
  eq(text(scene, scene.parts.status), "The night could not be imported.")
  scene.answer = { ok = true }
  press(scene, scene.parts.importButton)
  eq(text(scene, scene.parts.status), "Imported.")
  eq(#scene.imports, 3)
end)

both("while a session is open Import is off, with the reason beside the buttons, and it comes back when the session ends", function(options)
  local scene = setup(options)
  scene.window.update({ sessionOpen = true })
  paste(scene, GOOD)
  isColor(scene, scene.parts.status, "good")
  eq(enabled(scene, scene.parts.importButton), false)
  eq(text(scene, scene.parts.hint), "Finish or cancel the open session first.")
  isColor(scene, scene.parts.hint, "warn")
  press(scene, scene.parts.importButton) -- even a click that gets through does nothing
  eq(#scene.imports, 0)
  scene.window.update({})
  eq(text(scene, scene.parts.hint), "")
  eq(enabled(scene, scene.parts.importButton), true)
  scene.window.update({ sessionOpen = true })
  eq(enabled(scene, scene.parts.importButton), false)
end)

both("Import does nothing if the box changed after it was read", function(options)
  local scene = setup(options)
  paste(scene, GOOD)
  scene.parts.edit:SetText(GOOD .. "x") -- a change the game did not tell us about, in the setup where SetText is silent
  press(scene, scene.parts.importButton)
  eq(#scene.imports, 0)
  eq(text(scene, scene.parts.status), "Reading...")
  scene.game.advance(0.31)
  eq(#scene.imports, 0)
  is_true(text(scene, scene.parts.status) ~= "Reading...")
end)

both("Clear empties the box, cancels a read that is waiting and focuses the box", function(options)
  local reads = 0
  local scene
  scene = setup({
    setTextFires = options.setTextFires,
    deps = { today = function() return TODAY end, read = function(string_) reads = reads + 1 return scene.ns.Night.read(string_) end },
  })
  paste(scene, GOOD, false)
  scene.parts.scroll:SetVerticalScroll(40)
  scene.parts.edit:ClearFocus()
  press(scene, scene.parts.clearButton)
  eq(scene.parts.edit:GetText(), "")
  eq(text(scene, scene.parts.status), "Nothing pasted yet.")
  eq(text(scene, scene.parts.count), "")
  eq(shown(scene, scene.parts.placeholder), true)
  eq(enabled(scene, scene.parts.clearButton), false)
  eq(scene.parts.scroll:GetVerticalScroll(), 0)
  eq(scene.parts.edit:HasFocus(), true)
  scene.game.advance(1)
  eq(reads, 0)
  eq(text(scene, scene.parts.status), "Nothing pasted yet.")
end)

test("opening the window again reads what was left in the box again, so that the age is right", function()
  local scene = setup()
  paste(scene, GOOD)
  is_true(string.find(text(scene, scene.parts.status), "copied 2 hours ago", 1, true) ~= nil)
  scene.window.hide()
  scene.game.advance(3600)
  scene.window.open()
  is_true(string.find(text(scene, scene.parts.status), "copied 3 hours ago", 1, true) ~= nil)
  eq(scene.parts.edit:GetText(), GOOD)
  eq(scene.parts.edit:HasFocus(), true)
  eq(enabled(scene, scene.parts.importButton), true)
  scene.window.update({ current = "Night of 2026-12-09, copied 3 hours ago: 12 players, 4 priorities." })
  scene.window.hide()
  scene.window.open({ sessionOpen = true })
  eq(enabled(scene, scene.parts.importButton), false)
  eq(text(scene, scene.parts.current), "No night has been imported yet.")
end)

test("a reader that fails is reported, and the window does not stay on Reading...", function()
  local scene = setup({ deps = { today = function() return TODAY end, read = function() error("boom") end } })
  paste(scene, GOOD)
  eq(text(scene, scene.parts.status), "The string could not be read. Tell the addon maintainers.")
  isColor(scene, scene.parts.status, "bad")
  eq(enabled(scene, scene.parts.importButton), false)
  eq(#scene.errors, 1)
  is_true(string.find(scene.errors[1], "boom", 1, true) ~= nil)
end)

test("a reader that starts to fail after a good read leaves Import off", function()
  local failing = false
  local scene
  scene = setup({
    deps = {
      today = function() return TODAY end,
      read = function(string_)
        if failing then error("boom") end
        return scene.ns.Night.read(string_)
      end,
    },
  })
  paste(scene, GOOD)
  eq(enabled(scene, scene.parts.importButton), true)
  scene.window.hide()
  failing = true
  scene.window.open()
  eq(text(scene, scene.parts.status), "The string could not be read. Tell the addon maintainers.")
  eq(enabled(scene, scene.parts.importButton), false)
  eq(#scene.errors, 1)
end)

test("opening the window while a read is waiting reads once, not twice", function()
  local reads = 0
  local scene
  scene = setup({
    deps = { today = function() return TODAY end, read = function(string_) reads = reads + 1 return scene.ns.Night.read(string_) end },
  })
  paste(scene, GOOD, false)
  scene.window.open()
  eq(reads, 1)
  scene.game.advance(1)
  eq(reads, 1)
end)

test("with no deps the window reads the game's server time and date", function()
  local scene = setup({ deps = {} })
  paste(scene, GOOD) -- the game's date is 2026-12-10 (UTC), the night's raid date is 2026-12-09
  local status = text(scene, scene.parts.status)
  is_true(string.find(status, "copied 2 hours ago", 1, true) ~= nil)
  is_true(string.find(status, "The raid date (2026-12-09) is not today (2026-12-10).", 1, true) ~= nil)
  isColor(scene, scene.parts.status, "warn")
end)

test("100,000 characters are counted and answered at once", function()
  local scene = setup()
  local started = os.clock()
  paste(scene, "IM1:night:j:99999:" .. string.rep("x", 100000 - 18))
  is_true(os.clock() - started < 3)
  eq(text(scene, scene.parts.count), "100,000 characters")
  isColor(scene, scene.parts.status, "bad")
  eq(enabled(scene, scene.parts.importButton), false)
  eq(#scene.errors, 0)
end)

test("no stock scroll frame: a plain one takes the room of the scroll bar, and the window still works", function()
  local known = UI.load_known()
  known.present.templates.UIPanelScrollFrameTemplate = nil
  local scene = setup({ known = known })
  local state = scene.game.state
  eq(state(scene.parts.scroll).templates[1], nil)
  eq(state(scene.parts.scroll).width, state(scene.parts.region).width)
  eq(state(scene.parts.edit).width, state(scene.parts.region).width)
  paste(scene, GOOD)
  eq(enabled(scene, scene.parts.importButton), true)
  local stock = setup()
  is_true(state(scene.parts.scroll).width > stock.game.state(stock.parts.scroll).width)
  deep_eq(Intact.problems(scene.game, scene.window.window.frame), {})
end)

test("the worst status the reader can give fits the lines of the status box, compact and roomy", function()
  for _, density in ipairs({ "compact", "roomy" }) do
    local long = string.rep("W", 60)
    local skipped = {}
    for index = 1, 6 do skipped[index] = { item = long, reason = "line " .. index .. ": unknown player" } end
    local crowded = {
      ok = true, model = { at = AT }, raid = { date = "2026-12-01" }, roster = { 1, 2, 3 }, priorities = { 1, 2 }, skipped = skipped,
      problems = { { kind = "raid" }, { kind = "roster" }, { kind = "roster" }, { kind = "boss" } },
    }
    local scene = setup({ density = density, clock = AT + 3 * 86400, deps = { today = function() return TODAY end, read = function() return crowded end } })
    paste(scene, GOOD)
    local status = scene.parts.status
    local info = scene.game.state(status)
    is_true(string.find(info.text, "more than 18 hours ago", 1, true) ~= nil) -- the last sentence is there
    local size = Metrics.FONT_OBJECTS[info.fontObject].size
    is_true(#Metrics.layout(info.text, size, info.width, true) <= 6)
    deep_eq(Intact.problems(scene.game, scene.window.window.frame), {})
  end
end)

test("nothing sticks out and no two controls overlap: compact, roomy, flat, in every state the window has", function()
  local crowdedRead = function(string_)
    if string_ == "crowded" then
      return { ok = true, model = { at = AT }, raid = { date = "2026-12-01" }, roster = { 1 }, priorities = { 1 },
        skipped = { { item = string.rep("W", 60), reason = "line 4: unknown player" } }, problems = { { kind = "raid" } } }
    end
    return nil
  end
  for _, options in ipairs({ {}, { density = "roomy" }, { chrome = "flat" }, { density = "roomy", chrome = "flat" } }) do
    local scene
    scene = setup({
      density = options.density, chrome = options.chrome, clock = AT + 19 * 3600,
      deps = {
        today = function() return "2026-12-10" end,
        read = function(string_) return crowdedRead(string_) or scene.ns.Night.read(string_) end,
      },
    })
    local function check(label)
      local problems = Intact.problems(scene.game, scene.window.window.frame)
      if #problems > 0 then
        error((options.density or "compact") .. " " .. (options.chrome or "stock") .. " " .. label .. ": " .. table.concat(problems, "; "))
      end
    end
    scene.window.open()
    check("empty")
    paste(scene, GOOD, false)
    check("reading")
    scene.game.advance(0.31)
    check("a night with both warnings")
    paste(scene, "crowded")
    check("a crowded summary")
    paste(scene, case("night-bad-truncated"))
    scene.window.update({ current = "Night of 2026-12-08, copied 2 days ago: 58 players, 87 priorities.", sessionOpen = true })
    check("an error with a night in place and a session open")
    paste(scene, string.rep("x", 100000))
    check("a string of 100,000 characters")
    scene.window.update({})
    paste(scene, GOOD)
    press(scene, scene.parts.importButton)
    check("after an import")
  end
end)

test("a test build can listen: every change of the box, every read with how long it took, and every import is passed on", function()
  local log = {}
  local ticks = 0
  local scene = setup({
    deps = {
      today = function() return TODAY end,
      log = function(entry) log[#log + 1] = entry end,
      clock = function() ticks = ticks + 7 return ticks end,
    },
  })
  paste(scene, GOOD)
  deep_eq(log, { { event = "changed", chars = #GOOD, user = true, same = false }, { event = "read", chars = #GOOD, ms = 7, ok = true } })
  press(scene, scene.parts.importButton)
  eq(log[3].event, "import")
  eq(log[3].ok, true)
  eq(log[3].chars, #GOOD)
  paste(scene, case("night-bad-truncated"))
  eq(log[#log].event, "read")
  eq(log[#log].ok, false)
  eq(log[#log].code, "E_TRUNCATED")
  -- a log that raises does not harm the window
  local broken = setup({ deps = { today = function() return TODAY end, log = function() error("boom") end } })
  paste(broken, GOOD)
  eq(enabled(broken, broken.parts.importButton), true)
  eq(#broken.errors, 0)
end)
