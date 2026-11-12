-- Intrepid Manager: the council session, pure logic (no client calls). The loot master queues items and starts a session; every raider
-- answers each item (Best in slot, Upgrade, Off-spec or Pass, with a note) before a timer runs out; the loot master sees the answers.
-- The other side of the same exchange is what a raider has been offered. Time comes in as a function (GetTime in the game), so the
-- tests can move it. The wire format is net/CouncilWire.lua; the client side is game/CouncilSession.lua.
--
--   local session = ns.Council.newSession({ now = GetTime, id = "k3f9" })
--   session.add("item:12345")                              --> 1
--   session.start()                                        --> true
--   session.respond(1, "Mirelle Dunmore", "u", "my first") --> true
--   session.rows(1)                                        --> { { who = "Mirelle Dunmore", code = "u", label = "Upgrade", note = ... } }
--
--   local offers = ns.Council.newOffers({ now = GetTime })
--   offers.receive("k3f9", "Jorren Ashvale", 1, 3, 60, "item:12345")
--   offers.answer("k3f9", 1, "u", "my first")

local _, ns = ...

local Council = {}
ns.Council = Council

Council.DEFAULT_TIMER = 60
Council.MIN_TIMER = 5
Council.MAX_TIMER = 600
Council.MAX_ITEMS = 20
Council.GRACE = 3 -- seconds the loot master still takes an answer after the timer: it takes time to arrive

-- The buttons of a raider's answer, best claim first. The code is what travels.
Council.RESPONSES = {
  { code = "b", label = "Best in slot", short = "BiS" },
  { code = "u", label = "Upgrade", short = "Upgrade" },
  { code = "o", label = "Off-spec", short = "Off-spec" },
  { code = "p", label = "Pass", short = "Pass" },
}
local BY_CODE = {}
for rank, response in ipairs(Council.RESPONSES) do
  response.rank = rank
  BY_CODE[response.code] = response
end

local WORDS = {
  b = "b", bis = "b", best = "b",
  u = "u", up = "u", upgrade = "u",
  o = "o", os = "o", off = "o", offspec = "o", ["off-spec"] = "o",
  p = "p", pass = "p",
}

-- The code a typed word stands for ("bis", "up", "os", "pass" and a few more), or nil.
function Council.codeOf(word)
  if type(word) ~= "string" then return nil end
  return WORDS[string.lower(word)]
end

function Council.response(code) return BY_CODE[code] end
function Council.label(code) return BY_CODE[code] and BY_CODE[code].label or tostring(code) end

-- An item string as the game's links carry it: "item:12345" or "item:12345::::::::70:::::".
function Council.isItem(text)
  return type(text) == "string" and #text <= 120 and string.match(text, "^item:%d+[%d:%-]*$") ~= nil
end

-- The id inside an item string.
function Council.itemId(item)
  return tonumber(string.match(item or "", "^item:(%d+)"))
end

---------------------------------------------------------------------------------------------------------------
-- The loot master's session
---------------------------------------------------------------------------------------------------------------

