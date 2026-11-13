-- Intrepid Manager: the loot master's session window. Frames only: it shows the model it is given and calls the callbacks it was
-- given; game/CouncilSession keeps the session.
--
-- On the left the items of the session, one line each (picture, name in the color of its quality, how many answered, and before the
-- start a button to take it out); a click picks the item whose answers the right side shows. Below them the timer, and the button
-- that starts the session. On the right the answers to the picked item, best claim first, each raider's name in the color of their
-- class (the hello tells it), the answer, and the note. While the session runs the times and answers update every second; when it
-- is over the button starts a new one.
--
-- The model (read only; the session builds it):
--   model = {
--     state = "none" | "building" | "running" | "closed", timer = 60, remaining = 42 (running only), responders = 3,
--     hellos = 5, group = 8, pending = 2 (awarded and not given yet), notice = "a warning for the status line" (or nil),
--     practice = true (a practice session, started outside a group: nothing was sent, and its awards are not logged) or nil,
--     answers = 7, expected = 9 (once started: answers so far, and raiders asked times items),
--     items = { { n, item, name, quality, icon, counts = { b, u, o, p, total }, asked = 3 (once started), winner = "who it was
--                 awarded to", given = true, source = "where it drops: Boss, Dungeon" (or nil) }, ... },
--   }
--
-- The callbacks (each in pcall):
--   model()               the model as it is now (called every second while the window is shown)
--   rows(n)               the answers to item n: { { who, code, label, note, class, winner, given }, ... }
--   bags()                the button "Add from bags" was pressed
--   remove(n)             take item n out of the queue
--   start(seconds)        Start was pressed with this timer
--   finish()              End was pressed
--   reset()               New session was pressed (after the end)
--   award(n, who)         the Award button of an answer: item n goes to this raider (nothing is traded yet)
--   unaward(n)            the x next to the winner: take the award of item n back
--   trade(who)            the Trade button of the winner: trade this raider everything that is awarded to them
--   versions()            the Versions button: ask the group which version of the addon each has, and show the answers
--   importNight()         the Import night button: open the window that takes the night string of the Raid Desk
--   exportAwards()        the Export awards button: open the window with the awards string for the Raid Desk
--
-- Above the answers, one line says how the picked item was answered once the session runs, and where it drops when that is known.
--
-- SessionPanel.statusText(model), SessionPanel.countsText(counts) and SessionPanel.detailText(counts, source) are the sentences, for the tests.

local _, ns = ...

local SessionPanel = {}
ns.UI = ns.UI or {}
ns.UI.SessionPanel = SessionPanel

local NAME = "IntrepidManagerLootSession"
local VISIBLE = 12
local HINT = "Add the items you want to hand out with Add from bags, then press Start. Raiders who have the addon are offered them "
  .. "with a timer and answer in their own window; their answers show here."
local CLAIM_SHADES = { b = "gold", u = "good", o = "warn", p = "muted" }

-- "7/9 responses logged": every raider's answer to every item counts one; a model without the count says how many answered.
function SessionPanel.loggedText(model)
  if type(model.expected) == "number" and model.expected > 0 then
    return (model.answers or 0) .. "/" .. model.expected .. " responses logged"
  end
  return (model.responders or 0) .. " answered"
end

-- "Running - 42 s left - 7/24 responses logged - 5 of 8 have the addon"; a practice session (started outside a group) begins with
-- "Practice - ".
function SessionPanel.statusText(model)
  local items = #(model.items or {})
  local practice = model.practice and "Practice - " or ""
  if model.state == "running" then
    local text = practice .. "Running - " .. string.format("%.0f", model.remaining or 0) .. " s left - " .. SessionPanel.loggedText(model)
    if not model.practice and model.group and model.group > 0 then
      text = text .. " - " .. (model.hellos or 0) .. " of " .. model.group .. " have the addon"
    end
    if (model.pending or 0) > 0 then text = text .. " - " .. model.pending .. " awarded" end
    return text
  end
  if model.state == "closed" then
    local text = practice .. "Over - " .. SessionPanel.loggedText(model)
    if (model.pending or 0) > 0 then text = text .. " - " .. model.pending .. " to trade" end
    return text
  end
  if items == 0 then return "Nothing queued yet." end
  return items .. (items == 1 and " item" or " items") .. " queued. The timer is " .. (model.timer or 60) .. " seconds."
end

-- The count at the right of an item in the list: its answers out of the raiders asked ("2/5"), "won" or "given".
function SessionPanel.itemCount(data)
  if data.given then return "given" end
  if data.winner then return "won" end
  local total = (data.counts and data.counts.total) or 0
  if type(data.asked) == "number" and data.asked > 0 then return total .. "/" .. data.asked end
  return tostring(total)
end

-- "BiS 1   Upgrade 2   Off-spec 0   Pass 1".
function SessionPanel.countsText(counts)
  counts = counts or {}
  return "BiS " .. (counts.b or 0) .. "   Upgrade " .. (counts.u or 0) .. "   Off-spec " .. (counts.o or 0) .. "   Pass " .. (counts.p or 0)
end

-- The line above the answers: the counts (or nothing before the start), then where the item drops.
function SessionPanel.detailText(counts, source)
  local text = counts and SessionPanel.countsText(counts) or ""
  if type(source) == "string" and source ~= "" then
    text = (text ~= "" and (text .. "   ") or "") .. "From " .. source
  end
  return text
end

function SessionPanel.new(kit, callbacks)
  callbacks = callbacks or {}
  local m, colors = kit.m, kit.colors
  local self = {}

  local function call(name, ...)
    local callback = callbacks[name]
    if callback then return callback(...) end
  end

  -- the numbers everything else is placed by
  local pad, gap, header = m.pad, m.gap, m.header
  local width = 700
  local inner = width - 10 - pad * 2
  local leftWidth = 250
  local rightX = pad + leftWidth + gap * 2
  local rightWidth = inner - leftWidth - gap * 2
  local topRow = m.button
  local listTop = pad + topRow + gap
  local itemRow = m.itemRow
  local listHeight = itemRow * VISIBLE
  local leftRowWidth = leftWidth - m.bar - 2
  local iconSize = itemRow - 4
  local removeSize = itemRow - 4
  local countWidth = 44
  local nameWidth = leftRowWidth - iconSize - removeSize - countWidth - gap * 4
  local countsTop = listTop
  local headsTop = countsTop + header + gap
  local tableTop = headsTop + header
  local tableHeight = listHeight - (tableTop - listTop)
  local rowHeight = m.row
  local statusTop = listTop + listHeight + gap
  local barTop = statusTop + header + gap * 2
  local height = barTop + m.button + pad + 28
  local rightRowWidth = rightWidth - m.bar - 2
  local classSize = m.icon
  local whoWidth, claimWidth = 130, 84
  local actionWidth, undoWidth = 52, 18
  local noteWidth = rightRowWidth - whoWidth - claimWidth - actionWidth - undoWidth - gap * 5

  local window = kit.window({
    name = NAME, title = "Loot session", width = width, height = height, chrome = "clear", anchor = { point = "TOPLEFT", x = 40, y = -90 },
  })
  local body = window.body

  -- left: the items
  local itemsHead = kit.label(body, "ITEMS", { font = "gold", width = 90 })
  itemsHead:SetPoint("TOPLEFT", pad, -pad - 2)
  local addButton = kit.button(body, "Add from bags", { width = 110 })
  addButton:SetPoint("TOPLEFT", pad + leftWidth - 110, -pad)
  local leftList = kit.scrollList(body, leftWidth, listHeight)
  leftList.frame:SetPoint("TOPLEFT", pad, -listTop)

  -- right: the answers
  local versionsWidth = 76
  local answersHeadWidth = rightWidth - versionsWidth - gap
  local answersHead = kit.label(body, "ANSWERS", { font = "gold", width = answersHeadWidth })
  answersHead:SetPoint("TOPLEFT", rightX, -pad - 2)
  local versionsButton = kit.button(body, "Versions", { width = versionsWidth })
  versionsButton:SetPoint("TOPRIGHT", -pad, -pad)
  local status = kit.label(body, "", { width = inner })
  status:SetPoint("TOPLEFT", pad, -statusTop)
  local countsLine = kit.label(body, "", { width = rightWidth })
  countsLine:SetPoint("TOPLEFT", rightX, -countsTop)
  local headWho = kit.label(body, "RAIDER", { color = colors.muted, width = whoWidth })
  headWho:SetPoint("TOPLEFT", rightX + gap, -headsTop)
  local headClaim = kit.label(body, "ANSWER", { color = colors.muted, width = claimWidth })
  headClaim:SetPoint("TOPLEFT", rightX + gap + whoWidth + gap, -headsTop)
  local headNote = kit.label(body, "NOTE", { color = colors.muted, width = noteWidth })
  headNote:SetPoint("TOPLEFT", rightX + gap + whoWidth + gap + claimWidth + gap, -headsTop)
  -- "Hide no response", at the right of the column heads: the raiders who have not answered the item are listed unless it is ticked
  -- (it stays as it is for the login)
  local hideWidth = 122
  local hideMissing = kit.check(body, "Hide no response")
  hideMissing:SetPoint("TOPLEFT", rightX + rightWidth - hideWidth, -headsTop + 1)
  local rightList = kit.scrollList(body, rightWidth, tableHeight)
  rightList.frame:SetPoint("TOPLEFT", rightX, -tableTop)
  local hint = kit.label(body, HINT, { wrap = true, width = rightWidth - gap * 2, color = colors.muted })
  hint:SetPoint("TOPLEFT", rightX + gap, -countsTop)

  -- bottom: the timer and the buttons
  local timerLabel = kit.label(body, "Timer", { width = 40 })
  timerLabel:SetPoint("TOPLEFT", pad, -barTop - 2)
  local timerBox = kit.input(body, { width = 44, maxLetters = 3 })
  timerBox:SetPoint("TOPLEFT", pad + 46, -barTop)
  timerBox:SetText("60")
  local secondsLabel = kit.label(body, "seconds", { width = 60, color = colors.muted })
  secondsLabel:SetPoint("TOPLEFT", pad + 46 + 44 + gap, -barTop - 2)
  local importButton = kit.button(body, "Import night", { width = 92 })
  importButton:SetPoint("TOPLEFT", pad + 46 + 44 + gap + 60 + gap * 3, -barTop)
  local exportButton = kit.button(body, "Export awards", { width = 100 })
  exportButton:SetPoint("TOPLEFT", importButton, "TOPRIGHT", gap, 0)
  local startButton = kit.button(body, "Start session", { primary = true, width = 110 })
  startButton:SetPoint("TOPRIGHT", -pad, -barTop)
  local endButton = kit.button(body, "End session", { width = 110 })
  endButton:SetPoint("TOPRIGHT", -pad, -barTop)
  local newButton = kit.button(body, "New session", { primary = true, width = 110 })
  newButton:SetPoint("TOPRIGHT", -pad, -barTop)

  local leftRows, rightRows = {}, {}
  local current = { state = "none", items = {} }
  local selected

  local function makeLeftRow(index)
    local row = {}
    local frame = CreateFrame("Button", nil, leftList.content)
    frame:SetSize(leftRowWidth, itemRow)
    frame:SetPoint("TOPLEFT", 0, -(index - 1) * itemRow)
    kit.fill(frame, index % 2 == 1 and colors.panel or colors.panelAlt)
    row.selected = frame:CreateTexture(nil, "ARTWORK")
    row.selected:SetAllPoints()
    row.selected:SetColorTexture(colors.selected[1], colors.selected[2], colors.selected[3], 1)
    row.selected:Hide()
    row.icon = kit.icon(frame, iconSize, 1, nil)
    row.icon:SetPoint("LEFT", gap, 0)
    row.name = kit.label(frame, "", { width = nameWidth })
    row.name:SetPoint("LEFT", row.icon, "RIGHT", gap, 0)
    row.count = kit.label(frame, "", { width = countWidth, justify = "RIGHT", color = colors.muted })
    row.count:SetPoint("LEFT", row.name, "RIGHT", gap, 0)
    row.remove = kit.button(frame, "x", { width = removeSize })
    row.remove:SetHeight(removeSize)
    row.remove:SetPoint("RIGHT", -gap, 0)
    frame:SetScript("OnClick", kit.safe(function()
      local data = row.data
      if not data then return end
      selected = data.n
      self.paintRight()
      self.paintLeft()
    end))
    frame:SetScript("OnEnter", kit.safe(function(self_)
      if not row.data then return end
      GameTooltip:SetOwner(self_, "ANCHOR_RIGHT")
      GameTooltip:SetHyperlink(row.data.item)
      GameTooltip:Show()
    end))
    frame:SetScript("OnLeave", kit.safe(function() GameTooltip:Hide() end))
    row.remove:SetScript("OnClick", kit.safe(function()
      if row.data then call("remove", row.data.n) end
      local fresh = call("model")
      if fresh then self.update(fresh) end
    end))
    row.frame = frame
    leftRows[index] = row
    return row
  end

  local function makeRightRow(index)
    local row = {}
    local frame = CreateFrame("Frame", nil, rightList.content)
    frame:SetSize(rightRowWidth, rowHeight)
    frame:SetPoint("TOPLEFT", 0, -(index - 1) * rowHeight)
    kit.fill(frame, index % 2 == 1 and colors.panel or colors.panelAlt)
    row.winnerBg = frame:CreateTexture(nil, "ARTWORK")
    row.winnerBg:SetAllPoints()
    row.winnerBg:SetColorTexture(colors.selected[1], colors.selected[2], colors.selected[3], 1)
    row.winnerBg:Hide()
    row.classIcon = frame:CreateTexture(nil, "ARTWORK")
    row.classIcon:SetSize(classSize, classSize)
    row.classIcon:SetPoint("LEFT", gap, 0)
    row.who = kit.label(frame, "", { width = whoWidth - classSize - gap })
    row.who:SetPoint("LEFT", row.classIcon, "RIGHT", gap, 0)
    row.claim = kit.label(frame, "", { width = claimWidth })
    row.claim:SetPoint("LEFT", frame, "LEFT", gap + whoWidth + gap, 0)
    row.note = kit.label(frame, "", { width = noteWidth, color = colors.muted })
    row.note:SetPoint("LEFT", row.claim, "RIGHT", gap, 0)
    row.undo = kit.button(frame, "x", { width = undoWidth })
    row.undo:SetHeight(rowHeight - 2)
    row.undo:SetPoint("RIGHT", -gap, 0)
    row.award = kit.button(frame, "Award", { width = actionWidth })
    row.award:SetHeight(rowHeight - 2)
    row.award:SetPoint("RIGHT", row.undo, "LEFT", -gap, 0)
    row.trade = kit.button(frame, "Trade", { width = actionWidth, primary = true })
    row.trade:SetHeight(rowHeight - 2)
    row.trade:SetPoint("RIGHT", row.undo, "LEFT", -gap, 0)
    row.given = kit.label(frame, "given", { width = actionWidth + undoWidth + gap, justify = "RIGHT", color = colors.good })
    row.given:SetPoint("RIGHT", -gap, 0)
    row.award:SetScript("OnClick", kit.safe(function()
      if row.answer and selected then call("award", selected, row.answer.who) end
      local fresh = call("model")
      if fresh then self.update(fresh) end
    end))
    row.trade:SetScript("OnClick", kit.safe(function()
      if row.answer then call("trade", row.answer.who) end
      local fresh = call("model")
      if fresh then self.update(fresh) end
    end))
    row.undo:SetScript("OnClick", kit.safe(function()
      if row.answer and selected then call("unaward", selected) end
      local fresh = call("model")
      if fresh then self.update(fresh) end
    end))
    row.frame = frame
    rightRows[index] = row
    return row
  end

  function self.paintLeft()
    local building = current.state == "none" or current.state == "building"
    for i, data in ipairs(current.items) do
      local row = leftRows[i] or makeLeftRow(i)
      row.data = data
      row.frame:Show()
      kit.setIcon(row.icon, data.quality or 1, data.icon)
      local color = ns.UI.Kit.qualityColor(data.quality or 1)
      row.name:SetText(kit.fit(data.n .. ". " .. (data.name or "?"), nameWidth))
      row.name:SetTextColor(color[1], color[2], color[3])
      row.count:SetText(building and "" or SessionPanel.itemCount(data))
      local shade = data.given and colors.good or (data.winner and colors.gold or colors.muted)
      row.count:SetTextColor(shade[1], shade[2], shade[3])
      row.remove:SetShown(building)
      row.selected:SetShown(selected == data.n)
    end
    for i = #current.items + 1, #leftRows do
      leftRows[i].data = nil
      leftRows[i].frame:Hide()
    end
    leftList.setContentHeight(#current.items * itemRow)
  end

  function self.paintRight()
    local data
    for _, item in ipairs(current.items) do
      if item.n == selected then data = item end
    end
    local rows = data and call("rows", data.n) or {}
    hint:SetShown(#current.items == 0)
    answersHead:SetText(data and ("ANSWERS - " .. kit.fit(data.name or "?", answersHeadWidth - 70)) or "ANSWERS")
    local started = current.state ~= "none" and current.state ~= "building"
    countsLine:SetText(data and kit.fit(SessionPanel.detailText(started and (data.counts or {}) or nil, data.source), rightWidth) or "")
    hideMissing:SetShown(started)
    hideMissing.label:SetShown(started)
    -- with the box ticked, the rows of raiders who have not answered are left out (never the winner's)
    if hideMissing:GetChecked() == true then
      local shown = {}
      for _, answer in ipairs(rows) do
        if not answer.missing or answer.winner then shown[#shown + 1] = answer end
      end
      rows = shown
    end
    local tradable = current.state == "running" or current.state == "closed"
    local itemGiven = data ~= nil and data.given
    for i, answer in ipairs(rows) do
      local row = rightRows[i] or makeRightRow(i)
      row.answer = answer
      row.frame:Show()
      -- anyone can be awarded the item until it is given; the winner has Trade and a way to take the award back, then "given"
      row.award:SetShown(tradable and not answer.winner and not itemGiven)
      row.trade:SetShown(tradable and answer.winner and not answer.given or false)
      row.undo:SetShown(tradable and answer.winner and not answer.given or false)
      row.given:SetShown(answer.winner and answer.given or false)
      row.winnerBg:SetShown(answer.winner or false)
      local color = ns.UI.Kit.classColor(answer.class)
      row.who:SetText(kit.fit(answer.who, whoWidth - classSize - gap))
      local file = ns.UI.Kit.classIconFile(answer.class)
      if file then row.classIcon:SetTexture(file) end
      row.classIcon:SetShown(file ~= nil)
      row.who:SetTextColor(color[1], color[2], color[3])
      row.claim:SetText(answer.label)
      local shade = colors[answer.missing and "muted" or (CLAIM_SHADES[answer.code] or "text")]
      row.claim:SetTextColor(shade[1], shade[2], shade[3])
      row.note:SetText(kit.fit(answer.note or "", noteWidth))
    end
    for i = #rows + 1, #rightRows do
      rightRows[i].answer = nil
      rightRows[i].frame:Hide()
    end
    rightList.setContentHeight(#rows * rowHeight)
  end

  function self.update(model)
    current = model or { state = "none", items = {} }
    current.items = current.items or {}
    if selected == nil or not current.items[selected] then selected = current.items[1] and current.items[1].n or nil end
    local state = current.state
    local building = state == "none" or state == "building"
    local words = SessionPanel.statusText(current)
    if current.notice then words = current.notice end
    status:SetText(kit.fit(words, inner))
    local shade = current.notice and colors.bad or (state == "running" and colors.good or colors.muted)
    status:SetTextColor(shade[1], shade[2], shade[3])
    startButton:SetShown(building)
    startButton:SetEnabled(#current.items > 0)
    endButton:SetShown(state == "running")
    newButton:SetShown(state == "closed")
    timerBox:SetEnabled(building)
    if building and not timerBox:HasFocus() then timerBox:SetText(tostring(current.timer or 60)) end
    addButton:SetEnabled(building)
    self.paintLeft()
    self.paintRight()
  end

  addButton:SetScript("OnClick", kit.safe(function() call("bags") end))
  versionsButton:SetScript("OnClick", kit.safe(function() call("versions") end))
  hideMissing:SetScript("OnClick", kit.safe(function() self.paintRight() end))
  importButton:SetScript("OnClick", kit.safe(function() call("importNight") end))
  exportButton:SetScript("OnClick", kit.safe(function() call("exportAwards") end))
  startButton:SetScript("OnClick", kit.safe(function()
    local seconds = tonumber(timerBox:GetText())
    if not seconds or seconds < ns.Council.MIN_TIMER or seconds > ns.Council.MAX_TIMER then
      status:SetText("The timer is " .. ns.Council.MIN_TIMER .. " to " .. ns.Council.MAX_TIMER .. " seconds.")
      status:SetTextColor(colors.bad[1], colors.bad[2], colors.bad[3])
      return
    end
    call("start", seconds)
    local fresh = call("model")
    if fresh then self.update(fresh) end
  end))
  endButton:SetScript("OnClick", kit.safe(function()
    call("finish")
    local fresh = call("model")
    if fresh then self.update(fresh) end
  end))
  newButton:SetScript("OnClick", kit.safe(function()
    call("reset")
    selected = nil
    local fresh = call("model")
    if fresh then self.update(fresh) end
  end))

  -- A second at a time while the window is shown, the time and the answers are read again.
  local ticking = 0
  local function tick(token)
    if token ~= ticking or not window.isShown() then return end
    local fresh = call("model")
    if fresh then self.update(fresh) end
    C_Timer.After(1, function() tick(token) end)
  end
  window.frame:SetScript("OnShow", kit.safe(function()
    ticking = ticking + 1
    tick(ticking)
  end))
  window.frame:SetScript("OnHide", function() ticking = ticking + 1 end)

  window.hide()

  function self.show() window.show() end
  function self.hide() window.hide() end
  function self.isShown() return window.isShown() end
  function self.selected() return selected end
  self.frame = window.frame
  self.parts = {
    window = window, itemsHead = itemsHead, answersHead = answersHead, status = status, countsLine = countsLine, hint = hint, hideMissing = hideMissing,
    add = addButton, versions = versionsButton, importNight = importButton, exportAwards = exportButton, start = startButton, finish = endButton, new = newButton, timer = timerBox, leftList = leftList,
    rightList = rightList, leftRows = leftRows, rightRows = rightRows,
  }
  self.metrics = { width = width, height = height, itemRow = itemRow, rowHeight = rowHeight, visible = VISIBLE }
  return self
end
