import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultSource = join(process.env.USERPROFILE || "", "OneDrive", "Desktop", "개인 페이지 & 공유된 페이지");
const sourceRoot = resolve(process.argv[2] || process.env.NOTION_EXPORT_DIR || defaultSource);
const dataPath = join(projectRoot, "assets", "data", "notion-archive-data.js");
const mediaDir = join(projectRoot, "assets", "notion-media");
const mediaWebPrefix = "../assets/notion-media/";

const MEDIA_COPY_LIMIT = Number(process.env.MEDIA_COPY_LIMIT || 260);
const MEDIA_MAX_BYTES = Number(process.env.MEDIA_MAX_MB || 6) * 1024 * 1024;
const ACTIVE_BLOCK_LIMIT = Number(process.env.ARCHIVE_BLOCK_LIMIT || 120);
const SEARCH_TEXT_LIMIT = 7000;

const htmlExt = new Set([".html", ".htm"]);
const imageExt = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const mediaExt = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".mp3", ".pdf", ".xlsx"]);

const categoryDefinitions = [
  {
    id: "overview",
    label: "프로젝트 개요",
    tone: "teal",
    description: "장르, 플랫폼, 핵심 루프, 전체 방향성을 확인하는 상위 문서"
  },
  {
    id: "systems",
    label: "시스템",
    tone: "blue",
    description: "아웃게임/인게임, 성장, 재화, 카드, 피버, BM, 밸런스"
  },
  {
    id: "world",
    label: "세계관/스토리",
    tone: "violet",
    description: "세계 구조, 시놉시스, 지역, 세력, 장소와 배경"
  },
  {
    id: "characters",
    label: "캐릭터",
    tone: "rose",
    description: "주연 캐릭터, 개별 캐릭터 기획, 아트/성격/역할"
  },
  {
    id: "monsters",
    label: "몬스터",
    tone: "olive",
    description: "몬스터 리스트, 개별 몬스터, 전투 대상 데이터"
  },
  {
    id: "ui",
    label: "UI/UX",
    tone: "amber",
    description: "화면별 UI 사양, 리소스 체크, 버튼/팝업/해상도 기준"
  },
  {
    id: "data",
    label: "데이터/밸런스",
    tone: "cyan",
    description: "CSV, XLSX, 밸런스 테이블, 외부 데이터 기준"
  },
  {
    id: "production",
    label: "제작/일정",
    tone: "green",
    description: "주간 업무 보고서, 캘린더, 작업 현황, 마일스톤"
  },
  {
    id: "meetings",
    label: "회의",
    tone: "gray",
    description: "정기회의, 안건, 결정사항, 액션 아이템"
  },
  {
    id: "references",
    label: "레퍼런스",
    tone: "orange",
    description: "게임/아트/자료 레퍼런스와 비교 분석"
  },
  {
    id: "sound",
    label: "사운드",
    tone: "indigo",
    description: "BGM, 효과음, 오디오 레퍼런스와 적용 메모"
  },
  {
    id: "legacy",
    label: "보류/휴지통",
    tone: "slate",
    description: "휴지통, 구버전, 삭제 예정, 낮은 우선순위 자료"
  },
  {
    id: "docs",
    label: "기타 문서",
    tone: "neutral",
    description: "상위 분류로 묶기 어려운 일반 문서"
  }
];

const categoryMap = new Map(categoryDefinitions.map(item => [item.id, item]));

function toPosix(value) {
  return value.split(sep).join("/");
}

