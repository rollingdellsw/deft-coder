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
}

-- Configuration defaults
M.config = {
  -- Deft command to execute
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

  -- Debug mode
  debug = false,
}

---Setup the plugin with user configuration
---@param opts table|nil User configuration
function M.setup(opts)
  -- Merge user config with defaults
  M.config = vim.tbl_deep_extend('force', M.config, opts or {})
  M.state.working_dir = vim.fn.getcwd()

  M.setup_keymaps()

  if M.config.show_hint then
    hint.setup(M.config.hint_delay)
  end

  M.setup_autocmds()
end

---Build the split command based on config
---@return string vim command for creating split
local function build_split_cmd()
  return (M.config.split_position == 'vertical') and
         ('rightbelow ' .. M.config.split_size .. 'vsplit') or
         ('rightbelow ' .. M.config.split_size .. 'split')
end

---Launch Deft in a terminal split
---@param auto_focus boolean|nil If true, stay in terminal and enter insert mode (default: true)
function M.launch_deft(auto_focus)
  if auto_focus == nil then auto_focus = true end

  if M.state.session_active then
    vim.notify('Deft session already active', vim.log.levels.INFO)
    return
  end

  local split_cmd = build_split_cmd()

  local orig_winnr = vim.api.nvim_get_current_win()

  -- Open split
  vim.cmd(split_cmd)
  local term_bufnr = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_win_set_buf(0, term_bufnr)
  M.state.terminal_winnr = vim.api.nvim_get_current_win()

  -- Generate unique temp file for port discovery
  local port_file = vim.fn.tempname()

  -- Build Deft command
  local deft_cmd = M.config.deft_command
  if M.config.debug then deft_cmd = deft_cmd .. ' --verbose' end

  -- Launch Deft
  M.state.terminal_job_id = vim.fn.termopen(deft_cmd, {
    cwd = M.state.working_dir,
    env = {
      DEFT_DEBUG = M.config.debug and '1' or '0',
      DEFT_PORT_FILE = port_file
    },
    on_exit = function(_, exit_code, _)
      if vim.fn.filereadable(port_file) == 1 then os.remove(port_file) end
      vim.schedule(function() M.on_deft_exit(exit_code) end)
    end,
  })

  if M.state.terminal_job_id <= 0 then
    vim.notify('Failed to launch Deft', vim.log.levels.ERROR)
    return
  end

  -- Setup terminal buffer
  M.state.terminal_bufnr = vim.api.nvim_get_current_buf()
  vim.api.nvim_buf_set_name(M.state.terminal_bufnr, 'Deft')
  vim.api.nvim_buf_set_option(M.state.terminal_bufnr, 'buftype', 'terminal')
  vim.api.nvim_buf_set_option(M.state.terminal_bufnr, 'modifiable', false)
  vim.api.nvim_buf_set_option(M.state.terminal_bufnr, 'bufhidden', 'hide')
  vim.api.nvim_win_set_option(M.state.terminal_winnr, 'number', false)
  vim.api.nvim_win_set_option(M.state.terminal_winnr, 'relativenumber', false)

  -- Terminal keymaps
  local opts = { buffer = M.state.terminal_bufnr, noremap = true, silent = true }

  -- Ctrl+O to exit terminal focus
  vim.keymap.set('t', '<C-o>', function()
    vim.cmd('stopinsert')
    local wins = vim.api.nvim_list_wins()
    for _, win in ipairs(wins) do
      if win ~= M.state.terminal_winnr then
        vim.api.nvim_set_current_win(win)
        return
      end
    end
  end, vim.tbl_extend('force', opts, { desc = 'Return to code window' }))

  -- Esc pass-through
  vim.api.nvim_buf_set_keymap(M.state.terminal_bufnr, 't', '<Esc>', '<C-\\><C-N>i<Esc>', {
    noremap = true, silent = true
  })

  -- Wait for connection
  local ipc_port = nil
  for i = 1, 50 do
    vim.wait(100)
    if vim.fn.filereadable(port_file) == 1 then
      local lines = vim.fn.readfile(port_file)
      if #lines > 0 and lines[1] ~= '' then
        ipc_port = tonumber(lines[1])
        os.remove(port_file)
        break
      end
    end
  end

  if not ipc_port then
    vim.notify('Failed to connect to Deft', vim.log.levels.ERROR)
    if vim.fn.filereadable(port_file) == 1 then os.remove(port_file) end
    return
  end

  -- Connect IPC
  M.state.ipc_client = ipc.new(ipc_port)
  ipc.debug_enabled = M.config.debug
  M.state.ipc_client:start_listening(M.handle_ipc_message)
  M.state.session_active = true

  vim.schedule(function()
    if not M.config.debug then
      vim.notify('✓ Deft ready', vim.log.levels.INFO)
    end
  end)

  if auto_focus and M.state.terminal_winnr then
    vim.api.nvim_set_current_win(M.state.terminal_winnr)
    vim.cmd('startinsert')
  elseif orig_winnr and vim.api.nvim_win_is_valid(orig_winnr) then
    vim.api.nvim_set_current_win(orig_winnr)
  end
