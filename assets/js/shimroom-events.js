let formatSelectionRange = null;
let paragraphFormatRange = null;
let paragraphFormatBlockId = "";
let slashPaletteVisible = false;
let slashPaletteItems = [
  { type: "drawing", label: "그림판", icon: "DRAW" },
  { type: "heading", label: "제목", icon: "H" },
  { type: "text", label: "텍스트", icon: "T" },
  { type: "image", label: "이미지", icon: "IMG" },
  { type: "callout", label: "강조", icon: "C" },
  { type: "table", label: "엑셀표", icon: "XLS" },
  { type: "flow", label: "플로우", icon: "→" },
  { type: "mermaid", label: "Mermaid", icon: "📊" },
  { type: "calendar", label: "달력", icon: "CAL" },
  { type: "team", label: "팀원", icon: "TEAM" },
  { type: "workboard", label: "업무 관리", icon: "TODO" },
  { type: "meetingbook", label: "회의록", icon: "MTG" },
  { type: "video", label: "동영상", icon: "VID" },
  { type: "attachment", label: "파일/글", icon: "FILE" },
  { type: "quote", label: "인용", icon: "Q" },
  { type: "checklist", label: "체크리스트", icon: "☑" },
  { type: "code", label: "코드", icon: "{ }" },
  { type: "divider", label: "구분선", icon: "—" }
];
let slashPaletteSelectedIndex = 0;
let slashTargetEditable = null;
let filteredSlashItems = [...slashPaletteItems];
const tabDragState = { tabId: "", overTabId: "", placement: "" };
const imageResizeState = {
  active: false,
  target: null,
  frame: null,
  input: null,
  output: null,
  startX: 0,
  startWidth: 0,
  frameWidth: 0,
  pointerId: null,
  usingMouse: false
};
const contentUnitDragState = {
  active: false,
  blockId: "",
  unitId: "",
  overUnitId: "",
  placement: "",
  pointerId: null,
  pointerX: 0,
  pointerY: 0
};
const drawingStrokeState = {
  active: false,
  canvas: null,
  context: null,
  target: null,
  blockId: "",
  targetKey: "",
  pointerId: null,
  lastX: 0,
  lastY: 0,
  tool: "pen",
  color: "#202522",
  size: 6
};
const drawingHistory = new Map();

function updateFloatingToolbar() {
  if (!isEditing || !els.floatingToolbar) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    els.floatingToolbar.classList.remove("show");
    els.floatingToolbar.style.top = "-9999px";
    formatSelectionRange = null;
    return;
  }
  const activeEl = document.activeElement;
  if (!activeEl || !activeEl.hasAttribute('contenteditable') || activeEl.closest('table')) {
    els.floatingToolbar.classList.remove("show");
    els.floatingToolbar.style.top = "-9999px";
    formatSelectionRange = null;
    return;
  }
  const range = sel.getRangeAt(0);
  formatSelectionRange = range.cloneRange();
  const rect = range.getBoundingClientRect();
  els.floatingToolbar.classList.add("show");
  const toolbarWidth = els.floatingToolbar.offsetWidth || 150;
  const toolbarHeight = els.floatingToolbar.offsetHeight || 38;
  const left = rect.left + window.scrollX + (rect.width / 2) - (toolbarWidth / 2);
  const top = rect.top + window.scrollY - toolbarHeight - 8;
  els.floatingToolbar.style.left = `${Math.max(10, left)}px`;
  els.floatingToolbar.style.top = `${Math.max(10, top)}px`;
}

function applyFormat(wrapperStart, wrapperEnd = wrapperStart) {
  if (!formatSelectionRange) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(formatSelectionRange);
  const selectedText = formatSelectionRange.toString();
  const wrapped = `${wrapperStart}${selectedText}${wrapperEnd}`;
  document.execCommand("insertText", false, wrapped);
  els.floatingToolbar.classList.remove("show");
  els.floatingToolbar.style.top = "-9999px";
  formatSelectionRange = null;
}

function editableFromSelectionNode(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return element?.closest?.('[data-field="content"].editable') || null;
}

function rememberParagraphFormatSelection() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const editable = editableFromSelectionNode(sel.anchorNode);
  const blockEl = editable?.closest?.("[data-block-id]");
  const unitEl = editable?.closest?.("[data-unit-id]");
  if (!editable || !blockEl) return;
  paragraphFormatRange = sel.getRangeAt(0).cloneRange();
  paragraphFormatBlockId = unitEl?.dataset.unitId || blockEl.dataset.blockId || "";
}

function paragraphToolEditable(control) {
  const unitEl = control.closest("[data-unit-id]");
  if (unitEl) return unitEl.querySelector('[data-field="content"].editable') || null;
  const blockEl = control.closest("[data-block-id]");
  return blockEl?.querySelector('[data-field="content"].editable') || null;
}

function restoreParagraphFormatSelection(editable) {
  if (!editable) return false;
  const blockId = editable.closest("[data-block-id]")?.dataset.blockId || "";
  const unitId = editable.closest("[data-unit-id]")?.dataset.unitId || "";
  const targetId = unitId || blockId;
  const sel = window.getSelection();
  editable.focus();
  if (paragraphFormatRange && paragraphFormatBlockId === targetId) {
    sel.removeAllRanges();
    sel.addRange(paragraphFormatRange);
    return true;
  }
  const range = document.createRange();
  range.selectNodeContents(editable);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

function selectedParagraphText() {
  const sel = window.getSelection();
  return sel && sel.rangeCount ? sel.toString() : "";
}

function serializeEditableContent(editable) {
  const blockTags = new Set(["DIV", "P"]);
  function walk(node, isLast = true) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue.replace(/\u00a0/g, " ");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    if (node.dataset.mediaMarker) return node.dataset.mediaMarker;
    if (node.tagName === "BR") return "\n";
    const childNodes = Array.from(node.childNodes);
    let text = childNodes.map((child, index) => walk(child, index === childNodes.length - 1)).join("");
    if (node.dataset.editSize) {
      const size = normalizeFontSize(node.dataset.editSize);
      text = `[[size:${size}|${text}]]`;
    }
    if (node.dataset.editAlign) {
      const align = normalizeTextAlign(node.dataset.editAlign);
      text = `[[align:${align}|${text}]]`;
    }
    if (node.dataset.editColor) {
      const color = normalizeRichColor(node.dataset.editColor);
      text = `[[color:${color}|${text}]]`;
    }
    if (node.dataset.editMark) {
      const color = normalizeRichColor(node.dataset.editMark, "#fff3bf");
      text = `[[mark:${color}|${text}]]`;
    }
    if (blockTags.has(node.tagName) && node !== editable && !isLast) {
      text += "\n";
    }
    return text;
  }
  const childNodes = Array.from(editable.childNodes);
  return childNodes
    .map((child, index) => walk(child, index === childNodes.length - 1))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n$/, "");
}

function insertInlineMarkup(editable, text) {
  if (!restoreParagraphFormatSelection(editable)) return;
  document.execCommand("insertText", false, text);
  editable.dispatchEvent(new Event("input", { bubbles: true }));
  rememberParagraphFormatSelection();
}

function replaceSelectionWithElement(element) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(element);
  range.setStartAfter(element);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

function editableRange(editable) {
  const sel = window.getSelection();
  if (!editable || !sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!editable.contains(range.commonAncestorContainer)) return null;
  return range.cloneRange();
}

function restoreEditableRange(editable, range) {
  const sel = window.getSelection();
  if (!editable || !sel) return false;
  editable.focus();
  if (range && editable.contains(range.commonAncestorContainer)) {
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }
  const fallback = document.createRange();
  fallback.selectNodeContents(editable);
  fallback.collapse(false);
  sel.removeAllRanges();
  sel.addRange(fallback);
  return true;
}

function insertPlainTextAtEditableRange(editable, range, text) {
  const sel = window.getSelection();
  if (range) {
    if (!restoreEditableRange(editable, range)) return false;
  } else {
    const anchor = sel?.anchorNode || null;
    if (!anchor || !editable.contains(anchor)) {
      if (!restoreEditableRange(editable, null)) return false;
    }
  }
  if (!sel || sel.rangeCount === 0) return false;
  const activeRange = sel.getRangeAt(0);
  activeRange.deleteContents();
  const node = document.createTextNode(text);
  activeRange.insertNode(node);
  activeRange.setStartAfter(node);
  activeRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(activeRange);
  return true;
}

function editableForContentTarget(blockId, unitId = "") {
  const blockEl = document.getElementById(`block-${blockId}`);
  if (!blockEl) return null;
  if (unitId) {
    return blockEl.querySelector(`[data-unit-id="${CSS.escape(unitId)}"] [data-field="content"].editable`);
  }
  return blockEl.querySelector('[data-field="content"].editable');
}

function imageMarkerForAsset(asset) {
  return `[[image:${assetPath(asset.id)}|${asset.name}]]`;
}

function splitSerializedMedia(serialized) {
  const source = String(serialized || "");
  const matcher = /\[\[(image|video|file):([^\]|]+?)(?:\|([^\]]*))?\]\]/g;
  const segments = [];
  let cursor = 0;
  let match = null;
  while ((match = matcher.exec(source)) !== null) {
    if (match.index > cursor) {
      segments.push({ kind: "text", value: source.slice(cursor, match.index) });
    }
    segments.push({
      kind: "media",
      marker: {
        kind: String(match[1] || "").toLowerCase(),
        path: String(match[2] || "").trim(),
        caption: String(match[3] || "").trim()
      }
    });
    cursor = matcher.lastIndex;
  }
  if (cursor < source.length) {
    segments.push({ kind: "text", value: source.slice(cursor) });
  }
  return segments;
}

function createImageContentUnit(asset) {
  const unit = createContentUnit("image");
  if (asset?.id) unit.assetId = asset.id;
  unit.path = assetPath(asset?.id || "");
  unit.caption = asset?.name || unit.caption;
  return unit;
}

function createMediaContentUnitFromMarker(marker) {
  const mediaKind = String(marker?.kind || "image").toLowerCase();
  const unitType = mediaKind === "video" ? "video" : mediaKind === "file" ? "attachment" : "image";
  const asset = marker?.path ? assetFromPath(marker.path) : null;
  const unit = createContentUnit(unitType);
  unit.path = String(marker?.path || "");
  if (unit.path.startsWith("asset:")) unit.assetId = unit.path.slice(6);
  unit.caption = marker?.caption || asset?.name || unit.caption || "";
  return unit;
}

function textUnitFromTemplate(templateUnit, content) {
  if (content === null || content === undefined || content === "") return null;
  const unitType = ["heading", "text", "callout", "quote"].includes(templateUnit?.type) ? templateUnit.type : "text";
  const unit = createContentUnit(unitType);
  unit.content = content;
  if (["heading", "text", "callout", "quote"].includes(templateUnit?.type)) {
    if (templateUnit.align !== undefined) unit.align = templateUnit.align;
    if (templateUnit.fontSize !== undefined) unit.fontSize = templateUnit.fontSize;
    if (templateUnit.headingLevel !== undefined) unit.headingLevel = templateUnit.headingLevel;
  }
  return unit;
}

function serializeSegmentsToUnits(serialized, templateUnit) {
  const segments = splitSerializedMedia(serialized);
  const units = [];
  let textBuffer = "";
  const pushTextUnit = () => {
    const nextUnit = textUnitFromTemplate(templateUnit, textBuffer);
    if (!nextUnit) {
      textBuffer = "";
      return;
    }
    units.push(nextUnit);
    textBuffer = "";
  };
  for (const segment of segments) {
    if (segment.kind === "text") {
      textBuffer += segment.value;
      continue;
    }
    pushTextUnit();
    units.push(createMediaContentUnitFromMarker(segment.marker));
  }
  pushTextUnit();
  return units;
}

function ensureGenericBlock(block) {
  if (!block || block.type === "generic") return;
  const original = structuredClone(block);
  Object.keys(block).forEach(key => delete block[key]);
  block.id = original.id;
  block.type = "generic";
  block.items = [blockToContentUnit(original)];
}

function replaceSerializedContentUnit(block, unitId, serialized, templateUnit, wasGeneric) {
  if (!block) return false;
  const wasGenericBefore = wasGeneric === undefined ? block.type === "generic" : wasGeneric;
  const units = serializeSegmentsToUnits(serialized, templateUnit || block);
  if (!units.length) return false;
  ensureGenericBlock(block);
  if (!Array.isArray(block.items)) block.items = [];
  const targetUnitId = unitId || "";
  const targetIndex = targetUnitId ? block.items.findIndex(item => item.id === targetUnitId) : -1;
  if (targetIndex >= 0) {
    block.items.splice(targetIndex, 1, ...units);
    return true;
  }
  if (!wasGenericBefore) {
    block.items.splice(0, 1, ...units);
    return true;
  }
  block.items.push(...units);
  return true;
}

function insertUnitsIntoBlock(block, units, unitId = "") {
  if (!block || !Array.isArray(units) || !units.length) return false;
  ensureGenericBlock(block);
  const unitIndex = unitId ? block.items.findIndex(item => item.id === unitId) : -1;
  const insertAt = unitIndex >= 0 ? unitIndex + 1 : block.items.length;
  block.items.splice(insertAt, 0, ...units);
  return true;
}

function insertImageAssetsIntoEditable(editable, assets, range, commandLabel = "이미지 삽입") {
  const block = currentBlockFromEvent({ target: editable });
  if (!block) return false;
  const unit = contentUnitFromElement(editable);
  const targetBlock = unit || block;
  if (!("content" in targetBlock)) return false;
  const markerText = assets.map(imageMarkerForAsset).join("\n");
  if (!restoreEditableRange(editable, range)) return false;
  if (!insertPlainTextAtEditableRange(editable, null, markerText)) return false;
  const nextContent = serializeEditableContent(editable);
  CommandManager.execute(commandLabel, () => {
    assets.forEach(asset => {
      if (!findAssetById(asset.id)) state.assets.push(asset);
    });
    replaceSerializedContentUnit(block, unit?.id || "", nextContent, targetBlock, block.type === "generic");
  });
  return true;
}

