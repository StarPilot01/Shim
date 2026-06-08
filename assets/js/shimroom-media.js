const EMBEDDED_MEDIA_LIMIT = 12 * 1024 * 1024;
let pendingMediaInsert = null;

function findAssetById(assetId) {
  return state.assets.find(asset => asset.id === assetId) || null;
}

function assetPath(assetId) {
  return assetId ? `asset:${assetId}` : "";
}

function assetFromPath(path) {
  const value = String(path || "");
  if (!value.startsWith("asset:")) return null;
  return findAssetById(value.slice("asset:".length));
}

function resolveAssetPath(path) {
  const asset = assetFromPath(path);
  if (!asset) return "";
  return asset.dataUrl || asset.transientUrl || "";
}

function mediaKindForFile(file) {
  const lowerName = String(file?.name || "").toLowerCase();
  const mime = String(file?.type || "").toLowerCase();
  if (mime.startsWith("image/") || /\.(gif|png|jpe?g|webp|bmp|heif)$/i.test(lowerName)) return "image";
  if (mime.startsWith("video/") || /\.(mp4|webm|mov|avi|wmv|mpg|mpeg)$/i.test(lowerName)) return "video";
  if (mime.startsWith("text/") || /\.(txt|md|csv|tsv|json)$/i.test(lowerName)) return "text";
  return "file";
}

