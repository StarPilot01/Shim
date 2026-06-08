function showCustomModal({ title, placeholder, defaultValue, onConfirm }) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-window">
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="modal-close" type="button">×</button>
      </div>
      <div class="modal-body">
        <input class="modal-input" type="text" placeholder="${escapeHtml(placeholder || '')}" value="${escapeHtml(defaultValue || '')}">
      </div>
      <div class="modal-footer">
        <button class="modal-cancel-btn" type="button">취소</button>
        <button class="primary modal-confirm-btn" type="button">확인</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const input = backdrop.querySelector(".modal-input");
  input.focus();
  input.select();
  const close = () => backdrop.remove();
  const submit = () => {
    const val = input.value.trim();
    if (val) {
      onConfirm(val);
      close();
    }
  };
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector(".modal-cancel-btn").addEventListener("click", close);
  backdrop.querySelector(".modal-confirm-btn").addEventListener("click", submit);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
  backdrop.addEventListener("click", event => {
    if (event.target === backdrop) close();
  });
}

function showCustomConfirm({ message, onConfirm }) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-window">
      <div class="modal-header">
        <h3>확인</h3>
        <button class="modal-close" type="button">×</button>
      </div>
      <div class="modal-body">
        <p>${escapeHtml(message)}</p>
      </div>
      <div class="modal-footer">
        <button class="modal-cancel-btn" type="button">취소</button>
        <button class="danger modal-confirm-btn" type="button">확인</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector(".modal-cancel-btn").addEventListener("click", close);
  backdrop.querySelector(".modal-confirm-btn").addEventListener("click", () => {
    onConfirm();
    close();
  });
  backdrop.addEventListener("click", event => {
    if (event.target === backdrop) close();
  });
}

function ensureRows(rows) {
  const max = Math.max(1, ...rows.map(row => row.length));
  return (rows.length ? rows : [[""]]).map(row => {
    const next = Array.isArray(row) ? [...row] : [String(row ?? "")];
    while (next.length < max) next.push("");
    return next;
  });
}

function currentBlockFromEvent(event) {
  const article = event.target.closest("[data-block-id]");
  const tab = getCurrentTab();
  if (!article || !tab) return null;
  return tab.blocks.find(block => block.id === article.dataset.blockId);
}

