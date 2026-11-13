-- Intrepid Manager: the import window. Frames only: it reads what was pasted into it and calls the callback it was given.
--
-- The loot master copies a night from the Raid Desk ("Copy for addon"), opens this window and pastes into the box. When
-- the pasting has stopped for a moment the string is read and the window says what it found, in plain words: a good night
-- with how many players and priorities it holds (in orange when it is old, for another day, or had to leave something out),
-- or why the string cannot be used. Import stays off until the string reads and no loot session is open. Whatever is
-- wrong with a string, the night the addon has now is kept.
--
-- The view-model (read only; the engine builds it):
--   vm = {
--     current     = "Night of 2026-12-08, copied 2 days ago: 58 players, 87 priorities.",  -- the night the addon has now, or nil
--     sessionOpen = false,                                                                 -- a loot session is open
--   }
--
-- The callback (called in pcall):
--   import(text, result)   the loot master pressed Import on a string that reads; `result` is what ns.Night.read made of
--                          `text`. Answer { ok = true, message = "..." } or { ok = false, message = "..." }; the message is
--                          shown. After an import the box is emptied.
--
-- The window reads with ns.Night.read and says it with ns.Night.summary. deps (for tests) can replace read(text), now()
-- (the server time in seconds) and today() (the loot master's date as YYYY-MM-DD). deps.log(entry) hears what the window
-- does (a change of the box, a read and how long it took, an import) and deps.clock gives milliseconds for that (default:
-- debugprofilestop), so that a test build can keep what the game really did with a paste.

local _, ns = ...

local ImportWindow = {}
ns.UI = ns.UI or {}
ns.UI.ImportWindow = ImportWindow

local NAME = "IntrepidManagerImport"
local DEBOUNCE = 0.3 -- seconds after the last change before the string is read
local STATUS_LINES = 6
local SMALL, LARGE = 70, 90 -- button widths: Clear and Close, Import

local HELP = 'Paste the night string from the Raid Desk ("Copy for addon"), then press Import. A new night replaces the one the addon has now.'
local PLACEHOLDER = "Click here and paste (Ctrl+V, or Cmd+V on a Mac)."
local EMPTY = "Nothing pasted yet."
local READING = "Reading..."
local KEPT = "The night you have now is kept."
local SESSION_OPEN = "Finish or cancel the open session first."

function ImportWindow.new(kit, callbacks, deps)
  callbacks, deps = callbacks or {}, deps or {}
  local m, colors = kit.m, kit.colors
  local Night = ns.Night
  local read = deps.read or Night.read
  local now = deps.now or function() return GetServerTime() end
  local today = deps.today or function() return date("%Y-%m-%d") end
  local clock = deps.clock or debugprofilestop
  local self = {}

  local function note(entry)
    if deps.log then pcall(deps.log, entry) end
  end

  local function call(name, ...)
    local callback = callbacks[name]
    if callback then return callback(...) end
  end

  -- the numbers everything else is placed by
  local pad, gap, header = m.pad, m.gap, m.header
  local width = m.windowWidth - 120
  local inner = width - 10 - pad * 2
  local boxHeight = m.row * 8
  local statusHeight = STATUS_LINES * header + 8
  local currentTop = pad + 2 * header + gap
  local headTop = currentTop + header + gap
  local boxTop = headTop + header
  local statusTop = boxTop + boxHeight + gap
  local buttonsTop = statusTop + statusHeight + gap
  local height = buttonsTop + m.button + pad + 28

  local window = kit.window({ name = NAME, title = "Intrepid Manager - Import a night", width = width, height = height })
  local body = window.body

  local intro = kit.label(body, HELP, { wrap = true, width = inner })
  intro:SetPoint("TOPLEFT", pad, -pad)
  local current = kit.label(body, "", { width = inner, color = colors.muted })
  current:SetPoint("TOPLEFT", pad, -currentTop)
  local heading = kit.label(body, "NIGHT STRING", { font = "gold" })
  heading:SetPoint("TOPLEFT", pad, -headTop)
  local count = kit.label(body, "", { width = 160, justify = "RIGHT", color = colors.muted })
  count:SetPoint("TOPRIGHT", -pad, -headTop)

  -------------------------------------------------------------------------------------------------------------
  -- The paste box: the kit's text area (a multi-line edit box inside a scroll frame, as the probe's paste window was)
  -------------------------------------------------------------------------------------------------------------
  local area = kit.textArea(body, inner, boxHeight)
  local region, scroll, edit = area.region, area.scroll, area.edit
  region:SetPoint("TOPLEFT", pad, -boxTop)

  local placeholder = kit.label(region, PLACEHOLDER, { width = inner - 12, color = colors.muted })
  placeholder:SetPoint("TOPLEFT", 8, -6)

  -------------------------------------------------------------------------------------------------------------
  -- What was found, and the buttons
  -------------------------------------------------------------------------------------------------------------
  local statusPanel = CreateFrame("Frame", nil, body)
  statusPanel:SetSize(inner, statusHeight)
  statusPanel:SetPoint("TOPLEFT", pad, -statusTop)
  kit.fill(statusPanel, colors.panel)
  local status = kit.label(statusPanel, "", { wrap = true, width = inner - 12 })
  status:SetPoint("TOPLEFT", 6, -4)
  status:SetMaxLines(STATUS_LINES)

  local clearButton = kit.button(body, "Clear", { width = SMALL })
  clearButton:SetPoint("TOPLEFT", pad, -buttonsTop)
  local closeButton = kit.button(body, "Close", { width = SMALL })
  closeButton:SetPoint("TOPRIGHT", -pad, -buttonsTop)
  local importButton = kit.button(body, "Import", { primary = true, width = LARGE })
  importButton:SetPoint("TOPRIGHT", closeButton, "TOPLEFT", -gap, 0)
  local hint = kit.label(body, "", { width = inner - 2 * SMALL - LARGE - gap * 4, color = colors.warn })
  hint:SetPoint("LEFT", clearButton, "RIGHT", gap * 2, 0)

  local vm = {}
  local lastText = ""  -- the text in the box when it was last looked at
  local evaluated      -- { text, result } once the text has been read; nil while a read is waiting
  local generation = 0 -- bumped by every change, so that only the last waiting read counts

  local function setStatus(color, text)
    status:SetText(text)
    status:SetTextColor(color[1], color[2], color[3])
  end

  local function refresh()
    if evaluated and evaluated.result.ok and not vm.sessionOpen then importButton:Enable() else importButton:Disable() end
    if lastText ~= "" then clearButton:Enable() else clearButton:Disable() end
    hint:SetText(vm.sessionOpen and SESSION_OPEN or "")
    placeholder:SetShown(lastText == "")
    count:SetText(lastText ~= "" and kit.characters(#lastText) or "")
    if vm.current and vm.current ~= "" then
      current:SetText("In the addon now: " .. vm.current)
    else
      current:SetText("No night has been imported yet.")
    end
  end

  local function isBlank(text) return string.find(text, "^%s*$") ~= nil end

  -- Read the box and say what is in it.
  local function evaluate()
    local text = edit:GetText()
    lastText = text
    if isBlank(text) then
      evaluated = nil
      setStatus(colors.muted, EMPTY)
      return refresh()
    end
    local started = clock and clock()
    local result = read(text)
    note({ event = "read", chars = #text, ms = started and clock and (clock() - started) or nil, ok = result.ok, code = result.code })
    evaluated = { text = text, result = result }
    if result.ok then
      local info = Night.summary(result, now(), today())
      local careful = #info.warnings > 0 or info.skipped > 0 or #result.problems > 0
      setStatus(careful and colors.warn or colors.good, info.text)
    else
      setStatus(colors.bad, result.message .. (vm.current and (" " .. KEPT) or ""))
    end
    refresh()
  end

  -- If reading fails, the window must not be left saying "Reading...": it says so, and the error goes to the kit.
  local function evaluateSafely()
    local ok, err = pcall(evaluate)
    if not ok then
      evaluated = nil
      setStatus(colors.bad, "The string could not be read. Tell the addon maintainers.")
      refresh()
      error(err, 0)
    end
  end

  local function textChanged(userInput)
    local text = edit:GetText()
    note({ event = "changed", chars = #text, user = userInput, same = text == lastText })
    if text == lastText then return end
    lastText = text
    evaluated = nil
    generation = generation + 1
    local mine = generation
    if isBlank(text) then return evaluateSafely() end
    setStatus(colors.muted, READING)
    refresh()
    C_Timer.After(DEBOUNCE, kit.safe(function()
      if mine == generation then evaluateSafely() end
    end))
  end
  edit:SetScript("OnTextChanged", kit.safe(function(_, userInput) textChanged(userInput) end))

  -- Empty the box without waiting for the game to tell us about it.
  local function empty(color, text)
    generation = generation + 1
    lastText = ""
    evaluated = nil
    edit:SetText("")
    scroll:SetVerticalScroll(0)
    setStatus(color, text)
    refresh()
  end

  clearButton:SetScript("OnClick", kit.safe(function()
    empty(colors.muted, EMPTY)
    edit:SetFocus()
  end))
  closeButton:SetScript("OnClick", function() window.hide() end)

  importButton:SetScript("OnClick", kit.safe(function()
    if vm.sessionOpen then return end
    local text = edit:GetText()
    if not (evaluated and evaluated.result.ok and evaluated.text == text) then
      return textChanged() -- the box changed since it was read: look at it again before importing anything
    end
    local answer = call("import", text, evaluated.result) or { ok = false, message = "Nothing is connected to import with." }
    note({ event = "import", chars = #text, ok = answer.ok == true })
    if answer.ok then
      empty(colors.good, answer.message or "Imported.")
    else
      setStatus(colors.bad, answer.message or "The night could not be imported.")
    end
  end))

  -------------------------------------------------------------------------------------------------------------
  -- Outside
  -------------------------------------------------------------------------------------------------------------
  function self.update(newVm)
    vm = newVm or {}
    refresh()
  end

  -- Show the window with the box ready to paste into; a string left from before is read again (its age has changed).
  function self.open(newVm)
    if newVm then vm = newVm end
    window.show()
    edit:SetFocus()
    generation = generation + 1
    kit.safe(evaluateSafely)()
  end

  function self.show() window.show() end
  function self.hide() window.hide() end
  function self.toggle() window.toggle() end
  function self.isShown() return window.isShown() end
  self.window = window
  self.parts = {
    intro = intro, current = current, heading = heading, count = count, region = region, scroll = scroll, edit = edit,
    placeholder = placeholder,
    statusPanel = statusPanel, status = status, clearButton = clearButton, closeButton = closeButton,
    importButton = importButton, hint = hint,
  }

  setStatus(colors.muted, EMPTY)
  refresh()
  window.frame:Hide()
  return self
end
