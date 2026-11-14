-- Intrepid Manager: the voting window. Frames only: it shows the model it is given and calls the callbacks it was given;
-- game/CouncilSession keeps the votes.
--
-- Everyone in a session with a council gets it when the session starts, beside the answer window: on the left the items, each with
-- how many of the council voted on it (or "won" once it is awarded); a click picks the item whose candidates the right side shows.
-- On the right, above the candidates, "2 out of 3 have voted - 42 s left" (then "Voting is over", or who it was awarded to), and one
-- row per raider who asked for the item, best claim first and Pass last: the name in the color of the class, the answer, the note,
-- the votes (hover the count for who voted) and, for the council while votes are taken, a Vote button ("Voted" on the raider this
-- player voted for; pressing it again takes the vote back). The row with the most votes is tinted gold, each of them on a tie. The
-- votes are advice: the loot master awards.
--
-- The model (read only; the session builds it):
--   model = {
--     state = "none" | "running" | "over", remaining = 42 (running only), master = "Jorren Ashvale" (or "you"), practice = true or nil,
--     council = true (this player may vote), rank = "Officer Alt", councilSize = 3,
--     items = { { n, item, name, quality, icon, winner, voted, candidates (answers other than Pass), open, myVote }, ... },
--   }
--
-- The callbacks (each in pcall):
--   model()            the model as it is now (called every second while the window is shown)
--   rows(n)            the candidates of item n: { { who, code, label, note, class, votes, voters, mine, leader, canVote, winner }, ... }
--   vote(n, who)       the Vote button of a row (pressed on the raider voted for, it takes the vote back)
--
-- VotingWindow.statusText(model, item), VotingWindow.itemCount(model, item) and VotingWindow.hintText(model) are the sentences, for
-- the tests.

local _, ns = ...

local VotingWindow = {}
ns.UI = ns.UI or {}
ns.UI.VotingWindow = VotingWindow

local NAME = "IntrepidManagerVoting"
local VISIBLE = 12
local CLAIM_SHADES = { b = "gold", u = "good", o = "warn", p = "muted" }

-- The line above the candidates of the picked item.
function VotingWindow.statusText(model, item)
  if model.state == "none" or not item then return "No session with a council yet." end
  if item.winner then return "Awarded to " .. item.winner end
  local size = model.councilSize or 0
  local voted = item.voted or 0
  if model.state == "running" then
    return voted .. " out of " .. size .. " have voted - " .. string.format("%.0f", model.remaining or 0) .. " s left"
  end
  return "Voting is over - " .. voted .. " out of " .. size .. " voted"
end

-- The count at the right of an item in the list: "won" once awarded, else how many of the council voted ("1/3").
function VotingWindow.itemCount(model, item)
  if item.winner then return "won" end
  return (item.voted or 0) .. "/" .. (model.councilSize or 0)
end

-- The line at the bottom: what this player can do.
function VotingWindow.hintText(model)
  if model.state == "none" then return "The window fills when a loot master starts a session." end
  if model.council then
    return "You are on the council: one vote per item. Vote again to move it; press Voted to take it back. Votes close when the time is up."
  end
  return "Only the council votes (" .. (model.rank or "?") .. " and higher, and the loot master). Hover a vote count to see who voted."
end

