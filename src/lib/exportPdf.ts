import { jsPDF } from 'jspdf';
import type { PlanningRecord } from './parsePdf';
import { isTrainingScene, getSceneColor, timesMatch, prettyName, dayInitials, cleanSceneName, parseRange } from './utils';

/* ─── Design Tokens (matches app CSS) ─── */
const AMBER:   [number,number,number] = [255, 176, 58];
const AMBER2:  [number,number,number] = [232, 130, 30];
const VIOLET:  [number,number,number] = [108, 92,  231];
const WHITE:   [number,number,number] = [255, 255, 255];
const INK:     [number,number,number] = [22,  28,  46];
const MUTED:   [number,number,number] = [100, 110, 130];
// const DIVIDER: [number,number,number] = [220, 225, 235];

const MONTH_FR: Record<string,string> = {
  '01':'janv.','02':'févr.','03':'mars','04':'avril','05':'mai',
  '06':'juin','07':'juil.','08':'août','09':'sept.','10':'oct.',
  '11':'nov.','12':'déc.',
};
const DAY_FR_FULL  = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
const DAY_FR_SHORT = ['Dim.','Lun.','Mar.','Mer.','Jeu.','Ven.','Sam.'];

function cleanText(t: string): string {
  return (t||'').replace(/[Ø<ß"«»®©]/g,'').replace(/^ENT\s+/i, '').replace(/\bENT\b\s*/gi, '').replace(/\s+/g,' ').trim();
}
function weekdayFromIso(iso: string): number|null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));
  return isNaN(d.getTime()) ? null : d.getUTCDay();
}
function fmtDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return iso;
  const wd = weekdayFromIso(iso); const pf = wd !== null ? `${DAY_FR_FULL[wd]} ` : '';
  return `${pf}${+m[3]} ${MONTH_FR[m[2]]??m[2]} ${m[1]}`;
}
function fmtDateShort(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return iso;
  const wd = weekdayFromIso(iso); const pf = wd !== null ? `${DAY_FR_SHORT[wd]} ` : '';
  return `${pf}${m[3]}/${m[2]}`;
}
function initials(name: string): string {
  return dayInitials(name);
}
function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'scene';
}

/* ─── Direct PDF Download (Mobile & Desktop) ─── */
export async function downloadOrSharePdf(doc: jsPDF, filename: string): Promise<void> {
  if (typeof window === 'undefined') {
    doc.save(filename);
    return;
  }

  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);

  try {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
      URL.revokeObjectURL(blobUrl);
    }, 4000);
  } catch {
    doc.save(filename);
  }
}

/* ─── Logo cache ─── */
let logoPromise: Promise<string|null>|null = null;
function getLogoDataUrl(): Promise<string|null> {
  if (logoPromise) return logoPromise;
  return logoPromise = (async () => {
    try {
      const base = (typeof window!=='undefined'&&(window as unknown as {__BASE_URL__:string}).__BASE_URL__)||((import.meta as unknown as {env:{BASE_URL?:string}}).env?.BASE_URL??'/');
      const res = await fetch(`${base}sfx-dragon-logo.jpg`);
      if (!res.ok) return null;
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      return await new Promise<string>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const size = Math.min(img.width, img.height);
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(objUrl);
          
          ctx.beginPath();
          ctx.arc(size/2, size/2, size/2, 0, Math.PI * 2, true);
          ctx.closePath();
          ctx.clip();
          
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, size, size);
          
          const dx = (img.width - size) / 2;
          const dy = (img.height - size) / 2;
          ctx.drawImage(img, dx, dy, size, size, 0, 0, size, size);
          
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = objUrl;
      });
    } catch { return null; }
  })();
}

/* ─── Premium Header (Clean SFX Planner Console Bar) ─── */
function drawPremiumHeader(doc: jsPDF, pageW: number, marginX: number, y: number,
  title: string, subtitle: string, logo: string|null, rightLabel = 'SFX PLANNER', statsBadge?: string): number {
  const h = 20;
  const innerW = pageW - marginX * 2;

  // Print-friendly Light Header: Pure white card with subtle slate-300 border
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(203, 213, 225); // Slate-300
  doc.setLineWidth(0.3);
  doc.roundedRect(marginX, y, innerW, h, 2.0, 2.0, 'FD');

  // Subtle top amber bar
  doc.setFillColor(...AMBER);
  doc.rect(marginX + 2, y, innerW - 4, 0.8, 'F');

  // Logo
  let tx = marginX + 6;
  if (logo) {
    try {
      const lx = marginX + 3.5;
      const ly = y + 2.8;
      const ls = 14.4;
      doc.addImage(logo, 'PNG', lx, ly, ls, ls);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.circle(lx + ls / 2, ly + ls / 2, ls / 2 + 0.2, 'S');
      tx = lx + ls + 4.5;
    } catch { /* ignore */ }
  }

  // Title (Technician name in uppercase, dark ink)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13.5);
  doc.setTextColor(15, 23, 42); // Slate-900
  doc.text(cleanText(title).toUpperCase(), tx, y + 8.2);

  // Subtitle (Period readout)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(71, 85, 105); // Slate-600
  const cleanSub = cleanText(subtitle).replace(/\s*-\s*/, ' — ');
  doc.text(cleanSub, tx, y + 14.0);

  // Stats badge (clean readout in light warm pill)
  if (statsBadge) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    const badgeW = doc.getTextWidth(statsBadge) + 8;
    const bx = pageW - marginX - 36 - badgeW;
    const by = y + 5.0;
    doc.setFillColor(254, 243, 199); // Amber-100
    doc.setDrawColor(252, 211, 77);  // Amber-300
    doc.setLineWidth(0.25);
    doc.roundedRect(bx, by, badgeW, 8.5, 1.5, 1.5, 'FD');
    doc.setTextColor(180, 83, 9);   // Amber-700
    doc.text(statsBadge, bx + badgeW / 2, by + 5.8, { align: 'center' });
  }

  // Right label
  const rightX = pageW - marginX - 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...AMBER2);
  doc.text(rightLabel, rightX, y + 11.0, { align: 'right' });

  return y + h + 4;
}

/* ─── Premium Footer (Clean Status Bar) ─── */
function drawPremiumFooter(doc: jsPDF, pageW: number, pageH: number, marginX: number) {
  const fy = pageH - 9.0;
  // Slate dividing line
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(marginX, fy - 2, pageW - marginX, fy - 2);

  // Left status
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text("SFX PLANNER", marginX + 1, fy + 2.5);

  // Center UKG warning
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.0);
  doc.setTextColor(...AMBER2);
  doc.text("⚠  Contrôle obligatoire sur UKG personnel", pageW / 2, fy + 2.5, { align: 'center' });

  // Right date
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(148, 163, 184);
  const now = new Date();
  const dStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
  doc.text(`Document officiel · Édité le ${dStr}`, pageW - marginX - 1, fy + 2.5, { align: 'right' });
}

/* ─── Avatar circle with initials ─── */
function drawAvatar(doc: jsPDF, x: number, y: number, name: string, color: [number,number,number], size = 4.5) {
  const cx = x + size/2; const cy = y + size/2;
  doc.setFillColor(...color); doc.circle(cx, cy, size/2, 'F');
  // Dark overlay for text contrast
  doc.setTextColor(...WHITE); doc.setFont('helvetica','bold'); doc.setFontSize(size*1.4);
  doc.text(initials(name), cx, cy, {align:'center', baseline:'middle'});
}

