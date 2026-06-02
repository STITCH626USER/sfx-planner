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
  doc.text("⚠ Contrôle obligatoire sur UKG personnel. Données indicatives — formations (FO) à titre informatif.", pageW/2, fy+1.5, {align:'center'});
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
function drawSceneCard(doc: jsPDF, x: number, y: number, w: number,
  sceneName: string, rows: Array<{name:string;time:string;isFO?:boolean}>,
  rowH = 6.0): number {
  const sc = getSceneColor(sceneName);
  const accentRgb: [number,number,number] = [
    Math.round(sc.rgbText[0]*0.7 + 30),
    Math.round(sc.rgbText[1]*0.7 + 30),
    Math.round(sc.rgbText[2]*0.7 + 30),
  ];
  const headerH = 8.5;
  const padX = 4; const padTop = 1.5; const padBot = 3;
  const totalRows = Math.max(1, rows.length);
  const cardH = headerH + padTop + totalRows * rowH + padBot;

  // Card background (very light scene color)
  doc.setFillColor(sc.rgbBg[0], sc.rgbBg[1], sc.rgbBg[2]);
  doc.setDrawColor(sc.rgbText[0], sc.rgbText[1], sc.rgbText[2]);
  doc.setLineWidth(0.15);
  doc.roundedRect(x, y, w, cardH, 2, 2, 'FD');

  // Left accent bar (3px, full height, scene color)
  doc.setFillColor(sc.rgbText[0], sc.rgbText[1], sc.rgbText[2]);
  doc.roundedRect(x, y, 3, cardH, 1.5, 1.5, 'F');
  doc.rect(x+1.5, y, 1.5, cardH, 'F');

  // Header band
  doc.setFillColor(sc.rgbText[0], sc.rgbText[1], sc.rgbText[2]);
  doc.roundedRect(x, y, w, headerH, 2, 2, 'F');
  doc.rect(x, y+2, w, headerH-2, 'F');
  // Scene name
  doc.setFont('helvetica','bold'); doc.setFontSize(9.5); doc.setTextColor(...WHITE);
  const sn = doc.splitTextToSize(cleanText(sceneName), w-padX*2-8)[0] as string;
  doc.text(sn, x+padX+1, y+headerH*0.67);
  // Tech count badge
  if (rows.length > 0) {
    const badge = String(rows.length);
    const bw = doc.getTextWidth(badge)+4; const bh = 4.5;
    const bx = x+w-padX-bw; const by = y+(headerH-bh)/2;
    doc.setFillColor(...WHITE); doc.setDrawColor(...WHITE); doc.roundedRect(bx, by, bw, bh, bh/2, bh/2, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(sc.rgbText[0],sc.rgbText[1],sc.rgbText[2]);
    doc.text(badge, bx+bw/2, by+bh*0.72, {align:'center'});
  }

  // Rows
  let ry = y + headerH + padTop + 1;
  if (rows.length === 0) {
    doc.setFont('helvetica','italic'); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text('Aucun technicien', x+padX+4, ry+rowH*0.55);
  } else {
    for (const row of rows) {
      // Avatar
      const avSize = rowH * 0.75;
      const avColor: [number,number,number] = row.isFO ? VIOLET : accentRgb;
      drawAvatar(doc, x+padX+1, ry+(rowH-avSize)/2, row.name, avColor, avSize);
      let nameX = x+padX+1+avSize+2;
      // FO badge
      if (row.isFO) {
        const fow=6.5; const foh=avSize*0.8; const fox=nameX; const foy=ry+(rowH-foh)/2;
        doc.setFillColor(...VIOLET); doc.roundedRect(fox, foy, fow, foh, 0.8, 0.8, 'F');
        doc.setTextColor(...WHITE); doc.setFont('helvetica','bold'); doc.setFontSize(6.5);
        doc.text('FO', fox+fow/2, foy+foh*0.72, {align:'center'});
        nameX += fow+1.5;
      }
      // Time pill
      doc.setFont('helvetica','bold'); doc.setFontSize(8);
      const timeStr = row.time||'';
      const tw = doc.getTextWidth(timeStr)+5; const th = rowH*0.72;
      const px = x+w-padX-tw; const py = ry+(rowH-th)/2;
      const pillColor: [number,number,number] = /^off$/i.test(timeStr) ? MUTED : AMBER;
      doc.setFillColor(...pillColor); doc.roundedRect(px, py, tw, th, th/2, th/2, 'F');
      doc.setTextColor(...WHITE); doc.text(timeStr, px+tw/2, py+th*0.72, {align:'center'});
      // Name
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...INK);
      const maxW = px - nameX - 2;
      const nm = doc.splitTextToSize(row.name, maxW)[0] as string;
      doc.text(nm, nameX, ry+rowH*0.62);
      ry += rowH;
    }
  }
  return cardH;
}

