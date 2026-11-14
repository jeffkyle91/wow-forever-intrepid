-- Name handling for WoW: Forever. Pure Lua: no client calls, so it runs in the unit tests.
--
-- Characters have a first name and a surname ("Jorren Ashvale"). The second word is NOT a realm.
-- Never match a player on the first name alone.
--
-- The matching rule is the one of docs/spec/exchange-v0.md, section 2: remove leading and trailing ASCII spaces,
-- collapse runs of ASCII spaces, lowercase the ASCII letters only. Every other byte stays as it is, so a non-ASCII
-- letter must match exactly, case included, and a tab or a no-break space is never treated as a space.

local _, ns = ...

local Names = {}
ns.Names = Names

-- A to Z only. string.lower and %u follow the C locale, and in a Latin-1 locale they would change the bytes of a
-- UTF-8 letter, so the range is written out.
local function lowerAscii(text)
  return (string.gsub(text, "[A-Z]", function(letter) return string.char(string.byte(letter) + 32) end))
end

-- The key of a name or of any text: "  Jorren   ASHVALE " -> "jorren ashvale". Nil for something that is not a
-- string. One word is fine here (a name-only line or an award's recipient can be one word); use `normalize` to match
-- game characters.
function Names.key(text)
  if type(text) ~= "string" then return nil end
  local trimmed = string.match(text, "^ *(.-) *$")
  return lowerAscii((string.gsub(trimmed, "  +", " ")))
end

-- The key of a full name. Returns nil unless the result has at least two words.
function Names.normalize(name)
  local key = Names.key(name)
  if key == nil or not string.find(key, " ", 1, true) then return nil end
  return key
end

-- True when both are full names and are the same name, ignoring case and extra spaces.
function Names.same(a, b)
  local na, nb = Names.normalize(a), Names.normalize(b)
  return na ~= nil and na == nb
end
