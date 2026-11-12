-- The self-test: /im selftest runs these checks inside the game (docs/spec/exchange-v0.md). Pure Lua 5.1 with no
-- client calls. Everything the client provides comes in through `env`, so the unit tests run the same checks with
-- stand-ins. What this finds out that the unit tests cannot:
--   * whether the client's bit.bxor gives the answers the checksum relies on (signed 32-bit numbers),
--   * whether the other Lua functions behave in the client as they do on a desktop (string.format, string.find ...),
--   * how long the checksum, the JSON reader and the writer take in the game.
--
-- SelfTest.run(env) returns
--   { passed, failed, failures = { "name: why", ... }, info = { ... },
--     timings = { night = { { items, chars, checksumMs, plainChecksumMs, decodeMs, readMs }, ... },
--                 awards = { { awards, chars, writeMs }, ... } } }
-- and never raises: a check that raises counts as failed.
-- SelfTest.summary(result) gives the lines to show the player.
--
-- env (all optional):
--   bit     the client's bit library
--   now     a function that gives milliseconds (debugprofilestop); without it nothing is timed
--   timer   the name of that function, for the report
--   memory  a function that gives the memory Lua uses, in KB
--   sizes   { nights = { 10, 100, 400 }, awards = { 40, 100, 400 }, runs = 3 }: how much to time (tests use less)

local _, ns = ...

local SelfTest = {}
ns.SelfTest = SelfTest

local Crc32, Json, Envelope, Awards = ns.Crc32, ns.Json, ns.Envelope, ns.Awards
local Names, Ids, Check, Night, Marks = ns.Names, ns.Ids, ns.Check, ns.Night, ns.Marks
local format, floor, concat = string.format, math.floor, table.concat

local DEFAULT_SIZES = { nights = { 10, 100, 400 }, awards = { 40, 100, 400 }, runs = 3 }