function deleteEditableMedia(button) {
  const marker = button?.closest("[data-media-marker]");
  const editable = marker?.closest('[data-field="content"].editable');
  const block = editable ? currentBlockFromEvent({ target: editable }) : null;
  if (!marker || !editable || !block) return;
  const unit = contentUnitFromElement(editable);
  const targetBlock = unit || block;
  const next = marker.nextSibling;
  const prev = marker.previousSibling;
  marker.remove();
  if (next?.nodeName === "BR") {
    next.remove();
  } else if (prev?.nodeName === "BR") {
    prev.remove();
  }
  const nextContent = serializeEditableContent(editable);
  CommandManager.execute("이미지 삭제", () => {
    targetBlock.content = nextContent;
  });
  toast("이미지를 삭제했습니다.");
}

function stripRichFormatting(value) {
  let text = String(value || "");
  let previous = "";
  while (previous !== text) {
    previous = text;
    text = text
      .replace(/\[\[(?:size|align|color|mark):[^\]|]+\|([\s\S]*?)\]\]/g, "$1")
      .replace(/\[\[math:([\s\S]*?)\]\]/g, "$1");
  }
  return text
    .replace(/\[\[(?:image|video|file):(.+?)(?:\|([^\]]*))?\]\]/g, (_match, path, caption) => caption || path)
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/\*(.*?)\*/g, "$1");
}

function wrapParagraphSelection(control, wrapperStart, wrapperEnd = wrapperStart, placeholder = "텍스트") {
  const editable = paragraphToolEditable(control);
  restoreParagraphFormatSelection(editable);
  const selected = selectedParagraphText();
  insertInlineMarkup(editable, `${wrapperStart}${selected || placeholder}${wrapperEnd}`);
}

function applyParagraphTool(control) {
  const editable = paragraphToolEditable(control);
  const type = control.dataset.inlineFormat;
  if (!editable || !type) return;
  if (type === "bold") return wrapParagraphSelection(control, "**", "**", "굵은 글자");
  if (type === "italic") return wrapParagraphSelection(control, "*", "*", "기울임 글자");
  if (type === "underline") return wrapParagraphSelection(control, "__", "__", "밑줄 글자");
  if (type === "strike") return wrapParagraphSelection(control, "~~", "~~", "취소선 글자");
  if (type === "code") return wrapParagraphSelection(control, "`", "`", "code");
  if (type === "image") {
    rememberParagraphFormatSelection();
    const block = currentBlockFromEvent({ target: control });
    const unit = contentUnitFromElement(control);
    if (block) openImageFilePicker(block, "paragraph", unit?.id || "");
    return;
  }
  if (type === "bullet") {
    restoreParagraphFormatSelection(editable);
    const selected = selectedParagraphText();
    return insertInlineMarkup(editable, `${selected ? "" : "\n"}- ${selected || "항목"}`);
  }
  if (type === "ordered") {
    restoreParagraphFormatSelection(editable);
    const selected = selectedParagraphText();
    return insertInlineMarkup(editable, `${selected ? "" : "\n"}1. ${selected || "항목"}`);
  }
  if (type === "check") {
    restoreParagraphFormatSelection(editable);
    const selected = selectedParagraphText();
    return insertInlineMarkup(editable, `${selected ? "" : "\n"}[ ] ${selected || "할 일"}`);
  }
  if (type === "formula") {
    restoreParagraphFormatSelection(editable);
    const selected = selectedParagraphText();
    showCustomModal({
      title: "수식 입력",
      placeholder: "예: E=mc^2, SUM(A1:A3)",
      defaultValue: selected || "",
      onConfirm: formula => insertInlineMarkup(editable, `[[math:${formula}]]`)
    });
    return;
  }
  if (type === "link") {
    restoreParagraphFormatSelection(editable);
    const selected = selectedParagraphText();
    showCustomModal({
      title: "링크 주소 입력",
      placeholder: "https://example.com",
      defaultValue: "",
      onConfirm: url => insertInlineMarkup(editable, `[${selected || "링크"}](${url})`)
    });
  }
}

function applyInlineColor(control, kind) {
  const editable = paragraphToolEditable(control);
  if (!editable) return;
  const fallback = kind === "mark" ? "#fff3bf" : "#202522";
  const color = normalizeRichColor(kind === "mark" ? control.dataset.inlineMark : control.dataset.inlineColor, fallback);
  restoreParagraphFormatSelection(editable);
  const selected = selectedParagraphText();
  const span = document.createElement("span");
  span.className = kind === "mark" ? "rich-mark" : "rich-color";
  span.dataset[kind === "mark" ? "editMark" : "editColor"] = color;
  span.style[kind === "mark" ? "backgroundColor" : "color"] = color;
  span.textContent = selected || "글자";
  replaceSelectionWithElement(span);
  editable.dispatchEvent(new Event("input", { bubbles: true }));
  rememberParagraphFormatSelection();
}

function clearParagraphFormatting(control) {
  const editable = paragraphToolEditable(control);
  const block = currentBlockFromEvent({ target: control });
  if (!editable || !block) return;
  const unit = contentUnitFromElement(control);
  const targetBlock = unit || block;
  restoreParagraphFormatSelection(editable);
  const selected = selectedParagraphText();
  if (selected) {
    replaceSelectionWithElement(document.createTextNode(selected));
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    rememberParagraphFormatSelection();
    return;
  }
  CommandManager.execute("서식 지우기", () => {
    targetBlock.content = stripRichFormatting(targetBlock.content || "");
    targetBlock.align = "left";
    targetBlock.headingLevel = 0;
    delete targetBlock.fontSize;
  });
  if (unit) focusContentUnitEditor(block.id, unit.id);
  else focusBlockEditor(block.id);
}

function applyParagraphSize(control) {
  const editable = paragraphToolEditable(control);
  const block = currentBlockFromEvent({ target: control });
  if (!editable || !block) return;
  const unit = contentUnitFromElement(control);
  const targetBlock = unit || block;
  const size = normalizeFontSize(control.value, paragraphFontSize(targetBlock));
  restoreParagraphFormatSelection(editable);
  const selected = selectedParagraphText();
  if (selected) {
    document.execCommand(
      "insertHTML",
      false,
      `<span class="rich-size" data-edit-size="${size}" style="font-size:${size}px">${escapeHtml(selected)}</span>`
    );
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    rememberParagraphFormatSelection();
    return;
  }
  CommandManager.execute("문단 글자 크기 변경", () => {
    targetBlock.fontSize = size;
  });
  if (unit) {
    focusContentUnitEditor(block.id, unit.id);
  } else {
    focusBlockEditor(block.id);
  }
}

function applyParagraphHeadingLevel(control) {
  const editable = paragraphToolEditable(control);
  const block = currentBlockFromEvent({ target: control });
  if (!editable || !block) return;
  const unit = contentUnitFromElement(control);
  const targetBlock = unit || block;
  const level = normalizeHeadingLevel(control.dataset.inlineHeading ?? control.value, targetBlock.type);
  restoreParagraphFormatSelection(editable);
  const selected = selectedParagraphText();
  if (selected) {
    const size = defaultFontSizeForTarget({ headingLevel: level });
    document.execCommand(
      "insertHTML",
      false,
      `<span class="rich-size" data-edit-size="${size}" style="font-size:${size}px">${escapeHtml(selected)}</span>`
    );
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    rememberParagraphFormatSelection();
    return;
  }
  CommandManager.execute("문단 헤딩 변경", () => {
    targetBlock.headingLevel = level;
    delete targetBlock.fontSize;
    if (targetBlock.type === "heading" && level === 0) {
      targetBlock.type = "text";
    }
  });
  if (unit) {
    focusContentUnitEditor(block.id, unit.id);
  } else {
    focusBlockEditor(block.id);
  }
}

function insertHeadingUnitAtBlockTop(block, level) {
  if (!block) return;
  let focusUnitId = "";
  let created = false;
  CommandManager.execute("블록 제목 추가", () => {
    if (block.type !== "generic") {
      const original = structuredClone(block);
      Object.keys(block).forEach(key => delete block[key]);
      block.id = original.id;
      block.type = "generic";
      block.items = [blockToContentUnit(original)];
    }
    block.items = Array.isArray(block.items) ? block.items : [];
    const firstUnit = block.items[0];
    if (firstUnit && isHeadingLike(firstUnit)) {
      focusUnitId = firstUnit.id;
      firstUnit.type = "heading";
      firstUnit.headingLevel = level;
      delete firstUnit.fontSize;
      return;
    }
    const headingUnit = createContentUnit("heading");
    headingUnit.content = "";
    headingUnit.headingLevel = level;
    delete headingUnit.fontSize;
    focusUnitId = headingUnit.id;
    created = true;
    block.items.unshift(headingUnit);
  });
  if (focusUnitId) {
    focusContentUnitEditor(block.id, focusUnitId, { selectAll: true });
  } else {
    focusBlockEditor(block.id);
  }
  toast(created ? "블록 맨 위에 제목을 추가했습니다." : "블록 제목 레벨을 변경했습니다.");
}

function applyParagraphAlign(control) {
  const editable = paragraphToolEditable(control);
  const block = currentBlockFromEvent({ target: control });
  if (!editable || !block) return;
  const unit = contentUnitFromElement(control);
  const targetBlock = unit || block;
  const align = normalizeTextAlign(control.dataset.inlineAlign);
  restoreParagraphFormatSelection(editable);
  const selected = selectedParagraphText();
  if (selected) {
    const span = document.createElement("span");
    span.className = `rich-align rich-align-${align}`;
    span.dataset.editAlign = align;
    span.textContent = selected;
    replaceSelectionWithElement(span);
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    rememberParagraphFormatSelection();
    return;
  }
  CommandManager.execute("문단 정렬 변경", () => {
    targetBlock.align = align;
  });
  if (unit) {
    focusContentUnitEditor(block.id, unit.id);
  } else {
    focusBlockEditor(block.id);
  }
}

function contentUnitFromElement(element) {
  const unitId = element?.closest?.("[data-unit-id]")?.dataset.unitId || "";
  if (!unitId) return null;
  const block = currentBlockFromEvent({ target: element });
  return block?.items?.find(unit => unit.id === unitId) || null;
}

function contentTargetFromEvent(event) {
  const unit = contentUnitFromElement(event.target);
  return unit || currentBlockFromEvent(event);
}

function safeDrawingControlColor(value) {
  if (typeof safeDrawingColor === "function") return safeDrawingColor(value);
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#202522";
}

function safeDrawingControlSize(value) {
  if (typeof safeDrawingSize === "function") return safeDrawingSize(value);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(1, Math.min(36, Math.round(numeric))) : 6;
}

function drawingTargetFromElement(element) {
  const block = currentBlockFromEvent({ target: element });
  if (!block) return null;
  const unit = contentUnitFromElement(element);
  const target = unit || block;
  if (target?.type !== "drawing") return null;
  const targetKey = unit ? `unit:${unit.id}` : "block";
  return { block, target, targetKey, key: `block:${block.id}:${targetKey}` };
}

function drawingContext(canvas) {
  const ctx = canvas?.getContext?.("2d");
  if (!ctx) return null;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return ctx;
}

function loadDrawingCanvas(canvas, source) {
  const ctx = drawingContext(canvas);
  if (!ctx) return;
  const src = String(source || "");
  if (canvas.dataset.drawingLoaded === src && canvas.dataset.drawingLoading !== src) return;
  canvas.dataset.drawingLoading = src;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!src) {
    canvas.dataset.drawingLoaded = src;
    delete canvas.dataset.drawingLoading;
    return;
  }
  const image = new Image();
  image.onload = () => {
    if (canvas.dataset.drawingLoading !== src) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.dataset.drawingLoaded = src;
    delete canvas.dataset.drawingLoading;
  };
  image.onerror = () => {
    if (canvas.dataset.drawingLoading === src) delete canvas.dataset.drawingLoading;
    if (canvas.dataset.drawingLoaded !== src) canvas.dataset.drawingLoaded = "";
  };
  image.src = src;
}

function renderDrawingCanvases() {
  document.querySelectorAll("[data-drawing-canvas]").forEach(canvas => {
    loadDrawingCanvas(canvas, canvas.dataset.drawingSrc || "");
  });
}

function drawingCanvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const x = ((event.clientX - rect.left) / width) * canvas.width;
  const y = ((event.clientY - rect.top) / height) * canvas.height;
  return {
    x: Math.max(0, Math.min(canvas.width, x)),
    y: Math.max(0, Math.min(canvas.height, y))
  };
}

function applyDrawingStyle(ctx, target) {
  const tool = target.drawingTool === "eraser" ? "eraser" : "pen";
  const size = safeDrawingControlSize(target.brushSize);
  ctx.lineWidth = size;
  ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = tool === "eraser" ? "rgba(0,0,0,1)" : safeDrawingControlColor(target.brushColor);
  ctx.fillStyle = ctx.strokeStyle;
  return { tool, size, color: safeDrawingControlColor(target.brushColor) };
}

function drawDrawingDot(ctx, point, size) {
  ctx.beginPath();
  ctx.arc(point.x, point.y, Math.max(0.5, size / 2), 0, Math.PI * 2);
  ctx.fill();
}

function pushDrawingHistory(info, dataUrl) {
  if (!info?.key) return;
  const entries = drawingHistory.get(info.key) || [];
  const value = String(dataUrl || "");
  if (entries.at(-1) !== value) entries.push(value);
  while (entries.length > 30) entries.shift();
  drawingHistory.set(info.key, entries);
}

function restoreDrawingHistory(info) {
  const entries = drawingHistory.get(info?.key) || [];
  if (!entries.length) {
    toast("되돌릴 그림 기록이 없습니다.");
    return;
  }
  const previous = entries.pop();
  drawingHistory.set(info.key, entries);
  CommandManager.execute("그림판 되돌리기", () => {
    info.target.dataUrl = previous;
  });
  toast("그림을 되돌렸습니다.");
}

