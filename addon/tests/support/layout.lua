-- Where every widget of the strict stand-ins would be on the screen, worked out from anchors, sizes and scale the way
-- the game does it, and what its text looks like once wrapped.
--
--   local Layout = dofile("tests/support/layout.lua")
--   local layout = Layout.new(game)       -- one per picture: it caches what it works out
--   layout.rect(widget)                   -- { left, bottom, width, height, right, top } in screen pixels with y up, or nil
--                                         -- when nothing places the widget (the game would not show it either)
--   layout.visible(widget)                -- shown, every parent shown, and placed
--   layout.alpha(widget)                  -- its own alpha times its parents'
--   layout.text(widget)                   -- { lines, size, color, lineHeight, width, height, scale } for text widgets;
--                                         -- sizes are in the widget's own units, drawn `scale` times as large
--   layout.warnings                       -- what a player would notice: no anchor, anchors that cross
--
-- The rules, as in the game: an anchor ties one of the widget's nine points to one of the nine points of another
-- region (its parent by default) with an offset; two anchors on opposite sides fix the size on that axis, otherwise
-- the size comes from SetSize or SetWidth/SetHeight; a font string without a size takes its text's size (wrapped at
-- the width the anchors or SetWidth give it); a frame's scale multiplies its size and its offsets and its children's;
-- SetAllPoints fills the other region; a scroll child sits at the scroll frame's top left, moved by the scroll.

local Metrics = dofile("tests/support/metrics.lua")

local Layout = {}

-- Left, right, top and bottom space between an edit box's edge and its text when SetTextInsets was not called (a guess).
Layout.EDIT_INSETS = { 6, 6, 0, 0 }

-- The nine anchor points as fractions of a region: { across (0 left to 1 right), up (0 bottom to 1 top) }.
local FRACTION = {
  TOPLEFT = { 0, 1 }, TOP = { 0.5, 1 }, TOPRIGHT = { 1, 1 },
  LEFT = { 0, 0.5 }, CENTER = { 0.5, 0.5 }, RIGHT = { 1, 0.5 },
  BOTTOMLEFT = { 0, 0 }, BOTTOM = { 0.5, 0 }, BOTTOMRIGHT = { 1, 0 },
}

local function build(left, bottom, width, height)
  return { left = left, bottom = bottom, width = width, height = height, right = left + width, top = bottom + height }
end

-- The size of a region on one axis, when two of its anchors with different fractions fix it, and the first anchor.
local function span(constraints)
  local low, high = constraints[1], constraints[1]
  for _, constraint in ipairs(constraints) do
    if constraint[1] < low[1] then low = constraint end
    if constraint[1] > high[1] then high = constraint end
  end
  if high[1] - low[1] > 1e-9 then return (high[2] - low[2]) / (high[1] - low[1]), low end
  return nil, low
end

-- Start and size on one axis. `explicit` is the size from SetSize, `intrinsic` the size of the content.
local function solve(constraints, explicit, intrinsic)
  local size, low = span(constraints)
  size = size or explicit or intrinsic or 0
  return low[2] - low[1] * size, size
end