function scrollToBlock(blockId) {
  requestAnimationFrame(() => {
    const target = document.getElementById(`block-${blockId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function focusEditableTarget(target, options = {}) {
  try {
    target.focus({ preventScroll: true });
  } catch (_) {
    target.focus();
  }
  if (!target.matches?.('[contenteditable="true"]')) {
    target.select?.();
    return;
  }
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(target);
  if (!options.selectAll) {
    range.collapse(options.position === "start");
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function focusBlockEditor(blockId, options = {}) {
  requestAnimationFrame(() => {
    const blockEl = document.getElementById(`block-${blockId}`);
    if (!blockEl) return;
    const target = blockEl.querySelector('[contenteditable="true"], textarea:not([disabled]), input:not([disabled]):not([type="hidden"])');
    if (target) {
      focusEditableTarget(target, options);
      lastFocusedBlockId = blockId;
    }
    blockEl.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function focusContentUnitEditor(blockId, unitId, options = {}) {
  requestAnimationFrame(() => {
    const blockEl = document.getElementById(`block-${blockId}`);
    const unitEl = blockEl?.querySelector(`[data-unit-id="${CSS.escape(unitId)}"]`);
    if (!unitEl) return;
    const target = unitEl.querySelector('[contenteditable="true"], textarea:not([disabled]), input:not([disabled]):not([type="hidden"])');
    if (target) {
      focusEditableTarget(target, options);
      lastFocusedBlockId = blockId;
    }
    unitEl.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function createBlock(type) {
  const definition = BLOCK_DEFINITIONS[type];
  return { id: uid("block"), type, ...(definition?.create?.() || { content: "" }) };
}

function addBlock(type, targetIndex = null) {
  if (!isEditing) return;
  if (currentView !== "document") {
    toast("문서 탭에서만 블록을 추가할 수 있습니다.");
    return;
  }
  const tab = getCurrentTab();
  if (!tab) return;
  const newBlock = createBlock(type);
  let index = tab.blocks.length;
  if (targetIndex !== null) {
    const requestedIndex = Number(targetIndex);
    index = Number.isFinite(requestedIndex)
      ? Math.max(0, Math.min(tab.blocks.length, requestedIndex))
      : tab.blocks.length;
  } else if (lastFocusedBlockId) {
    const focusIndex = tab.blocks.findIndex(b => b.id === lastFocusedBlockId);
    if (focusIndex >= 0) {
      index = focusIndex + 1;
    }
  }
  CommandManager.execute("블록 추가", () => {
    getCurrentTab().blocks.splice(index, 0, newBlock);
  });
  toast("블록을 추가했습니다.");
  focusBlockEditor(newBlock.id);
  highlightBlock(newBlock.id, "block-new");
}

function splitEditableBlock(block, editable, caretOffset) {
  const tab = getCurrentTab();
  if (!tab || !block || !editable) return;
  const index = tab.blocks.findIndex(item => item.id === block.id);
  if (index < 0) return;
  const text = String(editable.innerText || "");
  const offset = Math.max(0, Math.min(text.length, Number(caretOffset) || 0));
  const before = text.slice(0, offset).replace(/\n+$/, "");
  const after = text.slice(offset).replace(/^\n+/, "");
  const newBlock = createBlock("text");
  newBlock.content = after || "";
  CommandManager.execute("블록 나누기", () => {
    block.content = before;
    getCurrentTab().blocks.splice(index + 1, 0, newBlock);
  });
  toast("블록을 나눴습니다.");
  focusBlockEditor(newBlock.id, { position: "start" });
  highlightBlock(newBlock.id, "block-new");
}

function addDatasetBlock() {
  if (!isEditing) return;
  if (currentView !== "document") {
    toast("문서 탭에서만 데이터 시트를 삽입할 수 있습니다.");
    return;
  }
  const sheet = els.datasetSelect?.value || Object.keys(state.datasets)[0];
  const tab = getCurrentTab();
  if (!tab || !sheet) return;
  CommandManager.execute("데이터 시트 삽입", () => {
    tab.blocks.push({ id: uid("block"), type: "dataset", sheet });
  });
  toast("데이터 시트를 삽입했습니다.");
}

function moveBlock(blockId, dir) {
  if (!isEditing) return;
  const tab = getCurrentTab();
  const index = tab.blocks.findIndex(block => block.id === blockId);
  const next = index + dir;
  if (index < 0 || next < 0 || next >= tab.blocks.length) return;
  CommandManager.execute("블록 이동", () => {
    const currentTab = getCurrentTab();
    [currentTab.blocks[index], currentTab.blocks[next]] = [currentTab.blocks[next], currentTab.blocks[index]];
  });
  toast(dir < 0 ? "블록을 위로 이동했습니다." : "블록을 아래로 이동했습니다.");
  highlightBlock(blockId, "block-highlight");
}

function moveBlockTo(blockId, targetBlockId, placement = "before") {
  if (!isEditing || searchQuery) return;
  const tab = getCurrentTab();
  const fromIndex = tab.blocks.findIndex(block => block.id === blockId);
  const targetIndex = tab.blocks.findIndex(block => block.id === targetBlockId);
  if (fromIndex < 0 || targetIndex < 0 || blockId === targetBlockId) return;
  let toIndex = targetIndex + (placement === "after" ? 1 : 0);
  if (fromIndex < toIndex) toIndex -= 1;
  if (fromIndex === toIndex) return;
  CommandManager.execute("블록 드래그 이동", () => {
    const currentTab = getCurrentTab();
    const index = currentTab.blocks.findIndex(block => block.id === blockId);
    const [moved] = currentTab.blocks.splice(index, 1);
    currentTab.blocks.splice(toIndex, 0, moved);
  });
}

function moveContentUnit(blockId, fromUnitId, targetUnitId, placement = "before") {
  if (!isEditing || searchQuery || !blockId || !fromUnitId || !targetUnitId) return false;
  const block = findBlockById(blockId);
  if (!block || block.type !== "generic" || !Array.isArray(block.items)) return false;
  const fromIndex = block.items.findIndex(unit => unit.id === fromUnitId);
  const targetIndex = block.items.findIndex(unit => unit.id === targetUnitId);
  if (fromIndex < 0 || targetIndex < 0 || fromUnitId === targetUnitId) return false;
  let toIndex = targetIndex + (placement === "after" ? 1 : 0);
  if (fromIndex < toIndex) toIndex -= 1;
  if (fromIndex === toIndex) return false;
  let didMove = false;

  CommandManager.execute("콘텐츠 유닛 순서 변경", () => {
    const currentBlock = findBlockById(blockId);
    if (!currentBlock || currentBlock.type !== "generic" || !Array.isArray(currentBlock.items)) return;
    const activeFrom = currentBlock.items.findIndex(unit => unit.id === fromUnitId);
    const activeTarget = currentBlock.items.findIndex(unit => unit.id === targetUnitId);
    if (activeFrom < 0 || activeTarget < 0) return;
    let destination = activeTarget + (placement === "after" ? 1 : 0);
    if (activeFrom < destination) destination -= 1;
    if (activeFrom === destination) return;
    const [moved] = currentBlock.items.splice(activeFrom, 1);
    currentBlock.items.splice(destination, 0, moved);
    didMove = true;
  });

  return didMove;
}

function duplicateBlock(blockId) {
  if (!isEditing) return;
  const tab = getCurrentTab();
  const index = tab.blocks.findIndex(block => block.id === blockId);
  if (index < 0) return;
  const copyId = uid("block");
  CommandManager.execute("블록 복제", () => {
    const currentTab = getCurrentTab();
    const copy = structuredClone(currentTab.blocks[index]);
    copy.id = copyId;
    currentTab.blocks.splice(index + 1, 0, copy);
  });
  toast("블록을 복제했습니다.");
  focusBlockEditor(copyId);
  highlightBlock(copyId, "block-new");
}

function deleteBlock(blockId) {
  if (!isEditing) return;
  const tab = getCurrentTab();
  const block = tab.blocks.find(item => item.id === blockId);
  if (!block) return;
  showCustomConfirm({
    message: `'${labelForType(block.type)}' 블록을 삭제할까요?`,
    onConfirm: () => {
      CommandManager.execute("블록 삭제", () => {
        const currentTab = getCurrentTab();
        currentTab.blocks = currentTab.blocks.filter(item => item.id !== blockId);
      });
      toast("블록을 삭제했습니다.");
    }
  });
}

function addTab() {
  if (!isEditing) return;
  showCustomModal({
    title: "탭 추가",
    placeholder: "탭 이름",
    defaultValue: "새 탭",
    onConfirm: (title) => {
      CommandManager.execute("탭 추가", () => {
        const tab = { id: uid("tab"), title, blocks: [{ id: uid("block"), type: "heading", content: title }] };
        state.tabs.push(tab);
        currentView = "document";
        currentWikiKeyword = "";
        currentTabId = tab.id;
      });
      toast("탭을 추가했습니다.");
      fadeInBlocks();
    }
  });
}

function addChildTab(parentId) {
  if (!isEditing) return;
  const parent = documentTabs().find(tab => tab.id === parentId);
  if (!parent) return;
  showCustomModal({
    title: "하위 탭 추가",
    placeholder: "하위 탭 이름",
    defaultValue: `${parent.title} 하위 탭`,
    onConfirm: (title) => {
      CommandManager.execute("하위 탭 추가", () => {
        const tab = {
          id: uid("tab"),
          parentId: parent.id,
          title,
          blocks: [{ id: uid("block"), type: "heading", content: title }]
        };
        state.tabs.splice(tabInsertIndexAfterSubtree(parent.id), 0, tab);
        currentView = "document";
        currentWikiKeyword = "";
        currentTabId = tab.id;
      });
      toast("하위 탭을 추가했습니다.");
      fadeInBlocks();
    }
  });
}

function renameTab() {
  if (!isEditing) return;
  if (currentView !== "document") return;
  const tab = getCurrentTab();
  if (!tab) return;
  showCustomModal({
    title: "탭 이름 변경",
    placeholder: "탭 이름",
    defaultValue: tab.title,
    onConfirm: (title) => {
      CommandManager.execute("탭 이름 변경", () => {
        getCurrentTab().title = title;
      });
      toast("탭 이름을 변경했습니다.");
    }
  });
}

function duplicateTab() {
  if (!isEditing) return;
  if (currentView !== "document") return;
  const tab = getCurrentTab();
  if (!tab) return;
  CommandManager.execute("탭 복제", () => {
    const source = getCurrentTab();
    const copy = structuredClone(source);
    copy.id = uid("tab");
    copy.parentId = source.parentId || "";
    copy.title = `${source.title} 복사`;
    copy.blocks.forEach(block => block.id = uid("block"));
    state.tabs.push(copy);
    currentTabId = copy.id;
  });
  toast("탭을 복제했습니다.");
}

function deleteTabById(tabId) {
  if (!isEditing) return;
  if (currentView !== "document") return;
  if (documentTabs().length <= 1) {
    toast("마지막 탭은 삭제할 수 없습니다.");
    return;
  }
  const tab = documentTabs().find(item => item.id === tabId);
  if (!tab) return;
  const deleteIds = tabSubtreeIdSet(tab.id);
  if (documentTabs().length <= deleteIds.size) {
    toast("마지막 탭은 삭제할 수 없습니다.");
    return;
  }
  showCustomConfirm({
    message: `'${tab.title}' 탭을 삭제할까요?`,
    onConfirm: () => {
      CommandManager.execute("탭 삭제", () => {
        const ids = tabSubtreeIdSet(tab.id);
        state.tabs = state.tabs.filter(item => !ids.has(item.id));
        if (ids.has(currentTabId)) currentTabId = documentTabs()[0].id;
      });
      toast("탭을 삭제했습니다.");
      fadeInBlocks();
    }
  });
}

function deleteTab() {
  deleteTabById(currentTabId);
}

function moveTab(tabId, dir) {
  if (!isEditing || searchQuery) return false;
  const tab = documentTabs().find(item => item.id === tabId);
  if (!tab) return false;
  const parentId = tab.parentId || "";
  const siblings = documentTabs().filter(item => (item.parentId || "") === parentId);
  const index = siblings.findIndex(item => item.id === tabId);
  const target = siblings[index + dir];
  if (index < 0 || !target) return false;
  return moveTabTo(tabId, target.id, dir > 0 ? "after" : "before", parentId);
}

function tabSubtreeIdSet(tabId) {
  const ids = new Set([tabId]);
  let changed = true;
  while (changed) {
    changed = false;
    documentTabs().forEach(tab => {
      if (!ids.has(tab.id) && ids.has(tab.parentId)) {
        ids.add(tab.id);
        changed = true;
      }
    });
  }
  return ids;
}

function tabInsertIndexAfterSubtree(tabId) {
  const ids = tabSubtreeIdSet(tabId);
  let lastIndex = -1;
  state.tabs.forEach((tab, index) => {
    if (ids.has(tab.id)) lastIndex = index;
  });
  return Math.max(0, lastIndex + 1);
}

function moveTabTo(tabId, targetTabId, placement = "before", nextParentId = null) {
  if (!isEditing || searchQuery || tabId === targetTabId) return false;
  const fromIndex = state.tabs.findIndex(tab => tab.id === tabId);
  const targetIndex = state.tabs.findIndex(tab => tab.id === targetTabId);
  if (fromIndex < 0 || targetIndex < 0) return false;
  const movedIds = tabSubtreeIdSet(tabId);
  if (movedIds.has(targetTabId)) return false;
  const targetParentId = nextParentId === null
    ? (state.tabs[targetIndex].parentId || "")
    : String(nextParentId || "");
  CommandManager.execute("탭 위치 이동", () => {
    const ids = tabSubtreeIdSet(tabId);
    const moving = state.tabs.filter(tab => ids.has(tab.id));
    if (!moving.length) return;
    moving[0].parentId = targetParentId;
    state.tabs = state.tabs.filter(tab => !ids.has(tab.id));
    let insertIndex = placement === "after"
      ? tabInsertIndexAfterSubtree(targetTabId)
      : state.tabs.findIndex(tab => tab.id === targetTabId);
    if (insertIndex < 0) {
      state.tabs.push(...moving);
      return;
    }
    state.tabs.splice(insertIndex, 0, ...moving);
  });
  toast("탭 위치를 이동했습니다.");
  return true;
}

function rowsToCsv(rows) {
  return rows.map(row => row.map(value => {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(",")).join("\r\n");
}

function parseDelimited(text, delimiter) {
  if (delimiter === "\t") {
    return text.trim().split(/\r?\n/).map(line => line.split("\t"));
  }
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows.filter(item => item.some(cellValue => String(cellValue).length));
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function exportJson() {
  CommandManager.commitDraft({ render: false });
  saveNow();
  downloadBlob("shimroom_plan_project.json", JSON.stringify(state, null, 2), "application/json;charset=utf-8");
}

async function saveProjectToFile() {
  CommandManager.commitDraft({ render: false });
  saveNow();
  const content = JSON.stringify(state, null, 2);
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: "shimroom_plan_project.json",
        types: [{
          description: "Shimroom project JSON",
          accept: { "application/json": [".json"] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      toast("프로젝트 파일로 저장했습니다.");
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.error(err);
    }
  }
  downloadBlob("shimroom_plan_project.json", content, "application/json;charset=utf-8");
  toast("프로젝트 JSON 파일을 내려받았습니다.");
}

function exportCurrentHtml() {
  CommandManager.commitDraft({ render: false });
  saveNow();
  const json = JSON.stringify(state, null, 2).replace(/</g, "\\u003c");
  const previousMode = isEditing;
  setMode(false);
  let html = "<!doctype html>\n" + document.documentElement.outerHTML;
  html = html.replace(
    /<script src="assets\/data\/project-data\.js"><\/script>/,
    `<script id="project-data" type="application/json">\n${json}\n  <\/script>`
  ).replace(
    /<script id="project-data" type="application\/json">[\s\S]*?<\/script>/,
    `<script id="project-data" type="application/json">\n${json}\n  <\/script>`
  );
  setMode(previousMode);
  downloadBlob("shimroom_plan_tool_export.html", html, "text/html;charset=utf-8");
}

function markdownRichText(value) {
  let text = String(value ?? "").replace(/\r\n/g, "\n");
  let previous = "";
  while (previous !== text) {
    previous = text;
    text = text.replace(/\[\[(?:size|align|color|mark):[^\]|]+\|([\s\S]*?)\]\]/gi, "$1");
  }
  text = text.replace(/\[\[math:([\s\S]*?)\]\]/gi, (_match, expression) => `$${String(expression).trim()}$`);
  text = text.replace(/\[\[image:(.+?)(?:\|([^\]]*))?\]\]/gi, (_match, path, caption) => markdownImage(path, caption));
  text = text.replace(/\[\[(?:video|file):(.+?)(?:\|([^\]]*))?\]\]/gi, (_match, path, caption) => markdownLink(path, caption));
  return text.replace(/\[\[([^\]\|\n]+)(?:\|([^\]\n]+))?\]\]/g, (_match, target, label) => markdownRichText(label || target));
}

function markdownText(value) {
  return markdownRichText(value).split("\n").map(line => line.trimEnd()).join("\n").trim();
}

function markdownLinkLabel(value) {
  return markdownRichText(value).replace(/[\[\]]/g, "\\$&").trim() || "link";
}

function markdownPathFromValue(value) {
  const raw = String(value || "").trim();
  const asset = typeof assetFromPath === "function" ? assetFromPath(raw) : null;
  const path = asset?.name || raw;
  if (!path) return "";
  return /\s/.test(path) ? `<${path.replace(/[<>]/g, "")}>` : path.replace(/\)/g, "%29");
}

function markdownLink(path, label = "") {
  const href = markdownPathFromValue(path);
  return href ? `[${markdownLinkLabel(label || path)}](${href})` : markdownLinkLabel(label || path);
}

function markdownImage(path, caption = "") {
  const src = markdownPathFromValue(path);
  return src ? `![${markdownLinkLabel(caption || path)}](${src})` : markdownLinkLabel(caption || path);
}

function markdownHeading(value, level = 2) {
  const title = markdownText(value).replace(/^#{1,6}\s+/, "").trim();
  if (!title) return "";
  const safeLevel = Math.max(1, Math.min(6, level));
  return `${"#".repeat(safeLevel)} ${title}`;
}

function markdownHeadingBlock(block, level) {
  const lines = markdownText(block.content || "").split("\n");
  const title = lines.shift() || "";
  const body = lines.join("\n").trim();
  return [markdownHeading(title, level), body].filter(Boolean).join("\n\n");
}

function markdownQuote(value, prefix = "") {
  const text = markdownText(value);
  if (!text) return "";
  const lines = text.split("\n").map(line => line ? `> ${line}` : ">");
  return prefix ? [`> ${prefix}`, ...lines].join("\n") : lines.join("\n");
}

function markdownFence(value, language = "") {
  const content = String(value ?? "").replace(/\r\n/g, "\n").trimEnd();
  const longestTicks = [...content.matchAll(/`+/g)].reduce((max, match) => Math.max(max, match[0].length), 0);
  const fence = "`".repeat(Math.max(3, longestTicks + 1));
  const safeLanguage = String(language || "").trim().replace(/[`\s]+/g, "");
  return `${fence}${safeLanguage}\n${content}\n${fence}`;
}

function markdownTableCell(value) {
  return markdownRichText(value)
    .replace(/\r?\n+/g, "<br>")
    .replace(/\|/g, "\\|")
    .trim();
}

function markdownTable(rows) {
  const normalized = ensureRows(rows)
    .map(row => row.map(cell => String(cell ?? "")))
    .filter(row => row.some(cell => cell.trim()));
  if (!normalized.length) return "";
  const columnCount = Math.max(1, ...normalized.map(row => row.length));
  const padded = normalized.map(row => Array.from({ length: columnCount }, (_item, index) => markdownTableCell(row[index] || "")));
  const header = padded[0];
  const separator = Array.from({ length: columnCount }, () => "---");
  const body = padded.slice(1);
  return [
    `| ${header.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...body.map(row => `| ${row.join(" | ")} |`)
  ].join("\n");
}

function markdownRowsForDataset(sheetName, rows) {
  const normalized = ensureRows(rows);
  if (String(sheetName || "").trim() !== "회의록") return normalized;
  const headerIndex = sheetHeaderIndex(normalized, "회의ID");
  if (headerIndex < 0) return normalized;
  const header = normalized[headerIndex].map(cell => String(cell || "").trim());
  const dateIndex = calendarColumnIndex(header, ["일자", "날짜"], -1);
  const timeIndex = calendarColumnIndex(header, ["시간"], -1);
  const statusIndex = calendarColumnIndex(header, ["상태"], -1);
  const columns = header
    .map((cell, index) => ({ cell, index }))
    .filter(item => item.cell !== "액션아이템")
    .map(item => item.index);
  return normalized.map(row => columns.map(index => {
    if (index === statusIndex && typeof displayMeetingStatus === "function") {
      return displayMeetingStatus(
        row[index],
        dateIndex >= 0 ? row[dateIndex] : "",
        timeIndex >= 0 ? row[timeIndex] : ""
      );
    }
    return row[index] ?? "";
  }));
}

function markdownMediaPath(block) {
  const asset = typeof assetFromBlock === "function" ? assetFromBlock(block) : null;
  const path = String(block.path || "").trim();
  if (path && !path.startsWith("asset:")) return path;
  return asset?.name || path;
}

function markdownDataset(sheetName, title = "", level = 3) {
  const sheet = String(sheetName || "").trim();
  const table = sheet && state.datasets[sheet] ? markdownTable(markdownRowsForDataset(sheet, state.datasets[sheet])) : "";
  if (!table) return title ? markdownHeading(title, level) : "";
  return [
    title ? markdownHeading(title, level) : "",
    `시트: ${sheet}`,
    table
  ].filter(Boolean).join("\n\n");
}

function markdownDataBlock(block, level, title, sheetNames) {
  const pieces = [markdownHeading(title || labelForType(block.type), level)];
  sheetNames
    .map(sheet => String(sheet || "").trim())
    .filter((sheet, index, list) => sheet && list.indexOf(sheet) === index)
    .forEach(sheet => pieces.push(markdownDataset(sheet, sheet, Math.min(6, level + 1))));
  return pieces.filter(Boolean).join("\n\n");
}

function markdownBlock(block, parentLevel = 2) {
  if (!block) return "";
  const childLevel = Math.min(6, parentLevel + 1);
  const headingLevel = Math.min(6, parentLevel + Math.max(1, headingLevelFor(block) || 1));
  if (block.type === "generic") {
    return (block.items || []).map(unit => markdownBlock(unit, parentLevel)).filter(Boolean).join("\n\n");
  }
  if (block.type === "heading") return markdownHeadingBlock(block, headingLevel);
  if (["text", "callout", "quote"].includes(block.type) && isHeadingLike(block)) return markdownHeadingBlock(block, headingLevel);
  if (block.type === "text") return markdownText(block.content || "");
  if (block.type === "callout") return markdownQuote(block.content || "", "[!NOTE]");
  if (block.type === "quote") return markdownQuote(block.content || "");
  if (block.type === "checklist") {
    return (block.items || []).map(item => `- [${item.checked ? "x" : " "}] ${markdownRichText(item.text || "").trim()}`).join("\n");
  }
  if (block.type === "code") return markdownFence(block.content || "", block.language || "text");
  if (block.type === "divider") return block.label ? `---\n\n_${markdownRichText(block.label)}_` : "---";
  if (block.type === "table") return markdownTable(block.rows);
  if (block.type === "dataset") {
    const sheet = state.datasets[block.sheet] ? block.sheet : Object.keys(state.datasets)[0] || "";
    return markdownDataset(sheet, block.title || block.sheet || "데이터", childLevel);
  }
  if (block.type === "flow") return markdownFence(block.content || "", "text");
  if (block.type === "mermaid") return markdownFence(block.content || "", "mermaid");
  if (block.type === "image") return markdownImage(markdownMediaPath(block), block.caption || "첨부 이미지");
  if (block.type === "video") return markdownLink(markdownMediaPath(block), block.caption || "동영상");
  if (block.type === "attachment") return markdownLink(markdownMediaPath(block), block.caption || "첨부 파일");
  if (block.type === "dialogue") {
    return markdownDataBlock(block, childLevel, block.title || "대화", [block.stageSheet || "온기단계", block.dialogueSheet || "대화노드"]);
  }
  if (block.type === "calendar") {
    return markdownDataBlock(block, childLevel, block.title || "프로젝트 달력", [block.sheet || "프로젝트달력"]);
  }
  if (block.type === "team") {
    return markdownDataBlock(block, childLevel, block.title || "팀원 목록", [block.sheet || "팀원목록"]);
  }
  if (block.type === "workboard") {
    return markdownDataBlock(block, childLevel, block.title || "업무 관리", [block.teamSheet || "팀원목록", block.taskSheet || "업무목록"]);
  }
  if (block.type === "meetingbook") {
    return markdownDataBlock(block, childLevel, block.title || "회의록", [block.sheet || "회의록", block.teamSheet || "팀원목록"]);
  }
  return markdownText(block.content || block.caption || block.label || labelForType(block.type));
}

function markdownTab(tab, depth = 0) {
  const level = Math.min(6, 2 + depth);
  const pieces = [
    markdownHeading(tab.title || "제목 없음", level),
    tab.subtitle ? markdownText(tab.subtitle) : ""
  ];
  (tab.blocks || []).forEach(block => pieces.push(markdownBlock(block, level)));
  return pieces.filter(Boolean).join("\n\n");
}

function markdownGlossary() {
  const terms = typeof sortedTerms === "function" ? sortedTerms() : [...(state.glossary || [])];
  if (!terms.length) return "";
  const lines = terms.map(term => {
    const aliases = Array.isArray(term.aliases) && term.aliases.length ? ` (별칭: ${term.aliases.join(", ")})` : "";
    const category = term.category ? ` - ${term.category}` : "";
    return `- **${markdownRichText(term.keyword || "").trim()}**${aliases}${category}: ${markdownRichText(term.description || "").trim()}`;
  });
  return [markdownHeading("용어 사전", 2), ...lines].join("\n");
}

function buildProjectMarkdown() {
  const title = state.title || state.appTitle || DEFAULT_APP_TITLE;
  const tabItems = typeof tabTreeItems === "function"
    ? tabTreeItems()
    : documentTabs().map(tab => ({ tab, depth: 0 }));
  return [
    markdownHeading(title, 1),
    state.subtitle ? markdownText(state.subtitle) : "",
    ...tabItems.map(({ tab, depth }) => markdownTab(tab, depth)),
    markdownGlossary()
  ].filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

function exportMarkdown() {
  CommandManager.commitDraft({ render: false });
  saveNow();
  const filename = safeExportName(state.title || state.appTitle || "shimroom_gdd", "md");
  downloadBlob(filename, "\ufeff" + buildProjectMarkdown(), "text/markdown;charset=utf-8");
  toast("마크다운 파일을 내려받았습니다.");
}

function exportWorkbook() {
  CommandManager.commitDraft({ render: false });
  if (!window.XLSX) {
    toast("Excel 저장 모듈이 아직 준비되지 않았습니다. 잠시 후 다시 시도하세요.");
    return;
  }
  const workbook = XLSX.utils.book_new();
  Object.entries(state.datasets).forEach(([name, rows]) => {
    const sheet = XLSX.utils.aoa_to_sheet(ensureRows(rows));
    XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31) || "Sheet");
  });
  XLSX.writeFile(workbook, "shimroom_data_sheets_edited.xlsx");
  toast("데이터 시트를 Excel 파일로 저장했습니다.");
}

function exportSelectedCsv() {
  CommandManager.commitDraft({ render: false });
  const sheet = els.datasetSelect?.value;
  if (!sheet || !state.datasets[sheet]) return;
  downloadBlob(`${sheet}.csv`, "\ufeff" + rowsToCsv(ensureRows(state.datasets[sheet])), "text/csv;charset=utf-8");
}

function deleteDatasetSheet() {
  if (!isEditing) return;
  const sheet = els.datasetSelect?.value;
  if (!sheet || !state.datasets[sheet]) {
    toast("삭제할 데이터 시트가 없습니다.");
    return;
  }
  showCustomConfirm({
    message: `'${sheet}' 데이터 시트를 삭제할까요? 이 시트를 쓰는 블록은 남은 시트로 연결됩니다.`,
    onConfirm: () => {
      CommandManager.execute("데이터 시트 삭제", () => {
        delete state.datasets[sheet];
        const fallback = Object.keys(state.datasets)[0] || "";
        state.tabs.forEach(tab => {
          tab.blocks.forEach(block => {
            if (block.type === "dataset" && block.sheet === sheet) block.sheet = fallback;
          });
        });
      });
      toast("데이터 시트를 삭제했습니다.");
    }
  });
}

function exportRowsCsv(rows, filename) {
  downloadBlob(filename, "\ufeff" + rowsToCsv(ensureRows(rows)), "text/csv;charset=utf-8");
}

function readFileArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function fileBaseName(file, fallback = "table") {
  return String(file?.name || fallback).replace(/\.(xlsx|xls|csv|tsv)$/i, "") || fallback;
}

function safeExportName(name, extension) {
  const clean = String(name || "table")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 48) || "table";
  return `${clean}.${extension}`;
}

async function rowsFromSpreadsheetFile(file) {
  const lower = String(file?.name || "").toLowerCase();
  const isWorkbook = lower.endsWith(".xlsx") || lower.endsWith(".xls");
  if (isWorkbook) {
    if (!window.XLSX) {
      throw new Error("XLSX 모듈을 아직 불러오지 못했습니다.");
    }
    const workbook = XLSX.read(await readFileArrayBuffer(file), { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [[""]];
    return ensureRows(XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { header: 1, raw: false, defval: "" }));
  }
  const delimiter = lower.endsWith(".tsv") ? "\t" : ",";
  return ensureRows(parseDelimited(await readFileText(file), delimiter));
}

function openTableFilePicker(block, unitId = "") {
  if (!block || !els.tableFilePicker) return;
  pendingTableImport = { blockId: block.id, unitId };
  els.tableFilePicker.value = "";
  els.tableFilePicker.click();
}

async function importTableFile(file) {
  if (!file || !pendingTableImport) return;
  const pending = pendingTableImport;
  pendingTableImport = null;
  const block = findBlockById(pending.blockId);
  const targetBlock = pending.unitId
    ? block?.items?.find(item => item.id === pending.unitId)
    : block;
  if (!targetBlock) return;
  try {
    const rows = await rowsFromSpreadsheetFile(file);
    CommandManager.execute("엑셀표 가져오기", () => {
      targetBlock.type = "table";
      targetBlock.rows = rows.length ? rows : [[""]];
      targetBlock.filter = "";
      targetBlock.sortColumn = -1;
      targetBlock.sortDir = "asc";
    });
    toast(`${fileBaseName(file)} 데이터를 표에 가져왔습니다.`);
  } catch (err) {
    console.error(err);
    toast("표 가져오기 실패: Excel/CSV/TSV 파일 형식을 확인하세요.");
  }
}

function exportTableWorkbook(block) {
  CommandManager.commitDraft({ render: false });
  const rows = ensureRows(block?.rows || [[""]]);
  const base = safeExportName(`${getCurrentTab()?.title || "table"}_table`, "xlsx");
  if (!window.XLSX) {
    exportRowsCsv(rows, base.replace(/\.xlsx$/i, ".csv"));
    toast("Excel 모듈이 준비되지 않아 CSV로 저장했습니다.");
    return;
  }
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  XLSX.writeFile(workbook, base);
  toast("엑셀표를 Excel 파일로 저장했습니다.");
}

function importProjectFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      let text = String(reader.result || "");
      if (file.name.toLowerCase().endsWith(".html")) {
        text = extractProjectDataFromHtml(text);
      }
      const imported = normalizeState(JSON.parse(text));
      CommandManager.execute("프로젝트 가져오기", () => {
        state = imported;
        currentView = "document";
        currentWikiKeyword = "";
        currentTabId = documentTabs()[0]?.id || "";
      });
      toast("프로젝트를 가져왔습니다.");
    } catch (err) {
      console.error(err);
      toast("가져오기 실패: JSON 또는 HTML 형식을 확인하세요.");
    }
  };
  reader.readAsText(file, "utf-8");
}

