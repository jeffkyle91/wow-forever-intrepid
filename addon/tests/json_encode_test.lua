-- JSON writer (docs/spec/exchange-v0.md, section 3, "Producers"). Invented names only. See AGENTS.md.
local ns = load_core({}, "Json")
local Json = ns.Json

local FIXTURES = SPEC .. "fixtures/"

local function decode(text)
  local ok, value = Json.decode(text)
  if not ok then error("decode failed: " .. tostring(value), 2) end
  return value
end

local function fails(fn)
  local ok, message = pcall(fn)
  if ok then error("expected an error", 2) end
  return message
end

-- A one-field object, to look at how a string is written.
local ONE = Json.object({ "s" })
local function written(text) return Json.encode({ s = text }, ONE) end

-- The field lists of the spec (docs/spec/exchange-v0.md sections 5 and 6), in canonical order.
local KNOWN = Json.object({ "id", "rev" })
local PLAYER = Json.object({ "k", "id", "name", "surname", "class", "role", "main", "locked" })
local BOSS = Json.object({ "npcId", "name", "zoneId" })
local LINE = Json.object({ "k", "name", "text", "awarded", "done" })
local PRIORITY = Json.object({ "id", "item", "itemId", "encounter", "npcId", "zoneId", "note", "lines" },
  { lines = Json.listOf(LINE) })
local NIGHT = Json.object({ "schema", "id", "at", "by", "phase", "raid", "known", "roster", "bosses", "priorities" }, {
  raid = Json.object({ "id", "date", "name", "size" }),
  known = Json.listOf(KNOWN),
  roster = Json.listOf(PLAYER),
  bosses = Json.listOf(BOSS),
  priorities = Json.listOf(PRIORITY),
})
local DELIVERY = Json.object({ "state", "at", "how" })
local AWARD = Json.object({ "id", "rev", "session", "at", "date", "phase", "raid", "itemId", "item", "toId", "to",
  "pseudo", "decision", "priority", "encounter", "npcId", "zoneId", "note", "delivery", "status" },
  { delivery = DELIVERY })
local AWARDS = Json.object({ "schema", "id", "at", "by", "awards" }, { awards = Json.listOf(AWARD) })

test("fields are written in the shape's order, not the table's", function()
  local shape = Json.object({ "b", "a", "c" })
  eq(Json.encode({ a = 1, b = 2, c = 3 }, shape), '{"b":2,"a":1,"c":3}')
end)

test("absent and false fields are left out, true is written", function()
  local shape = Json.object({ "a", "b", "c", "d" })
  eq(Json.encode({ a = 1, b = false, d = true }, shape), '{"a":1,"d":true}')
  eq(Json.encode({}, shape), "{}")
end)

test("lists and nested objects follow their shapes, and an empty list is []", function()
  local shape = Json.object({ "items", "none", "one" }, {
    items = Json.listOf(Json.object({ "x" })),
    none = Json.listOf(Json.object({ "x" })),
    one = Json.object({ "y" }),
  })
  eq(Json.encode({ items = { { x = 1 }, { x = 2 } }, none = {}, one = { y = "z" } }, shape),
    '{"items":[{"x":1},{"x":2}],"none":[],"one":{"y":"z"}}')
  eq(Json.encode({ 1, "a", true }, Json.listOf()), '[1,"a",true]')
  eq(Json.encode({}, Json.listOf()), "[]")
end)

test("whole numbers are written without a fraction or an exponent", function()
  local shape = Json.object({ "n" })
  eq(Json.encode({ n = 0 }, shape), '{"n":0}')
  -- a real negative zero (a literal -0 is folded into the constant 0, so it has to come from the reader)
  local negativeZero = decode("-0")
  eq(string.format("%.0f", negativeZero), "-0")
  eq(Json.encode({ n = negativeZero }, shape), '{"n":0}')
  eq(Json.encode({ n = -5 }, shape), '{"n":-5}')
  eq(Json.encode({ n = 1796866530 }, shape), '{"n":1796866530}')
  eq(Json.encode({ n = 100000000000000 }, shape), '{"n":100000000000000}')
  eq(Json.encode({ n = 1e15 }, shape), '{"n":1000000000000000}')
  eq(Json.encode({ n = 9007199254740992 }, shape), '{"n":9007199254740992}')
  eq(Json.encode({ n = 2.0 }, shape), '{"n":2}')
end)