/* ─── Layout chooser ─── */
interface Layout { orientation:'portrait'|'landscape'; cols:number; fontTitle:number; fontSub:number; fontSection:number; fontRow:number; rowHeight:number; sectionGap:number; rowGap:number; dense:boolean; }

function chooseLayout(items:number, rows:number): Layout {
  const d = items + rows*0.6;
  if (d<=30)  return {orientation:'portrait',  cols:1, fontTitle:18,fontSub:11,fontSection:12,fontRow:10,rowHeight:6.0,sectionGap:4,  rowGap:0.6,dense:false};
  if (d<=60)  return {orientation:'portrait',  cols:2, fontTitle:17,fontSub:10,fontSection:11,fontRow:9.5,rowHeight:5.2,sectionGap:3.2,rowGap:0.4,dense:false};
  if (d<=110) return {orientation:'landscape', cols:2, fontTitle:16,fontSub:10,fontSection:10,fontRow:9,  rowHeight:4.8,sectionGap:2.8,rowGap:0.3,dense:false};
  if (d<=180) return {orientation:'landscape', cols:3, fontTitle:15,fontSub:9.5,fontSection:10,fontRow:8.5,rowHeight:4.2,sectionGap:2.4,rowGap:0.2,dense:true};
  return                {orientation:'landscape', cols:4, fontTitle:14,fontSub:9, fontSection:9.5,fontRow:8,  rowHeight:3.8,sectionGap:2,  rowGap:0.2,dense:true};
}

/* ─── Multi-column card layout engine ─── */
function layoutCards(doc: jsPDF, blocks: Array<{header:string;rows:Array<{name:string;time:string;isFO?:boolean}>}>,
  startY: number, marginX: number, pageW: number, pageH: number, cols: number, rowH: number, _gap: number, logo: string|null,
  headerTitle: string, headerSub: string): void {
  const bottom = pageH - 14;
  const gutter = 5;
  const colW = (pageW - marginX*2 - gutter*(cols-1)) / cols;
  const colYs: number[] = new Array(cols).fill(startY);

  const cardGap = 4;

  for (const block of blocks) {
    const nRows = Math.max(1, block.rows.length);
    const headerH = 8.5; const padTop=1.5; const padBot=3;
    const cardH = headerH + padTop + nRows * rowH + padBot;

    // Find shortest column
    let bestCol = 0; let minY = colYs[0];
    for (let i=1; i<cols; i++) if (colYs[i] < minY) { minY=colYs[i]; bestCol=i; }

    // Page break?
    if (minY + cardH > bottom) {
      drawPremiumFooter(doc, pageW, pageH, marginX);
      doc.addPage();
      const ny = drawPremiumHeader(doc, pageW, marginX, 10, headerTitle, headerSub+' (suite)', logo);
      colYs.fill(ny);
      bestCol=0; minY=ny;
    }

    const x = marginX + bestCol*(colW+gutter);
    const h = drawSceneCard(doc, x, colYs[bestCol], colW, block.header, block.rows, rowH);
    colYs[bestCol] += h + cardGap;
  }
}

/* ─── generateAndSave (employee + scene exports) ─── */
async function generateAndSave(opts:{
  title:string; subtitle:string;
  blocks:Array<{header:string;rows:Array<{name:string;time:string;isFO?:boolean}>}>;
  itemCount:number; totalRows:number; filename:string;
}): Promise<void> {
  const logo = await getLogoDataUrl();
  const layout = chooseLayout(opts.itemCount, opts.totalRows);
  const doc = new jsPDF({orientation:layout.orientation, unit:'mm', format:'a4'});
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const startY = drawPremiumHeader(doc, pageW, 10, 10, opts.title, opts.subtitle, logo);
  layoutCards(doc, opts.blocks, startY, 10, pageW, pageH, layout.cols, layout.rowHeight, layout.sectionGap, logo, opts.title, opts.subtitle);
  drawPremiumFooter(doc, pageW, pageH, 10);
  doc.save(opts.filename);
}

