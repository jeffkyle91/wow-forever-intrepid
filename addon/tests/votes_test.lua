-- Council votes (IntrepidManager/core/Votes.lua): the council from guild ranks, and one session's votes. Invented names only.

local ns = {}
load_core(ns, "Names", "Votes")
local Votes = ns.Votes

-- The guild's ranks as the roster tells them: the rank name and its index (0 is the Guild Master).
local RANKS = {
  { name = "Member", index = 4 }, { name = "Officer", index = 1 }, { name = "Guild Master", index = 0 },
  { name = "Officer Alt", index = 2 }, { name = "Veteran", index = 3 }, { name = "Initiate", index = 6 }, { name = "Alt", index = 5 },
}

test("the threshold is the index of the rank named, whatever its case and outer spaces; an unknown rank has none", function()
  eq(Votes.threshold(RANKS, "Officer Alt"), 2)
  eq(Votes.threshold(RANKS, "  officer alt "), 2)
  eq(Votes.threshold(RANKS, "Officer"), 1)
  eq(Votes.threshold(RANKS, "Alt"), 5)
  eq(Votes.threshold(RANKS, "Raid Lead"), nil)
  eq(Votes.threshold(RANKS, ""), nil)
  eq(Votes.threshold({}, "Officer Alt"), nil)
  eq(Votes.threshold(nil, "Officer Alt"), nil)
  eq(Votes.DEFAULT_RANK, "Officer Alt")
end)

test("the council is that rank and every higher one, plus the loot master; nobody else, and no rank means the loot master alone", function()
  local members = {
    { name = "Jorren Ashvale", rankIndex = 4, me = true }, -- the loot master, a Member
    { name = "Bram Tollet", rankIndex = 0 },
    { name = "Mirelle Dunmore", rankIndex = 2 },
    { name = "Orrin Vale", rankIndex = 3 },
    { name = "Cass Wren", rankIndex = 5 },
    { name = "Dell Harrow" }, -- not in the guild
    { name = "Ness Coyle", rankIndex = 1 },
  }
  deep_eq(Votes.councilOf(members, 2), { "Jorren Ashvale", "Bram Tollet", "Mirelle Dunmore", "Ness Coyle" })
  deep_eq(Votes.councilOf(members, 0), { "Jorren Ashvale", "Bram Tollet" })
  deep_eq(Votes.councilOf(members, nil), { "Jorren Ashvale" })
  deep_eq(Votes.councilOf({}, 2), {})
end)

test("names are matched without a realm or case (plain letters; accented capitals are not folded, as in core/Names)", function()
  eq(Votes.key("Jorren Ashvale"), Votes.key("JORREN ASHVALE"))
  eq(Votes.key("Jorren Ashvale-Realm"), Votes.key("Jorren Ashvale"))
  eq(Votes.key(nil), "")
  eq(Votes.cleanName(" Bram|Tollet~, "), "BramTollet")
  eq(Votes.cleanName(string.rep("a", 60)), string.rep("a", 48))
  -- never cut inside a two-byte letter (\195\169 is e with an acute accent)
  eq(Votes.cleanName(string.rep("a", 47) .. "\195\169"), string.rep("a", 47))
end)

local function board()
  local b = Votes.newBoard()
  b.setCouncil({ "Jorren Ashvale", "Bram Tollet", "Ness Coyle" })
  return b
end

test("only the council votes; one vote per item moves to the new pick and can be taken back", function()
  local b = board()
  is_true(b.isCouncil("bram tollet"))
  eq(b.isCouncil("Orrin Vale"), false)
  local ok, why = b.vote(1, "Orrin Vale", "Mirelle Dunmore")
  eq(ok, false)
  eq(why, "Only the council votes.")
  local voted, before = b.vote(1, "Bram Tollet", "Mirelle Dunmore")
  is_true(voted)
  eq(before, nil)
  voted, before = b.vote(1, "Bram Tollet", "Orrin Vale")
  is_true(voted)
  eq(before, "Mirelle Dunmore")
  eq(b.voteOf(1, "Bram Tollet"), "Orrin Vale")
  local tally = b.tally(1)
  eq(tally[Votes.key("Mirelle Dunmore")], nil)
  deep_eq(tally[Votes.key("Orrin Vale")], { who = "Orrin Vale", count = 1, voters = { "Bram Tollet" } })
  voted, before = b.vote(1, "Bram Tollet", nil)
  is_true(voted)
  eq(before, "Orrin Vale")
  eq(b.voteOf(1, "Bram Tollet"), nil)
  deep_eq(b.tally(1), {})
  -- another item is counted apart
  b.vote(2, "Bram Tollet", "Cass Wren")
  eq(b.voteOf(1, "Bram Tollet"), nil)
  eq(b.voteOf(2, "Bram Tollet"), "Cass Wren")
  eq(b.vote("x", "Bram Tollet", "Cass Wren"), false)
end)

