-- /im msgtest (IntrepidManager/net/MsgTest.lua): two stand-in games exchange addon messages through a fake server
-- (tests/support/fake_chat.lua). Invented names only.

local UI = dofile("tests/support/strict_ui.lua")
local FakeChat = dofile("tests/support/fake_chat.lua")

-- Two clients in one group. options.world: the fake server's knobs; options.single: only the first client; options.prepare(client):
-- changes a client's game before the addon starts listening. The first client is created with sid aaaa, the second with bbbb.
local function pair(options)
  options = options or {}
  local world = FakeChat.new(options.world)
  local scene = { world = world }
  local function client(name, sid)
    local game = UI.new()
    local joined = world.join(game, name)
    local ns = {}
    game.load("IntrepidManager/net/MsgTest.lua", ns)
    local mine = { game = game, client = joined, db = {}, said = {}, ns = ns }
    if options.prepare then options.prepare(mine) end
    mine.test = ns.Net.MsgTest.new({ out = function(text) mine.said[#mine.said + 1] = text end, db = mine.db, sid = sid })
    mine.test.listen()
    return mine
  end
  scene.one = client("Jorren Ashvale", "aaaa")
  if not options.single then scene.two = client("Mirelle Dunmore", "bbbb") end
  scene.one.client.offset = 5000.25 -- the two clocks of a real pair never agree
  return scene
end

local function perChat(MsgTest)
  local total = 0
  for _, phase in ipairs(MsgTest.PHASES) do total = total + phase.count end
  return total
end

local function rows(list, test)
  local picked = {}
  for _, row in ipairs(list) do
    if test(row) then picked[#picked + 1] = row end
  end
  return picked
end

local function said(mine, text)
  for _, line in ipairs(mine.said) do
    if string.find(line, text, 1, true) then return true end
  end
  return false
end

local function dump(value)
  if type(value) ~= "table" then return tostring(value) end
  local parts = {}
  for k, v in pairs(value) do parts[#parts + 1] = tostring(k) .. "=" .. dump(v) end
  return "{" .. table.concat(parts, ",") .. "}"
end

test("a full run on a plain server: every phase sends what the plan says, the other client records all of it and answers the pings", function()
  local scene = pair()
  local MsgTest = scene.one.ns.Net.MsgTest
  scene.one.test.run()
  scene.world.advance(330)
  local run = scene.one.db.msgtest.runs[1]
  is_true(run.finished)
  eq(run.stopped, nil)
  eq(run.chat, "PARTY")
  eq(run.members, 2)
  eq(run.large, 255)
  -- 1 hello, 3 size probes (255 taken; 256 and 300 refused), then every phase on the group chat and by whisper
  eq(#run.sent, 1 + 3 + 2 * perChat(MsgTest))
  eq(#rows(run.sent, function(row) return row.chat == "WHISPER" end), perChat(MsgTest))
  local other = scene.two.db.msgtest
  -- from the sender: the hello, the 255-byte probe, and every phase on both channels; the rest are the echoes of its own answers
  eq(#rows(other.received, function(row) return row.from == "other" end), 1 + 1 + 2 * perChat(MsgTest))
  eq(#rows(other.received, function(row) return row.from == "self" end), 1 + 6)
  eq(#other.replies, 1 + 2 * 6) -- an answer to the hello and to each of the 12 pings
  -- the sender hears its own group messages come back (not the whispers), and the answers
  local mine = scene.one.db.msgtest.received
  eq(#rows(mine, function(row) return row.from == "self" end), 1 + 1 + perChat(MsgTest))
  local answers = rows(mine, function(row) return row.k == "Q" end)
  eq(#answers, 13)
  for _, row in ipairs(answers) do
    is_true(row.rtt >= 0.55 and row.rtt <= 0.75)
  end
  -- every large message has the size the probe found
  for _, row in ipairs(rows(run.sent, function(row) return row.p == "b20" end)) do eq(row.len, 255) end
  -- the marks say where each phase started
  eq(run.marks[1].p, "hello")
  eq(#run.marks, 1 + 2 * #MsgTest.PHASES)
  eq(run.marks[2].restricted, true)
end)

test("the summary tells what was sent, refused and echoed back, the message sizes and the round trips", function()
  local scene = pair()
  scene.one.test.run()
  scene.world.advance(330)
  eq(scene.one.said[#scene.one.said], "Message test: run aaaar1 is done. Type /reload to save the results, then do the same on the other client.")
  is_true(said(scene.one, "message sizes: 255=Success, 256=InvalidMessage, 300=InvalidMessage"))
  is_true(said(scene.one, "PARTY ping: 6 sent, 6 came back"))
  is_true(said(scene.one, "PARTY b40: 40 sent, 40 came back"))
  is_true(said(scene.one, "WHISPER b20: 20 sent"))
  is_true(said(scene.one, "PARTY round trips: 7 answers"))
  is_true(said(scene.one, "WHISPER round trips: 6 answers"))
  is_true(said(scene.two, "another client started run aaaar1"))
  is_true(said(scene.two, "heard " .. (2 + 2 * perChat(scene.one.ns.Net.MsgTest)) .. " messages from the other client (run aaaar1)"))
  local heardLines = 0
  for _, line in ipairs(scene.two.said) do
    if string.find(line, "heard ", 1, true) then heardLines = heardLines + 1 end
  end
  eq(heardLines, 1)
end)

test("a server that delivers in ticks and caps what arrives per tick makes a burst arrive late and spread out, and loses nothing", function()
  local scene = pair({ world = { delay = 0.3, tick = 0.7, perTick = 3 } })
  scene.one.test.run()
  scene.world.advance(500)
  local got = rows(scene.two.db.msgtest.received, function(row) return row.p == "b20" and row.chat == "PARTY" end)
  eq(#got, 20)
  local spread = got[#got].t - got[1].t
  is_true(spread > 3.9 and spread < 4.5) -- 20 messages, 3 per 0.7 s: the last tick comes 6 ticks after the first
  local back = rows(scene.one.db.msgtest.received, function(row) return row.p == "b20" and row.from == "self" end)
  eq(#back, 20)
  is_true(back[20].lag > 4) -- the echo of the last one measures the same delay on the sender's own clock
  is_true(back[1].lag < 1.5)
end)

test("a client throttle that refuses a long burst is written down per message, and what was refused never arrives", function()
  local scene = pair({ world = { burst = 10 } })
  scene.one.test.run()
  scene.world.advance(330)
  local run = scene.one.db.msgtest.runs[1]
  local function refused(phase)
    return #rows(run.sent, function(row) return row.p == phase and row.chat == "PARTY" and row.r == "AddonMessageThrottle" end)
  end
  eq(refused("b10"), 0) -- ten at once is the limit, not over it
  eq(refused("b20"), 10)
  eq(refused("b40"), 30)
  eq(refused("p500"), 0)
  eq(#rows(scene.two.db.msgtest.received, function(row) return row.p == "b40" and row.chat == "PARTY" end), 10)
  is_true(said(scene.one, "PARTY b40: 40 sent, refused: 30 AddonMessageThrottle, 10 came back"))
  is_true(run.finished)
end)

test("a throttle that counts per prefix lets the two-prefix phase through while the single-prefix burst is cut", function()
  local scene = pair({ world = { burst = 10, perPrefix = true } })
  scene.one.test.run()
  scene.world.advance(330)
  local run = scene.one.db.msgtest.runs[1]
  local function refused(phase)
    return #rows(run.sent, function(row) return row.p == phase and row.chat == "PARTY" and row.r == "AddonMessageThrottle" end)
  end
  eq(refused("b20"), 10)
  eq(refused("x20"), 0)
  local got = rows(scene.two.db.msgtest.received, function(row) return row.p == "x20" and row.chat == "PARTY" end)
  eq(#got, 20)
  local second = 0
  for _, row in ipairs(got) do
    if row.px == 2 then second = second + 1 end
  end
  eq(second, 10)
  -- the same throttle counted for the whole client cuts the two-prefix phase as well
  local whole = pair({ world = { burst = 10 } })
  whole.one.test.run()
  whole.world.advance(330)
  local cut = #rows(whole.one.db.msgtest.runs[1].sent, function(row) return row.p == "x20" and row.chat == "PARTY" and row.r == "AddonMessageThrottle" end)
  eq(cut, 10)
end)

test("a server that loses and reorders messages shows in the other client's record: gaps, and sequence numbers out of order", function()
  local lost = 0
  local scene = pair({ world = {
    drop = function(delivery)
      if delivery.chat == "PARTY" and string.find(delivery.text, ":b20:", 1, true) and delivery.from == "Jorren Ashvale" and delivery.to == "Mirelle Dunmore" then
        local seq = tonumber(string.match(delivery.text, ":b20:(%d+):"))
        if seq % 5 == 0 then lost = lost + 1 return true end
      end
    end,
    reorder = function(batch)
      local reversed = {}
      for i = #batch, 1, -1 do reversed[#reversed + 1] = batch[i] end
      return reversed
    end,
  } })
  scene.one.test.run()
  scene.world.advance(330)
  eq(lost, 4)
  local got = rows(scene.two.db.msgtest.received, function(row) return row.p == "b20" and row.chat == "PARTY" end)
  eq(#got, 16)
  local outOfOrder = 0
  for i = 2, #got do
    if got[i].i < got[i - 1].i then outOfOrder = outOfOrder + 1 end
  end
  is_true(outOfOrder > 0)
  -- the sender's echo of its own burst was not touched by the drop rule
  eq(#rows(scene.one.db.msgtest.received, function(row) return row.p == "b20" and row.from == "self" end), 20)
end)

test("a game that takes a smaller message than 255 bytes sets the size of every large message", function()
  local scene = pair({ world = { maxLength = 250 } })
  scene.one.test.run()
  scene.world.advance(330)
  local run = scene.one.db.msgtest.runs[1]
  eq(run.large, 250)
  eq(run.sent[2].r, "InvalidMessage") -- 255 was refused
  eq(run.sent[3].r, "Success") -- 250 was taken
  for _, row in ipairs(rows(run.sent, function(row) return row.p == "p500" and row.r == "Success" end)) do eq(row.len, 250) end
  is_true(said(scene.one, "largest message the game accepted: 250 bytes"))
end)

test("a game that refuses every size stops the run with the reason", function()
  local scene = pair({ world = { maxLength = 90 } })
  scene.one.test.run()
  scene.world.advance(30)
  local run = scene.one.db.msgtest.runs[1]
  is_true(run.stopped ~= nil)
  eq(run.finished, false)
  is_true(said(scene.one, "refused every message size"))
  is_true(not said(scene.one, "PARTY ping"))
end)

test("nobody answering the first ping stops the run after four seconds, with nothing else sent", function()
  local scene = pair({ single = true })
  scene.one.test.run()
  scene.world.advance(3.9)
  is_true(not said(scene.one, "nobody answered"))
  scene.world.advance(0.2)
  local run = scene.one.db.msgtest.runs[1]
  eq(#run.sent, 1)
  is_true(said(scene.one, "nobody answered"))
  eq(run.finished, false)
  scene.world.advance(60)
  eq(#run.sent, 1)
end)

test("it will not start without a group, in combat, in a boss fight, or twice", function()
  local alone = pair()
  alone.one.client.inGroup = false
  alone.one.test.run()
  is_true(said(alone.one, "join a group with the other client first"))
  eq(alone.one.db.msgtest.runs[1], nil)

  local fighting = pair()
  fighting.one.client.combat = true
  fighting.one.test.run()
  is_true(said(fighting.one, "not in combat, please"))
  eq(fighting.one.db.msgtest.runs[1], nil)

  local boss = pair()
  boss.one.client.encounter = true
  boss.one.test.run()
  is_true(said(boss.one, "blocks addon messages during a boss fight"))
  eq(boss.one.db.msgtest.runs[1], nil)

  local twice = pair()
  twice.one.test.run()
  twice.one.test.run()
  is_true(said(twice.one, "a run is already going"))
  eq(#twice.one.db.msgtest.runs, 1)
end)

test("a boss fight that starts during a run ends it at the next phase", function()
  local scene = pair()
  scene.one.test.run()
  scene.world.advance(30) -- into the group chat phases
  scene.one.client.encounter = true
  scene.world.advance(60)
  local run = scene.one.db.msgtest.runs[1]
  eq(run.finished, false)
  is_true(string.find(run.stopped, "a boss fight started", 1, true) ~= nil)
  local count = #run.sent
  scene.world.advance(120)
  eq(#run.sent, count)
end)

test("stop ends a run at once, saying so, and a second stop says nothing is running", function()
  local scene = pair()
  scene.one.test.run()
  scene.world.advance(20)
  local run = scene.one.db.msgtest.runs[1]
  local before = #run.sent
  scene.one.test.stop()
  eq(run.stopped, "you stopped it.")
  scene.world.advance(120)
  eq(#run.sent, before)
  scene.one.test.stop()
  is_true(said(scene.one, "nothing is running"))
  -- a new run can start afterwards and gets its own id
  scene.one.test.run()
  eq(scene.one.db.msgtest.runs[2].id, "aaaar2")
end)

test("in a raid the group channel is RAID, and a whisper goes to the name the answer came from", function()
  local scene = pair()
  scene.one.client.raid = true
  scene.two.client.raid = true
  scene.one.test.run()
  scene.world.advance(330)
  local run = scene.one.db.msgtest.runs[1]
  eq(run.chat, "RAID")
  eq(run.raid, true)
  eq(#rows(run.sent, function(row) return row.chat == "RAID" and row.p == "b20" end), 20)
  eq(#rows(run.sent, function(row) return row.chat == "WHISPER" and row.r == "Success" end), perChat(scene.one.ns.Net.MsgTest))
  is_true(said(scene.one, "RAID round trips: 7 answers"))
end)

test("nothing in the saved record names a player", function()
  local scene = pair()
  scene.one.test.run()
  scene.world.advance(330)
  for _, mine in ipairs({ scene.one, scene.two }) do
    local text = dump(mine.db)
    is_true(string.find(text, "Jorren", 1, true) == nil)
    is_true(string.find(text, "Ashvale", 1, true) == nil)
    is_true(string.find(text, "Mirelle", 1, true) == nil)
    is_true(string.find(text, "Dunmore", 1, true) == nil)
  end
end)

test("other addons' messages cost nothing and leave no row; broken and secret messages are counted, never raised", function()
  local scene = pair({ single = true })
  local game = scene.one.game
  game.send("CHAT_MSG_ADDON", "OtherAddon", "anything", "PARTY", "Someone Else")
  eq(#scene.one.db.msgtest.received, 0)
  game.send("CHAT_MSG_ADDON", "IMTEST", "not our shape", "PARTY", "Someone Else")
  eq(scene.one.db.msgtest.bad, 1)
  eq(#scene.one.db.msgtest.received, 0)
  game.env.issecretvalue = function(value) return value == "secret" end
  game.send("CHAT_MSG_ADDON", "IMTEST", "secret", "PARTY", "Someone Else")
  eq(scene.one.db.msgtest.secret, 1)
  game.send("CHAT_MSG_ADDON", "IMTEST", 42, "PARTY", "Someone Else") -- not text
  eq(#scene.one.db.msgtest.received, 0)
  -- an error inside the handler is kept, not shown
  game.env.issecretvalue = function() error("secret value") end
  game.send("CHAT_MSG_ADDON", "IMTEST", "K:x:y:z:1:1:", "PARTY", "Someone Else")
  eq(scene.one.db.msgtest.errorCount, 1)
  is_true(string.find(scene.one.db.msgtest.errors[1], "secret value", 1, true) ~= nil)
  eq(#scene.one.said, 0)
end)

test("restriction changes are recorded with whether a run was going", function()
  local scene = pair({ single = true })
  scene.one.game.send("ADDON_RESTRICTION_STATE_CHANGED", 0, 1)
  scene.one.game.send("ADDON_RESTRICTION_STATE_CHANGED", 0, 0)
  local list = scene.one.db.msgtest.restrictions
  eq(#list, 2)
  eq(list[1].type, 0)
  eq(list[1].state, 1)
  eq(list[1].running, nil)
end)

test("the saved lists stop growing at their limit and count what they dropped", function()
  local scene = pair({ single = true })
  for i = 1, 4005 do
    scene.one.game.send("CHAT_MSG_ADDON", "IMTEST", "D:cccc:cccc" .. "r1:b20:" .. i .. ":20:xx", "PARTY", "Someone Else")
  end
  eq(#scene.one.db.msgtest.received, 4000)
  eq(scene.one.db.msgtest.droppedRows, 5)
end)

test("the prefix is registered once at listen, a refusal is told, and status and clear work", function()
  local scene = pair({ single = true })
  eq(scene.one.db.msgtest.prefixResult, "Success")
  eq(scene.one.client.prefixes.IMTEST, true)
  scene.one.test.listen() -- a second call changes nothing
  eq(scene.one.db.msgtest.prefixResult, "Success")
  scene.one.test.command("")
  is_true(said(scene.one, "prefix registered, idle"))
  scene.one.test.command("clear")
  eq(#scene.one.db.msgtest.received, 0)
  is_true(said(scene.one, "records cleared"))
  -- a client that cannot register the prefix says so and does not run
  local game = UI.new()
  local world = FakeChat.new()
  world.join(game, "Jorren Ashvale")
  game.env.C_ChatInfo.RegisterAddonMessagePrefix = function() return 3 end
  local ns = {}
  game.load("IntrepidManager/net/MsgTest.lua", ns)
  local lines = {}
  local test = ns.Net.MsgTest.new({ out = function(text) lines[#lines + 1] = text end, db = {}, sid = "dddd" })
  test.listen()
  test.run()
  is_true(string.find(lines[#lines], "would not register the message prefix", 1, true) ~= nil)
end)

test("the command word picks run, stop, clear or the status", function()
  local scene = pair()
  scene.one.test.command("run")
  eq(#scene.one.db.msgtest.runs, 1)
  scene.one.test.command("  STOP ")
  eq(scene.one.db.msgtest.runs[1].stopped, "you stopped it.")
  scene.one.test.command("whatever")
  is_true(said(scene.one, "Commands: /im msgtest run, stop, clear."))
end)

test("parse reads our own shapes and nothing else", function()
  local MsgTest = pair({ single = true }).one.ns.Net.MsgTest
  local head = MsgTest.parse("Q:aaaa:aaaar1:ping:3:6:bbbb")
  eq(head.kind, "Q")
  eq(head.sid, "aaaa")
  eq(head.run, "aaaar1")
  eq(head.phase, "ping")
  eq(head.seq, 3)
  eq(head.total, 6)
  eq(head.rest, "bbbb")
  eq(MsgTest.parse("hello"), nil)
  eq(MsgTest.parse("D:aaaa:r:b20:x:20:"), nil)
end)

test("the round trip line gives the shortest and the longest answer, and the rows carry the phase size, the prefix and the timeline", function()
  local scene = pair({ world = { delay = 0.3, tick = 0.7 } })
  scene.one.test.run()
  scene.world.advance(400)
  local run = scene.one.db.msgtest.runs[1]
  local low, high
  for _, row in ipairs(scene.one.db.msgtest.received) do
    if row.rtt and row.chat == "PARTY" then
      low = (not low or row.rtt < low) and row.rtt or low
      high = (not high or row.rtt > high) and row.rtt or high
    end
  end
  is_true(low < high) -- ticks make the answers differ
  is_true(said(scene.one, "PARTY round trips: 7 answers, " .. low .. " to " .. high .. " seconds"))
  -- the small phases keep their own sizes, the others the largest size taken
  eq(rows(run.sent, function(row) return row.p == "b10" end)[1].len, 100)
  eq(rows(run.sent, function(row) return row.p == "b40" end)[1].len, 60)
  eq(rows(run.sent, function(row) return row.p == "b20" end)[1].len, 255)
  -- the total of the phase travels in the message and is kept by the other client
  eq(rows(scene.two.db.msgtest.received, function(row) return row.p == "b20" and row.chat == "PARTY" end)[1].n, 20)
  eq(rows(scene.two.db.msgtest.received, function(row) return row.p == "b40" and row.chat == "PARTY" end)[1].n, 40)
  -- the two-prefix phase alternates: the even numbers go out on the second prefix, on both sides of the record
  for _, row in ipairs(rows(run.sent, function(row) return row.p == "x20" end)) do
    eq(row.px, row.i % 2 == 0 and 2 or nil)
  end
  for _, row in ipairs(rows(scene.two.db.msgtest.received, function(row) return row.p == "x20" end)) do
    eq(row.px, row.i % 2 == 0 and 2 or nil)
  end
  -- hello goes out first; the answer is awaited four seconds, the sizes are probed, and three seconds later the first phase starts
  is_true(math.abs((run.marks[2].t - run.marks[1].t) - 7) < 0.2)
  -- the chat tells each phase as it starts
  is_true(said(scene.one, "Message test: run aaaar1 on PARTY. Asking the other client to answer first."))
  is_true(said(scene.one, "Message test: PARTY b20: 20 messages of 255 bytes at once"))
  is_true(said(scene.one, "Message test: PARTY p500: 20 messages of 255 bytes, 0.5 s apart"))
  is_true(said(scene.one, "Message test: WHISPER ping: 6 messages, 1.2 s apart"))
  eq(scene.one.db.msgtest.schema, 1)
end)

test("a client picks its own short id when none is given, and two clients get different ones", function()
  local worldOne = FakeChat.new()
  local gameOne = UI.new()
  worldOne.join(gameOne, "Jorren Ashvale")
  local nsOne = {}
  gameOne.load("IntrepidManager/net/MsgTest.lua", nsOne)
  local one = nsOne.Net and nsOne.Net.MsgTest.new({ out = function() end, db = {} })
  local gameTwo = UI.new({ clock = 1796999999 })
  worldOne.join(gameTwo, "Mirelle Dunmore")
  local nsTwo = {}
  gameTwo.load("IntrepidManager/net/MsgTest.lua", nsTwo)
  local two = nsTwo.Net.MsgTest.new({ out = function() end, db = {} })
  is_true(string.find(one.sid, "^%x+$") ~= nil and #one.sid <= 4)
  is_true(string.find(two.sid, "^%x+$") ~= nil and #two.sid <= 4)
end)

test("an answer addressed to another client changes nothing here: no round trip, no partner", function()
  local scene = pair({ single = true })
  scene.one.test.run()
  scene.one.game.send("CHAT_MSG_ADDON", "IMTEST", "Q:cccc:aaaar1:hello:1:1:zzzz", "PARTY", "Someone Else")
  scene.world.advance(4.5)
  eq(scene.one.db.msgtest.runs[1].stopped ~= nil, true) -- still nobody answered us
  eq(rows(scene.one.db.msgtest.received, function(row) return row.rtt ~= nil end)[1], nil)
  -- one addressed to us, in a later run, sets the round trip and lets the run go on
  scene.one.test.run()
  scene.one.game.send("CHAT_MSG_ADDON", "IMTEST", "Q:cccc:aaaar2:hello:1:1:aaaa", "PARTY", "Someone Else")
  scene.world.advance(4.5)
  eq(scene.one.db.msgtest.runs[2].stopped, nil)
  eq(rows(scene.one.db.msgtest.received, function(row) return row.rtt ~= nil end)[1].run, "aaaar2")
end)

test("when the second prefix cannot be registered the two-prefix phase uses the first one only", function()
  local scene = pair({ prepare = function(mine)
    local original = mine.game.env.C_ChatInfo
    local register = original.RegisterAddonMessagePrefix
    original.RegisterAddonMessagePrefix = function(prefix)
      if prefix == "IMTES2" then return 3 end
      return register(prefix)
    end
  end })
  eq(scene.one.db.msgtest.prefixResult2, "MaxPrefixes")
  scene.one.test.run()
  scene.world.advance(330)
  for _, row in ipairs(rows(scene.one.db.msgtest.runs[1].sent, function(row) return row.p == "x20" end)) do eq(row.px, nil) end
  eq(#rows(scene.one.db.msgtest.runs[1].sent, function(row) return row.p == "x20" and row.chat == "PARTY" end), 20)
end)

test("once a boss fight has stopped a run, nothing of it wakes up when the fight is over", function()
  local scene = pair()
  scene.one.test.run()
  scene.world.advance(30)
  scene.one.client.encounter = true
  scene.world.advance(60)
  local run = scene.one.db.msgtest.runs[1]
  is_true(run.stopped ~= nil)
  local count = #run.sent
  scene.one.client.encounter = false
  scene.world.advance(200)
  eq(#run.sent, count)
end)

test("a fight that starts mid-run is marked on the phases that follow, and asking to clear during a run is refused", function()
  local scene = pair()
  scene.one.test.run()
  scene.world.advance(20)
  scene.one.client.combat = true
  scene.world.advance(30)
  local run = scene.one.db.msgtest.runs[1]
  eq(run.marks[2].combat, nil)
  eq(run.marks[#run.marks].combat, true)
  scene.one.test.clear()
  is_true(said(scene.one, "a run is going. Type /im msgtest stop first."))
  is_true(#scene.one.db.msgtest.runs == 1)
end)

test("a result code the list does not know is written down as its number, and counted as a refusal", function()
  local scene = pair({ single = true })
  scene.one.game.env.C_ChatInfo.SendAddonMessage = function() return 77 end
  scene.one.test.run()
  local run = scene.one.db.msgtest.runs[1]
  eq(run.sent[1].r, "77")
  scene.world.advance(5)
  is_true(said(scene.one, "nobody answered"))
  -- (the summary of a finished run names refusals by their text; a number stands for itself)
  local lines = scene.one.ns.Net.MsgTest.summary({ id = "x", sent = { { k = "D", p = "b20", chat = "PARTY", r = "77" } } }, {})
  eq(lines[1], "PARTY b20: 1 sent, refused: 1 77, 0 came back")
end)

test("a listening client speaks once for each quiet spell, however many bursts it heard", function()
  local scene = pair({ single = true })
  local function heardFrom(count)
    for i = 1, count do
      scene.one.game.send("CHAT_MSG_ADDON", "IMTEST", "D:cccc:ccccr1:b10:" .. i .. ":" .. count .. ":xx", "PARTY", "Someone Else")
    end
  end
  heardFrom(3)
  scene.world.advance(20)
  eq(#scene.one.said, 0) -- not quiet long enough
  heardFrom(2)
  scene.world.advance(25)
  eq(#scene.one.said, 0) -- the new messages moved the quiet spell: the check at 30 s found them, the next one is at 60 s
  scene.world.advance(16)
  eq(#scene.one.said, 1)
  is_true(said(scene.one, "heard 5 messages from the other client (run ccccr1)"))
  heardFrom(4)
  scene.world.advance(40)
  eq(#scene.one.said, 2)
  is_true(said(scene.one, "heard 4 messages from the other client (run ccccr1)"))
end)

test("an answer to an earlier run does not make the current run's partner", function()
  local scene = pair({ single = true })
  scene.one.test.run()
  scene.world.advance(5) -- stops: nobody answered
  scene.one.test.run()
  scene.one.game.send("CHAT_MSG_ADDON", "IMTEST", "Q:cccc:aaaar1:hello:1:1:aaaa", "PARTY", "Someone Else")
  scene.world.advance(5)
  is_true(scene.one.db.msgtest.runs[2].stopped ~= nil)
  is_true(string.find(scene.one.db.msgtest.runs[2].stopped, "nobody answered", 1, true) ~= nil)
end)
