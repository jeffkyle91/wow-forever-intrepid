-- Intrepid Manager: the bag picker. Frames only: it lists what the callbacks give and tells which rows were chosen. The loot master
-- clicks the items to offer (a click picks, a second click drops), then Add. Items with a trade time come first, soonest to run out
-- first; the box "Include grays and whites" widens the list to every quality (it opens ticked when nothing better is in the bags).
--
-- A row (from game/Bags): { name, quality, icon, item, link, bag, slot, bound, minutes, tradeLine }.
--
-- The callbacks (each in pcall):
--   rows(all)     the rows of the bags (all: grays and whites too), and the number of slots that could not be read
--   add(rows)     the chosen rows
--
-- BagPicker.detail(row) is the muted words at the right of a row, for the tests.

local _, ns = ...

local BagPicker = {}
ns.UI = ns.UI or {}
ns.UI.BagPicker = BagPicker

local NAME = "IntrepidManagerBags"
local VISIBLE = 9
local QUALITY_NAMES = { [0] = "Poor", [1] = "Common", [2] = "Uncommon", [3] = "Rare", [4] = "Epic", [5] = "Legendary" }
local EMPTY = "Nothing in your bags can be offered."
local EMPTY_HINT = "Tick the box to see grays and whites too."

-- "Epic - 3 h 59 min left to trade", "Rare - not bound", "Poor".
function BagPicker.detail(row)
  local text = QUALITY_NAMES[row.quality] or ("quality " .. tostring(row.quality))
  if row.tradeLine then
    local left = ns.Game and ns.Game.Bags and ns.Game.Bags.timeText(row.minutes)
    return text .. " - " .. (left and (left .. " left to trade") or "can be traded for a while")
  end
  if row.bound == false then return text .. " - not bound" end
  return text
end

