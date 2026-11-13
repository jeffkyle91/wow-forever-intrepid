-- JSON for the exchange strings (docs/spec/exchange-v0.md, section 3). Pure Lua 5.1 with no client calls.
--
-- Json.decode(text) reads what JSON.parse reads (RFC 8259) and applies the reader rules of the spec:
--   * null or false as the value of an object field is the same as leaving the field out, and when a key repeats the
--     last value wins (so a later null or false removes an earlier value);
--   * null inside a list is an error; false inside a list is kept;
--   * an escaped surrogate without its partner is an error (a Lua string cannot carry one);
--   * lists are marked (Json.isList) so that [] and {} stay different, which a Lua table cannot say by itself;
--   * nesting deeper than Json.MAX_DEPTH is an error (the real strings nest 5 deep);
--   * numbers are read as Lua numbers; Json.isInteger says whether one is a whole number in the range the spec allows.
-- Strings come back as UTF-8 bytes.
--
-- Json.encode(value, shape) is the writer for the strings the addon makes (see below).

local _, ns = ...

local Json = {}
ns.Json = Json

local find, sub, byte, char, format = string.find, string.sub, string.byte, string.char, string.format
local concat = table.concat
local floor = math.floor

Json.MAX_DEPTH = 16

-- Lists carry this metatable. Objects are plain tables.
local LIST = {}

function Json.isList(value)
  return getmetatable(value) == LIST
end

-- A list holding `items` (a new empty list when there are none).
function Json.list(items)
  return setmetatable(items or {}, LIST)
end

-- Whether `value` is a whole number from -2^53 to 2^53 (so 2, 2.0 and 2e0 are, and 2.5 is not).
function Json.isInteger(value)
  return type(value) == "number" and value == floor(value) and value >= -9007199254740992 and value <= 9007199254740992
end

---------------------------------------------------------------------------------------------------------------
-- Reading
---------------------------------------------------------------------------------------------------------------

-- Errors raised for bad input carry this metatable, so a bug in this file is never mistaken for bad input.
local FAILURE = {}

local function fail(message, pos)
  error(setmetatable({ message = message, pos = pos }, FAILURE), 0)
end

-- The UTF-8 bytes of a code point from 0 to 0x10FFFF that is not a surrogate.
local function utf8char(code)
  if code < 0x80 then
    return char(code)
  elseif code < 0x800 then
    return char(0xC0 + floor(code / 0x40), 0x80 + code % 0x40)
  elseif code < 0x10000 then
    return char(0xE0 + floor(code / 0x1000), 0x80 + floor(code / 0x40) % 0x40, 0x80 + code % 0x40)
  end
  return char(0xF0 + floor(code / 0x40000), 0x80 + floor(code / 0x1000) % 0x40, 0x80 + floor(code / 0x40) % 0x40,
    0x80 + code % 0x40)
end

local ESCAPES = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }

-- The characters that end a run of plain string content: the closing quote, a backslash, and a control character.
local STRING_STOP = '["\\%z\1-\31]'

local function skipSpace(text, pos)
  local _, last = find(text, "^[ \t\r\n]*", pos)
  return last + 1
end

