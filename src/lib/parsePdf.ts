// Parse Disneyland Paris SFX weekly planning PDFs in the browser using pdfjs-dist.
//
// COMPATIBILITY: we use pdfjs-dist **v3 legacy build** (ES2017 target, plain
// .js, no top-level private fields, no class statics). This builds runs on
// every iOS WebView we've tested — including WhatsApp, Instagram and Gmail
// in-app browsers, which still bundle older WebKit than mobile Safari.
//
// In iOS in-app browsers (detected via UA), we additionally **disable the
// pdfjs worker** — these WebViews silently fail to spawn Web Workers from
// blob: URLs, then any Worker code that reaches a `for...of` over the
// (now-undefined) port throws the infamous
//     "undefined is not a function (near '...e of t...')"
// error visible in production. Disabling the worker forces pdfjs to parse on
// the main thread, where our polyfills (Promise.withResolvers,
// Array#at/toSorted/toReversed, structuredClone) are already installed.

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars */
// @ts-ignore — v3 ships only .js, not .mjs, and no .d.ts at this path.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.js?url';
import { isInAppBrowser } from './polyfills';
import { formatEmployeeName, cleanSceneName } from './utils';

type PdfJsModule = any;
let pdfjsPromise: Promise<PdfJsModule> | null = null;

function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // Legacy v3 build — UMD/AMD .js, ES2017 target, broadest WebKit support.
      // @ts-ignore
      const mod = await import('pdfjs-dist/legacy/build/pdf.js') as PdfJsModule;
      // In an in-app browser, we won't use a worker at all (see parsePdfFile).
      // But pdfjs still wants workerSrc set, so point it at the legacy worker
      // for the non-WebView code path.
      try {
        mod.GlobalWorkerOptions.workerSrc = workerUrl;
      } catch (_) { /* ignore */ }
      return mod;
    })();
  }
  return pdfjsPromise;
}

const HEADER_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const;
type DayName = typeof HEADER_DAYS[number];

const ROLE_KEYWORDS = [
  'tech sfx',
  'tech atelier',
  'asstcoordinateur',
  'asstcoordinateur s',
  'asstcoordinateur sfx',
  'asst coordinateur',
  'asst coordinateur sfx',
  'magasinier bunker',
  'parkwide',
  'park wide',
  'runner',
  'regiesfx',
  'regie sfx',
  'régie sfx',
  'regiesf',
  'coordinateur',
  "chef d'équipe",
  'chef d equipe',
  'senior',
  'pupitreur sfx',
  'pupitreur',
  'conducteur ng25',
  'conducteur',
  'tech sfx ponton',
  'tech sfx secuphare',
  'tech sfx secu phare',
  'entertainment',
  'frontierlandtheater',
];

const HR_CODES = new Set(['SM', 'SC', 'SH', 'HS', 'HF', 'HR', 'FO']);

const TIME_RE = /(\d{1,2}[:h]\d{2}\s*-\s*\d{1,2}[:h]\d{2})/i;
const PURE_OFF_RE = /^(Repos|CX|C4|XJ|CT)\s*$/i;

export interface PlanningRecord {
  employee: string;
  date: string;       // ISO YYYY-MM-DD
  day: DayName;
  time: string;       // "HH:MM-HH:MM" or "OFF"
  shiftTime?: string; // Overall daily shift hours e.g. "09:00-18:03"
  scene: string;      // scene assignment text or "OFF"
  role?: string;      // role/mention if any (e.g. AsstCoordinateur, Pupitreur SFX, Tech Sfx, etc.)
  weekLabel: string;  // e.g. "Sem. 21 — 17/05 → 23/05"
  sourceFile: string;
}

interface TokenT {
  text: string;
  x: number;
  y: number; // bigger = lower on page (we flip pdfjs y)
  width: number;
  height: number;
}

const approxEq = (a: number, b: number, tol = 3) => Math.abs(a - b) <= tol;

