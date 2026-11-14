-- The awarded marks the addon shows (docs/spec/exchange-v0.md, section 7). Pure Lua 5.1 with no client calls.
--
-- The app computes the marks and sends them as each line's `awarded` flag; the addon adds only its own awards made
-- since. Marks.compute starts from the night's flags and adds those awards.
--
-- Marks.compute(night, log)
--   night  a night as Night.check gave it (ok = true)
--   log    the addon's own awards: tables with id, rev, phase, item, to, and perhaps priority, toId, pseudo, status
-- returns { awarded = { [priority id] = { true or false for each line, in order } },
--           changed = { ids of awards the night knows in an older revision than the log's } }
-- The night and the log are not changed.

local _, ns = ...

local Marks = {}
ns.Marks = Marks

local Names = ns.Names

-- A roster entry that has a surname (not blank). Without one it matches no game character.
local function hasSurname(player)
  return type(player.surname) == "string" and not string.find(player.surname, "^ *$")
end

function Marks.compute(night, log)
  local awarded = {}
  for _, priority in ipairs(night.priorities) do
    local flags = {}
    for position, line in ipairs(priority.lines) do flags[position] = line.awarded == true end
    awarded[priority.id] = flags
  end

  local known = {}
  for _, entry in ipairs(night.known) do known[entry.id] = entry.rev end

  -- Roster entries by full name. A name two entries share matches nobody.
  local byName = {}
  for _, player in ipairs(night.roster) do
    if hasSurname(player) then
      local key = Names.key(player.name .. " " .. player.surname)
      if byName[key] ~= nil then byName[key] = false else byName[key] = player end
    end
  end

  local phase = night.model.phase
  local changed = {}
  for _, award in ipairs(log) do
    if award.status ~= "removed" and award.pseudo == nil and award.phase == phase then
      local knownRev = known[award.id]
      if knownRev ~= nil then
        -- the app counted this award already; a newer version here is only reported
        if award.rev > knownRev then changed[#changed + 1] = award.id end
      else
        -- the priority the award counts for: the one it names, or every one with the same item name
        local targets = {}
        if award.priority ~= nil then
          for _, priority in ipairs(night.priorities) do
            if priority.id == award.priority then targets[#targets + 1] = priority end
          end
        else
          local itemKey = Names.key(award.item)
          for _, priority in ipairs(night.priorities) do
            if Names.key(priority.item) == itemKey then targets[#targets + 1] = priority end
          end
        end

        local toKey = Names.key(award.to)
        local player = byName[toKey] or nil -- nil for a name nobody has and for one two entries share
        local ks
        if award.toId ~= nil then
          ks = {}
          for _, entry in ipairs(night.roster) do
            if entry.id == award.toId then ks[entry.k] = true end
          end
        end

        for _, priority in ipairs(targets) do
          -- the recipient's lines: by the roster id when the award has one, else by the full name, else a name-only line
          local flags = awarded[priority.id]
          for position, line in ipairs(priority.lines) do
            local mine
            if ks then
              mine = line.k ~= nil and ks[line.k] == true
            elseif player then
              mine = line.k ~= nil and line.k == player.k
            else
              mine = line.name ~= nil and Names.key(line.name) == toKey
            end
            if mine and not flags[position] then
              flags[position] = true
              break -- the first open line of that person
            end
          end
        end
      end
    end
  end
  return { awarded = awarded, changed = changed }
end
