-- Intrepid Manager: sample view-models for the windows, with invented names. The in-game test mode shows these when
-- there is no session, and the storyboards and tests draw them. Nothing here comes from a real raid.

local _, ns = ...

local Sample = {}
ns.UI = ns.UI or {}
ns.UI.Sample = Sample

local FIRST = {
  "Jorren", "Mirelle", "Tobin", "Garrick", "Orrin", "Zorn", "Lysa", "Bram", "Corin", "Dessa", "Edrik", "Fenna", "Galen",
  "Hild", "Ivor", "Jessa", "Kell", "Liora", "Marek", "Nessa", "Osric", "Perrin", "Quilla", "Rudo", "Sable", "Teris",
  "Ulric", "Vessa", "Wend", "Xanthe", "Yorrin", "Zelda", "Alder", "Brisa", "Caspian", "Delia", "Emmet", "Fiora", "Gwyn", "Hale",
}
local LAST = {
  "Ashvale", "Dunmore", "Ashvale", "Vole", "Vale", "Quillby", "Thorne", "Marrow", "Eastwick", "Fenwick", "Greywater",
  "Holloway", "Ironside", "Jessop", "Kettle", "Larkin", "Mosswood", "Northcott", "Oakhart", "Pennyfold", "Quinlan",
}
local CLASSES = {
  { "Warrior", "Tank" }, { "Priest", "Healer" }, { "Warrior", "Melee" }, { "Rogue", "Melee" }, { "Mage", "Ranged" },
  { "Mage", "Ranged" }, { "Warlock", "Ranged" }, { "Paladin", "Healer" }, { "Hunter", "Ranged" }, { "Druid", "Healer" },
  { "Shaman", "Melee" },
}