-- `pos` is at the opening quote. Returns the string and the position after the closing quote.
local function parseString(text, pos)
  local start = pos + 1
  local stop = find(text, STRING_STOP, start)
  if not stop then fail("the string is not closed", pos) end
  if byte(text, stop) == 34 then return sub(text, start, stop - 1), stop + 1 end -- no escapes: the usual case

  local pieces, count, from = {}, 0, start
  while true do
    if stop > from then
      count = count + 1
      pieces[count] = sub(text, from, stop - 1)
    end
    local c = byte(text, stop)
    if c == 34 then
      return concat(pieces), stop + 1
    elseif c == 92 then
      local letter = sub(text, stop + 1, stop + 1)
      if ESCAPES[letter] then
        count = count + 1
        pieces[count] = ESCAPES[letter]
        from = stop + 2
      elseif letter == "u" then
        local digits = sub(text, stop + 2, stop + 5)
        if not find(digits, "^%x%x%x%x$") then fail("bad \\u escape", stop) end
        local code = tonumber(digits, 16)
        from = stop + 6
        if code >= 0xD800 and code <= 0xDBFF then
          local pair = sub(text, from, from + 5)
          if not find(pair, "^\\u[dD][c-fC-F]%x%x$") then fail("a high surrogate without its partner", stop) end
          code = 0x10000 + (code - 0xD800) * 0x400 + (tonumber(sub(pair, 3), 16) - 0xDC00)
          from = from + 6
        elseif code >= 0xDC00 and code <= 0xDFFF then
          fail("a low surrogate without its partner", stop)
        end
        count = count + 1
        pieces[count] = utf8char(code)
      else
        fail("bad escape", stop)
      end
    else
      fail("a control character in a string", stop)
    end
    stop = find(text, STRING_STOP, from)
    if not stop then fail("the string is not closed", pos) end
  end
end

-- `pos` is at the first character of the number. Returns the number and the position after it.
local function parseNumber(text, pos)
  local _, last = find(text, "^-?%d+", pos)
  if not last then fail("bad number", pos) end
  local digits = byte(text, pos) == 45 and pos + 1 or pos
  if byte(text, digits) == 48 and last > digits then fail("a number with a leading zero", pos) end
  -- A "." or "e" that is not followed by digits is left in the text, where the caller refuses it.
  local _, fraction = find(text, "^%.%d+", last + 1)
  if fraction then last = fraction end
  local _, exponent = find(text, "^[eE][+-]?%d+", last + 1)
  if exponent then last = exponent end
  return tonumber(sub(text, pos, last)), last + 1
end

local parseValue

-- `depth` is the number of lists and objects already open around this one.
local function parseList(text, pos, depth)
  if depth >= Json.MAX_DEPTH then fail("nested too deeply", pos) end
  local list, count = setmetatable({}, LIST), 0
  pos = skipSpace(text, pos + 1)
  if byte(text, pos) == 93 then return list, pos + 1 end
  while true do
    local value
    value, pos = parseValue(text, pos, depth + 1)
    if value == nil then fail("null in a list", pos - 4) end
    count = count + 1
    list[count] = value
    pos = skipSpace(text, pos)
    local c = byte(text, pos)
    if c == 44 then
      pos = skipSpace(text, pos + 1)
    elseif c == 93 then
      return list, pos + 1
    else
      fail("expected , or ]", pos)
    end
  end
end

local function parseObject(text, pos, depth)
  if depth >= Json.MAX_DEPTH then fail("nested too deeply", pos) end
  local object = {}
  pos = skipSpace(text, pos + 1)
  if byte(text, pos) == 125 then return object, pos + 1 end
  while true do
    if byte(text, pos) ~= 34 then fail("expected a string as the field name", pos) end
    local key
    key, pos = parseString(text, pos)
    pos = skipSpace(text, pos)
    if byte(text, pos) ~= 58 then fail("expected :", pos) end
    pos = skipSpace(text, pos + 1)
    local value
    value, pos = parseValue(text, pos, depth + 1)
    if value == false then value = nil end
    object[key] = value -- null and false remove an earlier value of the same key: the last one wins
    pos = skipSpace(text, pos)
    local c = byte(text, pos)
    if c == 44 then
      pos = skipSpace(text, pos + 1)
    elseif c == 125 then
      return object, pos + 1
    else
      fail("expected , or }", pos)
    end
  end
end

