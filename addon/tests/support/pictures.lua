-- Pictures of what the strict stand-in widgets would show: HTML drawn from the widgets' anchors, sizes, text, colors
-- and textures, positioned by tests/support/layout.lua. The window code that builds the widgets is the real code, so
-- a picture shows layout, wording, colors and states; it cannot show how the game draws a font or Blizzard's art.
-- Those are approximated (see the CSS below and the notes under each picture) and the notes say what was assumed.
--
--   local Pictures = dofile("tests/support/pictures.lua")
--   local picture = Pictures.render(game, { crop = "content" })   -- { html, width, height, warnings, assumptions }
--   Pictures.page(sections, { title = "...", document = true })    -- a whole page of pictures with captions
--
-- What is drawn: shown frames and regions in the game's order (strata, level, creation order; draw layers inside a
-- frame; highlight textures are left out as they appear only under the mouse), clipped by scroll frames and frames that
-- clip children; frame backdrops; textures (colors, WHITE8X8 with a vertex color, gradients, anything else as a placeholder);
-- font strings with the game's alignment rules and escapes; button, edit box, check box and status bar contents; and the
-- stock templates as CSS look-alikes.

local Layout = dofile("tests/support/layout.lua")

local Pictures = {}

local STRATA = { WORLD = 0, BACKGROUND = 1, LOW = 2, MEDIUM = 3, HIGH = 4, DIALOG = 5, FULLSCREEN = 6, FULLSCREEN_DIALOG = 7, TOOLTIP = 8 }
local LAYER = { BACKGROUND = 1, BORDER = 2, ARTWORK = 3, OVERLAY = 4, HIGHLIGHT = 5 }

-- The stock templates the pictures know how to draw, as CSS classes below.
local LOOKS = {
  BasicFrameTemplate = "lk-dialog", BasicFrameTemplateWithInset = "lk-dialog", DialogBoxFrame = "lk-dialog",
  UIPanelDialogTemplate = "lk-dialog", UIPanelButtonTemplate = "lk-button", UIPanelButtonGrayTemplate = "lk-button lk-gray",
  UIPanelCloseButton = "lk-close", InputBoxTemplate = "lk-input", UICheckButtonTemplate = "lk-check",
  ChatConfigCheckButtonTemplate = "lk-check", TooltipBackdropTemplate = "lk-tooltip",
}

local function number(n)
  local text = string.format("%.2f", n)
  text = string.gsub(text, "%.?0+$", "")
  if text == "" or text == "-" or text == "-0" then text = "0" end
  return text
end

local function escape(text)
  text = string.gsub(text, "&", "&amp;")
  text = string.gsub(text, "<", "&lt;")
  text = string.gsub(text, ">", "&gt;")
  return (string.gsub(text, '"', "&quot;"))
end

-- A color given as { r, g, b, a } or as a color object with r, g, b and a fields.
local function colorOf(c)
  return { c[1] or c.r or 1, c[2] or c.g or 1, c[3] or c.b or 1, c[4] or c.a or 1 }
end

local function clamp(x)
  if x < 0 then return 0 end
  if x > 1 then return 1 end
  return x
end

local function rgba(c, alphaScale)
  c = colorOf(c)
  return string.format("rgba(%d,%d,%d,%s)", math.floor(clamp(c[1]) * 255 + 0.5), math.floor(clamp(c[2]) * 255 + 0.5),
    math.floor(clamp(c[3]) * 255 + 0.5), number(clamp(c[4] * (alphaScale or 1))))
end

local function tint(c, by)
  if not by then return colorOf(c) end
  c, by = colorOf(c), colorOf(by)
  return { c[1] * by[1], c[2] * by[2], c[3] * by[3], c[4] * by[4] }
end

local function hueOf(text)
  local hash = 0
  for i = 1, #text do hash = (hash * 31 + string.byte(text, i)) % 360 end
  return hash
end

