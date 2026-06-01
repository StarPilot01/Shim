const STORAGE_KEY = "shimroom-plan-tool-state-v1";
const CURRENT_SCHEMA_VERSION = 3;
const DEFAULT_APP_TITLE = "쉼표의 방 통합 기획서 툴";
const LEGACY_OUTING_TERM = "\uc678\ucd9c";
let state = loadState();
let currentTabId = state.tabs[0]?.id || "";
let isEditing = false;
let searchQuery = "";
let currentView = "document";
let currentWikiKeyword = "";
let saveTimer = null;
let lastFocusedBlockId = "";
let lastFocusedTableCell = { blockId: "", row: -1, col: -1, type: "" };

const BLOCK_DEFINITIONS = Object.freeze({
  generic: { label: "블록", create: () => ({ items: [createContentUnit("text")] }) },
  heading: { label: "제목", create: () => ({ content: "새 제목" }) },
  text: { label: "텍스트", create: () => ({ content: "새 텍스트" }) },
  callout: { label: "강조", create: () => ({ content: "강조할 내용" }) },
  quote: { label: "인용", create: () => ({ content: "인용하거나 참고할 문장을 입력하세요." }) },
  checklist: { label: "체크리스트", create: () => ({ items: [{ text: "확인할 항목", checked: false }] }) },
  code: { label: "코드", create: () => ({ language: "text", content: "메모 또는 스크립트를 입력하세요." }) },
  divider: { label: "구분선", create: () => ({ label: "" }) },
  table: { label: "엑셀표", create: () => ({ rows: [["항목", "내용"], ["", ""]] }) },
  flow: { label: "플로우", create: () => ({ content: "시작 -> 행동 -> 변화" }) },
  mermaid: { label: "Mermaid", create: () => ({ content: defaultMermaid() }) },
  image: { label: "이미지", create: () => ({ caption: "캡션", path: "", assetId: "", imageWidth: 100 }) },
  video: { label: "동영상", create: () => ({ caption: "동영상 설명", path: "", assetId: "" }) },
  attachment: { label: "파일/글", create: () => ({ caption: "첨부 설명", path: "", assetId: "" }) },
  dialogue: { label: "대화", create: () => ({ title: "쉼청이와 대화하기", dialogueSheet: "대화노드", stageSheet: "온기단계", warmthStage: "1", currentNodeId: "", history: [] }) },
  calendar: { label: "달력", create: () => ({ title: "프로젝트 달력", sheet: "프로젝트달력", month: currentMonthKey() }) },
  team: { label: "팀원", create: () => ({ title: "팀원 목록", sheet: "팀원목록" }) },
  workboard: { label: "업무 관리", create: () => ({ title: "업무 관리", taskSheet: "업무목록", teamSheet: "팀원목록" }) },
  meetingbook: { label: "회의록", create: () => ({ title: "회의록", sheet: "회의록", teamSheet: "팀원목록", defaultWeekday: "월요일", defaultTime: "22:00" }) },
  dataset: { label: "데이터", create: () => ({ sheet: Object.keys(state.datasets)[0] || "" }) }
});

function createContentUnit(type = "text") {
  const unit = { id: uid("unit"), type };
  const definition = BLOCK_DEFINITIONS[type];
  return { ...unit, ...(definition?.create?.() || { content: "" }) };
}

function normalizeTextAlign(value) {
  return ["left", "center", "right"].includes(value) ? value : "left";
}

function normalizeHeadingLevel(value, type = "text") {
  if (value === undefined || value === null || value === "") return type === "heading" ? 1 : 0;
  const numeric = Number(value);
  return [0, 1, 2, 3].includes(numeric) ? numeric : (type === "heading" ? 1 : 0);
}

function headingLevelFor(target = {}) {
  if (target.headingLevel !== undefined) return normalizeHeadingLevel(target.headingLevel, target.type);
  if (typeof target.showInSubtabs === "boolean") return target.showInSubtabs ? 1 : 0;
  return target.type === "heading" ? 1 : 0;
}

function isHeadingLike(target = {}) {
  return headingLevelFor(target) > 0;
}

const PARAGRAPH_FONT_SIZES = Object.freeze([12, 14, 16, 18, 20, 24, 28]);
const TEXT_COLOR_SWATCHES = Object.freeze(["#202522", "#a33f36", "#2f6f5e", "#2b5d8c", "#7a4f9a"]);
const HIGHLIGHT_COLOR_SWATCHES = Object.freeze(["#fff3bf", "#dff3e7", "#dcecf8", "#f8dfda", "#ece4f6"]);

function defaultFontSizeForTarget(target = {}) {
  const level = headingLevelFor(target);
  if (level === 1) return 28;
  if (level === 2) return 24;
  if (level === 3) return 20;
  return 16;
}

function normalizeFontSize(value, fallback = 16) {
  const numeric = Number(value);
  return PARAGRAPH_FONT_SIZES.includes(numeric) ? numeric : fallback;
}

function normalizeImageWidth(value, fallback = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(20, Math.min(100, Math.round(numeric / 5) * 5));
}

function paragraphFontSize(target = {}) {
  return normalizeFontSize(target.fontSize, defaultFontSizeForTarget(target));
}

function normalizeRichColor(value, fallback = "#202522") {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
}

function isSubtabEnabled(item) {
  return isHeadingLike(item);
}

const els = {
  tabList: document.getElementById("tabList"),
  wikiHome: document.getElementById("wikiHome"),
  wikiCount: document.getElementById("wikiCount"),
  wikiKeywordList: document.getElementById("wikiKeywordList"),
  blocks: document.getElementById("blocks"),
  appTitle: document.getElementById("appTitle"),
  title: document.getElementById("projectTitle"),
  subtitle: document.getElementById("projectSubtitle"),
  meta: document.getElementById("projectMeta"),
  activeTabSummary: document.getElementById("activeTabSummary"),
  docSearch: document.getElementById("docSearch"),
  imageBasePath: document.getElementById("imageBasePath"),
  termKeyword: document.getElementById("termKeyword"),
  termDescription: document.getElementById("termDescription"),
  termPanel: document.getElementById("termPanel"),
  termSearch: document.getElementById("termSearch"),
  termResults: document.getElementById("termResults"),
  imageFilePicker: document.getElementById("imageFilePicker"),
  mediaFilePicker: document.getElementById("mediaFilePicker"),
  tableFilePicker: document.getElementById("tableFilePicker"),
  versionPanel: document.getElementById("versionPanel"),
  versionList: document.getElementById("versionList"),
  versionDiff: document.getElementById("versionDiff"),
  versionSummary: document.getElementById("versionSummary"),
  versionBaseSelect: document.getElementById("versionBaseSelect"),
  versionTargetSelect: document.getElementById("versionTargetSelect"),
  datasetSelect: document.getElementById("datasetSelect"),
  modeToggle: document.getElementById("modeToggle"),
  modeBadge: document.getElementById("modeBadge"),
  undoCommand: document.getElementById("undoCommand"),
  redoCommand: document.getElementById("redoCommand"),
  deleteDatasetSheet: document.getElementById("deleteDatasetSheet"),
  saveStatus: document.getElementById("saveStatus"),
  sideStatus: document.getElementById("sideStatus"),
  toast: document.getElementById("toast"),
  floatingToolbar: document.getElementById("floatingToolbar"),
  slashPalette: document.getElementById("slashPalette")
};