test("numbers that are not whole are bugs in the caller", function()
  local shape = Json.object({ "n" })
  for _, bad in ipairs({ 2.5, 0 / 0, 1 / 0, -1 / 0, 9007199254740994 }) do
    fails(function() Json.encode({ n = bad }, shape) end)
  end
end)

test("a forgotten field, a missing shape and an unwritable value are bugs in the caller", function()
  local shape = Json.object({ "a" })
  local message = fails(function() Json.encode({ a = 1, forgotten = 2 }, shape) end)
  is_true(message:find("forgotten", 1, true) ~= nil)
  fails(function() Json.encode({ a = { 1 } }, shape) end)
  fails(function() Json.encode({ a = print }, shape) end)
  -- a list shape given a table that is not a plain list would otherwise write [] and drop the data
  fails(function() Json.encode({ a = 1 }, Json.listOf()) end)
  fails(function() Json.encode({ 1, 2, x = 3 }, Json.listOf()) end)
  fails(function() Json.encode({ [1] = "a", [3] = "c" }, Json.listOf()) end)
end)

test("short escapes, \\u00xx, DEL and the pipe", function()
  eq(written('say "hi"'), '{"s":"say \\"hi\\""}')
  eq(written("back\\slash"), '{"s":"back\\\\slash"}')
  eq(written("\b\f\n\r\t"), '{"s":"\\b\\f\\n\\r\\t"}')
  eq(written("\0\1\31"), '{"s":"\\u0000\\u0001\\u001f"}')
  eq(written("\127"), '{"s":"\\u007f"}')
  eq(written("a|b||c"), '{"s":"a\\u007cb\\u007c\\u007cc"}')
end)

test("plain ASCII is written as it is, including / and the characters next to the escaped ones", function()
  local plain = " !#$%&'()*+,-./0123456789:;<=>?@AZ[]^_`az{}~"
  eq(written(plain), '{"s":"' .. plain .. '"}')
  eq(written(""), '{"s":""}')
  eq(written("a/b"), '{"s":"a/b"}')
end)

test("non-ASCII is written as lowercase \\uxxxx, above U+FFFF as a surrogate pair", function()
  eq(written("Zo\195\171 \195\134rinwald"), '{"s":"Zo\\u00eb \\u00c6rinwald"}')
  eq(written("\226\130\172"), '{"s":"\\u20ac"}')
  eq(written("\240\159\142\137"), '{"s":"\\ud83c\\udf89"}')
  eq(written("x\240\144\128\128y"), '{"s":"x\\ud800\\udc00y"}')
  eq(written("\244\143\191\191"), '{"s":"\\udbff\\udfff"}')
  eq(written("\239\191\191"), '{"s":"\\uffff"}')
end)

test("bytes that are not well-formed UTF-8 become U+FFFD, one per byte, and never raise", function()
  eq(written("\128"), '{"s":"\\ufffd"}')              -- a stray continuation byte
  eq(written("\255"), '{"s":"\\ufffd"}')              -- not a UTF-8 byte at all
  eq(written("\195"), '{"s":"\\ufffd"}')              -- cut off
  eq(written("a\226\130"), '{"s":"a\\ufffd\\ufffd"}') -- a 3-byte character cut off
  eq(written("\192\128"), '{"s":"\\ufffd\\ufffd"}')   -- overlong NUL
  eq(written("\224\128\128"), '{"s":"\\ufffd\\ufffd\\ufffd"}') -- overlong
  eq(written("\237\160\128"), '{"s":"\\ufffd\\ufffd\\ufffd"}') -- a UTF-16 surrogate written in UTF-8
  eq(written("\244\144\128\128"), '{"s":"\\ufffd\\ufffd\\ufffd\\ufffd"}') -- above U+10FFFF
  eq(written("\240\128\128\128"), '{"s":"\\ufffd\\ufffd\\ufffd\\ufffd"}') -- overlong 4-byte NUL
  eq(written("\240\143\191\191"), '{"s":"\\ufffd\\ufffd\\ufffd\\ufffd"}') -- overlong 4-byte U+FFFF
  eq(written("\245\128\128\128"), '{"s":"\\ufffd\\ufffd\\ufffd\\ufffd"}') -- F5 starts nothing
  eq(written("\195\171\128"), '{"s":"\\u00eb\\ufffd"}')
end)

