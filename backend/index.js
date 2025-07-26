const express = require('express');
const path = require('path');
const os = require('os');
const pty = require('node-pty');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:107.0) Gecko/20100101 Firefox/107.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 Edg/107.0.1418.62",
  "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64; rv:102.0) Gecko/20100101 Firefox/102.0",
  "Mozilla/5.0 (Linux; Android 13; SM-A536U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPad; CPU OS 16_1_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/108.0.5359.112 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36 Vivaldi/5.5.2805.50",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:107.0) Gecko/20100101 Firefox/107.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.3 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Linux; Android 12; SM-G991U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36"
];

class RateLimiter {
  constructor(requestsPerMinute = 30) {
    this.requestsPerMinute = requestsPerMinute;
    this.requests = [];
  }

  async acquire() {
    const now = new Date();
    this.requests = this.requests.filter(req => now - req < 60 * 1000);
    if (this.requests.length >= this.requestsPerMinute) {
      const waitTime = 60 - (now - this.requests[0]) / 1000;
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
      }
    }
    this.requests.push(now);
  }
}

class SearchResult {
  constructor(title, link, snippet, position) {
    this.title = title;
    this.link = link;
    this.snippet = snippet;
    this.position = position;
  }
}

class DuckDuckGoSearcher {
  constructor() {
    this.BASE_URL = "https://html.duckduckgo.com/html";
    this.rateLimiter = new RateLimiter();
  }

  async search(query, maxResults = 10, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await this.rateLimiter.acquire();
        console.log(`[BACKEND] Searching DuckDuckGo for: ${query} (Attempt ${i + 1})`);

        const data = new URLSearchParams({ q: query, b: "", kl: "" });
        const response = await axios.post(this.BASE_URL, data.toString(), {
          headers: {
            "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 30000
        });

        const $ = cheerio.load(response.data);
        if (!$) {
            console.error("[BACKEND] Failed to parse HTML response");
            continue;
        }

        const results = [];
        $('.result').each((idx, element) => {
          if (results.length >= maxResults) return false;

          const titleElem = $(element).find('.result__title a');
          const snippetElem = $(element).find('.result__snippet');
          if (!titleElem.length) return true;

          const title = titleElem.text().trim();
          let link = titleElem.attr('href');
          
          if (link && link.includes('y.js')) return true;

          if (link && link.startsWith('//duckduckgo.com/l/?uddg=')) {
            link = decodeURIComponent(link.split('uddg=')[1].split('&')[0]);
          }

          const snippet = snippetElem.length ? snippetElem.text().trim() : "";
          results.push(new SearchResult(title, link, snippet, results.length + 1));
        });

        if (results.length > 0) {
            console.log(`[BACKEND] Successfully found ${results.length} results on attempt ${i + 1}`);
            return results;
        }
        console.log(`[BACKEND] Attempt ${i + 1} returned no results, retrying...`);
      } catch (error) {
        if (error.code === 'ECONNABORTED') {
            console.error(`[BACKEND] Search request timed out on attempt ${i + 1}`);
        } else if (error.response) {
            console.error(`[BACKEND] HTTP error on attempt ${i + 1}: ${error.message}`);
        } else {
            console.error(`[BACKEND] Unexpected error on attempt ${i + 1}: ${error.message}`);
        }
        if (i === maxRetries - 1) {
            console.error("[BACKEND] Max retries reached. Search failed.");
            throw new Error("Failed to fetch search results after multiple retries.");
        }
      }
    }
    return [];
  }
}

const app = express();
const port = 3333;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

app.post('/api/read-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const $ = cheerio.load(response.data);
    $('script, style, header, footer, nav, aside').remove();
    let content = $('body').text().replace(/\s\s+/g, ' ').trim();
    const links = Array.from($('a')).map(el => $(el).attr('href')).filter(Boolean);
    res.json({ content, links });
  } catch (error) {
    console.error(`[BACKEND] Error fetching URL ${url}:`, error.message);
    res.status(500).json({ message: `Failed to process URL: ${error.message}` });
  }
});

const searcher = new DuckDuckGoSearcher();
app.post('/api/duckduckgo-search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

  try {
    const results = await searcher.search(query);
    res.json({ results });
  } catch (error) {
    console.error(`[BACKEND] Error searching DuckDuckGo for "${query}":`, error.message);
    res.status(500).json({ message: `Failed to perform search: ${error.message}` });
  }
});

// =================================================================
// === Backend Terminal Tool Execution Endpoint                  ===
// =================================================================
app.post('/api/execute-tool', async (req, res) => {
  const { toolName, parameters } = req.body;

  if (toolName !== 'run_terminal_command') {
    return res
      .status(501)
      .json({
        status: 'Error',
        message: `Tool '${toolName}' is not implemented on the backend.`,
      });
  }

  const { command } = parameters;
  if (!command) {
    return res
      .status(400)
      .json({ status: 'Error', message: "A 'command' parameter is required." });
  }

  // Determine the shell based on the operating system
  const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    cwd: process.env.HOME, // Start in the user's home directory
    env: process.env,
  });

  let output = '';
  ptyProcess.onData((data) => {
    output += data;
    console.log('[TERMINAL]', data);
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(`[TERMINAL] Process exited with code ${exitCode}`);
    if (exitCode === 0) {
      res.json({ status: 'Success', output: output });
    } else {
      res
        .status(500)
        .json({
          status: 'Error',
          message: `Command failed with exit code ${exitCode}.`,
          output: output,
        });
    }
  });

  console.log(`[BACKEND] Executing command: ${command}`);
  ptyProcess.write(command + '\r');

  // Add a small delay and then send an exit command to ensure the process terminates
  // if the executed command is non-interactive.
  setTimeout(() => {
    if (!ptyProcess.killed) {
      ptyProcess.write('exit\r');
    }
  }, 1000); // Wait 1 second before exiting

  // Timeout to prevent hanging processes
  setTimeout(() => {
    if (!res.headersSent) {
      ptyProcess.kill();
      console.error('[BACKEND] Command timed out.');
      res
        .status(500)
        .json({
          status: 'Error',
          message: 'Command execution timed out.',
          output: output,
        });
    }
  }, 15000); // 15-second timeout
});

app.listen(port, () => {
  console.log(`Backend server listening at http://localhost:${port}`);
  console.log('Navigate to http://localhost:3000 to open the editor.');
});