function parsePage(items: any[], sourceFile: string, ctx: { lastWeekLabel: string }): PlanningRecord[] {
  const tokens: TokenT[] = items
    .filter((i: any) => i && typeof i.str === 'string' && i.str.trim())
    .map((i: any) => ({
      text: i.str,
      x: i.transform[4],
      y: -i.transform[5], // flip so larger y = lower
      width: i.width || 0,
      height: i.height || 10,
    }));

  if (tokens.length === 0) return [];

  // --- Locate header row
  const cleanStr = (s: string) => s.trim().toLowerCase();
  const dimancheTok = tokens.find(t => cleanStr(t.text) === 'dimanche');
  if (!dimancheTok) return [];
  const headerY = dimancheTok.y;
  const dayTokens = HEADER_DAYS.map(d => tokens.find(t => cleanStr(t.text) === d && approxEq(t.y, headerY, 3)));
  if (dayTokens.some(t => !t)) return [];
  const dayX = dayTokens.map(t => (t as TokenT).x);

  const idHeader = tokens.find(t => cleanStr(t.text) === 'id' && approxEq(t.y, headerY, 3));
  if (!idHeader) return [];

  // --- Day column x-bounds (midpoints between adjacent day-header tokens)
  const colStarts: number[] = [];
  const colEnds: number[] = [];
  for (let i = 0; i < 7; i++) {
    const prev = i === 0 ? null : dayX[i - 1];
    const next = i === 6 ? null : dayX[i + 1];
    colStarts.push(prev === null ? (idHeader.x + dayX[0]) / 2 : (prev + dayX[i]) / 2);
    colEnds.push(next === null ? Infinity : (dayX[i] + next) / 2);
  }

  // --- Nom column: from page left to ID column start
  const nomColStart = 30;
  const nomColEnd = idHeader.x - 5;

  // --- Week year from "Du: DD-MM-YYYY"
  let year = '';
  let weekStartIso = '';
  let weekEndIso = '';
  for (const t of tokens) {
    const m = t.text.match(/Du:\s*(\d{2})-(\d{2})-(\d{4})\s*Au:\s*(\d{2})-(\d{2})-(\d{4})/i);
    if (m) {
      year = m[3];
      weekStartIso = `${m[3]}-${m[2]}-${m[1]}`;
      weekEndIso = `${m[6]}-${m[5]}-${m[4]}`;
      break;
    }
    const m2 = t.text.match(/Du:\s*(\d{2})-(\d{2})-(\d{4})/i);
    if (m2) { year = m2[3]; weekStartIso = `${m2[3]}-${m2[2]}-${m2[1]}`; }
  }

  // Week number from "Semaine:202621" → week 21
  let weekLabel = ctx.lastWeekLabel;
  for (const t of tokens) {
    const m = t.text.match(/Semaine:\s*\d{4}(\d{2})/i);
    if (m && weekStartIso && weekEndIso) {
      const s = weekStartIso.split('-');
      const e = weekEndIso.split('-');
      weekLabel = `Sem. ${m[1]} · ${s[2]}/${s[1]} → ${e[2]}/${e[1]}`;
      ctx.lastWeekLabel = weekLabel;
      break;
    }
  }

  // --- Day ISO dates from "DD-MM" tokens on header row
  const dayISODates: (string | null)[] = dayTokens.map((dt) => {
    if (!dt) return null;
    const candidates = tokens.filter(t =>
      /^\d{2}[-/]\d{2}$/.test(t.text) &&
      Math.abs(t.y - dt.y) < 6 &&
      t.x > dt.x - 5 && t.x < dt.x + 80,
    );
    candidates.sort((a, b) => a.x - b.x);
    if (!candidates.length) return null;
    const m = candidates[0].text.match(/^(\d{2})[-/](\d{2})$/);
    if (!m) return null;
    return `${year || 'YYYY'}-${m[2]}-${m[1]}`;
  });

  // --- Employee rows: tokens in Nom column with surname,given pattern
  const nomCandidates = tokens.filter(t =>
    t.x >= nomColStart && t.x < nomColEnd && t.y > headerY + 5 &&
    (/^[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ' -]+,?$/.test(t.text) || /^[A-Z][A-ZÀ-Þ' -]+,/.test(t.text)),
  );

  // Group by Y bucket
  const buckets: Map<number, TokenT[]> = new Map();
  for (const t of nomCandidates) {
    const yKey = Math.round(t.y);
    let foundKey: number | null = null;
    for (const k of buckets.keys()) {
      if (Math.abs(k - yKey) <= 2) { foundKey = k; break; }
    }
    const k = foundKey ?? yKey;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(t);
  }

  const employees = Array.from(buckets.entries())
    .map(([y, toks]) => {
      toks.sort((a, b) => a.x - b.x);
      let name = toks.map(t => t.text).join(' ')
        .replace(/\s+/g, ' ')
        .replace(/\s*,\s*/, ', ')
        .trim();
      name = name.replace(/\s*\(\*\)\s*$/, '').trim();
      return { y: Number(y), name: formatEmployeeName(name) };
    })
    .filter(e => e.name.length > 0)
    .sort((a, b) => a.y - b.y);

  if (!employees.length) return [];

  // Compute y range for each employee
  const empRanges = employees.map((e, i) => ({
    name: e.name,
    yStart: e.y - 2,
    yEnd: i + 1 < employees.length ? employees[i + 1].y - 2 : Infinity,
  }));

  const records: PlanningRecord[] = [];
  for (const emp of empRanges) {
    for (let d = 0; d < 7; d++) {
      const xStart = colStarts[d];
      const xEnd = colEnds[d];
      const cellTokens = tokens
        .filter(t => t.x >= xStart - 3 && t.x < xEnd + 3 && t.y >= emp.yStart && t.y < emp.yEnd)
        .sort((a, b) => a.y - b.y || a.x - b.x);

      const segments = parseCell(cellTokens);
      const date = dayISODates[d] || '';
      for (const seg of segments) {
        records.push({
          employee: emp.name,
          date,
          day: HEADER_DAYS[d],
          time: seg.time,
          shiftTime: seg.shiftTime,
          scene: seg.scene,
          role: seg.role,
          weekLabel,
          sourceFile,
        });
      }
    }
  }
  return records;
}

