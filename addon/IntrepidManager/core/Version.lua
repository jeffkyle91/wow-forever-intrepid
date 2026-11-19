-- Intrepid Manager: comparing addon versions, pure (no client calls). A version is dotted numbers: "0.0.14", "1.2". Anything after the
-- numbers ("-beta") is ignored. Used by the version check, which tells who has the addon and who has an older or a newer one.
--
--   ns.Version.compare("0.0.14", "0.0.9")    --> 1
--   ns.Version.relation("0.0.14", "0.0.15")  --> "newer" (theirs is newer than mine)

local _, ns = ...

local Version = {}
ns.Version = Version

-- { 0, 0, 14 } for "0.0.14", or nil when the text starts with no number.
function Version.parse(text)
  if type(text) ~= "string" then return nil end
  local numbers = {}
  local rest = text
  while true do
    local digits, tail = string.match(rest, "^(%d+)(.*)$")
    if not digits then break end
    numbers[#numbers + 1] = tonumber(digits)
    local more = string.match(tail, "^%.(%d.*)$")
    if not more then break end
    rest = more
  end
  if #numbers == 0 then return nil end
  return numbers
end

-- -1 when a is older than b, 0 when they are the same, 1 when a is newer; nil when either is not a version. Missing numbers count as 0
-- ("1.2" is "1.2.0").
function Version.compare(a, b)
  local pa, pb = Version.parse(a), Version.parse(b)
  if not pa or not pb then return nil end
  for i = 1, math.max(#pa, #pb) do
    local x, y = pa[i] or 0, pb[i] or 0
    if x < y then return -1 end
    if x > y then return 1 end
  end
  return 0
end

-- How their version stands to mine: "same", "newer" (theirs is newer), "older" (theirs is older) or "unknown".
function Version.relation(mine, theirs)
  local order = Version.compare(theirs, mine)
  if order == nil then return "unknown" end
  if order == 0 then return "same" end
  return order > 0 and "newer" or "older"
end
