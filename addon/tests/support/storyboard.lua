-- A storyboard is a script that builds a window from the stand-in widgets, takes pictures as it changes the window,
-- and hands them to the runner (tests/storyboards.lua). Files in tests/storyboards/ return a function(story):
--
--   return function(story)
--     story.describe("Title of the section", "One line about what the pictures show.")
--     local game = story.game              -- stand-in widgets with the stock templates installed
--     ... build the window with game.env.CreateFrame, run its code, press its buttons with game.fire ...
--     story.snap("Caption of the picture")
--   end

local UI = dofile("tests/support/strict_ui.lua")
local StockTemplates = dofile("tests/support/stock_templates.lua")
local Pictures = dofile("tests/support/pictures.lua")

local Storyboard = {}

function Storyboard.new(id)
  local story = { id = id, game = StockTemplates.install(UI.new()), title = id, shots = {} }

  function story.describe(title, text)
    story.title, story.text = title, text
  end

  -- Start over with an empty screen (story.game is a new game; the pictures taken so far are kept).
  -- options.known is a changed copy of the known-good list, for a picture of what happens when the game lacks something.
  function story.reset(options)
    story.game = StockTemplates.install(UI.new(options))
    return story.game
  end

  -- Take a picture of the screen as it is now. options go to Pictures.render (crop, padding).
  function story.snap(caption, options)
    story.shots[#story.shots + 1] = { caption = caption, picture = Pictures.render(story.game, options) }
  end

  return story
end

return Storyboard
