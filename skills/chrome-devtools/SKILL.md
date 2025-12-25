---
name: chrome-devtools
description: Control and inspect a live Chrome browser for debugging, automation, and performance analysis
license: MIT
allowed-tools:
  # Navigation (7 tools)
  - new_page
  - navigate_page
  - list_pages
  - select_page
  - close_page
  - navigate_page_history
  - wait_for
  # Input Automation (7 tools)
  - click
  - fill
  - fill_form
  - hover
  - drag
  - handle_dialog
  - upload_file
  - press_key
  # Debugging (4 tools)
  - evaluate_script
  - list_console_messages
  - get_console_message
  - take_screenshot
  - take_snapshot
  # Network (2 tools)
  - list_network_requests
  - get_network_request
  # Performance (3 tools)
  - performance_start_trace
  - performance_stop_trace
  - performance_analyze_insight
  # Emulation (3 tools)
  - emulate
  - resize_page
---

# Chrome DevTools MCP

Control and inspect a live Chrome browser using the official Chrome DevTools MCP server. This skill enables AI-powered browser automation, debugging, and performance analysis.

> **Note**: This skill requires the `chrome-devtools` MCP server to be running.

## Workflow Examples

### 1. Debug a Page Load Issue

```javascript
// 1. Navigate to the page
navigate_page({ url: "http://localhost:3000" });

// 2. Check for console errors
list_console_messages({ types: ["error", "warning"] });

// 3. Check network failures
list_network_requests({ resourceTypes: ["fetch", "xhr"] });

// 4. Take a screenshot to see current state
take_screenshot({ fullPage: true });
```

### 2. Test a Form Submission

```javascript
// 1. Navigate to form page
navigate_page({ url: "http://localhost:3000/login" });

// 2. Take snapshot to find element UIDs
take_snapshot();

// 3. Fill the form
fill_form({
  fields: [
    { uid: "email-input", value: "test@example.com" },
    { uid: "password-input", value: "password123" },
  ],
});

// 4. Click submit
click({ uid: "submit-button" });

// 5. Wait for navigation
wait_for({ text: "Welcome" });

// 6. Verify success
take_screenshot();
list_console_messages();
```

### 3. Performance Analysis

```javascript
// 1. Start performance trace with auto-reload
performance_start_trace({ reload: true, autoStop: true });

// 2. Get Core Web Vitals and insights
// (trace automatically stops and returns results)

// 3. For manual traces (to capture interactions):
performance_start_trace({ reload: false, autoStop: false });
// ... perform user interactions ...
performance_stop_trace();
performance_analyze_insight({ insight: "lcp" });
```

### 4. Mobile Responsiveness Testing

```javascript
// 1. Resize to mobile viewport
resize_page({ width: 390, height: 844 });

// 2. Take screenshot
take_screenshot({ fullPage: true });

// 3. Test tablet
resize_page({ width: 768, height: 1024 });
take_screenshot({ fullPage: true });
```

### 5. Execute Custom JavaScript

```javascript
// Check if an element exists
evaluate_script({
  function: "() => document.querySelector('.error-message')?.textContent",
});

// Get computed styles
evaluate_script({
  function:
    "() => getComputedStyle(document.querySelector('.container')).width",
});

// Check localStorage
evaluate_script({
  function: "() => JSON.parse(localStorage.getItem('user'))",
});
```

## Best Practices

1. **Use `take_snapshot` before interactions** - Get element UIDs from the accessibility tree for reliable targeting
2. **Prefer snapshots over screenshots** - Snapshots are faster and provide structured data
3. **Check console messages after actions** - Catch JavaScript errors early
4. **Use `wait_for` after navigation** - Ensure page is loaded before interacting
5. **Keep traces short** - Performance traces can generate large data

## Security Notes

⚠️ Ask for user confirmation before taking irreversible actions: submit, purchase, send, etc.
