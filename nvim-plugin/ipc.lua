-- IPC client for communicating with Deft via stdio
-- Uses Unix socket for reliable bidirectional communication

local M = {}

M.debug_enabled = false  -- Set via config

---Create a new IPC client
---@return table IPC client instance
---@param port number|nil TCP port (if known)
function M.new(port)
  local client = {
    port = port,
    socket = nil,
    message_buffer = '',
    connected = false,
  }

  setmetatable(client, { __index = M })
  return client
end

---Connect to TCP socket
---@return boolean success
function M:connect()
  if self.connected then
    return true
  end

  -- Port must be provided at construction time
  -- (discovered from Deft terminal output by init.lua)

  if M.debug_enabled then
    vim.notify('[Deft IPC] Connecting to port: ' .. tostring(self.port or 'unknown'), vim.log.levels.INFO)
  end

  if not self.port then
    return false
  end

  -- Retry connection up to 10 times
  for attempt = 1, 10 do
    local socket = vim.loop.new_tcp()
    local connect_err = nil
    local connected = false

    socket:connect('127.0.0.1', self.port, function(err)
      connect_err = err
      if not err then
        connected = true
      end
    end)

    -- Wait for connection
    vim.wait(500, function()
      return connect_err ~= nil or connected
    end)

    if connected then
      self.socket = socket
      self.connected = true
      if M.debug_enabled then
        vim.notify('[Deft IPC] Connected to TCP port ' .. tostring(self.port), vim.log.levels.INFO)
      end
      return true
    end

    if M.debug_enabled then
      vim.notify('[Deft IPC] Connection attempt ' .. attempt .. ' failed: ' .. (connect_err or 'timeout'), vim.log.levels.WARN)
    end
    socket:close()

    if attempt < 10 then
      vim.wait(300)
    end
  end

  vim.notify('[Deft IPC] Failed to connect to port ' .. tostring(self.port) .. ' after 10 attempts', vim.log.levels.ERROR)
  return false
end

---Start listening for incoming messages
---@param handler function Callback for handling messages
function M:start_listening(handler)
  if M.debug_enabled then
    vim.notify('[Deft IPC] Starting to listen for messages', vim.log.levels.INFO)
  end

  -- Connect to socket
  if not self:connect() then
    if M.debug_enabled then
      vim.notify('[Deft IPC] Failed to connect', vim.log.levels.ERROR)
    end
    return
  end

  -- Set up read callback
  self.socket:read_start(vim.schedule_wrap(function(err, data)
    if err then
      vim.notify('[Deft IPC] Read error: ' .. err, vim.log.levels.ERROR)
      return
    end

    if data then
      self:handle_data(data, handler)
    else
      -- Connection closed
      vim.notify('[Deft IPC] Connection closed by server', vim.log.levels.WARN)
      self.connected = false
    end
  end))

  if M.debug_enabled then
    vim.notify('[Deft IPC] Listening on TCP socket', vim.log.levels.INFO)
  end
end

---Handle incoming data (may contain multiple messages)
---@param data string Raw data from stdout
---@param handler function Message handler callback
function M:handle_data(data, handler)
  -- Only log for actual JSON messages (less spam)
  if data:match('^%s*{') then
    if M.debug_enabled then
      vim.notify('[Deft IPC] Received JSON: ' .. data:sub(1, 100), vim.log.levels.INFO)
    end
  end

  self.message_buffer = self.message_buffer .. data

  -- Process complete messages (newline-delimited)
  while true do
    local newline_pos = self.message_buffer:find('\n')
    if not newline_pos then
      break
    end

    local message_str = self.message_buffer:sub(1, newline_pos - 1)
    self.message_buffer = self.message_buffer:sub(newline_pos + 1)

    -- Parse and handle message
    local ok, message = pcall(vim.json.decode, message_str)
    if ok then
      if M.debug_enabled then
        vim.notify('[Deft IPC] Parsed JSON, type: ' .. tostring(message.type), vim.log.levels.INFO)
      end
      handler(message)
    else
      -- Only warn if it really looked like JSON
      if message_str:match('^%s*{') then
        vim.notify('[Deft IPC] JSON parse error: ' .. message_str:sub(1, 50), vim.log.levels.WARN)
      end
      -- Silently ignore non-JSON lines
    end
  end
end

---Send a code query message
---@param query table Query details {filepath, selection, query, lineStart, lineEnd}
function M:send_code_query(query)
  if M.debug_enabled then
    vim.notify('[Deft IPC] Sending code_query', vim.log.levels.INFO)
    vim.notify('[Deft IPC] filepath: ' .. query.filepath, vim.log.levels.INFO)
  end

  if not self.connected then
    return false
  end

  local message = vim.json.encode({
    type = 'code_query',
    id = self:generate_id(),
    timestamp = os.time() * 1000,
    filepath = query.filepath,
    selection = query.selection,
    query = query.query,
    lineStart = query.lineStart,
    lineEnd = query.lineEnd,
  })

  self:send_raw(message)
  return true
end

---Send a confirmation response message
---@param response table Response details {requestId, decision, rejectionMessage, editedContent}
function M:send_confirmation_response(response)
  if M.debug_enabled then
    vim.notify('[Deft IPC] Sending confirmation_response: ' .. response.decision, vim.log.levels.INFO)
    if response.rejectionMessage then
      vim.notify('[Deft IPC] Rejection message: ' .. response.rejectionMessage, vim.log.levels.INFO)
    end
    if response.editedContent then
      vim.notify('[Deft IPC] Edited content provided (length: ' .. #response.editedContent .. ')', vim.log.levels.INFO)
    end
  end

  if not self.connected then
    return false
  end

  -- Build message with all fields
  local message_data = {
    type = 'confirmation_response',
    id = self:generate_id(),
    timestamp = os.time() * 1000,
    requestId = response.requestId,
    decision = response.decision,
  }

  -- Add optional fields if present
  if response.rejectionMessage then
    message_data.rejectionMessage = response.rejectionMessage
  end

  if response.editedContent then
    message_data.editedContent = response.editedContent
  end

  -- Add fileDecisions for multi-file patch responses
  if response.fileDecisions then
    message_data.fileDecisions = response.fileDecisions
  end

  local message = vim.json.encode(message_data)
  self:send_raw(message)
  return true
end

---Send raw message to Deft stdin
---@param message string JSON-encoded message
function M:send_raw(message)
  if M.debug_enabled then
    vim.notify('[Deft IPC] Sending raw: ' .. message:sub(1, 100), vim.log.levels.INFO)
  end
  if not self.connected or not self.socket then
    return
  end

  -- Send via TCP socket
  self.socket:write(message .. '\n')
end

---Close the IPC connection
function M:close()
  if self.socket then
    self.socket:close()
    self.socket = nil
  end
  self.connected = false
  self.message_buffer = ''
end

---Generate a unique message ID
---@return string UUID
function M:generate_id()
  -- Simple UUID v4 generation
  local template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
  return string.gsub(template, '[xy]', function(c)
    local v = (c == 'x') and math.random(0, 0xf) or math.random(8, 0xb)
    return string.format('%x', v)
  end)
end

return M
