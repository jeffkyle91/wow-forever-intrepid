-- Intrepid Manager: a small window that lists players one to a line, with a box that narrows the list as you type.
-- It is how "Pick" chooses someone out of the raid (40 names fit with a scroll).
--
-- picker.open(entries, onPick)
--   entries   a list of { name = "First Surname", class = "Warrior" (optional), role = "Tank" (optional) }
--   onPick    called with the chosen entry

local _, ns = ...

local Picker = {}
ns.UI = ns.UI or {}
ns.UI.Picker = Picker

local NAME = "IntrepidManagerPicker"

function Picker.new(kit)
  local m, colors = kit.m, kit.colors
  local self = {}
  local visibleRows = m.name == "roomy" and 12 or 14
  local width = m.popupWidth - 40
  local listWidth = width - 10 - m.pad * 2 -- the window's body is ten pixels narrower than the window
  local listHeight = visibleRows * m.row
  local window = kit.window({
    name = NAME, title = "Pick a player", width = width, height = 24 + m.pad * 3 + m.input + m.gap + listHeight + 10,
    strata = "FULLSCREEN_DIALOG",
  })
  local body = window.body
  local filter = kit.input(body, { width = listWidth - 40, maxLetters = 40 })
  filter:SetPoint("TOPLEFT", m.pad + 40, -m.pad)
  kit.label(body, "Find:", { color = colors.muted }):SetPoint("TOPLEFT", m.pad, -(m.pad + 2))
  local list = kit.scrollList(body, listWidth, listHeight)
  list.frame:SetPoint("TOPLEFT", m.pad, -(m.pad + m.input + m.gap))
  kit.fill(list.frame, colors.panel)

  local entries, shown, rows, onPick = {}, {}, {}, nil

  local function row(index)
    if rows[index] then return rows[index] end
    local made = CreateFrame("Frame", nil, list.content)
    made:SetSize(list.content:GetWidth(), m.row)
    made:SetPoint("TOPLEFT", 0, -(index - 1) * m.row)
    made.bg = kit.fill(made, index % 2 == 0 and colors.panelAlt or colors.panel)
    made.name = kit.label(made, "", { width = listWidth - 90 })
    made.name:SetPoint("LEFT", 6, 0)
    made.role = kit.label(made, "", { width = 70, color = colors.muted, justify = "RIGHT" })
    made.role:SetPoint("RIGHT", -6, 0)
    made:EnableMouse(true)
    made:SetScript("OnMouseDown", kit.safe(function()
      local entry = shown[index]
      window.hide()
      if entry and onPick then onPick(entry) end
    end))
    rows[index] = made
    return made
  end

  local function refresh()
    local wanted = ns.Names.key(filter:GetText() or "") or ""
    shown = {}
    for _, entry in ipairs(entries) do
      if wanted == "" or string.find(ns.Names.key(entry.name) or "", wanted, 1, true) then shown[#shown + 1] = entry end
    end
    for i, entry in ipairs(shown) do
      local made = row(i)
      made.name:SetText(entry.name)
      local color = ns.UI.Kit.classColor(entry.class)
      made.name:SetTextColor(color[1], color[2], color[3])
      made.role:SetText(entry.role or "")
      made:Show()
    end
    for i = #shown + 1, #rows do rows[i]:Hide() end
    list.setContentHeight(#shown * m.row)
    list.scrollTo(0)
  end

  filter:SetScript("OnTextChanged", kit.safe(refresh))
  window.frame:Hide()

  function self.open(list_, picked)
    entries, onPick = list_ or {}, picked
    filter:SetText("")
    refresh()
    window.show()
    filter:SetFocus()
  end

  function self.hide() window.hide() end
  function self.isShown() return window.isShown() end
  self.window = window
  self.parts = { filter = filter, rows = rows, list = list }
  return self
end