function stableId(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function stripTags(fragment = "") {
  return decodeHtml(String(fragment)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h1|h2|h3|tr|summary|figure)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function compactText(value = "") {
  return String(value)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function oneLine(value = "") {
  return compactText(value).replace(/\s+/g, " ").trim();
}

function pageBody(html) {
  const match = html.match(/<div class="page-body">([\s\S]*?)<\/article>/i);
  return match ? match[1] : html;
}

function pageTitle(html, fallback) {
  const match = html.match(/<h1[^>]*class="[^"]*\bpage-title\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
    || html.match(/<title>([\s\S]*?)<\/title>/i);
  return oneLine(stripTags(match?.[1] || fallback));
}

function cleanFileTitle(filePath) {
  return oneLine(filePath
    .replace(/\.[^.]+$/, "")
    .replace(/\s+[0-9a-f]{8,}.*$/i, "")
    .replace(/[_-]+/g, " "));
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

function isNoisyText(text) {
  const value = oneLine(text);
  return !value
    || value === "목차"
    || value === "숏 컷"
    || value === "데이터 테이블"
    || value === "Legacy"
    || /^https?:\/\/docs\.google\.com\/spreadsheets\//.test(value);
}

function resolveHref(href, fromFile) {
  const raw = decodeHtml(String(href || "")).trim();
  if (!raw || raw.startsWith("#") || /^(https?:|data:|mailto:|tel:)/i.test(raw)) return null;
  const withoutHash = raw.split("#")[0];
  if (!withoutHash) return null;
  const decoded = safeDecodeURIComponent(withoutHash).replace(/\//g, sep);
  return resolve(dirname(fromFile), decoded);
}

function isInsideSource(filePath) {
  const rel = relative(sourceRoot, filePath);
  return rel && !rel.startsWith("..") && !resolve(filePath).startsWith("..");
}

function imageRefs(fragment, fromFile) {
  const refs = [];
  const matches = fragment.matchAll(/<img\b([^>]*)\bsrc="([^"]+)"([^>]*)>/gi);
  for (const match of matches) {
    const attrs = `${match[1] || ""} ${match[3] || ""}`;
    const src = decodeHtml(match[2]);
    if (/app\.notion\.com\/(icons|images)/i.test(src) || /\bnotion-static-icon\b/i.test(attrs)) continue;
    const filePath = resolveHref(src, fromFile);
    if (!filePath || !existsSync(filePath)) continue;
    refs.push({ filePath, href: src });
  }
  return refs;
}

async function copyMedia(filePath, copiedMedia) {
  const extension = extname(filePath).toLowerCase();
  if (!imageExt.has(extension)) return null;
  if (copiedMedia.byPath.has(filePath)) return copiedMedia.byPath.get(filePath);
  if (copiedMedia.items.length >= MEDIA_COPY_LIMIT) return null;
  const info = await stat(filePath);
  if (info.size > MEDIA_MAX_BYTES) return null;

  const rel = toPosix(relative(sourceRoot, filePath));
  const hash = stableId(rel);
  const fileName = `${hash}${extension === ".jpeg" ? ".jpg" : extension}`;
  const dest = join(mediaDir, fileName);
  await copyFile(filePath, dest);

  const item = {
    id: `media-${hash}`,
    title: cleanFileTitle(filePath.split(sep).at(-1)),
    url: `${mediaWebPrefix}${fileName}`,
    sourcePath: rel,
    bytes: info.size,
    extension: extension.replace(".", "")
  };
  copiedMedia.items.push(item);
  copiedMedia.byPath.set(filePath, item);
  return item;
}

function extractTableRows(fragment) {
  const rows = [];
  for (const rowMatch of fragment.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const rowHtml = rowMatch[0];
    const cells = [];
    for (const cellMatch of rowHtml.matchAll(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi)) {
      cells.push(oneLine(stripTags(cellMatch[0])));
    }
    if (cells.some(Boolean)) rows.push(cells);
  }
  return rows;
}

function extractExternalLinks(html) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHtml(match[1]);
    if (!/^https?:\/\//i.test(href)) continue;
    const label = oneLine(stripTags(match[2])) || href;
    if (links.some(link => link.href === href)) continue;
    links.push({ label, href });
    if (links.length >= 10) break;
  }
  return links;
}

function extractLocalDocLinks(html, fromFile) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href="([^"]+\.html(?:#[^"]*)?)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const target = resolveHref(match[1], fromFile);
    if (!target || !existsSync(target)) continue;
    const label = oneLine(stripTags(match[2]));
    links.push({
      title: label || cleanFileTitle(target.split(sep).at(-1)),
      sourcePath: toPosix(relative(sourceRoot, target))
    });
    if (links.length >= 24) break;
  }
  return links;
}

function categorize(relPath, title) {
  const hay = `${relPath} ${title}`;
  if (/휴지통|삭제\s*예정|\(구\)|\bLegacy\b/i.test(hay)) return "legacy";
  if (/회의|정기회의|회의록|안건/.test(hay)) return "meetings";
  if (/주간\s*업무|업무\s*보고|캘린더|마일스톤|TODO|업무\s*분담|작업/.test(hay)) return "production";
  if (/UI|UX|리소스|화면|팝업|버튼|해상도|폰트/.test(hay)) return "ui";
  if (/시스템|전투|강화|성장|재화|상점|카드|피버|챕터|웨이브|BM|패시브|호감도|기도|가챠|상호작용/.test(hay)) return "systems";
  if (/세계관|이야기|시놉시스|장소|배경|지역|스토리|서사|연출|퀘스트|마나/.test(hay)) return "world";
  if (/캐릭터|주연|안젤라|마리|마르타|몽글레|나린|히나|시폰|설이|미레이|프리시아/.test(hay)) return "characters";
  if (/몬스터|슬라임|고블린|크리처|보스/.test(hay)) return "monsters";
  if (/사운드|BGM|효과음|오디오|음악/.test(hay)) return "sound";
  if (/레퍼런스|래퍼런스|자료|분석|아트\s*레퍼런스|게임\s*레퍼런스/.test(hay)) return "references";
  if (/데이터|밸런스|테이블|xlsx|csv|시트/.test(hay)) return "data";
  if (/기획서$|기획서\s/.test(hay)) return "overview";
  return "docs";
}

function pageStatus(relPath, title, text) {
  const identity = `${relPath} ${title}`;
  if (/휴지통|삭제\s*예정|\(구\)|\bLegacy\b/i.test(identity)) return "legacy";
  const hay = `${identity} ${text.slice(0, 900)}`;
  if (/수정\s*필요|제목\s*없음|미정|임시|정리\s*필요|공란|TODO/i.test(hay)) return "review";
  if (oneLine(text).length < 90) return "review";
  return "active";
}

async function parseHtmlPage(filePath, copiedMedia) {
  const relPath = toPosix(relative(sourceRoot, filePath));
  const html = await readFile(filePath, "utf8");
  const title = pageTitle(html, cleanFileTitle(filePath.split(sep).at(-1)));
  const body = pageBody(html);
  const allText = compactText(stripTags(body));
  const category = categorize(relPath, title);
  const status = pageStatus(relPath, title, allText);
  const headings = [];
  const blocks = [];
  const pageMedia = [];
  const tables = [];

  const blockRegex = /<(h[1-3]|p|li|summary|table|figure)\b[\s\S]*?<\/\1>/gi;
  for (const match of body.matchAll(blockRegex)) {
    const tag = match[1].toLowerCase();
    const fragment = match[0];
    if (tag === "table") {
      const rows = extractTableRows(fragment);
      if (rows.length) {
        tables.push(rows);
        blocks.push({ type: "table", rows: rows.slice(0, 18).map(row => row.slice(0, 8)) });
      }
      continue;
    }

    if (tag === "figure") {
      const mediaRefs = imageRefs(fragment, filePath);
      for (const ref of mediaRefs.slice(0, 2)) {
        const item = await copyMedia(ref.filePath, copiedMedia);
        if (!item) continue;
        pageMedia.push(item.id);
        blocks.push({ type: "media", mediaId: item.id, caption: item.title });
      }
      const sourceLink = fragment.match(/<div[^>]*class="[^"]*\bsource\b[^"]*"[\s\S]*?<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (sourceLink) {
        const label = oneLine(stripTags(sourceLink[2]));
        if (label) blocks.push({ type: "attachment", text: label });
      }
      continue;
    }

    const text = oneLine(stripTags(fragment));
    if (isNoisyText(text)) continue;
    if (tag.startsWith("h")) {
      const level = Number(tag.slice(1));
      if (text !== title) headings.push({ level, text });
      blocks.push({ type: "heading", level, text });
    } else if (tag === "summary") {
      headings.push({ level: 2, text });
      blocks.push({ type: "heading", level: 2, text });
    } else if (tag === "li") {
      if (/<table\b/i.test(fragment)) {
        const rows = extractTableRows(fragment);
        if (rows.length) {
          tables.push(rows);
          blocks.push({ type: "table", rows: rows.slice(0, 18).map(row => row.slice(0, 8)) });
        }
        continue;
      }
      blocks.push({ type: "list", text: text.slice(0, 700) });
    } else {
      blocks.push({ type: "paragraph", text: text.slice(0, 1000) });
    }

    if (blocks.length >= ACTIVE_BLOCK_LIMIT) break;
  }

  const localLinks = extractLocalDocLinks(body, filePath);
  const externalLinks = extractExternalLinks(body);
  const excerptSource = allText
    .split("\n")
    .map(oneLine)
    .filter(line => !isNoisyText(line) && line !== title)
    .slice(0, 8)
    .join(" ");

  const id = `doc-${stableId(relPath)}`;
  const normalizedBlocks = blocks.slice(0, ACTIVE_BLOCK_LIMIT).map((block, index) => ({
    id: `block-${stableId(`${relPath}:${index}:${block.type}:${block.text || block.content || block.caption || block.mediaId || ""}`)}`,
    ...block
  }));

  return {
    id,
    title,
    category,
    categoryLabel: categoryMap.get(category)?.label || "기타 문서",
    status,
    sourcePath: relPath,
    depth: relPath.split("/").length - 1,
    folder: relPath.split("/")[0] || "",
    textLength: oneLine(allText).length,
    excerpt: excerptSource.slice(0, 420),
    headings: headings.slice(0, 28),
    blocks: normalizedBlocks,
    mediaIds: [...new Set(pageMedia)],
    localLinks,
    externalLinks,
    tableCount: tables.length,
    searchText: oneLine(`${title} ${relPath} ${headings.map(item => item.text).join(" ")} ${allText}`).slice(0, SEARCH_TEXT_LIMIT)
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuote = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"") {
      if (inQuote && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuote = !inQuote;
      }
      continue;
    }
    if (char === "," && !inQuote) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuote) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some(value => String(value).trim())) rows.push(row.map(value => compactText(value)));
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  row.push(cell);
  if (row.some(value => String(value).trim())) rows.push(row.map(value => compactText(value)));
  return rows;
}

