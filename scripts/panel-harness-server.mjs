import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createUpdateChecker } from "../extension/background/update-checker.js";
import { normalizeUpdateState, UPDATE_RELEASE_PAGE } from "../extension/shared/update-policy.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.BHT_PANEL_TEST_PORT || 4178);
const indexPath = path.join(repoRoot, "extension/sidepanel/index.html");
const appMarker = '    <script type="module" src="./app.js"></script>';
const harnessScript = '    <script src="/tests/browser/chrome-stub.js"></script>';
const harnessCalls = [];
const updateFixtures = new Map();

function updateFixture(scope, mode) {
  if (updateFixtures.has(scope)) return updateFixtures.get(scope);
  let state = normalizeUpdateState();
  const checker = createUpdateChecker({
    currentVersion: "1.7.44",
    storage: {
      get: async (key) => ({ [key]: state }),
      set: async (patch) => { state = Object.values(patch)[0]; }
    },
    fetchFeed: async () => {
      if (mode === "error") return { ok: false, status: 503 };
      const version = mode === "current" ? "1.7.44" : "1.7.45";
      return { ok: true, text: async () => `<feed><entry>
        <link rel="alternate" href="${UPDATE_RELEASE_PAGE}/tag/v${version}"/>
        <updated>2026-10-30T12:00:00Z</updated>
        <content>更新提醒测试版本：改进使用体验。</content>
      </entry></feed>` };
    }
  });
  const fixture = { checker, read: () => state };
  updateFixtures.set(scope, fixture);
  return fixture;
}

const mounts = [
  ["/sidepanel/", path.join(repoRoot, "extension/sidepanel")],
  ["/background/", path.join(repoRoot, "extension/background")],
  ["/content/", path.join(repoRoot, "extension/content")],
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
    if (requestUrl.pathname === "/__harness/update") {
      const input = request.method === "POST" ? await readJsonBody(request) : {};
      const fixture = updateFixture(input.scope || requestUrl.searchParams.get("scope") || "default",
        input.mode || requestUrl.searchParams.get("mode") || "current");
      let result = { ok: true, state: fixture.read() };
      if (input.action === "check") result = await fixture.checker.check({ force: input.force === true });
      if (input.action === "claim") result = await fixture.checker.claimReminder(input.version);
      if (input.action === "confirm") result = await fixture.checker.confirmReminder(input.claimId);
      if (input.action === "cancel") result = await fixture.checker.cancelReminder(input.claimId);
      if (input.action === "claim" && input.delay) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000, Math.max(0, Number(input.delay) || 0))));
      }
      response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": contentTypes[".json"] });
      response.end(JSON.stringify(result));
      return;
    }
    if (requestUrl.pathname === "/__harness/frame") {
      const width = Math.max(300, Math.min(800, Number(requestUrl.searchParams.get("width")) || 420));
      response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": contentTypes[".html"] });
      response.end(`<!doctype html><html><head><meta charset="utf-8"><title>面板尺寸验证</title></head>
        <body style="margin:0;background:#e8e8e8"><iframe title="AutoCast 开发面板" width="${width}" height="1000"
        style="display:block;border:0" src="/sidepanel/index.html?mode=float&harness=1"></iframe></body></html>`);
      return;
    }
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