function clearDrawingBoard(element) {
  const info = drawingTargetFromElement(element);
  if (!info) return;
  const canvas = element.closest("[data-drawing-board]")?.querySelector("[data-drawing-canvas]");
  const currentDataUrl = info.target.dataUrl || canvas?.toDataURL?.("image/png") || "";
  pushDrawingHistory(info, currentDataUrl);
  CommandManager.execute("그림판 전체 지우기", () => {
    info.target.dataUrl = "";
  });
  toast("그림판을 비웠습니다.");
}

function setDrawingTool(element, tool) {
  const info = drawingTargetFromElement(element);
  if (!info) return;
  const nextTool = tool === "eraser" ? "eraser" : "pen";
  CommandManager.execute("그림판 도구 변경", () => {
    info.target.drawingTool = nextTool;
  });
}

function matchesDrawingPointer(event) {
  return drawingStrokeState.pointerId === null || event.pointerId === undefined || event.pointerId === drawingStrokeState.pointerId;
}

function beginDrawingStroke(event) {
  const canvas = event.target.closest("[data-drawing-canvas]");
  if (!canvas || !isEditing || event.button !== 0 || drawingStrokeState.active) return false;
  const info = drawingTargetFromElement(canvas);
  const ctx = drawingContext(canvas);
  if (!info || !ctx) return false;
  loadDrawingCanvas(canvas, info.target.dataUrl || "");
  delete canvas.dataset.drawingLoading;
  const point = drawingCanvasPoint(canvas, event);
  pushDrawingHistory(info, info.target.dataUrl || "");
  CommandManager.beginDraft("그림판 그리기", `drawing:${info.key}`);
  const style = applyDrawingStyle(ctx, info.target);
  drawDrawingDot(ctx, point, style.size);
  drawingStrokeState.active = true;
  drawingStrokeState.canvas = canvas;
  drawingStrokeState.context = ctx;
  drawingStrokeState.target = info.target;
  drawingStrokeState.blockId = info.block.id;
  drawingStrokeState.targetKey = info.targetKey;
  drawingStrokeState.pointerId = event.pointerId ?? null;
  drawingStrokeState.lastX = point.x;
  drawingStrokeState.lastY = point.y;
  drawingStrokeState.tool = style.tool;
  drawingStrokeState.color = style.color;
  drawingStrokeState.size = style.size;
  try {
    canvas.setPointerCapture?.(event.pointerId);
  } catch (_) {
    // Synthetic pointer events in tests may not have an active pointer.
  }
  event.preventDefault();
  return true;
}

function applyDrawingStroke(event) {
  if (!drawingStrokeState.active || !matchesDrawingPointer(event)) return;
  const { canvas, context, target } = drawingStrokeState;
  if (!canvas || !context || !target) return;
  const point = drawingCanvasPoint(canvas, event);
  applyDrawingStyle(context, target);
  context.beginPath();
  context.moveTo(drawingStrokeState.lastX, drawingStrokeState.lastY);
  context.lineTo(point.x, point.y);
  context.stroke();
  drawingStrokeState.lastX = point.x;
  drawingStrokeState.lastY = point.y;
  event.preventDefault();
}

function finishDrawingStroke(event) {
  if (!drawingStrokeState.active || !matchesDrawingPointer(event)) return false;
  const { canvas, context, target } = drawingStrokeState;
  if (canvas && context && target) {
    context.globalCompositeOperation = "source-over";
    target.dataUrl = canvas.toDataURL("image/png");
    canvas.dataset.drawingSrc = target.dataUrl;
    canvas.dataset.drawingLoaded = target.dataUrl;
  }
  drawingStrokeState.active = false;
  drawingStrokeState.canvas = null;
  drawingStrokeState.context = null;
  drawingStrokeState.target = null;
  drawingStrokeState.blockId = "";
  drawingStrokeState.targetKey = "";
  drawingStrokeState.pointerId = null;
  CommandManager.commitDraft({ render: false });
  event?.preventDefault?.();
  return true;
}

function updateImageWidthUi(frame, input, output, width) {
  const normalized = normalizeImageWidth(width);
  frame?.style.setProperty("--image-width", `${normalized}%`);
  if (input) input.value = String(normalized);
  if (output) output.textContent = `${normalized}%`;
  return normalized;
}

function insertContentUnit(blockId, type, insertIndex) {
  const block = findBlockById(blockId);
  if (!block) return;
  let insertedUnitId = "";
  CommandManager.execute("콘텐츠 추가", () => {
    if (block.type !== "generic") {
      const original = structuredClone(block);
      Object.keys(block).forEach(key => delete block[key]);
      block.id = original.id;
      block.type = "generic";
      block.items = [blockToContentUnit(original)];
    }
    block.items = Array.isArray(block.items) ? block.items : [];
    const index = Math.max(0, Math.min(block.items.length, Number(insertIndex) || block.items.length));
    const nextUnit = createContentUnit(type);
    insertedUnitId = nextUnit.id;
    block.items.splice(index, 0, nextUnit);
  });
  toast(`${labelForType(type)} 콘텐츠를 추가했습니다.`);
  if (insertedUnitId) {
    focusContentUnitEditor(blockId, insertedUnitId);
  } else {
    focusBlockEditor(blockId);
  }
}

function deleteContentUnit(block, unitId) {
  if (!block || block.type !== "generic" || !unitId) return;
  const unit = block.items?.find(item => item.id === unitId);
  if (!unit) return;
  CommandManager.execute("콘텐츠 삭제", () => {
    block.items = Array.isArray(block.items) ? block.items.filter(item => item.id !== unitId) : [];
    if (!block.items.length) block.items.push(createContentUnit("text"));
  });
  toast("콘텐츠를 삭제했습니다.");
  focusBlockEditor(block.id);
}

function blockToContentUnit(block) {
  const copy = structuredClone(block);
  const originalId = copy.id;
  copy.id = uid("unit");
  copy.sourceBlockId = originalId;
  return copy;
}

function showSlashPalette(editable) {
  slashTargetEditable = editable;
  slashPaletteSelectedIndex = 0;
  slashPaletteVisible = true;
  filteredSlashItems = [...slashPaletteItems];
  renderSlashPaletteItems();
  els.slashPalette.classList.remove("hidden");
  
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const left = rect.left + window.scrollX;
    const top = rect.bottom + window.scrollY + 6;
    els.slashPalette.style.left = `${Math.max(10, left)}px`;
    els.slashPalette.style.top = `${top}px`;
  }
}

function filterSlashPaletteItems(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) {
    filteredSlashItems = [...slashPaletteItems];
  } else {
    filteredSlashItems = slashPaletteItems.filter(item => 
      item.label.toLowerCase().includes(q) || item.type.toLowerCase().includes(q)
    );
  }
  if (slashPaletteSelectedIndex >= filteredSlashItems.length) {
    slashPaletteSelectedIndex = 0;
  }
  renderSlashPaletteItems();
}

function renderSlashPaletteItems() {
  if (filteredSlashItems.length === 0) {
    els.slashPalette.innerHTML = `<div class="empty" style="padding: 8px; font-size:12px; border:0;">일치하는 블록 없음</div>`;
    return;
  }
  els.slashPalette.innerHTML = filteredSlashItems.map((item, idx) => `
    <button class="slash-palette-item ${idx === slashPaletteSelectedIndex ? 'selected' : ''}" data-slash-type="${item.type}">
      <span>${escapeHtml(item.icon)}</span>
      <strong>${escapeHtml(item.label)}</strong>
    </button>
  `).join("");
}

function hideSlashPalette() {
  els.slashPalette.classList.add("hidden");
  slashPaletteVisible = false;
  slashTargetEditable = null;
}

function handleSlashPaletteSelect() {
  if (!slashTargetEditable) return;
  const item = filteredSlashItems[slashPaletteSelectedIndex];
  if (item) {
    const text = slashTargetEditable.innerText;
    const lastSlashIdx = text.lastIndexOf("/");
    let cleanText = text;
    if (lastSlashIdx >= 0) {
      cleanText = text.slice(0, lastSlashIdx);
    }
    slashTargetEditable.innerText = cleanText;
    const block = currentBlockFromEvent({ target: slashTargetEditable });
    const unit = contentUnitFromElement(slashTargetEditable);
    if (block?.type === "generic" && unit) {
      const currIdx = block.items.findIndex(content => content.id === unit.id);
      const canReplace = ["heading", "text", "callout", "quote"].includes(unit.type) && !cleanText.trim();
      let focusUnitId = unit.id;
      CommandManager.execute(canReplace ? "콘텐츠 전환" : "콘텐츠 추가", () => {
        unit.content = cleanText;
        if (canReplace && currIdx >= 0) {
          const nextUnit = createContentUnit(item.type);
          nextUnit.id = unit.id;
          block.items[currIdx] = nextUnit;
        } else {
          const insertIndex = currIdx >= 0 ? currIdx + 1 : block.items.length;
          const nextUnit = createContentUnit(item.type);
          focusUnitId = nextUnit.id;
          block.items.splice(insertIndex, 0, nextUnit);
        }
      });
      toast(`${item.label} 콘텐츠를 ${canReplace ? "전환" : "추가"}했습니다.`);
      focusContentUnitEditor(block.id, focusUnitId);
      hideSlashPalette();
      return;
    }
    if (block) {
      block.content = slashTargetEditable.innerText;
      const tab = getCurrentTab();
      const currIdx = tab.blocks.findIndex(b => b.id === block.id);
      if (!block.content.trim() && block.type === "text") {
        CommandManager.execute("블록 타입 전환", () => {
          const def = BLOCK_DEFINITIONS[item.type];
          block.type = item.type;
          Object.assign(block, def?.create?.() || { content: "" });
        });
        toast(`${item.label}(으)로 전환했습니다.`);
        render();
      } else {
        addBlock(item.type, currIdx + 1);
      }
    }
  }
  hideSlashPalette();
}

function openImageFilePicker(block, target = "text", unitId = "") {
  if (!block) return;
  pendingImageInsert = { blockId: block.id, unitId, target };
  els.imageFilePicker.value = "";
  els.imageFilePicker.click();
}

function openSheetImageFilePicker(block, targetBlock, type, unitId = "", sheet = "") {
  if (!block || !targetBlock) return;
  if (lastFocusedTableCell.blockId !== targetBlock.id || lastFocusedTableCell.type !== type) {
    toast("이미지를 넣을 표 셀을 먼저 선택하세요.");
    return;
  }
  pendingImageInsert = {
    blockId: block.id,
    unitId,
    target: type === "dataset" ? "dataset-cell" : "table-cell",
    row: lastFocusedTableCell.row,
    col: lastFocusedTableCell.col,
    sheet
  };
  els.imageFilePicker.value = "";
  els.imageFilePicker.click();
}

async function insertSelectedImageFile(file) {
  if (!file || !pendingImageInsert) return;
  const block = findBlockById(pendingImageInsert.blockId);
  if (!block) return;
  const target = pendingImageInsert.target;
  const unit = pendingImageInsert.unitId
    ? block.items?.find(item => item.id === pendingImageInsert.unitId)
    : null;
  const targetBlock = unit || block;
  const asset = await createAssetFromFile(file);
  const imagePath = assetPath(asset.id);
  if (target === "table-cell") {
    const marker = `[[image:${imagePath}|${asset.name}]]`;
    CommandManager.execute("표 셀 이미지 삽입", () => {
      if (!findAssetById(asset.id)) state.assets.push(asset);
      targetBlock.rows = ensureRows(targetBlock.rows);
      const row = pendingImageInsert.row;
      const col = pendingImageInsert.col;
      const current = String(targetBlock.rows[row]?.[col] || "");
      targetBlock.rows[row][col] = `${current}${current ? "\n" : ""}${marker}`;
    });
    pendingImageInsert = null;
    toast("표 셀에 이미지를 삽입했습니다.");
    return;
  }
  if (target === "dataset-cell") {
    const marker = `[[image:${imagePath}|${asset.name}]]`;
    CommandManager.execute("데이터 셀 이미지 삽입", () => {
      if (!findAssetById(asset.id)) state.assets.push(asset);
      const sheet = pendingImageInsert.sheet || targetBlock.sheet || Object.keys(state.datasets)[0] || "";
      if (!sheet) return;
      targetBlock.sheet = sheet;
      state.datasets[sheet] = ensureRows(state.datasets[sheet] || [[]]);
      const row = pendingImageInsert.row;
      const col = pendingImageInsert.col;
      const current = String(state.datasets[sheet][row]?.[col] || "");
      state.datasets[sheet][row][col] = `${current}${current ? "\n" : ""}${marker}`;
    });
    pendingImageInsert = null;
    toast("표 셀에 이미지를 삽입했습니다.");
    return;
  }
  if (target === "paragraph" || target === "text") {
    const editable = editableForContentTarget(block.id, unit?.id || "");
    if (editable && insertImageAssetsIntoEditable(editable, [asset], paragraphFormatRange, "이미지 삽입")) {
      pendingImageInsert = null;
      toast("이미지를 삽입했습니다.");
      return;
    }
    CommandManager.execute("이미지 삽입", () => {
      if (!findAssetById(asset.id)) state.assets.push(asset);
      const markerText = imageMarkerForAsset(asset);
      const nextSerialized = `${targetBlock.content || ""}${targetBlock.content ? "\n" : ""}${markerText}`;
      replaceSerializedContentUnit(block, unit?.id || "", nextSerialized, targetBlock, block.type === "generic");
    });
    pendingImageInsert = null;
    toast("이미지를 삽입했습니다.");
    return;
  }
  CommandManager.execute("이미지 삽입", () => {
        if (!findAssetById(asset.id)) state.assets.push(asset);
        if (target === "image-block") {
           targetBlock.assetId = asset.id;
           targetBlock.path = imagePath;
           delete targetBlock.src;
          if (!targetBlock.caption || targetBlock.caption === "캡션") targetBlock.caption = asset.name;
          return;
        }
    const marker = `[[image:${imagePath}|${asset.name}]]`;
    block.content = `${block.content || ""}${block.content ? "\n" : ""}${marker}`;
  });
  pendingImageInsert = null;
  toast("이미지를 업로드했습니다.");
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
  const items = Array.from(data.items || []);
  const itemFiles = items
    .filter(item => item.kind === "file" && String(item.type || "").startsWith("image/"))
    .map(item => item.getAsFile())
    .filter(file => file && mediaKindForFile(file) === "image");
  const files = itemFiles.length
    ? itemFiles
    : Array.from(data.files || []).filter(file => mediaKindForFile(file) === "image");
  return files.map((file, index) => namedClipboardImageFile(file, index));
}

