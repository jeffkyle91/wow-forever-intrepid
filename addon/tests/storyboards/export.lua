-- The export window, in the states a loot master meets: nothing to export, awards that are new and changed, all new, the
-- box ticked, no night loaded, a session open, and the same window roomy and with the flat frame. The window is the addon's
-- real code (IntrepidManager/ui/); the awards string is the shared fixture of docs/spec/fixtures. Invented names only.

local FILES = { "ui/Kit", "ui/ExportWindow" }

local function fixture(path)
  local handle = assert(io.open(SPEC .. "fixtures/" .. path, "rb"))
  local text = handle:read("*a")
  handle:close()
  return text
end

return function(story)
  story.describe("Export window",
    "The awards string to copy into the Raid Desk: how many awards it holds and which of them are new or changed, a box that "
    .. "cannot be edited and selects everything when it is clicked, and the reminder to /reload when the fight is over.")

  local awards = fixture("awards-small.j.txt")
  local function vm(change)
    local model = { text = awards, count = 5, new = 3, changed = 2, hasNight = true, everything = false, sessionOpen = false }
    for key, value in pairs(change or {}) do model[key] = value end
    return model
  end

  -- A window in a fresh game, open with this view-model; returns the window.
  local function open(options, model)
    local game = story.reset({})
    local ns = {}
    for _, file in ipairs(FILES) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
    local kit = ns.UI.Kit.new({ density = options and options.density, chrome = options and options.chrome })
    local window = ns.UI.ExportWindow.new(kit, {})
    window.open(model or {})
    return window, game
  end

  open(nil, {})
  story.snap("Opened with nothing to export yet")

  local window, game = open(nil, vm())
  game.fire(window.parts.scroll, "OnMouseDown", "LeftButton")
  story.snap("Five awards, three new and two changed since the night was copied; the string is ready to copy")

  open(nil, vm({ count = 4, new = 4, changed = 0 }))
  story.snap("All new")

  open(nil, vm({ count = 12, everything = true }))
  story.snap("The box 'Everything, not only what is new' ticked")

  open(nil, vm({ hasNight = false }))
  story.snap("No night loaded: the awards of the last 14 days")

  open(nil, vm({ sessionOpen = true }))
  story.snap("A loot session is open: awards given from now on are not in the string")

  open({ density = "roomy" }, vm())
  story.snap("The same window roomy")

  open({ chrome = "flat" }, vm())
  story.snap("The same window with the flat frame, which the kit falls back to when the stock frame is not available")
end
