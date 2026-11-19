-- Intrepid Manager: /im msgtest. Measures what addon messages do on this server between two clients in the same group, before the
-- council messages (responses, votes, tallies) are built on them. One client types /im msgtest run; the other only needs the addon:
-- it listens from the start, answers pings and records what arrives. Both keep what they saw in IntrepidManagerDB.msgtest (it
-- reaches the disk at the next /reload). Nothing in the record is a player name: a message is "self" (the game echoed our own
-- message back, which also times the server) or "other", and clients are told apart by a short random id.
--
--   local test = ns.Net.MsgTest.new({ out = print, db = IntrepidManagerDB })
--   test.listen()     -- once, at load: registers the prefix and starts recording
--   test.run()        -- about three minutes of pings, bursts and paced streams on the group chat, then by whisper
--   test.stop()
--
-- Message shapes (prefix IMTEST, and IMTES2 for the two-prefix phase; at most 255 bytes):  K:sid:run:phase:seq:total:rest
--   P ping, Q answer to a ping (rest = the pinger's sid), D data of a set size (rest = padding), Z size probe (seq = the size).
--   (A colon, not a pipe: the pipe starts an escape code in chat text, and ForeverLoot's working messages use colons.)

local _, ns = ...

local MsgTest = {}
ns.Net = ns.Net or {}
ns.Net.MsgTest = MsgTest

local PREFIX = "IMTEST"
local PREFIX2 = "IMTES2" -- a second prefix, for the phase that asks whether the throttle counts per prefix
local MAX_ROWS = 4000 -- per list in the saved record
local QUIET = 30 -- seconds without a message before the listening client says what it heard (the longest pause in a run is 20)
local HELLO_WAIT = 4 -- seconds the other client gets to answer the first ping
local SIZES = { 255, 250, 240, 200, 100 } -- tried from the top until the game accepts one: the "large" size
local OVER = { 256, 300 } -- sent once each, to see how the game refuses what is too long

-- The phases of a run, for each channel in turn: how many messages, how far apart (0 = all in the same instant), their size
-- ("large" is the biggest size the game accepted) and how long to wait afterwards for the last ones to arrive.
local PHASES = {
  { phase = "ping", kind = "P", count = 6, gap = 1.2, drain = 3 },
  { phase = "b10", kind = "D", count = 10, size = 100, gap = 0, drain = 8 },
  { phase = "b20", kind = "D", count = 20, size = "large", gap = 0, drain = 20 },
  { phase = "b40", kind = "D", count = 40, size = 60, gap = 0, drain = 12 },
  { phase = "x20", kind = "D", count = 20, size = "large", gap = 0, drain = 15, alternate = true }, -- like b20, on two prefixes
  { phase = "p500", kind = "D", count = 20, size = "large", gap = 0.5, drain = 8 },
  { phase = "p250", kind = "D", count = 20, size = "large", gap = 0.25, drain = 12 },
}
MsgTest.PHASES = PHASES
MsgTest.PREFIX = PREFIX
MsgTest.PREFIX2 = PREFIX2

local function round(value) return math.floor(value * 1000 + 0.5) / 1000 end

local function resultName(code)
  local enum = Enum and Enum.SendAddonMessageResult
  if type(code) == "number" and enum then
    for name, value in pairs(enum) do
      if value == code then return name end
    end
  end
  return tostring(code)
end

local function prefixResultName(code)
  local enum = Enum and Enum.RegisterAddonMessagePrefixResult
  if type(code) == "number" and enum then
    for name, value in pairs(enum) do
      if value == code then return name end
    end
  end
  return tostring(code)
end

local function clock()
  return GetTimePreciseSec and GetTimePreciseSec() or GetTime()
end

local function groupChat()
  if IsInRaid() then return "RAID" end
  if IsInGroup() then return "PARTY" end
end

-- "K:sid:run:phase:seq:total:rest" as a table, or nil when the text is not one of ours.
local function parse(text)
  local kind, sid, run, phase, seq, total, rest = string.match(text, "^(%a):(%w+):(%w+):(%w+):(%d+):(%d+):(%w*)")
  if not kind then return nil end
  return { kind = kind, sid = sid, run = run, phase = phase, seq = tonumber(seq), total = tonumber(total), rest = rest }
end
MsgTest.parse = parse

local function key(run, phase, seq) return run .. "/" .. phase .. "/" .. seq end

-- The lines /im msgtest prints when a run ends: per channel and phase, what was sent, what the game refused, what came back.
-- `received` is the saved list of everything this client heard (rows of "self" are our own messages echoed by the server).
function MsgTest.summary(run, received)
  local order, groups, sizes = {}, {}, {}
  for _, row in ipairs(run.sent or {}) do
    if row.k == "P" or row.k == "D" then
      local name = row.chat .. " " .. row.p
      local group = groups[name]
      if not group then
        group = { sent = 0, refused = {}, back = 0, chat = row.chat }
        groups[name] = group
        order[#order + 1] = name
      end
      group.sent = group.sent + 1
      if row.r ~= "Success" then group.refused[row.r] = (group.refused[row.r] or 0) + 1 end
    elseif row.k == "Z" then
      sizes[#sizes + 1] = row.i .. "=" .. row.r
    end
  end
  local trips = {}
  for _, row in ipairs(received or {}) do
    if row.run == run.id then
      if row.from == "self" and (row.k == "P" or row.k == "D") then
        local group = groups[row.chat .. " " .. row.p]
        if group then group.back = group.back + 1 end
      elseif row.rtt then
        local list = trips[row.chat] or {}
        list[#list + 1] = row.rtt
        trips[row.chat] = list
      end
    end
  end
  local lines = {}
  if #sizes > 0 then lines[#lines + 1] = "message sizes: " .. table.concat(sizes, ", ") end
  for _, name in ipairs(order) do
    local group = groups[name]
    local refused = {}
    for reason, count in pairs(group.refused) do refused[#refused + 1] = count .. " " .. reason end
    table.sort(refused)
    local text = name .. ": " .. group.sent .. " sent"
    if #refused > 0 then text = text .. ", refused: " .. table.concat(refused, ", ") end
    if group.chat ~= "WHISPER" then text = text .. ", " .. group.back .. " came back" end
    lines[#lines + 1] = text
  end
  for _, name in ipairs({ "PARTY", "RAID", "WHISPER" }) do
    local list = trips[name]
    if list then
      table.sort(list)
      lines[#lines + 1] = name .. " round trips: " .. #list .. " answers, " .. list[1] .. " to " .. list[#list] .. " seconds"
    end
  end
  return lines
end

function MsgTest.new(context)
  local out = context.out or print
  local db = context.db or {}
  local self = {}

  local sid = context.sid or string.format("%x", (math.floor(clock() * 1000) + math.random(0, 4095)) % 65536)
  local frame
  local registered
  local registered2
  local runCount = 0
  local state -- the run in progress: { run, chat, partner, cancelled, large }
  local sentAt = {} -- key(run, phase, seq) -> the clock when we sent it
  local heard = { count = 0 } -- what other clients sent since the last quiet spell: { run, count, last }
  local quietPending = false

  local function store()
    if not db.msgtest then
      db.msgtest = { schema = 1, sid = sid, runs = {}, received = {}, replies = {}, restrictions = {}, errors = {} }
    end
    return db.msgtest
  end

  local function add(list, row)
    if #list >= MAX_ROWS then
      local saved = store()
      saved.droppedRows = (saved.droppedRows or 0) + 1
      return
    end
    list[#list + 1] = row
  end

  local function restricted()
    local ok, answer = pcall(C_ChatInfo.AreOutgoingAddonChatMessagesRestricted)
    if ok then return answer end
    return nil
  end

  -- Sends one message. spec: kind, run, phase, seq, total, size (pad to this many bytes), chat, target, rest, prefix. The row goes
  -- into `list`. Returns true when the game took it (result Success; a client that answers nothing counts as taking it).
  local function transmit(spec, list)
    local text = spec.kind .. ":" .. sid .. ":" .. spec.run .. ":" .. spec.phase .. ":" .. spec.seq .. ":" .. (spec.total or 0) .. ":" .. (spec.rest or "")
    if spec.size and #text < spec.size then text = text .. string.rep("x", spec.size - #text) end
    local at = clock()
    local prefix = spec.prefix or PREFIX
    local ok, code = pcall(C_ChatInfo.SendAddonMessage, prefix, text, spec.chat, spec.target)
    local row = { k = spec.kind, p = spec.phase, i = spec.seq, t = round(at), len = #text, chat = spec.chat, px = prefix == PREFIX2 and 2 or nil }
    if ok then row.r = resultName(code) else row.r = "error: " .. tostring(code) end
    if spec.kind == "P" or spec.kind == "D" then sentAt[key(spec.run, spec.phase, spec.seq)] = at end
    add(list, row)
    return ok and (code == 0 or code == true or code == nil)
  end

  ---------------------------------------------------------------------------------------------------------------
  -- Listening: every client records what arrives and answers pings
  ---------------------------------------------------------------------------------------------------------------

  local function say(text) out("Message test: " .. text) end

  local function quietCheck()
    quietPending = false
    if heard.count == 0 then return end
    if clock() - heard.last < QUIET - 0.5 then
      quietPending = true
      C_Timer.After(QUIET, quietCheck)
      return
    end
    say("heard " .. heard.count .. " messages from the other client (run " .. tostring(heard.run) .. "). Type /reload to save them to a file.")
    heard = { count = 0 }
  end

  local function noteHeard(head, now)
    if heard.count == 0 then
      if head.kind == "P" and head.phase == "hello" then
        say("another client started run " .. head.run .. ". It takes about three minutes. I will say when it is quiet.")
      end
      heard.run = head.run
    end
    heard.count = heard.count + 1
    heard.last = now
    if not quietPending then
      quietPending = true
      C_Timer.After(QUIET, quietCheck)
    end
  end

  local function onMessage(prefix, text, chat, sender)
    if prefix ~= PREFIX and prefix ~= PREFIX2 then return end
    local saved = store()
    if issecretvalue and issecretvalue(text) then
      saved.secret = (saved.secret or 0) + 1
      return
    end
    if type(text) ~= "string" then return end
    local now = clock()
    local head = parse(text)
    if not head then
      saved.bad = (saved.bad or 0) + 1
      return
    end
    local mine = head.sid == sid
    local row = {
      t = round(now), k = head.kind, run = head.run, p = head.phase, i = head.seq, n = head.total, len = #text, chat = chat,
      from = mine and "self" or "other", s = head.sid, px = prefix == PREFIX2 and 2 or nil,
    }
    if mine then
      local at = sentAt[key(head.run, head.phase, head.seq)]
      if at then row.lag = round(now - at) end
    elseif head.kind == "Q" and head.rest == sid then
      local at = sentAt[key(head.run, head.phase, head.seq)]
      if at then row.rtt = round(now - at) end
      if state and state.run.id == head.run and sender then state.partner = state.partner or sender end
    end
    add(saved.received, row)
    if mine then return end
    noteHeard(head, now)
    if head.kind == "P" then
      -- Answer on the channel the ping came on, so the pinger measures that channel.
      local target
      if chat == "WHISPER" then target = sender end
      if chat ~= "WHISPER" or target then
        transmit({ kind = "Q", run = head.run, phase = head.phase, seq = head.seq, total = head.total, chat = chat, target = target, rest = head.sid, prefix = prefix }, saved.replies)
      end
    end
  end

  local function onRestriction(kind, value)
    local saved = store()
    add(saved.restrictions, { t = round(clock()), type = kind, state = value, running = state ~= nil or nil })
  end

  function self.listen()
    if frame then return end
    local ok, code = pcall(C_ChatInfo.RegisterAddonMessagePrefix, PREFIX)
    local saved = store()
    saved.prefixResult = ok and prefixResultName(code) or ("error: " .. tostring(code))
    registered = ok and (code == 0 or code == 1)
    local ok2, code2 = pcall(C_ChatInfo.RegisterAddonMessagePrefix, PREFIX2)
    saved.prefixResult2 = ok2 and prefixResultName(code2) or ("error: " .. tostring(code2))
    registered2 = ok2 and (code2 == 0 or code2 == 1)
    frame = CreateFrame("Frame")
    frame:RegisterEvent("CHAT_MSG_ADDON")
    frame:RegisterEvent("ADDON_RESTRICTION_STATE_CHANGED")
    frame:SetScript("OnEvent", function(_, event, ...)
      -- Never let an error here reach the player: count it and keep the last text.
      local good, problem = pcall(function(...)
        if event == "CHAT_MSG_ADDON" then
          onMessage(...)
        elseif event == "ADDON_RESTRICTION_STATE_CHANGED" then
          onRestriction(...)
        end
      end, ...)
      if not good then
        local record = store()
        record.errorCount = (record.errorCount or 0) + 1
        add(record.errors, tostring(problem))
      end
    end)
  end

  ---------------------------------------------------------------------------------------------------------------
  -- Running: the sender's script
  ---------------------------------------------------------------------------------------------------------------

  local function live(current) return state == current and not current.cancelled end

  local function finish(current, why)
    if state ~= current then return end
    state = nil
    current.cancelled = true -- timers of this run that are still waiting do nothing
    current.run.finished = why == nil
    current.run.stopped = why
    if why then
      say("stopped: " .. why .. " Type /reload to save what was measured.")
    else
      for _, line in ipairs(MsgTest.summary(current.run, store().received)) do say(line) end
      say("run " .. current.run.id .. " is done. Type /reload to save the results, then do the same on the other client.")
    end
  end

  local function mark(current, chat, phase)
    add(current.run.marks, {
      t = round(clock()), chat = chat, p = phase, restricted = restricted(), combat = InCombatLockdown() or nil,
    })
  end

  local function sizeOf(current, size)
    if size == "large" then return current.large end
    return size
  end

  local function target(current, chat)
    if chat == "WHISPER" then return current.partner end
  end

  local function runPhase(current, chat, phase, done)
    if not live(current) then return end
    if IsEncounterInProgress() then return finish(current, "a boss fight started, and the game blocks addon messages in one.") end
    mark(current, chat, phase.phase)
    local size = sizeOf(current, phase.size)
    say(chat .. " " .. phase.phase .. ": " .. phase.count .. (phase.count == 1 and " message" or " messages") .. (size and (" of " .. size .. " bytes") or "") .. (phase.gap > 0 and (", " .. phase.gap .. " s apart") or " at once"))
    local function sendFrom(index)
      if not live(current) then return end
      transmit({
        kind = phase.kind, run = current.run.id, phase = phase.phase, seq = index, total = phase.count, size = size,
        chat = chat, target = target(current, chat), prefix = (phase.alternate and registered2 and index % 2 == 0) and PREFIX2 or PREFIX,
      }, current.run.sent)
      if index < phase.count then
        if phase.gap > 0 then
          C_Timer.After(phase.gap, function() sendFrom(index + 1) end)
        else
          sendFrom(index + 1)
        end
      else
        C_Timer.After(phase.drain, function() if live(current) then done() end end)
      end
    end
    sendFrom(1)
  end

  local function runChat(current, chats, index)
    if not live(current) then return end
    local chat = chats[index]
    if not chat then return finish(current) end
    local function phaseAt(number)
      if not live(current) then return end
      local phase = PHASES[number]
      if not phase then return runChat(current, chats, index + 1) end
      runPhase(current, chat, phase, function() phaseAt(number + 1) end)
    end
    phaseAt(1)
  end

  -- Which size does the game accept? Largest of SIZES that it takes; then two sizes that are too long, only to see the answer.
  local function probeSizes(current)
    local chat = current.chat
    for _, size in ipairs(SIZES) do
      local taken = transmit({ kind = "Z", run = current.run.id, phase = "size", seq = size, total = 0, size = size, chat = chat }, current.run.sent)
      if taken then
        current.large = size
        break
      end
    end
    for _, size in ipairs(OVER) do
      transmit({ kind = "Z", run = current.run.id, phase = "size", seq = size, total = 0, size = size, chat = chat }, current.run.sent)
    end
    current.run.large = current.large
    if not current.large then
      return finish(current, "the game refused every message size (see the result codes in the saved file).")
    end
    say("largest message the game accepted: " .. current.large .. " bytes")
    C_Timer.After(3, function()
      if live(current) then runChat(current, { current.chat, "WHISPER" }, 1) end
    end)
  end

  function self.run()
    if state then
      say("a run is already going. Type /im msgtest stop to end it.")
      return
    end
    if InCombatLockdown() then
      say("not in combat, please. Try again when the fight is over.")
      return
    end
    if IsEncounterInProgress() then
      say("the game blocks addon messages during a boss fight. Try again afterwards.")
      return
    end
    local chat = groupChat()
    if not chat then
      say("join a group with the other client first (a party is enough), then type /im msgtest run.")
      return
    end
    if not frame then self.listen() end
    if not registered then
      say("the game would not register the message prefix, so there is nothing to test.")
      return
    end
    runCount = runCount + 1
    local run = {
      id = sid .. "r" .. runCount, sid = sid, startedAt = time and time() or nil, chat = chat, raid = IsInRaid() or nil,
      members = GetNumGroupMembers(), sent = {}, marks = {},
    }
    local saved = store()
    saved.runs[#saved.runs + 1] = run
    local current = { run = run, chat = chat, cancelled = false }
    state = current
    mark(current, chat, "hello")
    say("run " .. run.id .. " on " .. chat .. ". Asking the other client to answer first.")
    transmit({ kind = "P", run = run.id, phase = "hello", seq = 1, total = 1, chat = chat }, run.sent)
    C_Timer.After(HELLO_WAIT, function()
      if not live(current) then return end
      if not current.partner then
        return finish(current, "nobody answered. Is the other client in this group, with the same build (/im version) and the game restarted since it was installed?")
      end
      probeSizes(current)
    end)
  end

  function self.stop()
    if not state then
      say("nothing is running.")
      return
    end
    state.cancelled = true
    finish(state, "you stopped it.")
  end

  function self.status()
    local saved = db.msgtest
    local text = "prefix " .. (registered and "registered" or "not registered") .. ", " .. (state and ("run " .. state.run.id .. " is going") or "idle")
    if saved then text = text .. ", " .. #saved.received .. " messages recorded, " .. #saved.runs .. " runs" end
    say(text .. ". Commands: /im msgtest run, stop, clear.")
  end

  function self.clear()
    if state then
      say("a run is going. Type /im msgtest stop first.")
      return
    end
    db.msgtest = nil
    sentAt = {}
    store()
    say("records cleared.")
  end

  -- What follows /im msgtest.
  function self.command(argument)
    local word = string.lower(string.match(argument or "", "^%s*(%S*)") or "")
    if word == "run" or word == "start" then
      self.run()
    elseif word == "stop" then
      self.stop()
    elseif word == "clear" then
      self.clear()
    else
      self.status()
    end
  end

  self.sid = sid
  self.frame = function() return frame end
  return self
end
