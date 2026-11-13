-- The loot history window, in the states a loot master meets: nothing kept yet, a few weeks of raids, one raid picked, a search, a
-- search that finds nothing, the same window roomy and with the flat frame. The window is the addon's real code (IntrepidManager/ui/);
-- the history is built by the real core/History.lua from an invented awards log. Invented names, items and places only.

local FILES = { "core/History", "ui/Kit", "ui/HistoryWindow" }

return function(story)
  story.describe("Loot history",
    "Every award made as loot master on this account, across all dates. Left, the raids (the game's dungeon or raid and when it "
    .. "started); right, the awards of the raid picked. The search takes a player, an item, a dungeon or raid, or a date.")

  local WED = 1796846700 -- 2026-12-09 20:05 UTC, a Wednesday
  local DAY, HOUR = 86400, 3600
  local PLAYERS = { "Jorren Ashvale", "Mirabel Quint", "Bram Tollet", "Tavian Marrow", "Zo\195\171 \195\134rinwald", "Odile Fenwick" }
  local ITEMS = {
    "Cloak of Fixtures", "Test Blade of Ages", "Helm of Samples", "Ring of Stand-ins", "Gauntlets of the Dry Run", "Mantle of Mock Data",
    "Leggings of the Placeholder", "Belt of Invented Names",
  }

  -- Four weeks of Wednesday raids in Molten Test Core, an Onyx Test Lair run after each, and a dungeon run between.
  local function sampleLog()
    local log, n = {}, 0
    local function add(at, place, options)
      n = n + 1
      options = options or {}
      log[#log + 1] = {
        id = "s-tpt2u0-q4tz-" .. n, rev = 1, at = at, date = os.date("!%Y-%m-%d", at), itemId = 900000 + n,
        item = ITEMS[(n % #ITEMS) + 1], to = options.to or PLAYERS[(n % #PLAYERS) + 1], decision = "council",
        delivery = { state = (n % 4 == 0) and "assigned" or "received" }, place = place,
        status = (n % 11 == 0) and "removed" or nil, pseudo = options.pseudo,
      }
    end
    for week = 0, 3 do
      local start = WED + week * 7 * DAY
      for k = 0, 7 do add(start + k * 15 * 60, "Molten Test Core") end
      add(start + 2 * HOUR + 30 * 60, "Molten Test Core", { to = "Disenchant", pseudo = "disenchant" })
      for k = 0, 2 do add(start + 3 * HOUR + k * 10 * 60, "Onyx Test Lair") end
      add(start + 3 * DAY + 2 * HOUR, "Hollow Test Keep")
    end
    return log
  end

  local function clock(at) return os.date("!*t", at) end

  local function open(options, log, search)
    local game = story.reset({})
    local ns = {}
    for _, file in ipairs(FILES) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
    local kit = ns.UI.Kit.new({ density = options and options.density, chrome = options and options.chrome })
    local window = ns.UI.HistoryWindow.new(kit)
    window.open({ history = ns.History.build(log, clock), year = 2026, limit = 10000, search = search })
    return window, game
  end

  open(nil, {})
  story.snap("Nothing kept yet")

  open(nil, sampleLog())
  story.snap("Four weeks of raids: every award, newest first, and the raids on the left")

  local window, game = open(nil, sampleLog())
  game.fire(window.parts.raidList.lines[5].frame, "OnClick", "LeftButton")
  story.snap("One raid picked: its awards only")

  open(nil, sampleLog(), "cloak")
  story.snap("A search for an item: the raids on the left are those with a match, with how many")

  open(nil, sampleLog(), "dec 16")
  story.snap("A search for a date")

  open(nil, sampleLog(), "nobody by this name")
  story.snap("A search that finds nothing")

  open({ density = "roomy" }, sampleLog())
  story.snap("The same window roomy")

  open({ chrome = "flat" }, sampleLog())
  story.snap("The same window with the flat frame")
end
