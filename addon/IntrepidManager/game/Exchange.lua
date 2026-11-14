-- Intrepid Manager: the exchange with the Raid Desk (docs/spec/exchange-v0.md). It keeps the night the loot master imported and the
-- awards the loot sessions make, in the saved variables, and builds the awards string for the export window.
--
-- The night (section 5): what the Raid Desk's "Copy for addon" made, as ns.Night.read accepted it. A new import replaces it.
-- The awards (section 6): one record for each award the loot master makes, in the shape of the spec, written as the session goes:
-- assigned when the item is awarded, received when the trade went through, removed (a new revision) when the award is taken
-- back. An award is never changed in recipient or item: that is a removal and a new award with a new id. The ids are made from the
-- session's start time and four random characters chosen when the addon loads, so a crash never reuses one (section 6.1).
--
--   local exchange = ns.Game.Exchange.new({ db = IntrepidManagerDB, version = "0.0.17" })
--   exchange.importNight(result)            -- the loot master pressed Import: result is what ns.Night.read made of the string
--   exchange.nightText()                    -- "Night of 2026-12-09, copied 2 hours ago: 24 players, 24 priorities." or nil
--   exchange.beginSession(key)              -- a loot session starts (key tells it from the others of this load)
--   exchange.awarded(key, entry, winner)    -- item `entry` ({ n, item, name }) goes to `winner` (a full name, or "Disenchant" or "Guild bank")
--   exchange.unawarded(key, entry)          -- the award is taken back
--   exchange.given(key, entry, how)         -- the item reached the winner: how is "trade", "master-loot" or "manual"
--   exchange.exportModel(everything)        -- the view-model of ui/ExportWindow
--
-- The names of players are in these records: they are what the Raid Desk needs, and the saved file is not for sharing.

local _, ns = ...

local Exchange = {}
ns.Game = ns.Game or {}
ns.Game.Exchange = Exchange

local MAX_LOG = 2000 -- awards kept; a raid night makes a few dozen
Exchange.PSEUDO_LABEL = { disenchant = "Disenchant", ["guild-bank"] = "Guild bank" }

-- "disenchant" or "guild-bank" for the labels of the pseudo recipients (any case, "guild bank" or "guild-bank"), else nil.
function Exchange.pseudoOf(name)
  local key = ns.Names.key(name)
  if key == "disenchant" then return "disenchant" end
  if key == "guild bank" or key == "guild-bank" then return "guild-bank" end
  return nil
end

local function cut(text, limit)
  text = tostring(text or "")
  if #text <= limit then return text end
  return string.sub(text, 1, limit)
end

