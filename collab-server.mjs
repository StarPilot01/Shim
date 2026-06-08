import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const collabDir = join(rootDir, ".collab");
const stateFile = join(collabDir, "project-state.json");
const port = Number(process.env.PORT || process.argv[2] || 8770);
const host = process.env.HOST || process.argv[3] || "127.0.0.1";
const clients = new Map();
const streams = new Set();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

let doc = await loadDocument();

async function loadInitialState() {
  const source = await readFile(join(rootDir, "assets", "data", "project-data.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: "project-data.js" });
  return structuredClone(sandbox.window.SHIMROOM_PROJECT_DATA || { tabs: [], datasets: {}, glossary: [] });
}

async function loadDocument() {
  await mkdir(collabDir, { recursive: true });
  if (existsSync(stateFile)) {
    try {
      const saved = JSON.parse(await readFile(stateFile, "utf8"));
      if (saved && typeof saved === "object" && saved.state) {
        return {
          revision: Number(saved.revision || 0),
          state: saved.state,
          pathRevisions: saved.pathRevisions && typeof saved.pathRevisions === "object" ? saved.pathRevisions : {},
          updatedAt: saved.updatedAt || new Date().toISOString()
        };
      }
    } catch (err) {
      console.warn("Could not read collaboration state. Starting from embedded data.", err);
    }
  }
  return {
    revision: 0,
    state: await loadInitialState(),
    pathRevisions: {},
    updatedAt: new Date().toISOString()
  };
}

async function saveDocument() {
  const tmp = `${stateFile}.tmp`;
  await writeFile(tmp, JSON.stringify(doc, null, 2), "utf8");
  await rename(tmp, stateFile);
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}

function pathKey(path) {
  if (!Array.isArray(path) || !path.length) return "/";
  return `/${path.map(part => String(part).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

function pathsOverlap(a, b) {
  if (a === "/" || b === "/") return true;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function hasConflict(path, baseRevision) {
  const key = pathKey(path);
  return Object.entries(doc.pathRevisions)
    .some(([changedPath, revision]) => revision > baseRevision && pathsOverlap(key, changedPath));
}

function assignAtPath(target, path, value, deleted = false) {
  if (!Array.isArray(path) || !path.length) {
    if (deleted) return {};
    return structuredClone(value);
  }
  let cursor = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    const nextKey = path[index + 1];
    if (cursor[key] === undefined || cursor[key] === null || typeof cursor[key] !== "object") {
      cursor[key] = /^\d+$/.test(String(nextKey)) ? [] : {};
    }
    cursor = cursor[key];
  }
  const last = path[path.length - 1];
  if (deleted) {
    if (Array.isArray(cursor) && /^\d+$/.test(String(last))) cursor.splice(Number(last), 1);
    else delete cursor[last];
  } else {
    cursor[last] = structuredClone(value);
  }
  return target;
}

function normalizedChanges(changes) {
  if (!Array.isArray(changes)) return [];
  return changes
    .filter(change => change && Array.isArray(change.path))
    .slice(0, 5000)
    .map(change => ({
      path: change.path.map(part => String(part)),
      value: change.value,
      deleted: Boolean(change.deleted)
    }));
}

function presencePayload() {
  const now = Date.now();
  return [...clients.values()]
    .filter(client => now - client.lastSeen < 45000)
    .map(({ id, name, tabTitle, editing, lastSeen }) => ({ id, name, tabTitle, editing, lastSeen }));
}

function broadcast(payload) {
  const event = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of streams) {
    try {
      res.write(event);
    } catch (_) {
      streams.delete(res);
    }
  }
}

function touchClient(info = {}) {
  const id = String(info.clientId || "").trim();
  if (!id) return;
  clients.set(id, {
    id,
    name: String(info.clientName || info.name || "사용자").slice(0, 40),
    tabTitle: String(info.tabTitle || "").slice(0, 80),
    editing: Boolean(info.editing),
    lastSeen: Date.now()
  });
}

async function handlePatch(req, res) {
  try {
    const body = await readBody(req);
    touchClient(body);
    const baseRevision = Number(body.baseRevision || 0);
    const changes = normalizedChanges(body.changes);
    if (!changes.length) {
      sendJson(res, 200, { ok: true, revision: doc.revision, state: doc.state, presence: presencePayload() });
      return;
    }
    const conflicts = changes.filter(change => hasConflict(change.path, baseRevision)).map(change => pathKey(change.path));
    if (conflicts.length) {
      sendJson(res, 409, { ok: false, reason: "conflict", revision: doc.revision, state: doc.state, conflicts, presence: presencePayload() });
      return;
    }
    let nextState = structuredClone(doc.state);
    for (const change of changes) {
      nextState = assignAtPath(nextState, change.path, change.value, change.deleted);
    }
    doc.revision += 1;
    nextState.updatedAt = new Date().toISOString();
    doc.state = nextState;
    doc.updatedAt = nextState.updatedAt;
    for (const change of changes) doc.pathRevisions[pathKey(change.path)] = doc.revision;
    doc.pathRevisions["/updatedAt"] = doc.revision;
    await saveDocument();
    const payload = { type: "state", revision: doc.revision, clientId: body.clientId || "" };
    broadcast(payload);
    broadcast({ type: "presence", presence: presencePayload() });
    sendJson(res, 200, { ok: true, revision: doc.revision, state: doc.state, presence: presencePayload() });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message || "Patch failed." });
  }
}

async function handlePresence(req, res) {
  try {
    const body = await readBody(req, 1024 * 1024);
    touchClient(body);
    broadcast({ type: "presence", presence: presencePayload() });
    sendJson(res, 200, { ok: true, presence: presencePayload() });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message || "Presence failed." });
  }
}

function handleEvents(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  touchClient({
    clientId: url.searchParams.get("clientId"),
    clientName: url.searchParams.get("clientName")
  });
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    "connection": "keep-alive"
  });
  streams.add(res);
  res.write(`data: ${JSON.stringify({ type: "hello", revision: doc.revision, presence: presencePayload() })}\n\n`);
  const timer = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({ type: "ping", revision: doc.revision })}\n\n`);
    } catch (_) {
      clearInterval(timer);
      streams.delete(res);
    }
  }, 15000);
  req.on("close", () => {
    clearInterval(timer);
    streams.delete(res);
  });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawPath = decodeURIComponent(url.pathname === "/" ? "/GDD/index.html" : url.pathname);
  const filePath = normalize(join(rootDir, rawPath));
  if (!filePath.startsWith(rootDir) || relative(rootDir, filePath).startsWith("..")) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  } catch (_) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "GET" && url.pathname === "/api/collab/state") {
    sendJson(res, 200, { ok: true, revision: doc.revision, state: doc.state, presence: presencePayload() });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/collab/events") {
    handleEvents(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/collab/patch") {
    await handlePatch(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/collab/presence") {
    await handlePresence(req, res);
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    await serveStatic(req, res);
    return;
  }
  res.writeHead(405);
  res.end("Method not allowed");
});

setInterval(() => {
  const before = clients.size;
  const now = Date.now();
  for (const [id, client] of clients) {
    if (now - client.lastSeen > 45000) clients.delete(id);
  }
  if (clients.size !== before) broadcast({ type: "presence", presence: presencePayload() });
}, 10000);

server.listen(port, host, () => {
  console.log(`Shim collaboration server: http://${host}:${port}/GDD/index.html`);
});