async function pasteClipboardImages(blockId, unitId, files, editable = null, range = null) {
  const assets = [];
  for (const file of files) {
    assets.push(await createAssetFromFile(file));
  }
  if (editable && insertImageAssetsIntoEditable(editable, assets, range, "이미지 붙여넣기")) {
    const hasSessionOnlyPreview = assets.some(asset => !asset.dataUrl);
    if (hasSessionOnlyPreview) {
      toast("큰 이미지는 현재 브라우저 세션에서만 미리 볼 수 있습니다.");
    } else {
      toast(assets.length > 1 ? `${assets.length}개 이미지를 붙여넣었습니다.` : "클립보드 이미지를 붙여넣었습니다.");
    }
    return;
  }
  CommandManager.execute("이미지 붙여넣기", () => {
    const block = findBlockById(blockId);
    if (!block) return;
    assets.forEach(asset => {
    if (!findAssetById(asset.id)) state.assets.push(asset);
  });
  const targetBlock = unitId ? block.items?.find(item => item.id === unitId) : block;
  if (targetBlock && "content" in targetBlock) {
    const markerText = assets.map(imageMarkerForAsset).join("\n");
    const nextSerialized = `${targetBlock.content || ""}${targetBlock.content ? "\n" : ""}${markerText}`;
    replaceSerializedContentUnit(block, unitId || "", nextSerialized, targetBlock, block.type === "generic");
    return;
  }
  if (block.type !== "generic") {
    const original = structuredClone(block);
    Object.keys(block).forEach(key => delete block[key]);
    block.id = original.id;
    block.type = "generic";
    block.items = [blockToContentUnit(original)];
  }
  const imageUnits = assets.map(createImageContentUnit);
  if (!insertUnitsIntoBlock(block, imageUnits, unitId)) {
    block.items = Array.isArray(block.items) ? block.items : [];
    block.items.push(...imageUnits);
  }
  });
  const hasSessionOnlyPreview = assets.some(asset => !asset.dataUrl);
  if (hasSessionOnlyPreview) {
    toast("큰 이미지는 현재 브라우저 세션에서만 미리 볼 수 있습니다.");
  } else {
    toast(assets.length > 1 ? `${assets.length}개 이미지를 붙여넣었습니다.` : "클립보드 이미지를 붙여넣었습니다.");
  }
}

function clearDropMarkers(includeDragging = false) {
  const selector = includeDragging ? ".drop-before, .drop-after, .dragging" : ".drop-before, .drop-after";
  els.blocks.querySelectorAll(selector).forEach(element => {
    element.classList.remove("drop-before", "drop-after", "dragging");
  });
  dragState.overBlockId = "";
  dragState.placement = "";
}

function dragPlacement(event, article) {
  const rect = article.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
}

els.appTitle?.addEventListener("input", () => {
  if (!isEditing) return;
  CommandManager.beginDraft("문서 전체 제목 수정", "app-title");
  state.appTitle = els.appTitle.value;
  document.title = String(state.appTitle || DEFAULT_APP_TITLE).trim() || DEFAULT_APP_TITLE;
  scheduleSave();
});
els.appTitle?.addEventListener("focusout", () => {
  if (!String(state.appTitle || "").trim()) {
    state.appTitle = DEFAULT_APP_TITLE;
    renderAppTitle();
    scheduleSave();
  }
  CommandManager.commitDraft({ render: false });
});

els.title.addEventListener("input", () => {
  if (!isEditing || currentView !== "document") return;
  const tab = getCurrentTab();
  if (!tab) return;
  CommandManager.beginDraft("탭 제목 수정", `tab:${tab.id}:title`);
  tab.title = els.title.value;
  scheduleSave();
  renderTabs();
  renderWikiNav();
});
els.title.addEventListener("focusout", () => {
  if (currentView === "document") {
    const tab = getCurrentTab();
    if (tab && !String(tab.title || "").trim()) {
      tab.title = "새 탭";
      els.title.value = tab.title;
      scheduleSave();
      renderTabs();
    }
  }
  CommandManager.commitDraft({ render: false });
});

els.subtitle.addEventListener("input", () => {
  if (!isEditing || currentView !== "document") return;
  const tab = getCurrentTab();
  if (!tab) return;
  CommandManager.beginDraft("탭 설명 수정", `tab:${tab.id}:subtitle`);
  tab.subtitle = els.subtitle.value;
  scheduleSave();
});
els.subtitle.addEventListener("focusout", () => CommandManager.commitDraft({ render: false }));

els.docSearch.addEventListener("input", () => {
  searchQuery = els.docSearch.value;
  renderTabs();
  renderWikiNav();
  renderProjectHeader();
  renderBlocks();
  renderMermaidBlocks();
});

els.imageBasePath.addEventListener("input", () => {
  if (!isEditing) return;
  CommandManager.beginDraft("이미지 기본 경로 수정", "image-base-path");
  state.imageBasePath = els.imageBasePath.value.trim();
  scheduleSave();
  renderBlocks();
  renderMermaidBlocks();
});
els.imageBasePath.addEventListener("focusout", () => CommandManager.commitDraft({ render: false }));

function beginTabRename(tabId) {
  if (!isEditing || !tabId) return;
  editingTabId = tabId;
  render();
  const input = document.querySelector(`[data-tab-rename-input="${editingTabId}"]`);
  if (input) {
    input.focus();
    input.select();
  }
}

els.tabList.addEventListener("click", event => {
  const editButton = event.target.closest("[data-tab-edit-id]");
  if (editButton) {
    event.preventDefault();
    beginTabRename(editButton.dataset.tabEditId);
    return;
  }

  if (event.target.closest("[data-tab-drag-handle]")) {
    return;
  }

  const deleteButton = event.target.closest("[data-tab-delete-id]");
  if (deleteButton) {
    event.preventDefault();
    deleteTabById(deleteButton.dataset.tabDeleteId);
    return;
  }
  const jumpButton = event.target.closest("[data-jump-block]");
  if (jumpButton) {
    scrollToBlock(jumpButton.dataset.jumpBlock);
    highlightBlock(jumpButton.dataset.jumpBlock, "block-highlight");
    return;
  }
  const row = event.target.closest(".tab-row[data-tab-row-id], [data-tab-id]");
  if (!row) return;
  const nextTabId = row.dataset.tabRowId || row.dataset.tabId;
  if (!nextTabId) return;
  const wasTab = currentTabId;
  currentView = "document";
  currentWikiKeyword = "";
  currentTabId = nextTabId;
  render();
  if (wasTab !== currentTabId) fadeInBlocks();
});

function clearTabDropMarkers(includeDragging = false) {
  const selector = includeDragging ? ".tab-row.drop-before, .tab-row.drop-after, .tab-row.dragging" : ".tab-row.drop-before, .tab-row.drop-after";
  els.tabList.querySelectorAll(selector).forEach(element => {
    element.classList.remove("drop-before", "drop-after", "dragging");
  });
  tabDragState.overTabId = "";
  tabDragState.placement = "";
}

function tabDragPlacement(event, row) {
  const rect = row.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
}

els.tabList.addEventListener("dragstart", event => {
  const row = event.target.closest("[data-tab-row-id]");
  if (!isEditing || searchQuery || !row || !event.target.closest("[data-tab-drag-handle]")) {
    event.preventDefault();
    return;
  }
  tabDragState.tabId = row.dataset.tabRowId;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", tabDragState.tabId);
  row.classList.add("dragging");
});

els.tabList.addEventListener("dragover", event => {
  if (!tabDragState.tabId) return;
  const row = event.target.closest("[data-tab-row-id]");
  if (!row || row.dataset.tabRowId === tabDragState.tabId) return;
  event.preventDefault();
  clearTabDropMarkers(false);
  tabDragState.overTabId = row.dataset.tabRowId;
  tabDragState.placement = tabDragPlacement(event, row);
  row.classList.add(tabDragState.placement === "after" ? "drop-after" : "drop-before");
});

els.tabList.addEventListener("drop", event => {
  if (!tabDragState.tabId || !tabDragState.overTabId) return;
  event.preventDefault();
  const { tabId, overTabId, placement } = tabDragState;
  tabDragState.tabId = "";
  clearTabDropMarkers(true);
  const targetTab = documentTabs().find(tab => tab.id === overTabId);
  moveTabTo(tabId, overTabId, placement, targetTab?.parentId || "");
});

els.tabList.addEventListener("dragend", () => {
  tabDragState.tabId = "";
  clearTabDropMarkers(true);
});

function beginPendingBlockDrag(event) {
  const dragHandle = event.target.closest("[data-drag-handle]");
  if (!dragHandle || !isEditing || searchQuery || event.button !== 0) return false;
  const article = dragHandle.closest("[data-block-id]");
  const blockId = article?.dataset.blockId || "";
  if (!blockId) return false;
  if (dragState.pendingBlockId === blockId) {
    event.preventDefault();
    return true;
  }
  dragState.handleBlockId = blockId;
  dragState.pendingBlockId = blockId;
  dragState.pointerX = event.clientX;
  dragState.pointerY = event.clientY;
  dragState.pointerId = event.pointerId ?? null;
  dragState.manualDrag = false;
  if (event.pointerId !== undefined) {
    try {
      dragHandle.setPointerCapture?.(event.pointerId);
    } catch (_) {
      // Synthetic pointer events in tests do not always register an active pointer.
    }
  }
  event.preventDefault();
  return true;
}

function beginImageResize(event) {
  const handle = event.target.closest("[data-image-resize-handle]");
  if (imageResizeState.active) return false;
  if (!handle || !isEditing || event.button !== 0) return false;
  const block = currentBlockFromEvent(event);
  const targetBlock = contentTargetFromEvent(event);
  const frame = handle.closest("[data-image-frame]");
  const box = frame?.querySelector("[data-image-resize-box]");
  if (!block || !targetBlock || !frame || !box) return false;
  const targetKey = targetBlock === block ? "block" : targetBlock.id;
  CommandManager.beginDraft("이미지 크기 조정", `block:${block.id}:${targetKey}:image-width`);
  imageResizeState.active = true;
  imageResizeState.target = targetBlock;
  imageResizeState.frame = frame;
  imageResizeState.input = frame.querySelector("[data-image-width]");
  imageResizeState.output = frame.querySelector("[data-image-width-output]");
  imageResizeState.startX = event.clientX;
  imageResizeState.startWidth = box.getBoundingClientRect().width;
  imageResizeState.frameWidth = Math.max(1, frame.getBoundingClientRect().width);
  imageResizeState.pointerId = event.pointerId ?? null;
  imageResizeState.usingMouse = event.pointerId === undefined;
  handle.classList.add("resizing");
  try {
    handle.setPointerCapture?.(event.pointerId);
  } catch (_) {
    // Synthetic events may not have an active pointer.
  }
  document.body.classList.add("image-resizing");
  event.preventDefault();
  return true;
}

function contentUnitFromBlock(block, unitId) {
  if (!block || !Array.isArray(block.items)) return null;
  return block.items.find(unit => unit.id === unitId) || null;
}

function contentUnitPlacement(event, unit) {
  const rect = unit.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
}

function clearContentUnitDragMarkers(includeDragging = false) {
  const selector = includeDragging ? ".content-unit.dragging, .content-unit.drop-before, .content-unit.drop-after" : ".content-unit.drop-before, .content-unit.drop-after";
  els.blocks.querySelectorAll(selector).forEach(element => {
    element.classList.remove("dragging", "drop-before", "drop-after");
  });
}

function resetContentUnitDragState() {
  contentUnitDragState.active = false;
  contentUnitDragState.blockId = "";
  contentUnitDragState.unitId = "";
  contentUnitDragState.overUnitId = "";
  contentUnitDragState.placement = "";
  contentUnitDragState.pointerId = null;
  contentUnitDragState.pointerX = 0;
  contentUnitDragState.pointerY = 0;
}

function matchesContentUnitPointer(event) {
  return contentUnitDragState.pointerId === null || event.pointerId === undefined || event.pointerId === contentUnitDragState.pointerId;
}

function beginContentUnitDrag(event) {
  const handle = event.target.closest("[data-content-unit-drag-handle]");
  if (!handle || !isEditing || searchQuery || event.button !== 0) return false;
  if (contentUnitDragState.active) return true;
  const blockEl = event.target.closest("[data-block-id]");
  const unitEl = handle.closest("[data-unit-id]");
  if (!blockEl || !unitEl) return false;
  const blockId = blockEl.dataset.blockId || "";
  const unitId = unitEl.dataset.unitId || "";
  if (!blockId || !unitId) return false;
  const block = findBlockById(blockId);
  if (!block || block.type !== "generic" || !Array.isArray(block.items)) return false;
  const targetUnit = contentUnitFromBlock(block, unitId);
  if (!targetUnit) return false;
  contentUnitDragState.active = true;
  contentUnitDragState.blockId = block.id;
  contentUnitDragState.unitId = unitId;
  contentUnitDragState.overUnitId = "";
  contentUnitDragState.placement = "";
  contentUnitDragState.pointerId = event.pointerId ?? null;
  contentUnitDragState.pointerX = event.clientX;
  contentUnitDragState.pointerY = event.clientY;
  clearContentUnitDragMarkers(false);
  unitEl.classList.add("dragging");
  document.body.classList.add("content-unit-dragging");
  try {
    handle.setPointerCapture?.(event.pointerId);
  } catch (_) {
    // Synthetic pointer events may not have an active pointer.
  }
  event.preventDefault();
  return true;
}

