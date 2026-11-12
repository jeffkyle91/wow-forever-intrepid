-- The wire format of the council session (IntrepidManager/net/CouncilWire.lua). Invented names only.

local function load()
  local ns = {}
  load_core(ns, "Names", "Council")
  load_addon_file("IntrepidManager/net/CouncilWire.lua", ns)
  return ns.Net.CouncilWire, ns.Council
end

local LINK = "|cffa335ee|Hitem:12345::::::::70:::::|h[Crown of the Fallen]|h|r"

test("an item string comes out of a link, a plain item string, or a link with bonus numbers", function()
  local Wire = load()
  eq(Wire.itemString(LINK), "item:12345::::::::70")
  eq(Wire.itemString("item:12345"), "item:12345")
  eq(Wire.itemString("item:12345::::::::70:::::"), "item:12345::::::::70")
  eq(Wire.itemString("|cff9d9d9d|Hitem:7073:0:0:0:0:0:-12:0:70:0:0:0:0:3:1472:5:6|h[Broken Fang]|h|r"), "item:7073:0:0:0:0:0:-12:0:70:0:0:0:0:3:1472:5:6")
  eq(Wire.itemString("|Hspell:133|h[Fireball]|h"), nil)
  eq(Wire.itemString("item:"), nil)
  eq(Wire.itemString("item::::"), nil)
  eq(Wire.itemString("hello"), nil)
  eq(Wire.itemString(nil), nil)
  eq(Wire.itemString(42), nil)
end)

test("every item link in a line is found, in order, and other links and text are skipped", function()
  local Wire = load()
  local text = "add " .. LINK .. " and |cff0070dd|Hitem:777::::::::70|h[Ring]|h|r also |Hspell:5|h[x]|h done"
  deep_eq(Wire.itemStrings(text), { "item:12345::::::::70", "item:777::::::::70" })
  deep_eq(Wire.itemStrings("nothing"), {})
  deep_eq(Wire.itemStrings(nil), {})
end)

