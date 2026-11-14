-- Intrepid Manager: council votes, pure logic (no client calls). Who is on the council, and the votes of one loot session: each
-- council member has one vote per item, which moves when they vote for someone else and can be taken back. When votes are taken
-- (while the answer timer runs, until the item is awarded) is the session's to decide: game/CouncilSession asks before it records.
--
-- The council is the guild members of a rank and every rank above it ("Officer Alt and higher", the loot owner's choice of
-- 2026-11-13), plus the loot master, who always votes. Names are matched by Votes.key: the name without a realm after "-", in the
-- matching rule of core/Names (the game's full names have a first name and a surname, and the surname is not a realm).
--
--   local board = ns.Votes.newBoard()
--   board.setCouncil({ "Jorren Ashvale", "Bram Tollet" })
--   board.vote(1, "Bram Tollet", "Mirelle Dunmore")          --> true, nil          (no earlier vote)
--   board.vote(1, "Bram Tollet", "Orrin Vale")               --> true, "Mirelle Dunmore"
--   board.tally(1)                                            --> { [key of Orrin Vale] = { who, count = 1, voters = { "Bram Tollet" } } }

local _, ns = ...

local Votes = {}
ns.Votes = Votes

-- The guild rank the council starts at when the loot master has not chosen another one (/im council rank <name>).
Votes.DEFAULT_RANK = "Officer Alt"
Votes.MAX_NAME = 48 -- bytes in a name that travels in a vote or the council list

-- The key a name is matched by: no realm, no case, no accents' differences (core/Names). "" for nothing.
function Votes.key(name)
  if type(name) ~= "string" then return "" end
  return ns.Names.key(string.match(name, "^([^%-]*)") or "")
end

local function trimmed(text)
  return string.lower(string.match(tostring(text or ""), "^%s*(.-)%s*$"))
end

-- The index of the rank named `wanted` (0 is the Guild Master, larger numbers are lower ranks), from what is known of the guild's
-- ranks: ranks = { { name = "Officer", index = 1 }, ... } (the same rank may come many times). Case and outer spaces do not count.
-- Nil when no rank has that name.
function Votes.threshold(ranks, wanted)
  local want = trimmed(wanted)
  if want == "" then return nil end
  for _, rank in ipairs(ranks or {}) do
    if type(rank.name) == "string" and type(rank.index) == "number" and trimmed(rank.name) == want then return rank.index end
  end
  return nil
end

-- The council among `members` ({ { name, rankIndex (nil when not in the guild), me (the loot master) }, ... }, in order): every
-- member whose rank is `threshold` or higher (a smaller index), and the loot master always. With no threshold, the loot master alone.
function Votes.councilOf(members, threshold)
  local council = {}
  for _, member in ipairs(members or {}) do
    local ranked = type(threshold) == "number" and type(member.rankIndex) == "number" and member.rankIndex <= threshold
    if member.me or ranked then council[#council + 1] = member.name end
  end
  return council
end

-- A name fit to travel: no pipe (escape codes), tilde (the wire's separator), comma (the council list's), control characters or
-- outer spaces; at most Votes.MAX_NAME bytes, never cut inside a UTF-8 character. "" when nothing is left.
function Votes.cleanName(name)
  local text = tostring(name or "")
  text = string.gsub(text, "[|~,%c]", "")
  text = string.match(text, "^%s*(.-)%s*$")
  if #text > Votes.MAX_NAME then
    local cut = Votes.MAX_NAME
    while cut > 0 do
      local byte = string.byte(text, cut + 1)
      if byte and byte >= 128 and byte < 192 then cut = cut - 1 else break end
    end
    text = string.sub(text, 1, cut)
  end
  return text
end

---------------------------------------------------------------------------------------------------------------
-- The votes of one session
---------------------------------------------------------------------------------------------------------------

function Votes.newBoard()
  local self = {}
  local council, councilKeys = {}, {}
  local items = {} -- n -> { byVoter = { voterKey -> { voter, target, targetKey } } }

  local function add(names)
    for _, name in ipairs(names or {}) do
      local key = Votes.key(name)
      if key ~= "" and not councilKeys[key] then
        councilKeys[key] = true
        council[#council + 1] = name
      end
    end
  end

  -- The council of this session, in the order given (a repeat of a name counts once).
  function self.setCouncil(names)
    council, councilKeys = {}, {}
    add(names)
  end

  -- More names for it (the loot master's list comes in parts when it is long).
  function self.addCouncil(names) add(names) end

  function self.council()
    local copy = {}
    for i, name in ipairs(council) do copy[i] = name end
    return copy
  end

  function self.isCouncil(name)
    local key = Votes.key(name)
    return key ~= "" and councilKeys[key] == true
  end

  local function item(n)
    if not items[n] then items[n] = { byVoter = {} } end
    return items[n]
  end

  -- A council member's vote on item n for `target` (a name; nil or "" takes the vote back). Voting for the one already voted for
  -- changes nothing. Returns true and the name voted for before (nil when none), or false and why.
  function self.vote(n, voter, target)
    if type(n) ~= "number" then return false, "No item." end
    if not self.isCouncil(voter) then return false, "Only the council votes." end
    local voterKey = Votes.key(voter)
    local entry = item(n)
    local before = entry.byVoter[voterKey]
    local previous = before and before.target or nil
    local targetKey = Votes.key(target)
    if targetKey == "" then
      entry.byVoter[voterKey] = nil
      return true, previous
    end
    entry.byVoter[voterKey] = { voter = voter, target = target, targetKey = targetKey }
    return true, previous
  end

  -- Who `voter` voted for on item n, or nil.
  function self.voteOf(n, voter)
    local entry = items[n]
    local found = entry and entry.byVoter[Votes.key(voter)]
    return found and found.target or nil
  end

  local function byName(a, b)
    local ka, kb = Votes.key(a), Votes.key(b)
    if ka ~= kb then return ka < kb end
    return a < b
  end

  -- The votes of item n by whom they are for: { [target key] = { who (the target's name as the first vote spelled it), count, voters =
  -- { names A to Z } } }.
  function self.tally(n)
    local result = {}
    local entry = items[n]
    if not entry then return result end
    for _, vote in pairs(entry.byVoter) do
      local slot = result[vote.targetKey]
      if not slot then
        slot = { who = vote.target, count = 0, voters = {} }
        result[vote.targetKey] = slot
      end
      slot.count = slot.count + 1
      slot.voters[#slot.voters + 1] = vote.voter
    end
    for _, slot in pairs(result) do table.sort(slot.voters, byName) end
    return result
  end

  -- How many of `present` (a list of names; nil: the whole council) have a vote on item n. Only council members count.
  function self.voted(n, present)
    local entry = items[n]
    if not entry then return 0 end
    local total = 0
    if present then
      local seen = {}
      for _, name in ipairs(present) do
        local key = Votes.key(name)
        if key ~= "" and not seen[key] and councilKeys[key] and entry.byVoter[key] then total = total + 1 end
        seen[key] = true
      end
      return total
    end
    for key in pairs(entry.byVoter) do
      if councilKeys[key] then total = total + 1 end
    end
    return total
  end

  -- The keys of the most-voted on item n, among `eligible` (a set of target keys; nil: anybody voted for). Several on a tie; none
  -- while nobody has a vote.
  function self.leaders(n, eligible)
    local best, keys = 0, {}
    for key, slot in pairs(self.tally(n)) do
      if not eligible or eligible[key] then
        if slot.count > best then
          best, keys = slot.count, { key }
        elseif slot.count == best and best > 0 then
          keys[#keys + 1] = key
        end
      end
    end
    table.sort(keys)
    return keys, best
  end

  -- What the awards log keeps of item n's votes: { { to, by = { voters A to Z } }, ... }, the most votes first, then A to Z. Nil
  -- when nobody voted.
  function self.snapshot(n)
    local list = {}
    for _, slot in pairs(self.tally(n)) do
      local by = {}
      for i, voter in ipairs(slot.voters) do by[i] = voter end
      list[#list + 1] = { to = slot.who, by = by }
    end
    if #list == 0 then return nil end
    table.sort(list, function(a, b)
      if #a.by ~= #b.by then return #a.by > #b.by end
      return byName(a.to, b.to)
    end)
    return list
  end

  return self
end
