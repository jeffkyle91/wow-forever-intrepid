-- A stand-in for the server side of addon messages, for tests with two or more stand-in games (tests/support/strict_ui.lua)
-- that talk to each other. Each game that joins gets C_ChatInfo (RegisterAddonMessagePrefix, SendAddonMessage,
-- AreOutgoingAddonChatMessagesRestricted), Enum, IsInGroup, IsInRaid, GetNumGroupMembers, GetTimePreciseSec,
-- IsEncounterInProgress and InCombatLockdown, and receives CHAT_MSG_ADDON events for what the others send. What the real
-- server does is only known from measurements (see Addon-Handoff.md), so the options are knobs for testing a client's
-- reaction, not a model of the server.
--
--   local world = FakeChat.new({ delay = 0.3, tick = 0.7, perTick = 3, burst = 10 })
--   local one = world.join(gameOne, "Jorren Ashvale")      -- the name other clients see as the sender
--   world.advance(30)                                      -- 30 seconds pass in every joined game, messages arrive on the way
--
-- options: delay (seconds from sending to arriving, default 0.3), tick (when above 0, messages arrive only at multiples of
-- it), perTick (at most this many messages arrive per recipient per tick, the rest wait a tick), maxLength (default 255),
-- burst (a client may send this many messages in one instant, then gets AddonMessageThrottle; with perPrefix each prefix has its
-- own allowance), drop(delivery) (true loses
-- that delivery), reorder(batch) (returns the deliveries that arrive in the same instant in the order to deliver them).
-- A delivery is { from, to, text, chat, number }.
--
-- A client has: name, inGroup (default true), raid, encounter (sends return AddOnMessageLockdown), combat, offset (added to
-- its GetTimePreciseSec, to show that two clocks differ), prefixes (the registered ones), received (count), class (a class token, for
-- UnitClass), connected (false: UnitIsConnected says no).
--
-- The group as a client sees it: "player" is the client, party1 to party4 (or raid1 to raidN, the client included) are the clients
-- that joined, in the order they joined: UnitExists, GetUnitName, UnitClass (only for clients that have a class) and UnitIsConnected
-- answer for them.

local FakeChat = {}

local SEND = {
  Success = 0, InvalidPrefix = 1, InvalidMessage = 2, AddonMessageThrottle = 3, InvalidChatType = 4, NotInGroup = 5,
  TargetRequired = 6, InvalidChannel = 7, ChannelThrottle = 8, GeneralError = 9, NotInGuild = 10, AddOnMessageLockdown = 11,
  TargetOffline = 12,
}
local REGISTER = { Success = 0, DuplicatePrefix = 1, InvalidPrefix = 2, MaxPrefixes = 3 }
FakeChat.SEND = SEND