function cleanRole(raw: string): string {
  let r = (raw || '').trim();
  if (!r) return '';
  // Fix truncation: "AsstCoordinateur S" -> "AsstCoordinateur"
  if (/^asst\s*coordinateur\s*s$/i.test(r) || /^asstcoordinateur\s*s$/i.test(r)) {
    return 'AsstCoordinateur';
  }
  if (/^asstcoordinateur$/i.test(r) || /^asst\s*coordinateur$/i.test(r)) {
    return 'AsstCoordinateur';
  }
  if (/^asstcoordinateur\s*sfx$/i.test(r) || /^asst\s*coordinateur\s*sfx$/i.test(r)) {
    return 'AsstCoordinateur';
  }
  if (/^regiesf$/i.test(r) || /^regie\s*sf$/i.test(r)) {
    return 'RegieSFX';
  }
  // Strip orphan trailing single letter (e.g. cut off by cell border)
  r = r.replace(/\s+[A-Za-z]$/, '').trim();
  return r;
}

function extractSceneAndRole(lines: string[]): { scene: string; role?: string } {
  let scene = '';
  let role = '';

  // 1. Look for known scene line (starting with ENT or DLP or is Formation)
  let sceneLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^(ENT|DLP)\b/i.test(trimmed) || /^formation\b/i.test(trimmed) || /^fo\b/i.test(trimmed)) {
      scene = trimmed;
      sceneLineIdx = i;
      break;
    }
  }

  // 2. Look for role line among the other lines
  for (let i = 0; i < lines.length; i++) {
    if (i === sceneLineIdx) continue;
    const trimmed = lines[i].trim();
    if (!trimmed || TIME_RE.test(trimmed) || HR_CODES.has(trimmed.toUpperCase())) continue;
    
    // Check if it's a known role or candidate
    const cleaned = cleanRole(trimmed);
    if (ROLE_KEYWORDS.some(kw => trimmed.toLowerCase().includes(kw)) || cleaned) {
      role = cleaned;
      break;
    }
  }

  // Fallback if no scene was explicitly identified
  if (!scene) {
    const nonRole = lines.filter(l => {
      const t = l.trim();
      if (!t || TIME_RE.test(t) || HR_CODES.has(t.toUpperCase())) return false;
      if (ROLE_KEYWORDS.includes(t.toLowerCase())) return false;
      return true;
    });
    if (nonRole.length > 0) {
      scene = nonRole.join(' - ');
    } else {
      for (const l of lines) {
        const t = l.trim();
        if (!t || TIME_RE.test(t) || HR_CODES.has(t.toUpperCase())) continue;
        scene = t;
        break;
      }
    }
  }

  if (!scene) scene = '—';
  else scene = cleanSceneName(scene);

  return { scene, role: role || undefined };
}

