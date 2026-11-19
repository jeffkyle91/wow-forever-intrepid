-- The loot session window, in the states a loot master meets: a night with a long priority list, a name picked, the
-- confirmation, a give the game did not confirm, a give we did not start, picking out of a raid of 40, and the same
-- window roomy and with the flat frame. The window is the addon's real code (IntrepidManager/ui/); only the callbacks
-- are stand-ins. Invented names only.

local FILES = { "core/Names", "ui/Kit", "ui/Sample", "ui/Confirm", "ui/Picker", "ui/SessionWindow" }

return function(story)
  story.describe("Loot session window",
    "One line per player, as tall as the name text, so a raid of 40 fits and scrolls. Compact is the default; roomy and the "
    .. "flat frame (used when the game refuses the stock one) are shown at the end.")

  -- a window in a fresh game; returns the window, the Sample module and the game
  local function open(options, known)
    local game = story.reset(known)
    local ns = {}
    for _, file in ipairs(FILES) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
    local kit = ns.UI.Kit.new(options or {})
    local callbacks = {
      preview = function(_, who) return { ok = true, recipient = who, lines = {} } end,
    }
    local window = ns.UI.SessionWindow.new(kit, callbacks)
    window.update(ns.UI.Sample.session())
    return window, ns.UI.Sample, game
  end

  local window, Sample, game = open()
  story.snap("A night with five items and twelve names on the priority list")

  window.update(Sample.session({ lines = 40 }))
  window.parts.priorities.scrollBy(16 * 9)
  story.snap("A list of 40 names, scrolled")

  window.update(Sample.session({ lines = 12 }))
  window.selectLine(2)
  story.snap("A name selected: the recipient is filled in")

  game.fire(window.parts.giveButton, "OnClick")
  story.snap("Give pressed: the confirmation")
  window.confirm.hide()

  window.update(Sample.session({ attempt = { state = "unconfirmed", who = "Mirelle Dunmore" } }))
  story.snap("A give the game did not confirm")

  window.update(Sample.session({ observed = { { id = "o1", who = "Garrick Vole", item = "Blade of the Fixture" } } }))
  story.snap("A give the game made that we did not start")

  window.update(Sample.session())
  game.fire(window.parts.pickButton, "OnClick")
  story.snap("Pick: someone out of the raid of 40")

  open({ density = "roomy" })
  story.snap("The same window roomy")

  open({ chrome = "flat" })
  story.snap("The same window with the flat frame, which the kit falls back to when the stock frame is not available")
end