function updateContentUnitDragTarget(event) {
  if (!contentUnitDragState.active || !matchesContentUnitPointer(event)) return;
  if (!isEditing) {
    finishContentUnitDrag(event);
    return;
  }
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const unit = target?.closest?.("[data-unit-id]");
  const block = target?.closest?.("[data-block-id]");
  if (!block || block.dataset.blockId !== contentUnitDragState.blockId) {
    clearContentUnitDragMarkers(false);
    contentUnitDragState.overUnitId = "";
    contentUnitDragState.placement = "";
    return;
  }
  clearContentUnitDragMarkers(false);
  if (unit && unit.dataset.unitId) {
    if (unit.dataset.unitId === contentUnitDragState.unitId) {
      contentUnitDragState.overUnitId = "";
      contentUnitDragState.placement = "";
      return;
    }
    const placement = contentUnitPlacement(event, unit);
    contentUnitDragState.overUnitId = unit.dataset.unitId;
    contentUnitDragState.placement = placement;
    unit.classList.add(placement === "after" ? "drop-after" : "drop-before");
    return;
  }
  const stackUnits = Array.from(block.querySelectorAll(":scope .content-unit[data-unit-id]"));
  if (!stackUnits.length) {
    contentUnitDragState.overUnitId = "";
    contentUnitDragState.placement = "";
    return;
  }
  const firstUnit = stackUnits[0];
  const lastUnit = stackUnits[stackUnits.length - 1];
  const firstRect = firstUnit?.getBoundingClientRect();
  const lastRect = lastUnit?.getBoundingClientRect();
  if (!firstRect || !lastRect) return;
  if (event.clientY <= firstRect.top) {
    contentUnitDragState.overUnitId = firstUnit.dataset.unitId || "";
    contentUnitDragState.placement = "before";
    firstUnit.classList.add("drop-before");
  } else if (event.clientY >= lastRect.bottom) {
    contentUnitDragState.overUnitId = lastUnit.dataset.unitId || "";
    contentUnitDragState.placement = "after";
    lastUnit.classList.add("drop-after");
  }
}

function finishContentUnitDrag(event) {
  if (!contentUnitDragState.active || !matchesContentUnitPointer(event)) return;
  const shouldMove = Boolean(contentUnitDragState.blockId && contentUnitDragState.unitId && contentUnitDragState.overUnitId);
  const { blockId, unitId, overUnitId, placement } = contentUnitDragState;
  clearContentUnitDragMarkers(true);
  resetContentUnitDragState();
  document.body.classList.remove("content-unit-dragging");
  if (shouldMove && blockId && unitId !== overUnitId) {
    event.preventDefault();
    const moved = moveContentUnit(blockId, unitId, overUnitId, placement);
    if (moved) focusContentUnitEditor(blockId, unitId, { position: "start" });
  }
}

function applyImageResizeFromEvent(event) {
  if (!imageResizeState.active || !imageResizeState.target || !imageResizeState.frame) return;
  const nextWidthPx = imageResizeState.startWidth + (event.clientX - imageResizeState.startX);
  const nextPercent = (nextWidthPx / imageResizeState.frameWidth) * 100;
  const width = updateImageWidthUi(
    imageResizeState.frame,
    imageResizeState.input,
    imageResizeState.output,
    nextPercent
  );
  imageResizeState.target.imageWidth = width;
  scheduleSave();
}

els.blocks.addEventListener("pointerdown", event => {
  if (beginDrawingStroke(event)) return;
  if (beginImageResize(event)) return;
  if (beginContentUnitDrag(event)) return;
  beginPendingBlockDrag(event);
});

document.addEventListener("pointermove", event => {
  if (drawingStrokeState.active) {
    applyDrawingStroke(event);
    return;
  }
  updateContentUnitDragTarget(event);
  if (imageResizeState.usingMouse) return;
  applyImageResizeFromEvent(event);
});
document.addEventListener("mousemove", event => {
  updateContentUnitDragTarget(event);
  if (!imageResizeState.usingMouse) return;
  applyImageResizeFromEvent(event);
});

function finishImageResize() {
  if (!imageResizeState.active) return;
  imageResizeState.frame?.querySelector("[data-image-resize-handle]")?.classList.remove("resizing");
  imageResizeState.active = false;
  imageResizeState.target = null;
  imageResizeState.frame = null;
  imageResizeState.input = null;
  imageResizeState.output = null;
  imageResizeState.usingMouse = false;
  document.body.classList.remove("image-resizing");
  CommandManager.commitDraft({ render: false });
}

document.addEventListener("pointerup", event => {
  if (finishDrawingStroke(event)) return;
  finishImageResize();
  finishContentUnitDrag(event);
});
document.addEventListener("pointercancel", event => {
  if (finishDrawingStroke(event)) return;
  finishImageResize();
  finishContentUnitDrag(event);
});
document.addEventListener("mouseup", event => {
  finishImageResize();
  finishContentUnitDrag(event);
});

els.blocks.addEventListener("mousedown", event => {
  if (beginImageResize(event)) return;
  if (beginContentUnitDrag(event)) return;
  const paragraphButton = event.target.closest("[data-inline-format]");
  if (paragraphButton) {
    rememberParagraphFormatSelection();
    event.preventDefault();
    return;
  }
  if (event.target.closest("[data-inline-size]")) {
    rememberParagraphFormatSelection();
    return;
  }
  if (event.target.closest("[data-inline-heading]")) {
    rememberParagraphFormatSelection();
    return;
  }
  if (event.target.closest("[data-inline-align]")) {
    rememberParagraphFormatSelection();
    event.preventDefault();
    return;
  }
  if (event.target.closest("[data-inline-color], [data-inline-mark], [data-inline-clear]")) {
    rememberParagraphFormatSelection();
    event.preventDefault();
    return;
  }
  beginPendingBlockDrag(event);
  if (event.target.closest("[data-selected-term-create]")) {
    rememberTextSelection();
    event.preventDefault();
  }
});

function dragArticleFromEvent(event) {
  const article = event.target.closest("[data-block-id]");
  if (!article) return null;
  if (event.target.closest("[data-drag-handle]")) return article;
  return dragState.handleBlockId === article.dataset.blockId ? article : null;
}

els.blocks.addEventListener("dragstart", event => {
  const article = dragArticleFromEvent(event);
  if (!isEditing || searchQuery || !article) {
    event.preventDefault();
    dragState.handleBlockId = "";
    return;
  }
  dragState.blockId = article.dataset.blockId;
  dragState.handleBlockId = "";
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", dragState.blockId);
  article.classList.add("dragging");
});

els.blocks.addEventListener("dragover", event => {
  if (!dragState.blockId) return;
  const article = event.target.closest("[data-block-id]");
  if (!article || article.dataset.blockId === dragState.blockId) return;
  event.preventDefault();
  clearDropMarkers(false);
  dragState.overBlockId = article.dataset.blockId;
  dragState.placement = dragPlacement(event, article);
  article.classList.add(dragState.placement === "after" ? "drop-after" : "drop-before");
});

els.blocks.addEventListener("drop", event => {
  if (!dragState.blockId || !dragState.overBlockId) return;
  event.preventDefault();
  const { blockId, overBlockId, placement } = dragState;
  clearDropMarkers(true);
  resetDragState();
  moveBlockTo(blockId, overBlockId, placement);
});

els.blocks.addEventListener("dragend", () => {
  resetDragState();
  clearDropMarkers(true);
});

function resetDragState() {
  dragState.blockId = "";
  dragState.overBlockId = "";
  dragState.placement = "";
  dragState.handleBlockId = "";
  dragState.pendingBlockId = "";
  dragState.pointerX = 0;
  dragState.pointerY = 0;
  dragState.pointerId = null;
  dragState.manualDrag = false;
}

function startManualDragIfNeeded(event) {
  if (!dragState.pendingBlockId || dragState.manualDrag) return;
  const moved = Math.hypot(event.clientX - dragState.pointerX, event.clientY - dragState.pointerY);
  if (moved < 4) return;
  dragState.manualDrag = true;
  dragState.blockId = dragState.pendingBlockId;
  const source = document.querySelector(`[data-block-id="${CSS.escape(dragState.blockId)}"]`);
  source?.classList.add("dragging");
}

function matchesActivePointer(event) {
  return dragState.pointerId === null || event.pointerId === undefined || event.pointerId === dragState.pointerId;
}

function updateManualDragTarget(event) {
  if (!dragState.manualDrag || !dragState.blockId) return;
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const article = target?.closest?.("[data-block-id]");
  if (!article || article.dataset.blockId === dragState.blockId) return;
  clearDropMarkers(false);
  dragState.overBlockId = article.dataset.blockId;
  dragState.placement = dragPlacement(event, article);
  article.classList.add(dragState.placement === "after" ? "drop-after" : "drop-before");
}

function autoScrollManualDrag(event) {
  if (!dragState.manualDrag) return;
  const margin = 72;
  const maxStep = 28;
  let step = 0;
  if (event.clientY < margin) {
    step = -Math.round(maxStep * (1 - event.clientY / margin));
  } else if (event.clientY > window.innerHeight - margin) {
    step = Math.round(maxStep * (1 - (window.innerHeight - event.clientY) / margin));
  }
  if (step) window.scrollBy(0, step);
}

function handleManualDragMove(event) {
  if (!dragState.pendingBlockId) return;
  if (!matchesActivePointer(event)) return;
  if (!isEditing || searchQuery) {
    resetDragState();
    clearDropMarkers(true);
    return;
  }
  startManualDragIfNeeded(event);
  updateManualDragTarget(event);
  autoScrollManualDrag(event);
  if (dragState.manualDrag) event.preventDefault();
}

function finishManualDrag(event) {
  if (!dragState.pendingBlockId || !matchesActivePointer(event)) return;
  const shouldMove = dragState.manualDrag && dragState.blockId && dragState.overBlockId;
  const { blockId, overBlockId, placement } = dragState;
  clearDropMarkers(true);
  resetDragState();
  if (shouldMove) {
    event.preventDefault();
    moveBlockTo(blockId, overBlockId, placement);
  }
}

document.addEventListener("pointermove", handleManualDragMove);
document.addEventListener("mousemove", handleManualDragMove);

document.addEventListener("pointerup", finishManualDrag);
document.addEventListener("mouseup", finishManualDrag);
document.addEventListener("pointercancel", event => {
  if (!matchesActivePointer(event)) return;
  clearDropMarkers(true);
  resetDragState();
});

function dialogueBlockFromEvent(event) {
  const block = currentBlockFromEvent(event);
  return block?.type === "dialogue" ? block : null;
}

function resetDialogueBlock(block) {
  if (!block) return;
  CommandManager.execute("대화 처음으로", () => {
    block.currentNodeId = "";
    block.history = [];
  });
}

function setDialogueStage(block, stageId) {
  if (!block) return;
  CommandManager.execute("대화 온기 단계 변경", () => {
    block.warmthStage = String(stageId || "1");
    block.currentNodeId = "";
    block.history = [];
  });
}

function dialogueHasVisibleContent(node) {
  return Boolean(node?.line || node?.choices?.length);
}

function sequentialDialogueNode(block, direction = 1, fromId = "", visibleOnly = true) {
  if (!block) return null;
  const nodes = dialogueNodesForBlock(block);
  if (!nodes.length) return null;
  const current = fromId
    ? nodes.find(node => node.id === fromId)
    : activeDialogueNode(block);
  const currentIndex = nodes.findIndex(node => node.id === current?.id);
  const startIndex = currentIndex >= 0 ? currentIndex + Math.sign(direction || 1) : 0;
  for (let index = startIndex; index >= 0 && index < nodes.length; index += Math.sign(direction || 1)) {
    if (!visibleOnly || dialogueHasVisibleContent(nodes[index])) return nodes[index];
  }
  return null;
}

function resolveDialogueTarget(block, targetId, fallbackFromId = "") {
  let target = dialogueNodeById(block, targetId);
  const visited = new Set();
  while (target && !visited.has(target.id)) {
    if (!dialogueStageMatches(target.stageId, block.warmthStage)) return null;
    if (dialogueHasVisibleContent(target)) return target;
    visited.add(target.id);
    if (target.nextId) {
      target = dialogueNodeById(block, target.nextId);
      continue;
    }
    const nextVisible = sequentialDialogueNode(block, 1, target.id, true);
    if (nextVisible) return nextVisible;
    break;
  }
  const fallback = fallbackFromId ? sequentialDialogueNode(block, 1, fallbackFromId, true) : null;
  if (fallback) return fallback;
  return null;
}

function setDialogueNode(block, target, command = "대화 이동", remember = true) {
  if (!block || !target) return;
  const current = activeDialogueNode(block);
  CommandManager.execute(command, () => {
    block.history = Array.isArray(block.history) ? block.history : [];
    if (remember && current?.id && current.id !== target.id) block.history.push(current.id);
    block.history = block.history.slice(-20);
    block.currentNodeId = target.id;
  });
}

function advanceDialogueBlock(block, nextId) {
  if (!block) return;
  const targetId = String(nextId || "").trim();
  if (!targetId) {
    toast("연결된 대화 노드가 비어 있습니다.");
    return;
  }
  const current = activeDialogueNode(block);
  const target = resolveDialogueTarget(block, targetId, current?.id || "");
  if (!target) {
    toast("연결된 대화 노드를 찾을 수 없습니다.");
    return;
  }
  setDialogueNode(block, target, "대화 진행");
}

function talkDialogueBlock(block) {
  if (!block) return;
  const current = activeDialogueNode(block);
  if (!current) return;
  if (current.choices?.length) {
    toast("선택지를 골라주세요.");
    return;
  }
  const target = current.nextId
    ? resolveDialogueTarget(block, current.nextId, current.id)
    : sequentialDialogueNode(block, 1, current.id, true);
  if (!target) {
    toast("마지막 대화입니다.");
    return;
  }
  setDialogueNode(block, target, "대화하기");
}

function stepDialogueBlock(block, direction) {
  if (!block) return;
  const current = activeDialogueNode(block);
  const target = sequentialDialogueNode(block, Number(direction) || 1, current?.id || "", true);
  if (!target) return;
  setDialogueNode(block, target, "대화 순서 이동", false);
}

function calendarBlockFromEvent(event) {
  const block = currentBlockFromEvent(event);
  return block?.type === "calendar" ? block : null;
}

function setCalendarMonth(block, monthKey) {
  if (!block) return;
  CommandManager.execute("달력 월 변경", () => {
    block.month = normalizeMonthKey(monthKey);
  });
}