-- The first `count` players of an invented raid (at most 40): { name = "First Surname", class, role }.
function Sample.roster(count)
  local roster = {}
  for i = 1, math.min(count or 40, #FIRST) do
    local class = CLASSES[(i * 5) % #CLASSES + 1]
    roster[i] = { name = FIRST[i] .. " " .. LAST[(i - 1) % #LAST + 1], class = class[1], role = class[2] }
  end
  return roster
end

local ITEMS = {
  { name = "Blade of the Fixture", quality = 4, ilvl = 70, source = "Grimtooth", icon = "Interface\\Icons\\INV_Sword_27" },
  { name = "Cloak of the Mock", quality = 3, ilvl = 66, source = "Grimtooth", icon = "Interface\\Icons\\INV_Misc_Cape_18" },
  { name = "Ring of Placeholders", quality = 3, ilvl = 66, source = "Mordrek the Late", icon = "Interface\\Icons\\INV_Jewelry_Ring_14",
    state = "awarded", to = "Tobin Ashvale" },
  { name = "Boots of the Hollow", quality = 2, ilvl = 60, source = "Mordrek the Late", icon = "Interface\\Icons\\INV_Boots_Plate_05",
    state = "awarded", to = "Orrin Vale" },
  { name = "Helm of Specimens", quality = 4, ilvl = 70, source = "Mordrek the Late", icon = "Interface\\Icons\\INV_Helmet_08" },
}

-- A session as the window reads it. options: lines (how many priority lines the selected item has, default 12),
-- selected (item index, default 1), roster (default 40), attempt, observed, busy, warnings.
function Sample.session(options)
  options = options or {}
  local roster = Sample.roster(options.roster or 40)
  local items, awarded = {}, 0
  for i, item in ipairs(ITEMS) do
    items[i] = { index = i, name = item.name, quality = item.quality, icon = item.icon, state = item.state or "open", to = item.to }
    if item.state == "awarded" then awarded = awarded + 1 end
  end
  local selected = options.selected or 1
  local item = ITEMS[selected]
  local lines = {}
  local here = { "here", "here", "away", "here", "offline", "here", "here", "away" }
  for i = 1, options.lines or 12 do
    local player = roster[(i * 3) % #roster + 1]
    lines[#lines + 1] = {
      kind = "char", pos = i, name = player.name, class = player.class, role = player.role, here = here[(i - 1) % #here + 1],
      awarded = (item.state == "awarded" and i == 1) or i == 4 and selected == 1, eligible = i ~= 5, candidate = player.name,
    }
    if i == 6 then lines[#lines + 1] = { kind = "note", text = "any warlock who didn't get the cloak" } end
  end
  local candidates = {}
  for i, player in ipairs(roster) do
    if i ~= 7 and i ~= 23 then candidates[#candidates + 1] = player end
  end
  return {
    summary = awarded .. " of " .. #ITEMS .. " awarded",
    items = items,
    selected = selected,
    item = {
      index = selected, name = item.name, quality = item.quality, ilvl = item.ilvl, icon = item.icon, source = item.source,
      state = item.state or "open", to = item.to, nextInLine = lines[1] and lines[1].name,
      blocks = { { note = selected == 1 and "Tanks first, then melee DPS" or "", lines = lines } },
      candidates = candidates, warnings = options.warnings, attempt = options.attempt,
    },
    observed = options.observed,
    status = "Last: Boots of the Hollow -> Orrin Vale: received (master loot)",
    busy = options.busy == true,
  }
end

-- An invented awards log for the loot history window (/im window history): four weekly raids before `now` (server time) in an
-- invented raid, a short second raid after each, and a dungeon run between, in the shape game/Exchange.lua writes. Some awards
-- were given, some taken back, one each night went to Disenchant.
local HISTORY_ITEMS = {
  "Blade of the Fixture", "Cloak of the Mock", "Ring of Placeholders", "Boots of the Hollow", "Helm of Samples", "Mantle of Mock Data",
  "Leggings of the Placeholder", "Belt of Invented Names", "Gauntlets of the Dry Run",
}

local HISTORY_BOSSES = { "Lord Fixture", "The Mock Hound", "Baron Placeholder" }

function Sample.historyLog(now)
  local roster = Sample.roster(12)
  local log, n = {}, 0
  local function add(at, place, to, pseudo)
    n = n + 1
    local given = n % 4 ~= 0
    log[#log + 1] = {
      id = "s-demo00-hist-" .. n, rev = 1, session = "s-demo00", at = at, date = date("%Y-%m-%d", at), itemId = 900000 + n,
      item = HISTORY_ITEMS[(n % #HISTORY_ITEMS) + 1], to = to or roster[(n % #roster) + 1].name, pseudo = pseudo,
      decision = not pseudo and "council" or nil,
      encounter = place == "Molten Test Core" and HISTORY_BOSSES[(n % #HISTORY_BOSSES) + 1] or nil,
      delivery = given and { state = "received", at = at + 300, how = "trade" } or { state = "assigned" },
      status = (n % 11 == 0) and "removed" or nil, place = place,
    }
    -- the council's votes on every other award of the raid (who voted for the winner, and one vote for somebody else)
    if not pseudo and place == "Molten Test Core" and n % 2 == 0 then
      local record = log[#log]
      record.votes = {
        { to = record.to, by = { roster[((n + 3) % #roster) + 1].name, roster[((n + 5) % #roster) + 1].name } },
        { to = roster[((n + 1) % #roster) + 1].name, by = { roster[((n + 7) % #roster) + 1].name } },
      }
    end
  end
  local day, hour = 86400, 3600
  for week = 3, 0, -1 do
    local start = now - week * 7 * day - 4 * hour
    for k = 0, 7 do add(start + k * 15 * 60, "Molten Test Core") end
    add(start + 2 * hour + 30 * 60, "Molten Test Core", "Disenchant", "disenchant")
    for k = 0, 2 do add(start + 3 * hour + k * 10 * 60, "Onyx Test Lair") end
    if week > 0 then add(start + 3 * day, "Hollow Test Keep") end
  end
  return log
end

-- An invented loot session with a council for the voting window (/im window voting): three items, the player on the council of
-- four. Item 1 has candidates and votes, item 2 was awarded, nobody has asked for item 3 yet. `mine` (n -> name) is the demo
-- player's pretend votes, added to the counts. Returns the model and the rows of each item.
function Sample.voting(mine)
  mine = mine or {}
  local model = {
    state = "running", remaining = 38, master = "Jorren Ashvale", council = true, rank = "Officer Alt", councilSize = 4, items = {
      { n = 1, item = "item:900101", name = "Blade of the Fixture", quality = 4, icon = "Interface\\Icons\\INV_Sword_27", voted = 3, candidates = 3, open = true },
      { n = 2, item = "item:900102", name = "Cloak of the Mock", quality = 4, icon = "Interface\\Icons\\INV_Misc_Cape_02", voted = 2, candidates = 2,
        winner = "Selwyn Crake" },
      { n = 3, item = "item:900103", name = "Ring of Placeholders", quality = 3, icon = "Interface\\Icons\\INV_Jewelry_Ring_03", voted = 0, candidates = 0, open = true },
    },
  }
  local rows = {
    [1] = {
      { who = "Bram Tollet", class = "WARRIOR", code = "b", label = "Best in slot", note = "", voters = { "Ness Coyle", "Orrin Vale" } },
      { who = "Mirelle Dunmore", class = "PRIEST", code = "u", label = "Upgrade", note = "my first ring", voters = { "Dell Harrow" } },
      { who = "Tamsin Rook", class = "MAGE", code = "o", label = "Off-spec", note = "", voters = {} },
      { who = "Cass Wren", class = "ROGUE", code = "p", label = "Pass", note = "", voters = {} },
    },
    [2] = {
      { who = "Selwyn Crake", class = "DRUID", code = "b", label = "Best in slot", note = "", voters = { "Ness Coyle", "Orrin Vale" }, winner = true },
      { who = "Garrick Vole", class = "DRUID", code = "u", label = "Upgrade", note = "", voters = {} },
    },
    [3] = {},
  }
  for n, list in pairs(rows) do
    local item = model.items[n]
    local best = 0
    for _, row in ipairs(list) do
      if mine[n] == row.who then
        local voters = { "You" }
        for _, voter in ipairs(row.voters) do voters[#voters + 1] = voter end
        row.voters, row.mine = voters, true
      end
      row.votes = #row.voters
      row.canVote = item.open and row.code ~= "p" or nil
      if row.code ~= "p" and row.votes > best then best = row.votes end
    end
    for _, row in ipairs(list) do row.leader = (best > 0 and row.code ~= "p" and row.votes == best) or nil end
    item.myVote = mine[n]
    if mine[n] then item.voted = item.voted + 1 end
  end
  return model, rows
end
