import jsPDF from 'jspdf';
import type { PlanningRecord } from './parsePdf';
import { computeAllFOAssociations, getFOAssociationKey, isTrainingScene, getSceneColor } from './utils';

const MONTH_FR: Record<string,string> = {
  '01':'janv.','02':'févr.','03':'mars','04':'avril','05':'mai',
  '06':'juin','07':'juil.','08':'août','09':'sept.','10':'oct.','11':'nov.','12':'déc.'
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
function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'scene';
}

/* ─── Logo cache ─── */
/* ═══════════════════════════════════════════════
   EXPORT QUOTIDIEN — Vue globale du jour
═══════════════════════════════════════════════ */
export async function exportDayPdf(date: string, records: PlanningRecord[]): Promise<void> {
  const dayRecs = records.filter(r => r.date === date && r.time !== 'OFF');
  await generateGridGlobalPdf({
    title: 'Vue globale du jour',
    subtitle: fmtDate(date),
    filename: `sfx-planning-${date}.pdf`,
    records: dayRecs
  });
}

/* ═══════════════════════════════════════════════
   EXPORT INDIVIDUEL — Planning d'un technicien
═══════════════════════════════════════════════ */
export async function exportEmployeePdf(employee: string, records: PlanningRecord[]): Promise<void> {
  const empRecs = records.filter(r => r.employee === employee);
  if (empRecs.length === 0) return;

  const allDates = Array.from(new Set(records.map(r=>r.date).filter(Boolean))).sort();
  const pStart = fmtDate(allDates[0]);
  const pEnd = fmtDate(allDates[allDates.length-1]);
  const period = pStart && pEnd && pStart !== pEnd ? `${pStart} - ${pEnd}` : pStart;

  await generateGridGlobalPdf({
    title: prettyName(employee),
    subtitle: `Planning individuel · ${period}`,
    filename: `sfx-planning-indiv-${slug(prettyName(employee))}.pdf`,
    records: empRecs
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
