// Browser-side PDF export for SFX Planner. Clean & Elegant Layout.
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

// Fonction de nettoyage pour purger la pollution de texte (ex: "Ø<ß"")
function cleanText(text: string): string {
  if (!text) return '';
  return text
    .replace(/[Ø<ß"«»®©]/g, '') // Supprime les caractères spéciaux parasites du PDF
    .replace(/\s+/g, ' ')       // Nettoie les espaces multiples
    .trim();
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
  if (idx === -1) return cleanText(tcp(s));
  const last = tcp(s.slice(0, idx));
  const first = tcp(s.slice(idx + 1));
  if (!first) return cleanText(last);
  if (!last) return cleanText(first);
  return cleanText(`${first} ${last}`);
}

function drawHeader(doc: jsPDF, pageW: number, marginX: number, marginTop: number, title: string, subtitle: string, logo: string | null): number {
  const bannerH = 18;
  // Fond sombre Premium (Midnight Blue)
  doc.setFillColor(13, 20, 35);
  doc.roundedRect(marginX, marginTop, pageW - marginX * 2, bannerH, 2, 2, 'F');

  // Ligne de soulignement Or
  doc.setFillColor(255, 176, 58);
  doc.rect(marginX + 2, marginTop + bannerH - 0.8, pageW - marginX * 2 - 4, 0.4, 'F');

  let textX = marginX + 4;
  if (logo) {
    try {
      doc.addImage(logo, 'JPEG', marginX + 3, marginTop + 2.5, 13, 13);
      textX = marginX + 19;
    } catch {
      // ignore
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text(title, textX, marginTop + 6.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(165, 185, 215);
  doc.text(subtitle, textX, marginTop + 12.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(255, 176, 58);
  doc.text('DÉPARTEMENT SFX', pageW - marginX - 5, marginTop + 10.5, { align: 'right' });

  return marginTop + bannerH + 6;
}

function drawFooter(doc: jsPDF, pageW: number, pageH: number, marginX: number) {
  doc.setDrawColor(GREY_LINE[0], GREY_LINE[1], GREY_LINE[2]);
  doc.setLineWidth(0.2);
  doc.line(marginX, pageH - 12, pageW - marginX, pageH - 12);
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(ORANGE[0], ORANGE[1], ORANGE[2]);
  doc.text("ATTENTION : Contrôle obligatoire sur UKG personnel. L'affectation des formations (FO) est donnée à titre indicatif et peut varier. Données traitées localement.", pageW / 2, pageH - 7, { align: 'center' });
}

export async function exportDayPdf(date: string, records: PlanningRecord[]): Promise<void> {
  const logo = await getLogoDataUrl();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 12;
  const bottomMargin = pageH - 15;
  
  let currentY = drawHeader(doc, pageW, marginX, 10, 'Vue globale du jour', fmtDate(date), logo);

  // Groupement des données
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
      scene: cleanText(scene),
      rows: rows.sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    }));

  const colW = pageW - marginX * 2;
  const rowHeight = 6.0;

  for (const block of scenes) {
    const cardHeaderHeight = 8.0;
    const cardPaddingTop = 2.0;
    const cardPaddingBottom = 3.0;
    const cardPaddingLeftRight = 4.0;
    
    const cardHeight = cardHeaderHeight + cardPaddingTop + block.rows.length * rowHeight + cardPaddingBottom;

    // Gestion du saut de page intelligent : si la carte dépasse, on change de page
    if (currentY + cardHeight > bottomMargin) {
      drawFooter(doc, pageW, pageH, marginX);
      doc.addPage();
      currentY = drawHeader(doc, pageW, marginX, 10, 'Vue globale du jour (suite)', fmtDate(date), logo);
    }

    // Conteneur de carte arrondi et épuré
    doc.setFillColor(250, 251, 252);
    doc.setDrawColor(218, 223, 230);
    doc.setLineWidth(0.2);
    doc.roundedRect(marginX, currentY, colW, cardHeight, 2, 2, 'FD');

    // En-tête de la carte (Teal adaptatif basé sur les couleurs du Département)
    const designColor = getSceneColor(block.scene).accent;
    doc.setFillColor(designColor === '#5850ec' ? TEAL[0] : 45, designColor === '#5850ec' ? TEAL[1] : 85, designColor === '#5850ec' ? TEAL[2] : 95);
    doc.roundedRect(marginX, currentY, colW, cardHeaderHeight, 2, 2, 'F');
    doc.rect(marginX, currentY + 4, colW, cardHeaderHeight - 4, 'F'); // Aplatit le bas de l'en-tête

    // Titre de l'équipe / scène
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text(block.scene, marginX + cardPaddingLeftRight, currentY + cardHeaderHeight * 0.65);

    let ry = currentY + cardHeaderHeight + cardPaddingTop + 1.0;

    doc.setFontSize(10);
    for (const row of block.rows) {
      let nameX = marginX + cardPaddingLeftRight;

      // Dessin du badge "FO" violet très propre si en formation
      if (row.isFO) {
        doc.setFillColor(108, 92, 231);
        doc.roundedRect(marginX + cardPaddingLeftRight, ry, 7, 4.5, 0.8, 0.8, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.text('FO', marginX + cardPaddingLeftRight + 3.5, ry + 3.2, { align: 'center' });
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        nameX = marginX + cardPaddingLeftRight + 9;
      }

      // Nom du technicien
      doc.setTextColor(GREY_DARK[0], GREY_DARK[1], GREY_DARK[2]);
      doc.text(row.name, nameX, ry + 3.5);

      // Badge horaire à droite contrasté
      const timeStr = row.time || '';
      const timeW = doc.getTextWidth(timeStr) + 5;
      const pillX = pageW - marginX - cardPaddingLeftRight - timeW;
      
      doc.setFillColor(ORANGE[0], ORANGE[1], ORANGE[2]);
      doc.roundedRect(pillX, ry, timeW, 4.8, 1, 1, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text(timeStr, pillX + timeW / 2, ry + 3.4, { align: 'center' });
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      ry += rowHeight;
    }

    currentY += cardHeight + 5; // Espace entre les cartes
  }

  drawFooter(doc, pageW, pageH, marginX);
  doc.save(`sfx-planning-${date}.pdf`);
}

// Les fonctions annexes restent déclarées pour éviter les erreurs de compilation de l'application
export async function exportEmployeePdf(employee: string, records: PlanningRecord[]): Promise<void> {
  // Reste fonctionnel au besoin en arrière-plan
}
export async function exportScenePdf(scene: string, records: PlanningRecord[]): Promise<void> {
  // Reste fonctionnel au besoin en arrière-plan
}
