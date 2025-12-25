# NOTICE

This product includes third-party software components licensed under various open-source licenses.

---

## Runtime Dependencies

### Core Framework

| Package | License | Source                              |
| ------- | ------- | ----------------------------------- |
| react   | MIT     | https://github.com/facebook/react   |
| ink     | MIT     | https://github.com/vadimdemedes/ink |
| zod     | MIT     | https://github.com/colinhacks/zod   |
| chalk   | MIT     | https://github.com/chalk/chalk      |
| js-yaml | MIT     | https://github.com/nodeca/js-yaml   |

### LLM & AI Integration

| Package             | License    | Source                                                   |
| ------------------- | ---------- | -------------------------------------------------------- |
| google-auth-library | Apache-2.0 | https://github.com/googleapis/google-auth-library-nodejs |
| chrome-devtools-mcp | Apache-2.0 | https://github.com/ChromeDevTools/chrome-devtools-mcp    |

### OpenTelemetry (Observability)

| Package                             | License    | Source                                             |
| ----------------------------------- | ---------- | -------------------------------------------------- |
| @opentelemetry/resources            | Apache-2.0 | https://github.com/open-telemetry/opentelemetry-js |
| @opentelemetry/sdk-metrics          | Apache-2.0 | https://github.com/open-telemetry/opentelemetry-js |
| @opentelemetry/semantic-conventions | Apache-2.0 | https://github.com/open-telemetry/opentelemetry-js |
| opentelemetry                       | Apache-2.0 | https://github.com/open-telemetry/opentelemetry-js |

### File & Network Utilities

| Package              | License      | Source                                            |
| -------------------- | ------------ | ------------------------------------------------- |
| fast-glob            | MIT          | https://github.com/mrmlnc/fast-glob               |
| node-fetch           | MIT          | https://github.com/node-fetch/node-fetch          |
| diff                 | BSD-3-Clause | https://github.com/kpdecker/jsdiff                |
| pdf-to-png-converter | MIT          | https://github.com/dichovsky/pdf-to-png-converter |
| open                 | MIT          | https://github.com/sindresorhus/open              |
| node-machine-id      | MIT          | https://www.npmjs.com/package/node-machine-id     |

### Code Parsing (Tree-sitter)

| Package                  | License | Source                                                |
| ------------------------ | ------- | ----------------------------------------------------- |
| @vscode/tree-sitter-wasm | MIT     | https://github.com/microsoft/vscode-tree-sitter-wasm  |
| tree-sitter-python       | MIT     | https://github.com/tree-sitter/tree-sitter-python     |
| tree-sitter-rust         | MIT     | https://github.com/tree-sitter/tree-sitter-rust       |
| tree-sitter-typescript   | MIT     | https://github.com/tree-sitter/tree-sitter-typescript |

### Schema & Validation

| Package                          | License | Source                                             |
| -------------------------------- | ------- | -------------------------------------------------- |
| @alcyone-labs/zod-to-json-schema | ISC     | https://github.com/alcyone-labs/zod-to-json-schema |
| jsonrepair                       | ISC     | https://github.com/josdejong/jsonrepair            |

### Sandbox Server Dependencies

| Package   | License    | Source                                 |
| --------- | ---------- | -------------------------------------- |
| express   | MIT        | https://github.com/expressjs/express   |
| puppeteer | Apache-2.0 | https://github.com/puppeteer/puppeteer |

### Compilers & Bundlers (Sandbox)

| Package    | License    | Source                                  |
| ---------- | ---------- | --------------------------------------- |
| typescript | Apache-2.0 | https://github.com/microsoft/TypeScript |
| esbuild    | MIT        | https://github.com/evanw/esbuild        |

---

## License Texts

### MIT License

The MIT License permits reuse within proprietary software on the condition that the license is distributed with that software. It is also compatible with the GNU General Public License.

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Apache License 2.0

Several dependencies are licensed under the Apache License 2.0. The full text is available at:
https://www.apache.org/licenses/LICENSE-2.0

### BSD 3-Clause License

The `diff` package is licensed under the BSD 3-Clause License:

```
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED.
```

---

## Neovim Plugin and MCP Servers

Files in the `nvim-plugin/` and `mcp-server` directory are licensed under the MIT License and may include inspiration or patterns from the broader Neovim plugin ecosystem.

---