-- options: now (function), id (short text that tells sessions apart), timer (seconds, default 60).
function Council.newSession(options)
  local now = options.now
  local self = { id = options.id, timer = options.timer or Council.DEFAULT_TIMER, state = "building" }
  local items = {}
  local startedAt, deadline

  -- Queue an item (before the start); meta is { name, quality } for the windows (the name as the link shows it, the quality 0 to 5).
  -- Returns its number, or nil and why.
  function self.add(item, meta)
    if self.state ~= "building" then return nil, "The session has started. Add items before you start it." end
    if not Council.isItem(item) then return nil, "That is not an item." end
    if #items >= Council.MAX_ITEMS then return nil, "At most " .. Council.MAX_ITEMS .. " items in one session." end
    meta = meta or {}
    items[#items + 1] = { n = #items + 1, item = item, name = meta.name, quality = meta.quality, responses = {}, order = {} }
    return #items
  end

  -- Take an item out of the queue (before the start); the items after it move up one number.
  function self.remove(n)
    if self.state ~= "building" then return false, "The session has started." end
    if not items[n] then return false, "There is no item " .. tostring(n) .. "." end
    table.remove(items, n)
    for i, entry in ipairs(items) do entry.n = i end
    return true
  end

  function self.count() return #items end
  function self.item(n) return items[n] end

  -- The items in order: { { n, item, name, quality, winner, given }, ... } (the answers are read with rows and counts). winner is
  -- the name the loot master awarded the item to; given is true once the trade went through.
  function self.items()
    local list = {}
    for i, entry in ipairs(items) do
      list[i] = { n = entry.n, item = entry.item, name = entry.name, quality = entry.quality, winner = entry.winner, given = entry.given }
    end
    return list
  end

  -- The loot master decides who gets item n: `who` is the winner's full name, or nil to take the award back. Nothing is awarded before
  -- the start, and an item that was given cannot be awarded again. Returns true, or false and why.
  function self.award(n, who)
    local entry = items[n]
    if not entry then return false, "There is no item " .. tostring(n) .. "." end
    if self.state == "building" then return false, "Start the session first." end
    if entry.given then return false, "Item " .. n .. " was given already." end
    if who ~= nil and (type(who) ~= "string" or ns.Names.key(who) == "") then return false, "No name." end
    entry.winner = who
    return true
  end

  -- The trade went through: item n is with its winner. Returns true, or false and why.
  function self.give(n)
    local entry = items[n]
    if not entry then return false, "There is no item " .. tostring(n) .. "." end
    if not entry.winner then return false, "Item " .. n .. " is not awarded to anybody." end
    entry.given = true
    return true
  end

  -- What `who` has won and not been given yet, in order: { { n, item, name, quality }, ... }. Names match without regard to case.
  function self.wonBy(who)
    local key = ns.Names.key(who)
    local list = {}
    for _, entry in ipairs(items) do
      if entry.winner and not entry.given and ns.Names.key(entry.winner) == key then
        list[#list + 1] = { n = entry.n, item = entry.item, name = entry.name, quality = entry.quality }
      end
    end
    return list
  end

  -- How many awarded items are not given yet.
  function self.pending()
    local total = 0
    for _, entry in ipairs(items) do
      if entry.winner and not entry.given then total = total + 1 end
    end
    return total
  end

  -- Start the session: from now on answers are taken until the timer (plus a short grace) runs out.
  function self.start(seconds)
    if self.state ~= "building" then return false, "The session has started already." end
    if #items == 0 then return false, "Add at least one item first." end
    if seconds ~= nil then
      if type(seconds) ~= "number" or seconds < Council.MIN_TIMER or seconds > Council.MAX_TIMER then
        return false, "The timer is " .. Council.MIN_TIMER .. " to " .. Council.MAX_TIMER .. " seconds."
      end
      self.timer = seconds
    end
    self.state = "running"
    startedAt = now()
    deadline = startedAt + self.timer
    return true
  end

  function self.startedAt() return startedAt end

  -- Seconds left on the timer (never below 0), or nil when the session is not running.
  function self.remaining()
    if self.state ~= "running" then return nil end
    return math.max(0, deadline - now())
  end

  -- Take one raider's answer: item number, the name the game gave, a code of Council.RESPONSES, a note. A raider may change the
  -- answer until the time is up; the last one counts. Returns true and whether it replaced an earlier answer, or false and why.
  function self.respond(n, who, code, note)
    if self.state ~= "running" then return false, "There is no session taking answers." end
    if now() > deadline + Council.GRACE then return false, "Time is up." end
    local entry = items[n]
    if not entry then return false, "There is no item " .. tostring(n) .. "." end
    if not BY_CODE[code] then return false, "Unknown answer." end
    if type(who) ~= "string" or who == "" then return false, "No name." end
    local key = ns.Names.key(who)
    local replaced = entry.responses[key] ~= nil
    entry.responses[key] = { who = who, key = key, code = code, label = BY_CODE[code].label, note = note or "", at = now() - startedAt }
    if not replaced then entry.order[#entry.order + 1] = key end
    return true, replaced
  end

  -- The answers for an item, best claim first and earlier first within the same claim.
  function self.rows(n)
    local entry = items[n]
    if not entry then return {} end
    local rows = {}
    for _, key in ipairs(entry.order) do rows[#rows + 1] = entry.responses[key] end
    table.sort(rows, function(a, b)
      local ra, rb = BY_CODE[a.code].rank, BY_CODE[b.code].rank
      if ra ~= rb then return ra < rb end
      if a.at ~= b.at then return a.at < b.at end
      return a.key < b.key
    end)
    return rows
  end

  -- How many answered each way for an item: { b = 1, u = 2, o = 0, p = 3, total = 6 }.
  function self.counts(n)
    local counts = { b = 0, u = 0, o = 0, p = 0, total = 0 }
    local entry = items[n]
    if not entry then return counts end
    for _, key in ipairs(entry.order) do
      local response = entry.responses[key]
      counts[response.code] = counts[response.code] + 1
      counts.total = counts.total + 1
    end
    return counts
  end

  -- The distinct raiders who answered anything.
  function self.responders()
    local seen, total = {}, 0
    for _, entry in ipairs(items) do
      for key in pairs(entry.responses) do
        if not seen[key] then
          seen[key] = true
          total = total + 1
        end
      end
    end
    return total
  end

  -- Close the session once the timer and the grace are over. Returns true when it closed now.
  function self.expire()
    if self.state == "running" and now() > deadline + Council.GRACE then
      self.state = "closed"
      return true
    end
    return false
  end

  -- End it now.
  function self.close()
    if self.state == "closed" then return false end
    self.state = "closed"
    return true
  end

  return self
end

---------------------------------------------------------------------------------------------------------------
-- What a raider has been offered
---------------------------------------------------------------------------------------------------------------

-- options: now (function).
function Council.newOffers(options)
  local now = options.now
  local self = {}
  local list = {}
  local byKey = {}

  local function key(sid, n) return sid .. "/" .. n end

  -- An item offered by the loot master `master`; meta is { name, quality } as the offer told them. Returns the offer and whether it
  -- is new (a repeat changes nothing).
  function self.receive(sid, master, n, count, timer, item, meta)
    local k = key(sid, n)
    if byKey[k] then return byKey[k], false end
    meta = meta or {}
    local offer = {
      sid = sid, n = n, count = count, master = master, item = item, name = meta.name, quality = meta.quality, timer = timer,
      deadline = now() + timer, state = "open",
    }
    byKey[k] = offer
    list[#list + 1] = offer
    return offer, true
  end

  function self.get(sid, n) return byKey[key(sid, n)] end

  -- Seconds left for an offer, never below 0.
  function self.remaining(offer)
    if offer.state == "closed" then return 0 end
    return math.max(0, offer.deadline - now())
  end

  -- The raider's answer to an offer; it can be changed until the time is up. Returns the offer, or nil and why.
  function self.answer(sid, n, code, note)
    local offer = byKey[key(sid, n)]
    if not offer then return nil, "There is no such item on offer." end
    if not BY_CODE[code] then return nil, "Unknown answer." end
    if offer.state == "closed" or now() > offer.deadline then
      offer.state = "closed"
      return nil, "Time is up for that item."
    end
    offer.myCode, offer.myNote, offer.state = code, note or "", "answered"
    return offer
  end

  -- Close every offer whose time is up. Returns the ones closed now.
  function self.expire()
    local closed = {}
    for _, offer in ipairs(list) do
      if offer.state ~= "closed" and now() > offer.deadline then
        offer.state = "closed"
        closed[#closed + 1] = offer
      end
    end
    return closed
  end

  -- The loot master ended the session: close its offers. Returns the ones closed now.
  function self.endSession(sid)
    local closed = {}
    for _, offer in ipairs(list) do
      if offer.sid == sid and offer.state ~= "closed" then
        offer.state = "closed"
        closed[#closed + 1] = offer
      end
    end
    return closed
  end

  -- Every offer, in the order received.
  function self.list()
    local copy = {}
    for i, offer in ipairs(list) do copy[i] = offer end
    return copy
  end

  -- The offers that still take an answer, in order.
  function self.open()
    local open = {}
    for _, offer in ipairs(list) do
      if offer.state ~= "closed" and now() <= offer.deadline then open[#open + 1] = offer end
    end
    return open
  end

  return self
end
