-- Draws the storyboards into build/pictures (not kept in git): one page per picture, index.html with all of them, and
-- artifact.html, the same page without the document around it, for the Artifact tool. Run it from the repository root:
--
--   lua5.1 tests/storyboards.lua            every storyboard in tests/storyboards/
--   lua5.1 tests/storyboards.lua demo       the named ones
--
-- It exits with an error if a storyboard raises one, which is also how it checks that the windows still build.

local Storyboard = dofile("tests/support/storyboard.lua")
local Pictures = dofile("tests/support/pictures.lua")

local OUT = "build/pictures"

local function mkdir(path)
  if string.sub(package.config, 1, 1) == "\\" then
    os.execute('mkdir "' .. string.gsub(path, "/", "\\") .. '" 2>nul')
  else
    os.execute('mkdir -p "' .. path .. '"')
  end
end

local function storyboardNames()
  if #arg > 0 then return arg end
  local names = {}
  local list = io.popen("ls tests/storyboards/*.lua")
  for file in list:lines() do names[#names + 1] = string.match(file, "([^/]+)%.lua$") end
  list:close()
  return names
end

local sections, failed = {}, false
for _, name in ipairs(storyboardNames()) do
  local story = Storyboard.new(name)
  local ok, err = pcall(function() dofile("tests/storyboards/" .. name .. ".lua")(story) end)
  if not ok then
    failed = true
    print("FAIL  storyboard " .. name .. "\n      " .. tostring(err))
  else
    mkdir(OUT .. "/" .. name)
    local notes = 0
    for index, shot in ipairs(story.shots) do
      local file = string.format("%s/%s/%02d-%s.html", OUT, name, index, Pictures.slug(shot.caption))
      Pictures.write(file, Pictures.document(shot, shot.caption))
      notes = notes + #shot.picture.warnings
    end
    sections[#sections + 1] = { id = name, title = story.title, text = story.text, shots = story.shots }
    print(string.format("%s: %d pictures, %d things to check", name, #story.shots, notes))
  end
end

if #sections > 0 then
  local options = {
    title = "Intrepid Window Pictures",
    lede = "What the addon's windows would show in the game, drawn from the Lua the addon runs, on stand-in widgets. "
      .. "Layout, wording, colors and states come from the code; fonts and Blizzard's art are approximations.",
    legend = "<b>How to read these.</b> Text sizes are estimates, the stock frame, buttons and close button are look-alikes drawn "
      .. "with CSS, and item icons are placeholders. Notes under a picture list what to check (a window partly off the "
      .. "screen, a widget with no anchor) and which guesses about Blizzard's templates the picture relies on. "
      .. "The first look at the real thing is in the game.",
    footer = "Made by <code>lua5.1 tests/storyboards.lua</code> from <code>tests/storyboards/</code>.",
  }
  mkdir(OUT)
  options.document = true
  Pictures.write(OUT .. "/index.html", Pictures.page(sections, options))
  options.document = false
  Pictures.write(OUT .. "/artifact.html", Pictures.page(sections, options))
  print("pages written to " .. OUT)
end
os.exit(failed and 1 or 0)