/* ─── Scene Card ─── */
/* ─── Compact card dimensions ─── */
const C_HEADER = 6.0;  // card header height mm
const C_PAD_T  = 0.8;  // padding top
const C_PAD_B  = 1.8;  // padding bottom
const C_CARD_GAP = 2.8; // gap between cards
const C_ROW_H  = 4.5;  // row height (was 6.0)
const C_GUTTER = 4.5;  // column gutter
const C_MARGIN = 10;   // page margin

function drawSceneCard(doc: jsPDF, x: number, y: number, w: number,
  headerText: string, rows: Array<{name:string;time:string;isFO?:boolean;subtext?:string}>,
  rowH: number, themeColorName: string, dateStr?: string): number {
  const sc = getSceneColor(themeColorName);
  const accentRgb: [number,number,number] = [
    Math.round(sc.rgbText[0]*0.7 + 30),
    Math.round(sc.rgbText[1]*0.7 + 30),
    Math.round(sc.rgbText[2]*0.7 + 30),
  ];
  const headerH = C_HEADER;
  const padX = 3.5; const padTop = C_PAD_T; const padBot = C_PAD_B;
  let contentH = 0;
  for (const r of rows) {
    if (r.subtext) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5);
      const avSize = Math.min(rowH * 0.72, 3.5);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
      const tw = doc.getTextWidth(r.time||'')+4;
      const maxW = w - padX*2 - 1.5 - avSize - 1.5 - tw - 1.5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5);
      const subLines = doc.splitTextToSize(r.subtext, maxW);
      contentH += rowH + (subLines.length * rowH * 0.50);
    } else {
      contentH += rowH;
    }
  }
  if (rows.length === 0) contentH += rowH;
  const cardH = Math.max(dateStr ? 16 : 0, headerH + padTop + contentH + padBot);

  let cardX = x;
  let cardW = w;
  
  if (dateStr) {
    const dateObj = new Date(dateStr);
    const days = ['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'];
    const months = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
    
    const dayName = days[dateObj.getDay()].replace('.', '').toUpperCase();
    const dayNum = dateObj.getDate().toString().padStart(2, '0');
    const monthName = months[dateObj.getMonth()];
    
    const pictoW = 16;
    const pictoH = 16;
    
    // Picto Background
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(220, 220, 225);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y + (cardH - pictoH)/2, pictoW, pictoH, 2.5, 2.5, 'FD');
    
    // Picto Text
    const py = y + (cardH - pictoH)/2;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5); doc.setTextColor(130, 140, 150);
    doc.text(dayName, x + pictoW/2, py + 4.5, {align: 'center'});
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20, 30, 40);
    doc.text(dayNum, x + pictoW/2, py + 10.5, {align: 'center'});
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(130, 140, 150);
    doc.text(monthName, x + pictoW/2, py + 14.5, {align: 'center'});
    
    cardX = x + pictoW + 4;
    cardW = w - pictoW - 4;
    headerText = `${rows.length} technicien${rows.length > 1 ? 's' : ''}`;
  }

  // Card background (White)
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(220, 220, 225); // Subtle border
  doc.setLineWidth(0.2);
  doc.roundedRect(cardX, y, cardW, cardH, 2.0, 2.0, 'FD');

  // Header band (Pastel subtle color)
  // Header band (Pastel subtle color)
  doc.setFillColor(sc.rgbBg[0], sc.rgbBg[1], sc.rgbBg[2]);
  doc.roundedRect(cardX, y, cardW, headerH, 2.0, 2.0, 'F');
  doc.rect(cardX, y+2.0, cardW, headerH-2.0, 'F');
  // Bottom line of header
  doc.setDrawColor(235, 235, 240);
  doc.setLineWidth(0.15);
  doc.line(cardX, y+headerH, cardX+cardW, y+headerH);

  // Left accent bar (thinner, more elegant)
  doc.setFillColor(sc.rgbAccent[0], sc.rgbAccent[1], sc.rgbAccent[2]);
  doc.roundedRect(cardX, y, 2.0, cardH, 0.8, 0.8, 'F');

  // Scene name (compact font)
  doc.setFont('helvetica','bold'); 
  doc.setTextColor(30, 20, 10); // Dark premium text
  let snSize = 7.5;
  doc.setFontSize(snSize);
  const maxWText = cardW - padX*2 - 10;
  let sn = cleanText(headerText);
  while(doc.getTextWidth(sn) > maxWText && snSize > 5.0) {
    snSize -= 0.5;
    doc.setFontSize(snSize);
  }
  if (doc.getTextWidth(sn) > maxWText) {
    sn = doc.splitTextToSize(sn, maxWText)[0] as string;
  }
  doc.text(sn, cardX+padX+1.5, y+headerH*0.66);

  // Count badge removed per user request

  // Rows
  let ry = y + headerH + padTop + 0.5;
  if (rows.length === 0) {
    doc.setFont('helvetica','italic'); doc.setFontSize(7); doc.setTextColor(...MUTED);
    doc.text('Aucun technicien', cardX+padX+3, ry+rowH*0.55);
  } else {
    for (const row of rows) {
      let subLines: string[] = [];
      let currentH = rowH;
      const avSize = Math.min(rowH * 0.72, 3.5);
      
      doc.setFont('helvetica','bold'); doc.setFontSize(7);
      const timeStr = row.time||'';
      const tw = doc.getTextWidth(timeStr)+4;
      const maxW = w - padX*2 - 1.5 - avSize - 1.5 - tw - 1.5;

      if (row.subtext) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5);
        subLines = doc.splitTextToSize(row.subtext, maxW);
        currentH = rowH + (subLines.length * rowH * 0.50);
      }
      
      const avColor: [number,number,number] = row.isFO ? VIOLET : accentRgb;
      drawAvatar(doc, cardX+padX+1, ry+(currentH-avSize)/2, row.name, avColor, avSize);
      
      const nameX = cardX+padX+1+avSize+1.5;
      const th = rowH*0.68;
      const px = cardX+cardW-padX-tw; const py = ry+(currentH-th)/2;
      
      const isOff = /^off$/i.test(timeStr);
      const pillColor: [number,number,number] = isOff ? [240, 240, 243] : sc.rgbBg;
      const pillBorder: [number,number,number] = isOff ? [220, 220, 225] : sc.rgbAccent;
      const pillText: [number,number,number] = isOff ? MUTED : sc.rgbText;
      doc.setFillColor(...pillColor);
      doc.setDrawColor(...pillBorder);
      doc.setLineWidth(0.2);
      doc.roundedRect(px, py, tw, th, 1.2, 1.2, 'FD');
      doc.setFont('helvetica','bold'); doc.setFontSize(7);
      doc.setTextColor(...pillText); doc.text(timeStr, px+tw/2, py+th*0.72, {align:'center'});
      
      doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...INK);
      const nm = doc.splitTextToSize(row.name, maxW)[0] as string;
      doc.text(nm, nameX, ry + currentH * (row.subtext ? (0.45 - (subLines.length-1)*0.08) : 0.65));
      
      if (row.subtext) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(130, 140, 150);
        doc.text(subLines, nameX, ry + currentH * (0.85 - (subLines.length-1)*0.1));
      }
      
      ry += currentH;
    }
  }
  return cardH;
}

