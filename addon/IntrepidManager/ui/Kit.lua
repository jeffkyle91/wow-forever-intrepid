-- Intrepid Manager: the widget kit the windows are built from. Frames only: no engine, no loot calls.
--
-- The look: a stock Blizzard frame (title bar, close button, inset) around flat warm parts. The default density is
-- compact, so that a priority list, a roster of 40 players or a night of 20 items takes one small line per entry, the
-- way a loot council shows a candidate; "roomy" is the same layout with bigger lines and fonts.
--
-- Two things protect the windows from what we could not test in the game:
--   * The stock frame is made in pcall. If the game refuses the template, or its parts (TitleText, CloseButton, Inset) are
--     not there, the kit makes its own flat frame, title and close button, and the window still opens.
--   * Fonts are the game's own font objects, never a file, so any client language and any name draws.
--
-- Use:  local kit = ns.UI.Kit.new({ density = "compact", chrome = "stock", positions = IntrepidManagerDB.positions })
--       local window = kit.window({ name = "IntrepidManagerSession", title = "Intrepid Manager - Loot", width = 640, height = 520 })

local _, ns = ...

local Kit = {}
ns.UI = ns.UI or {}
ns.UI.Kit = Kit

local FLAT = "Interface\\Buttons\\WHITE8X8"
local BAR_ROOM = 26 -- what the scroll bar of the stock scroll frame needs beside it (it sits 6 pixels off and is 16 wide)

Kit.COLORS = {
  window = { 0.082, 0.075, 0.067, 1 }, panel = { 0.082, 0.075, 0.067, 1 }, panelAlt = { 0.098, 0.090, 0.080, 1 },
  side = { 0.063, 0.055, 0.047, 1 }, line = { 0.294, 0.267, 0.231, 1 }, selected = { 0.24, 0.19, 0.06, 1 },
  text = { 0.937, 0.914, 0.875, 1 }, muted = { 0.639, 0.604, 0.557, 1 }, gold = { 1, 0.82, 0, 1 },
  good = { 0.27, 1, 0.4, 1 }, bad = { 1, 0.35, 0.32, 1 }, warn = { 1, 0.62, 0.24, 1 }, banner = { 0.26, 0.09, 0.08, 1 },
  track = { 0.2, 0.18, 0.16, 1 }, thumb = { 0.55, 0.5, 0.42, 1 }, hover = { 1, 1, 1, 0.07 },
}

-- The game's class colors, keyed by the class name in lower case without spaces ("Death Knight" -> "deathknight").
Kit.CLASS_COLORS = {
  deathknight = { 0.77, 0.12, 0.23 }, druid = { 1, 0.49, 0.04 }, hunter = { 0.67, 0.83, 0.45 }, mage = { 0.41, 0.8, 0.94 },
  monk = { 0, 1, 0.6 }, paladin = { 0.96, 0.55, 0.73 }, priest = { 1, 1, 1 }, rogue = { 1, 0.96, 0.41 },
  shaman = { 0, 0.44, 0.87 }, warlock = { 0.58, 0.51, 0.79 }, warrior = { 0.78, 0.61, 0.43 },
}

-- Item quality colors by quality number (0 poor to 5 legendary).
Kit.QUALITY_COLORS = {
  [0] = { 0.62, 0.62, 0.62 }, [1] = { 1, 1, 1 }, [2] = { 0.12, 1, 0 }, [3] = { 0, 0.44, 0.87 }, [4] = { 0.64, 0.21, 0.93 },
  [5] = { 1, 0.5, 0 },
}

-- Sizes. `row` is one line of a table, `itemRow` one line of the item list; compact is the default.
Kit.DENSITIES = {
  compact = {
    name = "compact", text = "GameFontHighlightSmall", gold = "GameFontNormalSmall", title = "GameFontNormal",
    row = 16, itemRow = 20, icon = 14, headIcon = 30, pad = 6, gap = 4, button = 20, input = 18, inputFont = 11,
    check = 16, header = 14, windowWidth = 680, windowHeight = 520, leftWidth = 232, bar = 4, banner = 52,
    colPos = 22, colName = 150, colRole = 44, colHere = 74, popupWidth = 360,
  },
  roomy = {
    name = "roomy", text = "GameFontHighlight", gold = "GameFontNormal", title = "GameFontNormalLarge",
    row = 24, itemRow = 32, icon = 24, headIcon = 44, pad = 10, gap = 6, button = 24, input = 22, inputFont = 12,
    check = 22, header = 20, windowWidth = 830, windowHeight = 620, leftWidth = 280, bar = 6, banner = 66,
    colPos = 30, colName = 190, colRole = 56, colHere = 96, popupWidth = 440,
  },
}