test("a note loses pipes, control characters and extra spaces, and is cut to the limit on a character boundary", function()
  local Wire = load()
  eq(Wire.cleanNote("  my   first |cffff0000one|r  "), "my first /cffff0000one/r")
  eq(Wire.cleanNote("line one\nline two\ttabbed"), "line one line two tabbed")
  eq(Wire.cleanNote(nil), "")
  eq(Wire.cleanNote(12), "12")
  eq(Wire.cleanNote(string.rep("a", 100)), string.rep("a", 80))
  eq(Wire.cleanNote(string.rep("a", 100), 10), string.rep("a", 10))
  -- an e with an accent is two bytes (195 169): cutting between them would leave half a character
  local accented = string.rep("a", 79) .. "\195\169\195\169"
  eq(Wire.cleanNote(accented), string.rep("a", 79))
  eq(#Wire.cleanNote(string.rep("a", 78) .. "\195\169\195\169"), 80)
  eq(Wire.cleanNote("\226\130\172\226\130\172", 4), "\226\130\172") -- a three byte character: 4 bytes fit one
end)

test("an offer, an answer, an end and a hello are made of fields joined by tildes, and never hold a pipe", function()
  local Wire = load()
  eq(Wire.item("k3f9", 2, 3, 60, "item:12345::::::::70", 4, "Crown of the Fallen"), "I~1~k3f9~2~3~60~4~item:12345::::::::70~Crown of the Fallen")
  eq(Wire.item("k3f9", 2, 3, 60, "item:12345"), "I~1~k3f9~2~3~60~1~item:12345~") -- an unknown quality is told as 1, a missing name as nothing
  eq(Wire.item("k3f9", 2, 3, 60, "item:12345", 9, "x"), "I~1~k3f9~2~3~60~1~item:12345~x")
  eq(Wire.item("k3f9", 2, 3, 60, "item:12345", 3, "A|cffff0000 name~with~tildes"), "I~1~k3f9~2~3~60~3~item:12345~A/cffff0000 name~with~tildes")
  eq(Wire.hello("k3f9", "0.0.11", "WARRIOR"), "K~1~k3f9~0.0.11~WARRIOR")
  eq(Wire.hello("k3f9", "0.0.11", "not a class!"), "K~1~k3f9~0.0.11")
  eq(Wire.response("k3f9", 2, "u", "my first"), "R~1~k3f9~2~u~~~my first")
  eq(Wire.response("k3f9", 2, "u", "x", "item:111", "item:222"), "R~1~k3f9~2~u~item:111~item:222~x")
  eq(Wire.finish("k3f9"), "X~1~k3f9")
  eq(Wire.hello("k3f9", "0.0.10"), "K~1~k3f9~0.0.10")
  eq(string.find(Wire.response("k3f9", 1, "p", "a|b|cffff0000c"), "|", 1, true), nil)
  local text, why = Wire.item("k3f9", 1, 1, 60, "not an item")
  eq(text, nil)
  eq(why, "not an item")
  eq(Wire.PREFIX, "IMC1")
end)

test("a message is never longer than 255 bytes: the note shrinks first, then the second gear item goes", function()
  local Wire = load()
  local long = "item:12345" .. string.rep(":1", 55) -- 120 bytes, the longest item string accepted
  local note = string.rep("n", 200)
  local text = Wire.response("k3f9", 2, "u", note)
  is_true(#text <= 255)
  eq(#text, #"R~1~k3f9~2~u~~~" + 80)
  text = Wire.response("k3f9", 2, "u", note, long, long)
  is_true(#text <= 255)
  local decoded = Wire.decode(text)
  eq(decoded.gear1, long)
  eq(decoded.gear2, nil) -- no room for the second
  eq(#decoded.note, 80)
  -- two medium gear items both fit, and the note gives way instead
  local mid = "item:12345" .. string.rep(":1", 45) -- 100 bytes
  text = Wire.response("k3f9", 2, "u", note, mid, mid)
  eq(#text, 255)
  decoded = Wire.decode(text)
  eq(decoded.gear1, mid)
  eq(decoded.gear2, mid)
  eq(#decoded.note, 255 - #("R~1~k3f9~2~u~" .. mid .. "~" .. mid .. "~"))
  text = Wire.response("k3f9", 2, "u", note, long .. "", "item:1")
  is_true(#text <= 255)
  eq(Wire.decode(text).gear1, long)
  eq(Wire.decode(text).gear2, "item:1")
  -- not items: left out
  decoded = Wire.decode(Wire.response("k3f9", 2, "u", "x", "junk", nil))
  eq(decoded.gear1, nil)
  -- an offer with a huge item string is refused, not cut
  local huge = "item:1" .. string.rep(":1", 200)
  eq(Wire.item("k3f9", 1, 1, 60, huge), nil)
end)

test("what is made can be read back", function()
  local Wire = load()
  deep_eq(Wire.decode(Wire.item("k3f9", 2, 3, 60, "item:12345::::::::70", 4, "Crown of the Fallen")), {
    kind = "I", sid = "k3f9", n = 2, count = 3, timer = 60, quality = 4, item = "item:12345::::::::70", name = "Crown of the Fallen",
  })
  deep_eq(Wire.decode(Wire.item("k3f9", 1, 1, 60, "item:5")), { kind = "I", sid = "k3f9", n = 1, count = 1, timer = 60, quality = 1, item = "item:5", name = "" })
  deep_eq(Wire.decode(Wire.hello("k3f9", "0.0.11", "DEATHKNIGHT")), { kind = "K", sid = "k3f9", version = "0.0.11", class = "DEATHKNIGHT" })
  deep_eq(Wire.decode(Wire.response("k3f9", 2, "b", "my first", "item:111", nil)), { kind = "R", sid = "k3f9", n = 2, code = "b", gear1 = "item:111", note = "my first" })
  deep_eq(Wire.decode(Wire.response("k3f9", 2, "p", "")), { kind = "R", sid = "k3f9", n = 2, code = "p", note = "" })
  deep_eq(Wire.decode(Wire.finish("k3f9")), { kind = "X", sid = "k3f9" })
  deep_eq(Wire.decode(Wire.hello("k3f9", "0.0.10")), { kind = "K", sid = "k3f9", version = "0.0.10" })
  -- a note may hold tildes: it is the last field
  eq(Wire.decode("R~1~k3f9~1~u~~~a~b~c").note, "a~b~c")
end)

test("a message of another version, or not ours, is told apart from a broken one", function()
  local Wire = load()
  local decoded, why, version = Wire.decode("I~2~k3f9~1~1~60~1~item:5~x")
  eq(decoded, nil)
  eq(why, "other version")
  eq(version, 2)
  for _, text in ipairs({ "hello there", "", string.rep("x", 256) }) do
    local none, reason = Wire.decode(text)
    eq(none, nil)
    eq(reason, "not a council message")
  end
  local nothing, reason = Wire.decode(nil)
  eq(nothing, nil)
  eq(reason, "not a council message")
end)

test("a message with a field out of range, an unknown answer or a bad item is refused whole", function()
  local Wire = load()
  local function refused(text, expected)
    local decoded, why = Wire.decode(text)
    eq(decoded, nil)
    eq(why, expected)
  end
  refused("I~1~k3f9~1~0~60~1~item:5~x", "bad offer") -- no items
  refused("I~1~k3f9~1~21~60~1~item:5~x", "bad offer") -- more than twenty
  refused("I~1~k3f9~4~3~60~1~item:5~x", "bad offer") -- item 4 of 3
  refused("I~1~k3f9~0~3~60~1~item:5~x", "bad offer")
  refused("I~1~k3f9~1~3~4~1~item:5~x", "bad offer") -- timer under 5
  refused("I~1~k3f9~1~3~601~1~item:5~x", "bad offer")
  refused("I~1~k3f9~1~3~60~6~item:5~x", "bad offer") -- quality over 5
  refused("I~1~abcdefghijklmnop~1~3~60~1~item:5~x", "bad offer") -- session id too long
  refused("I~1~k3f9~1~3~60~1~spell:5~x", "bad item")
  refused("I~1~k3f9~1~3", "bad offer")
  refused("R~1~k3f9~1~z~~~x", "bad answer")
  refused("R~1~k3f9~0~u~~~x", "bad answer")
  refused("R~1~k3f9~1~u~junk~~x", "bad gear")
  refused("R~1~k3f9~1~u~~junk~x", "bad gear")
  refused("R~1~k3f9~1~u", "bad answer")
  refused("X~1~", "bad end")
  refused("X~1~k3f9~extra", "bad end")
  refused("K~1~k3f9~", "bad hello")
  refused("K~1~k3f9~this version is far too long to be real", "bad hello")
  refused("Z~1~k3f9", "unknown message")
end)

test("a note arriving with a pipe or a control character is cleaned again on the way in", function()
  local Wire = load()
  eq(Wire.decode("R~1~k3f9~1~u~~~a|cffff0000b\1c").note, "a/cffff0000b c")
end)

test("the edges: both gear items fit while the note keeps 20 bytes, the second goes when it would not", function()
  local Wire = load()
  local function gear(n) return "item:12345" .. string.rep(":1", (n - 10) / 2) end -- n bytes, n even
  local both = Wire.response("k3f9", 2, "u", string.rep("n", 80), gear(110), gear(110)) -- head 235
  eq(Wire.decode(both).gear2, gear(110))
  eq(#both, 255)
  local over = Wire.response("k3f9", 2, "u", string.rep("n", 80), gear(110), gear(112)) -- head 237
  eq(Wire.decode(over).gear2, nil)
  eq(Wire.decode(over).gear1, gear(110))
end)

test("the edges of an offer, an answer and a hello: exact numbers pass, one over fails", function()
  local Wire = load()
  local function ok(text) return Wire.decode(text) ~= nil end
  is_true(ok("I~1~k3f9~20~20~600~5~item:5~x"))
  is_true(ok("I~1~k3f9~1~1~5~0~item:5~x"))
  eq(ok("I~1~k3f9~21~20~60~1~item:5~x"), false)
  eq(ok("I~1~k3f9~1~20~601~1~item:5~x"), false)
  eq(ok("I~1~k3f9~1~20~4~1~item:5~x"), false)
  is_true(ok("R~1~k3f9~20~u~~~x"))
  eq(ok("R~1~k3f9~21~u~~~x"), false)
  local twelve, thirteen = string.rep("a", 12), string.rep("a", 13)
  is_true(ok("I~1~" .. twelve .. "~1~1~60~1~item:5~x"))
  eq(ok("I~1~" .. thirteen .. "~1~1~60~1~item:5~x"), false)
  is_true(ok("R~1~" .. twelve .. "~1~u~~~x"))
  eq(ok("R~1~" .. thirteen .. "~1~u~~~x"), false)
  is_true(ok("X~1~" .. twelve))
  eq(ok("X~1~" .. thirteen), false)
  is_true(ok("K~1~" .. twelve .. "~" .. string.rep("v", 20)))
  eq(ok("K~1~" .. thirteen .. "~1.0"), false)
  eq(ok("K~1~k3f9~" .. string.rep("v", 21)), false)
end)

test("a note is never cut inside a character of two, three or four bytes", function()
  local Wire = load()
  local three = "\225\128\128" -- U+1000: continuation bytes 128 and 128
  local four = "\240\144\128\128" -- U+10000
  eq(Wire.cleanNote(string.rep("a", 9) .. three, 10), string.rep("a", 9))
  eq(Wire.cleanNote(string.rep("a", 8) .. three, 10), string.rep("a", 8))
  eq(Wire.cleanNote(string.rep("a", 7) .. three, 10), string.rep("a", 7) .. three)
  eq(Wire.cleanNote(string.rep("a", 7) .. four, 10), string.rep("a", 7))
  eq(Wire.cleanNote(four .. four, 6), four)
  eq(Wire.cleanNote("\128\128\128", 2), "") -- nothing but continuation bytes: nothing is kept
end)

test("the quality is read from the color of a link, and the links of a line come with their names and qualities", function()
  local Wire = load()
  eq(Wire.qualityOfColor("ff9d9d9d"), 0)
  eq(Wire.qualityOfColor("ffffffff"), 1)
  eq(Wire.qualityOfColor("ff1eff00"), 2)
  eq(Wire.qualityOfColor("ff0070dd"), 3)
  eq(Wire.qualityOfColor("ffa335ee"), 4)
  eq(Wire.qualityOfColor("ffff8000"), 5)
  eq(Wire.qualityOfColor("ffe6cc80"), nil)
  eq(Wire.qualityOfColor(nil), nil)
  local text = "|cff9d9d9d|Hitem:7073::::::::70:::::|h[Broken Fang]|h|r and |cffa335ee|Hitem:12345:::::::::|h[Crown of the Fallen]|h|r"
  deep_eq(Wire.itemInfos(text), {
    { item = "item:7073::::::::70", name = "Broken Fang", quality = 0 },
    { item = "item:12345", name = "Crown of the Fallen", quality = 4 },
  })
  deep_eq(Wire.itemInfos("nothing"), {})
  deep_eq(Wire.itemInfos(nil), {})
end)

test("an announce of the version and a full version check are made and read back", function()
  local Wire = load()
  eq(Wire.announce("0.0.15", "WARRIOR"), "V~1~0.0.15~WARRIOR")
  eq(Wire.announce("0.0.15"), "V~1~0.0.15")
  eq(Wire.announce("0.0.15", "not a class!"), "V~1~0.0.15")
  eq(Wire.versionRequest("ab12"), "Q~1~ab12")
  deep_eq(Wire.decode("V~1~0.0.15~WARRIOR"), { kind = "V", version = "0.0.15", class = "WARRIOR" })
  deep_eq(Wire.decode("V~1~0.0.15"), { kind = "V", version = "0.0.15" })
  deep_eq(Wire.decode("Q~1~ab12"), { kind = "Q", sid = "ab12" })
  deep_eq(Wire.decode("K~1~0~0.0.15~MAGE"), { kind = "K", sid = "0", version = "0.0.15", class = "MAGE" })
  local function refused(text, expected)
    local decoded, why = Wire.decode(text)
    eq(decoded, nil)
    eq(why, expected)
  end
  refused("V~1~", "bad announce")
  refused("V~1~" .. string.rep("1", 21), "bad announce")
  refused("V~1~0.0.15~WAR RIOR", "bad announce")
  refused("Q~1~", "bad request")
  refused("Q~1~abcdefghijklmnop", "bad request")
  local decoded = Wire.decode("V~2~0.0.15")
  eq(decoded, nil)
end)
