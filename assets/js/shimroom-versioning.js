function versionStateNow() {
  return cloneStateWithoutVersions(state);
}

function versionLabel(version) {
  const date = new Date(version.createdAt || Date.now()).toLocaleString("ko-KR");
  return `${version.name} · ${date}`;
}

function saveNamedVersion() {
  CommandManager.commitDraft({ render: false });
  showCustomModal({
    title: "버전 이름",
    placeholder: "예: 전투 밸런스 수정 전",
    defaultValue: `버전 ${state.versions.length + 1}`,
    onConfirm: (name) => {
      CommandManager.execute("버전 저장", () => {
        state.versions.push({
          id: uid("version"),
          name,
          createdAt: new Date().toISOString(),
          note: "",
          state: versionStateNow()
        });
        state.versions = state.versions.slice(-40);
      });
      toast("현재 문서를 버전으로 저장했습니다.");
      renderVersionPanel();
    }
  });
}

function stateForVersionValue(value) {
  if (value === "current") return versionStateNow();
  return state.versions.find(version => version.id === value)?.state || versionStateNow();
}

function renderVersionOptions(selectedTarget = "current") {
  const versions = [...state.versions].reverse();
  const savedOptions = versions.map(version => `<option value="${escapeHtml(version.id)}">${escapeHtml(versionLabel(version))}</option>`).join("");
  els.versionBaseSelect.innerHTML = savedOptions;
  els.versionTargetSelect.innerHTML = `<option value="current">현재 작업본</option>${savedOptions}`;
  if (state.versions.length) els.versionBaseSelect.value = state.versions.at(-1).id;
  els.versionTargetSelect.value = selectedTarget;
}

function flattenBlock(block, tab, index, out) {
  const label = `${tab.title} / ${index + 1}. ${labelForType(block.type)}`;
  out[`문서/${label}/타입`] = block.type;
  if ("content" in block) out[`문서/${label}/내용`] = block.content || "";
  if ("caption" in block) out[`문서/${label}/캡션`] = block.caption || "";
  if ("path" in block) out[`문서/${label}/경로`] = block.path || "";
  if (Array.isArray(block.items)) {
    block.items.forEach((item, itemIndex) => {
      out[`문서/${label}/체크 ${itemIndex + 1}`] = `${item.checked ? "[x]" : "[ ]"} ${item.text || ""}`;
    });
  }
  if (Array.isArray(block.rows)) {
    ensureRows(block.rows).forEach((row, r) => {
      row.forEach((cell, c) => {
        out[`문서/${label}/표 ${sheetColumnLabel(c)}${r + 1}`] = cell || "";
      });
    });
  }
}

function flattenStateForDiff(source) {
  const out = {};
  out["문서/제목"] = source.title || "";
  out["문서/설명"] = source.subtitle || "";
  (source.tabs || []).filter(tab => !isWikiLegacyTab(tab)).forEach((tab, tabIndex) => {
    out[`문서/탭 ${tabIndex + 1}/이름`] = tab.title || "";
    (tab.blocks || []).forEach((block, blockIndex) => flattenBlock(block, tab, blockIndex, out));
  });
  Object.entries(source.datasets || {}).forEach(([sheet, rows]) => {
    ensureRows(rows).forEach((row, r) => {
      row.forEach((cell, c) => {
        out[`데이터/${sheet}/${sheetColumnLabel(c)}${r + 1}`] = cell || "";
      });
    });
  });
  (source.glossary || []).forEach(term => {
    out[`위키/${term.keyword}/설명`] = term.description || "";
    out[`위키/${term.keyword}/별칭`] = (term.aliases || []).join(", ");
  });
  (source.assets || []).forEach(asset => {
    out[`파일/${asset.name}/종류`] = asset.kind || "";
    out[`파일/${asset.name}/크기`] = fileSizeLabel(asset.size || 0);
  });
  return out;
}

function createDiff(baseState, targetState) {
  const before = flattenStateForDiff(baseState);
  const after = flattenStateForDiff(targetState);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort((a, b) => a.localeCompare(b, "ko"));
  return keys.flatMap(key => {
    const oldValue = before[key];
    const newValue = after[key];
    if (oldValue === newValue) return [];
    if (oldValue === undefined) return [{ type: "added", key, oldValue: "", newValue }];
    if (newValue === undefined) return [{ type: "removed", key, oldValue, newValue: "" }];
    return [{ type: "changed", key, oldValue, newValue }];
  });
}

