-- Intrepid Manager: an icon test window, to look in the game at what a council window is made of: class icons (cut out of the
-- game's class sheet, and the game's own one-file class icons), class colors, item icons by id with their quality borders and
-- tooltips, and the gear the player wears with its tooltips. Hover an icon for its tooltip. An icon that shows a green square
-- or the whole sheet is one the game could not draw; that is what this window is for. Frames only; nothing is changed.
--
--   local window = ns.UI.IconWindow.new(kit)
--   window.open()

local _, ns = ...

local IconWindow = {}
ns.UI = ns.UI or {}
ns.UI.IconWindow = IconWindow

local NAME = "IntrepidManagerIcons"
local SHEET = "Interface\\GLUES\\CHARACTERCREATE\\UI-CHARACTERCREATE-CLASSES"
local CLASSES = { "WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST", "SHAMAN", "MAGE", "WARLOCK", "DRUID" }
local CLASS_NAMES = { "Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid" }
local ITEM_IDS = { 6948, 19019, 32837, 29434, 25 }
local SLOTS = 19
local SIZE = 24

-- What the game has under a global name, when it has it (the names that no code of ours is allowed to rely on yet).
local function global(name)
  return _G[name]
end

local function itemIcon(id)
  local holder = _G.C_Item
  local ok, icon = pcall(function() return holder.GetItemIconByID(id) end)
  return ok and icon or nil
end

local function itemQuality(id)
  local holder = _G.C_Item
  local ok, quality = pcall(function() return holder.GetItemQualityByID(id) end)
  return ok and tonumber(quality) or 1
end

function IconWindow.new(kit)
  local m, colors = kit.m, kit.colors
  local Kit = ns.UI.Kit
  local self = {}
  local pad = m.pad
  local width = 20 * (SIZE + 4) + pad * 2 + 10
  local rowHeight = SIZE + 6

  local window = kit.window({ name = NAME, title = "Intrepid Manager - Icon test", width = width, height = 400 })
  local body = window.body

  local intro = kit.label(body, "Hover an icon for its tooltip. A green square, or a whole sheet of icons, is something the game could not draw.",
    { wrap = true, width = width - 10 - pad * 2, color = colors.muted })
  intro:SetPoint("TOPLEFT", pad, -pad)

  local function heading(text, top)
    local label = kit.label(body, text, { font = "gold" })
    label:SetPoint("TOPLEFT", pad, -top)
  end

  -- One icon of a row: a quality border and a picture, with a tooltip on hover.
  local function placeIcon(left, top, quality, texture, onEnter)
    local icon = kit.icon(body, SIZE, quality, texture)
    icon:SetPoint("TOPLEFT", left, -top)
    icon:EnableMouse(true)
    icon:SetScript("OnEnter", kit.safe(function(owner)
      if onEnter then onEnter(owner) end
    end))
    icon:SetScript("OnLeave", function()
      if GameTooltip then GameTooltip:Hide() end
    end)
    return icon
  end

  local top = pad + 28
  -- class icons cut from the sheet
  heading("Class icons from the class sheet (CLASS_ICON_TCOORDS)", top)
  top = top + m.header
  local sheet = global("CLASS_ICON_TCOORDS")
  self.sheetIcons = {}
  for index, class in ipairs(CLASSES) do
    local icon = placeIcon(pad + (index - 1) * (SIZE + 4), top, 1, SHEET)
    local coords = type(sheet) == "table" and sheet[class]
    if type(coords) == "table" then icon.art:SetTexCoord(coords[1], coords[2], coords[3], coords[4]) end
    self.sheetIcons[class] = icon
  end
  top = top + rowHeight

  -- the game's own icon of each class
  heading("Class icons from their own files (Interface\\Icons\\ClassIcon_...)", top)
  top = top + m.header
  self.fileIcons = {}
  for index, class in ipairs(CLASSES) do
    self.fileIcons[class] = placeIcon(pad + (index - 1) * (SIZE + 4), top, 1, "Interface\\Icons\\ClassIcon_" .. CLASS_NAMES[index])
  end
  top = top + rowHeight

  -- class colors on names
  heading("Class colors (RAID_CLASS_COLORS)", top)
  top = top + m.header
  local palette = global("RAID_CLASS_COLORS")
  local names = {}
  for index, class in ipairs(CLASSES) do
    local color = type(palette) == "table" and palette[class]
    local rgb = type(color) == "table" and { color.r or 1, color.g or 1, color.b or 1 } or colors.text
    names[#names + 1] = Kit.colored(rgb, CLASS_NAMES[index])
  end
  local colored = kit.label(body, table.concat(names, "   "), { width = width - 10 - pad * 2 })
  colored:SetPoint("TOPLEFT", pad, -top)
  top = top + m.row + 4

  -- items by id
  heading("Items by id (C_Item), with their tooltips", top)
  top = top + m.header
  self.itemIcons = {}
  local function paintItem(id)
    local icon = self.itemIcons[id]
    local quality = itemQuality(id)
    kit.setIcon(icon, quality, itemIcon(id))
  end
  for index, id in ipairs(ITEM_IDS) do
    self.itemIcons[id] = placeIcon(pad + (index - 1) * (SIZE + 4), top, itemQuality(id), itemIcon(id), function(owner)
      GameTooltip:SetOwner(owner, "ANCHOR_RIGHT")
      GameTooltip:SetHyperlink("item:" .. id)
    end)
    -- the game may not have the item yet: ask for it, and draw the icon again when it is there
    pcall(function()
      _G.Item:CreateFromItemID(id):ContinueOnItemLoad(function() paintItem(id) end)
    end)
  end
  top = top + rowHeight

  -- what the player wears
  heading("Your gear, with its tooltips (GetInventoryItemTexture)", top)
  top = top + m.header
  self.gearIcons = {}
  local texture = global("GetInventoryItemTexture")
  for slot = 1, SLOTS do
    local column, line = (slot - 1) % 10, math.floor((slot - 1) / 10)
    local picture = type(texture) == "function" and texture("player", slot) or nil
    self.gearIcons[slot] = placeIcon(pad + column * (SIZE + 4), top + line * rowHeight, picture and 1 or 0, picture, function(owner)
      GameTooltip:SetOwner(owner, "ANCHOR_RIGHT")
      local method = GameTooltip["SetInventoryItem"]
      if method then method(GameTooltip, "player", slot) end
    end)
  end
  top = top + rowHeight * 2

  local closeButton = kit.button(body, "Close", { width = 70 })
  closeButton:SetPoint("BOTTOMRIGHT", -pad, pad)
  closeButton:SetScript("OnClick", function() window.hide() end)
  window.frame:SetHeight(top + m.button + pad * 2 + 28)

  function self.open() window.show() end
  function self.show() window.show() end
  function self.hide() window.hide() end
  function self.toggle() window.toggle() end
  function self.isShown() return window.isShown() end
  self.window = window
  window.frame:Hide()
  return self
end