const dragState = {
  blockId: "",
  overBlockId: "",
  placement: "",
  handleBlockId: "",
  pendingBlockId: "",
  pointerX: 0,
  pointerY: 0,
  pointerId: null,
  manualDrag: false
};

let lastTextSelection = null;
let pendingImageInsert = null;
let pendingTableImport = null;
const imagePreviewUrls = new Map();

function loadState() {
  const embedded = readEmbeddedState();
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return normalizeState(applyCurrentPlanningMigrations(replaceLegacyPlanningTerms(mergeEmbeddedUpdates(JSON.parse(saved), embedded)), embedded));
    } catch (err) {
      console.warn("Saved state is invalid.", err);
    }
  }
  return normalizeState(applyCurrentPlanningMigrations(replaceLegacyPlanningTerms(embedded), embedded));
}

function readEmbeddedState() {
  if (window.SHIMROOM_PROJECT_DATA) return structuredClone(window.SHIMROOM_PROJECT_DATA);
  const embedded = document.getElementById("project-data");
  return embedded ? JSON.parse(embedded.textContent) : { tabs: [], datasets: {}, glossary: [] };
}

function mergeEmbeddedUpdates(saved, embedded) {
  const next = saved && typeof saved === "object" ? structuredClone(saved) : {};
  const embeddedTabs = Array.isArray(embedded?.tabs) ? embedded.tabs : [];
  next.tabs = Array.isArray(next.tabs) ? next.tabs : [];

  const tabIds = new Set(next.tabs.map(tab => tab?.id).filter(Boolean));
  embeddedTabs.forEach((tab, embeddedIndex) => {
    if (!tab?.id || tabIds.has(tab.id)) return;
    const previousEmbeddedIds = embeddedTabs.slice(0, embeddedIndex).map(item => item?.id).filter(Boolean).reverse();
    const previousIndex = previousEmbeddedIds
      .map(id => next.tabs.findIndex(existing => existing?.id === id))
      .find(index => index >= 0);
    const insertAt = previousIndex === undefined ? next.tabs.length : previousIndex + 1;
    next.tabs.splice(insertAt, 0, structuredClone(tab));
    tabIds.add(tab.id);
  });

  repairForeignEmbeddedTabBlocks(next.tabs, embeddedTabs);

  if (embedded?.datasets && typeof embedded.datasets === "object") {
    next.datasets = next.datasets && typeof next.datasets === "object" ? next.datasets : {};
    Object.entries(embedded.datasets).forEach(([name, rows]) => {
      if (!(name in next.datasets)) {
        next.datasets[name] = structuredClone(rows);
      } else if (name === "대화노드") {
        mergeDatasetBlankCellsById(next.datasets[name], rows);
      }
    });
  }

  if (Array.isArray(embedded?.glossary)) {
    next.glossary = Array.isArray(next.glossary) ? next.glossary : [];
    const keywords = new Set(next.glossary.map(term => term?.keyword).filter(Boolean));
    embedded.glossary.forEach(term => {
      if (!term?.keyword || keywords.has(term.keyword)) return;
      next.glossary.push(structuredClone(term));
      keywords.add(term.keyword);
    });
  }

  return next;
}

function repairForeignEmbeddedTabBlocks(savedTabs, embeddedTabs) {
  if (!Array.isArray(savedTabs) || !Array.isArray(embeddedTabs)) return;
  const embeddedByTabId = new Map(embeddedTabs.filter(tab => tab?.id).map(tab => [tab.id, tab]));
  const embeddedBlockOwner = new Map();
  embeddedTabs.forEach(tab => {
    (tab.blocks || []).forEach(block => {
      if (block?.id) embeddedBlockOwner.set(block.id, tab.id);
    });
  });

  savedTabs.forEach(savedTab => {
    const embeddedTab = embeddedByTabId.get(savedTab?.id);
    if (!embeddedTab || !Array.isArray(savedTab.blocks) || !Array.isArray(embeddedTab.blocks) || !embeddedTab.blocks.length) return;
    const savedBlockIds = savedTab.blocks.map(block => block?.id).filter(Boolean);
    if (!savedBlockIds.length) return;
    const ownEmbeddedBlockIds = new Set(embeddedTab.blocks.map(block => block?.id).filter(Boolean));
    const ownBlockCount = savedBlockIds.filter(id => ownEmbeddedBlockIds.has(id)).length;
    if (ownBlockCount > 0) return;
    const foreignBlockCount = savedBlockIds.filter(id => embeddedBlockOwner.has(id) && embeddedBlockOwner.get(id) !== savedTab.id).length;
    if (foreignBlockCount < Math.ceil(savedBlockIds.length * 0.6)) return;
    savedTab.blocks = structuredClone(embeddedTab.blocks);
    if (!String(savedTab.subtitle || "").trim() && embeddedTab.subtitle) savedTab.subtitle = embeddedTab.subtitle;
  });
}

