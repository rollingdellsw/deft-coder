-- deft.nvim - Neovim integration for Deft coding agent
-- Main plugin initialization

local M = {}

-- Import submodules
local ipc = require('deft.ipc')
local diff_viewer = require('deft.diff')
local code_query = require('deft.query')
local hint = require('deft.hint')

-- Plugin state
M.state = {
  session_active = false,
  terminal_bufnr = nil,
  terminal_winnr = nil,
  terminal_job_id = nil,
  ipc_client = nil,
  working_dir = nil,
  terminal_hidden = false,
}

-- Configuration defaults
M.config = {
  -- Deft command to execute (base command, flags added based on config)
  deft_command = 'deft',

  -- Terminal split configuration
  split_position = 'vertical',
  split_size = 80,

  -- Keymaps
  keymaps = {
    code_query = '<leader>ca',  -- Ask about selected code
  },

  -- Show hint on visual selection
  show_hint = false,
  hint_delay = 500, -- ms to wait before showing hint

  -- Debug mode (enables verbose logging in both plugin and Deft)
  debug = false,

  -- Auto-hide terminal when switching focus away
  auto_hide = true,
}

---Setup the plugin with user configuration
---@param opts table|nil User configuration
function M.setup(opts)
  -- Merge user config with defaults
  M.config = vim.tbl_deep_extend('force', M.config, opts or {})

  -- Store working directory
  M.state.working_dir = vim.fn.getcwd()

  -- Setup keymaps
  M.setup_keymaps()

  -- Setup visual selection hint
  if M.config.show_hint then
    hint.setup(M.config.hint_delay)
  end

  -- Setup autocommands for diff display
  M.setup_autocmds()
end

