import express from "express";
import puppeteer, { type Browser, type Page } from "puppeteer";

const app = express();
app.use(express.json());

const PORT = 3000;

/** Maximum content size for page fetches (~8KB) */
const FETCH_MAX_CONTENT_SIZE = 8192;

/**
 * Truncate fetched page content
 */
function truncatePageContent(
  content: string,
  maxSize: number = FETCH_MAX_CONTENT_SIZE,
): string {
  if (content.length <= maxSize) {
    return content;
  }

  const truncatedBytes = content.length - maxSize;
  const hint = `Page content truncated. Consider extracting specific elements.`;
  const truncateMsg = `\n\n[CONTENT TRUNCATED: ${truncatedBytes} chars omitted. ${hint}]`;

  return content.slice(0, maxSize - truncateMsg.length) + truncateMsg;
}

const WORK_DIR = "/usr/src/sandbox";

// Browser instance management
let browser: Browser | null = null;

// Rate limiting
const searchRateLimiter = new Map<string, number>();
const SEARCH_RATE_LIMIT_MS = 3000; // 3 seconds between searches

async function getBrowser(): Promise<Browser> {
  if (browser === null || !browser.isConnected()) {
    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        process.env.PUPPETEER_EXECUTABLE_PATH ?? "/usr/bin/chromium",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-extensions",
      ],
    });
  }
  return browser;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function performDuckDuckGoSearch(
  query: string,
  maxResults: number = 10,
): Promise<SearchResult[]> {
  const browserInstance = await getBrowser();
  const page: Page = await browserInstance.newPage();

  try {
    // Set a realistic user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );

    // Navigate to DuckDuckGo HTML version (more reliable for scraping)
    const encodedQuery = encodeURIComponent(query);
    await page.goto(`https://html.duckduckgo.com/html/?q=${encodedQuery}`, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Extract search results
    const results = await page.evaluate(() => {
      const searchResults: SearchResult[] = [];

      // DuckDuckGo HTML version has a consistent structure
      const resultElements = Array.from(document.querySelectorAll(".result"));

      for (const element of resultElements) {
        // Get the main result link
        const linkElement = element.querySelector(
          ".result__a",
        ) as HTMLAnchorElement | null;

        // Get the snippet
        const snippetElement = element.querySelector(".result__snippet");

        if (linkElement !== null) {
          // DuckDuckGo uses redirects, extract the actual URL
          let url = linkElement.getAttribute("href") ?? "";

          // If it's a DuckDuckGo redirect, extract the actual URL
          if (url.startsWith("//duckduckgo.com/l/?")) {
            try {
              const urlObj = new URL("https:" + url);
              const uddg = urlObj.searchParams.get("uddg");
              if (uddg !== null) {
                url = decodeURIComponent(uddg);
              }
            } catch (e) {
              continue;
            }
          }

          // Ensure valid HTTP(S) URL
          if (url.startsWith("http")) {
            searchResults.push({
              title: linkElement.textContent?.trim() ?? "",
              url: url,
              snippet: snippetElement?.textContent?.trim() ?? "",
            });
          }
        }
      }

      return searchResults;
    });

    // Limit results to maxResults
    return results.slice(0, maxResults);
  } catch (error) {
    // Log error but don't throw - allow graceful degradation
    console.error("Search failed:", (error as Error).message);
    return [];
  } finally {
    await page.close();
  }
}

async function fetchPageContent(
  url: string,
): Promise<{ content: string; title: string }> {
  const browserInstance = await getBrowser();
  const page: Page = await browserInstance.newPage();

  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Extract text content and title
    const data = await page.evaluate(() => {
      // Remove script and style tags
      const scripts = document.querySelectorAll("script, style, noscript");
      scripts.forEach((script) => script.remove());

      return {
        title: document.title,
        content: document.body.innerText,
      };
    });

    return data;
  } finally {
    await page.close();
  }
}

