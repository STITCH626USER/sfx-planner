import jsPDF from 'jspdf';
import type { PlanningRecord } from './parsePdf';
import { isTrainingScene, getSceneColor, timesMatch } from './utils';

/* ─── Design Tokens (matches app CSS) ─── */
const NAVY:    [number,number,number] = [13,  20,  35];
const AMBER:   [number,number,number] = [255, 176, 58];
const AMBER2:  [number,number,number] = [232, 130, 30];
const TEAL:    [number,number,number] = [0,   185, 158];
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
  return (t||'').replace(/[Ø<ß"«»®©]/g,'').replace(/ENT\s+/i, '').replace(/PoolTechnicienSfx/i, 'Pool SFX').replace(/\s+/g,' ').trim();
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
function prettyName(s: string): string {
  const tc = (w: string) => w.split(/([-'])/).map(p => /^[-']$/.test(p)?p:p.charAt(0).toUpperCase()+p.slice(1).toLowerCase()).join('');
  const tcp = (str: string) => str.trim().split(/\s+/).map(tc).join(' ');
  const idx = s.indexOf(',');
  if (idx === -1) return cleanText(s).toUpperCase();
  const last = s.slice(0,idx).trim().toUpperCase(); const first = tcp(s.slice(idx+1));
  if (!first) return cleanText(last); if (!last) return cleanText(first);
  return cleanText(`${last} ${first}`);
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0]+(parts[1][0]||'')).toUpperCase();
  return name.slice(0,2).toUpperCase();
}
function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'scene';
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

/* ─── Premium Header ─── */
function drawPremiumHeader(doc: jsPDF, pageW: number, marginX: number, y: number,
  title: string, subtitle: string, logo: string|null, rightLabel = 'SFX PLANNER'): number {
  const h = 20;
  // Navy background
  doc.setFillColor(...NAVY); doc.roundedRect(marginX, y, pageW-marginX*2, h, 2.5, 2.5, 'F');
  // Amber bottom line
  doc.setFillColor(...AMBER); doc.rect(marginX+3, y+h-0.7, pageW-marginX*2-6, 0.5, 'F');
  // Teal right accent
  doc.setFillColor(...TEAL); doc.rect(pageW-marginX-3, y+2, 0.5, h-4, 'F');
  // Logo
  let tx = marginX + 5;
  if (logo) { try { const lx=marginX+3; const ly=y+3; const ls=14; doc.addImage(logo,'PNG',lx,ly,ls,ls); tx=lx+ls+4; } catch { /* ignore */ } }
  // Title
  doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(...WHITE);
  doc.text(cleanText(title), tx, y+8.5);
  // Subtitle
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(165,195,220);
  doc.text(cleanText(subtitle), tx, y+14.2);
  // Right label
  doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(...AMBER);
  doc.text(rightLabel, pageW-marginX-5, y+11, {align:'right'});
  return y + h + 5;
}

/* ─── Premium Footer ─── */
function drawPremiumFooter(doc: jsPDF, pageW: number, pageH: number, marginX: number) {
  const fy = pageH - 10;
  // Amber line
  doc.setDrawColor(...AMBER); doc.setLineWidth(0.3); doc.line(marginX, fy-2, pageW-marginX, fy-2);
  // Warning text
  doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...AMBER2);
  doc.text("Contrôle obligatoire sur UKG personnel", pageW/2, fy+1.5, {align:'center'});
  // Version
  doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
  doc.text('SFX Planner v3.2.9', pageW-marginX, fy+1.5, {align:'right'});
}

