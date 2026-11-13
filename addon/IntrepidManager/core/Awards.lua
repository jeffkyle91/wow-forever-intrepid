-- The awards string the addon makes (docs/spec/exchange-v0.md, section 6). Pure Lua 5.1 with no client calls.
--
-- Awards.encode(model)                    the string for an export (the field order of the spec and the envelope)
-- Awards.check(model)                     the content checks on a decoded awards payload
-- Awards.select(log, night, now, all)     which awards an export holds (section 6.1, "Which awards an export holds")
-- Awards.fit(selection, limit)            the first awards of a selection whose string stays within `limit` characters
--
-- A check never raises for bad input and never changes the payload. It returns
--   { ok = false, code = "E_PAYLOAD", message = "..." }   a top-level field is wrong
--   { ok = true, model = <the payload>, schema = n,
--     rowErrors = { "s-tpt2u0-q4tz-2", "award:6", ... },   the names of the spec (section 2), in the order found
--     problems = { { name = ..., kind = "award", reason = "..." }, ... },
--     awards = { <the awards that passed> } }
-- A bug in this code does not raise either: it comes back as E_PAYLOAD with `internal = true`.

local _, ns = ...

local Awards = {}
ns.Awards = Awards

local Json = ns.Json
local Envelope = ns.Envelope
local Ids = ns.Ids
local Check = ns.Check

local isText, isGameId, isObject, isInteger = Check.isText, Check.isGameId, Check.isObject, Json.isInteger

-- The fields of the spec, in canonical order (sections 6.1 and 3: producers write fields in this order).
local DELIVERY = Json.object({ "state", "at", "how" })
local AWARD = Json.object({
  "id", "rev", "session", "at", "date", "phase", "raid", "itemId", "item", "toId", "to", "pseudo", "decision",
  "priority", "encounter", "npcId", "zoneId", "note", "delivery", "status",
}, { delivery = DELIVERY })

Awards.SHAPE = Json.object({ "schema", "id", "at", "by", "awards" }, { awards = Json.listOf(AWARD) })
Awards.AWARD = AWARD

-- The longest awards string an export makes: 100,000 characters pasted whole into the game and the Raid Desk (spec section 11).
Awards.LIMIT = 100000

-- The awards string for `model`: a table with schema, id, at, by and awards (a list of award tables), as in the spec.
-- A field the spec does not have raises an error (a bug in the caller), so nothing is dropped quietly.
function Awards.encode(model)
  return Envelope.write("awards", Json.encode(model, Awards.SHAPE))
end

-- The content checks ---------------------------------------------------------------------------------------------------

local PSEUDO = { disenchant = true, ["guild-bank"] = true }
local DECISIONS = { council = true, roll = true, other = true }
local HOW = { ["master-loot"] = true, trade = true, manual = true }

-- Why a delivery is wrong, or nil. `assigned` ignores everything else; `received` needs a time and how.
local function deliveryProblem(delivery)
  if not isObject(delivery) then return "delivery is missing" end
  if delivery.state == "assigned" then return nil end
  if delivery.state ~= "received" then return "delivery.state is not assigned or received" end
  if not isInteger(delivery.at) then return "a received award needs delivery.at" end
  if delivery.how == nil or not HOW[delivery.how] then return "delivery.how is missing or unknown" end
  return nil
end

-- Why an award is wrong (its id is checked apart), or nil.
local function awardProblem(a)
  if not (isInteger(a.rev) and a.rev >= 1) then return "rev is missing or not a whole number from 1" end
  if a.session ~= nil and not Ids.isId(a.session) then return "session is not a valid id" end
  if not isInteger(a.at) then return "at is missing or not a whole number" end
  if not Check.isDate(a.date) then return "date is missing or not YYYY-MM-DD" end
  if a.phase ~= nil and not (isInteger(a.phase) and a.phase >= 0) then return "phase is not a whole number from 0" end
  if a.raid ~= nil and not Ids.isId(a.raid) then return "raid is not a valid id" end
  if not isGameId(a.itemId) then return "itemId is missing or not a valid id" end
  if not isText(a.item, 120, true) then return "item is missing, blank or too long" end
  if a.toId ~= nil and not Ids.isId(a.toId) then return "toId is not a valid id" end
  if not isText(a.to, 121, true) then return "to is missing, blank or too long" end
  if a.pseudo ~= nil and not PSEUDO[a.pseudo] then return "pseudo is not disenchant or guild-bank" end
  if a.pseudo ~= nil and a.toId ~= nil then return "a pseudo award has no toId" end
  if a.decision ~= nil and not DECISIONS[a.decision] then return "decision is not council, roll or other" end
  if a.pseudo == nil and a.decision == nil then return "an award that is not a pseudo award needs a decision" end
  if a.priority ~= nil and not Ids.isId(a.priority) then return "priority is not a valid id" end
  if not isText(a.encounter, 120, false) then return "encounter is too long" end
  if a.npcId ~= nil and not isGameId(a.npcId) then return "npcId is not a valid id" end
  if a.zoneId ~= nil and not isGameId(a.zoneId) then return "zoneId is not a valid id" end
  if not isText(a.note, 500, false) then return "note is too long" end
  local why = deliveryProblem(a.delivery)
  if why then return why end
  if a.status ~= nil and a.status ~= "removed" then return "status is not removed" end
  return nil
