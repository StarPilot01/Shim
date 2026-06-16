import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createSessionToken } from "./server/auth-crypto.mjs";
import { createAuthStore } from "./server/mysql-auth.mjs";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const collabDir = join(rootDir, ".collab");
const stateFile = join(collabDir, "project-state.json");
const archiveStateFile = join(collabDir, "archive-state.json");
const port = Number(process.env.PORT || process.argv[2] || 8770);
const host = process.env.HOST || process.argv[3] || "127.0.0.1";
const cookieName = process.env.SESSION_COOKIE || "shim_session";
const authDisabled = process.env.AUTH_DISABLED === "1";
const sessionDays = Number(process.env.SESSION_DAYS || 14);
const sessionMaxAgeMs = Math.max(1, sessionDays) * 24 * 60 * 60 * 1000;
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
let archiveDoc = await loadArchiveDocument();
let authStore = null;

if (!authDisabled) {
  authStore = await createAuthStore(process.env);
  await authStore.deleteExpiredSessions();
  setInterval(() => {
    authStore.deleteExpiredSessions().catch(err => console.warn("Could not delete expired sessions.", err));
  }, 60 * 60 * 1000);
}

async function loadInitialState() {
  const source = await readFile(join(rootDir, "assets", "data", "project-data.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: "project-data.js" });
  return structuredClone(sandbox.window.SHIMROOM_PROJECT_DATA || { tabs: [], datasets: {}, glossary: [] });
}

async function loadInitialArchiveState() {
  const source = await readFile(join(rootDir, "assets", "data", "notion-archive-data.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: "notion-archive-data.js" });
  return structuredClone(sandbox.window.SHIM_NOTION_ARCHIVE || { documents: [], collections: [], media: [] });
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

async function loadArchiveDocument() {
  await mkdir(collabDir, { recursive: true });
  if (existsSync(archiveStateFile)) {
    try {
      const saved = JSON.parse(await readFile(archiveStateFile, "utf8"));
      if (saved && typeof saved === "object" && saved.state) {
        return {
          revision: Number(saved.revision || 0),
          state: saved.state,
          updatedAt: saved.updatedAt || new Date().toISOString()
        };
      }
    } catch (err) {
      console.warn("Could not read archive state. Starting from embedded data.", err);
    }
  }
  return {
    revision: 0,
    state: await loadInitialArchiveState(),
    updatedAt: new Date().toISOString()
  };
}

async function saveDocument() {
  const tmp = `${stateFile}.tmp`;
  await writeFile(tmp, JSON.stringify(doc, null, 2), "utf8");
  await rename(tmp, stateFile);
}

async function saveArchiveDocument() {
  const tmp = `${archiveStateFile}.tmp`;
  await writeFile(tmp, JSON.stringify(archiveDoc, null, 2), "utf8");
  await rename(tmp, archiveStateFile);
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function readRawBody(req, limit = 25 * 1024 * 1024) {
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
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readBody(req, limit = 25 * 1024 * 1024) {
  const body = await readRawBody(req, limit);
  return body ? JSON.parse(body) : {};
}

async function readFormBody(req, limit = 1024 * 1024) {
  const body = await readRawBody(req, limit);
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (contentType.includes("application/json")) return body ? JSON.parse(body) : {};
  return Object.fromEntries(new URLSearchParams(body));
}

function parseCookies(header = "") {
  const cookies = {};
  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function cookieHeader(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (process.env.COOKIE_SECURE === "1") parts.push("Secure");
  return parts.join("; ");
}

function redirect(res, location, status = 303, headers = {}) {
  res.writeHead(status, { location, "cache-control": "no-store", ...headers });
  res.end();
}

function sanitizeNext(value) {
  const next = String(value || "/GDD/index.html");
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/api/auth/login")) return "/GDD/index.html";
  return next;
}

function wantsJson(req) {
  const accept = String(req.headers.accept || "");
  const contentType = String(req.headers["content-type"] || "");
  return accept.includes("application/json") || contentType.includes("application/json");
}

function isApiRequest(req) {
  return String(req.url || "").startsWith("/api/");
}

function getSessionToken(req) {
  return parseCookies(req.headers.cookie || "")[cookieName] || "";
}

async function currentUser(req) {
  if (authDisabled) {
    return { id: 0, username: "local", displayName: "Local user", role: "admin" };
  }
  return authStore.getSessionUser(getSessionToken(req));
}

function canEdit(user) {
  return user && (user.role === "admin" || user.role === "editor");
}

function authRequired(req, res, url) {
  if (wantsJson(req) || isApiRequest(req)) {
    sendJson(res, 401, { ok: false, reason: "auth_required" });
    return;
  }
  redirect(res, `/login?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
}

function forbidden(res) {
  sendJson(res, 403, { ok: false, reason: "forbidden" });
}

async function handleLogin(req, res) {
  try {
    const body = await readFormBody(req, 64 * 1024);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const next = sanitizeNext(body.next);
    const user = await authStore.verifyCredentials(username, password);

    if (!user) {
      if (wantsJson(req)) {
        sendJson(res, 401, { ok: false, reason: "invalid_credentials" });
      } else {
        sendLoginPage(res, { next, error: "아이디 또는 비밀번호를 확인해주세요." });
      }
      return;
    }

    const token = createSessionToken();
    await authStore.createSession(user.id, token, {
      maxAgeMs: sessionMaxAgeMs,
      userAgent: req.headers["user-agent"] || "",
      ipAddress: clientIp(req)
    });

    const setCookie = cookieHeader(cookieName, token, { maxAge: sessionMaxAgeMs / 1000 });
    if (wantsJson(req)) {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": setCookie
      });
      res.end(JSON.stringify({ ok: true, user }));
    } else {
      redirect(res, next, 303, { "set-cookie": setCookie });
    }
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message || "Login failed." });
  }
}

async function handleLogout(req, res) {
  try {
    if (!authDisabled) await authStore.deleteSession(getSessionToken(req));
    const clearCookie = cookieHeader(cookieName, "", { maxAge: 0, expires: new Date(0) });
    if (wantsJson(req)) {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": clearCookie
      });
      res.end(JSON.stringify({ ok: true }));
    } else {
      redirect(res, "/login", 303, { "set-cookie": clearCookie });
    }
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message || "Logout failed." });
  }
}

function sendLoginPage(res, options = {}) {
  const next = escapeHtml(sanitizeNext(options.next));
  const error = options.error ? `<p class="error">${escapeHtml(options.error)}</p>` : "";
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shim 로그인</title>
  <style>
    :root { color-scheme: light; font-family: Inter, Pretendard, system-ui, sans-serif; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #f5f7fb; color: #172033; }
    main { width: min(92vw, 360px); padding: 28px; background: #fff; border: 1px solid #d8deea; border-radius: 8px; box-shadow: 0 14px 40px rgba(20, 31, 51, .08); }
    h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: 0; }
    p { margin: 0 0 20px; color: #627089; }
    label { display: grid; gap: 6px; margin-top: 14px; font-size: 13px; font-weight: 700; color: #344057; }
    input { width: 100%; box-sizing: border-box; border: 1px solid #c9d1df; border-radius: 6px; padding: 11px 12px; font: inherit; }
    button { width: 100%; margin-top: 20px; border: 0; border-radius: 6px; padding: 12px 14px; background: #2057a7; color: #fff; font: inherit; font-weight: 800; cursor: pointer; }
    .error { padding: 10px 12px; border-radius: 6px; background: #fff1f1; color: #9b1c1c; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <h1>Shim 로그인</h1>
    <p>문서 서버에 접근하려면 로그인하세요.</p>
    ${error}
    <form method="post" action="/api/auth/login">
      <input type="hidden" name="next" value="${next}">
      <label>아이디
        <input name="username" autocomplete="username" required autofocus>
      </label>
      <label>비밀번호
        <input name="password" type="password" autocomplete="current-password" required>
      </label>
      <button type="submit">로그인</button>
    </form>
  </main>
</body>
</html>`);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "";
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

function touchClient(info = {}, user = null) {
  const id = String(info.clientId || "").trim();
  if (!id) return;
  const name = user?.displayName || user?.username || info.clientName || info.name || "User";
  clients.set(id, {
    id,
    name: String(name).slice(0, 40),
    tabTitle: String(info.tabTitle || "").slice(0, 80),
    editing: Boolean(info.editing),
    lastSeen: Date.now()
  });
}

async function handlePatch(req, res, user) {
  try {
    const body = await readBody(req);
    touchClient(body, user);
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

async function handlePresence(req, res, user) {
  try {
    const body = await readBody(req, 1024 * 1024);
    touchClient(body, user);
    broadcast({ type: "presence", presence: presencePayload() });
    sendJson(res, 200, { ok: true, presence: presencePayload() });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message || "Presence failed." });
  }
}

async function handleArchiveSave(req, res, user) {
  try {
    const body = await readBody(req, 35 * 1024 * 1024);
    touchClient(body, user);
    const state = body.state;
    if (!state || typeof state !== "object" || !Array.isArray(state.documents) || !Array.isArray(state.collections)) {
      sendJson(res, 400, { ok: false, error: "Invalid archive state." });
      return;
    }
    const baseRevision = Number(body.revision ?? body.baseRevision ?? 0);
    if (baseRevision < archiveDoc.revision) {
      sendJson(res, 409, {
        ok: false,
        reason: "conflict",
        revision: archiveDoc.revision,
        updatedAt: archiveDoc.updatedAt,
        state: archiveDoc.state
      });
      return;
    }
    archiveDoc = {
      revision: archiveDoc.revision + 1,
      state,
      updatedAt: new Date().toISOString()
    };
    archiveDoc.state.updatedAt = archiveDoc.updatedAt;
    await saveArchiveDocument();
    broadcast({ type: "archive-state", revision: archiveDoc.revision, clientId: body.clientId || "" });
    broadcast({ type: "presence", presence: presencePayload() });
    sendJson(res, 200, { ok: true, revision: archiveDoc.revision, updatedAt: archiveDoc.updatedAt });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message || "Archive save failed." });
  }
}

function handleArchiveState(res) {
  sendJson(res, 200, {
    ok: true,
    revision: archiveDoc.revision,
    updatedAt: archiveDoc.updatedAt,
    state: archiveDoc.state
  });
}

function handleEvents(req, res, user) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  touchClient({
    clientId: url.searchParams.get("clientId"),
    clientName: url.searchParams.get("clientName")
  }, user);
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
  const pathname = url.pathname === "/" ? "/index.html" : (url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname);
  const rawPath = decodeURIComponent(pathname);
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
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/login") {
      const user = await currentUser(req);
      if (user) redirect(res, sanitizeNext(url.searchParams.get("next")), 302);
      else sendLoginPage(res, { next: url.searchParams.get("next") });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      if (authDisabled) {
        redirect(res, sanitizeNext(url.searchParams.get("next")), 303);
      } else {
        await handleLogin(req, res);
      }
      return;
    }

    const user = await currentUser(req);

    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      if (!user) authRequired(req, res, url);
      else sendJson(res, 200, { ok: true, user });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      await handleLogout(req, res);
      return;
    }

    if (!user) {
      authRequired(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/collab/state") {
      sendJson(res, 200, { ok: true, revision: doc.revision, state: doc.state, presence: presencePayload() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/archive/state") {
      handleArchiveState(res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/archive/save") {
      if (!canEdit(user)) {
        forbidden(res);
        return;
      }
      await handleArchiveSave(req, res, user);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/collab/events") {
      handleEvents(req, res, user);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/collab/patch") {
      if (!canEdit(user)) {
        forbidden(res);
        return;
      }
      await handlePatch(req, res, user);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/collab/presence") {
      await handlePresence(req, res, user);
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      await serveStatic(req, res);
      return;
    }
    res.writeHead(405);
    res.end("Method not allowed");
  } catch (err) {
    console.error("Request failed.", err);
    sendJson(res, 500, { ok: false, error: "Internal server error." });
  }
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
  console.log(`Authentication: ${authDisabled ? "disabled" : "MySQL"}`);
});
