-- The parts and default sizes of Blizzard's stock templates, as the window tests and the pictures work with them.
--
-- MEASURED in the Forever beta on 2026-10-21 (/im facts, build 70450, addon 0.0.4): which parts each template creates, their
-- sizes and where they are anchored, and each template's default size. What cannot be measured that way is how the art
-- looks; the pictures draw a look-alike in CSS, and game.assumptions says so for each template a window used. Code under
-- test should still not depend on a part without a fallback: the template's parts are named by the game's own XML, and a
-- build of the client may change them.
--
-- What the measurement found that was not as guessed before: BasicFrameTemplateWithInset has no `Inset` frame (its inset is
-- a texture, `InsetBg`, that the kit's own body covers), a close button is 28 by 28 and sticks 3 pixels above the frame,
-- a check button is 32 by 32 and has a `Text` label of its own, the gray and the input box templates have no default size
-- (the kit sets one), and the scroll bar of a scroll frame sits 6 pixels to the right of it.
--
--   local StockTemplates = dofile("tests/support/stock_templates.lua")
--   StockTemplates.install(game)       -- after UI.new(), before the window is built

local StockTemplates = {}

function StockTemplates.install(game)
  local create = game.env.CreateFrame
  game.assumptions = game.assumptions or {}

  local function sized(width, height)
    return function(frame) game.state(frame).width, game.state(frame).height = width, height end
  end

  -- A dialog frame: a title text on the top edge, a close button in the corner, a background, and (with inset) the
  -- texture of the panel under the title bar. The frame has no size of its own.
  local function dialog(withInset)
    return function(frame)
      local background = frame:CreateTexture(nil, "BACKGROUND")
      background:SetPoint("TOPLEFT", 2, -21)
      background:SetPoint("BOTTOMRIGHT", -2, 2)
      background:SetColorTexture(0.04, 0.04, 0.05, 1)
      frame.Bg = background
      local title = frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
      title:SetPoint("TOP", -6, -4)
      frame.TitleText = title
      local close = create("Button", nil, frame, "UIPanelCloseButton")
      close:SetSize(28, 28)
      close:SetPoint("TOPRIGHT", 0, 3)
      frame.CloseButton = close
      if withInset then
        local inset = frame:CreateTexture(nil, "BORDER")
        inset:SetPoint("TOPLEFT", 4, -24)
        inset:SetPoint("BOTTOMRIGHT", -6, 4)
        inset:SetColorTexture(0, 0, 0, 0.78)
        frame.InsetBg = inset
      end
    end
  end

  game.templates.BasicFrameTemplate = dialog(false)
  game.templates.BasicFrameTemplateWithInset = dialog(true)
  game.templates.UIPanelButtonTemplate = sized(40, 22)
  game.templates.UIPanelButtonGrayTemplate = function() end
  game.templates.UIPanelCloseButton = sized(24, 24)
  game.templates.UICheckButtonTemplate = function(frame)
    sized(32, 32)(frame)
    local label = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    label:SetPoint("LEFT", frame, "RIGHT", -2, 0)
    frame.Text = label
  end
  game.templates.InputBoxTemplate = function() end
  game.templates.UIPanelScrollFrameTemplate = function(frame)
    local bar = create("Slider", nil, frame)
    bar:SetWidth(16)
    bar:SetPoint("TOPLEFT", frame, "TOPRIGHT", 6, -16)
    bar:SetPoint("BOTTOMLEFT", frame, "BOTTOMRIGHT", 6, 16)
    game.state(bar).look = "scrollbar"
    frame.ScrollBar = bar
  end

  local art = "the layout of its parts was measured in the beta, the art is drawn as a look-alike"
  game.assumptions.BasicFrameTemplate = "BasicFrameTemplate: " .. art
  game.assumptions.BasicFrameTemplateWithInset = "BasicFrameTemplateWithInset: " .. art
  game.assumptions.UIPanelButtonTemplate = "UIPanelButtonTemplate: the size 40 by 22 was measured, the art is drawn as a look-alike"
  game.assumptions.UIPanelButtonGrayTemplate = "UIPanelButtonGrayTemplate: it has no default size (measured), the art is drawn as a look-alike"
  game.assumptions.UIPanelCloseButton = "UIPanelCloseButton: the size 24 by 24 was measured, the art is drawn as a look-alike"
  game.assumptions.UICheckButtonTemplate = "UICheckButtonTemplate: the size 32 by 32 was measured, the art is drawn as a look-alike"
  game.assumptions.InputBoxTemplate = "InputBoxTemplate: it has no default size (measured), the art is drawn as a look-alike"
  game.assumptions.UIPanelScrollFrameTemplate = "UIPanelScrollFrameTemplate: the scroll bar's place was measured, the art is drawn as a look-alike"
  return game
end

return StockTemplates
