-- Ids and revision numbers (IntrepidManager/core/Ids.lua). Invented names only. See AGENTS.md.
local ns = load_addon_file("IntrepidManager/core/Ids.lua")
local Ids = ns.Ids

local function fails(fn, ...)
  local ok, err = pcall(fn, ...)
  if ok then error("expected an error", 2) end
  return tostring(err)
end

-- A random function that gives the listed numbers, one per call.
local function picks(...)
  local list, index = { ... }, 0
  return function(m)
    index = index + 1
    eq(m, 36)
    return list[index]
  end
end

-- base 36 ------------------------------------------------------------------------------------------------------------

test("base36 gives the digits 0-9 and a-z, most significant first", function()
  eq(Ids.base36(0), "0")
  eq(Ids.base36(9), "9")
  eq(Ids.base36(10), "a")
  eq(Ids.base36(35), "z")
  eq(Ids.base36(36), "10")
  eq(Ids.base36(1295), "zz")
  eq(Ids.base36(1296), "100")
end)

test("base36 matches the times in the fixtures and the biggest numbers", function()
  eq(Ids.base36(1796866200), "tpt2u0") -- the start of the first session of docs/spec/fixtures/awards-small
  eq(Ids.base36(1796262000), "tpg4mo")
  eq(Ids.base36(1796874912), "tpt9k0") -- the export id
  eq(Ids.base36(2 ^ 31), "zik0zk")
  eq(Ids.base36(2 ^ 32), "1z141z4")
  eq(Ids.base36(2 ^ 53 - 1), "2gosa7pa2gv")
end)

test("base36 and tonumber(text, 36) undo each other", function()
  local seed = 12345
  for _ = 1, 300 do
    seed = (seed * 1103515245 + 12345) % 2147483648
    local n = seed * 1000 + seed % 997 -- up to about 2 * 10^12
    eq(tonumber(Ids.base36(n), 36), n)
  end
end)

test("base36 refuses anything but a whole number from 0 to 2^53", function()
  for _, bad in ipairs({ -1, 1.5, 0 / 0, math.huge, -math.huge, 2 ^ 53 + 2, "12", true }) do
    fails(Ids.base36, bad)
  end
  eq(Ids.base36(2 ^ 53), "2gosa7pa2gw")
end)

-- random parts ---------------------------------------------------------------------------------------------------------

test("a random part is four characters made from the numbers 1 to 36", function()
  eq(Ids.randomPart(picks(27, 5, 30, 36)), "q4tz") -- the session part of the spec's example
  eq(Ids.randomPart(picks(9, 32, 12, 24)), "8vbn") -- the export part
  eq(Ids.randomPart(picks(1, 1, 1, 1)), "0000")
  eq(Ids.randomPart(picks(36, 36, 36, 36)), "zzzz")
end)

test("a random function that gives anything else is refused", function()
  for _, bad in ipairs({ 0, 37, 1.5, -3, "7", 0 / 0 }) do
    fails(Ids.randomPart, picks(5, 5, bad, 5))
  end
  fails(Ids.randomPart, function() return nil end)
end)

test("math.random(36) works as the random function", function()
  math.randomseed(7)
  for _ = 1, 50 do
    local part = Ids.randomPart(math.random)
    is_true(part:find("^[0-9a-z][0-9a-z][0-9a-z][0-9a-z]$") ~= nil)
  end
end)

-- session, award and export ids ---------------------------------------------------------------------------------------

test("session and award ids are the ones of the spec's example", function()
  eq(Ids.sessionId(1796866200, "q4tz"), "s-tpt2u0-q4tz")
  eq(Ids.sessionId(1796262000, "k3p9"), "s-tpg4mo-k3p9")
  eq(Ids.awardId("s-tpt2u0-q4tz", 1), "s-tpt2u0-q4tz-1")
  eq(Ids.awardId("s-tpt2u0-q4tz", 12), "s-tpt2u0-q4tz-12")
  eq(Ids.awardId("s-tpt2u0-q4tz", 1000000), "s-tpt2u0-q4tz-1000000")
  eq(Ids.exportId(1796874912, picks(9, 32, 12, 24)), "a-tpt9k0-8vbn")
end)

test("a session id needs a good random part and a good time", function()
  for _, bad in ipairs({ "", "q4t", "q4tzz", "Q4TZ", "q4t.", "q4t ", 1234, false }) do
    fails(Ids.sessionId, 1796866200, bad)
  end
  fails(Ids.sessionId, -5, "q4tz")
  fails(Ids.sessionId, 1.5, "q4tz")
  fails(Ids.sessionId, nil, "q4tz")
end)