async function parseCsvCollection(filePath) {
  const relPath = toPosix(relative(sourceRoot, filePath));
  const raw = await readFile(filePath, "utf8");
  const rows = parseCsv(raw);
  const title = cleanFileTitle(filePath.split(sep).at(-1));
  const category = categorize(relPath, title);
  return {
    id: `collection-${stableId(relPath)}`,
    title,
    category,
    categoryLabel: categoryMap.get(category)?.label || "기타 문서",
    sourcePath: relPath,
    rows: rows.slice(0, 250).map(row => row.slice(0, 16)),
    rowCount: rows.length,
    columnCount: Math.max(0, ...rows.map(row => row.length)),
    searchText: oneLine(`${title} ${relPath} ${rows.slice(0, 60).flat().join(" ")}`).slice(0, SEARCH_TEXT_LIMIT)
  };
}

function deriveKeyFacts(pages) {
  const facts = [];
  const overview = pages.find(page => page.title === "기획서") || pages[0];
  for (const block of overview?.blocks || []) {
    if (block.type !== "table") continue;
    for (const row of block.rows || []) {
      if (row.length < 2) continue;
      const key = oneLine(row[0]);
      const value = oneLine(row[1]);
      if (["장르", "시점", "플랫폼", "엔진"].includes(key) && value) {
        facts.push({ label: key, value });
      }
    }
  }
  const defaults = [
    { label: "장르", value: "미소녀 뱀서라이크" },
    { label: "시점", value: "탑뷰" },
    { label: "플랫폼", value: "모바일(Android, iOS)" },
    { label: "엔진", value: "Unity 6" }
  ];
  for (const item of defaults) {
    if (!facts.some(fact => fact.label === item.label)) facts.push(item);
  }
  return facts;
}

