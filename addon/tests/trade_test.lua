-- Giving an item by trade (IntrepidManager/game/Trade.lua) on a stand-in game with a fake trade window and bags
-- (tests/support/fake_trade.lua). Invented names and items only.

local UI = dofile("tests/support/strict_ui.lua")
local FakeTrade = dofile("tests/support/fake_trade.lua")

local ITEM = "item:401::::::::70" -- (the fake's links carry ::::::::70:::::; the string drops the trailing colons)

local function setup(options)
  options = options or {}
  local game = UI.new()
  local scene = { game = game, said = {}, db = {}, results = {}, completed = 0 }
  options.bags = options.bags or { [0] = { [3] = { id = 401, name = "Crown of the Fallen" }, [5] = { id = 402, name = "Ring of Ash" } } }
  scene.world = FakeTrade.install(game, options)
  local ns = {}
  load_core(ns, "Names", "Council")
  game.load("IntrepidManager/net/CouncilWire.lua", ns)
  game.load("IntrepidManager/game/Trade.lua", ns)
  scene.trade = ns.Game.Trade.new({ out = function(text) scene.said[#scene.said + 1] = text end, db = scene.db })
  scene.ns = ns
  return scene
end

local function give(scene, item, extra)
  local options = { unit = "party2", label = "Mirelle Dunmore",
    onResult = function(result) scene.results[#scene.results + 1] = result end,
    onCompleted = function(given) scene.completed = scene.completed + 1 scene.given = given end }
  for key, value in pairs(extra or {}) do options[key] = value end
  return scene.trade.give(item or ITEM, options)
end

local function said(scene, text)
  for _, line in ipairs(scene.said) do
    if string.find(line, text, 1, true) then return true end
  end
  return false
end

local function last(scene) return scene.said[#scene.said] end

local function stepNames(scene, run)
  local list = {}
  for _, entry in ipairs(scene.db.tradetest.runs[run or 1].steps) do list[#list + 1] = entry.s .. (entry.ok and "" or "!") end
  return table.concat(list, " ")
end

local function calls(scene)
  local list = {}
  for _, entry in ipairs(scene.world.calls) do list[#list + 1] = entry[1] end
  return table.concat(list, " ")
end

local function dump(value)
  if type(value) ~= "table" then return tostring(value) end
  local parts = {}
  for k, v in pairs(value) do parts[#parts + 1] = tostring(k) .. "=" .. dump(v) end
  return "{" .. table.concat(parts, ",") .. "}"
end

test("the whole way: the window opens, the item is picked up and clicked into the first free slot, the players accept", function()
  local scene = setup()
  scene.trade.listen()
  eq(give(scene), true)
  eq(calls(scene), "initiate")
  deep_eq(scene.world.calls[1], { "initiate", "party2" })
  scene.game.advance(0.3)
  eq(scene.world.open, true)
  eq(calls(scene), "initiate") -- the item waits a moment for the window to settle
  scene.game.advance(0.2)
  eq(calls(scene), "initiate pickup click")
  deep_eq(scene.world.calls[2], { "pickup", 0, 3 })
  deep_eq(scene.world.calls[3], { "click", 1 })
  scene.game.advance(0.6)
  is_true(scene.world.slots[1] ~= nil)
  eq(scene.world.cursor, nil)
  deep_eq(scene.results, { "placed" })
  is_true(said(scene, "Mirelle Dunmore can have the item: it is in the trade window. Press Trade"))
  eq(scene.trade.running(), true) -- the run stays open to see how the trade ends
  scene.world.accept()
  scene.game.advance(1.5)
  eq(scene.completed, 1)
  eq(last(scene), "Trade: trade complete.")
  eq(scene.trade.running(), false)
  local record = scene.db.tradetest.runs[1]
  eq(record.result, "completed")
  eq(record.completedBy, "message")
  eq(record.item, 401)
  eq(stepNames(scene), "locate initiate window pickup cursor click placed")
  scene.game.advance(5)
  eq(scene.completed, 1) -- told once, although the game sends the close twice
  eq(#scene.db.tradetest.runs, 1)
end)

test("a window that is open already is used as it is: nothing is initiated", function()
  local scene = setup()
  scene.trade.listen()
  scene.world.openWindow() -- the player opened it by hand
  eq(give(scene), true)
  scene.game.advance(1)
  eq(calls(scene), "pickup click")
  deep_eq(scene.results, { "placed" })
  eq(scene.db.tradetest, nil) -- (still open: the record is kept when the run ends)
  scene.world.cancel()
  scene.game.advance(1.5)
  eq(scene.db.tradetest.runs[1].windowWasOpen, true)
  eq(stepNames(scene), "locate window pickup cursor click placed")
end)

test("a slot that holds something already is never clicked: the item goes in the first free slot, and the other item stays", function()
  local scene = setup()
  scene.trade.listen()
  scene.world.openWindow()
  scene.world.slots[1] = FakeTrade.link(999, "Something the player put there")
  give(scene)
  scene.game.advance(1)
  deep_eq(scene.world.calls[#scene.world.calls], { "click", 2 })
  is_true(scene.world.slots[2] ~= nil)
  is_true(string.find(scene.world.slots[1], "Something the player put there", 1, true) ~= nil)
  eq(scene.world.cursor, nil)
  deep_eq(scene.results, { "placed" })
end)

test("the fake plays what was seen: a click on a slot with an item takes it back onto the cursor", function()
  local scene = setup()
  scene.world.openWindow()
  scene.world.slots[1] = FakeTrade.link(401)
  scene.game.env.ClickTradeButton(1)
  eq(scene.world.slots[1], nil)
  eq(scene.world.cursor.id, 401)
end)

test("the game refusing to open the trade as a protected call is told and the run ends with the reason", function()
  local scene = setup({ blocked = true })
  eq(give(scene), false)
  eq(last(scene), "Trade: the game blocked opening the trade (ADDON_ACTION_FORBIDDEN). Open it yourself and drag the item.")
  eq(scene.db.tradetest.runs[1].result, "blocked")
  eq(scene.db.tradetest.runs[1].events[1].e, "ADDON_ACTION_FORBIDDEN")
  deep_eq(scene.results, { "blocked" })
  eq(scene.trade.running(), false)
  eq(calls(scene), "initiate")
end)

test("a call that raises, a player too far away, and a window that never opens are told with what the game said", function()
  local raising = setup({ opens = "yes", raises = "protected" })
  eq(give(raising), false)
  is_true(said(raising, "the game would not open a trade: "))
  eq(raising.db.tradetest.runs[1].result, "raised")

  local far = setup({ opens = "tooFar" })
  eq(give(far), true)
  far.game.advance(2.9)
  eq(far.trade.running(), true)
  far.game.advance(0.2)
  eq(far.trade.running(), false)
  eq(last(far), "Trade: the trade window did not open. The game said: Target is too far away.")
  eq(far.db.tradetest.runs[1].result, "no window")
  eq(far.db.tradetest.runs[1].events[1].d, "Target is too far away.")

  local never = setup({ opens = "never" })
  give(never)
  never.game.advance(3.1)
  eq(last(never), "Trade: the trade window did not open.")
end)

test("a window that comes up during the call itself is used at once", function()
  local scene = setup({ opens = "sync" })
  give(scene)
  scene.game.advance(1)
  eq(calls(scene), "initiate pickup click")
  deep_eq(scene.results, { "placed" })
end)

test("an item that is not in the bags is told and nothing is called", function()
  local scene = setup()
  eq(give(scene, "item:12345"), false)
  eq(last(scene), "Trade: that item is not in your bags.")
  eq(#scene.world.calls, 0)
  eq(scene.db.tradetest, nil)
end)

test("an item that will not come up from its bag, and a click that does nothing or is refused, end the run and clear the cursor", function()
  local locked = setup({ locked = true })
  locked.trade.listen()
  locked.world.openWindow()
  give(locked)
  locked.game.advance(1)
  eq(last(locked), "Trade: the item did not come up from the bag (it may be locked or the call was refused).")
  eq(locked.world.cleared, 2) -- (once before the pickup, once after it failed)
  eq(calls(locked), "pickup") -- no click on an empty cursor
  eq(locked.db.tradetest.runs[1].result, "not picked up")

  local inert = setup({ clickInert = true })
  inert.trade.listen()
  inert.world.openWindow()
  give(inert)
  inert.game.advance(1)
  eq(last(inert), "Trade: the click did not put the item in the trade slot.")
  eq(inert.world.cursor, nil) -- the item went back
  eq(inert.db.tradetest.runs[1].result, "slot empty")
  eq(stepNames(inert), "locate window pickup cursor click placed!")

  local refused = setup({ clickBlocked = true })
  refused.trade.listen()
  refused.world.openWindow()
  give(refused)
  refused.game.advance(1)
  eq(last(refused), "Trade: the game blocked the click on the trade slot (ADDON_ACTION_BLOCKED).")
  eq(refused.world.cursor, nil)
  eq(refused.db.tradetest.runs[1].result, "blocked")
end)

test("six slots taken leave no room, and an item that moved is found again, or reported gone", function()
  local full = setup()
  full.trade.listen()
  full.world.openWindow()
  for slot = 1, 6 do full.world.slots[slot] = FakeTrade.link(900 + slot) end
  give(full)
  full.game.advance(1)
  eq(last(full), "Trade: all six trade slots are taken. Make room, then try again.")

  local moved = setup()
  moved.trade.listen()
  moved.world.openWindow()
  give(moved)
  moved.world.bags[0][4], moved.world.bags[0][3] = moved.world.bags[0][3], nil -- it moved while the window settled
  moved.game.advance(1)
  deep_eq(moved.world.calls[1], { "pickup", 0, 4 })
  deep_eq(moved.results, { "placed" })

  local gone = setup()
  gone.trade.listen()
  gone.world.openWindow()
  give(gone)
  gone.world.bags[0][3] = nil
  gone.game.advance(1)
  eq(last(gone), "Trade: the item is no longer in your bags.")
  eq(gone.db.tradetest.runs[1].result, "item gone")
end)

test("a trade that closes without 'Trade complete.' is reported as cancelled and gives nothing away", function()
  local scene = setup()
  scene.trade.listen()
  scene.world.openWindow()
  give(scene)
  scene.game.advance(1)
  scene.world.cancel()
  scene.game.advance(1.5)
  eq(scene.completed, 0)
  eq(last(scene), "Trade: the trade window closed without a completed trade.")
  eq(scene.db.tradetest.runs[1].result, "cancelled")
end)

test("a second give while the first waits is refused, but one after an item was placed takes over from it", function()
  local scene = setup()
  scene.trade.listen()
  give(scene)
  eq(give(scene), false)
  eq(last(scene), "Trade: still busy with the last one.")
  scene.game.advance(2) -- the window opened and the first item is in
  deep_eq(scene.results, { "placed" })
  eq(give(scene, "item:402::::::::70"), true) -- the window is still open: the next item goes in
  scene.game.advance(1)
  eq(scene.db.tradetest.runs[1].result, "left open")
  deep_eq(scene.results, { "placed", "placed" })
  is_true(scene.world.slots[1] ~= nil and scene.world.slots[2] ~= nil)
end)

test("stop ends a run, and says when nothing runs", function()
  local scene = setup()
  scene.trade.stop()
  eq(last(scene), "Trade: nothing is running.")
  give(scene)
  scene.trade.stop()
  eq(last(scene), "Trade: stopped.")
  eq(scene.trade.running(), false)
  deep_eq(scene.results, { "stopped" })
  scene.game.advance(5) -- the timers of the stopped run do nothing
  eq(#scene.world.calls, 1)
end)

test("an item is found by its string first and by its id otherwise", function()
  local scene = setup({ bags = { [0] = {
    [1] = { id = 401, name = "Other copy" }, [2] = { id = 402, name = "Ring" },
  }, [1] = { [4] = { id = 401, name = "Crown" } } } })
  local bag, slot = scene.trade.locate("item:401::::::::70")
  eq(bag, 0)
  eq(slot, 1)
  bag, slot = scene.trade.locate("item:401::::::::80") -- another link level: the id still finds it
  eq(bag, 0)
  eq(slot, 1)
  bag, slot = scene.trade.locate("item:777")
  eq(bag, nil)
  eq(slot, nil)
  -- the exact string wins over an earlier slot with the same id; the third value counts the slots that hold the id
  local levels = setup({ bags = { [0] = { [1] = { id = 401, name = "Crown", level = 80 }, [2] = { id = 401, name = "Crown" }, [3] = { id = 402, name = "Ring" } } } })
  local count
  bag, slot, count = levels.trade.locate("item:401::::::::70")
  deep_eq({ bag, slot, count }, { 0, 2, 2 })
  bag, slot, count = levels.trade.locate("item:402::::::::70")
  deep_eq({ bag, slot, count }, { 0, 3, 1 })
end)

test("the events are kept with their times, limited, and an error in the handler is counted, never shown", function()
  local scene = setup()
  scene.trade.listen()
  scene.world.openWindow()
  give(scene)
  scene.game.advance(1)
  scene.world.cancel()
  scene.game.advance(1.5)
  local names = {}
  for _, event in ipairs(scene.db.tradetest.runs[1].events) do names[#names + 1] = event.e end
  is_true(dump(names):find("TRADE_PLAYER_ITEM_CHANGED", 1, true) ~= nil)
  is_true(dump(names):find("TRADE_CLOSED", 1, true) ~= nil)
  eq(scene.db.tradetest.errorCount, nil)
  -- a handler that raises
  give(scene, "item:402::::::::70", { unit = "party1" })
  scene.game.env.GetTime = function() error("clock trouble") end
  scene.game.send("UI_ERROR_MESSAGE", 1, "Something")
  scene.game.env.GetTime = nil
  eq(scene.db.tradetest.errorCount, 1)
  is_true(string.find(scene.db.tradetest.lastError, "clock trouble", 1, true) ~= nil)
end)

test("nothing in the record names a player", function()
  local scene = setup()
  scene.trade.listen()
  give(scene)
  scene.game.advance(2)
  scene.world.accept()
  scene.game.advance(2)
  local text = dump(scene.db)
  for _, name in ipairs({ "Mirelle", "Dunmore" }) do eq(string.find(text, name, 1, true), nil) end
end)

test("the cursor is cleared first: something the player holds is put back, then the item is picked up and goes in", function()
  local scene = setup()
  scene.trade.listen()
  scene.world.openWindow()
  scene.world.cursor = { id = 999, link = FakeTrade.link(999, "Something in hand") }
  give(scene)
  scene.game.advance(1)
  eq(scene.world.cleared, 1)
  deep_eq(scene.world.calls[1], { "pickup", 0, 3 })
  is_true(scene.world.slots[1] ~= nil and string.find(scene.world.slots[1], "Hitem:401:", 1, true) ~= nil)
  deep_eq(scene.results, { "placed" })
end)

test("an item that the bag reports as locked is not picked up: the run ends and says so", function()
  local scene = setup({ bags = { [0] = { [3] = { id = 401, name = "Crown of the Fallen", locked = true } } } })
  scene.trade.listen()
  scene.world.openWindow()
  give(scene)
  scene.game.advance(1)
  eq(last(scene), "Trade: the item is locked (it may be in another trade or being moved). Try again in a moment.")
  eq(calls(scene), "")
  eq(scene.db.tradetest.runs[1].result, "locked")
  eq(stepNames(scene), "locate window locked!")
  deep_eq(scene.results, { "locked" })
end)

test("a trade that goes through without the message is complete once the item has left the bags, told once; one that does not is cancelled", function()
  local scene = setup()
  scene.trade.listen()
  scene.world.openWindow()
  give(scene)
  scene.game.advance(1)
  scene.world.accept({ silent = true })
  scene.game.advance(1.5)
  eq(scene.completed, 1)
  eq(last(scene), "Trade: trade complete.")
  eq(scene.db.tradetest.runs[1].result, "completed")
  eq(scene.db.tradetest.runs[1].completedBy, "bags")
  scene.game.advance(5)
  eq(scene.completed, 1)
  -- two copies of the item: one leaving is a trade, none leaving is not
  local twins = { [0] = { [3] = { id = 401, name = "Crown of the Fallen" }, [6] = { id = 401, name = "Crown of the Fallen" } } }
  local gone = setup({ bags = twins })
  gone.trade.listen()
  gone.world.openWindow()
  give(gone)
  gone.game.advance(1)
  gone.world.accept({ silent = true })
  gone.game.advance(1.5)
  eq(gone.completed, 1)
  local kept = setup({ bags = { [0] = { [3] = { id = 401, name = "Crown of the Fallen" }, [6] = { id = 401, name = "Crown of the Fallen" } } } })
  kept.trade.listen()
  kept.world.openWindow()
  give(kept)
  kept.game.advance(1)
  kept.world.cancel()
  kept.game.advance(1.5)
  eq(kept.completed, 0)
  eq(kept.db.tradetest.runs[1].result, "cancelled")
end)

test("what the game said during the run is kept with the other player's name left out, and who had pressed Trade", function()
  local scene = setup()
  scene.trade.listen()
  scene.world.openWindow()
  give(scene)
  scene.game.advance(1)
  scene.game.send("UI_INFO_MESSAGE", 7, "Mirelle Dunmore has placed an item")
  scene.game.send("UI_INFO_MESSAGE", 7, "Mirelle cancelled")
  scene.world.accept()
  scene.game.advance(1.5)
  local record = scene.db.tradetest.runs[1]
  eq(record.messages[1].text, "<name> has placed an item")
  eq(record.messages[2].text, "<name> cancelled")
  eq(record.messages[3].text, "Trade complete.")
  is_true(record.messages[3].after >= 1)
  local flags = {}
  for _, event in ipairs(record.events) do
    if event.e == "TRADE_ACCEPT_UPDATE" then flags[#flags + 1] = event.d end
  end
  deep_eq(flags, { "1,0", "1,1" })
  local text = dump(scene.db)
  for _, name in ipairs({ "Mirelle", "Dunmore" }) do eq(string.find(text, name, 1, true), nil) end
  -- no more than six texts a run, each cut short
  local many = setup()
  many.trade.listen()
  many.world.openWindow()
  give(many)
  many.game.advance(1)
  for i = 1, 10 do many.game.send("UI_INFO_MESSAGE", 7, string.rep("x", 100) .. i) end
  many.world.cancel()
  many.game.advance(1.5)
  eq(#many.db.tradetest.runs[1].messages, 6)
  eq(#many.db.tradetest.runs[1].messages[1].text, 60)
end)

local function itemOf(id) return "item:" .. id .. "::::::::70" end

local function three() return { [0] = { [1] = { id = 401, name = "Crown" }, [2] = { id = 402, name = "Ring" }, [4] = { id = 403, name = "Cloak" } } } end

test("several items go into one window, one after the other into the first free slots, and a completed trade gives all of them", function()
  local scene = setup({ bags = three() })
  scene.trade.listen()
  eq(give(scene, { itemOf(401), itemOf(402), itemOf(403) }), true)
  scene.game.advance(5)
  eq(calls(scene), "initiate pickup click pickup click pickup click")
  deep_eq({ scene.world.calls[2], scene.world.calls[3] }, { { "pickup", 0, 1 }, { "click", 1 } })
  deep_eq({ scene.world.calls[4], scene.world.calls[5] }, { { "pickup", 0, 2 }, { "click", 2 } })
  deep_eq({ scene.world.calls[6], scene.world.calls[7] }, { { "pickup", 0, 4 }, { "click", 3 } })
  is_true(string.find(scene.world.slots[1], "Hitem:401:", 1, true) ~= nil)
  is_true(string.find(scene.world.slots[2], "Hitem:402:", 1, true) ~= nil)
  is_true(string.find(scene.world.slots[3], "Hitem:403:", 1, true) ~= nil)
  eq(scene.world.cursor, nil)
  deep_eq(scene.results, { "placed" })
  is_true(said(scene, "Mirelle Dunmore can have 3 items: they are in the trade window. Press Trade"))
  eq(scene.completed, 0)
  scene.world.accept()
  scene.game.advance(1.5)
  eq(scene.completed, 1)
  deep_eq(scene.given, { itemOf(401), itemOf(402), itemOf(403) })
  local record = scene.db.tradetest.runs[1]
  eq(record.result, "completed")
  eq(record.count, 3)
  eq(record.placedCount, 3)
  eq(record.givenCount, 3)
  eq(stepNames(scene), "locate initiate window pickup cursor click placed pickup cursor click placed pickup cursor click placed")
end)

test("six items fit in one trade; the others wait for the next, and the chat says so", function()
  local bags = { [0] = {} }
  for i = 1, 8 do bags[0][i] = { id = 500 + i, name = "Thing " .. i } end
  local scene = setup({ bags = bags })
  scene.trade.listen()
  local items = {}
  for i = 1, 8 do items[i] = itemOf(500 + i) end
  give(scene, items)
  is_true(said(scene, "only six items fit in one trade: 2 more wait for the next one."))
  scene.game.advance(8)
  for slot = 1, 6 do is_true(scene.world.slots[slot] ~= nil) end
  deep_eq(scene.results, { "placed" })
  scene.world.accept()
  scene.game.advance(1.5)
  eq(#scene.given, 6)
  eq(scene.given[6], itemOf(506))
  is_true(scene.world.bags[0][7] ~= nil and scene.world.bags[0][8] ~= nil) -- the last two stay in the bags
end)

test("an item that is not in the bags is left out and the rest goes in; none of them in the bags calls nothing", function()
  local scene = setup({ bags = three() })
  scene.trade.listen()
  eq(give(scene, { itemOf(401), itemOf(999), itemOf(403) }), true)
  is_true(said(scene, "one of the items is not in your bags and is left out."))
  scene.game.advance(5)
  eq(calls(scene), "initiate pickup click pickup click")
  scene.world.accept()
  scene.game.advance(1.5)
  deep_eq(scene.given, { itemOf(401), itemOf(403) })
  local none = setup({ bags = three() })
  eq(give(none, { itemOf(998), itemOf(999) }), false)
  is_true(said(none, "none of those items is in your bags."))
  eq(#none.world.calls, 0)
  local several = setup({ bags = three() })
  give(several, { itemOf(401), itemOf(997), itemOf(998), itemOf(999) })
  is_true(said(several, "3 of the items are not in your bags and are left out."))
end)

test("two copies of the same item go in from their own bag slots, and one copy asked for takes one slot only", function()
  local twins = { [0] = { [3] = { id = 401, name = "Crown" }, [6] = { id = 401, name = "Crown" } } }
  local scene = setup({ bags = twins })
  scene.trade.listen()
  give(scene, { itemOf(401), itemOf(401) })
  scene.game.advance(4)
  deep_eq({ scene.world.calls[2], scene.world.calls[4] }, { { "pickup", 0, 3 }, { "pickup", 0, 6 } })
  scene.world.accept({ silent = true }) -- no message: the bags tell
  scene.game.advance(1.5)
  eq(scene.completed, 1)
  eq(#scene.given, 2)
  eq(scene.db.tradetest.runs[1].completedBy, "bags")

  local one = setup({ bags = { [0] = { [3] = { id = 401, name = "Crown" }, [6] = { id = 401, name = "Crown" } } } })
  one.trade.listen()
  give(one, itemOf(401))
  one.game.advance(3)
  one.world.accept({ silent = true })
  one.game.advance(1.5)
  eq(#one.given, 1)
  is_true(one.world.bags[0][6] ~= nil) -- the other copy is still there
end)

test("when an item cannot be added the ones already in the window stay, the rest is told, and only those are given", function()
  local scene = setup({ bags = { [0] = { [1] = { id = 401, name = "Crown" }, [2] = { id = 402, name = "Ring", locked = true }, [4] = { id = 403, name = "Cloak" } } } })
  scene.trade.listen()
  give(scene, { itemOf(401), itemOf(402), itemOf(403) })
  scene.game.advance(5)
  is_true(said(scene, "the item is locked (it may be in another trade or being moved)."))
  is_true(said(scene, "Mirelle Dunmore can have the item: it is in the trade window."))
  deep_eq(scene.results, { "partial" })
  eq(calls(scene), "initiate pickup click") -- the third item was not tried
  scene.world.accept()
  scene.game.advance(1.5)
  deep_eq(scene.given, { itemOf(401) })
  local record = scene.db.tradetest.runs[1]
  eq(record.result, "completed")
  eq(record.partial, "locked")
  eq(record.placedCount, 1)
  eq(stepNames(scene), "locate initiate window pickup cursor click placed locked!")
end)

test("an item taken out of the window by hand before the trade is not given", function()
  local scene = setup({ bags = three() })
  scene.trade.listen()
  give(scene, { itemOf(401), itemOf(402), itemOf(403) })
  scene.game.advance(5)
  scene.world.slots[2], scene.world.slotFrom[2] = nil, nil -- the loot master clicked the Ring out
  scene.game.send("TRADE_PLAYER_ITEM_CHANGED", 2)
  scene.world.accept()
  scene.game.advance(1.5)
  deep_eq(scene.given, { itemOf(401), itemOf(403) })
  is_true(scene.world.bags[0][2] ~= nil) -- the Ring is still in the bags
end)

test("what was in the window is read at every change and at every accept, so a lost event of one kind does not give away the wrong items", function()
  -- an item leaves the window without an event, and the accept comes: the accept tells
  local silent = setup({ bags = three() })
  silent.trade.listen()
  give(silent, { itemOf(401), itemOf(402), itemOf(403) })
  silent.game.advance(5)
  silent.world.slots[2], silent.world.slotFrom[2] = nil, nil
  silent.world.accept()
  silent.game.advance(1.5)
  deep_eq(silent.given, { itemOf(401), itemOf(403) })
  -- an item leaves with an event, and no accept event comes: the change tells
  local changed = setup({ bags = three() })
  changed.trade.listen()
  give(changed, { itemOf(401), itemOf(402), itemOf(403) })
  changed.game.advance(5)
  changed.world.slots[2], changed.world.slotFrom[2] = nil, nil
  changed.game.send("TRADE_PLAYER_ITEM_CHANGED", 2)
  changed.world.accept({ noFlags = true })
  changed.game.advance(1.5)
  deep_eq(changed.given, { itemOf(401), itemOf(403) })
end)

test("two copies asked for, one taken out of the window, and no message: only the copy that left the bags is given", function()
  local scene = setup({ bags = { [0] = { [3] = { id = 401, name = "Crown" }, [6] = { id = 401, name = "Crown" } } } })
  scene.trade.listen()
  give(scene, { itemOf(401), itemOf(401) })
  scene.game.advance(4)
  scene.world.slots[2], scene.world.slotFrom[2] = nil, nil
  scene.game.send("TRADE_PLAYER_ITEM_CHANGED", 2)
  scene.world.accept({ silent = true })
  scene.game.advance(1.5)
  eq(scene.completed, 1)
  eq(scene.db.tradetest.runs[1].completedBy, "bags")
  deep_eq(scene.given, { itemOf(401) })
  is_true(scene.world.bags[0][6] ~= nil)
end)

test("a window that closes while the items are going in stops the rest and leaves nothing on the cursor", function()
  local scene = setup({ bags = three() })
  scene.trade.listen()
  give(scene, { itemOf(401), itemOf(402), itemOf(403) })
  scene.game.advance(1.15) -- the first item is in, the second is a moment away
  eq(calls(scene), "initiate pickup click")
  scene.world.cancel()
  scene.game.advance(3)
  eq(calls(scene), "initiate pickup click")
  eq(scene.world.cursor, nil)
  eq(scene.completed, 0)
  eq(scene.db.tradetest.runs[1].result, "cancelled")
end)

test("a bag slot already taken by an earlier item is not used again when an item has moved", function()
  local scene = setup({ bags = { [0] = { [3] = { id = 401, name = "Crown" }, [5] = { id = 401, name = "Crown" } } } })
  local bag, slot = scene.trade.locate(itemOf(401), { ["0:3"] = true })
  deep_eq({ bag, slot }, { 0, 5 })
  bag = scene.trade.locate(itemOf(401), { ["0:3"] = true, ["0:5"] = true })
  eq(bag, nil)
end)

test("a window that is open with somebody else is never used: the items would go to the wrong player", function()
  local scene = setup({ partner = "Tavian Holt" })
  scene.trade.listen()
  scene.world.openWindow() -- the loot master has a trade open with another player
  eq(give(scene), false)
  is_true(said(scene, "a trade window is open, and it is not clear that it is with Mirelle Dunmore. Close it, then try again."))
  scene.game.advance(3)
  eq(#scene.world.calls, 0)
  eq(scene.trade.running(), false)
  eq(scene.db.tradetest, nil)
  -- the same window, once the other player is the one it is open with
  scene.world.partner = "Mirelle Dunmore"
  eq(give(scene), true)
  scene.game.advance(2)
  deep_eq(scene.results, { "placed" })
end)

test("a window whose other party cannot be told is not used either, and a realm after the name does not matter", function()
  local unknown = setup({ partnerUnknown = true })
  unknown.trade.listen()
  unknown.world.openWindow()
  eq(give(unknown), false)
  eq(#unknown.world.calls, 0)
  local realm = setup({ partner = "mirelle  DUNMORE-Somewhere" })
  realm.trade.listen()
  realm.world.openWindow()
  eq(give(realm), true)
  realm.game.advance(2)
  deep_eq(realm.results, { "placed" })
end)

test("the window the addon opened is used again for the same player, and is not used for another one", function()
  local scene = setup({ partnerUnknown = true }) -- (the game cannot tell who it is with: the addon knows, it opened it)
  scene.trade.listen()
  give(scene)
  scene.game.advance(2) -- opened, the first item is in
  deep_eq(scene.results, { "placed" })
  eq(give(scene, "item:402::::::::70", { label = "Tavian Holt", unit = "party1" }), false)
  is_true(said(scene, "a trade window is open, and it is not clear that it is with Tavian Holt."))
  eq(scene.trade.running(), true) -- the first run is still waiting for the close
  eq(give(scene, "item:402::::::::70"), true) -- the same player: the next item goes into the open window
  scene.game.advance(1)
  eq(scene.db.tradetest.runs[1].result, "left open")
  deep_eq(scene.results, { "placed", "placed" })
  -- after the window closed it is nobody's again
  scene.world.cancel()
  scene.game.advance(2)
  scene.world.openWindow()
  eq(give(scene, "item:402::::::::70"), false)
end)