function mergeDatasetBlankCellsById(savedRows, embeddedRows) {
  if (!Array.isArray(savedRows) || !Array.isArray(embeddedRows)) return;
  const embeddedHeaderIndex = embeddedRows.findIndex(row => Array.isArray(row) && row.some(cell => /ID$/i.test(String(cell || "").trim())));
  const savedHeaderIndex = savedRows.findIndex(row => Array.isArray(row) && row.some(cell => /ID$/i.test(String(cell || "").trim())));
  if (embeddedHeaderIndex < 0 || savedHeaderIndex < 0) return;
  const embeddedHeader = embeddedRows[embeddedHeaderIndex].map(cell => String(cell || "").trim());
  const savedHeader = savedRows[savedHeaderIndex].map(cell => String(cell || "").trim());
  const embeddedIdIndex = embeddedHeader.findIndex(cell => /ID$/i.test(cell));
  const savedIdIndex = savedHeader.findIndex(cell => /ID$/i.test(cell));
  if (embeddedIdIndex < 0 || savedIdIndex < 0) return;
  const savedById = new Map();
  savedRows.slice(savedHeaderIndex + 1).forEach(row => {
    const id = String(row?.[savedIdIndex] || "").trim();
    if (id) savedById.set(id, row);
  });
  embeddedRows.slice(embeddedHeaderIndex + 1).forEach(embeddedRow => {
    const id = String(embeddedRow?.[embeddedIdIndex] || "").trim();
    if (!id) return;
    const savedRow = savedById.get(id);
    if (!savedRow) {
      savedRows.push(structuredClone(embeddedRow));
      return;
    }
    embeddedHeader.forEach((columnName, embeddedIndex) => {
      const savedIndex = savedHeader.indexOf(columnName);
      if (savedIndex < 0) return;
      const savedValue = String(savedRow[savedIndex] ?? "").trim();
      const embeddedValue = String(embeddedRow[embeddedIndex] ?? "").trim();
      if (!savedValue && embeddedValue) savedRow[savedIndex] = embeddedRow[embeddedIndex];
    });
  });
}

function replaceLegacyPlanningTerms(value) {
  const oldTerm = "\ub8e8\ud2f4";
  const newTerm = "오늘의 한걸음";
  if (typeof value === "string") return value.split(oldTerm).join(newTerm);
  if (Array.isArray(value)) return value.map(replaceLegacyPlanningTerms);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.split(oldTerm).join(newTerm),
    replaceLegacyPlanningTerms(item)
  ]));
}

function applyCurrentPlanningMigrations(value, embedded = null) {
  if (!value || typeof value !== "object") return value;
  const next = structuredClone(value);
  replaceKnownPlanningPhrases(next);
  syncPlanningTabFromEmbedded(next, embedded, "one-step-diary-summary");
  syncPlanningTabFromEmbedded(next, embedded, "phone-system", { requiredText: "게임 중인가?" });
  migratePlanningDatasets(next.datasets);
  migratePlanningGlossary(next.glossary);
  return next;
}

function syncPlanningTabFromEmbedded(stateLike, embedded, tabId, options = {}) {
  const sourceTab = embedded?.tabs?.find?.(tab => tab?.id === tabId);
  if (!sourceTab || !Array.isArray(sourceTab.blocks)) return;
  stateLike.tabs = Array.isArray(stateLike.tabs) ? stateLike.tabs : [];
  const targetTab = stateLike.tabs.find(tab => tab?.id === tabId);
  const sourceClone = structuredClone(sourceTab);
  if (!targetTab) {
    stateLike.tabs.push(sourceClone);
    return;
  }
  if (options.requiredBlockId || options.requiredText) {
    const hasRequiredBlock = targetTab.blocks?.some?.(block => block?.id === options.requiredBlockId);
    const hasRequiredText = options.requiredText ? JSON.stringify(targetTab.blocks || []).includes(options.requiredText) : true;
    if ((!options.requiredBlockId || hasRequiredBlock) && hasRequiredText) return;
    targetTab.title = sourceClone.title;
    targetTab.subtitle = sourceClone.subtitle;
    targetTab.blocks = sourceClone.blocks;
    return;
  }
  const hasOldSplitBlocks = targetTab.blocks?.some?.(block => /^b-one-step-diary-\d+$/.test(String(block?.id || "")));
  const hasCanonicalMixedBlock = targetTab.blocks?.some?.(block =>
    block?.type === "generic" &&
    Array.isArray(block.items) &&
    block.items.some(unit => unit?.id === "u-one-step-table")
  );
  if (!hasOldSplitBlocks && hasCanonicalMixedBlock) return;
  targetTab.title = sourceClone.title;
  targetTab.subtitle = sourceClone.subtitle;
  targetTab.blocks = sourceClone.blocks;
}

function replaceKnownPlanningPhrases(target) {
  const replacements = [
    [`정리, 대화, 오늘의 한걸음, ${LEGACY_OUTING_TERM}`, "정리, 대화, 오늘의 한걸음, 일기"],
    [`정리·대화·오늘의 한걸음·${LEGACY_OUTING_TERM}`, "정리·대화·오늘의 한걸음·일기"],
    [`재화, 오늘의 한걸음, 방 꾸미기, 대화, 단어 수집, ${LEGACY_OUTING_TERM}`, "재화, 오늘의 한걸음, 방 꾸미기, 대화, 단어 수집, 일기"],
    [`방 꾸미기·오늘의 한걸음 해금·${LEGACY_OUTING_TERM} 준비`, "방 꾸미기·오늘의 한걸음 해금·일기 후보 축적"],
    [`상호작용·대화·오늘의 한걸음·${LEGACY_OUTING_TERM}`, "상호작용·대화·오늘의 한걸음"],
    ["창문 열기 / 물 마시기", "물 마시기"],
    ["스트레칭 / 창문 열기 / 물 마시기", "스트레칭 / 물 마시기"],
    [`${LEGACY_OUTING_TERM} / 일기 / 요리 해금`, "요리하기 / 일기 후보 확장"],
    [`${LEGACY_OUTING_TERM} / 일기 쓰기 / 요리하기 / 단어 ‘웃다’`, "요리하기 / 일기 후보 확장 / 단어 ‘웃다’"],
    [`${LEGACY_OUTING_TERM} 가능 여부`, "엔딩 진입 가능 여부"],
    ["오늘의 한걸음 5개 3단계 달성", "오늘의 한걸음 핵심 조건 달성"],
    [`첫 ${LEGACY_OUTING_TERM} 완료`, "핵심 단어 조건 충족"],
    [`첫 ${LEGACY_OUTING_TERM} 용기 10`, "-"],
    [`${LEGACY_OUTING_TERM}은 후반부에 해금되는 진행 전환 콘텐츠로, 닫힌 방 밖으로 한 걸음 나가는 사건이어야 한다.`, "방 밖으로 나가는 사건은 일반 기능이 아니라 엔딩에서만 발생한다."],
    [`${LEGACY_OUTING_TERM}은 닫힌 방 밖으로 나가는 첫걸음이다.`, "엔딩은 닫힌 방 밖으로 나가는 첫걸음이다."]
  ];

  const visit = item => {
    if (typeof item === "string") {
      return replacements.reduce((text, [from, to]) => text.split(from).join(to), item);
    }
    if (Array.isArray(item)) {
      item.forEach((child, index) => {
        item[index] = visit(child);
      });
      return item;
    }
    if (item && typeof item === "object") {
      Object.keys(item).forEach(key => {
        item[key] = visit(item[key]);
      });
    }
    return item;
  };

  visit(target);
}

