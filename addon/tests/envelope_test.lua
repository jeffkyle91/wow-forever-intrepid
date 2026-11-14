-- The envelope (docs/spec/exchange-v0.md, section 1) and the shared cases in docs/spec/fixtures/cases/.
-- Invented names only. See AGENTS.md.
local ns = load_core({}, "Crc32", "Json", "Envelope", "Ids", "Check", "Night", "Awards")
local Envelope, Json, Night, Awards = ns.Envelope, ns.Json, ns.Night, ns.Awards

local FIXTURES = SPEC .. "fixtures/"

local function decode(text)
  local ok, value = Json.decode(text)
  if not ok then error("decode failed: " .. tostring(value), 2) end
  return value
end

local function modelOf(name)
  return decode(read_file(FIXTURES .. name .. ".model.json"))
end

local function fixtureString(name)
  return read_file(FIXTURES .. name .. ".j.txt")
end

-- Asserts that reading `text` in the night box fails with `code`, and returns the result.
local function refused(text, code, kind)
  local result = Envelope.read(text, kind or "night")
  if result.ok then error("expected " .. code .. ", but the string was accepted", 2) end
  if result.internal then error("expected " .. code .. ", got a bug: " .. result.message, 2) end
  eq(result.code, code)
  return result
end

local NIGHT = fixtureString("night-small")
local AWARDS = fixtureString("awards-small")

---------------------------------------------------------------------------------------------------------------
-- The shared cases: every file in docs/spec/fixtures/cases/ gives the answer cases.json names.
---------------------------------------------------------------------------------------------------------------

local cases = decode(read_file(FIXTURES .. "cases/cases.json"))
local seenCodes = {}

