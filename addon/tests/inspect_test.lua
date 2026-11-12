-- /im inspect (IntrepidManager/ui/Inspect.lua) on the stand-in game with a fake client. Invented data only.

local UI = dofile("tests/support/strict_ui.lua")

-- A game whose client can inspect a target. options: noTarget, cannot (CanInspect says no), noNotify, raises.
local function setup(options)
  options = options or {}
  local game = UI.new()
  local env = game.env
  local scene = { game = game, said = {}, db = {}, notified = 0, cleared = 0 }
  env.GetTime = function() return game.clock end
  env.UnitExists = function() return not options.noTarget end
  env.CanInspect = function() return not options.cannot end
  if not options.noNotify then
    env.NotifyInspect = function()
      scene.notified = scene.notified + 1
      if options.raises then error("not allowed") end
    end
  end
  env.GetInventoryItemLink = function(_, slot)
    if slot == 1 or slot == 16 or slot == 19 then return "|cffa335ee|Hitem:" .. (200 + slot) .. "::::|h[Thing]|h|r" end
  end
  env.C_Item = { GetDetailedItemLevelInfo = function() return 141 end }
  env.UnitClass = function() return "Warrior", "WARRIOR" end
  env.UnitLevel = function() return 70 end
  env.ClearInspectPlayer = function() scene.cleared = scene.cleared + 1 end
  local ns = {}
  game.load("IntrepidManager/ui/Inspect.lua", ns)
  scene.inspect = ns.UI.Inspect.new({ out = function(text) scene.said[#scene.said + 1] = text end, db = scene.db })
  return scene
end

test("the game answers in time: the items are recorded without names, the class and level too, and the answer is told", function()
  local scene = setup()
  scene.inspect.run()
  eq(scene.notified, 1)
  is_true(string.find(scene.said[1], "Inspecting your target", 1, true) ~= nil)
  scene.game.advance(0.8)
  scene.game.send("INSPECT_READY")
  eq(#scene.db.inspect, 1)
  local result = scene.db.inspect[1]
  eq(result.ready, true)
  eq(result.seconds, 0.8)
  eq(result.count, 3)
  deep_eq(result.items, { ["1"] = 201, ["16"] = 216, ["19"] = 219 })
  deep_eq(result.levels, { ["1"] = 141, ["16"] = 141, ["19"] = 141 })
  eq(result.class, "WARRIOR")
  eq(result.level, 70)
  eq(scene.cleared, 1)
  is_true(string.find(scene.said[2], "the game answered after 0.8 seconds with 3 items", 1, true) ~= nil)
  scene.game.advance(10) -- the waiting timer finds nothing to do
  eq(#scene.db.inspect, 1)
  eq(#scene.said, 2)
end)

test("the game does not answer: that is recorded after four seconds, with what could be read", function()
  local scene = setup()
  scene.inspect.run()
  scene.game.advance(3.9)
  eq(scene.db.inspect, nil)
  scene.game.advance(0.2)
  eq(scene.db.inspect[1].ready, false)
  eq(scene.db.inspect[1].seconds, 4)
  is_true(string.find(scene.said[#scene.said], "did not answer in 4 seconds", 1, true) ~= nil)
  scene.game.send("INSPECT_READY") -- an answer that comes too late is not counted twice
  eq(#scene.db.inspect, 1)
end)

test("without a target, a target that cannot be inspected, no NotifyInspect, or a refusal, it says so and records nothing", function()
  local none = setup({ noTarget = true })
  none.inspect.run()
  eq(none.said[1], "Target a player first, then type /im inspect.")
  eq(none.notified, 0)
  local far = setup({ cannot = true })
  far.inspect.run()
  is_true(string.find(far.said[1], "cannot be inspected", 1, true) ~= nil)
  eq(far.notified, 0)
  local missing = setup({ noNotify = true })
  missing.inspect.run()
  eq(missing.said[1], "Inspect: this client has no NotifyInspect.")
  local refused = setup({ raises = true })
  refused.inspect.run()
  is_true(string.find(refused.said[1], "not allowed", 1, true) ~= nil)
  refused.game.advance(10)
  eq(refused.db.inspect, nil)
end)

test("asking again while the last answer is awaited waits, and asking after it starts a new one", function()
  local scene = setup()
  scene.inspect.run()
  scene.inspect.run()
  eq(scene.notified, 1)
  is_true(string.find(scene.said[#scene.said], "still waiting", 1, true) ~= nil)
  scene.game.send("INSPECT_READY")
  scene.inspect.run()
  eq(scene.notified, 2)
  scene.game.send("INSPECT_READY")
  eq(#scene.db.inspect, 2)
end)

test("a client without the helpers still gets a record, with nothing in it", function()
  local scene = setup()
  scene.game.env.GetInventoryItemLink = nil
  scene.game.env.UnitClass = nil
  scene.game.env.ClearInspectPlayer = nil
  scene.inspect.run()
  scene.game.send("INSPECT_READY")
  eq(scene.db.inspect[1].count, 0)
  eq(scene.db.inspect[1].class, nil)
end)
