-- The checks the night and awards content checks share (IntrepidManager/core/Check.lua). Invented names only. See AGENTS.md.
local ns = load_core({}, "Crc32", "Json", "Envelope", "Check")
local Check, Json = ns.Check, ns.Json

local E = "\195\169" -- a letter of two bytes
local EURO = "\226\130\172" -- a character of three bytes
local FACE = "\240\159\152\128" -- a character of four bytes

test("code points are counted, not bytes", function()
  eq(Check.codePoints(""), 0)
  eq(Check.codePoints("abc"), 3)
  eq(Check.codePoints("caf" .. E), 4)
  eq(Check.codePoints(EURO), 1)
  eq(Check.codePoints(FACE), 1)
  eq(Check.codePoints("a" .. E .. EURO .. FACE), 4)
end)

test("text may be as long as the limit and no longer, counted in code points", function()
  is_true(Check.isText(string.rep("a", 60), 60, true))
  eq(Check.isText(string.rep("a", 61), 60, true), false)
  is_true(Check.isText(string.rep(E, 60), 60, true)) -- 120 bytes, 60 code points
  eq(Check.isText(string.rep(E, 61), 60, true), false)
  is_true(Check.isText(string.rep(FACE, 5), 5, true))
  eq(Check.isText(string.rep(FACE, 6), 5, true), false)
  is_true(Check.isText(string.rep("a", 59) .. E, 60, true))
  is_true(Check.isText(string.rep("a", 500), 500, false))
  eq(Check.isText(string.rep("a", 501), 500, false), false)
end)

test("a NUL is never text", function()
  eq(Check.isText("a\0b", 60, true), false)
  eq(Check.isText("a\0b", 60, false), false)
  eq(Check.isText("\0", 60, false), false)
end)

test("blank means empty once ASCII spaces are taken off", function()
  eq(Check.isText("", 60, true), false)
  eq(Check.isText("   ", 60, true), false)
  is_true(Check.isText("", 60, false))
  is_true(Check.isText("   ", 60, false))
  is_true(Check.isText("\t", 60, true)) -- a tab is text
  is_true(Check.isText("\194\160", 60, true)) -- so is a no-break space
  is_true(Check.isText(" a ", 60, true))
end)

test("a missing value is fine when it is not required, and nothing else but a string is text", function()
  is_true(Check.isText(nil, 60, false))
  eq(Check.isText(nil, 60, true), false)
  for _, value in ipairs({ 5, true, false, {}, 1.5 }) do
    eq(Check.isText(value, 60, false), false)
    eq(Check.isText(value, 60, true), false)
  end
end)

test("a game id is a whole number from 1 to 100,000,000", function()
  is_true(Check.isGameId(1))
  is_true(Check.isGameId(100000000))
  is_true(Check.isGameId(900001))
  for _, bad in ipairs({ 0, -1, 100000001, 2.5, "5", true, false, {} }) do eq(Check.isGameId(bad), false) end
  eq(Check.isGameId(nil), false)
  eq(Check.isGameId(0 / 0), false)
  eq(Check.isGameId(math.huge), false)
end)

test("a date is written YYYY-MM-DD", function()
  is_true(Check.isDate("2026-12-09"))
  is_true(Check.isDate("0000-00-00")) -- only the form is checked, as in the app
  for _, bad in ipairs({ "2026-12-9", "12/09/2026", "2026-12-09 ", " 2026-12-09", "2026-12-091", "abcd-ef-gh", "2026/12/09", "20261209", "", 20261209, true }) do
    eq(Check.isDate(bad), false)
  end
  eq(Check.isDate(nil), false)
  eq(Check.isDate("\217\162026-12-09"), false)
end)

test("a field that is only ever true is absent or true", function()
  is_true(Check.isTrue(nil))
  is_true(Check.isTrue(true))
  for _, bad in ipairs({ false, "yes", 1, 0, {} }) do eq(Check.isTrue(bad), false) end
end)

test("an object is a table that is not a list", function()
  is_true(Check.isObject({}))
  is_true(Check.isObject({ a = 1 }))
  eq(Check.isObject(Json.list()), false)
  eq(Check.isObject(Json.list({ 1, 2 })), false)
  for _, bad in ipairs({ "x", 5, true }) do eq(Check.isObject(bad), false) end
  eq(Check.isObject(nil), false)
end)

test("display keeps short text, doubles pipes and cuts long text on a character boundary", function()
  eq(Check.display("Blade of the Fixture", 40), "Blade of the Fixture")
  eq(Check.display("see |notes| in Discord", 40), "see ||notes|| in Discord")
  eq(Check.display(string.rep("a", 40), 40), string.rep("a", 40))
  eq(Check.display(string.rep("a", 41), 40), string.rep("a", 40) .. "...")
  eq(Check.display(string.rep(E, 4), 3), string.rep(E, 3) .. "...") -- never in the middle of a letter
  eq(Check.display(string.rep(E, 3), 3), string.rep(E, 3))
  eq(Check.display(FACE .. FACE, 1), FACE .. "...")
  eq(Check.display("a|" .. string.rep("b", 50), 5), "a||bbb...")
  eq(Check.display(42, 10), "42")
end)

test("safe makes text fit for a message", function()
  eq(Check.safe("Plain words-and_marks 12.3:/x", 100), "Plain words-and_marks 12.3:/x")
  eq(Check.safe("a|cff00ff00b", 100), "a?cff00ff00b")
  eq(Check.safe("caf" .. E, 100), "caf??")
  eq(Check.safe(string.rep("a", 50), 10), string.rep("a", 10))
  eq(Check.safe(string.rep("a", 50)), string.rep("a", 24))
  eq(Check.safe(nil, 10), "nil")
end)

test("a refusal for a top-level field has the shape of the envelope's refusals", function()
  local refusal = Check.payloadError("header")
  eq(refusal.ok, false)
  eq(refusal.code, "E_PAYLOAD")
  eq(refusal.internal, nil)
  is_true(refusal.message:find("header", 1, true) ~= nil)
  eq(refusal.message, ns.Envelope.message("E_PAYLOAD", "header"))
end)
