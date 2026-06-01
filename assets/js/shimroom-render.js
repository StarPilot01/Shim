let editingTabId = "";

function saveSelection() {
  const activeEl = document.activeElement;
  if (!activeEl || !activeEl.hasAttribute('contenteditable')) return null;
  
  const blockEl = activeEl.closest('[data-block-id]');
  const wikiField = activeEl.dataset.wikiField;
  const field = activeEl.dataset.field;
  const tableCell = activeEl.dataset.tableCell;
  const datasetCell = activeEl.dataset.datasetCell;
  
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  
  const range = sel.getRangeAt(0);
  let startOffset = range.startOffset;
  let endOffset = range.endOffset;
  
  return {
    blockId: blockEl ? blockEl.dataset.blockId : null,
    wikiField: wikiField || null,
    field: field || null,
    tableCell: tableCell || null,
    datasetCell: datasetCell || null,
    startOffset,
    endOffset
  };
}

function restoreSelection(saved) {
  if (!saved) return;
  let target = null;
  if (saved.blockId) {
    const blockEl = document.getElementById(`block-${saved.blockId}`);
    if (blockEl) {
      if (saved.tableCell) {
        target = blockEl.querySelector(`[data-table-cell="${saved.tableCell}"]`);
      } else if (saved.datasetCell) {
        target = blockEl.querySelector(`[data-dataset-cell="${saved.datasetCell}"]`);
      } else if (saved.field) {
        target = blockEl.querySelector(`[data-field="${saved.field}"]`);
      }
    }
  } else if (saved.wikiField) {
    target = document.querySelector(`[data-wiki-field="${saved.wikiField}"]`);
  }
  
  if (target) {
    target.focus();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      let textNode = target.firstChild;
      if (!textNode) {
        textNode = document.createTextNode("");
        target.appendChild(textNode);
      }
      
      const len = textNode.nodeType === Node.TEXT_NODE ? textNode.length : 0;
      const start = Math.min(saved.startOffset, len);
      const end = Math.min(saved.endOffset, len);
      
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {
      console.warn("Cursor restore failed", e);
    }
  }
}

function render() {
  if (currentView === "document" && !getCurrentTab() && documentTabs().length) currentTabId = documentTabs()[0].id;
  const savedSel = saveSelection();
  setMode(isEditing);
  renderAppTitle();
  renderProjectHeader();
  renderTabs();
  renderWikiNav();
  renderDatasetSelect();
  renderBlocks();
  renderMermaidBlocks();
  updateStatus();
  updateCommandButtons();
  restoreSelection(savedSel);
}

function renderAppTitle() {
  const title = String(state.appTitle || DEFAULT_APP_TITLE).trim() || DEFAULT_APP_TITLE;
  document.title = title;
  if (els.appTitle && els.appTitle.value !== title) {
    els.appTitle.value = title;
  }
}

function renderProjectHeader() {
  if (currentView === "wiki") {
    const term = currentWikiTerm();
    els.title.value = term ? term.keyword : "쉼청년 위키";
    els.subtitle.value = term
      ? "쉼청년 기획서 안에서 쓰이는 키워드 전용 문서입니다."
      : "본문의 키워드를 가나다순으로 모아두는 위키 인덱스입니다.";
    els.title.readOnly = true;
    els.subtitle.readOnly = true;
    els.imageBasePath.value = state.imageBasePath || "";
    els.meta.innerHTML = "";
    els.activeTabSummary.innerHTML = "";
    return;
  }
  const tab = getCurrentTab();
  els.title.value = tab?.title || "";
  els.subtitle.value = tab?.subtitle || "";
  els.title.readOnly = !isEditing;
  els.subtitle.readOnly = !isEditing;
  els.imageBasePath.value = state.imageBasePath || "";
  els.meta.innerHTML = "";
  els.activeTabSummary.innerHTML = "";
}

function renderActiveTabSummary() {
  els.activeTabSummary.innerHTML = "";
}

function renderTabs() {
  const tabItems = tabTreeItems();
  els.tabList.innerHTML = tabItems.map(({ tab, depth }) => {
    const isActive = currentView === "document" && tab.id === currentTabId;
    const isEditingTab = isEditing && tab.id === editingTabId;
    const canEditTree = isEditing && !searchQuery && !isEditingTab;
    const canDelete = canEditTree && documentTabs().length > tabSubtreeIdSet(tab.id).size;
    const innerContent = isEditingTab
      ? `<input class="tab-title-input" data-tab-rename-input="${escapeHtml(tab.id)}" value="${escapeHtml(tab.title)}" autofocus>`
      : `${escapeHtml(tab.title)}${searchQuery ? `<span class="tab-count">${tab.blocks.filter(matchesSearch).length}</span>` : ""}`;
    const tabControls = canEditTree
      ? `
        <span class="tab-inline-controls">
          <span class="tab-drag-handle" data-tab-drag-handle draggable="true" title="잡고 드래그해서 이동" aria-hidden="true">⋮⋮</span>
          <button class="tab-action-button" type="button" data-tab-edit-id="${escapeHtml(tab.id)}" title="탭 이름 편집" aria-label="${escapeHtml(tab.title)} 탭 이름 편집">
            <svg class="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
            </svg>
          </button>
          <button class="tab-action-button danger" type="button" data-tab-delete-id="${escapeHtml(tab.id)}" title="탭 삭제" aria-label="${escapeHtml(tab.title)} 탭 삭제" ${canDelete ? "" : "disabled"}>
            <svg class="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6h18"></path>
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
            </svg>
          </button>
        </span>
      `
      : "";
    return `
      <div class="tab-row ${isActive ? "active" : ""} ${canEditTree ? "can-drag" : ""}" data-tab-row-id="${escapeHtml(tab.id)}" data-tab-depth="${depth}" style="--tab-depth:${depth}" draggable="false">
        <button class="tab-button ${isActive ? "active" : ""}" data-tab-id="${escapeHtml(tab.id)}">
          ${innerContent}
        </button>
        ${tabControls}
      </div>
      ${isActive ? renderSubtabs(tab, depth) : ""}
    `;
  }).join("");
}

function tabTreeItems() {
  const tabs = documentTabs();
  const childrenByParent = new Map();
  const ids = new Set(tabs.map(tab => tab.id));
  tabs.forEach(tab => {
    const parentId = ids.has(tab.parentId) && tab.parentId !== tab.id ? tab.parentId : "";
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(tab);
  });
  const items = [];
  const seen = new Set();
  const visit = (parentId, depth) => {
    const siblings = childrenByParent.get(parentId) || [];
    siblings.forEach((tab, siblingIndex) => {
      if (seen.has(tab.id)) return;
      seen.add(tab.id);
      items.push({ tab, depth, siblingIndex, siblingCount: siblings.length });
      visit(tab.id, depth + 1);
    });
  };
  visit("", 0);
  tabs.forEach(tab => {
    if (!seen.has(tab.id)) items.push({ tab, depth: 0, siblingIndex: 0, siblingCount: 1 });
  });
  return items;
}

function renderSubtabs(tab, depth = 0) {
  const headings = tab.blocks.flatMap((block, index) => {
    if (isDatasetSectionHeading(tab.blocks, index)) return [];
    if (block.type === "generic") {
      return (block.items || [])
        .filter(unit => isSubtabEnabled(unit))
        .map(unit => ({ id: block.id, title: subtabTitleForUnit(unit), level: headingLevelFor(unit) }))
        .filter(item => item.title);
    }
    if (isHeadingLike(block)) {
      return [{ id: block.id, title: subtabTitleForBlock(block), level: headingLevelFor(block) }];
    }
    return [];
  });
  if (!headings.length) return "";
  return `<div class="subtab-list" style="--tab-depth:${depth}">${headings.map(item => `
    <button class="subtab-button level-${escapeHtml(item.level || 1)}" data-jump-block="${escapeHtml(item.id)}"><span class="subtab-level-label">H${escapeHtml(item.level || 1)}</span>${escapeHtml(item.title)}</button>
  `).join("")}</div>`;
}

function isDatasetBlock(block) {
  return block?.type === "dataset";
}

function isDatasetSectionHeading(blocks, index) {
  const block = blocks[index];
  const next = blocks[index + 1];
  return isHeadingLike(block) && isDatasetBlock(next);
}

