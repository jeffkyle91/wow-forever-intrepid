-- Intrepid Manager: the loot history window (/im history, and History in the loot session window). Frames only: it shows the
-- history it was given (core/History.lua builds it from the awards log) and searches it as the loot master types.
--
-- Left, the raids, newest first: the dungeon or raid of the game and when it started. "All raids" is first. Right, the awards of the
-- raid picked (all of them under "All raids"), newest first: when, the item (hover for its tooltip), the winner, the raid, and
-- whether it was given or taken back. The search box above takes a player, an item, a dungeon or raid, or a date; the raids on the
-- left are then only those with an award that matches.
--
-- Both lists draw only the lines on screen, so ten thousand awards cost no more frames than twenty.
--
-- The view-model (read only; the engine builds it):
--   vm = {
--     history = History.build(log, clock),   -- the rows and the raids
--     year    = 2026,                        -- this year: older rows show their year instead of the time
--     limit   = 10000,                       -- how many awards the log keeps
--     search  = "dec 9",                     -- optional: put in the search box when the window opens
--   }

local _, ns = ...

local HistoryWindow = {}
ns.UI = ns.UI or {}
ns.UI.HistoryWindow = HistoryWindow

local NAME = "IntrepidManagerHistory"
local VISIBLE = 20 -- award lines on screen; the raid list shows half as many, two lines each
local HINT = "Only awards made on this account. Search a player, an item, a dungeon or raid, or a date such as Dec 9 or 2026-12-09."
local EMPTY = "No awards yet. The awards you make as loot master are kept here; practice awards never are."
local NOTHING = "Nothing matches."

local function number(n)
  local text = string.format("%.0f", n or 0)
  local before
  repeat
    before = text
    text = string.gsub(text, "^(%d+)(%d%d%d)", "%1,%2")
  until text == before
  return text
end

local function awards(n) return n == 1 and "1 award" or (number(n) .. " awards") end

