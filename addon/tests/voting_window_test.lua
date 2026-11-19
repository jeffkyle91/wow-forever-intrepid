-- The voting window (IntrepidManager/ui/VotingWindow.lua) on the strict stand-in widgets. Invented names and items only.

local UI = dofile("tests/support/strict_ui.lua")
local StockTemplates = dofile("tests/support/stock_templates.lua")
local Intact = dofile("tests/support/intact.lua")

local FILES = { "ui/Kit", "ui/SessionPanel", "ui/VotingWindow" }

local function item(n, change)
  local data = { n = n, item = "item:" .. (3000 + n), name = "Thing " .. n, quality = 4, icon = 133000 + n, voted = 0, candidates = 0, open = true }
  for key, value in pairs(change or {}) do data[key] = value end
  return data
end

local function model(count, change)
  local items = {}
  for i = 1, count do items[i] = item(i) end
  local data = { state = "running", remaining = 42, master = "Jorren Ashvale", council = true, rank = "Officer Alt", councilSize = 3, items = items }
  for key, value in pairs(change or {}) do data[key] = value end
  return data
end

local function candidate(who, code, label, change)
  local data = { who = who, code = code, label = label, note = "", class = "MAGE", votes = 0, voters = {} }
  for key, value in pairs(change or {}) do data[key] = value end
  return data
end

