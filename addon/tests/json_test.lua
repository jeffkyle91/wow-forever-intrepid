-- JSON reader (docs/spec/exchange-v0.md, section 3, "Readers"). Invented names only. See AGENTS.md.
local ns = load_core({}, "Crc32", "Json")
local Json = ns.Json
local Crc32 = ns.Crc32

local FIXTURES = "docs/spec/fixtures/"

local function decode(text)
  local ok, value = Json.decode(text)
  if not ok then error("decode failed: " .. tostring(value), 2) end
  return value
end

-- Asserts that `text` is refused, and returns the message.
local function rejected(text)
  local ok, message = Json.decode(text)
  if ok then error("expected an error for: " .. text:sub(1, 60), 2) end
  return message
end

test("scalars", function()
  eq(decode('"abc"'), "abc")
  eq(decode("12"), 12)
  eq(decode("-5"), -5)
  eq(decode("true"), true)
  eq(decode("false"), false)
  eq(decode("null"), nil)
  local ok, value = Json.decode("null")
  is_true(ok)
  eq(value, nil)
end)

test("whitespace between tokens", function()
  deep_eq(decode(' \t\r\n{ "a" : [ 1 , 2 ] , "b" : { } } \n'), { a = { 1, 2 }, b = {} })
end)

test("lists are marked, objects are not, so [] and {} stay different", function()
  is_true(Json.isList(decode("[]")))
  is_true(Json.isList(decode("[1,2]")))
  eq(Json.isList(decode("{}")), false)
  eq(Json.isList(decode('{"a":[]}')), false)
  is_true(Json.isList(decode('{"a":[]}').a))
  eq(Json.isList("text"), false)
  eq(Json.isList(nil), false)
  is_true(Json.isList(Json.list()))
  is_true(Json.isList(Json.list({ 1, 2 })))
end)

test("null removes a field, including an earlier value of the same key", function()
  deep_eq(decode('{"a":null,"b":1}'), { b = 1 })
  deep_eq(decode('{"a":1,"a":null}'), {})
end)

test("false removes a field, including an earlier value of the same key", function()
  deep_eq(decode('{"a":false,"b":true}'), { b = true })
  deep_eq(decode('{"a":true,"a":false}'), {})
  deep_eq(decode('{"a":{"b":false}}'), { a = {} })
end)

test("when a key repeats, the last value wins", function()
  deep_eq(decode('{"a":1,"a":2}'), { a = 2 })
  deep_eq(decode('{"a":null,"a":3}'), { a = 3 })
end)

test("null in a list is an error, false in a list is kept", function()
  rejected("[null]")
  rejected("[1,null,2]")
  rejected('{"k":[1,null]}')
  deep_eq(decode("[true,false]"), { true, false })
  deep_eq(decode("[false]"), { false })
end)

test("numbers", function()
  eq(decode("0"), 0)
  eq(decode("-0"), 0)
  eq(decode("1.5"), 1.5)
  eq(decode("1e3"), 1000)
  eq(decode("1E+3"), 1000)
  eq(decode("125e-2"), 1.25)
  eq(decode("2.0"), 2)
  eq(decode("2e0"), 2)
  eq(decode("9007199254740992"), 9007199254740992)
end)

test("things that are not JSON numbers", function()
  for _, text in ipairs({ "01", "00", "+1", ".5", "1.", "-", "--1", "1e", "1e+", "1.e5", "0x10", "NaN", "Infinity", "-Infinity", "1 2" }) do
    rejected(text)
  end
end)

test("isInteger: whole numbers from -2^53 to 2^53", function()
  is_true(Json.isInteger(2))
  is_true(Json.isInteger(decode("2.0")))
  is_true(Json.isInteger(decode("2e0")))
  is_true(Json.isInteger(0))
  is_true(Json.isInteger(-9007199254740992))
  is_true(Json.isInteger(9007199254740992))
  eq(Json.isInteger(9007199254740994), false)
  eq(Json.isInteger(2.5), false)
  eq(Json.isInteger(decode("1e999")), false)
  eq(Json.isInteger(0 / 0), false)
  eq(Json.isInteger("2"), false)
  eq(Json.isInteger(true), false)
  eq(Json.isInteger(nil), false)
end)

-- JSON escapes in these tests are written with doubled backslashes inside quotes on purpose: a single backslash-u in
-- a source file can be turned into the character itself by tools, and then the test would test nothing (CI refuses
-- non-ASCII sources, which is how that would show).
test("string escapes, in either case", function()
  eq(decode([["\"\\\/\b\f\n\r\t"]]), '"\\/\b\f\n\r\t')
  eq(decode('"\\u00eb"'), "\195\171")
  eq(decode('"\\u00EB"'), "\195\171")
  eq(decode('"Zo\\u00eb \\u00c6rinwald"'), "Zo\195\171 \195\134rinwald")
  eq(decode('"\\u0041\\u007c\\u007F"'), "A|\127")
  eq(decode('"\\u0000"'), "\0")
  eq(decode('"\\u20ac"'), "\226\130\172")
end)

test("a surrogate pair is one character; a lone surrogate is an error", function()
  eq(decode('"\\ud83c\\udf89"'), "\240\159\142\137")
  eq(decode('"\\uD83C\\uDF89"'), "\240\159\142\137")
  eq(decode('"x\\ud83c\\udf89y"'), "x\240\159\142\137y")
  rejected('"\\ud83c"')
  rejected('"\\ud83cx"')
  rejected('"\\udf89"')
  rejected('"\\ud83c\\ud83c"')
  rejected('"\\ud83c\\u0041"')
  rejected('"\\ud83c\\udf8"')
end)

