// Browser-side PDF export for SFX Planner. No network, no storage.
// One A4 page. Adaptive layout based on density.

import jsPDF from 'jspdf';
import type { PlanningRecord } from './parsePdf';
import { getFOAssociations, computeAllFOAssociations, getFOAssociationKey, isTrainingScene } from './utils';

const ORANGE: [number, number, number] = [232, 130, 30];
const TEAL: [number, number, number] = [31, 122, 112];
const GREY_DARK: [number, number, number] = [40, 40, 44];
const GREY_MED: [number, number, number] = [110, 110, 116];
const GREY_LINE: [number, number, number] = [220, 220, 224];

const MONTH_FR: Record<string, string> = {
  '01': 'janv.', '02': 'févr.', '03': 'mars', '04': 'avril', '05': 'mai',
  '06': 'juin', '07': 'juil.', '08': 'août', '09': 'sept.', '10': 'oct.',
  '11': 'nov.', '12': 'déc.',
};

// 0 = Sunday, 1 = Monday, ...
const DAY_FR_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const DAY_FR_SHORT = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];

function weekdayFromIso(iso: string): number | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  // Use UTC to avoid timezone shifting the day.
  const d = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
  if (isNaN(d.getTime())) return null;
  return d.getUTCDay();
}

let logoDataUrlPromise: Promise<string | null> | null = null;
function getLogoDataUrl(): Promise<string | null> {
  if (logoDataUrlPromise) return logoDataUrlPromise;
  logoDataUrlPromise = (async () => {
    try {
      const base = (typeof window !== 'undefined' && (window as any).__BASE_URL__) ||
        ((import.meta as any).env?.BASE_URL ?? '/');
      const url = `${base}sfx-dragon-logo.jpg`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  })();
  return logoDataUrlPromise;
}

function fmtDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const wd = weekdayFromIso(iso);
  const prefix = wd !== null ? `${DAY_FR_FULL[wd]} ` : '';
  return `${prefix}${parseInt(m[3], 10)} ${MONTH_FR[m[2]] ?? m[2]} ${m[1]}`;
}

// Compact form for narrow contexts (multi-column block headers): "Lun. 24/05/2026"
function fmtDateShort(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const wd = weekdayFromIso(iso);
  const prefix = wd !== null ? `${DAY_FR_SHORT[wd]} ` : '';
  return `${prefix}${m[3]}/${m[2]}/${m[1]}`;
}