/* ─── Simulate layout to count pages (pure, no rendering) ─── */
function simulatePages(
  blocks: Array<{rows: Array<unknown>}>,
  cols: number, rowH: number,
  pageW: number, pageH: number, headerH: number
): number {
  const bottom = pageH - 13;
  const gutter = C_GUTTER;
  const _colW = (pageW - C_MARGIN*2 - gutter*(cols-1)) / cols; // computed but not needed
  void _colW;
  const colYs = new Array(cols).fill(headerH);
  let pages = 1;
  for (const block of blocks) {
    let contentH = 0;
    for (const r of block.rows as Array<{subtext?: string}>) {
      if (r.subtext) {
        const estLines = Math.ceil(r.subtext.length / 45);
        contentH += rowH + (estLines * rowH * 0.50);
      } else {
        contentH += rowH;
      }
    }
    if (block.rows.length === 0) contentH += rowH;
    const cardH = C_HEADER + C_PAD_T + contentH + C_PAD_B;
    let bestCol = 0; let minY = colYs[0];
    for (let i=1; i<cols; i++) if (colYs[i] < minY) { minY=colYs[i]; bestCol=i; }
    if (minY + cardH > bottom) {
      pages++; colYs.fill(headerH); bestCol=0;
    }
    colYs[bestCol] += cardH + C_CARD_GAP;
  }
  return pages;
}

/* ─── Find optimal column count to minimize pages ─── */
function findBestCols(
  blocks: Array<{rows: Array<unknown>}>,
  pageW: number, pageH: number, headerH: number,
  rowH: number, maxCols: number
): number {
  const possibleCols = [2,3,4,5,6].filter(c => c <= maxCols);
  for (const cols of possibleCols) {
    const pages = simulatePages(blocks, cols, rowH, pageW, pageH, headerH);
    if (pages <= 1) return cols;
  }
  return possibleCols[possibleCols.length - 1]; // fallback to max allowed
}

/* ─── Multi-column card layout engine ─── */
function layoutCards(doc: jsPDF, blocks: Array<{header:string;themeColorName:string;rows:Array<{name:string;time:string;isFO?:boolean}>, dateStr?: string}>,
  startY: number, marginX: number, pageW: number, pageH: number, cols: number, rowH: number, _gap: number, logo: string|null,
  headerTitle: string, headerSub: string): void {
  const bottom = pageH - 13;
  const gutter = C_GUTTER;
  const colW = (pageW - marginX*2 - gutter*(cols-1)) / cols;
  const colYs: number[] = new Array(cols).fill(startY);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const nRows = Math.max(1, block.rows.length);
    const cardH = Math.max(block.dateStr ? 16 : 0, C_HEADER + C_PAD_T + nRows * rowH + C_PAD_B);
    
    // Find shortest column
    let bestCol = 0; let minY = colYs[0];
    for (let c=1; c<cols; c++) if (colYs[c] < minY) { minY=colYs[c]; bestCol=c; }

    // Page break
    if (minY + cardH > bottom) {
      drawPremiumFooter(doc, pageW, pageH, marginX);
      doc.addPage();
      const sy = drawPremiumHeader(doc, pageW, marginX, 10, headerTitle, headerSub + ' (suite)', logo) + 5;
      colYs.fill(sy);
      bestCol = 0;
    }

    const x = marginX + bestCol * (colW + gutter);
    const h = drawSceneCard(doc, x, colYs[bestCol], colW, block.header, block.rows, rowH, block.themeColorName, block.dateStr);
    colYs[bestCol] += h + C_CARD_GAP;
  }
}

/* ─── generateAndSave (employee + scene exports) ─── */
export async function generateAndSave(opts: {
  title: string; subtitle: string; filename: string;
  itemCount: number; totalRows: number;
  maxCols?: number;
  blocks: Array<{
    header: string;
    themeColorName: string;
    rows: Array<{name:string;time:string;isFO?:boolean;subtext?:string}>;
    dateStr?: string;
  }>;
}): Promise<void> {
  const logo = await getLogoDataUrl();
  // Always landscape — better for columns
  const doc = new jsPDF({orientation:'landscape', unit:'mm', format:'a4'});
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const APPROX_HEADER = 37; // header height + start margin
  const rowH = C_ROW_H;
  const cols = findBestCols(opts.blocks, pageW, pageH, APPROX_HEADER, rowH, opts.maxCols || 6);
  const startY = drawPremiumHeader(doc, pageW, C_MARGIN, 10, opts.title, opts.subtitle, logo);
  layoutCards(doc, opts.blocks, startY, C_MARGIN, pageW, pageH, cols, rowH, C_CARD_GAP, logo, opts.title, opts.subtitle);
  drawPremiumFooter(doc, pageW, pageH, C_MARGIN);
  await downloadOrSharePdf(doc, opts.filename);
}

/* ═══════════════════════════════════════════════
   EXPORT QUOTIDIEN — Vue globale du jour
═══════════════════════════════════════════════ */
export async function exportDayPdf(date: string, records: PlanningRecord[]): Promise<void> {
  const dayRecs = records.filter(r => r.date===date && r.time!=='OFF');
  const sceneMap   = new Map<string, Array<{name:string;time:string;isFO?:boolean}>>();

  for (const r of dayRecs) {
    let groupName = r.scene;
    let displayName = prettyName(r.employee);
    
    if (isTrainingScene(r.scene)) {
      groupName = 'Formations';
      if (r.scene.toLowerCase() !== 'formation' && r.scene.toLowerCase() !== 'fo') {
        const detail = r.scene.replace(/^(formation|fo)\s*(-\s*)?/i, '');
        if (detail) displayName = `${displayName} (${detail})`;
      }
    } else if (r.role) {
      displayName = `${displayName} (${r.role})`;
    }
    
    if (r.shiftTime && r.shiftTime !== r.time) {
      displayName = `${displayName} [Journée: ${r.shiftTime}]`;
    }
    
    if (!sceneMap.has(groupName)) sceneMap.set(groupName, []);
    sceneMap.get(groupName)!.push({name: displayName, time: r.time, isFO: isTrainingScene(r.scene)});
  }

  const blocks = Array.from(sceneMap.entries())
    .sort((a, b) => {
      const aFO = isTrainingScene(a[0]);
      const bFO = isTrainingScene(b[0]);
      if (aFO && !bFO) return 1;
      if (!aFO && bFO) return -1;
      return a[0].localeCompare(b[0], 'fr');
    })
    .map(([scene,rows]) => ({header:cleanText(cleanSceneName(scene)), themeColorName:scene, rows:rows.sort((a,b)=>a.name.localeCompare(b.name,'fr'))}));

  await generateAndSave({
    title: 'Vue globale du jour',
    subtitle: fmtDate(date),
    blocks,
    itemCount: blocks.length,
    totalRows: blocks.reduce((a,b)=>a+Math.max(1,b.rows.length),0),
    filename: `sfx-planning-${date}.pdf`,
    maxCols: 4
  });
}