function buildReadingMap(pages) {
  const priorityTitles = [
    "기획서",
    "시스템 기획",
    "세계관 설정",
    "캐릭터",
    "몬스터",
    "UI 기획",
    "게임 데이터(밸런스)",
    "사운드",
    "회의 관련",
    "자료 및 게임 레퍼런스",
    "아트 레퍼런스",
    "주간 업무 보고서"
  ];
  return priorityTitles
    .map(title => pages
      .filter(page => page.title === title && page.status !== "legacy")
      .sort((a, b) => a.depth - b.depth || a.sourcePath.length - b.sourcePath.length)[0])
    .filter(Boolean);
}

function buildInsights(pages, collections, allFiles) {
  const byCategory = Object.fromEntries(categoryDefinitions.map(category => [category.id, 0]));
  const byStatus = { active: 0, review: 0, legacy: 0 };
  for (const page of pages) {
    byCategory[page.category] = (byCategory[page.category] || 0) + 1;
    byStatus[page.status] = (byStatus[page.status] || 0) + 1;
  }

  const emptyDocs = pages.filter(page => page.textLength < 90 && page.status !== "legacy");
  const untitledDocs = pages.filter(page => /제목\s*없음/.test(page.title));
  const reviewDocs = pages.filter(page => page.status === "review").slice(0, 80);
  const legacyDocs = pages.filter(page => page.status === "legacy").slice(0, 80);

  return {
    totals: {
      files: allFiles.length,
      documents: pages.length,
      collections: collections.length,
      originalMediaFiles: allFiles.filter(file => mediaExt.has(extname(file).toLowerCase())).length,
      activeDocuments: byStatus.active,
      reviewDocuments: byStatus.review,
      legacyDocuments: byStatus.legacy
    },
    byCategory,
    byStatus,
    cleanup: {
      emptyDocs: emptyDocs.map(toDocRef).slice(0, 40),
      untitledDocs: untitledDocs.map(toDocRef).slice(0, 40),
      reviewDocs: reviewDocs.map(toDocRef),
      legacyDocs: legacyDocs.map(toDocRef),
      suggestions: [
        {
          title: "휴지통과 Legacy를 기본 탐색에서 분리",
          detail: `${byStatus.legacy}개 문서는 구버전/삭제 예정으로 분류했습니다. 검색에는 남기되 기본 읽기 흐름에서는 제외했습니다.`
        },
        {
          title: "제목 없음/미정/공란 문서 확인",
          detail: `${byStatus.review}개 문서는 제목, 본문량, 미정 표현 기준으로 검토 필요 상태입니다.`
        },
        {
          title: "시스템과 UI 문서를 우선 정합성 점검",
          detail: "시스템, 데이터/밸런스, UI/UX 문서가 실제 구현 사양에 직접 영향을 주므로 상단 읽기 흐름에 배치했습니다."
        },
        {
          title: "주간 업무 자료는 제작 로그로 분리",
          detail: "업무 보고서와 캘린더는 기획 본문이 아니라 진행 추적용으로 묶어 노이즈를 줄였습니다."
        }
      ]
    }
  };
}

