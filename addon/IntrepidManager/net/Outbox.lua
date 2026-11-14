-- Intrepid Manager: the sender queue of addon messages. The game limits each prefix on group chat to a burst of 10 messages and then
-- about 1 per second, and refuses what is over with AddonMessageThrottle instead of sending it (measured 2026-10-21, Addon-Handoff.md
-- section 7). Whispers have no such limit. During a boss fight the game refuses every send (AddOnMessageLockdown). This queue
-- keeps its own count of the allowance so that it rarely asks for more than the game gives, sends in the order pushed, retries a
-- message the game refused for either reason, and drops one the game will never take (wrong chat type, not in a group).
--
--   local box = ns.Net.Outbox.new({
--     send = function(prefix, text, chat, target) return C_ChatInfo.SendAddonMessage(prefix, text, chat, target) end,
--     now = GetTime, after = C_Timer.After, prefix = "IMC1", encounter = IsEncounterInProgress,
--   })
--   box.push("I~1~k3f9~1~3~60~item:12345", "RAID")        -- group chat: in order, within the allowance
--   box.push("R~1~k3f9~1~u~~~", "WHISPER", "Jorren Ashvale") -- whisper: at once

local _, ns = ...

local Outbox = {}
ns.Net = ns.Net or {}
ns.Net.Outbox = Outbox

Outbox.CAPACITY = 10
Outbox.REFILL = 1 -- messages per second
Outbox.RETRY_THROTTLED = 1.1 -- seconds before asking again after AddonMessageThrottle
Outbox.RETRY_HELD = 3 -- seconds before asking again during a boss fight
Outbox.MAX_TRIES = 20

-- The numbers of Enum.SendAddonMessageResult (probe results).
local RESULT_THROTTLE, RESULT_LOCKDOWN = 3, 11

local function resultName(code)
  local enum = Enum and Enum.SendAddonMessageResult
  if type(code) == "number" and enum then
    for name, value in pairs(enum) do
      if value == code then return name end
    end
  end
  return tostring(code)
end

-- options: send (prefix, text, chat, target) -> result code; now (); after (seconds, function); prefix; encounter () -> true during a
-- boss fight (optional); capacity and refill (default 10 and 1 per second); onDrop (entry, why) (optional).
function Outbox.new(options)
  local send, now, after = options.send, options.now, options.after
  local prefix = options.prefix
  local capacity = options.capacity or Outbox.CAPACITY
  local refillRate = options.refill or Outbox.REFILL
  local self = {}

  local group, whispers = {}, {}
  local tokens, last = capacity, now()
  local generation = 0
  local stats = { sent = 0, throttled = 0, held = 0, dropped = 0 }

  local function refill()
    local t = now()
    tokens = math.min(capacity, tokens + (t - last) * refillRate)
    last = t
  end

  local drain

  -- Ask for another look in `seconds`; a look made sooner by something else cancels this one.
  local function later(seconds)
    local mine = generation
    after(seconds, function()
      if generation == mine then drain() end
    end)
  end

  local function drop(entry, why)
    stats.dropped = stats.dropped + 1
    if options.onDrop then options.onDrop(entry, why) end
  end

  -- One try. Returns "sent", "throttled", "held" or "dropped".
  local function attempt(entry)
    entry.tries = entry.tries + 1
    local ok, code = pcall(send, prefix, entry.text, entry.chat, entry.target)
    if not ok then
      drop(entry, "error: " .. string.sub(tostring(code), 1, 60))
      return "dropped"
    end
    if code == 0 or code == true or code == nil then
      stats.sent = stats.sent + 1
      return "sent"
    end
    if entry.tries >= Outbox.MAX_TRIES then
      drop(entry, "gave up after " .. entry.tries .. " tries (" .. resultName(code) .. ")")
      return "dropped"
    end
    if code == RESULT_THROTTLE then
      stats.throttled = stats.throttled + 1
      return "throttled"
    end
    if code == RESULT_LOCKDOWN then
      stats.held = stats.held + 1
      return "held"
    end
    drop(entry, resultName(code))
    return "dropped"
  end

  drain = function()
    generation = generation + 1
    refill()
    local fight = options.encounter and options.encounter()
    -- Whispers have no allowance: send them in order until the game refuses one.
    while #whispers > 0 and not fight do
      local outcome = attempt(whispers[1])
      if outcome == "sent" or outcome == "dropped" then
        table.remove(whispers, 1)
      else
        later(outcome == "held" and Outbox.RETRY_HELD or Outbox.RETRY_THROTTLED)
        break
      end
    end
    while #group > 0 and not fight do
      refill()
      if tokens < 1 then
        later((1 - tokens) / refillRate + 0.05)
        break
      end
      local outcome = attempt(group[1])
      if outcome == "sent" then
        tokens = tokens - 1
        table.remove(group, 1)
      elseif outcome == "dropped" then
        table.remove(group, 1)
      else
        if outcome == "throttled" then tokens = 0 end -- the game says the allowance is used up: believe it
        later(outcome == "held" and Outbox.RETRY_HELD or Outbox.RETRY_THROTTLED)
        break
      end
    end
    if fight and (#group > 0 or #whispers > 0) then later(Outbox.RETRY_HELD) end
  end

  -- Queue a message. chat is "PARTY", "RAID" or another group chat, or "WHISPER" with the name in target.
  function self.push(text, chat, target)
    local entry = { text = text, chat = chat, target = target, tries = 0 }
    if chat == "WHISPER" then
      whispers[#whispers + 1] = entry
    else
      group[#group + 1] = entry
    end
    drain()
    return true
  end

  function self.pending() return #group + #whispers end

  function self.stats()
    return { sent = stats.sent, throttled = stats.throttled, held = stats.held, dropped = stats.dropped, pending = #group + #whispers }
  end

  -- Forget everything waiting (the session ended).
  function self.clear()
    group, whispers = {}, {}
    generation = generation + 1
  end

  return self
end
