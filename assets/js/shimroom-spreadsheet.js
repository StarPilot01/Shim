function detectHeaderIndex(rows) {
  const normalized = ensureRows(rows);
  const index = normalized.findIndex(row => row.filter(cell => String(cell ?? "").trim()).length >= 2);
  return index >= 0 ? index : 0;
}

function sheetColumnLabel(index) {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const mod = (n - 1) % 26;
    label = String.fromCharCode(65 + mod) + label;
    n = Math.floor((n - mod) / 26);
  }
  return label;
}

function parseCellRef(ref) {
  const match = String(ref || "").toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  const col = [...match[1]].reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const row = Number(match[2]) - 1;
  return { row, col };
}

function numericCellValue(rows, row, col, visited = new Set()) {
  const key = `${row}:${col}`;
  if (visited.has(key)) return 0;
  visited.add(key);
  const value = rows[row]?.[col] ?? "";
  if (String(value).trim().startsWith("=")) {
    const evaluated = evaluateFormula(String(value), rows, visited);
    return Number(evaluated) || 0;
  }
  const num = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(num) ? num : 0;
}

function rangeValues(rangeRef, rows, visited) {
  const [startRef, endRef] = String(rangeRef).split(":");
  const start = parseCellRef(startRef);
  const end = parseCellRef(endRef || startRef);
  if (!start || !end) return [];
  const values = [];
  const r0 = Math.min(start.row, end.row);
  const r1 = Math.max(start.row, end.row);
  const c0 = Math.min(start.col, end.col);
  const c1 = Math.max(start.col, end.col);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) values.push(numericCellValue(rows, r, c, visited));
  }
  return values;
}

