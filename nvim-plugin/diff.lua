-- Enhanced diff viewer for Deft with interactive command menu and file selector
-- Provides side-by-side diff view with comprehensive user controls and multi-file navigation
-- Aligned with nvim-diff-review-ui.md design spec
local M = {}

-- State
M.current_diff = nil
M.diff_bufnr_old = nil
M.diff_bufnr_new = nil
M.diff_winnr_old = nil
M.diff_winnr_new = nil
M.menu_bufnr = nil
M.menu_winnr = nil
M.file_selector_bufnr = nil
M.file_selector_winnr = nil
M.ipc_client = nil
M.deft_terminal_winnr = nil
M.debug_enabled = false
M.is_editing = false
M.edit_bufnr = nil
M.original_winnr = nil
M.original_bufnr = nil
M.saved_source_windows = {}  -- Store source windows to restore later
M.saved_layout = nil  -- Store window layout before diff
M.buffer_counter = 0  -- Counter for unique buffer names

M.current_hunk_positions = {}  -- Store hunk positions in current file

-- NEW: Mapping from vim.diff hunk indices to patch hunk indices
M.vim_to_patch_hunk_map = {}  -- [vim_hunk_idx] = patch_hunk_idx
M.current_file_patch_hunks = {}  -- Current file's patch hunk boundaries

-- Review state (simplified - just track current position and decisions)
M.review_state = {
  current_file_index = 1,   -- 1-based index in files array
  current_hunk_index = -1,  -- 0-based (starts at -1, increments to 0 before first show)
  reviews = {},             -- [filepath][hunk_index] = 'accept'|'reject'
  files = {},               -- Array of { filepath, hunks = {...}, total_hunks }
  patch_id = nil,           -- Current patch ID
  is_multi_file = false,    -- Multi-file mode flag
}

-- Helper: Safely close a window, creating a fallback if it's the last one
local function safe_close_win(winnr)
  if not winnr or not vim.api.nvim_win_is_valid(winnr) then return end

  -- Check if this is effectively the last non-floating window
  local wins = vim.api.nvim_tabpage_list_wins(0)
  local valid_wins = 0
  for _, w in ipairs(wins) do
    if vim.api.nvim_win_get_config(w).relative == '' then
      valid_wins = valid_wins + 1
    end
  end

  if valid_wins <= 1 then
    -- Emergency: Create a scratch buffer so we don't crash editor
    vim.cmd('botright vnew')
    vim.cmd('wincmd p') -- Go back to the window we want to close
  end

  -- Use pcall to ignore E444 if it somehow still happens
  pcall(vim.api.nvim_win_close, winnr, true)
end

---Save and hide all source code windows (except terminal)
function M.save_and_hide_source_windows()
  M.saved_source_windows = {}

  -- Robustly identify terminal buffer to prevent accidental closing
  local ok, deft = pcall(require, 'deft')
  local term_bufnr = ok and deft.state.terminal_bufnr or -1

  -- Get all windows in current tab
  local all_wins = vim.api.nvim_tabpage_list_wins(0)

  for _, winnr in ipairs(all_wins) do
    local config = vim.api.nvim_win_get_config(winnr)

    -- Skip floating windows
    if config.relative == '' then
      local bufnr = vim.api.nvim_win_get_buf(winnr)

      -- If this is the Deft terminal buffer, update our ref and KEEP IT OPEN
      if bufnr == term_bufnr then
        M.deft_terminal_winnr = winnr
      else
        -- It's a source window: save and close it
        table.insert(M.saved_source_windows, {
          bufnr = bufnr,
        })
        pcall(vim.api.nvim_win_close, winnr, false)
      end
    end
  end
end