function fileSizeLabel(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function readFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

async function createAssetFromFile(file) {
  const kind = mediaKindForFile(file);
  const asset = {
    id: uid("asset"),
    name: file.name || "untitled",
    kind,
    mime: file.type || "application/octet-stream",
    size: file.size || 0,
    dataUrl: "",
    text: "",
    transientUrl: "",
    createdAt: new Date().toISOString()
  };
  if (kind === "text") {
    asset.text = await readFileText(file);
  } else if ((file.size || 0) <= EMBEDDED_MEDIA_LIMIT) {
    asset.dataUrl = await readFileDataUrl(file);
  } else {
    asset.transientUrl = URL.createObjectURL(file);
  }
  return asset;
}

function openMediaFilePicker(block, target = "attachment-block", unitId = "") {
  if (!block || !els.mediaFilePicker) return;
  pendingMediaInsert = { blockId: block.id, unitId, target };
  els.mediaFilePicker.value = "";
  els.mediaFilePicker.click();
}

async function insertSelectedMediaFile(file) {
  if (!file || !pendingMediaInsert) return;
  const block = findBlockById(pendingMediaInsert.blockId);
  if (!block) return;
  const target = pendingMediaInsert.target;
  const unit = pendingMediaInsert.unitId
    ? block.items?.find(item => item.id === pendingMediaInsert.unitId)
    : null;
  const targetBlock = unit || block;
  pendingMediaInsert = null;
  const asset = await createAssetFromFile(file);
  CommandManager.execute("파일 업로드", () => {
    if (!findAssetById(asset.id)) state.assets.push(asset);
    if (target === "text") {
      if (asset.kind === "text") {
        targetBlock.content = `${targetBlock.content || ""}${targetBlock.content ? "\n\n" : ""}${asset.text}`;
      } else if (asset.kind === "image") {
        targetBlock.content = `${targetBlock.content || ""}${targetBlock.content ? "\n" : ""}[[image:${assetPath(asset.id)}|${asset.name}]]`;
      } else if (asset.kind === "video") {
        targetBlock.content = `${targetBlock.content || ""}${targetBlock.content ? "\n" : ""}[[video:${assetPath(asset.id)}|${asset.name}]]`;
      } else {
        targetBlock.content = `${targetBlock.content || ""}${targetBlock.content ? "\n" : ""}[[file:${assetPath(asset.id)}|${asset.name}]]`;
      }
      return;
    }
    if (target === "image-block") {
      targetBlock.type = "image";
      targetBlock.assetId = asset.id;
      targetBlock.path = assetPath(asset.id);
      targetBlock.caption = targetBlock.caption && targetBlock.caption !== "캡션" ? targetBlock.caption : asset.name;
      delete targetBlock.src;
      return;
    }
    if (target === "video-block") {
      targetBlock.type = "video";
      targetBlock.assetId = asset.id;
      targetBlock.path = assetPath(asset.id);
      targetBlock.caption = targetBlock.caption || asset.name;
      return;
    }
    targetBlock.type = "attachment";
    targetBlock.assetId = asset.id;
    targetBlock.path = assetPath(asset.id);
    targetBlock.caption = targetBlock.caption || asset.name;
  });
  if (!asset.dataUrl && !asset.text) {
    toast("대형 파일은 현재 브라우저 세션에서 미리보기로만 유지됩니다.");
  } else {
    toast(`${asset.name} 파일을 업로드했습니다.`);
  }
}

function assetFromBlock(block) {
  return findAssetById(block.assetId) || assetFromPath(block.path) || null;
}

function mediaSourceForBlock(block) {
  const asset = assetFromBlock(block);
  if (asset) return asset.dataUrl || asset.transientUrl || "";
  return normalizeImageSrc(block.path || block.src || "");
}

function renderAssetMeta(asset) {
  if (!asset) return "";
  const stored = asset.dataUrl || asset.text ? "저장됨" : "세션 미리보기";
  return `<small>${escapeHtml(asset.kind)} · ${escapeHtml(fileSizeLabel(asset.size))} · ${escapeHtml(stored)}</small>`;
}

function imageWidthForTarget(target) {
  return normalizeImageWidth(target?.imageWidth);
}

function renderImageSizeControl(target) {
  if (!isEditing) return "";
  const width = imageWidthForTarget(target);
  return `
    <label class="image-size-control edit-only">
      <span>크기</span>
      <input type="range" min="20" max="100" step="5" value="${width}" data-image-width>
      <output data-image-width-output>${width}%</output>
    </label>
  `;
}

function renderImageBlock(block) {
  const src = mediaSourceForBlock(block);
  const label = block.caption || assetFromBlock(block)?.name || "첨부 이미지";
  const width = imageWidthForTarget(block);
  return `
    <div class="image-frame media-frame" data-image-frame style="--image-width:${width}%">
      ${src ? `
        <div class="image-resize-box" data-image-resize-box>
          <img src="${escapeHtml(src)}" alt="${escapeHtml(label)}">
          ${isEditing ? `<span class="image-resize-handle edit-only" data-image-resize-handle title="드래그해서 이미지 크기 조절" aria-hidden="true"></span>` : ""}
        </div>
      ` : `<div class="empty">이미지는 글쓰기 블록의 이미지 아이콘으로 삽입하세요.</div>`}
      ${renderImageSizeControl(block)}
      <div class="inline-tools edit-only">
        <button class="danger" data-image-remove type="button">이미지 삭제</button>
        <button data-image-file-select>이미지 업로드</button>
      </div>
      ${renderAssetMeta(assetFromBlock(block))}
      <div class="caption editable" contenteditable="${editAttr()}" data-field="caption">${escapeEditable(block.caption || "캡션")}</div>
    </div>
  `;
}

function renderVideoBlock(block) {
  const src = mediaSourceForBlock(block);
  const asset = assetFromBlock(block);
  const label = block.caption || asset?.name || "첨부 동영상";
  return `
    <div class="media-frame video-frame">
      ${src ? `<video src="${escapeHtml(src)}" controls preload="metadata"></video>` : `<div class="empty">동영상 파일을 업로드하거나 URL/경로를 입력하세요.</div>`}
      ${renderAssetMeta(asset)}
      <div class="inline-tools edit-only">
        <button data-video-file-select>동영상 업로드</button>
      </div>
      <label class="field edit-only">동영상 경로
        <input class="text-field" data-media-path value="${escapeHtml(block.path || "")}" placeholder="sample.mp4 또는 https://...">
      </label>
      <div class="caption editable" contenteditable="${editAttr()}" data-field="caption">${escapeEditable(label)}</div>
    </div>
  `;
}

function renderAttachmentBlock(block) {
  const asset = assetFromBlock(block);
  const src = mediaSourceForBlock(block);
  const name = asset?.name || block.path || "첨부 파일";
  const textPreview = asset?.text ? asset.text.slice(0, 2400) : "";
  return `
    <div class="attachment-frame">
      <div class="attachment-card">
        <div>
          <strong>${escapeHtml(name)}</strong>
          ${renderAssetMeta(asset)}
        </div>
        ${src ? `<a class="attachment-download" href="${escapeHtml(src)}" download="${escapeHtml(name)}">열기</a>` : ""}
      </div>
      ${textPreview ? `<pre class="text-file-preview">${escapeHtml(textPreview)}${asset.text.length > textPreview.length ? "\n..." : ""}</pre>` : ""}
      <div class="inline-tools edit-only">
        <button data-attachment-file-select>파일/글 업로드</button>
      </div>
      <label class="field edit-only">파일 경로
        <input class="text-field" data-media-path value="${escapeHtml(block.path || "")}" placeholder="파일명, URL, asset:id">
      </label>
      <div class="caption editable" contenteditable="${editAttr()}" data-field="caption">${escapeEditable(block.caption || "첨부 설명")}</div>
    </div>
  `;
}
