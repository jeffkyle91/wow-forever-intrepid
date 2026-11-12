-- Does a window built from the strict stand-in widgets hold together? Every widget that is shown lies inside the window,
-- one-line text is not wider than its box, wrapped text stays inside the box it was written in, a button is wide enough
-- for its label (with 3 pixels to spare on each side), no two controls overlap,
-- the layout has nothing to warn about (no anchor, crossing anchors) and the mouse audit of the game is empty.
--
--   local Intact = dofile("tests/support/intact.lua")
--   local problems = Intact.problems(game, window.frame)     -- a list of texts; empty when all is well
--
-- Widgets inside a scroll frame are left out of the "inside the window" and "overlap" checks, as they scroll, and so is the
-- stock frame's close button, which sticks 3 pixels out of the top of the frame.

local Layout = dofile("tests/support/layout.lua")

local Intact = {}

function Intact.problems(game, frame)
  local layout = Layout.new(game)
  local state = game.state
  local box = layout.rect(frame)
  local problems = {}
  local function insideScroll(widget)
    local up = state(widget).parent
    while up and up ~= frame do
      if state(up).kind == "ScrollFrame" then return true end
      up = state(up).parent
    end
    return false
  end
  local controls = {}
  local function inWindow(widget)
    local up = widget
    while up do
      if up == frame then return true end
      up = state(up).parent
    end
    return false
  end
  local all = {}
  for _, widget in ipairs(game.frames) do
    all[#all + 1] = widget
    for _, region in ipairs(state(widget).regions) do all[#all + 1] = region end
  end
  for _, widget in ipairs(all) do
    if widget ~= game.env.UIParent and inWindow(widget) and layout.visible(widget) then
      local mine, rect = state(widget), layout.rect(widget)
      local what = layout.describe(widget) .. " " .. tostring(mine.text or "")
      if not insideScroll(widget) and widget ~= frame and widget ~= rawget(frame, "CloseButton") then -- (it sticks 3 pixels above the frame)
        if rect.left < box.left - 0.5 or rect.right > box.right + 0.5 or rect.bottom < box.bottom - 0.5 or rect.top > box.top + 0.5 then
          problems[#problems + 1] = what .. " lies outside the window"
        end
      end
      if mine.kind == "FontString" and mine.text and mine.text ~= "" and mine.wordWrap == false and mine.width > 0 then
        if layout.text(widget).width * (layout.text(widget).scale or 1) > rect.width + 0.5 then
          problems[#problems + 1] = what .. " is wider than its box"
        end
      end
      if mine.kind == "FontString" and mine.text and mine.text ~= "" and mine.wordWrap ~= false and not insideScroll(widget) then
        local holder = layout.rect(mine.parent)
        if holder and rect.bottom < holder.bottom - 0.5 then problems[#problems + 1] = what .. " runs out of the bottom of its box" end
      end
      if mine.kind == "Button" and mine.text and mine.text ~= "" and layout.text(widget).width * (layout.text(widget).scale or 1) + 6 > rect.width then
        problems[#problems + 1] = what .. " is a button too narrow for its label"
      end
      if (mine.kind == "Button" or mine.kind == "EditBox" or mine.kind == "CheckButton") and not insideScroll(widget) then
        controls[#controls + 1] = { widget = widget, rect = rect, what = what }
      end
    end
  end
  for i = 1, #controls do
    for j = i + 1, #controls do
      local a, b = controls[i].rect, controls[j].rect
      if a.left < b.right - 0.5 and b.left < a.right - 0.5 and a.bottom < b.top - 0.5 and b.bottom < a.top - 0.5 then
        problems[#problems + 1] = controls[i].what .. " overlaps " .. controls[j].what
      end
    end
  end
  for _, warning in ipairs(layout.warnings) do problems[#problems + 1] = warning end
  for _, problem in ipairs(game.audit()) do problems[#problems + 1] = problem end
  return problems
end

return Intact
