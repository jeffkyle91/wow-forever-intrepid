-- Intrepid Manager: /im session. The client side of the council session: the loot master queues items (shift-clicked links, or from
-- the bags), starts a session with a timer, and sees the answers; every raider with the addon is offered the items and answers each
-- before the timer runs out. It works from chat commands, and the windows (ui/SessionPanel, ui/BagPicker, ui/ResponseFrame) sit on
-- the same calls: they read masterModel(), offerModel() and rowsModel(n) and are told of changes through self.hooks.
-- The wire format is net/CouncilWire.lua (a test protocol, version 1), the sending net/Outbox.lua, the rules core/Council.lua.
--
--   Loot master:  /im session add [item] [item]     queue the shift-clicked items
--                 /im session bags                  list the items in your bags that can be traded; /im session bag 1 3 queues them
--                 /im session start [seconds]       offer the queue to the group; the default timer is 60 seconds. Outside a
--                                                   group it is a practice session: only the loot master is asked, nothing is
--                                                   sent, and its awards never reach the awards log or the export
--                 /im session results [item]        who answered what;  /im session end  ends it now
--                 /im award <item> <name>           award an item to a raider (or the Award button next to their answer)
--                 /im trade <name>                  trade a raider everything that is awarded to them (or the Trade button)
--   Raider:       /im offers                        what is on offer;   /im respond <item> <bis, up, os or pass> [note]
--
-- The record in IntrepidManagerDB.council has shapes only: item ids, counts and timers, no player names.

local _, ns = ...

local CouncilSession = {}
ns.Game = ns.Game or {}
ns.Game.CouncilSession = CouncilSession

local SELF = "(you)" -- how the loot master's own answer is named in its table
-- Awards to nobody in the group: the item stays with the loot master, who hands it over by hand (the Raid Desk records the label).
local PSEUDO_LABEL = { ["disenchant"] = "Disenchant", ["guild bank"] = "Guild bank", ["guild-bank"] = "Guild bank" }
local VERSION_WAIT = 5 -- seconds after a full version check before a silent member counts as "not installed"
local ANNOUNCE_DELAY = 3 -- seconds after joining a group before the version is announced (the roster settles first)
local ANNOUNCE_GAP = 30 -- seconds between two announces
local ENCOUNTER_RETRY = 15 -- seconds before an announce is tried again after a boss fight held it back
local REPLY_GAP = 60 -- seconds before the same announcer is told our version again
local RESET_CONFIRM = 10 -- seconds in which a second press of New session drops awards that are not given yet
local VERSION_TRACES = 40 -- lines of the timeline kept for versions heard (the log has room for 400, and the sessions need it)
local MAX_VERSION_WARNINGS = 3 -- chat lines "has a newer version" in one login, whatever the group sends
local MAX_PRINTED_ANSWERS = 30 -- answers printed to the chat while a session runs; /im session results shows all

local function plural(n, one, many) return n == 1 and one or many end

