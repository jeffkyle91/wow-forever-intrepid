-- The exchange engine (IntrepidManager/game/Exchange.lua): the night the loot master imported, the awards the sessions make in the
-- shape of docs/spec/exchange-v0.md, and the awards string of the export window. The night is the synthetic one of
-- docs/spec/fixtures/synthetic/. Invented names only. See AGENTS.md.
local ns = load_core({}, "Crc32", "Json", "Envelope", "Names", "Council", "Ids", "Check", "Night", "Awards")
load_addon_file("IntrepidManager/game/Exchange.lua", ns)
local Awards, Envelope, Night = ns.Awards, ns.Envelope, ns.Night

local DIR = SPEC .. "fixtures/synthetic/"
local NIGHT_TEXT = read_file(DIR .. "night.j.txt")

-- An engine on a fake clock and fake random numbers. Each call makes "another load" when given another `seed`.
local function engine(options)
  options = options or {}
  local clock = { t = options.start or 1796867000 }
  local db = options.db or {}
  local counter = options.seed or 0
  local exchange = ns.Game.Exchange.new({
    db = db, version = "0.0.17", now = function() return clock.t end, dateOf = function() return "2026-12-09" end,
    random = function(n) counter = counter + 7 return (counter % n) + 1 end,
    sessionOpen = function() return options.open end,
  })
  return exchange, db, clock
end

local function imported(options)
  local exchange, db, clock = engine(options)
  local result = Night.read(NIGHT_TEXT)
  local answer = exchange.importNight(result)
  return exchange, db, clock, result, answer
end

local function entry(n, itemId, name) return { n = n, item = "item:" .. itemId .. "::::::::70", name = name } end

-- The first priority of the night with at least one character line, and the roster entry of that line.
local function someone(result)
  for _, priority in ipairs(result.priorities) do
    for _, line in ipairs(priority.lines) do
      if line.k and result.byK[line.k] then return priority, result.byK[line.k] end
    end
  end
end

local function fullName(player) return player.name .. " " .. player.surname end

local function valid(record)
  local read = Envelope.read(Awards.encode({ schema = 1, id = "a-test", at = 1796868000, by = "Test/1", awards = { record } }), "awards")
  if not read.ok then return false, read.message end
  local checked = Awards.check(read.model)
  return checked.ok and #checked.rowErrors == 0, checked.rowErrors and table.concat(checked.rowErrors, ",") or checked.message
end