/* ─── Avatar circle with initials ─── */
function drawAvatar(doc: jsPDF, x: number, y: number, name: string, color: [number,number,number], size = 4.5) {
  const cx = x + size/2; const cy = y + size/2;
  doc.setFillColor(...color); doc.circle(cx, cy, size/2, 'F');
  // Dark overlay for text contrast
  doc.setTextColor(...WHITE); doc.setFont('helvetica','bold'); doc.setFontSize(size*1.4);
  doc.text(initials(name), cx, cy+size*0.22, {align:'center'});
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
  doc.setFillColor(sc.rgbText[0], sc.rgbText[1], sc.rgbText[2]);
  doc.roundedRect(cardX, y, 1.8, cardH, 1.5, 1.5, 'F');
  doc.rect(cardX+0.9, y, 0.9, cardH, 'F');

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
      const pillColor: [number,number,number] = isOff ? [240, 240, 243] : [255, 240, 225];
      const pillText: [number,number,number] = isOff ? MUTED : AMBER;
      doc.setFillColor(...pillColor); doc.roundedRect(px, py, tw, th, th/2, th/2, 'F');
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
  doc.save(opts.filename);
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
    .map(([scene,rows]) => ({header:cleanText(scene), themeColorName:scene, rows:rows.sort((a,b)=>a.name.localeCompare(b.name,'fr'))}));

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
    if (!dateMap.has(r.date)) dateMap.set(r.date,[]);
    const name = r.scene||'-'; let isFO=false; let subtext: string | undefined;
    if (isTrainingScene(r.scene)) {
      isFO=true;
      const dayRecs = records.filter(dr => dr.date === r.date && dr.time !== 'OFF' && !isTrainingScene(dr.scene));
      const scenesOfDay = new Set<string>();
      for (const dr of dayRecs) {
        if (timesMatch(dr.time, r.time, 5)) {
          let clean = dr.scene.replace(/\bENT\b/gi, '').trim().replace(/^[-_]+|[-_]+$/g, '').trim();
          if (clean && clean.toLowerCase() !== 'fo' && clean.toLowerCase() !== 'formation') {
            scenesOfDay.add(clean);
          }
        }
      }
      if (scenesOfDay.size > 0) subtext = 'Possibilités : ' + Array.from(scenesOfDay).sort().join(', ');
    }
    dateMap.get(r.date)!.push(r.time==='OFF' ? {name:'Repos / Congé',time:'OFF'} : {name,time:r.time,isFO,subtext});
  }

  const allDates = Array.from(dateMap.keys()).filter(Boolean).sort();

  const pStart   = allDates[0] ? fmtDate(allDates[0]) : '';
  const pEnd     = allDates[allDates.length-1] ? fmtDate(allDates[allDates.length-1]) : '';
  const period   = pStart&&pEnd&&pStart!==pEnd ? `${pStart} - ${pEnd}` : pStart;

  await generateIndivPdf({
    title: prettyName(employee),
    subtitle: period ? `Planning individuel - ${period}` : 'Planning individuel',
    dateMap,
    allDates,
    filename: `sfx-planning-indiv-${slug(prettyName(employee))}.pdf`,
  });
}

async function generateIndivPdf(opts: {
  title: string;
  subtitle: string;
  dateMap: Map<string, Array<{name:string;time:string;isFO?:boolean;subtext?:string}>>;
  allDates: string[];
  filename: string;
}): Promise<void> {
  const logo = await getLogoDataUrl();
  const doc = new jsPDF({orientation:'landscape', unit:'mm', format:'a4'});
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 10;
  
  const startY = drawPremiumHeader(doc, pageW, marginX, 10, opts.title, opts.subtitle, logo);
  
  const cols = 4;
  const gutter = 4.5;
  const colW = (pageW - marginX*2 - gutter*(cols-1)) / cols;
  const maxAvailableH = pageH - 13 - (startY + 5);
  
  let currentY = startY + 5;
  let currentCol = 0;
  
  for (let i = 0; i < opts.allDates.length; i++) {
    const d = opts.allDates[i];
    const rows = opts.dateMap.get(d) || [];
    
    const pictoH = 16;
    let totalBubblesH = 0;
    for (let j = 0; j < rows.length; j++) {
      let bH = 7.5;
      if (rows[j].subtext) bH += Math.ceil(rows[j].subtext!.length / 45) * 2.5;
      totalBubblesH += bH + (j < rows.length - 1 ? 1.5 : 0);
    }
    const pad = 2;
    const blockH = Math.max(pictoH, totalBubblesH) + pad * 2;
    const gapBlock = 3;
    
    if (currentY + blockH > startY + 5 + maxAvailableH) {
      currentCol++;
      currentY = startY + 5;
      
      if (currentCol >= cols) {
        drawPremiumFooter(doc, pageW, pageH, marginX);
        doc.addPage();
        currentY = drawPremiumHeader(doc, pageW, marginX, 10, opts.title, opts.subtitle + ' (suite)', logo) + 5;
        currentCol = 0;
      }
    }
    
    const x = marginX + currentCol * (colW + gutter);
    drawIndivDayBlock(doc, x, currentY, colW, blockH, d, rows);
    
    currentY += blockH + gapBlock;
  }
  
  drawPremiumFooter(doc, pageW, pageH, marginX);
  doc.save(opts.filename);
}

