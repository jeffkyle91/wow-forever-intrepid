-- Intrepid Manager: the exchange with the Raid Desk (docs/spec/exchange-v0.md). It keeps the night the loot master imported and the
-- awards the loot sessions make, in the saved variables, and builds the awards string for the export window.
--
-- The night (section 5): what the Raid Desk's "Copy for addon" made, as ns.Night.read accepted it. A new import replaces it.
-- The awards (section 6): one record for each award the loot master makes, in the shape of the spec, written as the session goes:
-- assigned when the item is awarded, received when the trade went through, removed (a new revision) when the award is taken
-- back. An award is never changed in recipient or item: that is a removal and a new award with a new id. The ids are made from the
-- session's start time and four random characters chosen when the addon loads, so a crash never reuses one (section 6.1).
-- Each award also keeps `place`, the dungeon or raid the loot master was in, for the loot history (core/History.lua). It is not in
-- the spec, so the export leaves it out. The log keeps the last Exchange.MAX_LOG awards: the history's "everything".
--
--   local exchange = ns.Game.Exchange.new({ db = IntrepidManagerDB, version = "0.0.17" })
--   exchange.importNight(result)            -- the loot master pressed Import: result is what ns.Night.read made of the string
--   exchange.nightText()                    -- "Night of 2026-12-09, copied 2 hours ago: 24 players, 24 priorities." or nil
--   exchange.beginSession(key)              -- a loot session starts (key tells it from the others of this load)
--   exchange.awarded(key, entry, winner)    -- item `entry` ({ n, item, name }) goes to `winner` (a full name, or "Disenchant" or "Guild bank")
--   exchange.unawarded(key, entry)          -- the award is taken back
--   exchange.given(key, entry, how)         -- the item reached the winner: how is "trade", "master-loot" or "manual"
--   exchange.exportModel(everything)        -- the view-model of ui/ExportWindow
--   exchange.log()                          -- the awards, oldest first (the loot history reads it)
--
-- The names of players are in these records: they are what the Raid Desk needs, and the saved file is not for sharing.

local _, ns = ...

local Exchange = {}
ns.Game = ns.Game or {}
ns.Game.Exchange = Exchange

-- Awards kept. A raid night makes a few dozen, so this is years of raiding; the loot owner chose it on 2026-11-13, to be watched
-- (/im history stats says how many there are and how big they are).
local MAX_LOG = 10000
Exchange.MAX_LOG = MAX_LOG
-- The fields an award keeps for the addon alone: the export leaves them out (the spec has no such field).
local LOCAL_FIELDS = { place = true }
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

-- The dungeon or raid the player is in, by the game's name, or nil outside one (GetInstanceInfo; any failure is nil).
function Exchange.currentPlace()
  if not GetInstanceInfo then return nil end
  local ok, name, instanceType = pcall(GetInstanceInfo)
  if not ok or type(name) ~= "string" or name == "" then return nil end
  if instanceType == "party" or instanceType == "raid" then return name end
  return nil
end

-- An award as the spec has it: a copy without the fields the addon keeps for itself.
local function forExport(award)
  local copy = {}
  for key, value in pairs(award) do
    if not LOCAL_FIELDS[key] then copy[key] = value end
  end
  return copy
end

-- options: db (the saved variables), version (the addon's), now (server time, default GetServerTime), dateOf(at) (the loot master's
-- local date as YYYY-MM-DD), random (math.random), sessionOpen() (a loot session runs), place() (the dungeon or raid the player is
-- in, default Exchange.currentPlace).
function Exchange.new(context)
  local db = context.db
  local Council, Names, Ids, Awards, Night, Envelope = ns.Council, ns.Names, ns.Ids, ns.Awards, ns.Night, ns.Envelope
  local now = context.now or function() return GetServerTime() end
  local dateOf = context.dateOf or function(at) return date("%Y-%m-%d", at) end
  local random = context.random or math.random
  local place = context.place or Exchange.currentPlace
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
    local where = place()
    if type(where) == "string" and where ~= "" then record.place = cut(where, 120) end
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

  -- The view-model of the export window (ui/ExportWindow): which awards the string holds is decided by Awards.select (spec 6.1),
  -- and the string never passes Awards.LIMIT: what does not fit waits for the next export (`left`). `only` = { ids = award id ->
  -- true, label = "Molten Core - Wed, Dec 9, 2026, 8:05 PM" }: those awards only, a night or a raid of the loot history.
  function self.exportModel(everything, only)
    local at = now()
    local night = db.night and { model = { phase = db.night.phase }, known = db.night.known or {} } or nil
    everything = everything and not only
    local selected = Awards.select(log(), night, at, everything, only and only.ids)
    local plain = {}
    for index, award in ipairs(selected.awards) do plain[index] = forExport(award) end
    selected.awards = plain
    selected = Awards.fit(selected)
    local vm = {
      count = selected.count, new = selected.new, changed = selected.changed, left = selected.left, hasNight = night ~= nil,
      everything = everything and true or false, sessionOpen = context.sessionOpen and context.sessionOpen() or false,
      session = only and only.label or nil,
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
