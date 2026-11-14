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
      db = mine.db, version = "0.0.26", now = function() return 1796867000 + math.floor(game.clock) end,
      dateOf = function() return "2026-12-09" end, sessionOpen = function() return mine.council.sessionOpen() end,
    })
  end
  mine.council = ns.Game.CouncilSession.new({
    out = function(text) mine.said[#mine.said + 1] = text end, db = mine.db, version = "0.0.26", sid = name == MASTER and "ml" or "rd",
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

test("answers go to the group chat, so every voting window lists the candidates; the loot master's own answer too", function()
  local scene = trio()
  start(scene, 60, 101)
  scene.raider.council.respond("1 up my first ring")
  scene.officer.council.respond("1 bis")
  scene.master.council.respond("1 os")
  scene.world.advance(1)
  -- the loot master's session took both answers from the group chat
  eq(scene.master.council.session().counts(1).total, 3)
  local expected = { "Bram Tollet Best in slot 0", "Mirelle Dunmore Upgrade 0", "Jorren Ashvale Off-spec 0" }
  deep_eq(board(scene.officer, 1), expected)
  deep_eq(board(scene.raider, 1), expected)
  eq(scene.raider.council.votingRows(1)[2].note, "my first ring")
  for _, delivery in ipairs(scene.world.delivered) do
    if string.sub(delivery.text, 1, 1) == "R" then eq(delivery.chat, "PARTY") end
  end
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
  scene.officer.game.send("CHAT_MSG_ADDON", "IMC1", "W~1~ml1~1~Bram Tollet", "PARTY", RAIDER)
  -- a vote by whisper is not a vote either
  scene.master.game.send("CHAT_MSG_ADDON", "IMC1", "W~1~ml1~1~Bram Tollet", "WHISPER", OFFICER)
  eq(scene.master.council.rowsModel(1)[1].votes, 0)
  eq(scene.officer.council.votingRows(1)[1].votes, 0)
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

test("voting ends with the answer time; a vote that comes after its grace is not counted", function()
  local scene = trio()
  start(scene, 20, 101)
  scene.raider.council.respond("1 up")
  scene.world.advance(20)
  eq(scene.officer.council.vote(1, "Mirelle Dunmore"), false)
  is_true(said(scene.officer, "voting on item 1 is over"))
  eq(scene.officer.council.votingModel().state, "over")
  eq(scene.officer.council.votingModel().items[1].open, false)
  scene.world.advance(5)
  scene.master.game.send("CHAT_MSG_ADDON", "IMC1", "W~1~ml1~1~Mirelle Dunmore", "PARTY", OFFICER)
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