function migratePlanningDatasets(datasets) {
  if (!datasets || typeof datasets !== "object") return;

  const removedOneStepNames = new Set(["창문 열기", "일기 쓰기", "짧은 산책"]);

  updateDatasetRowByValue(datasets["온기단계"], 0, "2", row => {
    row[6] = "일기 시스템 / 단어 '안녕'";
  });
  updateDatasetRowByValue(datasets["온기단계"], 0, "3", row => {
    row[6] = "오늘의 한걸음 시스템 / 창가 고양이 / 스트레칭 / 물 마시기 / 단어 ‘좋아’";
  });
  updateDatasetRowByValue(datasets["온기단계"], 0, "5", row => {
    row[2] = "자기 이야기와 생활 회복이 열리는 단계";
    row[6] = "요리하기 / 일기 후보 확장 / 단어 ‘웃다’";
    row[12] = "요리하기 해금 조건 상세 수치 미정";
  });

  updateDatasetRowByValue(datasets["승급조건"], 0, "4", row => {
    row[10] = "요리하기와 일기 후보 확장 단계로 진입";
  });
  updateDatasetRowByValue(datasets["승급조건"], 0, "5", row => {
    row[6] = "핵심 단어 조건 충족";
    row[7] = "오늘의 한걸음 핵심 조건 달성";
    row[9] = "-";
  });

  if (Array.isArray(datasets["오늘의 한걸음"])) {
    datasets["오늘의 한걸음"] = datasets["오늘의 한걸음"].filter(row => !removedOneStepNames.has(String(row?.[1] || "").trim()));
    const header = datasets["오늘의 한걸음"].find(row => Array.isArray(row) && row[0] === "RoutineID");
    if (header) header[0] = "StepID";
  }

  if (Array.isArray(datasets["해금매트릭스"])) {
    datasets["해금매트릭스"] = datasets["해금매트릭스"].filter(row => {
      const category = String(row?.[0] || "").trim();
      const name = String(row?.[1] || "").trim();
      if (category === "오늘의 한걸음" && removedOneStepNames.has(name)) return false;
      if (category === "생활/성장" && name === LEGACY_OUTING_TERM) return false;
      return true;
    });
    upsertDatasetRow(datasets["해금매트릭스"], 0, 1, ["일기", "일기 시스템", "-", "해금", "유지", "유지", "유지", "유지", "확정", "후보가 있을 때만 버튼 활성화"]);
    upsertDatasetRow(datasets["해금매트릭스"], 0, 1, ["일기", "꿈조각", "-", "-", "-", "준비", "상점", "유지", "확정", "놓친 일기 소재를 꿈으로 회상하는 소모품"]);
    upsertDatasetRow(datasets["해금매트릭스"], 0, 1, ["생활/성장", "엔딩의 방 밖으로 나가기", "-", "-", "-", "-", "준비", "가능", "확정", "일반 플레이 기능이 아니라 엔딩 사건"]);
  }

  updateDatasetRowByValue(datasets["단어"], 1, "바람", row => {
    row[3] = "커튼/창밖 변화 첫 확인";
    row[4] = "창밖 공기가 느껴지면";
    row[5] = "스미다";
    row[6] = "방 변화";
  });
  updateDatasetRowByValue(datasets["단어"], 1, "배고파", row => {
    row[3] = "요리하기 첫 수행";
    row[5] = "물들다 이후";
    row[6] = "오늘의 한걸음/요리";
  });
  updateDatasetRowByValue(datasets["단어"], 1, "무서워", row => {
    row[3] = "마지막 특별 대화에서 방 밖으로 나가기로 결심";
    row[4] = "문 앞에 서면";
    row[5] = "나아가다";
    row[6] = "엔딩";
  });
  updateDatasetRowByValue(datasets["단어"], 1, "나", row => {
    row[3] = "첫 일기 기록";
    row[4] = "자기 이야기를 기록하면";
    row[5] = "서리다 이후";
    row[6] = "일기";
  });

  updateDatasetRowByValue(datasets["경제성"], 0, "쉼멈 일기 특별 회차", row => {
    row[0] = "일기 기록";
    row[1] = "0";
    row[2] = "0";
    row[3] = "조건부";
    row[4] = "일기는 재화 보상을 주지 않고 단어/해금 기록과 연결";
  });
  updateDatasetRowByValue(datasets["경제성"], 0, "오늘의 한걸음 (3~4회 수행)", row => {
    row[1] = "170";
    row[2] = "28";
    row[4] = "스트레칭, 물 마시기, 음악 듣기, 요리하기 기준 초안";
  });
  updateDatasetRowByValue(datasets["경제성"], 0, "일일 합계", row => {
    row[1] = "7890";
    row[2] = "215";
  });

  updateDatasetRowByValue(datasets["대화슬롯"], 2, "오늘의 한걸음", row => {
    if (row[1] === "3") row[11] = "스트레칭 / 물 마시기";
  });
  updateDatasetRowByValue(datasets["대화슬롯"], 11, "물들다 진입", row => {
    row[12] = "요리하기 / 일기 후보 확장";
  });
  updateDatasetRowByValue(datasets["대화슬롯"], 2, "일기 쓰기", row => {
    row[2] = "일기 기록";
    row[11] = "조건 후보가 있을 때 일기 버튼 사용";
  });
}

function upsertDatasetRow(rows, categoryIndex, nameIndex, row) {
  if (!Array.isArray(rows)) return;
  const existing = rows.find(item =>
    String(item?.[categoryIndex] || "").trim() === row[categoryIndex] &&
    String(item?.[nameIndex] || "").trim() === row[nameIndex]
  );
  if (existing) {
    row.forEach((value, index) => {
      existing[index] = value;
    });
    return;
  }
  rows.push(structuredClone(row));
}

