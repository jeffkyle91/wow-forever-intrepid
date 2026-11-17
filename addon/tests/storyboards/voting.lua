-- Council votes: the voting window everyone gets at the start of a session with a council, and the loot master's window with the
-- votes. The windows are the addon's real code (IntrepidManager/ui/); the models are invented (ui/Sample.lua's voting session for
-- the voting window). Invented names only.

local FILES = { "core/Names", "core/Council", "ui/Kit", "ui/Sample", "ui/SessionPanel", "ui/VotingWindow" }

return function(story)
  story.describe("Council votes",
    "Everyone in a session with a council gets the voting window beside the answer window. The council (Officer Alt and higher, and "
    .. "the loot master) has a Vote button on each raider who asked for the item; a second press takes the vote back. The count "
    .. "shows who voted when hovered, and the most voted row is tinted gold. The loot master's window shows the same votes, with "
    .. "the loot master's own Vote button next to Award: the votes are advice, the loot master awards.")

  local function load(options)
    local game = story.reset({})
    local ns = {}
    for _, file in ipairs(FILES) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
    return ns, ns.UI.Kit.new(options or {})
  end

  local function voting(mine, change, options)
    local ns, kit = load(options)
    local model, rows = ns.UI.Sample.voting(mine)
    for key, value in pairs(change or {}) do model[key] = value end
    if change and change.council == false then
      for _, list in pairs(rows) do
        for _, row in ipairs(list) do row.canVote = nil end
      end
    end
    local window = ns.UI.VotingWindow.new(kit, { model = function() return model end, rows = function(n) return rows[n] or {} end })
    window.update(model)
    window.show()
    return window
  end

  voting({})
  story.snap("A council member's view while the timer runs: 3 of 4 have voted, Bram Tollet leads with 2 votes")

  voting({ [1] = "Mirelle Dunmore" })
  story.snap("After voting for Mirelle Dunmore: her button says Voted, and the tie with Bram Tollet tints both rows")

  voting({}, { council = false })
  story.snap("A raider off the council: the same counts, no Vote buttons, and the line at the bottom says who votes")

  local window = voting({})
  window.parts.leftRows[2].frame:GetScript("OnClick")(window.parts.leftRows[2].frame)
  story.snap("An item the loot master awarded: Awarded to Selwyn Crake, and voting on it is over")

  voting({}, nil, { density = "roomy" })
  story.snap("The voting window roomy")

  -- the loot master's window with the votes
  local ns, kit = load()
  local function item(n, name, change)
    local data = { n = n, item = "item:" .. (900100 + n), name = name, quality = 4, icon = 134400, counts = { b = 1, u = 1, o = 1, p = 1, total = 4 }, asked = 5 }
    for key, value in pairs(change or {}) do data[key] = value end
    return data
  end
  local _, rows = ns.UI.Sample.voting({ [1] = "Bram Tollet" })
  local answers = {}
  for i, row in ipairs(rows[1]) do
    answers[i] = row
    if row.who == "Bram Tollet" then row.voters[1] = "Jorren Ashvale" end
  end
  answers[#answers + 1] = { who = "Seren Ashby", label = "Waiting", note = "", class = "DRUID", missing = true, votes = 0, voters = {} }
  local model = {
    state = "running", timer = 90, remaining = 38, answers = 9, expected = 15, responders = 5, hellos = 5, group = 5, councilSize = 4,
    items = { item(1, "Blade of the Fixture", { voted = 4 }), item(2, "Cloak of the Mock", { voted = 2 }), item(3, "Ring of Placeholders", { voted = 0 }) },
  }
  local panel = ns.UI.SessionPanel.new(kit, { model = function() return model end, rows = function(n) return n == 1 and answers or {} end })
  panel.update(model)
  panel.show()
  story.snap("The loot master's window: a VOTES column and the loot master's own Vote button; Votes 4 of 4 above the answers")
end
