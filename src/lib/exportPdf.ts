import jsPDF from 'jspdf';
import type { PlanningRecord } from './parsePdf';
import { getFOAssociations, isTrainingScene, getSceneColor } from './utils';

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

function prettyName(s: string): string {
  const idx = s.indexOf(',');
  const tc = (w: string) => w.split(/([-'])/).map(p => /^[-']$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
  const tcp = (str: string) => str.trim().split(/\s+/).map(tc).join(' ');
  if (idx === -1) return cleanText(tcp(s));
  const last = tcp(s.slice(0, idx)); const first = tcp(s.slice(idx + 1));
  if (!first) return cleanText(last); if (!last) return cleanText(first);
  return cleanText(`${first} ${last}`);
}

function drawFooter(doc: jsPDF, pageW: number, pageH: number, marginX: number) {
  doc.setDrawColor(GREY_LINE[0], GREY_LINE[1], GREY_LINE[2]); doc.setLineWidth(0.2); doc.line(marginX, pageH - 11, pageW - marginX, pageH - 11);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(ORANGE[0], ORANGE[1], ORANGE[2]);
  doc.text("ATTENTION : Contrôle obligatoire sur UKG personnel. L'affectation des formations (FO) est donnée à titre indicatif et peut varier. Données traitées localement.", pageW / 2, pageH - 7, { align: 'center' });
}

export async function exportDayPdf(date: string, records: PlanningRecord[]): Promise<void> {
  const logo = await getLogoDataUrl();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth(); 
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 12; 
  const bottomMargin = pageH - 15;
  const cols = 3; 
  const gutter = 6;
  const colW = (pageW - marginX * 2 - gutter * (cols - 1)) / cols;
  
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

  const rowHeight = 6.0;
  const colYs: number[] = new Array(cols).fill(currentY);

  for (const block of scenes) {
    const cardHeight = 8.0 + 2.0 + block.rows.length * rowHeight + 3.0;
    
    let bestCol = 0;
    let minY = colYs[0];
    for(let i=1; i<cols; i++) {
        if(colYs[i] < minY) {
            minY = colYs[i];
            bestCol = i;
        }
    }

    if (minY + cardHeight > bottomMargin) {
      drawFooter(doc, pageW, pageH, marginX); 
      doc.addPage();
      currentY = drawHeaderLocal(doc, pageW, marginX, 10, 'Vue globale du jour (suite)', fmtDate(date));
      colYs.fill(currentY);
      minY = currentY;
      bestCol = 0;
    }

    const x = marginX + bestCol * (colW + gutter);
    const y = minY;

    doc.setFillColor(250, 251, 252); doc.setDrawColor(218, 223, 230); doc.setLineWidth(0.2); 
    doc.roundedRect(x, y, colW, cardHeight, 2, 2, 'FD');
    const dCol = getSceneColor(block.scene).accent;
    doc.setFillColor(dCol === '#5850ec' ? TEAL[0] : 45, dCol === '#5850ec' ? TEAL[1] : 85, dCol === '#5850ec' ? TEAL[2] : 95);
    doc.roundedRect(x, y, colW, 8.0, 2, 2, 'F'); doc.rect(x, y + 4, colW, 4.0, 'F');

    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(255, 255, 255);
    const sceneText = doc.splitTextToSize(block.scene, colW - 8)[0] as string;
    doc.text(sceneText, x + 4.0, y + 5.2);

    let ry = y + 11.0; doc.setFontSize(9);
    for (const row of block.rows) {
      let nameX = x + 4.0;
      if (row.isFO) {
        doc.setFillColor(108, 92, 231); doc.roundedRect(x + 4.0, ry, 7, 4.5, 0.8, 0.8, 'F');
        doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
        doc.text('FO', x + 7.5, ry + 3.2, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); nameX = x + 13.0;
      }
      
      const timeW = doc.getTextWidth(row.time || '') + 5; 
      const pillX = x + colW - 4.0 - timeW;
      const maxNameW = pillX - nameX - 2;
      const truncName = doc.splitTextToSize(row.name, maxNameW)[0] as string;

      doc.setTextColor(GREY_DARK[0], GREY_DARK[1], GREY_DARK[2]); doc.text(truncName, nameX, ry + 3.5);
      doc.setFillColor(ORANGE[0], ORANGE[1], ORANGE[2]); doc.roundedRect(pillX, ry, timeW, 4.8, 1, 1, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
      doc.text(row.time || '', pillX + timeW / 2, ry + 3.4, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); ry += rowHeight;
    }
    colYs[bestCol] = y + cardHeight + 4; 
  }
  drawFooter(doc, pageW, pageH, marginX); doc.save(`sfx-planning-${date}.pdf`);
}

export async function exportEmployeePdf(employee: string, records: PlanningRecord[]): Promise<void> {
  const doc = new jsPDF();
  doc.text(`Planning: ${employee}`, 10, 10);
  doc.save(`planning-${employee}.pdf`);
}

export async function exportScenePdf(scene: string, records: PlanningRecord[]): Promise<void> {
  const doc = new jsPDF();
  doc.text(`Scene: ${scene}`, 10, 10);
  doc.save(`scene-${scene}.pdf`);
}

export function listScenes(records: PlanningRecord[]): string[] {
  const set = new Set<string>(); for (const r of records) if (r.scene) set.add(r.scene); return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));
}

export async function exportGlobalRecapPdf(records: PlanningRecord[]): Promise<void> {
  const doc = new jsPDF();
  doc.text("Recap", 10, 10);
  doc.save("recap.pdf");
}
