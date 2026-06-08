(function () {
  const CLIENT_KEY = "shimroom-collab-client-id";
  const NAME_KEY = "shimroom-collab-name";
  const PUSH_DELAY = 700;
  const PRESENCE_DELAY = 8000;
  const API = "/api/collab";

  let enabled = false;
  let applyingRemote = false;
  let baseRevision = 0;
  let lastSyncedState = null;
  let pushTimer = null;
  let pushInFlight = false;
  let pushAgain = false;
  let pendingRemote = false;
  let source = null;

  const clientId = readClientId();
  const clientName = readClientName();
  const originalSaveNow = saveNow;

  const chip = document.createElement("span");
  chip.id = "collabStatus";
  chip.className = "collab-status offline";
  chip.textContent = "로컬 저장";
  document.querySelector(".top-actions")?.insertBefore(chip, document.getElementById("openTerms"));

  saveNow = function collabSaveNow() {
    originalSaveNow();
    if (enabled && !applyingRemote) scheduleCollabPush();
  };

  function readClientId() {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  }

  function readClientName() {
    const fromUrl = new URLSearchParams(location.search).get("user");
    const saved = localStorage.getItem(NAME_KEY);
    const name = (fromUrl || saved || `사용자 ${clientId.slice(0, 4)}`).trim().slice(0, 40);
    localStorage.setItem(NAME_KEY, name);
    return name;
  }

  function clone(value) {
    return structuredClone(value);
  }

  function stableJson(value) {
    return JSON.stringify(value);
  }

  function sameValue(a, b) {
    return stableJson(a) === stableJson(b);
  }

  function shouldSkipPath(path) {
    return path.length === 1 && path[0] === "updatedAt";
  }

  function objectLike(value) {
    return value && typeof value === "object";
  }

  function diffStates(base, next, path = []) {
    if (shouldSkipPath(path)) return [];
    if (sameValue(base, next)) return [];
    if (!objectLike(base) || !objectLike(next) || Array.isArray(base) !== Array.isArray(next)) {
      return [{ path, value: clone(next) }];
    }
    if (Array.isArray(base)) {
      if (base.length !== next.length) return [{ path, value: clone(next) }];
      return next.flatMap((value, index) => diffStates(base[index], value, [...path, String(index)]));
    }
    const keys = new Set([...Object.keys(base), ...Object.keys(next)]);
    const changes = [];
    keys.forEach(key => {
      if (key === "updatedAt" && path.length === 0) return;
      if (!(key in next)) {
        changes.push({ path: [...path, key], deleted: true });
        return;
      }
      if (!(key in base)) {
        changes.push({ path: [...path, key], value: clone(next[key]) });
        return;
      }
      changes.push(...diffStates(base[key], next[key], [...path, key]));
    });
    return changes;
  }

  function localChanges() {
    if (!lastSyncedState) return [];
    const changes = diffStates(lastSyncedState, state);
    if (changes.length > 350) return [{ path: [], value: clone(state) }];
    return changes;
  }

  function isActivelyEditing() {
    const el = document.activeElement;
    return Boolean(el?.matches?.("input, textarea, select, [contenteditable='true']"));
  }

  function setChip(text, status = "online") {
    chip.textContent = text;
    chip.classList.toggle("offline", status === "offline");
    chip.classList.toggle("syncing", status === "syncing");
    chip.classList.toggle("online", status === "online");
  }

  function updatePresenceLabel(presence = []) {
    const count = Math.max(1, presence.length || 1);
    const suffix = pendingRemote ? " · 원격 변경 대기" : "";
    setChip(`협업 ${count}명${suffix}`, pendingRemote ? "syncing" : "online");
  }

  function replaceLocalState(remoteState, revision, options = {}) {
    applyingRemote = true;
    state = normalizeState(clone(remoteState));
    baseRevision = Number(revision || baseRevision);
    lastSyncedState = clone(state);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
    if (options.render !== false) {
      CommandManager.clear();
      render();
    }
    applyingRemote = false;
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "content-type": "application/json", ...(options.headers || {}) },
      ...options
    });
    const json = await response.json();
    if (!response.ok) {
      const error = new Error(json.error || json.reason || "Request failed.");
      error.status = response.status;
      error.payload = json;
      throw error;
    }
    return json;
  }

  async function connectCollaboration() {
    try {
      setChip("협업 연결 중", "syncing");
      const remote = await requestJson(`${API}/state`);
      enabled = true;
      const localUpdated = Date.parse(state.updatedAt || "") || 0;
      const remoteUpdated = Date.parse(remote.state?.updatedAt || "") || 0;
      lastSyncedState = normalizeState(clone(remote.state));
      baseRevision = Number(remote.revision || 0);
      if (localUpdated > remoteUpdated && baseRevision === 0) {
        scheduleCollabPush(50);
      } else {
        replaceLocalState(remote.state, remote.revision);
      }
      updatePresenceLabel(remote.presence);
      openEventStream();
      sendPresence();
      setInterval(sendPresence, PRESENCE_DELAY);
    } catch (_) {
      enabled = false;
      setChip("로컬 저장", "offline");
    }
  }

  function openEventStream() {
    if (!window.EventSource || source) return;
    const params = new URLSearchParams({ clientId, clientName });
    source = new EventSource(`${API}/events?${params}`);
    source.onmessage = event => {
      const message = JSON.parse(event.data || "{}");
      if (message.type === "presence" || message.type === "hello") updatePresenceLabel(message.presence);
      if (message.type === "state" && message.clientId !== clientId && Number(message.revision || 0) > baseRevision) {
        pullRemoteState(message.revision);
      }
    };
    source.onerror = () => setChip("협업 재연결 중", "syncing");
  }

  async function pullRemoteState(revision) {
    if (localChanges().length && isActivelyEditing()) {
      pendingRemote = true;
      setChip("협업 원격 변경 대기", "syncing");
      return;
    }
    try {
      const remote = await requestJson(`${API}/state`);
      if (Number(remote.revision || 0) >= Number(revision || 0)) {
        pendingRemote = false;
        replaceLocalState(remote.state, remote.revision);
        updatePresenceLabel(remote.presence);
        toast("다른 사용자의 변경을 반영했습니다.");
      }
    } catch (_) {}
  }

  function scheduleCollabPush(delay = PUSH_DELAY) {
    if (!enabled || applyingRemote) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushLocalChanges, delay);
  }

  async function pushLocalChanges() {
    if (!enabled || applyingRemote) return;
    if (pushInFlight) {
      pushAgain = true;
      return;
    }
    const changes = localChanges();
    if (!changes.length) return;
    pushInFlight = true;
    setChip("협업 저장 중", "syncing");
    try {
      const result = await requestJson(`${API}/patch`, {
        method: "POST",
        body: JSON.stringify({
          clientId,
          clientName,
          baseRevision,
          changes
        })
      });
      pendingRemote = false;
      replaceLocalState(result.state, result.revision, { render: !isActivelyEditing() });
      updatePresenceLabel(result.presence);
    } catch (err) {
      if (err.status === 409 && err.payload?.state) {
        pendingRemote = false;
        replaceLocalState(err.payload.state, err.payload.revision);
        toast("같은 위치가 동시에 수정되어 최신 서버 문서로 맞췄습니다.");
      } else {
        setChip("협업 저장 실패", "offline");
      }
    } finally {
      pushInFlight = false;
      if (pushAgain) {
        pushAgain = false;
        scheduleCollabPush(120);
      }
    }
  }

  function sendPresence() {
    if (!enabled) return;
    const payload = JSON.stringify({
      clientId,
      clientName,
      tabTitle: getCurrentTab()?.title || "",
      editing: Boolean(isEditing)
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(`${API}/presence`, new Blob([payload], { type: "application/json" }));
      return;
    }
    fetch(`${API}/presence`, { method: "POST", headers: { "content-type": "application/json" }, body: payload }).catch(() => {});
  }

  document.addEventListener("visibilitychange", sendPresence);
  window.addEventListener("beforeunload", () => {
    if (enabled && localChanges().length) {
      navigator.sendBeacon?.(`${API}/patch`, new Blob([JSON.stringify({
        clientId,
        clientName,
        baseRevision,
        changes: localChanges()
      })], { type: "application/json" }));
    }
  });

  connectCollaboration();
})();