function extractProjectDataFromHtml(html) {
  const jsonScript = html.match(/<script id="project-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (jsonScript) return jsonScript[1];
  const dataAssignment = html.match(/window\.SHIMROOM_PROJECT_DATA\s*=\s*([\s\S]*?);\s*(?:<\/script>|$)/);
  if (dataAssignment) return dataAssignment[1];
  throw new Error("project-data not found");
}

function importDataFile(file) {
  const lower = file.name.toLowerCase();
  const isWorkbook = lower.endsWith(".xlsx") || lower.endsWith(".xls");
  if (isWorkbook && window.XLSX) {
    const reader = new FileReader();
    reader.onload = () => {
      const workbook = XLSX.read(reader.result, { type: "array" });
      CommandManager.execute("Excel 시트 가져오기", () => {
        workbook.SheetNames.forEach(name => {
          state.datasets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, defval: "" });
        });
      });
      toast("Excel 시트를 가져왔습니다.");
    };
    reader.readAsArrayBuffer(file);
    return;
  }
  if (isWorkbook) {
    toast("XLSX 읽기 모듈이 아직 준비되지 않았습니다. CSV 또는 TSV로 저장해 가져오세요.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const delimiter = lower.endsWith(".tsv") ? "\t" : ",";
    const rows = parseDelimited(String(reader.result || ""), delimiter);
    showCustomModal({
      title: "시트 이름",
      placeholder: "시트 이름",
      defaultValue: file.name.replace(/\.(csv|tsv)$/i, ""),
      onConfirm: (name) => {
        CommandManager.execute("데이터 가져오기", () => {
          state.datasets[name] = rows;
        });
        toast("데이터를 가져왔습니다.");
        render();
      }
    });
  };
  reader.readAsText(file, "utf-8");
}

