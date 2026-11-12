-- The version check (IntrepidManager/game/CouncilSession.lua: the announce, the full check, the group's versions): stand-in games
-- exchange the messages through the fake server (tests/support/fake_chat.lua). Invented names only.

local UI = dofile("tests/support/strict_ui.lua")
local FakeChat = dofile("tests/support/fake_chat.lua")

local function link(id, name) return "|cffa335ee|Hitem:" .. id .. "::::::::70:::::|h[" .. name .. "]|h|r" end

-- A client with the addon, in this version and class, and a record of what its windows would be told.
local function member(world, name, version, class)
  local game = UI.new()
  local joined = world.join(game, name)
  joined.class = class
  local ns = {}
  load_core(ns, "Names", "Council", "Version")
  game.load("IntrepidManager/net/CouncilWire.lua", ns)
  game.load("IntrepidManager/net/Outbox.lua", ns)
  game.load("IntrepidManager/game/Bags.lua", ns)
  game.load("IntrepidManager/game/Trade.lua", ns)
  game.load("IntrepidManager/game/CouncilSession.lua", ns)
  local mine = { game = game, joined = joined, db = {}, said = {}, told = 0 }
  mine.council = ns.Game.CouncilSession.new({
    out = function(text) mine.said[#mine.said + 1] = text end, db = mine.db, version = version, sid = "c" .. #world.clients,
  })
  mine.council.hooks.onVersions = function() mine.told = mine.told + 1 end
  mine.council.listen()
  return mine
end

-- A client without the addon: it is in the group, and that is all.
local function bare(world, name, class)
  local game = UI.new()
  local joined = world.join(game, name)
  joined.class = class
  return { game = game, joined = joined }
end

local function said(mine, text)
  for _, line in ipairs(mine.said) do
    if string.find(line, text, 1, true) then return true end
  end
  return false
end

local function count(mine, text)
  local n = 0
  for _, line in ipairs(mine.said) do
    if string.find(line, text, 1, true) then n = n + 1 end
  end
  return n
end

-- How many messages of this kind ("V", "K", "Q") were sent, whoever received them.
local function sent(world, kind)
  local numbers, n = {}, 0
  for _, delivery in ipairs(world.delivered) do
    if string.sub(delivery.text, 1, 1) == kind and not numbers[delivery.number] then
      numbers[delivery.number] = true
      n = n + 1
    end
  end
  return n
end

local function row(model, name)
  for _, entry in ipairs(model.rows) do
    if entry.who == name then return entry end
  end
end

local function roster(...)
  for _, one in ipairs({ ... }) do one.game.send("GROUP_ROSTER_UPDATE") end
end

local function kinds(mine)
  local list = {}
  for _, entry in ipairs((mine.db.council or { log = {} }).log) do list[#list + 1] = entry.e end
  return table.concat(list, " ")
end

local function dump(value)
  if type(value) ~= "table" then return tostring(value) end
  local parts = {}
  for k, v in pairs(value) do parts[#parts + 1] = tostring(k) .. "=" .. dump(v) end
  return "{" .. table.concat(parts, ",") .. "}"
end

test("joining a group announces the version after a moment, and a group of equal versions stays quiet", function()
  local world = FakeChat.new()
  local a = member(world, "Jorren Ashvale", "0.0.15", "WARRIOR")
  local b = member(world, "Mirelle Dunmore", "0.0.15", "MAGE")
  local c = member(world, "Tavian Holt", "0.0.15", "PRIEST")
  roster(a, b, c)
  world.advance(2)
  eq(sent(world, "V"), 0) -- not yet: the roster settles first
  world.advance(2)
  eq(sent(world, "V"), 3)
  eq(sent(world, "K"), 0) -- nobody has another version, so nobody answers
  local model = a.council.versionsModel()
  eq(#model.rows, 3)
  eq(model.rows[1].me, true)
  eq(model.rows[1].who, "Jorren Ashvale")
  eq(model.rows[2].who, "Mirelle Dunmore")
  eq(model.rows[2].version, "0.0.15")
  eq(model.rows[2].kind, "same")
  eq(model.rows[2].class, "MAGE")
  eq(model.rows[3].who, "Tavian Holt")
  eq(model.summary.same, 3)
  is_true(a.told > 0)
  -- the announce is not sent again within half a minute
  eq(a.council.announce(), false)
  world.advance(31)
  eq(a.council.announce(), true)
end)

test("a client on another version answers an announce with its own, once a minute at most, and a newer version is told once", function()
  local world = FakeChat.new()
  local a = member(world, "Jorren Ashvale", "0.0.15", "WARRIOR")
  local b = member(world, "Mirelle Dunmore", "0.0.14", "MAGE")
  roster(b)
  world.advance(4)
  eq(sent(world, "V"), 1)
  eq(sent(world, "K"), 1) -- a answered b
  local seenByB = row(b.council.versionsModel(), "Jorren Ashvale")
  eq(seenByB.version, "0.0.15")
  eq(seenByB.kind, "newer")
  local seenByA = row(a.council.versionsModel(), "Mirelle Dunmore")
  eq(seenByA.version, "0.0.14")
  eq(seenByA.kind, "older")
  eq(count(b, "Jorren Ashvale has Intrepid Manager 0.0.15 and you have 0.0.14. Please update."), 1)
  eq(count(a, "Please update"), 0)
  -- b announces again after half a minute: a has answered b a moment ago, so it stays quiet; after a minute it answers again
  world.advance(31)
  eq(b.council.announce(), true)
  world.advance(2)
  eq(sent(world, "K"), 1)
  world.advance(30)
  eq(b.council.announce(), true)
  world.advance(2)
  eq(sent(world, "K"), 2)
  eq(count(b, "Please update"), 1) -- told once
end)

test("a full check asks everybody: the group is listed, silent members wait and then count as not installed, the offline show as offline", function()
  local world = FakeChat.new()
  local a = member(world, "Jorren Ashvale", "0.0.15", "WARRIOR")
  local b = member(world, "Mirelle Dunmore", "0.0.15", "MAGE")
  member(world, "Tavian Holt", "0.0.13", "PRIEST")
  bare(world, "Kessa Drummond", "HUNTER")
  bare(world, "Brannoch Veil", "ROGUE").joined.connected = false
  -- before a check nothing is known
  local before = a.council.versionsModel()
  eq(before.checked, false)
  eq(#before.rows, 5)
  eq(row(before, "Mirelle Dunmore").status, "unchecked")
  eq(row(before, "Brannoch Veil").status, "offline")
  -- the check
  eq(a.council.checkVersions(), true)
  local waiting = a.council.versionsModel()
  eq(waiting.checked, true)
  eq(waiting.waiting, true)
  eq(row(waiting, "Mirelle Dunmore").status, "waiting")
  world.advance(1)
  local model = a.council.versionsModel()
  eq(sent(world, "Q"), 1)
  eq(sent(world, "K"), 2) -- b and c answered
  eq(row(model, "Mirelle Dunmore").kind, "same")
  eq(row(model, "Tavian Holt").version, "0.0.13")
  eq(row(model, "Tavian Holt").kind, "older")
  eq(row(model, "Kessa Drummond").status, "waiting")
  eq(row(model, "Kessa Drummond").class, "HUNTER")
  eq(model.waiting, true)
  world.advance(5)
  model = a.council.versionsModel()
  eq(model.waiting, false)
  eq(row(model, "Kessa Drummond").status, "missing")
  eq(row(model, "Brannoch Veil").status, "offline")
  deep_eq(model.summary, { same = 2, older = 1, newer = 0, other = 0, waiting = 0, missing = 1, offline = 1, unchecked = 0 })
  eq(model.rows[1].me, true)
  deep_eq({ model.rows[2].who, model.rows[3].who, model.rows[4].who, model.rows[5].who },
    { "Brannoch Veil", "Kessa Drummond", "Mirelle Dunmore", "Tavian Holt" })
  eq(a.told > 0, true)
  eq(b.council.versionsModel().checked, false) -- only the one who asked has a check
end)

test("a new check forgets the earlier answers, so a client that no longer answers shows as not installed", function()
  local silent = false
  local world = FakeChat.new({ drop = function(delivery) return silent and delivery.from == "Mirelle Dunmore" end })
  local a = member(world, "Jorren Ashvale", "0.0.15", "WARRIOR")
  member(world, "Mirelle Dunmore", "0.0.15", "MAGE")
  a.council.checkVersions()
  world.advance(2)
  eq(row(a.council.versionsModel(), "Mirelle Dunmore").status, "ok")
  silent = true -- the addon of the other player stopped answering (switched off, or a reload that is still going on)
  a.council.checkVersions()
  eq(row(a.council.versionsModel(), "Mirelle Dunmore").status, "waiting") -- the old answer is gone at once
  world.advance(6)
  eq(row(a.council.versionsModel(), "Mirelle Dunmore").status, "missing")
end)

test("leaving the group forgets the versions heard; a check outside a group says so; coming back starts fresh", function()
  local world = FakeChat.new()
  local a = member(world, "Jorren Ashvale", "0.0.15", "WARRIOR")
  member(world, "Mirelle Dunmore", "0.0.14", "MAGE")
  roster(a)
  a.council.checkVersions()
  world.advance(2)
  eq(row(a.council.versionsModel(), "Mirelle Dunmore").version, "0.0.14")
  a.joined.inGroup = false
  roster(a)
  eq(#a.council.versionsModel().rows, 1) -- only the player
  eq(a.council.checkVersions(), false)
  is_true(said(a, "join a group first. The version check goes to the group chat."))
  a.joined.inGroup = true
  roster(a)
  local again = a.council.versionsModel()
  eq(again.checked, false)
  eq(row(again, "Mirelle Dunmore").status, "unchecked")
end)

test("a boss fight holds the announce back until it is over and refuses the check", function()
  local world = FakeChat.new()
  local a = member(world, "Jorren Ashvale", "0.0.15", "WARRIOR")
  member(world, "Mirelle Dunmore", "0.0.15", "MAGE")
  a.joined.encounter = true
  roster(a)
  world.advance(4)
  eq(world.sends, 0)
  eq(a.council.checkVersions(), false)
  is_true(said(a, "a boss fight is on: the game blocks addon messages until it ends."))
  world.advance(10)
  eq(world.sends, 0)
  a.joined.encounter = false
  world.advance(10) -- the retry comes 15 seconds after the first try
  eq(sent(world, "V"), 1)
end)

test("an announce that a boss fight held back is not sent into a group that is gone when the fight ends", function()
  local world = FakeChat.new()
  local a = member(world, "Jorren Ashvale", "0.0.15", "WARRIOR")
  member(world, "Mirelle Dunmore", "0.0.15", "MAGE")
  a.joined.encounter = true
  roster(a)
  world.advance(4)
  a.joined.inGroup = false -- the group disbands during the fight
  roster(a)
  a.joined.encounter = false
  world.advance(40)
  eq(world.sends, 0)
  eq(a.db.council.lastDrop, nil)
  eq(count(a, "could not be sent"), 0)
end)

test("the hellos of a loot session tell the loot master the versions without a check", function()
  local world = FakeChat.new()
  local a = member(world, "Jorren Ashvale", "0.0.15", "WARRIOR")
  member(world, "Mirelle Dunmore", "0.0.14", "MAGE")
  a.council.add(link(101, "Thing 101"))
  a.council.start("30")
  world.advance(2)
  local model = a.council.versionsModel()
  eq(row(model, "Mirelle Dunmore").version, "0.0.14")
  eq(row(model, "Mirelle Dunmore").kind, "older")
  eq(kinds(a), "start hello") -- the timeline of the session stays as it was: no extra line for the version
end)

test("only what our code sends counts: an announce by whisper, a hello by group chat and bad versions are ignored, a realm suffix is not a different player", function()
  local world = FakeChat.new()
  local a = member(world, "Jorren Ashvale", "0.0.15", "WARRIOR")
  member(world, "Mirelle Dunmore", "0.0.15", "MAGE")
  local function send(text, chat, from) a.game.send("CHAT_MSG_ADDON", "IMC1", text, chat, from) end
  send("V~1~9.9.9~MAGE", "WHISPER", "Mirelle Dunmore") -- an announce comes on the group chat
  send("K~1~0~9.9.9~MAGE", "PARTY", "Mirelle Dunmore") -- a hello comes by whisper
  send("K~1~0~bad version!~MAGE", "WHISPER", "Mirelle Dunmore")
  send("V~1~~MAGE", "PARTY", "Mirelle Dunmore")
  send("Q~1~", "PARTY", "Mirelle Dunmore")
  eq(row(a.council.versionsModel(), "Mirelle Dunmore").status, "unchecked")
  eq(a.council.versionsModel().summary.unchecked, 1)
  -- our own announce comes back from the group chat, with a realm: nothing is answered, nobody is noted
  send("V~1~0.0.14~WARRIOR", "PARTY", "Jorren Ashvale-Realm")
  send("Q~1~zz9", "PARTY", "Jorren Ashvale-Realm")
  world.advance(2)
  eq(world.sends, 0)
  eq(#a.db.council.log, 0)
  -- a hello from the same player with a realm is the player on the roster
  send("K~1~0~0.0.12~MAGE", "WHISPER", "Mirelle Dunmore-Realm")
  eq(row(a.council.versionsModel(), "Mirelle Dunmore").version, "0.0.12")
  -- a newer announce on the group chat is noted and told
  send("V~1~9.9.9~MAGE", "PARTY", "Mirelle Dunmore")
  eq(row(a.council.versionsModel(), "Mirelle Dunmore").kind, "newer")
  eq(count(a, "Mirelle Dunmore has Intrepid Manager 9.9.9 and you have 0.0.15. Please update."), 1)
  eq(a.db.council.errorCount, nil)
end)

test("a group that keeps sending newer versions gets three chat lines and no more", function()
  local world = FakeChat.new()
  local a = member(world, "Jorren Ashvale", "0.0.15", "WARRIOR")
  member(world, "Mirelle Dunmore", "0.0.15", "MAGE")
  for i = 1, 8 do
    a.game.send("CHAT_MSG_ADDON", "IMC1", "V~1~9.9." .. i .. "~MAGE", "PARTY", "Mirelle Dunmore")
  end
  eq(count(a, "Please update"), 3)
  eq(row(a.council.versionsModel(), "Mirelle Dunmore").version, "9.9.8") -- the window still knows the latest
  a.game.send("CHAT_MSG_ADDON", "IMC1", "V~1~9.9.1~MAGE", "PARTY", "Mirelle Dunmore")
  eq(count(a, "Please update"), 3)
end)

test("the question of a full check is answered by whisper to whoever asked, whatever the version", function()
  local world = FakeChat.new()
  member(world, "Jorren Ashvale", "0.0.15", "WARRIOR")
  local b = member(world, "Mirelle Dunmore", "0.0.15", "MAGE")
  b.council.checkVersions()
  world.advance(2)
  eq(sent(world, "K"), 1) -- a answered b's question (b does not answer itself)
  local answered
  for _, delivery in ipairs(world.delivered) do
    if string.sub(delivery.text, 1, 1) == "K" then answered = delivery end
  end
  eq(answered.chat, "WHISPER")
  eq(answered.to, "Mirelle Dunmore")
  is_true(string.match(answered.text, "^K~1~c%d+~0%.0%.15~WARRIOR$") ~= nil)
end)

test("without a window /im versions asks and prints the answers after the wait; with a window the window is opened instead", function()
  local world = FakeChat.new()
  local a = member(world, "Jorren Ashvale", "0.0.15", "WARRIOR")
  member(world, "Mirelle Dunmore", "0.0.14", "MAGE")
  bare(world, "Kessa Drummond", "HUNTER")
  a.council.versions()
  world.advance(3)
  eq(count(a, "Mirelle Dunmore: 0.0.14, older"), 0) -- not before the wait is over
  world.advance(3)
  is_true(said(a, "Session: Jorren Ashvale: 0.0.15 (you)"))
  is_true(said(a, "Session: Mirelle Dunmore: 0.0.14, older"))
  is_true(said(a, "Session: Kessa Drummond: not installed"))
  local opened = 0
  a.council.hooks.onVersionsOpen = function() opened = opened + 1 end
  local lines = #a.said
  a.council.versions()
  world.advance(7)
  eq(opened, 1)
  eq(#a.said, lines)
end)

test("the record has the versions heard and the steps, and no names; the timeline keeps room for sessions", function()
  local world = FakeChat.new()
  local a = member(world, "Jorren Ashvale", "0.0.15", "WARRIOR")
  member(world, "Mirelle Dunmore", "0.0.14", "MAGE")
  roster(a)
  world.advance(4)
  a.council.checkVersions()
  world.advance(2)
  eq(kinds(a), "announce version check version")
  for i = 1, 60 do
    a.game.send("CHAT_MSG_ADDON", "IMC1", "V~1~0.0.15~MAGE", "PARTY", "Raider" .. i)
  end
  local versions = 0
  for _, entry in ipairs(a.db.council.log) do
    if entry.e == "version" then versions = versions + 1 end
  end
  eq(versions, 40) -- the cap
  is_true(#a.db.council.log < 100)
  local text = dump(a.db)
  for _, name in ipairs({ "Jorren", "Ashvale", "Mirelle", "Dunmore", "Raider" }) do eq(string.find(text, name, 1, true), nil) end
  eq(a.db.council.errorCount, nil)
end)