end

local function checkContent(m)
  if not isObject(m) then return Check.payloadError("the payload is not an object") end
  if not (Ids.isId(m.id) and isInteger(m.at) and isText(m.by, 60, true)) then return Check.payloadError("header") end
  if not Json.isList(m.awards) then return Check.payloadError("awards") end

  local errors, problems, awards, seen = {}, {}, {}, {}
  for index, a in ipairs(m.awards) do
    local id = isObject(a) and a.id or nil
    local idOk = Ids.isId(id)
    local first = idOk and not seen[id]
    if idOk then seen[id] = true end
    local reason
    if not first then
      reason = idOk and "id is used by an earlier award" or "id is missing or not valid"
    else
      reason = awardProblem(a)
    end
    if reason then
      local name = first and id or ("award:" .. index)
      errors[#errors + 1] = name
      problems[#problems + 1] = { name = name, kind = "award", reason = reason }
    else
      awards[#awards + 1] = a
    end
  end
  return { ok = true, model = m, schema = m.schema, rowErrors = errors, problems = problems, awards = awards }
end

function Awards.check(model)
  local ok, result = pcall(checkContent, model)
  if ok then return result end
  local failure = Check.payloadError("internal error: " .. Check.safe(result, 160))
  failure.internal = true
  return failure
end

-- Which awards an export holds ---------------------------------------------------------------------------------------

local DAY = 86400
local DEFAULT_DAYS = 14

-- The awards of `log` (a list of awards, each with id, rev, at and perhaps phase) an export holds by default, or all of
-- them. `night` is the loaded night as Night.check gave it (nil: no night loaded); `now` is the server time.
--   * With a night: every award of the night's phase, and every award with no phase, unless the night's `known` list
--     has it already: the same id with the same rev, or a higher one (the app has that version, or a newer).
--   * With no night: every award of the last 14 days.
--   * `all` set: every award.
--   * `only` set (award id -> true): those awards, whatever else (a night or a raid exported from the loot history).
-- Returns { awards = {...} in log order, count, new = awards the night does not know, changed = awards the night knows
-- in an older revision, kinds = "new", "changed" or false for each award, in the same order }. "Changed" is what the window shows
-- as "4 changed since the night was copied".
function Awards.select(log, night, now, all, only)
  local result = { awards = {}, count = 0, new = 0, changed = 0, kinds = {} }
  local known, phase = {}, nil
  if night then
    phase = night.model.phase
    for _, entry in ipairs(night.known or {}) do known[entry.id] = entry.rev end
  end
  for _, award in ipairs(log) do
    local knownRev = known[award.id]
    local keep
    if only then
      keep = only[award.id] == true
    elseif all then
      keep = true
    elseif night then
      keep = (award.phase == nil or award.phase == phase) and not (knownRev ~= nil and knownRev >= award.rev)
    else
      keep = award.at >= now - DEFAULT_DAYS * DAY
    end
    if keep then
      result.awards[#result.awards + 1] = award
      local kind = false
      if knownRev == nil then
        result.new = result.new + 1
        kind = "new"
      elseif knownRev < award.rev then
        result.changed = result.changed + 1
        kind = "changed"
      end
      result.kinds[#result.awards] = kind
    end
  end
  result.count = #result.awards
  return result
end

-- What fits in one string ---------------------------------------------------------------------------------------------

local HEAD_ROOM = 400 -- the envelope, the top-level fields and the brackets, with room to spare

-- The first awards of `selection` (what Awards.select gave) whose awards string stays within `limit` characters (Awards.LIMIT by
-- default), as a selection of the same shape with `left` = how many awards did not fit. The oldest come first, so that after the
-- Raid Desk imports them and a new night is copied, the next export holds the rest. Each award is written once to measure it,
-- and only until the limit is reached, so a long log costs no more than one string's worth.
function Awards.fit(selection, limit)
  limit = (limit or Awards.LIMIT) - HEAD_ROOM
  local kept = { awards = {}, count = 0, new = 0, changed = 0, kinds = {}, left = 0 }
  local size = 0
  for index, award in ipairs(selection.awards) do
    size = size + #Json.encode(award, AWARD) + 1
    if size > limit and index > 1 then
      kept.left = #selection.awards - index + 1
      break
    end
    kept.awards[index] = award
    local kind = selection.kinds and selection.kinds[index]
    kept.kinds[index] = kind or false
    if kind == "new" then kept.new = kept.new + 1 elseif kind == "changed" then kept.changed = kept.changed + 1 end
  end
  kept.count = #kept.awards
  return kept
end