/* ═══════════════════════════════════════════════
   EXPORT QUOTIDIEN — Vue globale du jour
═══════════════════════════════════════════════ */
export async function exportDayPdf(date: string, records: PlanningRecord[]): Promise<void> {
  const logo = await getLogoDataUrl();
  const doc = new jsPDF({orientation:'landscape', unit:'mm', format:'a4'});
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 12;
  const ROW_H = 6.0; const COLS = 3;

  let currentY = drawPremiumHeader(doc, pageW, marginX, 10, 'Vue globale du jour', fmtDate(date), logo, 'DÉPARTEMENT SFX');

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

  const scenes = Array.from(sceneMap.entries())
    .sort((a,b) => a[0].localeCompare(b[0],'fr'))
    .map(([scene,rows]) => ({header:cleanText(scene), rows:rows.sort((a,b)=>a.name.localeCompare(b.name,'fr'))}));

  layoutCards(doc, scenes, currentY, marginX, pageW, pageH, COLS, ROW_H, 5, logo, 'Vue globale du jour', fmtDate(date));
  drawPremiumFooter(doc, pageW, pageH, marginX);
  doc.save(`sfx-planning-${date}.pdf`);
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
  const period   = pStart&&pEnd&&pStart!==pEnd ? `${pStart} → ${pEnd}` : pStart;

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
  const sceneRecs = records.filter(r => r.scene===scene && r.time!=='OFF');
  const foRecs    = records.filter(r => isTrainingScene(r.scene) && r.time!=='OFF');
  const dayAssoc  = computeAllFOAssociations(records);
  const dateMap   = new Map<string, Array<{name:string;time:string;isFO?:boolean}>>();

  for (const r of sceneRecs) {
    if (!dateMap.has(r.date)) dateMap.set(r.date,[]);
    let isFO=false; let name=prettyName(r.employee);
    if (isTrainingScene(r.scene)) {
      isFO=true;
      const assoc=dayAssoc.get(getFOAssociationKey(r.date,r.employee))??[];
      if (assoc.length>0) name=`${prettyName(r.employee)} (${assoc.join(', ')})`;
    }
    dateMap.get(r.date)!.push({name,time:r.time,isFO});
  }
  for (const r of foRecs) {
    const assoc=dayAssoc.get(getFOAssociationKey(r.date,r.employee))??[];
    if (assoc.includes(scene)) {
      if (!dateMap.has(r.date)) dateMap.set(r.date,[]);
      dateMap.get(r.date)!.push({name:`${prettyName(r.employee)} (${r.scene||'FO'})`, time:r.time, isFO:true});
    }
  }

  const allDates  = Array.from(new Set(records.map(r=>r.date).filter(Boolean))).sort();
  const dates     = allDates.map(d => ({date:d, rows:(dateMap.get(d)??[]).sort((a,b)=>a.name.localeCompare(b.name,'fr'))}));
  const pStart    = allDates[0] ? fmtDate(allDates[0]) : '';
  const pEnd      = allDates[allDates.length-1] ? fmtDate(allDates[allDates.length-1]) : '';
  const period    = pStart&&pEnd&&pStart!==pEnd ? `${pStart} → ${pEnd}` : pStart;

  await generateAndSave({
    title: cleanText(scene),
    subtitle: period ? `Période : ${period}` : 'Période',
    blocks: dates.map(d => ({header:fmtDateShort(d.date), rows:d.rows})),
    itemCount: dates.length,
    totalRows: dates.reduce((a,d)=>a+Math.max(1,d.rows.length),0),
    filename: `sfx-planning-${slug(scene)}.pdf`,
  });
}

export function listScenes(records: PlanningRecord[]): string[] {
  const set = new Set<string>();
  for (const r of records) if (r.scene) set.add(r.scene);
  return Array.from(set).sort((a,b)=>a.localeCompare(b,'fr'));
}

export async function exportGlobalRecapPdf(records: PlanningRecord[]): Promise<void> {
  const allDates = Array.from(new Set(records.map(r=>r.date).filter(Boolean))).sort();
  if (allDates.length===0) return;
  await exportDayPdf(allDates[0], records);
}