/* ═══════════════════════════════════════════════
   EXPORT INDIVIDUEL — Planning d'un technicien
═══════════════════════════════════════════════ */
export async function exportEmployeePdf(employee: string, records: PlanningRecord[]): Promise<void> {
  const empRecs = records.filter(r => r.employee===employee);
  const dateMap = new Map<string, Array<{name:string;time:string;isFO?:boolean;subtext?:string}>>();

  for (const r of empRecs) {
    if (!dateMap.has(r.date)) dateMap.set(r.date, []);
    let clean = cleanSceneName(r.scene) || '-';
    let role = (r.role && !isTrainingScene(r.scene)) ? r.role : '';
    let name = clean;
    if (role) {
      name = `${name} (${role})`;
    }
    let isFO = false;
    let subtext: string | undefined;
    if (isTrainingScene(r.scene)) {
      isFO = true;
      const dayRecs = records.filter(dr => dr.date === r.date && dr.time !== 'OFF' && !isTrainingScene(dr.scene));
      const scenesOfDay = new Set<string>();
      for (const dr of dayRecs) {
        if (timesMatch(dr.time, r.time, 5)) {
          let cln = dr.scene.replace(/\bENT\b/gi, '').trim().replace(/^[-_]+|[-_]+$/g, '').trim();
          if (cln && cln.toLowerCase() !== 'fo' && cln.toLowerCase() !== 'formation') {
            scenesOfDay.add(cln);
          }
        }
      }
      scenesOfDay.add('Formation autre');
      if (scenesOfDay.size > 0) subtext = 'Possibilités : ' + Array.from(scenesOfDay).sort().join(', ');
    } else if (r.shiftTime && r.shiftTime !== r.time) {
      subtext = `Journée: ${r.shiftTime}`;
    }
    dateMap.get(r.date)!.push(r.time === 'OFF' ? { name: 'Repos / Congé', time: 'OFF' } : { name, time: r.time, isFO, subtext });
  }

  const allDates = Array.from(dateMap.keys()).filter(Boolean).sort();
  const workedDays = Array.from(dateMap.entries()).filter(([, rows]) => rows.some(r => !/^off$/i.test(r.time))).length;
  const numWeeks = Math.ceil(allDates.length / 7);

  const pStart   = allDates[0] ? fmtDate(allDates[0]) : '';
  const pEnd     = allDates[allDates.length-1] ? fmtDate(allDates[allDates.length-1]) : '';
  const period   = pStart&&pEnd&&pStart!==pEnd ? `${pStart} - ${pEnd}` : pStart;

  await generateIndivPdf({
    title: prettyName(employee),
    subtitle: period ? `Planning individuel · ${period}` : 'Planning individuel',
    statsBadge: `${workedDays}/${allDates.length} JOURS TRAVAILLÉS · ${numWeeks} SEM.`,
    dateMap,
    allDates,
    filename: `sfx-planning-indiv-${slug(prettyName(employee))}.pdf`,
  });
}

async function generateIndivPdf(opts: {
  title: string;
  subtitle: string;
  statsBadge?: string;
  dateMap: Map<string, Array<{name:string;time:string;isFO?:boolean;subtext?:string}>>;
  allDates: string[];
  filename: string;
  themeColorName?: string;
}): Promise<void> {
  const logo = await getLogoDataUrl();
  const doc = new jsPDF({orientation:'landscape', unit:'mm', format:'a4'});
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 8;
  
  const startY = drawPremiumHeader(doc, pageW, marginX, 8, opts.title, opts.subtitle, logo, 'SFX PLANNER', opts.statsBadge);
  
  const isIndiv = opts.filename.includes('indiv');
  const numWeeks = Math.ceil(opts.allDates.length / 7);
  
  if (isIndiv) {
    // 7 days per column, dynamic height to fill exactly 100% of vertical space without void!
    const bottomLimit = pageH - 14; // footer top
    const availableH = bottomLimit - startY; // approx 162mm
    const gapBlock = 2.2;
    const blockH = Math.min(23, (availableH - 6 * gapBlock) / 7);
    const cols = Math.min(4, Math.max(1, numWeeks));
    const gutter = 3.5;

    // Adaptive column width and centering based on number of weeks (1 to 4)
    let colW: number;
    if (cols === 1) {
      colW = 160;
    } else if (cols === 2) {
      colW = 130;
    } else if (cols === 3) {
      colW = (pageW - marginX * 2 - gutter * 2) / 3;
    } else {
      colW = (pageW - marginX * 2 - gutter * (cols - 1)) / cols;
    }

    const totalUsedWidth = cols * colW + (cols - 1) * gutter;
    const baseStartX = (pageW - totalUsedWidth) / 2;

    let currentCol = 0;
    let currentY = startY;

    for (let i = 0; i < opts.allDates.length; i++) {
      const d = opts.allDates[i];
      const rows = opts.dateMap.get(d) || [];

      if (i > 0 && i % 7 === 0) {
        currentCol++;
        currentY = startY;

        if (currentCol >= cols) {
          drawPremiumFooter(doc, pageW, pageH, marginX);
          doc.addPage();
          drawPremiumHeader(doc, pageW, marginX, 8, opts.title, opts.subtitle + ' (suite)', logo, 'SFX PLANNER', opts.statsBadge);
          currentCol = 0;
          currentY = startY;
        }
      }

      const x = baseStartX + currentCol * (colW + gutter);
      drawIndivDayBlock(doc, x, currentY, colW, blockH, d, rows, opts.themeColorName);
      currentY += blockH + gapBlock;
    }

    drawPremiumFooter(doc, pageW, pageH, marginX);
    await downloadOrSharePdf(doc, opts.filename);
    return;
  }

  // Scene export fallback
  const maxAvailableH = pageH - 13 - (startY + 5);
  let totalCols = 1;
  let simY = startY + 5;
  for (let i = 0; i < opts.allDates.length; i++) {
    const d = opts.allDates[i];
    const rows = opts.dateMap.get(d) || [];
    const pictoH = 11;
    let totalBubblesH = 0;
    for (let j = 0; j < rows.length; j++) {
      let bH = 5.5;
      if (rows[j].subtext) bH += Math.ceil(rows[j].subtext!.length / 45) * 2;
      totalBubblesH += bH + (j < rows.length - 1 ? 0.6 : 0);
    }
    const pad = 1;
    const blockH = Math.max(pictoH, totalBubblesH) + pad * 2;
    const gapBlock = 1.5;
    
    if (simY + blockH > startY + 5 + maxAvailableH) {
      totalCols++;
      simY = startY + 5;
    }
    simY += blockH + gapBlock;
  }

  const cols = 4;
  let colsPerPage: number[] = [];
  if (totalCols > 0) {
    const numPages = Math.ceil(totalCols / cols);
    colsPerPage = new Array(numPages).fill(Math.floor(totalCols / numPages));
    const remainder = totalCols % numPages;
    for (let i = 0; i < remainder; i++) {
      colsPerPage[i]++;
    }
  }

  const gutter = 2;
  const colW = (pageW - marginX*2 - gutter*(cols-1)) / cols;
  let currentY = startY + 5;
  let currentCol = 0;
  let currentPageIndex = 0;
  let activeColsLimit = colsPerPage[0] || cols;

  for (let i = 0; i < opts.allDates.length; i++) {
    const d = opts.allDates[i];
    const rows = opts.dateMap.get(d) || [];
    
    const pictoH = 11;
    let totalBubblesH = 0;
    for (let j = 0; j < rows.length; j++) {
      let bH = 5.5;
      if (rows[j].subtext) bH += Math.ceil(rows[j].subtext!.length / 45) * 2;
      totalBubblesH += bH + (j < rows.length - 1 ? 0.6 : 0);
    }
    const pad = 1;
    const blockH = Math.max(pictoH, totalBubblesH) + pad * 2;
    const gapBlock = 1.5;

    if (currentY + blockH > startY + 5 + maxAvailableH) {
      currentCol++;
      currentY = startY + 5;
      if (currentCol >= activeColsLimit) {
        drawPremiumFooter(doc, pageW, pageH, marginX);
        doc.addPage();
        currentPageIndex++;
        activeColsLimit = colsPerPage[currentPageIndex] || cols;
        currentY = drawPremiumHeader(doc, pageW, marginX, 8, opts.title, opts.subtitle + ' (suite)', logo) + 5;
        currentCol = 0;
      }
    }

    const usedWidth = activeColsLimit * colW + (activeColsLimit - 1) * gutter;
    const startX = (pageW - usedWidth) / 2;
    const x = startX + currentCol * (colW + gutter);
    drawIndivDayBlock(doc, x, currentY, colW, blockH, d, rows, opts.themeColorName);
    currentY += blockH + gapBlock;
  }

  drawPremiumFooter(doc, pageW, pageH, marginX);
  await downloadOrSharePdf(doc, opts.filename);
}

