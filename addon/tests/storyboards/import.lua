-- The import window, in the states a loot master meets: nothing pasted, a good string, a string with something to look at,
-- a string that cannot be used, a string for the wrong box, a session in the way, the moment after Import, and the same
-- window roomy and with the flat frame. The window is the addon's real code (IntrepidManager/ui/); only the callback is
-- a stand-in, and the strings are the shared fixtures of docs/spec/fixtures. Invented names only.

local FILES = { "core/Crc32", "core/Json", "core/Envelope", "core/Ids", "core/Check", "core/Night", "ui/Kit", "ui/ImportWindow" }
local FIXTURES = "docs/spec/fixtures/"
local AT = 1796862600 -- when the fixture night was copied
local LAST_WEEK = "Night of 2026-12-02, copied 7 days ago: 58 players, 87 priorities."

local function fixture(path)
  local handle = assert(io.open(FIXTURES .. path, "rb"))
  local text = handle:read("*a")
  handle:close()
  return text
end

return function(story)
  story.describe("Import window",
    "Paste the night string from the Raid Desk and the window says what it found before anything is imported. Orange means look "
    .. "first, red means this string cannot be used; either way the night the addon has now is kept. Import stays off while a "
    .. "loot session is open.")

  -- A window in a fresh game with last week's night in the addon; returns the window and the game.
  -- options: density, chrome, clock (default: two hours after the string was copied), today (the loot master's date).
  local function open(options)
    options = options or {}
    local game = story.reset({ clock = options.clock or AT + 2 * 3600 })
    local ns = {}
    for _, file in ipairs(FILES) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
    local kit = ns.UI.Kit.new({ density = options.density, chrome = options.chrome })
    local window
    local callbacks = {
      import = function()
        window.update({ current = "Night of 2026-12-09, copied 2 hours ago: 6 players, 3 priorities." })
        return { ok = true, message = "Imported the night of 2026-12-09: 6 players, 3 priorities." }
      end,
    }
    window = ns.UI.ImportWindow.new(kit, callbacks, { today = function() return options.today or "2026-12-09" end })
    window.open({ current = LAST_WEEK })
    return window, game
  end

  local function paste(window, game, text)
    game.paste(window.parts.edit, text)
    game.advance(0.31)
  end

  local window, game = open()
  story.snap("Opened, with last week's night in the addon: nothing pasted yet")

  paste(window, game, fixture("night-small.j.txt"))
  story.snap("A good string, read once the pasting stopped: green, and Import is on")

  window, game = open({ clock = AT + 19 * 3600, today = "2026-12-10" })
  paste(window, game, fixture("cases/night-ok-row-error.txt"))
  story.snap("A string that reads but has something to look at: a skipped priority, another day, an old string")

  window, game = open()
  paste(window, game, fixture("cases/night-bad-truncated.txt"))
  story.snap("A string that was cut: red, Import is off, and the night you have now is kept")

  paste(window, game, fixture("awards-small.j.txt"))
  story.snap("An awards string pasted into the wrong box")

  window, game = open()
  window.update({ current = LAST_WEEK, sessionOpen = true })
  paste(window, game, fixture("night-small.j.txt"))
  story.snap("A loot session is open: the string reads, but Import waits")

  window, game = open()
  paste(window, game, fixture("night-small.j.txt"))
  game.fire(window.parts.importButton, "OnClick")
  story.snap("After Import: the box is empty, the message says what happened, and the night in the addon is the new one")

  window, game = open({ density = "roomy" })
  paste(window, game, fixture("night-small.j.txt"))
  story.snap("The same window roomy")

  window, game = open({ chrome = "flat" })
  paste(window, game, fixture("night-small.j.txt"))
  story.snap("The same window with the flat frame, which the kit falls back to when the stock frame is not available")
end
