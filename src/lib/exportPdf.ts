import jsPDF from 'jspdf';
import type { PlanningRecord } from './parsePdf';
import { getFOAssociations, computeAllFOAssociations, getFOAssociationKey, isTrainingScene, getSceneColor } from './utils';

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
  return (t||'').replace(/[Ø<ß"«»®©]/g,'').replace(/\s+/g,' ').trim();
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
  if (idx === -1) return cleanText(tcp(s));
  const last = tcp(s.slice(0,idx)); const first = tcp(s.slice(idx+1));
  if (!first) return cleanText(last); if (!last) return cleanText(first);
  return cleanText(`${first} ${last}`);
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
      const base = (typeof window!=='undefined'&&(window as any).__BASE_URL__)||((import.meta as any).env?.BASE_URL??'/');
      const res = await fetch(`${base}sfx-dragon-logo.jpg`);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise<string>((resolve,reject) => {
        const r = new FileReader(); r.onload=()=>resolve(String(r.result)); r.onerror=reject; r.readAsDataURL(blob);
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
  if (logo) { try { const lx=marginX+3; const ly=y+3; const ls=14; doc.addImage(logo,'JPEG',lx,ly,ls,ls); tx=lx+ls+4; } catch {} }
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
  doc.text("ATTENTION: Controle obligatoire sur UKG personnel. Donnees indicatives - formations (FO) a titre informatif.", pageW/2, fy+1.5, {align:'center'});
  // Version
  doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
  doc.text('SFX Planner · v3.6', pageW-marginX, fy+1.5, {align:'right'});
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
  sceneName: string, rows: Array<{name:string;time:string;isFO?:boolean}>,
  rowH = C_ROW_H): number {
  const sc = getSceneColor(sceneName);
  const accentRgb: [number,number,number] = [
    Math.round(sc.rgbText[0]*0.7 + 30),
    Math.round(sc.rgbText[1]*0.7 + 30),
    Math.round(sc.rgbText[2]*0.7 + 30),
  ];
  const headerH = C_HEADER;
  const padX = 3.5; const padTop = C_PAD_T; const padBot = C_PAD_B;
  const totalRows = Math.max(1, rows.length);
  const cardH = headerH + padTop + totalRows * rowH + padBot;

  // Card background (White)
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(220, 220, 225); // Subtle border
  doc.setLineWidth(0.2);
  doc.roundedRect(x, y, w, cardH, 2.0, 2.0, 'FD');

  // Header band (Pastel subtle color)
  doc.setFillColor(sc.rgbBg[0], sc.rgbBg[1], sc.rgbBg[2]);
  doc.roundedRect(x, y, w, headerH, 2.0, 2.0, 'F');
  doc.rect(x, y+2.0, w, headerH-2.0, 'F');
  // Bottom line of header
  doc.setDrawColor(235, 235, 240);
  doc.setLineWidth(0.15);
  doc.line(x, y+headerH, x+w, y+headerH);

  // Left accent bar (thinner, more elegant)
  doc.setFillColor(sc.rgbText[0], sc.rgbText[1], sc.rgbText[2]);
  doc.roundedRect(x, y, 1.8, cardH, 1.5, 1.5, 'F');
  doc.rect(x+0.9, y, 0.9, cardH, 'F');

  // Scene name (compact font)
  doc.setFont('helvetica','bold'); 
  doc.setTextColor(30, 20, 10); // Dark premium text
  let snSize = 7.5;
  doc.setFontSize(snSize);
  const maxWText = w - padX*2 - 10;
  let sn = cleanText(sceneName);
  while(doc.getTextWidth(sn) > maxWText && snSize > 5.0) {
    snSize -= 0.5;
    doc.setFontSize(snSize);
  }
  if (doc.getTextWidth(sn) > maxWText) {
    sn = doc.splitTextToSize(sn, maxWText)[0] as string;
  }
  doc.text(sn, x+padX+1.5, y+headerH*0.66);

  // Count badge
  if (rows.length > 0) {
    const badge = String(rows.length);
    const bw = doc.getTextWidth(badge)+3.5; const bh = 3.8;
    const bx = x+w-padX-bw-0.5; const by = y+(headerH-bh)/2;
    doc.setFillColor(255, 255, 255); 
    doc.setDrawColor(220, 220, 225);
    doc.setLineWidth(0.1);
    doc.roundedRect(bx, by, bw, bh, bh/2, bh/2, 'FD');
    doc.setFont('helvetica','bold'); doc.setFontSize(6); doc.setTextColor(sc.rgbText[0],sc.rgbText[1],sc.rgbText[2]);
    doc.text(badge, bx+bw/2, by+bh*0.72, {align:'center'});
  }

  // Rows
  let ry = y + headerH + padTop + 0.5;
  if (rows.length === 0) {
    doc.setFont('helvetica','italic'); doc.setFontSize(7); doc.setTextColor(...MUTED);
    doc.text('Aucun technicien', x+padX+3, ry+rowH*0.55);
  } else {
    for (const row of rows) {
      const avSize = Math.min(rowH * 0.72, 3.5);
      const avColor: [number,number,number] = row.isFO ? VIOLET : accentRgb;
      drawAvatar(doc, x+padX+1, ry+(rowH-avSize)/2, row.name, avColor, avSize);
      let nameX = x+padX+1+avSize+1.5;
      if (row.isFO) {
        const fow=5.5; const foh=avSize*0.9; const fox=nameX; const foy=ry+(rowH-foh)/2;
        doc.setFillColor(...VIOLET); doc.roundedRect(fox, foy, fow, foh, 0.6, 0.6, 'F');
        doc.setTextColor(...WHITE); doc.setFont('helvetica','bold'); doc.setFontSize(5.5);
        doc.text('FO', fox+fow/2, foy+foh*0.72, {align:'center'});
        nameX += fow+1.2;
      }
      doc.setFont('helvetica','bold'); doc.setFontSize(7);
      const timeStr = row.time||'';
      const tw = doc.getTextWidth(timeStr)+4; const th = rowH*0.68;
      const px = x+w-padX-tw; const py = ry+(rowH-th)/2;
      const isOff = /^off$/i.test(timeStr);
      const pillColor: [number,number,number] = isOff ? [240, 240, 243] : [255, 240, 225];
      const pillText: [number,number,number] = isOff ? MUTED : AMBER;
      doc.setFillColor(...pillColor); doc.roundedRect(px, py, tw, th, th/2, th/2, 'F');
      doc.setFont('helvetica','bold');
      doc.setTextColor(...pillText); doc.text(timeStr, px+tw/2, py+th*0.72, {align:'center'});
      doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...INK);
      const maxW = px - nameX - 1.5;
      const nm = doc.splitTextToSize(row.name, maxW)[0] as string;
      doc.text(nm, nameX, ry+rowH*0.65);
      ry += rowH;
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
    const nRows = Math.max(1, block.rows.length);
    const cardH = C_HEADER + C_PAD_T + nRows * rowH + C_PAD_B;
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
  rowH: number
): number {
  for (const cols of [2,3,4,5,6]) {
    const pages = simulatePages(blocks, cols, rowH, pageW, pageH, headerH);
    if (pages <= 1) return cols;
  }
  return 6; // max cols as fallback
}

/* ─── Multi-column card layout engine ─── */
function layoutCards(doc: jsPDF, blocks: Array<{header:string;rows:Array<{name:string;time:string;isFO?:boolean}>}>,
  startY: number, marginX: number, pageW: number, pageH: number, cols: number, rowH: number, _gap: number, logo: string|null,
  headerTitle: string, headerSub: string): void {
  const bottom = pageH - 13;
  const gutter = C_GUTTER;
  const colW = (pageW - marginX*2 - gutter*(cols-1)) / cols;
  const colYs: number[] = new Array(cols).fill(startY);

  for (const block of blocks) {
    const nRows = Math.max(1, block.rows.length);
    const cardH = C_HEADER + C_PAD_T + nRows * rowH + C_PAD_B;

    let bestCol = 0; let minY = colYs[0];
    for (let i=1; i<cols; i++) if (colYs[i] < minY) { minY=colYs[i]; bestCol=i; }

    if (minY + cardH > bottom) {
      drawPremiumFooter(doc, pageW, pageH, marginX);
      doc.addPage();
      const ny = drawPremiumHeader(doc, pageW, marginX, 10, headerTitle, headerSub+' (suite)', logo);
      colYs.fill(ny); bestCol=0; minY=ny;
    }

    const x = marginX + bestCol*(colW+gutter);
    const h = drawSceneCard(doc, x, colYs[bestCol], colW, block.header, block.rows, rowH);
    colYs[bestCol] += h + C_CARD_GAP;
  }
}

/* ─── generateAndSave (employee + scene exports) ─── */
async function generateAndSave(opts:{
  title:string; subtitle:string;
  blocks:Array<{header:string;rows:Array<{name:string;time:string;isFO?:boolean}>}>;
  itemCount:number; totalRows:number; filename:string;
}): Promise<void> {
  const logo = await getLogoDataUrl();
  // Always landscape — better for columns
  const doc = new jsPDF({orientation:'landscape', unit:'mm', format:'a4'});
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const APPROX_HEADER = 37; // header height + start margin
  const rowH = C_ROW_H;
  const cols = findBestCols(opts.blocks, pageW, pageH, APPROX_HEADER, rowH);
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
  const activeRegs = dayRecs.filter(r => !isTrainingScene(r.scene));
  const activeFOs  = dayRecs.filter(r =>  isTrainingScene(r.scene));
  const dayAssoc   = getFOAssociations(dayRecs);
  const sceneMap   = new Map<string, Array<{name:string;time:string;isFO?:boolean}>>();

  for (const r of activeRegs) {
    if (!sceneMap.has(r.scene)) sceneMap.set(r.scene, []);
    sceneMap.get(r.scene)!.push({name:prettyName(r.employee), time:r.time});
  }
  for (const r of activeFOs) {
    const assoc = dayAssoc.get(r.employee)??[];
    const gk = r.scene;
    if (!sceneMap.has(gk)) sceneMap.set(gk,[]);
    sceneMap.get(gk)!.push({name:`${prettyName(r.employee)}${assoc.length>0?` (${assoc.join(', ')})`:''}`  , time:r.time, isFO:true});
    for (const sc of assoc) {
      if (!sceneMap.has(sc)) sceneMap.set(sc,[]);
      sceneMap.get(sc)!.push({name:`${prettyName(r.employee)} (${r.scene||'FO'})`, time:r.time, isFO:true});
    }
  }

  const blocks = Array.from(sceneMap.entries())
    .sort((a,b) => a[0].localeCompare(b[0],'fr'))
    .map(([scene,rows]) => ({header:cleanText(scene), rows:rows.sort((a,b)=>a.name.localeCompare(b.name,'fr'))}));

  await generateAndSave({
    title: 'Vue globale du jour',
    subtitle: fmtDate(date),
    blocks,
    itemCount: blocks.length,
    totalRows: blocks.reduce((a,b)=>a+Math.max(1,b.rows.length),0),
    filename: `sfx-planning-${date}.pdf`,
  });
}

/* ═══════════════════════════════════════════════
   EXPORT INDIVIDUEL — Planning d'un technicien
═══════════════════════════════════════════════ */
export async function exportEmployeePdf(employee: string, records: PlanningRecord[]): Promise<void> {
  const empRecs = records.filter(r => r.employee===employee);
  const dayAssoc = computeAllFOAssociations(records);
  const dateMap = new Map<string, Array<{name:string;time:string;isFO?:boolean}>>();

  for (const r of empRecs) {
    if (!dateMap.has(r.date)) dateMap.set(r.date,[]);
    let name = r.scene||'-'; let isFO=false;
    if (isTrainingScene(r.scene)) {
      isFO=true;
      const assoc = dayAssoc.get(getFOAssociationKey(r.date,r.employee))??[];
      if (assoc.length>0) name=`${assoc.join(', ')} (${r.scene})`;
    }
    dateMap.get(r.date)!.push(r.time==='OFF' ? {name:'Repos / Congé',time:'OFF'} : {name,time:r.time,isFO});
  }

  const allDates = Array.from(dateMap.keys()).filter(Boolean).sort();
  const blocks   = allDates.map(d => ({header:fmtDateShort(d), rows:dateMap.get(d)??[]}));
  const pStart   = allDates[0] ? fmtDate(allDates[0]) : '';
  const pEnd     = allDates[allDates.length-1] ? fmtDate(allDates[allDates.length-1]) : '';
  const period   = pStart&&pEnd&&pStart!==pEnd ? `${pStart} - ${pEnd}` : pStart;

  await generateAndSave({
    title: prettyName(employee),
    subtitle: period ? `Planning individuel · ${period}` : 'Planning individuel',
    blocks, itemCount:blocks.length,
    totalRows: blocks.reduce((a,b)=>a+Math.max(1,b.rows.length),0),
    filename: `sfx-planning-indiv-${slug(prettyName(employee))}.pdf`,
  });
}

/* ═══════════════════════════════════════════════
   EXPORT PAR SCÈNE — Planning d'une scène
═══════════════════════════════════════════════ */
export async function exportScenePdf(scene: string, records: PlanningRecord[]): Promise<void> {
  const allDates = Array.from(new Set(records.map(r=>r.date).filter(Boolean))).sort();
  if (allDates.length === 0) return;

  const pStart = fmtDate(allDates[0]);
  const pEnd = fmtDate(allDates[allDates.length-1]);
  const period = pStart && pEnd && pStart !== pEnd ? `${pStart} - ${pEnd}` : pStart;

  const dayAssoc = computeAllFOAssociations(records);
  const filteredRecords: PlanningRecord[] = [];
  
  for (const r of records) {
    if (r.time === 'OFF') continue;
    if (r.scene === scene) {
      filteredRecords.push(r);
    } else if (isTrainingScene(r.scene)) {
      const assoc = dayAssoc.get(getFOAssociationKey(r.date, r.employee)) || [];
      if (assoc.includes(scene)) {
        filteredRecords.push(r);
      }
    }
  }

  await generateGridGlobalPdf({
    title: cleanText(scene),
    subtitle: `Période : ${period}`,
    filename: `sfx-planning-${slug(scene)}.pdf`,
    records: filteredRecords
  });
}

export function listScenes(records: PlanningRecord[]): string[] {
  const set = new Set<string>();
  for (const r of records) if (r.scene) set.add(r.scene);
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
  
  const allEmps = Array.from(new Set(records.map(r=>r.employee).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'fr'));
  
  // Use A3 to double the density per page
  const doc = new jsPDF({orientation:'landscape', unit:'mm', format:'a3'});
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

  const rowH = 4.8;
  const headerH = 6;
  const colNameW = 55;
  const colDayW = (pageW - C_MARGIN*2 - colNameW) / 7;

  for (const weekDates of weeks) {
    const weekRecs = records.filter(r => weekDates.includes(r.date));
    const activeEmps = allEmps.filter(emp => weekRecs.some(r => r.employee === emp));
    if (activeEmps.length === 0) continue;

    if (y + headerH + rowH * 2 > bottom) drawPageHeader();

    // Draw Week Header
    doc.setFillColor(30, 40, 60);
    doc.rect(C_MARGIN, y, pageW - C_MARGIN*2, headerH, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text("TECHNICIEN", C_MARGIN + 2, y + 4.2);
    
    for (let d = 0; d < 7; d++) {
      const dx = C_MARGIN + colNameW + d * colDayW;
      if (d < weekDates.length) {
        doc.text(fmtDateShort(weekDates[d]), dx + colDayW/2, y + 4.2, {align: 'center'});
      }
    }
    y += headerH;

    for (const emp of activeEmps) {
      if (y + rowH > bottom) {
        drawPageHeader();
        
        // Redraw Header
        doc.setFillColor(30, 40, 60);
        doc.rect(C_MARGIN, y, pageW - C_MARGIN*2, headerH, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
        doc.text("TECHNICIEN (suite)", C_MARGIN + 2, y + 4.2);
        for (let d = 0; d < 7; d++) {
          const dx = C_MARGIN + colNameW + d * colDayW;
          if (d < weekDates.length) {
            doc.text(fmtDateShort(weekDates[d]), dx + colDayW/2, y + 4.2, {align: 'center'});
          }
        }
        y += headerH;
      }

      const isEven = activeEmps.indexOf(emp) % 2 === 0;
      doc.setFillColor(isEven ? 255 : 248, isEven ? 255 : 250, isEven ? 255 : 252);
      doc.rect(C_MARGIN, y, pageW - C_MARGIN*2, rowH, 'F');
      
      doc.setDrawColor(220, 225, 230); doc.setLineWidth(0.1);
      doc.line(C_MARGIN, y+rowH, pageW-C_MARGIN, y+rowH); // bottom
      
      doc.setTextColor(20, 30, 40); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      let nm = prettyName(emp);
      if (doc.getTextWidth(nm) > colNameW - 2) nm = doc.splitTextToSize(nm, colNameW - 2)[0] as string;
      doc.text(nm, C_MARGIN + 2, y + 3.4);
      
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
          doc.setFillColor(235, 238, 242);
          doc.rect(dx+0.4, y+0.4, colDayW-0.8, rowH-0.8, 'F');
          doc.setTextColor(130, 140, 150);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
          doc.text('OFF', dx + colDayW/2, y + 3.4, {align: 'center'});
        } else {
          const sc = getSceneColor(mainRec.scene);
          const sceneAbbr = shortenSceneName(mainRec.scene);
          
          const boxW = 18;
          doc.setFillColor(sc.rgbText[0], sc.rgbText[1], sc.rgbText[2]);
          doc.rect(dx+0.4, y+0.4, boxW, rowH-0.8, 'F');
          
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
          doc.text(sceneAbbr, dx + 0.4 + boxW/2, y + 3.2, {align: 'center'});
          
          let timeStr = mainRec.time;
          if (recs.length > 1) {
            const fO = recs.find(r => isTrainingScene(r.scene));
            if (fO) timeStr += ' +FO';
          }
          doc.setTextColor(20, 30, 40);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
          doc.text(timeStr, dx + 0.4 + boxW + (colDayW - boxW - 0.8)/2, y + 3.4, {align: 'center'});
        }
      }
      y += rowH;
    }
    
    // Top border of the table is drawn by header.
    y += 8; // spacing between weeks
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
