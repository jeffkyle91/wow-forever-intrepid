-- The content of a night string (docs/spec/exchange-v0.md, sections 2, 4 and 5): what the addon checks after the
-- envelope has been read, and what it tells the loot master before Import. Pure Lua 5.1 with no client calls.
--
-- Night.read(text)                   Envelope.read plus Night.check: "read the string, check the rows" in one call
-- Night.check(model)                 the content checks on a decoded payload (Envelope.read's `model`)
-- Night.summary(result, now, today)  the facts and the line shown before Import (spec 5.3, step 3)
--
-- A check never raises for bad input and never changes the payload. It returns
--   { ok = false, code = "E_PAYLOAD", message = "..." }   a top-level field is wrong: keep the current night
--   { ok = true, model = <the payload>, schema = n,
--     rowErrors = { "raid", "roster:3", "pr-cloak", ... },   the names of the spec (section 2), in the order found
--     problems = { { name = "pr-cloak", kind = "priority", reason = "line 3: unknown player" }, ... },
--     raid = <the raid, or nil when there is none or it is wrong>,
--     known = { { id = ..., rev = ... }, ... },
--     roster = { <the valid entries, in order> }, byK = { [k] = <valid entry> },
--     bosses = { <the valid bosses> },
--     priorities = { <the priorities that are shown> }, skipped = { { name = ..., item = ..., reason = ... }, ... } }
-- A bug in this code does not raise either: it comes back as E_PAYLOAD with `internal = true`.

local _, ns = ...

local Night = {}
ns.Night = Night

local Json, Ids, Check, Envelope = ns.Json, ns.Ids, ns.Check, ns.Envelope
local isText, isGameId, isTrue, isObject, isInteger = Check.isText, Check.isGameId, Check.isTrue, Check.isObject, Json.isInteger

local MAX_LINES = 60
local OLD_AFTER = 18 * 3600 -- seconds (spec section 4)

-- Top-level fields: a wrong one means nothing in the string can be trusted. Returns what is wrong, or nil.
local function headerProblem(m)
  if not isObject(m) then return "the payload is not an object" end
  if not (Ids.isId(m.id) and isInteger(m.at) and isText(m.by, 60, true)) then return "header" end
  if not (isInteger(m.phase) and m.phase >= 0) then return "phase" end
  if not (Json.isList(m.roster) and Json.isList(m.priorities)) then return "roster or priorities" end
  if m.known ~= nil then
    if not Json.isList(m.known) then return "known" end
    for _, entry in ipairs(m.known) do
      if not (isObject(entry) and Ids.isId(entry.id) and isInteger(entry.rev) and entry.rev >= 1) then return "known" end
    end
  end
  if m.bosses ~= nil and not Json.isList(m.bosses) then return "bosses" end
  return nil
end

local function raidOk(raid)
  return isObject(raid) and Ids.isId(raid.id) and Check.isDate(raid.date) and isText(raid.name, 120, false)
    and (raid.size == nil or raid.size == 10 or raid.size == 20 or raid.size == 40)
end

-- Why a roster entry is wrong (its k is checked apart), or nil.
local function playerProblem(p)
  if not Ids.isId(p.id) then return "id is missing or not valid" end
  if not isText(p.name, 60, true) then return "name is missing, blank or too long" end
  if not isText(p.surname, 60, false) then return "surname is too long" end
  if not isText(p.class, 40, false) then return "class is too long" end
  if not isText(p.role, 40, false) then return "role is too long" end
  if p.main ~= nil and not isInteger(p.main) then return "main is not a whole number" end
  if not isTrue(p.locked) then return "locked is not true" end
  return nil
end

-- Why a line is wrong, or nil. A line is exactly one of: a roster character (k), a name only (name), a note (text).
local function lineProblem(line, validKs)
  if not isObject(line) then return "not an object" end
  local present = (line.k ~= nil and 1 or 0) + (line.name ~= nil and 1 or 0) + (line.text ~= nil and 1 or 0)
  if present ~= 1 then return "needs exactly one of k, name and text" end
  if line.text ~= nil then
    if not isText(line.text, 500, true) then return "the note is blank or too long" end
    if line.awarded ~= nil then return "a note cannot be awarded" end
    if not isTrue(line.done) then return "done is not true" end
    return nil
  end
  if line.k ~= nil then
    if not validKs[line.k] then return "unknown player" end
  elseif not isText(line.name, 121, true) then
    return "the name is blank or too long"
  end
  if line.done ~= nil then return "only a note can be done" end
  if not isTrue(line.awarded) then return "awarded is not true" end
  return nil
end

-- Why a priority is wrong (its id is checked apart), or nil. One bad line skips the whole priority: showing it
-- without that line would tell the council a wrong order.
local function priorityProblem(p, validKs)
  if not isText(p.item, 120, true) then return "item is missing, blank or too long" end
  if p.itemId ~= nil and not isGameId(p.itemId) then return "itemId is not a valid id" end
  if not isText(p.encounter, 120, false) then return "encounter is too long" end
  if p.npcId ~= nil and not isGameId(p.npcId) then return "npcId is not a valid id" end
  if p.zoneId ~= nil and not isGameId(p.zoneId) then return "zoneId is not a valid id" end
  if not isText(p.note, 500, false) then return "note is too long" end
  if not Json.isList(p.lines) then return "lines are missing" end
  if #p.lines > MAX_LINES then return "more than " .. MAX_LINES .. " lines" end
  for position, line in ipairs(p.lines) do
    local why = lineProblem(line, validKs)
    if why then return "line " .. position .. ": " .. why end
  end
  return nil
end

local function checkContent(m)
  local why = headerProblem(m)
  if why then return Check.payloadError(why) end

  local errors, problems = {}, {}
  local function bad(name, kind, reason)
    errors[#errors + 1] = name
    problems[#problems + 1] = { name = name, kind = kind, reason = reason }
  end

  local raid
  if m.raid ~= nil then
    if raidOk(m.raid) then raid = m.raid else bad("raid", "raid", "the raid is not valid, so the string is read without it") end
  end

  -- The roster. The first entry with a k or an id wins; a k whose first entry is broken makes its lines invalid.
  local roster, byK, kSeen, ids = {}, {}, {}, {}
  for index, p in ipairs(m.roster) do
    local name = "roster:" .. index
    local k = isObject(p) and p.k or nil
    if not (isInteger(k) and k >= 1) then
      bad(name, "roster", "k is missing or not a whole number from 1")
    elseif kSeen[k] then
      bad(name, "roster", "k is used by an earlier entry")
    else
      kSeen[k] = true
      local reason = playerProblem(p)
      if not reason and ids[p.id] then reason = "id is used by an earlier entry" end
      if reason then
        bad(name, "roster", reason)
      else
        ids[p.id] = true
        byK[k] = p
        roster[#roster + 1] = p
      end
    end
  end

  local bosses, npcs = {}, {}
  for index, b in ipairs(m.bosses or {}) do
    local reason
    if not isObject(b) then
      reason = "not an object"
    elseif not isGameId(b.npcId) then
      reason = "npcId is missing or not a valid id"
    elseif npcs[b.npcId] then
      reason = "npcId is used by an earlier boss"
    elseif not isText(b.name, 120, true) then
      reason = "name is missing, blank or too long"
    elseif b.zoneId ~= nil and not isGameId(b.zoneId) then
      reason = "zoneId is not a valid id"
    end
    if reason then
      bad("boss:" .. index, "boss", reason)
    else
      npcs[b.npcId] = true
      bosses[#bosses + 1] = b
    end
  end

  -- The priorities. One is named by its id when that is valid and its first use, else by its position.
  local priorities, skipped, seen = {}, {}, {}
  for index, p in ipairs(m.priorities) do
    local id = isObject(p) and p.id or nil
    local idOk = Ids.isId(id)
    local first = idOk and not seen[id]
    local reason
    if not first then
      reason = idOk and "id is used by an earlier priority" or "id is missing or not valid"
    else
      reason = priorityProblem(p, byK)
    end
    if idOk then seen[id] = true end
    if reason then
      local name = first and id or ("priority:" .. index)
      bad(name, "priority", reason)
      skipped[#skipped + 1] = { name = name, item = (isObject(p) and type(p.item) == "string") and p.item or nil, reason = reason }
    else
      priorities[#priorities + 1] = p
    end
  end

  return {
    ok = true, model = m, schema = m.schema, rowErrors = errors, problems = problems, raid = raid, known = m.known or {},
    roster = roster, byK = byK, bosses = bosses, priorities = priorities, skipped = skipped,
  }
end

function Night.check(model)
  local ok, result = pcall(checkContent, model)
  if ok then return result end
  local failure = Check.payloadError("internal error: " .. Check.safe(result, 160))
  failure.internal = true
  return failure
end

function Night.read(text)
  local read = Envelope.read(text, "night")
  if not read.ok then return read end
  return Night.check(read.model)
end

-- The summary --------------------------------------------------------------------------------------------------------

local function count(n, one, many)
  return string.format("%.0f", n) .. " " .. (n == 1 and one or many)
end

-- "just now", "35 minutes ago", "2 hours ago", "3 days ago"
local function ago(seconds)
  if seconds < 60 then return "just now" end
  if seconds < 3600 then
    local n = math.floor(seconds / 60)
    return count(n, "minute", "minutes") .. " ago"
  end
  if seconds < 86400 then
    local n = math.floor(seconds / 3600)
    return count(n, "hour", "hours") .. " ago"
  end
  local n = math.floor(seconds / 86400)
  return count(n, "day", "days") .. " ago"
end

local MAX_SKIPPED_SHOWN = 3

-- What the loot master sees before pressing Import (spec 5.3, step 3, and the warnings of section 4):
--   "Night of 2026-12-09, copied 2 hours ago: 58 players, 87 priorities. 1 priority skipped: Cloak of Many Commas
--    (line 4: unknown player)."
-- `now` is the server time in seconds; `today` is the loot master's local date as YYYY-MM-DD (nil: no date warning).
-- Returns { players, priorities, skipped, age, otherDay, old, warnings = { text, ... }, text }. The text is ready for
-- the game: names from the string are cut short and their pipes doubled.
function Night.summary(result, now, today)
  local m = result.model
  local age = now - m.at
  local info = {
    players = #result.roster, priorities = #result.priorities, skipped = #result.skipped, age = age,
    otherDay = false, old = false, warnings = {},
  }

  local sentences = {}
  local head = result.raid and ("Night of " .. result.raid.date) or "Night"
  sentences[#sentences + 1] = head .. ", copied " .. ago(age) .. ": " .. count(info.players, "player", "players") .. ", "
    .. count(info.priorities, "priority", "priorities") .. "."

  if info.skipped > 0 then
    local shown = {}
    for position = 1, math.min(info.skipped, MAX_SKIPPED_SHOWN) do
      local row = result.skipped[position]
      shown[#shown + 1] = Check.display(row.item or row.name, 40) .. " (" .. row.reason .. ")"
    end
    local more = info.skipped > MAX_SKIPPED_SHOWN and (" and " .. (info.skipped - MAX_SKIPPED_SHOWN) .. " more") or ""
    sentences[#sentences + 1] = count(info.skipped, "priority", "priorities") .. " skipped: " .. table.concat(shown, "; ") .. more .. "."
  end

  local ignored = {}
  local byKind = { raid = 0, roster = 0, boss = 0 }
  for _, problem in ipairs(result.problems) do
    if byKind[problem.kind] then byKind[problem.kind] = byKind[problem.kind] + 1 end
  end
  if byKind.raid > 0 then ignored[#ignored + 1] = "the raid" end
  if byKind.roster > 0 then ignored[#ignored + 1] = count(byKind.roster, "roster entry", "roster entries") end
  if byKind.boss > 0 then ignored[#ignored + 1] = count(byKind.boss, "boss", "bosses") end
  if #ignored > 0 then sentences[#sentences + 1] = "Ignored: " .. table.concat(ignored, ", ") .. "." end

  if today and result.raid and result.raid.date ~= today then
    info.otherDay = true
    info.warnings[#info.warnings + 1] = "The raid date (" .. result.raid.date .. ") is not today (" .. today .. ")."
  end
  if age > OLD_AFTER then
    info.old = true
    info.warnings[#info.warnings + 1] = "This string was copied more than 18 hours ago."
  end
  for _, warning in ipairs(info.warnings) do sentences[#sentences + 1] = warning end

  info.text = table.concat(sentences, " ")
  return info
end
