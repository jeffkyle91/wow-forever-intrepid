-- Intrepid Manager: the version window. Frames only: it shows the model it is given and calls the callbacks it was given;
-- game/CouncilSession keeps what is known (it asks the group and hears the answers).
--
-- One line for each member of the group: the class picture, the name in the color of the class, the version of the addon, and a word
-- for how it stands to yours: the same, older, newer (then yours is the old one), "waiting" while the answers come in, "not installed"
-- when a member did not answer the question, "offline". Below the list one line counts them, and a line asks for an update when
-- somebody has a newer version. The heading says "asking the group" until the answers are in. "Check again" asks the group once more.
-- While the window is shown it reads the model again every second.
--
-- The model (read only; the session builds it, see CouncilSession.versionsModel):
--   model = {
--     mine = "0.0.15", checked = true, waiting = false,
--     summary = { same = 5, older = 1, newer = 0, other = 0, waiting = 0, missing = 2, offline = 0, unchecked = 0 },
--     rows = { { who, class, me, status, version, kind }, ... },
--   }
--
-- The callbacks (each in pcall):
--   model()    the model as it is now
--   check()    "Check again" was pressed: ask the group
--
-- VersionWindow.statusText(model) and VersionWindow.stateText(row) are the sentences, for the tests.

local _, ns = ...

local VersionWindow = {}
ns.UI = ns.UI or {}
ns.UI.VersionWindow = VersionWindow

local NAME = "IntrepidManagerVersions"
local VISIBLE = 14
local ORDER = { "same", "older", "newer", "other", "waiting", "missing", "offline", "unchecked" }
local COUNT_WORDS = {
  same = "same", older = "older", newer = "newer", other = "other", waiting = "waiting", missing = "not installed", offline = "offline",
  unchecked = "not asked",
}
local STATE_WORDS = {
  same = "same version", older = "older", newer = "newer - update", other = "other", waiting = "waiting...",
  missing = "not installed", offline = "offline", unchecked = "not asked yet",
}
local SHADES = { same = "good", older = "warn", newer = "gold", other = "muted", waiting = "muted", missing = "bad", offline = "muted", unchecked = "muted" }