function updateDatasetRowByValue(rows, columnIndex, value, updater) {
  if (!Array.isArray(rows)) return;
  rows.forEach(row => {
    if (String(row?.[columnIndex] || "").trim() === value) updater(row);
  });
}

function migratePlanningGlossary(glossary) {
  if (!Array.isArray(glossary)) return;
  glossary.forEach(term => {
    if (!term || typeof term !== "object") return;
    if (term.keyword === LEGACY_OUTING_TERM) {
      term.keyword = "방 밖으로 나가는 엔딩";
      term.description = "일반 플레이 기능이 아니라, 엔딩에서만 발생하는 방 밖으로 나가는 사건이다.";
    }
  });
}

function normalizeState(input) {
  const next = structuredClone(input);
  next.tabs = Array.isArray(next.tabs) ? next.tabs : [];
  next.appTitle = String(next.appTitle ?? DEFAULT_APP_TITLE).trim() || DEFAULT_APP_TITLE;
  next.datasets = next.datasets && typeof next.datasets === "object" ? next.datasets : {};
  next.imageBasePath ||= "";
  next.assets = normalizeAssets(Array.isArray(next.assets) ? next.assets : []);
  next.glossary = normalizeGlossary(Array.isArray(next.glossary) ? next.glossary : defaultGlossary());
  next.versions = normalizeVersions(Array.isArray(next.versions) ? next.versions : [], next);
  next.schemaVersion = CURRENT_SCHEMA_VERSION;
  next.tabs.forEach(tab => {
    tab.id ||= uid("tab");
    tab.title ||= "새 탭";
    tab.parentId = String(tab.parentId || "");
    tab.subtitle = String(tab.subtitle ?? "");
    tab.blocks = Array.isArray(tab.blocks) ? tab.blocks : [];
    tab.blocks.forEach(block => {
      block.id ||= uid("block");
      normalizeBlock(block);
    });
  });
  ensureUniqueTabIds(next.tabs);
  normalizeTabParents(next.tabs);
  return next;
}