function summarizeDiff(diff) {
  return diff.reduce((summary, change) => {
    summary[change.type] += 1;
    return summary;
  }, { added: 0, removed: 0, changed: 0 });
}

function renderChange(change) {
  const typeLabel = change.type === "added" ? "추가" : change.type === "removed" ? "삭제" : "수정";
  return `
    <article class="diff-item ${escapeHtml(change.type)}">
      <div class="diff-item-head">
        <strong>${escapeHtml(change.key)}</strong>
        <span>${typeLabel}</span>
      </div>
      ${change.type !== "added" ? `<pre class="diff-old">${escapeHtml(String(change.oldValue || ""))}</pre>` : ""}
      ${change.type !== "removed" ? `<pre class="diff-new">${escapeHtml(String(change.newValue || ""))}</pre>` : ""}
    </article>
  `;
}

function renderDiff() {
  const baseState = stateForVersionValue(els.versionBaseSelect.value);
  const targetState = stateForVersionValue(els.versionTargetSelect.value);
  const diff = createDiff(baseState, targetState);
  const summary = summarizeDiff(diff);
  els.versionSummary.innerHTML = `
    <span class="diff-pill added">추가 ${summary.added}</span>
    <span class="diff-pill removed">삭제 ${summary.removed}</span>
    <span class="diff-pill changed">수정 ${summary.changed}</span>
    <span class="diff-pill">총 ${diff.length}</span>
  `;
  els.versionDiff.innerHTML = diff.length
    ? diff.slice(0, 140).map(renderChange).join("") + (diff.length > 140 ? `<div class="empty">표시 범위를 넘어 ${diff.length - 140}개 변경이 더 있습니다.</div>` : "")
    : `<div class="empty">두 버전 사이에 변경 사항이 없습니다.</div>`;
}

function restoreVersion(versionId) {
  const version = state.versions.find(item => item.id === versionId);
  if (!version) return;
  showCustomConfirm({
    message: `'${version.name}' 버전으로 현재 문서를 복원할까요? 버전 기록 자체는 유지됩니다.`,
    onConfirm: () => {
      const versions = structuredClone(state.versions);
      CommandManager.execute("버전 복원", () => {
        state = normalizeState({ ...structuredClone(version.state), versions });
        currentView = "document";
        currentWikiKeyword = "";
        currentTabId = documentTabs()[0]?.id || "";
      });
      render();
      renderVersionPanel();
      toast("선택한 버전으로 복원했습니다.");
    }
  });
}

function renderVersionList() {
  els.versionList.innerHTML = [...state.versions].reverse().map(version => `
    <article class="version-card">
      <button data-version-select="${escapeHtml(version.id)}" type="button">
        <strong>${escapeHtml(version.name)}</strong>
        <small>${escapeHtml(new Date(version.createdAt).toLocaleString("ko-KR"))}</small>
      </button>
      <button class="danger edit-only" data-version-restore="${escapeHtml(version.id)}" type="button">복원</button>
    </article>
  `).join("");
}

function renderVersionPanel() {
  if (!els.versionPanel) return;
  renderVersionOptions(els.versionTargetSelect?.value || "current");
  renderDiff();
  renderVersionList();
}

function openVersionPanel() {
  els.versionPanel.classList.remove("hidden");
  renderVersionPanel();
}

function closeVersionPanel() {
  els.versionPanel.classList.add("hidden");
}

document.getElementById("openHistory")?.addEventListener("click", openVersionPanel);
document.getElementById("closeHistory")?.addEventListener("click", closeVersionPanel);
document.getElementById("saveVersion")?.addEventListener("click", saveNamedVersion);
document.getElementById("refreshVersionDiff")?.addEventListener("click", renderVersionPanel);
els.versionBaseSelect?.addEventListener("change", renderDiff);
els.versionTargetSelect?.addEventListener("change", renderDiff);
els.versionList?.addEventListener("click", event => {
  const select = event.target.closest("[data-version-select]");
  if (select) {
    els.versionBaseSelect.value = select.dataset.versionSelect;
    renderDiff();
    return;
  }
  const restore = event.target.closest("[data-version-restore]");
  if (restore) restoreVersion(restore.dataset.versionRestore);
});
