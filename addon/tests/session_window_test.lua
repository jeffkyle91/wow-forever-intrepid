-- The loot session window (IntrepidManager/ui/SessionWindow.lua) on the strict stand-in widgets, with the sample view-model
-- of IntrepidManager/ui/Sample.lua. Invented names only.

local UI = dofile("tests/support/strict_ui.lua")
local StockTemplates = dofile("tests/support/stock_templates.lua")
local Layout = dofile("tests/support/layout.lua")
local Intact = dofile("tests/support/intact.lua")

local FILES = { "core/Names", "ui/Kit", "ui/Sample", "ui/Confirm", "ui/Picker", "ui/SessionWindow" }

-- A window in a fresh game. Every callback records its call in `calls`; preview answers with `preview`.
local function setup(options, known)
  local game = StockTemplates.install(UI.new({ known = known }))
  local ns = {}
  for _, file in ipairs(FILES) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
  local calls = {}
  local scene = { game = game, ns = ns, calls = calls, preview = { ok = true } }
  local callbacks = {}
  for _, name in ipairs({ "select", "give", "pseudo", "remove", "restore", "finish", "retry", "markReceived", "confirmObserved",
      "dismissObserved" }) do
    callbacks[name] = function(...) calls[#calls + 1] = { name = name, ... } end
  end
  callbacks.preview = function(...)
    calls[#calls + 1] = { name = "preview", ... }
    return scene.preview
  end
  scene.callbacks = callbacks
  scene.kit = ns.UI.Kit.new(options or {})
  scene.window = ns.UI.SessionWindow.new(scene.kit, callbacks)
  scene.parts = scene.window.parts
  scene.Sample = ns.UI.Sample
  return scene
end

local function near(actual, expected)
  if math.abs(actual - expected) > 0.001 then error("expected " .. expected .. ", got " .. tostring(actual), 2) end
end

local function text(scene, widget) return scene.game.state(widget).text end
local function shown(scene, widget) return scene.game.state(widget).shown end
local function enabled(scene, widget) return scene.game.state(widget).enabled ~= false end

test("a new window is open and empty: it says how items arrive, and nothing can be given", function()
  local scene = setup()
  is_true(scene.window.isShown())
  eq(#scene.parts.itemRows, 0)
  eq(text(scene, scene.parts.headInfo), "Items appear here when you loot as Master Looter.")
  eq(enabled(scene, scene.parts.giveButton), false)
  eq(enabled(scene, scene.parts.pickButton), false)
  eq(enabled(scene, scene.parts.finishButton), false)
  eq(shown(scene, scene.parts.banner), false)
end)

test("the items are one small line each, with the selected one marked and the given ones saying to whom", function()
  local scene = setup()
  scene.window.update(scene.Sample.session())
  local rows = scene.parts.itemRows
  eq(#rows, 5)
  eq(text(scene, scene.parts.progress), "2 of 5 awarded")
  for i, row in ipairs(rows) do
    eq(scene.game.state(row).height, 20)
    eq(scene.game.state(row).points[1].y, -(i - 1) * 20)
  end
  eq(text(scene, rows[1].name), "Blade of the Fixture")
  deep_eq(scene.game.state(rows[1].name).textColor, { 0.64, 0.21, 0.93 })
  deep_eq(scene.game.state(rows[2].name).textColor, { 0, 0.44, 0.87 })
  deep_eq(scene.game.state(rows[4].name).textColor, { 0.12, 1, 0 })
  eq(shown(scene, rows[1].selected), true)
  eq(shown(scene, rows[2].selected), false)
  eq(text(scene, rows[1].state), "")
  eq(text(scene, rows[3].state), "Tobin")
  eq(text(scene, rows[4].state), "Orrin")
  deep_eq(scene.game.state(rows[3].state).textColor, { 0.27, 1, 0.4 })
  eq(scene.game.state(rows[1].icon).backdropBorderColor[3], 0.93)
  eq(scene.game.state(rows[1].icon.art).texture, "Interface\\Icons\\INV_Sword_27")
end)

test("the selected item has a header and a priority list with one line per player, as tall as small name text", function()
  local scene = setup()
  scene.window.update(scene.Sample.session())
  eq(text(scene, scene.parts.headName), "Blade of the Fixture")
  eq(text(scene, scene.parts.headInfo), "Item level 70   From Grimtooth   Next in line: Garrick Vole")
  eq(text(scene, scene.parts.headInfo) ~= nil, true)
  eq(text(scene, scene.parts.noteLabel), "Note: Tanks first, then melee DPS")
  local rows = scene.parts.lineRows
  local shownRows = {}
  for _, row in ipairs(rows) do
    if shown(scene, row) then shownRows[#shownRows + 1] = row end
  end
  eq(#shownRows, 13) -- twelve players and the note that comes after the sixth
  for _, row in ipairs(shownRows) do eq(scene.game.state(row).height, 16) end
  eq(scene.game.state(shownRows[1].name).fontObject, "GameFontHighlightSmall")
  eq(text(scene, shownRows[1].pos), "1")
  eq(text(scene, shownRows[1].name), "Garrick Vole")
  eq(text(scene, shownRows[1].role), "Healer")
  eq(text(scene, shownRows[1].here), "here")
  deep_eq(scene.game.state(shownRows[1].name).textColor, { 1, 0.49, 0.04 }) -- a druid
  eq(text(scene, shownRows[2].here), "here")
  eq(text(scene, shownRows[3].here), "away")
  deep_eq(scene.game.state(shownRows[3].here).textColor, { 1, 0.62, 0.24 })
  eq(text(scene, shownRows[4].here), "received") -- the fourth line was awarded
  deep_eq(scene.game.state(shownRows[4].here).textColor, { 1, 0.82, 0 })
  eq(text(scene, shownRows[5].here), "offline")
  deep_eq(scene.game.state(shownRows[5].name).textColor, { 0.639, 0.604, 0.557 }) -- not eligible: gray
  eq(shown(scene, shownRows[7].span), true) -- the note line
  eq(text(scene, shownRows[7].span), "any warlock who didn't get the cloak")
  eq(shown(scene, shownRows[7].name), false)
  eq(shown(scene, shownRows[1].span), false)
end)

test("a block header shows only when the item has more than one priority block", function()
  local scene = setup()
  local vm = scene.Sample.session()
  vm.item.blocks = {
    { note = "First list", lines = { { kind = "char", pos = 1, name = "Jorren Ashvale", class = "Warrior", role = "Tank", here = "here" } } },
    { note = "", lines = { { kind = "char", pos = 1, name = "Mirelle Dunmore", class = "Priest", role = "Healer", here = "here" } } },
  }
  scene.window.update(vm)
  local rows = scene.parts.lineRows
  eq(text(scene, rows[1].span), "First list")
  eq(text(scene, rows[2].name), "Jorren Ashvale")
  eq(text(scene, rows[3].span), "Priority")
  eq(text(scene, rows[4].name), "Mirelle Dunmore")
  deep_eq(scene.game.state(rows[1].span).textColor, { 1, 0.82, 0 })
end)

test("a raid of 40 fits one line each and scrolls, and the list starts at the top for every item", function()
  local scene = setup()
  scene.window.update(scene.Sample.session({ lines = 40 }))
  local list = scene.parts.priorities
  eq(list.height, 41 * 16)
  is_true(list.view < list.height)
  eq(list.frame:GetVerticalScroll(), 0)
  scene.game.fire(list.frame, "OnMouseWheel", -1)
  eq(list.frame:GetVerticalScroll(), 48)
  scene.game.fire(list.frame, "OnMouseWheel", -1000)
  eq(list.frame:GetVerticalScroll(), list.height - list.view)
  scene.window.update(scene.Sample.session({ lines = 40, selected = 2 }))
  eq(list.frame:GetVerticalScroll(), 0)
  local visibleRows = math.floor(list.view / 16)
  is_true(visibleRows >= 17) -- a good part of the raid is in view without scrolling
end)

test("when the list gets shorter the rows are reused and the extra ones hidden", function()
  local scene = setup()
  scene.window.update(scene.Sample.session({ lines = 40 }))
  eq(#scene.parts.lineRows, 41)
  scene.window.update(scene.Sample.session({ lines = 3 }))
  eq(#scene.parts.lineRows, 41) -- not made again
  local count = 0
  for _, row in ipairs(scene.parts.lineRows) do
    if shown(scene, row) then count = count + 1 end
  end
  eq(count, 3)
  eq(scene.parts.priorities.height, 3 * 16)
  scene.window.update(scene.Sample.session({ lines = 40 }))
  eq(shown(scene, scene.parts.lineRows[41]), true)
end)

test("an item with no priority list says so, and an empty night asks to open the loot window", function()
  local scene = setup()
  local vm = scene.Sample.session()
  vm.item.blocks = {}
  scene.window.update(vm)
  local empty
  for _, region in ipairs(scene.game.state(scene.parts.priorities.content).regions) do
    if scene.game.state(region).text and string.find(scene.game.state(region).text, "No priority list", 1, true) then empty = region end
  end
  is_true(empty ~= nil)
  scene.window.update({ items = {} })
  eq(text(scene, scene.parts.headInfo), "Items appear here when you loot as Master Looter.")
  scene.window.update({ items = { { index = 1, name = "x", quality = 3, state = "open" } }, selected = nil })
  eq(text(scene, scene.parts.headInfo), "Pick an item on the left.")
end)

test("clicking an item calls select with its index, and its row hovers", function()
  local scene = setup()
  scene.window.update(scene.Sample.session())
  local row = scene.parts.itemRows[2]
  scene.game.fire(row, "OnMouseDown")
  deep_eq(scene.calls, { { name = "select", 2 } })
  eq(shown(scene, row.hover), false)
  scene.game.fire(row, "OnEnter")
  eq(shown(scene, row.hover), true)
  scene.game.fire(row, "OnLeave")
  eq(shown(scene, row.hover), false)
end)

test("clicking a player fills the recipient and marks the line; notes and unknown lines cannot be chosen", function()
  local scene = setup()
  scene.window.update(scene.Sample.session())
  local rows = scene.parts.lineRows
  scene.game.fire(rows[2], "OnMouseDown")
  eq(text(scene, scene.parts.recipient), "Lysa Thorne")
  deep_eq(scene.game.state(rows[2].bg).color, { 0.24, 0.19, 0.06, 1 })
  scene.game.fire(rows[3], "OnMouseDown")
  eq(text(scene, scene.parts.recipient), "Dessa Fenwick")
  deep_eq(scene.game.state(rows[2].bg).color, { 0.098, 0.09, 0.08, 1 })
  scene.game.fire(rows[7], "OnMouseDown") -- the note line
  eq(text(scene, scene.parts.recipient), "Dessa Fenwick")
  scene.game.fire(rows[3], "OnEnter")
  eq(shown(scene, rows[3].hover), true)
  scene.game.fire(rows[7], "OnEnter")
  eq(shown(scene, rows[7].hover), false)
  scene.game.fire(rows[3], "OnLeave")
  eq(shown(scene, rows[3].hover), false)
end)

test("Give without a recipient asks to pick one; with one it asks the engine to preview and then confirms", function()
  local scene = setup()
  scene.window.update(scene.Sample.session())
  scene.game.fire(scene.parts.giveButton, "OnClick")
  is_true(string.find(text(scene, scene.parts.bannerText), "Pick a player first.", 1, true) ~= nil)
  eq(shown(scene, scene.parts.banner), true)
  eq(#scene.calls, 0)
  eq(scene.window.confirm.isShown(), false)

  scene.game.fire(scene.parts.lineRows[2], "OnMouseDown")
  eq(shown(scene, scene.parts.banner), false) -- choosing a player clears the message
  scene.preview = { ok = true, recipient = "Lysa Thorne", warnings = { "Replaces the give to Orrin Vale." }, lines = { "Priority 2 of 12" } }
  scene.game.fire(scene.parts.giveButton, "OnClick")
  deep_eq(scene.calls, { { name = "preview", 1, "Lysa Thorne" } })
  local confirm = scene.window.confirm
  is_true(confirm.isShown())
  local parts = confirm.parts
  eq(text(scene, parts.itemLabel), "|cffa336edBlade of the Fixture|r")
  eq(text(scene, parts.recipientLabel), "to |cffc79c6eLysa Thorne|r")
  eq(text(scene, parts.extra[1]), "Replaces the give to Orrin Vale.")
  deep_eq(scene.game.state(parts.extra[1]).textColor, { 1, 0.62, 0.24 })
  eq(text(scene, parts.extra[2]), "Decision: council")
  eq(text(scene, parts.extra[3]), "Priority 2 of 12")
  eq(shown(scene, parts.extra[4]), false)
  eq(text(scene, parts.confirmButton), "Give")
end)

test("confirming gives with the decision and the note; cancelling or hiding gives nothing", function()
  local scene = setup()
  scene.window.update(scene.Sample.session())
  scene.game.fire(scene.parts.lineRows[2], "OnMouseDown")
  scene.parts.noteInput:SetText("  tank gear  ")
  scene.game.fire(scene.parts.checks[2], "OnClick") -- Roll
  scene.game.fire(scene.parts.giveButton, "OnClick")
  local parts = scene.window.confirm.parts
  eq(text(scene, parts.extra[1]), "Decision: roll   Note: tank gear")
  scene.game.fire(parts.confirmButton, "OnClick")
  eq(scene.window.confirm.isShown(), false)
  deep_eq(scene.calls[#scene.calls], { name = "give", 1, "Lysa Thorne", { decision = "roll", note = "tank gear" } })
  eq(#scene.calls, 2)

  scene.game.fire(scene.parts.giveButton, "OnClick")
  scene.game.fire(parts.cancelButton, "OnClick")
  eq(scene.window.confirm.isShown(), false)
  eq(#scene.calls, 3) -- another preview, no give
  scene.game.fire(scene.parts.giveButton, "OnClick")
  scene.window.confirm.hide()
  scene.game.fire(parts.confirmButton, "OnClick") -- a click after it was closed gives nothing
  eq(scene.calls[#scene.calls].name, "preview")
end)

test("a refused preview shows the reason and does not ask for a confirmation", function()
  local scene = setup()
  scene.window.update(scene.Sample.session())
  scene.game.fire(scene.parts.lineRows[5], "OnMouseDown")
  scene.preview = { ok = false, reason = "Jessa Larkin is not in the loot window." }
  scene.game.fire(scene.parts.giveButton, "OnClick")
  is_true(string.find(text(scene, scene.parts.bannerText), "Jessa Larkin is not in the loot window.", 1, true) ~= nil)
  eq(scene.window.confirm.isShown(), false)
  scene.preview = { ok = false }
  scene.game.fire(scene.parts.giveButton, "OnClick")
  is_true(string.find(text(scene, scene.parts.bannerText), "That player cannot get it.", 1, true) ~= nil)
  scene.window.update(scene.Sample.session({ selected = 2 })) -- another item: the message goes
  eq(shown(scene, scene.parts.banner), false)
end)

test("typing a name works too, and Enter in the box never gives", function()
  local scene = setup()
  scene.window.update(scene.Sample.session())
  scene.parts.recipient:SetText("  Zorn Quillby ")
  scene.game.fire(scene.parts.recipient, "OnEnterPressed")
  eq(#scene.calls, 0)
  eq(scene.window.confirm.isShown(), false)
  scene.game.fire(scene.parts.giveButton, "OnClick")
  deep_eq(scene.calls[1], { name = "preview", 1, "Zorn Quillby" })
end)

test("Pick opens the list of everyone who can get the item; typing narrows it; choosing fills the recipient", function()
  local scene = setup()
  scene.window.update(scene.Sample.session())
  scene.game.fire(scene.parts.pickButton, "OnClick")
  local picker = scene.window.picker
  is_true(picker.isShown())
  local rows = picker.parts.rows
  local function visibleRows()
    local list = {}
    for _, row in ipairs(rows) do
      if shown(scene, row) then list[#list + 1] = row end
    end
    return list
  end
  eq(#visibleRows(), 38) -- two of the 40 are not in the loot window
  eq(text(scene, rows[1].name), "Jorren Ashvale")
  eq(scene.game.state(rows[1]).height, 16)
  picker.parts.filter:SetText("ash")
  scene.game.fire(picker.parts.filter, "OnTextChanged")
  local names = {}
  for _, row in ipairs(visibleRows()) do names[#names + 1] = text(scene, row.name) end
  is_true(#names >= 2 and #names < 38)
  for _, name in ipairs(names) do is_true(string.find(string.lower(name), "ash", 1, true) ~= nil) end
  scene.game.fire(rows[1], "OnMouseDown")
  eq(picker.isShown(), false)
  eq(text(scene, scene.parts.recipient), names[1])
  scene.game.fire(scene.parts.pickButton, "OnClick")
  eq(text(scene, picker.parts.filter), "")
  eq(#visibleRows(), 38)
end)

test("the decision boxes are exclusive and start on council", function()
  local scene = setup()
  local checks = scene.parts.checks
  eq(#checks, 3)
  eq(checks[1]:GetChecked(), true)
  scene.game.fire(checks[3], "OnClick")
  eq(checks[1]:GetChecked(), false)
  eq(checks[2]:GetChecked(), false)
  eq(checks[3]:GetChecked(), true)
  scene.game.fire(checks[2], "OnClick")
  eq(checks[3]:GetChecked(), false)
  eq(checks[2]:GetChecked(), true)
end)

test("the buttons call what they are for", function()
  local scene = setup()
  scene.window.update(scene.Sample.session())
  scene.game.fire(scene.parts.disenchantButton, "OnClick")
  scene.game.fire(scene.parts.bankButton, "OnClick")
  scene.game.fire(scene.parts.removeButton, "OnClick")
  scene.game.fire(scene.parts.finishButton, "OnClick")
  deep_eq(scene.calls, { { name = "pseudo", 1, "disenchant" }, { name = "pseudo", 1, "guild-bank" }, { name = "remove", 1 }, { name = "finish" } })
  local vm = scene.Sample.session()
  vm.item.state = "removed"
  scene.window.update(vm)
  eq(text(scene, scene.parts.removeButton), "Restore")
  scene.game.fire(scene.parts.removeButton, "OnClick")
  deep_eq(scene.calls[#scene.calls], { name = "restore", 1 })
  scene.window.update(scene.Sample.session())
  eq(text(scene, scene.parts.removeButton), "Remove")
end)

test("while a give runs, or after the item was given, the buttons that give are off", function()
  local scene = setup()
  scene.window.update(scene.Sample.session({ busy = true }))
  for _, name in ipairs({ "giveButton", "pickButton", "disenchantButton", "bankButton", "removeButton", "finishButton" }) do
    eq(enabled(scene, scene.parts[name]), false)
  end
  scene.window.update(scene.Sample.session())
  for _, name in ipairs({ "giveButton", "pickButton", "disenchantButton", "bankButton", "removeButton", "finishButton" }) do
    eq(enabled(scene, scene.parts[name]), true)
  end
  scene.window.update(scene.Sample.session({ selected = 3 })) -- the ring was given to Tobin Ashvale
  eq(enabled(scene, scene.parts.giveButton), false)
  eq(enabled(scene, scene.parts.disenchantButton), false)
  eq(enabled(scene, scene.parts.removeButton), true)
  is_true(string.find(text(scene, scene.parts.headInfo), "Given to Tobin Ashvale", 1, true) ~= nil)
end)

test("a give the game did not confirm shows a banner with Retry and Mark received", function()
  local scene = setup()
  scene.window.update(scene.Sample.session())
  local view = scene.parts.priorities.view
  scene.window.update(scene.Sample.session({ attempt = { state = "unconfirmed", who = "Mirelle Dunmore" } }))
  eq(shown(scene, scene.parts.banner), true)
  local message = text(scene, scene.parts.bannerText)
  is_true(string.find(message, "Not confirmed.", 1, true) ~= nil)
  is_true(string.find(message, "Mirelle Dunmore", 1, true) ~= nil)
  eq(text(scene, scene.parts.bannerFirst), "Retry")
  eq(text(scene, scene.parts.bannerSecond), "Mark received")
  eq(shown(scene, scene.parts.bannerSecond), true)
  is_true(scene.parts.priorities.view < view) -- the list gives the banner its room
  scene.game.fire(scene.parts.bannerFirst, "OnClick")
  scene.game.fire(scene.parts.bannerSecond, "OnClick")
  deep_eq(scene.calls, { { name = "retry", 1, "Mirelle Dunmore" }, { name = "markReceived", 1, "Mirelle Dunmore" } })
  scene.window.update(scene.Sample.session())
  eq(shown(scene, scene.parts.banner), false)
  eq(scene.parts.priorities.view, view)
end)

test("a refused give offers Retry only, a give we did not start offers Record and Dismiss, a warning has no buttons", function()
  local scene = setup()
  scene.window.update(scene.Sample.session({ attempt = { state = "failed", who = "Orrin Vale", reason = "Inventory is full." } }))
  local message = text(scene, scene.parts.bannerText)
  is_true(string.find(message, "Could not give.", 1, true) ~= nil)
  is_true(string.find(message, "Inventory is full.", 1, true) ~= nil)
  eq(shown(scene, scene.parts.bannerFirst), true)
  eq(shown(scene, scene.parts.bannerSecond), false)

  scene.window.update(scene.Sample.session({ observed = { { id = "o1", who = "Garrick Vole", item = "Blade of the Fixture" } } }))
  message = text(scene, scene.parts.bannerText)
  is_true(string.find(message, "Garrick Vole received Blade of the Fixture", 1, true) ~= nil)
  eq(text(scene, scene.parts.bannerFirst), "Record")
  eq(text(scene, scene.parts.bannerSecond), "Dismiss")
  scene.game.fire(scene.parts.bannerFirst, "OnClick")
  scene.game.fire(scene.parts.bannerSecond, "OnClick")
  deep_eq(scene.calls, { { name = "confirmObserved", "o1" }, { name = "dismissObserved", "o1" } })

  scene.window.update(scene.Sample.session({ warnings = { "A roll for this item is still running." } }))
  message = text(scene, scene.parts.bannerText)
  is_true(string.find(message, "A roll for this item is still running.", 1, true) ~= nil)
  eq(shown(scene, scene.parts.bannerFirst), false)
  eq(shown(scene, scene.parts.bannerSecond), false)
end)

test("odd data never breaks the window: missing names, classes, roles, icons and qualities, very long names", function()
  local scene = setup()
  local long = string.rep("Longname", 8)
  scene.window.update({
    summary = nil,
    items = { { index = 1 }, { index = 2, name = long, quality = 99, state = "mystery" }, { index = 3, name = "x", state = "awarded" } },
    selected = 1,
    item = {
      index = 1, blocks = { { lines = { { kind = "char" }, { kind = "name", name = long }, { kind = "note" }, { kind = "header" },
        { kind = "char", name = "Zoe", class = 7, role = false, here = "mystery", awarded = true } } } },
      candidates = { { name = "Zoe" }, { name = long } }, attempt = { state = "unconfirmed" },
    },
    observed = { {} },
  })
  eq(text(scene, scene.parts.itemRows[1].name), "?")
  eq(text(scene, scene.parts.itemRows[3].state), "given") -- no recipient known
  scene.game.fire(scene.parts.pickButton, "OnClick")
  scene.window.picker.hide()
  scene.window.update({})
  scene.window.update(nil)
  eq(#scene.game.printed, 0)
end)

test("a callback that raises is reported, not raised, and the window carries on", function()
  local reported
  local scene = setup({ onError = function(message) reported = message end })
  scene.window.update(scene.Sample.session())
  scene.callbacks.select = function() error("select failed") end
  scene.game.fire(scene.parts.itemRows[2], "OnMouseDown")
  is_true(string.find(reported, "select failed", 1, true) ~= nil)
  scene.window.update(scene.Sample.session({ selected = 2 }))
  eq(text(scene, scene.parts.headName), "Cloak of the Mock")
end)

test("Escape closes the window and its popups; the popups start closed", function()
  local scene = setup()
  deep_eq(scene.game.env.UISpecialFrames, { "IntrepidManagerSession", "IntrepidManagerConfirm", "IntrepidManagerPicker" })
  eq(scene.window.confirm.isShown(), false)
  eq(scene.window.picker.isShown(), false)
  scene.window.toggle()
  eq(scene.window.isShown(), false)
  scene.window.show()
  is_true(scene.window.isShown())
end)

-- Every widget that is shown lies inside the window, text fits the box it was given, and no two controls overlap
-- (tests/support/intact.lua).
local function intact(scene)
  return Intact.problems(scene.game, scene.window.window.frame)
end

test("nothing sticks out, no text is wider than its box, no two controls overlap: compact, roomy, flat, with every banner", function()
  for _, options in ipairs({ {}, { density = "roomy" }, { chrome = "flat" }, { density = "roomy", chrome = "flat" } }) do
    local scene = setup(options)
    local states = {
      scene.Sample.session(), scene.Sample.session({ lines = 40 }), scene.Sample.session({ selected = 3 }),
      scene.Sample.session({ attempt = { state = "unconfirmed", who = "Mirelle Dunmore" } }),
      scene.Sample.session({ attempt = { state = "failed", who = "Orrin Vale", reason = "Inventory is full." } }),
      scene.Sample.session({ observed = { { id = "o1", who = "Garrick Vole", item = "Blade of the Fixture" } } }),
      scene.Sample.session({ warnings = { "A roll for this item is still running." } }),
      scene.Sample.session({ busy = true }),
      { items = {} }, -- an empty night
      { items = { { index = 1, name = "x", quality = 3, state = "open" } }, selected = 1,
        item = { index = 1, name = "x", quality = 3, state = "open", blocks = {} } }, -- no priority list
    }
    for index, vm in ipairs(states) do
      scene.window.update(vm)
      local problems = intact(scene)
      if #problems > 0 then
        error((options.density or "compact") .. " " .. (options.chrome or "stock") .. " state " .. index .. ": " .. table.concat(problems, "; "))
      end
    end
  end
end)

test("the compact window fits a priority list of a raid of 40 in a screen with room to spare", function()
  local scene = setup()
  scene.window.update(scene.Sample.session({ lines = 40 }))
  local rect = Layout.new(scene.game).rect(scene.window.window.frame)
  eq(rect.width, 680)
  eq(rect.height, 520)
  is_true(rect.height < 600)
  local roomy = setup({ density = "roomy" })
  roomy.window.update(roomy.Sample.session({ lines = 40 }))
  is_true(roomy.parts.priorities.view / 24 < scene.parts.priorities.view / 16) -- the roomy list shows fewer players
end)

local function rects(scene)
  return Layout.new(scene.game)
end

test("the recipient is what the game would be handed: the candidate name when there is one", function()
  local scene = setup()
  local vm = scene.Sample.session()
  vm.item.blocks[1].lines[2].candidate = "Lysa Thorne-Realm"
  vm.item.blocks[1].lines[3].candidate = nil
  scene.window.update(vm)
  scene.window.selectLine(2)
  eq(text(scene, scene.parts.recipient), "Lysa Thorne-Realm")
  scene.window.selectLine(3)
  eq(text(scene, scene.parts.recipient), "Dessa Fenwick")
end)

test("a row that showed a note shows a player again when the list changes, and the other way round", function()
  local scene = setup()
  scene.window.update(scene.Sample.session()) -- the seventh row is a note
  local row = scene.parts.lineRows[7]
  eq(shown(scene, row.span), true)
  eq(shown(scene, row.pos), false)
  eq(shown(scene, row.name), false)
  eq(shown(scene, row.role), false)
  eq(shown(scene, row.here), false)
  scene.window.update(scene.Sample.session({ lines = 5 })) -- no note among five lines, the seventh row is gone
  scene.window.update(scene.Sample.session({ lines = 12 }))
  eq(shown(scene, row.span), true)
  local plain = scene.Sample.session()
  plain.item.blocks[1].lines = {}
  for i = 1, 8 do plain.item.blocks[1].lines[i] = { kind = "char", pos = i, name = "Player " .. i, class = "Mage", role = "DPS", here = "here" } end
  scene.window.update(plain)
  eq(shown(scene, row.span), false)
  eq(shown(scene, row.pos), true)
  eq(shown(scene, row.name), true)
  eq(shown(scene, row.role), true)
  eq(shown(scene, row.here), true)
  eq(text(scene, row.name), "Player 7")
  eq(text(scene, row.span), "any warlock who didn't get the cloak") -- the old text is only hidden
end)

test("the Give button and the banner's first button are the red stock buttons, the others gray", function()
  local scene = setup()
  local function template(widget) return scene.game.state(widget).templates[1] end
  eq(template(scene.parts.giveButton), "UIPanelButtonTemplate")
  eq(template(scene.parts.bannerFirst), "UIPanelButtonTemplate")
  eq(template(scene.parts.bannerSecond), "UIPanelButtonGrayTemplate")
  eq(template(scene.parts.pickButton), "UIPanelButtonGrayTemplate")
  eq(template(scene.parts.removeButton), "UIPanelButtonGrayTemplate")
  eq(template(scene.window.confirm.parts.confirmButton), "UIPanelButtonTemplate")
  eq(template(scene.window.confirm.parts.cancelButton), "UIPanelButtonGrayTemplate")
end)

test("the empty-night message shows only without items, and rows come back when the list grows again", function()
  local scene = setup()
  eq(shown(scene, scene.parts.emptyItems), true)
  scene.window.update(scene.Sample.session())
  eq(shown(scene, scene.parts.emptyItems), false)
  for _, row in ipairs(scene.parts.itemRows) do eq(shown(scene, row), true) end
  local vm = scene.Sample.session()
  vm.items = { vm.items[1], vm.items[2] }
  scene.window.update(vm)
  eq(shown(scene, scene.parts.itemRows[1]), true)
  eq(shown(scene, scene.parts.itemRows[3]), false)
  eq(shown(scene, scene.parts.itemRows[5]), false)
  eq(scene.parts.itemList.height, 2 * 20)
  scene.window.update(scene.Sample.session())
  eq(shown(scene, scene.parts.itemRows[5]), true)
  eq(scene.parts.itemList.height, 5 * 20)
end)

test("after an item was shown, an empty night clears the header, the note and the icon", function()
  local scene = setup()
  scene.window.update(scene.Sample.session())
  eq(shown(scene, scene.parts.headIcon), true)
  scene.window.update({ items = {} })
  eq(text(scene, scene.parts.headName), "")
  eq(text(scene, scene.parts.noteLabel), "")
  eq(shown(scene, scene.parts.headIcon), false)
  eq(shown(scene, scene.parts.itemRows[1]), false)
  eq(text(scene, scene.parts.progress), "")
end)

test("the header takes the item's quality color and icon; choosing a line is forgotten when the list is shown again", function()
  local scene = setup()
  scene.window.update(scene.Sample.session())
  deep_eq(scene.game.state(scene.parts.headName).textColor, { 0.64, 0.21, 0.93 })
  deep_eq(scene.game.state(scene.parts.headIcon).backdropBorderColor, { 0.64, 0.21, 0.93, 1 })
  eq(scene.game.state(scene.parts.headIcon.art).texture, "Interface\\Icons\\INV_Sword_27")
  eq(scene.game.state(scene.parts.headName).fontObject, "GameFontNormal")
  scene.window.update(scene.Sample.session({ selected = 2 }))
  deep_eq(scene.game.state(scene.parts.headName).textColor, { 0, 0.44, 0.87 })
  eq(scene.game.state(scene.parts.headIcon.art).texture, "Interface\\Icons\\INV_Misc_Cape_18")
  scene.window.selectLine(2)
  deep_eq(scene.game.state(scene.parts.lineRows[2].bg).color, { 0.24, 0.19, 0.06, 1 })
  scene.window.update(scene.Sample.session({ selected = 2 }))
  deep_eq(scene.game.state(scene.parts.lineRows[2].bg).color, { 0.098, 0.09, 0.08, 1 })
end)

test("the banner says what happened in words, and the status line shows the engine's text", function()
  local scene = setup()
  scene.window.update(scene.Sample.session({ attempt = { state = "unconfirmed", who = "Mirelle Dunmore" } }))
  eq(text(scene, scene.parts.bannerText), "|cffff5952Not confirmed.|r The game did not say Mirelle Dunmore received it " ..
    "(a full bag is the usual reason). Ask them to free a slot, then press Retry.")
  scene.window.update(scene.Sample.session({ attempt = { state = "unconfirmed" } }))
  is_true(string.find(text(scene, scene.parts.bannerText), "did not say the recipient received it", 1, true) ~= nil)
  scene.window.update(scene.Sample.session({ observed = { { id = "o1", who = "Garrick Vole", item = "Blade" } } }))
  eq(text(scene, scene.parts.bannerText), "|cffffd100Seen:|r Garrick Vole received Blade and this window did not give it. Record it?")
  scene.window.update(scene.Sample.session({ observed = { { id = "o1" } } }))
  is_true(string.find(text(scene, scene.parts.bannerText), "someone received an item and this window", 1, true) ~= nil)
  eq(text(scene, scene.parts.status), "Last: Boots of the Hollow -> Orrin Vale: received (master loot)")
  local vm = scene.Sample.session()
  vm.status = nil
  scene.window.update(vm)
  eq(text(scene, scene.parts.status), "")
end)

test("a message from a click goes when the next click is Give with a typed name, and shows what the engine corrected", function()
  local scene = setup()
  scene.window.update(scene.Sample.session())
  scene.game.fire(scene.parts.giveButton, "OnClick")
  eq(shown(scene, scene.parts.banner), true)
  scene.parts.recipient:SetText("lysa thorne")
  scene.preview = { ok = true, recipient = "Lysa Thorne" }
  scene.game.fire(scene.parts.giveButton, "OnClick")
  eq(shown(scene, scene.parts.banner), false)
  eq(text(scene, scene.window.confirm.parts.recipientLabel), "to |cffefe9dfLysa Thorne|r") -- the engine's spelling, no class known
end)

test("the columns line up with their headings, rows are one line apart, and the list sits between the headings and the buttons", function()
  for _, options in ipairs({ {}, { density = "roomy" } }) do
    local scene = setup(options)
    scene.window.update(scene.Sample.session())
    local layout = rects(scene)
    local m = scene.kit.m
    local row = scene.parts.lineRows[1]
    local cells = { row.pos, row.name, row.role, row.here }
    for i, heading in ipairs(scene.parts.headings) do
      local a, b = layout.rect(heading), layout.rect(cells[i])
      near(a.left, b.left)
      near(a.width, b.width)
    end
    for i = 1, 5 do
      near(layout.rect(scene.parts.lineRows[i]).top, layout.rect(scene.parts.lineRows[1]).top - (i - 1) * m.row)
      near(layout.rect(scene.parts.lineRows[i]).height, m.row)
    end
    local list, give = layout.rect(scene.parts.priorities.frame), layout.rect(scene.parts.giveButton)
    is_true(layout.rect(scene.parts.headings[1]).bottom >= list.top - 1)
    is_true(list.bottom >= give.top)
    scene.window.update(scene.Sample.session({ attempt = { state = "unconfirmed", who = "x" } }))
    local banner = layout.rect(scene.parts.banner)
    local shrunk = rects(scene).rect(scene.parts.priorities.frame)
    is_true(banner.top <= shrunk.bottom + 0.5)
    is_true(banner.bottom >= give.top - 0.5)
  end
end)

test("the mouse works: every row, the list, and the window take it, and nothing is left for the game to ignore", function()
  local scene = setup()
  scene.window.update(scene.Sample.session({ lines = 40 }))
  scene.game.fire(scene.parts.pickButton, "OnClick")
  deep_eq(scene.game.audit(), {})
  for _, row in ipairs(scene.parts.itemRows) do eq(scene.game.state(row).mouse, true) end
  for _, row in ipairs(scene.parts.lineRows) do eq(scene.game.state(row).mouse, true) end
  eq(scene.game.state(scene.parts.priorities.frame).wheel, true)
  eq(scene.game.state(scene.parts.itemList.frame).wheel, true)
  eq(scene.game.state(scene.window.window.frame).mouse, true)
  for _, row in ipairs(scene.window.picker.parts.rows) do eq(scene.game.state(row).mouse, true) end
end)

test("the banner's text starts at its left edge, stays clear of its buttons and starts at the top", function()
  for _, options in ipairs({ {}, { density = "roomy" } }) do
    local scene = setup(options)
    scene.window.update(scene.Sample.session({ attempt = { state = "unconfirmed", who = "Mirelle Dunmore" } }))
    local layout = rects(scene)
    local banner, message = layout.rect(scene.parts.banner), layout.rect(scene.parts.bannerText)
    near(message.left, banner.left + 8)
    near(message.top, banner.top - 4)
    is_true(message.right <= layout.rect(scene.parts.bannerFirst).left)
    is_true(message.bottom >= banner.bottom - 0.5)
    eq(scene.game.state(scene.parts.bannerText).justifyV, "TOP")
    is_true(scene.game.state(scene.parts.bannerText).wordWrap ~= false) -- the banner's words wrap
    is_true(layout.text(scene.parts.bannerText).height <= message.height + 0.5) -- the words fit the room they have
  end
end)