-- What a texture shows: a css background (or nil: it shows nothing), an extra class and a title for the placeholder.
local function textureFill(st)
  if st.color then return "background:" .. rgba(tint(st.color, st.vertexColor)), nil, nil end
  if st.gradient then
    local low, high = st.gradient[2], st.gradient[3]
    if type(low) == "table" and type(high) == "table" then
      local direction = st.gradient[1] == "HORIZONTAL" and "90deg" or "0deg"
      return "background:linear-gradient(" .. direction .. "," .. rgba(low) .. "," .. rgba(high) .. ")", nil, nil
    end
  end
  local texture = st.texture
  if texture ~= nil then
    if type(texture) == "string" and string.find(string.lower(texture), "white8x8", 1, true) then
      return "background:" .. rgba(st.vertexColor or { 1, 1, 1, 1 }), nil, nil
    end
    local name = tostring(texture)
    return string.format("background:hsl(%d,28%%,30%%)", hueOf(name)), "ph", name
  end
  if st.atlas then return string.format("background:hsl(%d,28%%,30%%)", hueOf(st.atlas)), "ph", st.atlas end
  return nil
end

local function runsHtml(line, scale)
  local parts = {}
  for _, run in ipairs(line.runs) do
    if run.icon then
      local width = (run.icon.width > 0 and run.icon.width or 12) * scale
      local height = (run.icon.height > 0 and run.icon.height or 12) * scale
      parts[#parts + 1] = string.format('<i class="ic" style="width:%spx;height:%spx"></i>', number(width), number(height))
    elseif run.color then
      parts[#parts + 1] = '<span style="color:' .. rgba(run.color) .. '">' .. escape(run.text) .. "</span>"
    else
      parts[#parts + 1] = escape(run.text)
    end
  end
  return table.concat(parts)
end

-- One picture of the screen as the widgets stand now. options.crop: "content" (the shown windows and a margin,
-- the default) or "screen"; options.padding: the margin in pixels.
function Pictures.render(game, options)
  options = options or {}
  local layout = Layout.new(game)
  local state = game.state
  local screenHeight = game.screen.height
  local ROOT = {}
  local out, warnings, usedAssumptions = {}, {}, {}

  local function clips(frame)
    return state(frame).clips or state(frame).kind == "ScrollFrame"
  end

  local function containerOf(frame)
    local up = state(frame).parent
    while up do
      if clips(up) then return up end
      up = state(up).parent
    end
    return nil
  end

  -- shown frames, grouped by the frame that clips them
  local groups, windows = {}, {}
  for index, frame in ipairs(game.frames) do
    if index > 1 and layout.visible(frame) then
      local key = containerOf(frame) or ROOT
      groups[key] = groups[key] or {}
      groups[key][#groups[key] + 1] = { frame = frame, index = index }
      if state(frame).parent == game.env.UIParent then windows[#windows + 1] = frame end
    end
  end

  -- the part of the screen to show
  local minX, minY, maxX, maxY
  for _, frame in ipairs(windows) do
    local rect = layout.rect(frame)
    local top, bottom = screenHeight - rect.top, screenHeight - rect.bottom
    minX = math.min(minX or rect.left, rect.left)
    maxX = math.max(maxX or rect.right, rect.right)
    minY = math.min(minY or top, top)
    maxY = math.max(maxY or bottom, bottom)
    if rect.left < 0 or rect.bottom < 0 or rect.right > game.screen.width or rect.top > screenHeight then
      warnings[#warnings + 1] = layout.describe(frame) .. " is partly off the screen"
    end
  end
  local padding = options.padding or 12
  local cropLeft, cropTop, width, height
  if options.crop == "screen" or not minX then
    cropLeft, cropTop, width, height = 0, 0, game.screen.width, screenHeight
  else
    cropLeft, cropTop = minX - padding, minY - padding
    width, height = (maxX - minX) + 2 * padding, (maxY - minY) + 2 * padding
  end

  local function place(rect, ox, oy)
    return string.format("left:%spx;top:%spx;width:%spx;height:%spx", number(rect.left - ox),
      number((screenHeight - rect.top) - oy), number(rect.width), number(rect.height))
  end

  -- Lines of text inside a box, aligned the way the game aligns them (font strings default to centered both ways).
  local function emitText(widget, rect, justifyH, justifyV, ox, oy, insets)
    local info = layout.text(widget)
    local st = state(widget)
    local scale = info.scale or 1
    local lineHeight = info.lineHeight * scale
    local total = #info.lines * lineHeight
    local left = rect.left + (insets and insets[1] or 0)
    local right = rect.right
    local boxTop = screenHeight - rect.top + (insets and insets[3] or 0)
    local boxHeight = rect.height - (insets and insets[3] or 0) - (insets and insets[4] or 0)
    local first
    if justifyV == "TOP" then
      first = boxTop
    elseif justifyV == "BOTTOM" then
      first = boxTop + boxHeight - total
    else
      first = boxTop + (boxHeight - total) / 2
    end
    local classes = "x"
    if info.flags and string.find(info.flags, "THICKOUTLINE", 1, true) then
      classes = classes .. " ol2"
    elseif info.flags and string.find(info.flags, "OUTLINE", 1, true) then
      classes = classes .. " ol"
    end
    if st.shadowColor then classes = classes .. " sh" end
    local alpha = layout.alpha(widget)
    for i, line in ipairs(info.lines) do
      local lineWidth = line.width * scale
      local x
      if justifyH == "LEFT" then
        x = left
      elseif justifyH == "RIGHT" then
        x = right - lineWidth
      else
        x = left + (right - left - lineWidth) / 2
      end
      local html = runsHtml(line, scale)
      if html ~= "" then
        out[#out + 1] = string.format('<div class="%s" style="left:%spx;top:%spx;height:%spx;line-height:%spx;font-size:%spx;color:%s;opacity:%s">%s</div>',
          classes, number(x - ox), number(first + (i - 1) * lineHeight - oy), number(lineHeight), number(lineHeight),
          number(info.size * scale), rgba(info.color), number(alpha), html)
      end
    end
  end

  local function emitRegion(region, ox, oy)
    local st = state(region)
    local rect = layout.rect(region)
    if st.kind == "Texture" then
      local fill, class, title = textureFill(st)
      if fill and rect.width > 0 and rect.height > 0 then
        local style = place(rect, ox, oy) .. ";" .. fill
        local alpha = layout.alpha(region)
        if alpha < 1 then style = style .. ";opacity:" .. number(alpha) end
        if st.desaturated then style = style .. ";filter:grayscale(1)" end
        if st.blendMode == "ADD" then style = style .. ";mix-blend-mode:plus-lighter" end
        out[#out + 1] = string.format('<div class="t%s" style="%s"%s></div>', class and (" " .. class) or "", style,
          title and (' title="' .. escape(title) .. '"') or "")
      end
    elseif st.kind == "FontString" and st.text and st.text ~= "" then
      emitText(region, rect, st.justifyH or "CENTER", st.justifyV or "MIDDLE", ox, oy)
    end
  end

  local function emitFrame(frame, ox, oy)
    local st = state(frame)
    local rect = layout.rect(frame)
    local classes, styles = { "w" }, { place(rect, ox, oy) }
    local boxed = false
    for _, template in ipairs(st.templates) do
      if LOOKS[template] then
        classes[#classes + 1] = LOOKS[template]
        boxed = true
      end
      if game.assumptions and game.assumptions[template] then usedAssumptions[template] = game.assumptions[template] end
    end
    if st.look then
      classes[#classes + 1] = "lk-" .. st.look
      boxed = true
    end
    if st.kind == "StatusBar" then
      classes[#classes + 1] = "lk-bar"
      boxed = true
    end
    if st.kind == "CheckButton" and st.checked then classes[#classes + 1] = "on" end
    if (st.kind == "Button" or st.kind == "CheckButton") and st.enabled == false then classes[#classes + 1] = "off" end
    if st.backdrop or st.backdropColor then
      local backdrop = st.backdrop or {}
      local c = st.backdropColor and colorOf(st.backdropColor) or { 1, 1, 1, 1 }
      if backdrop.bgFile and not string.find(string.lower(backdrop.bgFile), "white8x8", 1, true) then
        c = { c[1] * 0.1, c[2] * 0.09, c[3] * 0.07, c[4] * 0.92 } -- art we cannot draw: a dark stand-in, tinted
      end
      if backdrop.bgFile or st.backdropColor then styles[#styles + 1] = "background:" .. rgba(c) end
      if backdrop.edgeFile then
        local size = math.max(backdrop.edgeSize or 1, 1)
        styles[#styles + 1] = "border:" .. number(size) .. "px solid " .. rgba(st.backdropBorderColor or { 1, 1, 1, 1 })
      end
      boxed = true
    end
    local alpha = layout.alpha(frame)
    if alpha < 1 then styles[#styles + 1] = "opacity:" .. number(alpha) end
    if boxed then
      out[#out + 1] = '<div class="' .. table.concat(classes, " ") .. '" style="' .. table.concat(styles, ";") .. '"></div>'
    end

    local regions = {}
    for index, region in ipairs(st.regions) do
      local rs = state(region)
      if rs.layer ~= "HIGHLIGHT" and layout.visible(region) then
        regions[#regions + 1] = { region = region, layer = LAYER[rs.layer] or 3, sublevel = rs.sublevel or 0, index = index }
      end
    end
    table.sort(regions, function(a, b)
      if a.layer ~= b.layer then return a.layer < b.layer end
      if a.sublevel ~= b.sublevel then return a.sublevel < b.sublevel end
      return a.index < b.index
    end)
    for _, item in ipairs(regions) do emitRegion(item.region, ox, oy) end

    if st.kind == "Button" and st.text and st.text ~= "" then
      emitText(frame, rect, "CENTER", "MIDDLE", ox, oy)
    elseif st.kind == "EditBox" and st.text and st.text ~= "" then
      emitText(frame, rect, "LEFT", st.multiLine and "TOP" or "MIDDLE", ox, oy, st.textInsets or Layout.EDIT_INSETS)
    elseif st.kind == "StatusBar" and st.max and st.max > (st.min or 0) then
      local ratio = clamp(((st.value or 0) - (st.min or 0)) / (st.max - (st.min or 0)))
      local fill = { left = rect.left, bottom = rect.bottom, top = rect.top, width = rect.width * ratio, height = rect.height }
      out[#out + 1] = string.format('<div class="bar-fill" style="%s"></div>', place(fill, ox, oy))
    end
  end

  local function byOrder(a, b)
    local sa, sb = STRATA[state(a.frame).strata] or 3, STRATA[state(b.frame).strata] or 3
    if sa ~= sb then return sa < sb end
    local la, lb = state(a.frame).level, state(b.frame).level
    if la ~= lb then return la < lb end
    return a.index < b.index
  end

  local function emitContainer(container, ox, oy)
    local list = groups[container] or {}
    table.sort(list, byOrder)
    for _, item in ipairs(list) do
      emitFrame(item.frame, ox, oy)
      if clips(item.frame) then
        local rect = layout.rect(item.frame)
        out[#out + 1] = '<div class="clip" style="' .. place(rect, ox, oy) .. '">'
        emitContainer(item.frame, rect.left, screenHeight - rect.top)
        out[#out + 1] = "</div>"
      end
    end
  end

  emitContainer(ROOT, cropLeft, cropTop)

  for _, warning in ipairs(layout.warnings) do warnings[#warnings + 1] = warning end
  local assumptions = {}
  for _, note in pairs(usedAssumptions) do assumptions[#assumptions + 1] = note end
  table.sort(assumptions)
  return {
    html = string.format('<div class="screen" style="width:%spx;height:%spx">%s</div>', number(width), number(height),
      table.concat(out, "\n")),
    width = width, height = height, warnings = warnings, assumptions = assumptions, shapes = #out,
  }
end

---------------------------------------------------------------------------------------------------------------
-- Pages
---------------------------------------------------------------------------------------------------------------

local STAGE_CSS = [==[
.stagewrap{overflow-x:auto;width:fit-content;max-width:100%;border:1px solid var(--stage-edge);border-radius:6px;background:#07090a}
.screen{position:relative;overflow:hidden;font-family:var(--game);background:radial-gradient(900px 420px at 18% 0%,#1d2d22 0,transparent 62%),radial-gradient(700px 420px at 100% 100%,#2f2316 0,transparent 58%),#0a0d0a}
.screen .w,.screen .t,.screen .x,.screen .clip,.screen .bar-fill{position:absolute;box-sizing:border-box}
.screen .x{white-space:pre;font-weight:400}
.screen .x.ol{text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000}
.screen .x.ol2{text-shadow:-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,2px 2px 0 #000}
.screen .x.sh{text-shadow:1px -1px 0 #000}
.screen .clip{overflow:hidden}
.screen .ic{display:inline-block;vertical-align:middle;background:#44464c;border:1px solid #000;box-sizing:border-box}
.screen .ph{border:1px solid rgba(0,0,0,.65);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
.screen .bar-fill{background:#2fbf4a}
.lk-dialog{background:rgba(5,5,8,.95);border:4px solid transparent;border-image:linear-gradient(135deg,#e6c878,#8a6a28 34%,#f2dc96 52%,#6e5019 70%,#c9a24e) 1;box-shadow:0 0 0 1px #000}
.lk-inset{background:rgba(0,0,0,.78);border:1px solid #6c6c72;border-radius:3px}
.lk-button{background:linear-gradient(#aa2828,#701414 50%,#5a0e0e 52%,#801a1a);border:1px solid #000;border-radius:4px;box-shadow:inset 0 0 0 1px rgba(232,194,122,.4)}
.lk-button.lk-gray{background:linear-gradient(#5d5d63,#2f2f34 52%,#3e3e44);box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)}
.lk-button.off{filter:grayscale(1) brightness(.72)}
.lk-close{background:linear-gradient(#b72a2a,#6c1010);border:1px solid #1a0505;border-radius:3px;box-shadow:inset 0 0 0 1px rgba(229,194,122,.6)}
.lk-close::after{content:"x";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#ffd100;font:700 14px/1 var(--game)}
.lk-input{background:#000;border:1px solid #7a7a80;border-radius:3px}
.lk-check{background:rgba(0,0,0,.8);border:1px solid #c9a24e;border-radius:3px}
.lk-check.on::after{content:"";position:absolute;left:30%;top:8%;width:30%;height:58%;border:solid #ffd100;border-width:0 3px 3px 0;transform:rotate(42deg)}
.lk-tooltip{background:rgba(16,16,28,.96);border:1px solid #6c6c72;border-radius:3px}
.lk-scrollbar{background:rgba(0,0,0,.6);border:1px solid #3b3b42}
.lk-bar{background:rgba(0,0,0,.7);border:1px solid #555}
]==]

local PAGE_CSS = [==[
:root{--bg:#f1f2f4;--panel:#ffffff;--ink:#1c1e23;--muted:#585e69;--line:#d3d7de;--accent:#7a5a14;--stage-edge:#2b2f36;--display:'Marcellus','Palatino Linotype',Georgia,serif;--body:'Source Sans 3','Segoe UI',system-ui,sans-serif;--mono:'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace;--game:'Friz Quadrata TT','Palatino Linotype','Book Antiqua',Palatino,Georgia,serif}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111317;--panel:#181b21;--ink:#e6e8ec;--muted:#9aa1ad;--line:#2b3039;--accent:#e2c36c;--stage-edge:#3a404a;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#111317;--panel:#181b21;--ink:#e6e8ec;--muted:#9aa1ad;--line:#2b3039;--accent:#e2c36c;--stage-edge:#3a404a;color-scheme:dark}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 var(--body);padding-block:28px 56px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.page{max-width:76rem;margin:0 auto;min-width:0}
h1{font:400 clamp(1.7rem,4vw,2.3rem)/1.15 var(--display);margin:0 0 .5rem;text-wrap:balance}
h2{font:400 1.5rem/1.2 var(--display);margin:2.4rem 0 .3rem;text-wrap:balance}
.lede{max-width:65ch;margin:.2rem 0 1rem;color:var(--muted)}
.legend{max-width:65ch;margin:0 0 1.2rem;padding:.7rem .9rem;border:1px solid var(--line);border-radius:6px;background:var(--panel);font-size:.92rem;color:var(--muted)}
.legend b{color:var(--ink);font-weight:600}
nav.toc{margin:0 0 1.4rem;font-size:.95rem}
nav.toc ol{margin:.3rem 0 0;padding-left:1.3rem;columns:2 22rem}
nav.toc a{color:var(--accent)}
nav.toc a:focus-visible,.shot a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.section-note{max-width:65ch;margin:0 0 1rem;color:var(--muted)}
.shot{margin:0 0 30px;min-width:0}
.shot figcaption{display:flex;gap:.7em;align-items:baseline;margin:0 0 8px}
.shot .no{font:500 .8rem var(--mono);color:var(--muted)}
.shot .cap{font:400 1.08rem/1.3 var(--display)}
.notes{margin:.55rem 0 0;padding:0;list-style:none;font-size:.86rem;color:var(--muted);max-width:75ch}
.notes li{margin:.15rem 0}
.notes .warn{color:var(--ink)}
.notes .warn::before{content:"Check: ";font-weight:600;color:var(--accent)}
.notes .asm::before{content:"Assumed: "}
code,.mono{font-family:var(--mono);font-size:.92em}
footer{margin-top:2.5rem;color:var(--muted);font-size:.85rem}
]==]

local FONTS = "https://fonts.googleapis.com/css2?family=Marcellus&family=Source+Sans+3:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap"

function Pictures.stage_css() return STAGE_CSS end

-- The notes under a picture: what to check and what was assumed.
local function notes(picture)
  local items = {}
  for _, warning in ipairs(picture.warnings) do items[#items + 1] = '<li class="warn">' .. escape(warning) .. "</li>" end
  for _, assumption in ipairs(picture.assumptions) do items[#items + 1] = '<li class="asm">' .. escape(assumption) .. "</li>" end
  if #items == 0 then return "" end
  return '<ul class="notes">' .. table.concat(items) .. "</ul>"
end

local function figure(id, number_, shot)
  return string.format('<figure class="shot" id="%s"><figcaption><span class="no">%s</span><span class="cap">%s</span></figcaption>' ..
    '<div class="stagewrap">%s</div>%s</figure>', id, number_, escape(shot.caption), shot.picture.html, notes(shot.picture))
end

function Pictures.slug(text)
  local slug = string.lower((string.gsub(text, "[^%w]+", "-")))
  slug = string.gsub(slug, "^%-+", "")
  slug = string.gsub(slug, "%-+$", "")
  return string.sub(slug, 1, 48)
end

-- A page of pictures. sections: { { id, title, text, shots = { { caption, picture } } } }.
-- options: title, lede, legend (html), document (true: a whole file; false: a page for the Artifact tool, which
-- adds the document around it), footer.
function Pictures.page(sections, options)
  local parts = {}
  local function add(text) parts[#parts + 1] = text end
  if options.document then
    add('<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">')
  end
  add("<title>" .. escape(options.title) .. "</title>")
  add('<meta name="claude:viewport-fit-sides" content="cover">')
  add('<link rel="stylesheet" href="' .. FONTS .. '">')
  add("<style>\n" .. PAGE_CSS .. STAGE_CSS .. "</style>")
  add('<div class="page">')
  add("<header><h1>" .. escape(options.title) .. "</h1>")
  if options.lede then add('<p class="lede">' .. options.lede .. "</p>") end
  if options.legend then add('<div class="legend">' .. options.legend .. "</div>") end
  add("</header>")
  local toc = {}
  for _, section in ipairs(sections) do
    for index, shot in ipairs(section.shots) do
      toc[#toc + 1] = string.format('<li><a href="#%s-%d">%s</a></li>', section.id, index, escape(shot.caption))
    end
  end
  add('<nav class="toc" aria-label="Pictures"><b>Pictures</b><ol>' .. table.concat(toc) .. "</ol></nav>")
  add("<main>")
  for _, section in ipairs(sections) do
    add('<section id="' .. section.id .. '"><h2>' .. escape(section.title) .. "</h2>")
    if section.text then add('<p class="section-note">' .. escape(section.text) .. "</p>") end
    for index, shot in ipairs(section.shots) do
      add(figure(section.id .. "-" .. index, string.format("%d / %d", index, #section.shots), shot))
    end
    add("</section>")
  end
  add("</main>")
  if options.footer then add("<footer>" .. options.footer .. "</footer>") end
  add("</div>")
  return table.concat(parts, "\n") .. "\n"
end

-- One picture on its own, as a whole file.
function Pictures.document(shot, title)
  return '<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>' ..
    escape(title) .. "</title>\n<style>\n" .. PAGE_CSS .. STAGE_CSS .. '</style>\n<div class="page">' ..
    figure("picture", "", shot) .. "</div>\n"
end

function Pictures.write(path, text)
  local handle = assert(io.open(path, "wb"))
  handle:write(text)
  handle:close()
end

return Pictures
