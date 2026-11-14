-- /im facts (IntrepidManager/ui/Facts.lua) on the strict stand-in widgets. The stand-ins answer for the game here, so these
-- tests are about the module: that it asks the right things, keeps what a saved file can hold, survives what the game
-- refuses, never takes the keyboard, and finishes. What the real game answers is what the run in the beta is for.

local UI = dofile("tests/support/strict_ui.lua")
local StockTemplates = dofile("tests/support/stock_templates.lua")

local fullKnown = UI.full_known

local function setup(options)
  options = options or {}
  local game = StockTemplates.install(UI.new({ known = options.known or fullKnown(), setTextFires = options.setTextFires }))
  local ns = {}
  game.load("IntrepidManager/ui/Facts.lua", ns)
  return game, ns.UI.Facts
end

-- Run the module and let time pass until everything that waits has run. Returns the result and how often `done` ran.
local function run(game, facts, options)
  local done = 0
  options = options or {}
  options.done = function() done = done + 1 end
  local result = facts.run(options)
  game.advance(5)
  return result, done
end

local function contains(text, word)
  return string.find(" " .. text .. " ", " " .. word .. " ", 1, true) ~= nil
end

local function count(list)
  local n = 0
  for _ in pairs(list) do n = n + 1 end
  return n
end

test("call gives the results of a method, and the reason when there is none or it raises", function()
  local game, facts = setup()
  local call = facts.helpers.call
  local frame = game.env.CreateFrame("Frame")
  frame:SetSize(30, 40)
  local size = call(frame, "GetSize")
  eq(size.n, 2)
  eq(size[1], 30)
  eq(size[2], 40)
  local none, why = call(frame, "NoSuchMethod")
  eq(none, nil)
  is_true(string.find(why, "NoSuchMethod", 1, true) ~= nil) -- the stand-in refuses a name that is not on its list, a real widget has no such method
  local raising = { Break = function() error("boom") end }
  local result, reason = call(raising, "Break")
  eq(result, nil)
  is_true(string.find(reason, "boom", 1, true) ~= nil)
  eq(call({ Nothing = function() end }, "Nothing").n, 0)
end)