-- Known checksums (from Python's zlib). The top-bit cases are the ones a signed bit.bxor would get wrong.
local VECTORS = {
  { "", "00000000" },
  { "a", "e8b7be43" },
  { "123456789", "cbf43926" },
  { "The quick brown fox jumps over the lazy dog", "414fa339" },
  { string.rep("\255", 1000), "e0533230" },
}

-- Pairs for asking bit.bxor how it answers; the checksum assumes signed results for numbers with the top bit set.
local BIT_PROBES = { { 4294967295, 0 }, { 2147483648, 0 }, { 2147483648, 1 }, { 3988292384, 1 }, { 4294967295, 4294967295 }, { 1, 2 } }

---------------------------------------------------------------------------------------------------------------
-- Small helpers
---------------------------------------------------------------------------------------------------------------

-- A value cut short, for a message.
local function short(value, limit)
  local text = tostring(value)
  limit = limit or 60
  if #text > limit then text = string.sub(text, 1, limit - 3) .. "..." end
  return text
end

local function expectEqual(actual, expected)
  if actual ~= expected then error("expected " .. short(expected) .. ", got " .. short(actual), 0) end
end

local function replaceOnce(text, from, to)
  local first, last = string.find(text, from, 1, true)
  if not first then error("the sample no longer contains " .. from, 0) end
  return string.sub(text, 1, first - 1) .. to .. string.sub(text, last + 1)
end

-- 1234567 -> "1,234,567"
local function commas(n)
  local text = format("%.0f", n)
  local count
  repeat
    text, count = string.gsub(text, "^(-?%d+)(%d%d%d)", "%1,%2")
  until count == 0
  return text
end

-- Text made safe to show in the chat window: anything but printable ASCII without "|" becomes "?".
local function safe(text)
  return (string.gsub(tostring(text), "[^ -{}~]", "?"))
end

local function hex(crc)
  return format("%04x%04x", floor(crc / 65536), crc % 65536)
end

local function fakeId(n)
  return format("%020d", n)
end

---------------------------------------------------------------------------------------------------------------
-- Strings shaped like real ones, to time and to read back
---------------------------------------------------------------------------------------------------------------

-- A night payload: 60 roster entries, 15 bosses, 20 known awards and `items` priorities of 8 lines each (about 350
-- characters per item, like a real night). Written by hand so that the times are for realistic text.
local function syntheticNight(items)
  local out = {}
  local function add(text) out[#out + 1] = text end
  local function comma(n) return n > 1 and "," or "" end
  add('{"schema":1,"id":"n-selftest0001","at":1796866200,"by":"IntrepidManager/selftest","phase":0,"known":[')
  for n = 1, 20 do
    add(format('%s{"id":"s-tpt2u0-%04d-%d","rev":%d}', comma(n), n, n, 1796866200 + n))
  end
  add('],"roster":[')
  for k = 1, 60 do
    add(format('%s{"k":%d,"id":"%s","name":"Player%d","surname":"Testname","class":"Warrior","role":"Tank","locked":true}',
      comma(k), k, fakeId(k), k))
  end
  add('],"bosses":[')
  for b = 1, 15 do
    add(format('%s{"npcId":%d,"name":"Boss Number %d","zoneId":2000}', comma(b), 10000 + b, b))
  end
  add('],"priorities":[')
  for i = 1, items do
    add(format('%s{"id":"%s","item":"Generated Item of the Night %d","itemId":%d,"encounter":"Boss Number %d",'
      .. '"npcId":%d,"zoneId":2000,"lines":[', comma(i), fakeId(i + 1000), i, 200000 + i, i % 15 + 1, 10001 + i % 15))
    for line = 1, 8 do
      add(format('%s{"k":%d%s}', comma(line), (i * 7 + line * 13) % 60 + 1, line == 1 and ',"awarded":true' or ""))
    end
    if i % 5 == 0 then add(',{"text":"any caster who did not get the cloak"}') end
    add("]}")
  end
  add("]}")
  return concat(out)
end

-- An awards export as a table, for Awards.encode: `count` received awards, each with the usual fields.
local function syntheticAwards(count)
  local awards = {}
  for n = 1, count do
    awards[n] = {
      id = format("s-tpt2u0-q4tz-%d", n), rev = 1796866260 + n * 60, session = "s-tpt2u0-q4tz", at = 1796866200 + n * 60,
      date = "2026-12-09", phase = 1, raid = "raid-1209", itemId = 200000 + n,
      item = format("Generated Item of the Night %d", n), toId = fakeId(n), to = "Jorren Ashvale", decision = "council",
      priority = fakeId(n + 1000), encounter = "Boss Number 3", npcId = 10003, zoneId = 2000,
      delivery = { state = "received", at = 1796866260 + n * 60, how = "master-loot" },
    }
  end
  return { schema = 1, id = "a-selftest0001", at = 1796876000, by = "IntrepidManager/selftest", awards = awards }
end

-- Awards for the marks: made in the synthetic night's phase (0), from its priorities, to its players.
local function syntheticLog(count)
  local log = {}
  for n = 1, count do
    log[n] = {
      id = format("s-tpt2u0-q4tz-%d", n), rev = 1796866260 + n, phase = 0, itemId = 200000 + n,
      item = format("Generated Item of the Night %d", n), toId = fakeId(n % 60 + 1), to = "Player1 Testname",
      priority = fakeId(n + 1000),
    }
  end
  return log
end

---------------------------------------------------------------------------------------------------------------
-- The checks
---------------------------------------------------------------------------------------------------------------

-- The fastest of `runs` runs of fn, in milliseconds, rounded to hundredths.
local function fastest(env, runs, fn)
  local best
  for _ = 1, runs do
    local started = env.now()
    fn()
    local took = env.now() - started
    if not best or took < best then best = took end
  end
  return floor(best * 100 + 0.5) / 100
end

local function readOrFail(text, kind)
  local read = Envelope.read(text, kind)
  if not read.ok then error(read.code .. ": " .. short(read.message, 100), 0) end
  return read
end

local function runChecks(result, env)
  local sizes = env.sizes or DEFAULT_SIZES
  local runs = sizes.runs or 3
  local samples = ns.SelfTestSamples or {}
  local info = result.info

  local function check(name, fn)
    local ok, err = pcall(fn)
    if ok then
      result.passed = result.passed + 1
    else
      result.failed = result.failed + 1
      result.failures[#result.failures + 1] = name .. ": " .. short(err, 120)
    end
  end

  -- What this client has.
  info.lua = _VERSION
  info.backend = Crc32.backend
  info.hasBit = type(env.bit) == "table"
  info.hasBxor = info.hasBit and type(env.bit.bxor) == "function"
  info.timer = env.now and (env.timer or "yes") or "none"
  info.runs = runs
  if info.hasBxor then
    info.bitProbe = {}
    for _, pair in ipairs(BIT_PROBES) do
      local ok, answer = pcall(env.bit.bxor, pair[1], pair[2])
      info.bitProbe[format("%.0f xor %.0f", pair[1], pair[2])] = ok and answer or ("error: " .. short(answer))
    end
  end

  -- The checksum.
  local plain = Crc32.make(Crc32.pureXor)
  check("checksum: known values, with the xor this client uses (" .. Crc32.backend .. ")", function()
    for _, vector in ipairs(VECTORS) do expectEqual(Crc32.hex(vector[1]), vector[2]) end
  end)
  check("checksum: known values, with the plain xor", function()
    for _, vector in ipairs(VECTORS) do expectEqual(hex(plain(vector[1])), vector[2]) end
  end)
  if info.hasBxor then
    local viaBit
    check("checksum: the table can be built with bit.bxor", function() viaBit = Crc32.make(env.bit.bxor) end)
    if viaBit then
      check("checksum: known values, with bit.bxor", function()
        for _, vector in ipairs(VECTORS) do expectEqual(hex(viaBit(vector[1])), vector[2]) end
      end)
    end
    check("bit.bxor agrees with the plain xor on 400 pairs, numbers with the top bit set included", function()
      local seed = 20261019
      local function nextNumber()
        seed = (seed * 16807) % 2147483647
        return seed
      end
      for _ = 1, 400 do
        local a = nextNumber() + (nextNumber() % 2) * 2147483648
        local b = nextNumber() + (nextNumber() % 2) * 2147483648
        expectEqual(env.bit.bxor(a, b) % 4294967296, Crc32.pureXor(a, b))
      end
    end)
  end

  -- Number and text functions of the client.
  check("string.format: a checksum with the top bit set is written as 8 hex digits", function()
    expectEqual(hex(3904355907), "e8b7be43") -- 0xE8B7BE43, written in decimal on purpose
    expectEqual(hex(1), "00000001")
  end)
  check("string.format: whole numbers are written without an exponent", function()
    expectEqual(format("%.0f", 1796866530), "1796866530")
    expectEqual(format("%.0f", 9007199254740992), "9007199254740992")
    expectEqual(format("%.0f", 1e15), "1000000000000000")
  end)

  -- The JSON reader and writer.
  local function decoded(text)
    local ok, value = Json.decode(text)
    if not ok then error("decode failed: " .. short(value, 100), 0) end
    return value
  end
  -- JSON escapes below are written with doubled backslashes on purpose: a single backslash-u in a source file can be
  -- turned into the character itself by tools, and then the check would test nothing (CI refuses non-ASCII sources).
  check("JSON reader: escapes and UTF-8", function()
    expectEqual(decoded('"a\\u00eb\\ud83c\\udf89\\n\\"\\\\\\/"'), "a\195\171\240\159\142\137\n\"\\/")
  end)
  check("JSON reader: null, false, repeated keys and lists", function()
    local value = decoded([[{"a":null,"b":false,"c":1,"c":2,"d":[],"e":{},"f":[true,false]}]])
    expectEqual(value.a, nil)
    expectEqual(value.b, nil)
    expectEqual(value.c, 2)
    expectEqual(Json.isList(value.d), true)
    expectEqual(Json.isList(value.e), false)
    expectEqual(value.f[2], false)
  end)
  check("JSON reader: numbers", function()
    expectEqual(decoded("[1e3]")[1], 1000)
    expectEqual(decoded("[2.0]")[1], 2)
    expectEqual(decoded("[-5]")[1], -5)
    expectEqual(decoded("[0.5]")[1], 0.5)
    expectEqual(Json.isInteger(decoded("[2e0]")[1]), true)
  end)
  check("JSON reader: bad input is refused", function()
    local bad = { "", "{", "[1,]", "01", '"\\ud800"', '{"a":1} x', "[null]", string.rep("[", 17) .. string.rep("]", 17) }
    for _, text in ipairs(bad) do
      if Json.decode(text) then error("accepted: " .. short(text), 0) end
    end
  end)
  check("JSON writer: escapes", function()
    local shape = Json.object({ "s" })
    expectEqual(Json.encode({ s = 'q"b\\p|d\127t\tz\195\171\240\159\142\137' }, shape),
      '{"s":"q\\"b\\\\p\\u007cd\\u007ft\\tz\\u00eb\\ud83c\\udf89"}')
  end)
  check("JSON writer: whole numbers, and bytes that are not UTF-8", function()
    local shape = Json.object({ "n", "s" })
    expectEqual(Json.encode({ n = 1796866530, s = "a\255b" }, shape), '{"n":1796866530,"s":"a\\ufffdb"}')
  end)

  -- The samples of docs/spec/fixtures/.
  local night = samples.night
  check("night sample: it is read", function()
    local read = readOrFail(night, "night")
    local model = read.model
    expectEqual(read.schema, 1)
    expectEqual(#model.roster, 6)
    expectEqual(#model.priorities, 3)
    expectEqual(model.roster[4].name, "Zo\195\171")
    expectEqual(model.roster[4].surname, "\195\134rinwald")
    expectEqual(model.priorities[1].note, "Tanks first; then DPS, see |notes| in Discord")
    expectEqual(model.priorities[2].lines[1].name, "Garrick Vole")
  end)
  check("night sample: its payload in a new envelope is the same string", function()
    local payload = string.match(night, "^IM1:%a+:j:%d+:(.*):%x%x%x%x%x%x%x%x$")
    expectEqual(Envelope.write("night", payload), night)
  end)
  check("awards sample: it is read, and written back byte for byte", function()
    local read = readOrFail(samples.awards, "awards")
    expectEqual(#read.model.awards, 5)
    expectEqual(Awards.encode(read.model), samples.awards)
  end)

  -- Strings that must be refused, made from the samples: the code the player would see.
  local refusals = {
    { "changed text", "E_CHECKSUM", "night", function() return replaceOnce(night, "Jorren", "Jorrem") end },
    { "cut short", "E_TRUNCATED", "night", function() return string.sub(night, 1, -301) end },
    { "a newer envelope", "E_VERSION", "night", function() return "IM2" .. string.sub(night, 4) end },
    { "a smart quote", "E_CHARS", "night", function() return replaceOnce(night, "'", "\226\128\153") end },
    { "a pipe", "E_CHARS", "night", function() return replaceOnce(night, "Jorren", "Jor|ren") end },
    { "the wrong box", "E_KIND", "night", function() return samples.awards end },
    { "not ours", "E_NOT_IM", "night", function() return "!WA:2!abcdef" end },
    { "a bad length", "E_MALFORMED", "night", function() return "IM1:night:j:12x:{}:00000000" end },
    { "an upper-case checksum", "E_MALFORMED", "night",
      function() return string.sub(night, 1, -9) .. string.upper(string.sub(night, -8)) end },
    { "an unknown encoding", "E_ENCODING", "night", function() return "IM1:night:q:2:{}:00000000" end },
    { "two strings", "E_MULTIPLE", "night", function() return night .. " " .. night end },
    { "a newer schema", "E_SCHEMA", "night", function() return Envelope.write("night", '{"schema":2}') end },
    { "a payload that is not an object", "E_PAYLOAD", "night", function() return Envelope.write("night", "[1]") end },
    { "nesting that is too deep", "E_PAYLOAD", "night", function()
      return Envelope.write("night", '{"schema":1,"x":' .. string.rep("[", 16) .. string.rep("]", 16) .. "}")
    end },
  }
  for _, refusal in ipairs(refusals) do
    check("envelope: " .. refusal[1] .. " gives " .. refusal[2], function()
      local read = Envelope.read(refusal[4](), refusal[3])
      if read.internal then error("a bug: " .. short(read.message, 100), 0) end
      expectEqual(read.ok, false)
      expectEqual(read.code, refusal[2])
    end)
  end
  check("envelope: line breaks, tabs and text around the string are fine", function()
    local pieces = {}
    for from = 1, #night, 76 do pieces[#pieces + 1] = string.sub(night, from, from + 75) end
    local pasted = "Here is the string:\r\n" .. concat(pieces, "\r\n") .. "\r\n\t(copied at 8pm)\n"
    expectEqual(#readOrFail(pasted, "night").model.roster, 6)
  end)

  -- Names, ids, the content checks and the marks (round 2). What the unit tests cannot say: that the client's own string,
  -- math and table functions give the answers these rely on.
  check("names: only the letters A to Z change case, and a tab is not a space", function()
    expectEqual(Names.key("  Jorren   ASHVALE "), "jorren ashvale")
    expectEqual(Names.key("\195\134RINWALD Test"), "\195\134rinwald test") -- the non-ASCII capital stays as it is
    expectEqual(Names.normalize("Jorren\tAshvale"), nil)
    expectEqual(Names.same("Jorren Ashvale", "JORREN ashvale"), true)
  end)
  check("text: code points, NUL and blank are told apart", function()
    expectEqual(Check.codePoints("caf\195\169\240\159\142\137"), 5)
    expectEqual(Check.isText("a\0b", 60, true), false)
    expectEqual(Check.isText("   ", 60, true), false)
    expectEqual(Check.isText("\194\160", 60, true), true) -- a no-break space is text
    expectEqual(Check.isText(string.rep("\195\169", 60), 60, true), true)
    expectEqual(Check.isText(string.rep("\195\169", 61), 60, true), false)
  end)
  check("ids: base 36, session and award ids, revisions, and the client's math.random", function()
    expectEqual(Ids.base36(1796866200), "tpt2u0")
    expectEqual(Ids.base36(9007199254740991), "2gosa7pa2gv")
    expectEqual(Ids.sessionId(1796866200, "q4tz"), "s-tpt2u0-q4tz")
    expectEqual(Ids.awardId("s-tpt2u0-q4tz", 12), "s-tpt2u0-q4tz-12")
    expectEqual(Ids.nextRev(nil, 1796866530), 1796866530)
    expectEqual(Ids.nextRev(1796866530, 1796866530), 1796866531)
    expectEqual(#Ids.randomPart(math.random), 4)
    expectEqual(Ids.isId(Ids.exportId(1796874912, math.random)), true)
  end)
  local nightChecked
  check("content: the night sample has 6 players and 3 priorities and nothing wrong", function()
    nightChecked = Night.read(night)
    expectEqual(nightChecked.ok, true)
    expectEqual(#nightChecked.roster, 6)
    expectEqual(#nightChecked.priorities, 3)
    expectEqual(#nightChecked.rowErrors, 0)
    expectEqual(Night.summary(nightChecked, 1796862600 + 7205, "2026-12-09").text,
      "Night of 2026-12-09, copied 2 hours ago: 6 players, 3 priorities.")
  end)
  check("content: a night with a wrong line skips that priority and says why", function()
    local model = readOrFail(night, "night").model
    local lines = model.priorities[2].lines
    lines[#lines + 1] = { k = 99 }
    local checked = Night.check(model)
    expectEqual(#checked.rowErrors, 1)
    expectEqual(checked.rowErrors[1], "pr-cloak")
    expectEqual(checked.skipped[1].reason, "line 4: unknown player")
  end)
  check("content: the awards sample passes, and an export of it holds the right awards", function()
    local model = readOrFail(samples.awards, "awards").model
    local checked = Awards.check(model)
    expectEqual(checked.ok, true)
    expectEqual(#checked.awards, 5)
    expectEqual(#checked.rowErrors, 0)
    local selection = Awards.select(model.awards, nightChecked or Night.read(night), 1796900000, false)
    expectEqual(selection.count, 5)
    expectEqual(selection.new, 4)
    expectEqual(selection.changed, 1)
    expectEqual(Awards.select(model.awards, nil, 1796900000, false).count, 5)
  end)
  check("marks: the awards sample marks the night sample as the reference says", function()
    local want = samples.marks
    if not want then error("the samples have no marks", 0) end
    local marked = Marks.compute(nightChecked or Night.read(night), readOrFail(samples.awards, "awards").model.awards)
    local priorities = 0
    for id, flags in pairs(want.awarded) do
      priorities = priorities + 1
      expectEqual(#marked.awarded[id], #flags)
      for position = 1, #flags do expectEqual(marked.awarded[id][position], flags[position]) end
    end
    expectEqual(priorities, 3)
    expectEqual(#marked.changed, #want.changed)
  end)

  -- Strings of real sizes: read back, and timed.
  local biggestPayload, biggestItems
  for _, items in ipairs(sizes.nights) do
    local payload = syntheticNight(items)
    local text = Envelope.write("night", payload)
    biggestPayload, biggestItems = payload, items
    check(format("a night of %d items (%s characters) is read back", items, commas(#text)), function()
      local model = readOrFail(text, "night").model
      expectEqual(#model.priorities, items)
      expectEqual(#model.roster, 60)
      expectEqual(model.priorities[items].lines[1].awarded, true)
    end)
    check(format("a night of %d items passes the content checks, and its marks can be worked out", items), function()
      local checked = Night.check(readOrFail(text, "night").model)
      expectEqual(checked.ok, true)
      expectEqual(#checked.rowErrors, 0)
      expectEqual(#checked.priorities, items)
      expectEqual(#checked.roster, 60)
      local log = syntheticLog(floor(items / 2))
      local marked = Marks.compute(checked, log)
      expectEqual(#marked.changed, 0)
      expectEqual(#marked.awarded[fakeId(1001)], 8) -- the first priority has 8 lines, and they are all there
    end)
    if env.now then
      check(format("timing: a night of %d items", items), function()
        local checked = Night.check(readOrFail(text, "night").model)
        local log = syntheticLog(floor(items / 2))
        result.timings.night[#result.timings.night + 1] = {
          items = items,
          chars = #text,
          checksumMs = fastest(env, runs, function() Crc32.hex(text) end),
          plainChecksumMs = fastest(env, 1, function() plain(text) end),
          decodeMs = fastest(env, runs, function() Json.decode(payload) end),
          readMs = fastest(env, runs, function() Envelope.read(text, "night") end),
          checkMs = fastest(env, runs, function() Night.check(checked.model) end),
          marksMs = fastest(env, runs, function() Marks.compute(checked, log) end),
        }
      end)
    end
  end
  if env.memory and biggestPayload then
    check("memory: reading the biggest night", function()
      local before = env.memory()
      local value = decoded(biggestPayload)
      info.decodeMemoryKB = floor(env.memory() - before) -- rough: the collector may run meanwhile
      expectEqual(#value.priorities, biggestItems)
    end)
  end

  for _, count in ipairs(sizes.awards) do
    local model = syntheticAwards(count)
    local text, readBack
    check(format("an export of %d awards is written and read back", count), function()
      text = Awards.encode(model)
      local read = readOrFail(text, "awards")
      readBack = read.model
      expectEqual(#read.model.awards, count)
      expectEqual(read.model.awards[count].to, "Jorren Ashvale")
      expectEqual(Awards.encode(read.model), text)
      local checked = Awards.check(read.model)
      expectEqual(checked.ok, true)
      expectEqual(#checked.rowErrors, 0)
      expectEqual(#checked.awards, count)
    end)
    if env.now and text and readBack then
      check(format("timing: an export of %d awards", count), function()
        result.timings.awards[#result.timings.awards + 1] = {
          awards = count,
          chars = #text,
          writeMs = fastest(env, runs, function() Awards.encode(model) end),
          checkMs = fastest(env, runs, function() Awards.check(readBack) end),
        }
      end)
    end
  end
end

-- Runs every check. Never raises.
function SelfTest.run(env)
  local result = { passed = 0, failed = 0, failures = {}, info = {}, timings = { night = {}, awards = {} } }
  local ok, err = pcall(runChecks, result, env or {})
  if not ok then
    result.failed = result.failed + 1
    result.failures[#result.failures + 1] = "the self-test itself: " .. short(err, 120)
  end
  return result
end

---------------------------------------------------------------------------------------------------------------
-- The report
---------------------------------------------------------------------------------------------------------------

local function ms(value)
  return value and format("%.1f", value) or "-"
end

-- The lines to show the player: counts, what failed, what the client has, and the times.
function SelfTest.summary(result)
  local lines = {}
  local function add(text) lines[#lines + 1] = text end
  local info = result.info
  add(format("Self-test: %s checks, %s passed, %s failed.", commas(result.passed + result.failed), commas(result.passed),
    commas(result.failed)))
  for i, failure in ipairs(result.failures) do
    if i > 8 then
      add("... and " .. commas(#result.failures - 8) .. " more failures (see the saved file).")
      break
    end
    add("FAILED " .. safe(failure))
  end

  local bits = "no bit library"
  if info.hasBxor then
    local answer = info.bitProbe and info.bitProbe["4294967295 xor 0"]
    bits = "bit.bxor answers are " .. (answer == -1 and "signed" or (answer == 4294967295 and "unsigned" or "odd: " .. safe(answer)))
  elseif info.hasBit then
    bits = "a bit library without bxor"
  end
  add(safe(info.lua) .. ". Checksum: " .. safe(info.backend) .. " (" .. bits .. "). Timer: " .. safe(info.timer) .. ".")

  if #result.timings.night > 0 or #result.timings.awards > 0 then
    add("Fastest of " .. tostring(info.runs) .. " runs, in milliseconds:")
    for _, row in ipairs(result.timings.night) do
      add(format("  night, %d items, %s characters: checksum %s (plain xor %s), JSON decode %s, whole read %s, content checks %s, marks %s",
        row.items, commas(row.chars), ms(row.checksumMs), ms(row.plainChecksumMs), ms(row.decodeMs), ms(row.readMs),
        ms(row.checkMs), ms(row.marksMs)))
    end
    for _, row in ipairs(result.timings.awards) do
      add(format("  export of %d awards, %s characters: write %s, content checks %s", row.awards, commas(row.chars),
        ms(row.writeMs), ms(row.checkMs)))
    end
    -- A negative figure means the collector ran meanwhile; it says nothing, so it is only kept in the saved file.
    if info.decodeMemoryKB and info.decodeMemoryKB > 0 then
      add("  reading the biggest night used about " .. commas(info.decodeMemoryKB) .. " KB.")
    end
  else
    add("No timer in this client, so nothing was timed.")
  end
  return lines
end