function toDocRef(page) {
  return {
    id: page.id,
    title: page.title,
    category: page.category,
    categoryLabel: page.categoryLabel,
    status: page.status,
    sourcePath: page.sourcePath,
    excerpt: page.excerpt
  };
}

function buildContentMap() {
  return [
    {
      category: "overview",
      title: "1. 프로젝트 기준",
      summary: "장르, 플랫폼, 엔진, 핵심 차별점을 먼저 고정합니다.",
      readFirst: ["기획서", "자료 및 게임 레퍼런스"]
    },
    {
      category: "systems",
      title: "2. 플레이 구조",
      summary: "인게임 루프, 아웃게임 성장, 피버, 카드, BM을 시스템 단위로 봅니다.",
      readFirst: ["시스템 기획", "챕터/웨이브 시스템", "피버", "성장/재화/상점"]
    },
    {
      category: "data",
      title: "3. 수치와 테이블",
      summary: "밸런스 기준과 외부 스프레드시트를 데이터 검수 대상으로 분리합니다.",
      readFirst: ["게임 데이터(밸런스)", "분서 리스트", "래퍼런스 리스트"]
    },
    {
      category: "world",
      title: "4. 세계관과 동기",
      summary: "마나, 지역, 성결회, 오염 구조를 캐릭터/스테이지의 근거로 연결합니다.",
      readFirst: ["세계관 설정", "이야기 흐름", "장소 및 배경"]
    },
    {
      category: "characters",
      title: "5. 캐릭터와 몬스터",
      summary: "주연 캐릭터, 패시브 개성, 적 구성과 해금 동기를 한 흐름으로 봅니다.",
      readFirst: ["캐릭터", "몬스터"]
    },
    {
      category: "ui",
      title: "6. 화면 사양",
      summary: "9:16 모바일 기준, 화면별 버튼/팝업/리소스 요구사항을 검수합니다.",
      readFirst: ["UI 기획", "UI 리소스 리스트업"]
    },
    {
      category: "production",
      title: "7. 제작 운영",
      summary: "회의록과 주간 업무 보고서는 결정사항과 미해결 이슈 추적용으로 분리합니다.",
      readFirst: ["회의 관련", "주간 업무 보고서"]
    }
  ];
}

