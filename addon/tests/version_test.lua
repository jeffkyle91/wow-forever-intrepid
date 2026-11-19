-- Comparing addon versions (IntrepidManager/core/Version.lua).

local function load()
  local ns = {}
  load_core(ns, "Version")
  return ns.Version
end

test("a version is its dotted numbers, whatever follows them", function()
  local Version = load()
  deep_eq(Version.parse("0.0.14"), { 0, 0, 14 })
  deep_eq(Version.parse("1.2"), { 1, 2 })
  deep_eq(Version.parse("10"), { 10 })
  deep_eq(Version.parse("0.0.14-beta"), { 0, 0, 14 })
  deep_eq(Version.parse("2.10.3 test"), { 2, 10, 3 })
  deep_eq(Version.parse("1.x"), { 1 })
  eq(Version.parse("beta"), nil)
  eq(Version.parse(""), nil)
  eq(Version.parse(nil), nil)
  eq(Version.parse(12), nil)
  eq(Version.parse(".5"), nil)
end)

test("versions compare number by number, not as text", function()
  local Version = load()
  eq(Version.compare("0.0.14", "0.0.9"), 1) -- 14 is more than 9
  eq(Version.compare("0.0.9", "0.0.14"), -1)
  eq(Version.compare("0.0.14", "0.0.14"), 0)
  eq(Version.compare("0.1.0", "0.0.99"), 1)
  eq(Version.compare("1.0.0", "0.99.99"), 1)
  eq(Version.compare("1.2", "1.2.0"), 0)
  eq(Version.compare("1.2", "1.2.1"), -1)
  eq(Version.compare("1.2.1", "1.2"), 1)
  eq(Version.compare("0.0.14-beta", "0.0.14"), 0)
  eq(Version.compare("junk", "0.0.14"), nil)
  eq(Version.compare("0.0.14", nil), nil)
end)

test("how their version stands to mine", function()
  local Version = load()
  eq(Version.relation("0.0.14", "0.0.14"), "same")
  eq(Version.relation("0.0.14", "0.0.15"), "newer")
  eq(Version.relation("0.0.14", "0.0.9"), "older")
  eq(Version.relation("0.0.14", "unknown"), "unknown")
  eq(Version.relation("unknown", "0.0.14"), "unknown")
  eq(Version.relation("0.0.14", nil), "unknown")
end)