test("every UTF-8 length, at its boundaries (bytes from the Unicode table)", function()
  local cases = {
    { "0080", "\194\128" }, { "07ff", "\223\191" },
    { "0800", "\224\160\128" }, { "0fff", "\224\191\191" }, { "1000", "\225\128\128" }, { "4e2d", "\228\184\173" },
    { "d7ff", "\237\159\191" }, { "e000", "\238\128\128" }, { "fffd", "\239\191\189" }, { "ffff", "\239\191\191" },
  }
  for _, case in ipairs(cases) do
    eq(decode('"\\u' .. case[1] .. '"'), case[2])
  end
  -- four bytes are written as surrogate pairs (bytes from Python's UTF-8 encoder)
  local pairs4 = {
    { "\\ud800\\udc00", "\240\144\128\128" }, -- U+10000
    { "\\ud840\\udc00", "\240\160\128\128" }, -- U+20000
    { "\\ud83c\\udf89", "\240\159\142\137" }, -- U+1F389
    { "\\ud87f\\udfff", "\240\175\191\191" }, -- U+2FFFF
    { "\\ud8bf\\udfff", "\240\191\191\191" }, -- U+3FFFF
    { "\\ud8c0\\udc00", "\241\128\128\128" }, -- U+40000
    { "\\udbbf\\udfff", "\243\191\191\191" }, -- U+FFFFF
    { "\\udbc0\\udc00", "\244\128\128\128" }, -- U+100000
    { "\\udbff\\udfff", "\244\143\191\191" }, -- U+10FFFF
  }
  for _, case in ipairs(pairs4) do
    eq(decode('"' .. case[1] .. '"'), case[2])
  end
end)

test("bad escapes and control characters", function()
  rejected([["\x"]])
  rejected([["\u12"]])
  rejected([["\u12g4"]])
  rejected([["\U0041"]])
  rejected('"line\nbreak"')
  rejected('"tab\there"')
  rejected('"nul\0byte"')
  rejected('"\1"')
end)

test("raw non-ASCII bytes and DEL pass through", function()
  eq(decode('"Zo\195\171"'), "Zo\195\171")
  eq(decode('"\127"'), "\127")
  eq(decode('"\255"'), "\255")
end)

test("a string that is not closed", function()
  rejected('"abc')
  rejected('"abc\\')
  rejected('{"a":"x}')
  rejected('"')
end)

test("broken structure", function()
  for _, text in ipairs({
    "", "   ", "[", "]", "{", "}", "[1,]", "[,1]", "[1 2]", '{"a":1,}', '{"a" 1}', '{"a":}', '{1:2}', '{"a":1 "b":2}',
    '{"a":1}}', "[1]]", "tru", "truex", "nul", "falsey", "{'a':1}", '{"a":1}x', "1 2", "[1,2", '{"a":[1,2}',
  }) do
    rejected(text)
  end
end)

test("an error says where", function()
  local message = rejected('{"a":1,}')
  is_true(message:find("character 8", 1, true) ~= nil)
end)

test("not a string", function()
  local ok = Json.decode(nil)
  eq(ok, false)
  eq((Json.decode(12)), false)
end)

test("nesting up to the limit is fine, deeper is an error, and a huge depth does not crash", function()
  local limit = Json.MAX_DEPTH
  is_true(Json.isList(decode(string.rep("[", limit) .. string.rep("]", limit))))
  rejected(string.rep("[", limit + 1) .. string.rep("]", limit + 1))
  rejected(string.rep('{"a":', limit + 1) .. "1" .. string.rep("}", limit + 1))
  rejected(string.rep("[", 200000))
end)

test("a large document", function()
  local parts = {}
  for i = 1, 3000 do
    parts[i] = string.format('{"k":%d,"name":"Player %d","ok":true,"tags":["a","b\\u00eb"]}', i, i)
  end
  local list = decode("[" .. table.concat(parts, ",") .. "]")
  eq(#list, 3000)
  eq(list[3000].name, "Player 3000")
  eq(list[17].tags[2], "b\195\171")
end)

test("the fixture models decode to the same data as their strings", function()
  for _, name in ipairs({ "night-small", "night-empty", "awards-small" }) do
    local fromModel = decode(read_file(FIXTURES .. name .. ".model.json"))
    local text = read_file(FIXTURES .. name .. ".j.txt")
    local payload = text:match("^IM1:%a+:j:%d+:(.*):%x%x%x%x%x%x%x%x$")
    is_true(payload ~= nil)
    deep_eq(decode(payload), fromModel)
  end
end)

test("the awards fixture note decodes to the characters it escapes", function()
  local awards = decode(read_file(FIXTURES .. "awards-small.model.json")).awards
  eq(awards[3].note, 'Holding it: she logged off; trade tomorrow "after reset" \\ see |list| \240\159\142\137')
  eq(awards[4].note, "Won the roll\twith 97\127")
  eq(awards[3].to, "Zo\195\171 \195\134rinwald")
end)

test("the other fixture files decode (raw UTF-8 included)", function()
  is_true(Json.isList(decode(read_file(FIXTURES .. "cases/cases.json"))))
  is_true(Json.isList(decode(read_file(FIXTURES .. "marks-cases.json"))))
  is_true(Json.isList(decode(read_file(FIXTURES .. "crc32-vectors.json"))))
end)

test("the CRC-32 vectors file agrees with Crc32", function()
  local vectors = decode(read_file(FIXTURES .. "crc32-vectors.json"))
  is_true(#vectors >= 5)
  for _, vector in ipairs(vectors) do
    eq(Crc32.hex(vector.text), vector.crc32)
  end
end)