test("the output is ASCII, free of | and DEL, and the reader gives the text back", function()
  local texts = {
    "plain", "", "Zo\195\171 \195\134rinwald", 'quote " and \\ and / and |', "\1\2\3\31 \127", "tab\there\nline",
    "\240\159\142\137 party \226\130\172", "\0inside", string.rep("long text, ", 2000),
  }
  for _, text in ipairs(texts) do
    local out = written(text)
    eq(out:find("[^ -~]"), nil)
    eq(out:find("|", 1, true), nil)
    eq(decode(out).s, text)
  end
end)

test("every code point survives a trip through the writer and the reader", function()
  -- all code points that are not surrogates, in steps, plus the edges of every UTF-8 length
  local function utf8(code)
    if code < 0x80 then return string.char(code) end
    if code < 0x800 then return string.char(0xC0 + math.floor(code / 0x40), 0x80 + code % 0x40) end
    if code < 0x10000 then
      return string.char(0xE0 + math.floor(code / 0x1000), 0x80 + math.floor(code / 0x40) % 0x40, 0x80 + code % 0x40)
    end
    return string.char(0xF0 + math.floor(code / 0x40000), 0x80 + math.floor(code / 0x1000) % 0x40,
      0x80 + math.floor(code / 0x40) % 0x40, 0x80 + code % 0x40)
  end
  local edges = { 0, 0x1F, 0x20, 0x7E, 0x7F, 0x80, 0x7FF, 0x800, 0xD7FF, 0xE000, 0xFFFF, 0x10000, 0x10FFFF }
  local function check(code)
    local text = utf8(code)
    eq(decode(written(text)).s, text)
  end
  for _, code in ipairs(edges) do check(code) end
  for code = 0x80, 0x10FFFF, 331 do
    if code < 0xD800 or code > 0xDFFF then check(code) end
  end
end)

test("the writer's escape for a code point matches the definition", function()
  local function expected(code)
    if code <= 0xFFFF then return string.format("\\u%04x", code) end
    local v = code - 0x10000
    return string.format("\\u%04x\\u%04x", 0xD800 + math.floor(v / 0x400), 0xDC00 + v % 0x400)
  end
  local samples = { 0xA0, 0xFF, 0x100, 0x3A9, 0x2028, 0xFFFD, 0x10000, 0x1F389, 0x2F800, 0x10FFFF }
  for _, code in ipairs(samples) do
    local text = (code < 0x800) and string.char(0xC0 + math.floor(code / 0x40), 0x80 + code % 0x40) or nil
    if code >= 0x800 and code < 0x10000 then
      text = string.char(0xE0 + math.floor(code / 0x1000), 0x80 + math.floor(code / 0x40) % 0x40, 0x80 + code % 0x40)
    elseif code >= 0x10000 then
      text = string.char(0xF0 + math.floor(code / 0x40000), 0x80 + math.floor(code / 0x1000) % 0x40,
        0x80 + math.floor(code / 0x40) % 0x40, 0x80 + code % 0x40)
    end
    eq(written(text), '{"s":"' .. expected(code) .. '"}')
  end
end)

local function payloadOf(name)
  local text = read_file(FIXTURES .. name .. ".j.txt")
  return (text:match("^IM1:%a+:j:%d+:(.*):%x%x%x%x%x%x%x%x$"))
end

test("the awards fixture is written byte for byte (quotes, backslash, |, DEL, tab and an emoji included)", function()
  local model = decode(read_file(FIXTURES .. "awards-small.model.json"))
  local payload = payloadOf("awards-small")
  eq(Json.encode(model, AWARDS), payload)
end)

test("the night fixtures are written byte for byte too", function()
  for _, name in ipairs({ "night-small", "night-empty" }) do
    local model = decode(read_file(FIXTURES .. name .. ".model.json"))
    eq(Json.encode(model, NIGHT), payloadOf(name))
  end
end)

test("written text reads back as the same data", function()
  local model = decode(read_file(FIXTURES .. "awards-small.model.json"))
  deep_eq(decode(Json.encode(model, AWARDS)), model)
end)
