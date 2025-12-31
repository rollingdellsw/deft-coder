-- Visual selection hint for Deft keybindings

local M = {}

M.hint_win = nil
M.hint_buf = nil
M.hint_timer = nil
M.delay_ms = 500
M.timeout = 1000
M.hide_timer = nil  -- Timer for auto-hiding hint

---Setup hint with debounce delay
---@param delay_ms number Delay in milliseconds before showing hint
function M.setup(delay_ms)
  M.delay_ms = delay_ms or 500

  -- Show hint when entering visual mode
  vim.api.nvim_create_autocmd('ModeChanged', {
    pattern = '*:[vV\x16]*', -- Entering any visual mode
    callback = function()
      M.schedule_show()
    end,
  })

  -- Hide hint when leaving visual mode
  vim.api.nvim_create_autocmd('ModeChanged', {
    pattern = '[vV\x16]*:*', -- Leaving visual mode
    callback = function()
      M.cancel_scheduled()
      M.hide()
    end,
  })
end

---Schedule showing the hint with debounce
function M.schedule_show()
  -- Cancel any existing timer
  M.cancel_scheduled()

  -- Create new timer
  M.hint_timer = vim.defer_fn(function()
    M.show()
  end, M.delay_ms)
end

---Cancel scheduled hint
function M.cancel_scheduled()
  if M.hint_timer then
    pcall(vim.fn.timer_stop, M.hint_timer)
    M.hint_timer = nil
  end
end

---Schedule hiding the hint after timeout
---@param timeout_ms number Timeout in milliseconds (default 2000)
function M.schedule_hide(timeout_ms)
  timeout_ms = timeout_ms or M.timeout

  -- Cancel any existing hide timer
  if M.hide_timer then
    pcall(vim.fn.timer_stop, M.hide_timer)
    M.hide_timer = nil
  end

  -- Create new timer to hide hint
  M.hide_timer = vim.defer_fn(function()
    M.hide()
    M.hide_timer = nil
  end, timeout_ms)
end

---Show the hint window
function M.show()
  -- Create buffer if needed
  if not M.hint_buf or not vim.api.nvim_buf_is_valid(M.hint_buf) then
    M.hint_buf = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_buf_set_lines(M.hint_buf, 0, -1, false, {
      '💡 Deft actions:',
      '  <leader>ca - Ask/change code',
    })
  end

  -- Create floating window
  if not M.hint_win or not vim.api.nvim_win_is_valid(M.hint_win) then
    M.hint_win = vim.api.nvim_open_win(M.hint_buf, false, {
      relative = 'cursor',
      row = 1,
      col = 0,
      width = 32,
      height = 2,
      style = 'minimal',
      border = 'rounded',
      focusable = false,
    })

    -- Set highlight
    vim.api.nvim_win_set_option(M.hint_win, 'winhl', 'Normal:NormalFloat,FloatBorder:FloatBorder')
  end

  -- Schedule auto-hide after 1 seconds
  M.schedule_hide(M.timeout)
end

---Hide the hint window
function M.hide()
  if M.hint_win and vim.api.nvim_win_is_valid(M.hint_win) then
    vim.api.nvim_win_close(M.hint_win, true)
    M.hint_win = nil
  end

  -- Cancel hide timer if active
  if M.hide_timer then
    M.hide_timer = nil
  end
end

return M
