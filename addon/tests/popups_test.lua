-- The confirmation (IntrepidManager/ui/Confirm.lua) and the player picker (IntrepidManager/ui/Picker.lua), on their own.
-- Invented names only.

local UI = dofile("tests/support/strict_ui.lua")
local StockTemplates = dofile("tests/support/stock_templates.lua")
local Layout = dofile("tests/support/layout.lua")

local function setup(options)
  local game = StockTemplates.install(UI.new())
  local ns = {}
  for _, file in ipairs({ "core/Names", "ui/Kit", "ui/Confirm", "ui/Picker" }) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
  local kit = ns.UI.Kit.new(options or {})
  return game, ns, kit
end

local function text(game, widget) return game.state(widget).text end

---------------------------------------------------------------------------------------------------------------
-- Confirm
---------------------------------------------------------------------------------------------------------------

test("the confirmation starts closed, is a dialog above the rest, and is closed by Escape", function()
  local game, ns, kit = setup()
  local confirm = ns.UI.Confirm.new(kit)
  eq(confirm.isShown(), false)
  eq(game.state(confirm.window.frame).strata, "FULLSCREEN_DIALOG")
  eq(game.state(confirm.window.title).text, "Give this item?")
  deep_eq(game.env.UISpecialFrames, { "IntrepidManagerConfirm" })
  deep_eq(game.audit(), {})
end)

test("asking shows the item, the recipient, the warnings first and then the other lines, in their colors", function()
  local game, ns, kit = setup()
  local confirm = ns.UI.Confirm.new(kit)
  confirm.ask({
    item = "|cffa335eeBlade|r", quality = 4, icon = "Interface\\Icons\\INV_Sword_27", recipient = "Lysa",
    warnings = { "Replaces the give to Orrin." }, lines = { "Decision: council", "Priority 2 of 12" },
  }, function() end)
  is_true(confirm.isShown())
  local parts = confirm.parts
  eq(text(game, parts.itemLabel), "|cffa335eeBlade|r")
  eq(text(game, parts.recipientLabel), "to Lysa")
  eq(text(game, parts.extra[1]), "Replaces the give to Orrin.")
  deep_eq(game.state(parts.extra[1]).textColor, { 1, 0.62, 0.24 })
  eq(text(game, parts.extra[2]), "Decision: council")
  deep_eq(game.state(parts.extra[2]).textColor, { 0.639, 0.604, 0.557 })
  eq(text(game, parts.extra[3]), "Priority 2 of 12")
  eq(game.state(parts.extra[4]).shown, false)
  deep_eq(game.state(parts.icon).backdropBorderColor, { 0.64, 0.21, 0.93, 1 })
  eq(game.state(parts.icon.art).texture, "Interface\\Icons\\INV_Sword_27")
  eq(text(game, parts.confirmButton), "Give")
  confirm.ask({ item = "x", recipient = "y", confirm = "Give anyway" }, function() end)
  eq(text(game, parts.confirmButton), "Give anyway")
  confirm.ask({ item = "x" }, function() end)
  eq(text(game, parts.recipientLabel), "to ?")
end)