-- The line under the lists: how many awards are kept, since when, and the limit.
function HistoryWindow.status(vm)
  local rows = vm.history and vm.history.rows or {}
  if #rows == 0 then return "Nothing kept yet (the history keeps up to " .. number(vm.limit or 0) .. " awards)." end
  local oldest = rows[#rows]
  return awards(#rows) .. " kept here since " .. (oldest.day or "?") .. " (up to " .. number(vm.limit or 0)
    .. "; after that the oldest drop off)."
end

-- The count at the top right: "24 of 1,234 awards", or "1,234 awards" when nothing narrows the list.
function HistoryWindow.countText(shown, total)
  if shown == total then return awards(total) end
  return number(shown) .. " of " .. awards(total)
end

-- The second line of a raid in the raid list: "Molten Core, 8:05 PM".
function HistoryWindow.raidLine(raid)
  return raid.placeText .. (raid.time and (", " .. raid.time) or "")
end

function HistoryWindow.new(kit)
  local m, colors = kit.m, kit.colors
  local History = ns.History
  local self = {}

  -- the numbers everything else is placed by
  local scale = m.name == "roomy" and 1.2 or 1
  local pad, gap, header = m.pad, m.gap, m.header
  local width = math.floor(920 * scale)
  local inner = width - 10 - pad * 2
  local leftWidth = math.floor(230 * scale)
  local rightX = pad + leftWidth + gap * 2
  local rightWidth = inner - leftWidth - gap * 2
  local rowHeight = m.row
  local listHeight = rowHeight * VISIBLE
  local searchTop = pad
  local headsTop = searchTop + m.input + gap * 2
  local listTop = headsTop + header
  local statusTop = listTop + listHeight + gap
  local hintTop = statusTop + header
  local height = hintTop + header + pad + 28
  local rowWidth = rightWidth - m.bar - 2
  local leftRowWidth = leftWidth - m.bar - 2
  local whenWidth, whoWidth, raidWidth, stateWidth = math.floor(104 * scale), math.floor(110 * scale), math.floor(120 * scale), math.floor(66 * scale)
  local itemWidth = rowWidth - whenWidth - whoWidth - raidWidth - stateWidth - gap * 6
  local countWidth = 44

  local window = kit.window({ name = NAME, title = "Loot history", width = width, height = height })
  local body = window.body

  -- top: the search
  local searchLabel = kit.label(body, "Search", { width = 46 })
  searchLabel:SetPoint("TOPLEFT", pad, -searchTop - 1)
  local searchBox = kit.input(body, { width = math.floor(280 * scale), maxLetters = 60 })
  searchBox:SetPoint("TOPLEFT", pad + 46 + gap * 2, -searchTop)
  local clearButton = kit.button(body, "Clear", { width = 56 })
  clearButton:SetPoint("TOPLEFT", searchBox, "TOPRIGHT", gap * 2, 1)
  local count = kit.label(body, "", { width = 220, justify = "RIGHT", color = colors.muted })
  count:SetPoint("TOPRIGHT", -pad, -searchTop - 1)

  -- the heads
  local raidsHead = kit.label(body, "RAIDS", { font = "gold", width = leftWidth })
  raidsHead:SetPoint("TOPLEFT", pad, -headsTop)
  local heads = {}
  local x = rightX + gap
  for _, column in ipairs({ { "WHEN", whenWidth }, { "ITEM", itemWidth }, { "WINNER", whoWidth }, { "RAID", raidWidth }, { "STATE", stateWidth } }) do
    local head = kit.label(body, column[1], { color = colors.muted, width = column[2] })
    head:SetPoint("TOPLEFT", x, -headsTop)
    heads[#heads + 1] = head
    x = x + column[2] + gap
  end

  local status = kit.label(body, "", { width = inner })
  status:SetPoint("TOPLEFT", pad, -statusTop)
  local hint = kit.label(body, HINT, { width = inner, color = colors.muted })
  hint:SetPoint("TOPLEFT", pad, -hintTop)

  -- A list that draws only the lines on screen: `lines` frames, filled by paint(frame, index) with index nil for a line past the end.
  -- The mouse wheel moves it three lines at a time; a thin bar shows where it is.
  local function pagedList(listWidth, lineHeight, lines, make, paint)
    local list = { offset = 0, total = 0, lines = {} }
    local frame = CreateFrame("Frame", nil, body)
    frame:SetSize(listWidth, lineHeight * lines)
    frame:EnableMouseWheel(true)
    local track = frame:CreateTexture(nil, "BORDER")
    track:SetPoint("TOPRIGHT", 0, 0)
    track:SetPoint("BOTTOMRIGHT", 0, 0)
    track:SetWidth(m.bar)
    track:SetColorTexture(colors.track[1], colors.track[2], colors.track[3], 1)
    local thumb = frame:CreateTexture(nil, "ARTWORK")
    thumb:SetWidth(m.bar)
    thumb:SetColorTexture(colors.thumb[1], colors.thumb[2], colors.thumb[3], 1)
    for index = 1, lines do list.lines[index] = make(frame, index) end
    list.frame = frame

    local function range() return math.max(0, list.total - lines) end

    function list.paint()
      list.offset = math.min(math.max(list.offset, 0), range())
      for index = 1, lines do
        local at = list.offset + index
        paint(list.lines[index], at <= list.total and at or nil)
      end
      local scrolls = range() > 0
      track:SetShown(scrolls)
      thumb:SetShown(scrolls)
      if scrolls then
        local view = lineHeight * lines
        local size = math.max(12, view * lines / list.total)
        thumb:SetHeight(size)
        thumb:ClearAllPoints()
        thumb:SetPoint("TOPRIGHT", 0, -(view - size) * list.offset / range())
      end
    end

    function list.set(total, keepPlace)
      list.total = total
      if not keepPlace then list.offset = 0 end
      list.paint()
    end

    frame:SetScript("OnMouseWheel", kit.safe(function(_, delta)
      list.offset = list.offset - delta * 3
      list.paint()
    end))
    return list
  end

  local shownRows, shownRaids = {}, {} -- what the lists show now
  local current = { history = { rows = {}, raids = {} }, year = 0, limit = 0 }
  local selected -- the raid picked, or nil for all of them
  local paintAll

  -- the raid list (left): "All raids", then each raid on two lines
  local raidLines = math.floor(VISIBLE / 2)
  local raidList = pagedList(leftWidth, rowHeight * 2, raidLines, function(parent, index)
    local line = {}
    local frame = CreateFrame("Button", nil, parent)
    frame:SetSize(leftRowWidth, rowHeight * 2)
    frame:SetPoint("TOPLEFT", 0, -(index - 1) * rowHeight * 2)
    kit.fill(frame, index % 2 == 1 and colors.panel or colors.panelAlt)
    line.selected = frame:CreateTexture(nil, "ARTWORK")
    line.selected:SetAllPoints()
    line.selected:SetColorTexture(colors.selected[1], colors.selected[2], colors.selected[3], 1)
    line.day = kit.label(frame, "", { font = "gold", width = leftRowWidth - countWidth - gap * 3 })
    line.day:SetPoint("TOPLEFT", gap, -1)
    line.count = kit.label(frame, "", { width = countWidth, justify = "RIGHT", color = colors.muted })
    line.count:SetPoint("TOPRIGHT", -gap, -1)
    line.place = kit.label(frame, "", { width = leftRowWidth - gap * 2 })
    line.place:SetPoint("TOPLEFT", gap, -rowHeight + 1)
    frame:SetScript("OnClick", kit.safe(function()
      if line.raid == nil and not line.all then return end
      selected = line.raid
      paintAll()
    end))
    line.frame = frame
    return line
  end, function(line, index)
    local entry = index and shownRaids[index]
    line.frame:SetShown(entry ~= nil)
    if not entry then
      line.raid, line.all = nil, false
      return
    end
    line.all = entry.all == true
    line.raid = entry.raid
    line.selected:SetShown(entry.raid == selected)
    if entry.all then
      line.day:SetText("All raids")
      line.place:SetText(kit.fit(awards(entry.count), leftRowWidth - gap * 2))
      line.count:SetText("")
    else
      line.day:SetText(kit.fit(entry.raid.day, leftRowWidth - countWidth - gap * 3))
      line.place:SetText(kit.fit(HistoryWindow.raidLine(entry.raid), leftRowWidth - gap * 2))
      line.count:SetText(number(entry.count))
    end
  end)
  raidList.frame:SetPoint("TOPLEFT", pad, -listTop)

  -- the award list (right)
  local function setColor(label, color) label:SetTextColor(color[1], color[2], color[3]) end
  local awardList = pagedList(rightWidth, rowHeight, VISIBLE, function(parent, index)
    local line = {}
    local frame = CreateFrame("Button", nil, parent)
    frame:SetSize(rowWidth, rowHeight)
    frame:SetPoint("TOPLEFT", 0, -(index - 1) * rowHeight)
    kit.fill(frame, index % 2 == 1 and colors.panel or colors.panelAlt)
    local left = gap
    local function cell(cellWidth, options_)
      local label = kit.label(frame, "", options_ or { width = cellWidth })
      label:SetPoint("LEFT", left, 0)
      left = left + cellWidth + gap
      return label
    end
    line.when = cell(whenWidth)
    line.item = cell(itemWidth, { width = itemWidth, font = "gold" })
    line.who = cell(whoWidth)
    line.raid = cell(raidWidth)
    line.state = cell(stateWidth)
    frame:SetScript("OnEnter", kit.safe(function(self_)
      local row = line.row
      if not (row and row.itemId) then return end
      GameTooltip:SetOwner(self_, "ANCHOR_RIGHT")
      GameTooltip:SetHyperlink("item:" .. string.format("%.0f", row.itemId))
      GameTooltip:Show()
    end))
    frame:SetScript("OnLeave", kit.safe(function() GameTooltip:Hide() end))
    line.frame = frame
    return line
  end, function(line, index)
    local row = index and shownRows[index]
    line.row = row
    line.frame:SetShown(row ~= nil)
    if not row then return end
    line.when:SetText(kit.fit(History.shortWhen(row, current.year), whenWidth))
    line.item:SetText(kit.fit(row.item, itemWidth))
    line.who:SetText(kit.fit(row.to, whoWidth))
    line.raid:SetText(kit.fit(row.placeText, raidWidth))
    line.state:SetText(row.state)
    local text = row.removed and colors.muted or colors.text
    setColor(line.when, text)
    setColor(line.who, text)
    setColor(line.raid, text)
    setColor(line.item, row.removed and colors.muted or colors.gold)
    setColor(line.state, row.removed and colors.bad or (row.received and colors.good or colors.muted))
  end)
  awardList.frame:SetPoint("TOPLEFT", rightX, -listTop)

  local emptyLine = kit.label(body, "", { width = rightWidth - gap * 2, color = colors.muted })
  emptyLine:SetPoint("TOPLEFT", rightX + gap, -listTop - 2)

  -- Search, pick the raids that have a match, and paint both lists. `keepPlace`: a repaint, not a new search (the lists stay
  -- where they were scrolled to).
  paintAll = function(keepPlace)
    local history = current.history
    local text = searchBox:GetText() or ""
    local all = History.search(history, text, nil)
    shownRows = selected and History.search(history, text, selected) or all
    local counts = History.raidCounts(all)
    shownRaids = { { all = true, count = #all } }
    for _, raid in ipairs(history.raids) do
      local n = counts[raid] or 0
      if n > 0 or raid == selected then shownRaids[#shownRaids + 1] = { raid = raid, count = n } end
    end
    raidList.set(#shownRaids, keepPlace)
    awardList.set(#shownRows, keepPlace)
    count:SetText(HistoryWindow.countText(#shownRows, #history.rows))
    if #history.rows == 0 then
      emptyLine:SetText(EMPTY)
    elseif #shownRows == 0 then
      emptyLine:SetText(NOTHING)
    else
      emptyLine:SetText("")
    end
  end

  searchBox:SetScript("OnTextChanged", kit.safe(function() paintAll() end))
  clearButton:SetScript("OnClick", kit.safe(function()
    selected = nil
    searchBox:SetText("")
    searchBox:ClearFocus()
    paintAll()
  end))

  -- Show this history. The search text stays, and so does the raid picked when the new history still has it.
  function self.update(vm)
    vm = vm or {}
    current = { history = vm.history or { rows = {}, raids = {} }, year = vm.year or 0, limit = vm.limit or 0 }
    if selected then
      local key = selected.key
      selected = nil
      for _, raid in ipairs(current.history.raids) do
        if raid.key == key then selected = raid end
      end
    end
    status:SetText(HistoryWindow.status(current))
    paintAll(true)
  end

  -- Open with this history: a search given in the view-model replaces the one in the box, and the raid picked is forgotten.
  function self.open(vm)
    vm = vm or {}
    selected = nil
    if vm.search ~= nil then searchBox:SetText(vm.search) end
    self.update(vm)
    raidList.set(#shownRaids)
    awardList.set(#shownRows)
    window.show()
  end

  -- What the lists show (for the tests and the pictures): the rows, the raids, and the raid picked.
  function self.shown() return shownRows, shownRaids, selected end

  function self.show() window.show() end
  function self.hide() window.hide() end
  function self.toggle() window.toggle() end
  function self.isShown() return window.isShown() end
  self.window = window
  self.parts = {
    searchLabel = searchLabel, searchBox = searchBox, clearButton = clearButton, count = count, raidsHead = raidsHead, heads = heads,
    status = status, hint = hint, raidList = raidList, awardList = awardList, emptyLine = emptyLine,
  }

  self.update({})
  window.frame:Hide()
  return self
end
