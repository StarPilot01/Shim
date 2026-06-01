function termTitle(keyword) {
  return `키워드: ${keyword}`;
}

function findTerm(keyword) {
  return state.glossary.find(term => term.keyword === keyword || (term.aliases || []).includes(keyword));
}

function findTermPageTab(term) {
  if (!term) return null;
  return state.tabs.find(tab => tab.id === term.pageTabId)
    || state.tabs.find(tab => tab.termKeyword === term.keyword)
    || null;
}

function migrateLegacyTermPage(term) {
  const legacyTab = findTermPageTab(term);
  if (!legacyTab) return;
  const descriptionBlock = legacyTab.blocks?.find(block => block.role === "term-description");
  if (descriptionBlock?.content && !term.description) term.description = descriptionBlock.content;
  term.pageTabId = "";
}

function upsertTerm(keyword, description) {
  const cleanKeyword = String(keyword || "").trim();
  const cleanDescription = String(description || "").trim() || "설명을 입력하세요.";
  if (!cleanKeyword) return null;
  let term = findTerm(cleanKeyword);
  if (term) {
    term.keyword = term.keyword || cleanKeyword;
    term.description = cleanDescription;
  } else {
    term = {
      id: uid("term"),
      keyword: cleanKeyword,
      aliases: [],
      category: "기획",
      description: cleanDescription,
      pageTabId: ""
    };
    state.glossary.push(term);
  }
  migrateLegacyTermPage(term);
  return term;
}

function updateWikiField(field, value) {
  const term = currentWikiTerm();
  if (!term) return;
  if (field === "keyword") {
    const keyword = String(value || "").trim();
    if (!keyword) return;
    term.keyword = keyword;
    currentWikiKeyword = keyword;
  }
  if (field === "description") {
    term.description = String(value || "").trim() || "설명을 입력하세요.";
  }
}

function openTermPage(keyword) {
  const cleanKeyword = String(keyword || "").trim();
  if (!cleanKeyword) return;
  const term = findTerm(cleanKeyword);
  if (term) {
    currentView = "wiki";
    currentWikiKeyword = term.keyword;
    closeTermPanel();
    render();
    return;
  }
  if (!isEditing) {
    openTermPanel(cleanKeyword);
    return;
  }
  showCustomModal({
    title: "새 키워드 설명",
    placeholder: "설명을 입력하세요.",
    defaultValue: `${cleanKeyword}에 대한 설명을 입력하세요.`,
    onConfirm: (description) => {
      CommandManager.execute(`키워드 생성: ${cleanKeyword}`, () => {
        const created = upsertTerm(cleanKeyword, description);
        currentView = "wiki";
        currentWikiKeyword = created.keyword;
      });
      closeTermPanel();
      toast("새 키워드 페이지를 만들었습니다.");
    }
  });
}

function openWikiHome() {
  currentView = "wiki";
  currentWikiKeyword = "";
  closeTermPanel();
  render();
}

function selectionHostBlock() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode) return null;
  const anchor = selection.anchorNode.nodeType === Node.ELEMENT_NODE
    ? selection.anchorNode
    : selection.anchorNode.parentElement;
  const article = anchor?.closest?.("[data-block-id]");
  if (!article) return null;
  const block = findBlockById(article.dataset.blockId);
  if (!block || !["heading", "text", "callout", "quote"].includes(block.type)) return null;
  return { block, article };
}

function captureTextSelection() {
  if (!isEditing) return null;
  const selection = window.getSelection();
  const host = selectionHostBlock();
  const rawText = selection?.toString() || "";
  const text = rawText.replace(/\s+/g, " ").trim();
  if (!host || !text || text.length > 80) return null;
  return { text, rawText: rawText.trim(), blockId: host.block.id };
}

function rememberTextSelection() {
  const captured = captureTextSelection();
  if (captured) lastTextSelection = captured;
  return captured;
}

function cleanWikiLinkTarget(value) {
  return String(value || "")
    .trim()
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .replace(/[\[\]\n]/g, "")
    .trim();
}