function addTableRow(block) {
  block.rows = ensureRows(block.rows);
  block.rows.push(Array(block.rows[0].length).fill(""));
}

function addTableCol(block) {
  block.rows = ensureRows(block.rows);
  block.rows.forEach(row => row.push(""));
}

function addDatasetRow(sheet) {
  if (!sheet || !state.datasets[sheet]) return;
  state.datasets[sheet] = ensureRows(state.datasets[sheet]);
  state.datasets[sheet].push(Array(state.datasets[sheet][0].length).fill(""));
}

function addDatasetCol(sheet) {
  if (!sheet || !state.datasets[sheet]) return;
  state.datasets[sheet] = ensureRows(state.datasets[sheet]);
  state.datasets[sheet].forEach(row => row.push(""));
}

function deleteTableRow(block, rowIndex = null) {
  block.rows = ensureRows(block.rows);
  if (block.rows.length <= 1) {
    toast("마지막 행은 삭제할 수 없습니다.");
    return;
  }
  let targetIdx = rowIndex;
  if (targetIdx === null) {
    if (lastFocusedTableCell.blockId === block.id && lastFocusedTableCell.type === 'table') {
      targetIdx = lastFocusedTableCell.row;
    } else {
      targetIdx = block.rows.length - 1;
    }
  }
  if (targetIdx < 0 || targetIdx >= block.rows.length) return;
  CommandManager.execute("표 행 삭제", () => {
    block.rows.splice(targetIdx, 1);
  });
  toast("행을 삭제했습니다.");
}

