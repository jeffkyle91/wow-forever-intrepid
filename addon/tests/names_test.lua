-- Invented names only. See AGENTS.md.
local ns = load_addon_file("IntrepidManager/core/Names.lua")
local Names = ns.Names

test("normalize lowercases and collapses spaces", function()
  eq(Names.normalize("  Jorren   ASHVALE "), "jorren ashvale")
end)

test("a first name alone is not a full name", function()
  eq(Names.normalize("Jorren"), nil)
  eq(Names.same("Jorren", "Jorren"), false)
end)

test("non-strings are rejected", function()
  eq(Names.normalize(nil), nil)
  eq(Names.normalize(42), nil)
end)

test("same ignores case and spacing, not the surname", function()
  is_true(Names.same("Jorren Ashvale", "jorren  ashvale"))
  eq(Names.same("Jorren Ashvale", "Jorren Thornwick"), false)
end)

-- The matching rule of docs/spec/exchange-v0.md, section 2 ---------------------------------------------------------

local AE = "\195\134" -- the capital A with E written as one letter, as UTF-8 bytes
local ae = "\195\166" -- the lowercase one

test("key trims and collapses ASCII spaces only", function()
  eq(Names.key("  Jorren   ASHVALE "), "jorren ashvale")
  eq(Names.key("Jorren"), "jorren") -- one word is a key too (a name-only line, an award's recipient)
  eq(Names.key(""), "")
  eq(Names.key("     "), "")
  eq(Names.key("a  b   c"), "a b c")
  eq(Names.key("\t Jorren \t"), "\t jorren \t") -- a tab is text, not a space
  eq(Names.key("Jorren\194\160Ashvale"), "jorren\194\160ashvale") -- so is a no-break space
  eq(Names.key("a\nb"), "a\nb")
end)

test("key lowercases the letters A to Z and nothing else", function()
  eq(Names.key("ABCDEFGHIJKLMNOPQRSTUVWXYZ"), "abcdefghijklmnopqrstuvwxyz")
  eq(Names.key("abcxyz 0123456789 -'.@[`{"), "abcxyz 0123456789 -'.@[`{")
  eq(Names.key(AE .. "RINWALD Test"), AE .. "rinwald test") -- the non-ASCII capital stays, the ASCII ones change
  eq(Names.key(ae .. "RINWALD"), ae .. "rinwald")
end)

test("key is not fooled by the locale", function()
  -- In a Latin-1 locale the C function tolower changes the byte 195 of a UTF-8 letter. The key must not.
  local before = os.setlocale(nil)
  if os.setlocale("en_US.ISO8859-1") or os.setlocale("en_US.ISO-8859-1") or os.setlocale("de_DE.ISO8859-1") then
    local ok, err = pcall(function()
      eq(Names.key(AE .. "RINWALD"), AE .. "rinwald")
      eq(Names.key("\195\128\195\137 Test"), "\195\128\195\137 test")
    end)
    os.setlocale(before)
    if not ok then error(err, 0) end
  end
  os.setlocale(before)
end)

test("key of something that is not a string is nil", function()
  eq(Names.key(nil), nil)
  eq(Names.key(42), nil)
  eq(Names.key(true), nil)
  eq(Names.key({}), nil)
end)

test("normalize is the key of a full name, and nil for a single word", function()
  eq(Names.normalize("Jorren Ashvale"), "jorren ashvale")
  eq(Names.normalize("  jorren   ASHVALE "), "jorren ashvale")
  eq(Names.normalize("Jorren"), nil)
  eq(Names.normalize(""), nil)
  eq(Names.normalize("   "), nil)
  eq(Names.normalize("Jorren\tAshvale"), nil) -- a tab does not separate the words
  eq(Names.normalize("Jorren\194\160Ashvale"), nil) -- nor does a no-break space
end)

test("non-ASCII letters must match exactly, case included", function()
  is_true(Names.same(AE .. "rinwald Test", AE .. "RINWALD test"))
  eq(Names.same(AE .. "rinwald Test", ae .. "rinwald Test"), false)
  eq(Names.same("Zo\195\171 Test", "Zo\195\139 Test"), false)
  is_true(Names.same("Zo\195\171 Test", "ZO\195\171 TEST"))
end)