function subtabTitleFromContent(value) {
  return String(value || "")
    .replace(/\[\[size:(?:12|14|16|18|20|24|28)\|([\s\S]*?)\]\]/g, "$1")
    .replace(/\[\[math:([\s\S]*?)\]\]/g, "$1")
    .replace(/\[\[(?:image|video|file):(.+?)(?:\|([^\]]*))?\]\]/g, (_match, path, caption) => caption || path)
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/^[#>\-\*\s]+/gm, "")
    .replace(/[*_`]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function subtabTitleForUnit(unit) {
  return subtabTitleFromContent(unit.content || unit.caption || unit.label || unit.sheet) || labelForType(unit.type);
}

function subtabTitleForBlock(block) {
  if (block.type === "generic") {
    const primaryUnit = (block.items || []).find(unit => subtabTitleFromContent(unit.content || unit.caption || unit.label || unit.sheet))
      || (block.items || [])[0];
    if (primaryUnit) return subtabTitleForUnit(primaryUnit);
  }
  return subtabTitleFromContent(block.content || block.caption || block.label || block.sheet) || labelForType(block.type);
}

function sortedTerms() {
  return [...state.glossary].sort((a, b) => a.keyword.localeCompare(b.keyword, "ko"));
}

function currentWikiTerm() {
  return currentWikiKeyword ? findTerm(currentWikiKeyword) : null;
}

function matchesTermSearch(term) {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return true;
  return [
    term.keyword,
    term.category,
    term.description,
    ...(term.aliases || [])
  ].filter(Boolean).join(" ").toLowerCase().includes(q);
}

function renderWikiNav() {
  const terms = sortedTerms();
  if (els.wikiCount) els.wikiCount.textContent = `${terms.length}개`;
  els.wikiHome?.classList.toggle("active", currentView === "wiki" && !currentWikiKeyword);
  if (els.wikiKeywordList) els.wikiKeywordList.innerHTML = "";
}

function blockSearchText(block) {
  if (!block) return "";
  const parts = [block.type, block.title, block.content, block.caption, block.sheet, block.month, block.dialogueSheet, block.stageSheet, block.warmthStage, block.currentNodeId, block.taskSheet, block.teamSheet];
  if (Array.isArray(block.items)) {
    block.items.forEach(unit => {
      parts.push(unit.type, unit.content, unit.caption, unit.sheet);
      if (Array.isArray(unit.rows)) parts.push(unit.rows.flat().join(" "));
      if (unit.type === "dataset" && state.datasets[unit.sheet]) parts.push(state.datasets[unit.sheet].flat().join(" "));
    });
  }
  if (Array.isArray(block.rows)) {
    parts.push(block.rows.flat().join(" "));
  }
  if (block.type === "dataset" && state.datasets[block.sheet]) {
    parts.push(state.datasets[block.sheet].flat().join(" "));
  }
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function matchesSearch(block) {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return true;
  return blockSearchText(block).includes(q);
}

function renderDatasetSelect() {
  if (!els.datasetSelect) return;
  const names = Object.keys(state.datasets);
  els.datasetSelect.innerHTML = names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  if (els.deleteDatasetSheet) els.deleteDatasetSheet.disabled = !names.length;
}

function renderBlocks() {
  if (currentView === "wiki") {
    renderWikiBlocks();
    return;
  }
  const tab = getCurrentTab();
  if (!tab) {
    els.blocks.innerHTML = `<div class="empty">탭을 추가하세요.</div>`;
    return;
  }
  if (!tab.blocks.length) {
    els.blocks.innerHTML = isEditing && !searchQuery
      ? renderEmptyBlockStarter()
      : `<div class="empty">블록을 추가하세요.</div>`;
    return;
  }
  const visibleBlocks = searchQuery ? tab.blocks.filter(matchesSearch) : tab.blocks;
  if (!visibleBlocks.length) {
    els.blocks.innerHTML = `<div class="empty">현재 탭에서 검색 결과가 없습니다.</div>`;
    return;
  }
  if (isEditing && !searchQuery) {
    const pieces = [renderBlockInsertLine(0)];
    visibleBlocks.forEach(block => {
      const globalIndex = tab.blocks.findIndex(item => item.id === block.id);
      pieces.push(renderBlock(block, globalIndex, tab.blocks.length, false));
      pieces.push(renderBlockInsertLine(globalIndex + 1));
    });
    els.blocks.innerHTML = pieces.join("");
    return;
  }
  if (!isEditing && !searchQuery) {
    els.blocks.innerHTML = renderViewBlocksWithDataDrawers(tab, visibleBlocks);
    return;
  }
  els.blocks.innerHTML = visibleBlocks.map(block => {
    const globalIndex = tab.blocks.findIndex(item => item.id === block.id);
    return renderBlock(block, globalIndex, tab.blocks.length, Boolean(searchQuery));
  }).join("");
}

function renderViewBlocksWithDataDrawers(tab, blocks) {
  const pieces = [];
  for (let index = 0; index < blocks.length;) {
    const block = blocks[index];
    if (isDatasetSectionHeading(blocks, index)) {
      const sectionTitle = subtabTitleForBlock(block);
      let datasetIndex = index + 1;
      while (isDatasetBlock(blocks[datasetIndex])) {
        const datasetBlock = blocks[datasetIndex];
        const globalIndex = tab.blocks.findIndex(item => item.id === datasetBlock.id);
        pieces.push(renderDatasetDrawerBlock(datasetBlock, globalIndex, sectionTitle));
        datasetIndex += 1;
      }
      index = datasetIndex;
      continue;
    }
    const globalIndex = tab.blocks.findIndex(item => item.id === block.id);
    pieces.push(isDatasetBlock(block)
      ? renderDatasetDrawerBlock(block, globalIndex)
      : renderBlock(block, globalIndex, tab.blocks.length, false));
    index += 1;
  }
  return pieces.join("");
}

const CONTENT_INSERT_TYPES = ["text", "heading", "callout", "quote", "table", "checklist", "code", "divider", "flow", "mermaid", "image", "video", "attachment"];

function renderBlockInsertLine(insertIndex) {
  return `
    <div class="block-insert-line edit-only" data-insert-index="${insertIndex}">
      <button class="block-insert-btn" type="button" data-block-insert-generic data-insert-index="${insertIndex}" aria-label="빈 블록 추가" title="여기에 빈 블록 추가">+</button>
    </div>
  `;
}

function renderEmptyBlockStarter() {
  return `
    <div class="empty block-empty-starter">
      <div class="block-add-panel-inline">
        <button class="block-add-option" type="button" data-block-insert-generic data-insert-index="0">빈 블록 추가</button>
      </div>
    </div>
  `;
}

function renderWikiBlocks() {
  const term = currentWikiTerm();
  if (currentWikiKeyword && term) {
    els.blocks.innerHTML = renderWikiDetail(term);
    return;
  }
  els.blocks.innerHTML = renderWikiIndex();
}

function wikiTermExcerpt(term) {
  return String(term.description || "").replace(/\s+/g, " ").trim().slice(0, 72);
}

function wikiInitial(keyword) {
  const value = String(keyword || "").trim();
  return value ? value[0].toLocaleUpperCase("ko-KR") : "#";
}

function groupTermsByInitial(terms) {
  return terms.reduce((groups, term) => {
    const initial = wikiInitial(term.keyword);
    if (!groups.has(initial)) groups.set(initial, []);
    groups.get(initial).push(term);
    return groups;
  }, new Map());
}

function renderWikiIndex() {
  const terms = sortedTerms().filter(matchesTermSearch);
  if (!terms.length) {
    return `
      <section class="wiki-page">
        <div class="wiki-toolbar">
          <h2 class="wiki-page-title">쉼청년 위키</h2>
          <span class="wiki-muted">검색 결과 없음</span>
        </div>
        <div class="empty">키워드 검색 결과가 없습니다. 편집 모드에서 본문 글자를 선택한 뒤 # 버튼으로 새 키워드를 만들 수 있습니다.</div>
      </section>
    `;
  }
  const groups = [...groupTermsByInitial(terms).entries()];
  return `
    <section class="wiki-page">
      <div class="wiki-toolbar">
        <h2 class="wiki-page-title">쉼청년 위키</h2>
        <span class="wiki-muted">${terms.length}개 키워드 · 가나다순</span>
      </div>
      <div class="wiki-index-grid">
        ${groups.map(([initial, items]) => `
          <section class="wiki-letter-group">
            <h3 class="wiki-letter">${escapeHtml(initial)}</h3>
            <div class="wiki-term-grid">
              ${items.map(term => `
                <button class="wiki-term-card" data-wiki-term="${escapeHtml(term.keyword)}">
                  <strong>${escapeHtml(term.keyword)}</strong>
                  <small>${escapeHtml(wikiTermExcerpt(term))}</small>
                </button>
              `).join("")}
            </div>
          </section>
        `).join("")}
      </div>
    </section>
  `;
}

function documentMentionsForTerm(term) {
  const aliases = [term.keyword, ...(term.aliases || [])].filter(Boolean);
  const mentions = [];
  documentTabs().forEach(tab => {
    tab.blocks.forEach(block => {
      const text = blockSearchText(block);
      if (aliases.some(alias => text.includes(String(alias).toLowerCase()))) {
        mentions.push({ tabId: tab.id, tabTitle: tab.title, blockId: block.id, type: block.type });
      }
    });
  });
  return mentions;
}

function relatedTermsFor(term) {
  const source = `${term.keyword} ${term.description || ""}`.toLowerCase();
  return sortedTerms()
    .filter(item => item.keyword !== term.keyword)
    .filter(item => source.includes(item.keyword.toLowerCase()) || String(item.description || "").toLowerCase().includes(term.keyword.toLowerCase()))
    .slice(0, 8);
}

function renderWikiDetail(term) {
  const mentions = documentMentionsForTerm(term).slice(0, 12);
  const related = relatedTermsFor(term);
  return `
    <article class="wiki-page">
      <div class="wiki-toolbar">
        <button data-wiki-home>← 쉼청년 위키</button>
        <span class="wiki-muted">키워드 문서</span>
      </div>
      <div class="wiki-layout">
        <main class="wiki-article">
          <h2 class="wiki-page-title editable" contenteditable="${editAttr()}" data-wiki-field="keyword">${escapeEditable(term.keyword)}</h2>
          <section class="wiki-section">
            <h3>개요</h3>
            <div class="wiki-description editable" contenteditable="${editAttr()}" data-wiki-field="description">${escapeEditable(term.description || "설명을 입력하세요.")}</div>
          </section>
          <section class="wiki-section">
            <h3>문서 내 등장 위치</h3>
            ${mentions.length ? `<div class="wiki-link-list">${mentions.map(item => `
              <button data-tab-id="${escapeHtml(item.tabId)}" data-jump-block="${escapeHtml(item.blockId)}">
                ${escapeHtml(item.tabTitle)} · ${escapeHtml(labelForType(item.type))}
              </button>
            `).join("")}</div>` : `<div class="empty">현재 문서 본문에서 직접 연결된 위치가 없습니다.</div>`}
          </section>
          <section class="wiki-section">
            <h3>관련 키워드</h3>
            ${related.length ? `<div class="wiki-link-list">${related.map(item => `
              <button data-wiki-term="${escapeHtml(item.keyword)}">${escapeHtml(item.keyword)}</button>
            `).join("")}</div>` : `<div class="empty">관련 키워드가 아직 없습니다.</div>`}
          </section>
        </main>
        <aside class="wiki-infobox">
          <div class="wiki-info-row"><span>분류</span><strong>${escapeHtml(term.category || "기획")}</strong></div>
          <div class="wiki-info-row"><span>별칭</span><strong>${escapeHtml((term.aliases || []).join(", ") || "-")}</strong></div>
          <div class="wiki-info-row"><span>링크</span><strong>${mentions.length}곳</strong></div>
          <div class="wiki-info-row"><span>정렬</span><strong>${escapeHtml(wikiInitial(term.keyword))}</strong></div>
        </aside>
      </div>
    </article>
  `;
}

function renderBlock(block, index, count, highlighted = false) {
  const canDrag = isEditing && !searchQuery;
  const canKeyword = ["heading", "text", "callout", "quote"].includes(block.type);
  const copyIcon = `
    <svg class="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="10" height="10" rx="2"></rect>
      <path d="M5 15V7a2 2 0 0 1 2-2h8"></path>
    </svg>
  `;
  const trashIcon = `
    <svg class="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18"></path>
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
      <path d="M10 11v6"></path>
      <path d="M14 11v6"></path>
    </svg>
  `;
  const sheetIcon = `
    <svg class="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2"></rect>
      <path d="M3 10h18"></path>
      <path d="M3 15h18"></path>
      <path d="M9 4v16"></path>
      <path d="M15 4v16"></path>
    </svg>
  `;
  return `
    <article class="block ${canDrag ? "can-drag" : ""} ${highlighted ? "search-hit" : ""}" id="block-${escapeHtml(block.id)}" data-block-id="${escapeHtml(block.id)}" draggable="false">
      <div class="block-toolbar">
        <div class="block-meta">
          <button class="icon drag-handle edit-only" data-drag-handle aria-label="블록 드래그 이동" title="${searchQuery ? "검색 중에는 드래그 정렬을 사용할 수 없습니다." : "잡고 드래그해서 이동"}" ${searchQuery ? "disabled" : ""}>⋮⋮</button>
        </div>
        <div class="block-actions">
          ${canKeyword ? `<button class="icon" data-selected-term-create title="선택한 글자를 [[키워드]] 링크로 바꾸기">#</button>` : ""}
          <button class="block-action-pill" data-block-action="add-table" type="button" aria-label="블록 안에 엑셀표 추가" title="엑셀표 추가">${sheetIcon}<span>엑셀표</span></button>
          <button class="icon" data-block-action="duplicate" aria-label="블록 복제" title="복제">${copyIcon}</button>
          <button class="icon danger" data-block-action="delete" aria-label="블록 삭제" title="삭제">${trashIcon}</button>
        </div>
      </div>
      <div class="block-body">${renderBlockBody(block)}</div>
    </article>
  `;
}

function labelForType(type) {
  return BLOCK_DEFINITIONS[type]?.label || type;
}

function renderContentInsertButtons(blockId, insertIndex) {
  return CONTENT_INSERT_TYPES
    .map(type => `<button class="content-insert-option" type="button" data-content-insert-type="${escapeHtml(type)}" data-content-block-id="${escapeHtml(blockId)}" data-content-insert-index="${insertIndex}">${escapeHtml(labelForType(type))}</button>`)
    .join("");
}

function renderContentInsertLine(blockId, insertIndex) {
  return `
    <div class="content-insert-line edit-only">
      <details class="content-insert-menu">
        <summary class="content-insert-btn" aria-label="콘텐츠 추가" title="이 블록 안에 콘텐츠 추가">+</summary>
        <div class="content-insert-panel" role="menu">
          ${renderContentInsertButtons(blockId, insertIndex)}
        </div>
      </details>
    </div>
  `;
}

function alignClass(target) {
  return `align-${normalizeTextAlign(target?.align)}`;
}

function headingLevelClass(target) {
  const level = headingLevelFor(target);
  return level ? `heading-level-${level}` : "";
}

function fontSizeStyle(target) {
  return `font-size:${paragraphFontSize(target)}px`;
}

function renderEditableSizedContent(value, fallback = "") {
  const source = String(value || fallback);
  const pattern = /\[\[(size):(12|14|16|18|20|24|28)\|([\s\S]*?)\]\]|\[\[(align):(left|center|right)\|([\s\S]*?)\]\]|\[\[(color|mark):(#[0-9a-fA-F]{6})\|([\s\S]*?)\]\]/g;
  let cursor = 0;
  let html = "";
  for (const match of source.matchAll(pattern)) {
    html += escapeEditable(source.slice(cursor, match.index));
    const type = match[1] || match[4] || match[7];
    const value = match[2] || match[5] || match[8];
    const inner = match[3] || match[6] || match[9] || "";
    if (type === "size") {
      html += `<span class="rich-size" data-edit-size="${value}" style="font-size:${value}px">${renderEditableSizedContent(inner)}</span>`;
    } else if (type === "align") {
      const align = normalizeTextAlign(value);
      html += `<span class="rich-align rich-align-${align}" data-edit-align="${align}">${renderEditableSizedContent(inner)}</span>`;
    } else if (type === "color") {
      const color = normalizeRichColor(value);
      html += `<span class="rich-color" data-edit-color="${color}" style="color:${color}">${renderEditableSizedContent(inner)}</span>`;
    } else {
      const color = normalizeRichColor(value, "#fff3bf");
      html += `<span class="rich-mark" data-edit-mark="${color}" style="background-color:${color}">${renderEditableSizedContent(inner)}</span>`;
    }
    cursor = match.index + match[0].length;
  }
  html += escapeEditable(source.slice(cursor));
  return html;
}

function renderParagraphTools(target = {}) {
  const currentAlign = normalizeTextAlign(target.align);
  const currentSize = paragraphFontSize(target);
  const currentHeadingLevel = headingLevelFor(target);
  const sizeOptions = PARAGRAPH_FONT_SIZES
    .map(size => `<option value="${size}" ${currentSize === size ? "selected" : ""}>${size}</option>`)
    .join("");
  const headingButtons = [
    { value: 0, label: "본문" },
    { value: 1, label: "H1" },
    { value: 2, label: "H2" },
    { value: 3, label: "H3" }
  ].map(option => `
    <button type="button" class="paragraph-heading-button ${currentHeadingLevel === option.value ? "active" : ""}" data-inline-heading="${option.value}" aria-pressed="${currentHeadingLevel === option.value}" title="${escapeHtml(option.label)}">${option.label}</button>
  `).join("");
  const textColorButtons = TEXT_COLOR_SWATCHES.map(color => `
    <button type="button" class="paragraph-swatch-button" data-inline-color="${color}" aria-label="글자색 ${color}" title="글자색 ${color}">
      <span class="color-swatch" style="background:${color}"></span>
    </button>
  `).join("");
  const highlightButtons = HIGHLIGHT_COLOR_SWATCHES.map(color => `
    <button type="button" class="paragraph-swatch-button" data-inline-mark="${color}" aria-label="배경색 ${color}" title="배경색 ${color}">
      <span class="color-swatch color-swatch-highlight" style="background:${color}"></span>
    </button>
  `).join("");
  const imageIcon = `
    <svg class="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2"></rect>
      <circle cx="8.5" cy="10" r="1.5"></circle>
      <path d="M21 15l-5-5L5 19"></path>
    </svg>
  `;
  const alignIcon = align => {
    const widths = {
      left: [18, 13, 18, 10],
      center: [16, 10, 16, 10],
      right: [18, 13, 18, 10]
    }[align];
    const starts = {
      left: [3, 3, 3, 3],
      center: [4, 7, 4, 7],
      right: [3, 8, 3, 11]
    }[align];
    return `
      <svg class="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M${starts[0]} 6h${widths[0]}"></path>
        <path d="M${starts[1]} 10h${widths[1]}"></path>
        <path d="M${starts[2]} 14h${widths[2]}"></path>
        <path d="M${starts[3]} 18h${widths[3]}"></path>
      </svg>
    `;
  };
  return `
    <div class="paragraph-tools edit-only" aria-label="문단 서식 도구">
      <div class="paragraph-heading-buttons" role="group" aria-label="문단 유형">
        ${headingButtons}
      </div>
      <select class="paragraph-size-select" data-inline-size aria-label="글자 크기">
        ${sizeOptions}
      </select>
      <button type="button" data-inline-format="bold" title="굵게"><b>B</b></button>
      <button type="button" data-inline-format="italic" title="기울임"><i>I</i></button>
      <button type="button" data-inline-format="underline" title="밑줄"><u>U</u></button>
      <button type="button" data-inline-format="strike" title="취소선"><s>S</s></button>
      <button type="button" data-inline-format="code" title="인라인 코드">{ }</button>
      <button type="button" data-inline-format="link" title="링크">Link</button>
      <button type="button" data-inline-format="formula" title="수식">fx</button>
      <div class="paragraph-swatch-group" role="group" aria-label="글자색">
        ${textColorButtons}
      </div>
      <div class="paragraph-swatch-group" role="group" aria-label="배경색">
        ${highlightButtons}
      </div>
      <button type="button" data-inline-format="image" aria-label="이미지 삽입" title="이미지 삽입">${imageIcon}</button>
      <button type="button" data-inline-format="bullet" title="글머리">•</button>
      <button type="button" data-inline-format="ordered" title="번호 목록">1.</button>
      <button type="button" data-inline-format="check" title="체크 항목">☑</button>
      <button type="button" data-inline-clear title="서식 지우기">Tx</button>
      <span class="paragraph-tool-separator" aria-hidden="true"></span>
      <button type="button" class="${currentAlign === "left" ? "active" : ""}" data-inline-align="left" aria-pressed="${currentAlign === "left"}" aria-label="왼쪽 정렬" title="왼쪽 정렬">${alignIcon("left")}</button>
      <button type="button" class="${currentAlign === "center" ? "active" : ""}" data-inline-align="center" aria-pressed="${currentAlign === "center"}" aria-label="가운데 정렬" title="가운데 정렬">${alignIcon("center")}</button>
      <button type="button" class="${currentAlign === "right" ? "active" : ""}" data-inline-align="right" aria-pressed="${currentAlign === "right"}" aria-label="오른쪽 정렬" title="오른쪽 정렬">${alignIcon("right")}</button>
    </div>
  `;
}

function renderEditableParagraph(className, block, fallback, tag = "div") {
  const editable = `<${tag} class="${className} editable ${alignClass(block)} ${headingLevelClass(block)}" contenteditable="${editAttr()}" data-field="content" style="${fontSizeStyle(block)}">${renderEditableSizedContent(block.content, fallback)}</${tag}>`;
  return `${renderParagraphTools(block)}${editable}`;
}

function renderEditableContentUnitParagraph(className, unit, fallback, tag = "div") {
  const editable = `<${tag} class="${className} editable ${alignClass(unit)} ${headingLevelClass(unit)}" contenteditable="${editAttr()}" data-field="content" style="${fontSizeStyle(unit)}">${renderEditableSizedContent(unit.content, fallback)}</${tag}>`;
  return `${renderParagraphTools(unit)}${editable}`;
}

function renderGenericBlockLegacy(block) {
  const units = Array.isArray(block.items) && block.items.length ? block.items : [createContentUnit("text")];
  const trashIcon = `
    <svg class="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18"></path>
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
      <path d="M10 11v6"></path>
      <path d="M14 11v6"></path>
    </svg>
  `;
  const renderUnitDragHandle = unit => unit.type === "image"
    ? `<button class="icon content-unit-drag-handle" type="button" data-content-unit-drag-handle title="이미지 순서 변경" aria-label="이미지 순서 변경">⋮⋮</button>`
    : "";
  const content = [
    renderContentInsertLine(block.id, 0),
    ...units.map((unit, index) => `
      <section class="content-unit content-unit-${escapeHtml(unit.type)} ${isHeadingLike(unit) ? "content-unit-heading" : ""}" data-unit-id="${escapeHtml(unit.id)}">
        <div class="content-unit-body">${renderContentUnitBody(unit)}</div>
        <div class="content-unit-actions edit-only">
          ${renderUnitDragHandle(unit)}
          <button class="icon danger" type="button" data-content-action="delete" title="콘텐츠 삭제" aria-label="콘텐츠 삭제">${trashIcon}</button>
        </div>
      </section>
      ${renderContentInsertLine(block.id, index + 1)}
    `)
  ].join("");
  return `<div class="content-stack">${content}</div>`;
}

function renderGenericBlock(block) {
  const units = Array.isArray(block.items) && block.items.length ? block.items : [createContentUnit("text")];
  const trashIcon = `
    <svg class="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18"></path>
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
      <path d="M10 11v6"></path>
      <path d="M14 11v6"></path>
    </svg>
  `;
  const renderUnitDragHandle = unit =>
    `<button class="icon content-unit-drag-handle" type="button" data-content-unit-drag-handle title="${escapeHtml(labelForType(unit.type))} 순서 변경" aria-label="${escapeHtml(labelForType(unit.type))} 순서 변경">⋮⋮</button>`;
  const content = [
    renderContentInsertLine(block.id, 0),
    ...units.map((unit, index) => `
      <section class="content-unit content-unit-${escapeHtml(unit.type)} ${isHeadingLike(unit) ? "content-unit-heading" : ""}" data-unit-id="${escapeHtml(unit.id)}">
        <div class="content-unit-body">${renderContentUnitBody(unit)}</div>
        <div class="content-unit-actions edit-only">
          ${renderUnitDragHandle(unit)}
          <button class="icon danger" type="button" data-content-action="delete" title="콘텐츠 삭제" aria-label="콘텐츠 삭제">${trashIcon}</button>
        </div>
      </section>
      ${renderContentInsertLine(block.id, index + 1)}
    `)
  ].join("");
  return `<div class="content-stack">${content}</div>`;
}

function renderContentUnitBody(unit) {
  if (unit.type === "heading") {
    return renderEditableContentUnitParagraph("heading-block", unit, "새 제목", "h2");
  }
  if (unit.type === "text") {
    if (isEditing) return renderEditableContentUnitParagraph("text-block", unit, "텍스트를 입력하세요.");
    return `<div class="text-block rich-text ${alignClass(unit)} ${headingLevelClass(unit)}" style="${fontSizeStyle(unit)}">${renderRichContent(unit.content || "")}</div>`;
  }
  if (unit.type === "callout") {
    if (isEditing) return renderEditableContentUnitParagraph("callout", unit, "강조할 내용을 입력하세요.");
    return `<div class="callout rich-text ${alignClass(unit)} ${headingLevelClass(unit)}" style="${fontSizeStyle(unit)}">${renderRichContent(unit.content || "")}</div>`;
  }
  if (unit.type === "quote") {
    if (isEditing) return renderEditableContentUnitParagraph("quote-block", unit, "인용하거나 참고할 문장을 입력하세요.", "blockquote");
    return `<blockquote class="quote-block rich-text ${alignClass(unit)} ${headingLevelClass(unit)}" style="${fontSizeStyle(unit)}">${renderRichContent(unit.content || "")}</blockquote>`;
  }
  if (unit.type === "checklist") return renderChecklistBlock(unit);
  if (unit.type === "code") return renderCodeBlock(unit);
  if (unit.type === "divider") return renderDividerBlock(unit);
  if (unit.type === "image") return renderImageBlock(unit);
  if (unit.type === "video") return renderVideoBlock(unit);
  if (unit.type === "attachment") return renderAttachmentBlock(unit);
  if (unit.type === "flow") {
    return `
      <div class="flow-tools">
        <button data-flow-sample>샘플 추가</button>
      </div>
      <textarea class="flow-editor" data-flow-editor>${escapeHtml(unit.content || "")}</textarea>
      <div class="flow-preview">${renderFlow(unit.content || "")}</div>
    `;
  }
  if (unit.type === "mermaid") {
    return `
      <div class="flow-tools">
        <button data-mermaid-sample>샘플 추가</button>
      </div>
      <textarea class="flow-editor mermaid-editor" data-mermaid-editor>${escapeHtml(unit.content || "")}</textarea>
      <div class="mermaid-stage" data-mermaid-preview data-source="${escapeHtml(unit.content || "")}"></div>
    `;
  }
  if (unit.type === "table") return renderTableBlock(unit);
  if (unit.type === "dataset") return renderDatasetBlock(unit);
  return `<div class="empty">지원하지 않는 콘텐츠입니다.</div>`;
}

function dialogueCell(row, index) {
  return String(row?.[index] ?? "").trim();
}

function dialogueHeaderIndex(rows, headerName) {
  return rows.findIndex(row => row.some(cell => String(cell || "").trim() === headerName));
}

function dialogueStageRows(block) {
  const sheet = block.stageSheet || "온기단계";
  const rows = ensureRows(state.datasets[sheet] || []);
  const headerIndex = dialogueHeaderIndex(rows, "StageID");
  const body = headerIndex >= 0 ? rows.slice(headerIndex + 1) : rows;
  return body
    .filter(row => /^\d+$/.test(dialogueCell(row, 0)))
    .map(row => ({
      id: dialogueCell(row, 0),
      name: dialogueCell(row, 1),
      meaning: dialogueCell(row, 2),
      tone: dialogueCell(row, 5)
    }));
}

function dialogueNodeRows(block) {
  const sheet = block.dialogueSheet || "대화노드";
  const rows = ensureRows(state.datasets[sheet] || []);
  const headerIndex = dialogueHeaderIndex(rows, "NodeID");
  const body = headerIndex >= 0 ? rows.slice(headerIndex + 1) : rows;
  return body.map(row => {
    const choices = [
      { label: dialogueCell(row, 7), nextId: dialogueCell(row, 8) },
      { label: dialogueCell(row, 9), nextId: dialogueCell(row, 10) },
      { label: dialogueCell(row, 11), nextId: dialogueCell(row, 12) }
    ].filter(choice => choice.label);
    return {
      id: dialogueCell(row, 0),
      stageId: dialogueCell(row, 1),
      stageName: dialogueCell(row, 2),
      situation: dialogueCell(row, 3),
      speaker: dialogueCell(row, 4) || "쉼청이",
      line: dialogueCell(row, 5),
      nextId: dialogueCell(row, 6),
      choices,
      memo: dialogueCell(row, 13),
      status: dialogueCell(row, 14)
    };
  }).filter(node => node.id);
}

function dialogueStageMatches(rawStage, stageId) {
  const raw = String(rawStage || "").trim();
  const current = String(stageId || "").trim();
  if (!raw || raw === "공통" || raw === "전체") return true;
  if (raw === current) return true;
  const range = raw.match(/^(\d+)\s*~\s*(\d+)$/);
  if (range) {
    const value = Number(current);
    return value >= Number(range[1]) && value <= Number(range[2]);
  }
  return raw.split(/[,\s/|]+/).includes(current);
}

function dialogueNodesForBlock(block) {
  const stageId = String(block.warmthStage || "1");
  return dialogueNodeRows(block).filter(node => dialogueStageMatches(node.stageId, stageId));
}

function dialogueNodeById(block, nodeId) {
  return dialogueNodeRows(block).find(node => node.id === nodeId) || null;
}

function activeDialogueNode(block) {
  const nodes = dialogueNodesForBlock(block);
  return nodes.find(node => node.id === block.currentNodeId) || nodes[0] || null;
}

function renderDialogueLine(node, isCurrent = false) {
  const isPlayer = node.speaker === "플레이어";
  const lineClass = node.line ? "" : "is-empty";
  return `
    <div class="dialogue-line ${isPlayer ? "player" : "shim"} ${isCurrent ? "current" : ""}">
      <div class="dialogue-speaker">${escapeHtml(node.speaker)}</div>
      <div class="dialogue-bubble ${lineClass}">${node.line ? renderRichContent(node.line) : ""}</div>
    </div>
  `;
}

function renderDialogueChoicePopover(node) {
  const choices = node?.choices || [];
  if (!choices.length) return "";
  return `
    <div class="dialogue-choice-popover" role="dialog" aria-label="대화 선택지">
      ${choices.map(choice => `
        <button class="dialogue-choice" type="button" data-dialogue-next-id="${escapeHtml(choice.nextId)}" ${choice.nextId ? "" : "disabled"}>
          ${escapeHtml(choice.label)}
        </button>
      `).join("")}
    </div>
  `;
}

function renderDialogueRunControls(node, nodes = []) {
  const currentIndex = nodes.findIndex(item => item.id === node?.id);
  const hasPrevious = currentIndex > 0 && nodes.slice(0, currentIndex).some(item => item.line || item.choices?.length);
  const hasNext = currentIndex >= 0 && nodes.slice(currentIndex + 1).some(item => item.line || item.choices?.length);
  return `
    <div class="dialogue-run-controls">
      <button class="dialogue-step" type="button" data-dialogue-step="-1" aria-label="이전 대화" ${hasPrevious ? "" : "disabled"}>‹</button>
      <button class="dialogue-talk" type="button" data-dialogue-talk>대화하기</button>
      <button class="dialogue-step" type="button" data-dialogue-step="1" aria-label="다음 대화" ${hasNext ? "" : "disabled"}>›</button>
    </div>
  `;
}

function renderDialogueStage(node, stageOptions = "", nodes = []) {
  const speaker = node?.speaker || "쉼청이";
  const line = node?.line || "";
  return `
    <div class="dialogue-stage">
      <div class="dialogue-speech">
        <div class="dialogue-speaker">${escapeHtml(speaker)}</div>
        <div class="dialogue-bubble ${line ? "" : "is-empty"}">${line ? renderRichContent(line) : ""}</div>
      </div>
      <div class="dialogue-character" role="img" aria-label="쉼청이 idle"></div>
      <label class="field dialogue-stage-control">온기 단계
        <select data-dialogue-stage>${stageOptions}</select>
      </label>
      ${renderDialogueRunControls(node, nodes)}
      ${renderDialogueChoicePopover(node)}
    </div>
  `;
}

function renderDialogueBlock(block) {
  const stages = dialogueStageRows(block);
  const selectedStage = String(block.warmthStage || stages[0]?.id || "1");
  const stage = stages.find(item => item.id === selectedStage) || stages[0] || { id: selectedStage, name: "" };
  const stageOptions = stages.length
    ? stages.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === selectedStage ? "selected" : ""}>${escapeHtml(`${item.id}. ${item.name || "온기 단계"}`)}</option>`).join("")
    : `<option value="${escapeHtml(selectedStage)}">${escapeHtml(selectedStage)}</option>`;
  const nodes = dialogueNodesForBlock(block);
  const current = activeDialogueNode(block);
  return `
    <section class="dialogue-player" data-dialogue-player>
      <div class="dialogue-head">
        <div>
          <h3>${escapeHtml(block.title || "쉼청이와 대화하기")}</h3>
          <div class="dialogue-stage-chip">${escapeHtml(`${stage.id}. ${stage.name || "온기 단계"}`)}</div>
        </div>
      </div>
      <div class="dialogue-screen">
        ${current ? renderDialogueStage(current, stageOptions, nodes) : `<div class="dialogue-empty-slot"></div>`}
      </div>
      <div class="dialogue-meta">
        <span>${escapeHtml(current?.situation || "대화")}</span>
        <span>${escapeHtml(`${nodes.length}개 노드`)}</span>
      </div>
    </section>
  `;
}

function sheetHeaderIndex(rows, headerName) {
  return rows.findIndex(row => row.some(cell => String(cell || "").trim() === headerName));
}

function calendarHeaderIndex(rows) {
  return sheetHeaderIndex(rows, "날짜");
}

function calendarColumnIndex(header, names, fallback) {
  const index = header.findIndex(cell => names.includes(String(cell || "").trim()));
  return index >= 0 ? index : fallback;
}

function safeHexColor(value, fallback = "#8a948e") {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
}

function teamMemberInitial(name) {
  const value = String(name || "").trim();
  return value ? value[0].toLocaleUpperCase("ko-KR") : "?";
}

function teamMemberRows(sheet = "팀원목록") {
  const rows = ensureRows(state.datasets[sheet] || []);
  const headerIndex = sheetHeaderIndex(rows, "이름");
  if (headerIndex < 0) return [];
  const header = rows[headerIndex].map(cell => String(cell || "").trim());
  const indexes = {
    id: calendarColumnIndex(header, ["팀원ID", "ID"], 0),
    name: calendarColumnIndex(header, ["이름", "팀원"], 1),
    role: calendarColumnIndex(header, ["역할"], 2),
    focus: calendarColumnIndex(header, ["담당분야", "담당 분야"], 3),
    contact: calendarColumnIndex(header, ["연락", "연락처"], 4),
    color: calendarColumnIndex(header, ["색상", "컬러"], 5),
    status: calendarColumnIndex(header, ["상태"], 6),
    memo: calendarColumnIndex(header, ["메모", "비고"], 7)
  };
  return rows.slice(headerIndex + 1)
    .map((row, index) => ({
      id: String(row[indexes.id] || `member-${index}`).trim(),
      name: String(row[indexes.name] || "").trim(),
      role: String(row[indexes.role] || "").trim(),
      focus: String(row[indexes.focus] || "").trim(),
      contact: String(row[indexes.contact] || "").trim(),
      color: safeHexColor(row[indexes.color]),
      status: String(row[indexes.status] || "").trim(),
      memo: String(row[indexes.memo] || "").trim()
    }))
    .filter(member => member.name);
}

function teamMemberMap(sheet = "팀원목록") {
  return teamMemberRows(sheet).reduce((map, member) => {
    map.set(member.name, member);
    return map;
  }, new Map());
}

function splitOwnerNames(owner) {
  return String(owner || "")
    .split(/[,;/|\n]+/)
    .map(name => name.trim())
    .filter(Boolean);
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function compareDateKeys(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

function calendarDateFromKey(key) {
  const [year, month, day] = String(key || "").split("-").map(Number);
  return new Date(year, month - 1, day);
}

function calendarMonthBounds(monthKey) {
  const [year, month] = normalizeMonthKey(monthKey).split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return {
    start,
    end,
    startKey: `${year}-${String(month).padStart(2, "0")}-01`,
    endKey: `${year}-${String(month).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`
  };
}

function calendarEventRows(block) {
  const rows = ensureRows(state.datasets[block.sheet || "프로젝트달력"] || []);
  const headerIndex = calendarHeaderIndex(rows);
  if (headerIndex < 0) return [];
  const header = rows[headerIndex].map(cell => String(cell || "").trim());
  const indexes = {
    id: calendarColumnIndex(header, ["일정ID", "ID"], 0),
    date: calendarColumnIndex(header, ["날짜", "시작일"], 1),
    end: calendarColumnIndex(header, ["종료일", "끝나는 날"], 2),
    title: calendarColumnIndex(header, ["제목", "일정"], 3),
    category: calendarColumnIndex(header, ["분류", "유형"], 4),
    owner: calendarColumnIndex(header, ["담당", "담당자"], 5),
    status: calendarColumnIndex(header, ["상태"], 6),
    note: calendarColumnIndex(header, ["메모", "비고"], 7)
  };
  return rows.slice(headerIndex + 1)
    .map((row, index) => {
      const dateKey = String(row[indexes.date] || "").trim();
      const rawEndKey = String(row[indexes.end] || "").trim();
      if (!isDateKey(dateKey)) return null;
      const endKey = isDateKey(rawEndKey) && compareDateKeys(rawEndKey, dateKey) >= 0 ? rawEndKey : dateKey;
      return {
        id: String(row[indexes.id] || `cal-row-${index}`).trim(),
        dateKey,
        endKey,
        title: String(row[indexes.title] || "").trim() || "(제목 없음)",
        category: String(row[indexes.category] || "일정").trim() || "일정",
        owner: String(row[indexes.owner] || "").trim(),
        status: String(row[indexes.status] || "예정").trim() || "예정",
        note: String(row[indexes.note] || "").trim()
      };
    })
    .filter(Boolean)
    .sort((a, b) => compareDateKeys(a.dateKey, b.dateKey) || a.title.localeCompare(b.title, "ko"));
}

function boundedNumber(value, fallback = 0, min = 0, max = 100) {
  const numeric = Number(String(value ?? "").replace("%", "").trim());
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function taskChecklistItems(value) {
  return String(value || "")
    .split(/[\n|]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const done = /^\[(x|v|완료)\]\s*/i.test(item) || /^완료[:：]\s*/.test(item);
      const text = item
        .replace(/^\[(?:x|v|완료| )\]\s*/i, "")
        .replace(/^완료[:：]\s*/, "")
        .trim();
      return { text: text || item, done };
    });
}

function taskStatusClass(status) {
  const normalized = String(status || "").trim();
  const map = {
    "완료": "done",
    "진행": "active",
    "예정": "planned",
    "검토": "review",
    "지연": "delayed",
    "보류": "hold"
  };
  return map[normalized] || calendarStatusClass(normalized);
}

function taskPriorityClass(priority) {
  const normalized = String(priority || "").trim();
  const map = {
    "높음": "high",
    "보통": "medium",
    "낮음": "low"
  };
  return map[normalized] || "medium";
}

function taskPriorityRank(priority) {
  const map = { high: 0, medium: 1, low: 2 };
  return map[taskPriorityClass(priority)] ?? 1;
}

function isTaskDone(task) {
  return taskStatusClass(task?.status) === "done";
}

function taskSortDate(task) {
  return isDateKey(task?.dueKey) ? task.dueKey : "9999-12-31";
}

function taskRows(sheet = "업무목록") {
  const rows = ensureRows(state.datasets[sheet] || []);
  const headerIndex = sheetHeaderIndex(rows, "업무ID");
  if (headerIndex < 0) return [];
  const header = rows[headerIndex].map(cell => String(cell || "").trim());
  const indexes = {
    id: calendarColumnIndex(header, ["업무ID", "TaskID", "ID"], 0),
    title: calendarColumnIndex(header, ["제목", "업무", "할일"], 1),
    owner: calendarColumnIndex(header, ["담당", "담당자"], 2),
    status: calendarColumnIndex(header, ["상태"], 3),
    priority: calendarColumnIndex(header, ["우선순위", "중요도"], 4),
    start: calendarColumnIndex(header, ["시작일", "시작"], 5),
    due: calendarColumnIndex(header, ["마감일", "마감", "기한"], 6),
    category: calendarColumnIndex(header, ["분류", "유형"], 7),
    project: calendarColumnIndex(header, ["프로젝트", "영역"], 8),
    linkedEventId: calendarColumnIndex(header, ["연결일정ID", "일정ID"], 9),
    progress: calendarColumnIndex(header, ["진행률", "진척도"], 10),
    checklist: calendarColumnIndex(header, ["체크리스트", "세부항목"], 11),
    note: calendarColumnIndex(header, ["메모", "비고"], 12)
  };
  return rows.slice(headerIndex + 1)
    .map((row, index) => {
      const status = String(row[indexes.status] || "예정").trim() || "예정";
      const progressFallback = taskStatusClass(status) === "done" ? 100 : 0;
      const dueKey = String(row[indexes.due] || "").trim();
      const startKey = String(row[indexes.start] || "").trim();
      const title = String(row[indexes.title] || "").trim();
      return {
        id: String(row[indexes.id] || `task-row-${index}`).trim(),
        title: title || "(업무 제목 없음)",
        owner: String(row[indexes.owner] || "").trim(),
        status,
        priority: String(row[indexes.priority] || "보통").trim() || "보통",
        startKey: isDateKey(startKey) ? startKey : "",
        dueKey: isDateKey(dueKey) ? dueKey : "",
        category: String(row[indexes.category] || "").trim(),
        project: String(row[indexes.project] || "").trim(),
        linkedEventId: String(row[indexes.linkedEventId] || "").trim(),
        progress: boundedNumber(row[indexes.progress], progressFallback),
        checklist: taskChecklistItems(row[indexes.checklist]),
        note: String(row[indexes.note] || "").trim()
      };
    })
    .filter(task => task.title)
    .sort((a, b) => {
      if (isTaskDone(a) !== isTaskDone(b)) return isTaskDone(a) ? 1 : -1;
      return compareDateKeys(taskSortDate(a), taskSortDate(b))
        || taskPriorityRank(a.priority) - taskPriorityRank(b.priority)
        || a.title.localeCompare(b.title, "ko");
    });
}

function tasksForOwner(tasks, ownerName) {
  const target = String(ownerName || "").trim();
  if (!target) return [];
  return tasks.filter(task => splitOwnerNames(task.owner).includes(target));
}

function daysBetweenKeys(fromKey, toKey) {
  if (!isDateKey(fromKey) || !isDateKey(toKey)) return 9999;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.round((calendarDateFromKey(toKey) - calendarDateFromKey(fromKey)) / dayMs);
}

function taskDueClass(task, todayKey = currentDateKey()) {
  if (isTaskDone(task)) return "done";
  if (!task.dueKey) return "none";
  const diff = daysBetweenKeys(todayKey, task.dueKey);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 7) return "soon";
  return "normal";
}

function taskDueLabel(task, todayKey = currentDateKey()) {
  if (isTaskDone(task)) return "완료";
  if (!task.dueKey) return "마감 미정";
  const diff = daysBetweenKeys(todayKey, task.dueKey);
  if (diff < 0) return `D+${Math.abs(diff)}`;
  if (diff === 0) return "오늘 마감";
  return `D-${diff}`;
}

function isTaskDueSoon(task, todayKey = currentDateKey()) {
  const dueClass = taskDueClass(task, todayKey);
  return dueClass === "today" || dueClass === "soon" || dueClass === "overdue";
}

function calendarTaskEvents(sheet = "업무목록") {
  return taskRows(sheet)
    .filter(task => task.dueKey)
    .map(task => ({
      id: `task-${task.id}`,
      dateKey: task.dueKey,
      endKey: task.dueKey,
      title: `TODO: ${task.title}`,
      category: "업무",
      owner: task.owner,
      status: task.status,
      note: [task.project, task.category, task.priority, task.note].filter(Boolean).join(" · "),
      source: "task"
    }));
}

function meetingRows(sheet = "회의록") {
  const rows = ensureRows(state.datasets[sheet] || []);
  const headerIndex = sheetHeaderIndex(rows, "회의ID");
  if (headerIndex < 0) return [];
  const header = rows[headerIndex].map(cell => String(cell || "").trim());
  const indexes = {
    id: calendarColumnIndex(header, ["회의ID", "ID"], 0),
    date: calendarColumnIndex(header, ["일자", "날짜"], 1),
    time: calendarColumnIndex(header, ["시간"], 2),
    title: calendarColumnIndex(header, ["회의명", "제목"], 3),
    attendees: calendarColumnIndex(header, ["참석자", "참석"], 4),
    agenda: calendarColumnIndex(header, ["안건"], 5),
    minutes: calendarColumnIndex(header, ["회의록", "내용"], 6),
    decisions: calendarColumnIndex(header, ["결정사항", "결정"], 7),
    actions: calendarColumnIndex(header, ["액션아이템", "후속조치"], 8),
    status: calendarColumnIndex(header, ["상태"], 9),
    created: calendarColumnIndex(header, ["작성일"], 10)
  };
  return rows.slice(headerIndex + 1)
    .map((row, index) => {
      const dateKey = String(row[indexes.date] || "").trim();
      if (!isDateKey(dateKey)) return null;
      return {
        id: String(row[indexes.id] || `meeting-row-${index}`).trim(),
        dateKey,
        time: String(row[indexes.time] || "22:00").trim() || "22:00",
        title: String(row[indexes.title] || "주간 회의").trim() || "주간 회의",
        attendees: String(row[indexes.attendees] || "").trim(),
        agenda: String(row[indexes.agenda] || "").trim(),
        minutes: String(row[indexes.minutes] || "").trim(),
        decisions: String(row[indexes.decisions] || "").trim(),
        actions: String(row[indexes.actions] || "").trim(),
        status: String(row[indexes.status] || "예정").trim() || "예정",
        created: String(row[indexes.created] || "").trim()
      };
    })
    .filter(Boolean)
    .sort((a, b) => compareDateKeys(b.dateKey, a.dateKey) || String(b.time).localeCompare(a.time));
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

function calendarMeetingEvents(sheet = "회의록") {
  return meetingRows(sheet)
    .map(meeting => ({
      id: `meeting-${meeting.id}`,
      dateKey: meeting.dateKey,
      endKey: meeting.dateKey,
      title: `회의: ${meeting.title}`,
      category: "회의",
      owner: meeting.attendees || "팀",
      status: meeting.status,
      note: [meeting.time, meeting.agenda].filter(Boolean).join(" · "),
      source: "meeting"
    }));
}

function calendarEventsForMonth(events, monthKey) {
  const bounds = calendarMonthBounds(monthKey);
  return events.filter(event => compareDateKeys(event.dateKey, bounds.endKey) <= 0 && compareDateKeys(event.endKey, bounds.startKey) >= 0);
}

function calendarDays(monthKey) {
  const bounds = calendarMonthBounds(monthKey);
  const year = bounds.start.getFullYear();
  const month = bounds.start.getMonth();
  const firstDay = bounds.start.getDay();
  const daysInMonth = bounds.end.getDate();
  const totalCells = Math.max(35, Math.ceil((firstDay + daysInMonth) / 7) * 7);
  const todayKey = currentDateKey();
  return Array.from({ length: totalCells }, (_, index) => {
    const dayOffset = index - firstDay + 1;
    const date = new Date(year, month, dayOffset);
    const key = dateKeyFromDate(date);
    return {
      key,
      day: date.getDate(),
      inMonth: date.getMonth() === month,
      isToday: key === todayKey
    };
  });
}

function currentDateKey() {
  return dateKeyFromDate(new Date());
}

function dateKeyFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function calendarMonthLabel(monthKey) {
  const [year, month] = normalizeMonthKey(monthKey).split("-");
  return `${year}년 ${Number(month)}월`;
}

function calendarShiftMonth(monthKey, delta) {
  const [year, month] = normalizeMonthKey(monthKey).split("-").map(Number);
  const date = new Date(year, month - 1 + Number(delta || 0), 1);
  return currentMonthKey(date);
}

function calendarCategoryClass(category) {
  const normalized = String(category || "").trim();
  const map = {
    "기획": "plan",
    "개발": "dev",
    "아트": "art",
    "데이터": "data",
    "회의": "meeting",
    "QA": "qa",
    "배포": "release",
    "업무": "task"
  };
  return map[normalized] || "etc";
}

function calendarStatusClass(status) {
  const normalized = String(status || "").trim();
  const map = {
    "완료": "done",
    "진행": "active",
    "예정": "planned",
    "검토": "review",
    "지연": "delayed",
    "보류": "hold",
    "활성": "active"
  };
  return map[normalized] || "planned";
}

function calendarEventOccursOn(event, dayKey) {
  return compareDateKeys(event.dateKey, dayKey) <= 0 && compareDateKeys(event.endKey, dayKey) >= 0;
}

function renderMemberChips(owner, membersByName = new Map()) {
  const names = splitOwnerNames(owner);
  if (!names.length) return `<span class="member-chip unassigned">미정</span>`;
  return names.map(name => {
    const member = membersByName.get(name);
    const color = member?.color || "#8a948e";
    const detail = [member?.role, member?.status].filter(Boolean).join(" · ");
    return `
      <span class="member-chip" style="--member-color:${escapeHtml(color)}" title="${escapeHtml(detail || name)}">
        <span class="member-dot">${escapeHtml(teamMemberInitial(name))}</span>
        <span>${escapeHtml(name)}</span>
      </span>
    `;
  }).join("");
}

function renderCalendarEvent(event, compact = false, membersByName = new Map()) {
  const categoryClass = calendarCategoryClass(event.category);
  const statusClass = calendarStatusClass(event.status);
  const owner = renderMemberChips(event.owner, membersByName);
  const range = event.endKey !== event.dateKey
    ? `${escapeHtml(event.dateKey.slice(5))}~${escapeHtml(event.endKey.slice(5))}`
    : escapeHtml(event.dateKey.slice(5));
  return `
    <div class="calendar-event category-${categoryClass} status-${statusClass} ${compact ? "compact" : ""}" title="${escapeHtml(event.note || event.title)}">
      <strong>${escapeHtml(event.title)}</strong>
      <small>${range}</small>
      <div class="calendar-owner-row">${owner}</div>
    </div>
  `;
}

function renderCalendarBlock(block) {
  const monthKey = normalizeMonthKey(block.month);
  const taskEvents = calendarTaskEvents(block.taskSheet || "업무목록");
  const meetingEvents = calendarMeetingEvents(block.meetingSheet || "회의록");
  const events = [...calendarEventRows(block), ...taskEvents, ...meetingEvents];
  const membersByName = teamMemberMap("팀원목록");
  const monthEvents = calendarEventsForMonth(events, monthKey);
  const doneCount = monthEvents.filter(event => calendarStatusClass(event.status) === "done").length;
  const activeCount = monthEvents.filter(event => calendarStatusClass(event.status) === "active").length;
  const taskDueCount = monthEvents.filter(event => event.source === "task").length;
  const meetingCount = monthEvents.filter(event => event.source === "meeting").length;
  const days = calendarDays(monthKey);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `
    <section class="project-calendar">
      <div class="calendar-toolbar">
        <div>
          <h3>${escapeHtml(block.title || "프로젝트 달력")}</h3>
          <p>${escapeHtml(block.sheet || "프로젝트달력")} 시트를 기준으로 표시합니다.</p>
        </div>
        <div class="calendar-month-controls">
          <button class="icon" type="button" data-calendar-shift="-1" aria-label="이전 달">‹</button>
          <strong>${escapeHtml(calendarMonthLabel(monthKey))}</strong>
          <button class="icon" type="button" data-calendar-shift="1" aria-label="다음 달">›</button>
          <button type="button" data-calendar-today>이번 달</button>
        </div>
      </div>
      <div class="calendar-summary">
        <span>전체 ${monthEvents.length}개</span>
        <span>진행 ${activeCount}개</span>
        <span>완료 ${doneCount}개</span>
        <span>업무 마감 ${taskDueCount}개</span>
        <span>회의 ${meetingCount}개</span>
      </div>
      <div class="calendar-grid" role="grid" aria-label="${escapeHtml(calendarMonthLabel(monthKey))} 프로젝트 달력">
        ${weekdays.map(day => `<div class="calendar-weekday">${day}</div>`).join("")}
        ${days.map(day => {
          const dayEvents = monthEvents.filter(event => calendarEventOccursOn(event, day.key));
          return `
            <div class="calendar-day ${day.inMonth ? "" : "outside"} ${day.isToday ? "today" : ""}" role="gridcell">
              <div class="calendar-day-number">${day.day}</div>
              <div class="calendar-day-events">
                ${dayEvents.slice(0, 3).map(event => renderCalendarEvent(event, true, membersByName)).join("")}
                ${dayEvents.length > 3 ? `<div class="calendar-more">+${dayEvents.length - 3}</div>` : ""}
              </div>
            </div>
          `;
        }).join("")}
      </div>
      <div class="calendar-agenda">
        <h4>이번 달 일정</h4>
        ${monthEvents.length ? monthEvents.map(event => renderCalendarEvent(event, false, membersByName)).join("") : `<div class="empty">이번 달 일정이 없습니다.</div>`}
      </div>
    </section>
  `;
}

function renderTaskToggleInput(task, sheet = "업무목록") {
  return `
    <input
      class="task-toggle"
      type="checkbox"
      data-task-toggle
      data-task-id="${escapeHtml(task.id)}"
      data-task-sheet="${escapeHtml(sheet)}"
      aria-label="${escapeHtml(task.title)} 완료"
      ${isTaskDone(task) ? "checked" : ""}
    >
  `;
}

function renderTaskChecklist(task, maxItems = 3) {
  if (!task.checklist.length) return "";
  return `
    <ul class="task-checklist">
      ${task.checklist.slice(0, maxItems).map(item => `
        <li class="${item.done ? "done" : ""}">${escapeHtml(item.text)}</li>
      `).join("")}
      ${task.checklist.length > maxItems ? `<li class="more">+${task.checklist.length - maxItems}</li>` : ""}
    </ul>
  `;
}

function renderTodoRow(task, sheet = "업무목록") {
  const statusClass = taskStatusClass(task.status);
  const priorityClass = taskPriorityClass(task.priority);
  const dueClass = taskDueClass(task);
  const meta = [taskDueLabel(task), task.project, task.category, task.priority].filter(Boolean).join(" · ");
  return `
    <label class="todo-row status-${statusClass} priority-${priorityClass} due-${dueClass}">
      ${renderTaskToggleInput(task, sheet)}
      <span class="todo-row-main">
        <strong>${escapeHtml(task.title)}</strong>
        <span>${escapeHtml(meta)}</span>
      </span>
      <span class="todo-progress">${task.progress}%</span>
    </label>
  `;
}

function renderWorkloadCard(member, tasks) {
  const memberTasks = tasksForOwner(tasks, member.name);
  const doneCount = memberTasks.filter(isTaskDone).length;
  const openCount = memberTasks.length - doneCount;
  const dueSoonCount = memberTasks.filter(task => !isTaskDone(task) && isTaskDueSoon(task)).length;
  const avgProgress = memberTasks.length
    ? Math.round(memberTasks.reduce((sum, task) => sum + task.progress, 0) / memberTasks.length)
    : 0;
  return `
    <article class="workload-card" style="--member-color:${escapeHtml(member.color)}">
      <div class="workload-card-head">
        <div class="team-member-avatar small">${escapeHtml(teamMemberInitial(member.name))}</div>
        <div>
          <h5>${escapeHtml(member.name)}</h5>
          <p>${escapeHtml(member.role || "역할 미정")}</p>
        </div>
      </div>
      <div class="workload-stats">
        <span>TODO ${openCount}</span>
        <span>완료 ${doneCount}</span>
        <span>임박 ${dueSoonCount}</span>
      </div>
      <div class="workload-bar" aria-label="진행률 ${avgProgress}%">
        <span style="width:${avgProgress}%"></span>
      </div>
    </article>
  `;
}

function renderPersonalTodoCard(member, tasks, sheet = "업무목록") {
  const memberTasks = tasksForOwner(tasks, member.name);
  const openTasks = memberTasks.filter(task => !isTaskDone(task));
  return `
    <article class="todo-list-card" style="--member-color:${escapeHtml(member.color)}">
      <div class="todo-list-head">
        <div>
          <h5>${escapeHtml(member.name)}</h5>
          <p>${escapeHtml(member.focus || member.role || "담당 분야 미정")}</p>
        </div>
        <span>${openTasks.length}</span>
      </div>
      <div class="todo-list">
        ${memberTasks.length ? memberTasks.map(task => renderTodoRow(task, sheet)).join("") : `<div class="empty slim">담당 TODO가 없습니다.</div>`}
      </div>
    </article>
  `;
}

function renderTaskCard(task, membersByName = new Map(), sheet = "업무목록") {
  const statusClass = taskStatusClass(task.status);
  const priorityClass = taskPriorityClass(task.priority);
  const dueClass = taskDueClass(task);
  const owner = renderMemberChips(task.owner, membersByName);
  const meta = [task.project, task.category, task.linkedEventId].filter(Boolean).join(" · ");
  return `
    <article class="task-card status-${statusClass} priority-${priorityClass} due-${dueClass}">
      <div class="task-card-top">
        ${renderTaskToggleInput(task, sheet)}
        <div>
          <h5>${escapeHtml(task.title)}</h5>
          <p>${escapeHtml(meta || "프로젝트 미정")}</p>
        </div>
      </div>
      <div class="task-card-meta">
        <span class="task-chip priority-${priorityClass}">${escapeHtml(task.priority || "보통")}</span>
        <span class="task-chip due-${dueClass}">${escapeHtml(taskDueLabel(task))}</span>
      </div>
      <div class="calendar-owner-row">${owner}</div>
      <div class="task-progress-bar" aria-label="진행률 ${task.progress}%">
        <span style="width:${task.progress}%"></span>
      </div>
      ${renderTaskChecklist(task)}
      ${task.note ? `<p class="task-note">${escapeHtml(task.note)}</p>` : ""}
    </article>
  `;
}

function renderKanbanColumn(status, tasks, membersByName, sheet) {
  const columnTasks = tasks.filter(task => task.status === status);
  return `
    <section class="kanban-column status-${taskStatusClass(status)}">
      <div class="kanban-column-head">
        <h5>${escapeHtml(status)}</h5>
        <span>${columnTasks.length}</span>
      </div>
      <div class="kanban-cards">
        ${columnTasks.length ? columnTasks.map(task => renderTaskCard(task, membersByName, sheet)).join("") : `<div class="empty slim">업무가 없습니다.</div>`}
      </div>
    </section>
  `;
}

function renderTaskAssignmentForm(members, taskSheet = "업무목록") {
  const assignableMembers = members.filter(member => member.name && member.name !== "팀");
  const fallbackMembers = assignableMembers.length ? assignableMembers : members;
  return `
    <section class="task-assign-panel" data-task-assign-panel data-task-sheet="${escapeHtml(taskSheet)}">
      <div class="task-assign-head">
        <div>
          <h4>새 업무 배정</h4>
          <p>업무를 적고 팀원을 선택하면 담당자로 연결됩니다.</p>
        </div>
        <button class="task-assign-submit" type="button" data-task-create>추가</button>
      </div>
      <div class="task-assign-grid">
        <label class="field task-title-field">업무
          <input type="text" data-task-title placeholder="예: 3단계 대화 초안 작성">
        </label>
        <label class="field">마감일
          <input type="date" data-task-due>
        </label>
        <label class="field">우선순위
          <select data-task-priority>
            <option value="보통">보통</option>
            <option value="높음">높음</option>
            <option value="낮음">낮음</option>
          </select>
        </label>
        <div class="field task-member-field">
          <span>팀원</span>
          <div class="task-member-picker" role="group" aria-label="담당 팀원 선택">
            ${fallbackMembers.length ? fallbackMembers.map(member => `
              <label class="task-member-option" style="--member-color:${escapeHtml(member.color)}">
                <input type="checkbox" data-task-member value="${escapeHtml(member.name)}">
                <span class="member-dot">${escapeHtml(teamMemberInitial(member.name))}</span>
                <span>${escapeHtml(member.name)}</span>
              </label>
            `).join("") : `<div class="empty slim">먼저 팀원 목록을 추가해주세요.</div>`}
          </div>
        </div>
        <label class="field">프로젝트
          <input type="text" data-task-project placeholder="대화 시스템">
        </label>
        <label class="field task-note-field">메모
          <input type="text" data-task-note placeholder="필요하면 짧게 남기기">
        </label>
      </div>
    </section>
  `;
}

function renderMeetingAttendeePicker(members) {
  const assignableMembers = members.filter(member => member.name && member.name !== "팀");
  const fallbackMembers = assignableMembers.length ? assignableMembers : members;
  return `
    <div class="meeting-attendee-picker" role="group" aria-label="회의 참석자 선택">
      ${fallbackMembers.length ? fallbackMembers.map(member => `
        <label class="meeting-attendee-option" style="--member-color:${escapeHtml(member.color)}">
          <input type="checkbox" data-meeting-attendee value="${escapeHtml(member.name)}">
          <span class="member-dot">${escapeHtml(teamMemberInitial(member.name))}</span>
          <span>${escapeHtml(member.name)}</span>
        </label>
      `).join("") : `<div class="empty slim">먼저 팀원 목록을 추가해주세요.</div>`}
    </div>
  `;
}

function renderMeetingTextSection(label, value) {
  const text = String(value || "").trim();
  return text
    ? `<div class="meeting-note-section"><h5>${escapeHtml(label)}</h5><div class="rich-text">${renderRichContent(text)}</div></div>`
    : "";
}

function renderMeetingCard(meeting, membersByName = new Map()) {
  const attendees = renderMemberChips(meeting.attendees, membersByName);
  return `
    <article class="meeting-card status-${calendarStatusClass(meeting.status)}">
      <div class="meeting-card-head">
        <div>
          <h4>${escapeHtml(meeting.title)}</h4>
          <p>${escapeHtml(`${meeting.dateKey} ${meeting.time}`)}</p>
        </div>
        <span>${escapeHtml(meeting.status)}</span>
      </div>
      <div class="calendar-owner-row">${attendees}</div>
      ${renderMeetingTextSection("안건", meeting.agenda)}
      ${renderMeetingTextSection("회의록", meeting.minutes)}
      ${renderMeetingTextSection("결정사항", meeting.decisions)}
      ${renderMeetingTextSection("액션아이템", meeting.actions)}
    </article>
  `;
}

function renderMeetingBookBlock(block) {
  const sheet = block.sheet || "회의록";
  const teamSheet = block.teamSheet || "팀원목록";
  const members = teamMemberRows(teamSheet);
  const membersByName = teamMemberMap(teamSheet);
  const meetings = meetingRows(sheet);
  const defaultDate = nextWeekdayDateKey(block.defaultWeekday || "월요일");
  const defaultTime = block.defaultTime || "22:00";
  const latestMeeting = meetings[0];
  return `
    <section class="meeting-book">
      <div class="meeting-book-head">
        <div>
          <h3>${escapeHtml(block.title || "회의록")}</h3>
          <p>기본 일정은 매주 ${escapeHtml(block.defaultWeekday || "월요일")} ${escapeHtml(defaultTime)}입니다.</p>
        </div>
        <div class="meeting-summary">
          <span>다음 기본 회의 ${escapeHtml(defaultDate)} ${escapeHtml(defaultTime)}</span>
          <span>기록 ${meetings.length}개</span>
        </div>
      </div>
      <section class="meeting-write-panel" data-meeting-panel data-meeting-sheet="${escapeHtml(sheet)}">
        <div class="meeting-write-head">
          <div>
            <h4>회의록 작성</h4>
            <p>날짜와 시간을 회의마다 따로 지정할 수 있습니다.</p>
          </div>
          <button class="meeting-save" type="button" data-meeting-create>회의록 저장</button>
        </div>
        <div class="meeting-field-grid">
          <label class="field">회의 날짜
            <input type="date" data-meeting-date value="${escapeHtml(defaultDate)}">
          </label>
          <label class="field">시간
            <input type="time" data-meeting-time value="${escapeHtml(defaultTime)}">
          </label>
          <label class="field">상태
            <select data-meeting-status>
              <option value="예정">예정</option>
              <option value="진행">진행</option>
              <option value="완료">완료</option>
            </select>
          </label>
          <label class="field meeting-title-field">회의명
            <input type="text" data-meeting-title value="주간 회의">
          </label>
        </div>
        ${renderMeetingAttendeePicker(members)}
        <div class="meeting-text-grid">
          <label class="field">안건
            <textarea data-meeting-agenda placeholder="오늘 논의할 안건을 줄 단위로 적어주세요."></textarea>
          </label>
          <label class="field">회의록
            <textarea data-meeting-minutes placeholder="논의 내용을 여기에 기록하세요."></textarea>
          </label>
          <label class="field">결정사항
            <textarea data-meeting-decisions placeholder="결정된 내용을 정리하세요."></textarea>
          </label>
          <label class="field">액션아이템
            <textarea data-meeting-actions placeholder="담당자와 후속 업무를 적어주세요."></textarea>
          </label>
        </div>
      </section>
      <div class="work-section-head">
        <h4>회의 기록</h4>
        <span>${latestMeeting ? `${latestMeeting.dateKey} ${latestMeeting.time}` : "아직 기록 없음"}</span>
      </div>
      <div class="meeting-card-list">
        ${meetings.length ? meetings.map(meeting => renderMeetingCard(meeting, membersByName)).join("") : `<div class="empty">회의록이 없습니다.</div>`}
      </div>
    </section>
  `;
}

function renderWorkboardBlock(block) {
  const taskSheet = block.taskSheet || "업무목록";
  const teamSheet = block.teamSheet || "팀원목록";
  const tasks = taskRows(taskSheet);
  const members = teamMemberRows(teamSheet);
  const membersByName = teamMemberMap(teamSheet);
  const todayKey = currentDateKey();
  const doneCount = tasks.filter(isTaskDone).length;
  const openCount = tasks.length - doneCount;
  const dueSoonCount = tasks.filter(task => !isTaskDone(task) && isTaskDueSoon(task, todayKey)).length;
  const overdueCount = tasks.filter(task => taskDueClass(task, todayKey) === "overdue").length;
  const avgProgress = tasks.length
    ? Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length)
    : 0;
  const statuses = ["예정", "진행", "검토", "완료"];
  return `
    <section class="workboard">
      <div class="workboard-head">
        <div>
          <h3>${escapeHtml(block.title || "업무 관리")}</h3>
          <p>${escapeHtml(taskSheet)} · ${escapeHtml(teamSheet)}</p>
        </div>
        <span class="workboard-date">${escapeHtml(todayKey)}</span>
      </div>
      <div class="work-summary">
        <div class="work-summary-card"><strong>${tasks.length}</strong><span>전체 업무</span></div>
        <div class="work-summary-card"><strong>${openCount}</strong><span>진행 전/중</span></div>
        <div class="work-summary-card"><strong>${dueSoonCount}</strong><span>마감 임박</span></div>
        <div class="work-summary-card alert"><strong>${overdueCount}</strong><span>지연</span></div>
        <div class="work-summary-card"><strong>${avgProgress}%</strong><span>평균 진행률</span></div>
      </div>
      ${renderTaskAssignmentForm(members, taskSheet)}
      <div class="work-section-head">
        <h4>팀 워크로드</h4>
        <span>담당자별 업무량</span>
      </div>
      <div class="workload-grid">
        ${members.length ? members.map(member => renderWorkloadCard(member, tasks)).join("") : `<div class="empty">팀원 데이터가 없습니다.</div>`}
      </div>
      <div class="work-section-head">
        <h4>팀원별 TODO</h4>
        <span>담당 업무 체크</span>
      </div>
      <div class="personal-todo-grid">
        ${members.length ? members.map(member => renderPersonalTodoCard(member, tasks, taskSheet)).join("") : `<div class="empty">팀원 데이터가 없습니다.</div>`}
      </div>
      <div class="work-section-head">
        <h4>상태 보드</h4>
        <span>예정 · 진행 · 검토 · 완료</span>
      </div>
      <div class="kanban-board">
        ${statuses.map(status => renderKanbanColumn(status, tasks, membersByName, taskSheet)).join("")}
      </div>
    </section>
  `;
}

function renderTeamMemberCard(member, tasks = []) {
  const statusClass = calendarStatusClass(member.status);
  const contact = member.contact ? `<span>${escapeHtml(member.contact)}</span>` : `<span>연락처 미정</span>`;
  const memberTasks = tasksForOwner(tasks, member.name);
  const openCount = memberTasks.filter(task => !isTaskDone(task)).length;
  const doneCount = memberTasks.length - openCount;
  const dueSoonCount = memberTasks.filter(task => !isTaskDone(task) && isTaskDueSoon(task)).length;
  return `
    <article class="team-member-card status-${statusClass}" style="--member-color:${escapeHtml(member.color)}">
      <div class="team-member-avatar">${escapeHtml(teamMemberInitial(member.name))}</div>
      <div class="team-member-main">
        <h4>${escapeHtml(member.name)}</h4>
        <div class="team-member-meta">
          <span>${escapeHtml(member.role || "역할 미정")}</span>
          <span>${escapeHtml(member.status || "상태 미정")}</span>
          ${contact}
        </div>
        <p>${escapeHtml(member.focus || "담당 분야 미정")}</p>
        <div class="team-member-work">
          <span>TODO ${openCount}개</span>
          <span>완료 ${doneCount}개</span>
          <span>임박 ${dueSoonCount}개</span>
        </div>
        ${member.memo ? `<small>${escapeHtml(member.memo)}</small>` : ""}
      </div>
    </article>
  `;
}

function renderTeamBlock(block) {
  const members = teamMemberRows(block.sheet || "팀원목록");
  const tasks = taskRows("업무목록");
  const activeCount = members.filter(member => member.status === "활성").length;
  return `
    <section class="team-roster">
      <div class="team-roster-head">
        <div>
          <h3>${escapeHtml(block.title || "팀원 목록")}</h3>
          <p>${escapeHtml(block.sheet || "팀원목록")} 시트를 기준으로 표시합니다.</p>
        </div>
        <div class="team-roster-summary">
          <span>전체 ${members.length}명</span>
          <span>활성 ${activeCount}명</span>
        </div>
      </div>
      <div class="team-member-grid">
        ${members.length ? members.map(member => renderTeamMemberCard(member, tasks)).join("") : `<div class="empty">팀원 데이터가 없습니다.</div>`}
      </div>
    </section>
  `;
}

function renderBlockBody(block) {
  if (block.type === "generic") {
    return renderGenericBlock(block);
  }
  if (block.type === "heading") {
    return renderEditableParagraph("heading-block", block, "새 제목", "h2");
  }
  if (block.type === "text") {
    if (isEditing) {
      return renderEditableParagraph("text-block", block, "텍스트를 입력하세요.");
    }
    return `<div class="text-block rich-text ${alignClass(block)} ${headingLevelClass(block)}" style="${fontSizeStyle(block)}">${renderRichContent(block.content || "")}</div>`;
  }
  if (block.type === "callout") {
    if (isEditing) {
      return renderEditableParagraph("callout", block, "강조할 내용을 입력하세요.");
    }
    return `<div class="callout rich-text ${alignClass(block)} ${headingLevelClass(block)}" style="${fontSizeStyle(block)}">${renderRichContent(block.content || "")}</div>`;
  }
  if (block.type === "quote") {
    if (isEditing) {
      return renderEditableParagraph("quote-block", block, "인용하거나 참고할 문장을 입력하세요.", "blockquote");
    }
    return `<blockquote class="quote-block rich-text ${alignClass(block)} ${headingLevelClass(block)}" style="${fontSizeStyle(block)}">${renderRichContent(block.content || "")}</blockquote>`;
  }
  if (block.type === "checklist") {
    return renderChecklistBlock(block);
  }
  if (block.type === "code") {
    return renderCodeBlock(block);
  }
  if (block.type === "divider") {
    return renderDividerBlock(block);
  }
  if (block.type === "dialogue") {
    return renderDialogueBlock(block);
  }
  if (block.type === "calendar") {
    return renderCalendarBlock(block);
  }
  if (block.type === "team") {
    return renderTeamBlock(block);
  }
  if (block.type === "workboard") {
    return renderWorkboardBlock(block);
  }
  if (block.type === "meetingbook") {
    return renderMeetingBookBlock(block);
  }
  if (block.type === "image") {
    return renderImageBlock(block);
  }
  if (block.type === "video") {
    return renderVideoBlock(block);
  }
  if (block.type === "attachment") {
    return renderAttachmentBlock(block);
  }
  if (block.type === "flow") {
    return `
      <div class="flow-tools">
        <button data-flow-sample>샘플 추가</button>
      </div>
      <textarea class="flow-editor" data-flow-editor>${escapeHtml(block.content || "")}</textarea>
      <div class="flow-preview">${renderFlow(block.content || "")}</div>
    `;
  }
  if (block.type === "mermaid") {
    return `
      <div class="flow-tools">
        <button data-mermaid-sample>샘플 추가</button>
      </div>
      <textarea class="flow-editor mermaid-editor" data-mermaid-editor>${escapeHtml(block.content || "")}</textarea>
      <div class="mermaid-stage" data-mermaid-preview data-source="${escapeHtml(block.content || "")}"></div>
    `;
  }
  if (block.type === "table") {
    return renderTableBlock(block);
  }
  if (block.type === "dataset") {
    return renderDatasetBlock(block);
  }
  return `<div class="empty">지원하지 않는 블록입니다.</div>`;
}

function renderFlow(content) {
  const lines = String(content || "").split(/\n+/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return `<div class="empty">노드 -> 노드 형식으로 입력하세요.</div>`;
  return lines.map(line => {
    const parts = line.split(/\s*(?:->|=>|→)\s*/).map(item => item.trim()).filter(Boolean);
    if (parts.length === 1) return `<div class="flow-row"><div class="flow-node">${escapeHtml(parts[0])}</div></div>`;
    return `<div class="flow-row">${parts.map((part, i) => `
      ${i ? `<span class="flow-arrow">→</span>` : ""}
      <div class="flow-node">${escapeHtml(part)}</div>
    `).join("")}</div>`;
  }).join("");
}

function findBlockById(blockId) {
  for (const tab of state.tabs) {
    const block = tab.blocks.find(item => item.id === blockId);
    if (block) return block;
  }
  return null;
}

function defaultMermaid() {
  return [
    "flowchart TD",
    "  A[방 접속] --> B[상태 확인]",
    "  B --> C[작은 행동]",
    "  C --> D[온기 변화]",
    "  D --> E[다음 단계]"
  ].join("\n");
}

async function renderMermaidBlocks() {
  const targets = [...document.querySelectorAll("[data-mermaid-preview]")];
  if (!targets.length) return;
  if (!window.mermaid) {
    targets.forEach(target => {
      target.innerHTML = `<div class="empty">Mermaid 모듈을 불러오는 중입니다.</div>`;
    });
    return;
  }
  if (!renderMermaidBlocks.initialized) {
    mermaid.initialize({ startOnLoad: false, theme: "base", securityLevel: "strict" });
    renderMermaidBlocks.initialized = true;
  }
  for (const target of targets) {
    const article = target.closest("[data-block-id]");
    const block = article ? findBlockById(article.dataset.blockId) : null;
    const source = target.dataset.source || block?.content || defaultMermaid();
    try {
      const id = `mermaid-${article?.dataset.blockId || uid("diagram")}`;
      const result = await mermaid.render(id.replace(/[^a-zA-Z0-9_-]/g, "-"), source);
      target.innerHTML = result.svg;
    } catch (err) {
      target.innerHTML = `<div class="empty">Mermaid 문법을 확인하세요.<pre>${escapeHtml(source)}</pre></div>`;
    }
  }
}

function renderTableBlock(block) {
  const rows = ensureRows(block.rows);
  return `
    ${renderSheetTools(block, "table", rows)}
    <div class="table-wrap">
      ${renderSheetTable(rows, block, "table-cell")}
    </div>
  `;
}

function renderDatasetBlock(block) {
  const activeSheet = state.datasets[block.sheet] ? block.sheet : Object.keys(state.datasets)[0] || "";
  const rows = ensureRows(state.datasets[activeSheet] || [[]]);
  const options = Object.keys(state.datasets).map(name => `<option value="${escapeHtml(name)}" ${name === activeSheet ? "selected" : ""}>${escapeHtml(name)}</option>`).join("");
  return `
    ${renderSheetTools(block, "dataset", rows, options)}
    <div class="table-wrap">
      ${renderSheetTable(rows, block, "dataset-cell")}
    </div>
  `;
}

function datasetDrawerTitle(block, sectionTitle, activeSheet) {
  const title = String(sectionTitle || "").trim();
  if (title) return title;
  return `${activeSheet || block.sheet || "데이터"} 데이터`;
}

function datasetDrawerStats(rows) {
  const normalized = ensureRows(rows);
  const filledRows = normalized.filter(row => row.some(cell => String(cell || "").trim())).length;
  const columnCount = Math.max(1, ...normalized.map(row => row.length));
  return `${filledRows}행 · ${columnCount}열`;
}

function renderDatasetDrawerBlock(block, index, sectionTitle = "") {
  const activeSheet = state.datasets[block.sheet] ? block.sheet : Object.keys(state.datasets)[0] || "";
  const rows = ensureRows(state.datasets[activeSheet] || [[]]);
  const title = datasetDrawerTitle(block, sectionTitle, activeSheet);
  return `
    <article class="block dataset-drawer-block" id="block-${escapeHtml(block.id)}" data-block-id="${escapeHtml(block.id)}" draggable="false">
      <details class="dataset-drawer" open>
        <summary class="dataset-drawer-summary">
          <span class="dataset-drawer-title">
            <strong>${escapeHtml(title)}</strong>
            <small>${escapeHtml(activeSheet || "연결된 시트 없음")} · ${escapeHtml(datasetDrawerStats(rows))}</small>
          </span>
          <span class="dataset-drawer-state" aria-hidden="true">
            <span class="drawer-closed">표 보기</span>
            <span class="drawer-open">표 접기</span>
          </span>
        </summary>
        <div class="dataset-drawer-body">
          ${renderDatasetBlock(block)}
        </div>
      </details>
    </article>
  `;
}

function renderChecklistBlock(block) {
  const items = Array.isArray(block.items) ? block.items : [];
  return `
    <div class="checklist-block">
      ${items.map((item, index) => `
        <label class="check-row">
          <input type="checkbox" data-check-item="${index}" ${item.checked ? "checked" : ""} ${isEditing ? "" : "disabled"}>
          <span class="editable" contenteditable="${editAttr()}" data-check-text="${index}">${escapeEditable(item.text || "")}</span>
        </label>
      `).join("")}
      <button class="edit-only" data-check-add type="button">체크 항목 추가</button>
    </div>
  `;
}

function renderCodeBlock(block) {
  return `
    <div class="code-block-wrap">
      <label class="field edit-only">언어
        <input class="text-field" data-code-language value="${escapeHtml(block.language || "text")}">
      </label>
      <textarea class="code-editor edit-only" data-code-editor>${escapeHtml(block.content || "")}</textarea>
      <pre class="code-preview"><code>${escapeHtml(block.content || "")}</code></pre>
    </div>
  `;
}

function renderDividerBlock(block) {
  return `
    <div class="divider-block">
      <hr>
      <div class="divider-label editable edit-only" contenteditable="${editAttr()}" data-field="label">${escapeEditable(block.label || "")}</div>
      ${block.label && !isEditing ? `<span>${escapeHtml(block.label)}</span>` : ""}
    </div>
  `;
}
