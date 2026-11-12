-- /im loot (IntrepidManager/game/LootWindow.lua) on a stand-in game with a fake master loot window (tests/support/fake_loot.lua).
-- Invented names only.

local UI = dofile("tests/support/strict_ui.lua")
local FakeLoot = dofile("tests/support/fake_loot.lua")

local function setup(options)
  options = options or {}
  local game = UI.new()
  local scene = { game = game, said = {}, db = {} }
  scene.loot = FakeLoot.install(game, options)
  local ns = {}
  game.load("IntrepidManager/game/LootWindow.lua", ns)
  scene.window = ns.Game.LootWindow.new({ out = function(text) scene.said[#scene.said + 1] = text end, db = scene.db })
  scene.ns = ns
  return scene
end

-- Items of the given qualities, in slots 1, 2, 3 ... (slot 2, 3 ... when the window also holds money).
local function items(...)
  local list = {}
  for i, quality in ipairs({ ... }) do list[i] = { id = 100 + i, name = "Thing " .. i, quality = quality } end
  return list
end

local function last(scene) return scene.said[#scene.said] end

local function dump(value)
  if type(value) ~= "table" then return tostring(value) end
  local parts = {}
  for k, v in pairs(value) do parts[#parts + 1] = tostring(k) .. "=" .. dump(v) end
  return "{" .. table.concat(parts, ",") .. "}"
end

test("the list shows each item slot with its quality, skips money, and prints the candidates once", function()
  local scene = setup({ items = items(0, 2), money = true })
  scene.window.command("")
  eq(#scene.said, 4)
  is_true(string.find(scene.said[1], "Loot: slot 2: ", 1, true) == 1)
  is_true(string.find(scene.said[1], "[Thing 1]", 1, true) ~= nil)
  is_true(string.find(scene.said[1], "(Poor)", 1, true) ~= nil)
  is_true(string.find(scene.said[2], "slot 3: ", 1, true) ~= nil)
  is_true(string.find(scene.said[2], "(Uncommon)", 1, true) ~= nil)
  eq(scene.said[3], "Loot: candidates, for every slot: 1 Jorren Ashvale, 2 Mirelle Dunmore")
  is_true(string.find(scene.said[4], "give one with /im loot give <slot>", 1, true) ~= nil)
  eq(scene.db.loottest, nil) -- listing records nothing
end)

test("slots with different candidate lists print them per slot", function()
  local scene = setup({ items = items(0, 0), orders = { [2] = { "Mirelle Dunmore", "Jorren Ashvale" } } })
  scene.window.command("list")
  is_true(string.find(scene.said[1], "candidates: 1 Jorren Ashvale, 2 Mirelle Dunmore", 1, true) ~= nil)
  is_true(string.find(scene.said[2], "candidates: 1 Mirelle Dunmore, 2 Jorren Ashvale", 1, true) ~= nil)
end)

test("without a window, with only money, or without being the master looter, it says so", function()
  local none = setup({ items = {} })
  none.window.command("")
  eq(last(none), "Loot: there is no loot window open. Open a corpse first.")
  none.window.command("give 1 other")
  eq(last(none), "Loot: there is no loot window open. Open a corpse first.")
  none.window.command("sweep other")
  eq(last(none), "Loot: there is no loot window open. Open a corpse first.")

  local money = setup({ items = {}, money = true })
  money.window.command("")
  eq(last(money), "Loot: the window has no items, only money.")

  local bystander = setup({ items = items(0), notMasterLooter = true })
  bystander.window.command("")
  is_true(string.find(bystander.said[2], "none (you are not the master looter here, or nobody is in range)", 1, true) ~= nil)
  bystander.window.command("give 1 other")
  is_true(string.find(last(bystander), "you are not the master looter here", 1, true) ~= nil)
  eq(#bystander.loot.gives, 0)
end)

test("giving a slot by number calls GiveMasterLoot, waits for the slot to clear, and keeps a record without names", function()
  local scene = setup({ items = items(0, 2) })
  scene.window.command("give 1 2")
  eq(#scene.loot.gives, 1)
  deep_eq(scene.loot.gives[1], { slot = 1, index = 2, name = "Mirelle Dunmore" })
  is_true(string.find(scene.said[1], "giving slot 1 (", 1, true) ~= nil)
  is_true(string.find(scene.said[1], "to Mirelle Dunmore...", 1, true) ~= nil)
  scene.game.advance(0.1)
  eq(#scene.said, 1) -- not yet
  scene.game.advance(0.2)
  eq(scene.said[2], "Loot: slot 1: given. Type /reload to save the record.")
  local record = scene.db.loottest.gives[1]
  eq(record.slot, 1)
  eq(record.itemId, 101)
  eq(record.quality, 0)
  eq(record.candidate, 2)
  eq(record.who, "number")
  eq(record.result, "cleared")
  eq(record.seconds, 0.2)
  eq(record.method, "master")
  eq(record.threshold, 0)
  eq(record.members, 2)
  deep_eq(record.events, { { e = "LOOT_SLOT_CLEARED", after = 0.2, slot = 1 } })
  local text = dump(scene.db)
  for _, name in ipairs({ "Jorren", "Ashvale", "Mirelle", "Dunmore" }) do eq(string.find(text, name, 1, true), nil) end
  scene.game.advance(5) -- the waiting timer finds nothing to do
  eq(#scene.said, 2)
  eq(#scene.db.loottest.gives, 1)
end)

test("the player can be named by number, whole name, the start of a name, me or other", function()
  local function target(who, options)
    local scene = setup(options or { items = items(0), candidates = { "Jorren Ashvale", "Mirelle Dunmore", "Tavian Holt" } })
    scene.window.command("give 1 " .. who)
    return scene
  end
  eq(target("3").loot.gives[1].name, "Tavian Holt")
  eq(target("Mirelle Dunmore").loot.gives[1].name, "Mirelle Dunmore")
  eq(target("  mirelle   DUNMORE ").loot.gives[1].name, "Mirelle Dunmore")
  eq(target("tav").loot.gives[1].name, "Tavian Holt")
  eq(target("me").loot.gives[1].name, "Jorren Ashvale")
  local me = target("me")
  me.game.advance(0.3)
  eq(me.db.loottest.gives[1].who, "me")
  local two = { items = items(0) }
  eq(target("other", two).loot.gives[1].name, "Mirelle Dunmore")
  local other = target("other", two)
  other.game.advance(0.3)
  eq(other.db.loottest.gives[1].who, "other")
  -- a different first name for the player: "other" is the other one
  eq(target("other", { items = items(0), me = "Mirelle Dunmore" }).loot.gives[1].name, "Jorren Ashvale")
end)

test("a name that fits nobody or several, or a slot that is not there, is refused and nothing is given", function()
  local scene = setup({ items = items(0), candidates = { "Jorren Ashvale", "Mirelle Dunmore", "Mirelle Dunmoor" } })
  scene.window.command("give 1 other")
  is_true(string.find(last(scene), "more than one other player", 1, true) ~= nil)
  scene.window.command("give 1 mirelle")
  is_true(string.find(last(scene), "More than one candidate starts with 'mirelle'", 1, true) ~= nil)
  scene.window.command("give 1 zed")
  is_true(string.find(last(scene), "No candidate is called 'zed'", 1, true) ~= nil)
  scene.window.command("give 1 7")
  is_true(string.find(last(scene), "There is no candidate number 7", 1, true) ~= nil)
  scene.window.command("give 9 1")
  is_true(string.find(last(scene), "slot 9 has no item", 1, true) ~= nil)
  scene.window.command("give 1")
  is_true(string.find(last(scene), "use /im loot give <slot>", 1, true) ~= nil)
  eq(#scene.loot.gives, 0)
  local alone = setup({ items = items(0), candidates = { "Jorren Ashvale" } })
  alone.window.command("give 1 other")
  is_true(string.find(last(alone), "no other player", 1, true) ~= nil)
  local away = setup({ items = items(0), me = "Zed Nobody" })
  away.window.command("give 1 me")
  is_true(string.find(last(away), "not on the candidate list", 1, true) ~= nil)
end)

test("a give the game does not answer is told as not given after 2.5 seconds, and the slot stays", function()
  local scene = setup({ items = items(0), full = { ["Mirelle Dunmore"] = true } })
  scene.window.command("give 1 other")
  scene.game.advance(2.4)
  eq(#scene.said, 1)
  scene.game.advance(0.2)
  is_true(string.find(last(scene), "slot 1: not given: the game said nothing for 2.5 seconds (a full bag on their side", 1, true) ~= nil)
  eq(scene.db.loottest.gives[1].result, "no answer")
  eq(scene.db.loottest.gives[1].seconds, 2.5)
  eq(scene.game.env.GetLootSlotType(1), 1)
  -- the bags are emptied: the same give works now
  scene.loot.full = {}
  scene.window.command("give 1 other")
  scene.game.advance(0.3)
  eq(last(scene), "Loot: slot 1: given. Type /reload to save the record.")
end)

test("a window that closes during a give, and a call that raises, are told and recorded", function()
  local closing = setup({ items = items(0) })
  closing.window.command("give 1 other")
  closing.game.advance(0.1)
  closing.loot.close()
  is_true(string.find(last(closing), "not given: the loot window closed", 1, true) ~= nil)
  eq(closing.db.loottest.gives[1].result, "window closed")
  closing.game.advance(5)
  eq(#closing.db.loottest.gives, 1)

  local raising = setup({ items = items(0), raises = "protected function" })
  raising.window.command("give 1 other")
  is_true(string.find(last(raising), "not given: error: ", 1, true) ~= nil)
  is_true(string.find(last(raising), "protected function", 1, true) ~= nil)
  eq(raising.db.loottest.gives[1].result:sub(1, 6), "error:")
end)

test("a second command while one is in flight waits, and the events of other looting are ignored", function()
  local scene = setup({ items = items(0, 0) })
  scene.game.send("LOOT_SLOT_CLEARED", 1) -- nobody is giving: nothing to do
  scene.game.send("UI_ERROR_MESSAGE", 1, "Inventory is full.")
  eq(scene.db.loottest, nil)
  scene.window.command("give 1 other")
  scene.window.command("give 2 other")
  is_true(string.find(last(scene), "still working on the last one", 1, true) ~= nil)
  eq(#scene.loot.gives, 1)
  scene.game.send("LOOT_SLOT_CLEARED", 2) -- another slot cleared: not ours
  scene.game.send("UI_ERROR_MESSAGE", 1, "Inventory is full.")
  scene.game.advance(0.25)
  local record = scene.db.loottest.gives[1]
  eq(record.result, "cleared")
  eq(#record.events, 3)
  eq(record.events[2].text, "Inventory is full.")
  eq(record.events[3].slot, 1)
end)

test("a sweep gives every Poor item to the player, one at a time with a short pause, and leaves the rest", function()
  local scene = setup({ items = items(0, 2, 0, 1, 0) })
  scene.window.command("sweep other")
  is_true(string.find(scene.said[1], "giving 3 items of quality Poor or lower to Mirelle Dunmore...", 1, true) ~= nil)
  eq(#scene.loot.gives, 1)
  scene.game.advance(0.25)
  is_true(string.find(scene.said[2], "slot 1 (", 1, true) ~= nil)
  is_true(string.find(scene.said[2], "): given (1 of 3)", 1, true) ~= nil)
  eq(#scene.loot.gives, 1) -- the pause before the next one
  scene.game.advance(0.3)
  eq(#scene.loot.gives, 2)
  scene.game.advance(2)
  eq(#scene.loot.gives, 3)
  eq(last(scene), "Loot: done: 3 of 3 given. Type /reload to save the record.")
  local slots = {}
  for _, give in ipairs(scene.loot.gives) do slots[#slots + 1] = give.slot .. ":" .. give.index end
  deep_eq(slots, { "1:2", "3:2", "5:2" })
  eq(scene.game.env.GetLootSlotType(2), 1) -- the Uncommon is still there
  eq(scene.game.env.GetLootSlotType(4), 1) -- and the Common
  local record = scene.db.loottest.sweeps[1]
  eq(record.maxQuality, 0)
  eq(record.planned, 3)
  eq(record.given, 3)
  eq(record.who, "other")
  eq(record.stopped, nil)
  eq(#record.items, 3)
  eq(record.items[1].result, "cleared")
  eq(record.items[1].itemId, 101)
  eq(#scene.db.loottest.gives, 3)
  -- asking again finds nothing left of that quality
  scene.window.command("sweep other")
  eq(last(scene), "Loot: nothing of quality Poor or lower in the window.")
end)

test("a sweep up to a quality word takes the better items too, and a two-word name before the word still works", function()
  local scene = setup({ items = items(0, 1, 2, 3) })
  scene.window.command("sweep Mirelle Dunmore green")
  scene.game.advance(5)
  eq(#scene.loot.gives, 3)
  eq(scene.loot.gives[3].slot, 3)
  eq(scene.db.loottest.sweeps[1].maxQuality, 2)
  eq(scene.game.env.GetLootSlotType(4), 1) -- the Rare stays
  scene.window.command("sweep")
  is_true(string.find(last(scene), "use /im loot sweep <number, name, me or other>", 1, true) ~= nil)
  scene.window.command("sweep poor")
  is_true(string.find(last(scene), "use /im loot sweep", 1, true) ~= nil)
  scene.window.command("sweep other")
  eq(last(scene), "Loot: nothing of quality Poor or lower in the window.")
end)

test("a sweep stops at the first item that is not given, because the same full bag would stop the rest", function()
  local scene = setup({ items = items(0, 0, 0) })
  scene.window.command("sweep other")
  scene.game.advance(0.25)
  scene.loot.full["Mirelle Dunmore"] = true -- their bags fill up
  scene.game.advance(0.3 + 2.6)
  is_true(string.find(last(scene), "stopped after 1 of 3: slot 2 was not given", 1, true) ~= nil)
  eq(#scene.loot.gives, 2)
  scene.game.advance(10)
  eq(#scene.loot.gives, 2) -- the third was never tried
  local record = scene.db.loottest.sweeps[1]
  eq(record.given, 1)
  eq(record.stopped, "slot 2 was not given")
  eq(record.items[2].result, "no answer")
  -- and a new sweep can go on from there once there is room
  scene.loot.full = {}
  scene.window.command("sweep other")
  scene.game.advance(5)
  eq(last(scene), "Loot: done: 2 of 2 given. Type /reload to save the record.")
end)

test("a sweep stops when the window closes between two items, and says so", function()
  local scene = setup({ items = items(0, 0, 0) })
  scene.window.command("sweep other")
  scene.game.advance(0.25)
  scene.loot.close()
  scene.game.advance(1)
  is_true(string.find(last(scene), "stopped after 1 of 3: the loot window closed", 1, true) ~= nil)
  eq(#scene.loot.gives, 1)
end)

test("a slot that changed since the plan is skipped and recorded, not given", function()
  local scene = setup({ items = items(0, 0, 0) })
  scene.window.command("sweep other")
  scene.loot.slots[2].link = "|cff9d9d9d|Hitem:999::::::::70:::::|h[Something else]|h|r"
  scene.game.advance(5)
  eq(#scene.loot.gives, 2)
  eq(scene.loot.gives[2].slot, 3)
  local record = scene.db.loottest.sweeps[1]
  eq(record.given, 2)
  eq(record.items[2].result, "slot changed")
  eq(last(scene), "Loot: done: 2 of 3 given. Type /reload to save the record.")
end)

test("the player is found by name in each slot, because the numbering can differ between slots", function()
  local scene = setup({ items = items(0, 0, 0), orders = { [3] = { "Mirelle Dunmore", "Jorren Ashvale" } } })
  scene.window.command("sweep Mirelle Dunmore")
  scene.game.advance(5)
  eq(#scene.loot.gives, 3)
  eq(scene.loot.gives[1].index, 2)
  eq(scene.loot.gives[3].index, 1)
  eq(scene.loot.gives[3].name, "Mirelle Dunmore")
  -- a player who is not on the list of a later slot ends the sweep
  local gone = setup({ items = items(0, 0), orders = { [2] = { "Jorren Ashvale" } } })
  gone.window.command("sweep Mirelle Dunmore")
  gone.game.advance(5)
  is_true(string.find(last(gone), "stopped after 1 of 2: that player is no longer on the list for slot 2", 1, true) ~= nil)
end)

test("stop ends a sweep after the item in flight, and says when nothing runs", function()
  local scene = setup({ items = items(0, 0, 0) })
  scene.window.command("stop")
  eq(last(scene), "Loot: nothing is running.")
  scene.window.command("sweep other")
  scene.game.advance(0.1)
  scene.window.command("stop")
  eq(last(scene), "Loot: stopping after the item in flight.")
  scene.game.advance(5)
  is_true(string.find(last(scene), "stopped after 1 of 3: you stopped it", 1, true) ~= nil)
  eq(#scene.loot.gives, 1)
  -- stop while a single give is in flight
  local single = setup({ items = items(0) })
  single.window.command("give 1 other")
  single.window.command("stop")
  is_true(string.find(last(single), "one give is in flight", 1, true) ~= nil)
  -- a command while a sweep runs waits
  local busy = setup({ items = items(0, 0) })
  busy.window.command("sweep other")
  busy.window.command("sweep other")
  is_true(string.find(last(busy), "still working on the last one", 1, true) ~= nil)
  eq(#busy.loot.gives, 1)
end)

test("the commands list their words when asked something else, and nothing in the record names a player", function()
  local scene = setup({ items = items(0, 0) })
  scene.window.command("dance")
  is_true(string.find(last(scene), "commands: /im loot (the slots)", 1, true) ~= nil)
  scene.window.command("sweep other")
  scene.game.advance(5)
  scene.window.command("give 1 me")
  local text = dump(scene.db)
  for _, name in ipairs({ "Jorren", "Ashvale", "Mirelle", "Dunmore" }) do eq(string.find(text, name, 1, true), nil) end
end)

test("an error inside the event handler is kept in the record, never shown", function()
  local scene = setup({ items = items(0), full = { ["Mirelle Dunmore"] = true } })
  scene.window.command("give 1 other")
  local real = scene.game.env.GetTime
  scene.game.env.GetTime = function() error("boom") end
  scene.game.send("UI_ERROR_MESSAGE", 1, "Inventory is full.")
  scene.game.env.GetTime = real
  eq(scene.db.loottest.errorCount, 1)
  is_true(string.find(scene.db.loottest.lastError, "boom", 1, true) ~= nil)
  eq(#scene.said, 1) -- only the first line; the error was not shown
end)

test("the quality words map to the game's numbers, and the names compare without case or extra spaces", function()
  local LootWindow = setup({ items = items(0) }).ns.Game.LootWindow
  eq(LootWindow.QUALITY_WORDS.poor, 0)
  eq(LootWindow.QUALITY_WORDS.gray, 0)
  eq(LootWindow.QUALITY_WORDS.grey, 0)
  eq(LootWindow.QUALITY_WORDS.white, 1)
  eq(LootWindow.QUALITY_WORDS.green, 2)
  eq(LootWindow.QUALITY_WORDS.blue, 3)
  eq(LootWindow.QUALITY_WORDS.epic, 4)
  eq(LootWindow.comparable("  Jorren   ASHVALE "), "jorren ashvale")
end)

test("a sweep that gives the last item of the window is done, although the game closes the window with it", function()
  local scene = setup({ items = items(0, 0) })
  scene.window.command("sweep other")
  scene.game.advance(5)
  eq(#scene.loot.gives, 2)
  eq(scene.loot.opened, false) -- the fake window closed itself, as the game's does
  eq(last(scene), "Loot: done: 2 of 2 given. Type /reload to save the record.")
  eq(scene.db.loottest.sweeps[1].stopped, nil)
  eq(scene.db.loottest.sweeps[1].given, 2)
  -- the same when the window stays open
  local open = setup({ items = items(0, 0), keepOpen = true })
  open.window.command("sweep other")
  open.game.advance(5)
  eq(last(open), "Loot: done: 2 of 2 given. Type /reload to save the record.")
end)

test("the game's loot lines are kept as shapes on the receiving side too: me or someone else, loot or item, which item, when", function()
  local scene = setup({ items = items(0) })
  scene.window.listen()
  local link = "|cff9d9d9d|Hitem:7073::::::::70:::::|h[Broken Fang]|h|r"
  scene.game.send("CHAT_MSG_LOOT", "You receive loot: " .. link .. ".")
  scene.game.advance(1)
  scene.game.send("CHAT_MSG_LOOT", "Mirelle Dunmore receives loot: " .. link .. ".")
  scene.game.send("CHAT_MSG_LOOT", "You receive item: " .. link .. ".")
  scene.game.send("CHAT_MSG_LOOT", "Tavian Holt receives item: |cffffffff|Hitem:2672::::::::70:::::|h[Stringy Wolf Meat]|h|r.")
  scene.game.send("CHAT_MSG_LOOT", "Mirelle Dunmore rolls 55 on " .. link .. ".")
  scene.game.send("CHAT_MSG_LOOT", 42)
  local seen = scene.db.loottest.seen
  eq(#seen, 4)
  deep_eq(seen[1], { t = seen[1].t, who = "self", via = "loot", itemId = 7073 })
  eq(seen[2].who, "other")
  eq(seen[2].via, "loot")
  eq(seen[2].t - seen[1].t, 1)
  eq(seen[3].who, "self")
  eq(seen[3].via, "item")
  eq(seen[4].who, "other")
  eq(seen[4].itemId, 2672)
  local text = dump(scene.db)
  for _, name in ipairs({ "Mirelle", "Dunmore", "Tavian", "Holt" }) do eq(string.find(text, name, 1, true), nil) end
  -- a give in flight is not disturbed by the lines
  scene.window.command("give 1 other")
  scene.game.send("CHAT_MSG_LOOT", "You receive loot: " .. link .. ".")
  scene.game.advance(0.3)
  eq(scene.db.loottest.gives[1].result, "cleared")
  eq(#scene.db.loottest.seen, 5)
end)

test("the loot lines kept are limited, and a bad line never raises", function()
  local scene = setup({ items = items(0) })
  scene.window.listen()
  for i = 1, 210 do
    scene.game.send("CHAT_MSG_LOOT", "You receive loot: |cff9d9d9d|Hitem:" .. i .. "::::::::70:::::|h[Thing]|h|r.")
  end
  eq(#scene.db.loottest.seen, 200)
  scene.window.listen() -- a second call changes nothing
  scene.game.send("CHAT_MSG_LOOT", nil)
  eq(scene.db.loottest.errorCount, nil)
end)