function drawIndivDayBlock(doc: jsPDF, x: number, y: number, w: number, h: number, dateStr: string, rows: Array<{name:string;time:string;isFO?:boolean;subtext?:string}>) {
  const dateObj = new Date(dateStr);
  const days = ['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'];
  const months = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
  
  const dayName = days[dateObj.getDay()].replace('.', '').toUpperCase();
  const dayNum = dateObj.getDate().toString().padStart(2, '0');
  const monthName = months[dateObj.getMonth()];
  
  const pictoW = 16;
  const pictoH = 16;
  
  const pad = 2;
  
  // Entire Block Frame
  doc.setFillColor(252, 252, 254);
  doc.setDrawColor(228, 230, 235);
  doc.setLineWidth(0.2);
  doc.roundedRect(x, y, w, h, 2.5, 2.5, 'FD');

  // Picto Background
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(220, 220, 225);
  doc.setLineWidth(0.2);
  doc.roundedRect(x + pad, y + (h - pictoH)/2, pictoW, pictoH, 2.5, 2.5, 'FD');
  
  // Picto Text
  const py = y + (h - pictoH)/2;
  const px = x + pad + pictoW/2;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5); doc.setTextColor(130, 140, 150);
  doc.text(dayName, px, py + 4.5, {align: 'center'});
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20, 30, 40);
  doc.text(dayNum, px, py + 10.5, {align: 'center'});
  doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(130, 140, 150);
  doc.text(monthName, px, py + 14.5, {align: 'center'});
  
  const rx = x + pad + pictoW + 3;
  const bubbleW = w - pad * 2 - pictoW - 3;
  const gapBubble = 1.5;
  let totalBubblesH = 0;
  for (let j = 0; j < rows.length; j++) {
    let bH = 7.5;
    if (rows[j].subtext) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(4.5);
      const subLines = doc.splitTextToSize(rows[j].subtext!, bubbleW - 4);
      bH += subLines.length * 2.5;
    }
    totalBubblesH += bH + (j < rows.length - 1 ? 1.5 : 0);
  }
  let ry = y + (h - totalBubblesH) / 2;
  
  if (rows.length === 0) return;
  
  for (const row of rows) {
    const isOff = /^off$/i.test(row.time);
    const isFO = row.isFO;
    
    let subLines: string[] = [];
    let currentBubbleH = 7.5;
    if (row.subtext) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(4.5);
      subLines = doc.splitTextToSize(row.subtext, bubbleW - 4);
      currentBubbleH += subLines.length * 2.5;
    }
    
    let bgColor: [number,number,number];
    let textColor: [number,number,number];
    let accentColor: [number,number,number];
    
    if (isOff) {
      bgColor = [248, 249, 251];
      textColor = [130, 140, 150];
      accentColor = [210, 215, 220];
    } else {
      const sc = getSceneColor(row.name);
      bgColor = sc.rgbBg;
      textColor = sc.rgbText;
      accentColor = isFO ? VIOLET : [
        Math.max(0, Math.round(textColor[0]*0.8 - 20)),
        Math.max(0, Math.round(textColor[1]*0.8 - 20)),
        Math.max(0, Math.round(textColor[2]*0.8 - 20))
      ];
    }
    
    doc.setFillColor(...bgColor);
    doc.setDrawColor(...accentColor);
    doc.setLineWidth(0.15);
    doc.roundedRect(rx, ry, bubbleW, currentBubbleH, 1.5, 1.5, 'FD');
    
    doc.setFillColor(...accentColor);
    doc.roundedRect(rx, ry, 1.5, currentBubbleH, 1.2, 1.2, 'F');
    doc.rect(rx+0.8, ry, 0.7, currentBubbleH, 'F');
    
    let nmMaxW = bubbleW - 4;
    const timeStr = row.time || '';
    
    if (timeStr) {
      doc.setFont('helvetica','bold'); doc.setFontSize(6.5);
      const tw = doc.getTextWidth(timeStr) + 4;
      const th = 7.5 * 0.75;
      const tx = rx + bubbleW - 1.5 - tw;
      const ty = ry + (currentBubbleH - th)/2;
      
      const pillBg: [number,number,number] = isOff ? [235, 238, 242] : [255, 255, 255];
      const pillText: [number,number,number] = isOff ? [160, 170, 180] : AMBER;
      
      doc.setFillColor(...pillBg);
      doc.roundedRect(tx, ty, tw, th, th/2, th/2, 'F');
      doc.setTextColor(...pillText);
      doc.text(timeStr, tx + tw/2, ty + th*0.7, {align:'center'});
      nmMaxW = tx - rx - 3;
    }
    
    doc.setFont('helvetica', isOff ? 'normal' : 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...textColor);
    
    let nm = cleanText(row.name);
    if (doc.getTextWidth(nm) > nmMaxW) {
      nm = doc.splitTextToSize(nm, nmMaxW)[0] as string;
    }
    doc.text(nm, rx + 3.5, ry + (row.subtext ? 4.0 : 4.9));
    
    if (row.subtext) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(4.5); doc.setTextColor(130, 140, 150);
      doc.text(subLines, rx + 3.5, ry + 7.5);
    }
    
    ry += currentBubbleH + gapBubble;
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
      if (r.scene.toLowerCase() !== 'formation' && r.scene.toLowerCase() !== 'fo') {
        let detail = r.scene.replace(/^(formation|fo)\s*(-\s*)?/i, '');
        detail = detail.replace(/\bENT\b/gi, '').trim().replace(/^[-_]+|[-_]+$/g, '').trim();
        if (detail) displayName = `${displayName} (${detail})`;
      }
      const scenesOfDate = dateToScenes.get(r.date) || [];
      const matched = new Set<string>();
      for (const sc of scenesOfDate) {
        if (timesMatch(sc.time, r.time, 5)) matched.add(sc.clean);
      }
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
  let s = cleanText(scene).toUpperCase();
  s = s.replace(/^ENT\s+/, '').replace(/^EMT\s+/, '');
  s = s.split(/\s+/)[0];
  if (s.length > 9) s = s.substring(0, 9);
  return s;
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
      const badgeW = 17.5;

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
            doc.setFillColor(240, 242, 245);
            doc.rect(dx+0.4, y+0.4, colDayW-0.8, rowH-0.8, 'F');
            doc.setTextColor(148, 163, 184);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(fOff);
            doc.text('OFF', dx + colDayW/2, y + rowH/2 + 1.2, {align: 'center'});
          } else {
            const sc = getSceneColor(mainRec.scene);
            const sceneAbbr = shortenSceneName(mainRec.scene);
            
            doc.setFillColor(sc.rgbAccent[0], sc.rgbAccent[1], sc.rgbAccent[2]);
            doc.rect(dx+0.4, y+0.4, badgeW, rowH-0.8, 'F');
            
            doc.setTextColor(255, 255, 255);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(fScene);
            doc.text(sceneAbbr, dx + 0.4 + badgeW/2, y + rowH/2 + 1, {align: 'center'});
            
            let timeStr = mainRec.time;
            if (recs.length > 1) {
              const fO = recs.find(r => isTrainingScene(r.scene));
              if (fO) timeStr += ' +FO';
            }
            doc.setTextColor(20, 30, 40);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(fTime);
            doc.text(timeStr, dx + 0.4 + badgeW + (colDayW - badgeW - 0.8)/2, y + rowH/2 + 1.2, {align: 'center'});
          }
        }
        y += rowH;
      }
    }
    
    // Top border of the table is drawn by header.
  }

  if (pageCount > 0) doc.save(opts.filename);
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
