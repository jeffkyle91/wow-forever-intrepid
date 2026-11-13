-- CRC-32 (the one in zlib and PNG): the checksum at the end of every exchange string.
-- Spec: docs/spec/exchange-v0.md, section 1. Pure Lua 5.1 with no client calls, so it runs in the unit tests.
--
-- Lua 5.1 has no bit operators. The client has the `bit` library (probe 0.5.5 found bit.bxor on the beta client,
-- on the Mac and on Windows). When it is there, the loop uses bit.bxor; otherwise it uses a slower xor written
-- in plain arithmetic. Shifts and masks are plain arithmetic either way, so bxor is the only bit operation needed.
--
-- bit.bxor returns signed 32-bit numbers (-1 for 0xFFFFFFFF). Every result is brought back into 0 .. 2^32 - 1 with
-- `% 2^32`, so the checksum is the same on every machine.

local _, ns = ...

local Crc32 = {}
ns.Crc32 = Crc32

local byte = string.byte

local MODULUS = 4294967296     -- 2^32
local POLYNOMIAL = 3988292384  -- 0xEDB88320, the reflected CRC-32 polynomial
local ALL_ONES = 4294967295    -- 0xFFFFFFFF

-- The xor without bit operations, for 0 <= a, b < 2^32 (whole numbers). It works a hex digit at a time.
local nibbleXor -- built on first use: nibbleXor[x * 16 + y] is x xor y for 0 <= x, y < 16

local function pureXor(a, b)
  if not nibbleXor then
    nibbleXor = {}
    for x = 0, 15 do
      for y = 0, 15 do
        local result, power, p, q = 0, 1, x, y
        for _ = 1, 4 do
          if p % 2 ~= q % 2 then result = result + power end
          p, q, power = (p - p % 2) / 2, (q - q % 2) / 2, power * 2
        end
        nibbleXor[x * 16 + y] = result
      end
    end
  end
  local result, power = 0, 1
  while a > 0 or b > 0 do
    local x, y = a % 16, b % 16
    result = result + nibbleXor[x * 16 + y] * power
    a, b, power = (a - x) / 16, (b - y) / 16, power * 16
  end
  return result
end

Crc32.pureXor = pureXor

-- A checksum function that uses `xor` (a function of two whole numbers below 2^32; it may return signed numbers).
-- Used with the real bit.bxor when the client has it, and by the tests with a stand-in.
function Crc32.make(xor)
  local table256 = {}
  for i = 0, 255 do
    local c = i
    for _ = 1, 8 do
      -- a signed xor must be brought back into 0 .. 2^32 - 1 before the next halving
      if c % 2 == 1 then c = xor((c - 1) / 2, POLYNOMIAL) % MODULUS else c = c / 2 end
    end
    table256[i] = c
  end
  return function(text)
    local crc = ALL_ONES
    for i = 1, #text do
      local index = xor(crc % 256, byte(text, i))
      crc = xor(table256[index], (crc - crc % 256) / 256) % MODULUS
    end
    return xor(crc, ALL_ONES) % MODULUS
  end
end

-- Which xor this client uses: "bit" (the client's library) or "pure" (the fallback).
Crc32.backend = "pure"
local xor = pureXor
if type(bit) == "table" and type(bit.bxor) == "function" then
  Crc32.backend = "bit"
  xor = bit.bxor
end

local compute = Crc32.make(xor)

-- The checksum of a string of bytes, as a whole number from 0 to 2^32 - 1.
function Crc32.compute(text)
  return compute(text)
end

-- The checksum as 8 lowercase hex digits. "%x" passes through a C long, which is 32 bits on Windows, so the number is
-- written as two halves.
function Crc32.hex(text)
  local crc = compute(text)
  return string.format("%04x%04x", math.floor(crc / 65536), crc % 65536)
end