function ensureUniqueTabIds(tabs) {
  const used = new Set();
  tabs.forEach(tab => {
    const baseId = String(tab.id || uid("tab")).trim() || uid("tab");
    let id = baseId;
    let suffix = 2;
    while (used.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    tab.id = id;
    used.add(id);
  });
}

function normalizeTabParents(tabs) {
  const ids = new Set(tabs.filter(tab => !isWikiLegacyTab(tab)).map(tab => tab.id));
  tabs.forEach(tab => {
    if (!ids.has(tab.parentId) || tab.parentId === tab.id) tab.parentId = "";
  });
  tabs.forEach(tab => {
    const seen = new Set([tab.id]);
    let parentId = tab.parentId;
    while (parentId) {
      if (seen.has(parentId)) {
        tab.parentId = "";
        break;
      }
      seen.add(parentId);
      parentId = tabs.find(item => item.id === parentId)?.parentId || "";
    }
  });
}

function normalizeBlock(block) {
  if (!block || typeof block !== "object") return;
  if (block.type === "generic") {
    block.items = Array.isArray(block.items) && block.items.length
      ? block.items
      : [createContentUnit("text")];
    block.items.forEach(normalizeContentUnit);
  }
  if (block.type === "checklist") {
    block.items = Array.isArray(block.items) ? block.items : [{ text: block.content || "확인할 항목", checked: false }];
    block.items = block.items.map(item => ({
      id: item.id || uid("check"),
      text: String(item.text ?? ""),
      checked: Boolean(item.checked)
    }));
  }
  if (["image", "video", "attachment"].includes(block.type)) {
    block.assetId ||= "";
    block.path ||= "";
    block.caption ||= block.type === "image" ? "캡션" : "";
  }
  if (block.type === "image") {
    block.imageWidth = normalizeImageWidth(block.imageWidth);
  }
  if (["table", "dataset"].includes(block.type)) {
    block.filter ||= "";
    block.sortColumn = Number.isInteger(block.sortColumn) ? block.sortColumn : -1;
    block.sortDir = block.sortDir === "desc" ? "desc" : "asc";
  }
  if (block.type === "dialogue") {
    block.title ||= "쉼청이와 대화하기";
    block.dialogueSheet ||= "대화노드";
    block.stageSheet ||= "온기단계";
    block.warmthStage = String(block.warmthStage || "1");
    block.currentNodeId = String(block.currentNodeId || "");
    block.history = Array.isArray(block.history)
      ? block.history.map(item => String(item || "")).filter(Boolean).slice(-20)
      : [];
  }
  if (block.type === "calendar") {
    block.title ||= "프로젝트 달력";
    block.sheet ||= "프로젝트달력";
    block.month = normalizeMonthKey(block.month);
  }
  if (block.type === "team") {
    block.title ||= "팀원 목록";
    block.sheet ||= "팀원목록";
  }
  if (block.type === "workboard") {
    block.title ||= "업무 관리";
    block.taskSheet ||= "업무목록";
    block.teamSheet ||= "팀원목록";
  }
  if (block.type === "meetingbook") {
    block.title ||= "회의록";
    block.sheet ||= "회의록";
    block.teamSheet ||= "팀원목록";
    block.defaultWeekday ||= "월요일";
    block.defaultTime ||= "22:00";
  }
  if (["heading", "text", "callout", "quote"].includes(block.type)) {
    block.align = normalizeTextAlign(block.align);
    block.headingLevel = normalizeHeadingLevel(block.headingLevel, block.type);
    if (block.fontSize !== undefined) {
      block.fontSize = normalizeFontSize(block.fontSize, defaultFontSizeForTarget(block));
    }
  }
}

function normalizeContentUnit(unit) {
  if (!unit || typeof unit !== "object") return;
  unit.id ||= uid("unit");
  unit.type ||= "text";
  if (unit.type === "checklist") {
    unit.items = Array.isArray(unit.items) ? unit.items : [{ text: unit.content || "확인할 항목", checked: false }];
    unit.items = unit.items.map(item => ({
      id: item.id || uid("check"),
      text: String(item.text ?? ""),
      checked: Boolean(item.checked)
    }));
  }
  if (["image", "video", "attachment"].includes(unit.type)) {
    unit.assetId ||= "";
    unit.path ||= "";
    unit.caption ||= unit.type === "image" ? "캡션" : "";
  }
  if (unit.type === "image") {
    unit.imageWidth = normalizeImageWidth(unit.imageWidth);
  }
  if (["table", "dataset"].includes(unit.type)) {
    unit.filter ||= "";
    unit.sortColumn = Number.isInteger(unit.sortColumn) ? unit.sortColumn : -1;
    unit.sortDir = unit.sortDir === "desc" ? "desc" : "asc";
  }
  if (["heading", "text", "callout", "quote"].includes(unit.type)) {
    unit.align = normalizeTextAlign(unit.align);
    unit.headingLevel = normalizeHeadingLevel(unit.headingLevel, unit.type);
    if (unit.fontSize !== undefined) {
      unit.fontSize = normalizeFontSize(unit.fontSize, defaultFontSizeForTarget(unit));
    }
  }
}

function normalizeAssets(assets) {
  return assets
    .filter(asset => asset && (asset.id || asset.name || asset.dataUrl || asset.text))
    .map(asset => ({
      id: asset.id || uid("asset"),
      name: String(asset.name || "untitled"),
      kind: asset.kind || assetKindFromMime(asset.mime || asset.type || ""),
      mime: asset.mime || asset.type || "application/octet-stream",
      size: Number(asset.size || 0),
      dataUrl: asset.dataUrl || "",
      text: asset.text || "",
      transientUrl: asset.transientUrl || "",
      createdAt: asset.createdAt || new Date().toISOString()
    }));
}

function normalizeVersions(versions, stateForInitial) {
  const normalized = versions
    .filter(version => version && version.state)
    .map(version => ({
      id: version.id || uid("version"),
      name: version.name || "저장 버전",
      createdAt: version.createdAt || new Date().toISOString(),
      note: version.note || "",
      state: cloneStateWithoutVersions(version.state)
    }));
  if (normalized.length) return normalized.slice(-40);
  const initial = cloneStateWithoutVersions(stateForInitial);
  return [{
    id: "version-initial",
    name: "초기 원본",
    createdAt: initial.updatedAt || new Date().toISOString(),
    note: "프로젝트 데이터에서 생성된 기준 버전",
    state: initial
  }];
}

function cloneStateWithoutVersions(source) {
  const clone = structuredClone(source || {});
  delete clone.versions;
  return clone;
}

function assetKindFromMime(mime) {
  const value = String(mime || "").toLowerCase();
  if (value.startsWith("image/")) return "image";
  if (value.startsWith("video/")) return "video";
  if (value.startsWith("text/")) return "text";
  return "file";
}

function normalizeGlossary(glossary) {
  return glossary
    .filter(term => term && term.keyword)
    .map(term => ({
      id: term.id || uid("term"),
      keyword: String(term.keyword).trim(),
      aliases: Array.isArray(term.aliases) ? term.aliases.filter(Boolean).map(String) : [],
      category: term.category || "기획",
      description: term.description || "",
      pageTabId: term.pageTabId || ""
    }))
    .filter(term => term.keyword && term.description);
}

function defaultGlossary() {
  return [
    { keyword: "쉼청이", description: "방 안에 머물며 조금씩 회복해 가는 청년 캐릭터. 플레이어가 바꾸는 대상이 아니라 곁에 머물며 기다려야 하는 존재다." },
    { keyword: "온기 단계", description: "게임 전체 진행 상태를 묶는 중심 축. 청년의 반응, 방의 밝기, 해금 기능, 사운드, 엔딩 진입 가능 여부와 연결된다." },
    { keyword: "온기", description: "대화, 정리, 오늘의 한걸음 같은 능동 상호작용에서 얻는 재화. 관계에서 생기는 따뜻함을 상징한다." },
    { keyword: "여유", description: "시간이 흐르며 천천히 쌓이는 장기 성장 재화. 삶에 생긴 작은 여백과 생활 기반 회복을 의미한다." },
    { keyword: "용기", description: "최초 행동, 단계 상승, 특별 대화처럼 전환점에서 얻는 희소 재화. 새로운 행동을 시작하는 힘을 의미한다." },
    { keyword: "오늘의 한걸음", description: "무너진 하루의 리듬을 다시 만드는 반복 행동 시스템. 보상뿐 아니라 방 변화, 대사, 단어, 엔딩 조건과 연결된다." },
    { keyword: "단어", description: "청년이 자신의 감정에 이름을 붙여 가는 영구 수집 요소. 일기와 특수 기록의 재료가 된다." },
    { keyword: "우울한 포스트잇", description: "청년의 자기비난이나 무기력한 생각을 보여주는 상호작용 오브젝트." },
    { keyword: "희망이", description: "아직 남아 있는 가능성을 상징하는 긍정 오브젝트. 터치 시 온기와 드문 용기 보상을 줄 수 있다." },
    { keyword: "방 밖으로 나가는 엔딩", description: "일반 플레이 기능이 아니라, 엔딩에서만 발생하는 방 밖으로 나가는 사건이다." }
  ];
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function currentMonthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function normalizeMonthKey(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{1}$/.test(raw)) {
    const [year, month] = raw.split("-");
    return `${year}-${month.padStart(2, "0")}`;
  }
  return currentMonthKey();
}

function isWikiLegacyTab(tab) {
  return Boolean(tab?.termKeyword);
}

function documentTabs() {
  return state.tabs.filter(tab => !isWikiLegacyTab(tab));
}

function getCurrentTab() {
  const tabs = documentTabs();
  return tabs.find(tab => tab.id === currentTabId) || tabs[0];
}

function setMode(editing) {
  isEditing = Boolean(editing);
  document.body.classList.toggle("edit-mode", isEditing);
  document.body.classList.toggle("view-mode", !isEditing);
  document.body.classList.toggle("wiki-view", currentView === "wiki");
  els.modeBadge.textContent = isEditing ? "편집 모드" : "보기 모드";
  els.modeToggle.setAttribute("aria-pressed", String(isEditing));
  if (els.appTitle) els.appTitle.readOnly = !isEditing;
  els.title.readOnly = !isEditing;
  els.subtitle.readOnly = !isEditing;
}

function editAttr() {
  return isEditing ? "true" : "false";
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1500);
}

function saveNow() {
  state.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateStatus("저장됨");
  } catch (err) {
    console.error("Save failed.", err);
    updateStatus("저장 실패");
    toast("저장 공간이 부족합니다. 큰 동영상은 파일 경로로 관리하거나 JSON/HTML로 내보내세요.");
  }
}

