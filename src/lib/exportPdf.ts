import jsPDF from 'jspdf';
import type { PlanningRecord } from './parsePdf';
import { getFOAssociations, computeAllFOAssociations, getFOAssociationKey, isTrainingScene, getSceneColor } from './utils';

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

const DAY_FR_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const DAY_FR_SHORT = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];

function cleanText(text: string): string {
  if (!text) return '';
  return text.replace(/[Ø<ß"«»®©]/g, '').replace(/\s+/g, ' ').trim();
}

function weekdayFromIso(iso: string): number | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
  if (isNaN(d.getTime())) return null;
  return d.getUTCDay();
}

let logoDataUrlPromise: Promise<string | null> | null = null;
function getLogoDataUrl(): Promise<string | null> {
  if (logoDataUrlPromise) return logoDataUrlPromise;
  logoDataUrlPromise = (async () => {
    try {
      const base = (typeof window !== 'undefined' && (window as any).__BASE_URL__) || ((import.meta as any).env?.BASE_URL ?? '/');
      const url = `${base}sfx-dragon-logo.jpg`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob);
      });
    } catch { return null; }
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

function fmtDateShort(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const wd = weekdayFromIso(iso);
  const prefix = wd !== null ? `${DAY_FR_SHORT[wd]} ` : '';
  return `${prefix}${m[3]}/${m[2]}/${m[1]}`;
}

function prettyName(s: string): string {
  const idx = s.indexOf(',');
  const tc = (w: string) => w.split(/([-'])/).map(p => /^[-']$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
  const tcp = (str: string) => str.trim().split(/\s+/).map(tc).join(' ');
  if (idx === -1) return cleanText(tcp(s));
  const last = tcp(s.slice(0, idx)); const first = tcp(s.slice(idx + 1));
  if (!first) return cleanText(last); if (!last) return cleanText(first);
  return cleanText(`${first} ${last}`);
}

interface LayoutChoice { orientation: 'portrait' | 'landscape'; cols: number; fontTitle: number; fontSub: number; fontSection: number; fontRow: number; rowHeight: number; sectionGap: number; rowGap: number; dense: boolean; }

function chooseLayout(itemCount: number, totalRows: number): LayoutChoice {
  const density = itemCount + totalRows * 0.6;
  if (density <= 30) return { orientation: 'portrait', cols: 1, fontTitle: 18, fontSub: 11, fontSection: 12, fontRow: 10, rowHeight: 5.2, sectionGap: 4, rowGap: 0.6, dense: false };
  if (density <= 60) return { orientation: 'portrait', cols: 2, fontTitle: 17, fontSub: 10.5, fontSection: 11, fontRow: 9.5, rowHeight: 4.6, sectionGap: 3.2, rowGap: 0.4, dense: false };
  if (density <= 110) return { orientation: 'landscape', cols: 2, fontTitle: 16, fontSub: 10, fontSection: 10.5, fontRow: 9, rowHeight: 4.2, sectionGap: 2.8, rowGap: 0.3, dense: false };
  if (density <= 180) return { orientation: 'landscape', cols: 3, fontTitle: 15, fontSub: 9.5, fontSection: 10, fontRow: 8.5, rowHeight: 3.8, sectionGap: 2.4, rowGap: 0.2, dense: true };
  return { orientation: 'landscape', cols: 4, fontTitle: 14, fontSub: 9, fontSection: 9.5, fontRow: 8, rowHeight: 3.4, sectionGap: 2, rowGap: 0.2, dense: true };
}

function drawHeader(doc: jsPDF, pageW: number, marginX: number, marginTop: number, title: string, subtitle: string, layout: LayoutChoice, logo: string | null): number {
  const bannerH = 16;
  doc.setFillColor(13, 20, 35); doc.roundedRect(marginX, marginTop, pageW - marginX * 2, bannerH, 2, 2, 'F');
  doc.setFillColor(255, 176, 58); doc.rect(marginX + 2, marginTop + bannerH - 0.8, pageW - marginX * 2 - 4, 0.4, 'F');
  let textX = marginX + 4;
  if (logo) { try { doc.addImage(logo, 'JPEG', marginX + 3, marginTop + 2.2, 11.5, 11.5); textX = marginX + 17; } catch { } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(layout.fontTitle - 2.5); doc.setTextColor(255, 255, 255); doc.text(title, textX, marginTop + 6.2);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(layout.fontSub - 1.2); doc.setTextColor(165, 185, 215); doc.text(subtitle, textX, marginTop + 11.8);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(255, 176, 58); doc.text('SFX PLANNER', pageW - marginX - 4, marginTop + 9.5, { align: 'right' });
  return marginTop + bannerH + 4;
}

function drawFooter(doc: jsPDF, pageW: number, pageH: number, marginX: number) {
  doc.setDrawColor(GREY_LINE[0], GREY_LINE[1], GREY_LINE[2]); doc.setLineWidth(0.2); doc.line(marginX, pageH - 11, pageW - marginX, pageH - 11);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(ORANGE[0], ORANGE[1], ORANGE[2]);
  doc.text("ATTENTION : Contrôle obligatoire sur UKG personnel. L'affectation des formations (FO) est donnée à titre indicatif et peut varier. Données traitées localement.", pageW / 2, pageH - 7, { align: 'center' });
}

function drawBlocks(doc: jsPDF, blocks: Array<{ header: string; rows: Array<{ name: string; time: string; isFO?: boolean }> }>, startY: number, marginX: number, marginRight: number, pageW: number, pageH: number, layout: LayoutChoice): boolean {
  const bottom = pageH - 14; const availW = pageW - marginX - marginRight; const gutter = 4; const colW = (availW - gutter * (layout.cols - 1)) / layout.cols;
  let col = 0; let y = startY; const colYs: number[] = new Array(layout.cols).fill(startY);
  for (const block of blocks) {
    const cardHeaderHeight = 6.0; const cardPaddingTop = 1.2; const cardPaddingBottom = 2.0; const cardPaddingLeftRight = 3.0;
    const rowsLen = Math.max(1, block.rows.length); const cardHeight = cardHeaderHeight + cardPaddingTop + rowsLen * (layout.rowHeight + layout.rowGap) + cardPaddingBottom; const blockHeight = cardHeight + layout.sectionGap;
    let placed = false;
    for (let tries = 0; tries < layout.cols; tries++) { const idx = (col + tries) % layout.cols; if (colYs[idx] + blockHeight <= bottom) { col = idx; y = colYs[idx]; placed = true; break; } }
    if (!placed) return false;
    const x = marginX + col * (colW + gutter);
    doc.setFillColor(248, 250, 252); doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.15); doc.roundedRect(x, y, colW, cardHeight, 1.6, 1.6, 'FD');
    doc.setFillColor(TEAL[0], TEAL[1], TEAL[2]); doc.roundedRect(x, y, colW, cardHeaderHeight, 1.6, 1.6, 'F'); doc.rect(x, y + 3, colW, cardHeaderHeight - 3, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(layout.fontSection - 0.5); doc.setTextColor(255, 255, 255);
    const headerText = doc.splitTextToSize(block.header, colW - cardPaddingLeftRight * 2)[0] as string; doc.text(headerText, x + cardPaddingLeftRight, y + cardHeaderHeight * 0.7);
    let ry = y + cardHeaderHeight + cardPaddingTop + 1.0;
    if (block.rows.length === 0) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(layout.fontRow); doc.setTextColor(GREY_MED[0], GREY_MED[1], GREY_MED[2]); doc.text('Aucun technicien', x + cardPaddingLeftRight, ry + layout.rowHeight * 0.55); ry += layout.rowHeight + layout.rowGap;
    } else {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(layout.fontRow);
      for (const row of block.rows) {
        const isFO = (row as any).isFO; const timeStr = row.time || ''; const timeW = doc.getTextWidth(timeStr) + 4;
        const pillW = isFO ? 7.5 : 0; const nameMax = colW - cardPaddingLeftRight * 2 - timeW - pillW - 2.5; const nameTxt = (doc.splitTextToSize(row.name, nameMax)[0] as string) || row.name;
        let nameX = x + cardPaddingLeftRight;
        if (isFO) {
          const foPillW = 6; const foPillH = layout.rowHeight * 0.85; const foPillY = ry + (layout.rowHeight - foPillH) / 2;
          doc.setFillColor(120, 90, 230); doc.roundedRect(x + cardPaddingLeftRight, foPillY, foPillW, foPillH, 0.5, 0.5, 'F');
          doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(layout.fontRow - 1.5); doc.text('FO', x + cardPaddingLeftRight + foPillW / 2, foPillY + foPillH * 0.72, { align: 'center' });
          doc.setFont('helvetica', 'normal'); doc.setFontSize(layout.fontRow); nameX = x + cardPaddingLeftRight + foPillW + 1.5;
        }
        doc.setTextColor(GREY_DARK[0], GREY_DARK[1], GREY_DARK[2]); doc.text(nameTxt, nameX, ry + layout.rowHeight * 0.62);
        const isOff = /^off$/i.test(timeStr); const pillColor: [number, number, number] = isOff ? GREY_MED : ORANGE;
        doc.setFillColor(pillColor[0], pillColor[1], pillColor[2]); const pillH = layout.rowHeight * 0.85; const pillY = ry + (layout.rowHeight - pillH) / 2; const pillX = x + colW - cardPaddingLeftRight - timeW;
        doc.roundedRect(pillX, pillY, timeW, pillH, 0.8, 0.8, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(layout.fontRow - 0.5); doc.text(timeStr, pillX + timeW / 2, pillY + pillH * 0.72, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(layout.fontRow); ry += layout.rowHeight + layout.rowGap;
      }
    }
    colYs[col] = y + blockHeight;
  }
  return true;
}

function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'scene';
}

async function generateAndSave(opts: { title: string; subtitle: string; blocks: Array<{ header: string; rows: Array<{ name: string; time: string; isFO?: boolean }> }>; itemCount: number; totalRows: number; filename: string; }): Promise<void> {
  const logo = await getLogoDataUrl(); const tiers = [chooseLayout(opts.itemCount, opts.totalRows)];
  tiers.push({ orientation: 'landscape', cols: 2, fontTitle: 16, fontSub: 10, fontSection: 10.5, fontRow: 9, rowHeight: 4.2, sectionGap: 2.8, rowGap: 0.3, dense: false });
  tiers.push({ orientation: 'landscape', cols: 3, fontTitle: 15, fontSub: 9.5, fontSection: 10, fontRow: 8.5, rowHeight: 3.8, sectionGap: 2.4, rowGap: 0.2, dense: true });
  tiers.push({ orientation: 'landscape', cols: 4, fontTitle: 14, fontSub: 9, fontSection: 9.5, fontRow: 8, rowHeight: 3.4, sectionGap: 2, rowGap: 0.2, dense: true });
  for (const layout of tiers) {
    const doc = new jsPDF({ orientation: layout.orientation, unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth(); const pageH = doc.internal.pageSize.getHeight();
    const contentY = drawHeader(doc, pageW, 10, 9, opts.title, opts.subtitle, layout, logo);
    if (drawBlocks(doc, opts.blocks, contentY, 10, 10, pageW, pageH, layout)) { drawFooter(doc, pageW, pageH, 10); doc.save(opts.filename); return; }
  }
  const layout: LayoutChoice = { orientation: 'landscape', cols: 6, fontTitle: 12, fontSub: 8, fontSection: 8.5, fontRow: 7, rowHeight: 2.9, sectionGap: 1.4, rowGap: 0.1, dense: true };
  const doc = new jsPDF({ orientation: layout.orientation, unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth(); const pageH = doc.internal.pageSize.getHeight();
  const contentY = drawHeader(doc, pageW, 8, 8, opts.title, opts.subtitle, layout, logo);
  drawBlocks(doc, opts.blocks, contentY, 8, 8, pageW, pageH, layout); drawFooter(doc, pageW, pageH, 8); doc.save(opts.filename);
}

// ----------------------------------------------------
// NOUVEAU DESIGN : EXPORT QUOTIDIEN SOUS FORME DE CARTES
// ----------------------------------------------------
export async function exportDayPdf(date: string, records: PlanningRecord[]): Promise<void> {
  const logo = await getLogoDataUrl();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth(); const pageH = doc.internal.pageSize.getHeight();
  const marginX = 12; const bottomMargin = pageH - 15;
  
  const drawHeaderLocal = (d: jsPDF, w: number, mX: number, mT: number, t: string, s: string) => {
    const bannerH = 18; d.setFillColor(13, 20, 35); d.roundedRect(mX, mT, w - mX * 2, bannerH, 2, 2, 'F');
    d.setFillColor(255, 176, 58); d.rect(mX + 2, mT + bannerH - 0.8, w - mX * 2 - 4, 0.4, 'F');
    let textX = mX + 4; if (logo) { try { d.addImage(logo, 'JPEG', mX + 3, mT + 2.5, 13, 13); textX = mX + 19; } catch { } }
    d.setFont('helvetica', 'bold'); d.setFontSize(15); d.setTextColor(255, 255, 255); d.text(t, textX, mT + 6.5);
    d.setFont('helvetica', 'normal'); d.setFontSize(10); d.setTextColor(165, 185, 215); d.text(s, textX, mT + 12.5);
    d.setFont('helvetica', 'bold'); d.setFontSize(10); d.setTextColor(255, 176, 58); d.text('DÉPARTEMENT SFX', w - mX - 5, mT + 10.5, { align: 'right' });
    return mT + bannerH + 6;
  };

  let currentY = drawHeaderLocal(doc, pageW, marginX, 10, 'Vue globale du jour', fmtDate(date));

  const dayRecs = records.filter(r => r.date === date && r.time !== 'OFF');
  const activeRegs = dayRecs.filter(r => !isTrainingScene(r.scene));
  const activeFOs = dayRecs.filter(r => isTrainingScene(r.scene));
  const dayAssoc = getFOAssociations(dayRecs);
  const sceneMap = new Map<string, Array<{ name: string; time: string; isFO?: boolean }>>();
  
  for (const r of activeRegs) { if (!sceneMap.has(r.scene)) sceneMap.set(r.scene, []); sceneMap.get(r.scene)!.push({ name: prettyName(r.employee), time: r.time }); }
  for (const r of activeFOs) {
    const assoc = dayAssoc.get(r.employee) ?? []; const groupKey = isTrainingScene(r.scene) ? r.scene : 'FO';
    if (!sceneMap.has(groupKey)) sceneMap.set(groupKey, []);
    sceneMap.get(groupKey)!.push({ name: `${prettyName(r.employee)}${assoc.length > 0 ? ` (${assoc.join(', ')})` : ''}`, time: r.time, isFO: true });
    for (const scene of assoc) { if (!sceneMap.has(scene)) sceneMap.set(scene, []); sceneMap.get(scene)!.push({ name: `${prettyName(r.employee)} (${r.scene ? r.scene : 'FO'})`, time: r.time, isFO: true }); }
  }

  const scenes = Array.from(sceneMap.entries()).sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([scene, rows]) => ({ scene: cleanText(scene), rows: rows.sort((a, b) => a.name.localeCompare(b.name, 'fr')) }));

  for (const block of scenes) {
    const cardHeight = 8.0 + 2.0 + block.rows.length * 6.0 + 3.0;
    if (currentY + cardHeight > bottomMargin) {
      doc.setDrawColor(220, 220, 224); doc.setLineWidth(0.2); doc.line(marginX, pageH - 12, pageW - marginX, pageH - 12); doc.addPage();
      currentY = drawHeaderLocal(doc, pageW, marginX, 10, 'Vue globale du jour (suite)', fmtDate(date));
    }

    doc.setFillColor(250, 251, 252); doc.setDrawColor(218, 223, 230); doc.setLineWidth(0.2); doc.roundedRect(marginX, currentY, pageW - marginX * 2, cardHeight, 2, 2, 'FD');
    const dCol = getSceneColor(block.scene).accent;
    doc.setFillColor(dCol === '#5850ec' ? TEAL[0] : 45, dCol === '#5850ec' ? TEAL[1] : 85, dCol === '#5850ec' ? TEAL[2] : 95);
    doc.roundedRect(marginX, currentY, pageW - marginX * 2, 8.0, 2, 2, 'F'); doc.rect(marginX, currentY + 4, pageW - marginX * 2, 4, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(255, 255, 255); doc.text(block.scene, marginX + 4.0, currentY + 5.2);

    let ry = currentY + 11.0; doc.setFontSize(10);
    for (const row of block.rows) {
      let nameX = marginX + 4.0;
      if (row.isFO) {
        doc.setFillColor(108, 92, 231); doc.roundedRect(marginX + 4.0, ry, 7, 4.5, 0.8, 0.8, 'F');
        doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.text('FO', marginX + 7.5, ry + 3.2, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); nameX = marginX + 13.0;
      }
      doc.setTextColor(GREY_DARK[0], GREY_DARK[1], GREY_DARK[2]); doc.text(row.name, nameX, ry + 3.5);
      const timeW = doc.getTextWidth(row.time || '') + 5; const pillX = pageW - marginX - 4.0 - timeW;
      doc.setFillColor(ORANGE[0], ORANGE[1], ORANGE[2]); doc.roundedRect(pillX, ry, timeW, 4.8, 1, 1, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.text(row.time || '', pillX + timeW / 2, ry + 3.4, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); ry += 6.0;
    }
    currentY += cardHeight + 5;
  }
  doc.setDrawColor(220, 220, 224); doc.setLineWidth(0.2); doc.line(marginX, pageH - 12, pageW - marginX, pageH - 12); doc.save(`sfx-planning-${date}.pdf`);
}

export async function exportEmployeePdf(employee: string, records: PlanningRecord[]): Promise<void> {
  const empRecs = records.filter(r => r.employee === employee); const dayAssoc = computeAllFOAssociations(records);
  const dateMap = new Map<string, Array<{ name: string; time: string; isFO?: boolean }>>();
  for (const r of empRecs) {
    if (!dateMap.has(r.date)) dateMap.set(r.date, []);
    let name = r.scene || '-'; let isFO = false;
    if (isTrainingScene(r.scene)) { isFO = true; const assoc = dayAssoc.get(getFOAssociationKey(r.date, r.employee)) ?? []; if (assoc.length > 0) name = `${assoc.join(', ')} (${r.scene})`; }
    dateMap.get(r.date)!.push(r.time === 'OFF' ? { name: 'Repos / congé', time: 'OFF' } : { name, time: r.time, isFO });
  }
  const allDates = Array.from(dateMap.keys()).filter(Boolean).sort();
  const blocks = allDates.map(d => ({ header: fmtDateShort(d), rows: (dateMap.get(d) ?? []) }));
  const periodStart = allDates[0] ? fmtDate(allDates[0]) : ''; const periodEnd = allDates[allDates.length - 1] ? fmtDate(allDates[allDates.length - 1]) : '';
  const period = periodStart && periodEnd && periodStart !== periodEnd ? `${periodStart} au ${periodEnd}` : periodStart;
  await generateAndSave({ title: prettyName(employee), subtitle: period ? `Planning individuel - ${period}` : 'Planning individuel', blocks, itemCount: blocks.length, totalRows: blocks.reduce((acc, b) => acc + Math.max(1, b.rows.length), 0), filename: `sfx-planning-indiv-${slug(prettyName(employee))}.pdf` });
}

export async function exportScenePdf(scene: string, records: PlanningRecord[]): Promise<void> {
  const sceneRecs = records.filter(r => r.scene === scene && r.time !== 'OFF'); const foRecs = records.filter(r => isTrainingScene(r.scene) && r.time !== 'OFF'); const dayAssoc = computeAllFOAssociations(records);
  const dateMap = new Map<string, Array<{ name: string; time: string; isFO?: boolean }>>();
  for (const r of sceneRecs) {
    if (!dateMap.has(r.date)) dateMap.set(r.date, []);
    let isFO = false; let name = prettyName(r.employee);
    if (isTrainingScene(r.scene)) { isFO = true; const assoc = dayAssoc.get(getFOAssociationKey(r.date, r.employee)) ?? []; if (assoc.length > 0) name = `${prettyName(r.employee)} (${assoc.join(', ')})`; }
    dateMap.get(r.date)!.push({ name, time: r.time, isFO });
  }
  for (const r of foRecs) {
    const assoc = dayAssoc.get(getFOAssociationKey(r.date, r.employee)) ?? [];
    if (assoc.includes(scene)) { if (!dateMap.has(r.date)) dateMap.set(r.date, []); const label = r.scene ? ` (${r.scene})` : ''; dateMap.get(r.date)!.push({ name: `${prettyName(r.emp