---Show a diff from Deft
---@param message table IPC message with diff data
---@param ipc_client table IPC client instance
---@param deft_winnr number|nil Deft terminal window number
function M.show(message, ipc_client, deft_winnr)
  if M.debug_enabled then
    vim.notify('[Deft Diff] Received show_diff message', vim.log.levels.INFO)
    vim.notify('[Deft Diff] diffType: ' .. message.diffType, vim.log.levels.INFO)
    if message.files then
      vim.notify(string.format('[Deft Diff] Multi-file: %d files', #message.files), vim.log.levels.INFO)
    end
  end

  M.current_diff = message
  M.ipc_client = ipc_client
  M.deft_terminal_winnr = deft_winnr

  -- Save and hide source windows to prevent clutter (4+ panels)
  M.save_and_hide_source_windows()

  -- Initialize review state for multi-file patches
  M.initialize_review_state(message)

  -- Handle multi-file batch mode
  if message.isMultiFile and message.files then
    M.review_state.current_file_index = 1
    M.review_state.current_hunk_index = 0
    M.show_next_hunk()
    return
  end

  -- Single-file mode
  if message.diffType == 'hunk' then
    M.show_current_hunk()
  elseif message.diffType == 'write' then
    M.show_write_diff(message)
  else
    vim.notify('[Deft Diff] Unknown diffType: ' .. tostring(message.diffType), vim.log.levels.ERROR)
  end
end

---Initialize or update review state from patch message
---@param message table Patch message with file/hunk data
function M.initialize_review_state(message)
  -- Handle multi-file batch initialization
  if message.isMultiFile and message.files then
    M.review_state = {
      current_file_index = 1,
      current_hunk_index = 0,
      reviews = {},
      files = {},
      patch_id = message.requestId,
      is_multi_file = true,
    }

    for i, file_info in ipairs(message.files) do
      -- Store patch hunk boundaries
      local patch_hunks = {}
      if file_info.patchHunks then
        for _, ph in ipairs(file_info.patchHunks) do
          table.insert(patch_hunks, {
            hunkIndex = ph.hunkIndex,
            oldStart = ph.oldStart,
            oldCount = ph.oldCount,
            newStart = ph.newStart,
            newCount = ph.newCount,
            header = ph.header,
          })
        end
      end

      table.insert(M.review_state.files, {
        filepath = file_info.filepath,
        total_hunks = file_info.hunkCount or 0,  -- Initialize with patch hunk count
        hunks = {},
        existing_content = file_info.existingContent,
        new_content = file_info.newContent,
        is_new_file = file_info.isNewFile,
        patch_hunks = patch_hunks,
        patch_hunk_count = file_info.hunkCount,
      })

      -- Initialize reviews for this file
      M.review_state.reviews[file_info.filepath] = {}
    end
    return
  end

  -- Per-hunk initialization (legacy mode)
  if message.diffType == 'hunk' then
    local filepath = message.filepath
    local hunk_index = message.hunkIndex or 0
    local total_hunks = message.totalHunks or 1

    -- Initialize state if empty or if this is a new patch session
    if #M.review_state.files == 0 or
       (M.review_state.patch_id and M.review_state.patch_id ~= message.requestId) then
      M.review_state = {
        current_file_index = 1,
        current_hunk_index = 0,
        reviews = {},
        files = {},
        patch_id = message.requestId,
        is_multi_file = false,
      }

      if M.debug_enabled then
        vim.notify('[Deft Diff] New patch session started', vim.log.levels.INFO)
      end
    end

    -- Check if we've seen this file before
    local file_index = nil
    for i, file in ipairs(M.review_state.files) do
      if file.filepath == filepath then
        file_index = i
        -- Update total_hunks (might change as we see more hunks)
        file.total_hunks = math.max(file.total_hunks, total_hunks)
        break
      end
    end

    -- Add file if new
    if not file_index then
      table.insert(M.review_state.files, {
        filepath = filepath,
        total_hunks = total_hunks,
        hunks = {}
      })
      file_index = #M.review_state.files

      if M.debug_enabled then
        vim.notify(string.format('[Deft Diff] Discovered new file: %s (%d hunks)',
          filepath, total_hunks), vim.log.levels.INFO)
      end
    end

    -- Update current position
    M.review_state.current_file_index = file_index
    M.review_state.current_hunk_index = hunk_index

    if M.debug_enabled then
      vim.notify(string.format('[Deft Diff] Position: file %d/%d, hunk %d/%d',
        file_index, #M.review_state.files, hunk_index + 1, total_hunks), vim.log.levels.INFO)
    end
  end
end

---Get current file info
---@return table|nil Current file data
function M.get_current_file()
  if M.review_state.current_file_index > #M.review_state.files then
    return nil
  end
  return M.review_state.files[M.review_state.current_file_index]
end

---Count reviewed hunks for a file
---@param filepath string File path
---@return number Count of reviewed hunks
function M.count_reviewed(filepath)
  local reviews = M.review_state.reviews[filepath] or {}
  local count = 0
  for _ in pairs(reviews) do
    count = count + 1
  end
  return count
end

---Count total hunks across all files
---@return number, number total_hunks, reviewed_hunks
function M.count_all_hunks()
  local total_hunks = 0
  local reviewed_hunks = 0

  for _, file in ipairs(M.review_state.files) do
    total_hunks = total_hunks + file.total_hunks
    -- Use vim_hunks_reviewed for accurate count
    local vim_reviewed = file.vim_hunks_reviewed or {}
    for _ in pairs(vim_reviewed) do
      reviewed_hunks = reviewed_hunks + 1
    end
  end

  return total_hunks, reviewed_hunks
end

---Get absolute hunk index (across all files)
---@return number Absolute hunk index (1-based)
function M.get_absolute_hunk_index()
  local index = 0
  for i = 1, M.review_state.current_file_index - 1 do
    index = index + M.review_state.files[i].total_hunks
  end
  index = index + M.review_state.current_hunk_index + 1
  return index
end

---Calculate review statistics
---@return table Stats with reviewed_hunks, total_hunks, files_with_reviews, unreviewed_hunks
function M.calculate_review_stats()
  local total_hunks = 0
  local reviewed_hunks = 0
  local files_with_reviews = 0

  for _, file in ipairs(M.review_state.files) do
    -- Use vim hunk count (what user actually reviews block-by-block)
    local file_total = file.total_hunks or 0
    total_hunks = total_hunks + file_total

    -- Count vim hunks reviewed (not patch hunks)
    local vim_reviewed = file.vim_hunks_reviewed or {}
    local file_reviewed_count = 0
    for _ in pairs(vim_reviewed) do
      file_reviewed_count = file_reviewed_count + 1
    end
    reviewed_hunks = reviewed_hunks + file_reviewed_count
    if file_reviewed_count > 0 then
      files_with_reviews = files_with_reviews + 1
    end
  end

  return {
    total_hunks = total_hunks,
    reviewed_hunks = reviewed_hunks,
    files_with_reviews = files_with_reviews,
    unreviewed_hunks = total_hunks - reviewed_hunks,
  }
end

---Show multi-file selector for batch review
---@param message table Multi-file patch message
function M.show_multi_file_selector(message)
  -- Save current window context
  M.original_winnr = vim.api.nvim_get_current_win()
  M.original_bufnr = vim.api.nvim_get_current_buf()

  -- Create selector buffer
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_option(buf, 'bufhidden', 'wipe')
  vim.api.nvim_buf_set_option(buf, 'buftype', 'nofile')
  vim.api.nvim_buf_set_option(buf, 'swapfile', false)
  vim.api.nvim_buf_set_option(buf, 'modifiable', true)

  -- Build content (Clean list without ASCII borders)
  local lines = {}

  -- Add file list
  for i, file in ipairs(M.review_state.files) do
    local status = '[ ]'
    local review = M.review_state.reviews[file.filepath]
    if review and review['file'] then
      status = review['file'] == 'accept' and '[✓]' or '[✗]'
    end

    local file_type = file.is_new_file and '(new)' or ''
    table.insert(lines, string.format(' %s %d. %s %s', status, i, file.filepath, file_type))
  end

  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.api.nvim_buf_set_option(buf, 'modifiable', false)

  -- Create centered popup window
  local width = vim.o.columns
  local height = vim.o.lines
  local win_width = math.min(65, width - 4)
  local win_height = math.min(#lines, height - 10)
  local row = math.floor((height - win_height) / 2)
  local col = math.floor((width - win_width) / 2)

  local win = vim.api.nvim_open_win(buf, true, {
    relative = 'editor',
    width = win_width,
    height = win_height,
    row = row,
    col = col,
    style = 'minimal',
    border = 'rounded',
    title = string.format(' Patch Review (%d files) ', #M.review_state.files),
    title_pos = 'center',
    footer = ' a:Accept r:Reject s:Submit q:Cancel ',
    footer_pos = 'center',
  })

  M.file_selector_bufnr = buf
  M.file_selector_winnr = win

  -- Setup keymaps for file selector
  local opts = { buffer = buf, silent = true, noremap = true }

  -- Enter: Select file and review
  vim.keymap.set('n', '<CR>', function()
    vim.api.nvim_win_close(win, true)
    M.file_selector_winnr = nil
    M.file_selector_bufnr = nil
    -- Start reviewing from first hunk of first file
    M.review_state.current_file_index = 1
    M.review_state.current_hunk_index = 0
    M.show_next_hunk()
  end, opts)

  -- a: Accept current file
  vim.keymap.set('n', 'a', function()
    M.accept_entire_file()
  end, opts)

  -- r: Reject current file with message
  vim.keymap.set('n', 'r', function()
    M.reject_entire_file()
  end, opts)

  -- <leader>a: Accept all files
  vim.keymap.set('n', '<leader>a', function()
    M.accept_all_files()
  end, opts)

  -- <leader>r: Reject all files
  vim.keymap.set('n', '<leader>r', function()
    M.reject_all_files()
  end, opts)

  -- s: Submit decisions
  vim.keymap.set('n', 's', function()
    M.submit_multi_file_decisions()
  end, opts)

  -- q or ESC: Cancel (close menu, return to current position)
  vim.keymap.set('n', 'q', function()
    M.close_multi_file_selector()
  end, opts)

  vim.keymap.set('n', '<Esc>', function()
    M.close_multi_file_selector()
  end, opts)
end

---Close multi-file selector
function M.close_multi_file_selector()
  if M.file_selector_winnr and vim.api.nvim_win_is_valid(M.file_selector_winnr) then
    vim.api.nvim_win_close(M.file_selector_winnr, true)
  end
  M.file_selector_winnr = nil
  M.file_selector_bufnr = nil
end

---Accept entire file (all hunks)
function M.accept_entire_file()
  local current_file = M.get_current_file()
  if not current_file then
    return
  end

  -- Mark file as accepted
  M.review_state.reviews[current_file.filepath] = M.review_state.reviews[current_file.filepath] or {}
  M.review_state.reviews[current_file.filepath]['file'] = 'accept'

  vim.notify(string.format('Accepted: %s', current_file.filepath), vim.log.levels.INFO)
end

---Reject entire file
function M.reject_entire_file()
  local current_file = M.get_current_file()
  if not current_file then
    return
  end

  -- Mark file as rejected
  M.review_state.reviews[current_file.filepath] = M.review_state.reviews[current_file.filepath] or {}
  M.review_state.reviews[current_file.filepath]['file'] = 'reject'

  vim.notify(string.format('Rejected: %s', current_file.filepath), vim.log.levels.INFO)
end

---Accept all files
function M.accept_all_files()
  for _, file in ipairs(M.review_state.files) do
    M.review_state.reviews[file.filepath] = M.review_state.reviews[file.filepath] or {}
    M.review_state.reviews[file.filepath]['file'] = 'accept'
  end
  vim.notify('Accepted all files', vim.log.levels.INFO)
end

---Reject all files
function M.reject_all_files()
  for _, file in ipairs(M.review_state.files) do
    M.review_state.reviews[file.filepath] = M.review_state.reviews[file.filepath] or {}
    M.review_state.reviews[file.filepath]['file'] = 'reject'
  end
  vim.notify('Rejected all files', vim.log.levels.INFO)
end

---Submit multi-file decisions
function M.submit_multi_file_decisions()
  -- Build file decisions
  local file_decisions = {}
  for _, file in ipairs(M.review_state.files) do
    local file_review = M.review_state.reviews[file.filepath] or {}
    local decision = file_review['file'] or 'accept'  -- Default to accept
    table.insert(file_decisions, {
      filepath = file.filepath,
      decision = decision,
    })
  end

  -- Send confirmation
  if M.ipc_client and M.current_diff then
    M.ipc_client:send_confirmation_response({
      requestId = M.current_diff.requestId,
      decision = 'accept-all',
      fileDecisions = file_decisions,
    })
  end

  M.close_multi_file_selector()
  M.close()
end

---Show file selector menu for navigating between files
function M.show_file_selector()
  if #M.review_state.files == 0 then
    vim.notify('No files to review', vim.log.levels.WARN)
    return
  end

  -- Create selector buffer
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_option(buf, 'bufhidden', 'wipe')
  vim.api.nvim_buf_set_option(buf, 'buftype', 'nofile')
  vim.api.nvim_buf_set_option(buf, 'swapfile', false)

  -- Count files with reviews
  local files_reviewed = 0
  for _, file in ipairs(M.review_state.files) do
    local reviews = M.review_state.reviews[file.filepath] or {}
    local has_reviews = false
    for _ in pairs(reviews) do
      has_reviews = true
      break
    end
    if has_reviews then
      files_reviewed = files_reviewed + 1
    end
  end

  local total_hunks, reviewed_hunks = M.count_all_hunks()
  local counter_text = string.format('[%d/%d]', reviewed_hunks, total_hunks)

  local lines = {}

  -- Add file entries
  for i, file in ipairs(M.review_state.files) do
    -- Use vim_hunks_reviewed for accurate display
    local vim_reviewed = file.vim_hunks_reviewed or {}
    local reviewed_count = 0
    for _ in pairs(vim_reviewed) do
      reviewed_count = reviewed_count + 1
    end

    -- Determine status symbol
    local status_symbol = '   '
    if i == M.review_state.current_file_index then
      status_symbol = ' ● '  -- Current file
    elseif file.total_hunks > 0 and reviewed_count >= file.total_hunks then
      status_symbol = ' ✓ '  -- All hunks reviewed
    end

    local progress = string.format('[%d/%d]', reviewed_count, file.total_hunks)
    local file_line = string.format(' %s %-7s  %s', status_symbol, progress, file.filepath)
    table.insert(lines, file_line)
  end


  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.api.nvim_buf_set_option(buf, 'modifiable', false)

  -- Create centered popup window
  local width = vim.o.columns
  local height = vim.o.lines
  local win_width = math.min(65, width - 4)
  local win_height = math.min(#lines, height - 4)
  local row = math.floor((height - win_height) / 2)
  local col = math.floor((width - win_width) / 2)

  local win = vim.api.nvim_open_win(buf, true, {
    relative = 'editor',
    row = row,
    col = col,
    width = win_width,
    height = win_height,
    style = 'minimal',
    border = 'rounded',
    title = ' Select File to Review ' .. counter_text .. ' ',
    title_pos = 'center',
    footer = ' Enter:Select q:Cancel ',
    footer_pos = 'center',
  })

  M.file_selector_bufnr = buf
  M.file_selector_winnr = win

  -- Set up highlight for current line
  vim.api.nvim_win_set_option(win, 'cursorline', true)
  vim.api.nvim_win_set_option(win, 'number', false)
  vim.api.nvim_win_set_option(win, 'relativenumber', false)

  -- Position cursor on current file (1-based index directly matches line number)
  local cursor_line = M.review_state.current_file_index
  vim.api.nvim_win_set_cursor(win, {cursor_line, 0})

  -- Setup keymaps for file selector navigation
  local opts = { buffer = buf, silent = true, noremap = true }

  -- Enter: Jump to selected file
  vim.keymap.set('n', '<CR>', function()
    local cursor = vim.api.nvim_win_get_cursor(win)
    local selected_line = cursor[1]
    -- Direct mapping since we removed the header
    local file_index = selected_line

    if file_index >= 1 and file_index <= #M.review_state.files then
      -- Close selector
      vim.api.nvim_win_close(win, true)
      M.file_selector_winnr = nil
      M.file_selector_bufnr = nil

      -- Jump to selected file
      M.jump_to_file(file_index)
    else
      vim.notify('Invalid selection', vim.log.levels.WARN)
    end
  end, opts)

  -- ESC or q: Close menu without action
  vim.keymap.set('n', 'q', function()
    M.close_file_selector()
  end, opts)

  vim.keymap.set('n', '<Esc>', function()
    M.close_file_selector()
  end, opts)
end

---Close file selector
function M.close_file_selector()
  if M.file_selector_winnr and vim.api.nvim_win_is_valid(M.file_selector_winnr) then
    vim.api.nvim_win_close(M.file_selector_winnr, true)
  end
  M.file_selector_winnr = nil
  M.file_selector_bufnr = nil
end

---Jump to a specific file for review
---@param file_index number 1-based file index
function M.jump_to_file(file_index)
  if file_index < 1 or file_index > #M.review_state.files then
    vim.notify('Invalid file index', vim.log.levels.ERROR)
    return
  end

  -- Update current position to selected file
  M.review_state.current_file_index = file_index
  M.review_state.current_hunk_index = 0 -- Start at first hunk (0-indexed)

  local file = M.review_state.files[file_index]

  -- Show diff for selected file, starting at first hunk
  M.show_file_diff(file, 0)
end

---Show the next hunk in sequence
function M.show_next_hunk()
  -- In multi-file mode, advance through files
  if M.review_state.is_multi_file then
    local current_file = M.get_current_file()
    if not current_file then
      return
    end

    -- Check if we've finished all hunks in current file
    if M.review_state.current_hunk_index >= current_file.total_hunks then
      -- Move to next file
      M.review_state.current_file_index = M.review_state.current_file_index + 1
      M.review_state.current_hunk_index = 0

      if M.review_state.current_file_index > #M.review_state.files then
        M.show_completion_message()
        return
      end

      current_file = M.get_current_file()
      if not current_file then
        M.show_completion_message()
        return
      end
    end

    -- Show the hunk as a diff view
    M.show_file_diff(current_file, M.review_state.current_hunk_index)
  else
    -- Per-hunk mode (waits for next IPC message)
    return
  end
end

---Show completion message when all files are reviewed
function M.show_completion_message()
  -- Check if ALL hunks across ALL files have actually been reviewed
  local stats = M.calculate_review_stats()

  if stats.unreviewed_hunks == 0 then
    -- All hunks reviewed, auto-submit
    vim.notify('All files reviewed. Submitting...', vim.log.levels.INFO)
    M.send_all_decisions()
  else
    -- Some hunks unreviewed, show file selector so user can continue
    vim.notify(string.format('%d hunks remaining. Use <leader>sf to select file or <leader>d to submit.', stats.unreviewed_hunks), vim.log.levels.INFO)
    M.close_diff_windows()
    M.setup_global_keymaps()
  end
end

---Close diff windows without resetting review state
function M.close_diff_windows()
  -- Hide menu
  M.hide_command_menu()

  -- Try to resurrect terminal first if needed
  local ok, deft = pcall(require, 'deft')
  if ok and deft.state.terminal_hidden and deft.show_terminal then
    deft.show_terminal()
    M.deft_terminal_winnr = deft.state.terminal_winnr
  end

  -- Turn off diff mode and close windows
  if M.diff_winnr_old and vim.api.nvim_win_is_valid(M.diff_winnr_old) then
    vim.api.nvim_set_current_win(M.diff_winnr_old)
    vim.cmd('diffoff')
    safe_close_win(M.diff_winnr_old)
  end

  if M.diff_winnr_new and vim.api.nvim_win_is_valid(M.diff_winnr_new) then
    vim.api.nvim_set_current_win(M.diff_winnr_new)
    vim.cmd('diffoff')
    safe_close_win(M.diff_winnr_new)
  end

  M.diff_winnr_old = nil
  M.diff_winnr_new = nil

  -- Return focus to Deft terminal
  if M.deft_terminal_winnr and vim.api.nvim_win_is_valid(M.deft_terminal_winnr) then
    vim.api.nvim_set_current_win(M.deft_terminal_winnr)
  end
end

---Setup global keymaps that work even without diff windows
function M.setup_global_keymaps()
  -- Use current buffer (should be terminal) for global keymaps
  local buf = vim.api.nvim_get_current_buf()
  local opts = { buffer = buf, silent = true, noremap = true }

  -- Submit review
  vim.keymap.set('n', '<leader>d', function()
    M.send_all_decisions()
  end, opts)

  -- File selector
  vim.keymap.set('n', '<leader>sf', function()
    M.show_file_selector()
  end, opts)
end

---Show diff for a specific file
---@param file table File info from review_state
---@param hunk_index number 0-based hunk index
function M.show_file_diff(file, hunk_index)
  if not file.existing_content or not file.new_content then
    vim.notify('File content not available', vim.log.levels.ERROR)
    return
  end

  -- Save original window/buffer if not already saved
  if not M.original_winnr or not vim.api.nvim_win_is_valid(M.original_winnr) then
    M.original_winnr = vim.api.nvim_get_current_win()
    M.original_bufnr = vim.api.nvim_get_current_buf()
  end

  -- Create diff buffers
  local buf_old = vim.api.nvim_create_buf(false, true)
  local buf_new = vim.api.nvim_create_buf(false, true)

  -- Prepare content
  local old_lines = vim.split(file.existing_content or '', '\n')
  local new_lines = vim.split(file.new_content or '', '\n')

  -- Detect filetype from filepath extension
  local filetype = vim.filetype.match({ filename = file.filepath, contents = old_lines })
  if not filetype or filetype == '' then
    local ext = vim.fn.fnamemodify(file.filepath, ':e')
    if ext and ext ~= '' then
      filetype = vim.filetype.match({ filename = 'dummy.' .. ext }) or ext
    end
  end

  -- Set buffer options
  for _, buf in ipairs({buf_old, buf_new}) do
    vim.api.nvim_buf_set_option(buf, 'buftype', 'nofile')
    vim.api.nvim_buf_set_option(buf, 'bufhidden', 'wipe')
    vim.api.nvim_buf_set_option(buf, 'swapfile', false)
    if filetype and filetype ~= '' then
      vim.api.nvim_buf_set_option(buf, 'filetype', filetype)
    end
  end

  -- Set buffer content
  vim.api.nvim_buf_set_lines(buf_old, 0, -1, false, old_lines)
  vim.api.nvim_buf_set_lines(buf_new, 0, -1, false, new_lines)

  -- Calculate and store hunk positions
  M.calculate_hunk_positions(buf_old, buf_new, file)

  -- Update file's total_hunks based on vim.diff (for UI navigation)
  -- Update file's total_hunks based on actual diff
  local current_file = M.get_current_file()
  if current_file then
    current_file.total_hunks = #M.current_hunk_positions
  end

  -- Set buffer names (use unique names to avoid conflicts)
  M.buffer_counter = M.buffer_counter + 1
  vim.api.nvim_buf_set_name(buf_old, string.format('[Deft Old %d] %s', M.buffer_counter, file.filepath))
  vim.api.nvim_buf_set_name(buf_new, string.format('[Deft New %d] %s', M.buffer_counter, file.filepath))

  -- REUSE WINDOWS STRATEGY:
  -- If diff windows already exist and are valid, reuse them.
  -- This prevents the "3-panel" bug and screen flicker.
  local win_old, win_new

  if M.diff_winnr_old and vim.api.nvim_win_is_valid(M.diff_winnr_old) and
     M.diff_winnr_new and vim.api.nvim_win_is_valid(M.diff_winnr_new) then

    -- Reuse existing windows
    win_old = M.diff_winnr_old
    win_new = M.diff_winnr_new

    vim.api.nvim_win_set_buf(win_old, buf_old)
    vim.api.nvim_win_set_buf(win_new, buf_new)

    -- Clean up old buffers
    if M.diff_bufnr_old and vim.api.nvim_buf_is_valid(M.diff_bufnr_old) then
      vim.api.nvim_buf_delete(M.diff_bufnr_old, {force = true})
    end
    if M.diff_bufnr_new and vim.api.nvim_buf_is_valid(M.diff_bufnr_new) then
      vim.api.nvim_buf_delete(M.diff_bufnr_new, {force = true})
    end

  else
    -- Create new split layout
    -- Ensure we don't split the terminal
    if M.deft_terminal_winnr and vim.api.nvim_win_is_valid(M.deft_terminal_winnr) then
      vim.api.nvim_set_current_win(M.deft_terminal_winnr)
      -- Create split to the left of terminal
      vim.cmd('leftabove vsplit')
    else
      -- Fallback if terminal hidden/invalid
      vim.cmd('vsplit')
    end

    win_new = vim.api.nvim_get_current_win() -- Right pane (New)
    vim.api.nvim_win_set_buf(win_new, buf_new)

    vim.cmd('leftabove vsplit')
    win_old = vim.api.nvim_get_current_win() -- Left pane (Old)
    vim.api.nvim_win_set_buf(win_old, buf_old)
  end

  -- Update state
  M.diff_bufnr_old = buf_old
  M.diff_bufnr_new = buf_new
  M.diff_winnr_old = win_old
  M.diff_winnr_new = win_new

  -- Enable diff mode
  vim.api.nvim_win_call(win_old, function() vim.cmd('diffthis') end)
  vim.api.nvim_win_call(win_new, function() vim.cmd('diffthis') end)

  -- Focus on new content window
  vim.api.nvim_set_current_win(win_new)

  -- Highlight and jump to current hunk
  M.highlight_current_hunk()

  -- Setup keymaps
  M.setup_diff_keymaps()

  -- Show command menu
  M.show_command_menu()
end

---Calculate hunk positions in the diff buffers
---@param buf_old number Old buffer
---@param buf_new number New buffer
---@param file table File info
function M.calculate_hunk_positions(buf_old, buf_new, file)
  M.current_hunk_positions = {}
  M.vim_to_patch_hunk_map = {}

  -- Parse diff to find hunk boundaries
  local old_lines = vim.api.nvim_buf_get_lines(buf_old, 0, -1, false)
  local new_lines = vim.api.nvim_buf_get_lines(buf_new, 0, -1, false)

  -- Generate unified diff to identify hunks
  local diff_output = vim.diff(table.concat(old_lines, '\n'), table.concat(new_lines, '\n'), {
    result_type = 'indices',
  })

  if not diff_output then
    return
  end

  -- Store hunk positions (1-indexed line numbers)
  for i, hunk in ipairs(diff_output) do
    table.insert(M.current_hunk_positions, {
      old_start = hunk[1],
      old_count = hunk[2],
      new_start = hunk[3],
      new_count = hunk[4],
    })
  end

  -- Build mapping from vim.diff hunks to patch hunks
  if file.patch_hunks and #file.patch_hunks > 0 then
    M.current_file_patch_hunks = file.patch_hunks
    M.build_hunk_mapping()
  else
    -- Fallback: 1-to-1 mapping
    for i = 1, #M.current_hunk_positions do
      M.vim_to_patch_hunk_map[i - 1] = i - 1
    end
  end
end

---Build mapping from vim.diff hunk indices to patch hunk indices
function M.build_hunk_mapping()
  for vim_idx, vim_hunk in ipairs(M.current_hunk_positions) do
    local patch_idx = M.find_containing_patch_hunk(vim_hunk)
    M.vim_to_patch_hunk_map[vim_idx - 1] = patch_idx
  end
end

---Find which patch hunk contains a given vim.diff hunk
---@param vim_hunk table Vim hunk with new_start and new_count
---@return number patch_hunk_index (0-based)
function M.find_containing_patch_hunk(vim_hunk)
  local vim_start = vim_hunk.new_start
  local vim_end = vim_hunk.new_start + vim_hunk.new_count - 1

  for _, patch_hunk in ipairs(M.current_file_patch_hunks) do
    local patch_start = patch_hunk.newStart
    local patch_end = patch_hunk.newStart + patch_hunk.newCount - 1

    -- Check if vim hunk overlaps with patch hunk
    if vim_start >= patch_start and vim_start <= patch_end then
      return patch_hunk.hunkIndex
    end
  end

  -- Fallback: if no overlap found, use first hunk's index
  return M.current_file_patch_hunks[1] and M.current_file_patch_hunks[1].hunkIndex or 0
end

---Highlight the current hunk
function M.highlight_current_hunk()
  if #M.current_hunk_positions == 0 then
    return
  end

  local hunk_idx = M.review_state.current_hunk_index + 1  -- Convert to 1-based
  if hunk_idx < 1 or hunk_idx > #M.current_hunk_positions then
    return
  end

  local hunk = M.current_hunk_positions[hunk_idx]

  -- Clear previous highlights
  M.clear_hunk_highlights()

  -- Create highlight namespace if not exists
  if not M.hunk_ns then
    M.hunk_ns = vim.api.nvim_create_namespace('deft_current_hunk')
  end

  -- Highlight in old buffer (left)
  if M.diff_bufnr_old and vim.api.nvim_buf_is_valid(M.diff_bufnr_old) then
    if hunk.old_count > 0 then
      for line = hunk.old_start, hunk.old_start + hunk.old_count - 1 do
        vim.api.nvim_buf_add_highlight(M.diff_bufnr_old, M.hunk_ns, 'DiffDelete', line - 1, 0, -1)
      end
    end
  end

  -- Highlight in new buffer (right)
  if M.diff_bufnr_new and vim.api.nvim_buf_is_valid(M.diff_bufnr_new) then
    if hunk.new_count > 0 then
      for line = hunk.new_start, hunk.new_start + hunk.new_count - 1 do
        vim.api.nvim_buf_add_highlight(M.diff_bufnr_new, M.hunk_ns, 'DiffAdd', line - 1, 0, -1)
      end
    end
  end

  -- Jump to hunk in the new buffer (right window)
  if M.diff_winnr_new and vim.api.nvim_win_is_valid(M.diff_winnr_new) then
    vim.api.nvim_set_current_win(M.diff_winnr_new)
    local target_line = hunk.new_count > 0 and hunk.new_start or hunk.new_start
    vim.api.nvim_win_set_cursor(M.diff_winnr_new, {target_line, 0})
    vim.cmd('normal! zz')  -- Center cursor
  end
end

---Clear hunk highlights
function M.clear_hunk_highlights()
  if not M.hunk_ns then
    return
  end

  if M.diff_bufnr_old and vim.api.nvim_buf_is_valid(M.diff_bufnr_old) then
    vim.api.nvim_buf_clear_namespace(M.diff_bufnr_old, M.hunk_ns, 0, -1)
  end

  if M.diff_bufnr_new and vim.api.nvim_buf_is_valid(M.diff_bufnr_new) then
    vim.api.nvim_buf_clear_namespace(M.diff_bufnr_new, M.hunk_ns, 0, -1)
  end
end

---Move to next hunk within current file
function M.next_hunk_in_file()
  if #M.current_hunk_positions == 0 then
    vim.notify('No hunks in current file', vim.log.levels.WARN)
    return
  end

  local current_file = M.get_current_file()
  if not current_file then
    return
  end

  -- Move to next hunk
  if M.review_state.current_hunk_index + 1 < #M.current_hunk_positions then
    M.review_state.current_hunk_index = M.review_state.current_hunk_index + 1
    M.highlight_current_hunk()
    M.show_command_menu()  -- Update menu to show new hunk index
  else
    vim.notify('Already at last hunk in this file', vim.log.levels.INFO)
  end
end

---Move to previous hunk within current file
function M.prev_hunk_in_file()
  if #M.current_hunk_positions == 0 then
    vim.notify('No hunks in current file', vim.log.levels.WARN)
    return
  end

  local current_file = M.get_current_file()
  if not current_file then
    return
  end

  -- Move to previous hunk
  if M.review_state.current_hunk_index > 0 then
    M.review_state.current_hunk_index = M.review_state.current_hunk_index - 1
    M.highlight_current_hunk()
    M.show_command_menu()  -- Update menu to show new hunk index
  else
    vim.notify('Already at first hunk in this file', vim.log.levels.INFO)
  end
end

---Record current hunk decision and advance
---@param decision string 'accept' or 'reject'
function M.record_current_hunk(decision)
  local current_file = M.get_current_file()
  if not current_file then
    return
  end

  -- Map vim.diff hunk index to patch hunk index
  local vim_hunk_idx = M.review_state.current_hunk_index
  local patch_hunk_idx = M.vim_to_patch_hunk_map[vim_hunk_idx]

  patch_hunk_idx = patch_hunk_idx or vim_hunk_idx

  -- Record decision for PATCH hunk (for IPC response)
  if not M.review_state.reviews[current_file.filepath] then
    M.review_state.reviews[current_file.filepath] = {}
  end

  if M.review_state.reviews[current_file.filepath][patch_hunk_idx] == nil then
    M.review_state.reviews[current_file.filepath][patch_hunk_idx] = decision
  end

  -- Also track vim hunk as reviewed (for completion checking)
  if not current_file.vim_hunks_reviewed then
    current_file.vim_hunks_reviewed = {}
  end
  current_file.vim_hunks_reviewed[vim_hunk_idx] = true

  -- Move to next hunk in current file, or next file
  if M.review_state.current_hunk_index + 1 < #M.current_hunk_positions then
    -- More hunks in this file
    M.review_state.current_hunk_index = M.review_state.current_hunk_index + 1
    M.highlight_current_hunk()
    M.show_command_menu()
  else
    -- Current file done - find next unreviewed file or complete
    M.advance_to_next_unreviewed()
  end
end

---Find and advance to next file with unreviewed hunks
function M.advance_to_next_unreviewed()
  -- Check if all files are fully reviewed
  local stats = M.calculate_review_stats()
  if stats.unreviewed_hunks == 0 then
    M.show_completion_message()
    return
  end

  -- Find first file with unreviewed hunks
  for i, file in ipairs(M.review_state.files) do
    local vim_reviewed = file.vim_hunks_reviewed or {}
    local reviewed_count = 0
    for _ in pairs(vim_reviewed) do
      reviewed_count = reviewed_count + 1
    end

    -- File has unreviewed hunks if reviewed < total (and total > 0)
    if file.total_hunks > 0 and reviewed_count < file.total_hunks then
      M.review_state.current_file_index = i
      M.review_state.current_hunk_index = 0
      M.show_file_diff(file, 0)
      return
    end
  end

  -- All reviewed (fallback)
  M.show_completion_message()
end
---Show current hunk (legacy mode)
function M.show_current_hunk()
  if not M.current_diff or not M.current_diff.hunkContent then
    vim.notify('[Deft Diff] No hunk content available', vim.log.levels.ERROR)
    return
  end

  local message = M.current_diff

  -- Save original window/buffer
  if not M.original_winnr or not vim.api.nvim_win_is_valid(M.original_winnr) then
    M.original_winnr = vim.api.nvim_get_current_win()
    M.original_bufnr = vim.api.nvim_get_current_buf()
  end

  -- Parse unified diff to extract old and new content
  local hunk_lines = vim.split(message.hunkContent, '\n')
  local old_lines = {}
  local new_lines = {}

  for _, line in ipairs(hunk_lines) do
    if line:sub(1, 1) == '-' and line:sub(1, 3) ~= '---' then
      table.insert(old_lines, line:sub(2))
    elseif line:sub(1, 1) == '+' and line:sub(1, 3) ~= '+++' then
      table.insert(new_lines, line:sub(2))
    elseif line:sub(1, 1) == ' ' then
      table.insert(old_lines, line:sub(2))
      table.insert(new_lines, line:sub(2))
    end
  end

  -- Create buffers
  local buf_old = vim.api.nvim_create_buf(false, true)
  local buf_new = vim.api.nvim_create_buf(false, true)

  vim.api.nvim_buf_set_option(buf_old, 'buftype', 'nofile')
  vim.api.nvim_buf_set_option(buf_old, 'bufhidden', 'wipe')
  vim.api.nvim_buf_set_option(buf_new, 'buftype', 'nofile')
  vim.api.nvim_buf_set_option(buf_new, 'bufhidden', 'wipe')

  vim.api.nvim_buf_set_lines(buf_old, 0, -1, false, old_lines)
  vim.api.nvim_buf_set_lines(buf_new, 0, -1, false, new_lines)

  -- Set buffer names (use unique names)
  M.buffer_counter = M.buffer_counter + 1
  vim.api.nvim_buf_set_name(buf_old, string.format('[Deft Old %d] %s', M.buffer_counter, message.filepath))
  vim.api.nvim_buf_set_name(buf_new, string.format('[Deft New %d] %s', M.buffer_counter, message.filepath))

  -- Calculate window layout

  -- Create windows
  vim.cmd('leftabove vsplit')
  local win_old = vim.api.nvim_get_current_win()
  vim.api.nvim_win_set_buf(win_old, buf_old)

  vim.api.nvim_set_current_win(win_old)
  vim.cmd('rightbelow vsplit')
  local win_new = vim.api.nvim_get_current_win()
  vim.api.nvim_win_set_buf(win_new, buf_new)

  M.diff_bufnr_old = buf_old
  M.diff_bufnr_new = buf_new
  M.diff_winnr_old = win_old
  M.diff_winnr_new = win_new

  -- Enable diff mode
  vim.api.nvim_set_current_win(win_old)
  vim.cmd('diffthis')
  vim.api.nvim_set_current_win(win_new)
  vim.cmd('diffthis')

  vim.api.nvim_set_current_win(win_new)

  vim.cmd('wincmd =') -- Force equal width

  M.setup_diff_keymaps()
  M.show_command_menu()
end

---Show write diff (full file write confirmation)
function M.show_write_diff(message)
  -- Check if this file is already in review state
  local file_index = nil
  for i, file in ipairs(M.review_state.files) do
    if file.filepath == message.filepath then
      file_index = i
      break
    end
  end

  -- Add file if not present
  if not file_index then
    table.insert(M.review_state.files, {
      filepath = message.filepath,
      total_hunks = 1,
      hunks = {},
      existing_content = message.existingContent or '',
      new_content = message.newContent or '',
      is_new_file = message.existingContent == nil or message.existingContent == '',
      patch_hunks = {},
      patch_hunk_count = 1,
    })
    file_index = #M.review_state.files
  end

  -- Update current position
  M.review_state.current_file_index = file_index
  M.review_state.current_hunk_index = 0

  -- Initialize reviews for this file
  if not M.review_state.reviews[message.filepath] then
    M.review_state.reviews[message.filepath] = {}
  end

  local file = M.review_state.files[file_index]
  M.show_file_diff(file, 0)
end

---Show command menu
function M.show_command_menu()
  if M.menu_winnr and vim.api.nvim_win_is_valid(M.menu_winnr) then
    return
  end

  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_option(buf, 'bufhidden', 'wipe')
  vim.api.nvim_buf_set_option(buf, 'buftype', 'nofile')
  vim.api.nvim_buf_set_option(buf, 'modifiable', true)

  local current_file = M.get_current_file()

  -- Get vim and patch hunk indices
  local vim_hunk_idx = M.review_state.current_hunk_index
  local patch_hunk_idx = M.vim_to_patch_hunk_map[vim_hunk_idx] or vim_hunk_idx

  local file_progress = ''
  if current_file then
    -- Use actual hunk count from current_hunk_positions
    local hunks_in_file = #M.current_hunk_positions
    if hunks_in_file == 0 then
      hunks_in_file = current_file.total_hunks
    end

    local patch_hunk_count = current_file.patch_hunk_count or hunks_in_file

    file_progress = string.format('...%s [file %d/%d, vim %d/%d, patch %d/%d]',
      current_file.filepath,
      M.review_state.current_file_index,
      #M.review_state.files,
      vim_hunk_idx + 1,
      hunks_in_file,
      patch_hunk_idx + 1,
      patch_hunk_count)
  end

  local absolute_hunk = M.get_absolute_hunk_index()
  local total_hunks = M.count_all_hunks()

  local files_reviewed = 0
  for _, file in ipairs(M.review_state.files) do
    if M.count_reviewed(file.filepath) > 0 then
      files_reviewed = files_reviewed + 1
    end
  end

  -- Build header with progress
  local header_text = file_progress
  if #header_text > 38 then
    header_text = '...' .. header_text:sub(-35)
  end

  local global_progress = string.format('[%d/%d]', absolute_hunk, total_hunks)

  local review_text = string.format('  Reviewing: %s', header_text)
  local padding = string.rep(' ', 60 - #review_text - #global_progress)

  local lines = {
    '╔════════════════════════════════════════════════════════════╗',
    string.format('║%s%s%s║', review_text, padding, global_progress),
    '╠════════════════════════════════════════════════════════════╣',
    '║  Commands:                                                 ║',
    '║    a            Accept this change                         ║',
    '║    r            Reject with message                        ║',
    '║                                                            ║',
    '║    j/Down       Next hunk in file                          ║',
    '║    k/Up         Previous hunk in file                      ║',
    '║    <leader>sf   Select file to review                      ║',
    '║    <leader>d    Done - Submit review                       ║',
    '║    <leader>r    Reject all remaining                       ║',
    '║                                                            ║',
    '╚════════════════════════════════════════════════════════════╝',
  }

  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.api.nvim_buf_set_option(buf, 'modifiable', false)

  -- Create floating window at bottom-right of screen
  local width = vim.o.columns
  local height = vim.o.lines
  local win_width = 62
  local win_height = #lines

  local win = vim.api.nvim_open_win(buf, false, {
    relative = 'editor',
    row = height - win_height - 2,
    col = width - win_width - 2,
    width = win_width,
    height = win_height,
    style = 'minimal',
    border = 'none',
  })

  M.menu_bufnr = buf
  M.menu_winnr = win
end

---Hide command menu
function M.hide_command_menu()
  if M.menu_winnr and vim.api.nvim_win_is_valid(M.menu_winnr) then
    vim.api.nvim_win_close(M.menu_winnr, true)
  end
  M.menu_winnr = nil
  M.menu_bufnr = nil
end

---Prompt user for rejection message
function M.prompt_rejection_message()
  M.hide_command_menu()

  vim.ui.input({
    prompt = 'Rejection reason (or press Enter for default): ',
    default = '',
  }, function(input)
    if input == nil then
      -- User cancelled (pressed ESC)
      M.show_command_menu()
      return
    end

    local message = (input and #input > 0) and input or "User rejected"
    M.record_and_advance('reject', message)
  end)
end

---Record review decision and advance to next hunk
---@param decision string 'accept' or 'reject'
---@param rejection_message string|nil Optional rejection message
function M.record_and_advance(decision, rejection_message)
  local current_file = M.get_current_file()
  if not current_file then
    return
  end

  -- Record decision in review state
  if not M.review_state.reviews[current_file.filepath] then
    M.review_state.reviews[current_file.filepath] = {}
  end
  M.review_state.reviews[current_file.filepath][M.review_state.current_hunk_index] = decision

  -- Increment hunk index for next hunk
  M.review_state.current_hunk_index = M.review_state.current_hunk_index + 1

  -- Show next hunk (handles file advancement)
  M.show_next_hunk()
end

function M.setup_diff_keymaps()
  local buffers = {M.diff_bufnr_old, M.diff_bufnr_new}

  for _, bufnr in ipairs(buffers) do
    if bufnr and vim.api.nvim_buf_is_valid(bufnr) then
      local opts = { buffer = bufnr, silent = true, noremap = true }

      -- Navigation
      vim.keymap.set('n', '<Down>', function()
        M.next_hunk_in_file()
      end, vim.tbl_extend('force', opts, { desc = 'Next hunk in file' }))

      vim.keymap.set('n', '<Up>', function()
        M.prev_hunk_in_file()
      end, vim.tbl_extend('force', opts, { desc = 'Previous hunk in file' }))

      vim.keymap.set('n', 'j', function()
        M.next_hunk_in_file()
      end, vim.tbl_extend('force', opts, { desc = 'Next hunk in file' }))

      vim.keymap.set('n', 'k', function()
        M.prev_hunk_in_file()
      end, vim.tbl_extend('force', opts, { desc = 'Previous hunk in file' }))

      -- Actions
      vim.keymap.set('n', 'a', function()
        M.record_current_hunk('accept')
      end, vim.tbl_extend('force', opts, { desc = 'Accept change' }))

      vim.keymap.set('n', 'r', function()
        -- Hide command menu while typing
        M.hide_command_menu()

        -- Prompt for rejection message using multi-line input
        require('deft.query').show_multiline_input('Why reject this hunk?', function(input)
          -- input is the text (can be empty)

          -- Record rejection for PATCH hunk
          local current_file = M.get_current_file()
          if not current_file then
            return
          end

          local vim_hunk_idx = M.review_state.current_hunk_index
          local patch_hunk_idx = M.vim_to_patch_hunk_map[vim_hunk_idx]

          if patch_hunk_idx == nil then
            if M.debug_enabled then
              vim.notify(string.format('No patch mapping for vim hunk %d', vim_hunk_idx), vim.log.levels.WARN)
            end
            patch_hunk_idx = vim_hunk_idx
          end

          if not M.review_state.reviews[current_file.filepath] then
            M.review_state.reviews[current_file.filepath] = {}
          end

          -- Store rejection with message as a table
          local rejection_msg = (input and #input > 0) and input or 'User rejected'

          if M.review_state.reviews[current_file.filepath][patch_hunk_idx] == nil then
            M.review_state.reviews[current_file.filepath][patch_hunk_idx] = {
              decision = 'reject',
              messages = { rejection_msg }  -- Use array to accumulate messages
            }
          else
            -- Patch hunk already has a decision - append message if rejecting
            local existing = M.review_state.reviews[current_file.filepath][patch_hunk_idx]
            if existing.decision == 'reject' and existing.messages then
              table.insert(existing.messages, rejection_msg)
            end
          end

          -- Track vim hunk as reviewed (for completion checking)
          if not current_file.vim_hunks_reviewed then
            current_file.vim_hunks_reviewed = {}
          end
          current_file.vim_hunks_reviewed[vim_hunk_idx] = true

          -- Advance to next hunk (same logic as accept)
          M.advance_after_decision()
        end, function()
          -- On Cancel (Esc): restore the menu
          M.show_command_menu()
        end)
      end, vim.tbl_extend('force', opts, { desc = 'Reject with message' }))

      -- File selector
      vim.keymap.set('n', '<leader>sf', function()
        M.show_file_selector()
      end, vim.tbl_extend('force', opts, { desc = 'Select file to review' }))

      -- Submit review
      vim.keymap.set('n', '<leader>d', function()
        M.send_all_decisions()
      end, vim.tbl_extend('force', opts, { desc = 'Done - Submit review' }))

      -- Reject all remaining
      vim.keymap.set('n', '<leader>r', function()
        M.send_confirmation('reject-all')
      end, vim.tbl_extend('force', opts, { desc = 'Reject all remaining changes' }))
    end
  end
end

---Advance to next hunk after a decision (extracted logic)
function M.advance_after_decision()
  -- Move to next hunk in current file, or next file
  if M.review_state.current_hunk_index + 1 < #M.current_hunk_positions then
    -- More hunks in this file
    M.review_state.current_hunk_index = M.review_state.current_hunk_index + 1
    M.highlight_current_hunk()
    M.show_command_menu()
  else
    -- Move to next file
    M.review_state.current_file_index = M.review_state.current_file_index + 1
    M.review_state.current_hunk_index = 0

    if M.review_state.current_file_index > #M.review_state.files then
      -- All files done
      M.show_completion_message()
    else
      -- Show next file
      M.show_next_hunk()
    end
  end
end

---Send all file decisions to Deft
---Send all file decisions to Deft
function M.send_all_decisions()
  if not M.ipc_client or not M.current_diff then
    vim.notify('Cannot send decisions - no IPC connection', vim.log.levels.ERROR)
    return
  end

  -- CRITICAL: Mark all unreviewed hunks as 'accept' before sending
  -- This ensures the patch tool receives decisions for ALL hunks
  for _, file in ipairs(M.review_state.files) do
    local file_reviews = M.review_state.reviews[file.filepath] or {}
    local patch_count = file.patch_hunk_count or file.total_hunks

    -- Mark unreviewed hunks as accepted
    for hunk_idx = 0, patch_count - 1 do
      if file_reviews[hunk_idx] == nil then
        file_reviews[hunk_idx] = 'accept'
      end
    end

    M.review_state.reviews[file.filepath] = file_reviews
  end

  -- Build file decisions
  local file_decisions = {}
  local any_rejection = false
  for _, file in ipairs(M.review_state.files) do
    local file_reviews = M.review_state.reviews[file.filepath] or {}

    local reviewed_count = 0
    for _ in pairs(file_reviews) do
      reviewed_count = reviewed_count + 1
    end

    -- Build per-hunk decisions array
    local hunk_decisions = {}
    local all_accepted = true
    local any_rejected = false
    local patch_count = file.patch_hunk_count or file.total_hunks

    for hunk_idx = 0, patch_count - 1 do
      local hunk_decision = file_reviews[hunk_idx]

      if hunk_decision then
        -- Handle both string and table formats
        local decision_str = hunk_decision
        if type(hunk_decision) == 'table' then
          decision_str = hunk_decision.decision
        end

        table.insert(hunk_decisions, {
          hunkIndex = hunk_idx,
          decision = decision_str,
          message = type(hunk_decision) == 'table' and
            (hunk_decision.messages and table.concat(hunk_decision.messages, '; ') or hunk_decision.message) or nil,
        })

        if decision_str == 'reject' then
          all_accepted = false
          any_rejected = true
        end
      end
    end

    if any_rejected then
      any_rejection = true
    end

    -- Determine file-level decision
    local decision = 'accept'  -- Default
    -- Check if there are any rejections - don't compare counts since
    -- reviewed_count uses patch hunks while total_hunks uses vim.diff hunks
    if reviewed_count > 0 then
      if any_rejected then
        decision = 'partial'  -- Some hunks accepted, some rejected
      else
        decision = 'accept'   -- All hunks accepted
      end
    end

    table.insert(file_decisions, {
      filepath = file.filepath,
      decision = decision,
      hunkDecisions = hunk_decisions,
    })
  end

  if M.debug_enabled then
    vim.notify(string.format('[Deft Diff] Sending %d file decisions', #file_decisions), vim.log.levels.INFO)
  end

  -- Send confirmation response
  -- CRITICAL: Use 'accept' (not 'accept-all') when there are rejections
  -- 'accept-all' causes TypeScript to skip fileDecisions processing
  -- 'accept' falls through to the fileDecisions handler
  -- Note: 'partial' is NOT a valid top-level decision (only valid for file-level)
  local ipc_message = {
    requestId = M.current_diff.requestId,
    decision = any_rejection and 'accept' or 'accept-all',
    fileDecisions = file_decisions,
  }

  M.ipc_client:send_confirmation_response(ipc_message)

  M.close()
end

---Send confirmation response and close view (legacy mode)
---@param decision string User's decision
---@param rejection_message string|nil Optional rejection message
---@param edited_content string|nil Optional edited content
function M.send_confirmation(decision, rejection_message, edited_content)
  if M.debug_enabled then
    vim.notify('[Deft Diff] Sending confirmation: ' .. decision, vim.log.levels.INFO)
  end

  if M.ipc_client and M.current_diff and M.current_diff.requestId then
    local response = {
      requestId = M.current_diff.requestId,
      decision = decision,
    }

    if rejection_message then
      response.rejectionMessage = rejection_message
    end

    if edited_content then
      response.editedContent = edited_content
    end

    M.ipc_client:send_confirmation_response(response)
    M.close()
  end
end

---Restore saved source windows
function M.restore_source_windows()
  if #M.saved_source_windows == 0 then
    return
  end

  -- Restore windows to the left of the terminal
  -- Iterate and split relative to the terminal to reconstruct layout
  if M.deft_terminal_winnr and vim.api.nvim_win_is_valid(M.deft_terminal_winnr) then

    for _, win_info in ipairs(M.saved_source_windows) do
      if vim.api.nvim_buf_is_valid(win_info.bufnr) then
        -- Always focus terminal first so 'leftabove' places code to the left
        vim.api.nvim_set_current_win(M.deft_terminal_winnr)
        -- Create split to the left
        vim.cmd('leftabove vsplit')
        vim.api.nvim_win_set_buf(0, win_info.bufnr)
      end
    end
  end

  -- Clear saved state
  M.saved_source_windows = {}
end

---Close the diff view and return to Deft terminal
function M.close()
  -- Hide menu
  M.hide_command_menu()

  -- 1. Ensure Deft terminal is visible BEFORE closing diff windows
  -- This prevents the "last window closed" issue which creates empty scratch buffers
  local ok, deft = pcall(require, 'deft')
  local term_bufnr = ok and deft.state.terminal_bufnr or nil

  -- Check if terminal buffer is actually visible in any window
  local term_win_id = nil
  if term_bufnr and vim.api.nvim_buf_is_valid(term_bufnr) then
    term_win_id = vim.fn.bufwinid(term_bufnr)
  end

  -- If not visible, force it open
  if not term_win_id or term_win_id == -1 then
    if ok and deft.show_terminal then
      deft.show_terminal()
      -- update our reference
      term_win_id = deft.state.terminal_winnr
    end
  end

  M.deft_terminal_winnr = term_win_id

  -- 2. Now safe to close diff windows
  if M.diff_winnr_old and vim.api.nvim_win_is_valid(M.diff_winnr_old) then
    safe_close_win(M.diff_winnr_old)
  end

  if M.diff_winnr_new and vim.api.nvim_win_is_valid(M.diff_winnr_new) then
    safe_close_win(M.diff_winnr_new)
  end

  -- Restore saved source windows (this puts the layout back to [Code] | [Terminal])
  M.restore_source_windows()

  -- Balance windows naturally instead of forcing a hardcoded width
  if M.deft_terminal_winnr and vim.api.nvim_win_is_valid(M.deft_terminal_winnr) then
    vim.cmd('wincmd =')
  end

  M.diff_winnr_old = nil
  M.diff_winnr_new = nil
  M.current_diff = nil
  M.ipc_client = nil
  M.original_winnr = nil
  M.original_bufnr = nil

  -- Reset review state
  M.review_state = {
    current_file_index = 1,
    current_hunk_index = 0,
    reviews = {},
    files = {},
    patch_id = nil,
    is_multi_file = false,
  }

  -- 3. Force focus to Deft terminal
  if M.deft_terminal_winnr and vim.api.nvim_win_is_valid(M.deft_terminal_winnr) then
    vim.api.nvim_set_current_win(M.deft_terminal_winnr)
    vim.cmd('startinsert')
  end

  if M.debug_enabled then
    vim.notify('Diff view closed', vim.log.levels.INFO)
  end
end

return M
