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
