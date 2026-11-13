-- The council windows of a loot session: the loot master's window and the answer window, in a practice the loot master runs
-- alone and in a group. The windows are the addon's real code (IntrepidManager/ui/); the models are invented. Invented names only.

local FILES = { "core/Names", "core/Council", "ui/Kit", "ui/SessionPanel", "ui/ResponseFrame" }

return function(story)
  story.describe("Council windows",
    "The loot master's window lists every raider asked: their answer, or Waiting while the session runs and No response after it. "
    .. "Hide no response leaves those rows out. The status line counts the responses logged. In the answer window each item has "
    .. "its own note: Add note opens a small box, and the note shows under the buttons.")

  local function item(n, name, quality, change)
    local data = { n = n, item = "item:" .. (900100 + n), name = name, quality = quality, icon = 134400, counts = { b = 0, u = 0, o = 0, p = 0, total = 0 } }
    for key, value in pairs(change or {}) do data[key] = value end
    return data
  end

  local ITEMS = {
    item(1, "Fixture Bracers of Spirit", 2, { counts = { b = 1, u = 0, o = 0, p = 0, total = 1 }, asked = 1 }),
    item(2, "Lesser Test Potion", 1, { asked = 1 }),
    item(3, "Elixir of Minor Lorem", 1, { asked = 1 }),
  }

  local function panel(model, answers, options)
    local game = story.reset({})
    local ns = {}
    for _, file in ipairs(FILES) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
    local kit = ns.UI.Kit.new(options or {})
    local window = ns.UI.SessionPanel.new(kit, { model = function() return model end, rows = function(n) return answers[n] or {} end })
    window.update(model)
    window.show()
    return window, game
  end

  panel({ state = "running", timer = 60, remaining = 43, practice = true, answers = 1, expected = 3, responders = 1, group = 0, items = ITEMS },
    { [1] = { { who = "(you)", code = "b", label = "Best in slot", note = "lol" } } })
  story.snap("A practice, running: the loot master answered item 1 and the counter says 1/3 responses logged")

  local window = panel({ state = "closed", timer = 60, practice = true, answers = 1, expected = 3, responders = 1, group = 0, items = ITEMS },
    { [2] = { { who = "(you)", label = "No response", note = "", missing = true } } })
  window.parts.leftRows[2].frame:GetScript("OnClick")(window.parts.leftRows[2].frame)
  story.snap("After the session: an item nobody answered says No response instead of staying blank")

  local raid = {}
  for i, entry in ipairs({ { "Mirelle Dunmore", "b", "Best in slot", "PRIEST", "my last piece" }, { "Tavian Holt", "u", "Upgrade", "WARRIOR", "" },
      { "Orla Fenwick", "p", "Pass", "MAGE", "" } }) do
    raid[i] = { who = entry[1], code = entry[2], label = entry[3], class = entry[4], note = entry[5] }
  end
  for _, who in ipairs({ { "Brannoc Vale", "HUNTER" }, { "Seren Ashby", "DRUID" } }) do
    raid[#raid + 1] = { who = who[1], label = "Waiting", note = "", class = who[2], missing = true }
  end
  local groupItems = {
    item(1, "Fixture Bracers of Spirit", 4, { counts = { b = 1, u = 1, o = 0, p = 1, total = 3 }, asked = 5 }),
    item(2, "Crown of the Lorem Ones", 4, { counts = { b = 0, u = 2, o = 0, p = 0, total = 2 }, asked = 5 }),
  }
  local groupModel = { state = "running", timer = 90, remaining = 61, answers = 5, expected = 10, responders = 3, hellos = 4, group = 5, items = groupItems }
  panel(groupModel, { [1] = raid })
  story.snap("In a group: three answers and two raiders still Waiting; 5/10 responses logged, so the loot master can end it early")

  window = panel(groupModel, { [1] = raid })
  window.parts.hideMissing:SetChecked(true)
  window.parts.hideMissing:GetScript("OnClick")(window.parts.hideMissing)
  story.snap("Hide no response ticked: only the answers")

  -- the answer window
  local function offers(rows, options)
    local game = story.reset({})
    local ns = {}
    for _, file in ipairs(FILES) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
    local kit = ns.UI.Kit.new(options or {})
    local frame = ns.UI.ResponseFrame.new(kit, { model = function() return { master = "you", rows = rows } end })
    frame.update({ master = "you", rows = rows })
    frame.show()
    return frame, game
  end
  local function offer(n, name, quality, change)
    local data = { sid = "k3f9", n = n, count = 3, item = "item:" .. (900100 + n), name = name, quality = quality, icon = 134400, remaining = 42, state = "open" }
    for key, value in pairs(change or {}) do data[key] = value end
    return data
  end
  local ROWS = {
    offer(1, "Fixture Bracers of Spirit", 2, { state = "answered", myCode = "b", myLabel = "Best in slot", note = "lol" }),
    offer(2, "Lesser Test Potion", 1, { note = "for my alt" }),
    offer(3, "Elixir of Minor Lorem", 1),
  }
  offers(ROWS)
  story.snap("The answer window: each item has its own note; one sent with its answer, one waiting for the answer")

  local frame = offers(ROWS)
  frame.parts.rows[1].noteButton:GetScript("OnClick")(frame.parts.rows[1].noteButton)
  story.snap("Edit note: the box for that item's note; Save sends the answer again with it")

  offers(ROWS, { density = "roomy" })
  story.snap("The answer window roomy")
end