local function classKey(className)
  if type(className) ~= "string" then return nil end
  return (string.gsub(string.lower(className), "[^a-z]", ""))
end

-- The color of a class name (any capitalization), or the plain text color when it is missing or unknown.
function Kit.classColor(className)
  return Kit.CLASS_COLORS[classKey(className)] or Kit.COLORS.text
end

function Kit.qualityColor(quality)
  return Kit.QUALITY_COLORS[quality] or Kit.QUALITY_COLORS[1]
end

-- "1,234 characters": a count with its unit, in groups of three.
function Kit.characters(count)
  local digits = string.format("%.0f", count)
  while true do
    local grouped, changed = string.gsub(digits, "^(%d+)(%d%d%d)", "%1,%2")
    if changed == 0 then break end
    digits = grouped
  end
  return digits .. (count == 1 and " character" or " characters")
end

-- Text cut to at most `limit` bytes, never inside a UTF-8 character, with "..." at the end when something was cut.
function Kit.cutText(text, limit)
  text = tostring(text or "")
  if #text <= limit then return text end
  local cut = math.max(limit - 3, 0)
  while cut > 0 do
    local byte = string.byte(text, cut + 1)
    if byte and byte >= 128 and byte < 192 then cut = cut - 1 else break end
  end
  return string.sub(text, 1, cut) .. "..."
end

-- The picture of a class by its token ("WARRIOR"): the game's own file Interface\Icons\ClassIcon_Warrior, seen to draw for these nine
-- classes in the beta on 2026-10-22 (the class sheet drew the same pictures). Nil for another class.
local CLASS_FILES = {
  WARRIOR = "Warrior", PALADIN = "Paladin", HUNTER = "Hunter", ROGUE = "Rogue", PRIEST = "Priest", SHAMAN = "Shaman", MAGE = "Mage",
  WARLOCK = "Warlock", DRUID = "Druid",
}
function Kit.classIconFile(token)
  if type(token) ~= "string" then return nil end
  local name = CLASS_FILES[string.upper(token)]
  return name and ("Interface\\Icons\\ClassIcon_" .. name) or nil
end

-- "ff8000" for a color, to build |cff...|r escapes.
function Kit.hex(color)
  local function channel(value) return math.floor(math.min(math.max(value, 0), 1) * 255 + 0.5) end
  return string.format("%02x%02x%02x", channel(color[1]), channel(color[2]), channel(color[3]))
end

-- Text in a color: "|cffa335eeBlade of the Fixture|r".
function Kit.colored(color, text)
  return "|cff" .. Kit.hex(color) .. tostring(text) .. "|r"
end