function VotingWindow.new(kit, callbacks)
  callbacks = callbacks or {}
  local m, colors = kit.m, kit.colors
  local self = {}

  local function call(name, ...)
    local callback = callbacks[name]
    if callback then return callback(...) end
  end

  -- the numbers everything else is placed by
  local pad, gap, header = m.pad, m.gap, m.header
  local width = 680
  local inner = width - 10 - pad * 2
  local leftWidth = 220
  local rightX = pad + leftWidth + gap * 2
  local rightWidth = inner - leftWidth - gap * 2
  local listTop = pad + header + gap
  local itemRow = m.itemRow
  local listHeight = itemRow * VISIBLE
  local leftRowWidth = leftWidth - m.bar - 2
  local iconSize = itemRow - 4
  local countWidth = 40
  local nameWidth = leftRowWidth - iconSize - countWidth - gap * 3
  local statusTop = listTop
  local headsTop = statusTop + header + gap
  local tableTop = headsTop + header
  local tableHeight = listHeight - (tableTop - listTop)
  local rowHeight = m.row
  local hintTop = listTop + listHeight + gap
  local height = hintTop + header * 2 + pad + 28
  local rightRowWidth = rightWidth - m.bar - 2
  local classSize = m.icon
  local whoWidth, claimWidth = 124, 80
  local votesWidth, voteWidth = 28, 50
  local noteWidth = rightRowWidth - whoWidth - claimWidth - votesWidth - voteWidth - gap * 6
  local votesX = gap + whoWidth + gap + claimWidth + gap + noteWidth + gap

  local window = kit.window({
    name = NAME, title = "Council votes", width = width, height = height, chrome = "clear", anchor = { point = "TOPLEFT", x = 40, y = -90 },
  })
  local body = window.body

  local itemsHead = kit.label(body, "ITEMS", { font = "gold", width = leftWidth })
  itemsHead:SetPoint("TOPLEFT", pad, -pad - 2)
  local leftList = kit.scrollList(body, leftWidth, listHeight)
  leftList.frame:SetPoint("TOPLEFT", pad, -listTop)

  local votesHead = kit.label(body, "VOTES", { font = "gold", width = rightWidth })
  votesHead:SetPoint("TOPLEFT", rightX, -pad - 2)
  local status = kit.label(body, "", { width = rightWidth })
  status:SetPoint("TOPLEFT", rightX, -statusTop)
  local headWho = kit.label(body, "RAIDER", { color = colors.muted, width = whoWidth })
  headWho:SetPoint("TOPLEFT", rightX + gap, -headsTop)
  local headClaim = kit.label(body, "ANSWER", { color = colors.muted, width = claimWidth })
  headClaim:SetPoint("TOPLEFT", rightX + gap + whoWidth + gap, -headsTop)
  local headNote = kit.label(body, "NOTE", { color = colors.muted, width = noteWidth })
  headNote:SetPoint("TOPLEFT", rightX + gap + whoWidth + gap + claimWidth + gap, -headsTop)
  local headVotes = kit.label(body, "VOTES", { color = colors.muted, width = votesWidth + voteWidth })
  headVotes:SetPoint("TOPLEFT", rightX + votesX, -headsTop)
  local rightList = kit.scrollList(body, rightWidth, tableHeight)
  rightList.frame:SetPoint("TOPLEFT", rightX, -tableTop)
  local empty = kit.label(body, "", { width = rightWidth - gap * 2, color = colors.muted })
  empty:SetPoint("TOPLEFT", rightX + gap, -tableTop - gap)
  local hint = kit.label(body, "", { wrap = true, width = inner, color = colors.muted })
  hint:SetPoint("TOPLEFT", pad, -hintTop)

  local leftRows, rightRows = {}, {}
  local current = { state = "none", items = {} }
  local selected

  local function refresh()
    local fresh = call("model")
    if fresh then self.update(fresh) end
  end

  local function makeLeftRow(index)
    local row = {}
    local frame = CreateFrame("Button", nil, leftList.content)
    frame:SetSize(leftRowWidth, itemRow)
    frame:SetPoint("TOPLEFT", 0, -(index - 1) * itemRow)
    kit.fill(frame, index % 2 == 1 and colors.panel or colors.panelAlt)
    row.selected = frame:CreateTexture(nil, "ARTWORK")
    row.selected:SetAllPoints()
    row.selected:SetColorTexture(colors.selected[1], colors.selected[2], colors.selected[3], 1)
    row.selected:Hide()
    row.icon = kit.icon(frame, iconSize, 1, nil)
    row.icon:SetPoint("LEFT", gap, 0)
    row.name = kit.label(frame, "", { width = nameWidth })
    row.name:SetPoint("LEFT", row.icon, "RIGHT", gap, 0)
    row.count = kit.label(frame, "", { width = countWidth, justify = "RIGHT", color = colors.muted })
    row.count:SetPoint("LEFT", row.name, "RIGHT", gap, 0)
    frame:SetScript("OnClick", kit.safe(function()
      if not row.data then return end
      selected = row.data.n
      self.paintLeft()
      self.paintRight()
    end))
    frame:SetScript("OnEnter", kit.safe(function(self_)
      if not row.data then return end
      GameTooltip:SetOwner(self_, "ANCHOR_RIGHT")
      GameTooltip:SetHyperlink(row.data.item)
      GameTooltip:Show()
    end))
    frame:SetScript("OnLeave", kit.safe(function() GameTooltip:Hide() end))
    row.frame = frame
    leftRows[index] = row
    return row
  end

  local function makeRightRow(index)
    local row = {}
    local frame = CreateFrame("Frame", nil, rightList.content)
    frame:SetSize(rightRowWidth, rowHeight)
    frame:SetPoint("TOPLEFT", 0, -(index - 1) * rowHeight)
    kit.fill(frame, index % 2 == 1 and colors.panel or colors.panelAlt)
    row.leaderBg = frame:CreateTexture(nil, "ARTWORK")
    row.leaderBg:SetAllPoints()
    row.leaderBg:SetColorTexture(colors.gold[1], colors.gold[2], colors.gold[3], 0.14)
    row.leaderBg:Hide()
    row.winnerBg = frame:CreateTexture(nil, "ARTWORK")
    row.winnerBg:SetAllPoints()
    row.winnerBg:SetColorTexture(colors.selected[1], colors.selected[2], colors.selected[3], 1)
    row.winnerBg:Hide()
    row.classIcon = frame:CreateTexture(nil, "ARTWORK")
    row.classIcon:SetSize(classSize, classSize)
    row.classIcon:SetPoint("LEFT", gap, 0)
    row.who = kit.label(frame, "", { width = whoWidth - classSize - gap })
    row.who:SetPoint("LEFT", row.classIcon, "RIGHT", gap, 0)
    row.claim = kit.label(frame, "", { width = claimWidth })
    row.claim:SetPoint("LEFT", frame, "LEFT", gap + whoWidth + gap, 0)
    row.note = kit.label(frame, "", { width = noteWidth, color = colors.muted })
    row.note:SetPoint("LEFT", row.claim, "RIGHT", gap, 0)
    row.votesHit = CreateFrame("Frame", nil, frame)
    row.votesHit:SetSize(votesWidth, rowHeight)
    row.votesHit:SetPoint("LEFT", frame, "LEFT", votesX, 0)
    row.votesHit:EnableMouse(true)
    row.votes = kit.label(row.votesHit, "", { width = votesWidth })
    row.votes:SetPoint("LEFT", 0, 0)
    row.vote = kit.button(frame, "Vote", { width = voteWidth })
    row.vote:SetHeight(rowHeight - 2)
    row.vote:SetPoint("LEFT", row.votesHit, "RIGHT", gap, 0)
    row.vote:SetScript("OnClick", kit.safe(function()
      if row.answer and selected then call("vote", selected, row.answer.who) end
      refresh()
    end))
    row.votesHit:SetScript("OnEnter", kit.safe(function(hit) ns.UI.SessionPanel.showVoters(GameTooltip, hit, row.answer, colors) end))
    row.votesHit:SetScript("OnLeave", kit.safe(function() GameTooltip:Hide() end))
    row.frame = frame
    rightRows[index] = row
    return row
  end

  local function pickedItem()
    for _, item in ipairs(current.items) do
      if item.n == selected then return item end
    end
  end

  function self.paintLeft()
    for i, data in ipairs(current.items) do
      local row = leftRows[i] or makeLeftRow(i)
      row.data = data
      row.frame:Show()
      kit.setIcon(row.icon, data.quality or 1, data.icon)
      local color = ns.UI.Kit.qualityColor(data.quality or 1)
      row.name:SetText(kit.fit(data.n .. ". " .. (data.name or "?"), nameWidth))
      row.name:SetTextColor(color[1], color[2], color[3])
      row.count:SetText(VotingWindow.itemCount(current, data))
      local shade = data.winner and colors.good or (data.myVote and colors.gold or colors.muted)
      row.count:SetTextColor(shade[1], shade[2], shade[3])
      row.selected:SetShown(selected == data.n)
    end
    for i = #current.items + 1, #leftRows do
      leftRows[i].data = nil
      leftRows[i].frame:Hide()
    end
    leftList.setContentHeight(#current.items * itemRow)
  end

  function self.paintRight()
    local data = pickedItem()
    local rows = data and call("rows", data.n) or {}
    votesHead:SetText(data and ("VOTES - " .. kit.fit(data.name or "?", rightWidth - 60)) or "VOTES")
    status:SetText(kit.fit(VotingWindow.statusText(current, data), rightWidth))
    local shade = (data and data.winner) and colors.good or (current.state == "running" and colors.text or colors.muted)
    status:SetTextColor(shade[1], shade[2], shade[3])
    empty:SetText(data and #rows == 0 and "Nobody has asked for this item yet." or "")
    for i, answer in ipairs(rows) do
      local row = rightRows[i] or makeRightRow(i)
      row.answer = answer
      row.frame:Show()
      row.winnerBg:SetShown(answer.winner or false)
      row.leaderBg:SetShown((answer.leader and not answer.winner) or false)
      local color = ns.UI.Kit.classColor(answer.class)
      row.who:SetText(kit.fit(answer.who, whoWidth - classSize - gap))
      row.who:SetTextColor(color[1], color[2], color[3])
      local file = ns.UI.Kit.classIconFile(answer.class)
      if file then row.classIcon:SetTexture(file) end
      row.classIcon:SetShown(file ~= nil)
      row.claim:SetText(answer.label or "")
      local claimShade = colors[CLAIM_SHADES[answer.code] or "text"]
      row.claim:SetTextColor(claimShade[1], claimShade[2], claimShade[3])
      row.note:SetText(kit.fit(answer.note or "", noteWidth))
      local votes = answer.votes or 0
      row.votes:SetText(tostring(votes))
      local voteShade = votes > 0 and colors.gold or colors.muted
      row.votes:SetTextColor(voteShade[1], voteShade[2], voteShade[3])
      row.vote:SetShown(answer.canVote or false)
      row.vote:SetText(answer.mine and "Voted" or "Vote")
    end
    for i = #rows + 1, #rightRows do
      rightRows[i].answer = nil
      rightRows[i].frame:Hide()
    end
    rightList.setContentHeight(#rows * rowHeight)
  end

  function self.update(model)
    current = model or { state = "none", items = {} }
    current.items = current.items or {}
    if selected == nil or not pickedItem() then selected = current.items[1] and current.items[1].n or nil end
    hint:SetText(VotingWindow.hintText(current))
    self.paintLeft()
    self.paintRight()
  end

  -- A second at a time while the window is shown, the time and the votes are read again.
  local ticking = 0
  local function tick(token)
    if token ~= ticking or not window.isShown() then return end
    refresh()
    C_Timer.After(1, function() tick(token) end)
  end
  window.frame:SetScript("OnShow", kit.safe(function()
    ticking = ticking + 1
    tick(ticking)
  end))
  window.frame:SetScript("OnHide", function() ticking = ticking + 1 end)

  window.hide()

  function self.show() window.show() end
  function self.hide() window.hide() end
  function self.isShown() return window.isShown() end
  function self.selected() return selected end
  self.frame = window.frame
  self.parts = {
    window = window, itemsHead = itemsHead, votesHead = votesHead, status = status, hint = hint, empty = empty, headVotes = headVotes,
    leftList = leftList, rightList = rightList, leftRows = leftRows, rightRows = rightRows,
  }
  self.metrics = { width = width, height = height, rowHeight = rowHeight, visible = VISIBLE }
  return self
end