function drawIndivDayBlock(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  dateStr: string,
  rows: Array<{name:string;time:string;isFO?:boolean;subtext?:string}>,
  themeColorName?: string
) {
  let dayName = 'LUN.';
  let dayNum = '01';
  let monthName = 'SEPT.';

  if (dateStr) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const yr = parseInt(parts[0], 10);
      const mo = parseInt(parts[1], 10) - 1;
      const da = parseInt(parts[2], 10);
      const dateObj = new Date(yr, mo, da);
      const days = ['DIM.', 'LUN.', 'MAR.', 'MER.', 'JEU.', 'VEN.', 'SAM.'];
      const months = ['JANV.', 'FÉVR.', 'MARS', 'AVR.', 'MAI', 'JUIN', 'JUIL.', 'AOÛT', 'SEPT.', 'OCT.', 'NOV.', 'DÉC.'];
      dayName = days[dateObj.getDay()] || 'LUN.';
      dayNum = da.toString().padStart(2, '0');
      monthName = months[mo] || 'SEPT.';
    } else {
      const dateObj = new Date(dateStr);
      if (!isNaN(dateObj.getTime())) {
        const days = ['DIM.', 'LUN.', 'MAR.', 'MER.', 'JEU.', 'VEN.', 'SAM.'];
        const months = ['JANV.', 'FÉVR.', 'MARS', 'AVR.', 'MAI', 'JUIN', 'JUIL.', 'AOÛT', 'SEPT.', 'OCT.', 'NOV.', 'DÉC.'];
        dayName = days[dateObj.getDay()] || 'LUN.';
        dayNum = dateObj.getDate().toString().padStart(2, '0');
        monthName = months[dateObj.getMonth()] || '';
      }
    }
  }

  const isOff = rows.length === 0 || rows.every(r => /^off$/i.test(r.time));

  // Base card (soft slate-50 for OFF, pure white for working day)
  doc.setFillColor(isOff ? 248 : 255, isOff ? 250 : 255, isOff ? 252 : 255);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, w, h, 1.8, 1.8, 'FD');

  // Refined thin left accent stripe (1.4mm)
  if (!isOff) {
    const firstRow = rows[0];
    const isFOFirst = firstRow.isFO || isTrainingScene(firstRow.name);
    const scFirst = getSceneColor(themeColorName || firstRow.name);
    const firstColor: [number, number, number] = isFOFirst ? VIOLET : scFirst.rgbAccent;

    if (rows.length > 1) {
      const hPart = h / rows.length;
      for (let idx = 0; idx < rows.length; idx++) {
        const r = rows[idx];
        const isFO = r.isFO || isTrainingScene(r.name);
        const sc = getSceneColor(themeColorName || r.name);
        const col: [number, number, number] = isFO ? VIOLET : sc.rgbAccent;
        doc.setFillColor(...col);
        doc.rect(x, y + idx * hPart, 1.4, hPart, 'F');
      }
    } else {
      doc.setFillColor(...firstColor);
      doc.rect(x, y, 1.4, h, 'F');
    }
  }

  // Date Picto on left
  const pictoW = 12.8;
  const pictoH = Math.min(h - 2.8, 17.5);
  const py = y + (h - pictoH) / 2;
  const px = x + (isOff ? 1.8 : 2.5);

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.2);
  doc.roundedRect(px, py, pictoW, pictoH, 1.4, 1.4, 'FD');

  const cx = px + pictoW / 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.8);
  doc.setTextColor(71, 85, 105);
  doc.text(dayName, cx, py + 4.2, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  doc.text(dayNum, cx, py + 10.5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.0);
  doc.setTextColor(100, 116, 139);
  doc.text(monthName, cx, py + 14.5, { align: 'center' });

  // Content area on right
  const rx = px + pictoW + 2.4;

  if (isOff) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text('Repos / Congé', rx, y + h / 2 + 1.2);

    const pillW = 12;
    const pillH = 5.2;
    const pillX = x + w - pillW - 2.5;
    const pillY = y + (h - pillH) / 2;
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.roundedRect(pillX, pillY, pillW, pillH, 1.0, 1.0, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(148, 163, 184);
    doc.text('OFF', pillX + pillW / 2, pillY + 3.6, { align: 'center' });
    return;
  }

  // Working day
  const rowCount = rows.length;

  if (rowCount === 1) {
    const row = rows[0];
    const isFO = row.isFO || isTrainingScene(row.name);
    const sc = getSceneColor(themeColorName || row.name);
    const scBg: [number, number, number] = isFO ? [245, 243, 255] : sc.rgbBg;
    const scAccent: [number, number, number] = isFO ? VIOLET : sc.rgbAccent;
    const cleanTime = (row.time || '').replace(/\s*-\s*/, ' - ');

    // Time pill top right
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.6);
    const tw = doc.getTextWidth(cleanTime);
    const pillW = tw + 4.2;
    const pillH = 5.2;
    const pillX = x + w - pillW - 2.2;
    const pillY = y + 2.5;

    doc.setFillColor(...scBg);
    doc.setDrawColor(...scAccent);
    doc.setLineWidth(0.25);
    doc.roundedRect(pillX, pillY, pillW, pillH, 1.0, 1.0, 'FD');
    doc.setTextColor(...scAccent);
    doc.text(cleanTime, pillX + pillW / 2, pillY + 3.7, { align: 'center' });

    // Scene name
    let rawNm = cleanText(cleanSceneName(row.name));
    let mainName = rawNm;
    let role = row.subtext || '';
    const matchRole = rawNm.match(/^(.*?)\s*\((.*?)\)$/);
    if (matchRole) {
      mainName = matchRole[1].trim();
      role = matchRole[2].trim();
    }

    const maxSceneW = pillX - rx - 1.2;
    let fontSize = 8.0;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize);
    doc.setTextColor(15, 23, 42);

    while (fontSize > 6.4 && doc.getTextWidth(mainName) > maxSceneW) {
      fontSize -= 0.3;
      doc.setFontSize(fontSize);
    }
    let dispScene = mainName;
    if (doc.getTextWidth(dispScene) > maxSceneW) {
      while (dispScene.length > 0 && doc.getTextWidth(dispScene + '...') > maxSceneW) {
        dispScene = dispScene.slice(0, -1);
      }
      dispScene = dispScene.trim() + '...';
    }
    doc.text(dispScene, rx, y + 6.8);

    // Role
    if (role) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.setTextColor(100, 116, 139);
      let dispRole = role;
      if (doc.getTextWidth(dispRole) > maxSceneW) {
        while (dispRole.length > 0 && doc.getTextWidth(dispRole + '...') > maxSceneW) {
          dispRole = dispRole.slice(0, -1);
        }
        dispRole = dispRole.trim() + '...';
      }
      doc.text(dispRole, rx, y + 12.0);
    }
  } else if (rowCount === 2) {
    const rH = (h - 2.4) / 2;
    for (let idx = 0; idx < 2; idx++) {
      const row = rows[idx];
      const isFO = row.isFO || isTrainingScene(row.name);
      const sc = getSceneColor(themeColorName || row.name);
      const scBg: [number, number, number] = isFO ? [245, 243, 255] : sc.rgbBg;
      const scAccent: [number, number, number] = isFO ? VIOLET : sc.rgbAccent;

      const rowY = y + 1.2 + idx * rH;
      const cleanTime = (row.time || '').replace(/\s*-\s*/, ' - ');

      // Time pill
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.8);
      const tw = doc.getTextWidth(cleanTime);
      const pillW = tw + 3.8;
      const pillH = 4.6;
      const pillX = x + w - pillW - 2.0;
      const pillY = rowY + (rH - pillH) / 2;

      doc.setFillColor(...scBg);
      doc.setDrawColor(...scAccent);
      doc.setLineWidth(0.25);
      doc.roundedRect(pillX, pillY, pillW, pillH, 0.8, 0.8, 'FD');
      doc.setTextColor(...scAccent);
      doc.text(cleanTime, pillX + pillW / 2, pillY + 3.3, { align: 'center' });

      // Scene
      let rawNm = cleanText(cleanSceneName(row.name));
      let mainName = rawNm.replace(/\s*\([^)]*\).*$/, '').replace(/\s*\[[^\]]*\].*$/, '').trim();
      let role = '';
      const matchRole = rawNm.match(/\((.*?)\)/);
      if (matchRole) role = matchRole[1];

      const maxSceneW = pillX - rx - 1.2;
      let fontSize = 6.8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(fontSize);
      doc.setTextColor(15, 23, 42);

      while (fontSize > 5.8 && doc.getTextWidth(mainName) > maxSceneW) {
        fontSize -= 0.3;
        doc.setFontSize(fontSize);
      }
      let dispScene = mainName;
      if (doc.getTextWidth(dispScene) > maxSceneW) {
        while (dispScene.length > 0 && doc.getTextWidth(dispScene + '...') > maxSceneW) {
          dispScene = dispScene.slice(0, -1);
        }
        dispScene = dispScene.trim() + '...';
      }
      doc.text(dispScene, rx, rowY + rH * 0.45);

      if (role) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5.0);
        doc.setTextColor(100, 116, 139);
        let dispRole = role;
        if (doc.getTextWidth(dispRole) > maxSceneW) {
          while (dispRole.length > 0 && doc.getTextWidth(dispRole + '...') > maxSceneW) {
            dispRole = dispRole.slice(0, -1);
          }
          dispRole = dispRole.trim() + '...';
        }
        doc.text(dispRole, rx, rowY + rH * 0.82);
      }

      if (idx === 0) {
        doc.setDrawColor(241, 245, 249);
        doc.setLineWidth(0.2);
        doc.line(rx, rowY + rH, x + w - 2, rowY + rH);
      }
    }
  } else {
    // 3 or more rows - DYNAMIC FIT inside card!
    const rH = (h - 2.0) / rowCount;
    for (let idx = 0; idx < rowCount; idx++) {
      const row = rows[idx];
      const isFO = row.isFO || isTrainingScene(row.name);
      const sc = getSceneColor(themeColorName || row.name);
      const scBg: [number, number, number] = isFO ? [245, 243, 255] : sc.rgbBg;
      const scAccent: [number, number, number] = isFO ? VIOLET : sc.rgbAccent;

      const rowY = y + 1.0 + idx * rH;
      const cleanTime = (row.time || '').replace(/\s*-\s*/, ' - ');

      // Time pill
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.2);
      const tw = doc.getTextWidth(cleanTime);
      const pillW = tw + 3.4;
      const pillH = 4.2;
      const pillX = x + w - pillW - 1.8;
      const pillY = rowY + (rH - pillH) / 2;

      doc.setFillColor(...scBg);
      doc.setDrawColor(...scAccent);
      doc.setLineWidth(0.25);
      doc.roundedRect(pillX, pillY, pillW, pillH, 0.8, 0.8, 'FD');
      doc.setTextColor(...scAccent);
      doc.text(cleanTime, pillX + pillW / 2, pillY + 3.0, { align: 'center' });

      // Scene
      let rawNm = cleanText(cleanSceneName(row.name));
      let mainName = rawNm.replace(/\s*\([^)]*\).*$/, '').replace(/\s*\[[^\]]*\].*$/, '').trim();
      let role = '';
      const matchRole = rawNm.match(/\((.*?)\)/);
      if (matchRole) role = matchRole[1];

      let fullLabel = mainName;
      if (role && !mainName.toLowerCase().includes('formation')) {
        fullLabel = `${mainName} (${role})`;
      }

      const maxSceneW = pillX - rx - 1.2;
      let fontSize = 5.8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(fontSize);
      doc.setTextColor(15, 23, 42);

      let dispScene = fullLabel;
      if (doc.getTextWidth(dispScene) > maxSceneW) {
        dispScene = mainName;
        while (fontSize > 5.0 && doc.getTextWidth(dispScene) > maxSceneW) {
          fontSize -= 0.3;
          doc.setFontSize(fontSize);
        }
        if (doc.getTextWidth(dispScene) > maxSceneW) {
          while (dispScene.length > 0 && doc.getTextWidth(dispScene + '...') > maxSceneW) {
            dispScene = dispScene.slice(0, -1);
          }
          dispScene = dispScene.trim() + '...';
        }
      }
      doc.text(dispScene, rx, rowY + rH / 2 + 1.6);

      if (idx < rowCount - 1) {
        doc.setDrawColor(241, 245, 249);
        doc.setLineWidth(0.2);
        doc.line(rx, rowY + rH, x + w - 2, rowY + rH);
      }
    }
  }
}


