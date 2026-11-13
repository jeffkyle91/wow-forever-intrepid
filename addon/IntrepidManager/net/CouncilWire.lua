-- Intrepid Manager: the wire format of the council session, pure (no client calls). Version 1 is a TEST protocol: it carries only what
-- the first in-game sessions need (an item on offer, a raider's answer, the end, a hello), and the spec of ADDON-002/003 replaces or
-- extends it before votes and tallies are added. Every message is plain text of at most 255 bytes (the game cuts longer ones without
-- a word), made of fields joined by "~" (a character that ForeverLoot's working messages already use; "|" starts an escape code in
-- chat text and is never sent). The prefix carries the version, so a client with another version never sees these messages.
--
--   I~1~sid~n~count~timer~quality~item~name   the loot master offers item n of count, for timer seconds   (group chat)
--   R~1~sid~n~code~gear1~gear2~note     a raider's answer to item n; gear1 and gear2 are what they wear     (whisper to the loot master)
--   X~1~sid                             the loot master ends the session                                   (group chat)
--   K~1~sid~version~class               a raider's hello: the addon is here, in this version, of this class (whisper to the loot master)
--   V~1~version~class                   "I am here, in this version": an announce when joining a group (group chat); a client with another
--                                       version answers with K and the session id 0
--   Q~1~sid                             a full version check: every client answers with K and this sid (whisper to the asker)
--
--   sid is the session id, quality 0 to 5, item an item string ("item:12345:..."), name the item's name (it is the loot master's
--   link that has it; a raider's game may not know the item yet), class the class token ("WARRIOR", may be left out), code one of
--   Council.RESPONSES.

local _, ns = ...

local Wire = {}
ns.Net = ns.Net or {}
ns.Net.CouncilWire = Wire

Wire.PREFIX = "IMC1"
Wire.PROTO = 1
Wire.MAX = 255 -- bytes in a message
Wire.MAX_NOTE = 80 -- bytes in a note
local SEP = "~"

-- "item:12345::::::::70" from a link ("|cff...|Hitem:12345::::::::70:::::|h[Name]|h|r") or from an item string; nil when it is not an item.
function Wire.itemString(link)
  if type(link) ~= "string" then return nil end
  local found = string.match(link, "|Hitem:([%d:%-]*)|h") or string.match(link, "^item:([%d:%-]*)$")
  if not found then return nil end
  found = string.gsub(found, ":+$", "")
  if not string.match(found, "^%d") then return nil end
  return "item:" .. found
end

-- Every item string in a text, in order (a line with several shift-clicked links).
function Wire.itemStrings(text)
  local list = {}
  if type(text) ~= "string" then return list end
  for found in string.gmatch(text, "|Hitem:([%d:%-]*)|h") do
    local item = Wire.itemString("item:" .. found)
    if item then list[#list + 1] = item end
  end
  return list
end

-- The quality (0 to 5) of the color code in front of a link: "ff9d9d9d" is Poor, "ffa335ee" Epic; the newer "cnIQ4:" form is read too.
-- Nil for another color.
local COLOR_QUALITY = { ["9d9d9d"] = 0, ["ffffff"] = 1, ["1eff00"] = 2, ["0070dd"] = 3, ["a335ee"] = 4, ["ff8000"] = 5 }
function Wire.qualityOfColor(code)
  if type(code) ~= "string" then return nil end
  local named = string.match(code, "^nIQ(%d):?$")
  if named then return tonumber(named) <= 5 and tonumber(named) or nil end
  return COLOR_QUALITY[string.lower(string.sub(code, -6))]
end

-- Every item link in a text with what the link shows: { { item, name, quality }, ... }; quality is nil when the color is unknown or
-- the link has none.
function Wire.itemInfos(text)
  local list = {}
  if type(text) ~= "string" then return list end
  local from = 1
  while true do
    local first, last, found, name = string.find(text, "|Hitem:([%d:%-]*)|h%[(.-)%]|h", from)
    if not first then break end
    from = last + 1
    local item = Wire.itemString("item:" .. found)
    if item then
      local before = string.sub(text, math.max(1, first - 12), first - 1)
      local code = string.match(before, "|c(%x%x%x%x%x%x%x%x)$") or string.match(before, "|c(nIQ%d:)$")
      list[#list + 1] = { item = item, name = name, quality = Wire.qualityOfColor(code) }
    end
  end
  return list
end

-- A note fit to send: no pipes (they start escape codes), no control characters, single spaces, at most `limit` bytes, never cut
-- inside a UTF-8 character.
function Wire.cleanNote(text, limit)
  limit = limit or Wire.MAX_NOTE
  text = tostring(text or "")
  text = string.gsub(text, "|", "/")
  text = string.gsub(text, "%c", " ")
  text = string.gsub(text, "%s+", " ")
  text = string.match(text, "^ *(.-) *$")
  if #text > limit then
    local cut = limit
    while cut > 0 do
      local byte = string.byte(text, cut + 1)
      if byte and byte >= 128 and byte < 192 then cut = cut - 1 else break end
    end
    text = string.sub(text, 1, cut)
  end
  return text
end

local function join(...)
  return table.concat({ ... }, SEP)
end

Wire.MAX_NAME = 40 -- bytes in an item's name

-- The offer of item n (of count) for timer seconds, with the item's quality (0 to 5, 1 when unknown) and name. Returns the text, or
-- nil and why.
function Wire.item(sid, n, count, timer, item, quality, name)
  if not ns.Council.isItem(item) then return nil, "not an item" end
  quality = tonumber(quality) or 1
  if quality < 0 or quality > 5 then quality = 1 end
  local text = join("I", Wire.PROTO, sid, n, count, timer, math.floor(quality), item, Wire.cleanNote(name, Wire.MAX_NAME))
  if #text > Wire.MAX then return nil, "too long" end
  return text
end

-- A raider's answer. The note is cleaned and cut to what still fits; gear1 and gear2 (item strings, or nil) are left out when they
-- are not items, and gear2 when the two together leave less than 20 bytes for the note.
function Wire.response(sid, n, code, note, gear1, gear2)
  gear1 = ns.Council.isItem(gear1) and gear1 or ""
  gear2 = ns.Council.isItem(gear2) and gear2 or ""
  local head = join("R", Wire.PROTO, sid, n, code, gear1, gear2, "")
  -- Both items can take 240 bytes: leave the note at least 20, and give up the second item if it would not.
  if #head > Wire.MAX - 20 then
    gear2 = ""
    head = join("R", Wire.PROTO, sid, n, code, gear1, gear2, "")
  end
  return head .. Wire.cleanNote(note, math.min(Wire.MAX_NOTE, Wire.MAX - #head))
end

function Wire.finish(sid) return join("X", Wire.PROTO, sid) end

function Wire.hello(sid, version, class)
  local text = join("K", Wire.PROTO, sid, version)
  if type(class) == "string" and string.match(class, "^%a+$") and #class <= 20 then text = text .. SEP .. class end
  return text
end

-- Announce the version (and class) to the group.
function Wire.announce(version, class)
  local text = join("V", Wire.PROTO, version)
  if type(class) == "string" and string.match(class, "^%a+$") and #class <= 20 then text = text .. SEP .. class end
  return text
end

-- A full version check: everybody answers with a hello carrying `sid`.
function Wire.versionRequest(sid) return join("Q", Wire.PROTO, sid) end

local function inRange(value, low, high)
  return value ~= nil and value >= low and value <= high
end

-- A message as a table with `kind` ("I", "R", "X" or "K") and its fields, or nil and why. A different version gives nil, "other
-- version" and the number. Everything is checked: ranges, item strings, answer codes.
function Wire.decode(text)
  if type(text) ~= "string" or #text > Wire.MAX then return nil, "not a council message" end
  local kind, proto = string.match(text, "^(%a)~(%d+)~")
  if not kind then return nil, "not a council message" end
  if tonumber(proto) ~= Wire.PROTO then return nil, "other version", tonumber(proto) end
  local Council = ns.Council
  if kind == "I" then
    local sid, n, count, timer, quality, item, name = string.match(text, "^I~%d+~(%w+)~(%d+)~(%d+)~(%d+)~(%d)~([^~]+)~(.*)$")
    if not sid then return nil, "bad offer" end
    n, count, timer, quality = tonumber(n), tonumber(count), tonumber(timer), tonumber(quality)
    if #sid > 12 or not inRange(count, 1, Council.MAX_ITEMS) or not inRange(n, 1, count) or not inRange(timer, Council.MIN_TIMER, Council.MAX_TIMER)
      or not inRange(quality, 0, 5) then
      return nil, "bad offer"
    end
    if not Council.isItem(item) then return nil, "bad item" end
    return { kind = "I", sid = sid, n = n, count = count, timer = timer, quality = quality, item = item, name = Wire.cleanNote(name, Wire.MAX_NAME) }
  elseif kind == "R" then
    local sid, n, code, gear1, gear2, note = string.match(text, "^R~%d+~(%w+)~(%d+)~(%a)~([^~]*)~([^~]*)~(.*)$")
    if not sid then return nil, "bad answer" end
    n = tonumber(n)
    if #sid > 12 or not inRange(n, 1, Council.MAX_ITEMS) or not Council.response(code) then return nil, "bad answer" end
    if (gear1 ~= "" and not Council.isItem(gear1)) or (gear2 ~= "" and not Council.isItem(gear2)) then return nil, "bad gear" end
    return {
      kind = "R", sid = sid, n = n, code = code, gear1 = gear1 ~= "" and gear1 or nil, gear2 = gear2 ~= "" and gear2 or nil,
      note = Wire.cleanNote(note),
    }
  elseif kind == "X" then
    local sid = string.match(text, "^X~%d+~(%w+)$")
    if not sid or #sid > 12 then return nil, "bad end" end
    return { kind = "X", sid = sid }
  elseif kind == "K" then
    local sid, version, class = string.match(text, "^K~%d+~(%w+)~([%w%.%-]+)~?(%a*)$")
    if not sid or #sid > 12 or #version > 20 or #class > 20 then return nil, "bad hello" end
    return { kind = "K", sid = sid, version = version, class = class ~= "" and class or nil }
  elseif kind == "V" then
    local version, class = string.match(text, "^V~%d+~([%w%.%-]+)~?(%a*)$")
    if not version or #version > 20 or #class > 20 then return nil, "bad announce" end
    return { kind = "V", version = version, class = class ~= "" and class or nil }
  elseif kind == "Q" then
    local sid = string.match(text, "^Q~%d+~(%w+)$")
    if not sid or #sid > 12 then return nil, "bad request" end
    return { kind = "Q", sid = sid }
  end
  return nil, "unknown message"
end
