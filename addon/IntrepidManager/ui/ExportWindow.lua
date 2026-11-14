-- Intrepid Manager: the export window. Frames only: it shows the awards string it was given and calls the callbacks it was
-- given; the engine decides which awards the string holds (ns.Awards.select) and writes it (ns.Awards.encode).
--
-- The loot master copies the string (the box takes the keyboard and selects everything when it is clicked, or Select all
-- does it; the box cannot be edited) and pastes it into the Raid Desk. The window says how many awards the string holds and
-- how many of them are new or changed since the night was copied, that sending the same awards again is harmless, and that
-- the game writes its file at the next /reload.
--
-- The view-model (read only; the engine builds it):
--   vm = {
--     text        = "IM1:awards:j:...",   -- the awards string, or nil or "" when there is nothing to export
--     count       = 5,                    -- how many awards it holds
--     new         = 3, changed = 2,       -- of them, those the loaded night does not know, and those it knows in an older revision
--     hasNight    = true,                 -- a night is loaded (without one, an export holds the awards of the last 14 days)
--     everything  = false,                -- "Everything, not only what is new" is ticked
--     sessionOpen = false,                -- a loot session is open: awards given from now on are not in the string
--   }
--
-- The callbacks (each in pcall):
--   everything(on)   the box "Everything, not only what is new" was ticked or cleared: build the view-model again
--   done()           Done was pressed (the window has closed itself); the engine may suggest a /reload
--
-- ExportWindow.summary(vm) is the sentence about the awards, for the tests and the pictures.

local _, ns = ...

local ExportWindow = {}
ns.UI = ns.UI or {}
ns.UI.ExportWindow = ExportWindow

local NAME = "IntrepidManagerExport"
local HELP = "Copy the awards string below and paste it into the Raid Desk importer."
local HINT = "Click in the box and press Ctrl+C (Cmd+C on a Mac). The same awards can be sent again: the Raid Desk ignores what "
  .. "it already has. When the fight is over, type /reload so the game writes the file."
local EMPTY = "Nothing to export yet."
local SESSION_OPEN = "A loot session is open: awards given from now on are not in this string."

local function awardsText(count)
  return count == 1 and "1 award" or (string.format("%.0f", count) .. " awards")
end

