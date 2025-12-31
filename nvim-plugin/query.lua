-- Code query module for sending selected code to Deft
local M = {}

---Get the current visual selection with full file context
---@return table|nil context {text, filepath, line_start, line_end, full_file_content}
function M.get_selection_with_context()
  -- Get visual selection marks
  local start_pos = vim.fn.getpos("'<")
  local end_pos = vim.fn.getpos("'>")

  local start_line = start_pos[2]
  local end_line = end_pos[2]

  -- Get selected lines
  local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)

  if #lines == 0 then
    return nil
  end

  -- Dedent: remove common leading whitespace
  local min_indent = math.huge
  for _, line in ipairs(lines) do
    if line:match("%S") then  -- Only check non-empty lines
      local indent = line:match("^%s*"):len()
      min_indent = math.min(min_indent, indent)
    end
  end

  -- Remove common indentation from all lines
  if min_indent > 0 and min_indent < math.huge then
    for i, line in ipairs(lines) do
      lines[i] = line:sub(min_indent + 1)
    end
  end

  -- Join lines with newlines
  local text = table.concat(lines, '\n')

  -- Get current file path
  local filepath = vim.api.nvim_buf_get_name(0)

  -- Make path relative to cwd if possible
  local cwd = vim.fn.getcwd()
  if filepath:sub(1, #cwd) == cwd then
    filepath = filepath:sub(#cwd + 2) -- +2 to skip the path separator
  end

  -- Get full file content
  local full_lines = vim.api.nvim_buf_get_lines(0, 0, -1, false)
  local full_file_content = table.concat(full_lines, '\n')

  return {
    text = text,
    filepath = filepath,
    line_start = start_line,
    line_end = end_line,
    full_file_content = full_file_content,
  }
end

---Legacy function for backward compatibility
---@return table|nil selection {text, filepath, line_start, line_end}
function M.get_selection()
  local context = M.get_selection_with_context()
  if not context then
    return nil
  end

  -- Return without full_file_content for backward compatibility
  return {
    text = context.text,
    filepath = context.filepath,
    line_start = context.line_start,
    line_end = context.line_end,
  }
end

---Show a multi-line input box that auto-expands
---@param title string Window title
---@param on_submit function Callback(text)
---@param on_cancel function|nil Callback()
function M.show_multiline_input(title, on_submit, on_cancel)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_option(buf, 'bufhidden', 'wipe')
  vim.api.nvim_buf_set_option(buf, 'filetype', 'markdown') -- Syntax highlighting

  local width = math.min(60, vim.o.columns - 4)
  local max_height = 15
  local height = 1

  local row = math.floor((vim.o.lines - height) / 2)
  local col = math.floor((vim.o.columns - width) / 2)

  local win = vim.api.nvim_open_win(buf, true, {
    relative = 'editor',
    width = width,
    height = height,
    row = row,
    col = col,
    style = 'minimal',
    border = 'rounded',
    title = ' ' .. title .. ' ',
    title_pos = 'center',
    footer = ' Enter: New Line | Ctrl+S: Submit ',
    footer_pos = 'center',
  })

  -- Auto-resize window as user types
  vim.api.nvim_create_autocmd({'TextChanged', 'TextChangedI'}, {
    buffer = buf,
    callback = function()
      if not vim.api.nvim_win_is_valid(win) then return end
      local line_count = vim.api.nvim_buf_line_count(buf)
      local new_height = math.min(math.max(1, line_count), max_height)

      -- Keep centered vertically
      local new_row = math.floor((vim.o.lines - new_height) / 2)
      vim.api.nvim_win_set_config(win, {
        relative = 'editor',
        row = new_row,
        col = col,
        height = new_height
      })
    end
  })

  local function submit()
    local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
    local text = vim.trim(table.concat(lines, '\n'))
    vim.api.nvim_win_close(win, true)
    if on_submit then on_submit(text) end
  end

  local opts = { buffer = buf, silent = true }
  vim.keymap.set({'i', 'n'}, '<C-s>', submit, opts)
  vim.keymap.set('n', '<Esc>', function()
    vim.api.nvim_win_close(win, true)
    if on_cancel then on_cancel() end
  end, opts)
  vim.cmd('startinsert')
end

---Prompt user for instruction in Neovim, then send with context
---@param on_complete function|nil Callback called after message is sent (for focus management)
function M.prompt_and_send(on_complete)
  local context = M.get_selection_with_context()

  -- If no selection, just call on_complete to switch to Deft
  if not context then
    if on_complete then
      on_complete()
    end
    return
  end

  -- Hide hint if showing
  local hint_module = require('deft.hint')
  hint_module.hide()

  -- Use new multi-line input
  M.show_multiline_input('What would you like to do?', function(instruction)
    -- Build the complete message with context + instruction
    -- Note: instruction can now be multi-line

    -- Build the complete message with context + instruction
    local query = instruction .. '\n\n' ..
                  'Selected code from ' .. context.filepath ..
                  ' (lines ' .. context.line_start .. '-' .. context.line_end .. '):\n' ..
                  '```\n' .. context.text .. '\n```\n\n' ..
                  'Full file for context:\n```\n' .. context.full_file_content .. '\n```'

    -- Send to Deft
    local deft = require('deft')
    deft.send_code_query(query, context)

    vim.notify('✓ Sent to Deft: ' .. instruction, vim.log.levels.INFO)

    -- Call completion callback if provided
    -- This is where we switch focus to Deft terminal
    if on_complete then
      on_complete()
    end
  end)
end

---Send a predefined query with the current selection and full context
---@param query string The query to send
---@param on_complete function|nil Callback called after message is sent
function M.send_with_query(query, on_complete)
  local context = M.get_selection_with_context()

  if not context then
    vim.notify('No code selected', vim.log.levels.WARN)
    return
  end

  -- Hide hint if showing
  local hint_module = require('deft.hint')
  hint_module.hide()

  -- Build message with full context
  local full_query = query .. '\n\n' ..
                     'Selected code from ' .. context.filepath ..
                     ' (lines ' .. context.line_start .. '-' .. context.line_end .. '):\n' ..
                     '```\n' .. context.text .. '\n```\n\n' ..
                     'Full file for context:\n```\n' .. context.full_file_content .. '\n```'

  -- Send via main plugin
  local deft = require('deft')
  deft.send_code_query(full_query, context)

  vim.notify('✓ Sent to Deft: ' .. query, vim.log.levels.INFO)

  -- Call completion callback if provided
  if on_complete then
    on_complete()
  end
end

---Quick actions for common queries
M.actions = {
  explain = function()
    M.send_with_query('Please explain this code in detail')
  end,

  improve = function()
    M.send_with_query('How can this code be improved?')
  end,

  bugs = function()
    M.send_with_query('Are there any bugs or issues in this code?')
  end,

  refactor = function()
    M.send_with_query('Suggest refactoring for this code')
  end,

  tests = function()
    M.send_with_query('Write unit tests for this code')
  end,

  document = function()
    M.send_with_query('Add documentation comments to this code')
  end,

  implement = function()
    M.send_with_query('Implement this function. Use the patch tool to make the changes.')
  end,

  fix = function()
    M.send_with_query('Fix any issues in this code. Use the patch tool to make the changes.')
  end,
}

return M