test("there are shared cases for both boxes", function()
  is_true(#cases >= 87)
  local boxes = {}
  for _, case in ipairs(cases) do boxes[case.box] = true end
  is_true(boxes.night and boxes.awards)
end)

for _, case in ipairs(cases) do
  test("shared case " .. case.file, function()
    local text = read_file(FIXTURES .. case.file)
    -- the addon's box takes one string; the app's importer takes all it finds
    local result
    if case.box == "night" then
      result = Envelope.read(text, "night")
    else
      result = Envelope.readAll(text, "awards")
    end
    if result.internal then error("a bug, not bad input: " .. result.message) end
    if case.layer == "content" then
      -- the error comes from the content checks (step 9), which are not part of the envelope code:
      -- the envelope itself is fine
      if not result.ok then error("the envelope should be accepted, got " .. result.code .. ": " .. result.message) end
      eq(case.expect, "E_PAYLOAD")
      local checked = (case.box == "night" and Night or Awards).check(result.model or result.items[1].model)
      eq(checked.ok, false)
      eq(checked.code, "E_PAYLOAD")
    elseif case.expect == "OK" then
      if not result.ok then error("expected OK, got " .. result.code .. ": " .. result.message) end
      local items = result.items or { result }
      if case.envelopes then eq(#items, case.envelopes) end
      if case.sameAs then deep_eq(items[1].model, modelOf(case.sameAs)) end
      -- step 9, the content checks: the rows the case names are the ones that are wrong (all strings of the text together)
      local rowErrors = {}
      for _, item in ipairs(items) do
        local checked = (case.box == "night" and Night or Awards).check(item.model)
        if not checked.ok then error("the content checks refused it: " .. checked.code .. ": " .. checked.message) end
        for _, name in ipairs(checked.rowErrors) do rowErrors[#rowErrors + 1] = name end
      end
      table.sort(rowErrors)
      deep_eq(rowErrors, case.rowErrors or {})
    else
      seenCodes[case.expect] = true
      eq(result.ok, false)
      eq(result.code, case.expect)
      is_true(#result.message > 10)
    end
  end)
end

test("the shared cases between them reach every error code", function()
  for _, code in ipairs(Envelope.CODES) do
    if not seenCodes[code] then error("no shared case ends in " .. code) end
  end
  eq(#Envelope.CODES, 11)
end)

test("the good fixture strings are read, in their own boxes", function()
  for _, name in ipairs({ "night-small", "night-empty" }) do
    local result = Envelope.read(fixtureString(name), "night")
    is_true(result.ok)
    eq(result.kind, "night")
    eq(result.schema, 1)
    deep_eq(result.model, modelOf(name))
  end
  local result = Envelope.read(AWARDS, "awards")
  is_true(result.ok)
  deep_eq(result.model, modelOf("awards-small"))
end)

---------------------------------------------------------------------------------------------------------------
-- Writing
---------------------------------------------------------------------------------------------------------------

test("write builds the envelope of the spec", function()
  -- the checksums come from Python's zlib (docs/spec/fixtures/crc32-vectors.json)
  eq(Envelope.write("night", "{}"), "IM1:night:j:2:{}:578c47fe")
  eq(Envelope.write("awards", "{}"), "IM1:awards:j:2:{}:921f3f11")
end)

test("write refuses what cannot be a payload, and a kind that is not ours", function()
  for _, bad in ipairs({ "has|pipe", "tab\there", "line\nbreak", "caf\195\169", "del\127", 12, true }) do
    local ok = pcall(Envelope.write, "night", bad)
    eq(ok, false)
  end
  eq((pcall(Envelope.write, "roster", "{}")), false)
  eq((pcall(Envelope.read, "text", "roster")), false)
  eq((pcall(Envelope.readAll, "text", nil)), false)
end)

test("what write makes, read gives back", function()
  local shape = Json.object({ "schema", "id", "note" })
  local payload = Json.encode({ schema = 1, id = "n-1", note = "Zo\195\171 said \"hi\" | \\ \240\159\142\137" }, shape)
  local result = Envelope.read(Envelope.write("night", payload), "night")
  is_true(result.ok)
  eq(result.model.note, "Zo\195\171 said \"hi\" | \\ \240\159\142\137")
end)

test("random texts survive writing and reading", function()
  local function utf8(code)
    if code < 0x80 then return string.char(code) end
    if code < 0x800 then return string.char(0xC0 + math.floor(code / 0x40), 0x80 + code % 0x40) end
    if code < 0x10000 then
      return string.char(0xE0 + math.floor(code / 0x1000), 0x80 + math.floor(code / 0x40) % 0x40, 0x80 + code % 0x40)
    end
    return string.char(0xF0 + math.floor(code / 0x40000), 0x80 + math.floor(code / 0x1000) % 0x40,
      0x80 + math.floor(code / 0x40) % 0x40, 0x80 + code % 0x40)
  end
  math.randomseed(1019)
  local shape = Json.object({ "schema", "s" })
  for _ = 1, 60 do
    local pieces = {}
    for i = 1, math.random(0, 40) do
      local code = ({ math.random(0, 127), math.random(128, 0x7FF), math.random(0x800, 0xD7FF), math.random(0xE000, 0xFFFF), math.random(0x10000, 0x10FFFF) })[math.random(1, 5)]
      pieces[i] = utf8(code)
    end
    local text = table.concat(pieces)
    local result = Envelope.read(Envelope.write("night", Json.encode({ schema = 1, s = text }, shape)), "night")
    is_true(result.ok)
    eq(result.model.s, text)
  end
end)

test("a payload of 100,000 characters", function()
  local shape = Json.object({ "schema", "pad" })
  local payload = Json.encode({ schema = 1, pad = string.rep("0123456789abcdef", 6200) }, shape)
  is_true(#payload > 99000)
  local result = Envelope.read(Envelope.write("night", payload), "night")
  is_true(result.ok)
  eq(#result.model.pad, 99200)
end)

---------------------------------------------------------------------------------------------------------------
-- Reading, step by step (section 1.1)
---------------------------------------------------------------------------------------------------------------

test("steps 1 and 2: line breaks and tabs are removed, text around the string is ignored, IM1 is found first", function()
  local broken = NIGHT:sub(1, 40) .. "\r\n\t" .. NIGHT:sub(41, 400) .. "\n" .. NIGHT:sub(401)
  is_true(Envelope.read(broken, "night").ok)
  is_true(Envelope.read("Here is the night string: " .. NIGHT .. "\n(copied at 8pm)", "night").ok)
  is_true(Envelope.read("IM2:old text " .. NIGHT, "night").ok)
end)

test("not ours, or a newer envelope", function()
  refused("hello", "E_NOT_IM")
  refused("", "E_NOT_IM")
  refused("im1:night:j:2:{}:578c47fe", "E_NOT_IM") -- case matters
  refused("IM1", "E_NOT_IM")
  refused("IM2:night:j:2:{}:00000000", "E_VERSION")
  refused("see IM12: for details", "E_VERSION")
  refused(nil, "E_NOT_IM")
  refused(42, "E_NOT_IM")
end)

test("step 3: header problems, in the order the spec gives", function()
  refused("IM1:night", "E_MALFORMED")
  refused("IM1:night:j", "E_MALFORMED")
  refused("IM1:night:j:2", "E_MALFORMED")
  -- the length is checked before the kind, the kind before the encoding
  refused("IM1:awards:q:02:{}:00000000", "E_MALFORMED")
  refused("IM1:awards:q:2:{}:00000000", "E_KIND")
  refused("IM1:night:q:2:{}:00000000", "E_ENCODING")
  refused("IM1:night:jz:2:{}:00000000", "E_ENCODING")
  refused("IM1:night:j:+2:{}:00000000", "E_MALFORMED")
  refused("IM1:night:j:2.0:{}:00000000", "E_MALFORMED")
  refused("IM1:night:j:0x2:{}:00000000", "E_MALFORMED")
  refused("IM1:night:j: 2:{}:00000000", "E_MALFORMED")
end)

test("step 4: a character outside the allowed set wins over a short string", function()
  local cut = NIGHT:sub(1, 60) .. "\226\128\153" .. NIGHT:sub(61, 100) -- a smart quote, and the rest is missing
  refused(cut, "E_CHARS")
  refused(NIGHT:sub(1, 100), "E_TRUNCATED")
  -- only the envelope is checked: text after the checksum may be anything
  is_true(Envelope.read(NIGHT .. " \226\128\153 \127 |", "night").ok)
end)

test("step 5: truncated, or a missing colon or checksum", function()
  local result = refused(NIGHT:sub(1, -4), "E_TRUNCATED")
  is_true(result.message:find("%d+ of %d+ characters") ~= nil)
  refused(NIGHT:sub(1, -2), "E_TRUNCATED") -- one character short is still short
  refused(NIGHT:sub(1, -10), "E_TRUNCATED")
  refused(NIGHT:sub(1, -9), "E_TRUNCATED")
  is_true(Envelope.read(NIGHT, "night").ok)
  refused(NIGHT:sub(1, -2) .. "G", "E_MALFORMED")
  refused(NIGHT:sub(1, -9) .. "zzzzzzzz", "E_MALFORMED")
  refused(NIGHT:sub(1, -9) .. NIGHT:sub(-8):upper(), "E_MALFORMED") -- the checksum is lowercase hex
  refused(NIGHT:sub(1, -10) .. "X" .. NIGHT:sub(-8), "E_MALFORMED")
end)

test("step 6: a changed string gives E_CHECKSUM", function()
  refused(NIGHT:gsub("Mirelle", "Mirelld", 1), "E_CHECKSUM")
  refused(NIGHT:gsub('"phase":1', '"phase":2', 1), "E_CHECKSUM")
end)

test("step 7: the payload must be a JSON object", function()
  refused(Envelope.write("night", ""), "E_PAYLOAD")
  refused(Envelope.write("night", "{"), "E_PAYLOAD")
  for _, notAnObject in ipairs({ "[]", "[1]", '[{"schema":1}]', '"text"', "12", "null", "true" }) do
    local result = refused(Envelope.write("night", notAnObject), "E_PAYLOAD")
    is_true(result.message:find("not an object", 1, true) ~= nil)
  end
  refused(Envelope.write("night", '{"schema":1} x'), "E_PAYLOAD")
end)

test("step 8: the schema", function()
  local function withSchema(json) return Envelope.write("night", '{"schema":' .. json .. "}") end
  is_true(Envelope.read(withSchema("1"), "night").ok)
  is_true(Envelope.read(withSchema("1.0"), "night").ok)
  is_true(Envelope.read(withSchema("1e0"), "night").ok)
  refused(withSchema("0"), "E_SCHEMA")
  refused(withSchema("2"), "E_SCHEMA")
  refused(withSchema("-1"), "E_SCHEMA")
  refused(withSchema("1e3"), "E_SCHEMA")
  refused(withSchema('"1"'), "E_PAYLOAD")
  refused(withSchema("1.5"), "E_PAYLOAD")
  refused(withSchema("true"), "E_PAYLOAD")
  refused(withSchema("null"), "E_PAYLOAD")
  refused(withSchema("[1]"), "E_PAYLOAD")
  refused(Envelope.write("night", "{}"), "E_PAYLOAD")
  refused(Envelope.write("night", '{"Schema":1}'), "E_PAYLOAD")
end)

test("step 10: a second string", function()
  local two = NIGHT .. " " .. NIGHT
  refused(two, "E_MULTIPLE")
  -- the box does not look at the second string, so a broken one is E_MULTIPLE too
  refused(NIGHT .. " " .. NIGHT:gsub("Mirelle", "Mirelld", 1), "E_MULTIPLE")
  refused(NIGHT .. " IM1:", "E_MULTIPLE")
  -- the app's importer reads them all, and the first error is the answer
  local all = Envelope.readAll(two, "night")
  is_true(all.ok)
  eq(#all.items, 2)
  local broken = Envelope.readAll(NIGHT .. " " .. NIGHT:gsub("Mirelle", "Mirelld", 1), "night")
  eq(broken.ok, false)
  eq(broken.code, "E_CHECKSUM")
  -- "IM1:" inside the first string's own text is not a second string
  local inside = Envelope.write("night", '{"schema":1,"note":"see IM1:night:j:2:{}:00000000"}')
  is_true(Envelope.read(inside, "night").ok)
end)

---------------------------------------------------------------------------------------------------------------
-- Messages
---------------------------------------------------------------------------------------------------------------

test("the message for a string in the wrong box says where it belongs", function()
  local wrong = refused(AWARDS, "E_KIND")
  is_true(wrong.message:find("an awards string", 1, true) ~= nil)
  is_true(wrong.message:find("night strings", 1, true) ~= nil)
  is_true(wrong.message:find("Raid Desk importer", 1, true) ~= nil)
  local other = Envelope.readAll(NIGHT, "awards")
  is_true(other.message:find("a night string", 1, true) ~= nil)
  is_true(other.message:find("into the addon", 1, true) ~= nil)
end)

test("the message for a wrong schema gives both numbers", function()
  local result = refused(Envelope.write("night", '{"schema":7}'), "E_SCHEMA")
  is_true(result.message:find("schema 7", 1, true) ~= nil)
  is_true(result.message:find("up to 1", 1, true) ~= nil)
end)

test("the message for a bad character says where it is", function()
  local result = refused("IM1:night:j:2:{|:00000000", "E_CHARS")
  is_true(result.message:find("character 16", 1, true) ~= nil)
end)

test("text from a pasted header is shown safely, so it cannot start an escape code in the game", function()
  local result = refused("IM1:|cffff0000evil:j:2:{}:00000000", "E_KIND")
  eq(result.message:find("|", 1, true), nil)
  local long = refused("IM1:" .. string.rep("x", 500) .. ":j:2:{}:00000000", "E_KIND")
  is_true(#long.message < 300)
  eq(refused("IM1:night:|T:2:{}:00000000", "E_ENCODING").message:find("|", 1, true), nil)
end)

---------------------------------------------------------------------------------------------------------------
-- A bug is not mistaken for bad input
---------------------------------------------------------------------------------------------------------------

test("a bug inside a read comes back as an internal E_PAYLOAD, not as an error", function()
  local stub = load_core({}, "Crc32", "Json")
  stub.Json = {
    decode = function() error("boom from a stub") end,
    isList = ns.Json.isList,
    isInteger = ns.Json.isInteger,
  }
  load_core(stub, "Envelope")
  local result = stub.Envelope.read(NIGHT, "night")
  eq(result.ok, false)
  eq(result.code, "E_PAYLOAD")
  eq(result.internal, true)
  is_true(result.message:find("boom from a stub", 1, true) ~= nil)
  -- ordinary bad input is not marked
  eq(stub.Envelope.read("hello", "night").internal, nil)
end)
