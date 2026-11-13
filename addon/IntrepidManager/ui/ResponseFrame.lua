-- Intrepid Manager: the raider's answer frame. Frames only: it shows the items on offer from the model it is given and calls the
-- callbacks it was given; game/CouncilSession decides what is on offer and sends the answers.
--
-- One row per item: its picture (hover for the item's tooltip), its name in the color of its quality, the time left or the
-- answer given, four buttons (Best in slot, Upgrade, Off-spec, Pass) and Add note. Add note (Edit note once there is one) opens a
-- small box for the note of that item: Save (or Enter) keeps it and Cancel (or Escape) leaves it as it was. A note written before
-- the answer goes with it; a note changed after the answer is sent again with it. The note shows under the buttons. An answer
-- can be changed until the time is up and keeps its note; the button of the answer given is the one that is dimmed.
--
-- The model (read only; the session builds it):
--   model = {
--     master = "Jorren Ashvale",          -- who offers (or "you" when the loot master is this player)
--     rows = { { sid, n, count, item, name, quality, icon, remaining (seconds), state ("open", "answered", "closed"),
--                myCode, myLabel, myNote, note (the item's note, sent or waiting for the answer, or nil) }, ... },
--   }
--
-- The callbacks (each in pcall):
--   model()                                 the model as it is now (called every second while the frame is shown)
--   answer(sid, n, code)                    a button was pressed (the item's note goes with it)
--   note(sid, n, text)                      a note was saved ("" takes it out)
--
-- ResponseFrame.statusText(row) is the words at the right of a row, for the tests.

local _, ns = ...

local ResponseFrame = {}
ns.UI = ns.UI or {}
ns.UI.ResponseFrame = ResponseFrame

local NAME = "IntrepidManagerOffers"
local NOTE_NAME = "IntrepidManagerNote"
local VISIBLE = 5 -- rows in view; more scroll
local BUTTON_WIDTH = 80
local NOTE_BUTTON_WIDTH = 70
local NOTE_LETTERS = 80 -- the wire's limit for a note (net/CouncilWire MAX_NOTE)

-- The line under a row's buttons: the note, and whether it is still waiting for the answer.
function ResponseFrame.noteText(row)
  if type(row.note) ~= "string" or row.note == "" then return "" end
  if row.myCode then return "Note: " .. row.note end
  return "Note: " .. row.note .. " (goes with your answer)"
end

-- The words at the right of a row and the name of the color they take ("good", "warn", "muted" or "text").
function ResponseFrame.statusText(row)
  if row.state == "closed" or (row.remaining or 0) <= 0 then
    if row.myCode then return "You answered: " .. (row.myLabel or "?"), "muted" end
    return "Time is up", "muted"
  end
  if row.myCode then return string.format("%.0f", row.remaining) .. " s - you answered: " .. (row.myLabel or "?"), "good" end
  return string.format("%.0f", row.remaining) .. " s", row.remaining <= 10 and "warn" or "text"
end

function ResponseFrame.new(kit, callbacks)
  callbacks = callbacks or {}
  local m, colors = kit.m, kit.colors
  local Council = ns.Council
  local self = {}

  local function call(name, ...)
    local callback = callbacks[name]
    if callback then return callback(...) end
  end

  -- the numbers everything else is placed by
  local pad, gap, header = m.pad, m.gap, m.header
  local iconSize = m.headIcon
  local rowHeight = gap * 4 + header * 2 + m.button
  local buttonsWidth = #Council.RESPONSES * (BUTTON_WIDTH + gap) + NOTE_BUTTON_WIDTH
  local width = math.max(480, 10 + pad * 2 + m.bar + 2 + gap + iconSize + gap + buttonsWidth + gap)
  local inner = width - 10 - pad * 2
  local rowWidth = inner - m.bar - 2
  local statusWidth = 190
  local nameWidth = rowWidth - iconSize - gap * 3 - statusWidth
  local noteWidth = rowWidth - iconSize - gap * 3
  local fromTop = pad
  local listTop = fromTop + header + gap
  -- the frame is as tall as its rows (one row at least, five at most; more scroll)
  local function listHeightFor(count) return rowHeight * math.min(math.max(count, 1), VISIBLE) end
  local function heightFor(count) return listTop + listHeightFor(count) + pad + 28 end

  local window = kit.window({
    name = NAME, title = "Loot offered", width = width, height = heightFor(1), chrome = "clear",
    anchor = { point = "TOPRIGHT", x = -40, y = -90 },
  })
  local body = window.body

  local from = kit.label(body, "", { width = inner, color = colors.gold })
  from:SetPoint("TOPLEFT", pad, -fromTop)

  local list = kit.scrollList(body, inner, listHeightFor(1))
  list.frame:SetPoint("TOPLEFT", pad, -listTop)

  local rows = {}
  local current = { rows = {} }

  local function refresh()
    local fresh = call("model")
    if fresh then self.update(fresh) end
  end

  local function answer(row, code)
    local data = row.data
    if not data then return end
    call("answer", data.sid, data.n, code)
    refresh()
  end

  -- The note box: one item's note, opened by its Note button. Save (or Enter) keeps it, Cancel (or Escape) leaves it as it was.
  local popupWidth = m.popupWidth
  local popupInner = popupWidth - 12 - pad * 2
  local noteTop = pad + header + gap
  local noteHintTop = noteTop + m.input + gap
  local noteButtonsTop = noteHintTop + header + gap
  local popup = kit.window({
    name = NOTE_NAME, title = "Note", width = popupWidth, height = 24 + noteButtonsTop + m.button + pad + 6, strata = "FULLSCREEN_DIALOG",
  })
  local popupItem = kit.label(popup.body, "", { width = popupInner })
  popupItem:SetPoint("TOPLEFT", pad, -pad)
  local noteBox = kit.input(popup.body, { width = popupInner - 4, maxLetters = NOTE_LETTERS })
  noteBox:SetPoint("TOPLEFT", pad + 4, -noteTop)
  local popupHint = kit.label(popup.body, "", { width = popupInner, color = colors.muted })
  popupHint:SetPoint("TOPLEFT", pad, -noteHintTop)
  local saveButton = kit.button(popup.body, "Save", { primary = true, width = 90 })
  saveButton:SetPoint("TOPLEFT", (popupWidth - 12) / 2 - 90 - gap / 2, -noteButtonsTop)
  local cancelButton = kit.button(popup.body, "Cancel", { width = 90 })
  cancelButton:SetPoint("TOPLEFT", (popupWidth - 12) / 2 + gap / 2, -noteButtonsTop)
  local editing -- { sid, n } of the item whose note is open

  local function closeNote()
    editing = nil
    noteBox:ClearFocus()
    popup.hide()
  end
  local function saveNote()
    local target = editing
    local text = noteBox:GetText()
    closeNote()
    if target then call("note", target.sid, target.n, text) end
    refresh()
  end
  saveButton:SetScript("OnClick", kit.safe(saveNote))
  cancelButton:SetScript("OnClick", kit.safe(closeNote))
  noteBox:SetScript("OnEnterPressed", kit.safe(saveNote))
  noteBox:SetScript("OnEscapePressed", kit.safe(closeNote))
  popup.frame:HookScript("OnHide", function() editing = nil end)
  popup.hide()

  local function openNote(row)
    local data = row.data
    if not data then return end
    editing = { sid = data.sid, n = data.n }
    local color = ns.UI.Kit.qualityColor(data.quality or 1)
    popupItem:SetText(kit.fit(data.n .. ". " .. (data.name or "?"), popupInner))
    popupItem:SetTextColor(color[1], color[2], color[3])
    popupHint:SetText(data.myCode and "Saving sends your answer again with this note." or "The note goes with your answer.")
    noteBox:SetText(data.note or "")
    popup.show()
    noteBox:SetFocus()
    noteBox:HighlightText()
  end

  local function makeRow(index)
    local row = { index = index }
    local frame = CreateFrame("Frame", nil, list.content)
    frame:SetSize(rowWidth, rowHeight)
    frame:SetPoint("TOPLEFT", 0, -(index - 1) * rowHeight)
    kit.fill(frame, index % 2 == 1 and colors.panel or colors.panelAlt)
    row.frame = frame

    row.icon = kit.icon(frame, iconSize, 1, nil)
    row.icon:SetPoint("TOPLEFT", gap, -gap)
    row.icon:EnableMouse(true)
    row.icon:SetScript("OnEnter", kit.safe(function(self_)
      if not row.data then return end
      GameTooltip:SetOwner(self_, "ANCHOR_RIGHT")
      GameTooltip:SetHyperlink(row.data.item)
      GameTooltip:Show()
    end))
    row.icon:SetScript("OnLeave", kit.safe(function() GameTooltip:Hide() end))

    row.name = kit.label(frame, "", { width = nameWidth })
    row.name:SetPoint("TOPLEFT", row.icon, "TOPRIGHT", gap, 0)
    row.status = kit.label(frame, "", { width = statusWidth, justify = "RIGHT" })
    row.status:SetPoint("TOPRIGHT", -gap, -gap)

    row.buttons = {}
    for i, response in ipairs(Council.RESPONSES) do
      local button = kit.button(frame, response.short, { width = BUTTON_WIDTH })
      button:SetPoint("TOPLEFT", row.icon, "TOPRIGHT", gap + (i - 1) * (BUTTON_WIDTH + gap), -(header + gap))
      button:SetScript("OnClick", kit.safe(function() answer(row, response.code) end))
      row.buttons[i] = button
    end
    row.noteButton = kit.button(frame, "Add note", { width = NOTE_BUTTON_WIDTH })
    row.noteButton:SetPoint("TOPLEFT", row.icon, "TOPRIGHT", gap + #Council.RESPONSES * (BUTTON_WIDTH + gap), -(header + gap))
    row.noteButton:SetScript("OnClick", kit.safe(function() openNote(row) end))
    row.note = kit.label(frame, "", { width = noteWidth, color = colors.muted })
    row.note:SetPoint("TOPLEFT", row.icon, "TOPRIGHT", gap, -(header + gap + m.button + gap))
    rows[index] = row
    return row
  end

  local function paint(row, data)
    row.data = data
    row.frame:Show()
    kit.setIcon(row.icon, data.quality or 1, data.icon)
    local color = ns.UI.Kit.qualityColor(data.quality or 1)
    row.name:SetText(kit.fit(data.n .. ". " .. (data.name or "?"), nameWidth))
    row.name:SetTextColor(color[1], color[2], color[3])
    local words, shade = ResponseFrame.statusText(data)
    row.status:SetText(words)
    local tint = colors[shade] or colors.text
    row.status:SetTextColor(tint[1], tint[2], tint[3])
    local over = data.state == "closed" or (data.remaining or 0) <= 0
    for i, response in ipairs(Council.RESPONSES) do
      local chosen = data.myCode == response.code
      row.buttons[i]:SetEnabled(not over and not chosen)
    end
    local hasNote = type(data.note) == "string" and data.note ~= ""
    row.noteButton:SetText(hasNote and "Edit note" or "Add note")
    row.noteButton:SetEnabled(not over)
    row.note:SetText(kit.fit(ResponseFrame.noteText(data), noteWidth))
  end

  -- Show the model; rows beyond it are hidden.
  function self.update(model)
    current = model or { rows = {} }
    if current.master then
      from:SetText(current.master == "you" and "Your offer" or ("Offered by " .. current.master))
    else
      from:SetText("Nothing is on offer.")
    end
    for i, data in ipairs(current.rows) do
      paint(rows[i] or makeRow(i), data)
    end
    for i = #current.rows + 1, #rows do
      rows[i].data = nil
      rows[i].frame:Hide()
    end
    list.setViewHeight(listHeightFor(#current.rows))
    list.setContentHeight(#current.rows * rowHeight)
    window.frame:SetHeight(heightFor(#current.rows))
    -- the note box closes when its item is no longer on offer
    if editing then
      local open = false
      for _, data in ipairs(current.rows) do
        if data.sid == editing.sid and data.n == editing.n and data.state ~= "closed" and (data.remaining or 0) > 0 then open = true end
      end
      if not open then closeNote() end
    end
  end

  -- A second at a time while the frame is shown, the times on the rows run down.
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
  window.frame:SetScript("OnHide", function()
    ticking = ticking + 1
    if editing then closeNote() end
  end)

  window.hide() -- it opens when something is offered

  function self.show() window.show() end
  function self.hide() window.hide() end
  function self.isShown() return window.isShown() end
  self.frame = window.frame
  function self.editing() return editing end
  self.parts = {
    window = window, from = from, list = list, rows = rows, popup = popup, popupItem = popupItem, noteBox = noteBox, popupHint = popupHint,
    save = saveButton, cancel = cancelButton,
  }
  self.metrics = { rowHeight = rowHeight, width = width, heightFor = heightFor, visible = VISIBLE }
  return self
end
