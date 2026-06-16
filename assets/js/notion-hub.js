const STORAGE_KEY = "shim-notion-archive-state-v2";
const META_KEY = "shim-notion-archive-meta-v2";
const VERSION_KEY = "shim-notion-archive-versions-v1";
const embeddedArchive = window.SHIM_NOTION_ARCHIVE;

let archive = clone(embeddedArchive);
let docsById = new Map();
let collectionsById = new Map();
let categoryById = new Map();
let saveTimer = null;
let activeTextControl = null;
let drawingSession = null;
let slashState = { target: null, blockId: "", unitId: "", query: "", index: 0 };
let collabSource = null;
let presenceTimer = null;
let pendingContentMediaInsert = null;
let pendingTableImageInsert = null;
let pendingInlineMediaInsert = null;
let pendingBlockMediaReplace = null;
let pendingTableImportTarget = "";
let pendingTableImportSource = null;
let activeTableCell = { kind: "", blockId: "", unitId: "", row: -1, col: -1 };
const documentTreePointerDrag = {
  active: false,
  docId: "",
  overDocId: "",
  placement: "before",
  pointerId: null,
  startX: 0,
  startY: 0,
  moved: false
};
const contentUnitPointerDrag = {
  active: false,
  blockId: "",
  unitId: "",
  overUnitId: "",
  placement: "before",
  pointerId: null,
  startX: 0,
  startY: 0,
  moved: false
};
const blockDrag = {
  blockId: "",
  placement: "before"
};
const imageResizeState = {
  active: false,
  blockId: "",
  unitId: "",
  pointerId: null,
  startX: 0,
  startWidth: 0,
  frameWidth: 0,
  width: 100,
  recorded: false,
  target: null,
  frame: null,
  handle: null,
  input: null,
  output: null
};
const tableResizeState = {
  active: false,
  pointerId: null,
  startX: 0,
  startWidth: 0,
  cell: null,
  handle: null
};
const undoStack = [];
const redoStack = [];
const undoLabels = [];
const redoLabels = [];
const MAX_HISTORY = 80;
const CLIENT_KEY = "shim-notion-archive-client-id";

const state = {
  view: "overview",
  category: "all",
  status: "all",
  query: "",
  selectedDocId: "",
  selectedCollectionId: "",
  selectedWikiTerm: "",
  editMode: false,
  dirty: false,
  saveMode: "local",
  revision: 0,
  lastSavedAt: "",
  versions: [],
  renamingDocId: "",
  pendingRemoteRevision: 0,
  authUser: null,
  clientId: readClientId(),
  presence: []
};

const statusLabels = {
  all: "전체",
  active: "활성",
  review: "검토",
  legacy: "보류"
};

const statusOptions = [
  ["active", "활성"],
  ["review", "검토"],
  ["legacy", "보류"]
];

const blockInsertItems = [
  ["generic", "블록 묶음"],
  ["heading", "제목"],
  ["paragraph", "문단"],
  ["callout", "강조"],
  ["quote", "인용"],
  ["list", "목록"],
  ["checklist", "체크리스트"],
  ["code", "코드"],
  ["formula", "수식"],
  ["divider", "구분선"],
  ["table", "표"],
  ["dataset", "데이터"],
  ["flow", "플로우"],
  ["mermaid", "Mermaid"],
  ["drawing", "그림판"],
  ["media", "이미지"],
  ["video", "동영상"],
  ["attachment", "첨부"],
  ["dialogue", "대화"],
  ["calendar", "달력"],
  ["team", "팀원"],
  ["workboard", "업무 관리"],
  ["meetingbook", "회의록"]
];

const CONTENT_INSERT_TYPES = [
  "paragraph",
  "heading",
  "callout",
  "quote",
  "checklist",
  "code",
  "divider",
  "table",
  "dataset",
  "flow",
  "mermaid",
  "drawing",
  "media",
  "video",
  "attachment"
];
const CONTENT_INSERT_HOST_TYPES = new Set(CONTENT_INSERT_TYPES.concat(["list"]));

const els = {
  title: document.getElementById("appTitle"),
  subtitle: document.getElementById("appSubtitle"),
  search: document.getElementById("globalSearch"),
  sidebar: document.getElementById("sidebar"),
  workspace: document.getElementById("workspace"),
  toast: document.getElementById("toast"),
  modeBadge: document.getElementById("modeBadge"),
  saveStatus: document.getElementById("saveStatus"),
  editToggle: document.getElementById("editToggle"),
  undoCommand: document.getElementById("undoCommand"),
  redoCommand: document.getElementById("redoCommand"),
  openTerms: document.getElementById("openTerms"),
  openHistory: document.getElementById("openHistory"),
  saveArchive: document.getElementById("saveArchive"),
  exportArchive: document.getElementById("exportArchive"),
  exportHtml: document.getElementById("exportHtml"),
  exportReportHtml: document.getElementById("exportReportHtml"),
  exportMarkdown: document.getElementById("exportMarkdown"),
  exportWorkbook: document.getElementById("exportWorkbook"),
  importArchive: document.getElementById("importArchive"),
  collabStatus: document.getElementById("collabStatus"),
  floatingToolbar: document.getElementById("floatingToolbar"),
  formatBold: document.getElementById("formatBold"),
  formatItalic: document.getElementById("formatItalic"),
  formatUnderline: document.getElementById("formatUnderline"),
  formatLink: document.getElementById("formatLink"),
  slashPalette: document.getElementById("slashPalette"),
  mediaFilePicker: document.getElementById("mediaFilePicker"),
  tableFilePicker: document.getElementById("tableFilePicker"),
  termPanel: document.getElementById("termPanel"),
  closeTerms: document.getElementById("closeTerms"),
  termSearch: document.getElementById("termSearch"),
  termKeyword: document.getElementById("termKeyword"),
  termAliases: document.getElementById("termAliases"),
  termDescription: document.getElementById("termDescription"),
  saveTerm: document.getElementById("saveTerm"),
  termResults: document.getElementById("termResults"),
  versionPanel: document.getElementById("versionPanel"),
  closeHistory: document.getElementById("closeHistory"),
  saveVersion: document.getElementById("saveVersion"),
  refreshVersionDiff: document.getElementById("refreshVersionDiff"),
  versionBaseSelect: document.getElementById("versionBaseSelect"),
  versionTargetSelect: document.getElementById("versionTargetSelect"),
  versionSummary: document.getElementById("versionSummary"),
  versionDiff: document.getElementById("versionDiff"),
  versionList: document.getElementById("versionList"),
  authUser: document.getElementById("authUser"),
  logoutButton: document.getElementById("logoutButton")
};

const DEFAULT_MEDIA_ACCEPT = els.mediaFilePicker?.getAttribute("accept") || "";

init();

async function init() {
  hydrateLocal();
  hydrateVersions();
  rebuildIndexes();
  state.selectedDocId = archive.priorityDocs[0]?.id || archive.documents[0]?.id || "";
  state.selectedCollectionId = archive.collections[0]?.id || "";
  readHash();
  els.search.value = state.query;
  bindEvents();
  await hydrateAuth();
  await hydrateServer();
  connectPresence();
  render();
}

function bindEvents() {
  document.addEventListener("click", event => {
    const target = event.target.closest("[data-view], [data-category], [data-status], [data-doc], [data-collection], [data-action], [data-move-block], [data-duplicate-block], [data-delete-block], [data-glossary-doc], [data-wiki-term], [data-outline-target], [data-slash-type], [data-block-inline-format], [data-unit-inline-format], [data-inline-media-insert], [data-block-style-clear], [data-check-add], [data-content-insert-type], [data-content-action]");
    if (!target) return;

    const renameRow = state.editMode && event.detail >= 2 ? target.closest("[data-doc-tree-row]") : null;
    if (renameRow && target.dataset.doc) {
      beginDocumentTreeRename(renameRow.dataset.docTreeRow || target.dataset.doc);
      return;
    }

    if (target.dataset.slashType) {
      applySlashCommand(target.dataset.slashType);
      return;
    }

    if (target.dataset.blockInlineFormat) {
      applyBlockInlineFormat(target.dataset.blockId, target.dataset.blockInlineFormat);
      return;
    }

    if (target.dataset.unitInlineFormat) {
      applyUnitInlineFormat(target.dataset.blockId, target.dataset.unitId, target.dataset.unitInlineFormat);
      return;
    }

    if (target.dataset.inlineMediaInsert) {
      pendingInlineMediaInsert = inlineMediaTargetFromControl(target);
      pendingContentMediaInsert = null;
      pendingTableImageInsert = null;
      pendingBlockMediaReplace = null;
      openMediaPicker("auto");
      return;
    }

    if (target.dataset.blockStyleClear) {
      clearBlockTextStyle(target.dataset.blockStyleClear);
      return;
    }

    if (target.dataset.checkAdd) {
      addChecklistItem(target.dataset.checkAdd);
      return;
    }

    if (target.dataset.contentInsertType) {
      if (["media", "video", "attachment"].includes(target.dataset.contentInsertType)) {
        pendingInlineMediaInsert = null;
        pendingContentMediaInsert = {
          blockId: target.dataset.contentBlockId,
          index: Number(target.dataset.contentInsertIndex || 0),
          preferredType: target.dataset.contentInsertType
        };
        pendingBlockMediaReplace = null;
        openMediaPicker(target.dataset.contentInsertType);
        return;
      }
      insertContentUnit(target.dataset.contentBlockId, target.dataset.contentInsertType, Number(target.dataset.contentInsertIndex || 0));
      return;
    }

    if (target.dataset.contentAction) {
      handleContentUnitAction(target);
      return;
    }

    if (target.dataset.glossaryDoc) {
      selectGlossaryTerm(target);
      return;
    }

    if (target.dataset.wikiTerm) {
      state.selectedWikiTerm = canonicalWikiTerm(target.dataset.wikiTerm);
      state.view = "wiki";
      writeHash();
      render();
      focusWorkspace();
      return;
    }

    if (target.dataset.outlineTarget) {
      jumpToOutlineTarget(target.dataset.outlineTarget);
      return;
    }

    if (target.dataset.view) {
      state.view = target.dataset.view;
      writeHash();
      render();
      focusWorkspace();
      return;
    }

    if (target.dataset.category) {
      state.category = target.dataset.category;
      if (state.view === "overview") state.view = "documents";
      writeHash();
      render();
      focusWorkspace();
      return;
    }

    if (target.dataset.status) {
      state.status = target.dataset.status;
      if (state.view === "overview") state.view = "documents";
      writeHash();
      render();
      focusWorkspace();
      return;
    }

    if (target.dataset.doc) {
      state.selectedDocId = target.dataset.doc;
      state.view = "documents";
      writeHash();
      render();
      focusWorkspace();
      return;
    }

    if (target.dataset.collection) {
      state.selectedCollectionId = target.dataset.collection;
      state.view = "collections";
      writeHash();
      render();
      focusWorkspace();
      return;
    }

    if (target.dataset.moveBlock) {
      moveBlock(target.dataset.moveBlock, Number(target.dataset.direction || 0));
      return;
    }

    if (target.dataset.duplicateBlock) {
      duplicateBlock(target.dataset.duplicateBlock);
      return;
    }

    if (target.dataset.deleteBlock) {
      deleteBlock(target.dataset.deleteBlock);
      return;
    }

    if (target.dataset.action) {
      handleAction(target.dataset.action, target);
    }
  });

  document.addEventListener("dblclick", event => {
    if (!state.editMode) return;
    const row = event.target.closest("[data-doc-tree-row]");
    if (!row || event.target.closest("[data-drag-doc], .doc-tree-controls, [data-doc-tree-rename]")) return;
    beginDocumentTreeRename(row.dataset.docTreeRow || "");
  });

  document.addEventListener("dragstart", event => {
    const docHandle = event.target.closest("[data-drag-doc]");
    if (docHandle && state.editMode) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `doc:${docHandle.dataset.dragDoc}`);
      return;
    }

    const unitHandle = event.target.closest("[data-drag-unit]");
    if (unitHandle && state.editMode) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `unit:${unitHandle.dataset.contentBlockId}:${unitHandle.dataset.dragUnit}`);
      return;
    }

    const handle = event.target.closest("[data-drag-block]");
    if (!handle || !state.editMode) return;
    event.dataTransfer.effectAllowed = "move";
    blockDrag.blockId = handle.dataset.dragBlock || "";
    event.dataTransfer.setData("text/plain", blockDrag.blockId);
    handle.closest("[data-edit-block-id]")?.classList.add("block-dragging");
  });

  document.addEventListener("dragover", event => {
    if (state.editMode && hasFileTransfer(event.dataTransfer)) {
      event.preventDefault();
      document.body.classList.add("file-drop-active");
      return;
    }

    const docRow = event.target.closest("[data-doc-tree-row]");
    if (docRow && state.editMode) {
      event.preventDefault();
      clearDocumentTreeDragUi();
      const placement = rowDropPlacement(event, docRow);
      documentTreePointerDrag.placement = placement;
      docRow.classList.add("doc-drag-over", placement === "after" ? "doc-drag-after" : "doc-drag-before");
      return;
    }

    const unit = event.target.closest("[data-content-unit-id]");
    if (unit && state.editMode) {
      event.preventDefault();
      clearContentUnitDragUi();
      const placement = rowDropPlacement(event, unit);
      contentUnitPointerDrag.placement = placement;
      unit.classList.add("unit-drag-over", placement === "after" ? "unit-drag-after" : "unit-drag-before");
      return;
    }

    const block = event.target.closest("[data-edit-block-id]");
    if (!block || !state.editMode) return;
    event.preventDefault();
    clearBlockDragUi();
    const placement = blockDropPlacement(event, block);
    blockDrag.placement = placement;
    block.classList.add("drag-over", placement === "after" ? "drop-after" : "drop-before");
  });

  document.addEventListener("dragleave", event => {
    if (!event.relatedTarget || !document.body.contains(event.relatedTarget)) {
      document.body.classList.remove("file-drop-active");
    }
    const docRow = event.target.closest("[data-doc-tree-row]");
    if (docRow && !docRow.contains(event.relatedTarget)) {
      docRow.classList.remove("doc-drag-over", "doc-drag-before", "doc-drag-after");
    }
    const unitRow = event.target.closest("[data-content-unit-id]");
    if (unitRow && !unitRow.contains(event.relatedTarget)) {
      unitRow.classList.remove("unit-drag-over", "unit-drag-before", "unit-drag-after");
    }
    const block = event.target.closest("[data-edit-block-id]");
    if (block && !block.contains(event.relatedTarget)) {
      block.classList.remove("drag-over", "drop-before", "drop-after");
    }
  });

  document.addEventListener("drop", async event => {
    document.body.classList.remove("file-drop-active");
    if (state.editMode && hasFileTransfer(event.dataTransfer)) {
      event.preventDefault();
      await handleDroppedFiles(event);
      return;
    }

    const transfer = event.dataTransfer.getData("text/plain");
    const docRow = event.target.closest("[data-doc-tree-row]");
    if (docRow && state.editMode && transfer.startsWith("doc:")) {
      event.preventDefault();
      const placement = docRow.classList.contains("doc-drag-after") ? "after" : "before";
      clearDocumentTreeDragUi();
      clearDocumentTreePointerDrag();
      moveDocumentToTarget(transfer.slice(4), docRow.dataset.docTreeRow, placement);
      return;
    }

    const unit = event.target.closest("[data-content-unit-id]");
    if (unit && state.editMode && transfer.startsWith("unit:")) {
      event.preventDefault();
      const placement = unit.classList.contains("unit-drag-after") ? "after" : "before";
      clearContentUnitDragUi();
      clearContentUnitPointerDrag();
      const [, blockId, unitId] = transfer.split(":");
      moveContentUnitToTarget(blockId, unitId, unit.dataset.contentUnitId, placement);
      return;
    }

    const block = event.target.closest("[data-edit-block-id]");
    if (!block || !state.editMode) return;
    event.preventDefault();
    const placement = block.classList.contains("drop-after") ? "after" : "before";
    clearBlockDragUi();
    const fromId = transfer;
    if (fromId) moveBlockToTarget(fromId, block.dataset.editBlockId, placement);
  });

  document.addEventListener("dragend", () => {
    clearBlockDragUi();
    blockDrag.blockId = "";
    blockDrag.placement = "before";
  });

  document.addEventListener("pointerdown", event => {
    const docHandle = event.target.closest("[data-drag-doc]");
    if (docHandle && state.editMode && event.button === 0) {
      if (event.target.closest("button, input, textarea, select, label, [contenteditable='true']")) return;
      documentTreePointerDrag.active = true;
      documentTreePointerDrag.docId = docHandle.dataset.dragDoc || "";
      documentTreePointerDrag.overDocId = "";
      documentTreePointerDrag.pointerId = event.pointerId;
      documentTreePointerDrag.startX = event.clientX;
      documentTreePointerDrag.startY = event.clientY;
      documentTreePointerDrag.moved = false;
      docHandle.closest("[data-doc-tree-row]")?.classList.add("doc-row-dragging");
      docHandle.setPointerCapture?.(event.pointerId);
      return;
    }

    if (beginImageResize(event)) return;
    if (beginTableResize(event)) return;

    const handle = event.target.closest("[data-drag-unit]");
    if (!handle || !state.editMode || event.button !== 0) return;
    if (event.target.closest("button, input, textarea, select, label, [contenteditable='true']")) return;
    contentUnitPointerDrag.active = true;
    contentUnitPointerDrag.blockId = handle.dataset.contentBlockId || "";
    contentUnitPointerDrag.unitId = handle.dataset.dragUnit || "";
    contentUnitPointerDrag.overUnitId = "";
    contentUnitPointerDrag.pointerId = event.pointerId;
    contentUnitPointerDrag.startX = event.clientX;
    contentUnitPointerDrag.startY = event.clientY;
    contentUnitPointerDrag.moved = false;
    handle.closest("[data-content-unit-id]")?.classList.add("unit-dragging");
    handle.setPointerCapture?.(event.pointerId);
  });

  document.addEventListener("pointermove", event => {
    if (imageResizeState.active && event.pointerId === imageResizeState.pointerId) {
      applyImageResize(event);
      return;
    }
    if (tableResizeState.active && event.pointerId === tableResizeState.pointerId) {
      applyTableResize(event);
      return;
    }

    if (documentTreePointerDrag.active && event.pointerId === documentTreePointerDrag.pointerId) {
      const distance = Math.hypot(event.clientX - documentTreePointerDrag.startX, event.clientY - documentTreePointerDrag.startY);
      if (distance < 5 && !documentTreePointerDrag.moved) return;
      documentTreePointerDrag.moved = true;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("[data-doc-tree-row]");
      document.querySelectorAll(".doc-drag-over, .doc-drag-before, .doc-drag-after").forEach(item => {
        item.classList.remove("doc-drag-over", "doc-drag-before", "doc-drag-after");
      });
      if (!target || target.dataset.docTreeRow === documentTreePointerDrag.docId) {
        documentTreePointerDrag.overDocId = "";
        documentTreePointerDrag.placement = "before";
        return;
      }
      documentTreePointerDrag.overDocId = target.dataset.docTreeRow || "";
      documentTreePointerDrag.placement = rowDropPlacement(event, target);
      target.classList.add("doc-drag-over", documentTreePointerDrag.placement === "after" ? "doc-drag-after" : "doc-drag-before");
      return;
    }

    if (!contentUnitPointerDrag.active || event.pointerId !== contentUnitPointerDrag.pointerId) return;
    const distance = Math.hypot(event.clientX - contentUnitPointerDrag.startX, event.clientY - contentUnitPointerDrag.startY);
    if (distance < 5 && !contentUnitPointerDrag.moved) return;
    contentUnitPointerDrag.moved = true;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("[data-content-unit-id]");
    document.querySelectorAll(".unit-drag-over, .unit-drag-before, .unit-drag-after").forEach(item => {
      item.classList.remove("unit-drag-over", "unit-drag-before", "unit-drag-after");
    });
    if (!target || target.dataset.contentUnitId === contentUnitPointerDrag.unitId) {
      contentUnitPointerDrag.overUnitId = "";
      contentUnitPointerDrag.placement = "before";
      return;
    }
    const stack = target.closest(".content-stack");
    const belongsToBlock = stack?.querySelector(`[data-drag-unit="${CSS.escape(contentUnitPointerDrag.unitId)}"][data-content-block-id="${CSS.escape(contentUnitPointerDrag.blockId)}"]`);
    if (!belongsToBlock) {
      contentUnitPointerDrag.overUnitId = "";
      contentUnitPointerDrag.placement = "before";
      return;
    }
    contentUnitPointerDrag.overUnitId = target.dataset.contentUnitId || "";
    contentUnitPointerDrag.placement = rowDropPlacement(event, target);
    target.classList.add("unit-drag-over", contentUnitPointerDrag.placement === "after" ? "unit-drag-after" : "unit-drag-before");
  });

  document.addEventListener("pointerup", event => {
    if (imageResizeState.active && event.pointerId === imageResizeState.pointerId) {
      finishImageResize();
      return;
    }
    if (tableResizeState.active && event.pointerId === tableResizeState.pointerId) {
      finishTableResize();
      return;
    }

    if (documentTreePointerDrag.active && event.pointerId === documentTreePointerDrag.pointerId) {
      const { docId, overDocId, placement, moved } = documentTreePointerDrag;
      clearDocumentTreeDragUi();
      clearDocumentTreePointerDrag();
      if (moved && overDocId) moveDocumentToTarget(docId, overDocId, placement);
      return;
    }

    if (!contentUnitPointerDrag.active || event.pointerId !== contentUnitPointerDrag.pointerId) return;
    const { blockId, unitId, overUnitId, placement, moved } = contentUnitPointerDrag;
    clearContentUnitDragUi();
    clearContentUnitPointerDrag();
    if (moved && overUnitId) moveContentUnitToTarget(blockId, unitId, overUnitId, placement);
  });

  document.addEventListener("pointercancel", event => {
    if (imageResizeState.active && event.pointerId === imageResizeState.pointerId) finishImageResize();
    if (tableResizeState.active && event.pointerId === tableResizeState.pointerId) finishTableResize();
  });

  document.addEventListener("input", event => {
    const target = event.target;
    if (target.dataset.docTreeRename) return;
    if (target.dataset.archiveField) {
      updateArchiveField(target.dataset.archiveField, target.value);
      return;
    }
    if (target.dataset.editDocField) {
      updateDocField(target.dataset.editDocField, target.value);
      return;
    }
    if (target.dataset.blockField) {
      updateBlockField(target.dataset.blockId, target.dataset.blockField, target.value);
      if (target.dataset.diagramEditor) syncDiagramEditorPreview(target);
      syncEditorControlPreview(target);
      handleSlashInput(target);
      return;
    }
    if (target.dataset.blockStyleField) {
      updateBlockField(target.dataset.blockId, target.dataset.blockStyleField, target.value);
      return;
    }
    if (target.dataset.unitField) {
      updateContentUnitField(target.dataset.blockId, target.dataset.unitId, target.dataset.unitField, target.value);
      if (target.dataset.diagramEditor) syncDiagramEditorPreview(target);
      syncEditorControlPreview(target);
      handleSlashInput(target);
      return;
    }
    if (target.dataset.editCollectionField) {
      updateCollectionField(target.dataset.editCollectionField, target.value);
      return;
    }
    if (target.dataset.wikiField) {
      updateWikiField(target.dataset.wikiField, target.value);
      return;
    }
    if (target.dataset.tableFilter) {
      updateTableViewFilter(target, target.value, { renderAfter: false });
      return;
    }
    if (target.dataset.tableCell) {
      updateTableCell(target.dataset.blockId, Number(target.dataset.row), Number(target.dataset.col), target.textContent);
      return;
    }
    if (target.dataset.unitTableCell) {
      updateContentUnitTableCell(target.dataset.blockId, target.dataset.unitId, Number(target.dataset.row), Number(target.dataset.col), target.textContent);
      return;
    }
    if (target.dataset.collectionCell) {
      updateCollectionCell(Number(target.dataset.row), Number(target.dataset.col), target.textContent);
    }
    if (target.dataset.checkText) {
      updateChecklistItemText(target.dataset.blockId, Number(target.dataset.checkText), target.value);
    }
  });

  document.addEventListener("paste", async event => {
    if (!state.editMode) return;
    const files = clipboardImageFiles(event);
    if (!files.length) return;
    event.preventDefault();
    await handlePastedImages(event, files);
  });

  document.addEventListener("change", event => {
    const target = event.target;
    if (target.dataset.docTreeRename) {
      commitDocumentTreeRename(target);
      return;
    }
    if (target.dataset.archiveField) {
      updateArchiveField(target.dataset.archiveField, target.value);
      if (changeRequiresRender(target) || target.dataset.archiveField === "mediaBasePath") render();
      return;
    }
    if (target.dataset.editDocField) {
      updateDocField(target.dataset.editDocField, target.value);
      if (changeRequiresRender(target)) render();
      return;
    }
    if (target.dataset.blockField) {
      updateBlockField(target.dataset.blockId, target.dataset.blockField, target.value);
      hideSlashPalette();
      if (changeRequiresRender(target)) render();
      return;
    }
    if (target.dataset.blockStyleField) {
      updateBlockField(target.dataset.blockId, target.dataset.blockStyleField, target.value);
      render();
      return;
    }
    if (target.dataset.unitField) {
      updateContentUnitField(target.dataset.blockId, target.dataset.unitId, target.dataset.unitField, target.value);
      if (changeRequiresRender(target)) render();
      return;
    }
    if (target.dataset.editCollectionField) {
      updateCollectionField(target.dataset.editCollectionField, target.value);
      if (changeRequiresRender(target)) render();
      return;
    }
    if (target.dataset.wikiField) {
      updateWikiField(target.dataset.wikiField, target.value);
      if (changeRequiresRender(target)) render();
      return;
    }
    if (target.dataset.dialogueStage) {
      setDialogueStageBlock(target.dataset.blockId, target.value);
      return;
    }
    if (target.dataset.tableFilter) {
      updateTableViewFilter(target, target.value, { renderAfter: true });
      return;
    }
    if (target.dataset.docSelect) {
      state.selectedDocId = target.value;
      writeHash();
      render();
      return;
    }
    if (target.dataset.collectionSelect) {
      state.selectedCollectionId = target.value;
      writeHash();
      render();
      return;
    }
    if (target === els.importArchive) importArchiveFile(target.files?.[0]);
    if (target === els.mediaFilePicker) importMediaFile(target.files?.[0]);
    if (target === els.tableFilePicker) importTableFile(target.files?.[0]);
    if (target.dataset.checkItem) toggleChecklistItem(target.dataset.blockId, Number(target.dataset.checkItem), target.checked);
  });

  document.addEventListener("focusin", event => {
    if (event.target.matches("textarea, input[type='text'], input:not([type]), [contenteditable='true']")) {
      activeTextControl = event.target;
    }
    setActiveTableCellFromElement(event.target);
  });

  document.addEventListener("focusout", event => {
    const input = event.target.closest("[data-doc-tree-rename]");
    if (input) commitDocumentTreeRename(input);
  });

  document.addEventListener("selectionchange", () => {
    const active = document.activeElement;
    if (active?.matches?.("textarea, input[type='text'], input:not([type])")) {
      activeTextControl = active;
    }
    updateFloatingToolbar();
  });

  document.addEventListener("keyup", event => {
    if (isTextFormatControl(event.target)) updateFloatingToolbar();
  });

  document.addEventListener("pointerup", event => {
    if (isTextFormatControl(event.target)) updateFloatingToolbar();
  });

  document.addEventListener("focusout", event => {
    if (!isTextFormatControl(event.target)) return;
    setTimeout(() => {
      if (!document.activeElement?.closest?.("#floatingToolbar")) updateFloatingToolbar();
    }, 0);
  });

  els.search.addEventListener("input", event => {
    state.query = event.target.value.trim();
    writeHash(false);
    render();
  });

  els.editToggle.addEventListener("click", () => {
    state.editMode = !state.editMode;
    if (!state.editMode) state.renamingDocId = "";
    sendPresence();
    render();
  });

  els.undoCommand.addEventListener("click", undoArchive);
  els.redoCommand.addEventListener("click", redoArchive);
  els.openTerms.addEventListener("click", openTermPanel);
  els.openHistory.addEventListener("click", openVersionPanel);
  els.closeTerms.addEventListener("click", () => els.termPanel.classList.add("hidden"));
  els.closeHistory.addEventListener("click", () => els.versionPanel.classList.add("hidden"));
  els.termSearch.addEventListener("input", () => renderTermResults());
  els.saveTerm.addEventListener("click", saveGlossaryTerm);
  els.saveVersion.addEventListener("click", saveCurrentVersion);
  els.refreshVersionDiff.addEventListener("click", renderVersionPanel);
  els.versionBaseSelect.addEventListener("change", renderVersionDiff);
  els.versionTargetSelect.addEventListener("change", renderVersionDiff);
  els.floatingToolbar.addEventListener("mousedown", event => event.preventDefault());
  els.slashPalette.addEventListener("mousedown", event => event.preventDefault());
  document.addEventListener("mousedown", event => {
    if (event.target.closest(".text-style-tools button")) event.preventDefault();
  });
  els.floatingToolbar.addEventListener("click", event => {
    const button = event.target.closest("[data-floating-format]");
    if (!button) return;
    applyFormat(button.dataset.floatingFormat);
  });
  els.saveArchive.addEventListener("click", saveArchiveFile);
  els.exportArchive.addEventListener("click", exportArchiveState);
  els.exportHtml.addEventListener("click", exportArchiveHtml);
  els.exportReportHtml?.addEventListener("click", exportArchiveReportHtml);
  els.exportMarkdown.addEventListener("click", exportArchiveMarkdown);
  els.exportWorkbook.addEventListener("click", exportArchiveWorkbook);
  els.logoutButton.addEventListener("click", logoutArchiveUser);

  window.addEventListener("pointermove", drawOnCanvas);
  window.addEventListener("pointerup", endDrawing);

  document.addEventListener("keydown", event => {
    if (handleDocumentTreeRenameKey(event)) return;
    if (handlePlanningFormShortcut(event)) return;
    if (handleSlashKey(event)) return;
    if (handleBlockEditorKey(event)) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "s") {
      event.preventDefault();
      saveArchiveFile();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === "z" && !event.shiftKey) {
      event.preventDefault();
      undoArchive();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (key === "y" || (key === "z" && event.shiftKey))) {
      event.preventDefault();
      redoArchive();
    }
  });

  window.addEventListener("hashchange", () => {
    readHash();
    els.search.value = state.query;
    render();
  });
  window.addEventListener("beforeunload", () => {
    if (presenceTimer) window.clearInterval(presenceTimer);
    collabSource?.close?.();
    const payload = JSON.stringify({
      clientId: state.clientId,
      clientName: state.authUser?.displayName || state.authUser?.username || "Archive user",
      tabTitle: archive.title || "Archive",
      editing: false
    });
    navigator.sendBeacon?.("/api/collab/presence", new Blob([payload], { type: "application/json" }));
  });

  window.addEventListener("archive-mermaid-ready", renderMermaidBlocks);
  document.addEventListener("pointerdown", event => {
    if (!event.target.closest?.("#slashPalette, [data-block-field], [data-unit-field]")) hideSlashPalette();
    if (!event.target.closest?.("#floatingToolbar") && !isTextFormatControl(event.target)) hideFloatingToolbar();
  });
}

function changeRequiresRender(target) {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  const type = String(target.type || "").toLowerCase();
  return tag === "select" || ["color", "range", "checkbox", "file"].includes(type);
}

function focusedBlockId() {
  const active = document.activeElement;
  const control = active?.dataset?.blockId ? active : activeTextControl;
  return control?.dataset?.blockId || control?.closest?.("[data-edit-block-id]")?.dataset.editBlockId || "";
}

function blockTextKeyTarget(target) {
  if (!state.editMode || !target?.matches?.("textarea, input[type='text'], input:not([type])")) return null;
  if (!target.closest?.("[data-edit-block-id]")) return null;
  const blockId = target.dataset.blockId || "";
  if (!blockId) return null;
  if (target.dataset.unitField) {
    const unitId = target.dataset.unitId || "";
    const field = target.dataset.unitField || "";
    const unit = contentUnit(blockId, unitId);
    const expectedField = textKeyFieldForType(unit?.type || "");
    if (!unit || !unitId || !field || field !== expectedField) return null;
    return { kind: "unit", unit, blockId, unitId, field, control: target };
  }
  const field = target.dataset.blockField || "";
  const block = currentDoc()?.blocks?.find(item => item.id === blockId);
  const expectedField = textKeyFieldForType(block?.type || "");
  if (field !== expectedField) return null;
  return { kind: "block", block, blockId, field, control: target };
}

function textKeyFieldForType(type = "") {
  if (["heading", "paragraph", "list"].includes(type)) return "text";
  if (["callout", "quote", "checklist"].includes(type)) return "content";
  return "";
}

function handleBlockEditorKey(event) {
  if (event.isComposing) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  const target = blockTextKeyTarget(event.target);
  if (!target) return false;
  if (event.key === "Enter" && !event.shiftKey) {
    if (!splitTextKeyTarget(target)) return false;
    event.preventDefault();
    return true;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    insertTextAtCursor(target.control, "  ");
    return true;
  }
  if (event.key === "ArrowUp" && textCursorAtStart(target.control)) {
    event.preventDefault();
    if (target.kind === "unit") focusAdjacentContentUnitEditor(target.blockId, target.unitId, -1, "end");
    else focusAdjacentBlockEditor(target.blockId, -1, "end");
    return true;
  }
  if (event.key === "ArrowDown" && textCursorAtEnd(target.control)) {
    event.preventDefault();
    if (target.kind === "unit") focusAdjacentContentUnitEditor(target.blockId, target.unitId, 1, "start");
    else focusAdjacentBlockEditor(target.blockId, 1, "start");
    return true;
  }
  if (event.key === "Backspace" && textCursorAtStart(target.control) && !String(target.control.value || "").trim()) {
    event.preventDefault();
    if (target.kind === "unit") deleteEmptyFocusedContentUnit(target.blockId, target.unitId);
    else deleteEmptyFocusedBlock(target.blockId);
    return true;
  }
  return false;
}

function splitTextKeyTarget(target) {
  const doc = currentDoc();
  const control = target?.control;
  if (!doc || !control || typeof control.value !== "string") return false;
  const value = String(control.value || "");
  const start = Number.isFinite(control.selectionStart) ? control.selectionStart : value.length;
  const end = Number.isFinite(control.selectionEnd) ? control.selectionEnd : start;
  const before = value.slice(0, start);
  const after = value.slice(end);
  if (target.kind === "unit") {
    const block = contentBlock(target.blockId);
    const index = block?.items?.findIndex(item => item.id === target.unitId) ?? -1;
    if (!block || index < 0) return false;
    recordUndo();
    target.unit[target.field] = before;
    const unit = createContentUnit(nextTextContinuationType(target.unit.type));
    setTextTargetValue(unit, after);
    block.items.splice(index + 1, 0, unit);
    refreshDerivedDoc(doc);
    markDirty();
    refreshDocumentSidebar();
    hideSlashPalette();
    render();
    focusContentUnitEditor(target.blockId, unit.id, "start");
    return true;
  }
  const index = doc.blocks?.findIndex(block => block.id === target.blockId) ?? -1;
  if (!target.block || index < 0) return false;
  recordUndo();
  target.block[target.field] = before;
  const block = createBlock(nextTextContinuationType(target.block.type));
  setTextTargetValue(block, after);
  doc.blocks.splice(index + 1, 0, block);
  refreshDerivedDoc(doc);
  markDirty();
  refreshDocumentSidebar();
  hideSlashPalette();
  render();
  focusBlockEditor(block.id, "start");
  return true;
}

function nextTextContinuationType(type = "") {
  if (type === "list") return "list";
  return "paragraph";
}

function setTextTargetValue(target, value = "") {
  if (!target) return;
  if (["heading", "paragraph", "list"].includes(target.type)) {
    target.text = value;
    return;
  }
  if (["callout", "quote", "checklist"].includes(target.type)) {
    target.content = value;
    return;
  }
  target.text = value;
}

function textCursorAtStart(control) {
  return Number(control.selectionStart || 0) === 0 && Number(control.selectionEnd || 0) === 0;
}

function textCursorAtEnd(control) {
  const length = String(control.value || "").length;
  return Number(control.selectionStart || 0) === length && Number(control.selectionEnd || 0) === length;
}

function insertTextAtCursor(control, text) {
  const value = String(control.value || "");
  const start = Number.isFinite(control.selectionStart) ? control.selectionStart : value.length;
  const end = Number.isFinite(control.selectionEnd) ? control.selectionEnd : start;
  const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
  control.value = next;
  control.setSelectionRange(start + text.length, start + text.length);
  if (control.dataset.unitField) updateContentUnitField(control.dataset.blockId, control.dataset.unitId, control.dataset.unitField, next);
  else updateBlockField(control.dataset.blockId, control.dataset.blockField, next);
  syncEditorControlPreview(control);
}

function focusBlockEditor(blockId, position = "end") {
  requestAnimationFrame(() => {
    const control = blockEditorControl(blockId);
    if (!control) return;
    control.focus();
    if (typeof control.setSelectionRange === "function") {
      const offset = position === "start" ? 0 : String(control.value || "").length;
      control.setSelectionRange(offset, offset);
    }
    activeTextControl = control;
    control.closest("[data-edit-block-id]")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

function blockEditorControl(blockId) {
  const scope = document.querySelector(`[data-edit-block-id="${CSS.escape(blockId)}"]`);
  if (!scope) return null;
  const blockSelector = `[data-block-id="${CSS.escape(blockId)}"]`;
  const selectors = [
    `${blockSelector}[data-block-field="text"]`,
    `${blockSelector}[data-block-field="content"]`,
    `textarea${blockSelector}[data-block-field]`,
    `input${blockSelector}[data-block-field]:not([type="color"]):not([type="range"])`,
    `${blockSelector}[data-block-field]`
  ];
  for (const selector of selectors) {
    const control = scope.querySelector(selector);
    if (control) return control;
  }
  return null;
}

function focusContentUnitEditor(blockId, unitId, position = "end") {
  requestAnimationFrame(() => {
    const control = contentUnitEditorControl(blockId, unitId);
    if (!control) return;
    control.focus();
    if (typeof control.setSelectionRange === "function") {
      const offset = position === "start" ? 0 : String(control.value || "").length;
      control.setSelectionRange(offset, offset);
    }
    activeTextControl = control;
    control.closest("[data-content-unit-id]")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

function contentUnitEditorControl(blockId, unitId) {
  const scope = document.querySelector(`[data-content-unit-id="${CSS.escape(unitId)}"]`);
  if (!scope) return null;
  const unitSelector = `[data-block-id="${CSS.escape(blockId)}"][data-unit-id="${CSS.escape(unitId)}"]`;
  const selectors = [
    `${unitSelector}[data-unit-field="text"]`,
    `${unitSelector}[data-unit-field="content"]`,
    `textarea${unitSelector}[data-unit-field]`,
    `input${unitSelector}[data-unit-field]:not([type="color"]):not([type="range"])`,
    `${unitSelector}[data-unit-field]`
  ];
  for (const selector of selectors) {
    const control = scope.querySelector(selector);
    if (control) return control;
  }
  return null;
}

function focusAdjacentBlockEditor(blockId, direction, position = "end") {
  const doc = currentDoc();
  if (!doc || !direction) return false;
  const index = doc.blocks.findIndex(block => block.id === blockId);
  const next = doc.blocks[index + Math.sign(direction)];
  if (!next) return false;
  focusBlockEditor(next.id, position);
  return true;
}

function focusAdjacentContentUnitEditor(blockId, unitId, direction, position = "end") {
  const block = contentBlock(blockId);
  if (!block || !direction) return false;
  const index = block.items.findIndex(unit => unit.id === unitId);
  const next = block.items[index + Math.sign(direction)];
  if (next) {
    focusContentUnitEditor(blockId, next.id, position);
    return true;
  }
  return focusAdjacentBlockEditor(blockId, direction, position);
}

function deleteEmptyFocusedBlock(blockId) {
  const doc = currentDoc();
  if (!doc || (doc.blocks || []).length <= 1) return false;
  const index = doc.blocks.findIndex(block => block.id === blockId);
  if (index < 0) return false;
  const focusTarget = doc.blocks[index - 1] || doc.blocks[index + 1] || null;
  recordUndo();
  doc.blocks.splice(index, 1);
  refreshDerivedDoc(doc);
  markDirty();
  render();
  if (focusTarget) focusBlockEditor(focusTarget.id, "end");
  return true;
}

function deleteEmptyFocusedContentUnit(blockId, unitId) {
  const doc = currentDoc();
  const block = contentBlock(blockId);
  if (!doc || !block || (block.items || []).length <= 1) return false;
  const index = block.items.findIndex(unit => unit.id === unitId);
  if (index < 0) return false;
  const focusTarget = block.items[index - 1] || block.items[index + 1] || null;
  recordUndo();
  block.items.splice(index, 1);
  refreshDerivedDoc(doc);
  markDirty();
  render();
  if (focusTarget) focusContentUnitEditor(blockId, focusTarget.id, "end");
  return true;
}

function handlePlanningFormShortcut(event) {
  const form = event.target.closest?.("[data-planning-form]");
  if (!form) return false;
  const createButton = form.querySelector('[data-action="create-planning-record"]');
  if (!createButton) return false;
  const isCreateCombo = (event.ctrlKey || event.metaKey) && event.key === "Enter";
  const isTitleEnter = event.key === "Enter"
    && !event.shiftKey
    && event.target.matches?.('input[name="title"], input[name="name"], input[name="speaker"]');
  if (!isCreateCombo && !isTitleEnter) return false;
  event.preventDefault();
  createPlanningRecord(createButton.dataset.blockId, createButton.dataset.planType, form);
  return true;
}

function normalizeImageWidth(value = 100) {
  const width = Number(value || 100);
  if (!Number.isFinite(width)) return 100;
  return Math.max(20, Math.min(100, Math.round(width / 5) * 5));
}

function mediaForTarget(target = {}) {
  if (!target?.mediaId) return null;
  return archive.mediaById?.[target.mediaId] || archive.media?.find?.(item => item.id === target.mediaId) || null;
}

function safeMediaPath(value = "") {
  const source = String(value || "").trim();
  if (!source || /^(javascript|vbscript):/i.test(source)) return "";
  if (isCompleteMediaPath(source)) return source;
  return joinMediaBasePath(archive.mediaBasePath || "", source);
}

function isCompleteMediaPath(value = "") {
  return /^(data:|blob:|https?:\/\/|\/|\.\/|\.\.\/|#)/i.test(String(value || "").trim());
}

function joinMediaBasePath(base = "", value = "") {
  const source = String(value || "").trim();
  const root = String(base || "").trim();
  if (!source || !root) return source;
  return `${root.replace(/\/+$/, "")}/${source.replace(/^\/+/, "")}`;
}

function mediaSourceForTarget(target = {}) {
  return mediaForTarget(target)?.url || safeMediaPath(target.url || target.path || target.src || "");
}

function mediaLabelForTarget(target = {}, fallback = "미디어") {
  const media = mediaForTarget(target);
  return target.caption || target.text || target.fileName || media?.title || target.path || target.url || fallback;
}

function mediaAcceptForPreferredType(type = "auto") {
  if (type === "media") return "image/*,.gif";
  if (type === "video") return "video/*";
  return DEFAULT_MEDIA_ACCEPT;
}

function openMediaPicker(preferredType = "auto") {
  if (!els.mediaFilePicker) return;
  els.mediaFilePicker.value = "";
  els.mediaFilePicker.accept = mediaAcceptForPreferredType(preferredType);
  els.mediaFilePicker.click();
}

function resetMediaPicker() {
  if (!els.mediaFilePicker) return;
  els.mediaFilePicker.value = "";
  els.mediaFilePicker.accept = DEFAULT_MEDIA_ACCEPT;
}

function imageResizeTarget(blockId, unitId = "") {
  if (!blockId) return null;
  if (unitId) {
    const unit = contentUnit(blockId, unitId);
    return unit?.type === "media" ? unit : null;
  }
  const block = currentDoc()?.blocks?.find(item => item.id === blockId);
  return block?.type === "media" ? block : null;
}

function beginImageResize(event) {
  const handle = event.target.closest?.("[data-image-resize-handle]");
  if (!handle || !state.editMode || event.button !== 0) return false;
  const blockId = handle.dataset.blockId || "";
  const unitId = handle.dataset.unitId || "";
  const target = imageResizeTarget(blockId, unitId);
  const frame = handle.closest("[data-image-frame]");
  const box = frame?.querySelector("[data-image-resize-box]");
  if (!target || !frame || !box) return false;

  const boxRect = box.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  Object.assign(imageResizeState, {
    active: true,
    blockId,
    unitId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: boxRect.width,
    frameWidth: Math.max(1, frameRect.width),
    width: imageWidth(target),
    recorded: false,
    target,
    frame,
    handle,
    input: frame.closest("[data-image-editor]")?.querySelector("[data-image-width-control]") || null,
    output: frame.closest("[data-image-editor]")?.querySelector("[data-image-width-output]") || null
  });
  frame.classList.add("image-resizing");
  document.body.classList.add("image-resizing-active");
  try {
    handle.setPointerCapture?.(event.pointerId);
  } catch (_) {}
  event.preventDefault();
  return true;
}

function applyImageResize(event) {
  if (!imageResizeState.active || !imageResizeState.target) return;
  const delta = event.clientX - imageResizeState.startX;
  const nextWidth = normalizeImageWidth(((imageResizeState.startWidth + delta) / imageResizeState.frameWidth) * 100);
  if (nextWidth === imageResizeState.width) return;
  if (!imageResizeState.recorded) {
    recordUndo();
    imageResizeState.recorded = true;
  }
  imageResizeState.width = nextWidth;
  imageResizeState.target.imageWidth = nextWidth;
  updateImageResizeUi(imageResizeState.frame, imageResizeState.input, imageResizeState.output, nextWidth);
  markDirty();
  event.preventDefault();
}

function finishImageResize() {
  if (!imageResizeState.active) return;
  try {
    imageResizeState.handle?.releasePointerCapture?.(imageResizeState.pointerId);
  } catch (_) {}
  if (imageResizeState.recorded) refreshDerivedDoc(currentDoc());
  imageResizeState.frame?.classList.remove("image-resizing");
  document.body.classList.remove("image-resizing-active");
  clearImageResizeState();
}

function clearImageResizeState() {
  Object.assign(imageResizeState, {
    active: false,
    blockId: "",
    unitId: "",
    pointerId: null,
    startX: 0,
    startWidth: 0,
    frameWidth: 0,
    width: 100,
    recorded: false,
    target: null,
    frame: null,
    handle: null,
    input: null,
    output: null
  });
}

function beginTableResize(event) {
  const handle = event.target.closest?.("[data-table-resize-handle]");
  if (!handle || !state.editMode || event.button !== 0) return false;
  const cell = handle.closest("td, th");
  if (!cell) return false;
  const rect = cell.getBoundingClientRect();
  Object.assign(tableResizeState, {
    active: true,
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: rect.width,
    cell,
    handle
  });
  handle.classList.add("resizing");
  document.body.classList.add("table-column-resizing");
  try {
    handle.setPointerCapture?.(event.pointerId);
  } catch (_) {}
  event.preventDefault();
  return true;
}

function applyTableResize(event) {
  if (!tableResizeState.active || !tableResizeState.cell) return;
  const width = Math.max(60, Math.round(tableResizeState.startWidth + event.clientX - tableResizeState.startX));
  tableResizeState.cell.style.width = `${width}px`;
  tableResizeState.cell.style.minWidth = `${width}px`;
  event.preventDefault();
}

function finishTableResize() {
  if (!tableResizeState.active) return;
  try {
    tableResizeState.handle?.releasePointerCapture?.(tableResizeState.pointerId);
  } catch (_) {}
  tableResizeState.handle?.classList.remove("resizing");
  document.body.classList.remove("table-column-resizing");
  clearTableResizeState();
}

function clearTableResizeState() {
  Object.assign(tableResizeState, {
    active: false,
    pointerId: null,
    startX: 0,
    startWidth: 0,
    cell: null,
    handle: null
  });
}

function updateImageResizeUi(frame, input, output, width) {
  const normalized = normalizeImageWidth(width);
  frame?.style.setProperty("--image-width", `${normalized}%`);
  if (input) input.value = String(normalized);
  if (output) output.textContent = `${normalized}%`;
}

function syncEditorControlPreview(target) {
  if (target.dataset.blockField === "imageWidth" || target.dataset.unitField === "imageWidth") {
    const editor = target.closest("[data-image-editor]");
    updateImageResizeUi(
      editor?.querySelector("[data-image-frame]"),
      target,
      editor?.querySelector("[data-image-width-output]"),
      target.value
    );
    return;
  }
  if (!target.matches?.(".code-editor")) return;
  const preview = target.closest(".code-editor-wrap")?.querySelector(".code-preview code");
  if (preview) preview.textContent = target.value;
}

function renderDiagramEditor(type = "flow", content = "", options = {}) {
  const blockId = escapeHtml(options.blockId || "");
  const unitId = options.unitId ? ` data-unit-id="${escapeHtml(options.unitId)}"` : "";
  const fieldAttr = options.unitId ? "data-unit-field" : "data-block-field";
  const rows = Number(options.rows || 5);
  return `
    <div class="diagram-editor-wrap" data-diagram-editor-wrap>
      <div class="diagram-editor-tools">
        <button type="button" data-action="${escapeHtml(options.sampleAction || `${type}-sample`)}" data-block-id="${blockId}"${unitId}>샘플 적용</button>
      </div>
      <textarea class="block-textarea diagram-editor" rows="${rows}" data-diagram-editor="${escapeHtml(type)}" data-block-id="${blockId}"${unitId} ${fieldAttr}="${escapeHtml(options.field || "content")}">${escapeHtml(content || "")}</textarea>
      <div class="diagram-preview-pane" data-diagram-preview>${renderDiagramPreview(type, content)}</div>
    </div>
  `;
}

function renderDiagramPreview(type = "flow", content = "") {
  if (type === "mermaid") {
    return `<div class="mermaid-preview" data-mermaid-source="${escapeHtml(content || "")}">${escapeHtml(content || "")}</div>`;
  }
  return renderFlowPreview(content || "");
}

function syncDiagramEditorPreview(target) {
  const type = target.dataset.diagramEditor || "flow";
  const pane = target.closest?.("[data-diagram-editor-wrap]")?.querySelector?.("[data-diagram-preview]");
  if (!pane) return;
  pane.innerHTML = renderDiagramPreview(type, target.value || "");
  if (type === "mermaid") renderMermaidBlocks();
}

function clearDocumentTreeDragUi() {
  document.querySelectorAll(".doc-drag-over, .doc-drag-before, .doc-drag-after, .doc-row-dragging").forEach(item => {
    item.classList.remove("doc-drag-over", "doc-drag-before", "doc-drag-after", "doc-row-dragging");
  });
}

function rowDropPlacement(event, rowEl) {
  const rect = rowEl.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
}

function clearDocumentTreePointerDrag() {
  documentTreePointerDrag.active = false;
  documentTreePointerDrag.docId = "";
  documentTreePointerDrag.overDocId = "";
  documentTreePointerDrag.placement = "before";
  documentTreePointerDrag.pointerId = null;
  documentTreePointerDrag.startX = 0;
  documentTreePointerDrag.startY = 0;
  documentTreePointerDrag.moved = false;
}

function clearContentUnitDragUi() {
  document.querySelectorAll(".unit-drag-over, .unit-drag-before, .unit-drag-after, .unit-dragging").forEach(item => {
    item.classList.remove("unit-drag-over", "unit-drag-before", "unit-drag-after", "unit-dragging");
  });
}

function clearContentUnitPointerDrag() {
  contentUnitPointerDrag.active = false;
  contentUnitPointerDrag.blockId = "";
  contentUnitPointerDrag.unitId = "";
  contentUnitPointerDrag.overUnitId = "";
  contentUnitPointerDrag.placement = "before";
  contentUnitPointerDrag.pointerId = null;
  contentUnitPointerDrag.startX = 0;
  contentUnitPointerDrag.startY = 0;
  contentUnitPointerDrag.moved = false;
}

function clearBlockDragUi() {
  document.querySelectorAll(".edit-block.drag-over, .edit-block.drop-before, .edit-block.drop-after, .edit-block.block-dragging").forEach(item => {
    item.classList.remove("drag-over", "drop-before", "drop-after", "block-dragging");
  });
}

function blockDropPlacement(event, blockEl) {
  const rect = blockEl.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
}

function showConfirmDialog({ title = "확인", message = "", confirmLabel = "확인", cancelLabel = "취소", danger = false, onConfirm = () => {} } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-window" role="dialog" aria-modal="true" aria-labelledby="archive-modal-title">
      <div class="modal-header">
        <h3 id="archive-modal-title">${escapeHtml(title)}</h3>
        <button class="modal-close" type="button" aria-label="닫기">×</button>
      </div>
      <div class="modal-body">
        <p>${escapeHtml(message)}</p>
      </div>
      <div class="modal-footer">
        <button class="modal-cancel-btn" type="button">${escapeHtml(cancelLabel)}</button>
        <button class="modal-confirm-btn ${danger ? "danger" : "primary-action"}" type="button">${escapeHtml(confirmLabel)}</button>
      </div>
    </div>
  `;
  const close = () => {
    document.removeEventListener("keydown", onKeyDown);
    backdrop.remove();
  };
  const confirm = () => {
    close();
    onConfirm();
  };
  const onKeyDown = event => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      confirm();
    }
  };
  backdrop.addEventListener("click", event => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector(".modal-cancel-btn").addEventListener("click", close);
  backdrop.querySelector(".modal-confirm-btn").addEventListener("click", confirm);
  document.addEventListener("keydown", onKeyDown);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.querySelector(".modal-confirm-btn")?.focus());
}

function showInputDialog({ title = "입력", message = "", label = "값", defaultValue = "", confirmLabel = "저장", cancelLabel = "취소", onConfirm = () => {} } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-window" role="dialog" aria-modal="true" aria-labelledby="archive-input-modal-title">
      <div class="modal-header">
        <h3 id="archive-input-modal-title">${escapeHtml(title)}</h3>
        <button class="modal-close" type="button" aria-label="닫기">×</button>
      </div>
      <div class="modal-body">
        ${message ? `<p>${escapeHtml(message)}</p>` : ""}
        <label class="modal-input-field">${escapeHtml(label)}
          <input class="modal-input" type="text" value="${escapeHtml(defaultValue)}">
        </label>
      </div>
      <div class="modal-footer">
        <button class="modal-cancel-btn" type="button">${escapeHtml(cancelLabel)}</button>
        <button class="modal-confirm-btn primary-action" type="button">${escapeHtml(confirmLabel)}</button>
      </div>
    </div>
  `;
  const input = backdrop.querySelector(".modal-input");
  const close = () => {
    document.removeEventListener("keydown", onKeyDown);
    backdrop.remove();
  };
  const submit = () => {
    const value = input.value.trim();
    close();
    onConfirm(value);
  };
  const onKeyDown = event => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };
  backdrop.addEventListener("click", event => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector(".modal-cancel-btn").addEventListener("click", close);
  backdrop.querySelector(".modal-confirm-btn").addEventListener("click", submit);
  document.addEventListener("keydown", onKeyDown);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function handleAction(action, target) {
  if (action === "download-summary") {
    downloadSummary();
    return;
  }
  if (action === "open-terms") {
    openTermPanel();
    return;
  }
  if (action === "clear-filters") {
    state.category = "all";
    state.status = "all";
    state.query = "";
    els.search.value = "";
    writeHash();
    render();
    return;
  }
  if (action === "add-doc") {
    addDocument();
    return;
  }
  if (action === "add-child-doc") {
    addChildDocument(target.dataset.docId || state.selectedDocId);
    return;
  }
  if (action === "duplicate-doc") {
    duplicateDocument();
    return;
  }
  if (action === "delete-doc") {
    deleteDocument(target.dataset.docId || state.selectedDocId);
    return;
  }
  if (action === "doc-rename") {
    beginDocumentTreeRename(target.dataset.docId || state.selectedDocId);
    return;
  }
  if (action === "doc-depth") {
    changeDocumentDepth(target.dataset.docId, Number(target.dataset.direction || 0));
    return;
  }
  if (action === "add-block") {
    addBlock(target.dataset.blockType || "paragraph");
    return;
  }
  if (action === "replace-block-media") {
    pendingInlineMediaInsert = null;
    pendingContentMediaInsert = null;
    pendingTableImageInsert = null;
    pendingBlockMediaReplace = {
      blockId: target.dataset.blockId || "",
      unitId: target.dataset.unitId || "",
      preferredType: target.dataset.mediaType || "auto"
    };
    openMediaPicker(pendingBlockMediaReplace.preferredType);
    return;
  }
  if (action === "clear-block-media") {
    clearBlockMedia({
      blockId: target.dataset.blockId || "",
      unitId: target.dataset.unitId || ""
    });
    return;
  }
  if (action === "add-media-block") {
    pendingInlineMediaInsert = null;
    pendingContentMediaInsert = null;
    pendingTableImageInsert = null;
    pendingBlockMediaReplace = null;
    openMediaPicker("auto");
    return;
  }
  if (action === "delete-inline-media-marker") {
    deleteInlineMediaMarker(
      target.dataset.blockId || "",
      target.dataset.unitId || "",
      target.dataset.inlineField || "",
      Number(target.dataset.markerIndex)
    );
    return;
  }
  if (action === "insert-table-cell-image") {
    pendingInlineMediaInsert = null;
    pendingContentMediaInsert = null;
    pendingBlockMediaReplace = null;
    pendingTableImageInsert = {
      kind: target.dataset.cellKind || "",
      blockId: target.dataset.blockId || "",
      unitId: target.dataset.unitId || "",
      row: Number(target.dataset.row),
      col: Number(target.dataset.col)
    };
    openMediaPicker("media");
    return;
  }
  if (action === "import-table-block") {
    pendingTableImportTarget = "document";
    pendingTableImportSource = null;
    els.tableFilePicker.value = "";
    els.tableFilePicker.click();
    return;
  }
  if (action === "import-table-source") {
    const source = tableSourceFromControl(target);
    if (!source || !["table", "unit"].includes(source.kind)) {
      toast("가져올 표를 찾을 수 없습니다.");
      return;
    }
    pendingTableImportTarget = "source";
    pendingTableImportSource = {
      kind: source.kind,
      blockId: source.blockId || "",
      unitId: source.unitId || ""
    };
    els.tableFilePicker.value = "";
    els.tableFilePicker.click();
    return;
  }
  if (action === "import-collection-file") {
    pendingTableImportTarget = "collections";
    pendingTableImportSource = null;
    els.tableFilePicker.value = "";
    els.tableFilePicker.click();
    return;
  }
  if (action === "flow-sample") {
    applyDiagramSample(target.dataset.blockId, target.dataset.unitId, "flow");
    return;
  }
  if (action === "mermaid-sample") {
    applyDiagramSample(target.dataset.blockId, target.dataset.unitId, "mermaid");
    return;
  }
  if (action === "add-collection-row") {
    addCollectionRow();
    return;
  }
  if (action === "add-collection-column") {
    addCollectionColumn();
    return;
  }
  if (action === "delete-collection-column") {
    deleteCollectionColumn(Number(target.dataset.col));
    return;
  }
  if (action === "sort-collection") {
    sortCollection(Number(target.dataset.col || 0), target.dataset.direction || "asc");
    return;
  }
  if (action === "export-collection-csv") {
    exportCurrentCollectionCsv();
    return;
  }
  if (action === "table-sort") {
    sortTableView(target);
    return;
  }
  if (action === "table-clear-view") {
    clearTableView(target);
    return;
  }
  if (action === "hide-table-column") {
    hideTableColumnFromControl(target);
    return;
  }
  if (action === "show-table-columns") {
    showHiddenTableColumns(target);
    return;
  }
  if (action === "delete-table-row-selected") {
    deleteTableRowFromControl(target);
    return;
  }
  if (action === "table-export-csv") {
    exportTableView(target, "csv");
    return;
  }
  if (action === "table-export-xlsx") {
    exportTableView(target, "xlsx");
    return;
  }
  if (action === "delete-table-column") {
    deleteTableColumnFromControl(target);
    return;
  }
  if (action === "add-collection") {
    addCollection();
    return;
  }
  if (action === "delete-collection") {
    deleteCollection();
    return;
  }
  if (action === "delete-collection-row") {
    deleteCollectionRow(Number(target.dataset.row));
    return;
  }
  if (action === "add-table-row") {
    addTableRow(target.dataset.blockId);
    return;
  }
  if (action === "add-table-column") {
    addTableColumn(target.dataset.blockId);
    return;
  }
  if (action === "delete-table-row") {
    deleteTableRow(target.dataset.blockId, Number(target.dataset.row));
    return;
  }
  if (action === "add-unit-table-row") {
    addUnitTableRow(target.dataset.blockId, target.dataset.unitId);
    return;
  }
  if (action === "add-unit-table-column") {
    addUnitTableColumn(target.dataset.blockId, target.dataset.unitId);
    return;
  }
  if (action === "delete-unit-table-row") {
    deleteUnitTableRow(target.dataset.blockId, target.dataset.unitId, Number(target.dataset.row));
    return;
  }
  if (action === "delete-unit-table-column") {
    deleteUnitTableColumn(target.dataset.blockId, target.dataset.unitId, Number(target.dataset.col));
    return;
  }
  if (action === "clear-drawing") {
    clearDrawing(target.dataset.blockId, target.dataset.unitId || "");
    return;
  }
  if (action === "undo-drawing") {
    undoDrawing(target.dataset.blockId, target.dataset.unitId || "");
    return;
  }
  if (action === "create-planning-record") {
    createPlanningRecord(target.dataset.blockId, target.dataset.planType, target.closest("[data-planning-form]"));
    return;
  }
  if (action === "meeting-attendee-all") {
    selectPlanningMembers(target.closest("[data-planning-form]"), "attendees");
    return;
  }
  if (action === "toggle-task") {
    togglePlanningTask(target.dataset.blockId, Number(target.dataset.row), target.checked);
    return;
  }
  if (action === "calendar-shift") {
    shiftCalendarBlock(target.dataset.blockId, Number(target.dataset.monthDelta || 0));
    return;
  }
  if (action === "calendar-today") {
    setCalendarBlockMonth(target.dataset.blockId, currentMonthKey());
    return;
  }
  if (action === "dialogue-step") {
    stepDialogueBlock(target.dataset.blockId, Number(target.dataset.row), target.dataset.dialogueRemember !== "0");
    return;
  }
  if (action === "dialogue-talk") {
    stepDialogueBlock(target.dataset.blockId, Number(target.dataset.row), true);
    return;
  }
  if (action === "dialogue-back") {
    backDialogueBlock(target.dataset.blockId, Number(target.dataset.fallbackRow));
    return;
  }
  if (action === "dialogue-reset") {
    resetDialogueBlock(target.dataset.blockId);
    return;
  }
  if (action === "restore-version") {
    restoreVersion(target.dataset.versionId);
    return;
  }
  if (action === "reset-local") {
    showConfirmDialog({
      title: "원본으로 되돌리기",
      message: "브라우저에 저장된 Archive 편집본을 버리고 원본 Notion 정리본으로 되돌릴까요?",
      confirmLabel: "되돌리기",
      danger: true,
      onConfirm: () => {
        recordUndo();
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(META_KEY);
        archive = clone(embeddedArchive);
        archive.updatedAt = new Date().toISOString();
        rebuildIndexes();
        state.selectedDocId = archive.priorityDocs?.[0]?.id || archive.documents?.[0]?.id || "";
        state.selectedCollectionId = archive.collections?.[0]?.id || "";
        state.selectedWikiTerm = "";
        state.pendingRemoteRevision = 0;
        state.dirty = true;
        persistLocal();
        render();
        void saveArchiveNow({ manual: false });
        toast("로컬 편집본을 초기화했습니다.");
      }
    });
  }
}

function readHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  state.view = params.get("view") || state.view;
  state.category = params.get("category") || state.category;
  state.status = params.get("status") || state.status;
  state.query = params.get("q") || state.query;
  state.selectedDocId = params.get("doc") || state.selectedDocId;
  state.selectedCollectionId = params.get("collection") || state.selectedCollectionId;
  state.selectedWikiTerm = params.get("term") || state.selectedWikiTerm;
  if (!["overview", "documents", "wiki", "collections", "media", "cleanup"].includes(state.view)) state.view = "overview";
  if (state.category !== "all" && !categoryById.has(state.category)) state.category = "all";
  if (!["all", "active", "review", "legacy"].includes(state.status)) state.status = "all";
  if (state.selectedDocId && !docsById.has(state.selectedDocId)) state.selectedDocId = archive.documents[0]?.id || "";
  if (state.selectedCollectionId && !collectionsById.has(state.selectedCollectionId)) {
    state.selectedCollectionId = archive.collections[0]?.id || "";
  }
}

function writeHash(push = true) {
  const params = new URLSearchParams();
  params.set("view", state.view);
  if (state.category !== "all") params.set("category", state.category);
  if (state.status !== "all") params.set("status", state.status);
  if (state.query) params.set("q", state.query);
  if (state.view === "documents" && state.selectedDocId) params.set("doc", state.selectedDocId);
  if (state.view === "wiki" && state.selectedWikiTerm) params.set("term", state.selectedWikiTerm);
  if (state.view === "collections" && state.selectedCollectionId) params.set("collection", state.selectedCollectionId);
  const next = `#${params.toString()}`;
  if (push) history.pushState(null, "", next);
  else history.replaceState(null, "", next);
}

function render() {
  document.body.classList.toggle("editing", state.editMode);
  renderTopbar();
  renderTabs();
  renderSidebar();
  const viewRenderers = {
    overview: renderOverview,
    documents: renderDocuments,
    wiki: renderWiki,
    collections: renderCollections,
    media: renderMedia,
    cleanup: renderCleanup
  };
  els.workspace.innerHTML = `${renderArchiveTitle()}${viewRenderers[state.view]()}`;
  initializeDrawingCanvases();
  renderMermaidBlocks();
}

async function renderMermaidBlocks() {
  if (!window.mermaid) return;
  try {
    window.mermaid.initialize?.({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
  } catch (_) {}
  const blocks = [...document.querySelectorAll("[data-mermaid-source]")].filter(block => block.dataset.rendered !== "1");
  for (const block of blocks) {
    const source = block.dataset.mermaidSource || "";
    if (!source.trim()) continue;
    block.dataset.rendered = "1";
    try {
      const id = createId("archive-mermaid").replace(/[^a-zA-Z0-9_-]/g, "");
      const result = await window.mermaid.render(id, source);
      if (document.body.contains(block)) block.innerHTML = result.svg;
    } catch (err) {
      block.classList.add("mermaid-error");
      block.textContent = source;
    }
  }
}

function renderTopbar() {
  const totals = currentTotals();
  els.title.textContent = archive.title;
  els.subtitle.textContent = `${totals.documents}개 문서 · ${totals.collections}개 표 · ${totals.bundledMedia}개 미디어`;
  els.modeBadge.textContent = state.editMode ? "편집 모드" : "보기 모드";
  els.editToggle.textContent = state.editMode ? "편집 중" : "편집";
  els.editToggle.setAttribute("aria-pressed", String(state.editMode));
  els.editToggle.classList.toggle("active", state.editMode);
  els.saveArchive.disabled = false;
  els.saveArchive.textContent = state.dirty ? "파일 저장*" : "파일 저장";
  els.undoCommand.disabled = !undoStack.length;
  els.redoCommand.disabled = !redoStack.length;
  els.undoCommand.title = undoLabels.at(-1) ? `되돌리기: ${undoLabels.at(-1)} (Ctrl+Z)` : "되돌리기 (Ctrl+Z)";
  els.redoCommand.title = redoLabels.at(-1) ? `다시 실행: ${redoLabels.at(-1)} (Ctrl+Y)` : "다시 실행 (Ctrl+Y)";
  if (els.saveStatus) {
    els.saveStatus.textContent = state.dirty
      ? "자동 저장 대기"
      : state.lastSavedAt
        ? `저장됨 · ${formatDateTime(state.lastSavedAt)}`
        : "초기화됨";
    els.saveStatus.classList.toggle("dirty", state.dirty);
  }
  renderCollabStatus();
  renderAuthUser();
}

function renderCollabStatus() {
  if (!els.collabStatus) return;
  const count = Math.max(1, state.presence.length || 1);
  const editing = state.editMode ? " · 편집 중" : "";
  const pending = Number(state.pendingRemoteRevision || 0) > Number(state.revision || 0);
  els.collabStatus.textContent = `${count}명 접속${editing}${pending ? " · 원격 변경 대기" : ""}`;
  els.collabStatus.classList.toggle("offline", state.saveMode !== "server");
  els.collabStatus.classList.toggle("online", state.saveMode === "server" && !pending);
  els.collabStatus.classList.toggle("syncing", pending);
}

function renderAuthUser() {
  if (!state.authUser) {
    els.authUser.classList.add("hidden");
    els.logoutButton.classList.add("hidden");
    return;
  }
  els.authUser.classList.remove("hidden");
  els.authUser.innerHTML = `
    <span>${escapeHtml(state.authUser.displayName || state.authUser.username || "사용자")}</span>
    <small>${escapeHtml(state.authUser.role || "")}</small>
  `;
  if (state.authUser.id === 0) els.logoutButton.classList.add("hidden");
  else els.logoutButton.classList.remove("hidden");
}

function renderTabs() {
  document.querySelectorAll(".view-tab").forEach(button => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
}

function renderSidebar() {
  const totals = currentTotals();
  const byCategory = categoryCounts();
  const byStatus = statusCounts();
  const currentOutline = renderCurrentDocumentOutline();
  const documentTree = renderDocumentTreeSection();
  const priorityButtons = archive.priorityDocs.slice(0, 9).map(ref => {
    const doc = docsById.get(ref.id) || ref;
    return `
      <button class="priority-button" type="button" data-doc="${escapeHtml(doc.id)}">
        ${escapeHtml(doc.title)}
        <span class="source-note">${escapeHtml(doc.categoryLabel || ref.categoryLabel || "")}</span>
      </button>
    `;
  }).join("");

  els.sidebar.innerHTML = `
    <section class="side-section side-status-card">
      <h2 class="side-title">저장 상태</h2>
      <strong>${state.saveMode === "server" ? "서버 저장" : "브라우저 저장"}</strong>
      <span>${state.dirty ? "저장되지 않은 변경 있음" : `마지막 저장 ${state.lastSavedAt ? formatDateTime(state.lastSavedAt) : "-"}`}</span>
    </section>
    <section class="side-section">
      <h2 class="side-title">상태 필터</h2>
      <div class="filter-grid">
        ${["all", "active", "review", "legacy"].map(status => `
          <button class="filter-button ${state.status === status ? "active" : ""}" type="button" data-status="${status}">
            <span>${statusLabels[status]}</span>
            <strong>${status === "all" ? totals.documents : byStatus[status]}</strong>
          </button>
        `).join("")}
      </div>
    </section>
    <section class="side-section">
      <h2 class="side-title">문서 분류</h2>
      <div class="category-list">
        <button class="category-button ${state.category === "all" ? "active" : ""}" type="button" data-category="all">
          <span class="category-dot" aria-hidden="true"></span>
          <span class="category-name">전체 문서</span>
          <span class="category-count">${totals.documents}</span>
        </button>
        ${archive.categories.map(category => `
          <button class="category-button tone-${escapeHtml(category.tone)} ${state.category === category.id ? "active" : ""}" type="button" data-category="${escapeHtml(category.id)}">
            <span class="category-dot" aria-hidden="true"></span>
            <span class="category-name">${escapeHtml(category.label)}</span>
            <span class="category-count">${byCategory[category.id] || 0}</span>
          </button>
        `).join("")}
      </div>
    </section>
    <section class="side-section">
      <h2 class="side-title">위키</h2>
      <button class="wiki-home-button ${state.view === "wiki" ? "active" : ""}" type="button" data-view="wiki">
        <span>용어 인덱스</span>
        <small>${(archive.glossary?.length || 0).toLocaleString("ko-KR")}개</small>
      </button>
    </section>
    ${currentOutline}
    ${documentTree}
    <section class="side-section">
      <h2 class="side-title">우선 읽기</h2>
      <div class="priority-list">${priorityButtons}</div>
    </section>
  `;
}

function renderCurrentDocumentOutline() {
  if (state.view !== "documents") return "";
  const doc = selectedDocumentForSidebar();
  if (!doc) return "";
  const headings = docOutlineItems(doc).slice(0, 14);
  return `
    <section class="side-section doc-outline-section">
      <h2 class="side-title">현재 문서</h2>
      <button class="outline-doc-button" type="button" data-doc="${escapeHtml(doc.id)}">
        <span>${escapeHtml(doc.title)}</span>
        <small>${escapeHtml(doc.categoryLabel || "")}</small>
      </button>
      ${headings.length ? `
        <div class="doc-outline-list">
          ${headings.map(item => `
            <button class="doc-outline-button level-${escapeHtml(item.level)}" type="button" data-outline-target="${escapeHtml(item.targetId)}">
              <span class="outline-level">H${escapeHtml(item.level)}</span>
              <span>${escapeHtml(item.text)}</span>
            </button>
          `).join("")}
        </div>
      ` : `<p class="outline-empty">제목 블록을 추가하면 이동 링크가 생깁니다.</p>`}
    </section>
  `;
}

function renderDocumentTreeSection() {
  if (state.view !== "documents") return "";
  const { docs, total } = sidebarDocumentTreeDocs();
  return `
    <section class="side-section doc-tree-section">
      <div class="side-section-head">
        <h2 class="side-title">문서 트리</h2>
        <span class="doc-tree-count">${total.toLocaleString("ko-KR")}</span>
      </div>
      ${docs.length ? `
        <div class="doc-tree-list">
          ${docs.map(renderDocumentTreeRow).join("")}
        </div>
      ` : `<p class="outline-empty">현재 필터에 맞는 문서가 없습니다.</p>`}
    </section>
  `;
}

function renderDocumentTreeRow(doc) {
  const depth = documentDepth(doc);
  const active = doc.id === state.selectedDocId ? "active" : "";
  const editable = state.editMode ? "editable" : "";
  const id = escapeHtml(doc.id);
  const meta = `${doc.categoryLabel || ""}${doc.status ? ` · ${statusLabels[doc.status] || doc.status}` : ""}`;
  const title = doc.title || "제목 없음";
  const renaming = state.editMode && state.renamingDocId === doc.id;
  const canDelete = archive.documents.length > documentSubtreeSize(doc.id);
  return `
    <div class="doc-tree-row ${active} ${editable}" data-doc-tree-row="${id}" style="--doc-depth:${depth}">
      ${state.editMode ? `
        <div class="doc-tree-controls">
          <span class="doc-drag-handle" role="button" tabindex="0" draggable="true" data-drag-doc="${id}" title="문서 순서 이동" aria-label="문서 순서 이동">↕</span>
          <button class="doc-tree-depth-button" type="button" data-action="doc-depth" data-doc-id="${id}" data-direction="-1" title="내어쓰기" aria-label="내어쓰기" ${depth <= 0 ? "disabled" : ""}>←</button>
          <button class="doc-tree-depth-button" type="button" data-action="doc-depth" data-doc-id="${id}" data-direction="1" title="들여쓰기" aria-label="들여쓰기" ${depth >= 6 ? "disabled" : ""}>→</button>
          <button class="doc-tree-depth-button" type="button" data-action="add-child-doc" data-doc-id="${id}" title="하위 문서 추가" aria-label="하위 문서 추가">+</button>
          <button class="doc-tree-depth-button" type="button" data-action="doc-rename" data-doc-id="${id}" title="문서 이름 편집" aria-label="문서 이름 편집">✎</button>
          <button class="doc-tree-depth-button danger" type="button" data-action="delete-doc" data-doc-id="${id}" title="문서 삭제" aria-label="문서 삭제" ${canDelete ? "" : "disabled"}>×</button>
        </div>
      ` : ""}
      ${renaming ? `
        <div class="doc-tree-button doc-tree-rename-wrap">
          <input class="doc-tree-rename-input" type="text" value="${escapeHtml(title)}" data-doc-tree-rename="${id}" aria-label="문서 제목 변경">
          <span class="doc-tree-meta">${escapeHtml(meta)}</span>
        </div>
      ` : `
        <button class="doc-tree-button" type="button" data-doc="${id}" title="더블클릭해서 이름 변경">
          <span class="doc-tree-title">${escapeHtml(title)}</span>
          <span class="doc-tree-meta">${escapeHtml(meta)}</span>
        </button>
      `}
    </div>
  `;
}

function sidebarDocumentTreeDocs() {
  const query = searchable(state.query);
  const docs = (archive.documents || []).filter(doc => matchesDocumentFilters(doc, query));
  return { docs, total: docs.length };
}

function matchesDocumentFilters(doc, query = searchable(state.query)) {
  if (!doc) return false;
  if (state.category !== "all" && doc.category !== state.category) return false;
  if (state.status !== "all" && doc.status !== state.status) return false;
  if (query && !searchable(doc.searchText).includes(query)) return false;
  return true;
}

function documentDepth(doc) {
  const depth = Number(doc?.depth || 0);
  if (!Number.isFinite(depth)) return 0;
  return Math.max(0, Math.min(6, Math.round(depth)));
}

function selectedDocumentForSidebar() {
  if (state.view !== "documents") return null;
  const docs = filteredDocuments();
  if (!docs.some(doc => doc.id === state.selectedDocId)) state.selectedDocId = docs[0]?.id || "";
  return docs.find(doc => doc.id === state.selectedDocId) || docs[0] || null;
}

function refreshDocumentSidebar() {
  if (state.view === "documents") renderSidebar();
}

function beginDocumentTreeRename(docId = "") {
  if (!docId || !docsById.has(docId)) return;
  state.selectedDocId = docId;
  state.view = "documents";
  state.renamingDocId = docId;
  writeHash(false);
  render();
  requestAnimationFrame(() => {
    const input = document.querySelector(`[data-doc-tree-rename="${CSS.escape(docId)}"]`);
    input?.focus();
    input?.select?.();
  });
}

function handleDocumentTreeRenameKey(event) {
  const input = event.target.closest?.("[data-doc-tree-rename]");
  if (!input) return false;
  if (event.key === "Enter") {
    event.preventDefault();
    commitDocumentTreeRename(input);
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    input.dataset.cancelRename = "1";
    state.renamingDocId = "";
    render();
    return true;
  }
  return false;
}

function commitDocumentTreeRename(input) {
  if (!input || input.dataset.committed === "1") return;
  input.dataset.committed = "1";
  const docId = input.dataset.docTreeRename || "";
  if (input.dataset.cancelRename === "1") return;
  const doc = docsById.get(docId);
  if (!doc) return;
  const nextTitle = String(input.value || "").trim() || doc.title || "제목 없음";
  state.renamingDocId = "";
  renameDocumentTitle(docId, nextTitle);
  render();
}

function renameDocumentTitle(docId, title) {
  const doc = docsById.get(docId);
  if (!doc || doc.title === title) return;
  recordUndo();
  doc.title = title;
  refreshDerivedDoc(doc);
  markDirty();
}

function renderArchiveTitle() {
  const totals = currentTotals();

  return `
    <section class="document-title archive-title-panel">
      ${state.editMode ? `
        <input class="title-input" value="${escapeHtml(archive.title)}" data-archive-field="title" aria-label="문서 전체 제목">
        <textarea class="subtitle-input" rows="2" data-archive-field="subtitle" aria-label="문서 전체 설명">${escapeHtml(archive.subtitle || "Notion export 기반 웹 문서 편집 허브")}</textarea>
        <label class="media-base-field">미디어 기본 경로
          <input value="${escapeHtml(archive.mediaBasePath || "")}" data-archive-field="mediaBasePath" placeholder="../assets/notion-media 또는 https://cdn.example.com/media">
        </label>
      ` : `
        <h1>${escapeHtml(archive.title)}</h1>
        <p>${escapeHtml(archive.subtitle || "Notion export 기반 웹 문서 편집 허브")}</p>
      `}
      <div class="title-meta">
        <span class="pill">${totals.documents.toLocaleString("ko-KR")}개 문서</span>
        <span class="pill">${totals.collections.toLocaleString("ko-KR")}개 표</span>
        <span class="pill">${totals.bundledMedia.toLocaleString("ko-KR")}개 미디어</span>
        ${archive.mediaBasePath ? `<span class="pill">미디어 경로 ${escapeHtml(archive.mediaBasePath)}</span>` : ""}
        <span class="pill ${state.dirty ? "review" : "active"}">${state.dirty ? "저장 필요" : state.saveMode === "server" ? "서버 저장" : "브라우저 저장"}</span>
        <span class="pill">${state.lastSavedAt ? formatDateTime(state.lastSavedAt) : "새 편집본"}</span>
      </div>
      <div class="title-actions">
        <button class="primary-action" type="button" data-view="documents">문서 편집</button>
        <button type="button" data-view="wiki">위키</button>
        <button type="button" data-view="collections">표 데이터</button>
        <button type="button" data-action="download-summary">정리 보고서</button>
        <button type="button" data-action="reset-local">원본으로 되돌리기</button>
      </div>
    </section>
  `;
}

function renderOverview() {
  const totals = currentTotals();
  return `
    <section class="metric-strip">
      ${stat("문서", totals.documents)}
      ${stat("표 데이터", totals.collections)}
      ${stat("검토 필요", totals.reviewDocuments)}
      ${stat("미디어", totals.bundledMedia)}
    </section>

    <div class="dashboard-grid">
      <section class="surface">
        <div class="surface-head">
          <div>
            <h2>프로젝트 기준</h2>
            <p>상위 기획서에서 추출한 기본 사양입니다.</p>
          </div>
        </div>
        <div class="surface-body">
          <div class="fact-grid">
            ${archive.keyFacts.map(fact => `
              <div class="fact">
                <span>${escapeHtml(fact.label)}</span>
                <strong>${escapeHtml(fact.value)}</strong>
              </div>
            `).join("")}
          </div>
        </div>
      </section>

      <section class="surface">
        <div class="surface-head">
          <div>
            <h2>정리 상태</h2>
            <p>문서 분류와 검토 대상을 현재 편집본 기준으로 보여줍니다.</p>
          </div>
        </div>
        <div class="surface-body">
          <div class="bar-list">${categoryBars()}</div>
        </div>
      </section>
    </div>

    <section class="surface">
      <div class="surface-head">
        <div>
          <h2>읽는 순서</h2>
          <p>기획, 시스템, 데이터, 세계관, UI, 제작 운영 순으로 다시 묶었습니다.</p>
        </div>
      </div>
      <div class="surface-body">
        <div class="map-list">
          ${archive.contentMap.map(item => `
            <div class="map-row">
              <strong>${escapeHtml(item.title)}</strong>
              <p>${escapeHtml(item.summary)}</p>
              <button type="button" data-category="${escapeHtml(item.category)}">${escapeHtml(categoryById.get(item.category)?.label || item.category)}</button>
            </div>
          `).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderDocuments() {
  const docs = filteredDocuments();
  if (!docs.some(doc => doc.id === state.selectedDocId)) state.selectedDocId = docs[0]?.id || "";
  const selected = docs.find(doc => doc.id === state.selectedDocId) || docs[0];
  return `
    <section class="surface page-head-card">
      <div>
        <h1>문서 ${state.editMode ? "편집" : "탐색"}</h1>
        <p>${docs.length}개 문서가 현재 필터와 검색어에 맞습니다.</p>
      </div>
      <div class="head-actions">
        <button type="button" data-action="clear-filters">필터 초기화</button>
        ${state.editMode ? `
          <button type="button" data-action="add-doc">문서 추가</button>
          <button type="button" data-action="add-child-doc" data-doc-id="${escapeHtml(state.selectedDocId || "")}">하위 문서 추가</button>
          <button type="button" data-action="duplicate-doc">문서 복제</button>
          <button class="danger" type="button" data-action="delete-doc">문서 삭제</button>
          <button class="primary-action" type="button" data-action="add-block" data-block-type="paragraph">본문 추가</button>
        ` : ""}
      </div>
    </section>
    <div class="single-document-flow">
      <section class="surface picker-panel">
        <div class="surface-body result-toolbar">
          <label class="editor-field result-select">문서 선택
            <select data-doc-select="1" ${docs.length ? "" : "disabled"}>
              ${docs.map(doc => `<option value="${escapeHtml(doc.id)}" ${doc.id === state.selectedDocId ? "selected" : ""}>${escapeHtml(doc.title)} · ${escapeHtml(doc.categoryLabel)}</option>`).join("")}
            </select>
          </label>
          <span class="source-note">${docs.length.toLocaleString("ko-KR")}개 결과</span>
        </div>
      </section>
      ${selected ? renderDocumentDetail(selected) : empty("문서를 선택하세요.")}
    </div>
  `;
}

function renderDocumentDetail(doc) {
  const category = categoryById.get(doc.category);
  const related = doc.localLinks
    .map(link => archive.documents.find(item => item.sourcePath === link.sourcePath))
    .filter(Boolean)
    .slice(0, 8);
  const meta = state.editMode ? renderDocEditorMeta(doc) : renderDocReadMeta(doc);
  return `
    <article class="surface doc-detail">
      <div class="surface-head doc-head">
        <div>${meta}</div>
      </div>
      <div class="surface-body">
        ${state.editMode ? renderBlockToolbar() : `
          <div class="tag-row">
            ${(doc.headings || []).slice(0, 10).map(heading => `<span class="tag">${escapeHtml(heading.text)}</span>`).join("")}
          </div>
        `}
        <div class="doc-blocks">${renderBlocks(doc.blocks, { query: state.query })}</div>
        ${!state.editMode && related.length ? `
          <hr>
          <h3>연결 문서</h3>
          <div class="tag-row">
            ${related.map(item => `<button type="button" data-doc="${escapeHtml(item.id)}">${escapeHtml(item.title)}</button>`).join("")}
          </div>
        ` : ""}
        ${!state.editMode && doc.externalLinks.length ? `
          <hr>
          <h3>외부 링크</h3>
          <div class="tag-row">
            ${doc.externalLinks.map(link => `<a class="tag" href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`).join("")}
          </div>
        ` : ""}
        ${category ? `<p class="source-note">${escapeHtml(category.description)}</p>` : ""}
      </div>
    </article>
  `;
}

function renderDocReadMeta(doc) {
  const subtitle = String(doc.subtitle || doc.excerpt || "요약 가능한 본문이 짧은 문서입니다.").trim();
  return `
    <div class="tag-row">
      <span class="tag ${escapeHtml(doc.status)}">${statusLabels[doc.status]}</span>
      <span class="tag">${escapeHtml(doc.categoryLabel)}</span>
      <span class="tag">${doc.textLength.toLocaleString("ko-KR")}자</span>
    </div>
    <h1>${escapeHtml(doc.title)}</h1>
    <p class="doc-subtitle">${escapeHtml(subtitle)}</p>
    ${doc.subtitle && doc.excerpt && doc.subtitle !== doc.excerpt ? `<p class="doc-summary">${escapeHtml(doc.excerpt)}</p>` : ""}
    <p class="doc-path">${escapeHtml(doc.sourcePath)}</p>
  `;
}

function renderDocEditorMeta(doc) {
  return `
    <div class="edit-meta-grid">
      <label class="editor-field full">문서 제목
        <input value="${escapeHtml(doc.title)}" data-edit-doc-field="title">
      </label>
      <label class="editor-field full">부제목
        <textarea rows="2" data-edit-doc-field="subtitle" placeholder="제목 아래에 표시할 짧은 설명">${escapeHtml(doc.subtitle || "")}</textarea>
      </label>
      <label class="editor-field">분류
        <select data-edit-doc-field="category">
          ${archive.categories.map(category => `<option value="${escapeHtml(category.id)}" ${category.id === doc.category ? "selected" : ""}>${escapeHtml(category.label)}</option>`).join("")}
        </select>
      </label>
      <label class="editor-field">상태
        <select data-edit-doc-field="status">
          ${statusOptions.map(([value, label]) => `<option value="${value}" ${value === doc.status ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
      <label class="editor-field full">요약
        <textarea rows="3" data-edit-doc-field="excerpt">${escapeHtml(doc.excerpt || "")}</textarea>
      </label>
    </div>
    <p class="doc-path">${escapeHtml(doc.sourcePath)}</p>
  `;
}

function renderBlockToolbar() {
  return `
    <div class="editor-toolbar">
      <button type="button" data-action="add-block" data-block-type="generic">블록 묶음</button>
      <button type="button" data-action="add-block" data-block-type="heading">제목</button>
      <button type="button" data-action="add-block" data-block-type="paragraph">문단</button>
      <button type="button" data-action="add-block" data-block-type="callout">강조</button>
      <button type="button" data-action="add-block" data-block-type="quote">인용</button>
      <button type="button" data-action="add-block" data-block-type="list">목록</button>
      <button type="button" data-action="add-block" data-block-type="checklist">체크리스트</button>
      <button type="button" data-action="add-block" data-block-type="code">코드</button>
      <button type="button" data-action="add-block" data-block-type="divider">구분선</button>
      <button type="button" data-action="add-block" data-block-type="table">표</button>
      <button type="button" data-action="add-block" data-block-type="dataset">데이터</button>
      <button type="button" data-action="add-block" data-block-type="flow">플로우</button>
      <button type="button" data-action="add-block" data-block-type="mermaid">Mermaid</button>
      <button type="button" data-action="add-block" data-block-type="drawing">그림판</button>
      <button type="button" data-action="add-block" data-block-type="media">이미지</button>
      <button type="button" data-action="add-block" data-block-type="video">동영상</button>
      <button type="button" data-action="add-block" data-block-type="attachment">첨부</button>
      <button type="button" data-action="add-block" data-block-type="dialogue">대화</button>
      <button type="button" data-action="add-block" data-block-type="calendar">달력</button>
      <button type="button" data-action="add-block" data-block-type="team">팀원</button>
      <button type="button" data-action="add-block" data-block-type="workboard">업무 관리</button>
      <button type="button" data-action="add-block" data-block-type="meetingbook">회의록</button>
      <button type="button" data-action="import-table-block">표 가져오기</button>
      <button type="button" data-action="add-media-block">미디어 추가</button>
    </div>
  `;
}

function renderBlockTextTools(block) {
  const id = escapeHtml(block.id);
  const sizes = [12, 14, 16, 18, 20, 24, 28];
  const colors = ["#202522", "#a33f36", "#2f6f5e", "#2b5d8c", "#7a4f9a"];
  const marks = ["#fff3bf", "#dff3e7", "#dcecf8", "#f8dfda", "#ece4f6"];
  const headingLevelValue = styledHeadingLevel(block);
  return `
    <div class="text-style-tools">
      <select data-block-id="${id}" data-block-style-field="headingLevel" aria-label="문단 제목 단계">
        ${[0, 1, 2, 3].map(value => `<option value="${value}" ${headingLevelValue === value ? "selected" : ""}>${value ? `H${value}` : "본문"}</option>`).join("")}
      </select>
      <select data-block-id="${id}" data-block-style-field="fontSize" aria-label="글자 크기">
        ${sizes.map(size => `<option value="${size}" ${Number(block.fontSize || 16) === size ? "selected" : ""}>${size}</option>`).join("")}
      </select>
      <select data-block-id="${id}" data-block-style-field="textAlign" aria-label="정렬">
        ${["left", "center", "right"].map(value => `<option value="${value}" ${(block.textAlign || "left") === value ? "selected" : ""}>${value === "left" ? "왼쪽" : value === "center" ? "가운데" : "오른쪽"}</option>`).join("")}
      </select>
      <button type="button" data-block-id="${id}" data-block-inline-format="bold"><b>B</b></button>
      <button type="button" data-block-id="${id}" data-block-inline-format="italic"><i>I</i></button>
      <button type="button" data-block-id="${id}" data-block-inline-format="underline"><u>U</u></button>
      <button type="button" data-block-id="${id}" data-block-inline-format="strike"><s>S</s></button>
      <button type="button" data-block-id="${id}" data-block-inline-format="code">{ }</button>
      <button type="button" data-block-id="${id}" data-block-inline-format="link">Link</button>
      <button type="button" data-block-id="${id}" data-block-inline-format="formula">fx</button>
      <button type="button" data-block-id="${id}" data-block-inline-format="wiki">Wiki</button>
      <button type="button" data-block-id="${id}" data-block-inline-format="term" title="선택 글자를 용어로 등록">#</button>
      <button type="button" data-block-id="${id}" data-block-inline-format="bullet">•</button>
      <button type="button" data-block-id="${id}" data-block-inline-format="ordered">1.</button>
      <button type="button" data-block-id="${id}" data-block-inline-format="check">☑</button>
      <button type="button" data-block-id="${id}" data-block-inline-format="clear">Tx</button>
      <button type="button" data-inline-media-insert="1" data-block-id="${id}" data-inline-field="${escapeHtml(block.type === "paragraph" || block.type === "list" ? "text" : "content")}">미디어</button>
      ${sizes.map(size => `<button type="button" data-block-id="${id}" data-block-inline-format="size:${size}">${size}</button>`).join("")}
      ${colors.map(color => `<button type="button" class="swatch-button" style="--swatch:${color}" data-block-id="${id}" data-block-inline-format="color:${color}" title="글자색 ${color}"></button>`).join("")}
      ${marks.map(color => `<button type="button" class="swatch-button mark" style="--swatch:${color}" data-block-id="${id}" data-block-inline-format="mark:${color}" title="배경색 ${color}"></button>`).join("")}
      ${["left", "center", "right"].map(align => `<button type="button" data-block-id="${id}" data-block-inline-format="align:${align}">${align === "left" ? "L" : align === "center" ? "C" : "R"}</button>`).join("")}
      <label>글자 <input type="color" value="${escapeHtml(block.textColor || "#202522")}" data-block-id="${id}" data-block-style-field="textColor"></label>
      <label>배경 <input type="color" value="${escapeHtml(block.highlightColor || "#ffffff")}" data-block-id="${id}" data-block-style-field="highlightColor"></label>
      <button type="button" data-block-style-clear="${id}">Tx</button>
    </div>
  `;
}

function blockStyleAttr(block = {}) {
  const styles = [];
  const fontSize = Number(block.fontSize);
  if ([12, 14, 16, 18, 20, 24, 28].includes(fontSize)) styles.push(`font-size:${fontSize}px`);
  else {
    const headingSize = { 1: 28, 2: 22, 3: 18 }[styledHeadingLevel(block)];
    if (headingSize) styles.push(`font-size:${headingSize}px`, "font-weight:900", "line-height:1.22");
  }
  if (["left", "center", "right"].includes(block.textAlign)) styles.push(`text-align:${block.textAlign}`);
  if (/^#[0-9a-fA-F]{6}$/.test(block.textColor || "")) styles.push(`color:${block.textColor}`);
  if (/^#[0-9a-fA-F]{6}$/.test(block.highlightColor || "") && block.highlightColor !== "#ffffff") styles.push(`background:${block.highlightColor}`);
  return styles.join(";");
}

function imageWidth(block = {}) {
  return normalizeImageWidth(block.imageWidth || 100);
}

function renderEditableCodeBlock(block, options = {}) {
  const blockId = escapeHtml(options.blockId || block.id);
  const unitId = options.unitId ? escapeHtml(options.unitId) : "";
  const idAttrs = `data-block-id="${blockId}"${unitId ? ` data-unit-id="${unitId}"` : ""}`;
  const fieldAttr = unitId ? "data-unit-field" : "data-block-field";
  return `
    <div class="code-editor-wrap">
      <label class="editor-field code-language-field">언어
        <input class="block-input" value="${escapeHtml(block.language || "text")}" ${idAttrs} ${fieldAttr}="language" spellcheck="false">
      </label>
      <textarea class="block-textarea code-editor" rows="8" ${idAttrs} ${fieldAttr}="content" spellcheck="false">${escapeHtml(block.content || block.text || "")}</textarea>
      <pre class="code-preview"><code>${escapeHtml(block.content || block.text || "")}</code></pre>
    </div>
  `;
}

function renderEditableImageFrame(media, target, options = {}) {
  const width = imageWidth(target);
  const blockId = escapeHtml(options.blockId || target.id);
  const unitId = options.unitId ? escapeHtml(options.unitId) : "";
  const unitAttr = unitId ? ` data-unit-id="${unitId}"` : "";
  const fieldAttr = unitId ? "data-unit-field" : "data-block-field";
  return `
    <div class="image-editor" data-image-editor>
      <figure class="editable-media-preview image-frame" data-image-frame style="--image-width:${width}%">
        <div class="image-resize-box" data-image-resize-box>
          <img src="${escapeHtml(media.url)}" alt="${escapeHtml(target.caption || media.title)}">
          <span class="image-resize-handle" data-image-resize-handle data-block-id="${blockId}"${unitAttr} aria-label="이미지 폭 조절"></span>
        </div>
      </figure>
      <label class="editor-field image-size-control">이미지 폭
        <input type="range" min="20" max="100" step="5" value="${width}" data-image-width-control data-block-id="${blockId}"${unitAttr} ${fieldAttr}="imageWidth">
        <output data-image-width-output>${width}%</output>
      </label>
    </div>
  `;
}

function renderDrawingEditor(target, options = {}) {
  const blockId = escapeHtml(options.blockId || target.id || "");
  const unitId = options.unitId ? escapeHtml(options.unitId) : "";
  const unitAttr = unitId ? ` data-unit-id="${unitId}"` : "";
  const fieldAttr = unitId ? "data-unit-field" : "data-block-field";
  const tool = drawingTool(target);
  const rawBrushSize = Number(target.brushSize || 6);
  const brushSize = Number.isFinite(rawBrushSize) ? Math.max(1, Math.min(36, rawBrushSize)) : 6;
  return `
    <div class="drawing-editor" data-drawing-editor="${blockId}${unitId ? `:${unitId}` : ""}">
      <canvas class="drawing-canvas" width="900" height="420" data-drawing-canvas="${unitId || blockId}" data-block-id="${blockId}"${unitAttr}></canvas>
      <div class="drawing-controls">
        <label>도구
          <select data-block-id="${blockId}"${unitAttr} ${fieldAttr}="tool">
            <option value="pen" ${tool === "pen" ? "selected" : ""}>펜</option>
            <option value="eraser" ${tool === "eraser" ? "selected" : ""}>지우개</option>
          </select>
        </label>
        <label>색상 <input type="color" value="${escapeHtml(target.brushColor || "#202522")}" data-block-id="${blockId}"${unitAttr} ${fieldAttr}="brushColor"></label>
        <label>크기 <input type="range" min="1" max="36" value="${brushSize}" data-block-id="${blockId}"${unitAttr} ${fieldAttr}="brushSize"></label>
        <button type="button" data-action="undo-drawing" data-block-id="${blockId}"${unitAttr}>획 되돌리기</button>
        <button type="button" data-action="clear-drawing" data-block-id="${blockId}"${unitAttr}>지우기</button>
      </div>
    </div>
  `;
}

function renderBlocks(blocks = [], options = {}) {
  if (!blocks.length) return empty("본문 블록이 비어 있습니다.");
  const query = searchable(options.query || "");
  const visibleBlocks = query && !state.editMode
    ? blocks.filter(block => blockMatchesQuery(block, query))
    : blocks;
  if (!visibleBlocks.length) return empty("검색어와 일치하는 본문 블록이 없습니다.");
  return visibleBlocks
    .map((block, index) => {
      const highlighted = query && blockMatchesQuery(block, query);
      return state.editMode
        ? renderEditableBlock(block, index, visibleBlocks.length, highlighted)
        : renderReadBlock(block, highlighted);
    })
    .join("");
}

function renderReadBlock(block, highlighted = false) {
  return markSearchHit(renderReadBlockHtml(block), highlighted);
}

function renderReadBlockHtml(block) {
  if (block.type === "generic") return renderGenericBlock(block);
  if (block.type === "heading") {
    const level = Math.min(4, Math.max(2, Number(block.level) + 1));
    return `<section id="doc-block-${escapeHtml(block.id)}" class="doc-block"><h${level}>${escapeHtml(block.text)}</h${level}></section>`;
  }
  if (block.type === "paragraph") return `<section id="doc-block-${escapeHtml(block.id)}" class="doc-block"><div class="rich-text-block" style="${blockStyleAttr(block)}">${renderRichBlockText(block.text)}</div></section>`;
  if (block.type === "callout") return `<aside id="doc-block-${escapeHtml(block.id)}" class="doc-callout"><strong>강조</strong><div class="rich-text-block" style="${blockStyleAttr(block)}">${renderRichBlockText(block.content || block.text || "")}</div></aside>`;
  if (block.type === "quote") return `<blockquote id="doc-block-${escapeHtml(block.id)}" class="doc-quote" style="${blockStyleAttr(block)}">${renderRichBlockText(block.content || block.text || "")}</blockquote>`;
  if (block.type === "list") return `<section id="doc-block-${escapeHtml(block.id)}" class="doc-block bullet-block"><div class="rich-text-block" style="${blockStyleAttr(block)}">${renderRichBlockText(block.text)}</div></section>`;
  if (block.type === "checklist") return renderChecklist(block);
  if (block.type === "code") return `<pre class="code-preview"><code>${escapeHtml(block.content || "")}</code></pre>`;
  if (block.type === "divider") return `<div class="doc-divider"><hr>${block.label ? `<span>${escapeHtml(block.label)}</span>` : ""}</div>`;
  if (block.type === "table") return `<section class="doc-block">${renderTable(block.rows, { source: block })}</section>`;
  if (block.type === "dataset") return renderDatasetBlock(block);
  if (block.type === "flow") return renderFlowPreview(block.content || "");
  if (block.type === "mermaid") return `<div class="mermaid-preview" data-mermaid-source="${escapeHtml(block.content || "")}">${escapeHtml(block.content || "")}</div>`;
  if (block.type === "drawing") return `<figure class="drawing-preview">${block.dataUrl ? `<img src="${escapeHtml(block.dataUrl)}" alt="${escapeHtml(block.caption || "그림판")}">` : `<div>그림판</div>`}<figcaption>${escapeHtml(block.caption || "그림판")}</figcaption></figure>`;
  if (["dialogue", "calendar", "team", "workboard", "meetingbook"].includes(block.type)) return renderPlanningBlock(block);
  if (block.type === "media") {
    const src = mediaSourceForTarget(block);
    if (!src) return "";
    const label = mediaLabelForTarget(block, "이미지");
    const width = imageWidth(block);
    return `
      <figure class="doc-media">
        <img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" loading="lazy" style="width:${width}%">
        <figcaption>${escapeHtml(label)}</figcaption>
      </figure>
    `;
  }
  if (block.type === "video") {
    const src = mediaSourceForTarget(block);
    if (!src) return "";
    const label = mediaLabelForTarget(block, "동영상");
    return `
      <figure class="doc-media">
        <video src="${escapeHtml(src)}" controls></video>
        <figcaption>${escapeHtml(label)}</figcaption>
      </figure>
    `;
  }
  if (block.type === "attachment") {
    const src = mediaSourceForTarget(block);
    const label = mediaLabelForTarget(block, "첨부 파일");
    return `
      <section class="doc-block attachment-block">
        <p><strong>첨부:</strong> ${src ? `<a href="${escapeHtml(src)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label)}</p>
        ${block.content ? `<pre>${escapeHtml(String(block.content).slice(0, 2400))}</pre>` : ""}
      </section>
    `;
  }
  return "";
}

function markSearchHit(html = "", highlighted = false) {
  if (!highlighted || !html) return html;
  if (html.includes('class="')) return html.replace('class="', 'class="search-hit ');
  return `<div class="search-hit">${html}</div>`;
}

function renderEditableBlock(block, index, total, highlighted = false) {
  const blockBody = renderEditableBlockBody(block);
  const renderedBlockBody = canInsertContentIntoBlock(block)
    ? renderSingleContentBlockBody(block.id, blockBody)
    : blockBody;
  return `
    <section id="doc-block-${escapeHtml(block.id)}" class="doc-block edit-block ${highlighted ? "search-hit" : ""}" data-edit-block-id="${escapeHtml(block.id)}">
      <div class="block-edit-head" draggable="true" data-drag-block="${escapeHtml(block.id)}">
        <span>${blockLabel(block.type)}</span>
        <div>
          <button type="button" data-move-block="${escapeHtml(block.id)}" data-direction="-1" ${index === 0 ? "disabled" : ""}>위</button>
          <button type="button" data-move-block="${escapeHtml(block.id)}" data-direction="1" ${index === total - 1 ? "disabled" : ""}>아래</button>
          <button type="button" data-duplicate-block="${escapeHtml(block.id)}">복제</button>
          <button class="danger" type="button" data-delete-block="${escapeHtml(block.id)}">삭제</button>
        </div>
      </div>
      ${renderedBlockBody}
    </section>
  `;
}

function canInsertContentIntoBlock(block = {}) {
  return state.editMode && block.type !== "generic" && CONTENT_INSERT_HOST_TYPES.has(block.type);
}

function renderSingleContentBlockBody(blockId, bodyHtml = "") {
  return `
    <div class="content-stack content-stack-single">
      ${renderContentInsertLine(blockId, 0)}
      <div class="content-unit-single">${bodyHtml}</div>
      ${renderContentInsertLine(blockId, 1)}
    </div>
  `;
}

function renderEditableBlockBody(block) {
  if (block.type === "generic") return renderEditableGenericBlock(block);
  if (block.type === "heading") {
    return `${renderHeadingLevelControl(block.id, "", block.level)}<input class="block-input heading-input" value="${escapeHtml(block.text || "")}" data-block-id="${escapeHtml(block.id)}" data-block-field="text">`;
  }
  if (block.type === "paragraph" || block.type === "list") {
    return `${renderBlockTextTools(block)}<textarea class="block-textarea" rows="4" style="${blockStyleAttr(block)}" data-block-id="${escapeHtml(block.id)}" data-block-field="text">${escapeHtml(block.text || "")}</textarea>${renderInlineMediaManager(block, { blockId: block.id, field: "text" })}`;
  }
  if (["callout", "quote"].includes(block.type)) {
    return `${renderBlockTextTools(block)}<textarea class="block-textarea" rows="5" style="${blockStyleAttr(block)}" data-block-id="${escapeHtml(block.id)}" data-block-field="content">${escapeHtml(block.content || block.text || "")}</textarea>${renderInlineMediaManager(block, { blockId: block.id, field: "content" })}`;
  }
  if (block.type === "checklist") {
    return renderEditableChecklist(block);
  }
  if (block.type === "code") {
    return renderEditableCodeBlock(block);
  }
  if (["flow", "mermaid"].includes(block.type)) {
    return renderDiagramEditor(block.type, block.content || block.text || "", {
      rows: 5,
      blockId: block.id,
      field: "content",
      sampleAction: block.type === "mermaid" ? "mermaid-sample" : "flow-sample"
    });
  }
  if (block.type === "divider") {
    return `<input class="block-input" value="${escapeHtml(block.label || "")}" data-block-id="${escapeHtml(block.id)}" data-block-field="label">`;
  }
  if (block.type === "table") {
    return `
      ${renderTableTools(block, { kind: "table", blockId: block.id, rows: block.rows || [] })}
      ${renderTable(block.rows, { editable: true, source: block, kind: "table", blockId: block.id })}
    `;
  }
  if (block.type === "dataset") {
    return `
      <label class="editor-field">표 데이터
        <select data-block-id="${escapeHtml(block.id)}" data-block-field="collectionId">
          ${archive.collections.map(collection => `<option value="${escapeHtml(collection.id)}" ${collection.id === block.collectionId ? "selected" : ""}>${escapeHtml(collection.title)}</option>`).join("")}
        </select>
      </label>
    `;
  }
  if (block.type === "drawing") {
    return `
      <input class="block-input" value="${escapeHtml(block.caption || "")}" data-block-id="${escapeHtml(block.id)}" data-block-field="caption">
      ${renderDrawingEditor(block, { blockId: block.id })}
    `;
  }
  if (["dialogue", "calendar", "team", "workboard", "meetingbook"].includes(block.type)) {
    const collection = collectionsById.get(block.collectionId);
    return `
      <input class="block-input" value="${escapeHtml(block.title || blockLabel(block.type))}" data-block-id="${escapeHtml(block.id)}" data-block-field="title">
      <label class="editor-field">연결 표
        <select data-block-id="${escapeHtml(block.id)}" data-block-field="collectionId">
          <option value="">직접 입력</option>
          ${archive.collections.map(collection => `<option value="${escapeHtml(collection.id)}" ${collection.id === block.collectionId ? "selected" : ""}>${escapeHtml(collection.title)}</option>`).join("")}
        </select>
      </label>
      ${block.type === "dialogue" ? `
        <label class="editor-field">온기 단계 표
          <select data-block-id="${escapeHtml(block.id)}" data-block-field="stageCollectionId">
            <option value="">자동 감지</option>
            ${archive.collections.map(collection => `<option value="${escapeHtml(collection.id)}" ${collection.id === block.stageCollectionId ? "selected" : ""}>${escapeHtml(collection.title)}</option>`).join("")}
          </select>
        </label>
      ` : ""}
      ${block.type === "meetingbook" ? `
        <label class="editor-field">기본 요일
          <select data-block-id="${escapeHtml(block.id)}" data-block-field="defaultWeekday">
            ${["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"].map(day => `<option value="${day}" ${(block.defaultWeekday || "월요일") === day ? "selected" : ""}>${day}</option>`).join("")}
          </select>
        </label>
        <label class="editor-field">기본 시간
          <input type="time" value="${escapeHtml(block.defaultTime || "22:00")}" data-block-id="${escapeHtml(block.id)}" data-block-field="defaultTime">
        </label>
      ` : ""}
      <textarea class="block-textarea" rows="4" data-block-id="${escapeHtml(block.id)}" data-block-field="content">${escapeHtml(block.content || "")}</textarea>
      ${renderPlanningForm(block)}
      ${collection ? renderPlanningCollection(block.type, collection.rows || [], block) : ""}
    `;
  }
  if (block.type === "media" || block.type === "video") {
    const media = mediaForTarget(block);
    const src = mediaSourceForTarget(block);
    const label = mediaLabelForTarget(block, block.type === "video" ? "동영상" : "이미지");
    return `
      ${src ? (block.type === "video"
        ? `<figure class="editable-media-preview"><video src="${escapeHtml(src)}" controls></video></figure>`
        : renderEditableImageFrame(media || { url: src, title: label }, block, { blockId: block.id })) : `<div class="empty-state">URL/경로를 입력하거나 미디어 파일을 추가하세요.</div>`}
      <div class="inline-tools media-edit-tools">
        <button type="button" data-action="replace-block-media" data-block-id="${escapeHtml(block.id)}" data-media-type="${escapeHtml(block.type)}">파일 선택/교체</button>
        ${src ? `<button class="danger" type="button" data-action="clear-block-media" data-block-id="${escapeHtml(block.id)}">비우기</button>` : ""}
      </div>
      <label class="editor-field media-path-field">URL/경로
        <input class="block-input" value="${escapeHtml(block.path || block.url || "")}" data-block-id="${escapeHtml(block.id)}" data-block-field="path" placeholder="${block.type === "video" ? "sample.mp4 또는 https://..." : "image.png 또는 https://..."}">
      </label>
      <input class="block-input" value="${escapeHtml(block.caption || "")}" data-block-id="${escapeHtml(block.id)}" data-block-field="caption">
    `;
  }
  if (block.type === "attachment") {
    const src = mediaSourceForTarget(block);
    const label = mediaLabelForTarget(block, "첨부 파일");
    return `
      ${src ? `<p class="attachment-link-preview"><a href="${escapeHtml(src)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a></p>` : ""}
      <div class="inline-tools media-edit-tools">
        <button type="button" data-action="replace-block-media" data-block-id="${escapeHtml(block.id)}" data-media-type="attachment">파일 선택/교체</button>
        ${src ? `<button class="danger" type="button" data-action="clear-block-media" data-block-id="${escapeHtml(block.id)}">비우기</button>` : ""}
      </div>
      <label class="editor-field media-path-field">파일 URL/경로
        <input class="block-input" value="${escapeHtml(block.path || block.url || "")}" data-block-id="${escapeHtml(block.id)}" data-block-field="path" placeholder="file.pdf 또는 https://...">
      </label>
      <input class="block-input" value="${escapeHtml(block.text || block.fileName || "")}" data-block-id="${escapeHtml(block.id)}" data-block-field="text">
      <textarea class="block-textarea" rows="5" data-block-id="${escapeHtml(block.id)}" data-block-field="content">${escapeHtml(block.content || "")}</textarea>
    `;
  }
  return "";
}

function renderHeadingLevelControl(blockId, unitId = "", currentLevel = 1) {
  const block = escapeHtml(blockId);
  const unit = unitId ? ` data-unit-id="${escapeHtml(unitId)}"` : "";
  const field = unitId ? "data-unit-field" : "data-block-field";
  const level = headingLevel({ level: currentLevel });
  return `
    <label class="editor-field heading-level-field">제목 단계
      <select data-block-id="${block}"${unit} ${field}="level">
        ${[1, 2, 3].map(value => `<option value="${value}" ${level === value ? "selected" : ""}>H${value}</option>`).join("")}
      </select>
    </label>
  `;
}

function renderChecklist(block) {
  const items = checklistItems(block);
  return `
    <section class="checklist-block">
      ${items.map(item => `<label><input type="checkbox" disabled ${item.checked ? "checked" : ""}> <span>${escapeHtml(item.text)}</span></label>`).join("")}
    </section>
  `;
}

function renderEditableChecklist(block) {
  const items = checklistItems(block);
  return `
    <div class="checklist-editor">
      ${items.map((item, index) => `
        <label class="checklist-edit-row">
          <input type="checkbox" data-block-id="${escapeHtml(block.id)}" data-check-item="${index}" ${item.checked ? "checked" : ""}>
          <input type="text" value="${escapeHtml(item.text)}" data-block-id="${escapeHtml(block.id)}" data-check-text="${index}">
        </label>
      `).join("")}
      <button type="button" data-check-add="${escapeHtml(block.id)}">항목 추가</button>
    </div>
  `;
}

function checklistItems(block) {
  return String(block.content || block.text || "- [ ] 확인할 항목")
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => ({
      checked: /^\s*-\s*\[[xX]\]/.test(line),
      text: line.replace(/^\s*-\s*\[[ xX]\]\s*/, "").trim() || "확인할 항목"
    }));
}

function writeChecklistItems(block, items) {
  block.content = items.map(item => `- [${item.checked ? "x" : " "}] ${item.text || "확인할 항목"}`).join("\n");
}

function renderGenericBlock(block) {
  const items = Array.isArray(block.items) && block.items.length ? block.items : [createContentUnit("paragraph")];
  return `
    <section id="doc-block-${escapeHtml(block.id)}" class="generic-block">
      ${items.map(unit => `<div id="doc-unit-${escapeHtml(unit.id)}" class="content-unit content-unit-${escapeHtml(unit.type)}">${renderReadBlock(unit)}</div>`).join("")}
    </section>
  `;
}

function renderEditableGenericBlock(block) {
  const items = Array.isArray(block.items) && block.items.length ? block.items : [createContentUnit("paragraph")];
  block.items = items;
  return `
    <div class="content-stack">
      ${renderContentInsertLine(block.id, 0)}
      ${items.map((unit, index) => `
        <section id="doc-unit-${escapeHtml(unit.id)}" class="content-unit content-unit-${escapeHtml(unit.type)}" data-unit-id="${escapeHtml(unit.id)}" data-content-unit-id="${escapeHtml(unit.id)}">
          <div class="content-unit-head" draggable="true" data-drag-unit="${escapeHtml(unit.id)}" data-content-block-id="${escapeHtml(block.id)}">
            <strong>${escapeHtml(blockLabel(unit.type))}</strong>
            <div>
              <button type="button" data-content-action="move-up" data-content-block-id="${escapeHtml(block.id)}" data-unit-id="${escapeHtml(unit.id)}" ${index === 0 ? "disabled" : ""}>위</button>
              <button type="button" data-content-action="move-down" data-content-block-id="${escapeHtml(block.id)}" data-unit-id="${escapeHtml(unit.id)}" ${index === items.length - 1 ? "disabled" : ""}>아래</button>
              <button type="button" data-content-action="duplicate" data-content-block-id="${escapeHtml(block.id)}" data-unit-id="${escapeHtml(unit.id)}">복제</button>
              <button class="danger" type="button" data-content-action="delete" data-content-block-id="${escapeHtml(block.id)}" data-unit-id="${escapeHtml(unit.id)}">삭제</button>
            </div>
          </div>
          ${renderEditableContentUnit(block.id, unit)}
        </section>
        ${renderContentInsertLine(block.id, index + 1)}
      `).join("")}
    </div>
  `;
}

function renderContentInsertLine(blockId, index) {
  return `
    <div class="content-insert-line" data-insert-surface="content">
      ${CONTENT_INSERT_TYPES.map(type => `<button type="button" data-content-insert-type="${escapeHtml(type)}" data-content-block-id="${escapeHtml(blockId)}" data-content-insert-index="${index}">${escapeHtml(blockLabel(type))}</button>`).join("")}
    </div>
  `;
}

function renderEditableContentUnit(blockId, unit) {
  const id = escapeHtml(unit.id);
  if (unit.type === "heading") return `${renderHeadingLevelControl(blockId, unit.id, unit.level)}<input class="block-input heading-input" value="${escapeHtml(unit.text || "")}" data-block-id="${escapeHtml(blockId)}" data-unit-id="${id}" data-unit-field="text">`;
  if (unit.type === "paragraph" || unit.type === "list") return `${renderUnitTextTools(blockId, unit, "text")}<textarea class="block-textarea" rows="3" data-block-id="${escapeHtml(blockId)}" data-unit-id="${id}" data-unit-field="text">${escapeHtml(unit.text || "")}</textarea>${renderInlineMediaManager(unit, { blockId, unitId: unit.id, field: "text" })}`;
  if (["callout", "quote"].includes(unit.type)) return `${renderUnitTextTools(blockId, unit, "content")}<textarea class="block-textarea" rows="4" data-block-id="${escapeHtml(blockId)}" data-unit-id="${id}" data-unit-field="content">${escapeHtml(unit.content || unit.text || "")}</textarea>${renderInlineMediaManager(unit, { blockId, unitId: unit.id, field: "content" })}`;
  if (unit.type === "code") return renderEditableCodeBlock(unit, { blockId, unitId: unit.id });
  if (unit.type === "flow" || unit.type === "mermaid") return `
    ${renderDiagramEditor(unit.type, unit.content || unit.text || "", {
      rows: 4,
      blockId,
      unitId: unit.id,
      field: "content",
      sampleAction: unit.type === "mermaid" ? "mermaid-sample" : "flow-sample"
    })}
  `;
  if (unit.type === "checklist") return `<textarea class="block-textarea" rows="4" data-block-id="${escapeHtml(blockId)}" data-unit-id="${id}" data-unit-field="content">${escapeHtml(unit.content || unit.text || "")}</textarea>`;
  if (unit.type === "divider") return `<input class="block-input" value="${escapeHtml(unit.label || "")}" data-block-id="${escapeHtml(blockId)}" data-unit-id="${id}" data-unit-field="label">`;
  if (unit.type === "table") return renderUnitTable(blockId, unit);
  if (unit.type === "dataset") {
    return `
      <label class="editor-field">표 데이터
        <select data-block-id="${escapeHtml(blockId)}" data-unit-id="${id}" data-unit-field="collectionId">
          ${archive.collections.map(collection => `<option value="${escapeHtml(collection.id)}" ${collection.id === unit.collectionId ? "selected" : ""}>${escapeHtml(collection.title)}</option>`).join("")}
        </select>
      </label>
    `;
  }
  if (unit.type === "drawing") {
    return `
      <input class="block-input" value="${escapeHtml(unit.caption || "")}" data-block-id="${escapeHtml(blockId)}" data-unit-id="${id}" data-unit-field="caption">
      ${renderDrawingEditor(unit, { blockId, unitId: unit.id })}
    `;
  }
  if (unit.type === "media" || unit.type === "video") {
    const media = mediaForTarget(unit);
    const src = mediaSourceForTarget(unit);
    const label = mediaLabelForTarget(unit, unit.type === "video" ? "동영상" : "이미지");
    return `
      ${src ? (unit.type === "video"
        ? `<figure class="editable-media-preview"><video src="${escapeHtml(src)}" controls></video></figure>`
        : renderEditableImageFrame(media || { url: src, title: label }, unit, { blockId, unitId: unit.id })) : `<div class="empty-state">URL/경로를 입력하거나 미디어 파일을 추가하세요.</div>`}
      <div class="inline-tools media-edit-tools">
        <button type="button" data-action="replace-block-media" data-block-id="${escapeHtml(blockId)}" data-unit-id="${id}" data-media-type="${escapeHtml(unit.type)}">파일 선택/교체</button>
        ${src ? `<button class="danger" type="button" data-action="clear-block-media" data-block-id="${escapeHtml(blockId)}" data-unit-id="${id}">비우기</button>` : ""}
      </div>
      <label class="editor-field media-path-field">URL/경로
        <input class="block-input" value="${escapeHtml(unit.path || unit.url || "")}" data-block-id="${escapeHtml(blockId)}" data-unit-id="${id}" data-unit-field="path" placeholder="${unit.type === "video" ? "sample.mp4 또는 https://..." : "image.png 또는 https://..."}">
      </label>
      <input class="block-input" value="${escapeHtml(unit.caption || "")}" data-block-id="${escapeHtml(blockId)}" data-unit-id="${id}" data-unit-field="caption">
    `;
  }
  if (unit.type === "attachment") {
    const src = mediaSourceForTarget(unit);
    const label = mediaLabelForTarget(unit, "첨부 파일");
    return `
      ${src ? `<p class="attachment-link-preview"><a href="${escapeHtml(src)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a></p>` : ""}
      <div class="inline-tools media-edit-tools">
        <button type="button" data-action="replace-block-media" data-block-id="${escapeHtml(blockId)}" data-unit-id="${id}" data-media-type="attachment">파일 선택/교체</button>
        ${src ? `<button class="danger" type="button" data-action="clear-block-media" data-block-id="${escapeHtml(blockId)}" data-unit-id="${id}">비우기</button>` : ""}
      </div>
      <label class="editor-field media-path-field">파일 URL/경로
        <input class="block-input" value="${escapeHtml(unit.path || unit.url || "")}" data-block-id="${escapeHtml(blockId)}" data-unit-id="${id}" data-unit-field="path" placeholder="file.pdf 또는 https://...">
      </label>
      <input class="block-input" value="${escapeHtml(unit.text || unit.fileName || "")}" data-block-id="${escapeHtml(blockId)}" data-unit-id="${id}" data-unit-field="text">
      <textarea class="block-textarea" rows="5" data-block-id="${escapeHtml(blockId)}" data-unit-id="${id}" data-unit-field="content">${escapeHtml(unit.content || "")}</textarea>
    `;
  }
  return "";
}

function renderUnitInlineMediaTool(blockId, unit, field) {
  return renderUnitTextTools(blockId, unit, field);
}

function renderUnitTextTools(blockId, unit, field) {
  const block = escapeHtml(blockId);
  const unitId = escapeHtml(unit.id);
  const sizes = [12, 14, 16, 18, 20, 24, 28];
  const colors = ["#202522", "#a33f36", "#2f6f5e", "#2b5d8c", "#7a4f9a"];
  const marks = ["#fff3bf", "#dff3e7", "#dcecf8", "#f8dfda", "#ece4f6"];
  const headingLevelValue = styledHeadingLevel(unit);
  return `
    <div class="text-style-tools unit-text-tools">
      <select data-block-id="${block}" data-unit-id="${unitId}" data-unit-field="headingLevel" aria-label="문단 제목 단계">
        ${[0, 1, 2, 3].map(value => `<option value="${value}" ${headingLevelValue === value ? "selected" : ""}>${value ? `H${value}` : "본문"}</option>`).join("")}
      </select>
      <button type="button" data-block-id="${block}" data-unit-id="${unitId}" data-unit-inline-format="bold"><b>B</b></button>
      <button type="button" data-block-id="${block}" data-unit-id="${unitId}" data-unit-inline-format="italic"><i>I</i></button>
      <button type="button" data-block-id="${block}" data-unit-id="${unitId}" data-unit-inline-format="underline"><u>U</u></button>
      <button type="button" data-block-id="${block}" data-unit-id="${unitId}" data-unit-inline-format="strike"><s>S</s></button>
      <button type="button" data-block-id="${block}" data-unit-id="${unitId}" data-unit-inline-format="code">{ }</button>
      <button type="button" data-block-id="${block}" data-unit-id="${unitId}" data-unit-inline-format="link">Link</button>
      <button type="button" data-block-id="${block}" data-unit-id="${unitId}" data-unit-inline-format="formula">fx</button>
      <button type="button" data-block-id="${block}" data-unit-id="${unitId}" data-unit-inline-format="wiki">Wiki</button>
      <button type="button" data-block-id="${block}" data-unit-id="${unitId}" data-unit-inline-format="term" title="선택 글자를 용어로 등록">#</button>
      <button type="button" data-block-id="${block}" data-unit-id="${unitId}" data-unit-inline-format="bullet">•</button>
      <button type="button" data-block-id="${block}" data-unit-id="${unitId}" data-unit-inline-format="ordered">1.</button>
      <button type="button" data-block-id="${block}" data-unit-id="${unitId}" data-unit-inline-format="check">☑</button>
      <button type="button" data-block-id="${block}" data-unit-id="${unitId}" data-unit-inline-format="clear">Tx</button>
      <button type="button" data-inline-media-insert="1" data-block-id="${block}" data-unit-id="${unitId}" data-inline-field="${escapeHtml(field)}">미디어</button>
      ${sizes.map(size => `<button type="button" data-block-id="${block}" data-unit-id="${unitId}" data-unit-inline-format="size:${size}">${size}</button>`).join("")}
      ${colors.map(color => `<button type="button" class="swatch-button" style="--swatch:${color}" data-block-id="${block}" data-unit-id="${unitId}" data-unit-inline-format="color:${color}" title="글자색 ${color}"></button>`).join("")}
      ${marks.map(color => `<button type="button" class="swatch-button mark" style="--swatch:${color}" data-block-id="${block}" data-unit-id="${unitId}" data-unit-inline-format="mark:${color}" title="배경색 ${color}"></button>`).join("")}
      ${["left", "center", "right"].map(align => `<button type="button" data-block-id="${block}" data-unit-id="${unitId}" data-unit-inline-format="align:${align}">${align === "left" ? "L" : align === "center" ? "C" : "R"}</button>`).join("")}
    </div>
  `;
}

function renderUnitTable(blockId, unit) {
  const rows = unit.rows || [["항목", "내용"], ["", ""]];
  return `
    ${renderTableTools(unit, { kind: "unit", blockId, unitId: unit.id, rows })}
    ${renderTable(rows, { editable: true, source: unit, kind: "unit", blockId, unitId: unit.id })}
  `;
}

function renderDatasetBlock(block) {
  const collection = collectionsById.get(block.collectionId) || archive.collections[0];
  if (!collection) return empty("연결된 표 데이터가 없습니다.");
  const rows = collection.rows || [];
  const rowCount = Number(collection.rowCount || rows.length || 0);
  const columnCount = Number(collection.columnCount || Math.max(0, ...rows.map(row => row.length)) || 0);
  const title = block.title || collection.title || "표 데이터";
  return `
    <section class="dataset-block dataset-drawer-block">
      <details class="dataset-drawer" open>
        <summary class="dataset-drawer-summary">
          <span class="dataset-drawer-title">
            <strong>${escapeHtml(title)}</strong>
            <small>${escapeHtml(collection.categoryLabel || "표 데이터")} · ${rowCount.toLocaleString("ko-KR")}행 · ${columnCount.toLocaleString("ko-KR")}열</small>
          </span>
          <span class="dataset-drawer-state" aria-hidden="true">
            <span class="drawer-closed">표 보기</span>
            <span class="drawer-open">표 접기</span>
          </span>
        </summary>
        <div class="dataset-drawer-body">
          ${collection.sourcePath ? `<p class="source-note">${escapeHtml(collection.sourcePath)}</p>` : ""}
          ${renderTable(rows, { source: collection })}
        </div>
      </details>
    </section>
  `;
}

function renderPlanningBlock(block) {
  const collection = collectionsById.get(block.collectionId);
  const rows = collection?.rows || [];
  const showQuickForm = state.editMode || ["workboard", "meetingbook"].includes(block.type);
  return `
    <section class="planning-block planning-${escapeHtml(block.type)}">
      <div class="tag-row">
        <span class="tag">${escapeHtml(blockLabel(block.type))}</span>
        ${collection ? `<span class="tag">${escapeHtml(collection.title)}</span>` : ""}
      </div>
      <h3>${escapeHtml(block.title || blockLabel(block.type))}</h3>
      ${block.content ? `<p>${renderInlineText(block.content)}</p>` : ""}
      ${collection ? renderPlanningCollection(block.type, rows, block) : `<p>${escapeHtml(`${blockLabel(block.type)} 블록입니다.`)}</p>`}
      ${showQuickForm ? renderPlanningForm(block) : ""}
    </section>
  `;
}

function renderPlanningCollection(type, rows = [], block = {}) {
  if (!rows.length) return empty("연결된 표가 비어 있습니다.");
  if (type === "calendar") return renderCalendarRows(rows, block);
  if (type === "team") return renderTeamRows(rows);
  if (type === "workboard") return renderWorkRows(rows, block);
  if (type === "meetingbook") return renderMeetingRows(rows, block);
  if (type === "dialogue") return renderDialogueRows(rows, block);
  return renderTable(rows);
}

function renderWiki() {
  const terms = uniqueTerms(buildTermIndex())
    .filter(item => !state.query || searchable(termSearchBlob(item)).includes(searchable(state.query)))
    .sort((a, b) => a.term.localeCompare(b.term, "ko-KR"));
  if (state.selectedWikiTerm) state.selectedWikiTerm = canonicalWikiTerm(state.selectedWikiTerm);
  if (!terms.some(item => item.term === state.selectedWikiTerm)) {
    state.selectedWikiTerm = terms[0]?.term || "";
  }
  const selected = state.selectedWikiTerm
    ? terms.find(item => item.term === state.selectedWikiTerm) || terms[0]
    : terms[0];
  const saved = findGlossaryTerm(selected?.term);
  const selectedAliases = saved ? glossaryAliases(saved) : parseAliases(selected?.aliases || []);
  const related = selected
    ? buildTermIndex().filter(item => item.term === selected.term).slice(0, 10)
    : [];
  const indexedDocs = related
    .map(item => docsById.get(item.docId))
    .filter(Boolean)
    .filter((doc, index, list) => list.findIndex(item => item.id === doc.id) === index);
  const mentionDocs = saved || selected
    ? documentMentionsForTerm(saved || { keyword: selected.term, aliases: selectedAliases })
    : [];
  const relatedDocs = [...new Map([...indexedDocs, ...mentionDocs].map(doc => [doc.id, doc])).values()].slice(0, 16);
  const selectedTermRecord = saved || (selected ? { keyword: selected.term, aliases: selectedAliases, description: selected.context, context: selected.context } : {});
  const glossaryTermCandidates = terms.filter(item => findGlossaryTerm(item.term));
  const relatedTerms = selected ? relatedTermsForTerm(selectedTermRecord, glossaryTermCandidates) : [];
  const termCategoryLabel = saved?.docId
    ? docsById.get(saved.docId)?.categoryLabel || "위키"
    : selected?.docId
      ? docsById.get(selected.docId)?.categoryLabel || selected.context || "위키"
      : "위키";
  const initial = selected?.term ? selected.term[0].toLocaleUpperCase("ko-KR") : "-";

  return `
    <section class="surface page-head-card">
      <div>
        <h1>위키</h1>
        <p>${terms.length.toLocaleString("ko-KR")}개 용어와 문서 제목을 가나다순으로 정리했습니다.</p>
      </div>
      <div class="head-actions">
        <button type="button" data-action="clear-filters">검색 초기화</button>
        <button class="primary-action" type="button" data-action="open-terms">용어 저장</button>
      </div>
    </section>
    ${selected ? `
      <article class="surface wiki-article">
        <div class="surface-head">
          <div>
            ${state.editMode ? `
              <label class="editor-field">용어
                <input value="${escapeHtml(saved?.keyword || selected.term)}" data-wiki-field="keyword">
              </label>
              <label class="editor-field">별칭
                <input value="${escapeHtml(aliasesText(selectedAliases))}" data-wiki-field="aliases">
              </label>
            ` : `<h1>${escapeHtml(selected.term)}</h1>`}
            <p>${escapeHtml(selected.context || "문서에서 추출한 용어")}</p>
          </div>
        </div>
        <div class="surface-body">
          <div class="wiki-layout">
            <main class="wiki-main">
              ${selectedAliases.length ? `
                <div class="tag-row wiki-aliases">
                  <span class="tag">별칭</span>
                  ${selectedAliases.map(alias => `<button type="button" data-wiki-term="${escapeHtml(alias)}">${escapeHtml(alias)}</button>`).join("")}
                </div>
              ` : ""}
              ${state.editMode ? `
                <label class="editor-field full">설명
                  <textarea rows="4" data-wiki-field="description">${escapeHtml(saved?.description || selected.context || "")}</textarea>
                </label>
              ` : `<p class="wiki-description">${escapeHtml(saved?.description || selected.context || "설명이 아직 없습니다.")}</p>`}
              <h3>문서 내 등장 위치</h3>
              <div class="tag-row wiki-link-list">
                ${relatedDocs.map(doc => `<button type="button" data-doc="${escapeHtml(doc.id)}">${escapeHtml(doc.title)}</button>`).join("") || empty("연결된 문서가 없습니다.")}
              </div>
              <h3>관련 용어</h3>
              <div class="tag-row wiki-link-list">
                ${relatedTerms.map(item => `<button type="button" data-wiki-term="${escapeHtml(item.term)}">${escapeHtml(item.term)}</button>`).join("") || empty("관련 용어가 아직 없습니다.")}
              </div>
            </main>
            <aside class="wiki-infobox">
              <div class="wiki-info-row"><span>분류</span><strong>${escapeHtml(termCategoryLabel)}</strong></div>
              <div class="wiki-info-row"><span>별칭</span><strong>${escapeHtml(aliasesText(selectedAliases) || "-")}</strong></div>
              <div class="wiki-info-row"><span>링크</span><strong>${mentionDocs.length.toLocaleString("ko-KR")}곳</strong></div>
              <div class="wiki-info-row"><span>정렬</span><strong>${escapeHtml(initial)}</strong></div>
            </aside>
          </div>
        </div>
      </article>
    ` : empty("표시할 용어가 없습니다.")}
    <section class="surface">
      <div class="surface-head">
        <div>
          <h2>용어 인덱스</h2>
          <p>용어를 선택하면 위키 문서가 열립니다.</p>
        </div>
      </div>
      <div class="surface-body">
        <div class="wiki-index-grid">
          ${terms.map(item => `
            <button class="wiki-term-card ${item.term === state.selectedWikiTerm ? "active" : ""}" type="button" data-wiki-term="${escapeHtml(item.term)}">
              <strong>${escapeHtml(item.term)}</strong>
              <small>${escapeHtml(item.aliases?.length ? `별칭: ${aliasesText(item.aliases)}` : item.context)}</small>
            </button>
          `).join("") || empty("검색 결과가 없습니다.")}
        </div>
      </div>
    </section>
  `;
}

function calendarEventFromRecord(record = {}, headers = []) {
  const dateKey = bestHeader(headers, ["날짜", "일자", "date", "day", "start"]);
  const endKey = bestHeader(headers, ["종료일", "끝나는 날", "종료", "end", "finish"]);
  const titleKey = bestHeader(headers, ["제목", "일정", "업무", "title", "name"]);
  const categoryKey = matchingHeader(headers, ["분류", "유형", "category", "type"]);
  const statusKey = matchingHeader(headers, ["상태", "status"]);
  const ownerKey = matchingHeader(headers, ["담당", "담당자", "owner", "member"]);
  const noteKey = matchingHeader(headers, ["메모", "비고", "note"]);
  const date = normalizeDateKey(record[dateKey]);
  if (!date) return null;
  const rawEndDate = normalizeDateKey(record[endKey]);
  const endDate = rawEndDate && rawEndDate.localeCompare(date) >= 0 ? rawEndDate : date;
  return {
    title: record[titleKey] || record[headers[0]] || "일정",
    date,
    endDate,
    rawDate: endDate !== date
      ? `${record[dateKey] || date} ~ ${record[endKey] || endDate}`
      : record[dateKey] || date,
    category: record[categoryKey] || "",
    status: record[statusKey] || "",
    owner: record[ownerKey] || "",
    note: record[noteKey] || "",
    source: "calendar"
  };
}

function planningCollectionsForType(type = "", keywords = []) {
  const ids = new Set();
  for (const doc of archive.documents || []) {
    for (const block of doc.blocks || []) {
      if (block.type === type && block.collectionId) ids.add(block.collectionId);
    }
  }
  const match = findCollectionByKeyword(keywords);
  if (match?.id) ids.add(match.id);
  return [...ids].map(id => collectionsById.get(id)).filter(Boolean);
}

function workCalendarEventsFromCollection(collection) {
  const { headers, records } = rowsToRecords(collection?.rows || []);
  if (!headers.length || !records.length) return [];
  const titleKey = preferredHeader(headers, ["제목", "업무", "할일", "task", "title"], { reject: ["id", "아이디"] });
  const statusKey = bestHeader(headers, ["상태", "status"]);
  const ownerKey = bestHeader(headers, ["담당", "담당자", "owner", "member"]);
  const dueKey = bestHeader(headers, ["마감", "기한", "due", "deadline", "date", "날짜"]);
  const priorityKey = bestHeader(headers, ["우선순위", "우선", "priority"]);
  const projectKey = bestHeader(headers, ["프로젝트", "project"]);
  const noteKey = bestHeader(headers, ["메모", "비고", "note"]);
  const progressKey = bestHeader(headers, ["진행률", "진척도", "progress"]);
  const checklistKey = bestHeader(headers, ["체크리스트", "하위항목", "checklist", "todo"]);
  return records
    .map(record => workTaskFromRecord(record, { titleKey, statusKey, ownerKey, dueKey, priorityKey, projectKey, noteKey, progressKey, checklistKey }, headers))
    .map(task => {
      const date = normalizeDateKey(task.due);
      if (!date) return null;
      return {
        title: `TODO: ${task.title}`,
        date,
        endDate: date,
        rawDate: task.due,
        category: "업무",
        status: task.status,
        owner: task.owner,
        note: task.note,
        source: "task"
      };
    })
    .filter(Boolean);
}

function meetingCalendarEventsFromCollection(collection) {
  const { headers, records } = rowsToRecords(collection?.rows || []);
  if (!headers.length || !records.length) return [];
  const titleKey = preferredHeader(headers, ["회의명", "안건", "제목", "회의", "meeting", "title"], { reject: ["id", "아이디"] });
  const dateKey = bestHeader(headers, ["날짜", "일자", "date", "day"]);
  const timeKey = matchingHeader(headers, ["시간", "time"]);
  const attendeeKey = matchingHeader(headers, ["참석자", "참석", "attendees", "member"]);
  const statusKey = matchingHeader(headers, ["상태", "status"]);
  const agendaKey = matchingHeader(headers, ["안건", "agenda"]);
  return records
    .map(record => {
      const date = normalizeDateKey(record[dateKey]);
      if (!date) return null;
      const title = record[titleKey] || record[headers[0]] || "회의";
      return {
        title: `회의: ${title}`,
        date,
        endDate: date,
        rawDate: [record[dateKey], record[timeKey]].filter(Boolean).join(" "),
        category: "회의",
        status: displayMeetingStatus(record[statusKey] || "예정", date, record[timeKey] || ""),
        owner: record[attendeeKey] || "",
        note: agendaKey ? record[agendaKey] || "" : "",
        source: "meeting"
      };
    })
    .filter(Boolean);
}

function integratedCalendarEvents(rows = []) {
  const { headers, records } = rowsToRecords(rows);
  const baseEvents = records.map(record => calendarEventFromRecord(record, headers)).filter(Boolean);
  const taskEvents = planningCollectionsForType("workboard", ["task", "todo"]).flatMap(workCalendarEventsFromCollection);
  const meetingEvents = planningCollectionsForType("meetingbook", ["meeting"]).flatMap(meetingCalendarEventsFromCollection);
  return [...baseEvents, ...taskEvents, ...meetingEvents]
    .sort((a, b) => String(a.date).localeCompare(String(b.date), "ko") || String(a.title).localeCompare(String(b.title), "ko"));
}

function calendarEventOccursOnDay(event = {}, dayKey = "") {
  const start = event.date || "";
  const end = event.endDate || start;
  return start && dayKey >= start && dayKey <= end;
}

function calendarMonthBounds(monthKey = currentMonthKey()) {
  const [year, month] = String(monthKey || currentMonthKey()).split("-").map(Number);
  const base = new Date(Number.isFinite(year) ? year : new Date().getFullYear(), (Number.isFinite(month) ? month : new Date().getMonth() + 1) - 1, 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return {
    startKey: dateKeyFromDate(base),
    endKey: dateKeyFromDate(end)
  };
}

function calendarEventsForMonth(events = [], monthKey = currentMonthKey()) {
  const bounds = calendarMonthBounds(monthKey);
  return events.filter(event => {
    const start = event.date || "";
    const end = event.endDate || start;
    return start && start <= bounds.endKey && end >= bounds.startKey;
  });
}

function calendarEventSourceLabel(source = "") {
  if (source === "task") return "업무";
  if (source === "meeting") return "회의";
  return "";
}

function renderCalendarRows(rows, block = {}) {
  const events = integratedCalendarEvents(rows);
  const month = block.month || currentMonthKey();
  const monthEvents = calendarEventsForMonth(events, month);
  const doneCount = monthEvents.filter(event => /완료|done|complete/i.test(event.status || "")).length;
  const activeCount = monthEvents.filter(event => /진행|검토|active|progress|review/i.test(event.status || "")).length;
  const taskDueCount = monthEvents.filter(event => event.source === "task").length;
  const meetingCount = monthEvents.filter(event => event.source === "meeting").length;
  const days = calendarDays(month);
  return `
    <div class="planning-controls">
      <button type="button" data-action="calendar-shift" data-block-id="${escapeHtml(block.id || "")}" data-month-delta="-1">이전</button>
      <strong>${escapeHtml(month)}</strong>
      <button type="button" data-action="calendar-shift" data-block-id="${escapeHtml(block.id || "")}" data-month-delta="1">다음</button>
      <button type="button" data-action="calendar-today" data-block-id="${escapeHtml(block.id || "")}">오늘</button>
    </div>
    <div class="work-summary calendar-summary">
      <div class="work-summary-card"><strong>${monthEvents.length}</strong><span>전체</span></div>
      <div class="work-summary-card"><strong>${activeCount}</strong><span>진행</span></div>
      <div class="work-summary-card"><strong>${doneCount}</strong><span>완료</span></div>
      <div class="work-summary-card"><strong>${taskDueCount}</strong><span>업무 마감</span></div>
      <div class="work-summary-card"><strong>${meetingCount}</strong><span>회의</span></div>
    </div>
    <div class="calendar-mini-grid">
      ${["월", "화", "수", "목", "금", "토", "일"].map(day => `<span class="calendar-mini-head">${day}</span>`).join("")}
      ${days.map(day => {
        const dayRecords = monthEvents.filter(event => calendarEventOccursOnDay(event, day.key));
        return `
          <article class="calendar-mini-day ${day.outside ? "outside" : ""} ${day.today ? "today" : ""}">
            <strong>${day.day}</strong>
            ${dayRecords.slice(0, 3).map(event => `<span class="calendar-event-chip source-${escapeHtml(event.source)}">${escapeHtml(event.title || "일정")}</span>`).join("")}
          </article>
        `;
      }).join("")}
    </div>
    <div class="planning-list calendar-list">
      ${monthEvents.slice(0, 24).map(event => `
        <article class="planning-card">
          <strong>${escapeHtml(event.title || "일정")}</strong>
          <span>${escapeHtml(event.rawDate || event.date || "")}</span>
          <small>${escapeHtml([event.status, event.owner, event.category, calendarEventSourceLabel(event.source)].filter(Boolean).join(" · "))}</small>
          ${event.note ? `<p>${renderInlineText(event.note)}</p>` : ""}
        </article>
      `).join("") || empty("이번 달 일정이 없습니다.")}
    </div>
  `;
}

function workTasksFromRows(rows = []) {
  const { headers, records } = rowsToRecords(rows);
  if (!headers.length) return [];
  const titleKey = preferredHeader(headers, ["제목", "업무", "할일", "task", "title"], { reject: ["id", "아이디"] });
  const statusKey = bestHeader(headers, ["상태", "status"]);
  const ownerKey = bestHeader(headers, ["담당", "담당자", "owner"]);
  const dueKey = bestHeader(headers, ["마감", "기한", "due", "날짜"]);
  const priorityKey = bestHeader(headers, ["우선순위", "우선", "priority"]);
  const projectKey = bestHeader(headers, ["프로젝트", "project"]);
  const noteKey = bestHeader(headers, ["메모", "비고", "note"]);
  const progressKey = bestHeader(headers, ["진행률", "진척도", "progress"]);
  const checklistKey = bestHeader(headers, ["체크리스트", "하위항목", "checklist", "todo"]);
  return records.map(record => workTaskFromRecord(record, {
    titleKey,
    statusKey,
    ownerKey,
    dueKey,
    priorityKey,
    projectKey,
    noteKey,
    progressKey,
    checklistKey
  }, headers));
}

function renderTeamRows(rows) {
  const { headers, records } = rowsToRecords(rows);
  const nameKey = bestHeader(headers, ["이름", "팀원", "name"]);
  const roleKey = bestHeader(headers, ["역할", "직무", "role"]);
  const noteKey = bestHeader(headers, ["메모", "비고", "note"]);
  const statusKey = bestHeader(headers, ["상태", "status"]);
  const contactKey = bestHeader(headers, ["연락처", "이메일", "contact", "email"]);
  const focusKey = bestHeader(headers, ["담당", "분야", "focus", "part"]);
  const colorKey = matchingHeader(headers, ["색상", "컬러", "color"]);
  const activeCount = records.filter(record => /활성|active|진행/i.test(record[statusKey] || "")).length;
  const tasks = planningCollectionsForType("workboard", ["task", "todo"]).flatMap(collection => workTasksFromRows(collection.rows || []));
  return `
    <div class="team-roster">
      <div class="team-roster-summary">
        <span>전체 ${records.length}명</span>
        <span>활성 ${activeCount}명</span>
      </div>
      <div class="team-member-grid">
        ${records.slice(0, 24).map(record => {
          const name = record[nameKey] || record[headers[0]] || "팀원";
          const color = safeTeamColor(colorKey ? record[colorKey] : "");
          const memberTasks = tasks.filter(task => ownerNameList(task.owner).includes(name));
          const doneCount = memberTasks.filter(isWorkTaskDone).length;
          const openCount = memberTasks.length - doneCount;
          const dueSoonCount = memberTasks.filter(task => !isWorkTaskDone(task) && workTaskDueClass(task) === "soon").length;
          return `
            <article class="team-member-card" style="--member-color:${escapeHtml(color)}">
              <div class="team-member-avatar">${escapeHtml(teamMemberInitial(name))}</div>
              <div class="team-member-main">
                <h4>${escapeHtml(name)}</h4>
                <div class="team-member-meta">
                  <span>${escapeHtml(record[roleKey] || "역할 미정")}</span>
                  <span>${escapeHtml(record[statusKey] || "상태 미정")}</span>
                  <span>${escapeHtml(record[contactKey] || "연락처 미정")}</span>
                </div>
                <p>${escapeHtml(record[focusKey] || record[noteKey] || "담당 영역 미정")}</p>
                <div class="team-member-work">
                  <span>TODO ${openCount}개</span>
                  <span>완료 ${doneCount}개</span>
                  <span>임박 ${dueSoonCount}개</span>
                </div>
                ${record[noteKey] && record[focusKey] ? `<small>${escapeHtml(record[noteKey])}</small>` : ""}
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderWorkRows(rows, block = {}) {
  const { headers, records } = rowsToRecords(rows);
  const titleKey = preferredHeader(headers, ["제목", "업무", "할일", "task", "title"], { reject: ["id", "아이디"] });
  const statusKey = bestHeader(headers, ["상태", "status"]);
  const ownerKey = bestHeader(headers, ["담당", "담당자", "owner"]);
  const dueKey = bestHeader(headers, ["마감", "기한", "due", "날짜"]);
  const priorityKey = bestHeader(headers, ["우선순위", "우선", "priority"]);
  const projectKey = bestHeader(headers, ["프로젝트", "project"]);
  const noteKey = bestHeader(headers, ["메모", "비고", "note"]);
  const progressKey = bestHeader(headers, ["진행률", "진척도", "progress"]);
  const checklistKey = bestHeader(headers, ["체크리스트", "하위항목", "checklist", "todo"]);
  const tasks = records.map(record => workTaskFromRecord(record, {
    titleKey,
    statusKey,
    ownerKey,
    dueKey,
    priorityKey,
    projectKey,
    noteKey,
    progressKey,
    checklistKey
  }, headers));
  const doneCount = tasks.filter(isWorkTaskDone).length;
  const openTasks = tasks.filter(task => !isWorkTaskDone(task));
  const dueSoonCount = openTasks.filter(task => workTaskDueClass(task) === "soon").length;
  const overdueCount = openTasks.filter(task => workTaskDueClass(task) === "overdue").length;
  const avgProgress = tasks.length
    ? Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length)
    : 0;
  const membersByName = teamMemberDirectory();
  const memberNames = [...new Set([
    ...[...membersByName.values()].map(member => member.name),
    ...tasks.flatMap(task => ownerNameList(task.owner))
  ].filter(Boolean))].slice(0, 12);
  const statuses = [...new Set(["예정", "진행", "검토", "완료", ...tasks.map(task => task.status).filter(Boolean)])];
  return `
    <div class="work-dashboard">
      <div class="work-summary">
        <div class="work-summary-card"><strong>${tasks.length}</strong><span>전체 업무</span></div>
        <div class="work-summary-card"><strong>${openTasks.length}</strong><span>진행 중</span></div>
        <div class="work-summary-card"><strong>${doneCount}</strong><span>완료</span></div>
        <div class="work-summary-card alert"><strong>${overdueCount}</strong><span>지연</span></div>
        <div class="work-summary-card"><strong>${dueSoonCount}</strong><span>마감 임박</span></div>
        <div class="work-summary-card"><strong>${avgProgress}%</strong><span>평균 진행률</span></div>
      </div>
      <div class="work-section-head">
        <h4>팀 워크로드</h4>
        <span>담당자별 열린 업무</span>
      </div>
      <div class="workload-grid">
        ${memberNames.length ? memberNames.map(name => renderWorkloadCardLite(name, tasks, membersByName)).join("") : empty("담당자 데이터가 없습니다.")}
      </div>
      <div class="work-section-head">
        <h4>담당자별 TODO</h4>
        <span>업무 체크와 마감 확인</span>
      </div>
      <div class="personal-todo-grid">
        ${memberNames.length ? memberNames.map(name => renderPersonalTodoLite(name, tasks, block, membersByName)).join("") : empty("담당자를 선택한 업무가 없습니다.")}
      </div>
      <div class="work-section-head">
        <h4>상태 보드</h4>
        <span>예정 · 진행 · 검토 · 완료</span>
      </div>
      <div class="kanban-board">
        ${statuses.map(status => renderWorkKanbanColumn(status, tasks, block, membersByName)).join("")}
      </div>
    </div>
  `;
}

function workTaskFromRecord(record, keys, headers = []) {
  const title = record[keys.titleKey] || record[headers[0]] || "업무";
  return {
    rowIndex: record.__rowIndex,
    title,
    status: record[keys.statusKey] || "진행",
    owner: record[keys.ownerKey] || "",
    due: record[keys.dueKey] || "",
    priority: record[keys.priorityKey] || "보통",
    project: record[keys.projectKey] || "",
    note: record[keys.noteKey] || "",
    progress: workTaskProgress(record[keys.progressKey], record[keys.statusKey]),
    checklist: workTaskChecklistItems(record[keys.checklistKey])
  };
}

function workTaskProgress(value = "", status = "") {
  const raw = String(value ?? "").replace("%", "").trim();
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return Math.max(0, Math.min(100, Math.round(numeric)));
  return isWorkTaskDone({ status }) ? 100 : 0;
}

function workTaskChecklistItems(value = "") {
  return String(value || "")
    .split(/[\n|]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const done = /^\[(x|v|done|완료)\]\s*/i.test(item) || /^완료[:\s]/.test(item);
      const text = item
        .replace(/^\[(?:x|v|done|완료| )\]\s*/i, "")
        .replace(/^완료[:\s]*/, "")
        .trim();
      return { text: text || item, done };
    });
}

function ownerNameList(value = "") {
  return String(value || "").split(/[,;/\n]/).map(item => item.trim()).filter(Boolean);
}

function isWorkTaskDone(task = {}) {
  return /완료|done|true|1|complete/i.test(task.status || "");
}

function workTaskDueClass(task = {}, todayKey = currentDateKey()) {
  const due = normalizeDateKey(task.due || "");
  if (!due || isWorkTaskDone(task)) return "none";
  const days = Math.round((new Date(`${due}T00:00:00`) - new Date(`${todayKey}T00:00:00`)) / 86400000);
  if (days < 0) return "overdue";
  if (days <= 3) return "soon";
  return "normal";
}

function workTaskDueLabel(task = {}) {
  const due = normalizeDateKey(task.due || "");
  if (!due) return "마감 없음";
  const dueClass = workTaskDueClass(task);
  if (dueClass === "overdue") return `${due} 지연`;
  if (dueClass === "soon") return `${due} 임박`;
  return due;
}

function renderWorkTaskToggle(task, block = {}) {
  return `
    <input type="checkbox" data-action="toggle-task" data-block-id="${escapeHtml(block.id || "")}" data-row="${task.rowIndex}" ${isWorkTaskDone(task) ? "checked" : ""}>
  `;
}

function renderWorkOwnerChips(owner = "", membersByName = teamMemberDirectory()) {
  const names = ownerNameList(owner);
  return `<div class="calendar-owner-row">${names.length ? names.map(name => {
    const member = membersByName.get(searchable(name));
    const color = member?.color || "#8a948e";
    const detail = [member?.role, member?.status, member?.focus].filter(Boolean).join(" · ");
    return `
      <span class="member-chip" style="--member-color:${escapeHtml(color)}" title="${escapeHtml(detail || name)}">
        <span class="member-dot">${escapeHtml(teamMemberInitial(name))}</span>
        <span>${escapeHtml(name)}</span>
      </span>
    `;
  }).join("") : `<span class="member-chip unassigned">담당 미정</span>`}</div>`;
}

function renderWorkloadCardLite(name, tasks = [], membersByName = teamMemberDirectory()) {
  const member = membersByName.get(searchable(name));
  const memberTasks = tasks.filter(task => ownerNameList(task.owner).includes(name));
  const done = memberTasks.filter(isWorkTaskDone).length;
  const open = memberTasks.length - done;
  const dueSoon = memberTasks.filter(task => !isWorkTaskDone(task) && workTaskDueClass(task) === "soon").length;
  const progress = memberTasks.length
    ? Math.round(memberTasks.reduce((sum, task) => sum + task.progress, 0) / memberTasks.length)
    : 0;
  return `
    <article class="workload-card" style="--member-color:${escapeHtml(member?.color || "#8a948e")}">
      <div class="workload-card-head">
        <div class="team-member-avatar small">${escapeHtml(teamMemberInitial(name))}</div>
        <div>
          <h5>${escapeHtml(name)}</h5>
          <p>${escapeHtml(member?.role || member?.focus || `열린 업무 ${open}개`)}</p>
        </div>
      </div>
      <div class="workload-stats">
        <span>TODO ${open}</span>
        <span>완료 ${done}</span>
        <span>임박 ${dueSoon}</span>
      </div>
      <div class="workload-bar" aria-label="완료율 ${progress}%"><span style="width:${progress}%"></span></div>
    </article>
  `;
}

function renderPersonalTodoLite(name, tasks = [], block = {}, membersByName = teamMemberDirectory()) {
  const member = membersByName.get(searchable(name));
  const memberTasks = tasks.filter(task => ownerNameList(task.owner).includes(name));
  return `
    <article class="todo-list-card" style="--member-color:${escapeHtml(member?.color || "#8a948e")}">
      <div class="todo-list-head">
        <div>
          <h5>${escapeHtml(name)}</h5>
          <p>${escapeHtml(member?.focus || member?.role || `${memberTasks.length}개 업무`)}</p>
        </div>
        <span>${memberTasks.filter(task => !isWorkTaskDone(task)).length}</span>
      </div>
      <div class="todo-list">
        ${memberTasks.length ? memberTasks.map(task => `
          <label class="todo-row due-${workTaskDueClass(task)}">
            ${renderWorkTaskToggle(task, block)}
            <span class="todo-row-main">
              <strong>${escapeHtml(task.title)}</strong>
              <span>${escapeHtml([workTaskDueLabel(task), task.project, task.priority].filter(Boolean).join(" · "))}</span>
            </span>
            <span class="todo-progress">${task.progress}%</span>
          </label>
        `).join("") : `<div class="empty-state compact">업무 없음</div>`}
      </div>
    </article>
  `;
}

function renderWorkKanbanColumn(status, tasks = [], block = {}, membersByName = teamMemberDirectory()) {
  const columnTasks = tasks.filter(task => (task.status || "진행") === status);
  return `
    <section class="kanban-column status-${escapeHtml(searchable(status) || "status")}">
      <div class="kanban-column-head">
        <h5>${escapeHtml(status)}</h5>
        <span>${columnTasks.length}</span>
      </div>
      <div class="kanban-cards">
        ${columnTasks.length ? columnTasks.map(task => `
          <article class="task-card due-${workTaskDueClass(task)}">
            <div class="task-card-top">
              ${renderWorkTaskToggle(task, block)}
              <div>
                <h5>${escapeHtml(task.title)}</h5>
                <p>${escapeHtml(task.project || "프로젝트 미정")}</p>
              </div>
            </div>
            <div class="task-card-meta">
              <span class="task-chip">${escapeHtml(task.priority || "보통")}</span>
              <span class="task-chip due-${workTaskDueClass(task)}">${escapeHtml(workTaskDueLabel(task))}</span>
            </div>
            <div class="task-progress-bar" aria-label="진행률 ${task.progress}%"><span style="width:${task.progress}%"></span></div>
            ${renderWorkTaskChecklist(task)}
            ${renderWorkOwnerChips(task.owner, membersByName)}
            ${task.note ? `<p class="task-note">${escapeHtml(task.note)}</p>` : ""}
          </article>
        `).join("") : `<div class="empty-state compact">업무 없음</div>`}
      </div>
    </section>
  `;
}

function renderWorkTaskChecklist(task = {}, maxItems = 3) {
  const items = Array.isArray(task.checklist) ? task.checklist : [];
  if (!items.length) return "";
  return `
    <ul class="task-checklist">
      ${items.slice(0, maxItems).map(item => `<li class="${item.done ? "done" : ""}">${escapeHtml(item.text)}</li>`).join("")}
      ${items.length > maxItems ? `<li class="more">+${items.length - maxItems}</li>` : ""}
    </ul>
  `;
}

function renderMeetingRows(rows, block = {}) {
  const { headers, records } = rowsToRecords(rows);
  const titleKey = preferredHeader(headers, ["회의명", "안건", "제목", "회의", "title"], { reject: ["id", "아이디"] });
  const dateKey = bestHeader(headers, ["날짜", "일자", "date"]);
  const timeKey = bestHeader(headers, ["시간", "time"]);
  const decisionKey = bestHeader(headers, ["결정", "결정사항", "메모", "note"]);
  const attendeeKey = bestHeader(headers, ["참석자", "참석", "attendees", "member"]);
  const statusKey = bestHeader(headers, ["상태", "status"]);
  const agendaKey = bestHeader(headers, ["안건", "agenda"]);
  const minutesKey = bestHeader(headers, ["회의록", "minutes", "내용"]);
  const meetings = records.map(record => {
    const date = normalizeDateKey(record[dateKey]) || record[dateKey] || "";
    const time = record[timeKey] || "";
    return {
      title: record[titleKey] || record[headers[0]] || "회의",
      date,
      time,
      attendees: record[attendeeKey] || "",
      status: displayMeetingStatus(record[statusKey] || "예정", date, time),
      rawStatus: record[statusKey] || "예정",
      agenda: record[agendaKey] || "",
      minutes: record[minutesKey] || "",
      decisions: record[decisionKey] || ""
    };
  });
  const doneCount = meetings.filter(meeting => /완료|done|complete/i.test(meeting.status)).length;
  const plannedCount = meetings.length - doneCount;
  const membersByName = teamMemberDirectory();
  const defaultDate = nextWeekdayDateKey(block.defaultWeekday || "월요일");
  const defaultTime = block.defaultTime || "22:00";
  const latestMeeting = meetings[0];
  return `
    <div class="meeting-dashboard">
      <div class="work-section-head">
        <h4>${escapeHtml(block.title || "회의록")}</h4>
        <span>다음 기본 회의 ${escapeHtml(defaultDate)} ${escapeHtml(defaultTime)}${latestMeeting ? ` · 최근 ${escapeHtml([latestMeeting.date, latestMeeting.time].filter(Boolean).join(" "))}` : ""}</span>
      </div>
      <div class="work-summary meeting-summary">
        <div class="work-summary-card"><strong>${meetings.length}</strong><span>전체 회의</span></div>
        <div class="work-summary-card"><strong>${plannedCount}</strong><span>예정/진행</span></div>
        <div class="work-summary-card"><strong>${doneCount}</strong><span>완료</span></div>
      </div>
      <div class="meeting-card-list">
        ${meetings.length ? meetings.map(meeting => `
          <article class="meeting-card">
            <div class="meeting-card-head">
              <div>
                <h4>${escapeHtml(meeting.title)}</h4>
                <p>${escapeHtml([meeting.date, meeting.time].filter(Boolean).join(" "))}</p>
              </div>
              <span>${escapeHtml(meeting.status)}</span>
            </div>
            ${renderWorkOwnerChips(meeting.attendees, membersByName)}
            ${renderMeetingTextSection("안건", meeting.agenda)}
            ${renderMeetingTextSection("회의록", meeting.minutes)}
            ${renderMeetingTextSection("결정사항", meeting.decisions)}
          </article>
        `).join("") : empty("회의록이 없습니다.")}
      </div>
    </div>
  `;
}

function renderMeetingTextSection(label, value) {
  const text = String(value || "").trim();
  return text
    ? `<div class="meeting-note-section"><h5>${escapeHtml(label)}</h5><div>${renderInlineText(text)}</div></div>`
    : "";
}

function dialogueNodeIdKey(headers = []) {
  return headers.find(header => ["nodeid", "node", "노드", "번호", "id"].some(candidate => searchable(header).includes(candidate))) || "";
}

function dialogueStageKey(headers = []) {
  return matchingHeader(headers, ["StageID", "Stage ID", "온기단계", "온기 단계", "단계", "stage"]);
}

function dialogueStageMatches(rawStage, stageId) {
  const raw = String(rawStage || "").trim();
  const current = String(stageId || "").trim();
  if (!current) return true;
  if (!raw || raw === "공통" || raw === "전체") return true;
  if (raw === current) return true;
  const range = raw.match(/^(\d+)\s*~\s*(\d+)$/);
  if (range) {
    const value = Number(current);
    return value >= Number(range[1]) && value <= Number(range[2]);
  }
  return raw.split(/[,\s/|]+/).includes(current);
}

function dialogueStageCollection(block = {}) {
  const explicit = collectionsById.get(block.stageCollectionId);
  if (explicit) return explicit;
  const inferred = findCollectionByKeyword(["온기단계", "온기 단계", "stage"]);
  return inferred?.id && inferred.id !== block.collectionId ? inferred : null;
}

function dialogueStageRowsForBlock(block = {}, dialogueRecords = [], headers = []) {
  const collection = dialogueStageCollection(block);
  if (collection) {
    const { headers: stageHeaders, records } = rowsToRecords(collection.rows || []);
    const idKey = bestHeader(stageHeaders, ["StageID", "단계ID", "stage", "id"]);
    const nameKey = preferredHeader(stageHeaders, ["단계명", "이름", "name", "stage"], { reject: ["id", "아이디"] });
    const meaningKey = matchingHeader(stageHeaders, ["의미", "설명", "meaning", "description"]);
    return records
      .map(record => ({
        id: String(record[idKey] || "").trim(),
        name: String(record[nameKey] || "").trim(),
        meaning: String(record[meaningKey] || "").trim()
      }))
      .filter(stage => stage.id);
  }
  const stageKey = dialogueStageKey(headers);
  if (!stageKey) return [];
  const stages = new Map();
  for (const record of dialogueRecords) {
    const raw = String(record[stageKey] || "").trim();
    if (!raw || raw === "공통" || raw === "전체" || /^\d+\s*~\s*\d+$/.test(raw)) continue;
    raw.split(/[,\s/|]+/).map(item => item.trim()).filter(Boolean).forEach(id => {
      if (!stages.has(id)) stages.set(id, { id, name: "온기 단계", meaning: "" });
    });
  }
  return [...stages.values()].sort((a, b) => a.id.localeCompare(b.id, "ko-KR", { numeric: true }));
}

function dialogueFindRecordByTarget(rawTarget = "", records = [], headers = []) {
  const raw = String(rawTarget || "").trim();
  if (!raw) return null;
  const idKey = dialogueNodeIdKey(headers);
  return records.find(item => String(item.__rowIndex) === raw)
    || (idKey ? records.find(item => String(item[idKey] || "").trim() === raw) : null)
    || records.find(item => headers.some(header => String(item[header] || "").trim() === raw))
    || null;
}

function dialogueTargetRow(record, records = [], headers = [], nextKey = "", fallbackRow = 1) {
  const raw = String(record?.[nextKey] || "").trim();
  if (!raw) return fallbackRow;
  const target = dialogueFindRecordByTarget(raw, records, headers);
  return Number(target?.__rowIndex || fallbackRow);
}

function dialogueChoiceRows(record, records = [], headers = [], nextKey = "") {
  const explicitChoices = dialogueExplicitChoices(record, records, headers);
  if (explicitChoices.length) return explicitChoices;
  const raw = String(record?.[nextKey] || "").trim();
  const targets = raw
    ? raw.split(/[,\n;|/]+/).map(item => dialogueFindRecordByTarget(item, records, headers)).filter(Boolean)
    : [];
  const uniqueTargets = [...new Map(targets.map(item => [item.__rowIndex, item])).values()];
  if (uniqueTargets.length) {
    return uniqueTargets.slice(0, 6).map(item => ({
      label: dialogueChoiceLabel(item, headers),
      rowIndex: item.__rowIndex
    }));
  }
  return records
    .filter(item => item.__rowIndex !== record?.__rowIndex)
    .slice(0, 4)
    .map(item => ({
      label: dialogueChoiceLabel(item, headers),
      rowIndex: item.__rowIndex
    }));
}

function dialogueChoiceLabel(record = {}, headers = []) {
  const lineKey = bestHeader(headers, ["대사", "내용", "text", "line"]);
  const speakerKey = bestHeader(headers, ["화자", "캐릭터", "speaker"]);
  return record[lineKey] || record[speakerKey] || record[headers[0]] || `${record.__rowIndex || ""}`;
}

function dialogueExplicitChoices(record = {}, records = [], headers = []) {
  const choices = [];
  const pairs = dialogueChoiceColumnPairs(headers);
  for (const pair of pairs) {
    const label = String(record[pair.label] || "").trim();
    const targetRaw = String(record[pair.target] || "").trim();
    if (!label && !targetRaw) continue;
    const target = dialogueFindRecordByTarget(targetRaw || label, records, headers);
    choices.push({
      label: label || targetRaw,
      rowIndex: target?.__rowIndex || 0
    });
  }
  if (choices.length) return choices;

  const cells = Array.isArray(record.__cells) ? record.__cells : [];
  for (const [labelIndex, targetIndex] of [[7, 8], [9, 10], [11, 12]]) {
    const label = String(cells[labelIndex] || "").trim();
    const targetRaw = String(cells[targetIndex] || "").trim();
    if (!label && !targetRaw) continue;
    const target = dialogueFindRecordByTarget(targetRaw || label, records, headers);
    choices.push({
      label: label || targetRaw,
      rowIndex: target?.__rowIndex || 0
    });
  }
  return choices;
}

function dialogueChoiceColumnPairs(headers = []) {
  const entries = headers.map(header => ({
    header,
    key: searchable(header).replace(/[\s_\-.:()[\]]+/g, "")
  }));
  const pairs = [];
  for (let index = 1; index <= 6; index += 1) {
    const token = String(index);
    const inSlot = entry => entry.key.includes(token)
      && ["choice", "option", "select", "next", "선택", "다음"].some(word => entry.key.includes(word));
    const label = entries.find(entry => inSlot(entry)
      && ["label", "text", "title", "caption", "choice", "option", "선택지", "선택"].some(word => entry.key.includes(word))
      && !["target", "nextid", "nodeid", "다음"].some(word => entry.key.includes(word)));
    const target = entries.find(entry => inSlot(entry)
      && ["target", "nextid", "nodeid", "node", "next", "다음"].some(word => entry.key.includes(word))
      && entry.header !== label?.header);
    if (label && target && !pairs.some(pair => pair.label === label.header && pair.target === target.header)) {
      pairs.push({ label: label.header, target: target.header });
    }
  }
  return pairs;
}

function renderDialogueRows(rows, block = {}) {
  const { headers, records } = rowsToRecords(rows);
  const speakerKey = bestHeader(headers, ["화자", "캐릭터", "speaker"]);
  const lineKey = bestHeader(headers, ["대사", "내용", "text", "line"]);
  const nextKey = bestHeader(headers, ["다음", "선택", "next"]);
  const idKey = dialogueNodeIdKey(headers);
  const stageKey = dialogueStageKey(headers);
  const stages = dialogueStageRowsForBlock(block, records, headers);
  const selectedStage = String(block.warmthStage || stages[0]?.id || "").trim();
  const selectedStageRecord = stages.find(stage => stage.id === selectedStage);
  const stageRecords = selectedStage && stageKey
    ? records.filter(record => dialogueStageMatches(record[stageKey], selectedStage))
    : records;
  const playRecords = stageRecords.length ? stageRecords : records;
  const stageMatches = record => !selectedStage || !stageKey || dialogueStageMatches(record?.[stageKey], selectedStage);
  const current = (idKey && block.currentNodeId
      ? playRecords.find(record => String(record[idKey] || "").trim() === String(block.currentNodeId))
      : null)
    || playRecords.find(record => String(record.__rowIndex) === String(block.currentRowIndex))
    || playRecords[0];
  const currentIndex = Number(current?.__rowIndex || 1);
  const currentPlayIndex = Math.max(0, playRecords.findIndex(record => record.__rowIndex === current?.__rowIndex));
  const historyRows = Array.isArray(block.history) ? block.history.map(Number).filter(Number.isFinite) : [];
  const historyBackIndex = historyRows.at(-1) || 0;
  const previousRecord = playRecords[Math.max(0, currentPlayIndex - 1)];
  const targetByNext = current?.[nextKey] ? dialogueFindRecordByTarget(current[nextKey], records, headers) : null;
  const sequentialNext = playRecords[Math.min(playRecords.length - 1, currentPlayIndex + 1)];
  const nextRecord = targetByNext && stageMatches(targetByNext) ? targetByNext : sequentialNext;
  const previousIndex = historyBackIndex || Number(previousRecord?.__rowIndex || currentIndex);
  const nextIndex = Number(nextRecord?.__rowIndex || currentIndex);
  const choiceRows = current
    ? dialogueChoiceRows(current, records, headers, nextKey).filter(choice => {
        const target = records.find(record => Number(record.__rowIndex) === Number(choice.rowIndex));
        return !target || stageMatches(target);
      })
    : [];
  const stageControl = stages.length ? `
    <label class="dialogue-stage-control">온기 단계
      <select data-dialogue-stage="1" data-block-id="${escapeHtml(block.id || "")}">
        ${stages.map(stage => `<option value="${escapeHtml(stage.id)}" ${stage.id === selectedStage ? "selected" : ""}>${escapeHtml(`${stage.id}. ${stage.name || "온기 단계"}`)}</option>`).join("")}
      </select>
    </label>
  ` : "";
  return `
    ${current ? `
      <div class="dialogue-player">
        <div class="dialogue-player-head">
          <div>
            <strong>${escapeHtml(current[speakerKey] || "대화")}</strong>
            ${selectedStage ? `<small class="dialogue-stage-chip">${escapeHtml(`${selectedStage}. ${selectedStageRecord?.name || current[stageKey] || "온기 단계"}`)}</small>` : ""}
          </div>
          ${stageControl}
        </div>
        <p>${escapeHtml(current[lineKey] || current[headers[0]] || "")}</p>
        <div class="planning-controls">
          <button type="button" data-action="dialogue-step" data-block-id="${escapeHtml(block.id || "")}" data-row="${previousIndex}" ${!historyBackIndex && currentPlayIndex <= 0 ? "disabled" : ""}>이전</button>
          <button type="button" data-action="dialogue-talk" data-block-id="${escapeHtml(block.id || "")}" data-row="${nextIndex}" ${nextIndex === currentIndex ? "disabled" : ""}>대화하기</button>
          <button type="button" data-action="dialogue-step" data-block-id="${escapeHtml(block.id || "")}" data-row="${Number(sequentialNext?.__rowIndex || currentIndex)}" ${currentPlayIndex >= playRecords.length - 1 ? "disabled" : ""}>다음</button>
          ${choiceRows.map(choice => `<button type="button" data-action="dialogue-step" data-block-id="${escapeHtml(block.id || "")}" data-row="${choice.rowIndex || ""}" ${choice.rowIndex ? "" : "disabled"}>${escapeHtml(choice.label || `${choice.rowIndex || ""}`)}</button>`).join("")}
          <button type="button" data-action="dialogue-reset" data-block-id="${escapeHtml(block.id || "")}">처음으로</button>
        </div>
      </div>
    ` : ""}
    <div class="dialogue-preview-list">
      ${playRecords.slice(0, 12).map(record => `
        <article class="dialogue-preview-line">
          <strong>${escapeHtml(record[speakerKey] || "대화")}</strong>
          <p>${escapeHtml(record[lineKey] || record[headers[0]] || "")}</p>
          ${record[nextKey] ? `<small>${escapeHtml(record[nextKey])}</small>` : ""}
        </article>
      `).join("")}
    </div>
  `;
}

function renderPlanningForm(block) {
  const type = block.type;
  const common = `data-planning-form="${escapeHtml(block.id)}"`;
  const memberPicker = renderTeamMemberPicker;
  if (type === "calendar") {
    return `
      <div class="planning-form" ${common}>
        <input name="title" placeholder="일정 제목">
        <input name="date" type="date" value="${currentDateKey()}">
        <input name="owner" placeholder="담당">
        <select name="status"><option>예정</option><option>진행</option><option>완료</option><option>보류</option></select>
        <button type="button" data-action="create-planning-record" data-plan-type="calendar" data-block-id="${escapeHtml(block.id)}">일정 추가</button>
      </div>
    `;
  }
  if (type === "team") {
    return `
      <div class="planning-form" ${common}>
        <input name="name" placeholder="이름">
        <input name="role" placeholder="역할">
        <input name="note" placeholder="메모">
        <button type="button" data-action="create-planning-record" data-plan-type="team" data-block-id="${escapeHtml(block.id)}">팀원 추가</button>
      </div>
    `;
  }
  if (type === "workboard") {
    return `
      <div class="planning-form" ${common}>
        <input name="title" placeholder="업무">
        <input name="owner" placeholder="담당">
        ${memberPicker("owner", "담당 팀원")}
        <input name="due" type="date">
        <select name="status"><option>예정</option><option>진행</option><option>검토</option><option>완료</option><option>보류</option></select>
        <select name="priority"><option>보통</option><option>높음</option><option>낮음</option></select>
        <input name="project" placeholder="프로젝트">
        <input name="note" placeholder="메모">
        <button type="button" data-action="create-planning-record" data-plan-type="workboard" data-block-id="${escapeHtml(block.id)}">업무 추가</button>
      </div>
    `;
  }
  if (type === "meetingbook") {
    const defaultDate = nextWeekdayDateKey(block.defaultWeekday || "월요일");
    const defaultTime = block.defaultTime || "22:00";
    return `
      <div class="planning-form meeting-form" ${common}>
        <input name="title" placeholder="회의 제목">
        <input name="date" type="date" value="${escapeHtml(defaultDate)}">
        <input name="time" type="time" value="${escapeHtml(defaultTime)}">
        <select name="status"><option>예정</option><option>완료</option><option>보류</option></select>
        <input name="attendees" placeholder="참석자">
        ${memberPicker("attendees", "참석자 선택", { action: "meeting-attendee-all", actionLabel: "전체 참석" })}
        <textarea name="agenda" rows="2" placeholder="안건"></textarea>
        <textarea name="decisions" rows="2" placeholder="결정사항"></textarea>
        <textarea name="minutes" rows="2" placeholder="회의록"></textarea>
        <button type="button" data-action="create-planning-record" data-plan-type="meetingbook" data-block-id="${escapeHtml(block.id)}">회의록 저장</button>
      </div>
    `;
  }
  if (type === "dialogue") {
    return `
      <div class="planning-form" ${common}>
        <input name="speaker" placeholder="화자">
        ${renderDialogueStageFormField(block)}
        <input name="line" placeholder="대사">
        <input name="next" placeholder="다음 NodeID/선택지">
        <button type="button" data-action="create-planning-record" data-plan-type="dialogue" data-block-id="${escapeHtml(block.id)}">대사 추가</button>
      </div>
    `;
  }
  return "";
}

function renderDialogueStageFormField(block = {}) {
  const collection = collectionsById.get(block.collectionId);
  const { headers, records } = rowsToRecords(collection?.rows || []);
  const stages = dialogueStageRowsForBlock(block, records, headers);
  if (!stages.length) return `<input name="stage" placeholder="StageID">`;
  const selectedStage = String(block.warmthStage || stages[0]?.id || "").trim();
  return `
    <select name="stage" aria-label="온기 단계">
      ${stages.map(stage => `<option value="${escapeHtml(stage.id)}" ${stage.id === selectedStage ? "selected" : ""}>${escapeHtml(`${stage.id}. ${stage.name || "온기 단계"}`)}</option>`).join("")}
    </select>
  `;
}

function renderTeamMemberPicker(name, label, options = {}) {
  const members = [...teamMemberDirectory().values()].slice(0, 32);
  if (!members.length) return "";
  const action = options.action
    ? `<button type="button" data-action="${escapeHtml(options.action)}">${escapeHtml(options.actionLabel || "전체 선택")}</button>`
    : "";
  return `
    <fieldset class="planning-member-picker">
      <legend>${escapeHtml(label)}</legend>
      <div class="planning-member-list">
        ${members.map(member => `
          <label style="--member-color:${escapeHtml(member.color)}">
            <input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(member.name)}">
            <span class="member-dot">${escapeHtml(teamMemberInitial(member.name))}</span>
            <span>${escapeHtml(member.name)}</span>
          </label>
        `).join("")}
      </div>
      ${action}
    </fieldset>
  `;
}

function safeTeamColor(value = "") {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#8a948e";
}

function teamMemberInitial(name = "") {
  const text = String(name || "").trim();
  return text ? text[0].toLocaleUpperCase("ko-KR") : "?";
}

function teamMemberDirectory() {
  const members = new Map();
  const teamCollectionIds = new Set((archive.documents || [])
    .flatMap(doc => doc.blocks || [])
    .filter(block => block.type === "team" && block.collectionId)
    .map(block => block.collectionId));
  for (const collection of archive.collections || []) {
    const { headers, records } = rowsToRecords(collection.rows || []);
    const nameHeader = matchingHeader(headers, ["이름", "성명", "담당자", "담당", "멤버", "참석자", "member", "name", "attendee"]);
    const roleHeader = matchingHeader(headers, ["역할", "직무", "role"]);
    const focusHeader = matchingHeader(headers, ["담당분야", "담당 분야", "담당", "분야", "focus", "part"]);
    const contactHeader = matchingHeader(headers, ["연락", "연락처", "이메일", "contact", "email"]);
    const colorHeader = matchingHeader(headers, ["색상", "컬러", "color"]);
    const statusHeader = matchingHeader(headers, ["상태", "status"]);
    const noteHeader = matchingHeader(headers, ["메모", "비고", "note"]);
    const titleBlob = searchable(collection.title);
    const looksLikeTeam = teamCollectionIds.has(collection.id)
      || ["팀원", "팀 목록", "멤버", "member", "team", "staff"].some(keyword => titleBlob.includes(searchable(keyword)));
    if (!nameHeader || !looksLikeTeam) continue;
    for (const record of records) {
      const names = String(record[nameHeader] || "")
        .split(/[,;/\n]/)
        .map(item => item.trim())
        .filter(Boolean);
      for (const name of names) {
        const key = searchable(name);
        if (key && !members.has(key)) {
          members.set(key, {
            name,
            role: roleHeader ? record[roleHeader] || "" : "",
            focus: focusHeader ? record[focusHeader] || "" : "",
            contact: contactHeader ? record[contactHeader] || "" : "",
            color: safeTeamColor(colorHeader ? record[colorHeader] : ""),
            status: statusHeader ? record[statusHeader] || "" : "",
            note: noteHeader ? record[noteHeader] || "" : ""
          });
        }
      }
    }
  }
  return members;
}

function teamMemberNames() {
  const members = teamMemberDirectory();
  return [...members.values()].map(member => member.name).slice(0, 32);
}

function renderCollections() {
  const collections = filteredCollections();
  if (!collections.some(item => item.id === state.selectedCollectionId)) {
    state.selectedCollectionId = collections[0]?.id || "";
  }
  const selected = collections.find(item => item.id === state.selectedCollectionId) || collections[0];
  return `
    <section class="surface page-head-card">
      <div>
        <h1>표 데이터 ${state.editMode ? "편집" : "보기"}</h1>
        <p>CSV에서 가져온 표를 현재 편집본 기준으로 보여줍니다.</p>
      </div>
      <div class="head-actions">
        ${state.editMode ? `
          <button type="button" data-action="add-collection">표 추가</button>
          <button type="button" data-action="import-collection-file">Excel/CSV 가져오기</button>
          <button class="primary-action" type="button" data-action="add-collection-row">행 추가</button>
          <button type="button" data-action="add-collection-column">열 추가</button>
          <button class="danger" type="button" data-action="delete-collection">표 삭제</button>
        ` : ""}
      </div>
    </section>
    <div class="collection-layout">
      <section class="surface picker-panel">
        <div class="surface-body result-toolbar">
          <label class="editor-field result-select">표 선택
            <select data-collection-select="1" ${collections.length ? "" : "disabled"}>
              ${collections.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === state.selectedCollectionId ? "selected" : ""}>${escapeHtml(item.title)} · ${escapeHtml(item.categoryLabel)}</option>`).join("")}
            </select>
          </label>
          <span class="source-note">${collections.length.toLocaleString("ko-KR")}개 결과</span>
        </div>
      </section>
      ${selected ? `
        <section class="surface">
          <div class="surface-head">
            <div>
              ${state.editMode ? renderCollectionEditorMeta(selected) : `
                <div class="tag-row">
                  <span class="tag">${escapeHtml(selected.categoryLabel)}</span>
                  <span class="tag">${selected.rowCount.toLocaleString("ko-KR")}행</span>
                  <span class="tag">${selected.columnCount.toLocaleString("ko-KR")}열</span>
                </div>
                <h1>${escapeHtml(selected.title)}</h1>
                <p class="doc-path">${escapeHtml(selected.sourcePath)}</p>
              `}
            </div>
          </div>
          <div class="surface-body">
            ${state.editMode ? renderCollectionColumnTools(selected) : ""}
            ${renderTable(selected.rows, { editable: state.editMode, source: selected, kind: "collection", collection: true })}
          </div>
        </section>
      ` : empty("표를 선택하세요.")}
    </div>
  `;
}

function renderCollectionEditorMeta(collection) {
  return `
    <div class="edit-meta-grid">
      <label class="editor-field wide">표 제목
        <input value="${escapeHtml(collection.title)}" data-edit-collection-field="title">
      </label>
      <label class="editor-field">분류
        <select data-edit-collection-field="category">
          ${archive.categories.map(category => `<option value="${escapeHtml(category.id)}" ${category.id === collection.category ? "selected" : ""}>${escapeHtml(category.label)}</option>`).join("")}
        </select>
      </label>
      <label class="editor-field full">원본 경로
        <input value="${escapeHtml(collection.sourcePath || "")}" data-edit-collection-field="sourcePath">
      </label>
      <div class="tag-row">
        <span class="tag">${collection.rowCount.toLocaleString("ko-KR")}행</span>
        <span class="tag">${collection.columnCount.toLocaleString("ko-KR")}열</span>
      </div>
    </div>
  `;
}

function renderCollectionColumnTools(collection) {
  return renderTableTools(collection, { kind: "collection", rows: collection.rows || [] });
}

function renderMedia() {
  const media = archive.media.filter(item => {
    if (!state.query) return true;
    return searchable(`${item.title} ${item.sourcePath}`).includes(searchable(state.query));
  });
  return `
    <section class="surface">
      <div class="surface-head">
        <div>
          <h1>미디어 갤러리</h1>
          <p>호스팅 용량을 고려해 복사한 웹용 프리뷰입니다.</p>
        </div>
      </div>
      <div class="surface-body">
        <div class="media-grid">${media.map(mediaTile).join("") || empty("검색 결과가 없습니다.")}</div>
      </div>
    </section>
  `;
}

function renderCleanup() {
  const cleanup = buildCleanup();
  return `
    <section class="surface">
      <div class="surface-head">
        <div>
          <h1>정리 보드</h1>
          <p>검토할 문서와 보류 문서를 현재 편집본 기준으로 분리했습니다.</p>
        </div>
        <button class="primary-action" type="button" data-action="download-summary">보고서 내려받기</button>
      </div>
      <div class="surface-body">
        <div class="map-list">
          ${archive.insights.cleanup.suggestions.map(item => `
            <div class="map-row">
              <strong>${escapeHtml(item.title)}</strong>
              <p>${escapeHtml(item.detail)}</p>
              <button type="button" data-view="documents">문서 보기</button>
            </div>
          `).join("")}
        </div>
      </div>
    </section>
    <div class="cleanup-grid">
      ${cleanupColumn("검토 필요", cleanup.reviewDocs, "review")}
      ${cleanupColumn("제목 없음", cleanup.untitledDocs, "review")}
      ${cleanupColumn("보류/휴지통", cleanup.legacyDocs, "legacy")}
    </div>
  `;
}

function cleanupColumn(title, docs, status) {
  return `
    <section class="surface">
      <div class="surface-body cleanup-column">
        <h3>${escapeHtml(title)}</h3>
        ${(docs || []).slice(0, 18).map(doc => `
          <button class="cleanup-row" type="button" data-doc="${escapeHtml(doc.id)}">
            <strong>${escapeHtml(doc.title)}</strong>
            <span>${escapeHtml(doc.categoryLabel)} · ${statusLabels[doc.status || status]}</span>
          </button>
        `).join("") || empty("대상이 없습니다.")}
      </div>
    </section>
  `;
}

function filteredDocuments() {
  const query = searchable(state.query);
  return archive.documents.filter(doc => {
    if (state.category !== "all" && doc.category !== state.category) return false;
    if (state.status !== "all" && doc.status !== state.status) return false;
    if (query && !searchable(doc.searchText).includes(query)) return false;
    return true;
  }).sort((a, b) => statusRank(a.status) - statusRank(b.status)
    || a.depth - b.depth
    || a.categoryLabel.localeCompare(b.categoryLabel, "ko-KR")
    || a.title.localeCompare(b.title, "ko-KR"));
}

function filteredCollections() {
  const query = searchable(state.query);
  return archive.collections.filter(item => {
    if (state.category !== "all" && item.category !== state.category) return false;
    if (query && !searchable(item.searchText).includes(query)) return false;
    return true;
  }).sort((a, b) => a.categoryLabel.localeCompare(b.categoryLabel, "ko-KR")
    || a.title.localeCompare(b.title, "ko-KR"));
}

function updateArchiveField(field, value) {
  if (!["title", "subtitle", "mediaBasePath"].includes(field)) return;
  if (archive[field] === value) return;
  recordUndo();
  archive[field] = value;
  markDirty();
}

function updateDocField(field, value) {
  const doc = currentDoc();
  if (!doc) return;
  if (doc[field] === value) return;
  recordUndo();
  doc[field] = value;
  if (field === "category") doc.categoryLabel = categoryById.get(value)?.label || value;
  refreshDerivedDoc(doc);
  markDirty();
  refreshDocumentSidebar();
}

function updateBlockField(blockId, field, value) {
  const block = currentDoc()?.blocks?.find(item => item.id === blockId);
  if (!block) return;
  const nextValue = field === "imageWidth" ? normalizeImageWidth(value) : value;
  if (block[field] === nextValue) return;
  recordUndo();
  block[field] = nextValue;
  refreshDerivedDoc(currentDoc());
  markDirty();
  refreshDocumentSidebar();
}

function updateTableCell(blockId, row, col, value) {
  const block = currentDoc()?.blocks?.find(item => item.id === blockId);
  if (!block || block.type !== "table") return;
  block.rows[row] ||= [];
  if (block.rows[row][col] === value) return;
  recordUndo();
  block.rows[row][col] = value;
  refreshDerivedDoc(currentDoc());
  markDirty();
}

function updateCollectionCell(row, col, value) {
  const collection = currentCollection();
  if (!collection) return;
  collection.rows[row] ||= [];
  if (collection.rows[row][col] === value) return;
  recordUndo();
  collection.rows[row][col] = value;
  refreshDerivedCollection(collection);
  markDirty();
}

function updateCollectionField(field, value) {
  const collection = currentCollection();
  if (!collection || !["title", "category", "sourcePath"].includes(field)) return;
  if (collection[field] === value) return;
  recordUndo();
  collection[field] = value;
  if (field === "category") collection.categoryLabel = categoryById.get(value)?.label || value;
  refreshDerivedCollection(collection);
  markDirty();
}

function addDocument() {
  const category = state.category !== "all" ? state.category : archive.categories[0]?.id || "general";
  const doc = {
    id: createId("doc"),
    title: "새 문서",
    category,
    categoryLabel: categoryById.get(category)?.label || category,
    status: "active",
    depth: 0,
    sourcePath: "사용자 추가 문서",
    subtitle: "새 문서 부제목을 입력하세요.",
    excerpt: "새 문서 요약을 입력하세요.",
    blocks: [createBlock("paragraph")],
    headings: [],
    localLinks: [],
    externalLinks: [],
    mediaIds: [],
    textLength: 0,
    searchText: ""
  };
  refreshDerivedDoc(doc);
  recordUndo();
  archive.documents.unshift(doc);
  rebuildIndexes();
  state.selectedDocId = doc.id;
  state.view = "documents";
  markDirty();
  render();
  toast("문서를 추가했습니다.");
}

function addChildDocument(parentId = "") {
  const parent = docsById.get(parentId) || currentDoc();
  if (!parent) return addDocument();
  const category = parent.category || (state.category !== "all" ? state.category : archive.categories[0]?.id || "general");
  const doc = {
    id: createId("doc"),
    title: `${parent.title || "문서"} 하위 문서`,
    category,
    categoryLabel: categoryById.get(category)?.label || parent.categoryLabel || category,
    status: "active",
    depth: Math.min(6, documentDepth(parent) + 1),
    sourcePath: `${parent.sourcePath || parent.title || "사용자 문서"} · 하위 문서`,
    subtitle: "하위 문서 부제목을 입력하세요.",
    excerpt: "하위 문서 요약을 입력하세요.",
    blocks: [createBlock("paragraph")],
    headings: [],
    localLinks: [],
    externalLinks: [],
    mediaIds: [],
    textLength: 0,
    searchText: ""
  };
  refreshDerivedDoc(doc);
  recordUndo();
  const index = archive.documents.findIndex(item => item.id === parent.id);
  archive.documents.splice(index >= 0 ? index + 1 : 0, 0, doc);
  rebuildIndexes();
  state.selectedDocId = doc.id;
  state.view = "documents";
  markDirty();
  render();
  toast("하위 문서를 추가했습니다.");
}

function duplicateDocument() {
  const doc = currentDoc();
  if (!doc) return;
  const copy = clone(doc);
  copy.id = createId("doc");
  copy.title = `${doc.title} 복사본`;
  copy.sourcePath = `${doc.sourcePath || "사용자 문서"} · 복사본`;
  copy.blocks = (copy.blocks || []).map(block => cloneBlockForDuplicate(block));
  refreshDerivedDoc(copy);
  recordUndo();
  const index = archive.documents.findIndex(item => item.id === doc.id);
  archive.documents.splice(index + 1, 0, copy);
  rebuildIndexes();
  state.selectedDocId = copy.id;
  state.view = "documents";
  markDirty();
  render();
  toast("문서를 복제했습니다.");
}

function deleteDocument(docId = state.selectedDocId) {
  const doc = docsById.get(docId) || currentDoc();
  const index = archive.documents.findIndex(item => item.id === doc?.id);
  const end = index >= 0 ? documentSubtreeEndIndex(index) : index + 1;
  const deleting = index >= 0 ? archive.documents.slice(index, end) : [];
  const deleteIds = new Set(deleting.map(item => item.id));
  if (!doc || index < 0 || archive.documents.length <= deleting.length) {
    toast("마지막 문서는 삭제할 수 없습니다.");
    return;
  }
  showConfirmDialog({
    title: "문서 삭제",
    message: `'${doc.title}' 문서를 삭제할까요?`,
    confirmLabel: "삭제",
    danger: true,
    onConfirm: () => {
      recordUndo();
      archive.documents.splice(index, deleting.length);
      const fallbackIndex = Math.max(0, Math.min(index, archive.documents.length - 1));
      const fallbackDocId = archive.documents[fallbackIndex]?.id || "";
      archive.priorityDocs = (archive.priorityDocs || []).filter(item => !deleteIds.has(item.id));
      archive.glossary = (archive.glossary || []).map(term => deleteIds.has(term.docId) ? { ...term, docId: fallbackDocId } : term);
      rebuildIndexes();
      state.selectedDocId = fallbackDocId;
      markDirty();
      render();
      toast("문서를 삭제했습니다.");
    }
  });
}

function changeDocumentDepth(docId, direction) {
  if (!state.editMode || !docId || !direction) return;
  const doc = docsById.get(docId);
  if (!doc) return;
  const nextDepth = Math.max(0, Math.min(6, documentDepth(doc) + Math.sign(direction)));
  if (documentDepth(doc) === nextDepth) return;
  recordUndo();
  doc.depth = nextDepth;
  markDirty();
  render();
}

function documentSubtreeEndIndex(index, docs = archive.documents || []) {
  if (index < 0 || index >= docs.length) return index;
  const depth = documentDepth(docs[index]);
  let end = index + 1;
  while (end < docs.length && documentDepth(docs[end]) > depth) end += 1;
  return end;
}

function documentSubtreeSize(docId = "") {
  const index = archive.documents.findIndex(doc => doc.id === docId);
  if (index < 0) return 0;
  return documentSubtreeEndIndex(index) - index;
}

function moveDocumentToTarget(docId, targetDocId, placement = "before") {
  if (!state.editMode || !docId || !targetDocId || docId === targetDocId) return;
  const from = archive.documents.findIndex(doc => doc.id === docId);
  const to = archive.documents.findIndex(doc => doc.id === targetDocId);
  if (from < 0 || to < 0 || from === to) return;
  const fromEnd = documentSubtreeEndIndex(from);
  if (to >= from && to < fromEnd) return;
  recordUndo();
  const moving = archive.documents.splice(from, fromEnd - from);
  const targetIndex = archive.documents.findIndex(doc => doc.id === targetDocId);
  if (targetIndex < 0) {
    archive.documents.push(...moving);
  } else {
    const targetEnd = placement === "after" ? documentSubtreeEndIndex(targetIndex, archive.documents) : targetIndex;
    archive.documents.splice(targetEnd, 0, ...moving);
  }
  rebuildIndexes();
  markDirty();
  render();
}

function addBlock(type, targetIndex = null) {
  const doc = currentDoc();
  if (!doc) return;
  recordUndo();
  doc.blocks ||= [];
  const block = createBlock(type);
  const hasRequestedIndex = targetIndex !== null && targetIndex !== undefined;
  const requestedIndex = hasRequestedIndex ? Number(targetIndex) : NaN;
  let index = Number.isFinite(requestedIndex) ? requestedIndex : doc.blocks.length;
  if (!Number.isFinite(requestedIndex)) {
    const focusId = focusedBlockId();
    const focusIndex = doc.blocks.findIndex(item => item.id === focusId);
    if (focusIndex >= 0) index = focusIndex + 1;
  }
  index = Math.max(0, Math.min(doc.blocks.length, index));
  doc.blocks.splice(index, 0, block);
  refreshDerivedDoc(doc);
  markDirty();
  render();
  focusBlockEditor(block.id, "start");
}

function deleteBlock(blockId) {
  const doc = currentDoc();
  if (!doc) return;
  const block = doc.blocks?.find(item => item.id === blockId);
  showConfirmDialog({
    title: "블록 삭제",
    message: `'${blockLabel(block?.type || "paragraph")}' 블록을 삭제할까요?`,
    confirmLabel: "삭제",
    danger: true,
    onConfirm: () => {
      recordUndo();
      doc.blocks = (doc.blocks || []).filter(block => block.id !== blockId);
      refreshDerivedDoc(doc);
      markDirty();
      render();
    }
  });
}

function moveBlock(blockId, direction) {
  const doc = currentDoc();
  if (!doc || !direction) return;
  const index = doc.blocks.findIndex(block => block.id === blockId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= doc.blocks.length) return;
  recordUndo();
  const [block] = doc.blocks.splice(index, 1);
  doc.blocks.splice(nextIndex, 0, block);
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function moveBlockToTarget(blockId, targetBlockId, placement = "before") {
  const doc = currentDoc();
  if (!doc || blockId === targetBlockId) return;
  const from = doc.blocks.findIndex(block => block.id === blockId);
  const to = doc.blocks.findIndex(block => block.id === targetBlockId);
  if (from < 0 || to < 0) return;
  let nextIndex = to + (placement === "after" ? 1 : 0);
  if (from < nextIndex) nextIndex -= 1;
  if (from === nextIndex) return;
  recordUndo();
  const [block] = doc.blocks.splice(from, 1);
  doc.blocks.splice(nextIndex, 0, block);
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function duplicateBlock(blockId) {
  const doc = currentDoc();
  if (!doc) return;
  const index = doc.blocks.findIndex(block => block.id === blockId);
  if (index < 0) return;
  recordUndo();
  const copy = cloneBlockForDuplicate(doc.blocks[index]);
  doc.blocks.splice(index + 1, 0, copy);
  refreshDerivedDoc(doc);
  markDirty();
  render();
  focusBlockEditor(copy.id, "start");
}

function cloneBlockForDuplicate(block = {}, prefix = "block") {
  const copy = clone(block);
  copy.id = createId(prefix);
  if (copy.type === "generic") {
    copy.items = (copy.items || []).map(unit => cloneBlockForDuplicate(unit, "unit"));
    if (!copy.items.length) copy.items.push(createContentUnit("paragraph"));
  }
  return copy;
}

function createContentUnit(type = "paragraph") {
  const unit = createBlock(type);
  unit.id = createId("unit");
  if (unit.type === "generic") return createContentUnit("paragraph");
  return unit;
}

function contentBlock(blockId) {
  const block = currentDoc()?.blocks?.find(item => item.id === blockId);
  if (!block || block.type !== "generic") return null;
  block.items ||= [];
  return block;
}

function blockToContentUnit(block = {}) {
  const copy = clone(block);
  const originalId = copy.id || "";
  copy.id = createId("unit");
  copy.sourceBlockId = originalId;
  return copy;
}

function ensureContentBlock(block = null) {
  if (!block) return null;
  if (block.type === "generic") {
    block.items ||= [];
    return block;
  }
  const originalId = block.id;
  const originalUnit = blockToContentUnit(block);
  Object.keys(block).forEach(key => delete block[key]);
  block.id = originalId;
  block.type = "generic";
  block.items = [originalUnit];
  return block;
}

function contentUnit(blockId, unitId) {
  const block = contentBlock(blockId);
  return block?.items?.find(item => item.id === unitId) || null;
}

function insertContentUnit(blockId, type, index) {
  const doc = currentDoc();
  const targetBlock = doc?.blocks?.find(item => item.id === blockId);
  if (!doc || !targetBlock) return;
  recordUndo();
  const block = ensureContentBlock(targetBlock);
  const nextIndex = Math.max(0, Math.min(block.items.length, Number.isFinite(index) ? index : block.items.length));
  block.items.splice(nextIndex, 0, createContentUnit(type));
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function handleContentUnitAction(target) {
  const blockId = target.dataset.contentBlockId;
  const unitId = target.dataset.unitId;
  const block = contentBlock(blockId);
  const doc = currentDoc();
  if (!block || !doc) return;
  const index = block.items.findIndex(item => item.id === unitId);
  if (index < 0) return;
  recordUndo();
  if (target.dataset.contentAction === "delete") block.items.splice(index, 1);
  if (target.dataset.contentAction === "duplicate") {
    const copy = cloneBlockForDuplicate(block.items[index], "unit");
    block.items.splice(index + 1, 0, copy);
  }
  if (target.dataset.contentAction === "move-up" && index > 0) {
    [block.items[index - 1], block.items[index]] = [block.items[index], block.items[index - 1]];
  }
  if (target.dataset.contentAction === "move-down" && index < block.items.length - 1) {
    [block.items[index + 1], block.items[index]] = [block.items[index], block.items[index + 1]];
  }
  if (!block.items.length) block.items.push(createContentUnit("paragraph"));
  refreshDerivedDoc(doc);
  markDirty();
  render();
  if (target.dataset.contentAction === "duplicate") {
    const copy = block.items[index + 1];
    if (copy) focusContentUnitEditor(blockId, copy.id, "start");
  }
}

function moveContentUnitToTarget(blockId, unitId, targetUnitId, placement = "before") {
  if (!blockId || !unitId || !targetUnitId || unitId === targetUnitId) return;
  const doc = currentDoc();
  const block = contentBlock(blockId);
  if (!doc || !block) return;
  const from = block.items.findIndex(item => item.id === unitId);
  const to = block.items.findIndex(item => item.id === targetUnitId);
  if (from < 0 || to < 0 || from === to) return;
  let nextIndex = to + (placement === "after" ? 1 : 0);
  if (from < nextIndex) nextIndex -= 1;
  if (from === nextIndex) return;
  recordUndo();
  const [unit] = block.items.splice(from, 1);
  block.items.splice(nextIndex, 0, unit);
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function updateContentUnitField(blockId, unitId, field, value) {
  const doc = currentDoc();
  const unit = contentUnit(blockId, unitId);
  if (!doc || !unit) return;
  const nextValue = field === "imageWidth" ? normalizeImageWidth(value) : value;
  if (unit[field] === nextValue) return;
  recordUndo();
  unit[field] = nextValue;
  refreshDerivedDoc(doc);
  markDirty();
  refreshDocumentSidebar();
}

function applyDiagramSample(blockId, unitId = "", type = "flow") {
  const doc = currentDoc();
  const target = unitId ? contentUnit(blockId, unitId) : doc?.blocks?.find(item => item.id === blockId);
  if (!doc || !target || !["flow", "mermaid"].includes(target.type)) return;
  recordUndo();
  target.content = type === "mermaid" ? defaultMermaidSample() : "시작 -> 행동 -> 결과\n결과 -> 다음 단계";
  refreshDerivedDoc(doc);
  markDirty();
  render();
  toast(type === "mermaid" ? "Mermaid 샘플을 적용했습니다." : "Flow 샘플을 적용했습니다.");
}

function updateContentUnitTableCell(blockId, unitId, row, col, value) {
  const doc = currentDoc();
  const unit = contentUnit(blockId, unitId);
  if (!doc || !unit || unit.type !== "table") return;
  unit.rows ||= [["항목", "내용"], ["", ""]];
  unit.rows[row] ||= [];
  if (unit.rows[row][col] === value) return;
  recordUndo();
  unit.rows[row][col] = value;
  refreshDerivedDoc(doc);
  markDirty();
}

function toggleChecklistItem(blockId, index, checked) {
  const doc = currentDoc();
  const block = doc?.blocks?.find(item => item.id === blockId && item.type === "checklist");
  if (!block) return;
  const items = checklistItems(block);
  if (!items[index] || items[index].checked === checked) return;
  recordUndo();
  items[index].checked = checked;
  writeChecklistItems(block, items);
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function updateChecklistItemText(blockId, index, value) {
  const doc = currentDoc();
  const block = doc?.blocks?.find(item => item.id === blockId && item.type === "checklist");
  if (!block) return;
  const items = checklistItems(block);
  if (!items[index] || items[index].text === value) return;
  recordUndo();
  items[index].text = value;
  writeChecklistItems(block, items);
  refreshDerivedDoc(doc);
  markDirty();
}

function addChecklistItem(blockId) {
  const doc = currentDoc();
  const block = doc?.blocks?.find(item => item.id === blockId && item.type === "checklist");
  if (!block) return;
  recordUndo();
  const items = checklistItems(block);
  items.push({ checked: false, text: "새 항목" });
  writeChecklistItems(block, items);
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function initializeDrawingCanvases() {
  document.querySelectorAll("[data-drawing-canvas]").forEach(canvas => {
    const blockId = canvas.dataset.blockId || canvas.dataset.drawingCanvas || "";
    const unitId = canvas.dataset.unitId || "";
    const target = drawingTarget(blockId, unitId);
    if (!target || canvas.dataset.ready === "1") return;
    canvas.dataset.ready = "1";
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (target.dataUrl) {
      const image = new Image();
      image.onload = () => ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.src = target.dataUrl;
    }
    canvas.addEventListener("pointerdown", event => startDrawing(event, canvas, blockId, unitId));
  });
}

function drawingTarget(blockId, unitId = "") {
  if (!blockId) return null;
  if (unitId) {
    const unit = contentUnit(blockId, unitId);
    return unit?.type === "drawing" ? unit : null;
  }
  const block = currentDoc()?.blocks?.find(item => item.id === blockId);
  return block?.type === "drawing" ? block : null;
}

function drawingTool(target = {}) {
  return target.tool === "eraser" || target.drawingTool === "eraser" ? "eraser" : "pen";
}

function startDrawing(event, canvas, blockId, unitId = "") {
  if (!state.editMode) return;
  const target = drawingTarget(blockId, unitId);
  if (!target) return;
  recordUndo();
  pushDrawingTargetHistory(target, target.dataUrl || "");
  const point = canvasPoint(event, canvas);
  const ctx = canvas.getContext("2d");
  const style = applyDrawingCanvasStyle(ctx, target);
  drawCanvasDot(ctx, point, style.size);
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  drawingSession = { canvas, blockId, unitId, last: point };
  try {
    canvas.setPointerCapture?.(event.pointerId);
  } catch (_) {}
}

function drawOnCanvas(event) {
  if (!drawingSession) return;
  const { canvas } = drawingSession;
  const target = drawingTarget(drawingSession.blockId, drawingSession.unitId || "");
  if (!target) return;
  const point = canvasPoint(event, canvas);
  const ctx = canvas.getContext("2d");
  applyDrawingCanvasStyle(ctx, target);
  ctx.lineTo(point.x, point.y);
  ctx.stroke();
  drawingSession.last = point;
}

function endDrawing() {
  if (!drawingSession) return;
  const target = drawingTarget(drawingSession.blockId, drawingSession.unitId || "");
  if (target) {
    const ctx = drawingSession.canvas.getContext("2d");
    if (ctx) ctx.globalCompositeOperation = "source-over";
    target.dataUrl = drawingSession.canvas.toDataURL("image/png");
    refreshDerivedDoc(currentDoc());
    markDirty();
  }
  drawingSession = null;
}

function drawingBrushSize(target = {}) {
  const size = Number(target.brushSize || 6);
  return Number.isFinite(size) ? Math.max(1, Math.min(36, size)) : 6;
}

function applyDrawingCanvasStyle(ctx, target = {}) {
  const tool = drawingTool(target);
  const size = drawingBrushSize(target);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = size;
  ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = tool === "eraser" ? "rgba(0,0,0,1)" : target.brushColor || "#202522";
  ctx.fillStyle = ctx.strokeStyle;
  return { tool, size };
}

function drawCanvasDot(ctx, point, size = 6) {
  ctx.beginPath();
  ctx.arc(point.x, point.y, Math.max(0.5, size / 2), 0, Math.PI * 2);
  ctx.fill();
}

function pushDrawingTargetHistory(target, dataUrl = "") {
  if (!target) return;
  target.history ||= [];
  const value = String(dataUrl || "");
  if (target.history.at(-1) !== value) target.history.push(value);
  target.history = target.history.slice(-30);
}

function drawingCanvasForTarget(blockId, unitId = "") {
  if (!blockId) return null;
  const blockSelector = `[data-drawing-canvas][data-block-id="${CSS.escape(blockId)}"]`;
  if (!unitId) return document.querySelector(`${blockSelector}:not([data-unit-id])`);
  return document.querySelector(`${blockSelector}[data-unit-id="${CSS.escape(unitId)}"]`);
}

function canvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height
  };
}

function clearDrawing(blockId, unitId = "") {
  const doc = currentDoc();
  const target = drawingTarget(blockId, unitId);
  if (!doc || !target) return;
  recordUndo();
  const canvas = drawingCanvasForTarget(blockId, unitId);
  const currentDataUrl = target.dataUrl || canvas?.toDataURL?.("image/png") || "";
  pushDrawingTargetHistory(target, currentDataUrl);
  target.dataUrl = "";
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function undoDrawing(blockId, unitId = "") {
  const doc = currentDoc();
  const target = drawingTarget(blockId, unitId);
  if (!doc || !target || !target.history?.length) return;
  recordUndo();
  target.dataUrl = target.history.pop() || "";
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function selectPlanningMembers(form, name) {
  if (!form) return;
  let selected = 0;
  form.querySelectorAll("input[type='checkbox']").forEach(input => {
    if (input.name === name) {
      input.checked = true;
      selected += 1;
    }
  });
  if (selected) toast(name === "attendees" ? "참석자를 모두 선택했습니다." : "팀원을 모두 선택했습니다.");
}

function planningFormValues(form) {
  const values = {};
  for (const input of form.querySelectorAll("input, select, textarea")) {
    if (!input.name) continue;
    if ((input.type === "checkbox" || input.type === "radio") && !input.checked) continue;
    const value = String(input.value || "").trim();
    if (!value) continue;
    if (!values[input.name]) {
      values[input.name] = value;
    } else {
      const current = Array.isArray(values[input.name]) ? values[input.name] : [values[input.name]];
      current.push(value);
      values[input.name] = current;
    }
  }
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key,
    Array.isArray(value) ? [...new Set(value)].join(", ") : value
  ]));
}

function createPlanningRecord(blockId, type, form) {
  const doc = currentDoc();
  const block = doc?.blocks?.find(item => item.id === blockId);
  let collection = collectionsById.get(block?.collectionId);
  if (!block || !form) return;
  const values = planningFormValues(form);
  const validationMessage = planningRecordValidationMessage(type, values);
  if (validationMessage) {
    toast(validationMessage);
    return;
  }
  const record = planningRecordForType(type, values);
  if (!Object.values(record).some(Boolean)) {
    toast("추가할 내용을 입력하세요.");
    return;
  }
  recordUndo();
  if (!collection) {
    collection = createPlanningCollection(block, type, record);
    archive.collections.push(collection);
    block.collectionId = collection.id;
    rebuildIndexes();
  }
  appendRecordToCollection(collection, record);
  refreshDerivedCollection(collection);
  refreshDerivedDoc(doc);
  markDirty();
  render();
  toast("항목을 추가했습니다.");
}

function createPlanningCollection(block, type, seedRecord = {}) {
  const category = currentDoc()?.category || archive.categories[0]?.id || "general";
  const collection = {
    id: createId("collection"),
    title: `${block.title || blockLabel(type)} 데이터`,
    category,
    categoryLabel: categoryById.get(category)?.label || category,
    sourcePath: "사용자 추가 표",
    rows: [Object.keys(seedRecord).length ? Object.keys(seedRecord) : ["항목", "내용"]],
    rowCount: 1,
    columnCount: Object.keys(seedRecord).length || 2,
    searchText: ""
  };
  refreshDerivedCollection(collection);
  return collection;
}

function planningRecordValidationMessage(type, values = {}) {
  if (type === "calendar" && !values.title) return "일정 제목을 입력하세요.";
  if (type === "team" && !values.name) return "팀원 이름을 입력하세요.";
  if (type === "workboard") {
    if (!values.title) return "업무 내용을 입력하세요.";
    if (!values.owner) return "담당 팀원을 선택하거나 입력하세요.";
  }
  if (type === "meetingbook") {
    if (!values.attendees) return "회의 참석자를 선택하거나 입력하세요.";
  }
  if (type === "dialogue" && !values.line) return "대사를 입력하세요.";
  return "";
}

function planningRecordForType(type, values) {
  if (type === "calendar") return { 날짜: values.date || currentDateKey(), 제목: values.title, 담당: values.owner, 상태: values.status || "예정" };
  if (type === "team") return { 이름: values.name, 역할: values.role, 메모: values.note };
  if (type === "workboard") {
    return {
      업무ID: createId("task"),
      제목: values.title,
      담당: values.owner,
      상태: values.status || "예정",
      우선순위: values.priority || "보통",
      시작일: currentDateKey(),
      마감일: values.due,
      분류: values.category,
      프로젝트: values.project,
      연결일정ID: values.scheduleId,
      진행률: values.progress || "0",
      체크리스트: values.checklist,
      메모: values.note
    };
  }
  if (type === "meetingbook") {
    const date = values.date || currentDateKey();
    const time = values.time || "22:00";
    const status = displayMeetingStatus(values.status || "예정", date, time);
    return {
      회의ID: createId("meeting"),
      일자: date,
      시간: time,
      회의명: values.title || "주간 회의",
      참석자: values.attendees,
      안건: values.agenda,
      회의록: values.minutes,
      결정사항: values.decisions,
      상태: status,
      작성일: currentDateKey()
    };
  }
  if (type === "dialogue") {
    return {
      NodeID: createId("node"),
      StageID: values.stage || "",
      단계명: "",
      상황: "",
      화자: values.speaker || "쉼청이",
      대사: values.line,
      다음NodeID: values.next,
      선택지1: "",
      다음1: "",
      선택지2: "",
      다음2: "",
      선택지3: "",
      다음3: "",
      메모: "",
      상태: "작성"
    };
  }
  return values;
}

function appendRecordToCollection(collection, record) {
  const headers = collection.rows?.[0]?.length ? [...collection.rows[0]] : Object.keys(record);
  for (const key of Object.keys(record)) {
    if (!headers.some(header => headerMatchesRecordKey(header, key))) headers.push(key);
  }
  collection.rows ||= [];
  collection.rows[0] = headers;
  collection.rows.splice(1, 0, headers.map(header => {
    const recordKeys = Object.keys(record);
    const key = recordKeys.find(recordKey => header === recordKey)
      || recordKeys.find(recordKey => headerMatchesRecordKey(header, recordKey));
    return key ? record[key] || "" : "";
  }));
}

function headerMatchesRecordKey(header, key) {
  if (header === key) return true;
  const aliases = {
    NodeID: ["NodeID", "노드ID", "노드", "nodeid", "node", "id"],
    StageID: ["StageID", "단계ID", "온기단계", "온기 단계", "stageid", "stage"],
    단계명: ["단계명", "온기명", "stageName", "name"],
    상황: ["상황", "situation", "context"],
    다음NodeID: ["다음NodeID", "다음노드", "다음", "nextid", "next"],
    업무ID: ["업무ID", "taskid", "task id", "id"],
    회의ID: ["회의ID", "meetingid", "meeting id", "id"],
    제목: ["제목", "일정", "업무", "안건", "회의", "title", "name"],
    업무: ["업무", "할일", "제목", "task", "title"],
    날짜: ["날짜", "일자", "date", "day", "마감", "기한"],
    일자: ["일자", "날짜", "date", "day"],
    담당: ["담당", "담당자", "owner", "member"],
    상태: ["상태", "status"],
    우선순위: ["우선순위", "우선", "priority"],
    시작일: ["시작일", "시작", "start", "startdate"],
    프로젝트: ["프로젝트", "project"],
    분류: ["분류", "유형", "category", "type"],
    연결일정ID: ["연결일정ID", "일정ID", "scheduleid", "calendarid", "link"],
    진행률: ["진행률", "진척도", "progress"],
    체크리스트: ["체크리스트", "하위항목", "checklist", "todo"],
    참석자: ["참석자", "참석", "attendee", "attendees", "member"],
    이름: ["이름", "팀원", "name"],
    역할: ["역할", "직무", "role"],
    메모: ["메모", "비고", "note"],
    마감: ["마감", "마감일", "기한", "due", "날짜"],
    마감일: ["마감일", "마감", "기한", "due", "deadline", "날짜"],
    시간: ["시간", "time"],
    회의명: ["회의명", "회의", "안건", "제목", "title", "name"],
    안건: ["안건", "제목", "회의", "회의명", "title", "agenda"],
    결정사항: ["결정사항", "결정", "decision", "note"],
    회의록: ["회의록", "minutes", "내용"],
    작성일: ["작성일", "작성", "created", "createdat"],
    화자: ["화자", "캐릭터", "speaker"],
    대사: ["대사", "내용", "text", "line"],
    다음: ["다음", "선택", "next"],
    선택지1: ["선택지1", "선택1", "choice1", "option1"],
    다음1: ["다음1", "next1", "target1"],
    선택지2: ["선택지2", "선택2", "choice2", "option2"],
    다음2: ["다음2", "next2", "target2"],
    선택지3: ["선택지3", "선택3", "choice3", "option3"],
    다음3: ["다음3", "next3", "target3"]
  };
  const candidates = aliases[key] || [key];
  return candidates.some(candidate => searchable(header).includes(searchable(candidate)));
}

function togglePlanningTask(blockId, rowIndex, checked) {
  const doc = currentDoc();
  const block = doc?.blocks?.find(item => item.id === blockId);
  const collection = collectionsById.get(block?.collectionId);
  if (!collection || !collection.rows[rowIndex]) return;
  const statusCol = ensureCollectionColumn(collection, ["상태", "status"], "상태");
  const progressCol = ensureCollectionColumn(collection, ["진행률", "진척도", "progress"], "진행률");
  recordUndo();
  const row = collection.rows[rowIndex];
  row[statusCol] = checked ? "완료" : "진행";
  const currentProgress = String(row[progressCol] || "").trim();
  row[progressCol] = checked ? "100" : (currentProgress === "100" || !currentProgress ? "50" : currentProgress);
  refreshDerivedCollection(collection);
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function shiftCalendarBlock(blockId, delta) {
  const block = currentDoc()?.blocks?.find(item => item.id === blockId);
  if (!block || !Number.isFinite(delta)) return;
  setCalendarBlockMonth(blockId, shiftMonthKey(block.month || currentMonthKey(), delta));
}

function setCalendarBlockMonth(blockId, month) {
  const doc = currentDoc();
  const block = doc?.blocks?.find(item => item.id === blockId);
  if (!block) return;
  recordUndo();
  block.month = month;
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function setDialogueStageBlock(blockId, stageId) {
  const doc = currentDoc();
  const block = doc?.blocks?.find(item => item.id === blockId);
  if (!block) return;
  const nextStage = String(stageId || "").trim();
  if (String(block.warmthStage || "") === nextStage && !block.currentRowIndex && !block.currentNodeId) return;
  recordUndo();
  block.warmthStage = nextStage;
  block.currentRowIndex = 1;
  block.currentNodeId = "";
  block.history = [];
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function stepDialogueBlock(blockId, rowIndex, remember = true) {
  const doc = currentDoc();
  const block = doc?.blocks?.find(item => item.id === blockId);
  const collection = collectionsById.get(block?.collectionId);
  if (!block || !collection) return;
  const max = Math.max(1, collection.rows.length - 1);
  const next = Math.max(1, Math.min(max, Number(rowIndex) || 1));
  const current = Number(block.currentRowIndex || 1);
  if (next === current) return;
  const history = Array.isArray(block.history) ? block.history.map(Number).filter(Number.isFinite) : [];
  const isHistoryBack = history.at(-1) === next;
  recordUndo();
  block.currentRowIndex = next;
  const { headers, records } = rowsToRecords(collection.rows || []);
  const idKey = dialogueNodeIdKey(headers);
  const targetRecord = records.find(record => Number(record.__rowIndex) === next);
  block.currentNodeId = idKey && targetRecord ? String(targetRecord[idKey] || "").trim() : "";
  if (isHistoryBack) {
    history.pop();
    block.history = history;
  } else if (remember) {
    history.push(current);
    block.history = history.slice(-20);
  } else {
    block.history = history;
  }
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function backDialogueBlock(blockId, fallbackRow = 1) {
  const doc = currentDoc();
  const block = doc?.blocks?.find(item => item.id === blockId);
  const history = Array.isArray(block?.history) ? block.history.map(Number).filter(Number.isFinite) : [];
  stepDialogueBlock(blockId, history.at(-1) || fallbackRow, false);
}

function resetDialogueBlock(blockId) {
  const doc = currentDoc();
  const block = doc?.blocks?.find(item => item.id === blockId);
  if (!block) return;
  recordUndo();
  block.currentRowIndex = 1;
  block.currentNodeId = "";
  block.history = [];
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function addCollectionRow() {
  const collection = currentCollection();
  if (!collection) return;
  recordUndo();
  const width = Math.max(1, collection.columnCount || Math.max(0, ...collection.rows.map(row => row.length)));
  collection.rows.push(Array.from({ length: width }, () => ""));
  refreshDerivedCollection(collection);
  markDirty();
  render();
}

function addCollectionColumn() {
  const collection = currentCollection();
  if (!collection) return;
  recordUndo();
  collection.rows = (collection.rows || []).map((row, index) => [...row, index === 0 ? "새 열" : ""]);
  refreshDerivedCollection(collection);
  markDirty();
  render();
}

function deleteCollectionRow(rowIndex) {
  const collection = currentCollection();
  if (!collection || rowIndex < 0 || rowIndex >= collection.rows.length) return;
  recordUndo();
  collection.rows.splice(rowIndex, 1);
  refreshDerivedCollection(collection);
  markDirty();
  render();
}

function deleteCollectionColumn(colIndex) {
  const collection = currentCollection();
  if (!collection || colIndex < 0 || colIndex >= (collection.columnCount || 0)) return;
  recordUndo();
  collection.rows = (collection.rows || []).map(row => {
    const next = [...row];
    next.splice(colIndex, 1);
    return next.length ? next : [""];
  });
  refreshDerivedCollection(collection);
  markDirty();
  render();
}

function sortCollection(colIndex, direction = "asc") {
  const collection = currentCollection();
  if (!collection || colIndex < 0) return;
  const [header = [], ...body] = collection.rows || [];
  recordUndo();
  body.sort((a, b) => String(a[colIndex] || "").localeCompare(String(b[colIndex] || ""), "ko-KR", { numeric: true }));
  if (direction === "desc") body.reverse();
  collection.rows = [header, ...body];
  refreshDerivedCollection(collection);
  markDirty();
  render();
  toast("표를 정렬했습니다.");
}

function exportCurrentCollectionCsv() {
  const collection = currentCollection();
  if (!collection) return;
  exportRowsCsv(tableRowsForExport(collection), `${safeFilename(collection.title || "collection")}.csv`);
  toast("CSV를 출력했습니다.");
}

function tableSourceFromControl(control) {
  const kind = control.dataset.tableKind || (control.dataset.unitId ? "unit" : control.dataset.blockId ? "table" : "collection");
  if (kind === "collection") {
    const collection = currentCollection();
    return collection ? { kind, source: collection, rows: collection.rows || [], title: collection.title || "collection" } : null;
  }
  if (kind === "unit") {
    const unit = contentUnit(control.dataset.blockId, control.dataset.unitId);
    return unit ? { kind, source: unit, rows: unit.rows || [], title: unit.caption || "table", blockId: control.dataset.blockId, unitId: control.dataset.unitId } : null;
  }
  const doc = currentDoc();
  const block = doc?.blocks?.find(item => item.id === control.dataset.blockId && item.type === "table");
  return block ? { kind: "table", source: block, rows: block.rows || [], title: block.caption || doc?.title || "table", blockId: block.id } : null;
}

function setActiveTableCellFromElement(element) {
  const next = tableImageInsertFromElement(element);
  if (next) activeTableCell = next;
}

function tableCellMatchesSource(cell, ref) {
  if (!cell || !ref || cell.kind !== ref.kind) return false;
  if (ref.kind === "collection") return true;
  if (cell.blockId !== ref.blockId) return false;
  if (ref.kind === "unit" && cell.unitId !== ref.unitId) return false;
  return true;
}

function tableControlColumn(control, ref = null) {
  const select = control.closest(".sheet-tools")?.querySelector("[data-table-sort-column]");
  const value = Number(select?.value ?? control.dataset.col);
  if (Number.isInteger(value) && value >= 0) return value;
  const width = tableWidth(ref?.rows || []);
  return Math.max(0, width - 1);
}

function selectedTableColumn(control, ref = tableSourceFromControl(control)) {
  if (tableCellMatchesSource(activeTableCell, ref) && Number.isInteger(activeTableCell.col) && activeTableCell.col >= 0) {
    return activeTableCell.col;
  }
  return tableControlColumn(control, ref);
}

function selectedTableRow(control, ref = tableSourceFromControl(control)) {
  if (tableCellMatchesSource(activeTableCell, ref) && Number.isInteger(activeTableCell.row) && activeTableCell.row >= 0) {
    return activeTableCell.row;
  }
  const rows = ref?.rows || [];
  return Math.max(0, rows.length - 1);
}

function updateTableViewFilter(control, value, options = {}) {
  const ref = tableSourceFromControl(control);
  if (!ref) return;
  if ((ref.source.filter || "") === value) {
    if (options.renderAfter) render();
    return;
  }
  recordUndo();
  ref.source.filter = value;
  markTableSourceDirty(ref, options.renderAfter);
}

function sortTableView(control) {
  const ref = tableSourceFromControl(control);
  if (!ref) return;
  const col = tableControlColumn(control, ref);
  const direction = control.dataset.direction || "asc";
  recordUndo();
  ref.source.sortColumn = col;
  ref.source.sortDir = direction === "desc" ? "desc" : "asc";
  markTableSourceDirty(ref, true);
  toast(direction === "desc" ? "내림차순으로 정렬했습니다." : "오름차순으로 정렬했습니다.");
}

function clearTableView(control) {
  const ref = tableSourceFromControl(control);
  if (!ref) return;
  recordUndo();
  ref.source.filter = "";
  ref.source.sortColumn = -1;
  ref.source.sortDir = "asc";
  markTableSourceDirty(ref, true);
  toast("필터와 정렬을 해제했습니다.");
}

function hideTableColumnFromControl(control) {
  const ref = tableSourceFromControl(control);
  if (!ref) return;
  const col = selectedTableColumn(control, ref);
  const name = tableColumnName(ref.rows, col);
  if (!name) return;
  const hidden = hiddenTableColumnSet(ref.source);
  if (hidden.has(name)) return;
  recordUndo();
  ref.source.hiddenColumns = [...hidden, name];
  markTableSourceDirty(ref, true);
  toast("선택한 열을 숨겼습니다.");
}

function showHiddenTableColumns(control) {
  const ref = tableSourceFromControl(control);
  if (!ref || !hiddenTableColumnSet(ref.source).size) return;
  recordUndo();
  ref.source.hiddenColumns = [];
  markTableSourceDirty(ref, true);
  toast("숨긴 열을 다시 표시했습니다.");
}

function exportTableView(control, format = "csv") {
  const ref = tableSourceFromControl(control);
  if (!ref) return;
  const rows = tableRowsForExport(ref.source);
  const filename = safeFilename(ref.title || ref.kind || "table");
  if (format === "xlsx") {
    exportRowsXlsx(rows, `${filename}.xlsx`, filename);
    return;
  }
  exportRowsCsv(rows, `${filename}.csv`);
  toast("CSV를 출력했습니다.");
}

function deleteTableColumnFromControl(control) {
  const ref = tableSourceFromControl(control);
  if (!ref) return;
  const col = selectedTableColumn(control, ref);
  if (ref.kind === "collection") {
    deleteCollectionColumn(col);
    return;
  }
  if (ref.kind === "unit") {
    deleteUnitTableColumn(ref.blockId, ref.unitId, col);
    return;
  }
  deleteTableColumn(ref.blockId, col);
}

function deleteTableRowFromControl(control) {
  const ref = tableSourceFromControl(control);
  if (!ref) return;
  const row = selectedTableRow(control, ref);
  if (ref.kind === "collection") {
    deleteCollectionRow(row);
    return;
  }
  if (ref.kind === "unit") {
    deleteUnitTableRow(ref.blockId, ref.unitId, row);
    return;
  }
  deleteTableRow(ref.blockId, row);
}

function tableRowsForExport(source = {}) {
  const rows = source.rows || [];
  return tableViewRows(rows, source).rows.map(item => item.row);
}

function exportRowsCsv(rows = [], filename = "table.csv") {
  const csv = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  downloadBlob(filename, "\ufeff" + csv, "text/csv;charset=utf-8");
}

function exportRowsXlsx(rows = [], filename = "table.xlsx", sheetName = "Sheet1") {
  if (!window.XLSX) {
    exportRowsCsv(rows, filename.replace(/\.xlsx$/i, ".csv"));
    toast("Excel 라이브러리를 불러오지 못해 CSV로 저장했습니다.");
    return;
  }
  const workbook = window.XLSX.utils.book_new();
  const sheet = window.XLSX.utils.aoa_to_sheet(rows);
  window.XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(sheetName));
  window.XLSX.writeFile(workbook, filename);
  toast("Excel 파일을 출력했습니다.");
}

function exportArchiveWorkbook() {
  const sheets = archiveWorkbookSheets();
  if (!sheets.length) {
    toast("내보낼 표 데이터가 없습니다.");
    return;
  }
  if (!window.XLSX) {
    toast("Excel 라이브러리가 아직 준비되지 않았습니다. 잠시 후 다시 시도하세요.");
    return;
  }
  const workbook = window.XLSX.utils.book_new();
  const usedNames = new Set();
  sheets.forEach(sheetInfo => {
    const sheet = window.XLSX.utils.aoa_to_sheet(sheetInfo.rows);
    window.XLSX.utils.book_append_sheet(workbook, sheet, uniqueSheetName(sheetInfo.name, usedNames));
  });
  window.XLSX.writeFile(workbook, `${safeFilename(archive.title || "archive")}-tables.xlsx`);
  toast(`${sheets.length}개 시트를 Excel로 저장했습니다.`);
}

function archiveWorkbookSheets() {
  const sheets = [];
  (archive.collections || []).forEach(collection => {
    const rows = normalizeTableRows(collection.rows || []);
    if (rows.length) sheets.push({ name: collection.title || "collection", rows });
  });
  (archive.documents || []).forEach(doc => {
    (doc.blocks || []).forEach((block, blockIndex) => {
      if (block.type === "table") {
        const rows = normalizeTableRows(block.rows || []);
        if (rows.length) sheets.push({ name: `${doc.title || "document"} ${block.caption || `table ${blockIndex + 1}`}`, rows });
      }
      if (block.type === "generic") {
        (block.items || []).forEach((unit, unitIndex) => {
          if (unit.type !== "table") return;
          const rows = normalizeTableRows(unit.rows || []);
          if (rows.length) sheets.push({ name: `${doc.title || "document"} ${unit.caption || `unit table ${unitIndex + 1}`}`, rows });
        });
      }
    });
  });
  return sheets;
}

function uniqueSheetName(value, usedNames) {
  const base = safeSheetName(value);
  let name = base;
  let index = 2;
  while (usedNames.has(name)) {
    const suffix = ` ${index}`;
    name = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    index += 1;
  }
  usedNames.add(name);
  return name;
}

function safeSheetName(value = "Sheet1") {
  return String(value || "Sheet1").replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 31) || "Sheet1";
}

function markTableSourceDirty(ref, renderAfter = true) {
  if (ref.kind === "collection") {
    refreshDerivedCollection(ref.source);
  } else {
    refreshDerivedDoc(currentDoc());
  }
  markDirty();
  if (renderAfter) render();
}

function addCollection() {
  const category = state.category !== "all" ? state.category : archive.categories[0]?.id || "general";
  const collection = {
    id: createId("collection"),
    title: "새 표 데이터",
    category,
    categoryLabel: categoryById.get(category)?.label || category,
    sourcePath: "사용자 추가 표",
    rows: [["항목", "내용"], ["", ""]],
    rowCount: 2,
    columnCount: 2,
    searchText: ""
  };
  refreshDerivedCollection(collection);
  recordUndo();
  archive.collections.unshift(collection);
  rebuildIndexes();
  state.selectedCollectionId = collection.id;
  state.view = "collections";
  markDirty();
  render();
  toast("표 데이터를 추가했습니다.");
}

function deleteCollection() {
  const collection = currentCollection();
  if (!collection || archive.collections.length <= 1) {
    toast("마지막 표 데이터는 삭제할 수 없습니다.");
    return;
  }
  showConfirmDialog({
    title: "표 데이터 삭제",
    message: `'${collection.title}' 표 데이터를 삭제할까요?`,
    confirmLabel: "삭제",
    danger: true,
    onConfirm: () => {
      recordUndo();
      archive.collections = archive.collections.filter(item => item.id !== collection.id);
      for (const doc of archive.documents || []) {
        for (const block of doc.blocks || []) {
          if (block.collectionId === collection.id) block.collectionId = archive.collections[0]?.id || "";
        }
      }
      rebuildIndexes();
      state.selectedCollectionId = archive.collections[0]?.id || "";
      markDirty();
      render();
      toast("표 데이터를 삭제했습니다.");
    }
  });
}

function addTableRow(blockId) {
  const doc = currentDoc();
  const block = doc?.blocks?.find(item => item.id === blockId && item.type === "table");
  if (!block) return;
  recordUndo();
  block.rows ||= [["항목", "내용"]];
  const width = tableWidth(block.rows);
  block.rows.push(Array.from({ length: width }, () => ""));
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function addTableColumn(blockId) {
  const doc = currentDoc();
  const block = doc?.blocks?.find(item => item.id === blockId && item.type === "table");
  if (!block) return;
  recordUndo();
  block.rows = (block.rows || []).map((row, index) => [...row, index === 0 ? "새 열" : ""]);
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function deleteTableRow(blockId, rowIndex) {
  const doc = currentDoc();
  const block = doc?.blocks?.find(item => item.id === blockId && item.type === "table");
  if (!block || rowIndex < 0 || rowIndex >= block.rows.length) return;
  recordUndo();
  block.rows.splice(rowIndex, 1);
  if (!block.rows.length) block.rows.push([""]);
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function deleteTableColumn(blockId, colIndex) {
  const doc = currentDoc();
  const block = doc?.blocks?.find(item => item.id === blockId && item.type === "table");
  if (!block || colIndex < 0 || colIndex >= tableWidth(block.rows || [])) return;
  recordUndo();
  block.rows = deleteColumnFromRows(block.rows || [], colIndex);
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function addUnitTableRow(blockId, unitId) {
  const doc = currentDoc();
  const unit = contentUnit(blockId, unitId);
  if (!doc || !unit || unit.type !== "table") return;
  recordUndo();
  unit.rows ||= [["항목", "내용"]];
  unit.rows.push(Array.from({ length: tableWidth(unit.rows) }, () => ""));
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function addUnitTableColumn(blockId, unitId) {
  const doc = currentDoc();
  const unit = contentUnit(blockId, unitId);
  if (!doc || !unit || unit.type !== "table") return;
  recordUndo();
  unit.rows = (unit.rows || [["항목", "내용"]]).map((row, index) => [...row, index === 0 ? "새 열" : ""]);
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function deleteUnitTableRow(blockId, unitId, rowIndex) {
  const doc = currentDoc();
  const unit = contentUnit(blockId, unitId);
  if (!doc || !unit || unit.type !== "table" || rowIndex < 0 || rowIndex >= (unit.rows || []).length) return;
  recordUndo();
  unit.rows.splice(rowIndex, 1);
  if (!unit.rows.length) unit.rows.push([""]);
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function deleteUnitTableColumn(blockId, unitId, colIndex) {
  const doc = currentDoc();
  const unit = contentUnit(blockId, unitId);
  if (!doc || !unit || unit.type !== "table" || colIndex < 0 || colIndex >= tableWidth(unit.rows || [])) return;
  recordUndo();
  unit.rows = deleteColumnFromRows(unit.rows || [], colIndex);
  refreshDerivedDoc(doc);
  markDirty();
  render();
}

function deleteColumnFromRows(rows = [], colIndex) {
  return (rows.length ? rows : [[""]]).map(row => {
    const next = Array.isArray(row) ? [...row] : [String(row ?? "")];
    next.splice(colIndex, 1);
    return next.length ? next : [""];
  });
}

function createBlock(type) {
  const id = createId("block");
  if (type === "generic") return { id, type: "generic", items: [createContentUnit("paragraph")] };
  if (type === "heading") return { id, type: "heading", level: 1, text: "새 제목" };
  if (type === "callout") return { id, type: "callout", content: "강조할 내용" };
  if (type === "quote") return { id, type: "quote", content: "인용하거나 참고할 문장" };
  if (type === "list") return { id, type: "list", text: "새 목록 항목" };
  if (type === "checklist") return { id, type: "checklist", content: "- [ ] 확인할 항목" };
  if (type === "code") return { id, type: "code", language: "text", content: "메모 또는 스크립트를 입력하세요." };
  if (type === "divider") return { id, type: "divider", label: "" };
  if (type === "table") return { id, type: "table", rows: [["항목", "내용"], ["", ""]] };
  if (type === "dataset") return { id, type: "dataset", collectionId: archive.collections[0]?.id || "" };
  if (type === "flow") return { id, type: "flow", content: "시작 -> 행동 -> 변화" };
  if (type === "mermaid") return { id, type: "mermaid", content: defaultMermaidSample() };
  if (type === "drawing") return { id, type: "drawing", caption: "그림판", dataUrl: "", brushColor: "#202522", brushSize: 6, tool: "pen", history: [] };
  if (type === "media") return { id, type: "media", mediaId: "", path: "", caption: "이미지", imageWidth: 100 };
  if (type === "video") return { id, type: "video", mediaId: "", path: "", caption: "동영상" };
  if (type === "attachment") return { id, type: "attachment", path: "", text: "첨부 파일", fileName: "", size: 0, content: "" };
  if (type === "dialogue") return { id, type: "dialogue", title: "대화", content: "대화 흐름을 입력하세요.", collectionId: findCollectionByKeyword(["대화", "노드"])?.id || "" };
  if (type === "calendar") return { id, type: "calendar", title: "프로젝트 달력", content: "일정 메모를 입력하세요.", collectionId: findCollectionByKeyword(["달력", "일정"])?.id || "" };
  if (type === "team") return { id, type: "team", title: "팀원 목록", content: "팀원과 역할을 입력하세요.", collectionId: findCollectionByKeyword(["팀원", "멤버"])?.id || "" };
  if (type === "workboard") return { id, type: "workboard", title: "업무 관리", content: "업무와 상태를 입력하세요.", collectionId: findCollectionByKeyword(["업무", "task"])?.id || "" };
  if (type === "meetingbook") return { id, type: "meetingbook", title: "회의록", content: "회의 안건과 결정사항을 입력하세요.", collectionId: findCollectionByKeyword(["회의"])?.id || "", defaultWeekday: "월요일", defaultTime: "22:00" };
  return { id, type: "paragraph", text: "새 문단" };
}

function defaultMermaidSample() {
  return "flowchart TD\n  A[시작] --> B[진행]\n  B --> C[완료]";
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function findCollectionByKeyword(keywords = []) {
  const normalized = keywords.map(searchable);
  return archive.collections.find(collection => {
    const haystack = searchable(`${collection.title} ${collection.sourcePath} ${collection.categoryLabel}`);
    return normalized.some(keyword => haystack.includes(keyword));
  });
}

function refreshDerivedDoc(doc) {
  if (!doc) return;
  doc.categoryLabel = categoryById.get(doc.category)?.label || doc.categoryLabel || doc.category;
  doc.headings = docOutlineItems(doc).map(({ level, text, targetId }) => ({ level, text, targetId })).slice(0, 28);
  const text = [
    doc.title,
    doc.subtitle,
    doc.categoryLabel,
    doc.status,
    doc.excerpt,
    ...(doc.blocks || []).flatMap(block => blockTextParts(block))
  ].join(" ");
  doc.textLength = text.replace(/\s+/g, " ").trim().length;
  doc.searchText = text.slice(0, 7000);
}

function docOutlineItems(doc) {
  const items = [];
  for (const block of doc?.blocks || []) {
    if (block.type === "heading" && headingText(block)) {
      items.push({
        level: headingLevel(block),
        text: headingText(block),
        targetId: `doc-block-${block.id}`
      });
    } else if (styledHeadingLevel(block) && headingText(block)) {
      items.push({
        level: styledHeadingLevel(block),
        text: headingText(block),
        targetId: `doc-block-${block.id}`
      });
    }
    if (block.type === "generic") {
      for (const unit of block.items || []) {
        if (unit.type === "heading" && headingText(unit)) {
          items.push({
            level: headingLevel(unit),
            text: headingText(unit),
            targetId: `doc-unit-${unit.id}`
          });
        } else if (styledHeadingLevel(unit) && headingText(unit)) {
          items.push({
            level: styledHeadingLevel(unit),
            text: headingText(unit),
            targetId: `doc-unit-${unit.id}`
          });
        }
      }
    }
  }
  return items.slice(0, 28);
}

function headingText(block = {}) {
  return String(block.text || block.content || block.title || "").trim();
}

function headingLevel(block = {}) {
  return Math.min(3, Math.max(1, Number(block.level || 1)));
}

function styledHeadingLevel(block = {}) {
  const level = Number(block.headingLevel || 0);
  return [1, 2, 3].includes(level) ? level : 0;
}

function refreshDerivedCollection(collection) {
  collection.rowCount = collection.rows.length;
  collection.columnCount = Math.max(0, ...collection.rows.map(row => row.length));
  collection.searchText = `${collection.title} ${collection.sourcePath} ${collection.rows.slice(0, 80).flat().join(" ")}`.slice(0, 7000);
}

function blockTextParts(block) {
  if (!block) return [];
  if (block.type === "generic") return (block.items || []).flatMap(unit => blockTextParts(unit));
  if (block.type === "table") return (block.rows || []).flat();
  return [block.text, block.content, block.caption, block.label, block.title, block.path, block.url, block.fileName].filter(Boolean);
}

function blockMatchesQuery(block, query = searchable(state.query)) {
  if (!query) return false;
  return searchable(blockTextParts(block).join(" ")).includes(query);
}

function rowsToRecords(rows = []) {
  const normalized = rows.filter(row => Array.isArray(row));
  const headers = (normalized[0] || []).map((cell, index) => String(cell || `열 ${index + 1}`).trim() || `열 ${index + 1}`);
  const records = normalized.slice(1)
    .filter(row => row.some(cell => String(cell || "").trim()))
    .map((row, index) => ({
      ...Object.fromEntries(headers.map((header, colIndex) => [header, String(row[colIndex] || "").trim()])),
      __rowIndex: index + 1,
      __cells: row.map(cell => String(cell || "").trim())
    }));
  return { headers, records };
}

function bestHeader(headers = [], candidates = []) {
  const normalized = candidates.map(searchable);
  return headers.find(header => normalized.some(candidate => searchable(header).includes(candidate))) || headers[0] || "";
}

function preferredHeader(headers = [], candidates = [], options = {}) {
  const normalized = candidates.map(searchable).filter(Boolean);
  const rejected = (options.reject || []).map(searchable).filter(Boolean);
  const usableHeaders = headers.filter(header => {
    const value = searchable(header);
    return !rejected.some(candidate => value.includes(candidate));
  });
  const exact = usableHeaders.find(header => normalized.some(candidate => searchable(header) === candidate));
  if (exact) return exact;
  const fuzzy = usableHeaders.find(header => normalized.some(candidate => searchable(header).includes(candidate)));
  if (fuzzy) return fuzzy;
  return bestHeader(headers, candidates);
}

function matchingHeader(headers = [], candidates = []) {
  const normalized = candidates.map(searchable);
  return headers.find(header => normalized.some(candidate => searchable(header).includes(candidate))) || "";
}

function uniqueTerms(items = []) {
  const map = new Map();
  for (const item of items) {
    const key = item.term;
    if (!key) continue;
    if (!map.has(key)) map.set(key, item);
    else if (item.glossary) map.set(key, item);
  }
  return [...map.values()];
}

function parseAliases(value = "") {
  const items = Array.isArray(value) ? value : String(value || "").split(/[,\n]/);
  return [...new Set(items.map(item => String(item || "").trim()).filter(Boolean))];
}

function glossaryAliases(term = {}) {
  const keyword = String(term.keyword || "").trim();
  return parseAliases(term.aliases || []).filter(alias => alias !== keyword);
}

function aliasesText(aliases = []) {
  return parseAliases(aliases).join(", ");
}

function findGlossaryTerm(keyword = "") {
  const target = String(keyword || "").trim();
  if (!target) return null;
  return (archive.glossary || []).find(term => term.keyword === target || glossaryAliases(term).includes(target)) || null;
}

function canonicalWikiTerm(value = "") {
  const target = String(value || "").trim();
  return findGlossaryTerm(target)?.keyword || target;
}

function termSearchBlob(item = {}) {
  return `${item.term || ""} ${item.context || ""} ${aliasesText(item.aliases || [])}`;
}

function documentMentionsForTerm(term = {}) {
  const keyword = term.keyword || term.term || "";
  const probes = [keyword, ...glossaryAliases(term)].map(searchable).filter(Boolean);
  if (!probes.length) return [];
  return (archive.documents || []).filter(doc => {
    const text = searchable([
      doc.title,
      doc.subtitle,
      doc.excerpt,
      doc.searchText,
      ...(doc.blocks || []).flatMap(blockTextParts)
    ].filter(Boolean).join(" "));
    return probes.some(probe => text.includes(probe));
  });
}

function relatedTermsForTerm(term = {}, candidates = []) {
  const keyword = term.keyword || term.term || "";
  const probes = [keyword, ...glossaryAliases(term)].map(searchable).filter(Boolean);
  const source = searchable([keyword, term.description, term.context, aliasesText(glossaryAliases(term))].filter(Boolean).join(" "));
  if (!keyword || !probes.length) return [];
  const related = [];
  const seen = new Set([searchable(keyword)]);
  for (const item of candidates) {
    const itemKey = searchable(item.term);
    if (!itemKey || seen.has(itemKey)) continue;
    const itemBlob = searchable(termSearchBlob(item));
    if (source.includes(itemKey) || probes.some(probe => itemBlob.includes(probe))) {
      seen.add(itemKey);
      related.push(item);
    }
  }
  return related.slice(0, 8);
}

function ensureCollectionColumn(collection, candidates = [], fallback = "값") {
  collection.rows ||= [[fallback]];
  if (!collection.rows.length) collection.rows.push([fallback]);
  const headers = collection.rows[0] ||= [fallback];
  const index = headers.findIndex(header => candidates.some(candidate => searchable(header).includes(searchable(candidate))));
  if (index >= 0) return index;
  headers.push(fallback);
  for (let row = 1; row < collection.rows.length; row += 1) collection.rows[row].push("");
  return headers.length - 1;
}

function currentDateKey() {
  const now = new Date();
  return dateKeyFromDate(now);
}

function currentMonthKey() {
  return currentDateKey().slice(0, 7);
}

function meetingDateTime(dateKey, time = "") {
  const normalized = normalizeDateKey(dateKey);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  const timeMatch = String(time || "").trim().match(/^(\d{1,2})(?::(\d{2}))?/);
  const hour = timeMatch ? Math.min(23, Math.max(0, Number(timeMatch[1]) || 0)) : 0;
  const minute = timeMatch ? Math.min(59, Math.max(0, Number(timeMatch[2]) || 0)) : 0;
  return new Date(year, month - 1, day, hour, minute);
}

function isPastMeetingTime(dateKey, time = "", now = new Date()) {
  const meetingAt = meetingDateTime(dateKey, time);
  return meetingAt ? meetingAt.getTime() < now.getTime() : false;
}

function displayMeetingStatus(status, dateKey, time = "") {
  const normalized = String(status || "").trim() || "예정";
  if (normalized === "예정" && isPastMeetingTime(dateKey, time)) return "완료";
  return normalized;
}

function dateKeyFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekdayIndexFromKorean(value) {
  const map = { "일요일": 0, "월요일": 1, "화요일": 2, "수요일": 3, "목요일": 4, "금요일": 5, "토요일": 6 };
  return map[String(value || "").trim()] ?? 1;
}

function nextWeekdayDateKey(weekday = "월요일") {
  const date = new Date();
  const target = weekdayIndexFromKorean(weekday);
  const diff = (target - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + diff);
  return dateKeyFromDate(date);
}

function shiftMonthKey(monthKey, delta) {
  const [year, month] = String(monthKey || currentMonthKey()).split("-").map(Number);
  const date = new Date(Number.isFinite(year) ? year : new Date().getFullYear(), (Number.isFinite(month) ? month : new Date().getMonth() + 1) - 1 + delta, 1);
  return dateKeyFromDate(date).slice(0, 7);
}

function calendarDays(monthKey) {
  const [year, month] = String(monthKey || currentMonthKey()).split("-").map(Number);
  const base = new Date(year, month - 1, 1);
  const start = new Date(base);
  const mondayOffset = (base.getDay() + 6) % 7;
  start.setDate(base.getDate() - mondayOffset);
  const today = currentDateKey();
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dateKeyFromDate(date);
    return {
      key,
      day: date.getDate(),
      outside: date.getMonth() !== base.getMonth(),
      today: key === today
    };
  });
}

function sameCalendarDay(value, key) {
  return normalizeDateKey(value) === key;
}

function normalizeDateKey(value) {
  const text = String(value || "").trim();
  const iso = text.match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/)?.[0];
  if (iso) {
    const [y, m, d] = iso.split(/[-/.]/).map(Number);
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : dateKeyFromDate(date);
}

function renderInlineText(value = "") {
  const raw = String(value || "");
  const tokens = [];
  const pattern = /\[\[(image|video|file):([^\]|]+)(?:\|([^\]]*))?\]\]|\[\[math:([\s\S]*?)\]\]|\[\[(size):(12|14|16|18|20|24|28)\|([\s\S]*?)\]\]|\[\[(color|mark):(#[0-9a-fA-F]{6})\|([\s\S]*?)\]\]|\[\[(align):(left|center|right)\|([\s\S]*?)\]\]|\[\[([^\]]+)\]\]|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  raw.replace(pattern, (match, mediaKind, mediaRef, mediaCaption, math, sizeType, sizeValue, sizeInner, colorType, colorValue, colorInner, alignType, alignValue, alignInner, wiki, label, href, index) => {
    if (index > last) tokens.push(renderFormattedSegment(raw.slice(last, index)));
    if (mediaKind) {
      tokens.push(renderInlineMedia(mediaKind, mediaRef, mediaCaption));
    } else if (math != null) {
      tokens.push(renderInlineMath(math));
    } else if (sizeType) {
      tokens.push(renderRichInlineSpan("size", sizeValue, sizeInner));
    } else if (colorType) {
      tokens.push(renderRichInlineSpan(colorType, colorValue, colorInner));
    } else if (alignType) {
      tokens.push(renderRichInlineSpan(alignType, alignValue, alignInner));
    } else if (wiki) {
      const { term, label } = parseWikiMarker(wiki);
      const resolvedTerm = canonicalWikiTerm(term);
      if (term) tokens.push(`<button class="inline-wiki-link" type="button" data-wiki-term="${escapeHtml(resolvedTerm)}">${escapeHtml(label || term)}</button>`);
    } else {
      tokens.push(`<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`);
    }
    last = index + match.length;
    return match;
  });
  if (last < raw.length) tokens.push(renderFormattedSegment(raw.slice(last)));
  return tokens.join("").replace(/\n/g, "<br>");
}

function renderRichBlockText(value = "") {
  const lines = String(value || "").split(/\r?\n/);
  return lines.map(line => {
    if (!line.trim()) return `<div class="rich-spacer"></div>`;
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      return `<div class="rich-heading level-${heading[1].length}">${renderInlineText(heading[2])}</div>`;
    }
    const quote = line.match(/^>\s+(.+)$/);
    if (quote) {
      return `<blockquote class="rich-quote-line">${renderInlineText(quote[1])}</blockquote>`;
    }
    const checked = line.match(/^(?:-\s*)?\[(x| )\]\s+(.+)$/i);
    if (checked) {
      const done = checked[1].toLowerCase() === "x";
      return `<div class="rich-check-line ${done ? "done" : ""}"><span>${done ? "✓" : ""}</span><div>${renderInlineText(checked[2])}</div></div>`;
    }
    const numbered = line.match(/^(\d+)\.\s+(.+)$/);
    if (numbered) {
      return `<div class="rich-number-line"><span>${escapeHtml(numbered[1])}.</span><div>${renderInlineText(numbered[2])}</div></div>`;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      return `<div class="rich-bullet-line">${renderInlineText(bullet[1])}</div>`;
    }
    return `<div class="rich-line">${renderInlineText(line)}</div>`;
  }).join("");
}

function renderInlineMath(expression = "") {
  const text = String(expression || "").trim();
  return `<span class="math-inline" title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
}

function renderRichInlineSpan(type, value, inner = "") {
  const safeInner = renderInlineText(inner);
  if (type === "size") {
    const size = [12, 14, 16, 18, 20, 24, 28].includes(Number(value)) ? Number(value) : 16;
    return `<span class="rich-size" style="font-size:${size}px">${safeInner}</span>`;
  }
  if (type === "color" && /^#[0-9a-fA-F]{6}$/.test(value || "")) {
    return `<span class="rich-color" style="color:${escapeHtml(value)}">${safeInner}</span>`;
  }
  if (type === "mark" && /^#[0-9a-fA-F]{6}$/.test(value || "")) {
    return `<span class="rich-mark" style="background:${escapeHtml(value)}">${safeInner}</span>`;
  }
  if (type === "align" && ["left", "center", "right"].includes(value)) {
    return `<span class="rich-align rich-align-${escapeHtml(value)}">${safeInner}</span>`;
  }
  return safeInner;
}

function renderInlineMedia(kind, ref, caption = "") {
  const media = archive.mediaById?.[ref] || archive.media?.find?.(item => item.id === ref);
  const src = inlineMediaSrc(ref, media);
  const label = caption || media?.title || ref || "미디어";
  if (kind === "image" && src) {
    return `<span class="inline-media inline-media-image"><img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" loading="lazy"><small>${escapeHtml(label)}</small></span>`;
  }
  if (kind === "video" && src) {
    return `<span class="inline-media inline-media-video"><video src="${escapeHtml(src)}" controls preload="metadata"></video><small>${escapeHtml(label)}</small></span>`;
  }
  if (kind === "file" && src) {
    return `<a class="inline-file" href="${escapeHtml(src)}" download="${escapeHtml(label)}">${escapeHtml(label)}</a>`;
  }
  return `<span class="inline-file missing">${escapeHtml(label)}</span>`;
}

function inlineMediaMarkers(value = "") {
  const markers = [];
  const pattern = /\[\[(image|video|file):([^\]|]+)(?:\|([^\]]*))?\]\]/gi;
  let match;
  while ((match = pattern.exec(String(value || "")))) {
    const media = archive.mediaById?.[match[2]] || archive.media?.find?.(item => item.id === match[2]);
    markers.push({
      index: markers.length,
      marker: match[0],
      kind: match[1].toLowerCase(),
      ref: match[2],
      label: match[3] || media?.title || match[2]
    });
  }
  return markers;
}

function renderInlineMediaManager(target = {}, options = {}) {
  const field = options.field || "";
  const markers = inlineMediaMarkers(target[field] || "");
  if (!markers.length || !field) return "";
  const blockId = escapeHtml(options.blockId || "");
  const unitId = options.unitId ? escapeHtml(options.unitId) : "";
  const unitAttr = unitId ? ` data-unit-id="${unitId}"` : "";
  return `
    <div class="inline-media-manager" aria-label="삽입된 인라인 미디어">
      ${markers.map(item => `
        <span class="inline-media-chip">
          <span>${escapeHtml(inlineMediaKindLabel(item.kind))}</span>
          <strong>${escapeHtml(item.label)}</strong>
          <button type="button" data-action="delete-inline-media-marker" data-block-id="${blockId}"${unitAttr} data-inline-field="${escapeHtml(field)}" data-marker-index="${item.index}">삭제</button>
        </span>
      `).join("")}
    </div>
  `;
}

function inlineMediaKindLabel(kind = "") {
  if (kind === "image") return "이미지";
  if (kind === "video") return "동영상";
  return "파일";
}

function removeInlineMediaMarker(value = "", markerIndex = 0) {
  const source = String(value || "");
  const pattern = /\[\[(image|video|file):([^\]|]+)(?:\|([^\]]*))?\]\]/gi;
  let match;
  let index = 0;
  while ((match = pattern.exec(source))) {
    if (index === markerIndex) {
      const before = source.slice(0, match.index);
      const after = source.slice(match.index + match[0].length);
      return `${before}${after}`
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{2,}/g, "\n")
        .trim();
    }
    index += 1;
  }
  return source;
}

function deleteInlineMediaMarker(blockId, unitId = "", field = "", markerIndex = 0) {
  const doc = currentDoc();
  const target = unitId ? contentUnit(blockId, unitId) : doc?.blocks?.find(block => block.id === blockId);
  if (!doc || !target || !["text", "content"].includes(field) || !Number.isFinite(markerIndex)) return;
  const current = String(target[field] || "");
  const next = removeInlineMediaMarker(current, markerIndex);
  if (next === current) return;
  recordUndo();
  target[field] = next;
  refreshDerivedDoc(doc);
  markDirty();
  render();
  requestAnimationFrame(() => {
    const selector = unitId
      ? `[data-block-id="${CSS.escape(blockId)}"][data-unit-id="${CSS.escape(unitId)}"][data-unit-field="${CSS.escape(field)}"]`
      : `[data-block-id="${CSS.escape(blockId)}"][data-block-field="${CSS.escape(field)}"]`;
    const control = document.querySelector(selector);
    control?.focus();
  });
}

function renderFormattedSegment(value = "") {
  return escapeHtml(value)
    .replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, "<u>$1</u>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<u>$1</u>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

function renderFlowPreview(content = "") {
  const steps = String(content || "")
    .split(/(?:->|→|\n)/)
    .map(step => step.trim())
    .filter(Boolean);
  if (!steps.length) return `<pre class="flow-preview">${escapeHtml(content)}</pre>`;
  return `
    <div class="flow-preview">
      ${steps.map((step, index) => `
        <span class="flow-step">${escapeHtml(step)}</span>
        ${index < steps.length - 1 ? `<span class="flow-arrow">→</span>` : ""}
      `).join("")}
    </div>
  `;
}

function currentDoc() {
  return docsById.get(state.selectedDocId);
}

function currentCollection() {
  return collectionsById.get(state.selectedCollectionId);
}

function recordUndo(label = editHistoryLabel()) {
  const snapshot = JSON.stringify(archive);
  if (undoStack[undoStack.length - 1] === snapshot) return;
  undoStack.push(snapshot);
  undoLabels.push(label || "편집");
  if (undoStack.length > MAX_HISTORY) {
    undoStack.shift();
    undoLabels.shift();
  }
  redoStack.length = 0;
  redoLabels.length = 0;
  renderTopbar();
}

function editHistoryLabel() {
  const active = document.activeElement;
  if (active?.dataset?.docTreeRename) return "문서 제목 변경";
  if (active?.dataset?.archiveField) return "허브 정보 편집";
  if (active?.dataset?.editDocField) return "문서 정보 편집";
  if (active?.dataset?.editCollectionField) return "표 정보 편집";
  if (active?.dataset?.wikiField) return "위키 편집";
  if (active?.dataset?.tableCell || active?.dataset?.unitTableCell || active?.dataset?.collectionCell) return "표 편집";
  if (active?.dataset?.blockField || active?.dataset?.unitField) return "본문 편집";
  return state.view === "documents" ? "문서 편집" : state.view === "collections" ? "표 편집" : "허브 편집";
}

function restoreArchiveFromSnapshot(snapshot) {
  archive = JSON.parse(snapshot);
  rebuildIndexes();
  if (!docsById.has(state.selectedDocId)) state.selectedDocId = archive.documents[0]?.id || "";
  if (!collectionsById.has(state.selectedCollectionId)) state.selectedCollectionId = archive.collections[0]?.id || "";
  markDirty();
  render();
}

function undoArchive() {
  if (!undoStack.length) return;
  const label = undoLabels.pop() || "편집";
  redoStack.push(JSON.stringify(archive));
  redoLabels.push(label);
  restoreArchiveFromSnapshot(undoStack.pop());
  toast(`${label}을 되돌렸습니다.`);
}

function redoArchive() {
  if (!redoStack.length) return;
  const label = redoLabels.pop() || "편집";
  undoStack.push(JSON.stringify(archive));
  undoLabels.push(label);
  restoreArchiveFromSnapshot(redoStack.pop());
  toast(`${label}을 다시 실행했습니다.`);
}

function hydrateVersions() {
  try {
    const versions = JSON.parse(localStorage.getItem(VERSION_KEY) || "[]");
    state.versions = Array.isArray(versions) ? versions : [];
  } catch (_) {
    state.versions = [];
  }
}

function persistVersions() {
  localStorage.setItem(VERSION_KEY, JSON.stringify(state.versions.slice(0, 80)));
}

function saveCurrentVersion() {
  showInputDialog({
    title: "버전 저장",
    message: "현재 편집본을 나중에 비교하거나 복원할 수 있는 버전으로 저장합니다.",
    label: "버전 이름",
    defaultValue: `버전 ${state.versions.length + 1}`,
    confirmLabel: "저장",
    onConfirm: saveVersionWithTitle
  });
}

function saveVersionWithTitle(title = "") {
  const version = {
    id: `version-${Date.now().toString(36)}`,
    title: title || archive.title || "Archive",
    createdAt: new Date().toISOString(),
    state: clone(archive)
  };
  state.versions.unshift(version);
  persistVersions();
  renderVersionPanel();
  toast("현재 버전을 저장했습니다.");
}

function openVersionPanel() {
  els.versionPanel.classList.remove("hidden");
  renderVersionPanel();
}

function renderVersionPanel() {
  const versions = state.versions;
  els.versionSummary.textContent = versions.length
    ? `${versions.length.toLocaleString("ko-KR")}개 버전이 저장되어 있습니다.`
    : "저장된 버전이 없습니다. 현재 버전을 먼저 저장하세요.";

  const options = versions.map(version => {
    const label = `${formatDateTime(version.createdAt)} · ${version.title}`;
    return `<option value="${escapeHtml(version.id)}">${escapeHtml(label)}</option>`;
  }).join("");
  els.versionBaseSelect.innerHTML = options;
  els.versionTargetSelect.innerHTML = `<option value="current">현재 편집본</option>${options}`;
  if (versions[1]) els.versionBaseSelect.value = versions[1].id;
  if (versions[0]) els.versionTargetSelect.value = "current";

  els.versionList.innerHTML = versions.map(version => `
    <button class="version-item" type="button" data-action="restore-version" data-version-id="${escapeHtml(version.id)}">
      <strong>${escapeHtml(version.title)}</strong>
      <span>${escapeHtml(formatDateTime(version.createdAt))} · 문서 ${version.state.documents?.length || 0}개</span>
    </button>
  `).join("") || empty("저장된 버전이 없습니다.");
  renderVersionDiff();
}

function renderVersionDiff() {
  const base = state.versions.find(version => version.id === els.versionBaseSelect.value);
  const target = els.versionTargetSelect.value === "current"
    ? { title: "현재 편집본", state: archive }
    : state.versions.find(version => version.id === els.versionTargetSelect.value);
  if (!base || !target) {
    els.versionDiff.textContent = "비교할 버전이 부족합니다.";
    return;
  }
  const diff = createArchiveDiff(base.state, target.state);
  const summary = summarizeArchiveDiff(diff);
  els.versionSummary.innerHTML = `
    <span class="diff-pill added">추가 ${summary.added.toLocaleString("ko-KR")}</span>
    <span class="diff-pill removed">삭제 ${summary.removed.toLocaleString("ko-KR")}</span>
    <span class="diff-pill changed">수정 ${summary.changed.toLocaleString("ko-KR")}</span>
    <span class="diff-pill">총 ${diff.length.toLocaleString("ko-KR")}</span>
  `;
  els.versionDiff.innerHTML = diff.length
    ? diff.slice(0, 160).map(renderArchiveDiffItem).join("") + (diff.length > 160 ? `<div class="empty-state">표시 범위를 넘어 ${diff.length - 160}개 변경이 더 있습니다.</div>` : "")
    : empty("두 버전 사이에 변경 사항이 없습니다.");
  return;
  els.versionDiff.textContent = [
    `문서 추가 ${diff.addedDocs} · 변경 ${diff.changedDocs} · 삭제 ${diff.removedDocs}`,
    `표 추가 ${diff.addedCollections} · 변경 ${diff.changedCollections} · 삭제 ${diff.removedCollections}`,
    `미디어 차이 ${diff.mediaDelta >= 0 ? "+" : ""}${diff.mediaDelta}`
  ].join("\n");
}

function compareArchiveStates(base, target) {
  const docDiff = compareEntityArrays(base.documents || [], target.documents || []);
  const collectionDiff = compareEntityArrays(base.collections || [], target.collections || []);
  return {
    addedDocs: docDiff.added,
    changedDocs: docDiff.changed,
    removedDocs: docDiff.removed,
    addedCollections: collectionDiff.added,
    changedCollections: collectionDiff.changed,
    removedCollections: collectionDiff.removed,
    mediaDelta: (target.media?.length || 0) - (base.media?.length || 0)
  };
}

function compareEntityArrays(baseItems, targetItems) {
  const baseMap = new Map(baseItems.map(item => [item.id, JSON.stringify(item)]));
  const targetMap = new Map(targetItems.map(item => [item.id, JSON.stringify(item)]));
  let added = 0;
  let changed = 0;
  let removed = 0;
  for (const [id, value] of targetMap) {
    if (!baseMap.has(id)) added += 1;
    else if (baseMap.get(id) !== value) changed += 1;
  }
  for (const id of baseMap.keys()) {
    if (!targetMap.has(id)) removed += 1;
  }
  return { added, changed, removed };
}

function createArchiveDiff(baseState = {}, targetState = {}) {
  const before = flattenArchiveStateForDiff(baseState);
  const after = flattenArchiveStateForDiff(targetState);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort((a, b) => a.localeCompare(b, "ko-KR"));
  return keys.flatMap(key => {
    const oldValue = before[key];
    const newValue = after[key];
    if (oldValue === newValue) return [];
    if (oldValue === undefined) return [{ type: "added", key, oldValue: "", newValue }];
    if (newValue === undefined) return [{ type: "removed", key, oldValue, newValue: "" }];
    return [{ type: "changed", key, oldValue, newValue }];
  });
}

function flattenArchiveStateForDiff(source = {}) {
  const out = {};
  out["Archive/title"] = source.title || "";
  out["Archive/subtitle"] = source.subtitle || "";
  out["Archive/mediaBasePath"] = source.mediaBasePath || "";
  (source.documents || []).forEach((doc, docIndex) => flattenArchiveDocumentForDiff(doc, docIndex, out));
  (source.collections || []).forEach((collection, collectionIndex) => flattenArchiveCollectionForDiff(collection, collectionIndex, out));
  (source.glossary || []).forEach((term, index) => {
    const label = diffLabel(term.keyword, term.id, `term-${index + 1}`);
    out[`Wiki/${label}/description`] = term.description || "";
    out[`Wiki/${label}/aliases`] = glossaryAliases(term).join(", ");
    out[`Wiki/${label}/docId`] = term.docId || "";
  });
  (source.media || []).forEach((media, index) => {
    const label = diffLabel(media.name || media.fileName || media.url || media.path, media.id, `media-${index + 1}`);
    out[`Media/${label}/kind`] = media.kind || media.type || "";
    out[`Media/${label}/path`] = media.path || media.url || "";
    out[`Media/${label}/size`] = media.size || "";
  });
  return out;
}

function flattenArchiveDocumentForDiff(doc = {}, docIndex = 0, out = {}) {
  const label = diffLabel(doc.title, doc.id, `doc-${docIndex + 1}`);
  out[`Document/${label}/title`] = doc.title || "";
  out[`Document/${label}/subtitle`] = doc.subtitle || "";
  out[`Document/${label}/excerpt`] = doc.excerpt || "";
  out[`Document/${label}/status`] = doc.status || "";
  out[`Document/${label}/category`] = doc.categoryLabel || doc.category || "";
  out[`Document/${label}/sourcePath`] = doc.sourcePath || "";
  out[`Document/${label}/tags`] = (doc.tags || []).join(", ");
  (doc.blocks || []).forEach((block, blockIndex) => {
    flattenArchiveBlockForDiff(block, `${label}/Block ${blockIndex + 1}`, out);
  });
}

function flattenArchiveBlockForDiff(block = {}, prefix = "Block", out = {}) {
  out[`Block/${prefix}/type`] = block.type || "";
  for (const field of ["title", "text", "content", "caption", "label", "path", "url", "fileName", "collectionId", "mediaId", "language", "level"]) {
    if (block[field] !== undefined && block[field] !== null && block[field] !== "") {
      out[`Block/${prefix}/${field}`] = String(block[field]);
    }
  }
  if (Array.isArray(block.rows)) flattenDiffRows(block.rows, `Block/${prefix}/Table`, out);
  if (Array.isArray(block.items)) {
    block.items.forEach((unit, unitIndex) => flattenArchiveBlockForDiff(unit, `${prefix}/Unit ${unitIndex + 1}`, out));
  }
}

function flattenArchiveCollectionForDiff(collection = {}, collectionIndex = 0, out = {}) {
  const label = diffLabel(collection.title, collection.id, `collection-${collectionIndex + 1}`);
  out[`Collection/${label}/title`] = collection.title || "";
  out[`Collection/${label}/category`] = collection.categoryLabel || collection.category || "";
  out[`Collection/${label}/sourcePath`] = collection.sourcePath || "";
  out[`Collection/${label}/rowCount`] = String((collection.rows || []).length);
  flattenDiffRows(collection.rows || [], `Collection/${label}`, out);
}

function flattenDiffRows(rows = [], prefix = "Table", out = {}) {
  normalizeTableRows(rows).forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      out[`${prefix}/${tableColumnLabel(colIndex)}${rowIndex + 1}`] = String(cell ?? "");
    });
  });
}

function summarizeArchiveDiff(diff = []) {
  return diff.reduce((summary, change) => {
    summary[change.type] += 1;
    return summary;
  }, { added: 0, removed: 0, changed: 0 });
}

function renderArchiveDiffItem(change) {
  const typeLabel = change.type === "added" ? "추가" : change.type === "removed" ? "삭제" : "수정";
  return `
    <article class="diff-item ${escapeHtml(change.type)}">
      <div class="diff-item-head">
        <strong>${escapeHtml(change.key)}</strong>
        <span>${typeLabel}</span>
      </div>
      ${change.type !== "added" ? `<pre class="diff-old">${escapeHtml(String(change.oldValue ?? ""))}</pre>` : ""}
      ${change.type !== "removed" ? `<pre class="diff-new">${escapeHtml(String(change.newValue ?? ""))}</pre>` : ""}
    </article>
  `;
}

function diffLabel(primary = "", id = "", fallback = "") {
  return String(primary || id || fallback || "item").replace(/\s+/g, " ").trim().slice(0, 80);
}

function restoreVersion(versionId) {
  const version = state.versions.find(item => item.id === versionId);
  if (!version) return;
  recordUndo();
  archive = clone(version.state);
  rebuildIndexes();
  markDirty();
  render();
  toast("선택한 버전을 현재 편집본으로 복원했습니다.");
}

function openTermPanel() {
  els.termPanel.classList.remove("hidden");
  renderTermResults();
  els.termSearch.focus();
}

function renderTermResults() {
  const query = searchable(els.termSearch.value);
  const terms = buildTermIndex()
    .filter(item => !query || searchable(termSearchBlob(item)).includes(query))
    .slice(0, 80);
  els.termResults.innerHTML = terms.map(item => `
    <button class="term-result" type="button" data-doc="${escapeHtml(item.docId)}" data-glossary-doc="${escapeHtml(item.docId)}" data-glossary-term="${escapeHtml(item.term)}">
      <strong>${escapeHtml(item.term)}</strong>
      ${item.aliases?.length ? `<span>별칭: ${escapeHtml(aliasesText(item.aliases))}</span>` : ""}
      <span>${escapeHtml(item.context)}</span>
    </button>
  `).join("") || empty("검색 결과가 없습니다.");
}

function buildTermIndex() {
  const terms = [];
  for (const term of archive.glossary || []) {
    terms.push({
      term: term.keyword,
      context: term.description || "사용자 용어",
      docId: term.docId || archive.documents[0]?.id || "",
      glossary: true,
      aliases: glossaryAliases(term)
    });
  }
  for (const doc of archive.documents || []) {
    terms.push({ term: doc.title, context: doc.categoryLabel || "문서", docId: doc.id });
    for (const heading of (doc.headings || []).slice(0, 10)) {
      terms.push({ term: heading.text, context: doc.title, docId: doc.id });
    }
  }
  for (const collection of archive.collections || []) {
    terms.push({ term: collection.title, context: `${collection.categoryLabel} · 표 데이터`, docId: archive.documents.find(doc => doc.category === collection.category)?.id || archive.documents[0]?.id || "" });
  }
  return terms.filter(item => item.term && item.docId);
}

function selectGlossaryTerm(target) {
  const docId = target.dataset.glossaryDoc;
  const term = target.dataset.glossaryTerm || "";
  const saved = findGlossaryTerm(term);
  if (saved) {
    els.termKeyword.value = saved.keyword || "";
    els.termAliases.value = aliasesText(glossaryAliases(saved));
    els.termDescription.value = saved.description || "";
  } else {
    els.termKeyword.value = term;
    els.termAliases.value = "";
  }
  state.selectedDocId = docId;
  state.view = "documents";
  writeHash();
  render();
}

function saveGlossaryTerm() {
  const keyword = els.termKeyword.value.trim();
  const aliases = parseAliases(els.termAliases.value).filter(alias => alias !== keyword);
  const description = els.termDescription.value.trim();
  if (!keyword) {
    toast("용어를 입력하세요.");
    return;
  }
  recordUndo();
  archive.glossary ||= [];
  const existing = archive.glossary.find(item => item.keyword === keyword) || findGlossaryTerm(keyword);
  if (existing) {
    existing.aliases = aliases;
    existing.description = description;
    existing.docId = state.selectedDocId;
  } else {
    archive.glossary.push({ keyword, aliases, description, docId: state.selectedDocId, createdAt: new Date().toISOString() });
  }
  markDirty();
  renderTermResults();
  toast("용어를 저장했습니다.");
}

function updateWikiField(field, value) {
  if (!state.selectedWikiTerm) return;
  archive.glossary ||= [];
  state.selectedWikiTerm = canonicalWikiTerm(state.selectedWikiTerm);
  const existingIndex = archive.glossary.findIndex(item => item.keyword === state.selectedWikiTerm);
  const existing = existingIndex >= 0
    ? archive.glossary[existingIndex]
    : {
        keyword: state.selectedWikiTerm,
        aliases: [],
        description: buildTermIndex().find(item => item.term === state.selectedWikiTerm)?.context || "",
        docId: state.selectedDocId || archive.documents[0]?.id || "",
        createdAt: new Date().toISOString()
      };
  const next = { ...existing };
  if (field === "keyword") {
    const keyword = String(value || "").trim();
    if (!keyword || keyword === existing.keyword) return;
    next.keyword = keyword;
    next.aliases = glossaryAliases(next).filter(alias => alias !== keyword);
    state.selectedWikiTerm = keyword;
  } else if (field === "aliases") {
    const aliases = parseAliases(value).filter(alias => alias !== next.keyword);
    if (aliasesText(next.aliases || []) === aliasesText(aliases)) return;
    next.aliases = aliases;
  } else if (field === "description") {
    if (next.description === value) return;
    next.description = value;
  } else {
    return;
  }
  recordUndo();
  if (existingIndex >= 0) archive.glossary[existingIndex] = next;
  else archive.glossary.push(next);
  markDirty();
}

async function hydrateAuth() {
  try {
    const response = await fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return;
    const payload = await response.json();
    state.authUser = payload.user || null;
  } catch (_) {
    state.authUser = null;
  }
}

function readClientId() {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = createId("client");
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

function connectPresence() {
  sendPresence();
  presenceTimer = window.setInterval(sendPresence, 8000);
  if (!window.EventSource) return;
  try {
    const params = new URLSearchParams({
      clientId: state.clientId,
      clientName: state.authUser?.displayName || state.authUser?.username || "Archive user"
    });
    collabSource = new EventSource(`/api/collab/events?${params}`);
    collabSource.onmessage = event => {
      try {
        const message = JSON.parse(event.data || "{}");
        if (message.presence) {
          state.presence = message.presence;
          renderCollabStatus();
        }
        if (message.type === "archive-state" && message.clientId !== state.clientId) {
          handleRemoteArchiveRevision(Number(message.revision || 0));
        }
      } catch (_) {}
    };
    collabSource.onerror = () => {
      els.collabStatus?.classList.add("offline");
    };
  } catch (_) {
    els.collabStatus?.classList.add("offline");
  }
}

function handleRemoteArchiveRevision(revision) {
  if (!Number.isFinite(revision) || revision <= Number(state.revision || 0)) return;
  if (state.dirty || isArchiveActivelyEditing()) {
    state.pendingRemoteRevision = Math.max(Number(state.pendingRemoteRevision || 0), revision);
    renderCollabStatus();
    toast("다른 사용자의 저장이 대기 중입니다. 현재 편집을 저장한 뒤 새로 반영됩니다.");
    return;
  }
  pullRemoteArchiveState(revision);
}

function isArchiveActivelyEditing() {
  const active = document.activeElement;
  return Boolean(active?.matches?.("input, textarea, select, [contenteditable='true']"));
}

async function pullRemoteArchiveState(revision = 0) {
  try {
    const response = await fetch("/api/archive/state", { cache: "no-store", credentials: "same-origin" });
    const payload = await response.json();
    if (!response.ok || !payload.ok || !payload.state?.documents) return;
    if (Number(payload.revision || 0) < Number(revision || 0)) return;
    if (Number(payload.revision || 0) <= Number(state.revision || 0)) return;
    archive = payload.state;
    state.revision = Number(payload.revision || 0);
    state.lastSavedAt = payload.updatedAt || archive.updatedAt || "";
    state.saveMode = "server";
    state.pendingRemoteRevision = 0;
    state.dirty = false;
    rebuildIndexes();
    persistLocal();
    render();
    toast("다른 사용자의 변경을 반영했습니다.");
  } catch (_) {
    els.collabStatus?.classList.add("offline");
  }
}

function sendPresence() {
  const payload = JSON.stringify({
    clientId: state.clientId,
    clientName: state.authUser?.displayName || state.authUser?.username || "Archive user",
    tabTitle: archive.title || "Archive",
    editing: state.editMode
  });
  fetch("/api/collab/presence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
    credentials: "same-origin"
  })
    .then(response => response.ok ? response.json() : null)
    .then(data => {
      if (data?.presence) {
        state.presence = data.presence;
        renderCollabStatus();
      }
    })
    .catch(() => {
      els.collabStatus?.classList.add("offline");
    });
}

async function logoutArchiveUser() {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    location.href = "/login?next=/Archive/";
  } catch (_) {
    toast("로그아웃할 수 없습니다.");
  }
}

function isTextFormatControl(target) {
  if (!target?.matches?.("textarea, input[type='text'], input:not([type])")) return false;
  return Boolean(
    target.dataset.blockField
    || target.dataset.unitField
    || target.dataset.editDocField
    || target.dataset.archiveField
    || target.dataset.wikiField
  );
}

function updateFloatingToolbar() {
  if (!els.floatingToolbar || !state.editMode) {
    hideFloatingToolbar();
    return;
  }
  const active = document.activeElement;
  const target = isTextFormatControl(active) ? active : activeTextControl;
  if (!isTextFormatControl(target) || target.selectionStart == null || target.selectionStart === target.selectionEnd) {
    hideFloatingToolbar();
    return;
  }
  activeTextControl = target;
  const selectionRect = textControlSelectionRect(target, target.selectionStart, target.selectionEnd) || target.getBoundingClientRect();
  const toolbar = els.floatingToolbar;
  toolbar.classList.add("show");
  const toolbarWidth = toolbar.offsetWidth || 190;
  const toolbarHeight = toolbar.offsetHeight || 38;
  const left = selectionRect.left + (selectionRect.width / 2) - (toolbarWidth / 2);
  const top = selectionRect.top - toolbarHeight - 8;
  toolbar.style.left = `${Math.max(10, Math.min(window.innerWidth - toolbarWidth - 10, left))}px`;
  toolbar.style.top = `${Math.max(10, top)}px`;
}

function hideFloatingToolbar() {
  if (!els.floatingToolbar) return;
  els.floatingToolbar.classList.remove("show");
  els.floatingToolbar.style.top = "-9999px";
}

function textControlSelectionRect(control, start, end) {
  const rect = control.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const mirror = document.createElement("div");
  const style = getComputedStyle(control);
  const copyProps = [
    "boxSizing", "width", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight",
    "letterSpacing", "textTransform", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"
  ];
  mirror.style.position = "fixed";
  mirror.style.left = `${rect.left}px`;
  mirror.style.top = `${rect.top}px`;
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.overflow = "hidden";
  mirror.style.whiteSpace = control.tagName === "TEXTAREA" ? "pre-wrap" : "pre";
  mirror.style.wordBreak = "break-word";
  mirror.style.zIndex = "-1";
  for (const prop of copyProps) mirror.style[prop] = style[prop];
  mirror.textContent = String(control.value || "").slice(0, start);
  const marker = document.createElement("span");
  marker.textContent = String(control.value || "").slice(start, end) || "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  const markerRect = marker.getBoundingClientRect();
  mirror.remove();
  return {
    left: markerRect.left - Number(control.scrollLeft || 0),
    top: markerRect.top - Number(control.scrollTop || 0),
    width: Math.max(1, markerRect.width),
    height: Math.max(1, markerRect.height)
  };
}

function applyFormat(type) {
  const active = document.activeElement;
  const target = active?.matches?.("textarea, input[type='text'], input:not([type])") ? active : activeTextControl;
  if (!target || typeof target.value !== "string" || target.selectionStart == null) {
    toast("서식을 적용할 텍스트 입력칸을 선택하세요.");
    return;
  }

  if (type === "image") {
    pendingInlineMediaInsert = inlineMediaInsertFromTextControl(target);
    pendingContentMediaInsert = null;
    pendingTableImageInsert = null;
    pendingBlockMediaReplace = null;
    openMediaPicker("media");
    hideFloatingToolbar();
    return;
  }

  if (type === "formula") {
    promptInlineFormula(target, () => {
      target.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return;
  }

  if (type === "link") {
    promptInlineLink(target, () => {
      target.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return;
  }

  const next = applyInlineFormatToTextControl(target, type);
  if (next == null) return;
  target.focus();
  target.dispatchEvent(new Event("input", { bubbles: true }));
  hideFloatingToolbar();
}

function applyBlockInlineFormat(blockId, type) {
  const block = currentDoc()?.blocks?.find(item => item.id === blockId);
  if (!block) return;
  const active = document.activeElement;
  const target = active?.dataset?.blockId === blockId && active?.dataset?.blockField && typeof active.value === "string"
    ? active
    : document.querySelector(`[data-block-id="${CSS.escape(blockId)}"][data-block-field]`);
  if (!target || typeof target.value !== "string" || target.selectionStart == null) return;
  const field = target.dataset.blockField;
  if (type === "formula") {
    promptInlineFormula(target, value => {
      updateBlockField(blockId, field, value);
    });
    return;
  }
  if (type === "link") {
    promptInlineLink(target, value => {
      updateBlockField(blockId, field, value);
    });
    return;
  }
  const next = applyInlineFormatToTextControl(target, type);
  if (next == null) return;
  updateBlockField(blockId, field, target.value);
  finishInlineWikiTerm(target);
}

function applyUnitInlineFormat(blockId, unitId, type) {
  const unit = contentUnit(blockId, unitId);
  if (!unit) return;
  const active = document.activeElement;
  const target = active?.dataset?.blockId === blockId && active?.dataset?.unitId === unitId && active?.dataset?.unitField && typeof active.value === "string"
    ? active
    : document.querySelector(`[data-block-id="${CSS.escape(blockId)}"][data-unit-id="${CSS.escape(unitId)}"][data-unit-field]`);
  if (!target || typeof target.value !== "string" || target.selectionStart == null) return;
  const field = target.dataset.unitField;
  if (type === "formula") {
    promptInlineFormula(target, value => {
      updateContentUnitField(blockId, unitId, field, value);
    });
    return;
  }
  if (type === "link") {
    promptInlineLink(target, value => {
      updateContentUnitField(blockId, unitId, field, value);
    });
    return;
  }
  const next = applyInlineFormatToTextControl(target, type);
  if (next == null) return;
  updateContentUnitField(blockId, unitId, field, target.value);
  finishInlineWikiTerm(target);
}

function insertTextControlReplacement(target, start, end, replacement) {
  target.value = `${target.value.slice(0, start)}${replacement}${target.value.slice(end)}`;
  target.focus();
  target.setSelectionRange(start, start + replacement.length);
  return target.value;
}

function promptInlineFormula(target, onApply = () => {}) {
  if (!target || typeof target.value !== "string" || target.selectionStart == null) return false;
  const start = target.selectionStart;
  const end = target.selectionEnd;
  const selected = target.value.slice(start, end);
  showInputDialog({
    title: "수식 입력",
    message: "본문에 인라인 수식으로 삽입할 표현식을 입력하세요.",
    label: "수식",
    defaultValue: selected || "",
    confirmLabel: "삽입",
    onConfirm: formula => {
      const expression = String(formula || "").trim();
      if (!expression) return;
      const replacement = inlineFormatReplacement("formula", expression);
      const value = insertTextControlReplacement(target, start, end, replacement);
      onApply(value);
      hideFloatingToolbar();
    }
  });
  return true;
}

function promptInlineLink(target, onApply = () => {}) {
  if (!target || typeof target.value !== "string" || target.selectionStart == null) return false;
  const start = target.selectionStart;
  const end = target.selectionEnd;
  const selected = target.value.slice(start, end).trim() || "링크";
  showInputDialog({
    title: "링크 주소 입력",
    message: "선택한 텍스트에 연결할 URL을 입력하세요.",
    label: "URL",
    defaultValue: "",
    confirmLabel: "삽입",
    onConfirm: url => {
      const href = String(url || "").trim();
      if (!href) return;
      const replacement = `[${selected.replace(/\]/g, "\\]")}](${href})`;
      const value = insertTextControlReplacement(target, start, end, replacement);
      onApply(value);
      hideFloatingToolbar();
    }
  });
  return true;
}

function applyInlineFormatToTextControl(target, type) {
  const start = target.selectionStart;
  const end = target.selectionEnd;
  if (type === "clear" && start === end) return null;
  const fallback = {
    formula: "E=mc^2",
    code: "code",
    link: "text",
    bullet: "item",
    ordered: "item",
    check: "item"
  }[type] || "텍스트";
  const selected = target.value.slice(start, end) || fallback;
  const replacement = type === "clear" ? clearInlineFormatting(selected) : inlineFormatReplacement(type, selected);
  if (!replacement) return null;
  if (type === "wiki" || type === "term") {
    target.dataset.inlineWikiTerm = cleanWikiTarget(selected);
    if (type === "term") target.dataset.inlineWikiOpen = "1";
  }
  return insertTextControlReplacement(target, start, end, replacement);
}

function inlineFormatReplacement(type, selected) {
  const text = String(selected || "텍스트");
  const [name, rawValue = ""] = String(type || "").split(":");
  if (name === "size") {
    const size = [12, 14, 16, 18, 20, 24, 28].includes(Number(rawValue)) ? Number(rawValue) : 16;
    return `[[size:${size}|${text}]]`;
  }
  if ((name === "color" || name === "mark") && /^#[0-9a-fA-F]{6}$/.test(rawValue)) {
    return `[[${name}:${rawValue}|${text}]]`;
  }
  if (name === "align" && ["left", "center", "right"].includes(rawValue)) {
    return `[[align:${rawValue}|${text}]]`;
  }
  const replacements = {
    bold: `**${text}**`,
    italic: `*${text}*`,
    underline: `<u>${text}</u>`,
    strike: `~~${text}~~`,
    code: `\`${text}\``,
    link: `[${text}](https://)`,
    formula: `[[math:${text}]]`,
    wiki: wikiMarker(text),
    term: wikiMarker(text),
    bullet: `- ${text}`,
    ordered: `1. ${text}`,
    check: `- [ ] ${text}`
  };
  return replacements[type] || "";
}

function clearInlineFormatting(value = "") {
  let text = String(value || "");
  let previous = "";
  while (previous !== text) {
    previous = text;
    text = text
      .replace(/\[\[(?:size|color|mark|align):(?:12|14|16|18|20|24|28|#[0-9a-fA-F]{6}|left|center|right)\|([\s\S]*?)\]\]/gi, "$1")
      .replace(/\[\[math:([\s\S]*?)\]\]/gi, "$1")
      .replace(/\[\[(?:image|video|file):[^\]|]+(?:\|([^\]]*))?\]\]/gi, "$1")
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, term, label) => label || term);
  }
  return text
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|\/|\.\/|\.\.\/)[^)]+\)/g, "$1")
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/~~([\s\S]*?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<u>([\s\S]*?)<\/u>/gi, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2");
}

function cleanWikiTarget(value = "") {
  return String(value || "")
    .trim()
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .replace(/[\[\]\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function wikiMarker(value = "", label = "") {
  const term = cleanWikiTarget(value);
  if (!term) return "";
  const cleanLabel = String(label || "").replace(/\]\]/g, "").replace(/\|/g, "/").trim();
  if (cleanLabel && cleanLabel !== term) return `[[${term}|${cleanLabel}]]`;
  return `[[${term}]]`;
}

function parseWikiMarker(value = "") {
  const [termPart = "", ...labelParts] = String(value || "").split("|");
  const term = cleanWikiTarget(termPart);
  const label = labelParts.join("|").replace(/\]\]/g, "").trim() || term;
  return { term, label };
}

function registerInlineWikiTerm(term = "") {
  const keyword = cleanWikiTarget(term);
  if (!keyword) return;
  archive.glossary ||= [];
  if (!findGlossaryTerm(keyword)) {
    archive.glossary.push({
      keyword,
      aliases: [],
      description: "본문에서 추가한 용어입니다.",
      docId: state.selectedDocId,
      createdAt: new Date().toISOString()
    });
  }
  if (!els.termPanel.classList.contains("hidden")) renderTermResults();
}

function finishInlineWikiTerm(target) {
  const term = cleanWikiTarget(target.dataset.inlineWikiTerm || "");
  const shouldOpen = target.dataset.inlineWikiOpen === "1";
  registerInlineWikiTerm(term);
  delete target.dataset.inlineWikiTerm;
  delete target.dataset.inlineWikiOpen;
  if (shouldOpen) openInlineTermEditor(term);
}

function openInlineTermEditor(term = "") {
  const keyword = cleanWikiTarget(term);
  if (!keyword) return;
  const saved = findGlossaryTerm(keyword);
  els.termPanel.classList.remove("hidden");
  els.termKeyword.value = saved?.keyword || keyword;
  els.termAliases.value = saved ? aliasesText(glossaryAliases(saved)) : "";
  els.termDescription.value = saved?.description || "본문에서 추가한 용어입니다.";
  els.termSearch.value = keyword;
  renderTermResults();
  requestAnimationFrame(() => {
    els.termDescription.focus();
    els.termDescription.select();
  });
}

function clearBlockTextStyle(blockId) {
  const block = currentDoc()?.blocks?.find(item => item.id === blockId);
  if (!block) return;
  recordUndo();
  delete block.fontSize;
  delete block.headingLevel;
  delete block.textAlign;
  delete block.textColor;
  delete block.highlightColor;
  markDirty();
  render();
}

function handleSlashInput(target) {
  if (!state.editMode || !target?.dataset?.blockId || target.selectionStart == null) return;
  const cursor = target.selectionStart;
  const before = target.value.slice(0, cursor);
  const match = before.match(/(?:^|\n)\/([^\n\s]*)$/);
  if (!match) {
    if (slashState.target === target) hideSlashPalette();
    return;
  }
  slashState = {
    target,
    blockId: target.dataset.blockId,
    unitId: target.dataset.unitId || "",
    query: match[1] || "",
    index: 0
  };
  renderSlashPalette();
}

function slashMatches() {
  const query = searchable(slashState.query);
  return blockInsertItems.filter(([type, label]) => {
    if (!query) return true;
    return searchable(`${type} ${label}`).includes(query);
  });
}

function renderSlashPalette() {
  const target = slashState.target;
  if (!target || !els.slashPalette) return;
  const items = slashMatches();
  if (!items.length) {
    hideSlashPalette();
    return;
  }
  const rect = target.getBoundingClientRect();
  slashState.index = Math.max(0, Math.min(slashState.index, items.length - 1));
  els.slashPalette.classList.remove("hidden");
  els.slashPalette.style.left = `${Math.min(window.innerWidth - 240, Math.max(12, rect.left))}px`;
  els.slashPalette.style.top = `${Math.min(window.innerHeight - 260, rect.top + 34)}px`;
  els.slashPalette.innerHTML = items.map(([type, label], index) => `
    <button class="${index === slashState.index ? "active" : ""}" type="button" data-slash-type="${escapeHtml(type)}">
      <strong>${escapeHtml(label)}</strong>
      <small>/${escapeHtml(type)}</small>
    </button>
  `).join("");
}

function hideSlashPalette() {
  if (!els.slashPalette) return;
  els.slashPalette.classList.add("hidden");
  els.slashPalette.innerHTML = "";
  slashState = { target: null, blockId: "", unitId: "", query: "", index: 0 };
}

function handleSlashKey(event) {
  if (!els.slashPalette || els.slashPalette.classList.contains("hidden")) return false;
  const items = slashMatches();
  if (!items.length) {
    hideSlashPalette();
    return false;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    slashState.index = (slashState.index + 1) % items.length;
    renderSlashPalette();
    return true;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    slashState.index = (slashState.index - 1 + items.length) % items.length;
    renderSlashPalette();
    return true;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    applySlashCommand(items[slashState.index][0]);
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    hideSlashPalette();
    return true;
  }
  return false;
}

function applySlashCommand(type) {
  const target = slashState.target;
  const blockId = slashState.blockId;
  const unitId = slashState.unitId || target?.dataset?.unitId || "";
  if (!target || !blockId) return;
  const cursor = target.selectionStart ?? target.value.length;
  const before = target.value.slice(0, cursor);
  const match = before.match(/(^|[\n])\/[^\n\s]*$/);
  if (match) {
    const slashStart = cursor - match[0].length + match[1].length;
    const next = `${target.value.slice(0, slashStart)}${target.value.slice(cursor)}`;
    target.value = next;
    if (target.dataset.blockField) updateBlockField(blockId, target.dataset.blockField, next);
    if (target.dataset.unitField) updateContentUnitField(blockId, target.dataset.unitId, target.dataset.unitField, next);
    if (type === "formula") {
      const marker = "[[math:E=mc^2]]";
      const value = `${target.value.slice(0, slashStart)}${marker}${target.value.slice(slashStart)}`;
      target.value = value;
      if (target.dataset.blockField) updateBlockField(blockId, target.dataset.blockField, value);
      if (target.dataset.unitField) updateContentUnitField(blockId, target.dataset.unitId, target.dataset.unitField, value);
      hideSlashPalette();
      target.focus();
      target.setSelectionRange(slashStart + marker.length, slashStart + marker.length);
      return;
    }
  }
  if (type === "formula") return;
  if (unitId) insertContentUnitAfter(blockId, unitId, type);
  else insertBlockAfter(blockId, type);
}

function insertContentUnitAfter(blockId, unitId, type) {
  const doc = currentDoc();
  const block = contentBlock(blockId);
  if (!doc || !block) return;
  const index = block.items.findIndex(item => item.id === unitId);
  if (index < 0) {
    insertBlockAfter(blockId, type);
    return;
  }
  const unit = createContentUnit(type);
  recordUndo();
  block.items.splice(index + 1, 0, unit);
  refreshDerivedDoc(doc);
  markDirty();
  hideSlashPalette();
  render();
  requestAnimationFrame(() => {
    const input = document.querySelector(`[data-block-id="${CSS.escape(blockId)}"][data-unit-id="${CSS.escape(unit.id)}"]`);
    input?.focus();
  });
}

function insertBlockAfter(blockId, type) {
  const doc = currentDoc();
  if (!doc) return;
  const index = doc.blocks.findIndex(block => block.id === blockId);
  if (index < 0) return;
  const block = createBlock(type);
  recordUndo();
  doc.blocks.splice(index + 1, 0, block);
  refreshDerivedDoc(doc);
  markDirty();
  hideSlashPalette();
  render();
  requestAnimationFrame(() => {
    const input = document.querySelector(`[data-block-id="${CSS.escape(block.id)}"]`);
    input?.focus();
  });
}

function hasFileTransfer(dataTransfer) {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types || []).includes("Files") || (dataTransfer.files?.length || 0) > 0;
}

function transferFiles(dataTransfer, options = {}) {
  const files = Array.from(dataTransfer?.files || []);
  return options.imagesOnly ? files.filter(file => String(file.type || "").startsWith("image/")) : files;
}

function extensionForClipboardImage(type) {
  const mime = String(type || "").toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("bmp")) return "bmp";
  return "png";
}

function namedClipboardImageFile(file, index) {
  const name = String(file?.name || "").trim();
  if (name && name !== "image.png") return file;
  const suffix = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = extensionForClipboardImage(file?.type);
  try {
    return new File([file], `clipboard-image-${suffix}-${index + 1}.${ext}`, {
      type: file.type || "image/png",
      lastModified: Date.now()
    });
  } catch (_) {
    return file;
  }
}

function clipboardImageFiles(event) {
  const data = event.clipboardData;
  if (!data) return [];
  const itemFiles = Array.from(data.items || [])
    .filter(item => item.kind === "file" && String(item.type || "").startsWith("image/"))
    .map(item => item.getAsFile())
    .filter(Boolean);
  const files = itemFiles.length ? itemFiles : Array.from(data.files || []).filter(file => String(file.type || "").startsWith("image/"));
  return files.map((file, index) => namedClipboardImageFile(file, index));
}

function inlineMediaInsertFromTextControl(element) {
  const control = element?.closest?.("textarea, input");
  if (!control || typeof control.value !== "string") return null;
  const field = control.dataset.unitField || control.dataset.blockField || "";
  if (!["text", "content"].includes(field)) return null;
  return {
    blockId: control.dataset.blockId || "",
    unitId: control.dataset.unitId || "",
    field,
    selectionStart: control.selectionStart ?? control.value.length,
    selectionEnd: control.selectionEnd ?? control.selectionStart ?? control.value.length
  };
}

function tableImageInsertFromElement(element) {
  const cell = element?.closest?.("[data-table-cell], [data-unit-table-cell], [data-collection-cell]");
  if (!cell) return null;
  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  if (cell.dataset.collectionCell) return { kind: "collection", row, col };
  if (cell.dataset.unitTableCell) {
    return {
      kind: "unit",
      blockId: cell.dataset.blockId || "",
      unitId: cell.dataset.unitId || "",
      row,
      col
    };
  }
  return {
    kind: "table",
    blockId: cell.dataset.blockId || "",
    row,
    col
  };
}

async function handlePastedImages(event, files) {
  const tableInsert = tableImageInsertFromElement(event.target);
  if (tableInsert) {
    await importTableCellImageFiles(files, tableInsert);
    return true;
  }
  const inlineInsert = inlineMediaInsertFromTextControl(event.target);
  if (inlineInsert) {
    await importInlineMediaFiles(files, inlineInsert);
    return true;
  }
  await insertFilesAsBlocks(files, event);
  return true;
}

async function handleDroppedFiles(event) {
  const files = transferFiles(event.dataTransfer);
  if (!files.length) return false;
  const tableInsert = tableImageInsertFromElement(event.target);
  const imageFiles = files.filter(file => String(file.type || "").startsWith("image/"));
  if (tableInsert && imageFiles.length === files.length) {
    await importTableCellImageFiles(imageFiles, tableInsert);
    return true;
  }
  const inlineInsert = inlineMediaInsertFromTextControl(event.target);
  if (inlineInsert) {
    await importInlineMediaFiles(files, inlineInsert);
    return true;
  }
  await insertFilesAsBlocks(files, event);
  return true;
}

async function insertFilesAsBlocks(files, event) {
  const doc = currentDoc();
  if (!doc || !files.length) {
    toast("파일을 넣을 문서를 먼저 선택하세요.");
    return false;
  }
  const blockEl = event.target.closest?.("[data-edit-block-id]");
  const unitEl = event.target.closest?.("[data-content-unit-id]");
  const targetBlockId = blockEl?.dataset.editBlockId || "";
  const targetContentBlock = unitEl && targetBlockId ? contentBlock(targetBlockId) : null;
  const created = [];
  recordUndo();
  for (const file of files) {
    const nextBlock = await createFileBackedBlock(file, targetContentBlock ? "unit" : "block", "auto");
    if (nextBlock.mediaId) {
      doc.mediaIds ||= [];
      if (!doc.mediaIds.includes(nextBlock.mediaId)) doc.mediaIds.push(nextBlock.mediaId);
    }
    created.push(nextBlock);
  }
  if (targetContentBlock) {
    const unitIndex = targetContentBlock.items.findIndex(item => item.id === unitEl.dataset.contentUnitId);
    targetContentBlock.items.splice(unitIndex >= 0 ? unitIndex + 1 : targetContentBlock.items.length, 0, ...created);
  } else {
    doc.blocks ||= [];
    const blockIndex = doc.blocks.findIndex(block => block.id === targetBlockId);
    doc.blocks.splice(blockIndex >= 0 ? blockIndex + 1 : doc.blocks.length, 0, ...created);
  }
  refreshDerivedDoc(doc);
  markDirty();
  render();
  toast(files.length > 1 ? `${files.length}개 파일을 추가했습니다.` : "파일을 추가했습니다.");
  return true;
}

function mediaReplaceTarget(replace = {}) {
  if (!replace.blockId) return null;
  if (replace.unitId) return contentUnit(replace.blockId, replace.unitId);
  return currentDoc()?.blocks?.find(block => block.id === replace.blockId) || null;
}

function blockReferencesMediaId(value, mediaId = "") {
  if (!mediaId || value == null) return false;
  if (Array.isArray(value)) return value.some(item => blockReferencesMediaId(item, mediaId));
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([key]) => key !== "mediaIds")
      .some(([, item]) => blockReferencesMediaId(item, mediaId));
  }
  return String(value || "").includes(mediaId);
}

function pruneDocMediaId(doc, mediaId = "") {
  if (!doc || !mediaId) return;
  const stillUsed = (doc.blocks || []).some(block => blockReferencesMediaId(block, mediaId));
  if (!stillUsed) doc.mediaIds = (doc.mediaIds || []).filter(id => id !== mediaId);
}

function clearBlockMedia(replace = {}) {
  const doc = currentDoc();
  const target = mediaReplaceTarget(replace);
  if (!doc || !target || !["media", "video", "attachment"].includes(target.type)) return;
  const previousMediaId = target.mediaId || "";
  const fallbackCaption = target.type === "video" ? "동영상" : target.type === "attachment" ? "첨부 파일" : "이미지";
  recordUndo();
  target.mediaId = "";
  target.path = "";
  target.url = "";
  target.src = "";
  target.fileName = "";
  target.size = 0;
  target.caption = fallbackCaption;
  if (target.type === "attachment") {
    target.text = fallbackCaption;
    target.content = "";
  }
  pruneDocMediaId(doc, previousMediaId);
  refreshDerivedDoc(doc);
  markDirty();
  render();
  toast("미디어를 비웠습니다.");
}

function mediaFileKind(file) {
  const mime = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  return {
    isImage: mime.startsWith("image/") || /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/.test(name),
    isVideo: mime.startsWith("video/") || /\.(m4v|mov|mp4|ogv|webm)$/.test(name)
  };
}

function resolvedMediaTypeForFile(file, preferredType = "auto") {
  if (["media", "video", "attachment"].includes(preferredType)) return preferredType;
  const kind = mediaFileKind(file);
  if (kind.isVideo) return "video";
  if (kind.isImage) return "media";
  return "attachment";
}

async function replaceBlockMediaFile(file, replace) {
  try {
    if (!file) return;
    const doc = currentDoc();
    const target = mediaReplaceTarget(replace);
    if (!doc || !target || !["media", "video", "attachment"].includes(target.type)) {
      toast("파일을 교체할 미디어 블록을 찾을 수 없습니다.");
      return;
    }

    const kind = mediaFileKind(file);
    if (replace.preferredType === "media" && !kind.isImage) {
      toast("이미지 블록에는 이미지 파일만 넣을 수 있습니다.");
      return;
    }
    if (replace.preferredType === "video" && !kind.isVideo) {
      toast("동영상 블록에는 동영상 파일만 넣을 수 있습니다.");
      return;
    }

    const previousMedia = mediaForTarget(target);
    const previousCaption = target.caption || "";
    const previousFileName = target.fileName || "";
    const shouldUseFileName = !previousCaption || previousCaption === previousFileName || previousCaption === previousMedia?.title;
    const dataUrl = await readFileAsDataUrl(file);
    const content = await readableTextFile(file);
    const nextType = resolvedMediaTypeForFile(file, replace.preferredType);

    recordUndo();
    const media = registerMediaAsset(file, dataUrl);
    target.type = nextType;
    target.mediaId = media.id;
    target.path = "";
    target.url = "";
    target.src = "";
    target.fileName = file.name;
    target.size = file.size;
    target.caption = shouldUseFileName ? file.name : previousCaption;
    if (nextType === "attachment") {
      target.text = file.name;
      target.content = content;
    }
    if (nextType === "media") target.imageWidth = normalizeImageWidth(target.imageWidth || 100);
    doc.mediaIds ||= [];
    if (!doc.mediaIds.includes(media.id)) doc.mediaIds.push(media.id);
    refreshDerivedDoc(doc);
    markDirty();
    render();
    toast("파일을 교체했습니다.");
  } finally {
    resetMediaPicker();
  }
}

async function importMediaFile(file) {
  const replace = pendingBlockMediaReplace;
  pendingBlockMediaReplace = null;
  if (replace) {
    await replaceBlockMediaFile(file, replace);
    return;
  }

  const inlineInsert = pendingInlineMediaInsert;
  pendingInlineMediaInsert = null;
  if (inlineInsert) {
    await importInlineMediaFile(file, inlineInsert);
    return;
  }

  const tableInsert = pendingTableImageInsert;
  pendingTableImageInsert = null;
  if (tableInsert) {
    await importTableCellImageFile(file, tableInsert);
    return;
  }

  const contentInsert = pendingContentMediaInsert;
  pendingContentMediaInsert = null;
  if (!file) return;
  const doc = currentDoc();
  if (!doc) {
    toast("미디어를 추가할 문서를 먼저 선택하세요.");
    return;
  }
  const contentTarget = contentInsert ? contentBlock(contentInsert.blockId) : null;
  if (contentInsert && !contentTarget) {
    toast("미디어를 넣을 블록 묶음을 찾을 수 없습니다.");
    return;
  }
  try {
    recordUndo();
    const nextBlock = await createFileBackedBlock(file, contentInsert ? "unit" : "block", contentInsert?.preferredType || "auto");
    if (nextBlock.mediaId) {
      doc.mediaIds ||= [];
      if (!doc.mediaIds.includes(nextBlock.mediaId)) doc.mediaIds.push(nextBlock.mediaId);
    }
    if (contentTarget) {
      const index = Math.max(0, Math.min(contentTarget.items.length, Number.isFinite(contentInsert.index) ? contentInsert.index : contentTarget.items.length));
      contentTarget.items.splice(index, 0, nextBlock);
    } else {
      doc.blocks ||= [];
      doc.blocks.push(nextBlock);
    }
    refreshDerivedDoc(doc);
    markDirty();
    render();
    toast(contentTarget ? "묶음 안에 미디어를 추가했습니다." : "미디어 블록을 추가했습니다.");
  } finally {
    resetMediaPicker();
  }
}

async function importInlineMediaFile(file, insert) {
  if (!file) return;
  const doc = currentDoc();
  if (!doc) {
    toast("미디어를 넣을 문서를 먼저 선택하세요.");
    return;
  }
  try {
    const dataUrl = await readFileAsDataUrl(file);
    recordUndo();
    const media = registerMediaAsset(file, dataUrl);
    const marker = inlineMediaMarker(inlineMediaKind(file), media.id, file.name);
    if (!insertInlineMediaMarker(insert, marker, media.id)) {
      toast("미디어를 넣을 텍스트 영역을 찾을 수 없습니다.");
      return;
    }
    refreshDerivedDoc(doc);
    markDirty();
    render();
    toast("텍스트 안에 미디어를 넣었습니다.");
  } finally {
    resetMediaPicker();
  }
}

async function importInlineMediaFiles(files, insert) {
  const doc = currentDoc();
  if (!doc || !files.length) {
    toast("미디어를 넣을 문서를 먼저 선택하세요.");
    return false;
  }
  const prepared = [];
  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file);
    prepared.push({ file, dataUrl });
  }
  recordUndo();
  const mediaIds = [];
  const markers = prepared.map(({ file, dataUrl }) => {
    const media = registerMediaAsset(file, dataUrl);
    mediaIds.push(media.id);
    return inlineMediaMarker(inlineMediaKind(file), media.id, file.name);
  });
  if (!insertInlineMediaMarkers(insert, markers.join("\n"), mediaIds)) {
    toast("미디어를 넣을 텍스트 영역을 찾을 수 없습니다.");
    return false;
  }
  refreshDerivedDoc(doc);
  markDirty();
  render();
  toast(files.length > 1 ? `${files.length}개 미디어를 붙여넣었습니다.` : "미디어를 붙여넣었습니다.");
  return true;
}

function inlineMediaKind(file) {
  const mime = String(file?.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

function inlineMediaMarker(kind, mediaId, caption = "") {
  const safeKind = ["image", "video", "file"].includes(kind) ? kind : "file";
  return `[[${safeKind}:${mediaId}|${String(caption || safeKind).replaceAll("]", "")}]]`;
}

function inlineMediaTargetFromControl(control) {
  const target = {
    blockId: control.dataset.blockId || "",
    unitId: control.dataset.unitId || "",
    field: control.dataset.inlineField || ""
  };
  const active = activeTextControl;
  const sameBlock = active?.dataset?.blockId === target.blockId;
  const sameUnit = (active?.dataset?.unitId || "") === target.unitId;
  const activeField = active?.dataset?.unitField || active?.dataset?.blockField || "";
  if (sameBlock && sameUnit && activeField === target.field && typeof active.value === "string") {
    target.selectionStart = active.selectionStart ?? active.value.length;
    target.selectionEnd = active.selectionEnd ?? target.selectionStart;
  }
  return target;
}

function insertInlineMediaMarker(insert, marker, mediaId = "") {
  return insertInlineMediaMarkers(insert, marker, mediaId ? [mediaId] : []);
}

function insertInlineMediaMarkers(insert, marker, mediaIds = []) {
  if (!insert?.blockId || !insert.field) return false;
  const doc = currentDoc();
  if (!doc) return false;
  let target = null;
  if (insert.unitId) {
    target = contentUnit(insert.blockId, insert.unitId);
  } else {
    target = doc.blocks?.find(block => block.id === insert.blockId);
  }
  if (!target) return false;
  const current = String(target[insert.field] || "");
  const start = Number.isFinite(insert.selectionStart) ? Math.max(0, Math.min(current.length, insert.selectionStart)) : current.length;
  const end = Number.isFinite(insert.selectionEnd) ? Math.max(start, Math.min(current.length, insert.selectionEnd)) : start;
  const spacerBefore = start > 0 && !/[\s\n]$/.test(current.slice(0, start)) ? "\n" : "";
  const spacerAfter = end < current.length && !/^[\s\n]/.test(current.slice(end)) ? "\n" : "";
  const next = `${current.slice(0, start)}${spacerBefore}${marker}${spacerAfter}${current.slice(end)}`;
  target[insert.field] = next;
  syncActiveInlineMediaControl(insert, next);
  doc.mediaIds ||= [];
  mediaIds.forEach(mediaId => {
    if (mediaId && !doc.mediaIds.includes(mediaId)) doc.mediaIds.push(mediaId);
  });
  return true;
}

function syncActiveInlineMediaControl(insert, value) {
  const active = activeTextControl;
  if (!active || typeof active.value !== "string") return;
  const sameBlock = active.dataset.blockId === insert.blockId;
  const sameUnit = (active.dataset.unitId || "") === (insert.unitId || "");
  const sameField = (active.dataset.unitField || active.dataset.blockField || "") === insert.field;
  if (!sameBlock || !sameUnit || !sameField) return;
  active.value = value;
}

async function importTableCellImageFile(file, insert) {
  if (!file) return;
  try {
    if (!file.type.startsWith("image/")) {
      toast("표 셀에는 이미지 파일만 넣을 수 있습니다.");
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    recordUndo();
    const media = registerMediaAsset(file, dataUrl);
    const marker = tableImageMarker(media.id, file.name);
    if (!appendTableCellMarker(insert, marker, media.id)) {
      toast("이미지를 넣을 셀을 찾을 수 없습니다.");
      return;
    }
    markDirty();
    render();
    toast("표 셀에 이미지를 넣었습니다.");
  } finally {
    resetMediaPicker();
  }
}

async function importTableCellImageFiles(files, insert) {
  const imageFiles = files.filter(file => String(file.type || "").startsWith("image/"));
  if (!imageFiles.length) {
    toast("표 셀에는 이미지 파일만 넣을 수 있습니다.");
    return false;
  }
  const prepared = [];
  for (const file of imageFiles) {
    prepared.push({ file, dataUrl: await readFileAsDataUrl(file) });
  }
  recordUndo();
  let inserted = false;
  prepared.forEach(({ file, dataUrl }) => {
    const media = registerMediaAsset(file, dataUrl);
    const marker = tableImageMarker(media.id, file.name);
    inserted = appendTableCellMarker(insert, marker, media.id) || inserted;
  });
  if (!inserted) {
    toast("이미지를 넣을 셀을 찾을 수 없습니다.");
    return false;
  }
  markDirty();
  render();
  toast(imageFiles.length > 1 ? `${imageFiles.length}개 이미지를 셀에 넣었습니다.` : "이미지를 셀에 넣었습니다.");
  return true;
}

async function createFileBackedBlock(file, idPrefix = "block", preferredType = "auto") {
  const id = createId(idPrefix);
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  const shouldUseMedia = preferredType !== "attachment" && (isImage || isVideo);
  if (shouldUseMedia) {
    const dataUrl = await readFileAsDataUrl(file);
    const media = registerMediaAsset(file, dataUrl);
    return {
      id,
      type: isVideo ? "video" : "media",
      mediaId: media.id,
      caption: file.name,
      imageWidth: 100
    };
  }
  const content = await readableTextFile(file);
  return {
    id,
    type: "attachment",
    text: `${file.name} (${formatBytes(file.size)})`,
    fileName: file.name,
    size: file.size,
    content
  };
}

function registerMediaAsset(file, dataUrl) {
  const id = createId("media");
  const media = {
    id,
    title: file.name,
    url: dataUrl,
    sourcePath: `업로드/${file.name}`,
    bytes: file.size
  };
  archive.media ||= [];
  archive.media.push(media);
  archive.mediaById ||= {};
  archive.mediaById[id] = media;
  return media;
}

function tableImageMarker(mediaId, caption = "") {
  return `[[image:${mediaId}|${String(caption || "이미지").replaceAll("]", "")}]]`;
}

function appendTableCellMarker(insert, marker, mediaId = "") {
  if (!insert || !Number.isFinite(insert.row) || !Number.isFinite(insert.col)) return false;
  if (insert.kind === "table") {
    const doc = currentDoc();
    const block = doc?.blocks?.find(item => item.id === insert.blockId && item.type === "table");
    if (!doc || !block) return false;
    block.rows ||= [];
    block.rows[insert.row] ||= [];
    block.rows[insert.row][insert.col] = appendCellMarker(block.rows[insert.row][insert.col], marker);
    doc.mediaIds ||= [];
    if (mediaId && !doc.mediaIds.includes(mediaId)) doc.mediaIds.push(mediaId);
    refreshDerivedDoc(doc);
    return true;
  }
  if (insert.kind === "unit") {
    const doc = currentDoc();
    const unit = contentUnit(insert.blockId, insert.unitId);
    if (!doc || !unit || unit.type !== "table") return false;
    unit.rows ||= [];
    unit.rows[insert.row] ||= [];
    unit.rows[insert.row][insert.col] = appendCellMarker(unit.rows[insert.row][insert.col], marker);
    doc.mediaIds ||= [];
    if (mediaId && !doc.mediaIds.includes(mediaId)) doc.mediaIds.push(mediaId);
    refreshDerivedDoc(doc);
    return true;
  }
  if (insert.kind === "collection") {
    const collection = currentCollection();
    if (!collection) return false;
    collection.rows ||= [];
    collection.rows[insert.row] ||= [];
    collection.rows[insert.row][insert.col] = appendCellMarker(collection.rows[insert.row][insert.col], marker);
    refreshDerivedCollection(collection);
    return true;
  }
  return false;
}

function appendCellMarker(value, marker) {
  const text = String(value || "").trimEnd();
  return text ? `${text}\n${marker}` : marker;
}

async function importTableFile(file) {
  if (!file) return;
  const target = pendingTableImportTarget || "document";
  const sourceRef = pendingTableImportSource;
  pendingTableImportTarget = "";
  pendingTableImportSource = null;
  if (target === "collections") {
    await importCollectionsFile(file);
    return;
  }
  if (target === "source") {
    await importTableRowsIntoSource(file, sourceRef);
    return;
  }
  const doc = currentDoc();
  if (!doc) {
    toast("표를 추가할 문서를 먼저 선택하세요.");
    return;
  }
  try {
    const rows = await readTableRows(file);
    if (!rows.length) throw new Error("No rows");
    recordUndo();
    doc.blocks ||= [];
    doc.blocks.push({ id: `block-${Date.now().toString(36)}`, type: "table", rows });
    refreshDerivedDoc(doc);
    markDirty();
    render();
    toast("표 블록을 가져왔습니다.");
  } catch (err) {
    toast("표 파일을 읽을 수 없습니다.");
  } finally {
    els.tableFilePicker.value = "";
  }
}

async function importTableRowsIntoSource(file, ref = null) {
  if (!file || !ref) return;
  try {
    const rows = await readTableRows(file);
    if (!rows.length) throw new Error("No rows");
    const target = tableImportTargetFromRef(ref);
    if (!target?.source || !target.doc) throw new Error("Missing table target");
    recordUndo();
    target.source.rows = normalizeTableRows(rows);
    refreshDerivedDoc(target.doc);
    markDirty();
    render();
    toast("현재 표를 가져온 파일로 교체했습니다.");
  } catch (err) {
    toast("표 파일을 읽을 수 없습니다.");
  } finally {
    els.tableFilePicker.value = "";
  }
}

function tableImportTargetFromRef(ref = {}) {
  for (const doc of archive.documents || []) {
    for (const block of doc.blocks || []) {
      if (ref.kind === "table" && block.id === ref.blockId && block.type === "table") {
        return { doc, source: block };
      }
      if (ref.kind === "unit" && block.id === ref.blockId) {
        const unit = (block.items || []).find(item => item.id === ref.unitId && item.type === "table");
        if (unit) return { doc, source: unit };
      }
    }
  }
  return null;
}

async function importCollectionsFile(file) {
  if (!file) return;
  try {
    const sheets = (await readTableSheets(file)).filter(sheet => sheet.rows.length);
    if (!sheets.length) throw new Error("No rows");
    const category = state.category !== "all" ? state.category : archive.categories[0]?.id || "general";
    const categoryLabel = categoryById.get(category)?.label || category;
    const created = sheets.map(sheet => {
      const collection = {
        id: createId("collection"),
        title: sheet.name || tableFileBaseName(file),
        category,
        categoryLabel,
        sourcePath: `업로드/${file.name}${sheets.length > 1 ? `/${sheet.name}` : ""}`,
        rows: normalizeTableRows(sheet.rows),
        rowCount: 0,
        columnCount: 0,
        searchText: ""
      };
      refreshDerivedCollection(collection);
      return collection;
    });
    recordUndo();
    archive.collections.unshift(...created);
    rebuildIndexes();
    state.selectedCollectionId = created[0].id;
    state.view = "collections";
    markDirty();
    render();
    toast(created.length > 1 ? `${created.length}개 표를 가져왔습니다.` : "표 데이터를 가져왔습니다.");
  } catch (err) {
    toast("표 데이터 파일을 읽을 수 없습니다.");
  } finally {
    els.tableFilePicker.value = "";
  }
}

async function readTableSheets(file) {
  const name = String(file.name || "table").toLowerCase();
  if ((name.endsWith(".xlsx") || name.endsWith(".xls")) && window.XLSX) {
    const data = await file.arrayBuffer();
    const workbook = window.XLSX.read(data, { type: "array" });
    return workbook.SheetNames.map(sheetName => {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, blankrows: false, defval: "" })
        .map(row => row.map(cell => String(cell ?? "")));
      return { name: sheetName, rows };
    });
  }
  return [{ name: tableFileBaseName(file), rows: await readTableRows(file) }];
}

async function readTableRows(file) {
  const name = file.name.toLowerCase();
  if ((name.endsWith(".xlsx") || name.endsWith(".xls")) && window.XLSX) {
    const data = await file.arrayBuffer();
    const workbook = window.XLSX.read(data, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return window.XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }).map(row => row.map(cell => String(cell ?? "")));
  }
  const text = await file.text();
  const delimiter = name.endsWith(".tsv") || text.includes("\t") ? "\t" : ",";
  return parseDelimited(text, delimiter);
}

function parseDelimited(text, delimiter) {
  const source = String(text || "").replace(/^\ufeff/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows.filter(item => item.some(value => String(value || "").trim().length));
}

function tableFileBaseName(file) {
  return String(file?.name || "table").replace(/\.[^.]+$/, "") || "table";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function readableTextFile(file) {
  const lower = String(file.name || "").toLowerCase();
  const isText = String(file.type || "").startsWith("text/")
    || [".txt", ".md", ".json", ".csv", ".tsv", ".log"].some(ext => lower.endsWith(ext));
  if (!isText || file.size > 1024 * 1024) return "";
  try {
    return (await file.text()).slice(0, 12000);
  } catch (_) {
    return "";
  }
}

function hydrateLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const meta = JSON.parse(localStorage.getItem(META_KEY) || "null");
    if (saved?.documents && saved?.collections) {
      archive = saved;
      state.revision = Number(meta?.revision || 0);
      state.lastSavedAt = meta?.savedAt || "";
      state.saveMode = meta?.saveMode || "local";
    }
  } catch (err) {
    console.warn("Could not load local archive state.", err);
  }
}

async function hydrateServer() {
  try {
    const response = await fetch("/api/archive/state", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) {
      state.saveMode = "local";
      persistLocal();
      return;
    }
    const payload = await response.json();
    if (!payload.ok || !payload.state?.documents) return;
    if (Number(payload.revision || 0) >= state.revision) {
      archive = payload.state;
      state.revision = Number(payload.revision || 0);
      state.lastSavedAt = payload.updatedAt || "";
      state.saveMode = "server";
      state.pendingRemoteRevision = 0;
      rebuildIndexes();
      persistLocal();
    }
  } catch (_) {
    state.saveMode = "local";
  }
}

function markDirty(value = true) {
  state.dirty = value;
  if (value) scheduleSave();
  renderTopbar();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveArchiveNow({ manual: false }), 1100);
}

async function saveArchiveNow(options = {}) {
  clearTimeout(saveTimer);
  archive.updatedAt = new Date().toISOString();
  persistLocal();

  if (state.saveMode === "server") {
    try {
      const response = await fetch("/api/archive/save", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          state: archive,
          revision: state.revision,
          clientId: state.clientId,
          clientName: state.authUser?.displayName || state.authUser?.username || "Archive user"
        })
      });
      const payload = await response.json();
      if (response.status === 409 && payload?.reason === "conflict") {
        state.pendingRemoteRevision = Math.max(Number(state.pendingRemoteRevision || 0), Number(payload.revision || 0));
        state.saveMode = "server";
        persistLocal();
        renderCollabStatus();
        toast("서버에 더 최신 편집본이 있습니다. 원격 변경을 확인한 뒤 다시 저장하세요.");
        if (!isArchiveActivelyEditing()) pullRemoteArchiveState(Number(payload.revision || 0));
        return;
      }
      if (!response.ok || !payload.ok) throw new Error(payload.error || "save failed");
      state.revision = Number(payload.revision || state.revision);
      state.lastSavedAt = payload.updatedAt || archive.updatedAt;
      if (Number(state.pendingRemoteRevision || 0) <= state.revision) state.pendingRemoteRevision = 0;
      state.dirty = false;
      persistLocal();
      if (options.manual) render();
      else renderTopbar();
      if (options.manual) toast("서버에 저장했습니다.");
      return;
    } catch (err) {
      state.saveMode = "local";
      persistLocal();
      if (options.manual) toast("서버 저장에 실패해 브라우저에 저장했습니다.");
    }
  }

  state.lastSavedAt = archive.updatedAt;
  state.dirty = false;
  persistLocal();
  if (options.manual) render();
  else renderTopbar();
  if (options.manual) toast("브라우저에 저장했습니다.");
}

function persistLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(archive));
    localStorage.setItem(META_KEY, JSON.stringify({
      revision: state.revision,
      savedAt: archive.updatedAt || new Date().toISOString(),
      saveMode: state.saveMode
    }));
  } catch (err) {
    console.warn("Local archive save failed.", err);
    toast("브라우저 저장 공간이 부족합니다. JSON으로 내보내세요.");
  }
}

function exportArchiveState() {
  downloadBlob("eodum-cheonggangdan-archive-edit.json", JSON.stringify(archive, null, 2), "application/json;charset=utf-8");
  toast("편집본을 내보냈습니다.");
}

async function saveArchiveFile() {
  await saveArchiveNow({ manual: false });
  const filename = `${safeFilename(archive.title || "archive")}-edit.json`;
  const content = JSON.stringify(archive, null, 2);
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: "Archive edit JSON",
          accept: { "application/json": [".json"] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      toast("파일로 저장했습니다.");
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.error(err);
    }
  }
  downloadBlob(filename, content, "application/json;charset=utf-8");
  toast("JSON 파일을 내려받았습니다.");
}

function exportArchiveMarkdown() {
  downloadBlob("eodum-cheonggangdan-archive.md", archiveToMarkdown(), "text/markdown;charset=utf-8");
  toast("마크다운을 내보냈습니다.");
}

function exportArchiveHtml() {
  downloadBlob("eodum-cheonggangdan-archive-app.html", archiveToAppHtml(), "text/html;charset=utf-8");
  toast("편집 가능한 HTML 앱으로 내보냈습니다.");
}

function exportArchiveReportHtml() {
  downloadBlob("eodum-cheonggangdan-archive-report.html", archiveToHtml(), "text/html;charset=utf-8");
  toast("HTML 보고서를 내보냈습니다.");
}

function archiveToMarkdown() {
  const totals = currentTotals();
  const lines = [
    `# ${archive.title}`,
    "",
    archive.subtitle || "Notion export 기반 웹 문서 편집 허브",
    "",
    "## 통계",
    `- 문서: ${totals.documents}`,
    `- 표 데이터: ${totals.collections}`,
    `- 미디어: ${totals.bundledMedia}`,
    "",
    "## 문서"
  ];
  for (const doc of archive.documents) {
    lines.push("", ...docToMarkdown(doc));
  }
  if (archive.collections.length) {
    lines.push("", "## 표 데이터");
    for (const collection of archive.collections) {
      lines.push("", `### ${collection.title}`, "", tableToMarkdown(collection.rows || []));
    }
  }
  if (archive.glossary?.length) {
    lines.push("", "## 용어 사전");
    for (const term of [...archive.glossary].sort((a, b) => a.keyword.localeCompare(b.keyword, "ko-KR"))) {
      const aliases = glossaryAliases(term);
      lines.push("", `### ${term.keyword}`, "", term.description || "");
      if (aliases.length) lines.push("", `- 별칭: ${aliases.join(", ")}`);
    }
  }
  return lines.join("\n");
}

function docToMarkdown(doc) {
  const lines = [
    `### ${doc.title}`,
    ""
  ];
  if (doc.subtitle) lines.push(doc.subtitle, "");
  lines.push(
    `- 분류: ${doc.categoryLabel}`,
    `- 상태: ${statusLabels[doc.status] || doc.status}`,
    `- 원본: ${doc.sourcePath}`,
    "",
    doc.excerpt || ""
  );
  for (const block of doc.blocks || []) {
    const markdown = blockToMarkdown(block);
    if (markdown) lines.push("", markdown);
  }
  return lines;
}

function blockToMarkdown(block) {
  if (block.type === "generic") return (block.items || []).map(unit => blockToMarkdown(unit)).filter(Boolean).join("\n\n");
  if (block.type === "heading") return `${"#".repeat(Math.min(6, Number(block.level || 1) + 1))} ${block.text || ""}`;
  if (block.type === "paragraph") return inlineTextToMarkdown(block.text || "");
  if (block.type === "callout") return `> [!NOTE]\n> ${inlineTextToMarkdown(block.content || "").replace(/\n/g, "\n> ")}`;
  if (block.type === "quote") return inlineTextToMarkdown(block.content || "").split(/\r?\n/).map(line => `> ${line}`).join("\n");
  if (block.type === "list") return `- ${inlineTextToMarkdown(block.text || "")}`;
  if (block.type === "checklist") return block.content || "- [ ] 확인할 항목";
  if (block.type === "code") return `\`\`\`${block.language || "text"}\n${block.content || ""}\n\`\`\``;
  if (block.type === "divider") return block.label ? `---\n\n_${block.label}_` : "---";
  if (block.type === "table") return tableToMarkdown(block.rows || []);
  if (block.type === "dataset") {
    const collection = collectionsById.get(block.collectionId) || archive.collections[0];
    return collection ? `#### ${collection.title}\n\n${tableToMarkdown(collection.rows || [])}` : "";
  }
  if (block.type === "flow") return `\`\`\`text\n${block.content || ""}\n\`\`\``;
  if (block.type === "mermaid") return `\`\`\`mermaid\n${block.content || ""}\n\`\`\``;
  if (block.type === "drawing") return block.dataUrl ? `![${block.caption || "그림판"}](${block.dataUrl})` : `> ${block.caption || "그림판"}`;
  if (block.type === "media") {
    const src = mediaSourceForTarget(block);
    return src ? `![${mediaLabelForTarget(block, "이미지")}](${src})` : "";
  }
  if (block.type === "video") {
    const src = mediaSourceForTarget(block);
    return src ? `[${mediaLabelForTarget(block, "동영상")}](${src})` : "";
  }
  if (block.type === "attachment") {
    const src = mediaSourceForTarget(block);
    const label = mediaLabelForTarget(block, "첨부 파일");
    return src ? `> 첨부: [${label}](${src})` : `> 첨부: ${label}`;
  }
  if (["dialogue", "calendar", "team", "workboard", "meetingbook"].includes(block.type)) {
    const collection = collectionsById.get(block.collectionId);
    return [
      `#### ${block.title || blockLabel(block.type)}`,
      inlineTextToMarkdown(block.content || ""),
      collection ? `##### ${collection.title}\n\n${tableToMarkdown(collection.rows || [])}` : ""
    ].filter(Boolean).join("\n\n");
  }
  return "";
}

function inlineTextToMarkdown(value = "") {
  let text = String(value || "");
  let previous = "";
  while (previous !== text) {
    previous = text;
    text = text.replace(/\[\[(?:size|color|mark|align):(12|14|16|18|20|24|28|#[0-9a-fA-F]{6}|left|center|right)\|([\s\S]*?)\]\]/gi, "$2");
  }
  return text
    .replace(/\[\[math:([\s\S]*?)\]\]/gi, (_match, expression) => `$${String(expression).trim()}$`)
    .replace(/\[\[image:([^\]|]+)(?:\|([^\]]*))?\]\]/gi, (_match, ref, caption) => `![${caption || ref}](${inlineMediaMarkdownRef(ref)})`)
    .replace(/\[\[(video|file):([^\]|]+)(?:\|([^\]]*))?\]\]/gi, (_match, _kind, ref, caption) => `[${caption || ref}](${inlineMediaMarkdownRef(ref)})`)
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, term, label) => label || term)
    .replace(/<u>([\s\S]*?)<\/u>/g, "__$1__");
}

function inlineMediaMarkdownRef(ref = "") {
  const media = archive.mediaById?.[ref] || archive.media?.find?.(item => item.id === ref);
  return inlineMediaSrc(ref, media) || ref;
}

function tableToMarkdown(rows = []) {
  if (!rows.length) return "";
  const width = Math.max(1, ...rows.map(row => row.length));
  const normalized = rows.map(row => Array.from({ length: width }, (_, index) => inlineTextToMarkdown(String(row[index] ?? "")).replace(/\|/g, "\\|")));
  const head = normalized[0];
  const body = normalized.slice(1);
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...body.map(row => `| ${row.join(" | ")} |`)
  ].join("\n");
}

function archiveToHtml() {
  const data = JSON.stringify(archive).replaceAll("</script", "<\\/script");
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(archive.title)}</title>
  <style>
    body{font-family:Arial,"Malgun Gothic",sans-serif;line-height:1.6;margin:32px;color:#1f2522}
    h1,h2,h3{line-height:1.25} table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #d8ded8;padding:6px 8px;text-align:left;vertical-align:top}img{max-width:100%;height:auto}.doc{border-top:1px solid #d8ded8;padding-top:18px;margin-top:24px}.meta{color:#68726c}.inline-media{display:inline-grid;gap:4px;max-width:min(100%,420px);margin:8px 0;padding:8px;border:1px solid #d8ded8;border-radius:8px}.inline-media img,.inline-media video{display:block;width:100%;max-height:280px;object-fit:contain}.inline-media small,.inline-file{color:#68726c;font-size:12px}.math-inline{display:inline-block;padding:1px 6px;border:1px solid #cfdad4;border-radius:5px;background:#f7fbf8;color:#173f38;font-family:Consolas,monospace;font-size:.92em;font-weight:800}.rich-mark{padding:0 3px;border-radius:5px}.rich-align{display:block}.rich-align-center{text-align:center}.rich-align-right{text-align:right}
  </style>
</head>
<body>
  <h1>${escapeHtml(archive.title)}</h1>
  <p>${escapeHtml(archive.subtitle || "Notion export 기반 웹 문서 편집 허브")}</p>
  ${(archive.documents || []).map(doc => `
    <article class="doc">
      <p class="meta">${escapeHtml(doc.categoryLabel)} · ${escapeHtml(statusLabels[doc.status] || doc.status)}</p>
      <h2>${escapeHtml(doc.title)}</h2>
      ${doc.subtitle ? `<p class="subtitle">${escapeHtml(doc.subtitle)}</p>` : ""}
      <p>${escapeHtml(doc.excerpt || "")}</p>
      ${(doc.blocks || []).map(block => blockToHtml(block)).join("")}
    </article>
  `).join("")}
  ${archive.glossary?.length ? `
    <section class="doc">
      <h2>용어 사전</h2>
      ${archive.glossary.map(term => `<article><h3>${escapeHtml(term.keyword)}</h3>${glossaryAliases(term).length ? `<p class="meta">별칭: ${escapeHtml(aliasesText(glossaryAliases(term)))}</p>` : ""}<p>${escapeHtml(term.description || "")}</p></article>`).join("")}
    </section>
  ` : ""}
  <script type="application/json" id="archive-export-data">${data}</script>
</body>
</html>`;
}

function archiveToAppHtml() {
  const data = JSON.stringify(archive, null, 2)
    .replace(/</g, "\\u003c")
    .replaceAll("</script", "<\\/script");
  const dataScript = `<script id="archive-export-data" type="application/json">\n${data}\n  </script>\n  <script>window.SHIM_NOTION_ARCHIVE = JSON.parse(document.getElementById("archive-export-data").textContent);</script>`;
  let html = `<!doctype html>\n${document.documentElement.outerHTML}`;
  const dataScriptPattern = /<script\s+src="\.\.\/assets\/data\/notion-archive-data\.js[^"]*"><\/script>/i;
  if (dataScriptPattern.test(html)) {
    html = html.replace(dataScriptPattern, dataScript);
  } else {
    html = html.replace(/<script\s+defer\s+src="\.\.\/assets\/js\/notion-hub\.js[^"]*"><\/script>/i, `${dataScript}\n  $&`);
  }
  return html;
}

function blockToHtml(block) {
  if (block.type === "generic") return `<section>${(block.items || []).map(unit => blockToHtml(unit)).join("")}</section>`;
  if (block.type === "heading") {
    const level = Math.min(4, Math.max(2, Number(block.level || 1) + 1));
    return `<h${level}>${escapeHtml(block.text || "")}</h${level}>`;
  }
  if (block.type === "paragraph") return `<p>${renderInlineText(block.text || "")}</p>`;
  if (block.type === "callout") return `<aside><strong>강조</strong><p>${renderInlineText(block.content || "")}</p></aside>`;
  if (block.type === "quote") return `<blockquote>${renderInlineText(block.content || "")}</blockquote>`;
  if (block.type === "list") return `<ul><li>${renderInlineText(block.text || "")}</li></ul>`;
  if (block.type === "checklist") return `<ul>${String(block.content || "").split(/\r?\n/).filter(Boolean).map(line => `<li>${escapeHtml(line.replace(/^\s*-\s*\[[ xX]\]\s*/, ""))}</li>`).join("")}</ul>`;
  if (block.type === "code") return `<pre><code>${escapeHtml(block.content || "")}</code></pre>`;
  if (block.type === "divider") return `<hr>${block.label ? `<p><em>${escapeHtml(block.label)}</em></p>` : ""}`;
  if (block.type === "table") return renderStaticTable(block.rows || []);
  if (block.type === "dataset") {
    const collection = collectionsById.get(block.collectionId) || archive.collections[0];
    return collection ? `<h3>${escapeHtml(collection.title)}</h3>${renderStaticTable(collection.rows || [])}` : "";
  }
  if (block.type === "flow" || block.type === "mermaid") return `<pre>${escapeHtml(block.content || "")}</pre>`;
  if (block.type === "drawing") return block.dataUrl ? `<figure><img src="${escapeHtml(block.dataUrl)}" alt="${escapeHtml(block.caption || "그림판")}"><figcaption>${escapeHtml(block.caption || "그림판")}</figcaption></figure>` : `<p>${escapeHtml(block.caption || "그림판")}</p>`;
  if (block.type === "media") {
    const src = mediaSourceForTarget(block);
    const label = mediaLabelForTarget(block, "이미지");
    return src ? `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(label)}"><figcaption>${escapeHtml(label)}</figcaption></figure>` : "";
  }
  if (block.type === "video") {
    const src = mediaSourceForTarget(block);
    const label = mediaLabelForTarget(block, "동영상");
    return src ? `<figure><video src="${escapeHtml(src)}" controls></video><figcaption>${escapeHtml(label)}</figcaption></figure>` : "";
  }
  if (block.type === "attachment") {
    const src = mediaSourceForTarget(block);
    const label = mediaLabelForTarget(block, "첨부 파일");
    return `<p><strong>첨부:</strong> ${src ? `<a href="${escapeHtml(src)}">${escapeHtml(label)}</a>` : escapeHtml(label)}</p>`;
  }
  if (["dialogue", "calendar", "team", "workboard", "meetingbook"].includes(block.type)) {
    const collection = collectionsById.get(block.collectionId);
    return `<section><h3>${escapeHtml(block.title || blockLabel(block.type))}</h3>${block.content ? `<p>${renderInlineText(block.content || "")}</p>` : ""}${collection ? `<h4>${escapeHtml(collection.title)}</h4>${renderStaticTable(collection.rows || [])}` : ""}</section>`;
  }
  return "";
}

function renderStaticTable(rows = []) {
  if (!rows.length) return "";
  return `<table>${rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</table>`;
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function safeFilename(value) {
  return String(value || "archive").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "archive";
}

async function importArchiveFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const imported = file.name.toLowerCase().endsWith(".html")
      ? parseArchiveHtmlExport(text)
      : JSON.parse(text);
    if (!imported?.documents || !imported?.collections) throw new Error("Invalid archive JSON");
    recordUndo();
    archive = imported;
    rebuildIndexes();
    markDirty();
    render();
    toast("편집본을 가져왔습니다.");
  } catch (err) {
    toast("가져오기 파일을 읽을 수 없습니다.");
  } finally {
    els.importArchive.value = "";
  }
}

function parseArchiveHtmlExport(text) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  const data = doc.getElementById("archive-export-data")?.textContent;
  if (!data) throw new Error("No archive data in HTML");
  return JSON.parse(data);
}

function rebuildIndexes() {
  ensureArchiveIds();
  archive.mediaById = Object.fromEntries((archive.media || []).map(item => [item.id, item]));
  docsById = new Map((archive.documents || []).map(doc => [doc.id, doc]));
  collectionsById = new Map((archive.collections || []).map(item => [item.id, item]));
  categoryById = new Map((archive.categories || []).map(category => [category.id, category]));
}

function ensureArchiveIds() {
  archive.documents ||= [];
  archive.collections ||= [];
  archive.media ||= [];
  archive.categories ||= [];
  const docIds = new Set();
  archive.documents.forEach((doc, docIndex) => {
    doc.id = ensureUniqueArchiveId(doc.id, "doc", docIds, [doc.sourcePath, doc.title, docIndex]);
    doc.depth = documentDepth(doc);
    doc.blocks ||= [];
    const blockIds = new Set();
    doc.blocks.forEach((block, blockIndex) => {
      block.id = ensureUniqueArchiveId(block.id, "block", blockIds, [doc.id, blockIndex, block.type, block.text || block.content || block.caption || block.title || block.mediaId]);
      if (block.type !== "generic") return;
      block.items ||= [];
      const unitIds = new Set();
      block.items.forEach((unit, unitIndex) => {
        unit.id = ensureUniqueArchiveId(unit.id, "unit", unitIds, [block.id, unitIndex, unit.type, unit.text || unit.content || unit.caption || unit.title || unit.mediaId]);
      });
    });
  });
  const collectionIds = new Set();
  archive.collections.forEach((collection, index) => {
    collection.id = ensureUniqueArchiveId(collection.id, "collection", collectionIds, [collection.sourcePath, collection.title, index]);
  });
  const mediaIds = new Set();
  archive.media.forEach((media, index) => {
    media.id = ensureUniqueArchiveId(media.id, "media", mediaIds, [media.sourcePath, media.title, media.url, index]);
  });
}

function ensureUniqueArchiveId(value, prefix, seen, parts = []) {
  let id = String(value || "").trim();
  if (!id || seen.has(id)) {
    const base = stableArchiveId(prefix, parts);
    id = base;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
  }
  seen.add(id);
  return id;
}

function stableArchiveId(prefix, parts = []) {
  const source = parts.map(part => String(part ?? "")).join("|");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function currentTotals() {
  const byStatus = statusCounts();
  return {
    files: archive.insights?.totals?.files || 0,
    documents: archive.documents.length,
    collections: archive.collections.length,
    originalMediaFiles: archive.insights?.totals?.originalMediaFiles || archive.media.length,
    activeDocuments: byStatus.active,
    reviewDocuments: byStatus.review,
    legacyDocuments: byStatus.legacy,
    bundledMedia: archive.media.length
  };
}

function categoryCounts() {
  return archive.documents.reduce((counts, doc) => {
    counts[doc.category] = (counts[doc.category] || 0) + 1;
    return counts;
  }, {});
}

function statusCounts() {
  return archive.documents.reduce((counts, doc) => {
    counts[doc.status] = (counts[doc.status] || 0) + 1;
    return counts;
  }, { active: 0, review: 0, legacy: 0 });
}

function buildCleanup() {
  const reviewDocs = archive.documents.filter(doc => doc.status === "review").map(toDocRef);
  const legacyDocs = archive.documents.filter(doc => doc.status === "legacy").map(toDocRef);
  const untitledDocs = archive.documents.filter(doc => /제목\s*없음/.test(doc.title)).map(toDocRef);
  return { reviewDocs, legacyDocs, untitledDocs };
}

function toDocRef(doc) {
  return {
    id: doc.id,
    title: doc.title,
    categoryLabel: doc.categoryLabel,
    status: doc.status
  };
}

function statusRank(status) {
  return { active: 0, review: 1, legacy: 2 }[status] ?? 3;
}

function mediaTile(media) {
  const owner = archive.documents.find(doc => (doc.mediaIds || []).includes(media.id));
  return `
    <figure class="media-tile">
      <button type="button" ${owner ? `data-doc="${escapeHtml(owner.id)}"` : "data-view=\"media\""}>
        <img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.title)}" loading="lazy">
        <span class="media-caption">
          <strong>${escapeHtml(media.title)}</strong>
          <span>${escapeHtml(owner?.title || media.sourcePath)} · ${formatBytes(media.bytes)}</span>
        </span>
      </button>
    </figure>
  `;
}

function renderTableTools(source = {}, options = {}) {
  const rows = options.rows || source.rows || [];
  const columns = tableColumnOptions(rows, source);
  if (!columns.length) return "";
  const kind = options.kind || "table";
  const attrs = tableControlAttrs({ ...options, kind });
  const addRowAction = kind === "collection" ? "add-collection-row" : kind === "unit" ? "add-unit-table-row" : "add-table-row";
  const addColAction = kind === "collection" ? "add-collection-column" : kind === "unit" ? "add-unit-table-column" : "add-table-column";
  const importButton = ["table", "unit"].includes(kind) ? `<button type="button" data-action="import-table-source" ${attrs}>Excel/CSV 가져오기</button>` : "";
  const hiddenCount = hiddenTableColumnSet(source).size;
  return `
    <div class="table-tools sheet-tools">
      <label class="editor-field sheet-filter-field">필터
        <input class="sheet-filter" type="search" value="${escapeHtml(source.filter || "")}" data-table-filter="1" ${attrs} placeholder="현재 표 필터">
      </label>
      <label class="editor-field sheet-sort-field">정렬
        <select data-table-sort-column="1" ${attrs} aria-label="정렬 열">
          ${columns.map(({ index, label }) => `<option value="${index}" ${Number(source.sortColumn) === index ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
        </select>
      </label>
      ${hiddenCount ? `<span class="table-hidden-note">숨김 열 ${hiddenCount.toLocaleString("ko-KR")}개</span>` : ""}
      <div class="sheet-action-row">
        ${importButton}
        <button type="button" data-action="table-sort" data-direction="asc" ${attrs}>오름차순</button>
        <button type="button" data-action="table-sort" data-direction="desc" ${attrs}>내림차순</button>
        <button type="button" data-action="table-clear-view" ${attrs}>필터 해제</button>
        <button type="button" data-action="hide-table-column" ${attrs}>선택 열 숨김</button>
        ${hiddenCount ? `<button type="button" data-action="show-table-columns" ${attrs}>숨김 해제</button>` : ""}
        <button type="button" data-action="${addRowAction}" ${attrs}>행 추가</button>
        <button type="button" data-action="${addColAction}" ${attrs}>열 추가</button>
        <button class="danger" type="button" data-action="delete-table-row-selected" ${attrs}>선택 행 삭제</button>
        <button class="danger" type="button" data-action="delete-table-column" ${attrs}>선택 열 삭제</button>
        <button type="button" data-action="table-export-csv" ${attrs}>CSV 저장</button>
        <button type="button" data-action="table-export-xlsx" ${attrs}>Excel 저장</button>
      </div>
    </div>
  `;
}

function tableControlAttrs(options = {}) {
  return [
    `data-table-kind="${escapeHtml(options.kind || "table")}"`,
    options.blockId ? `data-block-id="${escapeHtml(options.blockId)}"` : "",
    options.unitId ? `data-unit-id="${escapeHtml(options.unitId)}"` : ""
  ].filter(Boolean).join(" ");
}

function tableColumnOptions(rows = [], source = {}) {
  const normalized = normalizeTableRows(rows);
  const header = normalized[detectTableHeaderIndex(normalized)] || normalized[0] || [];
  return visibleTableColumnIndexes(normalized, source).map(index => ({
    index,
    label: String(header[index] || tableColumnLabel(index)).slice(0, 44)
  }));
}

function hiddenTableColumnSet(source = {}) {
  const hiddenColumns = Array.isArray(source.hiddenColumns)
    ? source.hiddenColumns
    : defaultHiddenTableColumns(source);
  return new Set(hiddenColumns.map(item => String(item || "").trim()).filter(Boolean));
}

function defaultHiddenTableColumns(source = {}) {
  const haystack = searchable(`${source.title || ""} ${source.sourcePath || ""} ${source.category || ""} ${source.categoryLabel || ""} ${source.type || ""}`);
  if (haystack.includes(searchable("회의록")) || haystack.includes("meeting")) return ["액션아이템"];
  return [];
}

function tableColumnName(rows = [], index = 0) {
  const normalized = normalizeTableRows(rows);
  const header = normalized[detectTableHeaderIndex(normalized)] || normalized[0] || [];
  return String(header[index] || tableColumnLabel(index)).trim();
}

function visibleTableColumnIndexes(rows = [], source = {}) {
  const normalized = normalizeTableRows(rows);
  const width = tableWidth(normalized);
  const hidden = hiddenTableColumnSet(source);
  const indexes = Array.from({ length: width }, (_, index) => index)
    .filter(index => !hidden.has(tableColumnName(normalized, index)));
  return indexes.length ? indexes : Array.from({ length: width }, (_, index) => index);
}

function renderTable(rows = [], options = {}) {
  if (!rows.length) return empty("표 내용이 없습니다.");
  const source = options.source || {};
  const normalized = normalizeTableRows(rows);
  const view = tableViewRows(normalized, source);
  const visibleColumns = visibleTableColumnIndexes(normalized, source);
  const hasRowTools = options.editable && (options.collection || options.kind === "unit" || (options.blockId && options.kind !== "unit"));
  return `
    <div class="table-wrap">
      <table class="data-table ${options.editable ? "editable-table" : ""}">
        <thead>
          <tr class="sheet-coordinate-row">
            <th class="sheet-corner" scope="col" aria-label="행 번호"></th>
            ${visibleColumns.map(colIndex => `<th class="sheet-column-index" scope="col">${escapeHtml(tableColumnLabel(colIndex))}</th>`).join("")}
            ${hasRowTools ? `<th class="row-tools sheet-action-corner" scope="col">작업</th>` : ""}
          </tr>
        </thead>
        <tbody>
          ${view.rows.map(({ row, sourceIndex, isHeader }) => `
            <tr class="${isHeader ? "sheet-header-row" : ""}">
              <th class="sheet-row-index" scope="row">${sourceIndex + 1}</th>
              ${visibleColumns.map(colIndex => {
                if (!options.editable) return `<td>${renderTableCellContent(row[colIndex] || "", { rows: normalized, formulas: true })}</td>`;
                if (options.kind === "unit") {
                  return renderEditableTableCell(row[colIndex] || "", { kind: "unit", blockId: options.blockId, unitId: options.unitId, row: sourceIndex, col: colIndex });
                }
                return options.collection
                  ? renderEditableTableCell(row[colIndex] || "", { kind: "collection", row: sourceIndex, col: colIndex })
                  : renderEditableTableCell(row[colIndex] || "", { kind: "table", blockId: options.blockId, row: sourceIndex, col: colIndex });
              }).join("")}
              ${options.editable && options.collection ? `<td class="row-tools"><button class="danger" type="button" data-action="delete-collection-row" data-row="${sourceIndex}">삭제</button></td>` : ""}
              ${options.editable && options.kind === "unit" ? `<td class="row-tools"><button class="danger" type="button" data-action="delete-unit-table-row" data-block-id="${escapeHtml(options.blockId)}" data-unit-id="${escapeHtml(options.unitId)}" data-row="${sourceIndex}">삭제</button></td>` : ""}
              ${options.editable && options.blockId && options.kind !== "unit" ? `<td class="row-tools"><button class="danger" type="button" data-action="delete-table-row" data-block-id="${escapeHtml(options.blockId)}" data-row="${sourceIndex}">삭제</button></td>` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function normalizeTableRows(rows = []) {
  const normalized = (rows.length ? rows : [[""]]).map(row => Array.isArray(row) ? [...row] : [String(row ?? "")]);
  const width = tableWidth(normalized);
  return normalized.map(row => Array.from({ length: width }, (_, index) => String(row[index] ?? "")));
}

function tableWidth(rows = []) {
  return Math.max(1, ...rows.map(row => Array.isArray(row) ? row.length : 1));
}

function detectTableHeaderIndex(rows = []) {
  const index = rows.findIndex(row => row.filter(cell => String(cell ?? "").trim()).length >= 2);
  return index >= 0 ? index : 0;
}

function tableViewRows(rows = [], source = {}) {
  const normalized = normalizeTableRows(rows);
  const headerIndex = detectTableHeaderIndex(normalized);
  const query = searchable(source.filter || "");
  const pinned = normalized.slice(0, headerIndex + 1).map((row, index) => ({
    row,
    sourceIndex: index,
    isHeader: index === headerIndex
  }));
  let body = normalized.slice(headerIndex + 1).map((row, index) => ({
    row,
    sourceIndex: headerIndex + 1 + index,
    isHeader: false
  }));
  if (query) {
    body = body.filter(item => searchable(item.row.join(" ")).includes(query));
  }
  const sortColumn = Number(source.sortColumn);
  if (Number.isInteger(sortColumn) && sortColumn >= 0) {
    const dir = source.sortDir === "desc" ? -1 : 1;
    body.sort((a, b) => compareTableCells(a.row[sortColumn], b.row[sortColumn]) * dir);
  }
  return { rows: [...pinned, ...body], headerIndex };
}

function compareTableCells(a, b) {
  const an = Number(String(a ?? "").replace(/,/g, ""));
  const bn = Number(String(b ?? "").replace(/,/g, ""));
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return String(a ?? "").localeCompare(String(b ?? ""), "ko-KR", { numeric: true });
}

function tableColumnLabel(index) {
  let value = Number(index) + 1;
  let label = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    label = String.fromCharCode(65 + mod) + label;
    value = Math.floor((value - mod) / 26);
  }
  return label || "A";
}

function renderEditableTableCell(value, target = {}) {
  const attrs = tableCellEditAttrs(target);
  const buttonAttrs = tableCellImageButtonAttrs(target);
  return `
    <td class="resizable-table-cell">
      <div class="table-cell-editor" contenteditable="true" ${attrs}>${escapeHtml(value || "")}</div>
      ${renderTableCellPreview(value)}
      <button class="cell-image-button" type="button" data-action="insert-table-cell-image" ${buttonAttrs}>이미지</button>
      <span class="table-resize-handle" data-table-resize-handle aria-hidden="true"></span>
    </td>
  `;
}

function tableCellEditAttrs(target = {}) {
  const row = Number(target.row);
  const col = Number(target.col);
  if (target.kind === "collection") return `data-collection-cell="1" data-row="${row}" data-col="${col}"`;
  if (target.kind === "unit") {
    return `data-unit-table-cell="1" data-block-id="${escapeHtml(target.blockId)}" data-unit-id="${escapeHtml(target.unitId)}" data-row="${row}" data-col="${col}"`;
  }
  return `data-table-cell="1" data-block-id="${escapeHtml(target.blockId)}" data-row="${row}" data-col="${col}"`;
}

function tableCellImageButtonAttrs(target = {}) {
  return [
    `data-cell-kind="${escapeHtml(target.kind || "table")}"`,
    target.blockId ? `data-block-id="${escapeHtml(target.blockId)}"` : "",
    target.unitId ? `data-unit-id="${escapeHtml(target.unitId)}"` : "",
    `data-row="${Number(target.row)}"`,
    `data-col="${Number(target.col)}"`
  ].filter(Boolean).join(" ");
}

function renderTableCellPreview(value) {
  const content = renderTableCellContent(value, { previewOnlyImages: true });
  return content ? `<div class="table-cell-preview">${content}</div>` : "";
}

function renderTableCellContent(value, options = {}) {
  const source = String(value || "");
  if (options.formulas && source.trim().startsWith("=")) {
    const result = evaluateTableFormula(source, options.rows || []);
    return `<span class="formula-result" title="${escapeHtml(source)}">${escapeHtml(result)}</span>`;
  }
  const matcher = /\[\[image:([^\]|]+)(?:\|([^\]]*))?\]\]/g;
  let cursor = 0;
  let match = null;
  const parts = [];
  while ((match = matcher.exec(source)) !== null) {
    if (!options.previewOnlyImages && match.index > cursor) {
      parts.push(`<span>${escapeHtml(source.slice(cursor, match.index)).replace(/\n/g, "<br>")}</span>`);
    }
    const ref = String(match[1] || "").trim();
    const caption = String(match[2] || "").trim() || ref;
    const src = tableCellImageSrc(ref);
    if (src) {
      parts.push(`<figure class="table-cell-image"><img src="${escapeHtml(src)}" alt="${escapeHtml(caption)}" loading="lazy"><figcaption>${escapeHtml(caption)}</figcaption></figure>`);
    } else if (!options.previewOnlyImages) {
      parts.push(`<span>${escapeHtml(match[0])}</span>`);
    }
    cursor = matcher.lastIndex;
  }
  if (!options.previewOnlyImages && cursor < source.length) {
    parts.push(`<span>${escapeHtml(source.slice(cursor)).replace(/\n/g, "<br>")}</span>`);
  }
  return parts.join("");
}

function parseTableCellRef(ref) {
  const match = String(ref || "").toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  const col = [...match[1]].reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const row = Number(match[2]) - 1;
  return { row, col };
}

function numericTableCellValue(rows, row, col, visited = new Set()) {
  const key = `${row}:${col}`;
  if (visited.has(key)) return 0;
  visited.add(key);
  const value = rows[row]?.[col] ?? "";
  if (String(value).trim().startsWith("=")) return Number(evaluateTableFormula(String(value), rows, visited)) || 0;
  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function tableRangeValues(rangeRef, rows, visited) {
  const [startRef, endRef] = String(rangeRef).split(":");
  const start = parseTableCellRef(startRef);
  const end = parseTableCellRef(endRef || startRef);
  if (!start || !end) return [];
  const values = [];
  const rowStart = Math.min(start.row, end.row);
  const rowEnd = Math.max(start.row, end.row);
  const colStart = Math.min(start.col, end.col);
  const colEnd = Math.max(start.col, end.col);
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      values.push(numericTableCellValue(rows, row, col, visited));
    }
  }
  return values;
}

function applyTableFormulaFunctions(expression, rows, visited) {
  return expression.replace(/\b(SUM|AVERAGE|AVG|MIN|MAX|COUNT)\(([^()]*)\)/gi, (_, fn, argText) => {
    const values = argText.split(",").flatMap(part => tableRangeValues(part.trim(), rows, visited));
    if (!values.length) return "0";
    const name = fn.toUpperCase();
    if (name === "SUM") return String(values.reduce((sum, value) => sum + value, 0));
    if (name === "AVERAGE" || name === "AVG") return String(values.reduce((sum, value) => sum + value, 0) / values.length);
    if (name === "MIN") return String(Math.min(...values));
    if (name === "MAX") return String(Math.max(...values));
    if (name === "COUNT") return String(values.filter(value => Number.isFinite(value)).length);
    return "0";
  });
}

function evaluateTableFormula(value, rows = [], visited = new Set()) {
  const source = String(value || "").trim();
  if (!source.startsWith("=")) return source;
  const normalizedRows = normalizeTableRows(rows);
  let expression = source.slice(1).replace(/\s+/g, "");
  expression = applyTableFormulaFunctions(expression, normalizedRows, visited);
  expression = expression.replace(/\b[A-Z]+\d+\b/gi, ref => {
    const cell = parseTableCellRef(ref);
    return cell ? String(numericTableCellValue(normalizedRows, cell.row, cell.col, visited)) : "0";
  });
  if (!/^[0-9+\-*/().,\s]+$/.test(expression)) return "#VALUE!";
  try {
    const result = Function(`"use strict"; return (${expression});`)();
    if (!Number.isFinite(result)) return "#VALUE!";
    return Number.isInteger(result) ? String(result) : String(Number(result.toFixed(4)));
  } catch (_) {
    return "#VALUE!";
  }
}

function tableCellImageSrc(ref) {
  const media = archive.mediaById?.[ref] || archive.media?.find?.(item => item.id === ref);
  return inlineMediaSrc(ref, media);
}

function inlineMediaSrc(ref = "", media = null) {
  const source = media?.url || ref;
  if (!source) return "";
  if (media?.url) return safeMediaPath(source);
  if (isCompleteMediaPath(source) || looksLikeMediaPath(source) || archive.mediaBasePath) {
    return safeMediaPath(source);
  }
  return "";
}

function looksLikeMediaPath(value = "") {
  return /[\\/]/.test(String(value || "")) || /\.[a-z0-9]{2,8}(?:[?#].*)?$/i.test(String(value || ""));
}

function categoryBars() {
  const counts = categoryCounts();
  const max = Math.max(1, ...Object.values(counts));
  return archive.categories
    .filter(category => (counts[category.id] || 0) > 0)
    .map(category => {
      const count = counts[category.id] || 0;
      const width = Math.max(4, Math.round((count / max) * 100));
      return `
        <div class="bar-row tone-${escapeHtml(category.id)}">
          <span>${escapeHtml(category.label)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
          <strong>${count}</strong>
        </div>
      `;
    }).join("");
}

function stat(label, value) {
  return `
    <div class="stat">
      <span>${escapeHtml(label)}</span>
      <strong>${Number(value).toLocaleString("ko-KR")}</strong>
    </div>
  `;
}

function blockLabel(type) {
  return {
    heading: "제목",
    paragraph: "문단",
    callout: "강조",
    quote: "인용",
    list: "목록",
    checklist: "체크리스트",
    code: "코드",
    divider: "구분선",
    table: "표",
    dataset: "데이터",
    flow: "플로우",
    mermaid: "Mermaid",
    drawing: "그림판",
    generic: "블록 묶음",
    media: "미디어",
    video: "동영상",
    attachment: "첨부",
    dialogue: "대화",
    calendar: "달력",
    team: "팀원",
    workboard: "업무 관리",
    meetingbook: "회의록"
  }[type] || "블록";
}

function empty(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function downloadSummary() {
  const totals = currentTotals();
  const lines = [
    `# ${archive.title}`,
    "",
    archive.subtitle,
    "",
    "## 기본 사양",
    ...archive.keyFacts.map(fact => `- ${fact.label}: ${fact.value}`),
    "",
    "## 정리 통계",
    `- 문서: ${totals.documents}`,
    `- 표 데이터: ${totals.collections}`,
    `- 검토 필요 문서: ${totals.reviewDocuments}`,
    `- 보류/휴지통 문서: ${totals.legacyDocuments}`,
    `- 웹 번들 미디어: ${totals.bundledMedia}`,
    "",
    "## 우선 읽기",
    ...archive.priorityDocs.map(ref => {
      const doc = docsById.get(ref.id) || ref;
      return `- ${doc.title} (${doc.categoryLabel})`;
    })
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "eodum-cheonggangdan-archive-summary.md";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("정리 보고서를 내려받았습니다.");
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

function searchable(value = "") {
  return String(value).toLocaleLowerCase("ko-KR");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function focusWorkspace() {
  requestAnimationFrame(() => els.workspace.focus({ preventScroll: true }));
}

function jumpToOutlineTarget(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.classList.remove("outline-flash");
  requestAnimationFrame(() => target.classList.add("outline-flash"));
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(els.toast._timer);
  els.toast._timer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}