---Launch Deft in a terminal split
---@param auto_focus boolean|nil If true, stay in terminal and enter insert mode (default: true)
function M.launch_deft(auto_focus)
  -- Default to auto-focus
  if auto_focus == nil then
    auto_focus = true
  end

  if M.state.session_active then
    vim.notify('Deft session already active', vim.log.levels.INFO)
    return
  end

  -- Create terminal split
  local split_cmd
  if M.config.split_position == 'vertical' then
    split_cmd = 'rightbelow ' .. M.config.split_size .. 'vsplit'
  else
    split_cmd = 'rightbelow ' .. M.config.split_size .. 'split'
  end

  -- Save original window BEFORE creating split
  local orig_winnr = vim.api.nvim_get_current_win()

  -- Save original buffer to prevent terminal mode from affecting it
  local orig_bufnr = vim.api.nvim_get_current_buf()

  -- Check if original buffer is empty/unnamed (fresh Neovim start)
  local is_empty_buffer = vim.api.nvim_buf_get_name(orig_bufnr) == ''
    and vim.api.nvim_buf_get_option(orig_bufnr, 'modified') == false
    and #vim.api.nvim_buf_get_lines(orig_bufnr, 0, -1, false) == 1
    and vim.api.nvim_buf_get_lines(orig_bufnr, 0, -1, false)[1] == ''

  -- Open split with new empty buffer
  vim.cmd(split_cmd)

  -- Create a new buffer for the terminal
  local term_bufnr = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_win_set_buf(0, term_bufnr)

  -- Store the new window (where terminal will be created)
  local new_winnr = vim.api.nvim_get_current_win()

  -- Close the original window if it was empty - do this BEFORE termopen
  -- This prevents terminal from appearing in both windows
  if is_empty_buffer and orig_winnr ~= new_winnr and vim.api.nvim_win_is_valid(orig_winnr) then
    vim.api.nvim_win_close(orig_winnr, true)
    orig_winnr = nil
  end

  -- Store terminal window
  M.state.terminal_winnr = vim.api.nvim_get_current_win()

  -- Generate unique temp file for port discovery
  local port_file = vim.fn.tempname()

  -- Build Deft command with flags based on config
  local deft_cmd = M.config.deft_command
  if M.config.debug then
    deft_cmd = deft_cmd .. ' --verbose'
  end

  -- Launch Deft in terminal using termopen
  M.state.terminal_job_id = vim.fn.termopen(deft_cmd, {
    cwd = M.state.working_dir,
    env = {
      DEFT_DEBUG = M.config.debug and '1' or '0',
      DEFT_PORT_FILE = port_file
    },
    on_exit = function(_, exit_code, _)
      -- Ensure temp file is cleaned up if Deft crashes early
      if vim.fn.filereadable(port_file) == 1 then
        os.remove(port_file)
      end
      vim.schedule(function()
        M.on_deft_exit(exit_code)
      end)
    end,
  })

  if M.state.terminal_job_id == 0 then
    vim.notify('Failed to launch Deft: invalid arguments', vim.log.levels.ERROR)
    return
  elseif M.state.terminal_job_id == -1 then
    vim.notify('Failed to launch Deft: command not found', vim.log.levels.ERROR)
    return
  end

  -- Get the terminal buffer (created by termopen)
  M.state.terminal_bufnr = vim.api.nvim_get_current_buf()

  -- Setup terminal buffer options
  -- Keep terminal buffer listed so it appears in :ls and can be switched to
  vim.api.nvim_buf_set_option(M.state.terminal_bufnr, 'buflisted', true)

  -- Set a friendly buffer name for easy identification
  vim.api.nvim_buf_set_name(M.state.terminal_bufnr, 'Deft')

  -- Make terminal buffer easier to identify
  vim.api.nvim_buf_set_option(M.state.terminal_bufnr, 'buftype', 'terminal')

  -- Prevent accidental modification
  vim.api.nvim_buf_set_option(M.state.terminal_bufnr, 'modifiable', false)

  -- Disable line numbers in terminal
  vim.api.nvim_win_set_option(M.state.terminal_winnr, 'number', false)
  vim.api.nvim_win_set_option(M.state.terminal_winnr, 'relativenumber', false)

  -- Setup buffer-local keymaps for terminal control
  local opts = { buffer = M.state.terminal_bufnr, noremap = true, silent = true }

  -- Ctrl+O: Exit terminal mode and return focus to previous window (like vim's Ctrl+O in insert)
  vim.keymap.set('t', '<C-o>', function()
    -- Exit terminal mode to normal mode
    vim.cmd('stopinsert')

    -- Find the first non-terminal window and switch to it
    local wins = vim.api.nvim_list_wins()
    for _, win in ipairs(wins) do
      local buf = vim.api.nvim_win_get_buf(win)
      local buftype = vim.api.nvim_buf_get_option(buf, 'buftype')
      if buftype ~= 'terminal' and win ~= M.state.terminal_winnr then
        vim.api.nvim_set_current_win(win)
        return
      end
    end
  end, vim.tbl_extend('force', opts, { desc = 'Exit deft terminal and return to code window' }))

  -- CRITICAL: Make ESC pass through to deft instead of exiting terminal mode
  -- By default, nvim captures ESC to exit terminal mode back to normal mode
  -- We want ESC to be sent to deft so it can handle insert->normal mode transition
  -- Use Ctrl+\ Ctrl+N to exit terminal mode and return to nvim normal mode
  vim.api.nvim_buf_set_keymap(M.state.terminal_bufnr, 't', '<Esc>', '<C-\\><C-N>i<Esc>', {
    noremap = true,
    silent = true,
    desc = 'Send ESC to deft (for insert->normal mode)'
  })

  -- Setup auto-hide on focus leave if enabled
  if M.config.auto_hide then
    vim.api.nvim_create_autocmd('WinLeave', {
      buffer = M.state.terminal_bufnr,
      callback = function()
        -- Only hide if the terminal is still valid and not already hidden
        if M.state.terminal_winnr and vim.api.nvim_win_is_valid(M.state.terminal_winnr) and not M.state.terminal_hidden then
          vim.api.nvim_win_hide(M.state.terminal_winnr)
          M.state.terminal_hidden = true
          if M.config.debug then
            vim.notify('[Deft] Terminal auto-hidden on focus leave', vim.log.levels.INFO)
          end
        end
      end,
    })
  end

  -- Setup terminal window close autocmd
  vim.api.nvim_create_autocmd('WinClosed', {
    pattern = tostring(M.state.terminal_winnr),
    callback = function()
      M.stop_deft()
    end,
    once = true,
  })

  -- Wait for Deft to start and find IPC port from terminal output
  local ipc_port = nil
  local max_attempts = 50  -- 5 seconds total

  for i = 1, max_attempts do
    vim.wait(100)

    -- Check if port file has been written
    if vim.fn.filereadable(port_file) == 1 then
      local lines = vim.fn.readfile(port_file)
      if #lines > 0 and lines[1] ~= '' then
        ipc_port = tonumber(lines[1])
        -- Clean up file immediately
        os.remove(port_file)
        break
      end
    end

    if ipc_port then
      break
    end
  end

  if not ipc_port then
    vim.notify('Failed to connect to Deft - port file not written', vim.log.levels.ERROR)
    vim.notify('Debug: Run :messages to see Deft output', vim.log.levels.WARN)
    -- Try cleanup one last time
    if vim.fn.filereadable(port_file) == 1 then os.remove(port_file) end
    return
  end

  -- Create IPC client using TCP port
  M.state.ipc_client = ipc.new(ipc_port)

  -- Set debug mode in IPC module
  ipc.debug_enabled = M.config.debug

  if M.config.debug then
    vim.notify('[Deft] IPC client created for port: ' .. tostring(ipc_port), vim.log.levels.INFO)
  end


  -- Start listening for messages from Deft (includes connection with retry)
  M.state.ipc_client:start_listening(M.handle_ipc_message)

  M.state.session_active = true

  -- Schedule notifications to avoid "Press ENTER" prompt
  vim.schedule(function()
    if not M.config.debug then
      vim.notify('✓ Deft ready', vim.log.levels.INFO)
    else
      vim.notify('Deft session started', vim.log.levels.INFO)
      vim.notify('[Deft] Listening for IPC messages...', vim.log.levels.INFO)
    end
  end)

  -- Focus terminal and enter insert mode if auto_focus is true
  if auto_focus then
    if M.state.terminal_winnr and vim.api.nvim_win_is_valid(M.state.terminal_winnr) then
      vim.api.nvim_set_current_win(M.state.terminal_winnr)
      vim.schedule(function()
        if M.state.terminal_winnr and vim.api.nvim_win_is_valid(M.state.terminal_winnr) then
          vim.cmd('startinsert')
        end
      end)
    end
  else
    -- Return to original window
    if orig_winnr and vim.api.nvim_win_is_valid(orig_winnr) then
      vim.api.nvim_set_current_win(orig_winnr)
    end
  end

end

---Stop Deft session
function M.stop_deft()
  if not M.state.session_active then
    return
  end

  -- Close IPC connection
  if M.state.ipc_client then
    M.state.ipc_client:close()
    M.state.ipc_client = nil
  end

  -- Stop terminal job if still running
  if M.state.terminal_job_id then
    vim.fn.jobstop(M.state.terminal_job_id)
    M.state.terminal_job_id = nil
  end

  -- Close terminal window if open
  if M.state.terminal_winnr and vim.api.nvim_win_is_valid(M.state.terminal_winnr) then
    vim.api.nvim_win_close(M.state.terminal_winnr, true)
  end

  M.state.terminal_winnr = nil
  M.state.terminal_bufnr = nil
  M.state.session_active = false

  vim.notify('Deft session stopped', vim.log.levels.INFO)
end

---Handle Deft process exit
---@param exit_code number
function M.on_deft_exit(exit_code)
  if exit_code == 0 then
    vim.notify('Deft exited normally', vim.log.levels.INFO)
  else
    vim.notify('Deft exited with code ' .. exit_code, vim.log.levels.WARN)
  end
  M.stop_deft()
end


---Handle incoming IPC messages
---@param message table Parsed IPC message
function M.handle_ipc_message(message)
  if M.config.debug then
    vim.notify('[Deft] Received IPC message: ' .. message.type, vim.log.levels.INFO)
    vim.notify('[Deft] Message details: ' .. vim.inspect(message):sub(1, 200), vim.log.levels.INFO)
  end

  if message.type == 'show_diff' then
    -- Set debug mode in diff viewer
    diff_viewer.debug_enabled = M.config.debug
    diff_viewer.show(message, M.state.ipc_client, M.state.terminal_winnr)
  else
    vim.notify('Unknown IPC message type: ' .. tostring(message.type), vim.log.levels.WARN)
  end
end

---Send code query from visual selection (called from keymap)
function M.send_code_query_from_selection()
  -- Save original window to return to for prompt
  local orig_win = vim.api.nvim_get_current_win()

  -- Start or show Deft if needed
  local was_inactive = not M.state.session_active
  if was_inactive then
    -- Schedule notification to avoid "Press ENTER" prompt
    vim.schedule(function()
      vim.notify('Starting Deft...', vim.log.levels.INFO)
    end)
    M.launch_deft(false)  -- Don't auto-focus, we need to show prompt first
    -- Wait longer for first-time startup
    vim.wait(3000)
    -- Return to original window for prompt
    if vim.api.nvim_win_is_valid(orig_win) then
      vim.api.nvim_set_current_win(orig_win)
    end
  elseif not M.is_terminal_visible_in_current_tab() then
    -- If terminal is not visible in current tab, show it
    M.show_terminal()
    -- Return to original window for prompt
    if vim.api.nvim_win_is_valid(orig_win) then
      vim.api.nvim_set_current_win(orig_win)
    end
  end
  -- Don't switch to terminal here - let the user input their query first
  -- The callback in prompt_and_send() will handle switching to terminal after input

  -- Hide hint
  require('deft.hint').hide()

  -- Use the new prompt_and_send which:
  -- 1. Gets selection + full file context
  -- 2. Prompts user in Neovim for instruction
  -- 3. Formats complete message
  -- 4. Sends to Deft
  -- 5. Calls callback to switch focus
  require('deft.query').prompt_and_send(function()
    -- This callback runs AFTER user has entered their input
    -- Now it's safe to switch focus to Deft terminal
    -- Make sure terminal is visible
    if not M.is_terminal_visible_in_current_tab() then
      M.show_terminal()
    end

    vim.schedule(function()
      if M.state.terminal_winnr and vim.api.nvim_win_is_valid(M.state.terminal_winnr) then
        vim.api.nvim_set_current_win(M.state.terminal_winnr)
        vim.cmd('startinsert')
      end
    end)
  end)

  -- Don't switch focus here! The callback above will do it after input.
end

---Start Deft from normal mode (no file required)
function M.start_deft_normal_mode()
  if not M.state.session_active then
    -- Start new session
    M.launch_deft()
  elseif M.state.terminal_hidden then
    -- Session exists but terminal is hidden - show it
    M.show_terminal()
    vim.cmd('startinsert')
  else
    -- Terminal already visible - just switch focus
    if M.state.terminal_winnr and vim.api.nvim_win_is_valid(M.state.terminal_winnr) then
      vim.api.nvim_set_current_win(M.state.terminal_winnr)
      vim.cmd('startinsert')
    else
      -- Window invalid but session active - recreate window
      M.show_terminal()
      vim.cmd('startinsert')
    end
  end
end

---Send a code query to Deft
---@param query string User's question
---@param selection table|nil Visual selection info {text, filepath, line_start, line_end}
function M.send_code_query(query, selection)
  -- Launch Deft if not already running
  if not M.state.session_active then
    M.launch_deft()
    -- Wait for Deft to start
    vim.wait(2000)
  end

  if not M.state.ipc_client then
    vim.notify('Failed to connect to Deft', vim.log.levels.ERROR)
    return
  end

  if not selection then
    vim.notify('No code selected', vim.log.levels.WARN)
    return
  end

  -- Send query via IPC
  M.state.ipc_client:send_code_query({
    filepath = selection.filepath,
    selection = selection.text,
    query = query,
    lineStart = selection.line_start,
    lineEnd = selection.line_end,
  })

  if M.config.debug then
    vim.notify('Query sent to Deft', vim.log.levels.INFO)
  end
end

---Check if the terminal window is currently visible in the current tab
---@return boolean visible True if terminal window exists and is visible in current tab
function M.is_terminal_visible_in_current_tab()
  -- No session means not visible
  if not M.state.session_active or not M.state.terminal_bufnr then
    return false
  end

  -- Check all windows in current tabpage for our terminal buffer
  local current_tab_wins = vim.api.nvim_tabpage_list_wins(0)
  for _, win in ipairs(current_tab_wins) do
    local buf = vim.api.nvim_win_get_buf(win)
    if buf == M.state.terminal_bufnr then
      return true
    end
  end

  return false
end

---Show the deft terminal if it's hidden
function M.show_terminal()
  if not M.state.session_active then
    vim.notify('No active Deft session', vim.log.levels.WARN)
    return false
  end

  -- Show terminal if buffer exists but is not visible in current tab
  if M.state.terminal_bufnr and not M.is_terminal_visible_in_current_tab() then
    -- Recreate the split with the same configuration
    local split_cmd
    if M.config.split_position == 'vertical' then
      split_cmd = 'rightbelow ' .. M.config.split_size .. 'vsplit'
    else
      split_cmd = 'rightbelow ' .. M.config.split_size .. 'split'
    end

    vim.cmd(split_cmd)
    vim.api.nvim_win_set_buf(0, M.state.terminal_bufnr)
    M.state.terminal_winnr = vim.api.nvim_get_current_win()
    M.state.terminal_hidden = false

    if M.config.debug then
      vim.notify('[Deft] Terminal shown', vim.log.levels.INFO)
    end
    return true
  end
  return false
end

---Setup keymaps
function M.setup_keymaps()
  -- Code query from visual selection
  -- Use :<C-U> to preserve marks when exiting visual mode
  vim.keymap.set('v', M.config.keymaps.code_query, ':<C-U>lua require("deft").send_code_query_from_selection()<CR>', {
    desc = 'Ask Deft about selected code',
    silent = true
  })

  -- Start Deft from normal mode (no selection needed)
  vim.keymap.set('n', M.config.keymaps.code_query, function()
    local deft = require("deft")
    -- If terminal is hidden, show it
    if deft.state.terminal_hidden then
      deft.show_terminal()
      vim.cmd('startinsert')
    else
      -- Otherwise, normal behavior (start or switch to deft)
      deft.start_deft_normal_mode()
    end
  end, {
    desc = 'Start Deft or switch to Deft terminal',
    silent = true
  })
end

---Setup autocommands
function M.setup_autocmds()
  local group = vim.api.nvim_create_augroup('DeftNvim', { clear = true })

  -- Reconnect on VimResume (after suspend)
  vim.api.nvim_create_autocmd('VimResume', {
    group = group,
    callback = function()
      -- No auto-reconnect needed - Deft is tied to Neovim session
    end,
  })

  -- Cleanup on VimLeavePre
  vim.api.nvim_create_autocmd('VimLeavePre', {
    group = group,
    callback = function()
      if M.state.session_active then
        M.stop_deft()
      end
    end,
  })
end

-- User commands
vim.api.nvim_create_user_command('DeftStart', function()
  M.launch_deft()
end, { desc = 'Start Deft session in terminal split' })

vim.api.nvim_create_user_command('DeftStop', function()
  M.stop_deft()
end, { desc = 'Stop Deft session' })

vim.api.nvim_create_user_command('DeftShow', function()
  if M.show_terminal() then
    vim.cmd('startinsert')
  else
    vim.notify('Deft terminal is not hidden or session is not active', vim.log.levels.INFO)
  end
end, { desc = 'Show hidden Deft terminal' })

vim.api.nvim_create_user_command('DeftToggle', function()
  if M.state.terminal_hidden then
    M.show_terminal()
    vim.cmd('startinsert')
  elseif M.state.session_active and M.state.terminal_winnr and vim.api.nvim_win_is_valid(M.state.terminal_winnr) then
    vim.api.nvim_win_hide(M.state.terminal_winnr)
    M.state.terminal_hidden = true
  end
end, { desc = 'Toggle Deft terminal visibility' })

vim.api.nvim_create_user_command('DeftStatus', function()
  if M.state.session_active then
    local status = 'Deft session active (terminal buffer: ' .. M.state.terminal_bufnr .. ')'
    if M.state.terminal_hidden then
      status = status .. ' [hidden]'
    end
    vim.notify(status, vim.log.levels.INFO)
  else
    vim.notify('No active Deft session', vim.log.levels.WARN)
  end
end, { desc = 'Show Deft connection status' })

return M