-- "5 same - 1 older - 2 not installed", or why there is nothing to count.
function VersionWindow.statusText(model)
  local rows = #((model and model.rows) or {})
  if rows <= 1 then return "Nobody else is in your group." end
  local parts = {}
  for _, kind in ipairs(ORDER) do
    local n = model.summary and model.summary[kind] or 0
    if n > 0 then parts[#parts + 1] = n .. " " .. COUNT_WORDS[kind] end
  end
  return table.concat(parts, " - ")
end

-- The word in the last column of a row.
function VersionWindow.stateText(row)
  if row.me then return "you" end
  return STATE_WORDS[row.kind or row.status] or ""
end

function VersionWindow.new(kit, callbacks)
  callbacks = callbacks or {}
  local m, colors = kit.m, kit.colors
  local self = {}

  local function call(name, ...)
    local callback = callbacks[name]
    if callback then return callback(...) end
  end

  -- the numbers everything else is placed by
  local pad, gap, header = m.pad, m.gap, m.header
  local width = 400
  local inner = width - 10 - pad * 2
  local rowHeight = m.row
  local rowWidth = inner - m.bar - 2
  local classSize = m.icon
  local nameWidth, versionWidth = 150, 64
  local stateWidth = rowWidth - classSize - nameWidth - versionWidth - gap * 5
  local headsTop = pad + header + gap
  local listTop = headsTop + header
  local listHeight = rowHeight * VISIBLE
  local statusTop = listTop + listHeight + gap
  local warnTop = statusTop + header + gap
  local barTop = warnTop + header + gap * 2
  local height = barTop + m.button + pad + 28

  local window = kit.window({ name = NAME, title = "Versions", width = width, height = height, chrome = "clear" })
  local body = window.body

  local groupHead = kit.label(body, "YOUR GROUP", { font = "gold", width = 190 })
  groupHead:SetPoint("TOPLEFT", pad, -pad - 2)
  local mine = kit.label(body, "", { width = inner - 190 - gap, justify = "RIGHT", color = colors.muted })
  mine:SetPoint("TOPRIGHT", -pad, -pad - 2)
  local headWho = kit.label(body, "PLAYER", { color = colors.muted, width = nameWidth })
  headWho:SetPoint("TOPLEFT", pad + gap + classSize + gap, -headsTop)
  local headVersion = kit.label(body, "VERSION", { color = colors.muted, width = versionWidth })
  headVersion:SetPoint("TOPLEFT", pad + gap + classSize + gap + nameWidth + gap, -headsTop)
  local headState = kit.label(body, "", { color = colors.muted, width = stateWidth })
  headState:SetPoint("TOPLEFT", pad + gap + classSize + gap + nameWidth + gap + versionWidth + gap, -headsTop)
  local list = kit.scrollList(body, inner, listHeight)
  list.frame:SetPoint("TOPLEFT", pad, -listTop)
  local status = kit.label(body, "", { width = inner })
  status:SetPoint("TOPLEFT", pad, -statusTop)
  local warning = kit.label(body, "Somebody has a newer version than yours. Please update.", { width = inner, color = colors.gold })
  warning:SetPoint("TOPLEFT", pad, -warnTop)
  local checkButton = kit.button(body, "Check again", { primary = true, width = 110 })
  checkButton:SetPoint("TOPRIGHT", -pad, -barTop)

  local rows = {}
  local current = { rows = {}, summary = {} }

  local function makeRow(index)
    local row = {}
    local frame = CreateFrame("Frame", nil, list.content)
    frame:SetSize(rowWidth, rowHeight)
    frame:SetPoint("TOPLEFT", 0, -(index - 1) * rowHeight)
    kit.fill(frame, index % 2 == 1 and colors.panel or colors.panelAlt)
    row.classIcon = frame:CreateTexture(nil, "ARTWORK")
    row.classIcon:SetSize(classSize, classSize)
    row.classIcon:SetPoint("LEFT", gap, 0)
    row.who = kit.label(frame, "", { width = nameWidth })
    row.who:SetPoint("LEFT", row.classIcon, "RIGHT", gap, 0)
    row.version = kit.label(frame, "", { width = versionWidth })
    row.version:SetPoint("LEFT", row.who, "RIGHT", gap, 0)
    row.state = kit.label(frame, "", { width = stateWidth })
    row.state:SetPoint("LEFT", row.version, "RIGHT", gap, 0)
    row.frame = frame
    rows[index] = row
    return row
  end

  function self.update(model)
    current = model or { rows = {}, summary = {} }
    current.rows = current.rows or {}
    groupHead:SetText(current.waiting and "ASKING THE GROUP..." or "YOUR GROUP")
    mine:SetText(current.mine and kit.fit("You have " .. current.mine, inner - 190 - gap) or "")
    headState:SetText(#current.rows > 1 and "STATE" or "")
    for i, data in ipairs(current.rows) do
      local row = rows[i] or makeRow(i)
      row.frame:Show()
      local color = ns.UI.Kit.classColor(data.class)
      row.who:SetText(kit.fit(data.who or "?", nameWidth))
      row.who:SetTextColor(color[1], color[2], color[3])
      local file = ns.UI.Kit.classIconFile(data.class)
      if file then row.classIcon:SetTexture(file) end
      row.classIcon:SetShown(file ~= nil)
      row.version:SetText(data.version and kit.fit(data.version, versionWidth) or "-")
      local shade = colors[SHADES[data.kind or data.status] or "text"]
      row.version:SetTextColor(shade[1], shade[2], shade[3])
      row.state:SetText(VersionWindow.stateText(data))
      row.state:SetTextColor(shade[1], shade[2], shade[3])
    end
    for i = #current.rows + 1, #rows do rows[i].frame:Hide() end
    list.setContentHeight(#current.rows * rowHeight)
    status:SetText(kit.fit(VersionWindow.statusText(current), inner))
    warning:SetShown(((current.summary or {}).newer or 0) > 0)
  end

  checkButton:SetScript("OnClick", kit.safe(function()
    call("check")
    local fresh = call("model")
    if fresh then self.update(fresh) end
  end))

  -- A second at a time while the window is shown, the answers are read again.
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
  self.frame = window.frame
  self.parts = {
    window = window, groupHead = groupHead, mine = mine, status = status, warning = warning, check = checkButton, list = list, rows = rows,
    headState = headState,
  }
  self.metrics = { width = width, height = height, rowHeight = rowHeight, visible = VISIBLE }
  return self
end