/* ═══════════════════════════════════════════════
   EXPORT PAR SCÈNE — Planning d'une scène
═══════════════════════════════════════════════ */
export async function exportScenePdf(scene: string, records: PlanningRecord[]): Promise<void> {
  const isFOExport = scene === 'Formations';
  const sceneRecs = records.filter(r => {
    if (r.time === 'OFF') return false;
    if (isFOExport) return isTrainingScene(r.scene);
    return r.scene === scene;
  });

  const dateToScenes = new Map<string, Array<{time: string, clean: string}>>();
  for (const r of records) {
    if (r.time !== 'OFF' && !isTrainingScene(r.scene)) {
      let clean = r.scene.replace(/\bENT\b/gi, '').trim();
      clean = clean.replace(/^[-_]+|[-_]+$/g, '').trim();
      if (clean && clean.toLowerCase() !== 'fo' && clean.toLowerCase() !== 'formation') {
        if (!dateToScenes.has(r.date)) dateToScenes.set(r.date, []);
        dateToScenes.get(r.date)!.push({time: r.time, clean});
      }
    }
  }

  const dateMap = new Map<string, Array<{name:string;time:string;isFO?:boolean;subtext?:string}>>();
  for (const r of sceneRecs) {
    if (!dateMap.has(r.date)) dateMap.set(r.date, []);
    let displayName = prettyName(r.employee);
    let subtext = '';
    
    if (isFOExport) {
      const scenesOfDate = dateToScenes.get(r.date) || [];
      const matched = new Set<string>();
      for (const sc of scenesOfDate) {
        if (timesMatch(sc.time, r.time, 5)) matched.add(sc.clean);
      }
      matched.add('Formation autre');
      if (matched.size > 0) {
        subtext = 'Possibilités : ' + Array.from(matched).sort().join(', ');
      }
    }
    dateMap.get(r.date)!.push({name: displayName, time: r.time, isFO: isTrainingScene(r.scene), subtext});
  }

  const dateMapKeys = Array.from(dateMap.keys()).filter(Boolean).sort();
  const allDatesTotal = Array.from(new Set(records.map(r=>r.date).filter(Boolean))).sort();
  const pStart = allDatesTotal[0] ? fmtDate(allDatesTotal[0]) : '';
  const pEnd   = allDatesTotal[allDatesTotal.length-1] ? fmtDate(allDatesTotal[allDatesTotal.length-1]) : '';
  const period = pStart && pEnd && pStart !== pEnd ? `${pStart} - ${pEnd}` : pStart;

  for (const d of dateMapKeys) {
    dateMap.get(d)!.sort((a,b)=>a.name.localeCompare(b.name,'fr'));
  }

  await generateIndivPdf({
    title: cleanText(scene),
    subtitle: period ? `Période : ${period}` : 'Période',
    dateMap,
    allDates: dateMapKeys,
    filename: `sfx-planning-${slug(scene)}.pdf`,
    themeColorName: scene, // Force scene color for all bubbles
  });
}