async function main() {
  if (!existsSync(sourceRoot)) {
    throw new Error(`Notion export folder not found: ${sourceRoot}`);
  }

  await mkdir(dirname(dataPath), { recursive: true });
  await rm(mediaDir, { recursive: true, force: true });
  await mkdir(mediaDir, { recursive: true });

  const allFiles = await walk(sourceRoot);
  const copiedMedia = { items: [], byPath: new Map() };
  const pages = [];
  const collections = [];

  for (const file of allFiles.filter(file => htmlExt.has(extname(file).toLowerCase())).sort()) {
    pages.push(await parseHtmlPage(file, copiedMedia));
  }

  for (const file of allFiles.filter(file => extname(file).toLowerCase() === ".csv").sort()) {
    collections.push(await parseCsvCollection(file));
  }

  const mediaById = Object.fromEntries(copiedMedia.items.map(item => [item.id, item]));
  const priorityDocs = buildReadingMap(pages).map(toDocRef);
  const insights = buildInsights(pages, collections, allFiles);
  insights.totals.bundledMedia = copiedMedia.items.length;

  const archive = {
    schemaVersion: 1,
    title: "어둠의 청강단 기획 허브",
    subtitle: "Notion export를 웹 배포용 문서·데이터·미디어 탐색 툴로 재구성한 정리본",
    generatedAt: new Date().toISOString(),
    source: {
      kind: "Notion HTML export",
      rootName: sourceRoot.split(sep).at(-1),
      note: "원본 export 폴더는 수정하지 않고 읽기 전용으로 처리했습니다."
    },
    categories: categoryDefinitions,
    keyFacts: deriveKeyFacts(pages),
    contentMap: buildContentMap(),
    priorityDocs,
    insights,
    media: copiedMedia.items,
    mediaById,
    documents: pages,
    collections
  };

  const js = `window.SHIM_NOTION_ARCHIVE = ${JSON.stringify(archive, null, 2).replace(/<\/script/gi, "<\\/script")};\n`;
  await writeFile(dataPath, js, "utf8");

  console.log(`Built archive data: ${toPosix(relative(projectRoot, dataPath))}`);
  console.log(`Documents: ${pages.length}, collections: ${collections.length}, bundled media: ${copiedMedia.items.length}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
