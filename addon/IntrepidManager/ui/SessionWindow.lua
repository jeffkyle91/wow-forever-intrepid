-- Intrepid Manager: the loot session window. Frames only: it reads a view-model and calls the callbacks it was given, and
-- never touches the game's loot API.
--
-- Left: the items of the session, one small line each. Right: the selected item and the priority list for it, one small
-- line per player (the line is as tall as the player's name text, so a long list fits and scrolls), the recipient, the
-- decision, the buttons, a banner for what needs attention and a status line.
--
-- The view-model (read only; the engine builds it):
--   vm = {
--     summary  = "2 of 4 awarded",
--     items    = { { index, name, quality, icon, state = "open" | "awarded" | "removed" | "left" | "giving", to } },
--     selected = index of the selected item, or nil,
--     item     = {                                   -- the selected item
--       index, name, quality, ilvl, icon, source, state, to,
--       blocks = { { note, lines = { { kind = "char" | "name" | "note", pos, name, class, role,
--                                       here = "here" | "away" | "offline" | "received" | "unmatched",
--                                       awarded, eligible, candidate, text } } } },
--       candidates = { { name, class, role }, ... },  -- who the game would let this item go to (for Pick)
--       warnings = { "text" }, nextInLine = "First Surname",
--       attempt  = { state = "waiting" | "unconfirmed" | "failed", who, reason },
--     },
--     observed = { { id, who, item } },               -- gives the game made that we did not start; the first one is shown
--     status = "text", busy = false,
--   }
--
-- The callbacks (all optional; each is called in pcall):
--   select(index)                          an item was chosen
--   preview(index, who)                    -> { ok, recipient, warnings, lines } or { ok = false, reason }
--   give(index, who, options)              the loot master confirmed; options = { decision, note }
--   pseudo(index, "disenchant" | "guild-bank"), remove(index), restore(index), finish()
--   retry(index, who), markReceived(index, who)
--   confirmObserved(id), dismissObserved(id)

local _, ns = ...

local SessionWindow = {}
ns.UI = ns.UI or {}
ns.UI.SessionWindow = SessionWindow

local NAME = "IntrepidManagerSession"
local DECISIONS = { { "council", "Council" }, { "roll", "Roll" }, { "other", "Other" } }
local STATE_TEXT = { awarded = "given", removed = "removed", left = "left", giving = "giving..." }

local function trim(text)
  return (string.gsub(text or "", "^%s*(.-)%s*$", "%1"))
end

function SessionWindow.new(kit, callbacks)
  callbacks = callbacks or {}
  local m, colors = kit.m, kit.colors
  local Kit = ns.UI.Kit
  local self = {}

  local function call(name, ...)
    local callback = callbacks[name]
    if callback then return callback(...) end
  end

  -- the numbers everything else is placed by
  local width, height = m.windowWidth, m.windowHeight
  local bodyWidth, bodyHeight = width - 10, height - 28
  local pad, gap = m.pad, m.gap
  local panelHeight = bodyHeight - pad * 2 - m.header - gap
  local leftWidth = m.leftWidth
  local rightWidth = bodyWidth - leftWidth - pad * 3
  local controlsHeight = 4 * 2 + 3 * m.button + 2 * gap
  local headBottom = pad + m.headIcon + 4
  local tableTop = headBottom + m.header
  local listTop = tableTop + m.header
  local listHeight = panelHeight - listTop - controlsHeight - gap
  local listWidth = rightWidth - pad * 2

  local window = kit.window({ name = NAME, title = "Intrepid Manager - Loot", width = width, height = height })
  local body = window.body

  -------------------------------------------------------------------------------------------------------------
  -- Left: the items
  -------------------------------------------------------------------------------------------------------------
  local left = CreateFrame("Frame", nil, body)
  left:SetSize(leftWidth, panelHeight)
  left:SetPoint("TOPLEFT", pad, -pad)
  kit.fill(left, colors.side)
  kit.label(left, "ITEMS", { font = "gold" }):SetPoint("TOPLEFT", 6, -3)
  local progress = kit.label(left, "", { font = "gold", justify = "RIGHT", width = leftWidth - 56, color = colors.muted })
  progress:SetPoint("TOPRIGHT", -6, -3)
  local itemList = kit.scrollList(left, leftWidth - 4, panelHeight - m.header - 6)
  itemList.frame:SetPoint("TOPLEFT", 2, -(m.header + 4))
  local emptyItems = kit.label(itemList.content, "No items yet", { color = colors.muted, width = leftWidth - 16 })
  emptyItems:SetPoint("TOPLEFT", 6, -4)

  local itemRows = {}
  local function itemRow(index)
    if itemRows[index] then return itemRows[index] end
    local row = CreateFrame("Frame", nil, itemList.content)
    row:SetSize(itemList.content:GetWidth(), m.itemRow)
    row:SetPoint("TOPLEFT", 0, -(index - 1) * m.itemRow)
    row.selected = kit.fill(row, colors.selected)
    row.hover = kit.fill(row, colors.hover, "OVERLAY")
    row.hover:Hide()
    row.icon = kit.icon(row, m.icon, 1, nil)
    row.icon:SetPoint("LEFT", 3, 0)
    row.state = kit.label(row, "", { width = 54, justify = "RIGHT", color = colors.muted })
    row.state:SetPoint("RIGHT", -4, 0)
    row.name = kit.label(row, "", { width = row:GetWidth() - m.icon - 9 - 58 })
    row.name:SetPoint("LEFT", m.icon + 9, 0)
    row:EnableMouse(true)
    row:SetScript("OnEnter", function() row.hover:Show() end)
    row:SetScript("OnLeave", function() row.hover:Hide() end)
    itemRows[index] = row
    return row
  end

  -------------------------------------------------------------------------------------------------------------
  -- Right: the item, its priority list, the controls
  -------------------------------------------------------------------------------------------------------------
  local right = CreateFrame("Frame", nil, body)
  right:SetSize(rightWidth, panelHeight)
  right:SetPoint("TOPLEFT", left, "TOPRIGHT", pad, 0)
  kit.fill(right, colors.panel)

  local headIcon = kit.icon(right, m.headIcon, 1, nil)
  headIcon:SetPoint("TOPLEFT", pad, -pad)
  local textLeft = pad + m.headIcon + 8
  local headName = kit.label(right, "", { font = "title", width = rightWidth - textLeft - pad })
  headName:SetPoint("TOPLEFT", textLeft, -pad)
  local headInfo = kit.label(right, "", { color = colors.muted, width = rightWidth - textLeft - pad })
  headInfo:SetPoint("TOPLEFT", textLeft, -(pad + m.header + 2))
  local noteLabel = kit.label(right, "", { color = colors.muted, width = rightWidth - pad * 2 })
  noteLabel:SetPoint("TOPLEFT", pad, -headBottom)

  local columns = { { "#", 0, m.colPos, "RIGHT" }, { "Player", m.colPos + 6, m.colName }, { "Role", m.colPos + m.colName + 10, m.colRole },
    { "Here", m.colPos + m.colName + m.colRole + 14, m.colHere } }
  local headings = {}
  for i, column in ipairs(columns) do
    local heading = kit.label(right, column[1], { font = "gold", width = column[3], justify = column[4] })
    heading:SetPoint("TOPLEFT", pad + column[2], -tableTop)
    headings[i] = heading
  end

  local priorities = kit.scrollList(right, listWidth, listHeight)
  priorities.frame:SetPoint("TOPLEFT", pad, -listTop)
  kit.fill(priorities.frame, colors.panelAlt)
  local emptyList = kit.label(priorities.content, "", { color = colors.muted, width = listWidth - 20 })
  emptyList:SetPoint("TOPLEFT", 8, -4)

  local lineRows = {}
  local display = {}        -- what the rows show, in order: { kind = "header" | "char" | "name" | "note", ... }
  local selectedRow         -- index into display
  local recipient           -- the edit box, made below
  local vm                  -- the view-model on show
  local hintText            -- a message from the last click (no recipient, a refused give), shown in the banner until the next click
  local showBanner          -- defined below

  local function setRecipient(text)
    recipient:SetText(text or "")
  end

  local function paintRows()
    for i, row in ipairs(lineRows) do
      local line = display[i]
      if line then
        local color = (i == selectedRow) and colors.selected or ((i % 2 == 0) and colors.panelAlt or colors.panel)
        row.bg:SetColorTexture(color[1], color[2], color[3], 1)
      end
    end
  end

  local function selectRow(index)
    local line = display[index]
    if not line or (line.kind ~= "char" and line.kind ~= "name") then return end
    selectedRow = index
    setRecipient(line.candidate or line.name or "")
    if hintText then
      hintText = nil
      if vm then showBanner() end
    end
    paintRows()
  end

  local function lineRow(index)
    if lineRows[index] then return lineRows[index] end
    local row = CreateFrame("Frame", nil, priorities.content)
    row:SetSize(priorities.content:GetWidth(), m.row)
    row:SetPoint("TOPLEFT", 0, -(index - 1) * m.row)
    row.bg = kit.fill(row, colors.panel)
    row.hover = kit.fill(row, colors.hover, "OVERLAY")
    row.hover:Hide()
    row.pos = kit.label(row, "", { width = m.colPos, justify = "RIGHT", color = colors.muted })
    row.pos:SetPoint("LEFT", 0, 0)
    row.name = kit.label(row, "", { width = m.colName })
    row.name:SetPoint("LEFT", m.colPos + 6, 0)
    row.role = kit.label(row, "", { width = m.colRole })
    row.role:SetPoint("LEFT", m.colPos + m.colName + 10, 0)
    row.here = kit.label(row, "", { width = m.colHere })
    row.here:SetPoint("LEFT", m.colPos + m.colName + m.colRole + 14, 0)
    row.span = kit.label(row, "", { width = priorities.content:GetWidth() - m.colPos - 12 })
    row.span:SetPoint("LEFT", m.colPos + 6, 0)
    row:EnableMouse(true)
    row:SetScript("OnMouseDown", kit.safe(function() selectRow(index) end))
    row:SetScript("OnEnter", function() if display[index] and (display[index].kind == "char" or display[index].kind == "name") then row.hover:Show() end end)
    row:SetScript("OnLeave", function() row.hover:Hide() end)
    lineRows[index] = row
    return row
  end

  -- one line of the table
  local HERE = { here = colors.good, away = colors.warn, offline = colors.muted, received = colors.gold, unmatched = colors.bad }
  local function paintLine(row, line)
    local isSpan = line.kind == "header" or line.kind == "note"
    row.pos:SetShown(not isSpan)
    row.name:SetShown(not isSpan)
    row.role:SetShown(not isSpan)
    row.here:SetShown(not isSpan)
    row.span:SetShown(isSpan)
    if isSpan then
      row.span:SetText(line.text or "")
      local color = line.kind == "header" and colors.gold or colors.muted
      row.span:SetTextColor(color[1], color[2], color[3])
      return
    end
    row.pos:SetText(line.pos or "")
    local name = line.name or "?"
    row.name:SetText(name)
    local color = Kit.classColor(line.class)
    if line.eligible == false then color = colors.muted end
    row.name:SetTextColor(color[1], color[2], color[3])
    row.role:SetText(line.role or "?")
    local status = line.awarded and "received" or line.here
    row.here:SetText(status or "")
    local statusColor = HERE[status] or colors.muted
    row.here:SetTextColor(statusColor[1], statusColor[2], statusColor[3])
  end

  -- Controls, from the bottom: who gets it, the decision, the other actions.
  local controls = CreateFrame("Frame", nil, right)
  controls:SetSize(rightWidth, controlsHeight)
  controls:SetPoint("BOTTOMLEFT", 0, 0)
  local function lineY(n) return -(4 + (n - 1) * (m.button + gap)) end
  local labelWidth = 56

  local giveToLabel = kit.label(controls, "Give to:", { color = colors.muted, width = labelWidth })
  giveToLabel:SetPoint("TOPLEFT", pad, lineY(1) - 1)
  recipient = kit.input(controls, { width = 170, maxLetters = 40 })
  recipient:SetPoint("TOPLEFT", pad + labelWidth, lineY(1) - 1)
  local pickButton = kit.button(controls, "Pick...", { width = 54 })
  pickButton:SetPoint("TOPLEFT", pad + labelWidth + 174, lineY(1))
  local giveButton = kit.button(controls, "Give", { primary = true, width = 64 })
  giveButton:SetPoint("TOPLEFT", pad + labelWidth + 174 + 58, lineY(1))

  local decisionLabel = kit.label(controls, "Decision:", { color = colors.muted, width = labelWidth })
  decisionLabel:SetPoint("TOPLEFT", pad, lineY(2) - 1)
  local checks = {}
  local decision = "council"
  local function setDecision(value)
    decision = value
    for _, check in ipairs(checks) do check:SetChecked(check.value == value) end
  end
  for i, choice in ipairs(DECISIONS) do
    local check = kit.check(controls, choice[2])
    check.value = choice[1]
    check:SetPoint("TOPLEFT", pad + labelWidth + (i - 1) * 74, lineY(2) - 1)
    check:SetScript("OnClick", kit.safe(function() setDecision(choice[1]) end))
    checks[i] = check
  end
  setDecision("council")
  local noteLabelX = pad + labelWidth + 3 * 74 + 6
  kit.label(controls, "Note:", { color = colors.muted, width = 40 }):SetPoint("TOPLEFT", noteLabelX, lineY(2) - 1)
  local noteInput = kit.input(controls, { width = rightWidth - noteLabelX - 44 - pad, maxLetters = 100 })
  noteInput:SetPoint("TOPLEFT", noteLabelX + 44, lineY(2) - 1)

  local disenchantButton = kit.button(controls, "Disenchant", { width = 84 })
  disenchantButton:SetPoint("TOPLEFT", pad, lineY(3))
  local bankButton = kit.button(controls, "Guild bank", { width = 78 })
  bankButton:SetPoint("TOPLEFT", pad + 88, lineY(3))
  local removeButton = kit.button(controls, "Remove", { width = 64 })
  removeButton:SetPoint("TOPLEFT", pad + 88 + 82, lineY(3))
  local finishButton = kit.button(controls, "Finish session", { width = 100 })
  finishButton:SetPoint("TOPRIGHT", -pad, lineY(3))

  -- The banner above the controls: a give that was not confirmed, a failure, a give we did not start, a warning.
  local banner = CreateFrame("Frame", nil, right)
  banner:SetSize(listWidth, m.banner)
  banner:SetPoint("BOTTOMLEFT", pad, controlsHeight)
  kit.fill(banner, colors.banner)
  -- The text takes the width the buttons leave, three lines at most; the buttons stand one above the other at the right.
  local bannerButton = 108
  local bannerTextWidth = listWidth - bannerButton - 24
  local bannerText = kit.label(banner, "", { width = bannerTextWidth, wrap = true })
  bannerText:SetPoint("TOPLEFT", 8, -4)
  bannerText:SetJustifyV("TOP")
  bannerText:SetMaxLines(3)
  local bannerFirst = kit.button(banner, "", { primary = true, width = bannerButton })
  bannerFirst:SetPoint("TOPRIGHT", -6, -4)
  local bannerSecond = kit.button(banner, "", { width = bannerButton })
  bannerSecond:SetPoint("TOPRIGHT", -6, -(4 + m.button + gap))

  local status = kit.label(body, "", { color = colors.muted, width = bodyWidth - pad * 2 })
  status:SetPoint("BOTTOMLEFT", pad, 4)

  -------------------------------------------------------------------------------------------------------------
  -- Popups
  -------------------------------------------------------------------------------------------------------------
  local confirm = ns.UI.Confirm.new(kit)
  local picker = ns.UI.Picker.new(kit)

  -------------------------------------------------------------------------------------------------------------
  -- Showing a view-model
  -------------------------------------------------------------------------------------------------------------

  local function flatten(item)
    local rows = {}
    for _, block in ipairs(item.blocks or {}) do
      if #item.blocks > 1 then
        rows[#rows + 1] = { kind = "header", text = (block.note ~= nil and block.note ~= "") and block.note or "Priority" }
      end
      for _, line in ipairs(block.lines or {}) do rows[#rows + 1] = line end
    end
    return rows
  end

  local function showItems()
    local items = vm.items or {}
    progress:SetText(vm.summary or "")
    emptyItems:SetShown(#items == 0)
    for i, entry in ipairs(items) do
      local row = itemRow(i)
      local color = Kit.qualityColor(entry.quality)
      row.name:SetText(entry.name or "?")
      row.name:SetTextColor(color[1], color[2], color[3])
      kit.setIcon(row.icon, entry.quality, entry.icon)
      row.selected:SetShown(entry.index == vm.selected)
      local text = STATE_TEXT[entry.state] or ""
      if entry.state == "awarded" and entry.to then text = string.match(entry.to, "^%S+") or entry.to end
      row.state:SetText(text)
      local stateColor = (entry.state == "awarded") and colors.good or ((entry.state == "giving") and colors.warn or colors.muted)
      row.state:SetTextColor(stateColor[1], stateColor[2], stateColor[3])
      row:SetScript("OnMouseDown", kit.safe(function() call("select", entry.index) end))
      row:Show()
    end
    for i = #items + 1, #itemRows do itemRows[i]:Hide() end
    itemList.setContentHeight(#items * m.itemRow)
  end

  local function showItem()
    local item = vm.item
    local has = item ~= nil
    headIcon:SetShown(has)
    if not has then
      headName:SetText("")
      headInfo:SetText(#(vm.items or {}) == 0 and "Items appear here when you loot as Master Looter." or "Pick an item on the left.")
      noteLabel:SetText("")
      display, selectedRow = {}, nil
    else
      local color = Kit.qualityColor(item.quality)
      headName:SetText(item.name or "?")
      headName:SetTextColor(color[1], color[2], color[3])
      kit.setIcon(headIcon, item.quality, item.icon)
      local info = {}
      if item.ilvl then info[#info + 1] = "Item level " .. item.ilvl end
      if item.source then info[#info + 1] = "From " .. item.source end
      if item.state == "awarded" then
        info[#info + 1] = "Given to " .. (item.to or "someone")
      elseif item.nextInLine then
        info[#info + 1] = "Next in line: " .. item.nextInLine
      end
      headInfo:SetText(table.concat(info, "   "))
      local firstNote = item.blocks and item.blocks[1] and item.blocks[1].note
      noteLabel:SetText(firstNote and firstNote ~= "" and ("Note: " .. firstNote) or "")
      display = flatten(item)
    end

    for i, line in ipairs(display) do
      local row = lineRow(i)
      paintLine(row, line)
      row:Show()
    end
    for i = #display + 1, #lineRows do lineRows[i]:Hide() end
    emptyList:SetText(has and #display == 0 and "No priority list for this item. Pick a player below." or "")
    priorities.setContentHeight(#display * m.row)
    priorities.scrollTo(0)
    selectedRow = nil
    paintRows()
  end

  showBanner = function()
    local item = vm.item
    local attempt = item and item.attempt
    local text, first, second, firstCall, secondCall
    local index, who = item and item.index, attempt and attempt.who
    if attempt and (attempt.state == "unconfirmed" or attempt.state == "failed") then
      if attempt.state == "unconfirmed" then
        text = Kit.colored(colors.bad, "Not confirmed.") .. " The game did not say " .. (who or "the recipient") ..
          " received it (a full bag is the usual reason). Ask them to free a slot, then press Retry."
        first, second = "Retry", "Mark received"
        firstCall = function() call("retry", index, who) end
        secondCall = function() call("markReceived", index, who) end
      else
        text = Kit.colored(colors.bad, "Could not give.") .. " " .. (attempt.reason or "The game refused.")
        first, firstCall = "Retry", function() call("retry", index, who) end
      end
    elseif vm.observed and vm.observed[1] then
      local seen = vm.observed[1]
      text = Kit.colored(colors.gold, "Seen:") .. " " .. (seen.who or "someone") .. " received " .. (seen.item or "an item") ..
        " and this window did not give it. Record it?"
      first, second = "Record", "Dismiss"
      firstCall = function() call("confirmObserved", seen.id) end
      secondCall = function() call("dismissObserved", seen.id) end
    elseif hintText then
      text = Kit.colored(colors.warn, "Note:") .. " " .. hintText
    elseif item and item.warnings and item.warnings[1] then
      text = Kit.colored(colors.warn, "Note:") .. " " .. item.warnings[1]
    end
    if not text then
      banner:Hide()
      priorities.setViewHeight(listHeight)
      return
    end
    bannerText:SetText(text)
    bannerText:SetWidth(first and bannerTextWidth or listWidth - 16) -- the whole width when there are no buttons
    bannerFirst:SetShown(first ~= nil)
    bannerSecond:SetShown(second ~= nil)
    if first then
      bannerFirst:SetText(first)
      bannerFirst:SetScript("OnClick", kit.safe(firstCall))
    end
    if second then
      bannerSecond:SetText(second)
      bannerSecond:SetScript("OnClick", kit.safe(secondCall))
    end
    banner:Show()
    priorities.setViewHeight(listHeight - m.banner - gap)
  end

  local function showControls()
    local item = vm.item
    local open = item ~= nil and (item.state == "open" or item.state == nil)
    local busy = vm.busy == true
    local function enable(button, on)
      if on then button:Enable() else button:Disable() end
    end
    enable(giveButton, open and not busy)
    enable(pickButton, open and not busy)
    enable(disenchantButton, open and not busy)
    enable(bankButton, open and not busy)
    enable(removeButton, item ~= nil and not busy)
    removeButton:SetText(item and item.state == "removed" and "Restore" or "Remove")
    enable(finishButton, not busy and #(vm.items or {}) > 0)
  end

  function self.update(model)
    local before = vm and vm.item and vm.item.index
    vm = model or { items = {} }
    if not (vm.item and vm.item.index == before) then hintText = nil end
    showItems()
    showItem()
    showBanner()
    showControls()
    status:SetText(vm.status or "")
  end

  -------------------------------------------------------------------------------------------------------------
  -- What the buttons do
  -------------------------------------------------------------------------------------------------------------
  local function currentIndex() return vm and vm.item and vm.item.index end

  local function hintAt(message)
    hintText = message
    showBanner()
  end

  giveButton:SetScript("OnClick", kit.safe(function()
    local index, who = currentIndex(), trim(recipient:GetText())
    if not index then return end
    hintAt(nil)
    if who == "" then
      hintAt("Pick a player first.")
      return
    end
    local preview = call("preview", index, who)
    if preview and preview.ok == false then
      hintAt(preview.reason or "That player cannot get it.")
      return
    end
    local item = vm.item
    local chosen = who
    local line = display[selectedRow or 0]
    local lines = {}
    lines[#lines + 1] = "Decision: " .. decision .. (trim(noteInput:GetText()) ~= "" and ("   Note: " .. trim(noteInput:GetText())) or "")
    for _, extra in ipairs(preview and preview.lines or {}) do lines[#lines + 1] = extra end
    confirm.ask({
      item = Kit.colored(Kit.qualityColor(item.quality), item.name or "?"), quality = item.quality, icon = item.icon,
      recipient = Kit.colored(Kit.classColor(line and line.class), (preview and preview.recipient) or who),
      warnings = preview and preview.warnings or nil, lines = lines,
    }, function()
      call("give", index, chosen, { decision = decision, note = trim(noteInput:GetText()) })
    end)
  end))

  pickButton:SetScript("OnClick", kit.safe(function()
    local item = vm and vm.item
    if not item then return end
    picker.open(item.candidates or {}, function(entry) setRecipient(entry.name) end)
  end))

  disenchantButton:SetScript("OnClick", kit.safe(function() if currentIndex() then call("pseudo", currentIndex(), "disenchant") end end))
  bankButton:SetScript("OnClick", kit.safe(function() if currentIndex() then call("pseudo", currentIndex(), "guild-bank") end end))
  removeButton:SetScript("OnClick", kit.safe(function()
    local item = vm and vm.item
    if not item then return end
    call(item.state == "removed" and "restore" or "remove", item.index)
  end))
  finishButton:SetScript("OnClick", kit.safe(function() call("finish") end))

  -- Escape closes the window and the popups together: the game closes every shown frame whose name is in its list.
  function self.show() window.show() end
  function self.hide() window.hide() end
  function self.toggle() window.toggle() end
  function self.isShown() return window.isShown() end
  function self.selectLine(index) selectRow(index) end
  self.window, self.confirm, self.picker = window, confirm, picker
  self.parts = {
    recipient = recipient, giveButton = giveButton, pickButton = pickButton, banner = banner, bannerText = bannerText,
    noteInput = noteInput, itemList = itemList, priorities = priorities, status = status, headName = headName,
    headInfo = headInfo, noteLabel = noteLabel, finishButton = finishButton, removeButton = removeButton,
    bannerFirst = bannerFirst, bannerSecond = bannerSecond, disenchantButton = disenchantButton, bankButton = bankButton,
    checks = checks, progress = progress, itemRows = itemRows, lineRows = lineRows, headings = headings,
    emptyItems = emptyItems, headIcon = headIcon, emptyList = emptyList,
  }
  self.update({ items = {} })
  return self
end