test("an award number is a whole number from 1, on a real session id", function()
  for _, bad in ipairs({ 0, -1, 1.5, "1", 0 / 0, false }) do
    fails(Ids.awardId, "s-tpt2u0-q4tz", bad)
  end
  fails(Ids.awardId, nil, 1)
  fails(Ids.awardId, "has space", 1)
  fails(Ids.awardId, "", 1)
end)

test("every id the module makes is an id of the spec", function()
  local session = Ids.sessionId(2 ^ 53, "zzzz")
  is_true(Ids.isId(session))
  is_true(Ids.isId(Ids.awardId(session, 2 ^ 53)))
  is_true(#Ids.awardId(session, 2 ^ 53) <= 64)
  is_true(Ids.isId(Ids.exportId(2 ^ 53, picks(36, 36, 36, 36))))
end)

test("two loads of the addon in the same second get different sessions", function()
  local first = Ids.sessionId(1796866200, Ids.randomPart(picks(27, 5, 30, 36)))
  local second = Ids.sessionId(1796866200, Ids.randomPart(picks(2, 8, 4, 19)))
  is_true(first ~= second)
end)

-- the id rule of the spec -------------------------------------------------------------------------------------------

test("isId accepts 1 to 64 characters from A-Z a-z 0-9 _ -", function()
  for _, good in ipairs({ "a", "AbCdEfGhIjKlMnOpQr01", "s-tpt2u0-q4tz-1", "a_b-c", "0", "-", "_", string.rep("x", 64) }) do
    is_true(Ids.isId(good))
  end
end)

test("isId refuses anything else", function()
  for _, bad in ipairs({ "", string.rep("x", 65), "has.dot", "has space", "tab\t", "new\nline", "caf\195\169", "a/b", "a:b", "a|b", "\0" }) do
    eq(Ids.isId(bad), false)
  end
  for _, bad in ipairs({ 12, true }) do eq(Ids.isId(bad), false) end
  eq(Ids.isId(nil), false)
end)

-- revisions ----------------------------------------------------------------------------------------------------------

test("a new award starts at the server time", function()
  eq(Ids.nextRev(nil, 1796866530), 1796866530)
end)

test("a change is max(previous + 1, server time now)", function()
  eq(Ids.nextRev(1796866530, 1796866800), 1796866800) -- the clock has moved on
  eq(Ids.nextRev(1796866530, 1796866530), 1796866531) -- the same second: one more
  eq(Ids.nextRev(1796866530, 1796866531), 1796866531) -- previous + 1 equals the time
  eq(Ids.nextRev(1796866530, 1796866000), 1796866531) -- a clock that went back: the previous revision wins
end)

test("revisions rise with every change in the same second", function()
  local rev = Ids.nextRev(nil, 5000)
  eq(rev, 5000)
  for step = 1, 50 do
    local nextRev = Ids.nextRev(rev, 5000)
    eq(nextRev, 5000 + step)
    rev = nextRev
  end
end)

test("after a crash the next revision is above the one that was lost", function()
  -- the saved file holds revision 6001; the lost change had 6002 at second 6001; the addon loads at second 6050
  local lost = Ids.nextRev(6001, 6001)
  eq(lost, 6002)
  local afterLoad = Ids.nextRev(6001, 6050)
  is_true(afterLoad > lost)
end)

test("revisions never go down, whatever the clock does", function()
  local seed, rev, now = 99, nil, 1796866000
  for _ = 1, 500 do
    seed = (seed * 1103515245 + 12345) % 2147483648
    now = math.max(1, now + (seed % 7) - 2) -- sometimes goes back
    local next_ = Ids.nextRev(rev, now)
    is_true(next_ >= now)
    if rev then is_true(next_ > rev) end
    rev = next_
  end
end)

test("revisions refuse what the spec does not allow", function()
  for _, bad in ipairs({ 0, -1, 1.5, "5", 0 / 0, false }) do
    fails(Ids.nextRev, nil, bad)
    fails(Ids.nextRev, bad, 1000)
  end
  fails(Ids.nextRev, 2 ^ 53, 1000) -- previous + 1 would pass 2^53
  eq(Ids.nextRev(2 ^ 53 - 1, 1000), 2 ^ 53)
end)