test("asking again repositions the lines and buttons: lines come back, nothing piles up, the dialog follows their number", function()
  local game, ns, kit = setup()
  local confirm = ns.UI.Confirm.new(kit)
  local parts = confirm.parts
  confirm.ask({ item = "x", recipient = "y", lines = { "a" } }, function() end)
  local oneLine = game.state(confirm.window.frame).height
  confirm.ask({ item = "x", recipient = "y", lines = { "a", "b", "c" } }, function() end)
  local threeLines = game.state(confirm.window.frame).height
  is_true(threeLines > oneLine)
  eq(threeLines - oneLine, 2 * kit.m.header)
  for i = 1, 3 do eq(game.state(parts.extra[i]).shown, true) end
  eq(game.state(parts.extra[4]).shown, false)
  confirm.ask({ item = "x", recipient = "y", lines = { "a" } }, function() end)
  eq(game.state(confirm.window.frame).height, oneLine)
  eq(game.state(parts.extra[2]).shown, false)
  confirm.ask({ item = "x", recipient = "y", lines = { "a", "b" } }, function() end)
  eq(game.state(parts.extra[2]).shown, true) -- shown again after it was hidden
  eq(#game.state(parts.extra[1]).points, 1)
  eq(#game.state(parts.confirmButton).points, 1)
  eq(#game.state(parts.cancelButton).points, 1)
  local lines = {}
  for i = 1, 10 do lines[i] = "line " .. i end
  confirm.ask({ item = "x", recipient = "y", lines = lines }, function() end)
  eq(game.state(parts.extra[8]).shown, true)
  eq(#parts.extra, 8) -- no more than eight lines are kept
  eq(text(game, parts.extra[8]), "line 8")
end)

test("the confirm button calls back once and closes; cancel and closing forget the callback", function()
  local game, ns, kit = setup()
  local confirm = ns.UI.Confirm.new(kit)
  local parts = confirm.parts
  local given = 0
  confirm.ask({ item = "x", recipient = "y" }, function() given = given + 1 end)
  game.fire(parts.confirmButton, "OnClick")
  eq(given, 1)
  eq(confirm.isShown(), false)
  game.fire(parts.confirmButton, "OnClick")
  eq(given, 1) -- a second click gives nothing
  confirm.ask({ item = "x", recipient = "y" }, function() given = given + 1 end)
  game.fire(parts.cancelButton, "OnClick")
  eq(confirm.isShown(), false)
  game.fire(parts.confirmButton, "OnClick")
  eq(given, 1)
  confirm.ask({ item = "x", recipient = "y" }, function() given = given + 1 end)
  confirm.hide() -- Escape, or the window being closed
  game.fire(parts.confirmButton, "OnClick")
  eq(given, 1)
  confirm.ask({ item = "x", recipient = "y" }, function() error("failed") end)
  game.fire(parts.confirmButton, "OnClick") -- a failing callback is reported, not raised
  eq(#game.printed, 1)
  is_true(string.find(game.printed[1], "failed", 1, true) ~= nil)
end)

test("Enter does nothing in the confirmation: no frame of it reacts to it", function()
  local game, ns, kit = setup()
  local confirm = ns.UI.Confirm.new(kit)
  confirm.ask({ item = "x", recipient = "y" }, function() end)
  for _, frame in ipairs(game.frames) do
    eq(game.state(frame).scripts.OnEnterPressed, nil)
    eq(game.state(frame).scripts.OnKeyDown, nil)
  end
  eq(game.counts.SetPropagateKeyboardInput, nil)
end)

test("the confirmation fits its dialog in both densities, with and without lines", function()
  for _, options in ipairs({ {}, { density = "roomy" } }) do
    local game, ns, kit = setup(options)
    local confirm = ns.UI.Confirm.new(kit)
    for _, count in ipairs({ 0, 1, 4, 8 }) do
      local lines = {}
      for i = 1, count do lines[i] = "A line of text that is not too long " .. i end
      confirm.ask({ item = "|cffa335eeBlade of the Fixture|r", recipient = "Lysa Thorne", lines = lines, quality = 4 }, function() end)
      local layout = Layout.new(game)
      local frame = layout.rect(confirm.window.frame)
      local give, cancel = layout.rect(confirm.parts.confirmButton), layout.rect(confirm.parts.cancelButton)
      is_true(give.left >= frame.left and cancel.right <= frame.right)
      is_true(give.bottom >= frame.bottom and cancel.bottom >= frame.bottom)
      is_true(give.right <= cancel.left) -- side by side, not over each other
      for i = 1, count do
        local line = layout.rect(confirm.parts.extra[i])
        is_true(line.bottom >= give.top - 0.5) -- every line is above the buttons
        is_true(layout.text(confirm.parts.extra[i]).width <= line.width + 0.5)
      end
      eq(#layout.warnings, 0)
      eq(#game.audit(), 0)
    end
  end
end)

---------------------------------------------------------------------------------------------------------------
-- Picker
---------------------------------------------------------------------------------------------------------------

local ENTRIES = {
  { name = "Jorren Ashvale", class = "Warrior", role = "Tank" }, { name = "Mirelle Dunmore", class = "Priest", role = "Healer" },
  { name = "Tobin Ashvale", class = "Mage" }, { name = "Garrick Vole", class = "Rogue", role = "Melee" },
  { name = "Zoe-Ann Quillby" }, { name = "A.B. Marrow", class = "Druid", role = "Healer" },
}

local function visibleRows(game, picker)
  local list = {}
  for _, row in ipairs(picker.parts.rows) do
    if game.state(row).shown then list[#list + 1] = row end
  end
  return list
end

test("the picker starts closed, is Escape-closable, and lists everyone one to a line in their class color", function()
  local game, ns, kit = setup()
  local picker = ns.UI.Picker.new(kit)
  eq(picker.isShown(), false)
  deep_eq(game.env.UISpecialFrames, { "IntrepidManagerPicker" })
  picker.open(ENTRIES, function() end)
  is_true(picker.isShown())
  local rows = visibleRows(game, picker)
  eq(#rows, 6)
  for i, row in ipairs(rows) do
    eq(game.state(row).height, 16)
    eq(game.state(row).points[1].y, -(i - 1) * 16)
  end
  eq(text(game, rows[1].name), "Jorren Ashvale")
  deep_eq(game.state(rows[1].name).textColor, { 0.78, 0.61, 0.43 })
  eq(text(game, rows[1].role), "Tank")
  eq(text(game, rows[3].role), "") -- no role given
  deep_eq(game.state(rows[5].name).textColor, { 0.937, 0.914, 0.875 }) -- no class given: the plain text color
  deep_eq(game.state(rows[1].bg).color, { 0.082, 0.075, 0.067, 1 })
  deep_eq(game.state(rows[2].bg).color, { 0.098, 0.09, 0.08, 1 })
  eq(picker.parts.list.height, 6 * 16)
  eq(picker.parts.filter:HasFocus(), true)
  deep_eq(game.audit(), {})
  local find
  for _, region in ipairs(game.state(picker.window.body).regions) do
    if game.state(region).text == "Find:" then find = region end
  end
  is_true(find ~= nil) -- the box has its label
end)

test("typing narrows the list in any capitalization, matches the letters typed and not patterns, and starts again at the top", function()
  local game, ns, kit = setup()
  local picker = ns.UI.Picker.new(kit)
  picker.open(ENTRIES, function() end)
  local function type_(filter)
    picker.parts.filter:SetText(filter)
    game.fire(picker.parts.filter, "OnTextChanged")
    local names = {}
    for _, row in ipairs(visibleRows(game, picker)) do names[#names + 1] = text(game, row.name) end
    return names
  end
  deep_eq(type_("ASH"), { "Jorren Ashvale", "Tobin Ashvale" })
  deep_eq(type_("  ash  "), { "Jorren Ashvale", "Tobin Ashvale" })
  deep_eq(type_("vole"), { "Garrick Vole" })
  deep_eq(type_("."), { "A.B. Marrow" }) -- a dot is a dot, not any letter
  deep_eq(type_("-"), { "Zoe-Ann Quillby" })
  deep_eq(type_("zzz"), {})
  eq(picker.parts.list.height, 1)
  eq(#type_(""), 6)
  eq(picker.parts.list.height, 6 * 16)
  local many = {}
  for i = 1, 40 do many[i] = { name = "Player " .. i } end
  picker.open(many, function() end)
  picker.parts.list.scrollTo(100)
  eq(picker.parts.list.frame:GetVerticalScroll(), 100)
  eq(#type_("player"), 40) -- still too long for the window, but the list starts again at the top
  eq(picker.parts.list.frame:GetVerticalScroll(), 0)
end)

test("choosing a name closes the picker and hands the entry on; opening again starts clean", function()
  local game, ns, kit = setup()
  local picker = ns.UI.Picker.new(kit)
  local chosen = {}
  picker.open(ENTRIES, function(entry) chosen[#chosen + 1] = entry.name end)
  game.fire(visibleRows(game, picker)[4], "OnMouseDown")
  deep_eq(chosen, { "Garrick Vole" })
  eq(picker.isShown(), false)
  picker.parts.filter:SetText("ash")
  picker.open(ENTRIES, function(entry) chosen[#chosen + 1] = entry.name end)
  eq(text(game, picker.parts.filter), "")
  eq(#visibleRows(game, picker), 6)
  picker.open({}, nil) -- nothing to show, and no callback: a click does nothing
  eq(#visibleRows(game, picker), 0)
  picker.open(ENTRIES, nil)
  game.fire(visibleRows(game, picker)[1], "OnMouseDown")
  eq(#chosen, 1)
  picker.open(nil, nil)
  eq(#visibleRows(game, picker), 0)
end)

test("the picker shows 14 lines in the compact window and 12 in the roomy one, and fits its dialog", function()
  for _, case in ipairs({ { {}, 14, 16 }, { { density = "roomy" }, 12, 24 } }) do
    local game, ns, kit = setup(case[1])
    local picker = ns.UI.Picker.new(kit)
    local entries = {}
    for i = 1, 40 do entries[i] = { name = "Player " .. i, class = "Mage", role = "DPS" } end
    picker.open(entries, function() end)
    eq(picker.parts.list.view, case[2] * case[3])
    eq(picker.parts.list.height, 40 * case[3])
    local layout = Layout.new(game)
    local frame, list = layout.rect(picker.window.frame), layout.rect(picker.parts.list.frame)
    is_true(list.bottom >= frame.bottom + 4) -- the list is inside the frame, with room under it
    is_true(list.left >= frame.left and list.right <= frame.right)
    local filter = layout.rect(picker.parts.filter)
    is_true(filter.bottom >= list.top - 0.5)
    eq(#layout.warnings, 0)
    eq(#game.audit(), 0)
  end
end)