function deleteTableCol(block, colIndex = null) {
  block.rows = ensureRows(block.rows);
  if (block.rows[0].length <= 1) {
    toast("마지막 열은 삭제할 수 없습니다.");
    return;
  }
  let targetIdx = colIndex;
  if (targetIdx === null) {
    if (lastFocusedTableCell.blockId === block.id && lastFocusedTableCell.type === 'table') {
      targetIdx = lastFocusedTableCell.col;
    } else {
      targetIdx = block.rows[0].length - 1;
    }
  }
  if (targetIdx < 0 || targetIdx >= block.rows[0].length) return;
  CommandManager.execute("표 열 삭제", () => {
    block.rows.forEach(row => row.splice(targetIdx, 1));
  });
  toast("열을 삭제했습니다.");
}

function deleteDatasetRow(sheet, rowIndex = null) {
  if (!sheet || !state.datasets[sheet]) return;
  state.datasets[sheet] = ensureRows(state.datasets[sheet]);
  if (state.datasets[sheet].length <= 1) {
    toast("마지막 행은 삭제할 수 없습니다.");
    return;
  }
  let targetIdx = rowIndex;
  if (targetIdx === null) {
    if (lastFocusedTableCell.type === 'dataset') {
      targetIdx = lastFocusedTableCell.row;
    } else {
      targetIdx = state.datasets[sheet].length - 1;
    }
  }
  if (targetIdx < 0 || targetIdx >= state.datasets[sheet].length) return;
  CommandManager.execute("데이터 행 삭제", () => {
    state.datasets[sheet].splice(targetIdx, 1);
  });
  toast("행을 삭제했습니다.");
}

function deleteDatasetCol(sheet, colIndex = null) {
  if (!sheet || !state.datasets[sheet]) return;
  state.datasets[sheet] = ensureRows(state.datasets[sheet]);
  if (state.datasets[sheet][0].length <= 1) {
    toast("마지막 열은 삭제할 수 없습니다.");
    return;
  }
  let targetIdx = colIndex;
  if (targetIdx === null) {
    if (lastFocusedTableCell.type === 'dataset') {
      targetIdx = lastFocusedTableCell.col;
    } else {
      targetIdx = state.datasets[sheet][0].length - 1;
    }
  }
  if (targetIdx < 0 || targetIdx >= state.datasets[sheet][0].length) return;
  CommandManager.execute("데이터 열 삭제", () => {
    state.datasets[sheet].forEach(row => row.splice(targetIdx, 1));
  });
  toast("열을 삭제했습니다.");
}
