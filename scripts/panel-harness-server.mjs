import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.BHT_PANEL_TEST_PORT || 4178);
const indexPath = path.join(repoRoot, "extension/sidepanel/index.html");
const appMarker = '    <script type="module" src="./app.js"></script>';
const harnessScript = '    <script src="/tests/browser/chrome-stub.js"></script>';
const harnessCalls = [];

const mounts = [
  ["/sidepanel/", path.join(repoRoot, "extension/sidepanel")],
  ["/shared/", path.join(repoRoot, "extension/shared")],
  ["/assets/", path.join(repoRoot, "extension/assets")],
  ["/tests/", path.join(repoRoot, "tests")]
];

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

function resolveRequestPath(requestPath) {
  for (const [prefix, directory] of mounts) {
    if (!requestPath.startsWith(prefix)) continue;
    const relative = requestPath.slice(prefix.length);
    const resolved = path.resolve(directory, relative);
    if (resolved === directory || resolved.startsWith(directory + path.sep)) return resolved;
  }
  return null;
}

async function renderHarnessIndex() {
  const html = await fs.readFile(indexPath, "utf8");
  if (!html.includes(appMarker)) throw new Error("sidepanel app script marker not found");
  return html.replace(appMarker, harnessScript + "\n" + appMarker);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (requestUrl.pathname === "/__harness/calls") {
      if (request.method === "DELETE") {
        harnessCalls.length = 0;
      } else if (request.method === "POST") {
        harnessCalls.push(await readJsonBody(request));
      }
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": contentTypes[".json"]
      });
      response.end(JSON.stringify({ calls: harnessCalls }));
      return;
    }

    if (requestUrl.pathname === "/") {
      response.writeHead(302, { Location: "/sidepanel/index.html?mode=float&harness=1" });
      response.end();
      return;
    }

    if (requestUrl.pathname === "/sidepanel/index.html") {
      const html = await renderHarnessIndex();
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": contentTypes[".html"]
      });
      response.end(html);
      return;
    }

    const filePath = resolveRequestPath(requestUrl.pathname);
    if (!filePath) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const data = await fs.readFile(filePath);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(data);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500, {
      "Content-Type": "text/plain; charset=utf-8"
    });
    response.end(String(error?.message || error));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Boss panel harness: http://127.0.0.1:${port}/`);
});
