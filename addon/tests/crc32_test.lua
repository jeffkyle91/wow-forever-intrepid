-- CRC-32 (docs/spec/exchange-v0.md, section 1). The expected values come from Python's zlib, an independent implementation.
local ns = load_core({}, "Crc32")
local Crc32 = ns.Crc32

local function hex(crc) return string.format("%04x%04x", math.floor(crc / 65536), crc % 65536) end

-- A stand-in for the client's bit.bxor: the same answers, but signed 32-bit like the real library (so any result
-- with the top bit set comes back negative).
local function signedXor(a, b)
  local r = Crc32.pureXor(a, b)
  if r >= 2147483648 then r = r - 4294967296 end
  return r
end

local VECTORS = {
  { "", "00000000" },
  { "a", "e8b7be43" },
  { "123456789", "cbf43926" },
  { "The quick brown fox jumps over the lazy dog", "414fa339" },
  { string.rep("\0", 1000), "060b1780" },
  { string.rep("\255", 1000), "e0533230" },
  { string.rep("The quick brown fox jumps over the lazy dog ", 800), "0ba3130f" },
}

test("hex checksums of known texts", function()
  for _, vector in ipairs(VECTORS) do
    eq(Crc32.hex(vector[1]), vector[2])
  end
end)

test("all 256 byte values", function()
  local all = {}
  for i = 0, 255 do all[#all + 1] = string.char(i) end
  eq(Crc32.hex(table.concat(all)), "29058c73")
end)

test("the checksum is a whole number from 0 to 2^32 - 1, and hex pads to 8 digits", function()
  local crc = Crc32.compute("a")
  eq(crc, 0xE8B7BE43)
  eq(Crc32.compute(""), 0)
  eq(Crc32.hex(""), "00000000")
  eq(#Crc32.hex("a"), 8)
end)

test("without the bit library the pure xor is used", function()
  eq(Crc32.backend, "pure")
end)

test("pure xor agrees with the definition on edge values", function()
  local x = Crc32.pureXor
  eq(x(0, 0), 0)
  eq(x(1, 0), 1)
  eq(x(0, 4294967295), 4294967295)
  eq(x(4294967295, 4294967295), 0)
  eq(x(2147483648, 1), 2147483649)
  eq(x(0x12345678, 0x9abcdef0), 0x88888888)
  eq(x(3988292384, 4294967295), 306674911)
end)

test("a signed bit.bxor gives the same checksums as the pure xor", function()
  local viaBit = Crc32.make(signedXor)
  for _, vector in ipairs(VECTORS) do
    eq(hex(viaBit(vector[1])), vector[2])
  end
  -- checksums with the top bit set are the ones a signed result would break
  eq(viaBit("a"), 0xE8B7BE43)
  eq(viaBit("123456789"), 0xCBF43926)
end)

test("the pure and signed paths agree on random texts", function()
  local viaBit = Crc32.make(signedXor)
  math.randomseed(20261019)
  for length = 0, 300, 7 do
    local chars = {}
    for i = 1, length do chars[i] = string.char(math.random(0, 255)) end
    local text = table.concat(chars)
    eq(viaBit(text), Crc32.compute(text))
  end
end)
