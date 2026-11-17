-- Council votes in a loot session (IntrepidManager/game/CouncilSession.lua with core/Votes.lua): three stand-in games exchange the
-- messages through the fake server (tests/support/fake_chat.lua). The loot master is a Member of the guild, one raider an Officer
-- Alt (on the council), one an Initiate (not). Invented names, guild and items only.

local UI = dofile("tests/support/strict_ui.lua")
local FakeChat = dofile("tests/support/fake_chat.lua")

local GUILD = "Test Guild"
local MASTER, OFFICER, RAIDER = "Jorren Ashvale", "Bram Tollet", "Mirelle Dunmore"

local function link(id, name) return "|cffa335ee|Hitem:" .. id .. "::::::::70:::::|h[" .. name .. "]|h|r" end

local function client(world, name, guild)
  local game = UI.new()
  local joined = world.join(game, name)
  joined.guild = guild
  local env = game.env
  env.C_Item = {
    GetItemInfo = function(item)
      local id = tonumber(string.match(item, "item:(%d+)"))
      return "Thing " .. id, link(id, "Thing " .. id)
    end,
  }
  local ns = {}
  load_core(ns, "Names", "Council", "Votes", "Version")
  if world.exchange then load_core(ns, "Crc32", "Json", "Envelope", "Ids", "Check", "Night", "Awards") end
  game.load("IntrepidManager/net/CouncilWire.lua", ns)
  game.load("IntrepidManager/net/Outbox.lua", ns)
  game.load("IntrepidManager/game/Bags.lua", ns)
  game.load("IntrepidManager/game/Trade.lua", ns)
  if world.exchange then game.load("IntrepidManager/game/Exchange.lua", ns) end
  game.load("IntrepidManager/game/CouncilSession.lua", ns)
  local mine = { game = game, joined = joined, db = {}, said = {}, events = {}, ns = ns }
  if world.exchange and name == MASTER then
    mine.exchange = ns.Game.Exchange.new({
      db = mine.db, version = "0.0.27", now = function() return 1796867000 + math.floor(game.clock) end,
      dateOf = function() return "2026-12-09" end, sessionOpen = function() return mine.council.sessionOpen() end,
    })
  end
  mine.council = ns.Game.CouncilSession.new({
    out = function(text) mine.said[#mine.said + 1] = text end, db = mine.db, version = "0.0.27", sid = name == MASTER and "ml" or "rd",
    exchange = mine.exchange,
  })
  for _, hook in ipairs({ "onOffer", "onVotes", "onVotingOpen", "onAwarded" }) do
    mine.council.hooks[hook] = function(...) mine.events[#mine.events + 1] = { hook, ... } end
  end
  mine.council.listen()
  return mine
end

-- The loot master, an officer's alt and an initiate in one group (options.ranks changes who has which rank).
local function trio(options)
  options = options or {}
  local world = FakeChat.new()
  world.exchange = options.exchange
  world.rankNames = options.rankNames
  local ranks = options.ranks or { [MASTER] = { "Member", 4 }, [OFFICER] = { "Officer Alt", 2 }, [RAIDER] = { "Initiate", 6 } }
  local scene = { world = world }
  for key, name in pairs({ master = MASTER, officer = OFFICER, raider = RAIDER }) do
    local rank = ranks[name]
    scene[key] = { name = name, guild = rank and { name = GUILD, rank = rank[1], index = rank[2] } or nil }
  end
  scene.master = client(world, MASTER, scene.master.guild)
  scene.officer = client(world, OFFICER, scene.officer.guild)
  scene.raider = client(world, RAIDER, scene.raider.guild)
  return scene
end

local function said(mine, text)
  for _, line in ipairs(mine.said) do
    if string.find(line, text, 1, true) then return true end
  end
  return false
end

local function count(mine, hook)
  local n = 0
  for _, event in ipairs(mine.events) do
    if event[1] == hook then n = n + 1 end
  end
  return n
end

local function start(scene, seconds, ...)
  local text = ""
  for _, id in ipairs({ ... }) do text = text .. link(id, "Thing " .. id) .. " " end
  scene.master.council.command("add " .. text)
  scene.master.council.command("start " .. tostring(seconds))
  scene.world.advance(1)
end

-- The rows of item n in one client's voting window, as "who label votes", with "*" for the leader and "!" for this player's vote.
local function board(mine, n)
  local lines = {}
  for _, row in ipairs(mine.council.votingRows(n)) do
    lines[#lines + 1] = row.who .. " " .. row.label .. " " .. row.votes .. (row.leader and "*" or "") .. (row.mine and "!" or "")
  end
  return lines
end

test("the council goes out before the offers: Officer Alt and higher, and the loot master always; everyone gets the voting window once", function()
  local scene = trio()
  start(scene, 60, 101, 102)
  is_true(said(scene.master, "council (Officer Alt and higher): 2 in the group - Jorren Ashvale, Bram Tollet."))
  for _, mine in ipairs({ scene.officer, scene.raider }) do
    eq(count(mine, "onVotingOpen"), 1)
    local model = mine.council.votingModel()
    eq(model.master, MASTER)
    eq(model.councilSize, 2)
    eq(#model.items, 2)
    eq(model.state, "running")
  end
  is_true(scene.officer.council.votingModel().council)
  eq(scene.raider.council.votingModel().council, false)
  -- the loot master's own window shows the votes; the voting window is not opened for them
  eq(count(scene.master, "onVotingOpen"), 0)
  local model = scene.master.council.masterModel()
  eq(model.councilSize, 2)
  eq(model.items[1].voted, 0)
  is_true(model.items[1].votingOpen)
  is_true((scene.master.joined.rosterAsked or 0) >= 1) -- a fresh roster was asked for when the addon loaded
end)

test("answers go to the loot master by whisper and as a copy to the group chat, so every voting window lists the candidates", function()
  local scene = trio()
  start(scene, 60, 101)
  scene.raider.council.respond("1 up my first ring")
  scene.officer.council.respond("1 bis")
  scene.master.council.respond("1 os")
  scene.world.advance(1)
  -- the loot master's session took both answers from the whispers
  eq(scene.master.council.session().counts(1).total, 3)
  local expected = { "Bram Tollet Best in slot 0", "Mirelle Dunmore Upgrade 0", "Jorren Ashvale Off-spec 0" }
  deep_eq(board(scene.officer, 1), expected)
  deep_eq(board(scene.raider, 1), expected)
  eq(scene.raider.council.votingRows(1)[2].note, "my first ring")
  -- each raider's answer went both ways; the loot master's own only to the group chat
  local ways = {}
  for _, delivery in ipairs(scene.world.delivered) do
    if string.sub(delivery.text, 1, 1) == "R" and delivery.to == MASTER then ways[delivery.from .. " " .. delivery.chat] = true end
  end
  deep_eq(ways, {
    [OFFICER .. " WHISPER"] = true, [OFFICER .. " PARTY"] = true, [RAIDER .. " WHISPER"] = true, [RAIDER .. " PARTY"] = true,
    [MASTER .. " PARTY"] = true,
  })
end)

test("a council member votes, and every window counts it; the vote moves, and the button's second press takes it back", function()
  local scene = trio()
  start(scene, 60, 101)
  scene.raider.council.respond("1 up")
  scene.officer.council.respond("1 bis")
  scene.world.advance(1)
  is_true(scene.officer.council.vote(1, "Mirelle Dunmore"))
  is_true(said(scene.officer, "item 1: your vote is for Mirelle Dunmore."))
  scene.world.advance(1)
  deep_eq(board(scene.officer, 1), { "Bram Tollet Best in slot 0", "Mirelle Dunmore Upgrade 1*!" })
  deep_eq(board(scene.raider, 1), { "Bram Tollet Best in slot 0", "Mirelle Dunmore Upgrade 1*" })
  local rows = scene.master.council.rowsModel(1)
  eq(rows[2].who, RAIDER)
  eq(rows[2].votes, 1)
  deep_eq(rows[2].voters, { OFFICER })
  is_true(rows[2].leader)
  is_true(rows[2].canVote) -- the loot master may vote too
  eq(scene.master.council.masterModel().items[1].voted, 1)
  eq(scene.raider.council.votingModel().items[1].voted, 1)
  -- the vote moves to the officer's own answer
  scene.officer.council.vote(1, "Bram Tollet")
  scene.world.advance(1)
  deep_eq(board(scene.master, 1), { "Bram Tollet Best in slot 1*", "Mirelle Dunmore Upgrade 0" })
  -- the window's button again on the same raider takes it back
  scene.officer.council.vote(1, "Bram Tollet", nil, true)
  is_true(said(scene.officer, "item 1: your vote is taken back."))
  scene.world.advance(1)
  deep_eq(board(scene.raider, 1), { "Bram Tollet Best in slot 0", "Mirelle Dunmore Upgrade 0" })
  eq(scene.master.council.masterModel().items[1].voted, 0)
end)

test("the loot master always votes; a tie marks both, and the votes stay advice: nothing is awarded by them", function()
  local scene = trio()
  start(scene, 60, 101)
  scene.raider.council.respond("1 up")
  scene.officer.council.respond("1 bis")
  scene.world.advance(1)
  scene.officer.council.vote(1, "Mirelle Dunmore")
  is_true(scene.master.council.vote(1, "Bram Tollet"))
  scene.world.advance(1)
  deep_eq(board(scene.raider, 1), { "Bram Tollet Best in slot 1*", "Mirelle Dunmore Upgrade 1*" })
  eq(scene.master.council.masterModel().items[1].voted, 2)
  eq(scene.master.council.session().item(1).winner, nil)
end)

test("only the council votes: an initiate is told so, and a vote sent anyway is not counted", function()
  local scene = trio()
  start(scene, 60, 101)
  scene.officer.council.respond("1 bis")
  scene.world.advance(1)
  eq(scene.raider.council.vote(1, "Bram Tollet"), false)
  is_true(said(scene.raider, "only the council votes (Officer Alt and higher, and the loot master)."))
  scene.master.game.send("CHAT_MSG_ADDON", "IMC1", "W~1~ml1~1~Bram Tollet", "PARTY", RAIDER)
  scene.master.game.send("CHAT_MSG_ADDON", "IMC1", "W~1~ml1~1~Bram Tollet", "WHISPER", RAIDER)
  scene.officer.game.send("CHAT_MSG_ADDON", "IMC1", "W~1~ml1~1~Bram Tollet", "PARTY", RAIDER)
  -- the loot master counts the whisper, not the group chat's copy; everyone else counts the copy, not a whisper
  scene.master.game.send("CHAT_MSG_ADDON", "IMC1", "W~1~ml1~1~Bram Tollet", "PARTY", OFFICER)
  scene.raider.game.send("CHAT_MSG_ADDON", "IMC1", "W~1~ml1~1~Bram Tollet", "WHISPER", OFFICER)
  eq(scene.master.council.rowsModel(1)[1].votes, 0)
  eq(scene.officer.council.votingRows(1)[1].votes, 0)
  eq(scene.raider.council.votingRows(1)[1].votes, 0)
end)

test("votes are for raiders who asked: not for a Pass, not for somebody who has not answered", function()
  local scene = trio()
  start(scene, 60, 101)
  scene.raider.council.respond("1 pass")
  scene.world.advance(1)
  eq(scene.officer.council.vote(1, "Mirelle Dunmore"), false)
  is_true(said(scene.officer, "Mirelle Dunmore has not asked for item 1"))
  eq(scene.officer.council.vote(1, "Jorren Ashvale"), false)
  local rows = scene.officer.council.votingRows(1)
  eq(rows[1].label, "Pass")
  eq(rows[1].canVote, nil)
  eq(scene.officer.council.vote(9, "Mirelle Dunmore"), false)
end)

test("voting ends with the answer time; the loot master still counts a vote inside the grace, and not one after it", function()
  local scene = trio()
  start(scene, 20, 101)
  scene.raider.council.respond("1 up")
  scene.world.advance(20) -- 21 s
  eq(scene.officer.council.vote(1, "Mirelle Dunmore"), false)
  is_true(said(scene.officer, "voting on item 1 is over"))
  eq(scene.officer.council.votingModel().state, "over")
  eq(scene.officer.council.votingModel().items[1].open, false)
  -- a vote that arrives 2 seconds after the timer was on its way: it counts, and so does taking it back
  scene.world.advance(1) -- 22 s
  scene.master.game.send("CHAT_MSG_ADDON", "IMC1", "W~1~ml1~1~Mirelle Dunmore", "WHISPER", OFFICER)
  eq(scene.master.council.rowsModel(1)[1].votes, 1)
  scene.master.game.send("CHAT_MSG_ADDON", "IMC1", "W~1~ml1~1~", "WHISPER", OFFICER)
  eq(scene.master.council.rowsModel(1)[1].votes, 0)
  -- 3.2 seconds after: too late, though the session has not closed yet
  scene.world.advance(1.2)
  eq(scene.master.council.session().state, "running")
  scene.master.game.send("CHAT_MSG_ADDON", "IMC1", "W~1~ml1~1~Mirelle Dunmore", "WHISPER", OFFICER)
  eq(scene.master.council.rowsModel(1)[1].votes, 0)
end)

test("an award ends voting on that item, every window shows the winner, and taking it back opens voting again", function()
  local scene = trio()
  start(scene, 60, 101, 102)
  scene.raider.council.respond("1 up")
  scene.officer.council.respond("1 bis")
  scene.world.advance(1)
  scene.officer.council.vote(1, "Mirelle Dunmore")
  scene.world.advance(1)
  scene.master.council.award(1, "Mirelle Dunmore")
  scene.world.advance(1)
  for _, mine in ipairs({ scene.officer, scene.raider }) do
    local item = mine.council.votingModel().items[1]
    eq(item.winner, RAIDER)
    eq(item.open, false)
    is_true(mine.council.votingRows(1)[2].winner)
  end
  eq(scene.officer.council.vote(1, "Bram Tollet"), false)
  is_true(scene.officer.council.votingModel().items[2].open) -- the other item still takes votes
  scene.master.council.unaward(1)
  scene.world.advance(1)
  eq(scene.officer.council.votingModel().items[1].winner, nil)
  is_true(scene.officer.council.vote(1, "Bram Tollet"))
  scene.world.advance(1)
  local rows = scene.master.council.rowsModel(1)
  eq(rows[1].who, OFFICER)
  eq(rows[1].votes, 1) -- the loot master counts the new vote too
  eq(rows[2].votes, 0)
  -- an award message that does not come from the session's loot master changes nothing
  scene.officer.game.send("CHAT_MSG_ADDON", "IMC1", "A~1~ml1~2~Mirelle Dunmore", "PARTY", RAIDER)
  eq(scene.officer.council.votingModel().items[2].winner, nil)
end)

test("the awards log keeps who voted for whom, and the export leaves it out", function()
  local scene = trio({ exchange = true })
  start(scene, 60, 101, 102)
  scene.raider.council.respond("1 up")
  scene.officer.council.respond("1 bis")
  scene.world.advance(1)
  scene.officer.council.vote(1, "Mirelle Dunmore")
  scene.master.council.vote(1, "Bram Tollet")
  scene.world.advance(1)
  scene.master.council.award(1, "Mirelle Dunmore")
  local record = scene.master.exchange.log()[1]
  deep_eq(record.votes, { { to = OFFICER, by = { MASTER } }, { to = RAIDER, by = { OFFICER } } })
  local vm = scene.master.exchange.exportModel(true)
  eq(vm.count, 1)
  eq(string.find(vm.text, "votes", 1, true), nil)
  eq(string.find(vm.text, "place", 1, true), nil)
  -- an item nobody voted on keeps no votes
  scene.master.council.award(2, "Bram Tollet")
  eq(scene.master.exchange.log()[2].votes, nil)
end)

test("not in a guild, or no rank of that name: only the loot master votes, and /im council says why and sets the rank", function()
  local scene = trio({ ranks = { [OFFICER] = { "Officer Alt", 2 } } })
  start(scene, 60, 101)
  is_true(said(scene.master, "only you vote: you are not in a guild."))
  eq(scene.officer.council.votingModel().council, false)
  local other = trio({ ranks = { [MASTER] = { "Member", 4 }, [OFFICER] = { "Officer", 1 }, [RAIDER] = { "Veteran", 3 } } })
  other.master.council.councilCommand("")
  is_true(said(other.master, "only you vote: no guild rank is called Officer Alt."))
  other.master.council.councilCommand("rank officer")
  is_true(said(other.master, "the council now starts at the rank officer."))
  is_true(said(other.master, "council (officer and higher): 2 in the group - Jorren Ashvale, Bram Tollet."))
  eq(other.master.db.settings.councilRank, "officer")
  other.master.council.councilCommand("rank")
  is_true(said(other.master, "the council starts at the rank officer."))
  -- a rank nobody in the group has is found in the roster
  local roster = trio({ ranks = { [MASTER] = { "Member", 4 }, [OFFICER] = { "Officer", 1 }, [RAIDER] = { "Initiate", 6 } } })
  roster.world.roster = { { name = "Cass Wren", rank = "Officer Alt", index = 2 } }
  roster.master.council.councilCommand("")
  is_true(said(roster.master, "council (Officer Alt and higher): 2 in the group - Jorren Ashvale, Bram Tollet."))
end)

test("a practice: the loot master votes alone for an answer, nothing is sent, and the window counts 1 of 1", function()
  local scene = trio()
  scene.master.joined.inGroup = false
  scene.master.council.command("add " .. link(101, "Thing 101"))
  scene.master.council.command("start 30")
  scene.master.council.respond("1 bis")
  local sends = scene.world.sends
  is_true(scene.master.council.vote(1, "(you)"))
  eq(scene.world.sends, sends)
  local model = scene.master.council.masterModel()
  eq(model.councilSize, 1)
  eq(model.items[1].voted, 1)
  local rows = scene.master.council.rowsModel(1)
  eq(rows[1].who, "(you)")
  eq(rows[1].votes, 1)
  is_true(rows[1].mine)
  local voting = scene.master.council.votingModel()
  eq(voting.master, "you")
  is_true(voting.practice)
  deep_eq(board(scene.master, 1), { "Jorren Ashvale Best in slot 1*!" })
end)

test("a loot master of an older build sends no council: the answer goes by whisper, and there is no voting window", function()
  local scene = trio()
  local env = scene.raider.game.env
  local sent, real = {}, env.C_ChatInfo.SendAddonMessage
  env.C_ChatInfo.SendAddonMessage = function(prefix, text, chat, target)
    sent[#sent + 1] = { text = text, chat = chat, target = target }
    return real(prefix, text, chat, target)
  end
  scene.raider.game.send("CHAT_MSG_ADDON", "IMC1", "I~1~old1~1~1~60~4~item:555~Old Thing", "PARTY", "Tavian Holt")
  scene.raider.council.respond("1 up")
  local last = sent[#sent]
  eq(string.sub(last.text, 1, 1), "R")
  eq(last.chat, "WHISPER")
  eq(last.target, "Tavian Holt")
  eq(count(scene.raider, "onVotingOpen"), 0)
  eq(scene.raider.council.votingModel().state, "none")
  eq(scene.raider.council.vote(1, "Mirelle Dunmore"), false)
  is_true(said(scene.raider, "there is no session with a council to vote in."))
end)

test("/im vote and /im votes in the chat", function()
  local scene = trio()
  start(scene, 60, 101)
  scene.raider.council.respond("1 up")
  scene.world.advance(1)
  scene.officer.council.voteCommand("1 mirelle dunmore")
  is_true(said(scene.officer, "item 1: your vote is for Mirelle Dunmore."))
  scene.officer.council.voteCommand("1 clear")
  is_true(said(scene.officer, "item 1: your vote is taken back."))
  scene.officer.council.voteCommand("")
  is_true(said(scene.officer, "use /im vote <item number> <name>"))
  scene.officer.council.hooks.onVotingOpen = nil
  scene.officer.council.openVoting()
  is_true(said(scene.officer, "item 1: 0 voted"))
  local lonely = trio()
  lonely.raider.council.openVoting()
  is_true(said(lonely.raider, "there is no session with a council yet."))
end)

test("the guild's own list of rank names finds the rank when nobody online has it", function()
  local scene = trio({
    ranks = { [MASTER] = { "Member", 4 }, [OFFICER] = { "Officer", 1 }, [RAIDER] = { "Veteran", 3 } },
    rankNames = { "Guild Master", "Officer", "Officer Alt", "Veteran", "Member", "Alt", "Initiate" },
  })
  scene.master.council.councilCommand("")
  is_true(said(scene.master, "council (Officer Alt and higher): 2 in the group - Jorren Ashvale, Bram Tollet."))
end)

test("taking an award back after the answer time does not open voting again", function()
  local scene = trio()
  start(scene, 20, 101)
  scene.raider.council.respond("1 up")
  scene.world.advance(1)
  scene.master.council.award(1, RAIDER)
  scene.world.advance(19.5) -- 21.5 s
  scene.master.council.unaward(1)
  scene.world.advance(0.5)
  eq(scene.officer.council.vote(1, RAIDER), false)
  eq(scene.master.council.vote(1, RAIDER), false)
end)

test("a council member whose own practice is over votes on the next loot master's session", function()
  local scene = trio()
  scene.officer.joined.inGroup = false
  scene.officer.council.command("add " .. link(201, "Thing 201"))
  scene.officer.council.command("start 5")
  scene.world.advance(10)
  eq(scene.officer.council.session().state, "closed") -- never cleared with New session
  scene.officer.joined.inGroup = true
  start(scene, 60, 101)
  scene.raider.council.respond("1 up")
  scene.world.advance(1)
  eq(scene.officer.council.votingModel().sid, "ml1")
  is_true(scene.officer.council.vote(1, RAIDER))
  scene.world.advance(1)
  eq(scene.master.council.rowsModel(1)[1].votes, 1)
end)

test("a vote for a raider who then changes to Pass is not counted or kept, and counts again if they ask again", function()
  local scene = trio({ exchange = true })
  start(scene, 60, 101)
  scene.raider.council.respond("1 up")
  scene.officer.council.respond("1 bis")
  scene.world.advance(1)
  is_true(scene.officer.council.vote(1, RAIDER))
  scene.world.advance(1)
  scene.raider.council.respond("1 pass")
  scene.world.advance(1)
  eq(scene.master.council.masterModel().items[1].voted, 0)
  local item = scene.officer.council.votingModel().items[1]
  eq(item.voted, 0)
  eq(item.myVote, nil)
  eq(item.candidates, 1)
  deep_eq(board(scene.officer, 1), { "Bram Tollet Best in slot 0", "Mirelle Dunmore Pass 0" })
  deep_eq(board(scene.master, 1), { "Bram Tollet Best in slot 0", "Mirelle Dunmore Pass 0" })
  -- asking again: the vote that stayed on the board counts again
  scene.raider.council.respond("1 up")
  scene.world.advance(1)
  eq(scene.master.council.masterModel().items[1].voted, 1)
  eq(scene.officer.council.votingModel().items[1].myVote, RAIDER)
  -- and an award after a Pass keeps no vote for the raider who passed
  scene.raider.council.respond("1 pass")
  scene.world.advance(1)
  scene.master.council.award(1, OFFICER)
  eq(scene.master.exchange.log()[1].votes, nil)
end)

test("many answers near the end of the timer all reach the loot master, and so does a vote sent after them", function()
  local scene = trio()
  local ids = {}
  for i = 1, 20 do ids[i] = 300 + i end
  start(scene, 30, unpack(ids))
  scene.world.advance(25) -- 26 s: every offer is in
  for i = 1, 20 do is_true(scene.raider.council.answer(i, "b", "", nil)) end
  for i = 1, 20 do is_true(scene.officer.council.answer(i, "u", "", nil)) end
  scene.world.advance(0.5)
  is_true(scene.officer.council.vote(1, RAIDER))
  scene.world.advance(15)
  local got = 0
  for i = 1, 20 do got = got + scene.master.council.session().counts(i).total end
  eq(got, 40)
  local mirelle
  for _, row in ipairs(scene.master.council.rowsModel(1)) do
    if row.who == RAIDER then mirelle = row end
  end
  eq(mirelle.votes, 1)
end)

test("with many items the last offers go out seconds late, but carry the time left: every countdown ends with the loot master's", function()
  local scene = trio()
  local ids = {}
  for i = 1, 20 do ids[i] = 300 + i end
  start(scene, 30, unpack(ids)) -- the council and 20 offers: 10 messages go at once, then one a second
  scene.world.advance(15) -- 16 s: every offer is in
  local timers = {}
  for _, delivery in ipairs(scene.world.delivered) do
    local n, timer = string.match(delivery.text, "^I~1~ml1~(%d+)~20~(%d+)~")
    if n and delivery.to == RAIDER then timers[tonumber(n)] = tonumber(timer) end
  end
  is_true(timers[1] >= 29)
  is_true(timers[20] <= 20) -- it left about 11 seconds late, with that much less time
  local left = {}
  for _, row in ipairs(scene.raider.council.offerModel().rows) do left[row.n] = row.remaining end
  is_true(math.abs(left[20] - left[1]) <= 1)
  -- an answer in the raider's last seconds reaches the loot master in time; after the countdown the raider's own window says no
  scene.world.advance(13) -- 29 s
  is_true(scene.raider.council.answer(20, "b", "", nil))
  scene.world.advance(2) -- 31 s
  eq(scene.raider.council.answer(19, "b", "", nil), false)
  eq(scene.master.council.session().counts(20).total, 1)
end)

test("only the session's loot master offers, sends the council or ends it: copies from anybody else change nothing", function()
  local scene = trio()
  start(scene, 60, 101)
  scene.raider.council.respond("1 up")
  scene.world.advance(1)
  scene.officer.game.send("CHAT_MSG_ADDON", "IMC1", "X~1~ml1", "PARTY", RAIDER)
  scene.officer.game.send("CHAT_MSG_ADDON", "IMC1", "I~1~ml1~2~2~60~4~item:999~Fake Thing", "PARTY", RAIDER)
  scene.officer.game.send("CHAT_MSG_ADDON", "IMC1", "C~1~ml1~Mirelle Dunmore", "PARTY", RAIDER)
  local model = scene.officer.council.votingModel()
  eq(#model.items, 1)
  eq(model.councilSize, 2)
  eq(model.state, "running")
  is_true(scene.officer.council.vote(1, RAIDER))
  -- the loot master's own end does end it
  scene.master.council.finish()
  scene.world.advance(1)
  eq(scene.officer.council.votingModel().state, "over")
end)

test("the loot master is told once which raiders run a build whose answers the council cannot see", function()
  local scene = trio()
  start(scene, 60, 101)
  eq(said(scene.master, "their answers reach only you"), false) -- the other two run this build
  scene.master.game.send("CHAT_MSG_ADDON", "IMC1", "K~1~ml1~0.0.25~MAGE", "WHISPER", "Tavian Holt")
  scene.master.game.send("CHAT_MSG_ADDON", "IMC1", "K~1~ml1~0.0.25~MAGE", "WHISPER", "Tavian Holt")
  local lines = 0
  for _, line in ipairs(scene.master.said) do
    if string.find(line, "Tavian Holt has Intrepid Manager 0.0.25: their answers reach only you", 1, true) then lines = lines + 1 end
  end
  eq(lines, 1)
end)

test("a council member who is offline is not counted in N out of M", function()
  local scene = trio()
  scene.officer.joined.connected = false
  start(scene, 60, 101)
  eq(scene.master.council.masterModel().councilSize, 1)
  eq(scene.raider.council.votingModel().councilSize, 1)
end)
