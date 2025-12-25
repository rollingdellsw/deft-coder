---
name: web-research
description: Search the web and extract content using a browser sandbox
license: MIT
allowed-tools:
  - sandbox_browser
---

# Web Research

Use the `sandbox_browser` to search the internet (via DuckDuckGo) and read web pages. Useful for looking up documentation, error messages, or libraries.

## Workflow

1.  **Search**: Find relevant URLs.

    ```javascript
    sandbox_browser({
      action: "search",
      query: "react useEffect infinite loop fix",
      maxResults: 5,
    });
    ```

2.  **Fetch**: Read the content of a specific URL found in the search.

    ```javascript
    sandbox_browser({
      action: "fetch",
      url: "[https://react.dev/reference/react/useEffect](https://react.dev/reference/react/useEffect)",
    });
    ```

3.  **Snapshot**: Take a screenshot if visual layout is important (debugging UI).
    ```javascript
    sandbox_browser({
      action: "snapshot",
      url: "http://localhost:3000",
      fullPage: true,
    });
    ```
