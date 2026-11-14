-- Checks the night and awards content checks share (docs/spec/exchange-v0.md, section 2). Pure Lua 5.1 with no client
-- calls, so it runs in the unit tests.

local _, ns = ...

local Check = {}
ns.Check = Check

local Json = ns.Json
local Envelope = ns.Envelope

local find, byte, sub, gsub = string.find, string.byte, string.sub, string.gsub

-- The number of Unicode code points in a UTF-8 string. The spec counts these on every side; Lua counts bytes.
function Check.codePoints(text)
  local count = 0
  for i = 1, #text do
    local b = byte(text, i)
    if b < 128 or b >= 192 then count = count + 1 end
  end
  return count
end

-- Text of at most `limit` code points with no NUL. When `required` it is not blank either (empty once ASCII spaces
-- are taken off; any other whitespace counts as text). A missing value is fine when it is not required.
function Check.isText(value, limit, required)
  if value == nil then return not required end
  if type(value) ~= "string" then return false end
  if find(value, "\0", 1, true) then return false end
  if #value > limit and Check.codePoints(value) > limit then return false end -- bytes never count fewer than code points
  if required and find(value, "^ *$") then return false end
  return true
end

-- An integer from 1 to 100,000,000: the app's validGameId (itemId, npcId, zoneId).
function Check.isGameId(value)
  return Json.isInteger(value) and value >= 1 and value <= 100000000
end

-- YYYY-MM-DD. Only the form is checked, as in the app.
function Check.isDate(value)
  return type(value) == "string" and find(value, "^[0-9][0-9][0-9][0-9]%-[0-9][0-9]%-[0-9][0-9]$") ~= nil
end

-- Absent or true. The reader drops `false`, so a field that is only ever true can be nil or true.
function Check.isTrue(value)
  return value == nil or value == true
end

-- A JSON object (not a list).
function Check.isObject(value)
  return type(value) == "table" and not Json.isList(value)
end

-- Text from a payload made ready to show in the game: cut to `limit` code points (on a character boundary, with
-- "..." added) and with every "|" doubled, so the game shows it as it is (spec section 10).
function Check.display(text, limit)
  text = tostring(text)
  if #text > limit then
    local count = 0
    for i = 1, #text do
      local b = byte(text, i)
      if b < 128 or b >= 192 then
        count = count + 1
        if count > limit then
          text = sub(text, 1, i - 1) .. "..."
          break
        end
      end
    end
  end
  return (gsub(text, "|", "||"))
end

-- Text made safe to put in a message: cut short, and anything but letters, digits and a few marks becomes "?", so a
-- "|" can never start an escape code in the game's text.
function Check.safe(text, limit)
  return (gsub(sub(tostring(text), 1, limit or 24), "[^%w%-_ .:/]", "?"))
end

-- The refusal for a top-level field that is wrong (nothing in the string can be trusted). Same shape as the
-- envelope's refusals.
function Check.payloadError(what)
  return { ok = false, code = "E_PAYLOAD", message = Envelope.message("E_PAYLOAD", what) }
end
