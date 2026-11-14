-- The bag picker (IntrepidManager/ui/BagPicker.lua) on the strict stand-in widgets. Invented items only.

local UI = dofile("tests/support/strict_ui.lua")
local StockTemplates = dofile("tests/support/stock_templates.lua")
local Intact = dofile("tests/support/intact.lua")

local FILES = { "ui/Kit", "ui/BagPicker" }

local function bagRow(n, change)
  local row = {
    name = "Thing " .. n, quality = 4, icon = 133000 + n, item = "item:" .. (2000 + n), link = "link" .. n, bag = 0, slot = n,
    bound = true, tradeLine = true, minutes = 239,
  }
  for key, value in pairs(change or {}) do row[key] = value end
  return row
end

-- A picker in a fresh game. scene.better and scene.everything are what the bags hold for each box setting.
local function setup(options)
  options = options or {}
  local game = StockTemplates.install(UI.new())
  local scene = { game = game, added = {}, reads = {}, tips = {}, errors = {}, better = options.better or {}, everything = options.everything or {}, unread = options.unread }
  game.env.GameTooltip = {
    SetOwner = function(_, owner, anchor) scene.tips[#scene.tips + 1] = { "owner", owner, anchor } end,
    SetHyperlink = function(_, link) scene.tips[#scene.tips + 1] = { "link", link } end,
    Show = function() scene.tips[#scene.tips + 1] = { "show" } end,
    Hide = function() scene.tips[#scene.tips + 1] = { "hide" } end,
  }
  local ns = {}
  load_core(ns, "Names", "Council")
  for _, file in ipairs(FILES) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
  game.load("IntrepidManager/net/CouncilWire.lua", ns)
  game.load("IntrepidManager/game/Bags.lua", ns)
  scene.ns = ns
  scene.kit = ns.UI.Kit.new({ density = options.density, onError = function(err) scene.errors[#scene.errors + 1] = tostring(err) end })
  scene.picker = ns.UI.BagPicker.new(scene.kit, {
    rows = function(all)
      scene.reads[#scene.reads + 1] = all
      return all and scene.everything or scene.better, scene.unread
    end,
    add = function(rows) scene.added[#scene.added + 1] = rows end,
  })
  scene.parts = scene.picker.parts
  return scene
end

local function state(scene, widget) return scene.game.state(widget) end
local function text(scene, widget) return state(scene, widget).text end
local function enabled(scene, widget) return state(scene, widget).enabled ~= false end
local function press(scene, widget) scene.game.fire(widget, "OnClick", "LeftButton") end

test("the words at the right of a row: quality and trade time, or not bound, or the quality alone", function()
  local detail = setup().ns.UI.BagPicker.detail
  eq(detail(bagRow(1)), "Epic - 3 h 59 min left to trade")
  eq(detail(bagRow(1, { minutes = 20 })), "Epic - 20 min left to trade")
  eq(detail(bagRow(1, { minutes = false })), "Epic - can be traded for a while")
  eq(detail(bagRow(1, { tradeLine = false, bound = false, quality = 3 })), "Rare - not bound")
  eq(detail(bagRow(1, { tradeLine = false, bound = true, quality = 0 })), "Poor")
  eq(detail({ quality = 9 }), "quality 9")
end)

test("it opens on the better items, listed in order with their quality color, and the box stays clear", function()
  local scene = setup({ better = { bagRow(1), bagRow(2, { quality = 3, tradeLine = false, bound = false }) } })
  scene.picker.show()
  deep_eq(scene.reads, { false })
  eq(scene.parts.everything:GetChecked(), false)
  local rows = scene.parts.rows
  eq(text(scene, rows[1].name), "Thing 1")
  eq(text(scene, rows[1].detail), "Epic - 3 h 59 min left to trade")
  eq(text(scene, rows[2].detail), "Rare - not bound")
  local c = scene.ns.UI.Kit.QUALITY_COLORS[3]
  deep_eq(state(scene, rows[2].name).textColor, { c[1], c[2], c[3] })
  eq(state(scene, rows[1].icon.art).texture, 133001)
  eq(text(scene, scene.parts.status), "2 items. Click the ones to offer.")
  eq(enabled(scene, scene.parts.add), false)
  eq(text(scene, scene.parts.add), "Add selected")
end)

test("with nothing better in the bags it ticks the box by itself and shows everything; with nothing at all it says so", function()
  local gray = bagRow(1, { quality = 0, tradeLine = false, bound = false, minutes = nil })
  local scene = setup({ better = {}, everything = { gray, bagRow(2, { quality = 1, tradeLine = false, bound = false }) } })
  scene.picker.show()
  deep_eq(scene.reads, { false, true })
  eq(scene.parts.everything:GetChecked(), true)
  eq(text(scene, scene.parts.rows[1].detail), "Poor - not bound")
  eq(text(scene, scene.parts.rows[2].detail), "Common - not bound")
  local empty = setup()
  empty.picker.show()
  eq(text(empty, empty.parts.status), "Nothing in your bags can be offered. Tick the box to see grays and whites too.")
  eq(#empty.parts.rows, 0)
end)

test("a click picks a row and a second click drops it; Add sends the picked rows in list order and closes the window", function()
  local scene = setup({ better = { bagRow(1), bagRow(2), bagRow(3) } })
  scene.picker.show()
  local rows = scene.parts.rows
  press(scene, rows[3].frame)
  press(scene, rows[1].frame)
  eq(scene.game.visible(rows[1].selected), true)
  eq(scene.game.visible(rows[2].selected), false)
  eq(text(scene, scene.parts.add), "Add selected (2)")
  eq(enabled(scene, scene.parts.add), true)
  press(scene, rows[1].frame)
  eq(text(scene, scene.parts.add), "Add selected (1)")
  press(scene, rows[1].frame)
  press(scene, scene.parts.add)
  eq(#scene.added, 1)
  eq(#scene.added[1], 2)
  eq(scene.added[1][1].name, "Thing 1")
  eq(scene.added[1][2].name, "Thing 3")
  eq(scene.picker.isShown(), false)
  press(scene, scene.parts.add) -- (hidden window, nothing picked: nothing is sent again)
  eq(#scene.added, 1)
end)

test("the box and Refresh read the bags again and drop the picks; Close closes", function()
  local scene = setup({ better = { bagRow(1) }, everything = { bagRow(1), bagRow(2, { quality = 0, tradeLine = false }) } })
  scene.picker.show()
  press(scene, scene.parts.rows[1].frame)
  scene.parts.everything:SetChecked(true)
  press(scene, scene.parts.everything)
  deep_eq(scene.reads, { false, true })
  eq(#scene.parts.rows, 2)
  eq(text(scene, scene.parts.add), "Add selected")
  press(scene, scene.parts.refresh)
  deep_eq(scene.reads, { false, true, true })
  press(scene, scene.parts.close)
  eq(scene.picker.isShown(), false)
  -- shown again: read again
  scene.picker.show()
  eq(#scene.reads, 4)
end)

test("rows that could not be read are told, and the picture shows the item's tooltip on hover", function()
  local scene = setup({ better = { bagRow(1) }, unread = 3 })
  scene.picker.show()
  eq(text(scene, scene.parts.status), "1 item. Click the ones to offer. 3 bag slots could not be read.")
  local row = scene.parts.rows[1]
  scene.game.fire(row.frame, "OnEnter")
  deep_eq(scene.tips, { { "owner", row.frame, "ANCHOR_RIGHT" }, { "link", "item:2001" }, { "show" } })
  scene.game.fire(row.frame, "OnLeave")
  eq(scene.tips[#scene.tips][1], "hide")
  eq(#scene.errors, 0)
end)

test("the list holds together: inside the window, no text too wide, no buttons overlapping (few rows and many, compact and roomy)", function()
  for _, density in ipairs({ "compact", "roomy" }) do
    for _, count in ipairs({ 0, 3, 9, 14 }) do
      local rows = {}
      for i = 1, count do rows[i] = bagRow(i, { name = "A Rather Long Item Name Indeed", minutes = 59 }) end
      local scene = setup({ density = density, better = rows })
      scene.picker.show()
      deep_eq(Intact.problems(scene.game, scene.picker.frame), {})
    end
  end
end)

test("the picker opens at the top, clear of the session window", function()
  local scene = setup()
  local point = state(scene, scene.picker.frame).points[1]
  eq(point.point, "TOP")
  eq(point.y, -120)
end)
