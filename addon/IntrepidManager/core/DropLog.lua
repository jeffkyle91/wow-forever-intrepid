-- Intrepid Manager: the drop log. Inside dungeons and raids it counts which creature or encounter dropped which items, so the
-- Raid Desk's drop lists can be filled from the game (docs/design/drop-list-import.md, section 2). Pure Lua: game/DropWatch.lua
-- reads the client and hands the facts in, so every rule here is tested without the game.
--
-- It keeps counts, not a history. Never kept: a player's name or GUID, a creature's GUID (only a short checksum of a corpse's,
-- to count each corpse once), chat text, master loot candidates, roll results or winners. Creature, item and zone names are
-- the game's.
--
--   local log = ns.DropLog.new(IntrepidManagerDB)            -- keeps its data in db.drops
--   log.encounterStart(zone, id, name); log.bossUnit(npcId, name); log.encounterEnd(zone, id, name, success, now)
--   log.unit(npcId, name, classification)                      -- a creature seen as the target or under the mouse
--   log.window(zone, window, now)                              -- the first LOOT_READY of a loot window
--   log.roll(zone, item, encounterId, now)                     -- a roll the game's loot history files under an encounter
--   log.sourceOf(itemId)                                       -- "Boss, Zone" for an item a boss or a rare dropped here
--   log.zones()                                                -- the zones, newest first, as summaries
--
-- A zone fact: { instanceId, difficultyId, name, instanceType = "party" or "raid", maxPlayers, method }.
-- A window: { masterLooter = true?, threshold = 2, slots = { { itemId, name, quality, quest = true?, boe = true?, sources = { guid, ... } } } }.
--
-- How a corpse is told (section 2.2): only the first window of a corpse counts; a boss is a creature that was a boss unit of
-- an encounter won here; a guessed boss is the first corpse the master looter opens with loot at or above the threshold
-- within 5 minutes of a won encounter (it needs 2 kills, or the journal, to count as sure); a chest counts only for the master
-- looter within those 5 minutes; a rare is a creature the game classed rare; everything else is trash.

local _, ns = ...

local DropLog = {}
ns.DropLog = DropLog

DropLog.SCHEMA = 1
DropLog.WINDOW = 300 -- seconds after a won encounter in which a chest or a guessed boss belongs to it
DropLog.MAX_CORPSES = 200
DropLog.MAX_ITEMS_PER_SOURCE = 80
DropLog.MAX_SOURCES_PER_ZONE = 100
DropLog.MAX_ZONES = 60
DropLog.MAX_ITEMS = 20000
DropLog.MAX_UNITS = 500
DropLog.FLOOR = { boss = 2, rare = 2, trash = 3 } -- the lowest quality kept: Uncommon from bosses and rares, Rare from trash
DropLog.CONFIRM_KILLS = 2
local MAX_ID = 100000000
local MAX_NAME = 100

local function gameId(value)
  return type(value) == "number" and value >= 1 and value <= MAX_ID and value == math.floor(value)
end
DropLog.gameId = gameId

-- A name the drops string can carry: text with something in it, cut to 100 bytes. Nil otherwise.
local function cleanName(value)
  if type(value) ~= "string" then return nil end
  local text = string.match(value, "^%s*(.-)%s*$")
  if text == "" then return nil end
  return string.sub(text, 1, MAX_NAME)
end
DropLog.cleanName = cleanName

