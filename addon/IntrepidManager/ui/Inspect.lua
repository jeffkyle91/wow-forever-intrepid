-- Intrepid Manager: /im inspect. Asks the game to inspect the player you are targeting and records what came back: how long it
-- took, how many slots had an item, the item ids and levels (no names), the class and level. A council window would like to show
-- what each candidate wears; this says whether the game lets an addon see that, and how fast. It changes nothing.
--
--   local inspect = ns.UI.Inspect.new({ out = print, db = IntrepidManagerDB })
--   inspect.run()      -- the player you are targeting; the result is in db.inspect and in the chat

local _, ns = ...

local Inspect = {}
ns.UI = ns.UI or {}
ns.UI.Inspect = Inspect

local WAIT = 4 -- seconds the game gets to answer
local SLOTS = 19

function Inspect.new(context)
  local out = context.out or print
  local db = context.db or {}
  local self = {}
  local frame
  local running

  local function finish(ready)
    if not running then return end
    local started = running.started
    running = nil
    local result = { ready = ready, seconds = math.floor((GetTime() - started) * 100 + 0.5) / 100, count = 0, items = {}, levels = {} }
    local function call(name, ...)
      local fn = _G[name]
      if type(fn) ~= "function" then return nil end
      local ok, a, b = pcall(fn, ...)
      if ok then return a, b end
    end
    for slot = 1, SLOTS do
      local link = call("GetInventoryItemLink", "target", slot)
      local id = type(link) == "string" and tonumber(string.match(link, "item:(%d+)"))
      if id then
        result.count = result.count + 1
        result.items[tostring(slot)] = id
        local holder = _G.C_Item
        local ok, level = pcall(function() return holder.GetDetailedItemLevelInfo(link) end)
        if ok and level then result.levels[tostring(slot)] = level end
      end
    end
    local _, class = call("UnitClass", "target")
    result.class = class
    result.level = call("UnitLevel", "target")
    call("ClearInspectPlayer")
    db.inspect = db.inspect or {}
    db.inspect[#db.inspect + 1] = result
    if ready then
      out("Inspect: the game answered after " .. result.seconds .. " seconds with " .. result.count .. " items. Type /reload to save it.")
    else
      out("Inspect: the game did not answer in " .. WAIT .. " seconds (" .. result.count .. " items read anyway). Stand closer, or try another player.")
    end
  end

  function self.run()
    if not UnitExists("target") then
      out("Target a player first, then type /im inspect.")
      return
    end
    if running then
      out("Inspect: still waiting for the last answer.")
      return
    end
    running = { started = GetTime() }
    local can = _G.CanInspect
    if type(can) == "function" then
      local ok, answer = pcall(can, "target")
      if ok and not answer then
        running = nil
        out("Inspect: the game says this player cannot be inspected (too far away, or not a player). Stand closer.")
        return
      end
    end
    if not frame then
      frame = CreateFrame("Frame")
      frame:RegisterEvent("INSPECT_READY")
      frame:SetScript("OnEvent", function(_, event)
        if event == "INSPECT_READY" then finish(true) end
      end)
    end
    local notify = _G.NotifyInspect
    if type(notify) ~= "function" then
      running = nil
      out("Inspect: this client has no NotifyInspect.")
      return
    end
    local ok, err = pcall(notify, "target")
    if not ok then
      running = nil
      out("Inspect: " .. tostring(err))
      return
    end
    out("Inspecting your target. This takes a moment.")
    C_Timer.After(WAIT, function() finish(false) end)
  end

  self.frame = function() return frame end
  return self
end