-- The kit: constructors that share one density, one chrome and the saved window positions.
-- options: density ("compact" or "roomy"), chrome ("stock" or "flat"), positions (a table the kit keeps current), scale,
-- onError (called with a message when a handler fails; default: print).
function Kit.new(options)
  options = options or {}
  local kit = { options = options }
  local m = Kit.DENSITIES[options.density] or Kit.DENSITIES.compact
  local colors = Kit.COLORS
  kit.m = m
  kit.colors = colors
  kit.characters = Kit.characters

  -- A handler that can fail without breaking the window or the raid: the error is reported, not raised.
  function kit.safe(fn)
    return function(...)
      local ok, err = pcall(fn, ...)
      if not ok then
        if options.onError then options.onError(err) else print("Intrepid Manager: " .. tostring(err)) end
      end
    end
  end

  function kit.fill(parent, color, layer)
    local texture = parent:CreateTexture(nil, layer or "BACKGROUND")
    texture:SetAllPoints()
    texture:SetColorTexture(color[1], color[2], color[3], color[4] or 1)
    return texture
  end

  -- Text that fits a one line label of this width: cut with "..." when it would not (about 6 pixels a character in the compact
  -- density, 7.5 in the roomy one, a little more than the widest of an average word).
  function kit.fit(text, width)
    local perChar = m.name == "roomy" and 7.5 or 6.5
    return Kit.cutText(text, math.max(4, math.floor(width / perChar)))
  end

  -- A one line label. options: font ("text", "gold" or "title"), color, justify, width, wrap (default false: one line).
  function kit.label(parent, text, options_)
    local o = options_ or {}
    local label = parent:CreateFontString(nil, "OVERLAY", m[o.font or "text"])
    label:SetJustifyH(o.justify or "LEFT")
    label:SetJustifyV("MIDDLE")
    if o.width then label:SetWidth(o.width) end
    if not o.wrap then label:SetWordWrap(false) end
    local color = o.color
    if color then label:SetTextColor(color[1], color[2], color[3]) end
    if text then label:SetText(text) end
    return label
  end

  -- A stock button; the primary action is red, the rest gray.
  function kit.button(parent, text, options_)
    local o = options_ or {}
    local button
    if o.primary then
      button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    else
      button = CreateFrame("Button", nil, parent, "UIPanelButtonGrayTemplate")
    end
    button:SetSize(o.width or 80, m.button)
    button:SetText(text)
    return button
  end

  -- A one line edit box. Enter and Escape only leave it: Enter never acts.
  function kit.input(parent, options_)
    local o = options_ or {}
    local box = CreateFrame("EditBox", nil, parent, "InputBoxTemplate")
    box:SetSize(o.width or 120, m.input)
    box:SetAutoFocus(false)
    if o.maxLetters then box:SetMaxLetters(o.maxLetters) end
    local path = box:GetFont()
    if path then box:SetFont(path, m.inputFont, "") end
    box:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
    box:SetScript("OnEnterPressed", function(self) self:ClearFocus() end)
    return box
  end

  -- An edit box made without a template has no font, and the game refuses its text until it has one: give it the file and
  -- size of one of the game's font objects (the density's text font by default).
  function kit.setFont(box, fontObject)
    local path, size, flags = _G[fontObject or m.text]:GetFont()
    box:SetFont(path, size, flags)
  end

  -- A multi-line text box that scrolls: a background, a scroll frame (the stock one with its bar, or a plain one when the game
  -- refuses the template) and a multi-line edit box in it, built as the probe's paste window was (100,000 characters went in
  -- whole in the beta). In the game the edit box grows with its text, keeps every character, and takes clicks only on its own
  -- text line, so a click anywhere in the box focuses it. Escape leaves the box. Returns { region, scroll, edit, barRoom };
  -- the caller places `region` and sets the box's other scripts.
  function kit.textArea(parent, width, height)
    local region = CreateFrame("Frame", nil, parent)
    region:SetSize(width, height)
    kit.fill(region, colors.panelAlt)

    local templated, scroll = pcall(CreateFrame, "ScrollFrame", nil, region, "UIPanelScrollFrameTemplate")
    local barRoom = BAR_ROOM
    if not templated or not scroll then
      scroll = CreateFrame("ScrollFrame", nil, region)
      barRoom = 0
    end
    scroll:SetSize(width - barRoom, height)
    scroll:SetPoint("TOPLEFT", 0, 0)

    local edit = CreateFrame("EditBox", nil, scroll)
    edit:SetMultiLine(true)
    edit:SetAutoFocus(false)
    edit:SetMaxLetters(0) -- no limit: a night string runs to tens of thousands of characters
    kit.setFont(edit)
    edit:SetTextInsets(4, 4, 3, 3)
    edit:SetSize(width - barRoom, height)
    scroll:SetScrollChild(edit)

    scroll:EnableMouse(true)
    scroll:SetScript("OnMouseDown", function() edit:SetFocus() end)
    edit:SetScript("OnEscapePressed", function(box) box:ClearFocus() end)
    return { region = region, scroll = scroll, edit = edit, barRoom = barRoom }
  end

  -- A check box with its label to the right (box.label).
  function kit.check(parent, text)
    local box = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
    box:SetSize(m.check, m.check)
    box.label = kit.label(parent, text, {})
    box.label:SetPoint("LEFT", box, "RIGHT", 2, 0)
    return box
  end

  -- An item icon with a border in the quality's color. icon.art is the picture.
  function kit.icon(parent, size, quality, texture)
    local icon = CreateFrame("Frame", nil, parent, "BackdropTemplate")
    icon:SetSize(size, size)
    icon:SetBackdrop({ edgeFile = FLAT, edgeSize = size >= 24 and 2 or 1 })
    local color = Kit.qualityColor(quality)
    icon:SetBackdropBorderColor(color[1], color[2], color[3], 1)
    icon.art = icon:CreateTexture(nil, "ARTWORK")
    local inner = size >= 24 and 2 or 1
    icon.art:SetPoint("TOPLEFT", inner, -inner)
    icon.art:SetPoint("BOTTOMRIGHT", -inner, inner)
    if texture then icon.art:SetTexture(texture) end
    return icon
  end

  function kit.setIcon(icon, quality, texture)
    local color = Kit.qualityColor(quality)
    icon:SetBackdropBorderColor(color[1], color[2], color[3], 1)
    icon.art:SetTexture(texture)
  end

  -- Escape closes the frame (the game keeps the list of frames that Escape closes).
  function kit.escapeCloses(name)
    for _, existing in ipairs(UISpecialFrames) do
      if existing == name then return end
    end
    table.insert(UISpecialFrames, name)
  end

  -- A list that scrolls: a scroll frame of the given size with a content frame of the given width inside, wheel
  -- scrolling and a thin scroll bar. The caller fills list.content and tells the list how tall it is.
  function kit.scrollList(parent, width, height)
    local list = { view = height, height = height }
    local scroll = CreateFrame("ScrollFrame", nil, parent)
    scroll:SetSize(width, height)
    local content = CreateFrame("Frame", nil, scroll)
    content:SetSize(width - m.bar - 2, 1)
    scroll:SetScrollChild(content)
    scroll:EnableMouseWheel(true)
    local track = scroll:CreateTexture(nil, "BORDER")
    track:SetPoint("TOPRIGHT", 0, 0)
    track:SetPoint("BOTTOMRIGHT", 0, 0)
    track:SetWidth(m.bar)
    track:SetColorTexture(colors.track[1], colors.track[2], colors.track[3], 1)
    local thumb = scroll:CreateTexture(nil, "ARTWORK")
    thumb:SetWidth(m.bar)
    thumb:SetColorTexture(colors.thumb[1], colors.thumb[2], colors.thumb[3], 1)
    list.frame, list.content = scroll, content

    local function range() return math.max(0, list.height - list.view) end

    function list.refresh()
      local top = math.min(math.max(scroll:GetVerticalScroll(), 0), range())
      scroll:SetVerticalScroll(top)
      local scrolls = range() > 0
      track:SetShown(scrolls)
      thumb:SetShown(scrolls)
      if scrolls then
        local size = math.max(12, list.view * list.view / list.height)
        thumb:SetHeight(size)
        thumb:ClearAllPoints()
        thumb:SetPoint("TOPRIGHT", 0, -(list.view - size) * top / range())
      end
    end

    -- How tall the content is.
    function list.setContentHeight(contentHeight)
      list.height = math.max(contentHeight, 1)
      content:SetHeight(list.height)
      list.refresh()
    end

    -- How tall the visible part is (a banner above may take some of it).
    function list.setViewHeight(viewHeight)
      list.view = viewHeight
      scroll:SetHeight(viewHeight)
      list.refresh()
    end

    function list.scrollBy(pixels)
      scroll:SetVerticalScroll(math.min(math.max(scroll:GetVerticalScroll() + pixels, 0), range()))
      list.refresh()
    end

    function list.scrollTo(pixels)
      scroll:SetVerticalScroll(math.min(math.max(pixels, 0), range()))
      list.refresh()
    end

    -- Scroll so that the line `top` to `top + lineHeight` is in view.
    function list.reveal(top, lineHeight)
      local offset = scroll:GetVerticalScroll()
      if top < offset then
        list.scrollTo(top)
      elseif top + lineHeight > offset + list.view then
        list.scrollTo(top + lineHeight - list.view)
      end
    end

    scroll:SetScript("OnMouseWheel", kit.safe(function(_, delta) list.scrollBy(-delta * 3 * m.row) end))
    return list
  end

  -- A window. options: name (a global name, needed for Escape), title, width, height (default: the density's),
  -- strata (default "DIALOG"), onClose, anchor ({ point = "TOPLEFT", x = 40, y = -90 }: where it opens until it is dragged; the
  -- center otherwise), chrome (this window's own: "clear" is a translucent dark panel with a thin border, the way
  -- a loot council's windows look; the kit's chrome otherwise). Returns { frame, body, setTitle, show, hide, toggle, isShown }:
  -- `body` is the frame to build in. The stock frame is tried first; the flat one is the fallback (and the choice when the chrome
  -- is "flat").
  function kit.window(spec)
    local width, height = spec.width or m.windowWidth, spec.height or m.windowHeight
    local window = {}
    local frame, title, close, body
    local chrome = spec.chrome or options.chrome

    if chrome ~= "flat" and chrome ~= "clear" then
      local made, result = pcall(CreateFrame, "Frame", spec.name, UIParent, "BasicFrameTemplateWithInset")
      if made then
        frame = result
        -- the stock frame has a title text and a close button as named parts (measured in the beta); `Inset` is not one of
        -- them, but a client that has it gets it used
        title, close, body = rawget(frame, "TitleText"), rawget(frame, "CloseButton"), rawget(frame, "Inset")
        window.chrome = "stock"
      end
    end

    if not frame then
      frame = CreateFrame("Frame", spec.name, UIParent, "BackdropTemplate")
      frame:SetBackdrop({ bgFile = FLAT, edgeFile = FLAT, edgeSize = 1 })
      if chrome == "clear" then
        frame:SetBackdropColor(0.04, 0.04, 0.06, 0.84)
        frame:SetBackdropBorderColor(0.38, 0.38, 0.44, 1)
        window.chrome = "clear"
      else
        frame:SetBackdropColor(colors.window[1], colors.window[2], colors.window[3], 0.97)
        frame:SetBackdropBorderColor(colors.gold[1] * 0.6, colors.gold[2] * 0.6, colors.gold[3] * 0.6, 1)
        window.chrome = "flat"
      end
    end
    if not title then
      title = frame:CreateFontString(nil, "OVERLAY", m.title)
      title:SetPoint("TOP", 0, -6)
    end
    if not close then
      close = CreateFrame("Button", nil, frame)
      close:SetSize(18, 18)
      close:SetPoint("TOPRIGHT", -4, -4)
      kit.fill(close, { 0.5, 0.12, 0.1, 1 })
      kit.label(close, "x", { justify = "CENTER", color = colors.gold }):SetAllPoints()
      close:SetScript("OnClick", function() frame:Hide() end)
    end
    if not body then
      -- (the stock frame has no Inset frame, only a texture 4 pixels from the left and bottom, 24 from the top and 6 from
      -- the right, measured in the beta: the body covers it exactly. The flat frame has no art, so its body is even)
      body = CreateFrame("Frame", nil, frame)
      body:SetPoint("TOPLEFT", 4, -24)
      body:SetPoint("BOTTOMRIGHT", window.chrome == "stock" and -6 or -4, 4)
      if window.chrome == "clear" then
        kit.fill(body, { 0, 0, 0, 0.18 })
      else
        kit.fill(body, colors.side)
      end
    end

    frame:SetSize(width, height)
    frame:SetFrameStrata(spec.strata or "DIALOG")
    frame:SetClampedToScreen(true)
    frame:SetScale(options.scale or 1)
    title:SetText(spec.title or "")
    if spec.onClose then close:HookScript("OnClick", kit.safe(spec.onClose)) end

    -- dragging by the title area, and where it was left
    local positions = options.positions
    if positions and spec.name and positions[spec.name] then
      local saved = positions[spec.name]
      frame:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", saved.left, saved.top)
    elseif spec.anchor then
      frame:SetPoint(spec.anchor.point, UIParent, spec.anchor.point, spec.anchor.x or 0, spec.anchor.y or 0)
    else
      frame:SetPoint("CENTER")
    end
    frame:SetMovable(true)
    frame:EnableMouse(true)
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", function(self) self:StartMoving() end)
    frame:SetScript("OnDragStop", kit.safe(function(self)
      self:StopMovingOrSizing()
      if positions and spec.name then
        positions[spec.name] = { left = self:GetLeft(), top = self:GetTop() }
      end
    end))
    if spec.name then kit.escapeCloses(spec.name) end

    window.frame, window.body, window.title = frame, body, title
    function window.setTitle(text) title:SetText(text) end
    function window.show() frame:Show() end
    function window.hide() frame:Hide() end
    function window.isShown() return frame:IsShown() end
    function window.toggle() frame:SetShown(not frame:IsShown()) end
    return window
  end

  return kit
end
