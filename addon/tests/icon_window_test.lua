-- The icon test window (IntrepidManager/ui/IconWindow.lua) on the strict stand-in widgets, with a fake client that has class
-- icons, items by id, a tooltip and gear. Invented names only.

local UI = dofile("tests/support/strict_ui.lua")
local StockTemplates = dofile("tests/support/stock_templates.lua")
local Intact = dofile("tests/support/intact.lua")

local FILES = { "ui/Kit", "ui/IconWindow" }

-- A game, with what the window asks the client for. options: bare (the client has none of it).
local function setup(options)
  options = options or {}
  local game = StockTemplates.install(UI.new())
  local env = game.env
  local scene = { game = game, tips = {}, loads = {} }
  if not options.bare then
    env.C_Item = {
      GetItemIconByID = function(id) return 133000 + id end,
      GetItemQualityByID = function(id) return id == 19019 and 5 or 4 end,
    }
    env.Item = {
      CreateFromItemID = function(_, id)
        return { ContinueOnItemLoad = function(_, fn) scene.loads[id] = fn end }
      end,
    }
    env.CLASS_ICON_TCOORDS = { WARRIOR = { 0, 0.25, 0, 0.25 }, MAGE = { 0.25, 0.5, 0, 0.25 }, DRUID = { 0.75, 1, 0, 0.25 } }
    env.RAID_CLASS_COLORS = { WARRIOR = { r = 0.78, g = 0.61, b = 0.43 }, MAGE = { r = 0.41, g = 0.8, b = 0.94 } }
    env.GetInventoryItemTexture = function(_, slot) if slot ~= 4 and slot ~= 18 then return 500 + slot end end
    env.GameTooltip = {
      SetOwner = function(_, owner, anchor) scene.tips[#scene.tips + 1] = { "owner", owner, anchor } end,
      SetHyperlink = function(_, link) scene.tips[#scene.tips + 1] = { "link", link } end,
      SetInventoryItem = function(_, unit, slot) scene.tips[#scene.tips + 1] = { "slot", unit, slot } end,
      Hide = function() scene.tips[#scene.tips + 1] = { "hide" } end,
    }
  end
  local ns = {}
  for _, file in ipairs(FILES) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
  scene.kit = ns.UI.Kit.new({ density = options.density, chrome = options.chrome })
  scene.window = ns.UI.IconWindow.new(scene.kit)
  return scene
end

local function state(scene, widget) return scene.game.state(widget) end

test("the class icons are cut from the class sheet with the game's coordinates, and the game's own files are used too", function()
  local scene = setup()
  local warrior = scene.window.sheetIcons.WARRIOR
  eq(state(scene, warrior.art).texture, "Interface\\GLUES\\CHARACTERCREATE\\UI-CHARACTERCREATE-CLASSES")
  deep_eq(state(scene, warrior.art).texCoord, { 0, 0.25, 0, 0.25 })
  deep_eq(state(scene, scene.window.sheetIcons.MAGE.art).texCoord, { 0.25, 0.5, 0, 0.25 })
  eq(state(scene, scene.window.sheetIcons.ROGUE.art).texCoord, nil) -- the sheet has no coordinates for it: the whole sheet shows
  eq(state(scene, scene.window.fileIcons.WARRIOR.art).texture, "Interface\\Icons\\ClassIcon_Warrior")
  eq(state(scene, scene.window.fileIcons.DRUID.art).texture, "Interface\\Icons\\ClassIcon_Druid")
  eq(state(scene, scene.window.fileIcons.WARRIOR).width, 24)
end)

test("the item icons come from the game by id, with the quality's border; hovering shows the item's tooltip, leaving hides it", function()
  local scene = setup()
  local hearth, sword = scene.window.itemIcons[6948], scene.window.itemIcons[19019]
  eq(state(scene, hearth.art).texture, 133000 + 6948)
  eq(state(scene, hearth).backdropBorderColor[3], 0.93) -- epic
  eq(state(scene, sword).backdropBorderColor[1], 1) -- legendary: orange
  scene.game.fire(hearth, "OnEnter")
  deep_eq(scene.tips, { { "owner", hearth, "ANCHOR_RIGHT" }, { "link", "item:6948" } })
  scene.game.fire(hearth, "OnLeave")
  eq(scene.tips[3][1], "hide")
  -- an item the game had to load: the icon is drawn again when it is there
  eq(type(scene.loads[6948]), "function")
  scene.game.env.C_Item.GetItemIconByID = function() return 999 end
  scene.loads[6948]()
  eq(state(scene, hearth.art).texture, 999)
end)

test("the gear icons are what the player wears, with a tooltip of the slot; an empty slot is a plain box", function()
  local scene = setup()
  eq(state(scene, scene.window.gearIcons[1].art).texture, 501)
  eq(state(scene, scene.window.gearIcons[19].art).texture, 519)
  eq(state(scene, scene.window.gearIcons[4].art).texture, nil)
  scene.game.fire(scene.window.gearIcons[16], "OnEnter")
  deep_eq(scene.tips[#scene.tips], { "slot", "player", 16 })
  scene.game.fire(scene.window.gearIcons[18], "OnLeave")
  eq(scene.tips[#scene.tips][1], "hide")
end)

test("the class colors are on the names", function()
  local scene = setup()
  local found
  for _, widget in ipairs(scene.game.frames) do
    for _, region in ipairs(state(scene, widget).regions) do
      local text = state(scene, region).text
      if text and string.find(text, "Warrior", 1, true) and string.find(text, "Mage", 1, true) then found = text end
    end
  end
  is_true(found ~= nil)
  is_true(string.find(found, "|cffc79c6eWarrior|r", 1, true) ~= nil) -- 0.78, 0.61, 0.43
  is_true(string.find(found, "|cff69ccf0Mage|r", 1, true) ~= nil)
end)

test("a client with none of it still gets the window, with plain icons, and a tooltip that fails does not break it", function()
  local scene = setup({ bare = true })
  scene.window.open()
  is_true(scene.window.isShown())
  eq(state(scene, scene.window.sheetIcons.WARRIOR.art).texCoord, nil)
  scene.game.fire(scene.window.itemIcons[6948], "OnEnter") -- no GameTooltip: reported by the kit, not raised
  scene.game.fire(scene.window.itemIcons[6948], "OnLeave")
  scene.game.fire(scene.window.gearIcons[1], "OnLeave")
end)

test("the window opens, closes with Escape and its Close button, and nothing sticks out or overlaps: compact, roomy, flat", function()
  for _, options in ipairs({ {}, { density = "roomy" }, { chrome = "flat" } }) do
    local scene = setup(options)
    scene.window.open()
    is_true(scene.window.isShown())
    local problems = Intact.problems(scene.game, scene.window.window.frame)
    if #problems > 0 then error((options.density or "compact") .. " " .. (options.chrome or "stock") .. ": " .. table.concat(problems, "; ")) end
    local listed = false
    for _, name in ipairs(scene.game.env.UISpecialFrames) do listed = listed or name == "IntrepidManagerIcons" end
    is_true(listed)
    scene.window.hide()
    eq(scene.window.isShown(), false)
    scene.window.toggle()
    is_true(scene.window.isShown())
  end
end)