-- "Creature-0-4170-34-7-12345-00002B3C1D" -> "Creature", 12345. The sixth field is the creature's (or the object's) id.
function DropLog.parseGuid(guid)
  if type(guid) ~= "string" then return nil end
  local fields = {}
  for field in string.gmatch(guid, "[^%-]+") do fields[#fields + 1] = field end
  local kind = fields[1]
  if not kind or not string.find(kind, "^%a+$") then return nil end
  return kind, tonumber(fields[6])
end

local CREATURES = { Creature = true, Vehicle = true }

-- The key of a zone: the instance and its difficulty.
function DropLog.zoneKey(zone)
  if type(zone) ~= "table" or not gameId(zone.instanceId) then return nil end
  local difficulty = type(zone.difficultyId) == "number" and zone.difficultyId or 0
  return string.format("%.0f:%.0f", zone.instanceId, difficulty)
end

function DropLog.new(db, options)
  options = options or {}
  local hash = options.hash or function(text) return ns.Crc32.hex(text) end
  local self = {}

  local function store()
    local data = db.drops
    if type(data) ~= "table" or data.schema ~= DropLog.SCHEMA then
      data = { schema = DropLog.SCHEMA, zones = {}, zoneCount = 0, itemCount = 0, corpses = {}, cursor = 0, stats = {} }
      db.drops = data
    end
    return data
  end

  local function count(name, by)
    local stats = store().stats
    stats[name] = (stats[name] or 0) + (by or 1)
  end
  self.count = count

  -- In memory only: the creatures seen as target or under the mouse (name, classification), the encounter being fought, and the
  -- set of corpse checksums (rebuilt from the saved ring at the first window).
  local units, unitCount = {}, 0
  local fight
  local corpseSet

  ---------------------------------------------------------------------------------------------------------------
  -- Zones and sources
  ---------------------------------------------------------------------------------------------------------------

  local function dropZone(data, key)
    local zone = data.zones[key]
    if not zone then return end
    for _, source in pairs(zone.sources) do data.itemCount = data.itemCount - (source.count or 0) end
    data.zones[key] = nil
    data.zoneCount = data.zoneCount - 1
  end

  -- The zone of a zone fact, made when first needed. A full log drops the zone not seen for the longest time.
  local function zoneOf(fact, now)
    local key = DropLog.zoneKey(fact)
    if not key then return nil end
    local data = store()
    local zone = data.zones[key]
    if not zone then
      if data.zoneCount >= DropLog.MAX_ZONES then
        local oldestKey, oldest
        for otherKey, other in pairs(data.zones) do
          if not oldest or (other.last or 0) < (oldest.last or 0) then oldestKey, oldest = otherKey, other end
        end
        dropZone(data, oldestKey)
        count("zonesDropped")
      end
      zone = { instanceId = fact.instanceId, difficultyId = fact.difficultyId, first = now, sources = {}, count = 0, bosses = {}, guesses = {}, methods = {} }
      data.zones[key] = zone
      data.zoneCount = data.zoneCount + 1
    end
    zone.name = cleanName(fact.name) or zone.name or ("Instance " .. string.format("%.0f", fact.instanceId))
    zone.kind = fact.instanceType == "raid" and "raid" or "dungeon"
    if type(fact.maxPlayers) == "number" and fact.maxPlayers >= 1 and fact.maxPlayers <= 40 then zone.players = fact.maxPlayers end
    if fact.method ~= nil then zone.methods[tostring(fact.method)] = true end
    zone.last = now
    return zone, key
  end

  local function removeSource(zone, key)
    local source = zone.sources[key]
    if not source then return end
    store().itemCount = store().itemCount - (source.count or 0)
    zone.sources[key] = nil
    zone.count = zone.count - 1
  end

  -- A source of a zone by its key ("n12345" for a creature, "e678" for an encounter known only by its id), made when first
  -- needed. A full zone makes room for a boss or a rare by dropping the trash creature seen longest ago; trash waits.
  local function sourceOf(zone, key, make)
    local source = zone.sources[key]
    if source then return source end
    if zone.count >= DropLog.MAX_SOURCES_PER_ZONE then
      local victimKey, victim
      if make.kind ~= "trash" then
        for otherKey, other in pairs(zone.sources) do
          if other.kind == "trash" and (not victim or (other.last or 0) < (victim.last or 0)) then victimKey, victim = otherKey, other end
        end
      end
      if not victimKey then
        count("full")
        return nil
      end
      removeSource(zone, victimKey)
    end
    source = { npcId = make.npcId, encounterId = make.encounterId, name = make.name, kind = make.kind, guessed = make.guessed, kills = 0, items = {}, count = 0 }
    zone.sources[key] = source
    zone.count = zone.count + 1
    return source
  end

  -- One item seen under a source, in one kill. The same item in the same kill (a window and a roll of one corpse, or a window
  -- opened twice) counts once.
  local function addItem(source, slot, killKey, via, now)
    local data = store()
    local item = source.items[slot.itemId]
    if not item then
      if source.count >= DropLog.MAX_ITEMS_PER_SOURCE then
        -- a full list keeps the items seen most: the one seen least (and longest ago) makes room
        local leastId, least
        for id, other in pairs(source.items) do
          if not least or other.n < least.n or (other.n == least.n and (other.last or 0) < (least.last or 0)) then leastId, least = id, other end
        end
        source.items[leastId] = nil
        source.count = source.count - 1
        data.itemCount = data.itemCount - 1
        count("itemsDropped")
      end
      if data.itemCount >= DropLog.MAX_ITEMS then
        count("full")
        return
      end
      item = { n = 0 }
      source.items[slot.itemId] = item
      source.count = source.count + 1
      data.itemCount = data.itemCount + 1
    end
    if item.k ~= killKey then
      item.n = item.n + 1
      item.k = killKey
    end
    item.last = now
    item.name = cleanName(slot.name) or item.name
    if type(slot.quality) == "number" then item.quality = slot.quality end
    if slot.boe then item.boe = true end
    if slot.quest then item.quest = true end
    if via == "window" or not item.via then item.via = via end
    count("kept")
  end

  local function kill(source, killKey, now)
    if source.k ~= killKey then
      source.kills = source.kills + 1
      source.k = killKey
    end
    source.first = source.first or now
    source.last = now
  end

  local function killKeyOf(last)
    return "e" .. string.format("%.0f", last.id) .. "@" .. string.format("%.0f", last.at)
  end

  -- The last won encounter, when it was won in this zone less than WINDOW seconds ago.
  local function recent(key, now)
    local last = store().last
    if last and last.zone == key and type(last.at) == "number" and now - last.at >= 0 and now - last.at <= DropLog.WINDOW then return last end
    return nil
  end

  -- The name of a boss: the encounter's name when the encounter had one boss, else the unit's name.
  local function bossName(npcId, encounterId, last)
    local unitName = units[npcId] and units[npcId].name
    if last and last.id == encounterId then
      if #(last.npcs or {}) <= 1 and last.name then return last.name end
      if last.names and last.names[tostring(npcId)] then return last.names[tostring(npcId)] end
    end
    return unitName or (last and last.id == encounterId and last.name) or ("Creature " .. string.format("%.0f", npcId))
  end

  -- A source known only by its encounter (from rolls or a chest) joins the boss creature of that encounter once it is known.
  local function joinEncounter(zone, encounterId, into)
    local key = "e" .. string.format("%.0f", encounterId)
    local loose = zone.sources[key]
    if not loose or loose == into then return end
    for id, item in pairs(loose.items) do
      local mine = into.items[id]
      if mine then
        if item.n > mine.n then mine.n = item.n end
        if (item.last or 0) > (mine.last or 0) then mine.last = item.last end
        if item.via == "window" then mine.via = "window" end
      elseif into.count < DropLog.MAX_ITEMS_PER_SOURCE then
        into.items[id] = item
        into.count = into.count + 1
        loose.items[id] = nil
        loose.count = loose.count - 1
      end
    end
    -- (the kill the loose source last counted is the boss's kill too, so carry its key: the same kill is not counted twice)
    if loose.kills > into.kills then into.kills, into.k = loose.kills, loose.k end
    if into.k == nil then into.k = loose.k end
    if loose.first and (not into.first or loose.first < into.first) then into.first = loose.first end
    removeSource(zone, key)
  end

  local function bossSource(zone, npcId, encounterId, last, guessed)
    local source = sourceOf(zone, "n" .. string.format("%.0f", npcId), {
      npcId = npcId, encounterId = encounterId, name = bossName(npcId, encounterId, last), kind = "boss", guessed = guessed or nil,
    })
    if not source then return nil end
    source.kind, source.encounterId = "boss", encounterId
    if not guessed then source.guessed = nil end
    joinEncounter(zone, encounterId, source)
    return source
  end

  -- The source for something filed under an encounter: its boss creature when the zone knows it, else the encounter itself.
  local function encounterSource(zone, last)
    local npc
    for _, id in ipairs(last.npcs or {}) do
      if zone.bosses[id] == last.id then npc = id break end
    end
    if not npc then
      for id, encounterId in pairs(zone.bosses) do
        if encounterId == last.id and (not npc or id < npc) then npc = id end
      end
    end
    if npc then return bossSource(zone, npc, last.id, last) end
    return sourceOf(zone, "e" .. string.format("%.0f", last.id), { encounterId = last.id, name = cleanName(last.name) or ("Encounter " .. string.format("%.0f", last.id)), kind = "boss" })
  end

  ---------------------------------------------------------------------------------------------------------------
  -- Corpses: each counted once
  ---------------------------------------------------------------------------------------------------------------

  local function seenCorpse(guid)
    local data = store()
    if not corpseSet then
      corpseSet = {}
      for _, h in ipairs(data.corpses) do corpseSet[h] = true end
    end
    local h = hash(guid)
    if corpseSet[h] then return true, h end
    data.cursor = (data.cursor % DropLog.MAX_CORPSES) + 1
    local old = data.corpses[data.cursor]
    if old then corpseSet[old] = nil end
    data.corpses[data.cursor] = h
    corpseSet[h] = true
    return false, h
  end

  ---------------------------------------------------------------------------------------------------------------
  -- Facts
  ---------------------------------------------------------------------------------------------------------------

  function self.unit(npcId, name, classification)
    if not gameId(npcId) then return end
    local entry = units[npcId]
    if not entry then
      if unitCount >= DropLog.MAX_UNITS then units, unitCount = {}, 0 end
      entry = {}
      units[npcId] = entry
      unitCount = unitCount + 1
    end
    entry.name = cleanName(name) or entry.name
    if type(classification) == "string" then entry.class = classification end
  end

  function self.encounterStart(zone, id, name)
    if not gameId(id) then return end
    fight = { id = id, name = cleanName(name), zone = DropLog.zoneKey(zone), npcs = {}, names = {} }
    count("encounters")
  end

  -- A boss unit read during the fight (boss1 to boss5).
  function self.bossUnit(npcId, name)
    if not fight or not gameId(npcId) then return end
    for _, id in ipairs(fight.npcs) do
      if id == npcId then return end
    end
    if #fight.npcs >= 5 then return end
    fight.npcs[#fight.npcs + 1] = npcId
    fight.names[tostring(npcId)] = cleanName(name)
    self.unit(npcId, name, nil)
  end

  function self.encounterEnd(zoneFact, id, name, success, now)
    if not gameId(id) then return end
    local current = fight
    fight = nil
    if not success then
      count("encountersLost")
      return
    end
    count("encountersWon")
    local zone, key = zoneOf(zoneFact, now)
    if not zone then return end
    local npcs, names = {}, {}
    if current and current.id == id then npcs, names = current.npcs, current.names end
    for _, npcId in ipairs(npcs) do zone.bosses[npcId] = id end
    store().last = { id = id, name = cleanName(name) or (current and current.name), at = now, zone = key, npcs = npcs, names = names }
  end

  -- The first LOOT_READY of a loot window. Slots of several corpses (area loot) are told apart by their source.
  function self.window(zoneFact, window, now)
    local zone, key = zoneOf(zoneFact, now)
    if not zone then return end
    count("windows")
    local groups, order = {}, {}
    local any = false
    for _, slot in ipairs(window.slots or {}) do
      if gameId(slot.itemId) then
        local sources = slot.sources or {}
        if #sources == 0 then count("noSource") end
        for _, guid in ipairs(sources) do
          if not groups[guid] then
            groups[guid] = {}
            order[#order + 1] = guid
          end
          local list = groups[guid]
          list[#list + 1] = slot
          any = true
        end
      end
    end
    if not any then return end
    local threshold = type(window.threshold) == "number" and window.threshold or 2

    for _, guid in ipairs(order) do
      local slots = groups[guid]
      local kind, npcId = DropLog.parseGuid(guid)
      local repeated, h = seenCorpse(guid)
      if repeated then
        count("repeats")
      else
        count("corpses")
        local source, killKey, floor
        local last = recent(key, now)
        if kind == "GameObject" then
          if window.masterLooter and last then
            source, killKey, floor = encounterSource(zone, last), killKeyOf(last), DropLog.FLOOR.boss
            count("chests")
          else
            count("objectsIgnored")
          end
        elseif CREATURES[kind] and gameId(npcId) then
          local key2 = "n" .. string.format("%.0f", npcId)
          local encounterId = zone.bosses[npcId]
          -- a known boss's corpse belongs to the last win of its encounter here, however long the group took to open it
          local won = store().last
          local ofLast = encounterId ~= nil and won ~= nil and won.zone == key and won.id == encounterId
          if ofLast then last = won end
          if encounterId then
            source = bossSource(zone, npcId, encounterId, ofLast and last or nil)
            killKey = ofLast and killKeyOf(last) or ("c" .. h)
            if ofLast then last.claimed = true end
            floor = DropLog.FLOOR.boss
          else
            local atThreshold = false
            for _, slot in ipairs(slots) do
              if type(slot.quality) == "number" and slot.quality >= threshold then atThreshold = true end
            end
            local known = zone.sources[key2]
            if window.masterLooter and last and not last.claimed and atThreshold and not (known and known.kind ~= "boss") then
              -- a guessed boss: one guess never decides; the same creature on CONFIRM_KILLS kills of the encounter does
              local guess = zone.guesses[npcId]
              if guess and guess.e == last.id and guess.k ~= killKeyOf(last) then
                guess.n, guess.k = guess.n + 1, killKeyOf(last)
              elseif not guess or guess.e ~= last.id then
                guess = { e = last.id, n = 1, k = killKeyOf(last) }
                zone.guesses[npcId] = guess
              end
              local sure = guess.n >= DropLog.CONFIRM_KILLS
              if sure then
                zone.bosses[npcId] = last.id
                count("confirmed")
              else
                count("guessed")
              end
              source = bossSource(zone, npcId, last.id, last, not sure)
              killKey, floor = killKeyOf(last), DropLog.FLOOR.boss
              last.claimed = true
            else
              local unit = units[npcId]
              local rare = unit and (unit.class == "rare" or unit.class == "rareelite")
              local creatureKind = rare and "rare" or "trash"
              if known and known.kind == "boss" then creatureKind = "boss" end
              floor = DropLog.FLOOR[creatureKind]
              killKey = "c" .. h
              -- trash is only kept when something of it is: a creature with nothing at the floor makes no entry
              local keep = creatureKind ~= "trash" or known ~= nil
              if not keep then
                for _, slot in ipairs(slots) do
                  if type(slot.quality) == "number" and slot.quality >= floor then keep = true end
                end
              end
              if keep then
                source = known or sourceOf(zone, key2, { npcId = npcId, name = cleanName(unit and unit.name) or ("Creature " .. string.format("%.0f", npcId)), kind = creatureKind })
                if source and rare and source.kind == "trash" then source.kind = "rare" end
                if source and unit and unit.name and string.find(source.name or "", "^Creature %d+$") then source.name = cleanName(unit.name) end
              else
                count("trashEmpty")
              end
            end
          end
        else
          count("otherSources")
        end
        if source then
          kill(source, killKey, now)
          for _, slot in ipairs(slots) do
            if type(slot.quality) == "number" and slot.quality >= floor then
              addItem(source, slot, killKey, "window", now)
            else
              count("belowFloor")
            end
          end
        end
      end
    end
  end

  -- A roll the game's loot history puts under encounter `encounterId` (the watcher checked that). It is filed under the
  -- encounter's boss when the zone knows it, else under the encounter.
  function self.roll(zoneFact, item, encounterId, now)
    count("rolls")
    if type(item) ~= "table" or not gameId(item.itemId) then return end
    local zone, key = zoneOf(zoneFact, now)
    if not zone then return end
    local last = store().last
    if not (last and last.zone == key and last.id == encounterId) then
      count("rollsUnfiled")
      return
    end
    local source = encounterSource(zone, last)
    if not source then return end
    local killKey = killKeyOf(last)
    kill(source, killKey, now)
    if type(item.quality) == "number" and item.quality >= DropLog.FLOOR.boss then
      addItem(source, item, killKey, "roll", now)
      count("rollsFiled")
    else
      count("belowFloor")
    end
  end

  ---------------------------------------------------------------------------------------------------------------
  -- Reading the log
  ---------------------------------------------------------------------------------------------------------------

  -- "Boss, Zone" for an item a boss or a rare dropped here, from the zone seen most recently first; nil otherwise.
  function self.sourceOf(itemId)
    if not gameId(itemId) then return nil end
    local best, bestZone
    for _, zone in pairs(store().zones) do
      for _, source in pairs(zone.sources) do
        if (source.kind == "boss" or source.kind == "rare") and source.items[itemId] then
          if not bestZone or (zone.last or 0) > (bestZone.last or 0) then best, bestZone = source, zone end
        end
      end
    end
    if not best then return nil end
    return best.name .. ", " .. bestZone.name
  end

  -- The zones as summaries, the one seen last first: { key, name, kind, players, difficultyId, first, last, creatures, bosses, items }.
  function self.zones()
    local list = {}
    for key, zone in pairs(store().zones) do
      local bosses, items = 0, 0
      for _, source in pairs(zone.sources) do
        if source.kind == "boss" then bosses = bosses + 1 end
        items = items + (source.count or 0)
      end
      list[#list + 1] = {
        key = key, name = zone.name, kind = zone.kind, players = zone.players, difficultyId = zone.difficultyId,
        first = zone.first, last = zone.last, creatures = zone.count, bosses = bosses, items = items,
      }
    end
    table.sort(list, function(a, b)
      if (a.last or 0) ~= (b.last or 0) then return (a.last or 0) > (b.last or 0) end
      return a.key < b.key
    end)
    return list
  end

  function self.store() return store() end
  function self.last() return store().last end
  function self.fighting() return fight ~= nil end

  return self
end