function shiftCalendarMonth(block, delta) {
  if (!block) return;
  setCalendarMonth(block, calendarShiftMonth(block.month, delta));
}

function findTaskDatasetRow(sheet, taskId) {
  const sheetName = sheet || "업무목록";
  const rows = ensureRows(state.datasets[sheetName] || []);
  const headerIndex = sheetHeaderIndex(rows, "업무ID");
  if (headerIndex < 0) return null;
  const header = rows[headerIndex].map(cell => String(cell || "").trim());
  const indexes = {
    id: calendarColumnIndex(header, ["업무ID", "TaskID", "ID"], 0),
    status: calendarColumnIndex(header, ["상태"], -1),
    progress: calendarColumnIndex(header, ["진행률", "진척도"], -1)
  };
  const targetId = String(taskId || "").trim();
  const rowIndex = rows.findIndex((row, index) => index > headerIndex && String(row[indexes.id] || "").trim() === targetId);
  if (rowIndex < 0) return null;
  return { sheet: sheetName, rows, rowIndex, indexes };
}

function setTaskDone(taskId, sheet, done) {
  const target = findTaskDatasetRow(sheet, taskId);
  if (!target) {
    toast("업무 데이터를 찾을 수 없습니다.");
    return false;
  }
  CommandManager.execute("업무 완료 상태 변경", () => {
    const row = target.rows[target.rowIndex];
    if (target.indexes.status >= 0) row[target.indexes.status] = done ? "완료" : "진행";
    if (target.indexes.progress >= 0) {
      const current = String(row[target.indexes.progress] || "").trim();
      row[target.indexes.progress] = done ? "100" : (current === "100" || !current ? "50" : current);
    }
    state.datasets[target.sheet] = target.rows;
  });
  toast(done ? "업무를 완료 처리했습니다." : "업무를 진행 상태로 되돌렸습니다.");
  return true;
}

const TASK_SHEET_COLUMNS = Object.freeze([
  "업무ID",
  "제목",
  "담당",
  "상태",
  "우선순위",
  "시작일",
  "마감일",
  "분류",
  "프로젝트",
  "연결일정ID",
  "진행률",
  "체크리스트",
  "메모"
]);

function ensureTaskDataset(sheet = "업무목록") {
  const sheetName = sheet || "업무목록";
  let rows = ensureRows(state.datasets[sheetName] || []);
  let headerIndex = sheetHeaderIndex(rows, "업무ID");
  if (headerIndex < 0) {
    rows = [
      ["업무 목록"],
      ["팀원별 TODO, 상태 보드, 프로젝트 달력 마감일과 연결"],
      [...TASK_SHEET_COLUMNS]
    ];
    headerIndex = 2;
  }
  let header = rows[headerIndex].map(cell => String(cell || "").trim());
  TASK_SHEET_COLUMNS.forEach(column => {
    if (header.includes(column)) return;
    header.push(column);
    rows.forEach((row, index) => {
      if (index !== headerIndex) row.push("");
    });
  });
  rows[headerIndex] = header;
  state.datasets[sheetName] = ensureRows(rows);
  header = state.datasets[sheetName][headerIndex].map(cell => String(cell || "").trim());
  const indexes = Object.fromEntries(TASK_SHEET_COLUMNS.map(column => [column, header.indexOf(column)]));
  return { sheetName, rows: state.datasets[sheetName], headerIndex, header, indexes };
}

function createAssignedTaskFromPanel(panel) {
  if (!panel) return false;
  const taskSheet = panel.dataset.taskSheet || "업무목록";
  const titleInput = panel.querySelector("[data-task-title]");
  const title = String(titleInput?.value || "").trim();
  if (!title) {
    toast("업무 내용을 먼저 입력해주세요.");
    titleInput?.focus();
    return false;
  }
  const owners = Array.from(panel.querySelectorAll("[data-task-member]:checked"))
    .map(input => String(input.value || "").trim())
    .filter(Boolean);
  if (!owners.length) {
    toast("담당 팀원을 선택해주세요.");
    return false;
  }
  const dueKey = String(panel.querySelector("[data-task-due]")?.value || "").trim();
  const priority = String(panel.querySelector("[data-task-priority]")?.value || "보통").trim() || "보통";
  const project = String(panel.querySelector("[data-task-project]")?.value || "").trim();
  const note = String(panel.querySelector("[data-task-note]")?.value || "").trim();
  CommandManager.execute("업무 배정", () => {
    const dataset = ensureTaskDataset(taskSheet);
    const values = {
      "업무ID": uid("task"),
      "제목": title,
      "담당": owners.join(", "),
      "상태": "예정",
      "우선순위": priority,
      "시작일": currentDateKey(),
      "마감일": isDateKey(dueKey) ? dueKey : "",
      "분류": "",
      "프로젝트": project,
      "연결일정ID": "",
      "진행률": "0",
      "체크리스트": "",
      "메모": note
    };
    dataset.rows.push(dataset.header.map(column => values[column] ?? ""));
    state.datasets[dataset.sheetName] = ensureRows(dataset.rows);
  });
  toast(`${owners.join(", ")}에게 업무를 배정했습니다.`);
  return true;
}

const MEETING_SHEET_COLUMNS = Object.freeze([
  "회의ID",
  "일자",
  "시간",
  "회의명",
  "참석자",
  "안건",
  "회의록",
  "결정사항",
  "상태",
  "작성일"
]);

function ensureMeetingDataset(sheet = "회의록") {
  const sheetName = sheet || "회의록";
  let rows = ensureRows(state.datasets[sheetName] || []);
  let headerIndex = sheetHeaderIndex(rows, "회의ID");
  if (headerIndex < 0) {
    rows = [
      ["회의록"],
      ["기본 회의 시간: 매주 월요일 22:00. 필요 시 회의별 일자와 시간을 따로 지정"],
      [...MEETING_SHEET_COLUMNS]
    ];
    headerIndex = 2;
  }
  let header = rows[headerIndex].map(cell => String(cell || "").trim());
  MEETING_SHEET_COLUMNS.forEach(column => {
    if (header.includes(column)) return;
    header.push(column);
    rows.forEach((row, index) => {
      if (index !== headerIndex) row.push("");
    });
  });
  rows[headerIndex] = header;
  state.datasets[sheetName] = ensureRows(rows);
  header = state.datasets[sheetName][headerIndex].map(cell => String(cell || "").trim());
  return { sheetName, rows: state.datasets[sheetName], header };
}

function selectAllMeetingAttendees(button) {
  const panel = button?.closest("[data-meeting-panel]");
  const inputs = Array.from(panel?.querySelectorAll("[data-meeting-attendee]") || []);
  inputs.forEach(input => input.checked = true);
  if (inputs.length) toast("참석자를 모두 선택했습니다.");
}

function createMeetingFromPanel(panel) {
  if (!panel) return false;
  const meetingSheet = panel.dataset.meetingSheet || "회의록";
  const dateKey = String(panel.querySelector("[data-meeting-date]")?.value || "").trim();
  if (!isDateKey(dateKey)) {
    toast("회의 날짜를 선택해주세요.");
    panel.querySelector("[data-meeting-date]")?.focus();
    return false;
  }
  const time = String(panel.querySelector("[data-meeting-time]")?.value || "22:00").trim() || "22:00";
  const title = String(panel.querySelector("[data-meeting-title]")?.value || "주간 회의").trim() || "주간 회의";
  const attendees = Array.from(panel.querySelectorAll("[data-meeting-attendee]:checked"))
    .map(input => String(input.value || "").trim())
    .filter(Boolean);
  if (!attendees.length) {
    toast("회의 참석자를 선택해주세요.");
    return false;
  }
  const selectedStatus = String(panel.querySelector("[data-meeting-status]")?.value || "예정").trim() || "예정";
  const status = typeof displayMeetingStatus === "function"
    ? displayMeetingStatus(selectedStatus, dateKey, time)
    : selectedStatus;
  const agenda = String(panel.querySelector("[data-meeting-agenda]")?.value || "").trim();
  const minutes = String(panel.querySelector("[data-meeting-minutes]")?.value || "").trim();
  const decisions = String(panel.querySelector("[data-meeting-decisions]")?.value || "").trim();
  CommandManager.execute("회의록 저장", () => {
    const dataset = ensureMeetingDataset(meetingSheet);
    const values = {
      "회의ID": uid("meeting"),
      "일자": dateKey,
      "시간": time,
      "회의명": title,
      "참석자": attendees.join(", "),
      "안건": agenda,
      "회의록": minutes,
      "결정사항": decisions,
      "상태": status,
      "작성일": currentDateKey()
    };
    dataset.rows.push(dataset.header.map(column => values[column] ?? ""));
    state.datasets[dataset.sheetName] = ensureRows(dataset.rows);
  });
  toast("회의록을 저장했습니다.");
  return true;
}

els.blocks.addEventListener("input", event => {
  if (!isEditing) return;
  const wikiField = event.target.dataset.wikiField;
  if (currentView === "wiki" && wikiField) {
    const term = currentWikiTerm();
    CommandManager.beginDraft("위키 문서 수정", `wiki:${term?.id || currentWikiKeyword}:${wikiField}`);
    updateWikiField(wikiField, event.target.innerText);
    scheduleSave();
    renderWikiNav();
    renderProjectHeader();
    return;
  }
  const block = currentBlockFromEvent(event);
  if (!block) return;
  const targetBlock = contentTargetFromEvent(event) || block;
  const targetKey = targetBlock === block ? "block" : targetBlock.id;
  const field = event.target.dataset.field;
  if (event.target.matches("[data-drawing-color]")) {
    const info = drawingTargetFromElement(event.target);
    if (!info) return;
    CommandManager.beginDraft("그림판 색상 변경", `block:${block.id}:${targetKey}:drawing-color`);
    info.target.brushColor = safeDrawingControlColor(event.target.value);
    scheduleSave();
    return;
  }
  if (event.target.matches("[data-drawing-size]")) {
    const info = drawingTargetFromElement(event.target);
    if (!info) return;
    const size = safeDrawingControlSize(event.target.value);
    CommandManager.beginDraft("그림판 굵기 변경", `block:${block.id}:${targetKey}:drawing-size`);
    info.target.brushSize = size;
    event.target.value = String(size);
    const output = event.target.closest(".drawing-size-control")?.querySelector("output");
    if (output) output.textContent = String(size);
    scheduleSave();
    return;
  }
  if (field) {
    CommandManager.beginDraft(`${labelForType(targetBlock.type)} 수정`, `block:${block.id}:${targetKey}:${field}`);
    targetBlock[field] = field === "content" && event.target.classList.contains("editable")
      ? serializeEditableContent(event.target)
      : event.target.innerText;
    scheduleSave();
    return;
  }
  if (event.target.matches("[data-media-path]")) {
    CommandManager.beginDraft(`${labelForType(targetBlock.type)} 경로 수정`, `block:${block.id}:${targetKey}:media-path`);
    targetBlock.path = event.target.value.trim();
    targetBlock.assetId = targetBlock.path.startsWith("asset:") ? targetBlock.path.slice("asset:".length) : "";
    scheduleSave();
    return;
  }
  if (event.target.matches("[data-image-width]")) {
    CommandManager.beginDraft("이미지 크기 조정", `block:${block.id}:${targetKey}:image-width`);
    const width = normalizeImageWidth(event.target.value);
    targetBlock.imageWidth = width;
    const frame = event.target.closest("[data-image-frame]");
    updateImageWidthUi(frame, event.target, frame?.querySelector("[data-image-width-output]"), width);
    scheduleSave();
    return;
  }
  if (event.target.matches("[data-code-language]")) {
    CommandManager.beginDraft("코드 언어 수정", `block:${block.id}:${targetKey}:code-language`);
    targetBlock.language = event.target.value.trim() || "text";
    scheduleSave();
    return;
  }
  if (event.target.matches("[data-code-editor]")) {
    CommandManager.beginDraft("코드 블록 수정", `block:${block.id}:${targetKey}:code`);
    targetBlock.content = event.target.value;
    const preview = event.target.closest(".code-block-wrap").querySelector(".code-preview code");
    if (preview) preview.textContent = targetBlock.content;
    scheduleSave();
    return;
  }
  const checkText = event.target.dataset.checkText;
  if (checkText !== undefined) {
    const index = Number(checkText);
    CommandManager.beginDraft("체크리스트 수정", `block:${block.id}:${targetKey}:checklist`);
    targetBlock.items = Array.isArray(targetBlock.items) ? targetBlock.items : [];
    if (targetBlock.items[index]) targetBlock.items[index].text = event.target.innerText;
    scheduleSave();
    return;
  }
  if (event.target.matches("[data-sheet-filter]")) {
    setSheetFilter(targetBlock, event.target.value);
    return;
  }
  if (event.target.matches("[data-flow-editor]")) {
    CommandManager.beginDraft("플로우차트 수정", `block:${block.id}:${targetKey}:flow`);
    targetBlock.content = event.target.value;
    const scope = event.target.closest(".content-unit") || event.target.closest(".block-body");
    const preview = scope?.querySelector(".flow-preview");
    if (preview) preview.innerHTML = renderFlow(targetBlock.content);
    scheduleSave();
    return;
  }
  if (event.target.matches("[data-mermaid-editor]")) {
    CommandManager.beginDraft("Mermaid 다이어그램 수정", `block:${block.id}:${targetKey}:mermaid`);
    targetBlock.content = event.target.value;
    renderMermaidBlocks();
    scheduleSave();
    return;
  }
  const tableCell = event.target.dataset.tableCell;
  if (tableCell) {
    CommandManager.beginDraft("표 셀 수정", `block:${block.id}:${targetKey}:table`);
    const [r, c] = tableCell.split(":").map(Number);
    targetBlock.rows = ensureRows(targetBlock.rows);
    targetBlock.rows[r][c] = sheetCellTextFromElement(event.target);
    scheduleSave();
    return;
  }
  const datasetCell = event.target.dataset.datasetCell;
  if (datasetCell) {
    CommandManager.beginDraft("데이터 셀 수정", `block:${block.id}:${targetKey}:dataset`);
    const [r, c] = datasetCell.split(":").map(Number);
    const sheet = state.datasets[targetBlock.sheet] ? targetBlock.sheet : Object.keys(state.datasets)[0] || "";
    if (!sheet) return;
    targetBlock.sheet = sheet;
    state.datasets[sheet] = ensureRows(state.datasets[sheet]);
    state.datasets[sheet][r][c] = sheetCellTextFromElement(event.target);
    scheduleSave();
  }
});

