-- Intrepid Manager: the raider's answer frame. Frames only: it shows the items on offer from the model it is given and calls the
-- callbacks it was given; game/CouncilSession decides what is on offer and sends the answers.
--
-- One row per item: its picture (hover for the item's tooltip), its name in the color of its quality, the time left or the
-- answer given, and four buttons: Best in slot, Upgrade, Off-spec, Pass. A note typed in the box at the bottom goes with the next
-- answer. An answer can be changed until the time is up; the button of the answer given is the one that is dimmed.
--
-- The model (read only; the session builds it):
--   model = {
--     master = "Jorren Ashvale",          -- who offers (or "you" when the loot master is this player)
--     rows = { { sid, n, count, item, name, quality, icon, remaining (seconds), state ("open", "answered", "closed"),
--                myCode, myLabel, myNote }, ... },
--   }
--
-- The callbacks (each in pcall):
--   model()                                 the model as it is now (called every second while the frame is shown)
--   answer(sid, n, code, note)              a button was pressed
--
-- ResponseFrame.statusText(row) is the words at the right of a row, for the tests.

local _, ns = ...

local ResponseFrame = {}
ns.UI = ns.UI or {}
ns.UI.ResponseFrame = ResponseFrame

local NAME = "IntrepidManagerOffers"
local VISIBLE = 5 -- rows in view; more scroll
local BUTTON_WIDTH = 80
local NOTE_HINT = "Note, sent with your next answer"

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
  local rowHeight = gap * 3 + header + m.button
  local width = 480
  local inner = width - 10 - pad * 2
  local rowWidth = inner - m.bar - 2
  local statusWidth = 190
  local nameWidth = rowWidth - iconSize - gap * 3 - statusWidth
  local fromTop = pad
  local listTop = fromTop + header + gap
  -- the frame is as tall as its rows (one row at least, five at most; more scroll)
  local function listHeightFor(count) return rowHeight * math.min(math.max(count, 1), VISIBLE) end
  local function heightFor(count) return listTop + listHeightFor(count) + gap + m.input + pad + 28 end

  local window = kit.window({
    name = NAME, title = "Loot offered", width = width, height = heightFor(1), chrome = "clear",
    anchor = { point = "TOPRIGHT", x = -40, y = -90 },
  })
  local body = window.body

  local from = kit.label(body, "", { width = inner, color = colors.gold })
  from:SetPoint("TOPLEFT", pad, -fromTop)

  local list = kit.scrollList(body, inner, listHeightFor(1))
  list.frame:SetPoint("TOPLEFT", pad, -listTop)

  local note = kit.input(body, { width = inner - 4, maxLetters = 80 })
  note:SetPoint("TOPLEFT", list.frame, "BOTTOMLEFT", 4, -gap)
  local hint = kit.label(note, NOTE_HINT, { color = colors.muted, width = inner - 20 })
  hint:SetPoint("LEFT", 4, 0)
  note:SetScript("OnTextChanged", kit.safe(function(box) hint:SetShown(box:GetText() == "") end))

  local rows = {}
  local current = { rows = {} }

  local function answer(row, code)
    local data = row.data
    if not data then return end
    local text = note:GetText()
    note:SetText("")
    hint:SetShown(true)
    call("answer", data.sid, data.n, code, text)
    local fresh = call("model")
    if fresh then self.update(fresh) end
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
  window.frame:SetScript("OnHide", function() ticking = ticking + 1 end)

  window.hide() -- it opens when something is offered

  function self.show() window.show() end
  function self.hide() window.hide() end
  function self.isShown() return window.isShown() end
  self.frame = window.frame
  self.parts = { window = window, from = from, list = list, note = note, hint = hint, rows = rows }
  self.metrics = { rowHeight = rowHeight, width = width, heightFor = heightFor, visible = VISIBLE }
  return self
end