local function setup(options)
  options = options or {}
  local game = StockTemplates.install(UI.new())
  local scene = { game = game, calls = {}, tips = {}, errors = {}, model = options.model or model(2), rows = options.rows or {} }
  game.env.GameTooltip = {
    SetOwner = function(_, owner, anchor) scene.tips[#scene.tips + 1] = { "owner", owner, anchor } end,
    SetHyperlink = function(_, link) scene.tips[#scene.tips + 1] = { "link", link } end,
    SetText = function(_, words) scene.tips[#scene.tips + 1] = { "text", words } end,
    AddLine = function(_, words) scene.tips[#scene.tips + 1] = { "line", words } end,
    Show = function() scene.tips[#scene.tips + 1] = { "show" } end,
    Hide = function() scene.tips[#scene.tips + 1] = { "hide" } end,
  }
  local ns = {}
  load_core(ns, "Names", "Council")
  for _, file in ipairs(FILES) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
  scene.ns = ns
  scene.kit = ns.UI.Kit.new({ density = options.density, onError = function(err) scene.errors[#scene.errors + 1] = tostring(err) end })
  scene.window = ns.UI.VotingWindow.new(scene.kit, {
    model = function() return scene.model end,
    rows = function(n) return scene.rows[n] or {} end,
    vote = function(n, who) scene.calls[#scene.calls + 1] = { "vote", n, who } end,
  })
  scene.parts = scene.window.parts
  return scene
end

local function text(scene, widget) return scene.game.state(widget).text end
local function shown(scene, widget) return scene.game.visible(widget) end
local function press(scene, widget) scene.game.fire(widget, "OnClick", "LeftButton") end

test("the sentences: votes so far and the time left, over, awarded; the count of an item; what this player can do", function()
  local W = setup().ns.UI.VotingWindow
  local data = model(1)
  data.items[1].voted = 2
  eq(W.statusText(data, data.items[1]), "2 out of 3 have voted - 42 s left")
  eq(W.statusText(model(1, { state = "over", remaining = nil }), item(1, { voted = 1 })), "Voting is over - 1 out of 3 voted")
  eq(W.statusText(data, item(1, { winner = "Mirelle Dunmore" })), "Awarded to Mirelle Dunmore")
  eq(W.statusText({ state = "none", items = {} }, nil), "No session with a council yet.")
  eq(W.itemCount(data, item(1, { voted = 2 })), "2/3")
  eq(W.itemCount(data, item(1, { winner = "Mirelle Dunmore" })), "won")
  is_true(string.find(W.hintText(data), "You are on the council", 1, true) == 1)
  eq(W.hintText(model(1, { council = false })), "Only the council votes (Officer Alt and higher, and the loot master). Hover a vote count to see who voted.")
  eq(W.hintText({ state = "none", items = {} }), "The window fills when a loot master starts a session.")
end)

test("the candidates of the picked item: name, answer, note, votes; the council's Vote button votes, and the most voted is tinted", function()
  local rows = {
    [1] = {
      candidate("Bram Tollet", "b", "Best in slot", { votes = 2, voters = { "Jorren Ashvale", "Ness Coyle" }, leader = true, canVote = true }),
      candidate("Mirelle Dunmore", "u", "Upgrade", { note = "my first ring", votes = 1, voters = { "Bram Tollet" }, canVote = true, mine = true }),
      candidate("Tamsin Rook", "p", "Pass"),
    },
    [2] = { candidate("Orrin Vale", "o", "Off-spec", { canVote = true }) },
  }
  local scene = setup({ rows = rows })
  scene.model.items[1].voted = 3
  scene.window.update(scene.model)
  scene.window.show()
  eq(text(scene, scene.parts.votesHead), "VOTES - Thing 1")
  eq(text(scene, scene.parts.status), "3 out of 3 have voted - 42 s left")
  eq(text(scene, scene.parts.leftRows[1].count), "3/3")
  local right = scene.parts.rightRows
  eq(text(scene, right[1].who), "Bram Tollet")
  eq(text(scene, right[1].claim), "Best in slot")
  eq(text(scene, right[1].votes), "2")
  eq(shown(scene, right[1].leaderBg), true)
  eq(text(scene, right[1].vote), "Vote")
  eq(text(scene, right[2].note), "my first ring")
  eq(text(scene, right[2].vote), "Voted")
  eq(shown(scene, right[3].vote), false)
  press(scene, right[2].vote)
  press(scene, right[1].vote)
  deep_eq(scene.calls, { { "vote", 1, "Mirelle Dunmore" }, { "vote", 1, "Bram Tollet" } })
  scene.game.fire(right[1].votesHit, "OnEnter")
  deep_eq({ scene.tips[2], scene.tips[3], scene.tips[4] }, { { "text", "Votes for Bram Tollet: 2" }, { "line", "Jorren Ashvale" }, { "line", "Ness Coyle" } })
  -- the second item
  press(scene, scene.parts.leftRows[2].frame)
  eq(text(scene, scene.parts.votesHead), "VOTES - Thing 2")
  eq(text(scene, right[1].who), "Orrin Vale")
  eq(shown(scene, right[2].frame), false)
  deep_eq(scene.errors, {})
end)

test("a raider off the council sees the votes without a button; an awarded item says so and marks its winner", function()
  local rows = { [1] = { candidate("Bram Tollet", "b", "Best in slot", { votes = 1, voters = { "Ness Coyle" }, leader = true, winner = true }) } }
  local scene = setup({ model = model(1, { council = false }), rows = rows })
  scene.model.items[1].winner = "Bram Tollet"
  scene.window.update(scene.model)
  scene.window.show()
  local right = scene.parts.rightRows
  eq(shown(scene, right[1].vote), false)
  eq(shown(scene, right[1].winnerBg), true)
  eq(shown(scene, right[1].leaderBg), false)
  eq(text(scene, scene.parts.status), "Awarded to Bram Tollet")
  eq(text(scene, scene.parts.leftRows[1].count), "won")
  is_true(string.find(text(scene, scene.parts.hint), "Only the council votes", 1, true) == 1)
end)

test("nobody has asked yet, and no session at all, each say so; the window opens at the top left and reads the model every second", function()
  local scene = setup()
  scene.window.update(scene.model)
  scene.window.show()
  eq(text(scene, scene.parts.empty), "Nobody has asked for this item yet.")
  local frameState = scene.game.state(scene.window.frame)
  eq(frameState.points[1].point, "TOPLEFT")
  scene.model = model(1)
  scene.model.items[1].voted = 1
  scene.rows[1] = { candidate("Bram Tollet", "b", "Best in slot", { votes = 1 }) }
  scene.game.advance(1.1)
  eq(text(scene, scene.parts.status), "1 out of 3 have voted - 42 s left")
  eq(text(scene, scene.parts.empty), "")
  local none = setup({ model = { state = "none", items = {} } })
  none.window.update(none.model)
  none.window.show()
  eq(text(none, none.parts.status), "No session with a council yet.")
  eq(text(none, none.parts.votesHead), "VOTES")
end)

test("the window holds together: inside, no text too wide, no controls overlapping (compact and roomy)", function()
  for _, density in ipairs({ "compact", "roomy" }) do
    for _, count in ipairs({ 0, 3, 20 }) do
      local rows = { [1] = {} }
      for i = 1, 30 do
        rows[1][i] = candidate("Raider Number " .. i, "u", "Best in slot",
          { note = "a fairly long note about the item and more", votes = 12, canVote = true, leader = i == 1, mine = i == 2, winner = i == 3 })
      end
      local data = model(count)
      for _, entry in ipairs(data.items) do entry.name = "A Rather Long Item Name Indeed" end
      local scene = setup({ density = density, model = data, rows = rows })
      scene.window.update(data)
      scene.window.show()
      local problems = Intact.problems(scene.game, scene.window.frame)
      if #problems > 0 then print(density, count, table.concat(problems, "\n")) end
      deep_eq(problems, {})
    end
  end
end)
