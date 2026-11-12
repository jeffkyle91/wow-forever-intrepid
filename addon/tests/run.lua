-- Plain Lua 5.1 test runner. Run from the repository root:  lua5.1 tests/run.lua
-- Picks up every tests/*_test.lua. Test files use these helpers:
--   test(name, fn)         one test; a failing test is reported and the run goes on
--   eq(actual, expected)   same value (tables by identity)
--   is_true(value)         exactly true
--   deep_eq(actual, expected)  same contents, tables compared key by key
--   read_file(path)        a whole file, byte for byte (so CR LF stays as written)
--   apply_edit(model, edit) one edit of docs/spec/fixtures/content-cases.json or marks-cases.json on a decoded model
--   load_core(ns, ...)     load IntrepidManager/core/<Name>.lua files into ns, in the order given

local passed, failed = 0, 0

function test(name, fn)
  local ok, err = pcall(fn)
  if ok then
    passed = passed + 1
  else
    failed = failed + 1
    print("FAIL  " .. name .. "\n      " .. tostring(err))
  end
end

function eq(actual, expected)
  if actual ~= expected then
    error("expected " .. tostring(expected) .. ", got " .. tostring(actual), 2)
  end
end

function is_true(value)
  if value ~= true then error("expected true, got " .. tostring(value), 2) end
end

local function same(actual, expected, path)
  if type(actual) ~= type(expected) then
    return false, path .. ": expected " .. type(expected) .. ", got " .. type(actual)
  end
  if type(actual) ~= "table" then
    if actual ~= expected then
      return false, path .. ": expected " .. tostring(expected) .. ", got " .. tostring(actual)
    end
    return true
  end
  for key, value in pairs(expected) do
    local ok, why = same(actual[key], value, path .. "." .. tostring(key))
    if not ok then return false, why end
  end
  for key in pairs(actual) do
    if expected[key] == nil then return false, path .. "." .. tostring(key) .. ": not expected" end
  end
  return true
end

function deep_eq(actual, expected)
  local ok, why = same(actual, expected, "value")
  if not ok then error(why, 2) end
end

function read_file(path)
  local handle = assert(io.open(path, "rb"))
  local text = handle:read("*a")
  handle:close()
  return text
end

-- One edit of the shared fixtures on a decoded model: ["set", path, value], ["delete", path] or ["append", path, value].
-- A path holds keys and 1-based list positions, as in the names of row errors ("roster:3" is ["roster", 3]).
function apply_edit(model, edit)
  local op, path = edit[1], edit[2]
  local target = model
  for position = 1, #path - 1 do target = target[path[position]] end
  local last = path[#path]
  if op == "set" then
    target[last] = edit[3]
  elseif op == "append" then
    local list = target[last]
    list[#list + 1] = edit[3]
  elseif op == "delete" then
    if type(last) == "number" then table.remove(target, last) else target[last] = nil end
  else
    error("unknown edit " .. tostring(op), 2)
  end
end

-- Load an addon file the way the client does: the chunk receives (addon name, shared table).
function load_addon_file(path, ns)
  ns = ns or {}
  local chunk = assert(loadfile(path))
  chunk("IntrepidManager", ns)
  return ns
end

function load_core(ns, ...)
  for _, name in ipairs({ ... }) do
    load_addon_file("IntrepidManager/core/" .. name .. ".lua", ns)
  end
  return ns
end

local list = io.popen("ls tests/*_test.lua")
for file in list:lines() do dofile(file) end
list:close()

print(string.format("%d passed, %d failed", passed, failed))
os.exit(failed == 0 and 0 or 1)