-- options: out (function), db (table), version (the addon version, told in the hello), sid (a session id, for the tests), exchange
-- (game/Exchange: it is told of every award, take-back and delivery, for the awards string).
function CouncilSession.new(context)
  local out = context.out or print
  local db = context.db or {}
  local version = context.version or "unknown"
  -- Where an item drops ("Boss, Dungeon"), for the loot master's window; nil when nobody knows. Optional (game/DungeonJournal today).
  local sourceOf = context.sourceOf
  local Council, Wire, Outbox, Bags = ns.Council, ns.Net.CouncilWire, ns.Net.Outbox, ns.Game.Bags
  local self = { hooks = {} }

  local session -- the loot master's session (core/Council), or nil
  local offers = Council.newOffers({ now = GetTime })
  local outbox
  local tradeEngine -- game/Trade, made when first needed
  local frame, registered
  local counter = 0
  local seen = {} -- the versions heard in the group: key -> { who, version, class, at } (memory only, no names are saved)
  local warned = {} -- newer versions already warned about
  local warnings = 0 -- how many such lines were printed
  local checkSid, checkAt -- the last full version check: its id and when
  local lastAnnounce -- when we last announced our version
  local announceToken = 0 -- a newer plan to announce cancels the older one
  local inGroup = false -- were we in a group at the last roster event
  local repliedAt = {} -- announcers we answered with our version: key -> when
  local versionTraces = 0
  local resetWarnedAt -- when New session last warned about awards that are not given yet
  local greeted = {} -- sessions that we said hello to
  local acks = {} -- the hellos heard for our own session: key -> { version, class }
  local answersPrinted = 0
  local bagRows = {}
  local lastSid -- the session whose offers came last
  local practiceIds = {} -- the practice sessions of this load (started outside a group): id -> true
  local rosters = {} -- who each session asked: id -> { { who, class }, ... } (the group at the start; memory only, never saved)

  local function say(text) out("Session: " .. text) end

  -- A function that a window registered in self.hooks, called without ever letting its error out.
  local function fire(name, ...)
    local hook = self.hooks[name]
    if hook then pcall(hook, ...) end
  end

  local function store()
    if not db.council then db.council = { schema = 1, sessions = {} } end
    db.council.log = db.council.log or {}
    return db.council
  end

  -- One line of the timeline kept in the record (400 at most): when, what, which item, and the answer code or a count. No names. The
  -- two clients' timelines show how long an offer, a hello and an answer really take.
  local MAX_LOG = 400
  local function trace(kind, n, extra)
    local log = store().log
    if #log >= MAX_LOG then return end
    log[#log + 1] = { t = math.floor(GetTime() * 100 + 0.5) / 100, e = kind, n = n, c = extra }
  end

  -- Tell the exchange (the awards for the Raid Desk) of something about session `key`; a failure there never reaches the loot master's
  -- session. Nothing of a practice session is told: its awards never reach the awards log or the export.
  local function exchange(method, key, ...)
    if not context.exchange or practiceIds[key] then return end
    local ok, problem = pcall(context.exchange[method], key, ...)
    if not ok then
      local saved = store()
      saved.exchangeErrors = (saved.exchangeErrors or 0) + 1
      saved.lastExchangeError = string.sub(tostring(problem), 1, 120)
    end
  end

  -- The loot master's own full name as the game spells it.
  local function myName()
    local ok, name = pcall(GetUnitName, "player", true)
    if ok and type(name) == "string" and name ~= "" then return name end
    return "Loot master"
  end

  local function groupChat()
    if IsInRaid() then return "RAID" end
    if IsInGroup() then return "PARTY" end
  end

  -- The link of an item string for the chat when the game can make one, else the name the offer told in brackets, else the string.
  local function itemText(item, name)
    local ok, _, link = pcall(function() return C_Item.GetItemInfo(item) end)
    if ok and type(link) == "string" then return link end
    if type(name) == "string" and name ~= "" then return "[" .. name .. "]" end
    return "[" .. item .. "]"
  end
  self.itemText = itemText

  -- The class token of the player ("WARRIOR"), or nil.
  local function classToken()
    local ok, _, token = pcall(function() return UnitClass("player") end)
    if ok and type(token) == "string" and string.match(token, "^%a+$") then return token end
  end

  -- The picture of an item for a window: the game's icon by item id, or a question mark.
  local function iconOf(item)
    local ok, icon = pcall(function() return C_Item.GetItemIconByID(Council.itemId(item)) end)
    if ok and icon then return icon end
    return "Interface\\Icons\\INV_Misc_QuestionMark"
  end

  local function newId()
    counter = counter + 1
    if context.sid then return context.sid .. counter end
    return string.format("%04x", (math.floor(GetTime() * 1000) + math.random(0, 65535)) % 65536) .. counter
  end

  local function ensureOutbox()
    if outbox then return outbox end
    outbox = Outbox.new({
      send = function(prefix, text, chat, target) return C_ChatInfo.SendAddonMessage(prefix, text, chat, target) end,
      now = GetTime, after = C_Timer.After, prefix = Wire.PREFIX, encounter = IsEncounterInProgress,
      onDrop = function(_, why)
        local saved = store()
        saved.dropped = (saved.dropped or 0) + 1
        saved.lastDrop = string.sub(tostring(why), 1, 60)
        trace("drop", nil, saved.lastDrop)
        say("a message could not be sent (" .. tostring(why) .. ")")
      end,
    })
    return outbox
  end

  ---------------------------------------------------------------------------------------------------------------
  -- Receiving
  ---------------------------------------------------------------------------------------------------------------

  local function ownSession(sid) return session ~= nil and session.id == sid end

  -- A raider's clients close the offers whose time is up and tell what went unanswered.
  local function closeOffers()
    local closed = offers.expire()
    local unanswered = 0
    for _, offer in ipairs(closed) do
      if not offer.myCode then unanswered = unanswered + 1 end
      fire("onOfferChanged", offer)
    end
    if unanswered > 0 then
      say("time is up: " .. unanswered .. plural(unanswered, " item", " items") .. " had no answer from you.")
    end
    if #closed > 0 and #offers.open() == 0 then fire("onOffersClosed") end
  end

  local function handleOffer(head, sender)
    if ownSession(head.sid) then return end -- our own offer, already known here
    local offer, isNew = offers.receive(head.sid, sender, head.n, head.count, head.timer, head.item, { name = head.name, quality = head.quality })
    if not isNew then return end
    lastSid = head.sid
    trace("offer", head.n, head.count)
    if not greeted[head.sid] then
      greeted[head.sid] = true
      trace("hello-sent", nil, nil)
      ensureOutbox().push(Wire.hello(head.sid, version, classToken()), "WHISPER", sender)
      C_Timer.After(head.timer + 1, closeOffers)
      say(sender .. " offers " .. head.count .. plural(head.count, " item", " items") .. ", " .. head.timer .. " seconds to answer.")
    end
    say("item " .. head.n .. ": " .. itemText(head.item, head.name) .. " - answer with /im respond " .. head.n .. " bis, up, os or pass [note]")
    fire("onOffer", offer)
  end

  local function handleAnswer(head, sender)
    if not (session and ownSession(head.sid)) then return end
    local ok, replaced, previous = session.respond(head.n, sender, head.code, head.note)
    if not ok then return end
    trace("got", head.n, head.code)
    local repeated = previous ~= nil and previous.code == head.code and (previous.note or "") == (head.note or "")
    if answersPrinted < MAX_PRINTED_ANSWERS and not repeated then
      answersPrinted = answersPrinted + 1
      if previous and previous.code == head.code then
        say(sender .. " changed the note on item " .. head.n .. (head.note ~= "" and (": " .. head.note) or " (no note now)"))
      else
        say(sender .. " " .. (replaced and "changed to " or "answered ") .. Council.label(head.code) .. " on item " .. head.n .. (head.note ~= "" and (": " .. head.note) or ""))
      end
    end
    fire("onResponse", head.n, sender, head)
  end

  local function handleEnd(head)
    if ownSession(head.sid) then return end
    local closed = offers.endSession(head.sid)
    trace("ended", nil, #closed)
    if #closed > 0 then
      say("the loot master ended the session.")
      for _, offer in ipairs(closed) do fire("onOfferChanged", offer) end
      if #offers.open() == 0 then fire("onOffersClosed") end
    end
  end

  -- The key of a player's name for the version check: the name without a realm, in the matching rule of core/Names (the chat may say
  -- "Jorren Ashvale-Realm" where the roster says "Jorren Ashvale").
  local function playerKey(name)
    if type(name) ~= "string" then return nil end
    return ns.Names.key(string.match(name, "^([^%-]*)"))
  end

  -- Is this name the player's own? (Group chat brings our own messages back.)
  local function isMe(name)
    local ok, mine = pcall(GetUnitName, "player", true)
    local key = playerKey(name)
    return ok and key ~= nil and key ~= "" and playerKey(mine) == key
  end

  -- Somebody's version, from an announce or an answer (viaSession: from the hello of a session, which has its own line in the timeline).
  -- A newer one than ours is told once.
  local function noteVersion(who, theirs, class, viaSession)
    local key = playerKey(who)
    if not key or key == "" then return end
    local before = seen[key]
    seen[key] = { who = who, version = theirs, class = class, at = GetTime() }
    if not viaSession and (not before or before.version ~= theirs) and versionTraces < VERSION_TRACES then
      versionTraces = versionTraces + 1
      trace("version", nil, theirs)
    end
    if ns.Version.relation(version, theirs) == "newer" and not warned[theirs] and warnings < MAX_VERSION_WARNINGS then
      warned[theirs] = true
      warnings = warnings + 1
      say(who .. " has Intrepid Manager " .. theirs .. " and you have " .. version .. ". Please update.")
    end
    fire("onVersions")
  end

  local function handleHello(head, sender)
    if head.sid == "0" or head.sid == checkSid then noteVersion(sender, head.version, head.class) end
    if not (session and ownSession(head.sid)) then return end
    local key = ns.Names.key(sender)
    if key and not acks[key] then acks[key] = { version = head.version, class = head.class, who = sender } end
    noteVersion(sender, head.version, head.class, true)
    trace("hello", nil, head.class)
    fire("onHello", sender, head.version)
  end

  -- Somebody announced their version on the group chat: note it, and tell them ours when it differs (a group of equals stays quiet).
  local function handleAnnounce(head, sender)
    if isMe(sender) then return end
    noteVersion(sender, head.version, head.class)
    local key = playerKey(sender)
    if ns.Version.relation(version, head.version) == "same" or not key or key == "" then return end
    local now = GetTime()
    if repliedAt[key] and now - repliedAt[key] < REPLY_GAP then return end
    repliedAt[key] = now
    ensureOutbox().push(Wire.hello("0", version, classToken()), "WHISPER", sender)
  end

  -- A full version check: everybody answers.
  local function handleCheckRequest(head, sender)
    if isMe(sender) then return end
    ensureOutbox().push(Wire.hello(head.sid, version, classToken()), "WHISPER", sender)
  end

  local function onMessage(prefix, text, chat, sender)
    if prefix ~= Wire.PREFIX or type(text) ~= "string" then return end
    local head = Wire.decode(text)
    if not head then return end
    -- An offer or an end comes on the group chat, an answer or a hello by whisper: anything else is not from our code.
    local fromGroup = chat == "PARTY" or chat == "RAID" or chat == "INSTANCE_CHAT"
    if head.kind == "I" and fromGroup then
      handleOffer(head, sender)
    elseif head.kind == "X" and fromGroup then
      handleEnd(head)
    elseif head.kind == "R" and chat == "WHISPER" then
      handleAnswer(head, sender)
    elseif head.kind == "K" and chat == "WHISPER" then
      handleHello(head, sender)
    elseif head.kind == "V" and fromGroup then
      handleAnnounce(head, sender)
    elseif head.kind == "Q" and fromGroup then
      handleCheckRequest(head, sender)
    end
  end

  local function trading()
    if not tradeEngine then tradeEngine = ns.Game.Trade.new({ out = out, db = db }) end
    return tradeEngine
  end

  function self.listen()
    if frame then return end
    trading().listen()
    local ok, code = pcall(C_ChatInfo.RegisterAddonMessagePrefix, Wire.PREFIX)
    registered = ok and (code == 0 or code == 1)
    store().prefixResult = ok and tostring(code) or ("error: " .. tostring(code))
    frame = CreateFrame("Frame")
    frame:RegisterEvent("CHAT_MSG_ADDON")
    frame:RegisterEvent("GROUP_ROSTER_UPDATE")
    frame:RegisterEvent("PLAYER_ENTERING_WORLD")
    frame:SetScript("OnEvent", function(_, event, ...)
      -- Never let an error here reach the player mid-raid: count it and keep the last text.
      local good, problem
      if event == "CHAT_MSG_ADDON" then
        good, problem = pcall(onMessage, ...)
      elseif event == "GROUP_ROSTER_UPDATE" or event == "PLAYER_ENTERING_WORLD" then
        good, problem = pcall(self.rosterChanged)
      else
        return
      end
      if not good then
        local saved = store()
        saved.errorCount = (saved.errorCount or 0) + 1
        saved.lastError = string.sub(tostring(problem), 1, 120)
      end
    end)
  end

  ---------------------------------------------------------------------------------------------------------------
  -- Versions: who has the addon, and which version
  ---------------------------------------------------------------------------------------------------------------

  -- Tell the group which version we run. A client with another version answers with its own (a group of equals stays quiet); the
  -- window's full check makes everybody answer. At most once in ANNOUNCE_GAP seconds. Returns true when it was sent.
  function self.announce()
    local chat = groupChat()
    if not chat or not registered then return false end
    local now = GetTime()
    if lastAnnounce and now - lastAnnounce < ANNOUNCE_GAP then return false end
    lastAnnounce = now
    ensureOutbox().push(Wire.announce(version, classToken()), chat)
    trace("announce", nil, chat)
    return true
  end

  -- Announce after a moment (the roster settles first); during a boss fight the game blocks addon messages, so try again later. A newer
  -- plan replaces an older one.
  local function planAnnounce(delay)
    announceToken = announceToken + 1
    local token = announceToken
    C_Timer.After(delay, function()
      if token ~= announceToken then return end
      if IsEncounterInProgress() then return planAnnounce(ENCOUNTER_RETRY) end
      self.announce()
    end)
  end

  -- The group changed (or a loading screen ended): joining a group announces the version; leaving it forgets the versions heard.
  function self.rosterChanged()
    local now = IsInGroup() and true or false
    if now and not inGroup then planAnnounce(ANNOUNCE_DELAY) end
    if inGroup and not now then
      seen, checkSid, checkAt = {}, nil, nil
      announceToken = announceToken + 1
    end
    inGroup = now
    fire("onVersions")
  end

  -- A full version check: everybody in the group with the addon answers by whisper. What was heard before is forgotten, so that a row
  -- that stays silent shows as "not installed". Returns true when the question was sent.
  function self.checkVersions()
    local chat = groupChat()
    if not chat then
      say("join a group first. The version check goes to the group chat.")
      return false
    end
    if IsEncounterInProgress() then
      say("a boss fight is on: the game blocks addon messages until it ends.")
      return false
    end
    if not frame then self.listen() end
    if not registered then
      say("the game would not register the message prefix, so nothing can be sent.")
      return false
    end
    checkSid, checkAt = newId(), GetTime()
    seen = {}
    ensureOutbox().push(Wire.versionRequest(checkSid), chat)
    trace("check", nil, nil)
    fire("onVersions")
    return true
  end

  -- The members of the group as { name, class (a token or nil), connected, me }, in roster order.
  local function groupMembers()
    local units = { "player" }
    if IsInRaid() then
      units = {}
      for i = 1, GetNumGroupMembers() do units[#units + 1] = "raid" .. i end
    elseif IsInGroup() then
      for i = 1, 4 do units[#units + 1] = "party" .. i end
    end
    local members = {}
    for _, unit in ipairs(units) do
      if UnitExists(unit) then
        local ok, name = pcall(GetUnitName, unit, true)
        if ok and type(name) == "string" and name ~= "" then
          local _, _, token = pcall(function() return UnitClass(unit) end)
          if type(token) ~= "string" or not string.match(token, "^%a+$") then token = nil end
          local connectedOk, connected = pcall(UnitIsConnected, unit)
          members[#members + 1] = { name = name, class = token, connected = not connectedOk or connected ~= false, me = isMe(name) }
        end
      end
    end
    return members
  end

  -- What the version window shows (read only): the group, each member with what is known of their version.
  --   { mine = "0.0.15", checked = true, waiting = false, summary = { same = 5, older = 1, newer = 0, other = 0, waiting = 0,
  --     missing = 2, offline = 0, unchecked = 0 }, rows = { { who, class, me, status, version, kind }, ... } }
  -- status: "ok" (the version is known), "waiting" (asked a moment ago), "missing" (asked, no answer: the addon is not installed),
  -- "offline", "unchecked" (not asked yet). kind: for "ok" how theirs stands to ours ("same", "older", "newer" or "other" when one
  -- of the two is not a version), else the status.
  function self.versionsModel()
    local waiting = checkAt ~= nil and GetTime() - checkAt <= VERSION_WAIT
    local model = {
      mine = version, checked = checkAt ~= nil, waiting = waiting, rows = {},
      summary = { same = 0, older = 0, newer = 0, other = 0, waiting = 0, missing = 0, offline = 0, unchecked = 0 },
    }
    for _, member in ipairs(groupMembers()) do
      local row = { who = member.name, class = member.class, me = member.me }
      local entry = (not member.me) and seen[playerKey(member.name)] or nil
      if member.me then
        row.status, row.version, row.kind = "ok", version, "same"
      elseif entry then
        row.status, row.version = "ok", entry.version
        local relation = ns.Version.relation(version, entry.version)
        row.kind = relation == "unknown" and "other" or relation
        row.class = row.class or entry.class
      elseif not member.connected then
        row.status = "offline"
      elseif checkAt ~= nil then
        row.status = waiting and "waiting" or "missing"
      else
        row.status = "unchecked"
      end
      row.kind = row.kind or row.status
      model.summary[row.kind] = model.summary[row.kind] + 1
      model.rows[#model.rows + 1] = row
    end
    table.sort(model.rows, function(a, b)
      if a.me ~= b.me then return a.me end
      return (playerKey(a.who) or "") < (playerKey(b.who) or "")
    end)
    return model
  end

  -- The answers to the check as lines in the chat (for a client without the window).
  function self.printVersions()
    local model = self.versionsModel()
    if #model.rows == 0 then return say("you are not in a group.") end
    local words = { missing = "not installed", waiting = "no answer yet", offline = "offline", unchecked = "not asked yet" }
    for _, row in ipairs(model.rows) do
      local text = row.status == "ok" and (row.version .. (row.kind == "same" and "" or (", " .. row.kind))) or words[row.status]
      say(row.who .. ": " .. text .. (row.me and " (you)" or ""))
    end
  end

  -- /im versions: ask the group, and show the answers (the window when there is one, else a minute's wait and the chat).
  function self.versions()
    self.checkVersions()
    if self.hooks.onVersionsOpen then
      fire("onVersionsOpen")
    else
      C_Timer.After(VERSION_WAIT + 0.5, self.printVersions)
    end
  end

  ---------------------------------------------------------------------------------------------------------------
  -- The loot master: queue, start, results, end
  ---------------------------------------------------------------------------------------------------------------

  -- The session that takes new items: the one being built, or a new one when there is none or the last one is over.
  local function building()
    if session and session.state == "building" then return session end
    if session and session.state == "running" then return nil, "a session is running. Type /im session end first." end
    if session and session.state == "closed" and session.pending() > 0 then
      local pending = session.pending()
      return nil, pending .. plural(pending, " awarded item is", " awarded items are") .. " not given yet. Trade "
        .. plural(pending, "it", "them") .. " first, or type /im session new twice to drop " .. plural(pending, "it", "them") .. "."
    end
    session = Council.newSession({ now = GetTime, id = newId() })
    answersPrinted = 0
    acks = {}
    return session
  end

  local function queueLine(entry)
    return entry.n .. ". " .. itemText(entry.item, entry.name)
  end

  -- The quality of an item when the link did not tell: from the game by item id.
  local function qualityOf(item)
    local ok, quality = pcall(function() return C_Item.GetItemQualityByID(Council.itemId(item)) end)
    if ok and type(quality) == "number" then return quality end
  end

  -- infos: { { item, name, quality }, ... }
  local function addItems(infos)
    local current, why = building()
    if not current then return say(why) end
    for _, info in ipairs(infos) do
      local n, problem = current.add(info.item, { name = info.name, quality = info.quality or qualityOf(info.item) })
      if n then
        say("queued " .. queueLine({ n = n, item = info.item, name = info.name }))
      else
        say(problem)
        break
      end
    end
    fire("onQueueChanged")
  end

  function self.add(text)
    local infos = Wire.itemInfos(text)
    if #infos == 0 then
      -- (a link the color of which could not be read still has its item string)
      for _, item in ipairs(Wire.itemStrings(text)) do infos[#infos + 1] = { item = item } end
    end
    if #infos == 0 then
      say("shift-click the items into the command: /im session add [item] [item]. Or list the bags with /im session bags.")
      return
    end
    addItems(infos)
  end

  -- Queue rows of the bag list (the picker's and the command's way in).
  function self.addRows(rows)
    local infos = {}
    for _, row in ipairs(rows) do infos[#infos + 1] = { item = row.item, name = row.name, quality = row.quality } end
    if #infos > 0 then addItems(infos) end
  end

  -- The items of the bags that can be offered; `all` also takes grays and whites. Keeps the list for /im session bag.
  function self.scanBags(all)
    local rows, errors = Bags.scan(all and { minQuality = 0 } or nil)
    bagRows = rows
    return rows, errors
  end

  function self.bags(argument)
    local all = string.lower(argument or "") == "all"
    local rows, errors = self.scanBags(all)
    if #rows == 0 then
      say("no items in your bags can be offered (bound items with a trade time, or unbound ones of Uncommon quality or better). /im session bags all lists grays and whites too.")
      return
    end
    for i, row in ipairs(rows) do say(i .. ". " .. Bags.describe(row)) end
    if errors > 0 then say(errors .. " bag slots could not be read.") end
    say("queue them with /im session bag <numbers>, for example /im session bag 1 3; /im session bag all queues the ones with a trade time.")
  end

  function self.bag(argument)
    if #bagRows == 0 then
      say("list the bags first: /im session bags")
      return
    end
    local chosen = {}
    if string.lower(argument or "") == "all" then
      for _, row in ipairs(bagRows) do
        if row.tradeLine then chosen[#chosen + 1] = row end
      end
    else
      for number in string.gmatch(argument or "", "%d+") do
        local row = bagRows[tonumber(number)]
        if row then
          chosen[#chosen + 1] = row
        else
          say("there is no item " .. number .. " in the list.")
        end
      end
    end
    if #chosen == 0 then
      say("no item chosen: /im session bag <numbers>.")
      return
    end
    self.addRows(chosen)
  end

  function self.removeItem(n)
    if not session then return say("the queue is empty.") end
    local ok, why = session.remove(n)
    if not ok then return say(why) end
    say("removed item " .. n .. ".")
    fire("onQueueChanged")
  end

  function self.remove(argument)
    local n = tonumber(string.match(argument or "", "%d+"))
    if not n then return say("use /im session remove <item number>") end
    self.removeItem(n)
  end

  function self.list()
    if not session or session.count() == 0 then
      say("the queue is empty. Add items with /im session add [item] or /im session bags.")
      return
    end
    local state = session.state
    if state == "running" then
      say("running: " .. session.count() .. plural(session.count(), " item", " items") .. ", " .. math.floor(session.remaining() or 0) .. " seconds left, "
        .. session.responders() .. plural(session.responders(), " raider has", " raiders have") .. " answered.")
    else
      say(state == "building" and "queued:" or "over:")
    end
    for _, entry in ipairs(session.items()) do say(queueLine(entry)) end
  end

  local function summaryLine(n)
    local counts = session.counts(n)
    return "item " .. n .. ": " .. itemText(session.item(n).item) .. " - " .. counts.total .. plural(counts.total, " answer", " answers")
      .. " (BiS " .. counts.b .. ", Upgrade " .. counts.u .. ", Off-spec " .. counts.o .. ", Pass " .. counts.p .. ")"
  end

  function self.results(argument)
    if not session or session.count() == 0 then return say("no session yet.") end
    local only = tonumber(string.match(argument or "", "%d+"))
    for _, entry in ipairs(session.items()) do
      if not only or only == entry.n then
        say(summaryLine(entry.n))
        for _, row in ipairs(session.rows(entry.n)) do
          say("  " .. row.label .. ": " .. row.who .. (row.note ~= "" and (" - " .. row.note) or ""))
        end
      end
    end
    if practiceIds[session.id] then return say("a practice session: only you were asked, and its awards stay out of the awards log.") end
    local acksCount = 0
    for _ in pairs(acks) do acksCount = acksCount + 1 end
    say(acksCount .. plural(acksCount, " raider", " raiders") .. " said hello" .. (GetNumGroupMembers and (" of " .. GetNumGroupMembers() .. " in the group") or "") .. ".")
  end

  local function recordSession(how)
    local ids = {}
    for _, entry in ipairs(session.items()) do ids[#ids + 1] = Council.itemId(entry.item) end
    local acksCount = 0
    for _ in pairs(acks) do acksCount = acksCount + 1 end
    local saved = store()
    saved.sessions[#saved.sessions + 1] = {
      id = session.id, items = ids, timer = session.timer, raiders = session.responders(), hellos = acksCount, how = how,
      practice = practiceIds[session.id],
    }
  end

  local function finishSession(how)
    if not session or session.state ~= "running" then return false end
    session.close()
    offers.endSession(session.id)
    if #offers.open() == 0 then fire("onOffersClosed") end
    local chat = groupChat()
    if chat and not practiceIds[session.id] then ensureOutbox().push(Wire.finish(session.id), chat) end
    recordSession(how)
    trace("end", nil, session.responders())
    say("over (" .. how .. "): " .. session.responders() .. plural(session.responders(), " raider", " raiders") .. " answered.")
    self.results()
    fire("onEnd")
    return true
  end

  function self.finish()
    if not finishSession("you ended it") then say("no session is running.") end
  end

  -- The warning that New session shows while a second press would drop awards that are not given yet, or nil.
  local function resetNotice()
    if not (session and resetWarnedAt and GetTime() - resetWarnedAt < RESET_CONFIRM) then return nil end
    local pending = session.pending()
    if pending == 0 then return nil end
    return pending .. plural(pending, " awarded item is", " awarded items are") .. " not given yet. Press New session again to drop "
      .. plural(pending, "it", "them") .. "."
  end

  -- Forget a session that is over (the window's New session), so that the next items start a new queue. Awards that are not given yet
  -- are lost with it: the first press says so, and a second one within a few seconds drops them.
  function self.reset()
    if not (session and session.state == "closed") then return end
    local pending = session.pending()
    if pending > 0 and not (resetWarnedAt and GetTime() - resetWarnedAt < RESET_CONFIRM) then
      resetWarnedAt = GetTime()
      say(resetNotice() .. " Or give " .. plural(pending, "it", "them") .. " first with the Trade button.")
      fire("onQueueChanged")
      C_Timer.After(RESET_CONFIRM + 0.5, function() fire("onQueueChanged") end)
      return
    end
    resetWarnedAt = nil
    session = nil
    acks = {}
    answersPrinted = 0
    fire("onQueueChanged")
  end

  function self.start(argument)
    if session and session.state == "running" then return say("a session is running already. Type /im session end to end it.") end
    if not session or session.count() == 0 or session.state ~= "building" then
      return say("queue items first: /im session add [item] or /im session bags.")
    end
    -- Outside a group nobody else could be asked: the session is a practice, for the loot master alone (the windows, the answers, the
    -- awards and the countdown), and nothing is sent.
    local chat = groupChat()
    local practice = chat == nil
    if not practice then
      -- Ordinary combat is no obstacle (messages go out in it, and the windows are not secure frames); during a boss fight the game
      -- blocks addon messages, so nobody would get the offer while the timer ran.
      if IsEncounterInProgress() then
        return say("a boss fight is on: the game blocks addon messages until it ends, so nobody would get the offer. Start the session after the fight.")
      end
      if not frame then self.listen() end
      if not registered then return say("the game would not register the message prefix, so nothing can be sent.") end
    end
    local seconds = tonumber(string.match(argument or "", "%d+"))
    local started, why = session.start(seconds)
    if not started then return say(why) end
    local current = session
    if practice then practiceIds[current.id] = true end
    -- who is asked: the group as it is now (the loot master as SELF), or the loot master alone in a practice
    local roster = {}
    if practice then
      roster[1] = { who = SELF, class = classToken() }
    else
      for _, member in ipairs(groupMembers()) do roster[#roster + 1] = { who = member.me and SELF or member.name, class = member.class } end
      if #roster == 0 then roster[1] = { who = SELF, class = classToken() } end
    end
    rosters[current.id] = roster
    exchange("beginSession", current.id)
    answersPrinted = 0
    -- Our own offers are known here at once; the group's copy of them is ignored when it comes back.
    for _, entry in ipairs(current.items()) do
      local offer = offers.receive(current.id, SELF, entry.n, current.count(), current.timer, entry.item, { name = entry.name, quality = entry.quality })
      offer.mine = true
      lastSid = current.id
    end
    trace(practice and "practice" or "start", current.count(), current.timer)
    if practice then
      say("practice (you are not in a group): " .. current.count() .. plural(current.count(), " item", " items") .. ", " .. current.timer
        .. " seconds. Only you are asked and nothing is sent; its awards stay out of the awards log and the export. Answer in the window or with /im respond.")
    else
      for _, entry in ipairs(current.items()) do
        ensureOutbox().push(Wire.item(current.id, entry.n, current.count(), current.timer, entry.item, entry.quality, entry.name), chat)
      end
      say("started: " .. current.count() .. plural(current.count(), " item", " items") .. ", " .. current.timer .. " seconds. Raiders with the addon are asked; answer yourself with /im respond.")
    end
    for _, offer in ipairs(offers.list()) do
      if offer.sid == current.id then fire("onOffer", offer) end
    end
    fire("onSessionStarted", current)
    C_Timer.After(current.timer + Council.GRACE + 0.5, function()
      if session == current then finishSession("time is up") end
    end)
    C_Timer.After(5, function()
      if session ~= current or practice then return end
      local count = 0
      for _ in pairs(acks) do count = count + 1 end
      say(count .. plural(count, " raider", " raiders") .. " answered the hello" .. (GetNumGroupMembers and (" of " .. GetNumGroupMembers() .. " in the group") or "") .. ".")
    end)
  end

  ---------------------------------------------------------------------------------------------------------------
  -- The loot master awards items and gives them by trade
  ---------------------------------------------------------------------------------------------------------------

  -- The unit of the group whose full name is this one ("party2", "raid7"), or nil. A realm after the name does not matter.
  local function unitFor(name)
    local wanted = playerKey(name)
    if not wanted or wanted == "" then return nil end
    local units = {}
    if IsInRaid() then
      for i = 1, GetNumGroupMembers() do units[#units + 1] = "raid" .. i end
    else
      for i = 1, 4 do units[#units + 1] = "party" .. i end
    end
    for _, unit in ipairs(units) do
      if UnitExists(unit) then
        local ok, full = pcall(GetUnitName, unit, true)
        if ok and type(full) == "string" and playerKey(full) == wanted then return unit end
      end
    end
  end

  -- The name an item is awarded under: the spelling of an answer to the item, else the game's spelling of a member of the group, and
  -- SELF for the loot master. Nil when the name is nobody's.
  local function winnerName(n, typed)
    local key = playerKey(typed)
    if not key or key == "" then return nil end
    if PSEUDO_LABEL[ns.Names.key(typed)] then return PSEUDO_LABEL[ns.Names.key(typed)] end
    if typed == SELF or isMe(typed) then return SELF end
    for _, row in ipairs(session.rows(n)) do
      if playerKey(row.who) == key then return row.who end
    end
    local unit = unitFor(typed)
    if unit then
      local ok, name = pcall(GetUnitName, unit, true)
      if ok and type(name) == "string" and name ~= "" then return name end
    end
  end

  -- Award item n to `who`: the window's Award button passes the name of an answer, the chat command a typed name. Only what is awarded
  -- to a player is ever put into a trade with them.
  function self.award(n, who)
    if not session then return say("there is no session to award from.") end
    local entry = session.item(n)
    if not entry then return say("there is no item " .. tostring(n) .. ".") end
    local name = winnerName(n, who)
    if not name then
      return say(tostring(who) .. " is not in your group and has not answered: there is nobody to award item " .. n .. " to.")
    end
    local ok, why = session.award(n, name)
    if not ok then return say(why) end
    trace("award", n, nil)
    exchange("awarded", session.id, entry, name == SELF and myName() or name)
    local pseudo = name == PSEUDO_LABEL["disenchant"] or name == PSEUDO_LABEL["guild bank"]
    say("item " .. n .. " (" .. itemText(entry.item, entry.name) .. ") is awarded to " .. name
      .. (name == SELF and ". Press Trade next to your name when you have it."
        or (pseudo and ". Press Trade next to it once you have handed the item over."
          or (". Press Trade next to their name, or type /im trade " .. name .. "."))))
    fire("onAwarded", n, name)
  end

  -- Take the award of item n back (until it is given).
  function self.unaward(n)
    if not session then return say("there is no session.") end
    local entry = session.item(n)
    if not entry then return say("there is no item " .. tostring(n) .. ".") end
    local was = entry.winner
    if not was then return say("item " .. n .. " is not awarded to anybody.") end
    local ok, why = session.award(n, nil)
    if not ok then return say(why) end
    trace("unaward", n, nil)
    exchange("unawarded", session.id, entry)
    say("item " .. n .. " is not awarded to " .. was .. " any more.")
    fire("onAwarded", n, nil)
  end

  -- Say who has won what.
  function self.owed()
    if not session then return say("there is no session.") end
    local lines = 0
    for _, entry in ipairs(session.items()) do
      if entry.winner then
        lines = lines + 1
        say(entry.n .. ". " .. itemText(entry.item, entry.name) .. " - " .. (entry.given and "given to " or "awarded to ") .. entry.winner)
      end
    end
    if lines == 0 then say("nothing is awarded yet. Award with /im award <item number> <name>, or the Award button next to an answer.") end
  end

  -- Give the raider `who` everything that is awarded to them and not given yet: the window is opened with them and the items are put in
  -- by game/Trade (six at most); the loot master and the raider press Trade. When "Trade complete." comes those items show as given.
  function self.trade(who)
    local current = session
    if not current then return say("there is no session to give items from.") end
    local key = playerKey(who)
    local name
    for _, entry in ipairs(current.items()) do
      if entry.winner and not entry.given and playerKey(entry.winner) == key then
        name = entry.winner
        break
      end
    end
    if not name then
      return say(tostring(who) .. " has no awarded items waiting. Award an item first: /im award <item number> <name>.")
    end
    local won = current.wonBy(name)
    local items = {}
    for _, w in ipairs(won) do items[#items + 1] = w.item end
    local function given(w, how)
      current.give(w.n)
      trace("given", w.n, nil)
      exchange("given", current.id, w, how)
      fire("onGiven", w.n, name)
    end
    if name == SELF then -- the loot master keeps it: nothing to trade
      for _, w in ipairs(won) do given(w, "manual") end
      return say(#won .. plural(#won, " item stays", " items stay") .. " with you: marked as given.")
    end
    if name == PSEUDO_LABEL["disenchant"] or name == PSEUDO_LABEL["guild bank"] then -- handed over by hand
      for _, w in ipairs(won) do given(w, "manual") end
      return say(#won .. plural(#won, " item is", " items are") .. " marked as given to " .. name .. ": you hand " .. plural(#won, "it", "them") .. " over yourself.")
    end
    local unit = unitFor(name)
    if not unit then return say(name .. " is not in your group: there is nobody to trade with.") end
    trading().give(items, {
      unit = unit, label = name,
      onCompleted = function(left)
        local waiting = {}
        for _, w in ipairs(won) do waiting[#waiting + 1] = w end
        for _, item in ipairs(left) do
          for i, w in ipairs(waiting) do
            if w.item == item then
              table.remove(waiting, i)
              given(w, "trade")
              break
            end
          end
        end
      end,
    })
  end

  -- What follows /im trade: the name of a player who won something; or stop; nothing lists who has won what.
  function self.tradeCommand(argument)
    argument = string.gsub(argument or "", "^%s+", "")
    argument = string.gsub(argument, "%s+$", "")
    if argument == "" then return self.owed() end
    local word = string.lower(string.match(argument, "^%S+"))
    if word == "stop" then return trading().stop() end
    if tonumber(word) then
      return say("items are traded to the player who won them. Award the item first: /im award " .. word .. " <name>, then /im trade <name>.")
    end
    self.trade(argument)
  end

  -- What follows /im award: an item number and a name; "clear" and an item number takes an award back; nothing lists the awards.
  function self.awardCommand(argument)
    argument = string.gsub(argument or "", "^%s+", "")
    argument = string.gsub(argument, "%s+$", "")
    if argument == "" then return self.owed() end
    local word, rest = string.match(argument, "^(%S*)%s*(.-)%s*$")
    if string.lower(word) == "clear" then
      local n = tonumber(string.match(rest, "%d+"))
      if not n then return say("use /im award clear <item number>") end
      return self.unaward(n)
    end
    local n = tonumber(word)
    if not n or rest == "" then
      return say("use /im award <item number> <name> (or disenchant, or guild bank), or /im award clear <item number>. /im award alone lists who has won what.")
    end
    self.award(n, rest)
  end

  ---------------------------------------------------------------------------------------------------------------
  -- A raider: what is on offer, and the answer
  ---------------------------------------------------------------------------------------------------------------

  function self.offers()
    local open = offers.open()
    if #open == 0 then return say("nothing is on offer.") end
    for _, offer in ipairs(open) do
      say("item " .. offer.n .. " of " .. offer.count .. ": " .. itemText(offer.item) .. " - " .. math.floor(offers.remaining(offer)) .. " seconds left"
        .. (offer.myCode and (", you answered " .. Council.label(offer.myCode)) or ", no answer yet"))
    end
  end

  -- Answer item n of the latest offer (or of the session `sid`, which a window knows). note is cleaned by the wire code; a nil note
  -- keeps the item's note (the one written before the answer, or the one sent with the last answer). gear is for later (the items
  -- worn in the slot).
  function self.answer(n, code, note, sid)
    local target
    for _, offer in ipairs(offers.open()) do
      if offer.n == n and ((sid and offer.sid == sid) or (not sid and (not target or offer.sid == lastSid))) then target = offer end
    end
    if not target then
      say("item " .. tostring(n) .. " is not on offer (any more).")
      return false
    end
    if note == nil then note = target.draftNote or target.myNote or "" end
    local cleaned = Wire.cleanNote(note)
    local noteOnly = target.myCode == code and (target.myNote or "") ~= cleaned
    local offer, why = offers.answer(target.sid, n, code, cleaned)
    if not offer then
      say(why)
      return false
    end
    if offer.mine then
      local ok, problem = false, "the session is over."
      if session then ok, problem = session.respond(n, SELF, code, cleaned) end
      if not ok then
        say(problem)
        return false
      end
    else
      ensureOutbox().push(Wire.response(offer.sid, n, code, cleaned), "WHISPER", offer.master)
    end
    offer.draftNote = nil
    trace(noteOnly and "note" or "answer", n, code)
    if noteOnly then
      say("item " .. n .. ": note " .. (cleaned ~= "" and ("changed - " .. cleaned) or "taken out") .. (offer.mine and "" or " (sent)"))
    else
      say("item " .. n .. ": " .. Council.label(code) .. (cleaned ~= "" and (" - " .. cleaned) or "") .. (offer.mine and "" or " (sent)"))
    end
    fire("onOfferChanged", offer)
    return true
  end

  -- Write or change the note of item n of the session `sid` (the answer window's Note button). Once the item is answered, the answer
  -- goes again with the new note; before, the note waits for the answer. Returns true, or false when the item is not on offer.
  function self.setNote(sid, n, text)
    local offer = offers.get(sid, n)
    if not offer or offer.state == "closed" or offers.remaining(offer) <= 0 then
      say("item " .. tostring(n) .. " is not on offer (any more): the note was not changed.")
      return false
    end
    local cleaned = Wire.cleanNote(text)
    if offer.myCode then
      if cleaned == (offer.myNote or "") then return true end -- saved as it was: nothing to send
      return self.answer(n, offer.myCode, cleaned, sid)
    end
    offer.draftNote = cleaned ~= "" and cleaned or nil
    fire("onOfferChanged", offer)
    return true
  end

  -- /im respond <n> <answer> [note]: without a note, the item's note stays as it is.
  function self.respond(argument)
    local n, word, note = string.match(argument or "", "^(%d+)%s+(%S+)%s*(.-)%s*$")
    if not n then return say("use /im respond <item number> <bis, up, os or pass> [note]") end
    local code = Council.codeOf(word)
    if not code then return say("answer with bis, up, os or pass.") end
    self.answer(tonumber(n), code, note ~= "" and note or nil)
  end

  ---------------------------------------------------------------------------------------------------------------
  -- Commands
  ---------------------------------------------------------------------------------------------------------------

  function self.status()
    local text
    if session and session.state == "running" then
      text = "running, " .. math.floor(session.remaining() or 0) .. " seconds left"
    elseif session and session.state == "building" then
      text = session.count() .. plural(session.count(), " item", " items") .. " queued"
    else
      text = "no session"
    end
    say(text .. ". Commands: add [item], bags, bag <numbers>, list, remove <n>, start [seconds] (outside a group: a practice just for you), results [n], end, new. Then /im award <n> <name> and /im trade <name>. Raiders: /im offers, /im respond <n> <bis, up, os or pass> [note].")
  end

  -- What follows /im session.
  function self.command(argument)
    argument = string.gsub(argument or "", "^%s+", "")
    local word, rest = string.match(argument, "^(%S*)%s*(.-)%s*$")
    word = string.lower(word or "")
    if word == "add" then
      self.add(rest)
    elseif word == "bags" then
      self.bags(rest)
    elseif word == "bag" then
      self.bag(rest)
    elseif word == "list" then
      self.list()
    elseif word == "remove" then
      self.remove(rest)
    elseif word == "start" then
      self.start(rest)
    elseif word == "results" then
      self.results(rest)
    elseif word == "end" or word == "stop" then
      self.finish()
    elseif word == "new" then
      self.reset()
    elseif word == "status" then
      self.status()
    elseif word == "" or word == "window" or word == "open" then
      fire("onOpen") -- the window of the loot master (the main file opens it)
      if not self.hooks.onOpen then self.status() end
    else
      self.status()
    end
  end

  ---------------------------------------------------------------------------------------------------------------
  -- What the windows show (read only; the windows keep no state of their own about the session)
  ---------------------------------------------------------------------------------------------------------------

  local function countOf(map)
    local total = 0
    for _ in pairs(map) do total = total + 1 end
    return total
  end

  -- The loot master's window: the queue or the running session. state is "none", "building", "running" or "closed".
  -- The source text of an item, or nil. A failing lookup never reaches the window.
  local function sourceText(item)
    if not sourceOf then return nil end
    local ok, text = pcall(sourceOf, Council.itemId(item))
    if ok and type(text) == "string" and text ~= "" then return text end
    return nil
  end

  -- Who the session asked, and everybody who answered although they were not asked (a name the roster spelled differently): the
  -- number the windows count responses against.
  local function askedCount()
    local keys, total = {}, 0
    for _, member in ipairs(rosters[session.id] or {}) do
      local key = playerKey(member.who)
      if key and not keys[key] then
        keys[key] = true
        total = total + 1
      end
    end
    for _, entry in ipairs(session.items()) do
      for _, row in ipairs(session.rows(entry.n)) do
        local key = playerKey(row.who)
        if key and not keys[key] then
          keys[key] = true
          total = total + 1
        end
      end
    end
    return total
  end

  function self.masterModel()
    local model = {
      state = session and session.state or "none", timer = session and session.timer or Council.DEFAULT_TIMER, items = {},
      hellos = countOf(acks), group = GetNumGroupMembers(),
    }
    if session then
      for _, entry in ipairs(session.items()) do
        model.items[#model.items + 1] = {
          n = entry.n, item = entry.item, name = entry.name or ("item " .. tostring(Council.itemId(entry.item))), quality = entry.quality or 1,
          icon = iconOf(entry.item), counts = session.counts(entry.n), winner = entry.winner, given = entry.given,
          source = sourceText(entry.item),
        }
      end
      model.remaining = session.remaining()
      model.responders = session.responders()
      model.pending = session.pending()
      model.notice = resetNotice()
      model.practice = practiceIds[session.id]
      if session.state ~= "building" then
        local asked = askedCount()
        model.answers = session.answers()
        model.expected = asked * session.count()
        for _, item in ipairs(model.items) do item.asked = asked end
      end
    end
    return model
  end

  -- The answers to one item, best claim first: { { who, code, label, note, class, winner, given, missing }, ... }. After them, every
  -- raider the session asked who has not answered it: label "Waiting" while it runs, "No response" after, missing = true. The
  -- winner of the item has winner = true (and given = true once the trade went through); a winner who was not asked and did not
  -- answer gets a row of their own.
  function self.rowsModel(n)
    local rows = {}
    if session then
      local entry = session.item(n)
      local winnerKey = entry and entry.winner and playerKey(entry.winner) or nil
      local found = false
      local roster = rosters[session.id] or {}
      local classes, done = {}, {}
      for _, member in ipairs(roster) do
        local key = playerKey(member.who)
        if key then classes[key] = member.class end
      end
      for _, row in ipairs(session.rows(n)) do
        local ack = acks[row.key]
        local key = playerKey(row.who)
        local isWinner = winnerKey ~= nil and key == winnerKey
        found = found or isWinner
        if key then done[key] = true end
        rows[#rows + 1] = {
          who = row.who, code = row.code, label = row.label, note = row.note, class = (ack and ack.class) or (key and classes[key]),
          winner = isWinner or nil, given = (isWinner and entry.given) or nil,
        }
      end
      local label = session.state == "running" and "Waiting" or "No response"
      for _, member in ipairs(roster) do
        local key = playerKey(member.who)
        if key and not done[key] then
          done[key] = true
          local isWinner = winnerKey ~= nil and key == winnerKey
          found = found or isWinner
          local ack = acks[ns.Names.key(member.who)]
          rows[#rows + 1] = {
            who = member.who, label = label, note = "", class = member.class or (ack and ack.class), missing = true,
            winner = isWinner or nil, given = (isWinner and entry.given) or nil,
          }
        end
      end
      if winnerKey and not found then
        if PSEUDO_LABEL[ns.Names.key(entry.winner) or ""] then
          -- Disenchant or Guild bank: nobody was asked, so it is no missing answer
          rows[#rows + 1] = { who = entry.winner, label = "Awarded", note = "", winner = true, given = entry.given }
        else
          local ack = acks[ns.Names.key(entry.winner)]
          rows[#rows + 1] = { who = entry.winner, label = label, note = "", class = ack and ack.class, winner = true, given = entry.given, missing = true }
        end
      end
    end
    return rows
  end

  -- The raider's frame: the items of the latest session on offer, each with its time left and the answer given.
  function self.offerModel()
    local model = { rows = {} }
    for _, offer in ipairs(offers.list()) do
      if offer.sid == lastSid then
        model.master = offer.mine and "you" or offer.master
        model.rows[#model.rows + 1] = {
          sid = offer.sid, n = offer.n, count = offer.count, item = offer.item,
          name = offer.name or ("item " .. tostring(Council.itemId(offer.item))), quality = offer.quality or 1, icon = iconOf(offer.item),
          remaining = math.floor(offers.remaining(offer)), state = offer.state, myCode = offer.myCode, myNote = offer.myNote,
          myLabel = offer.myCode and Council.label(offer.myCode) or nil,
          note = offer.draftNote or (offer.myNote ~= "" and offer.myNote) or nil, -- what the Note button edits
        }
      end
    end
    return model
  end

  -- Is a loot session running? (The import window refuses a new night then.)
  function self.sessionOpen() return session ~= nil and session.state == "running" end

  function self.openOffers() return #offers.open() end
  function self.trader() return trading() end
  function self.session() return session end
  function self.offerList() return offers end
  function self.outbox() return outbox end
  function self.frame() return frame end
  return self
end