test("the night is kept as it was accepted and told in a sentence, and a new one replaces it", function()
  local exchange, db, _, result, answer = imported()
  eq(answer.ok, true)
  is_true(answer.message:find("Night of 2026-12-09", 1, true) ~= nil)
  eq(db.night.id, result.model.id)
  eq(#db.night.roster, #result.roster)
  eq(#db.night.priorities, #result.priorities)
  eq(db.night.phase, 1)
  eq(db.night.raid.id, "raid-20261209")
  is_true(exchange.nightText():find("copied 13 minutes ago", 1, true) ~= nil)
  is_true(exchange.nightText():find("29 players, 24 priorities", 1, true) ~= nil)
  local other = Night.read(NIGHT_TEXT)
  other.model.id = "n-another"
  eq(exchange.importNight(other).ok, true)
  eq(db.night.id, "n-another")
end)

test("a string that did not read, or an open session, keeps the night the addon has", function()
  local exchange, db, _, result = imported()
  local before = db.night
  eq(exchange.importNight({ ok = false, code = "E_CHECKSUM" }).ok, false)
  eq(exchange.importNight(nil).ok, false)
  eq(db.night, before)
  local busy, busyDb = engine({ open = true })
  local answer = busy.importNight(result)
  eq(answer.ok, false)
  eq(answer.message, "Finish or cancel the open session first.")
  eq(busyDb.night, nil)
  eq(busy.nightText(), nil)
end)

test("an award is a record of the spec: ids from the session, the revision at the server time, the night's phase and raid, the roster id and the priority", function()
  local exchange, db, clock, result = imported()
  local priority, player = someone(result)
  exchange.beginSession("c1")
  clock.t = clock.t + 30
  local record = exchange.awarded("c1", entry(1, priority.itemId, priority.item), fullName(player))
  is_true(record.id:match("^s%-%w+%-%w%w%w%w%-1$") ~= nil)
  eq(record.session, record.id:gsub("%-1$", ""))
  eq(record.rev, clock.t)
  eq(record.at, clock.t)
  eq(record.date, "2026-12-09")
  eq(record.phase, 1)
  eq(record.raid, "raid-20261209")
  eq(record.itemId, priority.itemId)
  eq(record.item, priority.item)
  eq(record.to, fullName(player))
  eq(record.toId, player.id)
  eq(record.decision, "council")
  eq(record.priority, priority.id)
  eq(record.encounter, priority.encounter)
  eq(record.npcId, priority.npcId)
  eq(record.zoneId, priority.zoneId)
  deep_eq(record.delivery, { state = "assigned" })
  eq(record.status, nil)
  local ok, why = valid(record)
  is_true(ok, why)
  eq(db.awards.log[1], record)
end)

test("without a night an award still has everything the spec requires: no phase, raid, roster id or priority, and the decision", function()
  local exchange, _, _, result = imported()
  local _, player = someone(result)
  local bare = engine()
  local record = bare.awarded("c1", entry(1, 900001, "Blade of the Fixture"), fullName(player))
  eq(record.phase, nil)
  eq(record.raid, nil)
  eq(record.toId, nil)
  eq(record.priority, nil)
  eq(record.decision, "council")
  local ok, why = valid(record)
  is_true(ok, why)
  eq(exchange.exportModel(false).hasNight, true)
  eq(bare.exportModel(false).hasNight, false)
end)

test("a name is matched to the roster as the spec says: exactly one entry, ASCII case and spaces ignored, never by first name, never without a surname", function()
  local exchange = imported()
  local roster = exchange.night().roster
  local first
  for _, p in ipairs(roster) do
    if p.surname and p.k == 1 then first = p end
  end
  local messy = exchange.awarded("c1", entry(1, 900001, "A"), "  " .. string.upper(first.name) .. "   " .. string.lower(first.surname) .. " ")
  eq(messy.toId, first.id)
  eq(exchange.awarded("c1", entry(2, 900002, "B"), first.name).toId, nil) -- the first name alone
  eq(exchange.awarded("c1", entry(3, 900003, "C"), "Wanderer").toId, nil) -- no surname on the roster
  eq(exchange.awarded("c1", entry(4, 900004, "D"), "Dovan Greywind").toId, nil) -- two entries with that full name
  eq(exchange.awarded("c1", entry(5, 900005, "E"), "Nobody Atall").toId, nil)
  local outside = string.char(90, 111, 195, 171) .. " " .. string.char(195, 134) .. "rinwald" -- Zoe with a diaeresis, AE: exact bytes
  local zoe = exchange.awarded("c1", entry(6, 900006, "F"), outside)
  is_true(zoe.toId ~= nil)
  local shout = exchange.awarded("c1", entry(7, 900007, "G"), "Zo" .. string.char(195, 139) .. " " .. string.char(195, 134) .. "rinwald")
  eq(shout.toId, nil) -- a capital letter outside ASCII is another letter
end)

test("taking an award back removes it with a higher revision, and awarding again makes a new award with the next id", function()
  local exchange, db, clock, result = imported()
  local priority, player = someone(result)
  local item = entry(1, priority.itemId, priority.item)
  local first = exchange.awarded("c1", item, fullName(player))
  local firstRev = first.rev
  clock.t = clock.t + 90
  exchange.unawarded("c1", item)
  eq(first.status, "removed")
  eq(first.rev, clock.t) -- the clock moved on: the server time wins
  is_true(first.rev > firstRev)
  clock.t = clock.t + 5
  local second = exchange.awarded("c1", item, "Tavian Marrow")
  is_true(second.id ~= first.id)
  eq(second.id:match("%-(%d+)$"), "2")
  eq(#db.awards.log, 2)
  -- changing the recipient is a removal of the first award and a new one
  clock.t = clock.t + 5
  local third = exchange.awarded("c1", item, fullName(player))
  eq(second.status, "removed")
  eq(third.id:match("%-(%d+)$"), "3")
  -- a clock that stands still still makes the revision rise
  local record = exchange.awarded("c1", entry(2, 900002, "Thing"), "Somebody Else")
  exchange.given("c1", entry(2, 900002, "Thing"), "trade")
  local given = record.rev
  exchange.unawarded("c1", entry(2, 900002, "Thing"))
  eq(record.rev, given + 1)
end)

test("an item that is on several priorities of the night counts for the one the recipient is on", function()
  local exchange, db = imported()
  local first = db.night.priorities[1]
  local second = {}
  for key, value in pairs(first) do second[key] = value end
  second.id = "pr-second-list"
  second.lines = { { k = db.night.roster[2].k } }
  first.lines = { { k = db.night.roster[1].k } }
  db.night.priorities[#db.night.priorities + 1] = second
  local again = ns.Game.Exchange.new({ db = db, version = "0.0.17", now = function() return 1796867000 end, dateOf = function() return "2026-12-09" end })
  local one, two = db.night.roster[1], db.night.roster[2]
  eq(again.awarded("c1", entry(1, first.itemId, first.item), fullName(one)).priority, first.id)
  eq(again.awarded("c1", entry(2, first.itemId, first.item), fullName(two)).priority, second.id)
  eq(again.awarded("c1", entry(3, first.itemId, first.item), "Nobody Atall").priority, first.id) -- on neither: the first
  eq(exchange.night(), db.night)
end)

test("a take-back is final for the delivery: an item given afterwards changes nothing", function()
  local exchange, _, clock = engine()
  local item = entry(1, 900001, "Blade of the Fixture")
  local record = exchange.awarded("c1", item, "Mirelle Dunmore")
  clock.t = clock.t + 10
  exchange.unawarded("c1", item)
  local rev = record.rev
  clock.t = clock.t + 10
  exchange.given("c1", item, "trade")
  eq(record.rev, rev)
  deep_eq(record.delivery, { state = "assigned" })
end)

test("a trade that went through makes the award received, how and when, with a higher revision", function()
  local exchange, _, clock = engine()
  local record = exchange.awarded("c1", entry(1, 900001, "Blade of the Fixture"), "Mirelle Dunmore")
  local assigned = record.rev
  clock.t = clock.t + 120
  exchange.given("c1", entry(1, 900001, "Blade of the Fixture"), "trade")
  deep_eq(record.delivery, { state = "received", at = clock.t, how = "trade" })
  eq(record.rev, clock.t)
  is_true(record.rev > assigned)
  local ok, why = valid(record)
  is_true(ok, why)
  exchange.given("c1", entry(9, 900009, "Nothing awarded"), "trade") -- an item nobody was awarded: nothing happens
  eq(#exchange.log(), 1)
end)

test("the pseudo recipients are Disenchant and Guild bank: no roster id, the label as the recipient", function()
  local exchange = imported()
  local de = exchange.awarded("c1", entry(1, 900001, "A"), "Disenchant")
  eq(de.pseudo, "disenchant")
  eq(de.to, "Disenchant")
  eq(de.toId, nil)
  local bank = exchange.awarded("c1", entry(2, 900002, "B"), "guild bank")
  eq(bank.pseudo, "guild-bank")
  eq(bank.to, "Guild bank")
  local ok, why = valid(de)
  is_true(ok, why)
  ok, why = valid(bank)
  is_true(ok, why)
  eq(ns.Game.Exchange.pseudoOf("GUILD-BANK"), "guild-bank")
  eq(ns.Game.Exchange.pseudoOf("Mirelle Dunmore"), nil)
end)

test("two loads of the addon never make the same id, even at the same second and with the same award numbers", function()
  local one, _, clockOne = engine({ seed = 1 })
  local two, _, clockTwo = engine({ seed = 2 })
  clockTwo.t = clockOne.t
  local a = one.awarded("c1", entry(1, 900001, "A"), "Somebody Else")
  local b = two.awarded("c1", entry(1, 900001, "A"), "Somebody Else")
  is_true(a.id ~= b.id)
  eq(a.id:match("%-(%d+)$"), b.id:match("%-(%d+)$"))
  -- a session of the same load that starts later has another id too
  clockOne.t = clockOne.t + 600
  one.beginSession("c2")
  is_true(one.awarded("c2", entry(1, 900001, "A"), "Somebody Else").id ~= a.id)
end)

test("the export holds the awards of the night's phase that the night does not know in this revision, and says how many are new or changed", function()
  local exchange, _, clock, result = imported()
  local priority, player = someone(result)
  eq(exchange.exportModel(false).count, 0)
  eq(exchange.exportModel(false).text, nil)
  clock.t = clock.t + 60
  exchange.awarded("c1", entry(1, priority.itemId, priority.item), fullName(player))
  exchange.awarded("c1", entry(2, 900002, "Thing"), "Tavian Marrow")
  local vm = exchange.exportModel(false)
  eq(vm.count, 2)
  eq(vm.new, 2)
  eq(vm.changed, 0)
  eq(vm.hasNight, true)
  eq(vm.everything, false)
  eq(vm.sessionOpen, false)
  local count, rowErrors = exchange.verify(vm.text)
  eq(count, 2)
  eq(#rowErrors, 0)
  local read = Envelope.read(vm.text, "awards")
  is_true(read.ok)
  eq(read.model.by, "IntrepidManager/0.0.17")
  is_true(read.model.id:match("^a%-%w+%-%w%w%w%w$") ~= nil)
  -- the app imported the first of them and copied a new night: it knows that one in the revision it has
  local known = exchange.night().known
  local log = exchange.log()
  known[#known + 1] = { id = log[1].id, rev = log[1].rev }
  vm = exchange.exportModel(false)
  eq(vm.count, 1)
  eq(exchange.verify(vm.text), 1)
  -- the first one changes after that: it is exported again, and counted as changed
  clock.t = clock.t + 600
  exchange.given("c1", entry(1, priority.itemId, priority.item), "trade")
  vm = exchange.exportModel(false)
  eq(vm.count, 2)
  eq(vm.changed, 1)
  eq(vm.new, 1)
  -- everything, not only what is new
  eq(exchange.exportModel(true).count, 2)
  eq(exchange.exportModel(true).everything, true)
end)

test("with no night the export holds the awards of the last 14 days, and a session that is open is told to the window", function()
  local busy, _, clock = engine({ open = true })
  busy.awarded("c1", entry(1, 900001, "A"), "Somebody Else")
  eq(busy.exportModel(false).count, 1)
  eq(busy.exportModel(false).sessionOpen, true)
  clock.t = clock.t + 15 * 86400
  eq(busy.exportModel(false).count, 0)
  eq(busy.exportModel(true).count, 1)
end)

test("the export reads back through the addon's reader and through the reference reader of the tools", function()
  local exchange, _, clock, result = imported()
  local priority, player = someone(result)
  clock.t = clock.t + 60
  exchange.awarded("c1", entry(1, priority.itemId, priority.item), fullName(player))
  exchange.awarded("c1", entry(2, 900002, "Spare Trinket of the Dry Run"), "Disenchant")
  exchange.given("c1", entry(1, priority.itemId, priority.item), "trade")
  exchange.awarded("c1", entry(3, 900003, "Cloak"), "Tavian Marrow")
  exchange.unawarded("c1", entry(3, 900003, "Cloak"))
  local text = exchange.exportModel(true).text
  eq(exchange.verify(text), 3)
  if os.execute("python3 --version >/dev/null 2>&1") == 0 then
    local path = os.tmpname()
    local file = assert(io.open(path, "wb"))
    file:write(text)
    file:close()
    local status = os.execute("python3 -B tools/synthetic.py check " .. path .. " --expect awards >/dev/null 2>&1")
    os.remove(path)
    eq(status, 0) -- the reference reader of the tools finds no row error either
  end
end)
