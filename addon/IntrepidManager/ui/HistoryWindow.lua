-- Intrepid Manager: the loot history window (/im history, and History in the loot session window). Frames only: it shows the
-- history it was given (core/History.lua builds it from the awards log), filters it as the loot master types and picks, and calls
-- the callbacks it was given.
--
-- Top: the search box (a player, an item, a dungeon or raid, or a date), the Raider dropdown (one winner, with a find box) and the
-- Dates dropdown (the last 7, 30 or 90 days, or one month). Left, the nights, newest first: an evening of loot wherever it was, with
-- its raids under it when it had more than one (Molten Core, then Onyxia's Lair). "All raids" is first; with a filter, only the
-- nights and raids with an award that passes it are listed. Right, the awards of the night or raid picked, newest first: when, the
-- item, the winner, the raid, and whether it was given or taken back. Hovering an award shows the item's tooltip and the award in
-- full (winner, time, raid, boss, how decided, how given). Export, bottom right, asks the engine for the awards string of the night
-- or raid picked: all of its awards, whatever the filters, for the Raid Desk.
--
-- Both lists draw only the lines on screen, so ten thousand awards cost no more frames than twenty.
--
-- The view-model (read only; the engine builds it):
--   vm = {
--     history = History.build(log, clock),   -- the rows, the raids and the nights
--     year    = 2026,                        -- this year: older rows show their year instead of the time
--     today   = 20796,                       -- History.dayNumber of today, for "the last 7 days"
--     limit   = 10000,                       -- how many awards the log keeps
--     search  = "dec 9",                     -- optional: put in the search box when the window opens
--   }
--
-- The callbacks (each in kit.safe):
--   export(pick)   Export was pressed; pick = { kind = "night" or "raid", key = its key, label = its label }

local _, ns = ...

local HistoryWindow = {}
ns.UI = ns.UI or {}
ns.UI.HistoryWindow = HistoryWindow

local NAME = "IntrepidManagerHistory"
local VISIBLE = 20 -- award lines on screen; the night list shows half as many, two lines each
local CHOICES = 12 -- lines of a dropdown's list
local HINT = "Only this account's awards. Pick a night or a raid on the left, then Export to copy just that one for the Raid Desk."
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

-- Where an award stands, in full: "Given in a trade, 9:47 PM", "Awarded, not given yet" or "Taken back".
function HistoryWindow.stateText(row)
  if row.removed then return "Taken back" end
  if not row.received then return "Awarded, not given yet" end
  local text = "Given"
  if row.givenHow then text = text .. " " .. row.givenHow end
  if row.givenWhen then text = text .. ", " .. row.givenWhen end
  return text
end

-- The lines of an award's tooltip under the item: { label, value } pairs, then the note (nil when there is none).
function HistoryWindow.details(row)
  local lines = {}
  local function add(label, value)
    if value and value ~= "" then lines[#lines + 1] = { label, value } end
  end
  add("Winner", row.to)
  add("When", row.when)
  add("Raid", row.raid and row.raid.label or row.placeText)
  add("Boss", row.encounter)
  add("Decided by", row.how)
  add("State", HistoryWindow.stateText(row))
  return lines, row.note
end

-- Who voted for whom on an award, one line per raider voted for, the most votes first: "Mirelle Dunmore (2): Bram Tollet, Ness
-- Coyle". Empty when the session had no votes on it. The votes stay in the game (the export leaves them out).
function HistoryWindow.votesLines(row)
  local lines = {}
  for _, vote in ipairs(row.votes or {}) do
    local by = vote.by or {}
    lines[#lines + 1] = tostring(vote.to) .. " (" .. #by .. "): " .. table.concat(by, ", ")
  end
  return lines
end

-- Does the game know the item? An item it doesn't know (the demo's invented ones, an id the game never had) gets the award's own
-- title instead of the game's item tooltip, which would be empty.
function HistoryWindow.knownItem(itemId)
  if type(itemId) ~= "number" then return false end
  local instant = C_Item and C_Item.GetItemInfoInstant -- the probe saw it answer on this client
  if not instant then return true end -- no way to ask: try the item's link
  return instant(itemId) ~= nil
end

-- The tooltip of one award: the game's tooltip of the item when it knows the item (else the item's name), then the award.
function HistoryWindow.showTooltip(tip, owner, row, colors)
  tip:SetOwner(owner, "ANCHOR_RIGHT")
  if HistoryWindow.knownItem(row.itemId) then
    tip:SetHyperlink("item:" .. string.format("%.0f", row.itemId))
    tip:AddLine(" ")
  else
    local gold = colors.gold
    tip:SetText(row.item, gold[1], gold[2], gold[3])
  end
  local lines, note = HistoryWindow.details(row)
  local label, value = colors.muted, colors.text
  for _, pair in ipairs(lines) do
    local right = value
    if pair[1] == "State" then right = row.removed and colors.bad or (row.received and colors.good or colors.muted) end
    tip:AddDoubleLine(pair[1], pair[2], label[1], label[2], label[3], right[1], right[2], right[3])
  end
  if note then tip:AddLine(note, value[1], value[2], value[3], true) end
  local votes = HistoryWindow.votesLines(row)
  if #votes > 0 then
    tip:AddLine("Votes", label[1], label[2], label[3])
    for _, line in ipairs(votes) do tip:AddLine(line, value[1], value[2], value[3], true) end
  end
  tip:Show()
end

-- The second line of a raid under its night, or of a night: "8:05 PM to 10:40 PM", "8:05 PM" for a single time, "" with no time.
function HistoryWindow.raidSpan(raid)
  if not raid.time then return "" end
  if raid.lastTime and raid.lastTime ~= raid.time then return raid.time .. " to " .. raid.lastTime end
  return raid.time
end

-- The second line of a night in the list: its raid ("Molten Core, 8:05 PM"), or, as its raids are listed under it, how many and
-- when ("2 raids, 8:05 PM to 11:40 PM").
function HistoryWindow.nightLine(night)
  local raids = night.raids or {}
  if #raids == 1 then return HistoryWindow.raidLine(raids[1]) end
  local span = HistoryWindow.raidSpan(night)
  return string.format("%.0f", #raids) .. " raids" .. (span ~= "" and (", " .. span) or "")
end

-- The list on the left: All raids, then every night with an award in `counts` (or picked) and, under a night of more than one
-- raid, those of its raids with an award in `counts` (or picked). Each entry is { all = true }, { night = n } or { raid = r },
-- with its count. `counts` is History.raidCounts of the awards that pass the filters, `total` their number.
function HistoryWindow.entries(history, counts, total, selected)
  local list = { { all = true, count = total } }
  for _, night in ipairs(history.nights or {}) do
    local n = counts[night] or 0
    local picked = selected ~= nil and (selected == night or selected.night == night)
    if n > 0 or picked then
      list[#list + 1] = { night = night, count = n }
      if #night.raids > 1 then
        for _, raid in ipairs(night.raids) do
          local count = counts[raid] or 0
          if count > 0 or raid == selected then list[#list + 1] = { raid = raid, count = count } end
        end
      end
    end
  end
  return list
end

-- Does every word start a word of `text`? (The dropdown's find box: "jor" finds Jorren Ashvale, "ash" too.)
function HistoryWindow.startsWords(text, words)
  local hay = " " .. table.concat(ns.History.words(text), " ")
  for _, word in ipairs(words) do
    if not string.find(hay, " " .. word, 1, true) then return false end
  end
  return true
end

function HistoryWindow.new(kit, callbacks)
  callbacks = callbacks or {}
  local m, colors = kit.m, kit.colors
  local History = ns.History
  local self = {}

  local function call(name, ...)
    local callback = callbacks[name]
    if callback then return callback(...) end
  end

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
  local headsTop = searchTop + math.max(m.input, m.button) + gap * 2
  local listTop = headsTop + header
  local statusTop = listTop + listHeight + gap
  local statusHeight = math.max(header, m.button)
  local hintTop = statusTop + statusHeight + gap
  local height = hintTop + header + pad + 28
  local rowWidth = rightWidth - m.bar - 2
  local leftRowWidth = leftWidth - m.bar - 2
  local whenWidth, whoWidth, raidWidth, stateWidth = math.floor(104 * scale), math.floor(110 * scale), math.floor(120 * scale), math.floor(66 * scale)
  local itemWidth = rowWidth - whenWidth - whoWidth - raidWidth - stateWidth - gap * 6
  local countWidth = 44
  local indent = gap * 3 -- a raid under its night
  local dayWidth = leftRowWidth - countWidth - gap * 3
  local placeWidth = leftRowWidth - gap * 2
  local searchWidth, raiderWidth, datesWidth = math.floor(190 * scale), math.floor(170 * scale), math.floor(150 * scale)
  local exportWidth = math.floor(110 * scale)

  local window = kit.window({ name = NAME, title = "Loot history", width = width, height = height })
  local body = window.body

  -- the heads
  local raidsHead = kit.label(body, "NIGHTS AND RAIDS", { font = "gold", width = leftWidth })
  raidsHead:SetPoint("TOPLEFT", pad, -headsTop)
  local heads = {}
  local x = rightX + gap
  for _, column in ipairs({ { "WHEN", whenWidth }, { "ITEM", itemWidth }, { "WINNER", whoWidth }, { "RAID", raidWidth }, { "STATE", stateWidth } }) do
    local head = kit.label(body, column[1], { color = colors.muted, width = column[2] })
    head:SetPoint("TOPLEFT", x, -headsTop)
    heads[#heads + 1] = head
    x = x + column[2] + gap
  end

  local status = kit.label(body, "", { width = inner - exportWidth - gap * 2 })
  status:SetPoint("TOPLEFT", pad, -statusTop - math.floor((statusHeight - header) / 2))
  local exportButton = kit.button(body, "Export", { width = exportWidth })
  exportButton:SetPoint("TOPRIGHT", -pad, -statusTop)
  local hint = kit.label(body, HINT, { width = inner, color = colors.muted })
  hint:SetPoint("TOPLEFT", pad, -hintTop)

  -- A list that draws only the lines on screen: `lines` frames, filled by paint(frame, index) with index nil for a line past the end.
  -- The mouse wheel moves it three lines at a time; a thin bar shows where it is.
  local function pagedList(parent, listWidth, lineHeight, lines, make, paint)
    local list = { offset = 0, total = 0, lines = {} }
    local frame = CreateFrame("Frame", nil, parent)
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
  local current = { history = { rows = {}, raids = {}, nights = {} }, year = 0, limit = 0 }
  local selected -- the night or the raid picked, or nil for all of them
  local raider, period -- the filters picked: a winner as the rows write it, a choice of History.periods; nil for all
  local paintAll

  -- A dropdown: a button that says what is picked and, under it, a list to pick from, with a find box when `spec.find`. One is open
  -- at a time; picking, its button again, Clear, and opening the window close it.
  -- spec = { title, width, popupWidth, find, choices() -> { { text, count, value, current, always } }, pick(choice) }
  local dropdowns = {}
  local function dropdown(spec)
    local dd = {}
    local button = kit.button(body, spec.title, { width = spec.width })
    local popupWidth = spec.popupWidth
    local listWidth = popupWidth - gap * 2
    local lineWidth = listWidth - m.bar - 2
    local textWidth = lineWidth - countWidth - gap * 3
    local findHeight = spec.find and (m.input + gap * 2) or 0
    local popup = CreateFrame("Frame", nil, window.frame)
    popup:SetFrameStrata("FULLSCREEN_DIALOG")
    popup:SetSize(popupWidth, findHeight + CHOICES * rowHeight + gap * 2)
    popup:SetPoint("TOPLEFT", button, "BOTTOMLEFT", 0, -2)
    popup:EnableMouse(true) -- a click on it never reaches the window under it
    kit.fill(popup, colors.thumb)
    local inside = popup:CreateTexture(nil, "BORDER")
    inside:SetPoint("TOPLEFT", 1, -1)
    inside:SetPoint("BOTTOMRIGHT", -1, 1)
    inside:SetColorTexture(colors.window[1], colors.window[2], colors.window[3], 1)

    local find
    if spec.find then
      local findLabel = kit.label(popup, "Find", { width = 30, color = colors.muted })
      findLabel:SetPoint("TOPLEFT", gap * 2, -gap - 2)
      find = kit.input(popup, { width = popupWidth - 30 - gap * 7, maxLetters = 40 })
      find:SetPoint("TOPLEFT", gap * 3 + 30, -gap)
    end

    local shown = {}
    local list = pagedList(popup, listWidth, rowHeight, CHOICES, function(parent, index)
      local line = {}
      local frame = CreateFrame("Button", nil, parent)
      frame:SetSize(lineWidth, rowHeight)
      frame:SetPoint("TOPLEFT", 0, -(index - 1) * rowHeight)
      kit.fill(frame, index % 2 == 1 and colors.panel or colors.panelAlt)
      line.selected = frame:CreateTexture(nil, "ARTWORK")
      line.selected:SetAllPoints()
      line.selected:SetColorTexture(colors.selected[1], colors.selected[2], colors.selected[3], 1)
      line.text = kit.label(frame, "", { width = textWidth })
      line.text:SetPoint("LEFT", gap, 0)
      line.count = kit.label(frame, "", { width = countWidth, justify = "RIGHT", color = colors.muted })
      line.count:SetPoint("RIGHT", -gap, 0)
      frame:SetScript("OnClick", kit.safe(function()
        local choice = line.choice
        if not choice then return end
        dd.close()
        spec.pick(choice)
      end))
      line.frame = frame
      return line
    end, function(line, index)
      local choice = index and shown[index]
      line.choice = choice
      line.frame:SetShown(choice ~= nil)
      if not choice then return end
      line.text:SetText(kit.fit(choice.text, textWidth))
      line.count:SetText(choice.count and number(choice.count) or "")
      line.selected:SetShown(choice.current == true)
    end)
    list.frame:SetPoint("TOPLEFT", gap, -(gap + findHeight))

    local function refresh()
      local words = History.words(find and find:GetText() or "")
      shown = {}
      for _, choice in ipairs(spec.choices()) do
        if choice.always or HistoryWindow.startsWords(choice.text, words) then shown[#shown + 1] = choice end
      end
      -- as tall as its choices, up to CHOICES lines (then it scrolls)
      local lines = math.max(1, math.min(CHOICES, #shown))
      list.frame:SetHeight(lines * rowHeight)
      popup:SetHeight(findHeight + lines * rowHeight + gap * 2)
      list.set(#shown)
    end

    function dd.close() popup:Hide() end
    function dd.open()
      for _, other in ipairs(dropdowns) do
        if other ~= dd then other.close() end
      end
      if find then find:SetText("") end
      refresh()
      popup:Show()
      if find then find:SetFocus() end
    end
    function dd.isOpen() return popup:IsShown() end
    function dd.say(text) button:SetText(kit.fit(spec.title .. ": " .. text, spec.width - 14)) end
    button:SetScript("OnClick", kit.safe(function()
      if popup:IsShown() then dd.close() else dd.open() end
    end))
    if find then find:SetScript("OnTextChanged", kit.safe(function() refresh() end)) end
    popup:Hide()
    dd.button, dd.popup, dd.find, dd.list = button, popup, find, list
    dropdowns[#dropdowns + 1] = dd
    return dd
  end

  -- top: the search and the filters
  local searchLabel = kit.label(body, "Search", { width = 46 })
  searchLabel:SetPoint("TOPLEFT", pad, -searchTop - 1)
  local searchBox = kit.input(body, { width = searchWidth, maxLetters = 60 })
  searchBox:SetPoint("TOPLEFT", pad + 46 + gap * 2, -searchTop)
  local raiderDrop = dropdown({
    title = "Raider", width = raiderWidth, popupWidth = math.floor(240 * scale), find = true,
    choices = function()
      local list = { { text = "All raiders", count = #current.history.rows, always = true, current = raider == nil } }
      for _, winner in ipairs(History.winners(current.history)) do
        list[#list + 1] = { text = winner.name, value = winner.name, count = winner.count, current = winner.name == raider }
      end
      return list
    end,
    pick = function(choice)
      raider = choice.value
      paintAll()
    end,
  })
  raiderDrop.button:SetPoint("TOPLEFT", searchBox, "TOPRIGHT", gap * 3, 1)
  local datesDrop = dropdown({
    title = "Dates", width = datesWidth, popupWidth = math.floor(180 * scale),
    choices = function()
      local list, now = {}, period and period.label or "Any date"
      for _, choice in ipairs(History.periods(current.history)) do
        list[#list + 1] = { text = choice.label, value = (choice.days or choice.year) and choice or nil, current = choice.label == now }
      end
      return list
    end,
    pick = function(choice)
      period = choice.value
      paintAll()
    end,
  })
  datesDrop.button:SetPoint("TOPLEFT", raiderDrop.button, "TOPRIGHT", gap * 2, 0)
  local clearButton = kit.button(body, "Clear", { width = 56 })
  clearButton:SetPoint("TOPLEFT", datesDrop.button, "TOPRIGHT", gap * 2, 0)
  local count = kit.label(body, "", { width = 180, justify = "RIGHT", color = colors.muted })
  count:SetPoint("TOPRIGHT", -pad, -searchTop - 1)

  -- the list on the left: "All raids", then each night (and the raids of a night of more than one) on two lines
  local function setColor(label, color) label:SetTextColor(color[1], color[2], color[3]) end
  local raidLines = math.floor(VISIBLE / 2)
  local raidList = pagedList(body, leftWidth, rowHeight * 2, raidLines, function(parent, index)
    local line = {}
    local frame = CreateFrame("Button", nil, parent)
    frame:SetSize(leftRowWidth, rowHeight * 2)
    frame:SetPoint("TOPLEFT", 0, -(index - 1) * rowHeight * 2)
    kit.fill(frame, index % 2 == 1 and colors.panel or colors.panelAlt)
    line.selected = frame:CreateTexture(nil, "ARTWORK")
    line.selected:SetAllPoints()
    line.selected:SetColorTexture(colors.selected[1], colors.selected[2], colors.selected[3], 1)
    line.day = kit.label(frame, "", { font = "gold", width = dayWidth })
    line.day:SetPoint("TOPLEFT", gap, -1)
    line.count = kit.label(frame, "", { width = countWidth, justify = "RIGHT", color = colors.muted })
    line.count:SetPoint("TOPRIGHT", -gap, -1)
    line.place = kit.label(frame, "", { width = placeWidth })
    line.place:SetPoint("TOPLEFT", gap, -rowHeight + 1)
    frame:SetScript("OnClick", kit.safe(function()
      local entry = line.entry
      if not entry then return end
      for _, each in ipairs(dropdowns) do each.close() end
      selected = entry.night or entry.raid -- nil for All raids
      paintAll(false, true)
    end))
    line.frame = frame
    return line
  end, function(line, index)
    local entry = index and shownRaids[index]
    line.entry = entry
    line.frame:SetShown(entry ~= nil)
    if not entry then return end
    local shift = entry.raid and indent or 0
    line.day:ClearAllPoints()
    line.day:SetPoint("TOPLEFT", gap + shift, -1)
    line.day:SetWidth(dayWidth - shift)
    line.place:ClearAllPoints()
    line.place:SetPoint("TOPLEFT", gap + shift, -rowHeight + 1)
    line.place:SetWidth(placeWidth - shift)
    if entry.all then
      line.selected:SetShown(selected == nil)
      line.day:SetText("All raids")
      line.place:SetText(kit.fit(awards(entry.count), placeWidth))
      line.count:SetText("")
      setColor(line.day, colors.gold)
      setColor(line.place, colors.text)
    elseif entry.night then
      line.selected:SetShown(entry.night == selected)
      line.day:SetText(kit.fit(entry.night.day, dayWidth))
      line.place:SetText(kit.fit(HistoryWindow.nightLine(entry.night), placeWidth))
      line.count:SetText(number(entry.count))
      setColor(line.day, colors.gold)
      setColor(line.place, colors.text)
    else
      line.selected:SetShown(entry.raid == selected)
      line.day:SetText(kit.fit(entry.raid.placeText, dayWidth - shift))
      line.place:SetText(kit.fit(HistoryWindow.raidSpan(entry.raid), placeWidth - shift))
      line.count:SetText(number(entry.count))
      setColor(line.day, colors.text)
      setColor(line.place, colors.muted)
    end
  end)
  raidList.frame:SetPoint("TOPLEFT", pad, -listTop)

  -- the award list (right)
  local awardList = pagedList(body, rightWidth, rowHeight, VISIBLE, function(parent, index)
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
      if line.row then HistoryWindow.showTooltip(GameTooltip, self_, line.row, colors) end
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

  -- Filter, list the nights and raids that have a match, and paint both lists. `keepPlace`: a repaint, not a new filter (both
  -- lists stay where they were scrolled to); `keepLeft`: a night or raid was picked (the list on the left stays where it was).
  paintAll = function(keepPlace, keepLeft)
    local history = current.history
    local filter = { text = searchBox:GetText() or "", to = raider, period = period, today = current.today }
    local all = History.filter(history, filter)
    if selected then
      filter.raid = selected.kind == "raid" and selected or nil
      filter.night = selected.kind == "night" and selected or nil
      shownRows = History.filter(history, filter)
    else
      shownRows = all
    end
    shownRaids = HistoryWindow.entries(history, History.raidCounts(all), #all, selected)
    raidList.set(#shownRaids, keepPlace or keepLeft)
    awardList.set(#shownRows, keepPlace)
    count:SetText(HistoryWindow.countText(#shownRows, #history.rows))
    raiderDrop.say(raider or "All")
    datesDrop.say(period and period.label or "Any")
    if selected then
      exportButton:SetText(selected.kind == "night" and "Export night" or "Export raid")
      exportButton:Enable()
    else
      exportButton:SetText("Export")
      exportButton:Disable()
    end
    if #history.rows == 0 then
      emptyLine:SetText(EMPTY)
    elseif #shownRows == 0 then
      emptyLine:SetText(NOTHING)
    else
      emptyLine:SetText("")
    end
  end

  local function closeDropdowns()
    for _, each in ipairs(dropdowns) do each.close() end
  end

  searchBox:SetScript("OnTextChanged", kit.safe(function() paintAll() end))
  clearButton:SetScript("OnClick", kit.safe(function()
    selected, raider, period = nil, nil, nil
    closeDropdowns()
    searchBox:SetText("")
    searchBox:ClearFocus()
    paintAll()
  end))
  exportButton:SetScript("OnClick", kit.safe(function()
    if not selected then return end
    closeDropdowns()
    call("export", { kind = selected.kind, key = selected.key, label = selected.label })
  end))

  -- Show this history. The search text and the filters stay, and so does the night or raid picked when the new history still has it.
  function self.update(vm)
    vm = vm or {}
    current = {
      history = vm.history or { rows = {}, raids = {}, nights = {} }, year = vm.year or 0, limit = vm.limit or 0, today = vm.today,
    }
    if selected then
      local kind, key = selected.kind, selected.key
      selected = nil
      for _, entry in ipairs((kind == "night" and current.history.nights or current.history.raids) or {}) do
        if entry.key == key then selected = entry end
      end
    end
    status:SetText(HistoryWindow.status(current))
    paintAll(true)
  end

  -- Open with this history: a search given in the view-model replaces the one in the box, and the night or raid picked is forgotten.
  function self.open(vm)
    vm = vm or {}
    selected = nil
    closeDropdowns()
    if vm.search ~= nil then searchBox:SetText(vm.search) end
    self.update(vm)
    raidList.set(#shownRaids)
    awardList.set(#shownRows)
    window.show()
  end

  -- What the lists show (for the tests and the pictures): the rows, the entries on the left, the night or raid picked, and the
  -- filters (the raider's name, the period).
  function self.shown() return shownRows, shownRaids, selected, raider, period end

  function self.show() window.show() end
  function self.hide() window.hide() end
  function self.toggle() window.toggle() end
  function self.isShown() return window.isShown() end
  self.window = window
  self.parts = {
    searchLabel = searchLabel, searchBox = searchBox, clearButton = clearButton, count = count, raidsHead = raidsHead, heads = heads,
    status = status, hint = hint, raidList = raidList, awardList = awardList, emptyLine = emptyLine, exportButton = exportButton,
    raiderButton = raiderDrop.button, raiderPopup = raiderDrop.popup, raiderFind = raiderDrop.find, raiderList = raiderDrop.list,
    datesButton = datesDrop.button, datesPopup = datesDrop.popup, datesList = datesDrop.list,
  }

  self.update({})
  window.frame:Hide()
  return self
end