function parseCell(tokens: TokenT[]): Array<{ time: string; shiftTime?: string; scene: string; role?: string }> {
  if (tokens.length === 0) return [{ time: 'OFF', scene: 'OFF' }];

  // Group into lines by Y proximity
  const lines: TokenT[][] = [];
  for (const t of tokens) {
    let placed = false;
    for (const line of lines) {
      if (Math.abs(line[0].y - t.y) <= 3) { line.push(t); placed = true; break; }
    }
    if (!placed) lines.push([t]);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  lines.sort((a, b) => a[0].y - b[0].y);
  const lineTexts = lines.map(line => line.map(t => t.text).join(' ').trim()).filter(Boolean);

  // OFF detection
  if (lineTexts.length === 0) return [{ time: 'OFF', scene: 'OFF' }];
  const joinedTop = lineTexts.slice(0, 2).join(' ').trim();
  if (PURE_OFF_RE.test(joinedTop) || PURE_OFF_RE.test(lineTexts[0])) {
    return [{ time: 'OFF', scene: 'OFF' }];
  }

  // Find all time ranges
  const timeEntries: Array<{ lineIndex: number; time: string }> = [];
  for (let i = 0; i < lineTexts.length; i++) {
    const m = lineTexts[i].match(TIME_RE);
    if (m) {
      timeEntries.push({
        lineIndex: i,
        time: m[1].replace(/h/i, ':').replace(/\s+/g, '')
      });
    }
  }

  if (timeEntries.length === 0) {
    return [{ time: 'OFF', scene: 'OFF' }];
  }

  // First time entry in Chronos WFM is the overall shift time from the top header of the cell
  const overallShift = timeEntries[0].time;

  // Determine segment slices
  let segmentStarts = timeEntries;
  let isMultiShiftHeader = false;
  if (timeEntries.length >= 2 && timeEntries[1].lineIndex === timeEntries[0].lineIndex + 1) {
    segmentStarts = timeEntries.slice(1);
    isMultiShiftHeader = true;
  }

  const results: Array<{ time: string; shiftTime?: string; scene: string; role?: string }> = [];

  for (let s = 0; s < segmentStarts.length; s++) {
    const cur = segmentStarts[s];
    const nextLineIdx = (s + 1 < segmentStarts.length) ? segmentStarts[s + 1].lineIndex : lineTexts.length;
    const segLines = lineTexts.slice(cur.lineIndex + 1, nextLineIdx);

    const { scene, role } = extractSceneAndRole(segLines);
    results.push({
      time: cur.time,
      shiftTime: (isMultiShiftHeader || segmentStarts.length > 1 || overallShift !== cur.time) ? overallShift : undefined,
      scene,
      role
    });
  }

  // Deduplicate identical segments if any
  const seen = new Set<string>();
  const unique: Array<{ time: string; shiftTime?: string; scene: string; role?: string }> = [];
  for (const r of results) {
    const key = `${r.time}|${r.shiftTime || ''}|${r.scene}|${r.role || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }

  return unique.length > 0 ? unique : [{ time: timeEntries[0].time, shiftTime: overallShift, scene: '—' }];
}

export interface ParseResult {
  records: PlanningRecord[];
  sourceFile: string;
  pageCount: number;
  weekLabels: string[];
}

export async function parsePdfFile(file: File): Promise<ParseResult> {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();

  // In an in-app iOS browser (WhatsApp/Instagram/Gmail/etc.) the worker cannot
  // be reliably spawned — pass disableWorker:true so pdfjs parses on the main
  // thread where our polyfills are installed.
  const docOpts: any = {
    data: buf,
    isEvalSupported: false,
    useSystemFonts: false,
  };
  if (isInAppBrowser()) {
    docOpts.disableWorker = true;
  }

  const doc = await pdfjsLib.getDocument(docOpts).promise;
  const all: PlanningRecord[] = [];
  const ctx = { lastWeekLabel: '' };
  const seenLabels = new Set<string>();
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const recs = parsePage(content.items, file.name, ctx);
    for (const r of recs) {
      seenLabels.add(r.weekLabel);
      all.push(r);
    }
  }

  // Deduplicate records across pages (e.g. main schedule pages vs appendix modification pages)
  const seenRecords = new Map<string, PlanningRecord>();
  for (const r of all) {
    const key = `${r.employee}__${r.date}__${r.time}__${r.scene}`;
    if (!seenRecords.has(key)) {
      seenRecords.set(key, r);
    }
  }

  // If an employee has working records on a given date, discard empty/redundant OFF records for that same date
  const workingEmpsDates = new Set<string>();
  for (const r of seenRecords.values()) {
    if (r.time !== 'OFF') {
      workingEmpsDates.add(`${r.employee}__${r.date}`);
    }
  }
  const filteredRecords = Array.from(seenRecords.values()).filter(r => {
    if (r.time === 'OFF' && workingEmpsDates.has(`${r.employee}__${r.date}`)) {
      return false;
    }
    return true;
  });

  return {
    records: filteredRecords,
    sourceFile: file.name,
    pageCount: doc.numPages,
    weekLabels: Array.from(seenLabels),
  };
}