test("the tally lists the voters A to Z, and how many voted counts only council members who are there", function()
  local b = board()
  b.vote(1, "Ness Coyle", "Mirelle Dunmore")
  b.vote(1, "Bram Tollet", "mirelle dunmore")
  b.vote(1, "Jorren Ashvale", "Orrin Vale")
  local tally = b.tally(1)
  deep_eq(tally[Votes.key("Mirelle Dunmore")], { who = "Mirelle Dunmore", count = 2, voters = { "Bram Tollet", "Ness Coyle" } })
  eq(b.voted(1), 3)
  eq(b.voted(1, { "Bram Tollet", "Jorren Ashvale", "Orrin Vale", "Bram Tollet" }), 2)
  eq(b.voted(2), 0)
  eq(b.voted(2, { "Bram Tollet" }), 0)
end)

test("the leaders are the most voted, several on a tie, none before a vote; the eligible set leaves others out", function()
  local b = board()
  deep_eq({ b.leaders(1) }, { {}, 0 })
  b.vote(1, "Ness Coyle", "Mirelle Dunmore")
  b.vote(1, "Bram Tollet", "Orrin Vale")
  local keys, best = b.leaders(1)
  eq(best, 1)
  eq(#keys, 2)
  b.vote(1, "Jorren Ashvale", "Orrin Vale")
  keys, best = b.leaders(1)
  deep_eq({ keys, best }, { { Votes.key("Orrin Vale") }, 2 })
  keys = b.leaders(1, { [Votes.key("Mirelle Dunmore")] = true })
  deep_eq(keys, { Votes.key("Mirelle Dunmore") })
  keys = b.leaders(1, {})
  deep_eq(keys, {})
end)

test("the snapshot for the awards log: most votes first, then A to Z, with who voted; nothing when nobody voted", function()
  local b = board()
  eq(b.snapshot(1), nil)
  b.vote(1, "Ness Coyle", "Orrin Vale")
  b.vote(1, "Bram Tollet", "Cass Wren")
  b.vote(1, "Jorren Ashvale", "Cass Wren")
  deep_eq(b.snapshot(1), {
    { to = "Cass Wren", by = { "Bram Tollet", "Jorren Ashvale" } },
    { to = "Orrin Vale", by = { "Ness Coyle" } },
  })
end)

test("the council is set once or added to in parts; a repeat counts once and a new list replaces it", function()
  local b = Votes.newBoard()
  b.addCouncil({ "Jorren Ashvale", "Bram Tollet" })
  b.addCouncil({ "bram tollet", "Ness Coyle", "" })
  deep_eq(b.council(), { "Jorren Ashvale", "Bram Tollet", "Ness Coyle" })
  b.setCouncil({ "Cass Wren" })
  deep_eq(b.council(), { "Cass Wren" })
  eq(b.isCouncil("Bram Tollet"), false)
  eq(b.isCouncil(""), false)
end)

test("a vote for a raider who is not eligible (changed to Pass) stays on the board, but is not counted or kept; it counts again if they ask", function()
  local b = board()
  b.vote(1, "Bram Tollet", "Mirelle Dunmore")
  b.vote(1, "Ness Coyle", "Orrin Vale")
  local both = { [Votes.key("Mirelle Dunmore")] = true, [Votes.key("Orrin Vale")] = true }
  local orrinOnly = { [Votes.key("Orrin Vale")] = true }
  eq(b.voted(1, nil, both), 2)
  eq(b.voted(1, nil, orrinOnly), 1)
  eq(b.voted(1, { "Bram Tollet", "Ness Coyle" }, orrinOnly), 1)
  eq(b.voted(1, nil, {}), 0)
  deep_eq(b.snapshot(1, orrinOnly), { { to = "Orrin Vale", by = { "Ness Coyle" } } })
  eq(b.snapshot(1, {}), nil)
  eq(b.voteOf(1, "Bram Tollet"), "Mirelle Dunmore") -- still there
  eq(b.voted(1, nil, both), 2)
end)

test("the name a tally shows is the same on every client: the spelling without a realm, else the first A to Z", function()
  local b = board()
  b.vote(1, "Ness Coyle", "Mirelle Dunmore-Realm")
  b.vote(1, "Bram Tollet", "Mirelle Dunmore")
  eq(b.tally(1)[Votes.key("Mirelle Dunmore")].who, "Mirelle Dunmore")
  local c = board()
  c.vote(1, "Bram Tollet", "Mirelle Dunmore")
  c.vote(1, "Ness Coyle", "Mirelle Dunmore-Realm")
  eq(c.tally(1)[Votes.key("Mirelle Dunmore")].who, "Mirelle Dunmore")
  local d = board()
  d.vote(1, "Bram Tollet", "mirelle dunmore")
  d.vote(1, "Ness Coyle", "Mirelle Dunmore")
  eq(d.tally(1)[Votes.key("Mirelle Dunmore")].who, "Mirelle Dunmore")
end)
