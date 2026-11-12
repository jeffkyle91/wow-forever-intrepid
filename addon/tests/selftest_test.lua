-- The self-test that /im selftest runs in the game (core/SelfTest.lua). Invented names only. See AGENTS.md.
local ns = load_core({}, "Crc32", "Json", "Envelope", "Names", "Ids", "Check", "Night", "Marks", "Awards", "SelfTestSamples", "SelfTest")
local Crc32, SelfTest = ns.Crc32, ns.SelfTest

local FIXTURES = "docs/spec/fixtures/"

-- A bit library like the client's, as far as the checksum cares: results are signed 32-bit numbers.
local function signedBit()
  return {
    bxor = function(a, b)
      local r = Crc32.pureXor(a % 4294967296, b % 4294967296)
      if r >= 2147483648 then r = r - 4294967296 end
      return r
    end,
  }
end

-- A clock that moves by one millisecond every time it is read.
local function steppingClock()
  local t = 0
  return function()
    t = t + 1
    return t
  end
end

local SMALL = { nights = { 10, 100 }, awards = { 5, 40 }, runs = 2 }

local function failuresText(result)
  return table.concat(result.failures, "\n")
end

test("the samples inside the addon are the fixture files", function()
  eq(ns.SelfTestSamples.night, read_file(FIXTURES .. "night-small.j.txt"))
  eq(ns.SelfTestSamples.awards, read_file(FIXTURES .. "awards-small.j.txt"))
end)

