-- /im window (IntrepidManager/ui/Demo.lua): the windows on sample data, on the strict stand-in widgets. Invented names only.

local UI = dofile("tests/support/strict_ui.lua")
local StockTemplates = dofile("tests/support/stock_templates.lua")

local FILES = {
  "core/Crc32", "core/Json", "core/Envelope", "core/Names", "core/Ids", "core/Check", "core/Night", "core/SelfTestSamples",
  "ui/Kit", "ui/Sample", "ui/Confirm", "ui/Picker", "ui/SessionWindow", "ui/ImportWindow", "ui/ExportWindow", "ui/IconWindow", "ui/Demo",
}

-- A game with the demo in it. Everything it says goes to scene.said; the saved variables are scene.db.
local function setup()
  local game = StockTemplates.install(UI.new())
  local ns = {}
  for _, file in ipairs(FILES) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
  local scene = { game = game, ns = ns, said = {}, db = {} }
  scene.demo = ns.UI.Demo.new({ out = function(text) scene.said[#scene.said + 1] = text end, db = scene.db })
  return scene
end

local function text(scene, widget) return scene.game.state(widget).text end
local function press(scene, widget) scene.game.fire(widget, "OnClick", "LeftButton") end
local function click(scene, widget) scene.game.fire(widget, "OnMouseDown", "LeftButton") end
local function visible(scene, widget) return scene.game.visible(widget) end

local function said(scene, fragment)
  for _, line in ipairs(scene.said) do
    if string.find(line, fragment, 1, true) then return true end
  end
  return false
end

local function frameNamed(scene, name) return scene.game.named[name] end

test("the words of /im window: a window, a density, a frame and a state, in any order", function()
  local parse = setup().demo.parse
  deep_eq(parse(""), { window = "session", density = "compact", chrome = "stock", extras = {} })
  deep_eq(parse(nil), { window = "session", density = "compact", chrome = "stock", extras = {} })
  deep_eq(parse("Import  ROOMY flat Sample busy"), { window = "import", density = "roomy", chrome = "flat", extras = { sample = true, busy = true } })
  deep_eq(parse("40 unconfirmed"), { window = "session", density = "compact", chrome = "stock", extras = { ["40"] = true, unconfirmed = true } })
  deep_eq(parse("picker stock compact"), { window = "picker", density = "compact", chrome = "stock", extras = {} })
  local request, unknown = parse("session roomy sideways")
  eq(request, nil)
  eq(unknown, "sideways")
end)

test("no words open the compact session window on sample data, and say that nothing is given", function()
  local scene = setup()
  eq(#scene.game.frames, 1)
  scene.demo.open("")
  local frame = frameNamed(scene, "IntrepidManagerSession")
  is_true(frame ~= nil)
  is_true(visible(scene, frame))
  eq(scene.game.state(frame).width, 680) -- compact
  is_true(said(scene, "Showing the session window (compact, stock frame) on sample data"))
  is_true(said(scene, "Nothing is given or imported. Escape closes it."))
  local listed = false
  for _, name in ipairs(scene.game.env.UISpecialFrames) do listed = listed or name == "IntrepidManagerSession" end
  is_true(listed)
  eq(type(scene.db.positions), "table")
  local session = scene.demo.windows().session
  eq(text(scene, session.parts.progress), "2 of 5 awarded")
  eq(text(scene, session.parts.headName), "Blade of the Fixture")
  deep_eq(scene.game.audit(), {})
end)

test("a word the demo does not know gets the help line and opens nothing", function()
  local scene = setup()
  scene.demo.open("sideways")
  eq(#scene.game.frames, 1)
  eq(#scene.said, 1)
  is_true(string.find(scene.said[1], "I do not know 'sideways'. /im window [session, import, export, icons, picker or confirm]", 1, true) == 1)
  eq(string.find(scene.said[1], "|", 1, true), nil) -- the game would read a pipe in the chat as the start of a color or a link
  eq(scene.demo.windows().session, nil)
end)

test("another density or frame builds new windows and hides the old ones; the same kit keeps its windows", function()
  local scene = setup()
  scene.demo.open("")
  local compact = frameNamed(scene, "IntrepidManagerSession")
  scene.demo.open("40")
  eq(frameNamed(scene, "IntrepidManagerSession"), compact) -- a state, not another density: the same window (it only needs more rows)
  scene.demo.open("roomy")
  local roomy = frameNamed(scene, "IntrepidManagerSession")
  is_true(roomy ~= compact)
  eq(scene.game.state(roomy).width, 830)
  eq(visible(scene, roomy), true)
  eq(visible(scene, compact), false)
  scene.demo.open("roomy flat")
  local flat = frameNamed(scene, "IntrepidManagerSession")
  is_true(flat ~= roomy)
  eq(visible(scene, roomy), false)
  eq(scene.game.state(flat).templates[1], "BackdropTemplate")
  scene.demo.open("import flat")
  eq(visible(scene, frameNamed(scene, "IntrepidManagerImport")), true)
  scene.demo.open("compact")
  eq(visible(scene, frameNamed(scene, "IntrepidManagerImport")), false) -- the import window of the other kit is hidden too
  eq(visible(scene, frameNamed(scene, "IntrepidManagerSession")), true)
end)

test("a window dragged somewhere is opened there next time, and the place is kept in the saved variables", function()
  local scene = setup()
  scene.demo.open("")
  local frame = frameNamed(scene, "IntrepidManagerSession")
  frame:ClearAllPoints()
  frame:SetPoint("TOPLEFT", scene.game.env.UIParent, "BOTTOMLEFT", 120, 900)
  scene.game.fire(frame, "OnDragStop")
  deep_eq(scene.db.positions.IntrepidManagerSession, { left = 120, top = 900 })
  scene.demo.open("roomy")
  local point = scene.game.state(frameNamed(scene, "IntrepidManagerSession")).points[1]
  eq(point.point, "TOPLEFT")
  eq(point.x, 120)
  eq(point.y, 900)
end)

test("the session states of the words: 40 names, a give not confirmed, a failed one, one we did not start, a warning", function()
  local scene = setup()
  scene.demo.open("")
  local parts = scene.demo.windows().session.parts
  eq(scene.game.state(parts.banner).shown, false)
  eq(parts.priorities.height, 13 * 16)
  scene.demo.open("40")
  eq(parts.priorities.height, 41 * 16)
  scene.demo.open("unconfirmed")
  eq(scene.game.state(parts.banner).shown, true)
  is_true(string.find(text(scene, parts.bannerText), "Not confirmed.", 1, true) ~= nil)
  is_true(string.find(text(scene, parts.bannerText), "Mirelle Dunmore", 1, true) ~= nil)
  scene.demo.open("failed")
  is_true(string.find(text(scene, parts.bannerText), "Inventory is full.", 1, true) ~= nil)
  scene.demo.open("observed")
  is_true(string.find(text(scene, parts.bannerText), "Garrick Vole", 1, true) ~= nil)
  scene.demo.open("warning")
  is_true(string.find(text(scene, parts.bannerText), "A roll for this item is still running.", 1, true) ~= nil)
  scene.demo.open("session")
  eq(scene.game.state(parts.banner).shown, false)
  eq(text(scene, parts.progress), "2 of 5 awarded")
end)

test("Give in the demo marks the item given, says that nothing was given, and the list shows it", function()
  local scene = setup()
  scene.demo.open("")
  local session = scene.demo.windows().session
  session.selectLine(2)
  local who = session.parts.recipient:GetText()
  is_true(who ~= "")
  press(scene, session.parts.giveButton)
  is_true(session.confirm.isShown())
  press(scene, session.confirm.parts.confirmButton)
  is_true(said(scene, "Demo: would give Blade of the Fixture to " .. who .. " (council). Nothing was given."))
  eq(text(scene, session.parts.progress), "3 of 5 awarded")
  eq(text(scene, session.parts.itemRows[1].state), (string.match(who, "^(%S+)")))
  scene.demo.open("") -- opening again starts a fresh pretend session
  eq(text(scene, session.parts.progress), "2 of 5 awarded")
end)

test("choosing another item, Disenchant, Guild bank, Remove, Restore and Finish all work on the demo's pretend session", function()
  local scene = setup()
  scene.demo.open("")
  local session = scene.demo.windows().session
  click(scene, session.parts.itemRows[2])
  eq(text(scene, session.parts.headName), "Cloak of the Mock")
  press(scene, session.parts.disenchantButton)
  is_true(said(scene, "Demo: would send Cloak of the Mock to disenchant. Nothing was given."))
  eq(text(scene, session.parts.itemRows[2].state), "Disenchanted")
  press(scene, session.parts.bankButton)
  is_true(said(scene, "Demo: would send Cloak of the Mock to guild-bank."))
  press(scene, session.parts.removeButton)
  is_true(said(scene, "Demo: would remove Cloak of the Mock from the session."))
  eq(text(scene, session.parts.itemRows[2].state), "removed")
  press(scene, session.parts.removeButton) -- the button says Restore now
  eq(text(scene, session.parts.itemRows[2].state), "Guild") -- back to what it was before: the bank took it
  press(scene, session.parts.finishButton)
  is_true(said(scene, "Demo: the session would finish. Nothing was given."))
end)

test("a give that was not confirmed can be marked received or tried again, and one we did not start can be dismissed", function()
  local scene = setup()
  scene.demo.open("unconfirmed")
  local session = scene.demo.windows().session
  press(scene, session.parts.bannerFirst) -- Retry
  is_true(said(scene, "Demo: would try Blade of the Fixture for Mirelle Dunmore again."))
  press(scene, session.parts.bannerSecond) -- Mark received
  is_true(said(scene, "Demo: would mark Blade of the Fixture as received by Mirelle Dunmore."))
  eq(scene.game.state(session.parts.banner).shown, false)
  scene.demo.open("observed")
  eq(scene.game.state(session.parts.banner).shown, true)
  press(scene, session.parts.bannerSecond)
  eq(scene.game.state(session.parts.banner).shown, false)
end)

test("the import window opens ready to paste into, with last week's night in place, and runs the real reader", function()
  local scene = setup()
  scene.demo.open("import")
  local window = scene.demo.windows().import
  is_true(visible(scene, frameNamed(scene, "IntrepidManagerImport")))
  eq(window.parts.edit:HasFocus(), true)
  eq(text(scene, window.parts.status), "Nothing pasted yet.")
  eq(text(scene, window.parts.current), "In the addon now: Night of 2026-12-02, copied 7 days ago: 58 players, 87 priorities.")
  scene.demo.open("import sample")
  eq(window.parts.edit:GetText(), scene.ns.SelfTestSamples.night)
  is_true(string.find(text(scene, window.parts.status), "Night of 2026-12-09, copied 1 hour ago: 6 players, 3 priorities.", 1, true) == 1)
  eq(scene.game.state(window.parts.importButton).enabled, true)
  press(scene, window.parts.importButton)
  is_true(said(scene, "Demo: would import " .. #scene.ns.SelfTestSamples.night .. " characters. Nothing was imported."))
  eq(text(scene, window.parts.status), "Demo only: nothing was imported.")
  eq(window.parts.edit:GetText(), "")
  scene.demo.open("import sample busy")
  eq(scene.game.state(window.parts.importButton).enabled, false)
  eq(text(scene, window.parts.hint), "Finish or cancel the open session first.")
  deep_eq(scene.game.audit(), {})
end)

test("the picker and the confirmation open on their own too, and answer without giving anything", function()
  local scene = setup()
  scene.demo.open("picker")
  local session = scene.demo.windows().session
  is_true(session.picker.isShown())
  eq(session.picker.parts.list.height, 38 * 16) -- the raid of 40 less the two the sample leaves out
  click(scene, session.picker.parts.rows[2])
  is_true(said(scene, "Demo: picked "))
  eq(session.picker.isShown(), false)
  scene.demo.open("confirm")
  is_true(session.confirm.isShown())
  press(scene, session.confirm.parts.confirmButton)
  is_true(said(scene, "Demo: confirmed. Nothing was given."))
  eq(session.confirm.isShown(), false)
end)

test("showAll opens every window for the facts run and hideAll closes them again", function()
  local scene = setup()
  local frames = scene.demo.showAll()
  for _, name in ipairs({ "session", "picker", "confirm", "import", "export" }) do
    is_true(frames[name] ~= nil)
    is_true(visible(scene, frames[name]))
  end
  eq(scene.demo.windows().import.parts.edit:GetText(), scene.ns.SelfTestSamples.night)
  eq(scene.demo.windows().export.parts.edit:GetText(), scene.ns.SelfTestSamples.awards)
  eq(scene.game.state(scene.demo.windows().session.parts.banner).shown, true) -- the session shows its banner, to be measured too
  scene.demo.hideAll()
  for _, frame in pairs(frames) do eq(visible(scene, frame), false) end
  scene.demo.hideAll() -- nothing built yet is fine too
  local fresh = setup()
  fresh.demo.hideAll()
end)

test("nothing the demo says in the chat has a pipe character in it", function()
  local scene = setup()
  for _, words in ipairs({ "", "sideways", "40", "unconfirmed", "failed", "observed", "import sample", "picker", "confirm", "roomy flat" }) do
    scene.demo.open(words)
  end
  local session = scene.demo.windows().session
  session.selectLine(2)
  press(scene, session.parts.giveButton)
  press(scene, session.confirm.parts.confirmButton)
  press(scene, session.parts.disenchantButton)
  press(scene, session.parts.removeButton)
  press(scene, session.parts.finishButton)
  is_true(#scene.said > 10)
  for _, line in ipairs(scene.said) do eq(string.find(line, "|", 1, true), nil) end
end)

test("the session window and the import window are not open together, unless they all are wanted", function()
  local scene = setup()
  scene.demo.open("")
  local session = frameNamed(scene, "IntrepidManagerSession")
  scene.demo.open("import")
  local import = frameNamed(scene, "IntrepidManagerImport")
  is_true(visible(scene, import))
  eq(visible(scene, session), false)
  scene.demo.open("picker")
  eq(visible(scene, import), false)
  is_true(visible(scene, session))
  is_true(scene.demo.windows().session.picker.isShown())
  scene.demo.open("import")
  eq(scene.demo.windows().session.picker.isShown(), false) -- the popups go with their window
  scene.demo.showAll()
  is_true(visible(scene, import))
  is_true(visible(scene, session))
end)

test("the import window's doings are kept in the saved variables, the last 60, with the time", function()
  local scene = setup()
  scene.demo.open("import")
  local window = scene.demo.windows().import
  scene.game.fire(window.parts.scroll, "OnMouseDown", "LeftButton")
  scene.game.paste(window.parts.edit, scene.ns.SelfTestSamples.night)
  scene.game.advance(0.4)
  local log = scene.db.pasteLog
  eq(log[1].event, "changed")
  eq(log[1].user, true)
  eq(log[1].chars, #scene.ns.SelfTestSamples.night)
  eq(log[2].event, "read")
  eq(log[2].ok, true)
  eq(log[1].at, 1796866200)
  press(scene, window.parts.importButton)
  eq(log[#log].event, "import")
  for _ = 1, 100 do scene.game.paste(window.parts.edit, "x") end
  eq(#scene.db.pasteLog, 60)
end)

test("the export window shows the sample awards string; Everything, Done and a session that is open work on it", function()
  local scene = setup()
  scene.demo.open("export")
  local window = scene.demo.windows().export
  is_true(visible(scene, frameNamed(scene, "IntrepidManagerExport")))
  eq(window.parts.edit:GetText(), scene.ns.SelfTestSamples.awards)
  eq(text(scene, window.parts.summary), "5 awards: 3 new and 2 changed since the night was copied.")
  eq(text(scene, window.parts.warning), "")
  window.parts.everything:SetChecked(true)
  press(scene, window.parts.everything)
  is_true(said(scene, "Demo: the export would hold everything."))
  eq(text(scene, window.parts.summary), "7 awards (everything, not only what is new).")
  window.parts.everything:SetChecked(false)
  press(scene, window.parts.everything)
  is_true(said(scene, "Demo: the export would hold what is new."))
  eq(text(scene, window.parts.summary), "5 awards: 3 new and 2 changed since the night was copied.")
  press(scene, window.parts.doneButton)
  eq(window.isShown(), false)
  is_true(said(scene, "Demo: Done. After a real export the addon would suggest a /reload, never force one."))
  scene.demo.open("export busy")
  eq(text(scene, window.parts.warning), "A loot session is open: awards given from now on are not in this string.")
  eq(scene.game.state(window.parts.everything).checked, false) -- opening again starts with the box cleared
  scene.demo.open("session")
  eq(window.isShown(), false)
  scene.demo.open("export roomy")
  eq(scene.game.state(frameNamed(scene, "IntrepidManagerExport")).width, 710)
  deep_eq(scene.game.audit(), {})
end)

test("the icon test window opens on its own word, one main window at a time, and is closed with the rest", function()
  local scene = setup()
  scene.demo.open("session")
  scene.demo.open("icons")
  local window = scene.demo.windows().icons
  is_true(window.isShown())
  eq(scene.demo.windows().session.isShown(), false)
  is_true(said(scene, "Showing the icons window (compact, stock frame) on sample data."))
  scene.demo.open("export")
  eq(window.isShown(), false)
  scene.demo.open("icons")
  is_true(window.isShown())
  scene.demo.open("roomy icons")
  is_true(scene.demo.windows().icons ~= window)
  is_true(scene.demo.windows().icons.isShown())
  scene.demo.hideAll()
  eq(scene.demo.windows().icons.isShown(), false)
  deep_eq(scene.game.audit(), {})
end)