-- Returns the value (nil for null) and the position after it.
function parseValue(text, pos, depth)
  local c = byte(text, pos)
  if c == 34 then
    return parseString(text, pos)
  elseif c == 123 then
    return parseObject(text, pos, depth)
  elseif c == 91 then
    return parseList(text, pos, depth)
  elseif c == 45 or (c and c >= 48 and c <= 57) then
    return parseNumber(text, pos)
  elseif sub(text, pos, pos + 3) == "true" then
    return true, pos + 4
  elseif sub(text, pos, pos + 4) == "false" then
    return false, pos + 5
  elseif sub(text, pos, pos + 3) == "null" then
    return nil, pos + 4
  end
  fail(c and "unexpected character" or "unexpected end of text", pos)
end

local function parseDocument(text)
  local value, pos = parseValue(text, skipSpace(text, 1), 0)
  pos = skipSpace(text, pos)
  if pos <= #text then fail("unexpected text after the value", pos) end
  return value
end

-- Returns true and the value (nil for a top-level null), or false and a message that says where it went wrong.
-- Only bad input is reported this way; a bug in this file raises an error.
function Json.decode(text)
  if type(text) ~= "string" then return false, "not a string" end
  local ok, result = pcall(parseDocument, text)
  if ok then return true, result end
  if type(result) == "table" and getmetatable(result) == FAILURE then
    return false, result.message .. " (character " .. format("%.0f", result.pos) .. ")"
  end
  error(result, 0)
end

---------------------------------------------------------------------------------------------------------------
-- Writing (spec section 3, "Producers")
---------------------------------------------------------------------------------------------------------------
-- The output has no spaces, uses ASCII only, writes fields in the order the spec lists them, writes whole numbers
-- without a fraction or an exponent, leaves out absent values, and writes a boolean only when it is true.
--
-- A Lua table cannot say whether it is a list or an object, or in which order its fields go, so the writer is told:
--   Json.object(fields, children)  an object. `fields` are its field names in the order to write them;
--                                  `children` maps a field name to the shape of that field's value (none for a
--                                  string, a whole number or true).
--   Json.listOf(items)             a list whose items have the shape `items` (none for plain values).
-- A table that has a field the shape does not list is a bug in the caller and raises an error, so a forgotten field
-- is never dropped quietly.

function Json.object(fields, children)
  local known = {}
  for _, name in ipairs(fields) do known[name] = true end
  return { kind = "object", fields = fields, children = children or {}, known = known }
end

function Json.listOf(items)
  return { kind = "list", items = items }
end

-- Short escapes; every other control character is written as \u00xx.
local SHORT = { [8] = "\\b", [9] = "\\t", [10] = "\\n", [12] = "\\f", [13] = "\\r", [34] = '\\"', [92] = "\\\\" }

-- Bytes that cannot be written as they are: control characters, ", \, | (the game reads it as the start of an
-- escape code), DEL and everything that is not ASCII.
local NEEDS_ESCAPE = '[%z\1-\31"\\|\127-\255]'

-- The code point that starts at byte `at` of `text`, and how many bytes it takes; nil when the bytes there are not
-- well-formed UTF-8 (a stray continuation byte, a cut-off or overlong sequence, a surrogate, a value above U+10FFFF).
local function readUtf8(text, at)
  local b1 = byte(text, at)
  local b2, b3, b4 = byte(text, at + 1, at + 3)
  if b1 >= 0xC2 and b1 <= 0xDF then
    if b2 and b2 >= 0x80 and b2 <= 0xBF then
      return (b1 - 0xC0) * 0x40 + (b2 - 0x80), 2
    end
  elseif b1 >= 0xE0 and b1 <= 0xEF then
    local lowest = b1 == 0xE0 and 0xA0 or 0x80  -- E0 80..9F would be an overlong form
    local highest = b1 == 0xED and 0x9F or 0xBF -- ED A0..BF would be a surrogate
    if b2 and b2 >= lowest and b2 <= highest and b3 and b3 >= 0x80 and b3 <= 0xBF then
      return (b1 - 0xE0) * 0x1000 + (b2 - 0x80) * 0x40 + (b3 - 0x80), 3
    end
  elseif b1 >= 0xF0 and b1 <= 0xF4 then
    local lowest = b1 == 0xF0 and 0x90 or 0x80  -- F0 80..8F would be an overlong form
    local highest = b1 == 0xF4 and 0x8F or 0xBF -- F4 90.. would be above U+10FFFF
    if b2 and b2 >= lowest and b2 <= highest and b3 and b3 >= 0x80 and b3 <= 0xBF and b4 and b4 >= 0x80 and b4 <= 0xBF then
      return (b1 - 0xF0) * 0x40000 + (b2 - 0x80) * 0x1000 + (b3 - 0x80) * 0x40 + (b4 - 0x80), 4
    end
  end
  return nil
