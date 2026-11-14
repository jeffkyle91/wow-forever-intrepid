-- The sender queue of addon messages (IntrepidManager/net/Outbox.lua), against a clock and a scheduler the test moves.

local function load()
  local ns = {}
  load_core(ns, "Names", "Council")
  load_addon_file("IntrepidManager/net/Outbox.lua", ns)
  return ns.Net.Outbox
end

-- A world: a clock, a scheduler, and a send function whose answers the test chooses. `answers` maps the nth send call (counting every
-- call, also repeats) to a result code; every other call answers 0.
local function world(options)
  options = options or {}
  local w = { t = 0, timers = {}, calls = {}, sent = {}, drops = {}, answers = options.answers or {}, fight = false }
  w.now = function() return w.t end
  w.after = function(seconds, fn) w.timers[#w.timers + 1] = { at = w.t + seconds, fn = fn } end
  w.send = function(prefix, text, chat, target)
    w.calls[#w.calls + 1] = { prefix = prefix, text = text, chat = chat, target = target, at = w.t }
    if w.raises then error(w.raises) end
    local code = w.answers[#w.calls] or (w.always and w.always(text)) or 0
    if code == 0 then w.sent[#w.sent + 1] = { text = text, chat = chat, target = target, at = w.t } end
    return code
  end
  function w.advance(seconds)
    local target = w.t + seconds
    while true do
      local best
      for i, timer in ipairs(w.timers) do
        if timer.at <= target + 1e-9 and (not best or timer.at < w.timers[best].at) then best = i end
      end
      if not best then break end
      local timer = table.remove(w.timers, best)
      w.t = math.max(w.t, timer.at)
      timer.fn()
    end
    w.t = target
  end
  function w.box(extra)
    local Outbox = load()
    local settings = { send = w.send, now = w.now, after = w.after, prefix = "IMC1", encounter = function() return w.fight end,
      onDrop = function(entry, why) w.drops[#w.drops + 1] = { text = entry.text, why = why } end }
    for key, value in pairs(extra or {}) do settings[key] = value end
    w.outbox = Outbox.new(settings)
    return w.outbox
  end
  return w
end

local function texts(list)
  local out = {}
  for i, row in ipairs(list) do out[i] = row.text end
  return out
end

test("ten messages go out at once, in order, on the prefix", function()
  local w = world()
  local box = w.box()
  for i = 1, 10 do box.push("m" .. i, "RAID") end
  eq(#w.sent, 10)
  eq(w.sent[1].text, "m1")
  eq(w.sent[10].text, "m10")
  eq(w.calls[1].prefix, "IMC1")
  eq(w.calls[1].chat, "RAID")
  eq(box.pending(), 0)
end)

test("the eleventh and the ones after wait for the allowance: one a second, in order", function()
  local w = world()
  local box = w.box()
  for i = 1, 15 do box.push("m" .. i, "PARTY") end
  eq(#w.sent, 10)
  eq(box.pending(), 5)
  w.advance(0.5)
  eq(#w.sent, 10)
  w.advance(0.6)
  eq(#w.sent, 11)
  w.advance(1)
  eq(#w.sent, 12)
  w.advance(10)
  eq(#w.sent, 15)
  eq(box.pending(), 0)
  local order = texts(w.sent)
  for i = 1, 15 do eq(order[i], "m" .. i) end
  -- the game was never asked for more than it gives: every call was accepted
  eq(#w.calls, 15)
end)

test("after a quiet spell the allowance is full again, but not more than ten", function()
  local w = world()
  local box = w.box()
  for i = 1, 10 do box.push("a" .. i, "RAID") end
  w.advance(100)
  for i = 1, 12 do box.push("b" .. i, "RAID") end
  eq(#w.sent, 20)
  eq(box.pending(), 2)
end)

test("a message the game refuses as throttled is tried again after a little over a second, and keeps its place", function()
  local w = world({ answers = { [3] = 3 } })
  local box = w.box()
  for i = 1, 5 do box.push("m" .. i, "RAID") end
  eq(#w.sent, 2) -- the third was refused, so the fourth and fifth wait behind it
  eq(box.pending(), 3)
  w.advance(1.2)
  deep_eq(texts(w.sent), { "m1", "m2", "m3" }) -- the allowance starts again from nothing: one a second
  w.advance(2.2)
  deep_eq(texts(w.sent), { "m1", "m2", "m3", "m4", "m5" })
  eq(box.stats().throttled, 1)
end)

test("whispers have no allowance and do not use the group's", function()
  local w = world()
  local box = w.box()
  for i = 1, 30 do box.push("w" .. i, "WHISPER", "Mirelle Dunmore") end
  eq(#w.sent, 30)
  eq(w.sent[1].target, "Mirelle Dunmore")
  for i = 1, 10 do box.push("g" .. i, "RAID") end
  eq(#w.sent, 40) -- the group still had all ten
  box.push("g11", "RAID")
  eq(box.pending(), 1)
end)

test("during a boss fight nothing is asked, and it all goes out in order afterwards", function()
  local w = world()
  w.fight = true
  local box = w.box()
  box.push("g1", "RAID")
  box.push("w1", "WHISPER", "Mirelle Dunmore")
  box.push("g2", "RAID")
  eq(#w.calls, 0)
  eq(box.pending(), 3)
  w.advance(10)
  eq(#w.calls, 0)
  w.fight = false
  w.advance(3.1)
  eq(box.pending(), 0)
  local order = texts(w.sent)
  deep_eq({ order[1], order[2], order[3] }, { "w1", "g1", "g2" }) -- whispers first, then the group in order
end)

test("a refusal because of a fight that the client did not know about is held and tried again", function()
  local w = world({ answers = { [1] = 11, [2] = 11 } })
  local box = w.box()
  box.push("g1", "RAID")
  eq(#w.sent, 0)
  eq(box.stats().held, 1)
  w.advance(3.1)
  eq(box.stats().held, 2)
  eq(#w.sent, 0)
  w.advance(3.1)
  eq(#w.sent, 1)
  eq(w.sent[1].text, "g1")
end)

test("a message the game will never take is dropped, told, and the queue goes on", function()
  local w = world({ answers = { [1] = 4 } })
  w.always = nil
  local box = w.box()
  box.push("bad", "NOWHERE")
  box.push("good", "RAID")
  eq(#w.sent, 1)
  eq(w.sent[1].text, "good")
  eq(#w.drops, 1)
  eq(w.drops[1].text, "bad")
  eq(w.drops[1].why, "4") -- (no Enum in this world: the number stands for itself)
  eq(box.stats().dropped, 1)
end)

test("a send that raises is dropped with the error, and does not stop the rest", function()
  local w = world()
  local box = w.box()
  w.raises = "protected"
  box.push("one", "RAID")
  eq(#w.drops, 1)
  is_true(string.find(w.drops[1].why, "error: ", 1, true) == 1)
  is_true(string.find(w.drops[1].why, "protected", 1, true) ~= nil)
  w.raises = nil
  box.push("two", "RAID")
  eq(#w.sent, 1)
end)

test("a message that is refused again and again is given up on after twenty tries", function()
  local w = world()
  w.always = function() return 3 end
  local box = w.box()
  box.push("stuck", "RAID")
  box.push("behind", "RAID")
  w.advance(25)
  eq(#w.drops, 1)
  is_true(string.find(w.drops[1].why, "gave up after 20 tries", 1, true) ~= nil)
  eq(w.drops[1].text, "stuck")
  w.advance(40) -- the one behind it gets its twenty tries too
  eq(#w.drops, 2)
  eq(w.drops[2].text, "behind")
end)

test("the names of the game's result codes are used when it has them", function()
  local w = world({ answers = { [1] = 4 } })
  local box = w.box()
  w.send_enum = nil
  local env = { Enum = { SendAddonMessageResult = { Success = 0, InvalidChatType = 4 } } }
  local chunk = assert(loadfile("IntrepidManager/net/Outbox.lua"))
  setmetatable(env, { __index = _G })
  setfenv(chunk, env)
  local ns = { Net = {} }
  chunk("IntrepidManager", ns)
  local named = ns.Net.Outbox.new({ send = w.send, now = w.now, after = w.after, prefix = "IMC1", onDrop = function(_, why) w.drops[#w.drops + 1] = { why = why } end })
  named.push("x", "NOWHERE")
  eq(w.drops[1].why, "InvalidChatType")
  eq(box.pending(), 0)
end)

test("clear forgets what is waiting, and a timer set earlier does nothing", function()
  local w = world()
  local box = w.box()
  for i = 1, 14 do box.push("m" .. i, "RAID") end
  eq(box.pending(), 4)
  box.clear()
  eq(box.pending(), 0)
  w.advance(20)
  eq(#w.sent, 10)
end)

test("the stats count what was sent, refused and dropped", function()
  local w = world({ answers = { [2] = 3, [5] = 4 } })
  local box = w.box()
  for i = 1, 4 do box.push("m" .. i, "RAID") end
  w.advance(5)
  local stats = box.stats()
  eq(stats.throttled, 1)
  eq(stats.dropped, 1)
  eq(stats.pending, 0)
  eq(stats.sent, 3)
end)

test("the allowance can be set: a capacity of five and two a second", function()
  local w = world()
  local box = w.box({ capacity = 5, refill = 2 })
  for i = 1, 8 do box.push("m" .. i, "RAID") end
  eq(#w.sent, 5)
  w.advance(0.6)
  eq(#w.sent, 6) -- one more after half a second
  w.advance(1)
  eq(#w.sent, 8)
end)

test("a refused whisper waits as long as a refused group message would: three seconds in a fight, a little over one when throttled", function()
  local w = world({ answers = { [1] = 11, [3] = 3 } })
  local box = w.box()
  box.push("w1", "WHISPER", "Mirelle Dunmore")
  eq(#w.sent, 0)
  w.advance(2.9)
  eq(#w.calls, 1)
  w.advance(0.2)
  eq(#w.sent, 1) -- call 2 took it after the three seconds
  box.push("w2", "WHISPER", "Mirelle Dunmore") -- call 3: throttled
  eq(#w.sent, 1)
  w.advance(1.0)
  eq(#w.calls, 3)
  w.advance(0.2)
  eq(#w.sent, 2)
end)

test("a stuck message is tried exactly twenty times; push says yes; the stats count both queues", function()
  local w = world()
  w.always = function() return 3 end
  local box = w.box()
  eq(box.push("stuck", "RAID"), true)
  w.advance(40)
  eq(#w.calls, 20)
  local fresh = world()
  fresh.always = function() return 3 end
  local other = fresh.box()
  other.push("g", "RAID")
  other.push("w", "WHISPER", "Mirelle Dunmore")
  eq(other.stats().pending, 2)
  eq(other.pending(), 2)
end)