export function listScenes(records: PlanningRecord[]): string[] {
  const set = new Set<string>();
  for (const r of records) {
    if (r.scene) {
      set.add(isTrainingScene(r.scene) ? 'Formations' : r.scene);
    }
  }
  return Array.from(set).sort((a,b)=>a.localeCompare(b,'fr'));
}

function shortenSceneName(scene: string): string {
  if (isTrainingScene(scene)) return 'FO';
  let s = cleanText(cleanSceneName(scene)).toUpperCase();
  s = s.replace(/^ENT\s+/, '').replace(/^EMT\s+/, '').replace(/^DLP\s+/, '');
  s = s.split(/\s+/)[0];
  if (s.length > 9) s = s.substring(0, 9);
  return s;
}

function getDailyAmplitude(recs: PlanningRecord[]): string {
  // 1. If any record has shiftTime, use it
  const withShift = recs.find(r => r.shiftTime && r.shiftTime !== 'OFF');
  if (withShift?.shiftTime) return withShift.shiftTime;

  // 2. Parse working records to find min start and max end
  let minStart = Infinity;
  let maxEnd = -Infinity;

  for (const r of recs) {
    if (!r.time || r.time === 'OFF' || /^off$/i.test(r.time)) continue;
    const rng = parseRange(r.time);
    if (rng) {
      if (rng.start < minStart) minStart = rng.start;
      if (rng.end > maxEnd) maxEnd = rng.end;
    }
  }

  if (minStart !== Infinity && maxEnd !== -Infinity && minStart < maxEnd) {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const sH = Math.floor(minStart / 60);
    const sM = minStart % 60;
    const eH = Math.floor(maxEnd / 60);
    const eM = maxEnd % 60;
    return `${pad(sH)}:${pad(sM)}-${pad(eH)}:${pad(eM)}`;
  }

  // 3. Fallback to first non-off time
  const firstWork = recs.find(r => r.time && r.time !== 'OFF' && !/^off$/i.test(r.time));
  return firstWork?.time || recs[0]?.time || '';
}