function BagPicker.new(kit, callbacks)
  callbacks = callbacks or {}
  local m, colors = kit.m, kit.colors
  local self = {}

  local function call(name, ...)
    local callback = callbacks[name]
    if callback then return callback(...) end
  end

  -- the numbers everything else is placed by
  local pad, gap, header = m.pad, m.gap, m.header
  local rowHeight = m.itemRow
  local iconSize = rowHeight - 4
  local width = 480
  local inner = width - 10 - pad * 2
  local rowWidth = inner - m.bar - 2
  local detailWidth = 190
  local nameWidth = rowWidth - iconSize - gap * 3 - detailWidth
  local listHeight = rowHeight * VISIBLE
  local headTop = pad
  local listTop = headTop + header + gap
  local statusTop = listTop + listHeight + gap
  local buttonsTop = statusTop + 2 * header + gap -- (the status may take two lines)
  local height = buttonsTop + m.button + pad + 28

  local window = kit.window({
    name = NAME, title = "Add from bags", width = width, height = height, chrome = "clear", anchor = { point = "TOP", x = 0, y = -120 },
  })
  local body = window.body

  local heading = kit.label(body, "ITEMS YOU CAN OFFER", { font = "gold" })
  heading:SetPoint("TOPLEFT", pad, -headTop)
  local list = kit.scrollList(body, inner, listHeight)
  list.frame:SetPoint("TOPLEFT", pad, -listTop)
  local status = kit.label(body, "", { width = inner, wrap = true, color = colors.muted })
  status:SetPoint("TOPLEFT", pad, -statusTop)

  local everything = kit.check(body, "Include grays and whites")
  everything:SetPoint("TOPLEFT", pad, -buttonsTop)
  local closeButton = kit.button(body, "Close", { width = 70 })
  closeButton:SetPoint("TOPRIGHT", -pad, -buttonsTop)
  local addButton = kit.button(body, "Add selected", { primary = true, width = 110 })
  addButton:SetPoint("TOPRIGHT", closeButton, "TOPLEFT", -gap, 0)
  local refreshButton = kit.button(body, "Refresh", { width = 70 })
  refreshButton:SetPoint("TOPRIGHT", addButton, "TOPLEFT", -gap, 0)

  local rows, data, picked = {}, {}, {}

  local function chosen()
    local list_ = {}
    for i, row in ipairs(data) do
      if picked[i] then list_[#list_ + 1] = row end
    end
    return list_
  end

  local function repaint()
    local count = 0
    for i = 1, #data do
      if picked[i] then count = count + 1 end
      local row = rows[i]
      if row then row.selected:SetShown(picked[i] == true) end
    end
    addButton:SetText(count > 0 and ("Add selected (" .. count .. ")") or "Add selected")
    addButton:SetEnabled(count > 0)
  end

  local function makeRow(index)
    local row = {}
    local frame = CreateFrame("Button", nil, list.content)
    frame:SetSize(rowWidth, rowHeight)
    frame:SetPoint("TOPLEFT", 0, -(index - 1) * rowHeight)
    kit.fill(frame, index % 2 == 1 and colors.panel or colors.panelAlt)
    row.selected = frame:CreateTexture(nil, "ARTWORK")
    row.selected:SetAllPoints()
    row.selected:SetColorTexture(colors.selected[1], colors.selected[2], colors.selected[3], 1)
    row.selected:Hide()
    row.icon = kit.icon(frame, iconSize, 1, nil)
    row.icon:SetPoint("LEFT", gap, 0)
    row.name = kit.label(frame, "", { width = nameWidth })
    row.name:SetPoint("LEFT", row.icon, "RIGHT", gap, 0)
    row.detail = kit.label(frame, "", { width = detailWidth, justify = "RIGHT", color = colors.muted })
    row.detail:SetPoint("RIGHT", -gap, 0)
    frame:SetScript("OnClick", kit.safe(function()
      if not data[index] then return end
      picked[index] = not picked[index] or nil
      repaint()
    end))
    frame:SetScript("OnEnter", kit.safe(function(self_)
      if not data[index] then return end
      GameTooltip:SetOwner(self_, "ANCHOR_RIGHT")
      GameTooltip:SetHyperlink(data[index].item)
      GameTooltip:Show()
    end))
    frame:SetScript("OnLeave", kit.safe(function() GameTooltip:Hide() end))
    row.frame = frame
    rows[index] = row
    return row
  end

  -- Read the bags again and show them. The list opens on everything when the better items are none.
  function self.refresh()
    local all = everything:GetChecked() == true
    local found, errors = call("rows", all)
    found = found or {}
    if #found == 0 and not all then
      everything:SetChecked(true)
      found, errors = call("rows", true)
      found = found or {}
    end
    data, picked = found, {}
    for i, item in ipairs(data) do
      local row = rows[i] or makeRow(i)
      row.frame:Show()
      kit.setIcon(row.icon, item.quality or 1, item.icon)
      local color = ns.UI.Kit.qualityColor(item.quality or 1)
      row.name:SetText(kit.fit(item.name or item.item, nameWidth))
      row.name:SetTextColor(color[1], color[2], color[3])
      row.detail:SetText(BagPicker.detail(item))
    end
    for i = #data + 1, #rows do rows[i].frame:Hide() end
    list.setContentHeight(#data * rowHeight)
    if #data == 0 then
      status:SetText(EMPTY .. " " .. EMPTY_HINT)
    else
      status:SetText(#data .. (#data == 1 and " item" or " items") .. ". Click the ones to offer."
        .. ((errors or 0) > 0 and (" " .. errors .. " bag slots could not be read.") or ""))
    end
    repaint()
  end

  everything:SetScript("OnClick", kit.safe(function() self.refresh() end))
  refreshButton:SetScript("OnClick", kit.safe(function() self.refresh() end))
  addButton:SetScript("OnClick", kit.safe(function()
    local rows_ = chosen()
    if #rows_ == 0 then return end
    window.hide()
    picked = {}
    repaint()
    call("add", rows_)
  end))
  closeButton:SetScript("OnClick", kit.safe(function() window.hide() end))
  window.frame:SetScript("OnShow", kit.safe(function() self.refresh() end))

  window.hide()

  function self.show() window.show() end
  function self.hide() window.hide() end
  function self.isShown() return window.isShown() end
  self.frame = window.frame
  self.parts = { window = window, list = list, rows = rows, status = status, everything = everything, add = addButton, refresh = refreshButton, close = closeButton }
  self.metrics = { rowHeight = rowHeight, width = width, height = height, visible = VISIBLE }
  return self
end