-- The sentence about what the string holds, and whether there is anything: "5 awards: 3 new and 2 changed since the night
-- was copied."
function ExportWindow.summary(vm)
  local count = vm.count or 0
  if count == 0 or not vm.text or vm.text == "" then return EMPTY, false end
  local awards = awardsText(count)
  if vm.everything then return awards .. " (everything, not only what is new).", true end
  if not vm.hasNight then return awards .. " from the last 14 days (no night is loaded).", true end
  local new, changed = vm.new or 0, vm.changed or 0
  if changed == 0 and new == count then return awards .. ", all new.", true end
  if new == 0 and changed == count then return awards .. ", all changed since the night was copied.", true end
  local parts = {}
  if new > 0 then parts[#parts + 1] = string.format("%.0f", new) .. " new" end
  if changed > 0 then parts[#parts + 1] = string.format("%.0f", changed) .. " changed since the night was copied" end
  if #parts == 0 then return awards .. ".", true end
  return awards .. ": " .. table.concat(parts, " and ") .. ".", true
end

function ExportWindow.new(kit, callbacks)
  callbacks = callbacks or {}
  local m, colors = kit.m, kit.colors
  local self = {}

  local function call(name, ...)
    local callback = callbacks[name]
    if callback then return callback(...) end
  end

  -- the numbers everything else is placed by
  local pad, gap, header = m.pad, m.gap, m.header
  local width = m.windowWidth - 120
  local inner = width - 10 - pad * 2
  local boxHeight = m.row * 8
  local summaryTop = pad + 2 * header + gap
  local headTop = summaryTop + header + gap
  local boxTop = headTop + header
  local hintTop = boxTop + boxHeight + gap
  local warnTop = hintTop + 3 * header + gap
  local buttonsTop = warnTop + header + gap
  local height = buttonsTop + m.button + pad + 28

  local window = kit.window({ name = NAME, title = "Intrepid Manager - Export awards", width = width, height = height })
  local body = window.body

  local intro = kit.label(body, HELP, { wrap = true, width = inner })
  intro:SetPoint("TOPLEFT", pad, -pad)
  local summary = kit.label(body, "", { width = inner })
  summary:SetPoint("TOPLEFT", pad, -summaryTop)
  local heading = kit.label(body, "AWARDS STRING", { font = "gold" })
  heading:SetPoint("TOPLEFT", pad, -headTop)
  local count = kit.label(body, "", { width = 160, justify = "RIGHT", color = colors.muted })
  count:SetPoint("TOPRIGHT", -pad, -headTop)

  local area = kit.textArea(body, inner, boxHeight)
  local scroll, edit = area.scroll, area.edit
  area.region:SetPoint("TOPLEFT", pad, -boxTop)

  local hint = kit.label(body, HINT, { wrap = true, width = inner, color = colors.muted })
  hint:SetPoint("TOPLEFT", pad, -hintTop)
  local warning = kit.label(body, "", { width = inner, color = colors.warn })
  warning:SetPoint("TOPLEFT", pad, -warnTop)

  local everything = kit.check(body, "Everything, not only what is new")
  everything:SetPoint("TOPLEFT", pad, -buttonsTop)
  local doneButton = kit.button(body, "Done", { primary = true, width = 70 })
  doneButton:SetPoint("TOPRIGHT", -pad, -buttonsTop)
  local selectButton = kit.button(body, "Select all", { width = 90 })
  selectButton:SetPoint("TOPRIGHT", doneButton, "TOPLEFT", -gap, 0)

  local shown = "" -- the string in the box: the box is read only, whatever is typed is put back

  local function selectAll()
    edit:SetFocus()
    edit:HighlightText()
  end

  edit:SetScript("OnTextChanged", kit.safe(function(_, userInput)
    if userInput and edit:GetText() ~= shown then
      edit:SetText(shown)
      edit:HighlightText()
    end
  end))
  edit:SetScript("OnEditFocusGained", kit.safe(function() edit:HighlightText() end))
  area.scroll:SetScript("OnMouseDown", kit.safe(selectAll))
  selectButton:SetScript("OnClick", kit.safe(selectAll))
  doneButton:SetScript("OnClick", kit.safe(function()
    window.hide()
    call("done")
  end))
  everything:SetScript("OnClick", kit.safe(function(box) call("everything", box:GetChecked() == true) end))

  function self.update(vm)
    vm = vm or {}
    local sentence, any = ExportWindow.summary(vm)
    summary:SetText(sentence)
    local color = any and colors.good or colors.muted
    summary:SetTextColor(color[1], color[2], color[3])
    shown = any and vm.text or ""
    edit:SetText(shown)
    scroll:SetVerticalScroll(0)
    count:SetText(shown ~= "" and kit.characters(#shown) or "")
    everything:SetChecked(vm.everything == true)
    warning:SetText(vm.sessionOpen and SESSION_OPEN or "")
    if any then selectButton:Enable() else selectButton:Disable() end
  end

  -- Show the window with this view-model; the string is ready to copy.
  function self.open(vm)
    self.update(vm)
    window.show()
  end

  function self.show() window.show() end
  function self.hide() window.hide() end
  function self.toggle() window.toggle() end
  function self.isShown() return window.isShown() end
  self.window = window
  self.parts = {
    intro = intro, summary = summary, heading = heading, count = count, region = area.region, scroll = scroll, edit = edit,
    hint = hint, warning = warning, everything = everything, selectButton = selectButton, doneButton = doneButton,
  }

  self.update({})
  window.frame:Hide()
  return self
end
