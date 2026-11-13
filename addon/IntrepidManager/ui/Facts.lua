-- Intrepid Manager: what the game's own widgets say about themselves (/im facts). The window code was written and tested
-- without a game, on stand-in widgets; this measures what the stand-ins had to guess:
--   * which methods each kind of widget has (the known-good list says a name exists, not on which widget),
--   * the parts, sizes and anchors of the stock templates the kit builds on,
--   * each font object's file, size and color, and the width of every printable character in it,
--   * how a multi-line edit box in a scroll frame behaves with a long text (does it grow, does it scroll, what events fire),
--   * the real width of the text in the windows' labels against the boxes they were given,
--   * what a council window needs from the client: items by id (names, icons, quality, whether they load), a tooltip, the class
--     icon coordinates and colors, and what the player wears.
--
-- Everything is read through pcall, so a name the game lacks or a template it refuses becomes a note in the result and
-- never stops the run. The run changes nothing in the game but a few frames it hides again. Nothing here reads a name, a
-- guild or a bag: only the game's widgets and the sample windows.
--
--   ns.UI.Facts.run({ parent = UIParent, windows = { session = frame, ... }, done = function(result) end })
--   ns.UI.Facts.summary(result)      -- lines for the chat
--
-- `done` is called once every measurement that waits for the game to lay out a frame is in. The result is a plain table
-- (numbers, strings, booleans, tables) that can go straight into the saved variables.

local _, ns = ...

local Facts = {}
ns.UI = ns.UI or {}
ns.UI.Facts = Facts

local MAX_CHILDREN = 30
local MAX_LABELS = 400

-- Frame types and the stock templates the kit uses (and a few it might).
local TEMPLATES = {
  { "Frame", "BasicFrameTemplateWithInset" }, { "Frame", "BasicFrameTemplate" }, { "Frame", "UIPanelDialogTemplate" },
  { "Button", "UIPanelButtonTemplate" }, { "Button", "UIPanelButtonGrayTemplate" }, { "Button", "UIPanelCloseButton" },
  { "CheckButton", "UICheckButtonTemplate" }, { "EditBox", "InputBoxTemplate" }, { "ScrollFrame", "UIPanelScrollFrameTemplate" },
  { "Frame", "BackdropTemplate" }, { "Frame", "ScrollingEditBoxTemplate" },
}

local FONT_OBJECTS = {
  "GameFontNormal", "GameFontNormalSmall", "GameFontNormalLarge", "GameFontHighlight", "GameFontHighlightSmall",
  "ChatFontNormal", "NumberFontNormal", "GameTooltipText",
}

-- Method names the addon calls or may want, checked by name when the game does not let us list a widget's methods.
local CURATED = {
  "SetFontObject", "GetNumLetters", "HighlightText", "SetCursorPosition", "SetMaxLines", "SetTextInsets", "SetMultiLine",
  "SetMaxLetters", "SetAutoFocus", "SetFocus", "ClearFocus", "HasFocus", "SetScrollChild", "GetVerticalScrollRange",
  "SetVerticalScroll", "SetColorTexture", "SetBackdrop", "SetBackdropColor", "SetBackdropBorderColor", "SetClampedToScreen",
  "SetMovable", "StartMoving", "StopMovingOrSizing", "RegisterForDrag", "EnableMouseWheel", "SetShown", "SetEnabled", "Enable",
  "Disable", "IsEnabled", "HookScript", "GetStringWidth", "GetStringHeight", "GetUnboundedStringWidth", "GetFontString",
  "SetNormalFontObject", "SetMinMaxValues", "SetResizable", "SetResizeBounds", "SetUserPlaced", "GetMaxLetters",
}

-- Strings whose width is measured in every font (a few of the texts the windows show, and the usual extremes).
local SAMPLES = {
  "M", "i", "W", "0", "H", "Mg", "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz", "0123456789", "iiiiiiiiiiiiiiiiiiii",
  "mmmmmmmmmmmmmmmmmmmm", "Mark received", "Finish session", "Disenchant", "Blade of the Fixture", "Jorren Ashvale",
  "The quick brown fox jumps over the lazy dog", "IM1:night:j:1687:{\"schema\":1,\"id\":\"n-7fq2kd91xw\",\"at\":1796862600",
}