function updateStatus(prefix = "자동 저장") {
  const d = new Date(state.updatedAt || Date.now());
  els.saveStatus.textContent = `${prefix} · ${d.toLocaleString("ko-KR")}`;
  els.saveStatus.classList.remove("save-flash");
  void els.saveStatus.offsetWidth;
  els.saveStatus.classList.add("save-flash");
  const tabs = documentTabs();
  const blockCount = tabs.reduce((sum, tab) => sum + tab.blocks.length, 0);
  if (els.sideStatus) {
    els.sideStatus.textContent = `문서 탭 ${tabs.length}개 · 블록 ${blockCount}개 · 위키 ${state.glossary.length}개 · 데이터 ${Object.keys(state.datasets).length}개 · 파일 ${state.assets.length}개 · 버전 ${state.versions.length}개`;
  }
}

function createDocumentSnapshot() {
  return {
    state: structuredClone(state),
    currentTabId,
    currentView,
    currentWikiKeyword
  };
}

function snapshotForCompare(snapshot) {
  const copy = structuredClone(snapshot);
  if (copy.state) delete copy.state.updatedAt;
  return copy;
}

function snapshotsEqual(a, b) {
  return JSON.stringify(snapshotForCompare(a)) === JSON.stringify(snapshotForCompare(b));
}

function restoreDocumentSnapshot(snapshot) {
  state = normalizeState(structuredClone(snapshot.state));
  currentView = snapshot.currentView || "document";
  currentWikiKeyword = snapshot.currentWikiKeyword || "";
  currentTabId = snapshot.currentTabId || state.tabs[0]?.id || "";
  if (currentView === "document" && !getCurrentTab() && documentTabs().length) currentTabId = documentTabs()[0].id;
}

function updateCommandButtons() {
  if (!els.undoCommand || !els.redoCommand) return;
  const activeDraft = CommandManager.hasDraft();
  els.undoCommand.disabled = !activeDraft && !CommandManager.canUndo();
  els.redoCommand.disabled = activeDraft || !CommandManager.canRedo();
  els.undoCommand.title = CommandManager.peekUndoLabel()
    ? `되돌리기: ${CommandManager.peekUndoLabel()} (Ctrl+Z)`
    : "되돌리기 (Ctrl+Z)";
  els.redoCommand.title = CommandManager.peekRedoLabel()
    ? `다시 실행: ${CommandManager.peekRedoLabel()} (Ctrl+Y)`
    : "다시 실행 (Ctrl+Y)";
}

const CommandManager = {
  undoStack: [],
  redoStack: [],
  draft: null,
  limit: 80,
  canUndo() {
    return this.undoStack.length > 0;
  },
  canRedo() {
    return this.redoStack.length > 0;
  },
  hasDraft() {
    return Boolean(this.draft);
  },
  peekUndoLabel() {
    return this.draft?.label || this.undoStack.at(-1)?.label || "";
  },
  peekRedoLabel() {
    return this.redoStack.at(-1)?.label || "";
  },
  push(command) {
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  },
  afterChange(options = {}) {
    if (options.save !== false) scheduleSave();
    if (options.render !== false) {
      render();
    } else {
      updateStatus();
      updateCommandButtons();
    }
  },
  execute(label, mutate, options = {}) {
    this.commitDraft({ render: false });
    const before = createDocumentSnapshot();
    const result = mutate();
    const after = createDocumentSnapshot();
    if (snapshotsEqual(before, after)) {
      updateCommandButtons();
      return result;
    }
    this.push({ label, before, after });
    this.afterChange(options);
    return result;
  },
  beginDraft(label, key) {
    if (this.draft?.key === key) return;
    this.commitDraft({ render: false });
    this.draft = { label, key, before: createDocumentSnapshot() };
    updateCommandButtons();
  },
  commitDraft(options = {}) {
    if (!this.draft) return false;
    const draft = this.draft;
    this.draft = null;
    const after = createDocumentSnapshot();
    if (!snapshotsEqual(draft.before, after)) {
      this.push({ label: draft.label, before: draft.before, after });
      this.afterChange(options);
      return true;
    }
    updateCommandButtons();
    return false;
  },
  undo() {
    this.commitDraft({ render: false });
    const command = this.undoStack.pop();
    if (!command) return;
    this.redoStack.push(command);
    restoreDocumentSnapshot(command.before);
    scheduleSave();
    render();
    toast(`되돌렸습니다: ${command.label}`);
  },
  redo() {
    const command = this.redoStack.pop();
    if (!command) return;
    this.undoStack.push(command);
    restoreDocumentSnapshot(command.after);
    scheduleSave();
    render();
    toast(`다시 실행했습니다: ${command.label}`);
  },
  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.draft = null;
    updateCommandButtons();
  }
};

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(els.toast._timer);
  els.toast._timer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeEditable(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseImageLine(line) {
  const custom = String(line).match(/^\s*\[\[image:(.+?)(?:\|([^\]]*))?\]\]\s*$/i);
  if (custom) return { path: custom[1].trim(), caption: (custom[2] || "").trim() };
  const markdown = String(line).match(/^\s*!\[([^\]]*)\]\((.*?)\)\s*$/);
  if (markdown) return { path: markdown[2].trim(), caption: markdown[1].trim() };
  return null;
}

function parseMediaLine(line) {
  const custom = String(line).match(/^\s*\[\[(image|video|file):(.+?)(?:\|([^\]]*))?\]\]\s*$/i);
  if (!custom) return null;
  return { kind: custom[1].toLowerCase(), path: custom[2].trim(), caption: (custom[3] || "").trim() };
}