function FakeChat.new(options)
  options = options or {}
  local world = { time = 0, clients = {}, queue = {}, sends = 0, delivered = {} }
  local order = 0

  local function arrival(sentAt)
    local at = sentAt + (options.delay or 0.3)
    local tick = options.tick or 0
    if tick > 0 then at = math.ceil(at / tick - 1e-9) * tick end
    return at
  end

  local function byName(name)
    for _, client in ipairs(world.clients) do
      if client.name == name then return client end
    end
  end

  function world.join(game, name)
    local client = { game = game, name = name, inGroup = true, offset = 0, prefixes = {}, received = 0, instant = nil, counts = {}, base = game.clock }
    world.clients[#world.clients + 1] = client
    local env = game.env
    env.Enum = { SendAddonMessageResult = SEND, RegisterAddonMessagePrefixResult = REGISTER }
    env.IsInGroup = function() return client.inGroup end
    env.IsInRaid = function() return client.inGroup and client.raid or false end
    env.GetNumGroupMembers = function()
      if not client.inGroup then return 0 end
      return #world.clients
    end
    local function unitClient(unit)
      if unit == "player" then return client end
      local others = {}
      for _, other in ipairs(world.clients) do
        if other.inGroup and (client.raid or other ~= client) then others[#others + 1] = other end
      end
      if client.raid then
        local index = tonumber(string.match(unit or "", "^raid(%d+)$"))
        return index and others[index] or nil
      end
      local index = tonumber(string.match(unit or "", "^party(%d)$"))
      return index and others[index] or nil
    end
    env.UnitExists = function(unit) return unitClient(unit) ~= nil end
    env.GetUnitName = function(unit) local found = unitClient(unit); return found and found.name or nil end
    env.UnitClass = function(unit)
      local found = unitClient(unit)
      if found and found.class then return found.class, found.class, 1 end
    end
    env.UnitIsConnected = function(unit)
      local found = unitClient(unit)
      return found ~= nil and found.connected ~= false
    end
    env.GetTimePreciseSec = function() return game.clock + client.offset end
    env.IsEncounterInProgress = function() return client.encounter or false end
    env.InCombatLockdown = function() return client.combat or false end
    env.C_ChatInfo = {
      RegisterAddonMessagePrefix = function(prefix)
        if type(prefix) ~= "string" or #prefix == 0 or #prefix > 16 then return REGISTER.InvalidPrefix end
        if client.prefixes[prefix] then return REGISTER.DuplicatePrefix end
        client.prefixes[prefix] = true
        return REGISTER.Success
      end,
      AreOutgoingAddonChatMessagesRestricted = function() return true end,
      SendAddonMessage = function(prefix, text, chat, target)
        if client.encounter then return SEND.AddOnMessageLockdown end
        if not client.prefixes[prefix] then return SEND.InvalidPrefix end
        if type(text) ~= "string" or #text > (options.maxLength or 255) then return SEND.InvalidMessage end
        if chat ~= "PARTY" and chat ~= "RAID" and chat ~= "WHISPER" then return SEND.InvalidChatType end
        if chat == "WHISPER" then
          if not target then return SEND.TargetRequired end
          if not byName(target) then return SEND.TargetOffline end
        elseif not client.inGroup then
          return SEND.NotInGroup
        end
        if client.instant ~= game.clock then client.instant, client.counts = game.clock, {} end
        local bucket = options.perPrefix and prefix or "all"
        client.counts[bucket] = (client.counts[bucket] or 0) + 1
        if options.burst and client.counts[bucket] > options.burst then return SEND.AddonMessageThrottle end
        world.sends = world.sends + 1
        local recipients = {}
        if chat == "WHISPER" then
          recipients[1] = byName(target)
        else
          for _, other in ipairs(world.clients) do
            if other.inGroup then recipients[#recipients + 1] = other end
          end
        end
        for _, recipient in ipairs(recipients) do
          local delivery = { from = name, to = recipient.name, text = text, chat = chat, number = world.sends, prefix = prefix }
          if not (options.drop and options.drop(delivery)) then
            order = order + 1
            world.queue[#world.queue + 1] = { at = arrival(game.clock - client.base), order = order, delivery = delivery, recipient = recipient }
          end
        end
        return SEND.Success
      end,
    }
    return client
  end

  local function deliver()
    local due = {}
    local keep = {}
    for _, item in ipairs(world.queue) do
      if item.at <= world.time + 1e-9 then due[#due + 1] = item else keep[#keep + 1] = item end
    end
    world.queue = keep
    table.sort(due, function(a, b)
      if a.at ~= b.at then return a.at < b.at end
      return a.order < b.order
    end)
    -- Group what arrives in the same instant per recipient, apply the cap and the reordering, then deliver.
    local batches, names = {}, {}
    for _, item in ipairs(due) do
      local name = item.recipient.name
      if not batches[name] then batches[name] = {} names[#names + 1] = name end
      local batch = batches[name]
      batch[#batch + 1] = item
    end
    for _, name in ipairs(names) do
      local batch = batches[name]
      local cap = options.perTick
      local now = {}
      for _, item in ipairs(batch) do
        if cap and #now >= cap then
          item.at = item.at + (options.tick or 0.7)
          world.queue[#world.queue + 1] = item
        else
          now[#now + 1] = item
        end
      end
      if options.reorder then
        local deliveries = {}
        for _, item in ipairs(now) do deliveries[#deliveries + 1] = item.delivery end
        local sorted = options.reorder(deliveries)
        local rebuilt = {}
        for _, delivery in ipairs(sorted) do
          for _, item in ipairs(now) do
            if item.delivery == delivery then rebuilt[#rebuilt + 1] = item break end
          end
        end
        now = rebuilt
      end
      for _, item in ipairs(now) do
        item.recipient.received = item.recipient.received + 1
        world.delivered[#world.delivered + 1] = item.delivery
        item.recipient.game.send("CHAT_MSG_ADDON", item.delivery.prefix, item.delivery.text, item.delivery.chat, item.delivery.from)
      end
    end
  end

  function world.advance(seconds, step)
    step = step or 0.05
    local target = world.time + seconds
    while world.time < target - 1e-9 do
      local dt = math.min(step, target - world.time)
      world.time = world.time + dt
      for _, client in ipairs(world.clients) do client.game.advance(dt) end
      deliver()
    end
  end

  return world
end

return FakeChat
