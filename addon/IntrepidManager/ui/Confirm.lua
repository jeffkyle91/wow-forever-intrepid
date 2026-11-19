-- Intrepid Manager: the confirmation before a give. A small dialog above everything else. Escape or Cancel closes it;
-- Enter does nothing, so a give is never one stray key press.
--
-- confirm.ask(spec, onConfirm)
--   spec.item        the item as text (usually colored by its quality)
--   spec.quality     item quality number, spec.icon the icon texture
--   spec.recipient   who gets it, as text (usually colored by class)
--   spec.lines       extra lines in the muted color (the decision, the note, "replaces ...")
--   spec.warnings    lines in the warning color
--   spec.confirm     the label of the confirm button (default "Give")

local _, ns = ...

local Confirm = {}
ns.UI = ns.UI or {}
ns.UI.Confirm = Confirm

local NAME = "IntrepidManagerConfirm"
local MAX_LINES = 4 -- extra lines and warnings that fit; more are dropped

function Confirm.new(kit)
  local m, colors = kit.m, kit.colors
  local self = {}
  local window = kit.window({ name = NAME, title = "Give this item?", width = m.popupWidth, height = 140, strata = "FULLSCREEN_DIALOG" })
  local body = window.body

  local icon = kit.icon(body, m.headIcon, 4, nil)
  icon:SetPoint("TOPLEFT", m.pad, -m.pad)
  local textWidth = m.popupWidth - m.headIcon - m.pad * 3 - 12
  local itemLabel = kit.label(body, "", { font = "title", width = textWidth })
  itemLabel:SetPoint("TOPLEFT", m.pad + m.headIcon + 8, -m.pad)
  local recipientLabel = kit.label(body, "", { width = textWidth })
  recipientLabel:SetPoint("TOPLEFT", m.pad + m.headIcon + 8, -(m.pad + m.header + 2))
  local extra = {}
  for i = 1, MAX_LINES * 2 do
    extra[i] = kit.label(body, "", { width = m.popupWidth - m.pad * 2 - 12 })
  end

  local confirmButton = kit.button(body, "Give", { primary = true, width = 90 })
  local cancelButton = kit.button(body, "Cancel", { width = 90 })
  local onConfirm

  confirmButton:SetScript("OnClick", kit.safe(function()
    local callback = onConfirm -- hiding the window forgets it, so take it first
    onConfirm = nil
    window.hide()
    if callback then callback() end
  end))
  cancelButton:SetScript("OnClick", function()
    onConfirm = nil
    window.hide()
  end)
  window.frame:HookScript("OnHide", function() onConfirm = nil end)
  window.frame:Hide()

  function self.ask(spec, confirmed)
    kit.setIcon(icon, spec.quality, spec.icon)
    itemLabel:SetText(spec.item or "")
    recipientLabel:SetText("to " .. (spec.recipient or "?"))
    local texts = {}
    for _, line in ipairs(spec.warnings or {}) do texts[#texts + 1] = { line, colors.warn } end
    for _, line in ipairs(spec.lines or {}) do texts[#texts + 1] = { line, colors.muted } end
    local top = m.pad + m.headIcon + 6
    for i, label in ipairs(extra) do
      local entry = texts[i]
      if entry and i <= MAX_LINES * 2 then
        label:SetText(entry[1])
        label:SetTextColor(entry[2][1], entry[2][2], entry[2][3])
        label:ClearAllPoints()
        label:SetPoint("TOPLEFT", m.pad, -(top + (i - 1) * m.header))
        label:Show()
      else
        label:Hide()
      end
    end
    local shown = math.min(#texts, #extra)
    local buttonTop = top + shown * m.header + m.gap
    confirmButton:ClearAllPoints()
    confirmButton:SetPoint("TOPLEFT", (m.popupWidth - 12) / 2 - 90 - m.gap / 2, -buttonTop)
    cancelButton:ClearAllPoints()
    cancelButton:SetPoint("TOPLEFT", (m.popupWidth - 12) / 2 + m.gap / 2, -buttonTop)
    confirmButton:SetText(spec.confirm or "Give")
    window.frame:SetHeight(24 + buttonTop + m.button + m.pad + 6)
    onConfirm = confirmed
    window.show()
  end

  function self.hide() window.hide() end
  function self.isShown() return window.isShown() end
  self.window = window
  self.parts = {
    confirmButton = confirmButton, cancelButton = cancelButton, itemLabel = itemLabel, recipientLabel = recipientLabel,
    icon = icon, extra = extra,
  }
  return self
end