end

-- \uXXXX for a code point, as a surrogate pair above U+FFFF. Lowercase hex.
local function escapeCode(code)
  if code <= 0xFFFF then return format("\\u%04x", code) end
  local v = code - 0x10000
  return format("\\u%04x\\u%04x", 0xD800 + floor(v / 0x400), 0xDC00 + v % 0x400)
end

-- A JSON string literal. Bytes that are not well-formed UTF-8 (the game should never give any) become U+FFFD.
local function quote(text)
  if not find(text, NEEDS_ESCAPE) then return '"' .. text .. '"' end
  local out, count, from = { '"' }, 1, 1
  while true do
    local at = find(text, NEEDS_ESCAPE, from)
    if not at then break end
    if at > from then
      count = count + 1
      out[count] = sub(text, from, at - 1)
    end
    local b = byte(text, at)
    count = count + 1
    if b < 128 then
      out[count] = SHORT[b] or format("\\u%04x", b)
      from = at + 1
    else
      local code, size = readUtf8(text, at)
      if code then
        out[count] = escapeCode(code)
        from = at + size
      else
        out[count] = "\\ufffd"
        from = at + 1
      end
    end
  end
  if from <= #text then
    count = count + 1
    out[count] = sub(text, from)
  end
  out[count + 1] = '"'
  return concat(out)
end

local function write(out, value, shape, path)
  local kind = type(value)
  if kind == "string" then
    out[#out + 1] = quote(value)
  elseif kind == "number" then
    if not Json.isInteger(value) then error(path .. ": " .. tostring(value) .. " is not a whole number", 0) end
    out[#out + 1] = value == 0 and "0" or format("%.0f", value)
  elseif kind == "boolean" then
    out[#out + 1] = value and "true" or "false" -- an object field that is false is left out before it gets here
  elseif kind == "table" then
    if not shape then error(path .. ": a table needs a shape", 0) end
    if shape.kind == "list" then
      local count = 0
      for _ in pairs(value) do count = count + 1 end
      if count ~= #value then error(path .. ": not a plain list", 0) end
      out[#out + 1] = "["
      for i = 1, #value do
        if i > 1 then out[#out + 1] = "," end
        write(out, value[i], shape.items, path .. "[" .. i .. "]")
      end
      out[#out + 1] = "]"
    else
      for key in pairs(value) do
        if not shape.known[key] then error(path .. ": the shape has no field " .. tostring(key), 0) end
      end
      out[#out + 1] = "{"
      local first = true
      for _, name in ipairs(shape.fields) do
        local field = value[name]
        if field ~= nil and field ~= false then
          if not first then out[#out + 1] = "," end
          first = false
          out[#out + 1] = quote(name) .. ":"
          write(out, field, shape.children[name], path .. "." .. name)
        end
      end
      out[#out + 1] = "}"
    end
  else
    error(path .. ": cannot write a " .. kind, 0)
  end
end

-- The JSON text for `value`, written as `shape` says. Raises an error for a value that cannot be written (that is a
-- bug in the caller, not bad input).
function Json.encode(value, shape)
  local out = {}
  write(out, value, shape, "value")
  return concat(out)
end
