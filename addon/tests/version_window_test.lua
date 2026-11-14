-- The version window (IntrepidManager/ui/VersionWindow.lua) on the strict stand-in widgets. Invented names only.

local UI = dofile("tests/support/strict_ui.lua")
local StockTemplates = dofile("tests/support/stock_templates.lua")
local Intact = dofile("tests/support/intact.lua")

local FILES = { "ui/Kit", "ui/VersionWindow" }

local function row(who, kind, version, class, change)
  local data = { who = who, class = class, me = false, status = kind, version = version, kind = kind }
  if version then data.status = "ok" end
  for key, value in pairs(change or {}) do data[key] = value end
  return data
end

local function summary(rows)
  local counts = { same = 0, older = 0, newer = 0, other = 0, waiting = 0, missing = 0, offline = 0, unchecked = 0 }
  for _, entry in ipairs(rows) do counts[entry.kind] = counts[entry.kind] + 1 end
  return counts
end

-- A model: me first, then the members given.
local function model(members, change)
  local rows = { row("Jorren Ashvale", "same", "0.0.15", "WARRIOR", { me = true }) }
  for _, member in ipairs(members or {}) do rows[#rows + 1] = member end
  local data = { mine = "0.0.15", checked = true, waiting = false, rows = rows, summary = summary(rows) }
  for key, value in pairs(change or {}) do data[key] = value end
  return data
end

local function setup(options)
  options = options or {}
  local game = StockTemplates.install(UI.new())
  local scene = { game = game, calls = {}, errors = {}, model = options.model or model() }
  local ns = {}
  for _, file in ipairs(FILES) do game.load("IntrepidManager/" .. file .. ".lua", ns) end
  scene.ns = ns
  scene.kit = ns.UI.Kit.new({ density = options.density, onError = function(err) scene.errors[#scene.errors + 1] = tostring(err) end })
  scene.window = ns.UI.VersionWindow.new(scene.kit, {
    model = function()
      scene.calls[#scene.calls + 1] = { "model" }
      if type(scene.model) == "function" then return scene.model() end
      return scene.model
    end,
    check = function() scene.calls[#scene.calls + 1] = { "check" } end,
  })
  scene.parts = scene.window.parts
  return scene
end

local function state(scene, widget) return scene.game.state(widget) end
local function text(scene, widget) return state(scene, widget).text end
local function shown(scene, widget) return scene.game.visible(widget) end
local function press(scene, widget) scene.game.fire(widget, "OnClick", "LeftButton") end
local function color(scene, widget) local c = state(scene, widget).textColor return { c[1], c[2], c[3] } end
local function shade(scene, name) local c = scene.kit.colors[name] return { c[1], c[2], c[3] } end

test("the sentences: the counts, nobody else, and the word in each row", function()
  local VersionWindow = setup().ns.UI.VersionWindow
  eq(VersionWindow.statusText(model()), "Nobody else is in your group.")
  eq(VersionWindow.statusText(nil), "Nobody else is in your group.")
  local members = { row("Mirelle Dunmore", "same", "0.0.15"), row("Tavian Holt", "older", "0.0.13"), row("Kessa Drummond", "missing"), row("Orla Finch", "missing") }
  eq(VersionWindow.statusText(model(members)), "2 same - 1 older - 2 not installed")
  members = { row("Mirelle Dunmore", "waiting"), row("Tavian Holt", "newer", "0.0.16"), row("Kessa Drummond", "offline"), row("Orla Finch", "unchecked") }
  eq(VersionWindow.statusText(model(members, { waiting = true })), "1 same - 1 newer - 1 waiting - 1 offline - 1 not asked")
  eq(VersionWindow.stateText(row("A", "same", "0.0.15", nil, { me = true })), "you")
  eq(VersionWindow.stateText(row("A", "same", "0.0.15")), "same version")
  eq(VersionWindow.stateText(row("A", "older", "0.0.13")), "older")
  eq(VersionWindow.stateText(row("A", "newer", "0.0.16")), "newer - update")
  eq(VersionWindow.stateText(row("A", "missing")), "not installed")
  eq(VersionWindow.stateText(row("A", "waiting")), "waiting...")
  eq(VersionWindow.stateText(row("A", "offline")), "offline")
  eq(VersionWindow.stateText(row("A", "unchecked")), "not asked yet")
  eq(VersionWindow.stateText({ status = "ok" }), "")
end)

test("a line for each member: the class picture, the name in the color of the class, the version and how it stands to yours", function()
  local members = {
    row("Mirelle Dunmore", "same", "0.0.15", "MAGE"), row("Tavian Holt", "older", "0.0.13", "PRIEST"), row("Orla Finch", "newer", "0.0.16", "DEATHKNIGHT"),
    row("Kessa Drummond", "missing", nil, "HUNTER"), row("Brannoch Veil", "waiting"),
  }
  local scene = setup({ model = model(members) })
  scene.window.show()
  local rows = scene.parts.rows
  eq(#rows, 6)
  eq(text(scene, scene.parts.mine), "You have 0.0.15")
  eq(text(scene, rows[1].who), "Jorren Ashvale")
  eq(text(scene, rows[1].state), "you")
  eq(state(scene, rows[1].classIcon).texture, "Interface\\Icons\\ClassIcon_Warrior")
  deep_eq(color(scene, rows[1].who), { 0.78, 0.61, 0.43 })
  eq(text(scene, rows[2].who), "Mirelle Dunmore")
  deep_eq(color(scene, rows[2].who), { 0.41, 0.8, 0.94 })
  eq(text(scene, rows[2].version), "0.0.15")
  eq(text(scene, rows[2].state), "same version")
  deep_eq(color(scene, rows[2].version), shade(scene, "good"))
  eq(text(scene, rows[3].state), "older")
  deep_eq(color(scene, rows[3].state), shade(scene, "warn"))
  eq(text(scene, rows[4].state), "newer - update")
  deep_eq(color(scene, rows[4].state), shade(scene, "gold"))
  eq(shown(scene, rows[4].classIcon), false) -- a class whose picture was not seen to draw
  eq(text(scene, rows[5].version), "-")
  eq(text(scene, rows[5].state), "not installed")
  deep_eq(color(scene, rows[5].state), shade(scene, "bad"))
  eq(text(scene, rows[6].state), "waiting...")
  deep_eq(color(scene, rows[6].state), shade(scene, "muted"))
  eq(shown(scene, rows[6].classIcon), false) -- (no class known)
  eq(text(scene, scene.parts.status), "2 same - 1 older - 1 newer - 1 waiting - 1 not installed")
  eq(text(scene, scene.parts.headState), "STATE")
end)

test("a newer version in the group asks for an update, else the line is not there", function()
  local scene = setup({ model = model({ row("Mirelle Dunmore", "same", "0.0.15") }) })
  scene.window.show()
  eq(shown(scene, scene.parts.warning), false)
  scene.window.update(model({ row("Mirelle Dunmore", "same", "0.0.15"), row("Tavian Holt", "newer", "0.0.16") }))
  eq(shown(scene, scene.parts.warning), true)
  is_true(string.find(text(scene, scene.parts.warning), "Please update", 1, true) ~= nil)
  scene.window.update(model({ row("Mirelle Dunmore", "same", "0.0.15") }))
  eq(shown(scene, scene.parts.warning), false)
end)

test("alone in the group the window says so and has no state column; a shorter group hides the lines left over", function()
  local scene = setup()
  scene.window.show()
  eq(text(scene, scene.parts.status), "Nobody else is in your group.")
  eq(text(scene, scene.parts.headState), "")
  scene.window.update(model({ row("Mirelle Dunmore", "same", "0.0.15"), row("Tavian Holt", "older", "0.0.13") }))
  eq(#scene.parts.rows, 3)
  scene.window.update(model({ row("Mirelle Dunmore", "same", "0.0.15") }))
  eq(shown(scene, scene.parts.rows[2].frame), true)
  eq(shown(scene, scene.parts.rows[3].frame), false)
end)

test("Check again asks and reads the answers again; the list is read every second while the window is shown and not once it is hidden", function()
  local scene = setup()
  local start = scene.game.clock
  scene.model = function()
    local answered = scene.game.clock - start >= 2
    return model({ answered and row("Mirelle Dunmore", "same", "0.0.15") or row("Mirelle Dunmore", "waiting") }, { waiting = not answered })
  end
  scene.window.show()
  eq(text(scene, scene.parts.rows[2].state), "waiting...")
  eq(text(scene, scene.parts.status), "1 same - 1 waiting")
  eq(text(scene, scene.parts.groupHead), "ASKING THE GROUP...")
  scene.game.advance(1)
  eq(text(scene, scene.parts.rows[2].state), "waiting...")
  scene.game.advance(1.5)
  eq(text(scene, scene.parts.rows[2].state), "same version")
  eq(text(scene, scene.parts.status), "2 same")
  eq(text(scene, scene.parts.groupHead), "YOUR GROUP")
  scene.calls = {}
  press(scene, scene.parts.check)
  deep_eq(scene.calls, { { "check" }, { "model" } })
  scene.window.hide()
  local before = #scene.calls
  scene.game.advance(10)
  eq(#scene.calls, before)
  eq(#scene.errors, 0)
end)

test("a long group scrolls: forty members take forty lines of the list", function()
  local members = {}
  for i = 1, 39 do members[i] = row("Raider Number " .. i, "same", "0.0.15", "MAGE") end
  local scene = setup({ model = model(members) })
  scene.window.show()
  eq(#scene.parts.rows, 40)
  eq(scene.parts.list.height, 40 * scene.window.metrics.rowHeight)
  is_true(scene.parts.list.height > scene.parts.list.view)
end)

test("the window holds together for any group: inside, no text too wide, no controls overlapping (compact and roomy)", function()
  for _, density in ipairs({ "compact", "roomy" }) do
    for _, count in ipairs({ 0, 1, 5, 14, 39 }) do
      local members = {}
      local kinds = { "older", "newer", "missing", "offline", "unchecked", "waiting", "same" }
      for i = 1, count do
        local kind = kinds[i % #kinds + 1]
        local hasVersion = kind == "older" or kind == "newer" or kind == "same"
        members[i] = row("A Raider With A Rather Long Name " .. i, kind, hasVersion and "0.0.15-beta.2" or nil, "PRIEST")
      end
      local scene = setup({ density = density, model = model(members, { waiting = true }) })
      scene.window.show()
      local problems = Intact.problems(scene.game, scene.window.frame)
      if #problems > 0 then print(density, count, table.concat(problems, "\n")) end
      deep_eq(problems, {})
    end
  end
end)