test("plain keeps what a saved file can hold: numbers to two decimals, short strings, booleans", function()
  local _, facts = setup()
  local plain = facts.helpers.plain
  eq(plain(1.23456), 1.23)
  eq(plain(-0.004), 0)
  eq(plain("abc"), "abc")
  eq(#plain(string.rep("x", 200)), 80)
  eq(plain(true), true)
  eq(plain(false), false)
  eq(plain(nil), nil)
  eq(plain({}), nil)
  eq(plain(print), nil)
  eq(plain(0 / 0), nil)
  eq(plain(math.huge), nil)
  eq(plain(-math.huge), nil)
end)

test("anchors say what a widget is tied to: its parent, the screen, or a named sibling", function()
  local game, facts = setup()
  local parent = game.env.CreateFrame("Frame", "FactsParent")
  parent:SetSize(100, 100)
  parent:SetPoint("CENTER")
  local sibling = game.env.CreateFrame("Frame", "FactsSibling", parent)
  local child = game.env.CreateFrame("Frame", nil, parent)
  child:SetPoint("TOPLEFT", 10, -20)
  child:SetPoint("BOTTOMRIGHT", sibling, "TOPRIGHT", 3.456, 0)
  deep_eq(facts.helpers.anchors(child, parent), { { "TOPLEFT", "parent", "TOPLEFT", 10, -20 }, { "BOTTOMRIGHT", "FactsSibling", "TOPRIGHT", 3.46, 0 } })
  deep_eq(facts.helpers.anchors(parent, game.env.UIParent), { { "CENTER", "parent", "CENTER", 0, 0 } })
  local lone = game.env.CreateFrame("Frame", nil, parent)
  lone:SetPoint("TOP", game.env.UIParent, "BOTTOM", 0, 0)
  deep_eq(facts.helpers.anchors(lone, parent), { { "TOP", "UIParent", "BOTTOM", 0, 0 } })
  deep_eq(facts.helpers.anchors(game.env.CreateFrame("Frame"), parent), {})
end)

test("describe walks a widget: its kind, size, text and anchors, and its children and regions to the depth asked", function()
  local game, facts = setup()
  local window = game.env.CreateFrame("Frame", nil, nil, "BasicFrameTemplateWithInset")
  window:SetSize(300, 200)
  window:SetPoint("CENTER")
  local label = window:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  label:SetText("Hello")
  label:SetPoint("TOPLEFT", 8, -30)
  local info = facts.helpers.describe(window, 2, game.env.UIParent)
  eq(info.type, "Frame")
  eq(info.width, 300)
  eq(info.height, 200)
  deep_eq(info.anchors, { { "CENTER", "parent", "CENTER", 0, 0 } })
  eq(#info.children, 1) -- the close button the stock template made
  eq(#info.regions, 4) -- its background, title text and inset textures, and the label
  eq(info.regions[4].text, "Hello")
  deep_eq(info.regions[4].anchors, { { "TOPLEFT", "parent", "TOPLEFT", 8, -30 } })
  eq(info.children[1].type, "Button")
  deep_eq(info.children[1].anchors, { { "TOPRIGHT", "parent", "TOPRIGHT", 0, 3 } })
  deep_eq(info.children[1].children, {}) -- two levels were asked for, so the close button has lists of its own (empty ones)
  local shallow = facts.helpers.describe(window, 0, game.env.UIParent)
  eq(shallow.children, nil)
  eq(shallow.regions, nil)
end)

test("parts lists the named parts a template gave a frame, one level deep", function()
  local game, facts = setup()
  local window = game.env.CreateFrame("Frame", nil, nil, "BasicFrameTemplateWithInset")
  local found = facts.helpers.parts(window)
  eq(count(found), 4)
  eq(found.TitleText.type, "FontString")
  eq(found.CloseButton.type, "Button")
  eq(found.Bg.type, "Texture")
  eq(found.InsetBg.type, "Texture")
  deep_eq(found.InsetBg.anchors, { { "TOPLEFT", "parent", "TOPLEFT", 4, -24 }, { "BOTTOMRIGHT", "parent", "BOTTOMRIGHT", -6, 4 } })
  eq(found.InsetBg.children, nil)
  window.NotAWidget = { 1, 2, 3 }
  window.number = 5
  eq(count(facts.helpers.parts(window)), 4)
end)

test("methodNames lists the methods of a widget's type when the metatable shows them, and says nothing when it does not", function()
  local _, facts = setup()
  local names = facts.helpers.methodNames
  deep_eq(names(setmetatable({}, { __index = { Show = function() end, SetPoint = function() end, count = 5, [1] = print } })), { "SetPoint", "Show" })
  eq(names(setmetatable({}, { __index = function() end })), nil)
  eq(names(setmetatable({}, { __metatable = "locked" })), nil)
  eq(names({}), nil)
  eq(names(5), nil)
end)

test("the run covers every section and finishes once, after the parts that wait", function()
  local game, facts = setup()
  local done = 0
  local result = facts.run({ done = function() done = done + 1 end })
  eq(done, 0)
  eq(result.done, nil)
  game.advance(0.1)
  eq(done, 0)
  game.advance(5)
  eq(done, 1)
  eq(result.done, true)
  eq(#result.notes, 0)
  eq(#game.timers, 0)
  for _, section in ipairs({ "client", "methods", "fonts", "templates", "edit", "timer" }) do is_true(result[section] ~= nil) end
  eq(count(result.methods), 11)
  eq(count(result.fonts), 8)
  eq(count(result.templates), 11)
  eq(#result.edit.steps, 5)
end)

test("the widget types are listed by name when the game shows them, and checked against a short list when it does not", function()
  local game, facts = setup()
  local result = run(game, facts)
  local edit = result.methods.EditBox
  eq(edit.listed, false)
  eq(edit.names, nil)
  is_true(contains(edit.curatedPresent, "SetFocus"))
  is_true(contains(edit.curatedPresent, "SetFontObject"))
  is_true(contains(edit.curatedPresent, "GetNumLetters")) -- both are methods of the game's edit box (measured)
  is_true(contains(edit.curatedMissing, "SetColorTexture")) -- a method of a texture, not of an edit box
  is_true(contains(edit.curatedMissing, "GetStringWidth"))
  local listing, listingFacts = setup()
  listing.env.getmetatable = function() return { __index = { Beta = function() end, Alpha = function() end, Gamma = 1 } } end
  local listed = run(listing, listingFacts)
  eq(listed.methods.Button.listed, true)
  eq(listed.methods.Button.count, 2)
  eq(listed.methods.Button.names, "Alpha Beta")
end)

test("every font object is measured: a line, a wrapped text, the sample strings and 95 character widths", function()
  local game, facts = setup()
  local result = run(game, facts)
  local small = result.fonts.GameFontHighlightSmall
  eq(#small.chars, 95)
  eq(small.lineHeight, 10.12) -- what the game measured for this font, which the stand-ins answer with
  eq(#small.samples, 18)
  eq(small.samples[1][1], "M")
  is_true(small.samples[1][2] > 0)
  eq(small.wrapped[1], 120)
  is_true(small.wrapped[2] >= small.lineHeight * 2)
  -- the space is measured between two letters, since a lone one may count for nothing
  is_true(small.chars[1] > 0)
  is_true(small.chars[("W"):byte() - 31] > small.chars[("i"):byte() - 31])
end)

test("a character's advance is measured in a line of that character, a pipe as two pipes, a space between two letters", function()
  local game, facts = setup()
  local result = run(game, facts)
  local small = result.fonts.GameFontHighlightSmall
  eq(#small.advances, 95)
  local function advance(char) return small.advances[char:byte() - 31] end
  is_true(advance("W") > advance("i"))
  is_true(advance(" ") > 0)
  is_true(advance("|") > 0 and advance("|") < advance("W")) -- two pipes make one: measured with 32, not 16
  -- in the stand-ins a line of sixteen "i" is sixteen times the estimate for one, so the advance is that estimate
  is_true(math.abs(advance("i") - game.text_width("i", 10)) < 0.01)
  for _, value in ipairs(small.advances) do is_true(type(value) == "number") end
end)

test("a font object the game lacks is marked missing, and the others are still measured", function()
  local known = fullKnown()
  known.present.fonts.NumberFontNormal = nil
  local game, facts = setup({ known = known })
  local result = run(game, facts)
  eq(result.fonts.NumberFontNormal.missing, true)
  is_true(result.fonts.GameFontNormal.chars ~= nil)
  eq(#result.notes, 0)
end)

test("a template the game refuses is a note on that template, and the others are still measured", function()
  local known = fullKnown()
  known.present.templates.UIPanelButtonGrayTemplate = nil
  local game, facts = setup({ known = known })
  local result = run(game, facts)
  is_true(string.find(result.templates["Button + UIPanelButtonGrayTemplate"].error, "UIPanelButtonGrayTemplate", 1, true) ~= nil)
  eq(result.templates["Button + UIPanelButtonTemplate"].error, nil)
  eq(result.templates["Button + UIPanelButtonTemplate"].type, "Button")
  eq(#result.notes, 0)
end)

test("the templates are measured with their default sizes, their parts and their regions", function()
  local game, facts = setup()
  local result = run(game, facts)
  local window = result.templates["Frame + BasicFrameTemplateWithInset"]
  eq(window.defaultWidth, 0)
  eq(window.width, 300) -- a frame with no size of its own was given one, so that its parts have something to lay out in
  eq(window.parts.CloseButton.type, "Button")
  eq(#window.children, 1)
  local button = result.templates["Button + UIPanelButtonTemplate"]
  eq(button.defaultWidth, 40)
  eq(button.defaultHeight, 22)
  eq(button.width, 40)
  eq(result.templates["Frame + BasicFrameTemplate"].parts.Inset, nil)
end)

test("the edit box test records what the game does for each length: what was kept, how big the box is, which events ran", function()
  for _, fires in ipairs({ false, true }) do
    local game, facts = setup({ setTextFires = fires })
    local result = run(game, facts)
    local steps = result.edit.steps
    deep_eq({ steps[1].chars, steps[2].chars, steps[3].chars, steps[4].chars, steps[5].chars }, { 0, 100, 1000, 5000, 20000 })
    for _, step in ipairs(steps) do
      eq(step.kept, step.chars)
      eq(step.width, 374)
      deep_eq(step.events, fires and { "set" } or {})
    end
    eq(result.edit.defaultLimit.kept, 1000)
    deep_eq(result.edit.stockBoxSetText, fires and { "set" } or {})
  end
end)

test("the stand-in game never has an edit box left that could take the keyboard, and every frame the run made is hidden again", function()
  local game, facts = setup()
  run(game, facts)
  local boxes = 0
  for index, frame in ipairs(game.frames) do
    local state = game.state(frame)
    if state.kind == "EditBox" then
      boxes = boxes + 1
      eq(state.autoFocus, false)
      eq(frame:HasFocus(), false)
    end
    if index > 1 then eq(game.visible(frame), false) end
  end
  is_true(boxes >= 5)
end)

test("the windows given to the run are measured: each label's text, its box and how wide the text is", function()
  local game, facts = setup()
  local window = game.env.CreateFrame("Frame")
  window:SetSize(200, 100)
  window:SetPoint("CENTER")
  local title = window:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  title:SetPoint("TOPLEFT", 4, -4)
  title:SetWidth(120)
  title:SetText("Intrepid Manager")
  local empty = window:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  empty:SetPoint("TOPLEFT", 4, -30)
  local inner = game.env.CreateFrame("Frame", nil, window)
  inner:SetPoint("TOPLEFT", 4, -50)
  inner:SetSize(100, 20)
  local deeper = inner:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  deeper:SetWidth(60)
  deeper:SetPoint("TOPLEFT")
  deeper:SetText("Blade of the Fixture")
  local result = run(game, facts, { windows = { demo = window } })
  local labels = result.windows.demo.labels
  eq(#labels, 2)
  eq(labels[1].text, "Intrepid Manager")
  eq(labels[1].box, 120)
  is_true(labels[1].width > 0 and labels[1].width < 120)
  eq(labels[1].size, 12)
  eq(labels[2].text, "Blade of the Fixture")
  eq(labels[1].owner, "Frame") -- what a label is written on, and how big that is
  eq(labels[1].ownerWidth, 200)
  eq(labels[2].ownerWidth, 100)
  eq(result.windows.demo.width, 200)
  eq(result.windows.demo.shown, true)
  eq(count(result.windows), 1)
end)

test("the clock is checked: a timer for 0.3 seconds is asked for and the time that passed is recorded", function()
  local game, facts = setup()
  local result = run(game, facts)
  eq(result.timer.asked, 0.3)
  eq(result.timer.got, 0.3)
  eq(result.client.time, 1796866200)
  eq(result.client.serverTime, 1796866200)
  deep_eq({ result.client.uiParent.width, result.client.uiParent.height }, { 1920, 1080 })
  game.env.GetBuildInfo = function() return "1.60.1", "70425", "Oct 15 2026", 16001 end
  game.env.GetLocale = function() return "enUS" end
  game.env.GetPhysicalScreenSize = function() return 2560, 1440 end
  local again = run(game, facts)
  deep_eq(again.client.client, { "1.60.1", "70425", "Oct 15 2026", 16001 })
  eq(again.client.locale, "enUS")
  deep_eq(again.client.physicalScreen, { 2560, 1440 })
end)

test("a section that raises is a note, and the run goes on and finishes", function()
  local game, facts = setup()
  game.env.UIParent = nil -- the parts that need a parent frame cannot work
  local result, done = run(game, facts)
  eq(done, 1)
  is_true(#result.notes >= 1)
  is_true(result.client ~= nil and result.timer ~= nil)
  for _, note in ipairs(result.notes) do is_true(type(note) == "string") end
end)

test("with no C_Timer the waiting parts become notes, and the run still finishes", function()
  local game, facts = setup()
  game.env.C_Timer = nil
  local done = 0
  local result = facts.run({ done = function() done = done + 1 end })
  eq(done, 1)
  eq(result.done, true)
  is_true(#result.notes >= 3)
  is_true(string.find(result.notes[1], "C_Timer", 1, true) ~= nil)
end)

local function plainTree(value, seen, path)
  local kind = type(value)
  if kind == "number" then
    if value ~= value or value == math.huge or value == -math.huge then error(path .. " is not a number a file can hold") end
  elseif kind == "table" then
    if seen[value] then error(path .. " is a table reached twice") end
    seen[value] = true
    for key, item in pairs(value) do
      if type(key) ~= "string" and type(key) ~= "number" then error(path .. " has a key that is a " .. type(key)) end
      plainTree(item, seen, path .. "." .. tostring(key))
    end
  elseif kind ~= "string" and kind ~= "boolean" then
    error(path .. " is a " .. kind)
  end
end

test("the result is plain data: numbers, strings, booleans and tables, none reached twice, ready for the saved variables", function()
  local game, facts = setup()
  local window = game.env.CreateFrame("Frame")
  window:SetSize(100, 50)
  window:SetPoint("CENTER")
  local result = run(game, facts, { windows = { demo = window } })
  plainTree(result, {}, "facts")
end)

test("the summary tells what was measured and what failed", function()
  local game, facts = setup()
  local result = run(game, facts)
  local lines = facts.summary(result)
  is_true(string.find(lines[1], "the screen is 1920 by 1080", 1, true) ~= nil)
  is_true(string.find(lines[2], "Widget types: 11", 1, true) ~= nil)
  is_true(string.find(lines[2], "Templates: 11 tried, 0 refused", 1, true) ~= nil)
  is_true(string.find(lines[2], "Fonts: 8", 1, true) ~= nil)
  is_true(string.find(lines[3], "Edit box steps: 5", 1, true) ~= nil)
  is_true(string.find(lines[4], "Items: 0 of 5 loaded. Tooltips with text: 0. Class icon coordinates: false. Worn items: 0.", 1, true) ~= nil)
  eq(#lines, 4)
  result.notes[1] = "fonts: boom"
  lines = facts.summary(result)
  eq(lines[5], "Failed: fonts: boom")
end)

test("every shown frame of a window is recorded with where it is: depth, kind, left, top, width and height", function()
  local game, facts = setup()
  local window = game.env.CreateFrame("Frame")
  window:SetSize(200, 100)
  window:SetPoint("TOPLEFT", game.env.UIParent, "BOTTOMLEFT", 50, 500)
  local child = game.env.CreateFrame("Button", nil, window)
  child:SetSize(80, 20)
  child:SetPoint("TOPLEFT", 10, -30)
  local hidden = game.env.CreateFrame("Frame", nil, window)
  hidden:SetSize(10, 10)
  hidden:SetPoint("TOPLEFT")
  hidden:Hide()
  local result = run(game, facts, { windows = { demo = window } })
  local rects = result.windows.demo.rects
  eq(#rects, 2) -- the hidden one is left out
  deep_eq(rects[1], { 0, "Frame", 50, 500, 200, 100 })
  deep_eq(rects[2], { 1, "Button", 60, 470, 80, 20 })
end)

-- A game that has what a council window needs: items by id that load a moment later, a tooltip, the class icon sheet, worn gear.
local function withClientData(game)
  local env = game.env
  env.C_Item = {
    GetItemInfoInstant = function(id) return id, "Armor", "Mail", "INVTYPE_CHEST", 133000 + id, 4 end,
    GetItemInfo = function(id)
      return "Item " .. id, "|cffa335ee|Hitem:" .. id .. "::::::::70:::::|h[Item " .. id .. "]|h|r", 4, 141, "Armor", "Mail", 1, "INVTYPE_CHEST", 99, 133000 + id
    end,
    GetItemIconByID = function(id) return 133000 + id end,
    GetItemNameByID = function(id) return "Item " .. id end,
    GetItemQualityByID = function() return 4 end,
    GetDetailedItemLevelInfo = function() return 141 end,
  }
  env.Item = {
    CreateFromItemID = function(_, id)
      local item = { id = id }
      function item.ContinueOnItemLoad(_, fn) env.C_Timer.After(0.5, fn) end
      function item.GetItemName(self) return "Item " .. self.id end
      function item.GetItemQuality() return 4 end
      function item.GetItemIcon(self) return 133000 + self.id end
      function item.GetCurrentItemLevel() return 141 end
      function item.GetItemLink(self) return "|cffa335ee|Hitem:" .. self.id .. "::::|h[Item]|h|r" end
      return item
    end,
  }
  env.CLASS_ICON_TCOORDS = { WARRIOR = { 0, 0.25, 0, 0.25 }, MAGE = { 0.25, 0.5, 0, 0.25 } }
  env.RAID_CLASS_COLORS = { WARRIOR = { r = 0.78, g = 0.61, b = 0.43, colorStr = "ffc79c6e" } }
  env.GetInventoryItemLink = function(_, slot)
    if slot <= 3 then return "|cffffffff|Hitem:" .. (100 + slot) .. "::::|h[Gear " .. slot .. "]|h|r" end
  end
  env.GetInventoryItemTexture = function(_, slot) return 500 + slot end
  local tip = env.CreateFrame("GameTooltip", nil, env.UIParent, "GameTooltipTemplate")
  env.GameTooltip = tip
  env.GameTooltipTextLeft1 = tip:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  env.GameTooltipTextLeft1:SetText("Thunderfury")
end

test("the council checks read items, a tooltip, the class icon sheet and the worn gear when the game has them", function()
  local game, facts = setup()
  withClientData(game)
  local result = run(game, facts)
  eq(#result.notes, 0)
  local hearth = result.items["6948"]
  eq(hearth.instant.id, 6948)
  eq(hearth.instant.equipLoc, "INVTYPE_CHEST")
  eq(hearth.instant.icon, 133000 + 6948)
  eq(hearth.info.name, "Item 6948")
  eq(hearth.info.link, "item:6948::::::::70:::::")
  eq(hearth.info.quality, 4)
  eq(hearth.info.ilvl, 141)
  eq(hearth.iconById, 133000 + 6948)
  eq(hearth.nameById, "Item 6948")
  eq(hearth.qualityById, 4)
  eq(hearth.mixin, "created")
  eq(hearth.loaded.name, "Item 6948")
  eq(hearth.loaded.icon, 133000 + 6948)
  eq(hearth.loaded.link, "item:6948::::")
  eq(count(result.items), 5)
  eq(result.tooltips.hyperlink.title, "Thunderfury")
  eq(result.tooltips.hyperlink.shown, true)
  eq(result.tooltips.equipped.title, "Thunderfury") -- the second tooltip, from an equipped item, is read too
  deep_eq(result.classIcons.tcoords.WARRIOR, { 0, 0.25, 0, 0.25 })
  eq(result.classIcons.tcoords.PRIEST, false)
  deep_eq(result.classIcons.colors.WARRIOR, { 0.78, 0.61, 0.43, "ffc79c6e" })
  eq(result.classIcons.hasCoords, true)
  eq(result.gear.count, 3)
  eq(result.gear.slots["2"].id, 102)
  eq(result.gear.slots["2"].ilvl, 141)
  eq(result.gear.slots["2"].texture, 502)
  eq(result.gear.slots["4"], nil)
  local lines = facts.summary(result)
  is_true(string.find(lines[4], "Items: 5 of 5 loaded.", 1, true) ~= nil)
  is_true(string.find(lines[4], "Class icon coordinates: true. Worn items: 3.", 1, true) ~= nil)
  plainTree(result, {}, "facts")
end)

test("an item that never loads is said so after three seconds; a game with none of this gives empty answers, not failures", function()
  local game, facts = setup()
  withClientData(game)
  game.env.Item.CreateFromItemID = function() return { ContinueOnItemLoad = function() end } end
  local result = run(game, facts)
  eq(result.items["6948"].loaded, "not loaded after 3 seconds")
  local bare, bareFacts = setup()
  local empty = run(bare, bareFacts)
  eq(#empty.notes, 0)
  eq(empty.items["6948"].mixin, "failed")
  eq(empty.items["6948"].instant, nil)
  eq(empty.tooltips.missing, true)
  eq(empty.classIcons.hasCoords, false)
  eq(empty.classIcons.tcoords.WARRIOR, false)
  eq(empty.gear.count, 0)
end)

test("a tooltip call that fails is a note on that test only", function()
  local known = fullKnown()
  known.unverified.methods.SetInventoryItem = nil
  local game, facts = setup({ known = known })
  withClientData(game)
  local result = run(game, facts)
  eq(result.tooltips.hyperlink.title, "Thunderfury")
  is_true(string.find(result.tooltips.equipped.error, "SetInventoryItem", 1, true) ~= nil)
  eq(#result.notes, 0)
end)