end

function M.stop_deft()
  if not M.state.session_active then return end
  if M.state.ipc_client then
    M.state.ipc_client:close()
    M.state.ipc_client = nil
  end
  if M.state.terminal_job_id then
    vim.fn.jobstop(M.state.terminal_job_id)
    M.state.terminal_job_id = nil
  end
  if M.state.terminal_winnr and vim.api.nvim_win_is_valid(M.state.terminal_winnr) then
    vim.api.nvim_win_close(M.state.terminal_winnr, true)
  end
  M.state.terminal_winnr = nil
  M.state.terminal_bufnr = nil
  M.state.session_active = false
  vim.notify('Deft session stopped', vim.log.levels.INFO)
end

function M.on_deft_exit(exit_code)
  if exit_code ~= 0 then
    vim.notify('Deft exited with code ' .. exit_code, vim.log.levels.WARN)
  end
  M.stop_deft()
end

function M.handle_ipc_message(message)
  if message.type == 'show_diff' then
    diff_viewer.debug_enabled = M.config.debug
    diff_viewer.show(message, M.state.ipc_client, M.state.terminal_winnr)
  end
end

---Send code query from visual selection
function M.send_code_query_from_selection()
  local orig_win = vim.api.nvim_get_current_win()

  -- Ensure Deft is running and visible
  if not M.state.session_active then
    M.launch_deft(false)
    vim.wait(2000)
  elseif not M.is_terminal_visible_in_current_tab() then
    M.show_terminal()
  end

  if vim.api.nvim_win_is_valid(orig_win) then
    vim.api.nvim_set_current_win(orig_win)
  end

  require('deft.hint').hide()

  require('deft.query').prompt_and_send(function()
    -- Callback after user input: Switch focus to Deft
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
end

---Smart Toggle: Start, Show, or Hide Deft
function M.start_deft_normal_mode()
  if not M.state.session_active then
    M.launch_deft()
  else
    local visible_win = M.get_visible_terminal_window()
    if not visible_win then
      -- Hidden -> Show it
      M.show_terminal()
      vim.schedule(function() vim.cmd('startinsert') end)
    else
      -- Visible -> Hide it
      if vim.api.nvim_win_is_valid(visible_win) then
        vim.api.nvim_win_hide(visible_win)
      end
    end
  end
end

function M.send_code_query(query, selection)
  if not M.state.session_active then M.launch_deft(); vim.wait(2000) end
  if not M.state.ipc_client then return end

  M.state.ipc_client:send_code_query({
    filepath = selection.filepath,
    selection = selection.text,
    query = query,
    lineStart = selection.line_start,
    lineEnd = selection.line_end,
  })
end

function M.get_visible_terminal_window()
  if not M.state.session_active or not M.state.terminal_bufnr then return nil end
  for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
    if vim.api.nvim_win_get_buf(win) == M.state.terminal_bufnr then return win end
  end
  return nil
end

function M.is_terminal_visible_in_current_tab()
  return M.get_visible_terminal_window() ~= nil
end

function M.show_terminal()
  if not M.state.session_active then return false end
  if M.state.terminal_bufnr and not M.is_terminal_visible_in_current_tab() then
    vim.cmd(build_split_cmd())
    vim.api.nvim_win_set_buf(0, M.state.terminal_bufnr)
    M.state.terminal_winnr = vim.api.nvim_get_current_win()
    vim.api.nvim_win_set_option(M.state.terminal_winnr, 'number', false)
    vim.api.nvim_win_set_option(M.state.terminal_winnr, 'relativenumber', false)
    return true
  end
  return false
end

function M.setup_keymaps()
  -- Visual mode query
  vim.keymap.set('v', M.config.keymaps.code_query, ':<C-U>lua require("deft").send_code_query_from_selection()<CR>', {
    desc = 'Ask Deft about selected code', silent = true
  })

  -- Normal mode toggle
  vim.keymap.set('n', M.config.keymaps.code_query, function()
    require("deft").start_deft_normal_mode()
  end, { desc = 'Toggle Deft terminal', silent = true })

  -- Terminal mode toggle (Correctly exits insert mode first)
  vim.keymap.set('t', M.config.keymaps.code_query, function()
    vim.cmd('stopinsert')
    require("deft").start_deft_normal_mode()
  end, { desc = 'Toggle Deft terminal', silent = true })
end

function M.setup_autocmds()
  vim.api.nvim_create_autocmd('VimLeavePre', {
    group = vim.api.nvim_create_augroup('DeftNvim', { clear = true }),
    callback = function()
      if M.state.session_active then M.stop_deft() end
    end,
  })
end

-- Commands
vim.api.nvim_create_user_command('DeftStart', function() M.launch_deft() end, {})
vim.api.nvim_create_user_command('DeftStop', function() M.stop_deft() end, {})
vim.api.nvim_create_user_command('DeftToggle', function() M.start_deft_normal_mode() end, {})
vim.api.nvim_create_user_command('DeftShow', function()
  if M.show_terminal() then vim.cmd('startinsert') end
end, {})

return M
