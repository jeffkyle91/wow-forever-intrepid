-- /im session, /im respond, /im offers (IntrepidManager/game/CouncilSession.lua): two stand-in games exchange the messages through the
-- fake server (tests/support/fake_chat.lua). Invented names and items only.

local UI = dofile("tests/support/strict_ui.lua")
local FakeChat = dofile("tests/support/fake_chat.lua")
local FakeTrade = dofile("tests/support/fake_trade.lua")

local function link(id, name) return "|cffa335ee|Hitem:" .. id .. "::::::::70:::::|h[" .. name .. "]|h|r" end

-- One client: a stand-in game joined to the world, with the session code loaded. extra(env) may add game functions.
local function client(world, name, extra)
  local game = UI.new()
  local joined = world.join(game, name)
  local env = game.env
  env.C_Item = {
    GetItemInfo = function(item)
      local id = tonumber(string.match(item, "item:(%d+)"))
      return "Thing " .. id, link(id, "Thing " .. id)
    end,
  }
  if extra then extra(env, game) end
  local ns = {}
  load_core(ns, "Names", "Council", "Version")
  if world.exchange then load_core(ns, "Crc32", "Json", "Envelope", "Ids", "Check", "Night", "Awards") end
  game.load("IntrepidManager/net/CouncilWire.lua", ns)
  game.load("IntrepidManager/net/Outbox.lua", ns)
  game.load("IntrepidManager/game/Bags.lua", ns)
  game.load("IntrepidManager/game/Trade.lua", ns)
  if world.exchange then game.load("IntrepidManager/game/Exchange.lua", ns) end
  game.load("IntrepidManager/game/CouncilSession.lua", ns)
  local mine = { game = game, joined = joined, db = {}, said = {}, events = {} }
  if world.exchange == true then
    mine.exchange = ns.Game.Exchange.new({
      db = mine.db, version = "0.0.10", now = function() return 1796867000 + math.floor(game.clock) end,
      dateOf = function() return "2026-12-09" end, sessionOpen = function() return mine.council.sessionOpen() end,
    })
  elseif type(world.exchange) == "table" then
    mine.exchange = world.exchange
  end
  mine.ns = ns
  mine.council = ns.Game.CouncilSession.new({
    out = function(text) mine.said[#mine.said + 1] = text end, db = mine.db, version = "0.0.10", sid = name == "Jorren Ashvale" and "ml" or "rd",
    exchange = name == "Jorren Ashvale" and mine.exchange or nil, sourceOf = name == "Jorren Ashvale" and world.sourceOf or nil,
  })
  for _, hook in ipairs({ "onOffer", "onOfferChanged", "onResponse", "onEnd", "onSessionStarted", "onHello", "onQueueChanged", "onOffersClosed", "onAwarded", "onGiven" }) do
    mine.council.hooks[hook] = function(...) mine.events[#mine.events + 1] = { hook, ... } end
  end
  mine.council.listen()
  return mine
end

-- A loot master and a raider in one group.
local function pair(options)
  options = options or {}
  local world = FakeChat.new(options.world)
  world.exchange = options.exchange
  world.sourceOf = options.sourceOf
  local scene = { world = world }
  scene.master = client(world, "Jorren Ashvale", options.masterEnv)
  scene.raider = client(world, "Mirelle Dunmore")
  return scene
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

local function dump(value)
  if type(value) ~= "table" then return tostring(value) end
  local parts = {}
  for k, v in pairs(value) do parts[#parts + 1] = tostring(k) .. "=" .. dump(v) end
  return "{" .. table.concat(parts, ",") .. "}"
end

local function queue(scene, ...)
  local text = ""
  for _, id in ipairs({ ... }) do text = text .. link(id, "Thing " .. id) .. " " end
  scene.master.council.command("add " .. text)
end

test("shift-clicked links are queued in order with numbers, a bad line says what to do, and removing renumbers", function()
  local scene = pair()
  local master = scene.master
  master.council.command("add nothing here")
  is_true(said(master, "shift-click the items into the command"))
  queue(scene, 101, 102, 103)
  is_true(said(master, "queued 1. " .. link(101, "Thing 101")))
  is_true(said(master, "queued 3. " .. link(103, "Thing 103")))
  master.council.command("remove 2")
  master.council.command("list")
  is_true(said(master, "queued:"))
  is_true(said(master, "2. " .. link(103, "Thing 103")))
  master.council.command("remove 9")
  is_true(said(master, "There is no item 9."))
  master.council.command("remove")
  is_true(said(master, "use /im session remove <item number>"))
  eq(master.events[1][1], "onQueueChanged")
end)

test("starting needs items, a group, no boss fight, and an unused queue", function()
  local scene = pair()
  local master = scene.master
  master.council.command("start")
  is_true(said(master, "queue items first"))
  queue(scene, 101)
  master.joined.inGroup = false
  master.council.command("start")
  is_true(said(master, "join a group first"))
  master.joined.inGroup = true
  master.joined.encounter = true
  master.council.command("start")
  is_true(said(master, "a boss fight is on: the game blocks addon messages until it ends"))
  eq(master.council.session().state, "building")
  master.joined.encounter = false
  master.council.command("start 3")
  is_true(said(master, "The timer is 5 to 600 seconds."))
  eq(master.council.session().state, "building")
  master.council.command("start")
  eq(master.council.session().state, "running")
  master.council.command("start")
  is_true(said(master, "a session is running already"))
  master.council.command("add " .. link(555, "Thing 555"))
  is_true(said(master, "a session is running. Type /im session end first."))
end)

test("a session reaches the raider, who answers, and the loot master sees it, then the time runs out and both sides close", function()
  local scene = pair()
  local master, raider = scene.master, scene.raider
  queue(scene, 101, 102, 103)
  master.council.command("start 30")
  is_true(said(master, "started: 3 items, 30 seconds."))
  scene.world.advance(1)
  -- the raider was offered the items and said hello
  is_true(said(raider, "Jorren Ashvale offers 3 items, 30 seconds to answer."))
  is_true(said(raider, "item 1: " .. link(101, "Thing 101") .. " - answer with /im respond 1 bis, up, os or pass [note]"))
  is_true(said(raider, "item 3: " .. link(103, "Thing 103")))
  is_true(master.council.session().responders() == 0)
  raider.council.offers()
  is_true(said(raider, "item 2 of 3: " .. link(102, "Thing 102") .. " - 29 seconds left, no answer yet"))
  raider.council.respond("2 up my first one")
  is_true(said(raider, "item 2: Upgrade - my first one (sent)"))
  scene.world.advance(1)
  is_true(said(master, "Mirelle Dunmore answered Upgrade on item 2: my first one"))
  eq(master.council.session().responders(), 1)
  master.council.command("results 2")
  is_true(said(master, "item 2: " .. link(102, "Thing 102") .. " - 1 answer (BiS 0, Upgrade 1, Off-spec 0, Pass 0)"))
  is_true(said(master, "  Upgrade: Mirelle Dunmore - my first one"))
  is_true(said(master, "1 raider said hello of 2 in the group."))
  -- a changed mind counts, once
  raider.council.respond("2 bis now I want it")
  scene.world.advance(1)
  is_true(said(master, "Mirelle Dunmore changed to Best in slot on item 2: now I want it"))
  eq(master.council.session().counts(2).total, 1)
  eq(master.council.session().counts(2).b, 1)
  -- the time runs out: the loot master's session ends, the raider's offers close
  scene.world.advance(40)
  is_true(said(master, "over (time is up): 1 raider answered."))
  eq(master.council.session().state, "closed")
  is_true(said(raider, "time is up: 2 items had no answer from you.")) -- their own clock closed the offers before the loot master's end arrived
  eq(count(raider, "the loot master ended the session."), 0)
  raider.council.offers()
  is_true(said(raider, "nothing is on offer."))
  raider.council.respond("2 up")
  is_true(said(raider, "item 2 is not on offer (any more)."))
  -- the record is shapes only
  local saved = master.db.council.sessions[1]
  eq(saved.items[1], 101)
  eq(saved.items[3], 103)
  eq(saved.timer, 30)
  eq(saved.raiders, 1)
  eq(saved.hellos, 1)
  eq(saved.how, "time is up")
  for _, mine in ipairs({ master, raider }) do
    local text = dump(mine.db)
    for _, name in ipairs({ "Jorren", "Ashvale", "Mirelle", "Dunmore" }) do eq(string.find(text, name, 1, true), nil) end
  end
end)

test("the loot master ends a session early, and a raider whose time ran out is told what went unanswered", function()
  local scene = pair()
  local master, raider = scene.master, scene.raider
  queue(scene, 101, 102)
  master.council.command("start 20")
  scene.world.advance(1)
  raider.council.respond("1 pass")
  scene.world.advance(1)
  master.council.command("end")
  scene.world.advance(1)
  is_true(said(master, "over (you ended it): 1 raider answered."))
  is_true(said(raider, "the loot master ended the session."))
  master.council.command("end")
  is_true(said(master, "no session is running."))
  -- another session where the raider never answers one item
  queue(scene, 201, 202)
  master.council.command("start 10")
  scene.world.advance(1)
  raider.council.respond("1 os")
  scene.world.advance(15)
  is_true(said(raider, "time is up: 1 item had no answer from you."))
end)

test("the loot master answers for themselves in the same table, without sending anything", function()
  local scene = pair()
  local master = scene.master
  queue(scene, 101)
  master.council.command("start 20")
  is_true(said(master, "answer yourself with /im respond"))
  master.council.respond("1 bis")
  is_true(said(master, "item 1: Best in slot"))
  eq(master.council.session().counts(1).b, 1)
  master.council.command("results")
  is_true(said(master, "  Best in slot: (you)"))
  master.council.respond("1 up")
  eq(master.council.session().counts(1).u, 1)
  eq(master.council.session().counts(1).total, 1)
  scene.world.advance(25)
  is_true(said(master, "over (time is up): 1 raider answered."))
  master.council.respond("1 pass")
  is_true(said(master, "item 1 is not on offer (any more)."))
end)

test("more than ten items go out within the game's allowance and all arrive in order", function()
  local scene = pair()
  local master, raider = scene.master, scene.raider
  for i = 1, 14 do queue(scene, 300 + i) end
  master.council.command("start 120")
  scene.world.advance(1)
  eq(count(raider, "answer with /im respond"), 10) -- the burst of ten
  scene.world.advance(6)
  eq(count(raider, "answer with /im respond"), 14)
  local order = {}
  for _, line in ipairs(raider.said) do
    local n = string.match(line, "^Session: item (%d+): ")
    if n then order[#order + 1] = tonumber(n) end
  end
  deep_eq(order, { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 })
  eq(master.council.outbox().stats().throttled, 0) -- the game was never asked for too much
end)

test("messages that do not come the way our code sends them are ignored", function()
  local scene = pair()
  local master, raider = scene.master, scene.raider
  queue(scene, 101)
  master.council.command("start 60")
  scene.world.advance(1)
  local Wire = {}
  local function send(game, text, chat, from)
    game.send("CHAT_MSG_ADDON", "IMC1", text, chat, from)
  end
  -- an answer by group chat, an answer to another session, an answer after a bad code: nothing counts
  send(master.game, "R~1~ml1~1~u~~~sneaky", "RAID", "Mirelle Dunmore")
  send(master.game, "R~1~zzzz~1~u~~~other session", "WHISPER", "Mirelle Dunmore")
  send(master.game, "R~1~ml1~1~q~~~bad code", "WHISPER", "Mirelle Dunmore")
  send(master.game, "R~1~ml1~9~u~~~no such item", "WHISPER", "Mirelle Dunmore")
  send(master.game, "R~2~ml1~1~u~~~other version", "WHISPER", "Mirelle Dunmore")
  eq(master.council.session().responders(), 0)
  -- an offer by whisper is not an offer; a hello by group chat is not a hello
  send(raider.game, "I~1~evil1~1~1~60~1~item:999~x", "WHISPER", "Tavian Holt")
  eq(#raider.council.offerList().list(), 1) -- only the real one
  send(master.game, "K~1~ml1~9.9.9", "PARTY", "Tavian Holt")
  master.council.command("results")
  is_true(said(master, "0 raiders said hello of 2 in the group.") or said(master, "1 raider said hello of 2 in the group."))
  eq(Wire.x, nil)
  -- nothing broke, and a proper answer still counts
  raider.council.respond("1 up")
  scene.world.advance(1)
  eq(master.council.session().responders(), 1)
  eq(master.db.council.errorCount, nil)
end)

test("a hostile or broken message in the handler is counted and never shown", function()
  local scene = pair()
  local master = scene.master
  master.game.env.GetTime = function() error("clock trouble") end
  master.game.send("CHAT_MSG_ADDON", "IMC1", "I~1~evil1~1~1~60~1~item:999~x", "PARTY", "Tavian Holt")
  eq(master.db.council.errorCount, 1)
  is_true(string.find(master.db.council.lastError, "clock trouble", 1, true) ~= nil)
  eq(#master.said, 0)
  master.game.send("CHAT_MSG_ADDON", "Other", "anything", "PARTY", "Tavian Holt")
  master.game.send("CHAT_MSG_ADDON", "IMC1", 42, "PARTY", "Tavian Holt")
  eq(master.db.council.errorCount, 1)
end)

test("the bags can be listed and queued by number, and 'all' takes the items with a trade time", function()
  local bags = { [0] = {
    [1] = { id = 401, name = "Crown of the Fallen", quality = 4, bound = true, trade = "3 |4hour:hrs; 59 min" },
    [2] = { id = 402, name = "Sturdy Boots", quality = 3, bound = false },
    [3] = { id = 403, name = "Ring of Ash", quality = 4, bound = true, trade = "20 min" },
  } }
  local scene = pair({ masterEnv = function(env)
    env.C_Container = {
      GetContainerNumSlots = function(bag) return bags[bag] and 4 or 0 end,
      GetContainerItemInfo = function(bag, slot)
        local entry = bags[bag] and bags[bag][slot]
        if not entry then return nil end
        return { hyperlink = link(entry.id, entry.name), itemID = entry.id, quality = entry.quality, isBound = entry.bound }
      end,
    }
    env.C_TooltipInfo = { GetBagItem = function(bag, slot)
      local entry = bags[bag] and bags[bag][slot]
      if not entry then return nil end
      local lines = {}
      if entry.trade then lines[1] = { leftText = "You may trade this item with players that were also eligible to loot this item for the next " .. entry.trade .. " (including time offline)." } end
      return { lines = lines }
    end }
  end })
  local master = scene.master
  master.council.command("bag 1")
  is_true(said(master, "list the bags first"))
  master.council.command("bags")
  is_true(said(master, "1. bag 0 slot 3: " .. link(403, "Thing 403") ~= nil and "1. bag 0 slot 3: " .. link(403, "Ring of Ash") .. " (Epic), 20 min left to trade"))
  is_true(said(master, "2. bag 0 slot 1: " .. link(401, "Crown of the Fallen") .. " (Epic), 3 h 59 min left to trade"))
  is_true(said(master, "3. bag 0 slot 2: " .. link(402, "Sturdy Boots") .. " (Rare), not bound"))
  master.council.command("bag 3 9")
  is_true(said(master, "there is no item 9 in the list."))
  is_true(said(master, "queued 1. "))
  master.council.command("bag all")
  eq(master.council.session().count(), 3) -- the boots, then the two with a trade time
  master.council.command("bag")
  is_true(said(master, "no item chosen"))
  eq(master.council.session().items()[1].item, "item:402::::::::70")
end)

test("a bag list with nothing to offer says so", function()
  local scene = pair({ masterEnv = function(env)
    env.C_Container = { GetContainerNumSlots = function() return 0 end, GetContainerItemInfo = function() return nil end }
    env.C_TooltipInfo = { GetBagItem = function() return nil end }
  end })
  scene.master.council.command("bags")
  is_true(said(scene.master, "no items in your bags can be offered"))
end)

test("respond and offers say what to do when the words are wrong or nothing is on offer", function()
  local scene = pair()
  local raider = scene.raider
  raider.council.respond("")
  is_true(said(raider, "use /im respond <item number> <bis, up, os or pass> [note]"))
  raider.council.respond("1 greed")
  is_true(said(raider, "answer with bis, up, os or pass."))
  raider.council.respond("1 up")
  is_true(said(raider, "item 1 is not on offer (any more)."))
  raider.council.offers()
  is_true(said(raider, "nothing is on offer."))
  raider.council.command("whatever")
  is_true(said(raider, "no session. Commands: add [item], bags, bag <numbers>, list, remove <n>, start [seconds], results [n], end, new. Then /im award <n> <name> and /im trade <name>."))
end)

test("the windows hear about the queue, the offers, the answers and the end through their hooks", function()
  local scene = pair()
  local master, raider = scene.master, scene.raider
  queue(scene, 101)
  master.council.command("start 20")
  scene.world.advance(1)
  raider.council.respond("1 up")
  scene.world.advance(1)
  master.council.command("end")
  scene.world.advance(1)
  local names = {}
  for _, event in ipairs(master.events) do names[#names + 1] = event[1] end
  is_true(dump(names):find("onSessionStarted", 1, true) ~= nil)
  is_true(dump(names):find("onResponse", 1, true) ~= nil)
  is_true(dump(names):find("onHello", 1, true) ~= nil)
  is_true(dump(names):find("onEnd", 1, true) ~= nil)
  local offered = {}
  for _, event in ipairs(raider.events) do offered[#offered + 1] = event[1] end
  is_true(dump(offered):find("onOffer", 1, true) ~= nil)
  is_true(dump(offered):find("onOfferChanged", 1, true) ~= nil)
  -- a hook that raises does not stop anything
  master.council.hooks.onQueueChanged = function() error("window trouble") end
  queue(scene, 105)
  is_true(said(master, "queued 1. " .. link(105, "Thing 105")))
end)

test("the game refusing the prefix stops a session before it starts, and a refused message is told and counted", function()
  local scene = pair()
  local master = scene.master
  queue(scene, 101)
  master.joined.encounter = false
  master.game.env.C_ChatInfo.SendAddonMessage = function() return 5 end -- NotInGroup
  master.council.command("start")
  is_true(said(master, "a message could not be sent (NotInGroup)"))
  eq(master.db.council.dropped, 1)
  eq(master.db.council.lastDrop, "NotInGroup")
end)

test("the record keeps a timeline of the session on each side: when, what, which item, the answer or a count, and no names", function()
  local scene = pair()
  local master, raider = scene.master, scene.raider
  queue(scene, 101, 102)
  master.council.command("start 30")
  scene.world.advance(1)
  raider.council.respond("2 up")
  scene.world.advance(1)
  master.council.command("end")
  scene.world.advance(1)
  local function kinds(mine)
    local list = {}
    for _, row in ipairs(mine.db.council.log) do list[#list + 1] = row.e end
    return table.concat(list, " ")
  end
  eq(kinds(master), "start hello got end") -- (its own end coming back is not logged)
  eq(kinds(raider), "offer hello-sent offer answer ended") -- (the hello goes out with the first offer)
  local log = master.db.council.log
  eq(log[1].n, 2) -- the start: two items
  eq(log[1].c, 30) -- and the timer
  eq(log[2].c, nil) -- the hello of a client that told no class
  eq(log[3].n, 2)
  eq(log[3].c, "u")
  is_true(log[3].t > log[1].t)
  local text = dump(master.db) .. dump(raider.db)
  for _, name in ipairs({ "Jorren", "Ashvale", "Mirelle", "Dunmore" }) do eq(string.find(text, name, 1, true), nil) end
  -- limited, like the rest
  for _ = 1, 450 do master.game.send("CHAT_MSG_ADDON", "IMC1", "K~1~ml1~0.0.12~MAGE", "WHISPER", "Someone Else") end
  eq(#master.db.council.log, 400)
end)

local function count_events(mine, name)
  local n = 0
  for _, event in ipairs(mine.events) do
    if event[1] == name then n = n + 1 end
  end
  return n
end

test("when every offer is over the windows are told once: the loot master ending it, the end arriving, or the time running out", function()
  local scene = pair()
  local master, raider = scene.master, scene.raider
  queue(scene, 101, 102)
  master.council.command("start 20")
  scene.world.advance(1)
  eq(count_events(raider, "onOffersClosed"), 0)
  eq(count_events(master, "onOffersClosed"), 0)
  master.council.command("end")
  eq(count_events(master, "onOffersClosed"), 1) -- the loot master's own offers
  scene.world.advance(1)
  eq(count_events(raider, "onOffersClosed"), 1) -- the end came by the group chat
  eq(master.council.openOffers(), 0)
  eq(raider.council.openOffers(), 0)
  -- the time running out on the raider's own clock, before any end arrives
  local second = pair()
  queue(second, 201)
  second.master.council.command("start 10")
  second.world.advance(1)
  eq(second.raider.council.openOffers(), 1)
  second.world.advance(11)
  eq(count_events(second.raider, "onOffersClosed"), 1)
  second.world.advance(10) -- the loot master's end arrives later: nothing more is told
  eq(count_events(second.raider, "onOffersClosed"), 1)
end)

test("an offer of another session still open keeps the windows open", function()
  local scene = pair()
  local raider = scene.raider
  raider.game.send("CHAT_MSG_ADDON", "IMC1", "I~1~aaa1~1~1~600~4~item:5~First", "PARTY", "Tavian Holt")
  raider.game.send("CHAT_MSG_ADDON", "IMC1", "I~1~bbb1~1~1~10~4~item:6~Second", "PARTY", "Orla Finch")
  eq(raider.council.openOffers(), 2)
  raider.game.send("CHAT_MSG_ADDON", "IMC1", "X~1~bbb1", "PARTY", "Orla Finch")
  eq(raider.council.openOffers(), 1)
  eq(count_events(raider, "onOffersClosed"), 0)
  raider.game.send("CHAT_MSG_ADDON", "IMC1", "X~1~aaa1", "PARTY", "Tavian Holt")
  eq(count_events(raider, "onOffersClosed"), 1)
end)

test("a session can be started in ordinary combat: the messages go out and the raider is offered the items", function()
  local scene = pair()
  local master, raider = scene.master, scene.raider
  queue(scene, 101, 102)
  master.joined.combat = true
  raider.joined.combat = true
  master.council.command("start 30")
  eq(master.council.session().state, "running")
  scene.world.advance(1)
  is_true(said(raider, "Jorren Ashvale offers 2 items, 30 seconds to answer."))
  raider.council.respond("1 up")
  scene.world.advance(1)
  eq(master.council.session().responders(), 1)
  master.council.command("end")
  is_true(said(master, "over (you ended it): 1 raider answered."))
end)

-- A loot master who has the epics of the given item ids (default 101) in the bag, a fake trade window, and a raider in the group
-- (the unit party1, or raid2 in a raid), with a running session of those items.
local function tradingPair(options)
  options = options or {}
  local ids = options.ids or { 101 }
  local bags = { [0] = {} }
  for i, id in ipairs(ids) do bags[0][i + 1] = { id = id, name = "Thing " .. id } end
  local trade = {}
  local scene = pair({ exchange = options.exchange, masterEnv = function(env, game)
    trade.world = FakeTrade.install(game, { bags = bags, opens = options.opens })
    env.UnitExists = function(unit) return unit == "party1" or unit == "raid2" or unit == "target" end
    env.GetUnitName = function(unit)
      if unit == "party1" or unit == "raid2" or unit == "target" then return "Mirelle Dunmore" end
    end
  end })
  scene.trade = trade.world
  queue(scene, unpack(ids))
  scene.master.council.command("start 60")
  return scene
end

local function pickups(scene)
  local list = {}
  for _, call in ipairs(scene.trade.calls) do
    if call[1] == "pickup" then list[#list + 1] = call[3] end
  end
  return list
end

test("the loot master awards an item, then trades with the winner: the window opens, the item goes in, and once the trade is complete the item is given", function()
  local scene = tradingPair()
  local master = scene.master
  master.council.award(1, "Mirelle Dunmore")
  is_true(said(master, "item 1 (" .. link(101, "Thing 101") .. ") is awarded to Mirelle Dunmore. Press Trade next to their name, or type /im trade Mirelle Dunmore."))
  eq(master.council.session().items()[1].winner, "Mirelle Dunmore")
  eq(master.council.session().items()[1].given, nil)
  eq(count_events(master, "onAwarded"), 1)
  eq(#scene.trade.calls, 0) -- awarding trades nothing
  master.council.trade("Mirelle Dunmore")
  deep_eq(scene.trade.calls[1], { "initiate", "party1" })
  scene.world.advance(2)
  is_true(scene.trade.slots[1] ~= nil)
  is_true(said(master, "Mirelle Dunmore can have the item: it is in the trade window."))
  eq(master.council.session().items()[1].given, nil)
  scene.trade.accept()
  scene.world.advance(2)
  eq(master.council.session().items()[1].given, true)
  eq(master.council.masterModel().items[1].given, true)
  eq(master.council.masterModel().items[1].winner, "Mirelle Dunmore")
  eq(master.council.masterModel().pending, 0)
  eq(count_events(master, "onGiven"), 1)
  local kinds = {}
  for _, row in ipairs(master.db.council.log) do kinds[#kinds + 1] = row.e .. (row.n and (":" .. row.n) or "") end
  is_true(table.concat(kinds, " "):find("award:1", 1, true) ~= nil)
  is_true(table.concat(kinds, " "):find("given:1", 1, true) ~= nil)
  eq(master.db.tradetest.runs[1].result, "completed")
  local text = dump(master.db)
  for _, name in ipairs({ "Mirelle", "Dunmore" }) do eq(string.find(text, name, 1, true), nil) end
end)

test("only what a raider won is put into the trade with them; an item nobody won is never touched, and a raider who won nothing gets no trade", function()
  local scene = tradingPair({ ids = { 101, 102, 103 } })
  local master = scene.master
  master.council.trade("Mirelle Dunmore")
  is_true(said(master, "Mirelle Dunmore has no awarded items waiting. Award an item first: /im award <item number> <name>."))
  eq(#scene.trade.calls, 0)
  master.council.award(2, "Mirelle Dunmore")
  master.council.trade("Mirelle Dunmore")
  scene.world.advance(3)
  deep_eq(pickups(scene), { 3 }) -- the bag slot of item 102, and no other
  is_true(string.find(scene.trade.slots[1], "Hitem:102:", 1, true) ~= nil)
  eq(scene.trade.slots[2], nil)
  scene.trade.accept()
  scene.world.advance(2)
  deep_eq({ master.council.session().items()[1].given, master.council.session().items()[2].given, master.council.session().items()[3].given }, { nil, true, nil })
  master.council.trade("Mirelle Dunmore") -- nothing is left to give
  is_true(count(master, "has no awarded items waiting") == 2)
end)

test("everything awarded to a raider goes into one trade, in the order of the items, and only those that went through are given", function()
  local scene = tradingPair({ ids = { 101, 102, 103 } })
  local master = scene.master
  master.council.award(3, "Mirelle Dunmore")
  master.council.award(1, "Mirelle Dunmore")
  master.council.trade("Mirelle Dunmore")
  scene.world.advance(6)
  deep_eq(pickups(scene), { 2, 4 }) -- items 101 and 103
  is_true(said(master, "Mirelle Dunmore can have 2 items: they are in the trade window."))
  scene.trade.slots[2], scene.trade.slotFrom[2] = nil, nil -- the loot master takes the second one out by hand
  master.game.send("TRADE_PLAYER_ITEM_CHANGED", 2)
  scene.trade.accept()
  scene.world.advance(2)
  local items = master.council.session().items()
  deep_eq({ items[1].given, items[2].given, items[3].given }, { true, nil, nil })
  eq(items[3].winner, "Mirelle Dunmore") -- still awarded: the next trade carries it
  eq(master.council.masterModel().pending, 1)
  -- and when it is the first one that comes out, the second is the one that is given
  local other = tradingPair({ ids = { 101, 102, 103 } })
  other.master.council.award(1, "Mirelle Dunmore")
  other.master.council.award(3, "Mirelle Dunmore")
  other.master.council.trade("Mirelle Dunmore")
  other.world.advance(6)
  other.trade.slots[1], other.trade.slotFrom[1] = nil, nil
  other.master.game.send("TRADE_PLAYER_ITEM_CHANGED", 1)
  other.trade.accept()
  other.world.advance(2)
  local later = other.master.council.session().items()
  deep_eq({ later[1].given, later[2].given, later[3].given }, { nil, nil, true })
end)

test("a name is matched without regard to case and spaces, in a raid too; a name that is not in the group, or no name, awards nothing", function()
  local scene = tradingPair()
  local master = scene.master
  master.council.award(1, "  mirelle   DUNMORE ")
  eq(master.council.session().items()[1].winner, "Mirelle Dunmore") -- the game's spelling
  master.council.trade("MIRELLE dunmore")
  deep_eq(scene.trade.calls[1], { "initiate", "party1" })
  scene.world.advance(5)
  scene.trade.cancel()
  scene.world.advance(2)
  master.council.award(1, "Nobody Here")
  is_true(said(master, "Nobody Here is not in your group and has not answered: there is nobody to award item 1 to."))
  eq(master.council.session().items()[1].winner, "Mirelle Dunmore") -- unchanged
  master.council.award(1, "")
  is_true(said(master, " is not in your group and has not answered: there is nobody to award item 1 to."))
  local raid = tradingPair()
  raid.master.joined.raid = true
  raid.master.council.award(1, "Mirelle Dunmore")
  raid.master.council.trade("Mirelle Dunmore")
  deep_eq(raid.trade.calls[1], { "initiate", "raid2" })
end)

test("an award can be changed or taken back until the item is given; a given item is final", function()
  local scene = tradingPair()
  local master = scene.master
  master.council.award(1, "Mirelle Dunmore")
  master.council.unaward(1)
  is_true(said(master, "item 1 is not awarded to Mirelle Dunmore any more."))
  eq(master.council.session().items()[1].winner, nil)
  eq(count_events(master, "onAwarded"), 2)
  master.council.trade("Mirelle Dunmore")
  is_true(said(master, "has no awarded items waiting"))
  master.council.unaward(1)
  is_true(said(master, "item 1 is not awarded to anybody."))
  master.council.award(1, "(you)") -- the loot master keeps it ...
  master.council.award(1, "Mirelle Dunmore") -- ... no, the raider gets it
  eq(master.council.session().items()[1].winner, "Mirelle Dunmore")
  master.council.trade("Mirelle Dunmore")
  scene.world.advance(2)
  scene.trade.accept()
  scene.world.advance(2)
  master.council.award(1, "(you)")
  is_true(said(master, "Item 1 was given already."))
  master.council.unaward(1)
  is_true(said(master, "Item 1 was given already."))
  eq(master.council.session().items()[1].winner, "Mirelle Dunmore")
end)

test("the answer of a raider sets the spelling of the winner; a winner who did not answer gets a row of their own", function()
  local scene = tradingPair({ ids = { 101, 102 } })
  local master, raider = scene.master, scene.raider
  scene.world.advance(1) -- the offer arrives
  raider.council.respond("1 up")
  scene.world.advance(1) -- and the answer
  master.council.award(1, "mirelle dunmore")
  local rows = master.council.rowsModel(1)
  eq(#rows, 1)
  deep_eq({ rows[1].who, rows[1].winner, rows[1].given, rows[1].label }, { "Mirelle Dunmore", true, nil, "Upgrade" })
  master.council.award(2, "Mirelle Dunmore") -- she did not answer item 2
  rows = master.council.rowsModel(2)
  eq(#rows, 1)
  deep_eq({ rows[1].who, rows[1].winner, rows[1].label, rows[1].code }, { "Mirelle Dunmore", true, "No answer", nil })
  master.council.unaward(2)
  eq(#master.council.rowsModel(2), 0)
end)

test("the loot master can keep an item: it is awarded under their own name and marked as given without a trade", function()
  local scene = pair()
  local master = scene.master
  queue(scene, 101)
  master.council.command("start 60")
  master.council.award(1, "Jorren Ashvale") -- their own name, as the game spells it
  eq(master.council.session().items()[1].winner, "(you)")
  is_true(said(master, "item 1 (" .. link(101, "Thing 101") .. ") is awarded to (you). Press Trade next to your name when you have it."))
  master.council.trade("(you)")
  is_true(said(master, "1 item stays with you: marked as given."))
  eq(master.council.session().items()[1].given, true)
  eq(count_events(master, "onGiven"), 1)
end)

test("nothing is awarded before the session starts, and there is nothing to award or trade without a session or with an item that is not there", function()
  local scene = pair()
  scene.master.council.award(1, "Mirelle Dunmore")
  is_true(said(scene.master, "there is no session to award from."))
  scene.master.council.trade("Mirelle Dunmore")
  is_true(said(scene.master, "there is no session to give items from."))
  queue(scene, 101)
  scene.master.council.award(1, "Mirelle Dunmore")
  is_true(said(scene.master, "Start the session first."))
  scene.master.council.command("start 60")
  scene.master.council.award(5, "Mirelle Dunmore")
  is_true(said(scene.master, "there is no item 5."))
  scene.master.council.unaward(5)
  is_true(said(scene.master, "there is no item 5."))
end)

test("the chat commands: /im award with a number and a name, clear, and the list; /im trade with a name, stop, and the list", function()
  local scene = tradingPair({ ids = { 101, 102 } })
  local master = scene.master
  master.council.awardCommand("")
  is_true(said(master, "nothing is awarded yet."))
  master.council.awardCommand("1")
  is_true(said(master, "use /im award <item number> <name>"))
  master.council.awardCommand("banana split")
  is_true(said(master, "use /im award <item number> <name>"))
  master.council.awardCommand("clear")
  is_true(said(master, "use /im award clear <item number>"))
  master.council.awardCommand("1 Mirelle Dunmore")
  eq(master.council.session().items()[1].winner, "Mirelle Dunmore")
  master.council.awardCommand("")
  is_true(said(master, "1. " .. link(101, "Thing 101") .. " - awarded to Mirelle Dunmore"))
  master.council.awardCommand("clear 1")
  eq(master.council.session().items()[1].winner, nil)
  master.council.awardCommand("2 Mirelle Dunmore")
  master.council.tradeCommand("")
  is_true(said(master, "2. " .. link(102, "Thing 102") .. " - awarded to Mirelle Dunmore"))
  master.council.tradeCommand("1 Mirelle Dunmore")
  is_true(said(master, "items are traded to the player who won them. Award the item first: /im award 1 <name>, then /im trade <name>."))
  eq(#scene.trade.calls, 0)
  master.council.tradeCommand("Mirelle Dunmore")
  deep_eq(scene.trade.calls[1], { "initiate", "party1" })
  master.council.tradeCommand("stop")
  is_true(said(master, "Trade: stopped."))
end)

test("New session warns before it drops awards that are not given yet, and the items cannot be queued over them", function()
  local scene = tradingPair({ ids = { 101, 102 } })
  local master = scene.master
  master.council.award(1, "Mirelle Dunmore")
  master.council.award(2, "Mirelle Dunmore")
  master.council.command("end")
  eq(master.council.masterModel().state, "closed")
  eq(master.council.masterModel().pending, 2)
  master.council.add(link(555, "Thing 555"))
  is_true(said(master, "2 awarded items are not given yet. Trade them first, or type /im session new twice to drop them."))
  master.council.reset()
  is_true(said(master, "2 awarded items are not given yet. Press New session again to drop them."))
  eq(master.council.session().state, "closed") -- still there
  is_true(master.council.masterModel().notice ~= nil)
  scene.world.advance(11) -- the warning has run out
  eq(master.council.masterModel().notice, nil)
  master.council.reset()
  eq(master.council.session().state, "closed")
  master.council.reset() -- a second press in time
  eq(master.council.session(), nil)
  eq(master.council.masterModel().state, "none")
end)

test("New session drops a session with nothing waiting at once", function()
  local scene = tradingPair()
  local master = scene.master
  master.council.command("end")
  master.council.reset()
  eq(master.council.session(), nil)
  local other = tradingPair()
  other.master.council.award(1, "Mirelle Dunmore")
  other.master.council.command("end")
  other.master.council.trade("Mirelle Dunmore")
  other.world.advance(2)
  other.trade.accept()
  other.world.advance(2)
  other.master.council.reset() -- given: nothing to lose
  eq(other.master.council.session(), nil)
end)

test("every award, take-back and delivery of a session is recorded for the Raid Desk, with ids from the session", function()
  local scene = tradingPair({ exchange = true, ids = { 101, 102, 103 } })
  local master = scene.master
  master.council.award(1, "Mirelle Dunmore")
  master.council.award(2, "Mirelle Dunmore")
  local log = master.exchange.log()
  eq(#log, 2)
  eq(log[1].to, "Mirelle Dunmore")
  eq(log[1].itemId, 101)
  eq(log[1].item, "Thing 101")
  deep_eq(log[1].delivery, { state = "assigned" })
  eq(log[1].decision, "council")
  is_true(log[1].id:match("^s%-%w+%-%w%w%w%w%-1$") ~= nil)
  eq(log[2].session, log[1].session)
  -- taking one back removes it, awarding it to somebody else makes a new award
  master.council.unaward(2)
  eq(log[2].status, "removed")
  master.council.award(3, "Mirelle Dunmore")
  eq(#master.exchange.log(), 3)
  -- the trade
  master.council.trade("Mirelle Dunmore")
  scene.world.advance(6)
  scene.trade.accept()
  scene.world.advance(2)
  eq(log[1].delivery.state, "received")
  eq(log[1].delivery.how, "trade")
  eq(log[3].delivery.state, "received")
  eq(log[2].status, "removed")
  eq(log[2].delivery.state, "assigned") -- a removed award is not delivered
  local vm = master.exchange.exportModel(true)
  eq(vm.count, 3)
  eq(master.exchange.verify(vm.text), 3)
end)

test("the loot master's own items and the pseudo recipients are recorded under their labels and marked given by hand", function()
  local scene = pair({ exchange = true })
  local master = scene.master
  queue(scene, 101, 102)
  master.council.command("start 60")
  master.council.award(1, "Jorren Ashvale")
  master.council.award(2, "Guild Bank")
  local log = master.exchange.log()
  eq(log[1].to, "Jorren Ashvale")
  eq(log[2].pseudo, "guild-bank")
  eq(log[2].to, "Guild bank")
  eq(master.council.session().items()[2].winner, "Guild bank")
  master.council.trade("(you)")
  master.council.trade("guild bank")
  is_true(said(master, "1 item stays with you: marked as given."))
  is_true(said(master, "1 item is marked as given to Guild bank: you hand it over yourself."))
  eq(log[1].delivery.how, "manual")
  eq(log[2].delivery.how, "manual")
  eq(master.council.masterModel().pending, 0)
  eq(master.council.session().items()[2].given, true)
end)

test("a session that cannot reach the exchange goes on, and says nothing to the raiders", function()
  local broken = setmetatable({}, { __index = function() return function() error("boom") end end })
  local scene = pair({ exchange = broken })
  local master = scene.master
  queue(scene, 101)
  master.council.command("start 60")
  master.council.award(1, "Mirelle Dunmore")
  eq(master.council.session().items()[1].winner, "Mirelle Dunmore")
  is_true(master.db.council.exchangeErrors >= 2) -- beginSession and awarded
  is_true(string.find(master.db.council.lastExchangeError, "boom", 1, true) ~= nil)
  eq(master.db.council.errorCount, nil)
end)

test("a session knows whether it is running, for the import window", function()
  local scene = pair()
  eq(scene.master.council.sessionOpen(), false)
  queue(scene, 101)
  eq(scene.master.council.sessionOpen(), false)
  scene.master.council.command("start 60")
  eq(scene.master.council.sessionOpen(), true)
  scene.master.council.command("end")
  eq(scene.master.council.sessionOpen(), false)
end)

test("the loot master's window says where each item drops when that is known, and a failing lookup says nothing", function()
  local asked = {}
  local scene = pair({ sourceOf = function(id)
    asked[#asked + 1] = id
    if id == 101 then return "Warden of Fixtures, Hollow Test Keep" end
    if id == 102 then error("journal trouble") end
    if id == 103 then return "" end
    return nil
  end })
  queue(scene, 101, 102, 103, 104)
  local items = scene.master.council.masterModel().items
  eq(items[1].source, "Warden of Fixtures, Hollow Test Keep")
  eq(items[2].source, nil)
  eq(items[3].source, nil)
  eq(items[4].source, nil)
  deep_eq(asked, { 101, 102, 103, 104 })
end)

test("without a source lookup the window's items have no source", function()
  local scene = pair()
  queue(scene, 101)
  eq(scene.master.council.masterModel().items[1].source, nil)
end)
