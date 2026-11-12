-- Strict stand-ins for the game's frames, font strings and textures, for tests of the addon's windows.
--
-- "Strict" means the known-good list (tools/api-known.json) is the judge. A frame type, template, font object, event
-- or method that is not on the list raises an error, and so does one the list says the client lacks, so a typo or an
-- API we have no evidence for fails a test here and not in a raid. The list says that a name exists, not which kind
-- of widget it belongs to; for the kinds the game was asked about (tools/api-widgets.json, measured with /im facts: Frame,
-- Button, CheckButton, EditBox, ScrollFrame, Slider, StatusBar, FontString, Texture) the stand-ins also refuse a method that
-- the game's widget of that kind does not have, so SetText on a plain Frame fails here. Other kinds accept any known method;
-- UI.new({ widgets = false }) turns the check off. Names marked unverified are accepted and recorded in game.unverified.
--
-- What the stand-ins remember (for assertions here, and for the layout and picture code): parent and children,
-- anchors, size, shown state, text and how it is set (justify, wrap), colors, backdrops, scroll and clip settings,
-- scripts, registered events. Everything else a known method does is counted in game.counts and nothing more.
-- Whether a method may be called is always decided by the list; the stand-in only supplies the behavior. Tests read
-- what a widget remembers with game.state(widget), which needs no method of the list. Text widths are estimates
-- (game.text_width), not the game's font metrics.
--
--   local UI = dofile("tests/support/strict_ui.lua")
--   local game = UI.new()                         -- reads tools/api-known.json
--   local frame = game.env.CreateFrame("Frame", "Demo", game.env.UIParent, "BasicFrameTemplate")
--   game.load("IntrepidManager/ui/Kit.lua", ns)   -- runs an addon file with game.env as its globals
--   game.fire(frame, "OnShow")                    -- run a script handler
--   game.send("LOOT_OPENED")                      -- send an event to every frame that registered for it
--   game.paste(editBox, "text")                   -- a player pastes into an edit box that has the keyboard focus
--   game.advance(0.3)                             -- time passes: C_Timer.After callbacks that are due run
--
-- The clock starts at options.clock (default 1796866200, 2026-12-10 01:30 UTC, an hour after the fixtures' night).
-- GetServerTime(), GetTime() and date() read it, date() in UTC so that a test gives the same answer in every time zone. Nothing runs by
-- itself: timers wait for game.advance. options.setTextFires makes SetText on an edit box run OnTextChanged (with
-- userInput false), which is what the game is believed to do; by default it does not, and a window should work either way.

local Metrics = dofile("tests/support/metrics.lua")

local StrictUI = {}

local POINTS = {
  TOPLEFT = true, TOP = true, TOPRIGHT = true, LEFT = true, CENTER = true, RIGHT = true,
  BOTTOMLEFT = true, BOTTOM = true, BOTTOMRIGHT = true,
}
local LAYERS = { BACKGROUND = true, BORDER = true, ARTWORK = true, OVERLAY = true, HIGHLIGHT = true }
local STRATA = {
  WORLD = true, BACKGROUND = true, LOW = true, MEDIUM = true, HIGH = true, DIALOG = true, FULLSCREEN = true,
  FULLSCREEN_DIALOG = true, TOOLTIP = true,
}

local function split(text)
  local items = {}
  for item in string.gmatch(text, "[^,%s]+") do items[#items + 1] = item end
  return items
end

local function deepCopy(value)
  if type(value) ~= "table" then return value end
  local copy = {}
  for key, item in pairs(value) do copy[key] = deepCopy(item) end
  return copy
end

-- Reads the list with the addon's own JSON reader (no helper of the test runner is needed, so the storyboards can use this too).
local function decode(path)
  local ns = {}
  assert(loadfile("IntrepidManager/core/Json.lua"))("IntrepidManager", ns)
  local handle = assert(io.open(path, "rb"))
  local text = handle:read("*a")
  handle:close()
  local ok, data = ns.Json.decode(text)
  assert(ok, data)
  return data
end

local knownCache
local widgetsCache

-- The methods the game gives each kind of widget, as sets: { Button = { SetText = true, ... }, ... } (tools/api-widgets.json).
local function widgetMethodSets()
  if not widgetsCache then
    widgetsCache = {}
    local sets = decode("tools/api-widgets.json").types
    for kind, names in pairs(sets) do
      local set = {}
      for _, name in ipairs(names) do set[name] = true end
      widgetsCache[kind] = set
    end
  end
  return widgetsCache
end

-- What a template adds to the frame it is given, besides the methods of its kind (BackdropTemplate is a mixin the game copies in).
local TEMPLATE_METHODS = {
  BackdropTemplate = { SetBackdrop = true, SetBackdropColor = true, SetBackdropBorderColor = true, GetBackdrop = true,
    GetBackdropColor = true, GetBackdropBorderColor = true, ClearBackdrop = true },
}

-- The list, read with the addon's own JSON reader. Reading takes a moment, so it is read once per run and every
-- caller gets its own copy to edit; UI.new() without options.known uses the one shared copy, which nobody may edit.
function StrictUI.load_known(path)
  if path then return decode(path) end
  knownCache = knownCache or decode("tools/api-known.json")
  return deepCopy(knownCache)
end

-- A copy of the list that also knows every method the stand-ins can do, for code that asks the game things on purpose
-- without having them on the list (the facts run reads many getters that no window calls).
function StrictUI.full_known()
  local known = StrictUI.load_known()
  for name in pairs(StrictUI.new().behaviors) do
    if known.present.methods[name] == nil and known.unverified.methods[name] == nil then known.present.methods[name] = "fl" end
  end
  return known
end

local function sharedKnown()
  knownCache = knownCache or decode("tools/api-known.json")
  return knownCache
end

local function statusOf(known, kind, name)
  for _, status in ipairs({ "present", "absent", "unverified" }) do
    local entry = known[status][kind][name]
    if entry ~= nil then return status, entry end
  end
end

function StrictUI.new(options)
  options = options or {}
  local known = options.known or sharedKnown()
  local game = {
    known = known,    -- the list the stand-ins judge by
    frames = {},      -- every frame, in creation order
    named = {},       -- frames and regions by name
    counts = {},      -- method name -> how often the generic (remember nothing) version ran
    unverified = {},  -- "kind name" -> note, for unverified names the code touched
    templates = {},   -- template name -> function(frame, game) that adds the parts that template creates
    printed = {},     -- what print() was given
    screen = { width = 1920, height = 1080 },
    options = options,
    clock = options.clock or 1796866200, -- seconds; GetServerTime() and date() read it, game.advance moves it
    timers = {},      -- C_Timer.After callbacks that wait: { at, order, callback }
  }
  local state = setmetatable({}, { __mode = "k" }) -- widget -> what it remembers
  local impl = {}

  -- Raise unless `name` is a known `kind` ("methods", "events", ...). `level` is where the error points.
  local function need(kind, name, what, level)
    local status, detail = statusOf(known, kind, name)
    if status == "present" then return end
    if status == "unverified" then
      game.unverified[kind .. " " .. name] = detail
      return
    end
    if status == "absent" then
      error(what .. " '" .. tostring(name) .. "' does not exist on the Forever client (tools/api-known.json: " .. detail .. ")", level + 1)
    end
    error(what .. " '" .. tostring(name) .. "' is not on the known-good list (tools/api-known.json)", level + 1)
  end

  local function allowedMethod(name)
    local status, detail = statusOf(known, "methods", name)
    if status == "unverified" then game.unverified["methods " .. name] = detail end
    return status == "present" or status == "unverified", status
  end

  local widgetMeta = {}
  function widgetMeta.__index(self, key)
    if type(key) ~= "string" or not string.find(key, "^%u") then return nil end -- own fields are lowerCamelCase
    local ok, status = allowedMethod(key)
    if ok then
      local mine = state[self]
      local owned = mine and options.widgets ~= false and widgetMethodSets()[mine.kind]
      if owned and not owned[key] then
        local mixed = false
        for _, template in ipairs(mine.templates or {}) do
          if TEMPLATE_METHODS[template] and TEMPLATE_METHODS[template][key] then mixed = true end
        end
        if not mixed then
          error("method '" .. key .. "' is not a method of a " .. mine.kind .. " in the game (tools/api-widgets.json, measured "
            .. "with /im facts): it is on the list, but for another kind of widget", 2)
        end
      end
      return impl[key] or function()
        game.counts[key] = (game.counts[key] or 0) + 1
      end
    end
    if status == "absent" then
      error("method '" .. key .. "' does not exist on the Forever client (tools/api-known.json)", 2)
    end
    error("'" .. key .. "' is not a method on the known-good list (tools/api-known.json) and not a part of a template; "
      .. "a typo, or an API that needs a source", 2)
  end

  local function newWidget(kind, name, parent, isRegion)
    local widget = setmetatable({}, widgetMeta)
    if name and parent and string.find(name, "$parent", 1, true) then
      name = string.gsub(name, "%$parent", state[parent].name or "")
    end
    local above = parent and state[parent]
    state[widget] = {
      kind = kind, name = name, parent = parent, children = {}, regions = {}, points = {}, scripts = {}, hooks = {},
      events = {}, shown = true, width = 0, height = 0, alpha = 1, scale = 1, text = nil, size = 12,
      strata = above and above.strata or "MEDIUM", -- a frame starts with its parent's strata and one level above it
      level = above and (isRegion and above.level or above.level + 1) or 0, isRegion = isRegion or false,
    }
    if name then
      game.named[name] = widget
      game.env[name] = widget
    end
    if parent then
      local list = isRegion and state[parent].regions or state[parent].children
      list[#list + 1] = widget
    end
    return widget
  end

  local function remove(list, widget)
    for i, item in ipairs(list) do
      if item == widget then
        table.remove(list, i)
        return
      end
    end
  end

  game.env = setmetatable({
    print = function(...)
      local parts = {}
      for i = 1, select("#", ...) do parts[i] = tostring((select(i, ...))) end
      game.printed[#game.printed + 1] = table.concat(parts, " ")
    end,
    SlashCmdList = {},
    UISpecialFrames = {}, -- the names of the frames that Escape closes
    GetServerTime = function() return math.floor(game.clock) end,
    GetTime = function() return game.clock end,
    date = function(format, at)
      if string.sub(format, 1, 1) ~= "!" then format = "!" .. format end
      return os.date(format, at or math.floor(game.clock))
    end,
  }, { __index = _G })
  game.env._G = game.env
  -- The game's font objects are globals (edit:SetFontObject(GameFontHighlight)); the stand-ins have those of the list.
  -- (with GetFont and GetTextColor, the two things the code asks a font object for)
  for name in pairs(known.present.fonts) do
    local look = Metrics.FONT_OBJECTS[name] or Metrics.DEFAULT_FONT
    game.env[name] = {
      fontName = name,
      GetFont = function() return look.path or "Fonts\\FRIZQT__.TTF", look.size, look.flags or "" end,
      GetTextColor = function() return look.color[1], look.color[2], look.color[3], 1 end,
    }
  end

  local timerCount = 0
  game.env.C_Timer = {
    After = function(seconds, callback)
      if type(seconds) ~= "number" or type(callback) ~= "function" then error("Usage: C_Timer.After(seconds, callback)", 2) end
      timerCount = timerCount + 1
      game.timers[#game.timers + 1] = { at = game.clock + seconds, order = timerCount, callback = callback }
    end,
  }

  function game.env.CreateFrame(frameType, name, parent, template)
    need("frame_types", frameType, "frame type", 2)
    local templates = split(template or "")
    for _, item in ipairs(templates) do need("templates", item, "template", 2) end
    if parent ~= nil and not state[parent] then error("CreateFrame(): the parent is not a frame", 2) end
    local widget = newWidget(frameType, name, parent or game.env.UIParent)
    state[widget].templates = templates
    game.frames[#game.frames + 1] = widget
    for _, item in ipairs(templates) do
      if game.templates[item] then game.templates[item](widget, game) end
    end
    return widget
  end
  game.CreateFrame = game.env.CreateFrame

  -- UIParent: the whole screen.
  local root = newWidget("Frame", "UIParent", nil)
  state[root].width, state[root].height = game.screen.width, game.screen.height
  game.frames[1] = root
  game.env.UIParent = root

  ---------------------------------------------------------------------------------------------------------------
  -- Methods that remember something. Every other known method is a counted no-op.
  ---------------------------------------------------------------------------------------------------------------

  function impl.GetName(self) return state[self].name end
  function impl.GetObjectType(self) return state[self].kind end
  function impl.GetParent(self) return state[self].parent end
  function impl.SetParent(self, parent)
    local mine = state[self]
    if mine.parent then remove(mine.isRegion and state[mine.parent].regions or state[mine.parent].children, self) end
    mine.parent = parent
    if parent then
      local list = mine.isRegion and state[parent].regions or state[parent].children
      list[#list + 1] = self
    end
  end
  function impl.GetChildren(self) return unpack(state[self].children) end
  function impl.GetNumChildren(self) return #state[self].children end
  function impl.GetRegions(self) return unpack(state[self].regions) end
  function impl.GetNumRegions(self) return #state[self].regions end

  function impl.SetPoint(self, point, ...)
    if not POINTS[point] then error("SetPoint(): unknown anchor point '" .. tostring(point) .. "'", 2) end
    local args = { ... }
    local at = 1
    local relativeTo, relativePoint
    if select("#", ...) >= 1 and type(args[1]) ~= "number" then -- nil, a region or a region's name
      relativeTo = args[1]
      at = 2
      if type(args[at]) == "string" then
        relativePoint = args[at]
        at = at + 1
      end
    end
    local x, y = args[at], args[at + 1]
    if type(relativeTo) == "string" then
      if not game.named[relativeTo] then error("SetPoint(): could not find the region named '" .. relativeTo .. "'", 2) end
      relativeTo = game.named[relativeTo]
    elseif relativeTo ~= nil and not state[relativeTo] then
      error("SetPoint(): the region to anchor to is not a region", 2)
    end
    if relativeTo == self then error("SetPoint(): cannot anchor a region to itself", 2) end
    if relativePoint ~= nil and not POINTS[relativePoint] then
      error("SetPoint(): unknown anchor point '" .. tostring(relativePoint) .. "'", 2)
    end
    if (x ~= nil and type(x) ~= "number") or (y ~= nil and type(y) ~= "number") then
      error("SetPoint(): the offsets must be numbers", 2)
    end
    local points = state[self].points
    points[#points + 1] = {
      point = point, relativeTo = relativeTo or state[self].parent, relativePoint = relativePoint or point,
      x = x or 0, y = y or 0,
    }
  end
  function impl.ClearAllPoints(self) state[self].points = {} end
  function impl.GetNumPoints(self) return #state[self].points end
  function impl.GetPoint(self, index)
    local p = state[self].points[index or 1]
    if not p then return nil end
    return p.point, p.relativeTo, p.relativePoint, p.x, p.y
  end
  function impl.SetAllPoints(self, target)
    state[self].allPoints = target or state[self].parent
    state[self].points = {}
  end

  function impl.SetSize(self, width, height)
    if type(width) ~= "number" or type(height) ~= "number" then error("Usage: SetSize(width, height)", 2) end
    state[self].width, state[self].height = width, height
  end
  function impl.SetWidth(self, width)
    if type(width) ~= "number" then error("Usage: SetWidth(width)", 2) end
    state[self].width = width
  end
  function impl.SetHeight(self, height)
    if type(height) ~= "number" then error("Usage: SetHeight(height)", 2) end
    state[self].height = height
  end
  function impl.GetWidth(self) return state[self].width end
  function impl.GetHeight(self) return state[self].height end
  function impl.GetSize(self) return state[self].width, state[self].height end

  -- Where a widget is on the screen (the layout of tests/support/layout.lua): the left edge, the top edge (counted from the
  -- bottom of the screen, as the game does) and the center.
  local function placed(widget)
    local rect = dofile("tests/support/layout.lua").new(game).rect(widget)
    return rect
  end
  function impl.GetLeft(self)
    local rect = placed(self)
    return rect and rect.left
  end
  function impl.GetTop(self)
    local rect = placed(self)
    return rect and rect.top
  end
  function impl.GetCenter(self)
    local rect = placed(self)
    if rect then return rect.left + rect.width / 2, rect.bottom + rect.height / 2 end
  end

  function impl.SetAlpha(self, alpha) state[self].alpha = alpha end
  function impl.GetAlpha(self) return state[self].alpha end
  function impl.SetScale(self, scale) state[self].scale = scale end
  function impl.GetScale(self) return state[self].scale end
  -- A frame's strata is its children's too: setting it moves the whole tree, as in the game.
  local function setStrata(frame, strata)
    state[frame].strata = strata
    for _, child in ipairs(state[frame].children) do setStrata(child, strata) end
  end
  function impl.SetFrameStrata(self, strata)
    if not STRATA[strata] then error("SetFrameStrata(): unknown strata '" .. tostring(strata) .. "'", 2) end
    setStrata(self, strata)
  end
  function impl.GetFrameStrata(self) return state[self].strata end
  function impl.SetFrameLevel(self, level) state[self].level = level end
  function impl.GetFrameLevel(self) return state[self].level end

  local function setShown(self, shown)
    local mine = state[self]
    if mine.shown == shown then return end
    mine.shown = shown
    game.fire(self, shown and "OnShow" or "OnHide") -- the handler and the hooks, as in the game
  end
  function impl.Show(self) setShown(self, true) end
  function impl.Hide(self) setShown(self, false) end
  function impl.SetShown(self, shown) setShown(self, shown and true or false) end
  function impl.IsShown(self) return state[self].shown end
  local function visible(widget)
    while widget do
      if not state[widget].shown then return false end
      widget = state[widget].parent
    end
    return true
  end
  function impl.IsVisible(self) return visible(self) end

  function impl.SetText(self, text)
    local mine = state[self]
    if mine.kind == "FontString" and not mine.fontObject and not mine.fontPath then
      error("SetText(): the font string has no font (the game says \"Font not set\"); create it with a font object or call SetFont first", 2)
    end
    mine.text = text == nil and "" or tostring(text)
    if mine.kind == "EditBox" and options.setTextFires then game.fire(self, "OnTextChanged", false) end
  end
  function impl.GetText(self) return state[self].text or "" end
  function impl.SetTextColor(self, r, g, b, a) state[self].textColor = { r, g, b, a } end
  function impl.SetFont(self, path, size, flags)
    state[self].fontPath, state[self].size, state[self].fontFlags = path, size or state[self].size, flags
  end
  function impl.GetFont(self) return state[self].fontPath or "Fonts\\FRIZQT__.TTF", state[self].size, state[self].fontFlags or "" end
  -- A font object is a global table of the game (GameFontHighlight); the font string and edit box remember its name.
  function impl.SetFontObject(self, font)
    if type(font) ~= "table" or type(font.fontName) ~= "string" then
      error("SetFontObject(): not a font object (the global is missing, or it is not one of the game's fonts)", 2)
    end
    state[self].fontObject, state[self].fontPath = font.fontName, nil
  end
  -- The size text is drawn at and the face it is measured in: SetFont wins over the font object the widget was made with.
  local function fontSize(mine)
    if mine.fontPath then return mine.size, Metrics.font_for_path(mine.fontPath, mine.size) end
    return (Metrics.FONT_OBJECTS[mine.fontObject] or Metrics.DEFAULT_FONT).size, mine.fontObject
  end
  function impl.GetStringWidth(self)
    local size, face = fontSize(state[self])
    return game.text_width(state[self].text or "", size, face)
  end
  -- The height of the text: one line, or as many as it takes at the width the font string was given (when it may wrap).
  function impl.GetStringHeight(self)
    local mine = state[self]
    local size, face = fontSize(mine)
    local wrapAt = mine.wordWrap ~= false and mine.width > 0 and mine.width or nil
    return #Metrics.layout(mine.text or "", size, wrapAt, wrapAt ~= nil, false, face) * Metrics.line_height(size, face)
  end

  function impl.SetColorTexture(self, r, g, b, a) state[self].color = { r, g, b, a == nil and 1 or a } end
  function impl.SetTexture(self, texture) state[self].texture = texture end
  function impl.SetVertexColor(self, r, g, b, a) state[self].vertexColor = { r, g, b, a == nil and 1 or a } end
  function impl.SetTexCoord(self, ...) state[self].texCoord = { ... } end
  function impl.SetAtlas(self, atlas) state[self].atlas = atlas end
  function impl.SetDesaturated(self, desaturated) state[self].desaturated = desaturated and true or false end
  function impl.SetBlendMode(self, mode) state[self].blendMode = mode end
  function impl.SetGradient(self, orientation, low, high) state[self].gradient = { orientation, low, high } end

  function impl.SetBackdrop(self, backdrop) state[self].backdrop = backdrop end
  function impl.SetBackdropColor(self, r, g, b, a) state[self].backdropColor = { r, g, b, a == nil and 1 or a } end
  function impl.SetBackdropBorderColor(self, r, g, b, a) state[self].backdropBorderColor = { r, g, b, a == nil and 1 or a } end

  function impl.SetJustifyH(self, justify) state[self].justifyH = justify end
  function impl.SetJustifyV(self, justify) state[self].justifyV = justify end
  function impl.SetWordWrap(self, wrap) state[self].wordWrap = wrap and true or false end
  function impl.SetNonSpaceWrap(self, wrap) state[self].nonSpaceWrap = wrap and true or false end
  function impl.SetMaxLines(self, lines) state[self].maxLines = lines end
  function impl.SetTextInsets(self, left, right, top, bottom) state[self].textInsets = { left, right, top, bottom } end
  function impl.SetShadowColor(self, r, g, b, a) state[self].shadowColor = { r, g, b, a == nil and 1 or a } end
  function impl.SetMultiLine(self, multiLine) state[self].multiLine = multiLine and true or false end

  function impl.SetNormalTexture(self, texture) state[self].normalTexture = texture end
  function impl.SetPushedTexture(self, texture) state[self].pushedTexture = texture end
  function impl.SetHighlightTexture(self, texture) state[self].highlightTexture = texture end
  function impl.SetDisabledTexture(self, texture) state[self].disabledTexture = texture end
  function impl.SetStatusBarTexture(self, texture) state[self].barTexture = texture end
  function impl.SetOrientation(self, orientation) state[self].orientation = orientation end

  function impl.SetClipsChildren(self, clips) state[self].clips = clips and true or false end
  function impl.SetScrollChild(self, child) state[self].scrollChild = child end
  function impl.SetVerticalScroll(self, offset) state[self].vscroll = offset end
  function impl.GetVerticalScroll(self) return state[self].vscroll or 0 end
  function impl.GetVerticalScrollRange(self)
    local child = state[self].scrollChild
    return child and math.max(0, state[child].height - state[self].height) or 0
  end
  function impl.SetChecked(self, checked) state[self].checked = checked and true or false end
  function impl.GetChecked(self) return state[self].checked or false end
  function impl.SetValue(self, value) state[self].value = value end
  function impl.GetValue(self) return state[self].value or 0 end
  function impl.SetMinMaxValues(self, low, high) state[self].min, state[self].max = low, high end
  function impl.SetEnabled(self, enabled) state[self].enabled = enabled and true or false end
  function impl.IsEnabled(self) return state[self].enabled ~= false end
  function impl.Enable(self) state[self].enabled = true end
  function impl.Disable(self) state[self].enabled = false end

  function impl.EnableMouse(self, enabled) state[self].mouse = enabled ~= false end
  function impl.EnableMouseWheel(self, enabled) state[self].wheel = enabled ~= false end
  function impl.SetMovable(self, movable) state[self].movable = movable ~= false end
  function impl.SetClampedToScreen(self, clamped) state[self].clamped = clamped ~= false end
  function impl.SetAutoFocus(self, autoFocus) state[self].autoFocus = autoFocus ~= false end
  function impl.SetMaxLetters(self, letters) state[self].maxLetters = letters end

  -- The keyboard focus belongs to one edit box at a time; the box is told when it gets it and when it loses it.
  local focused
  function impl.SetFocus(self)
    if focused == self then return end
    local before = focused
    focused = self
    if before then
      state[before].focus = false
      game.fire(before, "OnEditFocusLost")
    end
    state[self].focus = true
    game.fire(self, "OnEditFocusGained")
  end
  function impl.ClearFocus(self)
    if focused ~= self then return end
    focused = nil
    state[self].focus = false
    game.fire(self, "OnEditFocusLost")
  end
  function impl.HasFocus(self) return state[self].focus == true end
  function impl.RegisterForDrag(self, ...) state[self].drag = { ... } end

  function impl.SetScript(self, name, handler)
    if type(name) ~= "string" or name == "" then error("Usage: SetScript(\"name\", handler)", 2) end
    if handler ~= nil and type(handler) ~= "function" then error("SetScript(): the handler must be a function or nil", 2) end
    state[self].scripts[name] = handler
  end
  function impl.GetScript(self, name) return state[self].scripts[name] end
  function impl.HookScript(self, name, handler)
    local mine = state[self]
    local hooks = mine.hooks[name] or {}
    mine.hooks[name] = hooks
    hooks[#hooks + 1] = handler
  end

  function impl.RegisterEvent(self, event)
    need("events", event, "event", 2)
    state[self].events[event] = true
  end
  function impl.RegisterUnitEvent(self, event)
    need("events", event, "event", 2)
    state[self].events[event] = true
  end
  function impl.UnregisterEvent(self, event) state[self].events[event] = nil end
  function impl.UnregisterAllEvents(self) state[self].events = {} end
  function impl.IsEventRegistered(self, event) return state[self].events[event] == true end

  function impl.CreateFontString(self, name, layer, inherits)
    if layer ~= nil and not LAYERS[layer] then error("CreateFontString(): unknown draw layer '" .. tostring(layer) .. "'", 2) end
    if inherits ~= nil then need("fonts", inherits, "font object", 2) end
    local region = newWidget("FontString", name, self, true)
    state[region].layer = layer or "ARTWORK"
    state[region].fontObject = inherits
    return region
  end
  function impl.CreateTexture(self, name, layer, inherits, subLevel)
    if layer ~= nil and not LAYERS[layer] then error("CreateTexture(): unknown draw layer '" .. tostring(layer) .. "'", 2) end
    if inherits ~= nil then need("templates", inherits, "template", 2) end
    local region = newWidget("Texture", name, self, true)
    state[region].layer = layer or "ARTWORK"
    state[region].sublevel = subLevel or 0
    return region
  end

  ---------------------------------------------------------------------------------------------------------------
  -- Helpers for tests.
  ---------------------------------------------------------------------------------------------------------------

  -- What a widget remembers (kind, name, parent, children, regions, points, size, shown, text, scripts, events).
  function game.state(widget) return state[widget] end

  function game.find(name) return game.named[name] end

  -- Mistakes the game would not forgive: a plain frame with a mouse script that never called EnableMouse (the game never
  -- sends it the event), a mouse wheel script without EnableMouseWheel, a drag script without RegisterForDrag.
  -- Buttons, check boxes, edit boxes, sliders and status bars take the mouse by themselves. Returns a list of texts.
  local MOUSE_BY_DEFAULT = { Button = true, CheckButton = true, EditBox = true, Slider = true, StatusBar = true, ScrollFrame = false }
  function game.audit()
    local problems = {}
    for index, frame in ipairs(game.frames) do
      local mine = state[frame]
      if index > 1 then
        local label = (mine.name and ("'" .. mine.name .. "'") or ("#" .. index)) .. " (" .. mine.kind .. ")"
        local scripts = mine.scripts
        local mouse = mine.mouse or MOUSE_BY_DEFAULT[mine.kind]
        for _, script in ipairs({ "OnMouseDown", "OnMouseUp", "OnEnter", "OnLeave", "OnDragStart", "OnDragStop" }) do
          if scripts[script] and not mouse then
            problems[#problems + 1] = "frame " .. label .. " has " .. script .. " but EnableMouse(true) was never called"
          end
        end
        if scripts.OnMouseWheel and not mine.wheel then
          problems[#problems + 1] = "frame " .. label .. " has OnMouseWheel but EnableMouseWheel(true) was never called"
        end
        if scripts.OnDragStart and not mine.drag then
          problems[#problems + 1] = "frame " .. label .. " has OnDragStart but RegisterForDrag was never called"
        end
        if mine.drag and not mine.movable and scripts.OnDragStart then
          problems[#problems + 1] = "frame " .. label .. " is dragged but SetMovable(true) was never called"
        end
      end
    end
    return problems
  end

  -- Whether a widget and all its parents are shown.
  game.visible = visible

  -- The behaviors the stand-in has (a method also needs a place on the list before code can call it).
  game.behaviors = impl

  -- The width of a string at a font size, in a font object's face (tests/support/metrics.lua, from what the game measured).
  function game.text_width(text, size, face) return Metrics.width(text, size or 12, face) end

  -- Run a script handler (and its hooks) the way the game would.
  function game.fire(widget, script, ...)
    local mine = state[widget]
    local handler = mine.scripts[script]
    local result
    if handler then result = handler(widget, ...) end
    for _, hook in ipairs(mine.hooks[script] or {}) do hook(widget, ...) end
    return result
  end

  -- A player pastes `text` into an edit box: the box must be shown and have the keyboard focus (click it first), the
  -- text replaces what was there (cut to the letter limit, when SetMaxLetters gave one), and OnTextChanged runs with
  -- userInput true.
  function game.paste(box, text)
    local mine = state[box]
    if mine.kind ~= "EditBox" then error("game.paste(): not an edit box", 2) end
    if not visible(box) then error("game.paste(): the edit box is not shown", 2) end
    if not mine.focus then error("game.paste(): the edit box does not have the keyboard focus (click it first)", 2) end
    if type(mine.maxLetters) == "number" and mine.maxLetters > 0 then text = string.sub(text, 1, mine.maxLetters) end
    mine.text = text
    game.fire(box, "OnTextChanged", true)
  end

  -- Let time pass: the clock moves and every C_Timer.After callback that falls due runs, earliest first (a callback
  -- may start another timer that also falls due).
  function game.advance(seconds)
    local target = game.clock + seconds
    while true do
      local first
      for index, timer in ipairs(game.timers) do
        local best = first and game.timers[first]
        if timer.at <= target + 1e-9 and (not best or timer.at < best.at or (timer.at == best.at and timer.order < best.order)) then
          first = index
        end
      end
      if not first then break end
      local timer = table.remove(game.timers, first)
      game.clock = math.max(game.clock, timer.at)
      timer.callback()
    end
    game.clock = target
  end

  -- Send an event to every frame that registered for it.
  function game.send(event, ...)
    for _, frame in ipairs(game.frames) do
      if state[frame].events[event] then game.fire(frame, "OnEvent", event, ...) end
    end
  end

  -- Run OnUpdate on every visible frame that has one.
  function game.update(elapsed)
    for _, frame in ipairs(game.frames) do
      if state[frame].scripts.OnUpdate and visible(frame) then game.fire(frame, "OnUpdate", elapsed) end
    end
  end

  -- Load an addon file the way the client does: the chunk gets (addon name, shared table) and game.env as globals.
  function game.load(path, shared)
    local chunk = assert(loadfile(path))
    setfenv(chunk, game.env)
    shared = shared or {}
    chunk("IntrepidManager", shared)
    return shared
  end

  return game
end

return StrictUI