-- options: db (the saved variables), version (the addon's), now (server time, default GetServerTime), dateOf(at) (the loot master's
-- local date as YYYY-MM-DD), random (math.random), sessionOpen() (a loot session runs).
function Exchange.new(context)
  local db = context.db
  local Council, Names, Ids, Awards, Night, Envelope = ns.Council, ns.Names, ns.Ids, ns.Awards, ns.Night, ns.Envelope
  local now = context.now or function() return GetServerTime() end
  local dateOf = context.dateOf or function(at) return date("%Y-%m-%d", at) end
  local random = context.random or math.random
  local self = {}

  local part = Ids.randomPart(random) -- for every session of this load
  local sessions = {} -- key -> { id, next }
  local current = {} -- key .. "/" .. n -> the record of the award the item has now
  local rosterIndex, priorityIndex

  local function log()
    if not db.awards then db.awards = { schema = 1, log = {} } end
    return db.awards.log
  end

  ---------------------------------------------------------------------------------------------------------------
  -- The night
  ---------------------------------------------------------------------------------------------------------------

  local function indexNight()
    rosterIndex, priorityIndex = {}, {}
    local night = db.night
    if not night then return end
    for _, player in ipairs(night.roster or {}) do
      if type(player.surname) == "string" and string.match(player.surname, "[^ ]") then
        local key = Names.normalize(player.name .. " " .. player.surname)
        if key then
          rosterIndex[key] = rosterIndex[key] or {}
          table.insert(rosterIndex[key], player)
        end
      end
    end
    for _, priority in ipairs(night.priorities or {}) do
      if priority.itemId then
        priorityIndex[priority.itemId] = priorityIndex[priority.itemId] or {}
        table.insert(priorityIndex[priority.itemId], priority)
      end
    end
  end

  function self.night() return db.night end

  -- Keep the night that ns.Night.read accepted (its roster, priorities and so on, as the rows that passed). A string that did not read
  -- changes nothing. Returns { ok, message } for the import window.
  function self.importNight(result)
    if context.sessionOpen and context.sessionOpen() then
      return { ok = false, message = "Finish or cancel the open session first." }
    end
    if type(result) ~= "table" or not result.ok or type(result.model) ~= "table" then
      return { ok = false, message = "That string does not read as a night." }
    end
    local at = now()
    db.night = {
      id = result.model.id, at = result.model.at, by = result.model.by, phase = result.model.phase, raid = result.raid,
      known = result.known, roster = result.roster, bosses = result.bosses, priorities = result.priorities,
      skipped = #result.skipped, importedAt = at,
    }
    indexNight()
    local info = Night.summary(result, at, nil)
    return { ok = true, message = "Imported. " .. info.text }
  end

  -- The sentence about the night the addon has now, or nil.
  function self.nightText()
    local night = db.night
    if not night then return nil end
    local stand = { model = { at = night.at }, raid = night.raid, roster = night.roster or {}, priorities = night.priorities or {}, skipped = {}, problems = {} }
    return Night.summary(stand, now(), nil).text
  end

  if db.night then indexNight() end

  ---------------------------------------------------------------------------------------------------------------
  -- The awards
  ---------------------------------------------------------------------------------------------------------------

  local function sessionInfo(key)
    local info = sessions[key]
    if not info then
      info = { id = Ids.sessionId(now(), part), next = 1 }
      sessions[key] = info
    end
    return info
  end

  function self.beginSession(key)
    sessions[key] = { id = Ids.sessionId(now(), part), next = 1 }
  end

  -- The roster entry a full name belongs to, when exactly one entry of the night has it (spec section 2).
  local function rosterEntry(fullName)
    local key = Names.normalize(fullName)
    local found = key and rosterIndex and rosterIndex[key]
    if found and #found == 1 then return found[1] end
  end

  -- The priority of the night this award counts for: the ones for the item, the one the recipient is on when there are several.
  local function priorityFor(itemId, player)
    local candidates = priorityIndex and priorityIndex[itemId]
    if not candidates then return nil end
    if player then
      for _, priority in ipairs(candidates) do
        for _, line in ipairs(priority.lines or {}) do
          if line.k == player.k then return priority end
        end
      end
    end
    return candidates[1]
  end

  local function newRecord(key, entry, winner)
    local info = sessionInfo(key)
    local number = info.next
    info.next = number + 1
    local at = now()
    local itemId = Council.itemId(entry.item)
    local record = { id = Ids.awardId(info.id, number), rev = Ids.nextRev(nil, at), session = info.id, at = at, date = dateOf(at) }
    local night = db.night
    if night then
      record.phase = night.phase
      record.raid = night.raid and night.raid.id or nil
    end
    record.itemId = itemId
    record.item = cut(entry.name or ("Item " .. tostring(itemId)), 120)
    local player
    local pseudo = Exchange.pseudoOf(winner)
    if pseudo then
      record.pseudo = pseudo
      record.to = Exchange.PSEUDO_LABEL[pseudo]
    else
      record.to = cut(winner, 121)
      player = rosterEntry(winner)
      if player then record.toId = player.id end
    end
    record.decision = "council"
    local priority = priorityFor(itemId, player)
    if priority then
      record.priority = priority.id
      record.encounter = priority.encounter
      record.npcId = priority.npcId
      record.zoneId = priority.zoneId
    end
    record.delivery = { state = "assigned" }
    local entries = log()
    entries[#entries + 1] = record
    while #entries > MAX_LOG do table.remove(entries, 1) end
    current[key .. "/" .. entry.n] = record
    return record
  end

  local function removeRecord(record)
    if record.status == "removed" then return end
    record.status = "removed"
    record.rev = Ids.nextRev(record.rev, now())
  end

  function self.awarded(key, entry, winner)
    local previous = current[key .. "/" .. entry.n]
    if previous then removeRecord(previous) end
    return newRecord(key, entry, winner)
  end

  function self.unawarded(key, entry)
    local previous = current[key .. "/" .. entry.n]
    if previous then removeRecord(previous) end
    current[key .. "/" .. entry.n] = nil
  end

  function self.given(key, entry, how)
    local record = current[key .. "/" .. entry.n]
    if not record then return end
    local at = now()
    record.delivery = { state = "received", at = at, how = how or "manual" }
    record.rev = Ids.nextRev(record.rev, at)
  end

  function self.log() return log() end

  ---------------------------------------------------------------------------------------------------------------
  -- The export
  ---------------------------------------------------------------------------------------------------------------

  -- The view-model of the export window (ui/ExportWindow): which awards the string holds is decided by Awards.select (spec 6.1).
  function self.exportModel(everything)
    local at = now()
    local night = db.night and { model = { phase = db.night.phase }, known = db.night.known or {} } or nil
    local selected = Awards.select(log(), night, at, everything)
    local vm = {
      count = selected.count, new = selected.new, changed = selected.changed, hasNight = night ~= nil, everything = everything and true or false,
      sessionOpen = context.sessionOpen and context.sessionOpen() or false,
    }
    if selected.count > 0 then
      vm.text = Awards.encode({
        schema = 1, id = Ids.exportId(at, random), at = at, by = "IntrepidManager/" .. cut(context.version or "unknown", 40),
        awards = selected.awards,
      })
    end
    return vm
  end

  -- Read what an export holds back through the reader (for the tests and /im export): the count and the row errors.
  function self.verify(text)
    local read = Envelope.read(text, "awards")
    if not read.ok then return nil, read.message or read.code end
    local checked = Awards.check(read.model)
    if not checked.ok then return nil, checked.message end
    return #read.model.awards, checked.rowErrors
  end

  return self
end