local function pack(...) return { n = select("#", ...), ... } end

-- object:name(...) as a list of its results, or nil and the reason when the object lacks the method or it raises.
local function call(object, name, ...)
  local packed = pack(pcall(function(...)
    local method = object[name]
    if type(method) ~= "function" then error("no method " .. name, 0) end
    return method(object, ...)
  end, ...))
  if not packed[1] then return nil, tostring(packed[2]) end
  return { n = packed.n - 1, unpack(packed, 2, packed.n) }
end

-- A value fit for the saved variables: numbers to two decimals, short strings, booleans; nothing else.
local function plain(value)
  local kind = type(value)
  if kind == "number" then
    if value ~= value or value == math.huge or value == -math.huge then return nil end
    return math.floor(value * 100 + 0.5) / 100
  end
  if kind == "string" then return string.sub(value, 1, 80) end
  if kind == "boolean" then return value end
  return nil
end

local function first(object, name, ...)
  local results = call(object, name, ...)
  return results and plain(results[1])
end

-- A global function of the game as a list of its results (nil when the game lacks it or it raises).
local function global(name, ...)
  local packed = pack(pcall(function(...)
    local fn = _G[name]
    if type(fn) ~= "function" then error("no function " .. name, 0) end
    return fn(...)
  end, ...))
  if not packed[1] then return nil, tostring(packed[2]) end
  return { n = packed.n - 1, unpack(packed, 2, packed.n) }
end

-- C_Item.GetItemInfo(...) and the like: a list of the results (nil when the game lacks it or it raises).
local function inNamespace(space, name, ...)
  local packed = pack(pcall(function(...)
    local holder = _G[space]
    local fn = type(holder) == "table" and holder[name]
    if type(fn) ~= "function" then error("no function " .. space .. "." .. name, 0) end
    return fn(...)
  end, ...))
  if not packed[1] then return nil, tostring(packed[2]) end
  return { n = packed.n - 1, unpack(packed, 2, packed.n) }
end

local function has(object, name)
  local ok, value = pcall(function() return object[name] end)
  return ok and type(value) == "function"
end