function makeWikiLinkText(keyword, label = "") {
  const target = cleanWikiLinkTarget(keyword);
  let cleanLabel = String(label || "")
    .trim()
    .replace(/\]\]/g, "")
    .replace(/\|/g, "/");
  if (/^\[\[.*\]\]$/.test(String(label || "").trim())) {
    cleanLabel = cleanWikiLinkTarget(label);
  }
  if (!target) return "";
  if (cleanLabel && cleanLabel !== target) return `[[${target}|${cleanLabel}]]`;
  return `[[${target}]]`;
}

function replaceSelectedTextWithWikiLink(selected, keyword) {
  const block = findBlockById(selected?.blockId || "");
  if (!block || typeof block.content !== "string") return false;
  const linkText = makeWikiLinkText(keyword, selected.text);
  if (!linkText) return false;
  const candidates = [...new Set([selected.rawText, selected.text]
    .map(value => String(value || "").trim())
    .filter(Boolean))];
  for (const candidate of candidates) {
    const index = block.content.indexOf(candidate);
    if (index === -1) continue;
    block.content = `${block.content.slice(0, index)}${linkText}${block.content.slice(index + candidate.length)}`;
    return true;
  }
  return false;
}

function createKeywordFromSelection(blockId = "") {
  if (!isEditing) return;
  const selected = rememberTextSelection() || lastTextSelection;
  if (!selected || (blockId && selected.blockId !== blockId)) {
    toast("본문에서 키워드로 만들 글자를 먼저 드래그해 선택하세요.");
    return;
  }
  const keyword = cleanWikiLinkTarget(selected.text);
  if (!keyword) {
    toast("키워드로 만들 글자를 다시 선택하세요.");
    return;
  }
  const existing = findTerm(keyword);
  showCustomModal({
    title: existing ? "키워드 설명 수정" : "새 키워드 설명",
    placeholder: "설명을 입력하세요.",
    defaultValue: existing?.description || `${keyword}에 대한 설명을 입력하세요.`,
    onConfirm: (description) => {
      CommandManager.execute(`선택 키워드 등록: ${keyword}`, () => {
        const term = upsertTerm(keyword, description);
        if (term) replaceSelectedTextWithWikiLink(selected, term.keyword);
      });
      lastTextSelection = null;
      toast("선택한 글자를 [[키워드]] 링크로 바꿨습니다.");
    }
  });
}

function openTermPanel(keyword = "") {
  els.termPanel.classList.remove("hidden");
  els.termSearch.value = keyword;
  renderTermResults(keyword);
  requestAnimationFrame(() => els.termSearch.focus());
}

function closeTermPanel() {
  els.termPanel.classList.add("hidden");
}

function renderTermResults(query = "") {
  const q = String(query || "").trim().toLowerCase();
  const terms = state.glossary
    .filter(term => !q || term.keyword.toLowerCase().includes(q) || term.description.toLowerCase().includes(q) || (term.aliases || []).some(alias => alias.toLowerCase().includes(q)))
    .sort((a, b) => a.keyword.localeCompare(b.keyword, "ko"));
  if (!terms.length) {
    els.termResults.innerHTML = `<div class="empty">검색 결과가 없습니다.</div>`;
    return;
  }
  els.termResults.innerHTML = terms.map(term => `
    <article class="term-card">
      <strong>${escapeHtml(term.keyword)}</strong>
      ${term.aliases?.length ? `<small>별칭: ${escapeHtml(term.aliases.join(", "))}</small>` : ""}
      <p>${escapeHtml(term.description)}</p>
      <div class="term-card-actions">
        <button class="term-open" data-term-open="${escapeHtml(term.keyword)}">키워드 페이지 열기</button>
      </div>
    </article>
  `).join("");
}

function saveTermFromForm() {
  if (!isEditing) return;
  const keyword = els.termKeyword.value.trim();
  const description = els.termDescription.value.trim();
  if (!keyword || !description) {
    toast("키워드와 설명을 모두 입력하세요.");
    return;
  }
  CommandManager.execute(`용어 저장: ${keyword}`, () => {
    const term = upsertTerm(keyword, description);
    currentView = "wiki";
    currentWikiKeyword = term.keyword;
  });
  els.termKeyword.value = "";
  els.termDescription.value = "";
  renderTermResults(keyword);
  toast("용어를 저장했습니다.");
}