function applyFormulaFunctions(expr, rows, visited) {
  return expr.replace(/\b(SUM|AVERAGE|AVG|MIN|MAX|COUNT)\(([^()]*)\)/gi, (_, fn, argText) => {
    const values = argText.split(",").flatMap(part => rangeValues(part.trim(), rows, visited));
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

function evaluateFormula(value, rows, visited = new Set()) {
  const source = String(value || "").trim();
  if (!source.startsWith("=")) return value;
  let expr = source.slice(1).replace(/\s+/g, "");
  expr = applyFormulaFunctions(expr, rows, visited);
  expr = expr.replace(/\b[A-Z]+\d+\b/gi, ref => {
    const cell = parseCellRef(ref);
    return cell ? String(numericCellValue(rows, cell.row, cell.col, visited)) : "0";
  });
  if (!/^[0-9+\-*/().,\s]+$/.test(expr)) return "#VALUE!";
  try {
    const result = Function(`"use strict"; return (${expr});`)();
    if (!Number.isFinite(result)) return "#VALUE!";
    return Number.isInteger(result) ? String(result) : String(Number(result.toFixed(4)));
  } catch (err) {
    return "#VALUE!";
  }
}

function renderSheetCellValue(cell, rows) {
  const value = String(cell ?? "");
  if (isEditing || !value.trim().startsWith("=")) return renderRichContent(value);
  const computed = evaluateFormula(value, rows);
  return `<span class="formula-result" title="${escapeHtml(value)}">${escapeHtml(computed)}</span>`;
}

function renderSheetCellMediaPreview(cell) {
  const media = String(cell ?? "")
    .split(/\n+/)
    .map(line => parseMediaLine(line))
    .filter(item => item?.kind === "image");
  if (!media.length) return "";
  return `
    <div class="sheet-cell-media-preview" contenteditable="false" data-sheet-cell-preview aria-hidden="true">
      ${media.map(item => {
        const src = resolveImagePath(item.path);
        const label = item.caption || item.path;
        return src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(label)}">` : "";
      }).join("")}
    </div>
  `;
}

function sheetCellTextFromElement(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll("[data-sheet-cell-preview], .resize-handle").forEach(node => node.remove());
  return clone.innerText;
}

function rowsForSheetView(rows, block) {
  const normalized = ensureRows(rows);
  const headerIndex = detectHeaderIndex(normalized);
  const query = String(block.filter || "").trim().toLowerCase();
  const pinned = normalized.slice(0, headerIndex + 1).map((row, index) => ({
    row,
    sourceIndex: index,
    isHeader: index === headerIndex
  }));
  let body = normalized.slice(headerIndex + 1).map((row, i) => ({
    row,
    sourceIndex: headerIndex + 1 + i,
    isHeader: false
  }));
  if (query) {
    body = body.filter(item => item.row.join(" ").toLowerCase().includes(query));
  }
  if (Number.isInteger(block.sortColumn) && block.sortColumn >= 0) {
    const dir = block.sortDir === "desc" ? -1 : 1;
    body.sort((a, b) => {
      const av = a.row[block.sortColumn] ?? "";
      const bv = b.row[block.sortColumn] ?? "";
      const an = Number(String(av).replace(/,/g, ""));
      const bn = Number(String(bv).replace(/,/g, ""));
      if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * dir;
      return String(av).localeCompare(String(bv), "ko", { numeric: true }) * dir;
    });
  }
  return { rows: [...pinned, ...body], headerIndex };
}

function renderSheetTools(block, kind, rows, sheetName = "") {
  const normalized = ensureRows(rows);
  const header = normalized[detectHeaderIndex(normalized)] || normalized[0] || [];
  const actionName = kind === "dataset" ? "dataset" : "table";
  const columnOptions = header.map((cell, index) => {
    const label = String(cell || sheetColumnLabel(index)).slice(0, 40);
    return `<option value="${index}" ${block.sortColumn === index ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  const filterValue = block.filter || "";
  const tableFileActions = kind === "table"
    ? `
      <button data-table-action="import" type="button">Excel/CSV 가져오기</button>
      <button data-table-action="export-xlsx" type="button">Excel 저장</button>
    `
    : "";
  return `
    <div class="${kind === "dataset" ? "dataset-tools" : "table-tools"} sheet-tools">
      ${sheetName ? `<label class="field">시트 <select data-dataset-picker>${sheetName}</select></label>` : ""}
      <label class="field sheet-filter-field">필터
        <input class="sheet-filter" data-sheet-filter type="search" value="${escapeHtml(filterValue)}" placeholder="현재 표 필터">
      </label>
      <label class="field sheet-sort-field">정렬
        <select data-sheet-sort-col aria-label="정렬 열">${columnOptions}</select>
      </label>
      <div class="sheet-action-row">
        ${tableFileActions}
        <button data-${actionName}-action="insert-image" type="button">이미지 삽입</button>
        <button data-${actionName}-action="sort-asc" type="button">오름차순</button>
        <button data-${actionName}-action="sort-desc" type="button">내림차순</button>
        <button data-${actionName}-action="clear-view" type="button">필터 해제</button>
        <button data-${actionName}-action="add-row" type="button">행 추가</button>
        <button data-${actionName}-action="add-col" type="button">열 추가</button>
        <button data-${actionName}-action="delete-row" class="danger" type="button">행 삭제</button>
        <button data-${actionName}-action="delete-col" class="danger" type="button">열 삭제</button>
        <button data-${actionName}-action="export" type="button">CSV 저장</button>
      </div>
    </div>
  `;
}

function renderSheetTable(rows, block, dataAttr) {
  const view = rowsForSheetView(rows, block);
  const normalized = ensureRows(rows);
  const columnCount = Math.max(1, ...normalized.map(row => row.length));
  const columnHeaders = Array.from({ length: columnCount }, (_, c) => `
    <th class="sheet-column-index" scope="col">${sheetColumnLabel(c)}</th>
  `).join("");
  const body = view.rows.map(item => `<tr class="${item.isHeader ? "sheet-header-row" : ""}">
    <th class="sheet-row-index" scope="row">${item.sourceIndex + 1}</th>
    ${Array.from({ length: columnCount }, (_, c) => {
    const cell = item.row[c] ?? "";
    const cellHtml = isEditing
      ? `${escapeEditable(cell)}${renderSheetCellMediaPreview(cell)}<div class="resize-handle"></div>`
      : renderSheetCellValue(cell, rows);
    return `<td contenteditable="${editAttr()}" data-${dataAttr}="${item.sourceIndex}:${c}">${cellHtml}</td>`;
  }).join("")}</tr>`).join("");
  return `
    <table class="sheet-grid">
      <thead>
        <tr class="sheet-coordinate-row">
          <th class="sheet-corner" aria-hidden="true"></th>
          ${columnHeaders}
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function setSheetFilter(block, value) {
  CommandManager.beginDraft(`${labelForType(block.type)} 필터`, `block:${block.id}:filter`);
  block.filter = value;
  scheduleSave();
  renderBlocks();
}

function setSheetSort(block, dir, scope = null) {
  const select = scope?.querySelector("[data-sheet-sort-col]")
    || document.querySelector(`#block-${CSS.escape(block.id)} [data-sheet-sort-col]`);
  const col = select ? Number(select.value) : lastFocusedTableCell.col;
  CommandManager.execute(`${labelForType(block.type)} 정렬`, () => {
    block.sortColumn = Number.isInteger(col) && col >= 0 ? col : 0;
    block.sortDir = dir;
  });
  toast(dir === "desc" ? "내림차순으로 정렬했습니다." : "오름차순으로 정렬했습니다.");
}

function clearSheetView(block) {
  CommandManager.execute(`${labelForType(block.type)} 필터 해제`, () => {
    block.filter = "";
    block.sortColumn = -1;
    block.sortDir = "asc";
  });
  toast("필터와 정렬을 해제했습니다.");
}