function prettyName(s: string): string {
  const idx = s.indexOf(',');
  const tc = (w: string) =>
    w.split(/([-'])/)
      .map(p => /^[-']$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join('');
  const tcp = (s: string) => s.trim().split(/\s+/).map(tc).join(' ');
  if (idx === -1) return tcp(s);
  const last = tcp(s.slice(0, idx));
  const first = tcp(s.slice(idx + 1));
  if (!first) return last;
  if (!last) return first;
  return `${first} ${last}`;
}


interface LayoutChoice {
  orientation: 'portrait' | 'landscape';
  cols: number;
  fontTitle: number;
  fontSub: number;
  fontSection: number;
  fontRow: number;
  rowHeight: number;
  sectionGap: number;
  rowGap: number;
  dense: boolean;
}

function chooseLayout(itemCount: number, totalRows: number): LayoutChoice {
  // Heuristics: pick orientation, columns, and font sizes to fit one A4.
  const density = itemCount + totalRows * 0.6;
  if (density <= 30) {
    return { orientation: 'portrait', cols: 1, fontTitle: 18, fontSub: 11, fontSection: 12, fontRow: 10, rowHeight: 5.2, sectionGap: 4, rowGap: 0.6, dense: false };
  }
  if (density <= 60) {
    return { orientation: 'portrait', cols: 2, fontTitle: 17, fontSub: 10.5, fontSection: 11, fontRow: 9.5, rowHeight: 4.6, sectionGap: 3.2, rowGap: 0.4, dense: false };
  }
  if (density <= 110) {
    return { orientation: 'landscape', cols: 2, fontTitle: 16, fontSub: 10, fontSection: 10.5, fontRow: 9, rowHeight: 4.2, sectionGap: 2.8, rowGap: 0.3, dense: false };
  }
  if (density <= 180) {
    return { orientation: 'landscape', cols: 3, fontTitle: 15, fontSub: 9.5, fontSection: 10, fontRow: 8.5, rowHeight: 3.8, sectionGap: 2.4, rowGap: 0.2, dense: true };
  }
  return { orientation: 'landscape', cols: 4, fontTitle: 14, fontSub: 9, fontSection: 9.5, fontRow: 8, rowHeight: 3.4, sectionGap: 2, rowGap: 0.2, dense: true };
}

function drawHeader(doc: jsPDF, pageW: number, marginX: number, marginTop: number, title: string, subtitle: string, layout: LayoutChoice, logo: string | null): number {
  const bannerH = 16;
  // Draw premium dark midnight header banner
  doc.setFillColor(13, 20, 35);
  doc.roundedRect(marginX, marginTop, pageW - marginX * 2, bannerH, 2, 2, 'F');

  // Gold highlight line at the bottom of the banner
  doc.setFillColor(255, 176, 58);
  doc.rect(marginX + 2, marginTop + bannerH - 0.8, pageW - marginX * 2 - 4, 0.4, 'F');

  let textX = marginX + 4;
  if (logo) {
    try {
      doc.addImage(logo, 'JPEG', marginX + 3, marginTop + 2.2, 11.5, 11.5);
      textX = marginX + 17;
    } catch {
      // ignore
    }
  }

  // Title in white
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(layout.fontTitle - 2.5);
  doc.setTextColor(255, 255, 255);
  doc.text(title, textX, marginTop + 6.2);

  // Subtitle in light blue/grey
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(layout.fontSub - 1.2);
  doc.setTextColor(165, 185, 215);
  doc.text(subtitle, textX, marginTop + 11.8);

  // Right logo/brand wordmark in gold/orange
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(255, 176, 58);
  doc.text('SFX PLANNER', pageW - marginX - 4, marginTop + 9.5, { align: 'right' });

  return marginTop + bannerH + 4;
}

function drawFooter(doc: jsPDF, pageW: number, pageH: number, marginX: number, _dense: boolean, _denseNote: boolean) {
  // Divider line
  doc.setDrawColor(GREY_LINE[0], GREY_LINE[1], GREY_LINE[2]);
  doc.setLineWidth(0.2);
  doc.line(marginX, pageH - 11, pageW - marginX, pageH - 11);
  
  // Single permanent warning in bold orange
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(ORANGE[0], ORANGE[1], ORANGE[2]);
  doc.text("ATTENTION : Contrôle obligatoire sur UKG personnel. Le placement des formations peut varier. Données traitées localement.", pageW / 2, pageH - 7, { align: 'center' });
}

function drawBlocks(
  doc: jsPDF,
  blocks: Array<{ header: string; rows: Array<{ name: string; time: string; isFO?: boolean }> }>,
  startY: number,
  marginX: number,
  marginRight: number,
  pageW: number,
  pageH: number,
  layout: LayoutChoice,
): boolean {
  // Save 14mm of space at the bottom for the warning and footer
  const bottom = pageH - 14;
  const availW = pageW - marginX - marginRight;
  const gutter = 4;
  const colW = (availW - gutter * (layout.cols - 1)) / layout.cols;

  let col = 0;
  let y = startY;
  const colYs: number[] = new Array(layout.cols).fill(startY);

  for (const block of blocks) {
    const cardHeaderHeight = 6.0;
    const cardPaddingTop = 1.2;
    const cardPaddingBottom = 2.0;
    const cardPaddingLeftRight = 3.0;
    
    const rowsLen = Math.max(1, block.rows.length);
    const cardHeight = cardHeaderHeight + cardPaddingTop + rowsLen * (layout.rowHeight + layout.rowGap) + cardPaddingBottom;
    const blockHeight = cardHeight + layout.sectionGap;

    // Try to fit in current column; otherwise move to next column
    let placed = false;
    for (let tries = 0; tries < layout.cols; tries++) {
      const idx = (col + tries) % layout.cols;
      if (colYs[idx] + blockHeight <= bottom) {
        col = idx;
        y = colYs[idx];
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Doesn't fit — caller should bump density.
      return false;
    }

    const x = marginX + col * (colW + gutter);

    // Draw rounded card container background
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.15);
    doc.roundedRect(x, y, colW, cardHeight, 1.6, 1.6, 'FD');

    // Draw solid teal card header bar
    doc.setFillColor(TEAL[0], TEAL[1], TEAL[2]);
    doc.roundedRect(x, y, colW, cardHeaderHeight, 1.6, 1.6, 'F');
    // Draw flat bottom corners for the header bar so it merges with the card body
    doc.rect(x, y + 3, colW, cardHeaderHeight - 3, 'F');

    // Draw block title inside the header bar in white
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(layout.fontSection - 0.5);
    doc.setTextColor(255, 255, 255);
    const headerText = doc.splitTextToSize(block.header, colW - cardPaddingLeftRight * 2)[0] as string;
    doc.text(headerText, x + cardPaddingLeftRight, y + cardHeaderHeight * 0.7);

    let ry = y + cardHeaderHeight + cardPaddingTop + 1.0;

    if (block.rows.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(layout.fontRow);
      doc.setTextColor(GREY_MED[0], GREY_MED[1], GREY_MED[2]);
      doc.text('Aucun technicien', x + cardPaddingLeftRight, ry + layout.rowHeight * 0.55);
      ry += layout.rowHeight + layout.rowGap;
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(layout.fontRow);
      for (const row of block.rows) {
        const isFO = (row as any).isFO;
        const timeStr = row.time || '';
        const timeW = doc.getTextWidth(timeStr) + 4;
        
        const pillW = isFO ? 7.5 : 0;
        const nameMax = colW - cardPaddingLeftRight * 2 - timeW - pillW - 2.5;
        const nameTxt = (doc.splitTextToSize(row.name, nameMax)[0] as string) || row.name;

        let nameX = x + cardPaddingLeftRight;
        if (isFO) {
          const foPillW = 6;
          const foPillH = layout.rowHeight * 0.85;
          const foPillY = ry + (layout.rowHeight - foPillH) / 2;
          doc.setFillColor(120, 90, 230);
          doc.roundedRect(x + cardPaddingLeftRight, foPillY, foPillW, foPillH, 0.5, 0.5, 'F');
          
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(layout.fontRow - 1.5);
          doc.text('FO', x + cardPaddingLeftRight + foPillW / 2, foPillY + foPillH * 0.72, { align: 'center' });
          
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(layout.fontRow);
          nameX = x + cardPaddingLeftRight + foPillW + 1.5;
        }

        doc.setTextColor(GREY_DARK[0], GREY_DARK[1], GREY_DARK[2]);
        doc.text(nameTxt, nameX, ry + layout.rowHeight * 0.62);

        const isOff = /^off$/i.test(timeStr);
        const pillColor: [number, number, number] = isOff ? GREY_MED : ORANGE;
        doc.setFillColor(pillColor[0], pillColor[1], pillColor[2]);
        const pillH = layout.rowHeight * 0.85;
        const pillY = ry + (layout.rowHeight - pillH) / 2;
        const pillX = x + colW - cardPaddingLeftRight - timeW;
        doc.roundedRect(pillX, pillY, timeW, pillH, 0.8, 0.8, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(layout.fontRow - 0.5);
        doc.text(timeStr, pillX + timeW / 2, pillY + pillH * 0.72, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(layout.fontRow);
        ry += layout.rowHeight + layout.rowGap;
      }
    }

    colYs[col] = y + blockHeight;
  }

  return true;
}

export async function exportDayPdf(date: string, records: PlanningRecord[]): Promise<void> {
  const dayRecs = records.filter(r => r.date === date && r.time !== 'OFF');
  const activeRegs = dayRecs.filter(r => !isTrainingScene(r.scene));
  const activeFOs = dayRecs.filter(r => isTrainingScene(r.scene));
  const dayAssoc = getFOAssociations(dayRecs);
  
  const sceneMap = new Map<string, Array<{ name: string; time: string; isFO?: boolean }>>();
  
  for (const r of activeRegs) {
    if (!sceneMap.has(r.scene)) sceneMap.set(r.scene, []);
    sceneMap.get(r.scene)!.push({ name: prettyName(r.employee), time: r.time });
  }

  for (const r of activeFOs) {
    const assoc = dayAssoc.get(r.employee) ?? [];
    const groupKey = isTrainingScene(r.scene) ? r.scene : 'FO';
    if (!sceneMap.has(groupKey)) sceneMap.set(groupKey, []);
    const assocSuffix = assoc.length > 0 ? ` (${assoc.join(', ')})` : '';
    sceneMap.get(groupKey)!.push({
      name: `${prettyName(r.employee)}${assocSuffix}`,
      time: r.time,
      isFO: true
    });
    
    for (const scene of assoc) {
      if (!sceneMap.has(scene)) sceneMap.set(scene, []);
      const label = r.scene ? ` (${r.scene})` : ' (FO)';
      sceneMap.get(scene)!.push({
        name: `${prettyName(r.employee)}${label}`,
        time: r.time,
        isFO: true
      });
    }
  }

  const scenes = Array.from(sceneMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0], 'fr'))
    .map(([scene, rows]) => ({
      scene,
      rows: rows.sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    }));

  const totalRows = scenes.reduce((acc, s) => acc + s.rows.length, 0);
  await generateAndSave({
    title: 'Vue globale du jour',
    subtitle: fmtDate(date),
    blocks: scenes.map(s => ({ header: s.scene, rows: s.rows })),
    itemCount: scenes.length,
    totalRows,
    filename: `sfx-planning-${date}.pdf`,
  });
}

export async function exportEmployeePdf(employee: string, records: PlanningRecord[]): Promise<void> {
  const empRecs = records.filter(r => r.employee === employee);
  const dayAssoc = computeAllFOAssociations(records);
  
  // Group by date (one block per date), include OFF discreetly.
  const dateMap = new Map<string, Array<{ name: string; time: string; isFO?: boolean }>>();
  for (const r of empRecs) {
    if (!dateMap.has(r.date)) dateMap.set(r.date, []);
    
    let name = r.scene || '-';
    let isFO = false;
    
    if (isTrainingScene(r.scene)) {
      isFO = true;
      const assoc = dayAssoc.get(getFOAssociationKey(r.date, r.employee)) ?? [];
      if (assoc.length > 0) {
        name = `${assoc.join(', ')} (${r.scene})`;
      }
    }
    
    const row = r.time === 'OFF'
      ? { name: 'Repos / congé', time: 'OFF' }
      : { name, time: r.time, isFO };
    dateMap.get(r.date)!.push(row);
  }
  const allDates = Array.from(dateMap.keys()).filter(Boolean).sort();
  const blocks = allDates.map(d => ({
    header: fmtDateShort(d),
    rows: (dateMap.get(d) ?? []),
  }));

  const totalRows = blocks.reduce((acc, b) => acc + Math.max(1, b.rows.length), 0);
  const periodStart = allDates[0] ? fmtDate(allDates[0]) : '';
  const periodEnd = allDates[allDates.length - 1] ? fmtDate(allDates[allDates.length - 1]) : '';
  const period = periodStart && periodEnd && periodStart !== periodEnd
    ? `${periodStart} au ${periodEnd}`
    : periodStart;

  await generateAndSave({
    title: prettyName(employee),
    subtitle: period ? `Planning individuel - ${period}` : 'Planning individuel',
    blocks,
    itemCount: blocks.length,
    totalRows,
    filename: `sfx-planning-indiv-${slug(prettyName(employee))}.pdf`,
  });
}

export async function exportScenePdf(scene: string, records: PlanningRecord[]): Promise<void> {
  const sceneRecs = records.filter(r => r.scene === scene && r.time !== 'OFF');
  const foRecs = records.filter(r => isTrainingScene(r.scene) && r.time !== 'OFF');
  const dayAssoc = computeAllFOAssociations(records);

  const dateMap = new Map<string, Array<{ name: string; time: string; isFO?: boolean }>>();
  
  for (const r of sceneRecs) {
    if (!dateMap.has(r.date)) dateMap.set(r.date, []);
    let isFO = false;
    let name = prettyName(r.employee);
    if (isTrainingScene(r.scene)) {
      isFO = true;
      const assoc = dayAssoc.get(getFOAssociationKey(r.date, r.employee)) ?? [];
      if (assoc.length > 0) {
        name = `${prettyName(r.employee)} (${assoc.join(', ')})`;
      }
    }
    dateMap.get(r.date)!.push({ name, time: r.time, isFO });
  }

  for (const r of foRecs) {
    const assoc = dayAssoc.get(getFOAssociationKey(r.date, r.employee)) ?? [];
    if (assoc.includes(scene)) {
      if (!dateMap.has(r.date)) dateMap.set(r.date, []);
      const label = r.scene ? ` (${r.scene})` : '';
      dateMap.get(r.date)!.push({
        name: `${prettyName(r.employee)}${label}`,
        time: r.time,
        isFO: true
      });
    }
  }

  const allDates = Array.from(new Set(records.map(r => r.date).filter(Boolean))).sort();
  const dates = allDates.map(d => ({
    date: d,
    rows: (dateMap.get(d) ?? []).sort((a, b) => a.name.localeCompare(b.name, 'fr')),
  }));

  const totalRows = dates.reduce((acc, d) => acc + Math.max(1, d.rows.length), 0);
  const periodStart = allDates[0] ? fmtDate(allDates[0]) : '';
  const periodEnd = allDates[allDates.length - 1] ? fmtDate(allDates[allDates.length - 1]) : '';
  const period = periodStart && periodEnd && periodStart !== periodEnd
    ? `${periodStart} au ${periodEnd}`
    : periodStart;

  await generateAndSave({
    title: scene,
    subtitle: period ? `Période : ${period}` : 'Période',
    blocks: dates.map(d => ({ header: fmtDateShort(d.date), rows: d.rows })),
    itemCount: dates.length,
    totalRows,
    filename: `sfx-planning-${slug(scene)}.pdf`,
  });
}


function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'scene';
}

async function generateAndSave(opts: {
  title: string;
  subtitle: string;
  blocks: Array<{ header: string; rows: Array<{ name: string; time: string; isFO?: boolean }> }>;
  itemCount: number;
  totalRows: number;
  filename: string;
}): Promise<void> {
  const logo = await getLogoDataUrl();
  // Pick layout, then try to render. If it doesn't fit, bump density and retry.
  const tiers = [
    chooseLayout(opts.itemCount, opts.totalRows),
  ];
  // Pre-add denser fallbacks
  tiers.push({ orientation: 'landscape', cols: 2, fontTitle: 16, fontSub: 10, fontSection: 10.5, fontRow: 9, rowHeight: 4.2, sectionGap: 2.8, rowGap: 0.3, dense: false });
  tiers.push({ orientation: 'landscape', cols: 3, fontTitle: 15, fontSub: 9.5, fontSection: 10, fontRow: 8.5, rowHeight: 3.8, sectionGap: 2.4, rowGap: 0.2, dense: true });
  tiers.push({ orientation: 'landscape', cols: 4, fontTitle: 14, fontSub: 9, fontSection: 9.5, fontRow: 8, rowHeight: 3.4, sectionGap: 2, rowGap: 0.2, dense: true });
  tiers.push({ orientation: 'landscape', cols: 5, fontTitle: 13, fontSub: 8.5, fontSection: 9, fontRow: 7.5, rowHeight: 3.1, sectionGap: 1.6, rowGap: 0.15, dense: true });

  for (const layout of tiers) {
    const doc = new jsPDF({ orientation: layout.orientation, unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 10;
    const marginTop = 9;
    const contentY = drawHeader(doc, pageW, marginX, marginTop, opts.title, opts.subtitle, layout, logo);
    const ok = drawBlocks(doc, opts.blocks, contentY, marginX, marginX, pageW, pageH, layout);
    if (ok) {
      drawFooter(doc, pageW, pageH, marginX, layout.dense, layout.dense);
      doc.save(opts.filename);
      return;
    }
  }
  // Last resort: smallest layout, force render (truncate gracefully)
  const layout: LayoutChoice = { orientation: 'landscape', cols: 6, fontTitle: 12, fontSub: 8, fontSection: 8.5, fontRow: 7, rowHeight: 2.9, sectionGap: 1.4, rowGap: 0.1, dense: true };
  const doc = new jsPDF({ orientation: layout.orientation, unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 8;
  const marginTop = 8;
  const contentY = drawHeader(doc, pageW, marginX, marginTop, opts.title, opts.subtitle, layout, logo);
  drawBlocks(doc, opts.blocks, contentY, marginX, marginX, pageW, pageH, layout);
  drawFooter(doc, pageW, pageH, marginX, true, true);
  doc.save(opts.filename);
}

export function listScenes(records: PlanningRecord[]): string[] {
  const set = new Set<string>();
  for (const r of records) {
    if (r.scene && r.time !== 'OFF') set.add(r.scene);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));
}

export async function exportGlobalRecapPdf(records: PlanningRecord[]): Promise<void> {
  const logo = await getLogoDataUrl();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 10;
  const marginTop = 9;

  // Gather general statistics
  const uniqueTechs = new Set(records.map(r => r.employee)).size;
  const uniqueScenes = new Set(records.filter(r => r.scene && r.time !== 'OFF').map(r => r.scene)).size;
  const totalShifts = records.filter(r => r.time !== 'OFF').length;
  const allDates = Array.from(new Set(records.map(r => r.date).filter(Boolean))).sort();
  const periodStart = allDates[0] ? fmtDate(allDates[0]) : '';
  const periodEnd = allDates[allDates.length - 1] ? fmtDate(allDates[allDates.length - 1]) : '';
  const period = periodStart && periodEnd && periodStart !== periodEnd
    ? `${periodStart} au ${periodEnd}`
    : periodStart;

  // PAGE 1: TABLEAU DE BORD GÉNÉRAL
  {
    const layout: LayoutChoice = { orientation: 'landscape', cols: 2, fontTitle: 16, fontSub: 10, fontSection: 11, fontRow: 9.5, rowHeight: 4.6, sectionGap: 3.2, rowGap: 0.4, dense: false };
    const contentY = drawHeader(doc, pageW, marginX, marginTop, "Rapport Cockpit SFX — Synthèse", period ? `Période du ${period}` : 'Période globale', layout, logo);
    
    // Draw 3 KPI Blocks on the left (width: 80mm)
    const kpiX = marginX;
    const kpiW = 80;
    const kpiH = 14;
    let kpiY = contentY + 2;
    
    drawKpiCard(doc, kpiX, kpiY, kpiW, kpiH, String(uniqueTechs), "TECHNICIENS ACTIFS");
    kpiY += kpiH + 4;
    drawKpiCard(doc, kpiX, kpiY, kpiW, kpiH, String(uniqueScenes), "SCENES & FORMATIONS (FO)");
    kpiY += kpiH + 4;
    drawKpiCard(doc, kpiX, kpiY, kpiW, kpiH, String(totalShifts), "POSTES PLANIFIES SUR LA PERIODE");
    
    // Draw a nice bordered box on the left below KPIs for imported weeks
    kpiY += kpiH + 6;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.15);
    const weeksBoxH = pageH - 14 - kpiY;
    doc.roundedRect(kpiX, kpiY, kpiW, weeksBoxH, 1.6, 1.6, 'FD');
    doc.setFillColor(TEAL[0], TEAL[1], TEAL[2]);
    doc.roundedRect(kpiX, kpiY, kpiW, 5.5, 1.6, 1.6, 'F');
    doc.rect(kpiX, kpiY + 3, kpiW, 2.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    doc.text("Plannings importés", kpiX + 3, kpiY + 4);
    
    // List unique weeks
    const uniqueWeeks = Array.from(new Set(records.map(r => r.weekLabel).filter(Boolean))).sort();
    let wy = kpiY + 9;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(GREY_DARK[0], GREY_DARK[1], GREY_DARK[2]);
    if (uniqueWeeks.length === 0) {
      doc.text("Aucun planning", kpiX + 4, wy);
    } else {
      for (const w of uniqueWeeks) {
        if (wy + 4 > kpiY + weeksBoxH) break;
        doc.setFillColor(31, 122, 112);
        doc.circle(kpiX + 5, wy - 1.2, 0.7, 'F');
        doc.text(w, kpiX + 8, wy);
        wy += 4.5;
      }
    }

    // Draw the big technicians roster in 2 columns on the right (width: 185mm)
    const listX = marginX + kpiW + 6;
    const listW = pageW - marginX * 2 - kpiW - 6;
    const listH = pageH - 14 - contentY;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.15);
    doc.roundedRect(listX, contentY, listW, listH, 1.6, 1.6, 'FD');
    doc.setFillColor(TEAL[0], TEAL[1], TEAL[2]);
    doc.roundedRect(listX, contentY, listW, 6.5, 1.6, 1.6, 'F');
    doc.rect(listX, contentY + 3, listW, 3.5, 'F');
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(255, 255, 255);
    doc.text("Roster des Techniciens Actifs", listX + 4, contentY + 4.5);

    // Get list of employees sorted alphabetically
    const employees = Array.from(new Set(records.map(r => r.employee))).sort((a, b) => prettyName(a).localeCompare(prettyName(b), 'fr'));
    
    // Split into 2 sub-columns inside the right box
    const subColW = (listW - 8) / 2;
    let rx = listX + 4;
    let ry = contentY + 11;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    
    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      const activeDays = records.filter(r => r.employee === emp && r.time !== 'OFF').length;
      const totalWeeks = new Set(records.filter(r => r.employee === emp).map(r => r.weekLabel)).size;
      
      const txt = `${prettyName(emp)}`;
      const statsTxt = `${activeDays}j / ${totalWeeks}sem`;
      
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(GREY_DARK[0], GREY_DARK[1], GREY_DARK[2]);
      doc.text(txt, rx, ry);
      
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(GREY_MED[0], GREY_MED[1], GREY_MED[2]);
      doc.text(statsTxt, rx + subColW - 2, ry, { align: 'right' });
      
      // Light row divider
      doc.setDrawColor(235, 235, 240);
      doc.setLineWidth(0.1);
      doc.line(rx, ry + 1.2, rx + subColW, ry + 1.2);
      
      ry += 5.2;
      
      // If we hit the bottom, switch to the second column
      if (ry + 4 > contentY + listH) {
        if (rx === listX + 4) {
          rx = listX + 4 + subColW + 4;
          ry = contentY + 11;
        } else {
          // If we overflow the second column as well, truncate
          break;
        }
      }
    }

    drawFooter(doc, pageW, pageH, marginX, false, false);
  }

  // PAGE 2: ROTATION DES SCÈNES (DAILY ROSTER)
  {
    doc.addPage();
    const layout: LayoutChoice = { orientation: 'landscape', cols: 3, fontTitle: 16, fontSub: 10, fontSection: 11, fontRow: 9, rowHeight: 4.2, sectionGap: 2.8, rowGap: 0.3, dense: false };
    const contentY = drawHeader(doc, pageW, marginX, marginTop, "Rapport Cockpit SFX — Affectations", "Rotation des équipes sur les différentes scènes", layout, logo);
    
    // Group records by Scene, then list technicians per Date
    // Group only scenes that are active (excluding OFF)
    const sceneMap = new Map<string, Map<string, string[]>>();
    for (const r of records) {
      if (r.time === 'OFF' || !r.scene || isTrainingScene(r.scene)) continue;
      if (!sceneMap.has(r.scene)) sceneMap.set(r.scene, new Map());
      const dateMap = sceneMap.get(r.scene)!;
      if (!dateMap.has(r.date)) dateMap.set(r.date, []);
      dateMap.get(r.date)!.push(prettyName(r.employee));
    }
    
    // Convert to block format for drawBlocks
    const blocks: Array<{ header: string; rows: Array<{ name: string; time: string }> }> = [];
    const sortedScenes = Array.from(sceneMap.keys()).sort((a, b) => a.localeCompare(b, 'fr'));
    
    for (const scene of sortedScenes) {
      const dateMap = sceneMap.get(scene)!;
      const sortedDates = Array.from(dateMap.keys()).sort();
      const rows = sortedDates.map(date => {
        const names = dateMap.get(date)!;
        const shortNames = names.map(n => {
          const parts = n.split(' ');
          return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : n;
        }).join(', ');
        return {
          name: fmtDateShort(date),
          time: shortNames
        };
      });
      blocks.push({ header: scene, rows });
    }

    drawBlocks(doc, blocks, contentY, marginX, marginX, pageW, pageH, layout);
    drawFooter(doc, pageW, pageH, marginX, false, false);
  }

  // PAGE 3: SUIVI DES FORMATIONS (CALENDRIER FO)
  {
    doc.addPage();
    const layout: LayoutChoice = { orientation: 'landscape', cols: 2, fontTitle: 16, fontSub: 10, fontSection: 11, fontRow: 9.5, rowHeight: 4.6, sectionGap: 3.2, rowGap: 0.4, dense: false };
    const contentY = drawHeader(doc, pageW, marginX, marginTop, "Rapport Cockpit SFX — Calendrier FO", "Suivi détaillé des formations et scènes associées", layout, logo);
    
    // Group FO (Training) records
    const foRecs = records.filter(r => isTrainingScene(r.scene) && r.time !== 'OFF');
    const dayAssoc = computeAllFOAssociations(records);

    // Group by Date for chronological display
    const dateMap = new Map<string, Array<{ tech: string; scene: string; assoc: string[]; time: string }>>();
    for (const r of foRecs) {
      if (!dateMap.has(r.date)) dateMap.set(r.date, []);
      const key = getFOAssociationKey(r.date, r.employee);
      const assoc = dayAssoc.get(key) ?? [];
      dateMap.get(r.date)!.push({
        tech: prettyName(r.employee),
        scene: r.scene,
        assoc,
        time: r.time
      });
    }

    const blocks: Array<{ header: string; rows: Array<{ name: string; time: string; isFO?: boolean }> }> = [];
    const sortedDates = Array.from(dateMap.keys()).sort();
    
    for (const date of sortedDates) {
      const daySessions = dateMap.get(date)!;
      const rows = daySessions.map(s => {
        const assocTxt = s.assoc.length > 0 ? ` ➔ Associé à : ${s.assoc.join(', ')}` : '';
        return {
          name: `${s.tech} — ${s.scene}${assocTxt}`,
          time: s.time,
          isFO: true
        };
      });
      blocks.push({ header: fmtDate(date), rows });
    }

    drawBlocks(doc, blocks, contentY, marginX, marginX, pageW, pageH, layout);
    drawFooter(doc, pageW, pageH, marginX, false, false);
  }

  doc.save("sfx-planning-cockpit-3pages.pdf");
}

function drawKpiCard(doc: jsPDF, x: number, y: number, w: number, h: number, value: string, label: string) {
  // Rounded card container background
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.15);
  doc.roundedRect(x, y, w, h, 1.6, 1.6, 'FD');
  
  // Progress bottom highlight line
  doc.setFillColor(255, 176, 58);
  doc.rect(x + 2, y + h - 1.2, w - 4, 0.4, 'F');
  
  // Value text centered
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(255, 176, 58);
  doc.text(value, x + w / 2, y + h * 0.52, { align: 'center' });
  
  // Label text centered
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(110, 110, 116);
  doc.text(label, x + w / 2, y + h * 0.82, { align: 'center' });
}