els.blocks.addEventListener("focusout", event => {
  if (event.target.closest("[data-block-id]") || event.target.dataset.wikiField) CommandManager.commitDraft({ render: false });
});

els.blocks.addEventListener("change", event => {
  if (event.target.matches("[data-task-toggle]")) {
    const didUpdate = setTaskDone(event.target.dataset.taskId, event.target.dataset.taskSheet, event.target.checked);
    if (!didUpdate) event.target.checked = !event.target.checked;
    return;
  }
  if (event.target.matches("[data-dialogue-stage]")) {
    setDialogueStage(dialogueBlockFromEvent(event), event.target.value);
    return;
  }
  if (!isEditing) return;
  const block = currentBlockFromEvent(event);
  if (!block) return;
  const targetBlock = contentTargetFromEvent(event) || block;
  if (event.target.matches("[data-inline-size]")) {
    applyParagraphSize(event.target);
    return;
  }
  if (event.target.matches("[data-inline-heading]")) {
    applyParagraphHeadingLevel(event.target);
    return;
  }
  if (event.target.matches("[data-image-input]")) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      CommandManager.execute("이미지 파일 삽입", () => {
        targetBlock.src = reader.result;
        targetBlock.caption ||= file.name;
      });
    };
    reader.readAsDataURL(file);
    return;
  }
  const checkIndex = event.target.dataset.checkItem;
  if (checkIndex !== undefined) {
    const index = Number(checkIndex);
    CommandManager.execute("체크리스트 상태 변경", () => {
      targetBlock.items = Array.isArray(targetBlock.items) ? targetBlock.items : [];
      if (targetBlock.items[index]) targetBlock.items[index].checked = event.target.checked;
    });
    return;
  }
  if (event.target.matches("[data-dataset-picker]")) {
    CommandManager.execute("데이터 블록 시트 변경", () => {
      targetBlock.sheet = event.target.value;
    });
    toast(`시트를 '${event.target.value}'(으)로 변경했습니다.`);
  }
});

els.blocks.addEventListener("click", event => {
  const inlineFormatButton = event.target.closest("[data-inline-format]");
  if (inlineFormatButton) {
    applyParagraphTool(inlineFormatButton);
    return;
  }
  const inlineHeadingButton = event.target.closest("button[data-inline-heading]");
  if (inlineHeadingButton) {
    applyParagraphHeadingLevel(inlineHeadingButton);
    return;
  }
  const inlineColorButton = event.target.closest("[data-inline-color]");
  if (inlineColorButton) {
    applyInlineColor(inlineColorButton, "color");
    return;
  }
  const inlineMarkButton = event.target.closest("[data-inline-mark]");
  if (inlineMarkButton) {
    applyInlineColor(inlineMarkButton, "mark");
    return;
  }
  const inlineClearButton = event.target.closest("[data-inline-clear]");
  if (inlineClearButton) {
    clearParagraphFormatting(inlineClearButton);
    return;
  }
  const inlineAlignButton = event.target.closest("[data-inline-align]");
  if (inlineAlignButton) {
    applyParagraphAlign(inlineAlignButton);
    return;
  }
  const editableMediaDeleteButton = event.target.closest("[data-editable-media-delete]");
  if (editableMediaDeleteButton) {
    event.preventDefault();
    deleteEditableMedia(editableMediaDeleteButton);
    return;
  }
  const wikiHomeButton = event.target.closest("[data-wiki-home]");
  if (wikiHomeButton) {
    openWikiHome();
    return;
  }
  const wikiTermButton = event.target.closest("[data-wiki-term]");
  if (wikiTermButton) {
    openTermPage(wikiTermButton.dataset.wikiTerm);
    return;
  }
  const wikiJumpButton = event.target.closest("[data-tab-id][data-jump-block]");
  if (wikiJumpButton) {
    currentView = "document";
    currentWikiKeyword = "";
    currentTabId = wikiJumpButton.dataset.tabId;
    render();
    scrollToBlock(wikiJumpButton.dataset.jumpBlock);
    return;
  }
  const termButton = event.target.closest("[data-term]");
  if (termButton) {
    openTermPage(termButton.dataset.term);
    return;
  }
  const meetingAttendeeAllButton = event.target.closest("[data-meeting-attendee-all]");
  if (meetingAttendeeAllButton) {
    selectAllMeetingAttendees(meetingAttendeeAllButton);
    return;
  }
  const taskCreateButton = event.target.closest("[data-task-create]");
  if (taskCreateButton) {
    createAssignedTaskFromPanel(taskCreateButton.closest("[data-task-assign-panel]"));
    return;
  }
  const meetingCreateButton = event.target.closest("[data-meeting-create]");
  if (meetingCreateButton) {
    event.preventDefault();
    createMeetingFromPanel(meetingCreateButton.closest("[data-meeting-panel]"));
    return;
  }
  const dialogueTalkButton = event.target.closest("[data-dialogue-talk]");
  if (dialogueTalkButton) {
    talkDialogueBlock(dialogueBlockFromEvent(event));
    return;
  }
  const dialogueStepButton = event.target.closest("[data-dialogue-step]");
  if (dialogueStepButton) {
    stepDialogueBlock(dialogueBlockFromEvent(event), dialogueStepButton.dataset.dialogueStep);
    return;
  }
  const dialogueNextButton = event.target.closest("[data-dialogue-next-id]");
  if (dialogueNextButton) {
    advanceDialogueBlock(dialogueBlockFromEvent(event), dialogueNextButton.dataset.dialogueNextId);
    return;
  }
  const dialogueResetButton = event.target.closest("[data-dialogue-reset]");
  if (dialogueResetButton) {
    resetDialogueBlock(dialogueBlockFromEvent(event));
    return;
  }
  const calendarShiftButton = event.target.closest("[data-calendar-shift]");
  if (calendarShiftButton) {
    shiftCalendarMonth(calendarBlockFromEvent(event), Number(calendarShiftButton.dataset.calendarShift));
    return;
  }
  const calendarTodayButton = event.target.closest("[data-calendar-today]");
  if (calendarTodayButton) {
    setCalendarMonth(calendarBlockFromEvent(event), currentMonthKey());
    return;
  }
  const genericInsertButton = event.target.closest("[data-block-insert-generic]");
  const genericInsertSurface = genericInsertButton?.closest("[data-insert-surface]");
  if (genericInsertButton && (!genericInsertSurface || genericInsertSurface.dataset.insertSurface === "block")) {
    const idx = Number(genericInsertButton.dataset.insertIndex);
    addBlock("generic", Number.isFinite(idx) ? idx : null);
    return;
  }
  const contentInsertButton = event.target.closest("[data-content-insert-type]");
  const contentInsertSurface = contentInsertButton?.closest("[data-insert-surface]");
  if (contentInsertButton && (!contentInsertSurface || contentInsertSurface.dataset.insertSurface === "content")) {
    if (!isEditing) return;
    const idx = Number(contentInsertButton.dataset.contentInsertIndex);
    insertContentUnit(
      contentInsertButton.dataset.contentBlockId,
      contentInsertButton.dataset.contentInsertType,
      Number.isFinite(idx) ? idx : null
    );
    return;
  }
  const drawingToolButton = event.target.closest("[data-drawing-tool]");
  if (drawingToolButton) {
    if (!isEditing) return;
    event.preventDefault();
    setDrawingTool(drawingToolButton, drawingToolButton.dataset.drawingTool);
    return;
  }
  const drawingUndoButton = event.target.closest("[data-drawing-undo]");
  if (drawingUndoButton) {
    if (!isEditing) return;
    event.preventDefault();
    restoreDrawingHistory(drawingTargetFromElement(drawingUndoButton));
    return;
  }
  const drawingClearButton = event.target.closest("[data-drawing-clear]");
  if (drawingClearButton) {
    if (!isEditing) return;
    event.preventDefault();
    clearDrawingBoard(drawingClearButton);
    return;
  }
  if (!isEditing) return;
  const article = event.target.closest("[data-block-id]");
  const block = currentBlockFromEvent(event);
  if (!article || !block) return;
  const unit = contentUnitFromElement(event.target);
  const targetBlock = unit || block;
  const contentAction = event.target.closest("[data-content-action]")?.dataset.contentAction;
  if (contentAction === "delete" && unit) {
    deleteContentUnit(block, unit.id);
    return;
  }
  if (event.target.matches("[data-selected-term-create]")) {
    createKeywordFromSelection(block.id);
    return;
  }
  if (event.target.matches("[data-image-remove]")) {
    if (unit) {
      deleteContentUnit(block, unit.id);
    } else {
      deleteBlock(block.id);
    }
    return;
  }
  if (event.target.matches("[data-image-file-select]")) {
    openImageFilePicker(block, "image-block", unit?.id || "");
    return;
  }
  if (event.target.matches("[data-video-file-select]")) {
    openMediaFilePicker(block, "video-block", unit?.id || "");
    return;
  }
  if (event.target.matches("[data-attachment-file-select]")) {
    openMediaFilePicker(block, "attachment-block", unit?.id || "");
    return;
  }
  if (event.target.matches("[data-check-add]")) {
    CommandManager.execute("체크 항목 추가", () => {
      targetBlock.items = Array.isArray(targetBlock.items) ? targetBlock.items : [];
      targetBlock.items.push({ id: uid("check"), text: "새 항목", checked: false });
    });
    toast("체크 항목을 추가했습니다.");
    return;
  }
  const blockActionButton = event.target.closest("[data-block-action]");
  const action = blockActionButton?.dataset.blockAction;
  if (action === "add-table") {
    const insertIndex = block.type === "generic" && Array.isArray(block.items) ? block.items.length : 1;
    insertContentUnit(block.id, "table", insertIndex);
    return;
  }
  if (action === "duplicate") { duplicateBlock(block.id); return; }
  if (action === "delete") { deleteBlock(block.id); return; }
  const tableAction = event.target.dataset.tableAction;
  const sheetScope = event.target.closest(".content-unit") || article;
  if (tableAction === "sort-asc") { setSheetSort(targetBlock, "asc", sheetScope); return; }
  if (tableAction === "sort-desc") { setSheetSort(targetBlock, "desc", sheetScope); return; }
  if (tableAction === "clear-view") { clearSheetView(targetBlock); return; }
  if (tableAction === "insert-image") { openSheetImageFilePicker(block, targetBlock, "table", unit?.id || ""); return; }
  if (tableAction === "add-row") { CommandManager.execute("표 행 추가", () => addTableRow(targetBlock)); toast("행을 추가했습니다."); return; }
  if (tableAction === "add-col") { CommandManager.execute("표 열 추가", () => addTableCol(targetBlock)); toast("열을 추가했습니다."); return; }
  if (tableAction === "delete-row") { deleteTableRow(targetBlock); return; }
  if (tableAction === "delete-col") { deleteTableCol(targetBlock); return; }
  if (tableAction === "export") { exportRowsCsv(targetBlock.rows, "table.csv"); toast("CSV 파일을 저장했습니다."); return; }
  if (tableAction === "export-xlsx") { exportTableWorkbook(targetBlock); return; }
  if (tableAction === "import") { openTableFilePicker(block, unit?.id || ""); return; }
  const datasetAction = event.target.dataset.datasetAction;
  const activeSheet = state.datasets[targetBlock.sheet] ? targetBlock.sheet : Object.keys(state.datasets)[0] || "";
  if (datasetAction === "sort-asc") { setSheetSort(targetBlock, "asc", sheetScope); return; }
  if (datasetAction === "sort-desc") { setSheetSort(targetBlock, "desc", sheetScope); return; }
  if (datasetAction === "clear-view") { clearSheetView(targetBlock); return; }
  if (datasetAction === "insert-image") { openSheetImageFilePicker(block, targetBlock, "dataset", unit?.id || "", activeSheet); return; }
  if (datasetAction === "add-row") { CommandManager.execute("데이터 행 추가", () => { targetBlock.sheet = activeSheet; addDatasetRow(activeSheet); }); toast("행을 추가했습니다."); return; }
  if (datasetAction === "add-col") { CommandManager.execute("데이터 열 추가", () => { targetBlock.sheet = activeSheet; addDatasetCol(activeSheet); }); toast("열을 추가했습니다."); return; }
  if (datasetAction === "delete-row") { deleteDatasetRow(activeSheet); return; }
  if (datasetAction === "delete-col") { deleteDatasetCol(activeSheet); return; }
  if (datasetAction === "export" && activeSheet) { exportRowsCsv(state.datasets[activeSheet], `${activeSheet}.csv`); toast("CSV 파일을 저장했습니다."); return; }
  if (event.target.matches("[data-flow-sample]")) {
    CommandManager.execute("플로우 샘플 추가", () => {
      targetBlock.content = `${targetBlock.content || "시작 -> 행동 -> 변화"}\n새 노드 -> 다음 노드`;
    });
    toast("플로우 샘플을 추가했습니다.");
    return;
  }
  if (event.target.matches("[data-mermaid-sample]")) {
    CommandManager.execute("Mermaid 샘플 적용", () => {
      targetBlock.content = defaultMermaid();
    });
    toast("Mermaid 샘플을 적용했습니다.");
  }
});

document.querySelectorAll("[data-add-block]").forEach(button => {
  button.addEventListener("click", () => addBlock(button.dataset.addBlock));
});