async function takeFullPageSnapshot(
  url: string,
  options?: {
    viewportWidth?: number;
    viewportHeight?: number;
    fullPage?: boolean;
  },
): Promise<{
  screenshot: string;
  title: string;
  dimensions: { width: number; height: number };
}> {
  const browserInstance = await getBrowser();
  const page: Page = await browserInstance.newPage();

  try {
    // Set viewport
    await page.setViewport({
      width: options?.viewportWidth ?? 1920,
      height: options?.viewportHeight ?? 1080,
      deviceScaleFactor: 1,
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Get page title and dimensions
    const pageInfo = await page.evaluate(() => ({
      title: document.title,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    // Take full page screenshot
    const screenshotBuffer = await page.screenshot({
      type: "png",
      fullPage: options?.fullPage ?? true,
      captureBeyondViewport: true,
    });

    // Convert to base64
    const base64Screenshot = Buffer.from(screenshotBuffer).toString("base64");

    return {
      screenshot: base64Screenshot,
      title: pageInfo.title,
      dimensions: {
        width: pageInfo.scrollWidth,
        height: pageInfo.scrollHeight,
      },
    };
  } finally {
    await page.close();
  }
}

function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const lastRequest = searchRateLimiter.get(identifier);

  if (lastRequest !== undefined && now - lastRequest < SEARCH_RATE_LIMIT_MS) {
    return false;
  }

  searchRateLimiter.set(identifier, now);
  return true;
}

// Cleanup old rate limit entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of searchRateLimiter.entries()) {
    if (now - timestamp > 60000) {
      searchRateLimiter.delete(key);
    }
  }
}, 60000);

app.post("/search", async (req, res) => {
  const { query, maxResults } = req.body;

  if (typeof query !== "string") {
    return res
      .status(400)
      .json({ error: 'Invalid request, "query" must be a string.' });
  }

  if (query.trim().length === 0) {
    return res.status(400).json({ error: "Query cannot be empty." });
  }

  // Rate limiting by IP
  const clientIp = req.ip ?? "unknown";
  if (!checkRateLimit(clientIp)) {
    const lastRequest = searchRateLimiter.get(clientIp) ?? 0;
    const waitTime = Math.ceil(
      (SEARCH_RATE_LIMIT_MS - (Date.now() - lastRequest)) / 1000,
    );

    return res.status(429).json({
      error: `Rate limit exceeded. Please wait ${waitTime} more second(s).`,
    });
  }

  const max =
    typeof maxResults === "number"
      ? Math.min(Math.max(maxResults, 1), 100)
      : 10;

  try {
    const results = await performDuckDuckGoSearch(query, max);
    res.json({ results, count: results.length });
  } catch (error) {
    res
      .status(500)
      .json({ error: `Search failed: ${(error as Error).message}` });
  }
});

app.post("/fetch", async (req, res) => {
  const { url } = req.body;

  if (typeof url !== "string") {
    return res
      .status(400)
      .json({ error: 'Invalid request, "url" must be a string.' });
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch (error) {
    return res.status(400).json({ error: "Invalid URL format." });
  }

  // Rate limiting by IP
  const clientIp = req.ip ?? "unknown";
  if (!checkRateLimit(clientIp)) {
    const lastRequest = searchRateLimiter.get(clientIp) ?? 0;
    const waitTime = Math.ceil(
      (SEARCH_RATE_LIMIT_MS - (Date.now() - lastRequest)) / 1000,
    );

    return res.status(429).json({
      error: `Rate limit exceeded. Please wait ${waitTime} more second(s).`,
    });
  }

  try {
    const data = await fetchPageContent(url);
    res.json({
      title: data.title,
      content: truncatePageContent(data.content),
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: `Fetch failed: ${(error as Error).message}` });
  }
});

app.post("/snapshot", async (req, res) => {
  const { url, viewportWidth, viewportHeight, fullPage } = req.body;

  if (typeof url !== "string") {
    return res
      .status(400)
      .json({ error: 'Invalid request, "url" must be a string.' });
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch (error) {
    return res.status(400).json({ error: "Invalid URL format." });
  }

  // Rate limiting by IP
  const clientIp = req.ip ?? "unknown";
  if (!checkRateLimit(clientIp)) {
    const lastRequest = searchRateLimiter.get(clientIp) ?? 0;
    const waitTime = Math.ceil(
      (SEARCH_RATE_LIMIT_MS - (Date.now() - lastRequest)) / 1000,
    );

    return res.status(429).json({
      error: `Rate limit exceeded. Please wait ${waitTime} more second(s).`,
    });
  }

  try {
    const data = await takeFullPageSnapshot(url, {
      viewportWidth,
      viewportHeight,
      fullPage: fullPage ?? true,
    });
    res.json(data);
  } catch (error) {
    res
      .status(500)
      .json({ error: `Snapshot failed: ${(error as Error).message}` });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Sandbox server listening on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  if (browser !== null) {
    await browser.close();
  }
  process.exit(0);
});