-- The anchors of a widget as { point, relative to, relative point, x, y }.
local function anchors(widget, parent)
  local list = {}
  local count = first(widget, "GetNumPoints") or 0
  for index = 1, math.min(count, 4) do
    local point = call(widget, "GetPoint", index)
    if point then
      local target, relative = point[2], "parent"
      if target ~= nil and target ~= parent then
        if target == UIParent then
          relative = "UIParent"
        else
          relative = first(target, "GetName") or ("a " .. tostring(first(target, "GetObjectType")))
        end
      end
      list[#list + 1] = { plain(point[1]) or "?", relative, plain(point[3]) or "?", plain(point[4]) or 0, plain(point[5]) or 0 }
    end
  end
  return list
end

-- What a widget says about itself, and (to `depth` levels) about its children and regions.
local function describe(widget, depth, parent)
  local info = {
    type = first(widget, "GetObjectType"), name = first(widget, "GetName"), shown = first(widget, "IsShown"),
    anchors = anchors(widget, parent),
  }
  local size = call(widget, "GetSize")
  if size then info.width, info.height = plain(size[1]), plain(size[2]) end
  info.text, info.texture, info.atlas, info.layer = first(widget, "GetText"), first(widget, "GetTexture"), first(widget, "GetAtlas"),
    first(widget, "GetDrawLayer")
  local font = call(widget, "GetFont")
  if font and font[1] then info.font = { plain(font[1]) or "?", plain(font[2]) or 0, plain(font[3]) or "" } end
  for key, getter in pairs({ textColor = "GetTextColor", vertexColor = "GetVertexColor" }) do
    local color = call(widget, getter)
    if color and type(color[1]) == "number" then
      info[key] = { plain(color[1]), plain(color[2]) or 0, plain(color[3]) or 0, plain(color[4]) or 1 }
    end
  end
  if depth > 0 then
    local children, regions = {}, {}
    local list = call(widget, "GetChildren")
    for index = 1, math.min(list and list.n or 0, MAX_CHILDREN) do children[index] = describe(list[index], depth - 1, widget) end
    list = call(widget, "GetRegions")
    for index = 1, math.min(list and list.n or 0, MAX_CHILDREN) do regions[index] = describe(list[index], depth - 1, widget) end
    info.children, info.regions = children, regions
  end
  return info
end

-- The named parts a template gave a frame (frame.TitleText, frame.Inset ...), described one level deep.
local function parts(frame)
  local found = {}
  local count = 0
  for key, value in pairs(frame) do
    if type(key) == "string" and type(value) == "table" and count < MAX_CHILDREN then
      local kind = first(value, "GetObjectType")
      if kind then
        found[key] = describe(value, 0, frame)
        count = count + 1
      end
    end
  end
  return found
end

-- All the method names of a widget's type, when the game lets us look at its metatable.
local function methodNames(object)
  local ok, meta = pcall(getmetatable, object)
  if not ok or type(meta) ~= "table" or type(meta.__index) ~= "table" then return nil end
  local names = {}
  for name, value in pairs(meta.__index) do
    if type(name) == "string" and type(value) == "function" then names[#names + 1] = name end
  end
  table.sort(names)
  return names
end

-- The helpers, for the tests.
Facts.helpers = { call = call, plain = plain, first = first, describe = describe, anchors = anchors, parts = parts, methodNames = methodNames,
  inNamespace = inNamespace }

-------------------------------------------------------------------------------------------------------------------
-- The sections
-------------------------------------------------------------------------------------------------------------------

local function clientFacts()
  local info = {}
  local build = global("GetBuildInfo")
  if build then info.client = { plain(build[1]), plain(build[2]), plain(build[3]), plain(build[4]) } end
  local function value(name) local results = global(name) return results and plain(results[1]) end
  info.locale, info.serverTime, info.time = value("GetLocale"), value("GetServerTime"), value("GetTime")
  info.uiParent = { width = first(UIParent, "GetWidth"), height = first(UIParent, "GetHeight"), scale = first(UIParent, "GetScale"),
    effectiveScale = first(UIParent, "GetEffectiveScale") }
  local physical = global("GetPhysicalScreenSize")
  if physical then info.physicalScreen = { plain(physical[1]), plain(physical[2]) } end
  return info
end

local function methodFacts(parent)
  local makers = {
    { "Frame", function() return CreateFrame("Frame", nil, parent) end },
    { "Button", function() return CreateFrame("Button", nil, parent) end },
    { "CheckButton", function() return CreateFrame("CheckButton", nil, parent) end },
    { "EditBox", function() return CreateFrame("EditBox", nil, parent) end },
    { "ScrollFrame", function() return CreateFrame("ScrollFrame", nil, parent) end },
    { "Slider", function() return CreateFrame("Slider", nil, parent) end },
    { "StatusBar", function() return CreateFrame("StatusBar", nil, parent) end },
    { "FontString", function() return parent:CreateFontString() end },
    { "Texture", function() return parent:CreateTexture() end },
    { "Frame+BackdropTemplate", function() return CreateFrame("Frame", nil, parent, "BackdropTemplate") end },
    { "GameTooltip", function() return CreateFrame("GameTooltip", nil, parent, "GameTooltipTemplate") end },
  }
  local out = {}
  for _, maker in ipairs(makers) do
    local ok, object = pcall(maker[2])
    if not ok then
      out[maker[1]] = { error = tostring(object) }
    else
      call(object, "SetAutoFocus", false) -- an edit box takes the keyboard when it is shown; this one must not
      local names = methodNames(object)
      local present, missing = {}, {}
      for _, name in ipairs(CURATED) do
        if has(object, name) then present[#present + 1] = name else missing[#missing + 1] = name end
      end
      out[maker[1]] = {
        listed = names ~= nil, count = names and #names or nil, names = names and table.concat(names, " ") or nil,
        curatedPresent = table.concat(present, " "), curatedMissing = table.concat(missing, " "),
      }
      call(object, "Hide")
    end
  end
  return out
end

-- The width of every printable ASCII character in a font, and the widths and heights of the sample strings.
local function fontFacts(parent)
  local out = {}
  for _, name in ipairs(FONT_OBJECTS) do
    local entry = {}
    out[name] = entry
    local font = _G[name]
    if font == nil then
      entry.missing = true
    else
      local face = call(font, "GetFont")
      if face then entry.path, entry.size, entry.flags = plain(face[1]), plain(face[2]), plain(face[3]) end
      local color = call(font, "GetTextColor")
      if color and type(color[1]) == "number" then entry.color = { plain(color[1]), plain(color[2]) or 0, plain(color[3]) or 0, plain(color[4]) or 1 } end
      local made, fs = pcall(parent.CreateFontString, parent, nil, "OVERLAY", name)
      if not made then
        entry.error = tostring(fs)
      else
        local function width(text)
          call(fs, "SetText", text)
          return first(fs, "GetStringWidth")
        end
        call(fs, "SetText", "Mg")
        entry.lineHeight = first(fs, "GetStringHeight")
        local chars = {}
        local pair, twin = width("i i"), width("ii")
        chars[1] = pair and twin and plain(pair - twin) or 0 -- a space (measured between two letters: a lone one may count 0)
        for byte = 33, 126 do chars[byte - 31] = width(string.char(byte)) or 0 end
        entry.chars = chars -- 95 widths, for the characters from 32 (space) to 126
        -- A character's own advance: the width it takes in a line of the same character. A lone one is rounded up by the game.
        local advances = {}
        for byte = 33, 126 do
          local char = string.char(byte)
          local total = width(char == "|" and string.rep("||", 16) or string.rep(char, 16)) -- a pipe is an escape: two make one
          advances[byte - 31] = total and math.floor(total / 16 * 1000 + 0.5) / 1000 or 0
        end
        local spaced = width("i" .. string.rep(" ", 16) .. "i")
        advances[1] = pair and spaced and math.floor((spaced - (twin or 0)) / 16 * 1000 + 0.5) / 1000 or 0
        entry.advances = advances -- 95 numbers, in the order of chars
        local samples = {}
        for _, text in ipairs(SAMPLES) do
          call(fs, "SetText", text)
          samples[#samples + 1] = { string.sub(text, 1, 30), first(fs, "GetStringWidth") or 0, first(fs, "GetStringHeight") or 0 }
        end
        entry.samples = samples
        call(fs, "SetWidth", 120)
        call(fs, "SetText", "alpha beta gamma delta epsilon zeta eta theta iota")
        entry.wrapped = { 120, first(fs, "GetStringHeight") or 0 }
        call(fs, "Hide")
      end
    end
  end
  return out
end

-- The stock templates: created and anchored (the game lays frames out once they are shown), measured after a short wait.
-- `later(seconds, fn)` runs fn after that long and counts as work the run waits for.
local function templateFacts(parent, later)
  local out, made = {}, {}
  for _, pair in ipairs(TEMPLATES) do
    local label = pair[1] .. " + " .. pair[2]
    local ok, frame = pcall(CreateFrame, pair[1], nil, parent, pair[2])
    if not ok then
      out[label] = { error = tostring(frame) }
    else
      if pair[1] == "EditBox" then call(frame, "SetAutoFocus", false) end -- a new edit box would take the keyboard
      local entry = { defaultWidth = first(frame, "GetWidth"), defaultHeight = first(frame, "GetHeight") }
      out[label] = entry
      made[#made + 1] = { frame = frame, entry = entry }
      if (entry.defaultWidth or 0) == 0 then call(frame, "SetWidth", 300) end
      if (entry.defaultHeight or 0) == 0 then call(frame, "SetHeight", 200) end
      call(frame, "SetPoint", "CENTER", parent, "CENTER", 0, 0)
      call(frame, "SetAlpha", 0)
    end
  end
  later(0.2, function()
    for _, item in ipairs(made) do
      local ok, err = pcall(function()
        local info = describe(item.frame, 2, parent)
        for key, value in pairs(info) do item.entry[key] = value end
        item.entry.parts = parts(item.frame)
      end)
      if not ok then item.entry.error = tostring(err) end
      call(item.frame, "Hide")
    end
  end)
  return out
end

-- A multi-line edit box in a scroll frame, as the import window builds it, given texts of growing length.
local function editFacts(parent, later)
  local out = { steps = {} }
  local region = CreateFrame("Frame", nil, parent)
  region:SetSize(400, 120)
  region:SetPoint("TOPLEFT", parent, "TOPLEFT", 20, -20)
  region:SetAlpha(0)
  local templated, scroll = pcall(CreateFrame, "ScrollFrame", nil, region, "UIPanelScrollFrameTemplate")
  if not templated or not scroll then
    out.scrollTemplate = tostring(scroll)
    scroll = CreateFrame("ScrollFrame", nil, region)
  end
  scroll:SetSize(374, 120)
  scroll:SetPoint("TOPLEFT", 0, 0)
  local edit = CreateFrame("EditBox", nil, scroll)
  edit:SetAutoFocus(false)
  edit:SetMultiLine(true)
  edit:SetMaxLetters(0)
  local path, size, flags = _G.GameFontHighlightSmall:GetFont() -- the way the import window gives its box a font
  edit:SetFont(path, size, flags)
  edit:SetSize(374, 120)
  scroll:SetScrollChild(edit)
  local events = {}
  local function kind(userInput) return userInput == true and "user" or (userInput == false and "set" or "none") end
  edit:SetScript("OnTextChanged", function(_, userInput) events[#events + 1] = kind(userInput) end)

  -- a box nobody called SetMaxLetters on: does it cut a long text?
  local plainBox = CreateFrame("EditBox", nil, region)
  plainBox:SetAutoFocus(false)
  plainBox:SetSize(100, 20)
  plainBox:SetPoint("BOTTOMLEFT", 0, 0)
  local setFontObject, problem = pcall(function() plainBox:SetFontObject(_G.GameFontHighlightSmall) end)
  out.setFontObject = setFontObject or tostring(problem) -- true when the method works on an edit box
  if not setFontObject then plainBox:SetFont(path, size, flags) end
  plainBox:SetText(string.rep("y", 1000))
  out.defaultLimit = { kept = #plainBox:GetText(), maxLetters = first(plainBox, "GetMaxLetters") }

  -- a single-line stock box: does SetText run OnTextChanged?
  local okStock, stock = pcall(CreateFrame, "EditBox", nil, region, "InputBoxTemplate")
  if okStock then
    local stockEvents = {}
    stock:SetAutoFocus(false)
    stock:SetSize(100, 20)
    stock:SetPoint("BOTTOMRIGHT", 0, 0)
    stock:SetScript("OnTextChanged", function(_, userInput) stockEvents[#stockEvents + 1] = kind(userInput) end)
    stock:SetText("abc")
    out.stockBoxSetText = stockEvents
  end

  local sizes = { 0, 100, 1000, 5000, 20000 }
  local function step(index)
    local count = sizes[index]
    if not count then
      region:Hide()
      return
    end
    events = {}
    edit:SetText(string.rep("x", count)) -- no spaces, like a night string
    later(0.15, function()
      local text = call(edit, "GetText")
      out.steps[index] = {
        chars = count, kept = text and #tostring(text[1]) or -1, height = first(edit, "GetHeight"), width = first(edit, "GetWidth"),
        scrollRange = first(scroll, "GetVerticalScrollRange"), numLetters = first(edit, "GetNumLetters"), events = events,
      }
      step(index + 1)
    end)
  end
  step(1)
  return out
end

-- The text of every shown label under `frame`, as it is and as wide as its box.
local function labelFacts(frame)
  local found = {}
  local function visit(widget, depth)
    if #found >= MAX_LABELS or depth > 14 then return end
    local regions = call(widget, "GetRegions")
    for index = 1, regions and regions.n or 0 do
      local region = regions[index]
      if first(region, "GetObjectType") == "FontString" and first(region, "IsVisible") ~= false then
        local text = first(region, "GetText")
        if text and text ~= "" then
          local face = call(region, "GetFont")
          found[#found + 1] = {
            text = string.sub(text, 1, 40), box = first(region, "GetWidth"), boxHeight = first(region, "GetHeight"),
            width = first(region, "GetStringWidth"), height = first(region, "GetStringHeight"), size = face and plain(face[2]),
            wrap = first(region, "CanWordWrap"), unbounded = first(region, "GetUnboundedStringWidth"),
            lines = first(region, "GetNumLines"), owner = first(widget, "GetObjectType"), ownerWidth = first(widget, "GetWidth"),
            ownerHeight = first(widget, "GetHeight"),
          }
        end
      end
    end
    local children = call(widget, "GetChildren")
    for index = 1, children and children.n or 0 do visit(children[index], depth + 1) end
  end
  visit(frame, 0)
  return found
end

-- Where every shown frame under `frame` is on the screen, as { depth, type, left, top, width, height }: to set against the
-- layout the pictures work out from the anchors.
local MAX_RECTS = 220
local function rectFacts(frame)
  local found = {}
  local function visit(widget, depth)
    if #found >= MAX_RECTS or depth > 8 then return end
    if first(widget, "IsVisible") ~= false then
      found[#found + 1] = { depth, first(widget, "GetObjectType") or "?", first(widget, "GetLeft") or 0, first(widget, "GetTop") or 0,
        first(widget, "GetWidth") or 0, first(widget, "GetHeight") or 0 }
      local children = call(widget, "GetChildren")
      for index = 1, children and children.n or 0 do visit(children[index], depth + 1) end
    end
  end
  visit(frame, 0)
  return found
end

local function windowFacts(windows)
  local out = {}
  for name, frame in pairs(windows) do
    local ok, info = pcall(function()
      return {
        width = first(frame, "GetWidth"), height = first(frame, "GetHeight"), left = first(frame, "GetLeft"), top = first(frame, "GetTop"),
        scale = first(frame, "GetEffectiveScale"), shown = first(frame, "IsShown"), strata = first(frame, "GetFrameStrata"),
        labels = labelFacts(frame), rects = rectFacts(frame),
      }
    end)
    out[name] = ok and info or { error = tostring(info) }
  end
  return out
end

-------------------------------------------------------------------------------------------------------------------
-- What a council window needs: items, tooltips, class icons, gear
-------------------------------------------------------------------------------------------------------------------

-- A few items the game is sure to have (the hearthstone, two famous weapons, a badge of justice, a worn sword).
local ITEM_IDS = { 6948, 19019, 32837, 29434, 25 }
local CLASSES = { "WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST", "SHAMAN", "MAGE", "WARLOCK", "DRUID", "DEATHKNIGHT" }

local function itemString(link)
  return type(link) == "string" and string.match(link, "item:[%-%d:]+") or nil
end

Facts.helpers.itemString = itemString

-- Items by id: what the game answers at once, and what the item mixin says once the item has loaded.
local function itemFacts(later)
  local out = {}
  for _, id in ipairs(ITEM_IDS) do
    local entry = {}
    out[tostring(id)] = entry
    local instant = inNamespace("C_Item", "GetItemInfoInstant", id)
    if instant then
      entry.instant = { id = plain(instant[1]), type = plain(instant[2]), subType = plain(instant[3]), equipLoc = plain(instant[4]),
        icon = plain(instant[5]), classId = plain(instant[6]) }
    end
    local info = inNamespace("C_Item", "GetItemInfo", id)
    if info then
      entry.info = { name = plain(info[1]), link = itemString(info[2]), quality = plain(info[3]), ilvl = plain(info[4]),
        type = plain(info[5]), subType = plain(info[6]), equipLoc = plain(info[9]), icon = plain(info[10]) }
    end
    local function one(name) local r = inNamespace("C_Item", name, id) return r and plain(r[1]) end
    entry.iconById, entry.nameById, entry.qualityById = one("GetItemIconByID"), one("GetItemNameByID"), one("GetItemQualityByID")
    local made = pcall(function()
      local item = _G.Item:CreateFromItemID(id)
      entry.mixin = "created"
      item:ContinueOnItemLoad(function()
        entry.loaded = {
          name = first(item, "GetItemName"), quality = first(item, "GetItemQuality"), icon = first(item, "GetItemIcon"),
          ilvl = first(item, "GetCurrentItemLevel"), link = itemString(call(item, "GetItemLink") and call(item, "GetItemLink")[1]),
        }
      end)
    end)
    if not made then entry.mixin = "failed" end
  end
  later(3, function()
    for _, entry in pairs(out) do
      if entry.mixin == "created" and not entry.loaded then entry.loaded = "not loaded after 3 seconds" end
    end
  end)
  return out
end

-- A tooltip from an item link and from an equipped item, read a moment later (it needs a frame to lay out).
local function tooltipFacts(later)
  local tip = _G.GameTooltip
  if tip == nil then return { missing = true } end
  local out = {}
  local function show(label, fn)
    local ok, err = pcall(function()
      tip:SetOwner(UIParent, "ANCHOR_NONE")
      fn()
    end)
    if not ok then out[label] = { error = tostring(err) } return end
    later(0.3, function()
      local first_ = _G.GameTooltipTextLeft1
      out[label] = {
        lines = first(tip, "NumLines"), title = first_ and first(first_, "GetText"), shown = first(tip, "IsShown"),
        width = first(tip, "GetWidth"), height = first(tip, "GetHeight"),
      }
      call(tip, "Hide")
    end)
  end
  show("hyperlink", function() tip:SetHyperlink("item:19019") end)
  later(0.5, function()
    show("equipped", function() tip:SetInventoryItem("player", 16) end)
  end)
  return out
end

-- The class icon sheet's coordinates and the class colors, as the game's globals say them.
local function classIconFacts()
  local out = { tcoords = {}, colors = {} }
  local sheet, colors = _G.CLASS_ICON_TCOORDS, _G.RAID_CLASS_COLORS
  out.hasCoords, out.hasColors = type(sheet) == "table", type(colors) == "table"
  for _, class in ipairs(CLASSES) do
    local c = type(sheet) == "table" and sheet[class]
    out.tcoords[class] = type(c) == "table" and { plain(c[1]) or 0, plain(c[2]) or 0, plain(c[3]) or 0, plain(c[4]) or 0 } or false
    local color = type(colors) == "table" and colors[class]
    out.colors[class] = type(color) == "table" and { plain(color.r) or 0, plain(color.g) or 0, plain(color.b) or 0, plain(color.colorStr) } or false
  end
  return out
end

-- What the player wears: how many slots have an item, the item ids (no names), and what the game says about the first few.
local function gearFacts()
  local out = { slots = {}, count = 0 }
  for slot = 1, 19 do
    local link = global("GetInventoryItemLink", "player", slot)
    local id = link and type(link[1]) == "string" and tonumber(string.match(link[1], "item:(%d+)"))
    if id then
      out.count = out.count + 1
      local entry = { id = id }
      local level = inNamespace("C_Item", "GetDetailedItemLevelInfo", link[1])
      entry.ilvl = level and plain(level[1])
      local texture = global("GetInventoryItemTexture", "player", slot)
      entry.texture = texture and plain(texture[1])
      out.slots[tostring(slot)] = entry
    end
  end
  return out
end

-------------------------------------------------------------------------------------------------------------------
-- Run
-------------------------------------------------------------------------------------------------------------------

function Facts.run(options)
  options = options or {}
  local parent = options.parent or UIParent
  local result = { schema = 1, notes = {} }
  local pending, finished = 1, false -- the one that is held until every section has been started
  local function note(text) result.notes[#result.notes + 1] = text end
  local function complete()
    pending = pending - 1
    if pending == 0 and not finished then
      finished = true
      result.done = true
      if options.done then options.done(result) end
    end
  end
  -- Work that waits for the game: counted until it has run. Work started from inside counts before this one is done.
  local function later(seconds, fn)
    pending = pending + 1
    local ok, err = pcall(function()
      C_Timer.After(seconds, function()
        local ran, problem = pcall(fn)
        if not ran then note("later: " .. tostring(problem)) end
        complete()
      end)
    end)
    if not ok then
      note("C_Timer.After: " .. tostring(err))
      complete()
    end
  end
  -- a section that fails is a note, not an end to the run
  local function section(name, fn)
    local ok, value = pcall(fn)
    if ok then
      result[name] = value
    else
      result[name] = { error = tostring(value) }
      note(name .. ": " .. tostring(value))
    end
  end

  section("client", clientFacts)
  section("methods", function() return methodFacts(parent) end)
  section("fonts", function() return fontFacts(parent) end)
  section("templates", function() return templateFacts(parent, later) end)
  section("edit", function() return editFacts(parent, later) end)
  section("items", function() return itemFacts(later) end)
  section("tooltips", function() return tooltipFacts(later) end)
  section("classIcons", classIconFacts)
  section("gear", gearFacts)
  if options.windows then
    later(0.3, function() section("windows", function() return windowFacts(options.windows) end) end)
  end
  local started = global("GetTime")
  later(0.3, function()
    local now = global("GetTime")
    result.timer = { asked = 0.3, got = started and now and plain(now[1] - started[1]) or nil }
  end)
  complete()
  return result
end

-- Lines for the chat: what was measured, and what failed.
function Facts.summary(result)
  local function count(list)
    local n = 0
    for _ in pairs(list or {}) do n = n + 1 end
    return n
  end
  local client = result.client or {}
  local screen = client.uiParent or {}
  local lines = {
    "Facts: build " .. tostring(client.client and client.client[2]) .. ", the screen is " .. tostring(screen.width) .. " by "
      .. tostring(screen.height) .. " at scale " .. tostring(screen.effectiveScale) .. ".",
  }
  local listed, refused = 0, 0
  for _, entry in pairs(result.methods or {}) do
    if entry.listed then listed = listed + 1 end
    if entry.error then refused = refused + 1 end
  end
  local templates, templateErrors = 0, 0
  for _, entry in pairs(result.templates or {}) do
    templates = templates + 1
    if entry.error then templateErrors = templateErrors + 1 end
  end
  local labels = 0
  for _, window in pairs(result.windows or {}) do labels = labels + #(window.labels or {}) end
  lines[#lines + 1] = "Widget types: " .. count(result.methods) .. " (" .. listed .. " with their methods listed, " .. refused .. " refused). "
    .. "Templates: " .. templates .. " tried, " .. templateErrors .. " refused. Fonts: " .. count(result.fonts) .. "."
  lines[#lines + 1] = "Edit box steps: " .. count(result.edit and result.edit.steps) .. ". Labels measured in the windows: " .. labels .. "."
  local itemsLoaded, itemsTried = 0, 0
  for _, entry in pairs(result.items or {}) do
    itemsTried = itemsTried + 1
    if type(entry.loaded) == "table" then itemsLoaded = itemsLoaded + 1 end
  end
  local tips = 0
  for _, tip in pairs(result.tooltips or {}) do
    if type(tip) == "table" and (tip.lines or 0) > 0 then tips = tips + 1 end
  end
  lines[#lines + 1] = "Items: " .. itemsLoaded .. " of " .. itemsTried .. " loaded. Tooltips with text: " .. tips .. ". Class icon coordinates: "
    .. tostring(result.classIcons and result.classIcons.hasCoords) .. ". Worn items: " .. tostring(result.gear and result.gear.count) .. "."
  for _, text in ipairs(result.notes or {}) do lines[#lines + 1] = "Failed: " .. text end
  return lines
end