function normalizeImageSrc(value) {
  let src = String(value || "").trim().replace(/^['"]|['"]$/g, "");
  if (!src) return "";
  if (/^(https?:|data:|blob:|file:)/i.test(src)) return src;
  if (/^\\\\/.test(src)) {
    return encodeURI(`file://${src.replace(/^\\\\/, "").replace(/\\/g, "/")}`);
  }
  if (/^[a-zA-Z]:[\\/]/.test(src)) {
    return encodeURI(`file:///${src.replace(/\\/g, "/")}`);
  }
  return encodeURI(src.replace(/\\/g, "/"));
}

function joinImagePath(base, file) {
  if (!base) return file;
  if (/^(https?:|data:|blob:|file:|\/|\.\/|\.\.\/)/i.test(file) || /^[a-zA-Z]:[\\/]/.test(file) || /^\\\\/.test(file)) {
    return file;
  }
  const separator = base.includes("\\") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/, "")}${separator}${file.replace(/^[\\/]+/, "")}`;
}

function resolveImagePath(path) {
  const raw = String(path || "").trim();
  if (typeof resolveAssetPath === "function" && raw.startsWith("asset:")) return resolveAssetPath(raw);
  return imagePreviewUrls.get(raw) || normalizeImageSrc(joinImagePath(state.imageBasePath || "", raw));
}

function renderPathImage(path, caption = "") {
  const src = resolveImagePath(path);
  const label = caption || path;
  if (!src) return "";
  return `
    <figure class="rich-image">
      <img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" loading="lazy">
      ${label ? `<figcaption>${escapeHtml(label)}</figcaption>` : ""}
    </figure>
  `;
}

function renderInlineMedia(path, caption = "", kind = "file") {
  if (kind === "image") return renderPathImage(path, caption);
  const asset = typeof assetFromPath === "function" ? assetFromPath(path) : null;
  const src = asset ? (asset.dataUrl || asset.transientUrl || "") : normalizeImageSrc(path);
  const label = caption || asset?.name || path;
  if (kind === "video") {
    return `
      <figure class="rich-video">
        ${src ? `<video src="${escapeHtml(src)}" controls preload="metadata"></video>` : `<div class="empty">동영상을 불러올 수 없습니다.</div>`}
        ${label ? `<figcaption>${escapeHtml(label)}</figcaption>` : ""}
      </figure>
    `;
  }
  return `
    <div class="rich-file">
      <strong>${escapeHtml(label)}</strong>
      ${src ? `<a href="${escapeHtml(src)}" download="${escapeHtml(label)}">열기</a>` : ""}
    </div>
  `;
}

function linkTerms(text) {
  const source = String(text || "");
  const pattern = /\[\[([^\]\|\n]+)(?:\|([^\]\n]+))?\]\]/g;
  const reserved = /^(size|align|color|mark|math):/i;
  const matches = [...source.matchAll(pattern)];
  if (!matches.length) return escapeHtml(source);
  let cursor = 0;
  let html = "";
  for (const match of matches) {
    const start = match.index;
    const rawTarget = String(match[1] || "").trim();
    const rawLabel = String(match[2] || "").trim();
    html += escapeHtml(source.slice(cursor, start));
    if (!rawTarget || reserved.test(rawTarget)) {
      html += escapeHtml(match[0]);
    } else {
      const term = typeof findTerm === "function" ? findTerm(rawTarget) : null;
      const keyword = term?.keyword || rawTarget;
      const label = rawLabel || rawTarget;
      html += `<button class="term-link" data-term="${escapeHtml(keyword)}">${escapeHtml(label)}</button>`;
    }
    cursor = start + match[0].length;
  }
  html += escapeHtml(source.slice(cursor));
  return html;
}

function parseMarkdownStyles(html) {
  let res = html;
  res = res.replace(/\[\[size:(12|14|16|18|20|24|28)\|([\s\S]*?)\]\]/g, '<span class="rich-size" style="font-size:$1px">$2</span>');
  res = res.replace(/\[\[align:(left|center|right)\|([\s\S]*?)\]\]/g, '<span class="rich-align rich-align-$1">$2</span>');
  res = res.replace(/\[\[color:(#[0-9a-fA-F]{6})\|([\s\S]*?)\]\]/g, '<span class="rich-color" style="color:$1">$2</span>');
  res = res.replace(/\[\[mark:(#[0-9a-fA-F]{6})\|([\s\S]*?)\]\]/g, '<span class="rich-mark" style="background-color:$1">$2</span>');
  res = res.replace(/\[\[math:([\s\S]*?)\]\]/g, '<span class="rich-formula">$1</span>');
  res = res.replace(/`([^`]+)`/g, '<code class="rich-inline-code">$1</code>');
  res = res.replace(/~~(.*?)~~/g, '<s>$1</s>');
  res = res.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  res = res.replace(/\*(.*?)\*/g, '<em>$1</em>');
  res = res.replace(/__(.*?)__/g, '<u>$1</u>');
  res = res.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" class="rich-link">$1</a>');
  return res;
}

function renderRichContent(content) {
  const lines = String(content || "").split(/\n/);
  return lines.map(line => {
    const media = parseMediaLine(line);
    if (media) return renderInlineMedia(media.path, media.caption, media.kind);
    const image = parseImageLine(line);
    if (image) return renderPathImage(image.path, image.caption);
    if (!line.trim()) return `<div class="rich-spacer"></div>`;
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) return `<div class="rich-heading level-${heading[1].length}">${parseMarkdownStyles(linkTerms(heading[2]))}</div>`;
    const quote = line.match(/^>\s+(.+)$/);
    if (quote) return `<blockquote class="rich-quote-line">${parseMarkdownStyles(linkTerms(quote[1]))}</blockquote>`;
    const checked = line.match(/^\[(x| )\]\s+(.+)$/i);
    if (checked) return `<div class="rich-check-line ${checked[1].toLowerCase() === "x" ? "done" : ""}"><span>${checked[1].toLowerCase() === "x" ? "✓" : ""}</span>${parseMarkdownStyles(linkTerms(checked[2]))}</div>`;
    const numbered = line.match(/^(\d+)\.\s+(.+)$/);
    if (numbered) return `<div class="rich-number-line"><span>${escapeHtml(numbered[1])}.</span>${parseMarkdownStyles(linkTerms(numbered[2]))}</div>`;
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) return `<div class="rich-bullet-line">${parseMarkdownStyles(linkTerms(bullet[1]))}</div>`;
    return `<div class="rich-line">${parseMarkdownStyles(linkTerms(line))}</div>`;
  }).join("");
}

function highlightBlock(blockId, className) {
  requestAnimationFrame(() => {
    const el = document.getElementById(`block-${blockId}`);
    if (!el) return;
    el.classList.remove("block-new", "block-highlight", "block-danger-flash");
    void el.offsetWidth;
    el.classList.add(className || "block-highlight");
    el.addEventListener("animationend", () => el.classList.remove(className || "block-highlight"), { once: true });
  });
}

function fadeInBlocks() {
  els.blocks.classList.remove("blocks-entering");
  void els.blocks.offsetWidth;
  els.blocks.classList.add("blocks-entering");
  els.blocks.addEventListener("animationend", () => els.blocks.classList.remove("blocks-entering"), { once: true });
}