test("without a bit library or a timer, every check passes and nothing is timed", function()
  local result = SelfTest.run({ sizes = SMALL })
  eq(failuresText(result), "")
  eq(result.failed, 0)
  is_true(result.passed >= 25)
  eq(result.info.hasBit, false)
  eq(result.info.timer, "none")
  eq(result.info.backend, "pure")
  eq(#result.timings.night, 0)
  eq(#result.timings.awards, 0)
  eq(result.info.bitProbe, nil)
end)

test("with the default env (nothing at all) it still runs", function()
  local result = SelfTest.run()
  eq(result.failed, 0)
  is_true(result.passed >= 25)
end)

test("with a signed bit library, a clock and a memory counter, every check passes and the times are recorded", function()
  local memory = 1000
  local result = SelfTest.run({
    bit = signedBit(), now = steppingClock(), timer = "stand-in clock", sizes = SMALL,
    memory = function()
      memory = memory + 50
      return memory
    end,
  })
  eq(failuresText(result), "")
  eq(result.failed, 0)
  eq(result.info.hasBxor, true)
  eq(result.info.timer, "stand-in clock")
  eq(result.info.bitProbe["4294967295 xor 0"], -1)
  eq(result.info.bitProbe["2147483648 xor 0"], -2147483648)
  eq(result.info.bitProbe["1 xor 2"], 3)
  eq(#result.timings.night, 2)
  eq(#result.timings.awards, 2)
  eq(result.timings.night[1].items, 10)
  is_true(result.timings.night[2].chars > result.timings.night[1].chars)
  eq(result.timings.night[2].readMs, 1)
  eq(result.timings.awards[2].awards, 40)
  is_true(result.timings.awards[2].chars > 10000)
  is_true(result.info.decodeMemoryKB ~= nil)
end)

test("the full default sizes run and pass (about 115,000 characters at the largest)", function()
  local result = SelfTest.run({ bit = signedBit(), now = steppingClock() })
  eq(failuresText(result), "")
  eq(#result.timings.night, 3)
  eq(#result.timings.awards, 3)
  is_true(result.timings.night[3].chars > 100000)
end)

test("an unsigned bit library (answers kept in 0 .. 2^32 - 1) works too", function()
  local unsigned = { bxor = function(a, b) return Crc32.pureXor(a % 4294967296, b % 4294967296) end }
  local result = SelfTest.run({ bit = unsigned, sizes = SMALL })
  eq(failuresText(result), "")
  eq(result.info.bitProbe["4294967295 xor 0"], 4294967295)
end)

test("a bit.bxor that loses the top bit is found", function()
  local broken = { bxor = function(a, b) return Crc32.pureXor(a % 2147483648, b % 2147483648) end }
  local result = SelfTest.run({ bit = broken, sizes = SMALL })
  is_true(result.failed >= 2)
  is_true(failuresText(result):find("bit.bxor", 1, true) ~= nil)
end)

test("a bit.bxor that answers wrongly is found, and one that raises does not stop the run", function()
  local wrong = { bxor = function(a, b) return Crc32.pureXor(a, b) + 1 end }
  local wrongResult = SelfTest.run({ bit = wrong, sizes = SMALL })
  is_true(wrongResult.failed >= 1)
  local raising = { bxor = function() error("boom from a stand-in") end }
  local result = SelfTest.run({ bit = raising, sizes = SMALL })
  is_true(result.failed >= 1)
  is_true(failuresText(result):find("boom from a stand-in", 1, true) ~= nil)
  is_true(result.passed >= 20) -- the other checks still ran
  is_true(tostring(result.info.bitProbe["1 xor 2"]):find("error", 1, true) ~= nil)
end)

test("a bit table without bxor is reported, not run", function()
  local result = SelfTest.run({ bit = {}, sizes = SMALL })
  eq(result.failed, 0)
  eq(result.info.hasBit, true)
  eq(result.info.hasBxor, false)
end)

test("a clock that raises is a failure, not an error", function()
  local result = SelfTest.run({ now = function() error("no clock") end, sizes = SMALL })
  is_true(result.failed >= 1)
  is_true(failuresText(result):find("no clock", 1, true) ~= nil)
end)

test("a broken module is found by the checks that use it", function()
  local other = load_core({}, "Crc32", "Json", "Envelope", "Names", "Ids", "Check", "Night", "Marks", "Awards", "SelfTestSamples")
  -- an Envelope that reads everything as a checksum error
  other.Envelope.read = function() return { ok = false, code = "E_CHECKSUM", message = "stand-in" } end
  load_core(other, "SelfTest")
  local result = other.SelfTest.run({ sizes = SMALL })
  is_true(result.failed >= 10)
end)

test("a writer that changes its output is found", function()
  local other = load_core({}, "Crc32", "Json", "Envelope", "Names", "Ids", "Check", "Night", "Marks", "Awards", "SelfTestSamples")
  local realEncode = other.Awards.encode
  other.Awards.encode = function(model) return (string.gsub(realEncode(model), "Mirelle", "Mirelld")) end
  load_core(other, "SelfTest")
  local result = other.SelfTest.run({ sizes = SMALL })
  is_true(failuresText(result):find("awards sample", 1, true) ~= nil)

  local second = load_core({}, "Crc32", "Json", "Envelope", "Names", "Ids", "Check", "Night", "Marks", "Awards", "SelfTestSamples")
  local realWrite = second.Envelope.write
  second.Envelope.write = function(kind, payload) return realWrite(kind, payload) .. " " end
  load_core(second, "SelfTest")
  local other_result = second.SelfTest.run({ sizes = SMALL })
  is_true(failuresText(other_result):find("night sample: its payload in a new envelope", 1, true) ~= nil)
end)

test("the samples missing is a failure, not an error", function()
  local other = load_core({}, "Crc32", "Json", "Envelope", "Names", "Ids", "Check", "Night", "Marks", "Awards")
  load_core(other, "SelfTest")
  local result = other.SelfTest.run({ sizes = SMALL })
  is_true(result.failed >= 3)
end)

test("the summary says what happened, in lines that are safe to print", function()
  local result = SelfTest.run({ bit = signedBit(), now = steppingClock(), sizes = SMALL })
  local lines = SelfTest.summary(result)
  is_true(#lines >= 6)
  is_true(lines[1]:find("Self-test: ", 1, true) == 1)
  is_true(lines[1]:find("0 failed", 1, true) ~= nil)
  local text = table.concat(lines, "\n")
  is_true(text:find("signed", 1, true) ~= nil)
  is_true(text:find("night, 100 items", 1, true) ~= nil)
  is_true(text:find("export of 40 awards", 1, true) ~= nil)
  eq(text:find("|", 1, true), nil)
  for _, line in ipairs(lines) do is_true(#line < 200) end
end)

test("the summary of a failing run lists the failures, and cleans up what it shows", function()
  local result = SelfTest.run({ sizes = SMALL })
  result.failed = result.failed + 1
  result.failures[#result.failures + 1] = "something with a |cffff0000 pipe and \195\171 bytes"
  for i = 1, 10 do result.failures[#result.failures + 1] = "more " .. i end
  local lines = SelfTest.summary(result)
  local text = table.concat(lines, "\n")
  is_true(text:find("FAILED something with a ?cffff0000 pipe and ?? bytes", 1, true) ~= nil)
  is_true(text:find("more failures", 1, true) ~= nil)
  eq(text:find("|", 1, true), nil)
end)

test("the memory line is shown only when the figure means something", function()
  local function summaryWith(delta)
    local used = 5000
    local result = SelfTest.run({
      now = steppingClock(), sizes = SMALL,
      memory = function()
        used = used + delta
        return used
      end,
    })
    return table.concat(SelfTest.summary(result), "\n"), result
  end
  local text = summaryWith(300)
  is_true(text:find("used about 300 KB", 1, true) ~= nil)
  local negative, result = summaryWith(-300)
  eq(negative:find("used about", 1, true), nil)
  eq(result.info.decodeMemoryKB, -300) -- kept in the saved file all the same
end)

test("the summary without a timer says so", function()
  local lines = SelfTest.summary(SelfTest.run({ sizes = SMALL }))
  is_true(table.concat(lines, "\n"):find("nothing was timed", 1, true) ~= nil)
end)

-- Round 2: the checks of names, ids, content and marks --------------------------------------------------------------

local ALL_MODULES = { "Crc32", "Json", "Envelope", "Names", "Ids", "Check", "Night", "Marks", "Awards", "SelfTestSamples" }

local function withBroken(change)
  local other = load_core({}, unpack(ALL_MODULES))
  change(other)
  load_core(other, "SelfTest")
  return other.SelfTest.run({ sizes = SMALL })
end

test("the timings include the content checks and the marks", function()
  local result = SelfTest.run({ now = steppingClock(), sizes = SMALL })
  eq(failuresText(result), "")
  eq(result.timings.night[1].checkMs, 1)
  eq(result.timings.night[1].marksMs, 1)
  eq(result.timings.awards[1].checkMs, 1)
  local text = table.concat(SelfTest.summary(result), "\n")
  is_true(text:find("content checks 1.0, marks 1.0", 1, true) ~= nil)
  is_true(text:find("write 1.0, content checks 1.0", 1, true) ~= nil)
end)

test("a names module that changes case wrongly is found", function()
  local result = withBroken(function(other)
    other.Names.key = function(text) return text and string.lower(text) end -- string.lower: the locale's idea of case
    other.Names.normalize = function(text) return text and string.upper(text) end
  end)
  is_true(failuresText(result):find("names:", 1, true) ~= nil)
end)

test("an id module that gets base 36 wrong is found", function()
  local result = withBroken(function(other)
    other.Ids.base36 = function() return "0" end
  end)
  is_true(failuresText(result):find("ids:", 1, true) ~= nil)
end)

test("a night checker that finds problems in a good night is found", function()
  local result = withBroken(function(other)
    local real = other.Night.check
    other.Night.check = function(model)
      local checked = real(model)
      if checked.ok then checked.rowErrors[#checked.rowErrors + 1] = "roster:1" end
      return checked
    end
  end)
  is_true(failuresText(result):find("content: the night sample", 1, true) ~= nil)
  is_true(failuresText(result):find("passes the content checks", 1, true) ~= nil)
end)

test("an awards checker or selector that is wrong is found", function()
  local wrongCheck = withBroken(function(other)
    other.Awards.check = function() return { ok = true, awards = {}, rowErrors = {} } end
  end)
  is_true(failuresText(wrongCheck):find("content: the awards sample", 1, true) ~= nil)
  local wrongSelect = withBroken(function(other)
    other.Awards.select = function() return { count = 0, new = 0, changed = 0, awards = {} } end
  end)
  is_true(failuresText(wrongSelect):find("content: the awards sample", 1, true) ~= nil)
end)

test("marks that differ from the reference are found", function()
  local wrongMarks = withBroken(function(other)
    local real = other.Marks.compute
    other.Marks.compute = function(night, log)
      local result = real(night, log)
      result.awarded["pr-blade"][2] = not result.awarded["pr-blade"][2]
      return result
    end
  end)
  is_true(failuresText(wrongMarks):find("marks: the awards sample", 1, true) ~= nil)
  local wrongSample = withBroken(function(other)
    other.SelfTestSamples.marks.awarded["pr-typed"][1] = true
  end)
  is_true(failuresText(wrongSample):find("marks: the awards sample", 1, true) ~= nil)
  local noSample = withBroken(function(other)
    other.SelfTestSamples.marks = nil
  end)
  is_true(failuresText(noSample):find("the samples have no marks", 1, true) ~= nil)
end)

test("the generated marks in the samples are the ones in the fixtures", function()
  local want = ns.SelfTestSamples.marks
  deep_eq(want.awarded, { ["pr-blade"] = { true, true, false, false }, ["pr-cloak"] = { true, false, true }, ["pr-typed"] = { false } })
  deep_eq(want.changed, {})
end)