document.getElementById("addTab")?.addEventListener("click", addTab);
document.getElementById("renameTab")?.addEventListener("click", renameTab);
document.getElementById("duplicateTab")?.addEventListener("click", duplicateTab);
document.getElementById("deleteTab")?.addEventListener("click", deleteTab);
document.getElementById("addDatasetBlock")?.addEventListener("click", addDatasetBlock);
els.wikiHome?.addEventListener("click", openWikiHome);
els.wikiKeywordList?.addEventListener("click", event => {
  const button = event.target.closest("[data-wiki-term]");
  if (button) openTermPage(button.dataset.wikiTerm);
});
document.getElementById("modeToggle").addEventListener("click", () => {
  if (isEditing) {
    CommandManager.commitDraft({ render: false });
    saveNow();
  }
  setMode(!isEditing);
  render();
  toast(isEditing ? "편집 모드입니다." : "보기 모드입니다.");
});
els.undoCommand.addEventListener("click", () => CommandManager.undo());
els.redoCommand.addEventListener("click", () => CommandManager.redo());
document.getElementById("manualSave").addEventListener("click", saveProjectToFile);
document.getElementById("exportJson").addEventListener("click", exportJson);
document.getElementById("exportHtml").addEventListener("click", exportCurrentHtml);
document.getElementById("exportMarkdown").addEventListener("click", exportMarkdown);
document.getElementById("exportSheetCsv")?.addEventListener("click", () => { exportSelectedCsv(); toast("CSV 파일을 저장했습니다."); });
document.getElementById("exportWorkbook")?.addEventListener("click", exportWorkbook);
els.deleteDatasetSheet?.addEventListener("click", deleteDatasetSheet);
document.getElementById("openTerms").addEventListener("click", () => openTermPanel(""));
document.getElementById("closeTerms").addEventListener("click", closeTermPanel);
document.getElementById("saveTerm").addEventListener("click", saveTermFromForm);
els.termSearch.addEventListener("input", () => renderTermResults(els.termSearch.value));
els.termResults.addEventListener("click", event => {
  const button = event.target.closest("[data-term-open]");
  if (button) openTermPage(button.dataset.termOpen);
});
els.imageFilePicker.addEventListener("change", async event => {
  const file = event.target.files[0];
  if (file) await insertSelectedImageFile(file);
  event.target.value = "";
});
els.mediaFilePicker.addEventListener("change", async event => {
  const file = event.target.files[0];
  if (file) await insertSelectedMediaFile(file);
  event.target.value = "";
});
els.tableFilePicker?.addEventListener("change", async event => {
  const file = event.target.files[0];
  if (file) await importTableFile(file);
  event.target.value = "";
});
document.getElementById("importProject").addEventListener("change", event => {
  const file = event.target.files[0];
  if (file) importProjectFile(file);
  event.target.value = "";
});
document.getElementById("importDataFile")?.addEventListener("change", event => {
  const file = event.target.files[0];
  if (file) importDataFile(file);
  event.target.value = "";
});
document.getElementById("resetAll")?.addEventListener("click", () => {
  showCustomConfirm({
    message: "저장된 수정 내용을 초기 상태로 되돌릴까요?",
    onConfirm: () => {
      CommandManager.execute("전체 초기화", () => {
        localStorage.removeItem(STORAGE_KEY);
        state = normalizeState(readEmbeddedState());
        currentView = "document";
        currentWikiKeyword = "";
        currentTabId = documentTabs()[0]?.id || "";
      });
      toast("초기 상태로 되돌렸습니다.");
    }
  });
});

document.addEventListener("selectionchange", () => {
  if (isEditing) {
    rememberParagraphFormatSelection();
    rememberTextSelection();
    updateFloatingToolbar();
  }
});

document.addEventListener("keydown", event => {
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  
  if (mod) {
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      CommandManager.undo();
    }
    if (key === "y" || (key === "z" && event.shiftKey)) {
      event.preventDefault();
      CommandManager.redo();
    }
    if (key === "s") {
      event.preventDefault();
      saveProjectToFile();
    }
  }
});

// Tab List Inline Rename Events
els.tabList.addEventListener("dblclick", event => {
  if (!isEditing) return;
  const button = event.target.closest("[data-tab-id]");
  if (button) {
    beginTabRename(button.dataset.tabId);
  }
});

els.tabList.addEventListener("keydown", event => {
  const input = event.target.closest("[data-tab-rename-input]");
  if (!input) return;
  if (event.key === "Enter") {
    event.preventDefault();
    const tabId = input.dataset.tabRenameInput;
    const newTitle = input.value.trim();
    if (newTitle) {
      CommandManager.execute("탭 이름 변경", () => {
        const tab = state.tabs.find(t => t.id === tabId);
        if (tab) tab.title = newTitle;
      });
    }
    editingTabId = "";
    render();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    editingTabId = "";
    render();
  }
});

els.tabList.addEventListener("focusout", event => {
  const input = event.target.closest("[data-tab-rename-input]");
  if (!input) return;
  const tabId = input.dataset.tabRenameInput;
  const newTitle = input.value.trim();
  if (newTitle) {
    CommandManager.execute("탭 이름 변경", () => {
      const tab = state.tabs.find(t => t.id === tabId);
      if (tab) tab.title = newTitle;
    });
  }
  editingTabId = "";
  render();
});

// Focus Tracker
els.blocks.addEventListener("focusin", event => {
  const block = currentBlockFromEvent(event);
  if (block) lastFocusedBlockId = block.id;
  const targetBlock = contentTargetFromEvent(event) || block;
  const tableCell = event.target.dataset.tableCell;
  const datasetCell = event.target.dataset.datasetCell;
  if (tableCell) {
    const [r, c] = tableCell.split(":").map(Number);
    lastFocusedTableCell = { blockId: targetBlock?.id || block?.id || "", row: r, col: c, type: "table" };
  } else if (datasetCell) {
    const [r, c] = datasetCell.split(":").map(Number);
    lastFocusedTableCell = { blockId: targetBlock?.id || block?.id || "", row: r, col: c, type: "dataset" };
  }
});

els.blocks.addEventListener("paste", event => {
  if (!isEditing) return;
  const editable = event.target.closest('[data-field="content"].editable');
  if (!editable || editable.closest("table")) return;
  const block = currentBlockFromEvent(event);
  if (!block) return;
  const files = clipboardImageFiles(event);
  if (!files.length) return;
  const range = editableRange(editable);
  event.preventDefault();
  hideSlashPalette();
  const unit = contentUnitFromElement(editable);
  pasteClipboardImages(block.id, unit?.id || "", files, editable, range).catch(err => {
    console.error(err);
    toast("클립보드 이미지를 붙여넣지 못했습니다.");
  });
});

// Input handling for slash command /
els.blocks.addEventListener("input", event => {
  if (!isEditing) return;
  const editable = event.target.closest(".editable");
  if (!editable) return;
  
  const text = editable.innerText;
  const lastSlashIdx = text.lastIndexOf("/");
  if (lastSlashIdx >= 0) {
    if (!slashPaletteVisible) {
      showSlashPalette(editable);
    }
    const query = text.slice(lastSlashIdx + 1);
    filterSlashPaletteItems(query);
  } else if (slashPaletteVisible) {
    hideSlashPalette();
  }
});

function getCaretCharacterOffsetWithin(element) {
  let caretOffset = 0;
  const doc = element.ownerDocument || element.document;
  const win = doc.defaultView || doc.parentWindow;
  const sel = win.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    caretOffset = preCaretRange.toString().length;
  }
  return caretOffset;
}

// Blocks keydown (Enter, Backspace, Tab, Slash Palette navigation, Arrow Up/Down navigation)
els.blocks.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && event.target.closest("[data-meeting-panel]")) {
    event.preventDefault();
    createMeetingFromPanel(event.target.closest("[data-meeting-panel]"));
    return;
  }
  if (event.key === "Enter" && event.target.matches("[data-task-title]")) {
    event.preventDefault();
    createAssignedTaskFromPanel(event.target.closest("[data-task-assign-panel]"));
    return;
  }
  const editable = event.target.closest(".editable");
  if (!editable) return;
  
  const block = currentBlockFromEvent(event);
  if (!block) return;
  
  // Slash palette active navigation
  if (slashPaletteVisible) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filteredSlashItems.length > 0) {
        slashPaletteSelectedIndex = (slashPaletteSelectedIndex + 1) % filteredSlashItems.length;
        renderSlashPaletteItems();
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filteredSlashItems.length > 0) {
        slashPaletteSelectedIndex = (slashPaletteSelectedIndex - 1 + filteredSlashItems.length) % filteredSlashItems.length;
        renderSlashPaletteItems();
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      handleSlashPaletteSelect();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      hideSlashPalette();
      return;
    }
  }
  
  // Arrow Up Block Focus Navigation
  if (event.key === "ArrowUp") {
    if (editable.dataset.field === "content" && ["heading", "text", "callout", "quote"].includes(block.type)) {
      const offset = getCaretCharacterOffsetWithin(editable);
      if (offset === 0) {
        event.preventDefault();
        const tab = getCurrentTab();
        const currIdx = tab.blocks.findIndex(b => b.id === block.id);
        if (currIdx > 0) {
          const prevBlock = tab.blocks[currIdx - 1];
          const prevEl = document.getElementById(`block-${prevBlock.id}`)?.querySelector('.editable');
          if (prevEl) {
            prevEl.focus();
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(prevEl);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
            return;
          }
        }
      }
    }
  }
  
  // Arrow Down Block Focus Navigation
  if (event.key === "ArrowDown") {
    if (editable.dataset.field === "content" && ["heading", "text", "callout", "quote"].includes(block.type)) {
      const offset = getCaretCharacterOffsetWithin(editable);
      const textLen = editable.innerText.replace(/\n/g, "").length;
      if (offset >= textLen) {
        event.preventDefault();
        const tab = getCurrentTab();
        const currIdx = tab.blocks.findIndex(b => b.id === block.id);
        if (currIdx >= 0 && currIdx < tab.blocks.length - 1) {
          const nextBlock = tab.blocks[currIdx + 1];
          const nextEl = document.getElementById(`block-${nextBlock.id}`)?.querySelector('.editable');
          if (nextEl) {
            nextEl.focus();
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(nextEl);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            return;
          }
        }
      }
    }
  }
  
  // Tab key indent
  if (event.key === "Tab") {
    event.preventDefault();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const textNode = document.createTextNode("  ");
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      sel.removeAllRanges();
      sel.addRange(range);
      editable.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return;
  }
  
  // Backspace key -> Delete block if empty
  if (event.key === "Backspace") {
    if (editable.dataset.field === "content" && ["heading", "text", "callout", "quote"].includes(block.type)) {
      if (!editable.innerText.trim()) {
        event.preventDefault();
        const tab = getCurrentTab();
        if (tab.blocks.length > 1) {
          const currIdx = tab.blocks.findIndex(b => b.id === block.id);
          const prevBlock = tab.blocks[currIdx - 1] || tab.blocks[currIdx + 1];
          CommandManager.execute("블록 삭제", () => {
            tab.blocks = tab.blocks.filter(b => b.id !== block.id);
          });
          toast("블록을 삭제했습니다.");
          if (prevBlock) {
            lastFocusedBlockId = prevBlock.id;
            render();
            const prevEl = document.getElementById(`block-${prevBlock.id}`)?.querySelector('.editable');
            if (prevEl) {
              prevEl.focus();
              const range = document.createRange();
              const sel = window.getSelection();
              range.selectNodeContents(prevEl);
              range.collapse(false);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          } else {
            render();
          }
        }
      }
    }
  }
});

// Slash Palette click handler
els.slashPalette.addEventListener("click", event => {
  const itemEl = event.target.closest(".slash-palette-item");
  if (itemEl) {
    const type = itemEl.dataset.slashType;
    const idx = slashPaletteItems.findIndex(item => item.type === type);
    if (idx >= 0) {
      slashPaletteSelectedIndex = idx;
      handleSlashPaletteSelect();
    }
  }
});

// Floating toolbar actions
document.getElementById("formatBold").addEventListener("mousedown", event => {
  event.preventDefault();
  applyFormat("**");
});
document.getElementById("formatItalic").addEventListener("mousedown", event => {
  event.preventDefault();
  applyFormat("*");
});
document.getElementById("formatUnderline").addEventListener("mousedown", event => {
  event.preventDefault();
  applyFormat("__");
});
document.getElementById("formatLink").addEventListener("mousedown", event => {
  event.preventDefault();
  showCustomModal({
    title: "링크 주소 입력",
    placeholder: "https://example.com",
    defaultValue: "",
    onConfirm: (url) => {
      applyFormat("[", `](${url})`);
    }
  });
});

window.addEventListener("load", renderMermaidBlocks);
window.addEventListener("beforeunload", () => {
  CommandManager.commitDraft({ render: false });
  saveNow();
});

document.addEventListener("click", event => {
  if (isEditing) return;
  if (event.defaultPrevented) return;
  const meetingCreateButton = event.target.closest("[data-meeting-create]");
  if (meetingCreateButton) {
    event.preventDefault();
    createMeetingFromPanel(meetingCreateButton.closest("[data-meeting-panel]"));
    return;
  }
  const editable = event.target.closest(".editable, .block-body");
  if (editable && event.target.closest(".block")) {
    toast("편집하려면 상단의 편집 모드로 전환하세요.");
  }
});

// Table Column Resize Event Listeners
let isResizing = false;
let currentResizeHandle = null;
let startX = 0;
let startWidth = 0;
let resizeCell = null;

document.addEventListener("mousedown", event => {
  const handle = event.target.closest(".resize-handle");
  if (!handle) return;
  
  event.preventDefault();
  isResizing = true;
  currentResizeHandle = handle;
  handle.classList.add("resizing");
  
  resizeCell = handle.closest("td") || handle.closest("th");
  startX = event.clientX;
  startWidth = resizeCell.offsetWidth;
  
  document.body.style.cursor = "col-resize";
});

document.addEventListener("mousemove", event => {
  if (!isResizing || !resizeCell) return;
  const width = startWidth + (event.clientX - startX);
  resizeCell.style.width = `${Math.max(60, width)}px`;
});

document.addEventListener("mouseup", () => {
  if (isResizing) {
    isResizing = false;
    if (currentResizeHandle) {
      currentResizeHandle.classList.remove("resizing");
    }
    currentResizeHandle = null;
    resizeCell = null;
    document.body.style.cursor = "";
  }
});

els.wikiHome?.addEventListener("click", () => { setTimeout(fadeInBlocks, 10); });

setMode(false);
render();