function Layout.new(game)
  local layout = { warnings = {} }
  local state = game.state
  local rects, texts, resolving = {}, {}, {}
  local NONE = {}

  -- "Frame 'Name'", "Frame #7" (its place in the order frames were created) or "FontString of Frame #7".
  local describe
  describe = function(widget)
    local mine = state(widget)
    if mine.isRegion then return mine.kind .. " of " .. describe(mine.parent) end
    if mine.name then return mine.kind .. " '" .. mine.name .. "'" end
    for index, frame in ipairs(game.frames) do
      if frame == widget then return mine.kind .. " #" .. index end
    end
    return mine.kind
  end
  layout.describe = describe

  local function warn(message)
    layout.warnings[#layout.warnings + 1] = message
  end

  local function scaleOf(widget)
    local mine = state(widget)
    if mine.isRegion then return scaleOf(mine.parent) end
    local scale = mine.scale or 1
    if mine.parent then scale = scale * scaleOf(mine.parent) end
    return scale
  end

  function layout.alpha(widget)
    local mine = state(widget)
    local alpha = mine.alpha or 1
    if mine.parent then alpha = alpha * layout.alpha(mine.parent) end
    return alpha
  end

  -- Size, color and flags of a text widget: SetFont wins over the font object it was made with.
  local function fontOf(widget)
    local mine = state(widget)
    local fallback = mine.kind == "Button" and "GameFontNormal" or nil
    local name = mine.fontObject or fallback
    local object = Metrics.FONT_OBJECTS[name] or Metrics.DEFAULT_FONT
    local color = object.color
    if mine.textColor then color = { mine.textColor[1], mine.textColor[2], mine.textColor[3], mine.textColor[4] or 1 } end
    if mine.fontPath then name = Metrics.font_for_path(mine.fontPath, mine.size) end -- the face of that file, at the size given
    return mine.fontPath and mine.size or object.size, color, mine.fontFlags, name
  end

  local function textFor(widget, wrapWidth, breakLong)
    local mine = state(widget)
    local size, color, flags, fontName = fontOf(widget)
    local lines = Metrics.layout(mine.text or "", size, wrapWidth, mine.wordWrap ~= false, breakLong, fontName)
    if mine.maxLines and mine.maxLines > 0 then
      while #lines > mine.maxLines do table.remove(lines) end
    end
    local widest = 0
    for _, line in ipairs(lines) do
      if line.width > widest then widest = line.width end
    end
    local lineHeight = Metrics.line_height(size, fontName)
    return {
      lines = lines, size = size, color = color, flags = flags, lineHeight = lineHeight, width = widest,
      height = #lines * lineHeight,
    }
  end

  local rectOf

  local function compute(widget)
    local mine = state(widget)
    if not mine.parent then return build(0, 0, mine.width, mine.height) end
    local scale = scaleOf(widget)
    local above = state(mine.parent)

    if above.scrollChild == widget then
      local frame = rectOf(mine.parent)
      if not frame then return nil end
      local width = mine.width > 0 and mine.width * scale or frame.width
      local height = mine.height > 0 and mine.height * scale or frame.height
      return build(frame.left, frame.top + (above.vscroll or 0) * scale - height, width, height)
    end

    if mine.allPoints then
      local other = rectOf(mine.allPoints)
      if not other then return nil end
      return build(other.left, other.bottom, other.width, other.height)
    end

    if #mine.points == 0 then
      warn(describe(widget) .. " has no anchor, so the game would not show it")
      return nil
    end
    local across, up = {}, {}
    for _, point in ipairs(mine.points) do
      local target = rectOf(point.relativeTo or mine.parent)
      if not target then return nil end
      local own, theirs = FRACTION[point.point], FRACTION[point.relativePoint]
      across[#across + 1] = { own[1], target.left + theirs[1] * target.width + point.x * scale }
      up[#up + 1] = { own[2], target.bottom + theirs[2] * target.height + point.y * scale }
    end

    local explicitWidth = mine.width > 0 and mine.width * scale or nil
    local explicitHeight = mine.height > 0 and mine.height * scale or nil
    local text
    if mine.kind == "FontString" then
      -- the text is laid out in the widget's own units, and drawn `scale` times as large
      local available = span(across) or explicitWidth
      text = textFor(widget, available and available / scale or nil)
      text.scale = scale
      texts[widget] = text
    end
    local left, width = solve(across, explicitWidth, text and text.width * scale)
    local bottom, height = solve(up, explicitHeight, text and text.height * scale)
    if width < 0 or height < 0 then
      warn(describe(widget) .. " has anchors that cross, so its size would be negative")
      width, height = math.max(width, 0), math.max(height, 0)
    end
    return build(left, bottom, width, height)
  end

  rectOf = function(widget)
    local cached = rects[widget]
    if cached ~= nil then return cached ~= NONE and cached or nil end
    if resolving[widget] then error("anchor loop through " .. describe(widget), 0) end
    resolving[widget] = true
    local rect = compute(widget)
    resolving[widget] = nil
    rects[widget] = rect or NONE
    return rect
  end
  layout.rect = rectOf

  function layout.visible(widget)
    return game.visible(widget) and rectOf(widget) ~= nil
  end

  -- The text of a font string (wrapped to its width), of a multi-line edit box (wrapped to its width less the insets, a
  -- word that is too long cut where it overflows), or of a button or single-line edit box (on one line unless it has new lines).
  function layout.text(widget)
    local rect = rectOf(widget)
    if not texts[widget] then
      local mine = state(widget)
      if mine.kind == "EditBox" and mine.multiLine and rect then
        local insets = mine.textInsets or Layout.EDIT_INSETS
        local scale = scaleOf(widget)
        texts[widget] = textFor(widget, math.max(rect.width - (insets[1] or 0) - (insets[2] or 0), 0) / scale, true)
      else
        texts[widget] = textFor(widget, nil)
      end
      texts[widget].scale = scaleOf(widget)
    end
    return texts[widget]
  end

  return layout
end

return Layout