async function generateGridGlobalPdf(opts: {
  title: string; subtitle: string; filename: string;
  records: PlanningRecord[];
}) {
  const { records } = opts;
  const allDates = Array.from(new Set(records.map(r=>r.date).filter(Boolean))).sort();
  if (allDates.length === 0) return;
  
  const allEmps = Array.from(new Set(records.map(r=>r.employee).filter(Boolean))).sort((a,b)=>prettyName(a).localeCompare(prettyName(b),'fr'));
  
  // Use A4 landscape for better readability (more pages, less cramped)
  const doc = new jsPDF({orientation:'landscape', unit:'mm', format:'a4'});
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const C_MARGIN = 15;
  const bottom = pageH - 12;
  
  const weeks: string[][] = [];
  for (let i = 0; i < allDates.length; i += 7) {
    weeks.push(allDates.slice(i, i + 7));
  }

  let pageCount = 0;
  let y = bottom + 1; // force page break immediately

  const drawPageHeader = () => {
    if (pageCount > 0) doc.addPage();
    pageCount++;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20, 30, 50);
    doc.text(`${opts.title} - ${opts.subtitle}`, C_MARGIN, 15);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100, 110, 130);
    doc.text('SFX Planner', pageW - C_MARGIN, 15, {align: 'right'});
    y = 22;
  };

  const headerH = 7.5;
  const colNameW = 55;
  const colDayW = (pageW - C_MARGIN*2 - colNameW) / 7;

  for (const weekDates of weeks) {
    const weekRecs = records.filter(r => weekDates.includes(r.date));
    const activeEmps = allEmps.filter(emp => weekRecs.some(r => r.employee === emp));
    if (activeEmps.length === 0) continue;

    const halfLen = Math.ceil(activeEmps.length / 2);
    const halves = [activeEmps.slice(0, halfLen), activeEmps.slice(halfLen)];

    for (let part = 0; part < halves.length; part++) {
      const emps = halves[part];
      if (emps.length === 0) continue;

      drawPageHeader();

      // Draw Week Header
      doc.setFillColor(30, 40, 60);
      doc.rect(C_MARGIN, y, pageW - C_MARGIN*2, headerH, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
      doc.text(part === 0 ? "TECHNICIEN" : "TECHNICIEN (suite)", C_MARGIN + 2, y + 5);
      
      for (let d = 0; d < 7; d++) {
        const dx = C_MARGIN + colNameW + d * colDayW;
        if (d < weekDates.length) {
          doc.text(fmtDateShort(weekDates[d]), dx + colDayW/2, y + 5, {align: 'center'});
        }
      }
      y += headerH;

      const availableH = bottom - y;
      let rowH = availableH / emps.length;
      if (rowH > 14) rowH = 14; // Cap max height so it doesn't stretch to infinity if only 2 people
      
      const fName = Math.max(5, Math.min(8.5, rowH * 0.9));
      const fTime = Math.max(5, Math.min(7.5, rowH * 0.8));
      const fScene = Math.max(4, Math.min(6.2, rowH * 0.7));
      const fOff = Math.max(5, Math.min(7.5, rowH * 0.8));
      const badgeW = 16.5;

      for (let i = 0; i < emps.length; i++) {
        const emp = emps[i];
        const isEven = i % 2 === 0;
        doc.setFillColor(isEven ? 255 : 248, isEven ? 255 : 250, isEven ? 255 : 252);
        doc.rect(C_MARGIN, y, pageW - C_MARGIN*2, rowH, 'F');
        
        doc.setDrawColor(220, 225, 230); doc.setLineWidth(0.1);
        doc.line(C_MARGIN, y+rowH, pageW-C_MARGIN, y+rowH); // bottom
        
        doc.setTextColor(20, 30, 40); doc.setFont('helvetica', 'bold'); doc.setFontSize(fName);
        let nm = prettyName(emp);
        if (doc.getTextWidth(nm) > colNameW - 2) nm = doc.splitTextToSize(nm, colNameW - 2)[0] as string;
        doc.text(nm, C_MARGIN + 2, y + rowH/2 + 1.2);
        
        doc.line(C_MARGIN, y, C_MARGIN, y + rowH); // left edge
        doc.line(C_MARGIN + colNameW, y, C_MARGIN + colNameW, y + rowH); // col edge
        doc.line(pageW - C_MARGIN, y, pageW - C_MARGIN, y + rowH); // right edge
        
        for (let d = 0; d < 7; d++) {
          const dx = C_MARGIN + colNameW + d * colDayW;
          if (d > 0) doc.line(dx, y, dx, y + rowH);
          
          if (d >= weekDates.length) continue;
          const date = weekDates[d];
          const recs = weekRecs.filter(r => r.date === date && r.employee === emp);
          if (recs.length === 0) continue;
          
          const mainRec = recs.find(r => r.time !== 'OFF') || recs[0];
          
          if (mainRec.time === 'OFF' || /^off$/i.test(mainRec.time)) {
            doc.setFillColor(245, 247, 250);
            doc.rect(dx+0.4, y+0.4, colDayW-0.8, rowH-0.8, 'F');
            doc.setTextColor(148, 163, 184);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(fOff);
            doc.text('OFF', dx + colDayW/2, y + rowH/2 + 1.2, {align: 'center'});
          } else {
            const hasFormation = recs.some(r => isTrainingScene(r.scene));
            const nonFoRecs = recs.filter(r => !isTrainingScene(r.scene) && r.time !== 'OFF' && !/^off$/i.test(r.time));
            const isMixedFo = hasFormation && nonFoRecs.length > 0;
            const amplitudeStr = getDailyAmplitude(recs);

            const primaryRec = nonFoRecs[0] || recs[0];
            const cleanScene = cleanSceneName(primaryRec.scene);
            const sc = getSceneColor(cleanScene);
            const foSc = getSceneColor('Formation');

            if (isMixedFo) {
              // --- MULTICOLORE CELL (FORMATION + SCENE) ---
              // 1. Two-tone background: Scene tint on left, Formation violet tint on right
              const cellW = colDayW - 0.8;
              const cellH = rowH - 0.8;
              const splitW = Math.round(cellW * 0.52 * 10) / 10;

              // Left portion (Scene background tint)
              doc.setFillColor(sc.rgbBg[0], sc.rgbBg[1], sc.rgbBg[2]);
              doc.rect(dx+0.4, y+0.4, splitW, cellH, 'F');

              // Right portion (Formation violet background tint)
              doc.setFillColor(243, 232, 255);
              doc.rect(dx+0.4 + splitW, y+0.4, cellW - splitW, cellH, 'F');

              // 3. Two-tone Multi-color Badge: [ SCENE | FO ]
              const leftBadgeW = 10.5;
              const rightBadgeW = 6.0;
              const totalBadgeW = leftBadgeW + rightBadgeW; // 16.5mm
              const badgeH = rowH - 1.2;

              // Left part (Scene color)
              doc.setFillColor(sc.rgbAccent[0], sc.rgbAccent[1], sc.rgbAccent[2]);
              doc.roundedRect(dx+0.6, y+0.6, leftBadgeW, badgeH, 0.8, 0.8, 'F');
              doc.rect(dx+0.6 + leftBadgeW - 1.5, y+0.6, 1.5, badgeH, 'F');

              doc.setTextColor(255, 255, 255);
              doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.min(fScene, 5.5));
              let sAbbr = shortenSceneName(cleanScene);
              if (sAbbr.length > 5) sAbbr = sAbbr.substring(0, 5);
              doc.text(sAbbr, dx + 0.6 + leftBadgeW/2, y + rowH/2 + 1, {align: 'center'});

              // Right part (Formation Purple)
              doc.setFillColor(foSc.rgbAccent[0], foSc.rgbAccent[1], foSc.rgbAccent[2]);
              doc.roundedRect(dx+0.6 + leftBadgeW, y+0.6, rightBadgeW, badgeH, 0.8, 0.8, 'F');
              doc.rect(dx+0.6 + leftBadgeW, y+0.6, 1.5, badgeH, 'F');

              doc.setTextColor(255, 255, 255);
              doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.min(fScene, 5.5));
              doc.text('FO', dx + 0.6 + leftBadgeW + rightBadgeW/2, y + rowH/2 + 1, {align: 'center'});

              // 4. White pill with daily amplitude (just amplitude, no +FO)
              const timeX = dx + 0.6 + totalBadgeW + 0.8;
              const timeW = colDayW - 0.8 - (totalBadgeW + 1.4);
              const timeH = Math.min(rowH - 1.4, 5.6);
              const timeY = y + (rowH - timeH) / 2;

              doc.setFillColor(255, 255, 255);
              doc.setDrawColor(196, 181, 253);
              doc.setLineWidth(0.2);
              doc.roundedRect(timeX, timeY, timeW, timeH, 0.6, 0.6, 'FD');

              doc.setTextColor(15, 23, 42);
              doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.min(fTime, 6.2));
              doc.text(amplitudeStr, timeX + timeW/2, timeY + timeH/2 + 1.1, {align: 'center'});

            } else {
              // --- STANDARD CELL (SINGLE SCENE OR PURE FORMATION) ---
              const sceneAbbr = shortenSceneName(cleanScene);
              
              // Soft scene background tint across the cell
              doc.setFillColor(sc.rgbBg[0], sc.rgbBg[1], sc.rgbBg[2]);
              doc.rect(dx+0.4, y+0.4, colDayW-0.8, rowH-0.8, 'F');
              
              // Solid scene color badge
              doc.setFillColor(sc.rgbAccent[0], sc.rgbAccent[1], sc.rgbAccent[2]);
              doc.roundedRect(dx+0.6, y+0.6, badgeW, rowH-1.2, 0.8, 0.8, 'F');
              
              doc.setTextColor(255, 255, 255);
              doc.setFont('helvetica', 'bold'); doc.setFontSize(fScene);
              doc.text(sceneAbbr, dx + 0.6 + badgeW/2, y + rowH/2 + 1, {align: 'center'});
              
              // Just the daily amplitude (clean, no +FO)
              doc.setTextColor(sc.rgbText[0], sc.rgbText[1], sc.rgbText[2]);
              doc.setFont('helvetica', 'bold'); doc.setFontSize(fTime);
              doc.text(amplitudeStr, dx + 0.6 + badgeW + (colDayW - badgeW - 1.2)/2, y + rowH/2 + 1.2, {align: 'center'});
            }
          }
        }
        y += rowH;
      }
    }
    
    // Top border of the table is drawn by header.
  }

  if (pageCount > 0) await downloadOrSharePdf(doc, opts.filename);
}

export async function exportGlobalRecapPdf(records: PlanningRecord[]): Promise<void> {
  const allDates = Array.from(new Set(records.map(r=>r.date).filter(Boolean))).sort();
  if (allDates.length===0) return;

  const pStart = fmtDate(allDates[0]);
  const pEnd = fmtDate(allDates[allDates.length-1]);
  const period = pStart && pEnd && pStart !== pEnd ? `${pStart} - ${pEnd}` : pStart;

  await generateGridGlobalPdf({
    title: 'Planning Master',
    subtitle: period,
    filename: `sfx-master-roster.pdf`,
    records
  });
}
