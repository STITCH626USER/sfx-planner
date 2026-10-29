import { jsPDF } from 'jspdf';
import type { PlanningRecord } from './parsePdf';
import { isTrainingScene, getSceneColor, timesMatch, prettyName, dayInitials, cleanSceneName, parseRange, cleanRoleLabel } from './utils';

/* ─── Design Tokens (matches app CSS) ─── */
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
  return (t||'').replace(/[Ø<ß"«»®©]/g,'').replace(/^ENT[-_\s]+/i, '').replace(/\bENT\b[-_\s]*/gi, '').replace(/\s+/g,' ').trim();
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

  // Center UKG warning (exact text matching permanent bottom popup, ASCII safe)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(...AMBER2);
  doc.text("Contrôle obligatoire sur UKG personnel. Se rapprocher de la coordination pour les formations.", pageW / 2, fy + 2.5, { align: 'center' });

  // Right date (no "Document officiel" per user request)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(148, 163, 184);
  const now = new Date();
  const dStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
  doc.text(`Édité le ${dStr}`, pageW - marginX - 1, fy + 2.5, { align: 'right' });
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
/* ─── Night Shift Detection & Vector Moon Icon ─── */
const NIGHT_BG: [number, number, number] = [238, 242, 255];     // Indigo-50
const NIGHT_BORDER: [number, number, number] = [165, 180, 252]; // Indigo-300
const NIGHT_PILL_BG: [number, number, number] = [30, 41, 59];   // Slate-800
const NIGHT_PILL_BORDER: [number, number, number] = [79, 70, 229]; // Indigo-600
const NIGHT_ACCENT: [number, number, number] = [67, 56, 202];   // Indigo-700

function isNightShift(timeStr: string): boolean {
  if (!timeStr || /^off$/i.test(timeStr)) return false;
  const m = timeStr.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!m) return false;
  const startH = parseInt(m[1], 10);
  const endH = parseInt(m[3], 10);
  if (startH >= 20 || startH < 5) return true;
  if (startH >= 18 && endH >= 3 && endH <= 9) return true;
  return false;
}

function drawMoonIcon(
  doc: jsPDF,
  cx: number,
  cy: number,
  r: number,
  bgRgb: [number, number, number],
  moonRgb: [number, number, number] = [251, 191, 36]
) {
  doc.setFillColor(...moonRgb);
  doc.circle(cx, cy, r, 'F');
  doc.setFillColor(...bgRgb);
  doc.circle(cx + r * 0.42, cy - r * 0.22, r * 0.82, 'F');
}

function drawNightSectionHeader(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  count?: number,
  compact = false
) {
  const barH = compact ? 3.8 : 4.2;
  const label = count && count > 1 ? `ÉQUIPE DE NUIT (${count})` : 'ÉQUIPE DE NUIT';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(compact ? 4.6 : 5.0);
  const textW = doc.getTextWidth(label);
  const badgeW = textW + (compact ? 6.2 : 6.8);
  const badgeH = compact ? 3.3 : 3.6;
  const by = y + (barH - badgeH) / 2;

  // Horizontal accent line across full width
  doc.setDrawColor(...NIGHT_BORDER);
  doc.setLineWidth(0.22);
  doc.line(x, y + barH / 2, x + w, y + barH / 2);

  // Dark indigo pill on left
  doc.setFillColor(...NIGHT_PILL_BG);
  doc.setDrawColor(...NIGHT_PILL_BORDER);
  doc.setLineWidth(0.2);
  doc.roundedRect(x, by, badgeW, badgeH, 0.9, 0.9, 'FD');

  // Crescent moon icon
  drawMoonIcon(doc, x + 2.1, by + badgeH / 2, compact ? 0.85 : 0.95, NIGHT_PILL_BG);

  // Label text
  doc.setTextColor(255, 255, 255);
  doc.text(label, x + 4.0, by + badgeH * 0.71);
}

/* ─── Role Pill Style for PDF (Print-Friendly High Contrast) ─── */
function getPdfRoleColors(role: string): { bg: [number, number, number]; border: [number, number, number]; text: [number, number, number] } {
  const r = (role || '').toLowerCase();
  if (r.includes('regie')) {
    return { bg: [254, 243, 199], border: [245, 158, 11], text: [146, 64, 14] }; // Amber Gold
  }
  if (r.includes('coord') || r.includes('lead') || r.includes('asst')) {
    return { bg: [255, 228, 230], border: [244, 63, 94], text: [159, 18, 57] }; // Rose Coral
  }
  if (r.includes('secu') || r.includes('ponton') || r.includes('bassin')) {
    return { bg: [204, 251, 241], border: [20, 184, 166], text: [17, 94, 89] }; // Teal
  }
  if (r.includes('atelier') || r.includes('bunker') || r.includes('magasin') || r.includes('parkwide')) {
    return { bg: [224, 242, 254], border: [56, 189, 248], text: [3, 105, 161] }; // Sky Blue
  }
  return { bg: [241, 245, 249], border: [203, 213, 225], text: [71, 85, 105] }; // Slate neutral
}

/* ─── Compact card dimensions ─── */
const C_HEADER = 6.8;  // card header height mm
const C_PAD_T  = 1.0;  // padding top
const C_PAD_B  = 1.6;  // padding bottom
const C_CARD_GAP = 3.0; // gap between cards
const C_ROW_H  = 5.2;  // row height
const C_GUTTER = 4.2;  // column gutter
const C_MARGIN = 10;   // page margin

function calcSceneCardContentH(
  rows: Array<{name:string;time:string;role?:string;isFO?:boolean;subtext?:string}>,
  rowH: number
): number {
  if (rows.length === 0) return rowH;
  let contentH = 0;
  let nightCount = 0;
  for (const r of rows) {
    contentH += r.subtext ? rowH + 2.4 : rowH;
    if (isNightShift(r.time)) nightCount++;
  }
  if (nightCount > 0) {
    contentH += 4.6; // Night section header height
  }
  return contentH;
}

function drawSceneCard(doc: jsPDF, x: number, y: number, w: number,
  headerText: string, rows: Array<{name:string;time:string;role?:string;isFO?:boolean;subtext?:string}>,
  rowH: number, themeColorName: string, dateStr?: string): number {
  const sc = getSceneColor(themeColorName);
  const headerH = C_HEADER;
  const padX = 3.5; const padTop = C_PAD_T; const padBot = C_PAD_B;

  // Ensure Day/Show shifts are listed first, followed by Night shifts
  const sortedRows = [...rows].sort((a, b) => {
    const nA = isNightShift(a.time) ? 1 : 0;
    const nB = isNightShift(b.time) ? 1 : 0;
    if (nA !== nB) return nA - nB;
    return 0;
  });

  const nightCount = sortedRows.filter(r => isNightShift(r.time)).length;
  const contentH = calcSceneCardContentH(sortedRows, rowH);
  const cardH = Math.max(dateStr ? 16 : 0, headerH + padTop + contentH + padBot);

  const cardX = x;
  const cardW = w;

  // Card background (White with crisp slate border)
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(214, 222, 233);
  doc.setLineWidth(0.25);
  doc.roundedRect(cardX, y, cardW, cardH, 2.2, 2.2, 'FD');

  // Header band (Rich scene tint)
  doc.setFillColor(sc.rgbBg[0], sc.rgbBg[1], sc.rgbBg[2]);
  doc.roundedRect(cardX, y, cardW, headerH, 2.2, 2.2, 'F');
  doc.rect(cardX, y + 2.2, cardW, headerH - 2.2, 'F');

  // Bottom line of header
  doc.setDrawColor(sc.rgbAccent[0], sc.rgbAccent[1], sc.rgbAccent[2]);
  doc.setLineWidth(0.2);
  doc.line(cardX, y + headerH, cardX + cardW, y + headerH);

  // Re-stroke outer rounded border cleanly over the header band
  doc.setDrawColor(
    Math.round(sc.rgbAccent[0] * 0.35 + 203 * 0.65),
    Math.round(sc.rgbAccent[1] * 0.35 + 213 * 0.65),
    Math.round(sc.rgbAccent[2] * 0.35 + 225 * 0.65)
  );
  doc.setLineWidth(0.25);
  doc.roundedRect(cardX, y, cardW, cardH, 2.2, 2.2, 'S');

  // Scene dot + Scene name
  const dotX = cardX + padX + 1.2;
  const dotY = y + headerH / 2;
  doc.setFillColor(sc.rgbAccent[0], sc.rgbAccent[1], sc.rgbAccent[2]);
  doc.circle(dotX, dotY, 1.2, 'F');

  // Right count badge inside header
  const countStr = `${sortedRows.length}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  const countW = Math.max(5.2, doc.getTextWidth(countStr) + 3.2);
  const countH = 4.4;
  const countX = cardX + cardW - padX - countW;
  const countY = y + (headerH - countH) / 2;
  doc.setFillColor(sc.rgbAccent[0], sc.rgbAccent[1], sc.rgbAccent[2]);
  doc.roundedRect(countX, countY, countW, countH, 1.2, 1.2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.text(countStr, countX + countW / 2, countY + 3.1, { align: 'center' });

  // Scene title
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(sc.rgbText[0], sc.rgbText[1], sc.rgbText[2]);
  let snSize = 8.0;
  doc.setFontSize(snSize);
  const maxWText = countX - (dotX + 2.5) - 2;
  let sn = cleanText(headerText);
  while (doc.getTextWidth(sn) > maxWText && snSize > 5.5) {
    snSize -= 0.4;
    doc.setFontSize(snSize);
  }
  if (doc.getTextWidth(sn) > maxWText) {
    sn = doc.splitTextToSize(sn, maxWText)[0] as string;
  }
  doc.text(sn, dotX + 2.6, y + headerH * 0.67);

  // Rows
  let ry = y + headerH + padTop;
  if (sortedRows.length === 0) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(...MUTED);
    doc.text('Aucun technicien', cardX + padX + 2, ry + rowH * 0.62);
  } else {
    let nightSectionStarted = false;
    for (let rIdx = 0; rIdx < sortedRows.length; rIdx++) {
      const row = sortedRows[rIdx];
      const isNight = isNightShift(row.time);
      const currentH = row.subtext ? rowH + 2.4 : rowH;

      if (isNight && !nightSectionStarted) {
        nightSectionStarted = true;
        // Draw soft night background block for all remaining night rows
        const remH = (y + cardH - padBot) - ry + 0.6;
        doc.setFillColor(...NIGHT_BG);
        doc.setDrawColor(...NIGHT_BORDER);
        doc.setLineWidth(0.2);
        doc.roundedRect(cardX + 1.8, ry + 0.2, cardW - 3.6, remH, 1.2, 1.2, 'FD');

        drawNightSectionHeader(doc, cardX + padX + 0.2, ry + 0.4, cardW - padX * 2 - 0.4, nightCount, false);
        ry += 4.6;
      } else if (rIdx > 0) {
        // Subtle alternating row separator
        doc.setDrawColor(isNight ? 214 : 241, isNight ? 222 : 245, isNight ? 248 : 249);
        doc.setLineWidth(0.18);
        doc.line(cardX + 3.2, ry, cardX + cardW - 2.5, ry);
      }

      const avSize = 3.6;
      const avColor: [number, number, number] = row.isFO ? VIOLET : (isNight ? NIGHT_ACCENT : sc.rgbAccent);
      const mainRowCenterY = ry + rowH / 2;
      drawAvatar(doc, cardX + padX + 0.8, mainRowCenterY - avSize / 2, row.name, avColor, avSize);

      const nameX = cardX + padX + 0.8 + avSize + 1.8;

      // Time pill on far right
      const timeStr = (row.time || '').replace(/\s*-\s*/, ' - ');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6);
      const tw = doc.getTextWidth(timeStr) + 3.8;
      const th = 3.9;
      const px = cardX + cardW - padX - tw;
      const py = mainRowCenterY - th / 2;

      const isOff = /^off$/i.test(timeStr);
      const pillColor: [number, number, number] = isOff ? [241, 245, 249] : (isNight ? NIGHT_PILL_BG : sc.rgbBg);
      const pillBorder: [number, number, number] = isOff ? [203, 213, 225] : (isNight ? NIGHT_PILL_BORDER : sc.rgbAccent);
      const pillText: [number, number, number] = isOff ? MUTED : (isNight ? [255, 255, 255] : sc.rgbText);
      doc.setFillColor(...pillColor);
      doc.setDrawColor(...pillBorder);
      doc.setLineWidth(0.22);
      doc.roundedRect(px, py, tw, th, 1.0, 1.0, 'FD');
      doc.setTextColor(...pillText);
      doc.text(timeStr, px + tw / 2, py + 2.8, { align: 'center' });

      // Optional Role badge just to the left of Time pill
      let roleRightEdge = px - 1.4;
      const cleanRole = cleanRoleLabel(row.role || '');
      if (cleanRole) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.5);
        const rw = doc.getTextWidth(cleanRole) + 3.0;
        const rh = 3.6;
        const rxRole = roleRightEdge - rw;
        const ryRole = mainRowCenterY - rh / 2;
        const rc = getPdfRoleColors(cleanRole);
        doc.setFillColor(...rc.bg);
        doc.setDrawColor(...rc.border);
        doc.setLineWidth(0.18);
        doc.roundedRect(rxRole, ryRole, rw, rh, 0.9, 0.9, 'FD');
        doc.setTextColor(...rc.text);
        doc.text(cleanRole, rxRole + rw / 2, ryRole + 2.55, { align: 'center' });
        roleRightEdge = rxRole - 1.4;
      }

      // Technician Name (bold surname / clear typography)
      const maxNameW = Math.max(18, roleRightEdge - nameX);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(...INK);
      let dispName = row.name;
      if (doc.getTextWidth(dispName) > maxNameW) {
        while (dispName.length > 0 && doc.getTextWidth(dispName + '…') > maxNameW) {
          dispName = dispName.slice(0, -1);
        }
        dispName = dispName.trim() + '…';
      }
      doc.text(dispName, nameX, mainRowCenterY + 0.9);

      // Subtext (e.g. Formation details or full shift amplitude)
      if (row.subtext) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5.4);
        doc.setTextColor(100, 116, 139);
        const maxSubW = cardW - (nameX - cardX) - padX;
        let subLine = row.subtext;
        if (doc.getTextWidth(subLine) > maxSubW) {
          subLine = doc.splitTextToSize(subLine, maxSubW)[0] as string;
        }
        doc.text(subLine, nameX, ry + rowH + 1.4);
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
    const contentH = calcSceneCardContentH(block.rows as Array<{name:string;time:string;role?:string;isFO?:boolean;subtext?:string}>, rowH);
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
function layoutCards(doc: jsPDF, blocks: Array<{header:string;themeColorName:string;rows:Array<{name:string;time:string;role?:string;isFO?:boolean;subtext?:string}>, dateStr?: string}>,
  startY: number, marginX: number, pageW: number, pageH: number, cols: number, rowH: number, _gap: number, logo: string|null,
  headerTitle: string, headerSub: string, statsBadge?: string): void {
  const bottom = pageH - 13;
  const gutter = C_GUTTER;
  const colW = (pageW - marginX*2 - gutter*(cols-1)) / cols;
  const colYs: number[] = new Array(cols).fill(startY);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const contentH = calcSceneCardContentH(block.rows, rowH);
    const cardH = Math.max(block.dateStr ? 16 : 0, C_HEADER + C_PAD_T + contentH + C_PAD_B);
    
    // Find shortest column
    let bestCol = 0; let minY = colYs[0];
    for (let c=1; c<cols; c++) if (colYs[c] < minY) { minY=colYs[c]; bestCol=c; }

    // Page break
    if (minY + cardH > bottom) {
      drawPremiumFooter(doc, pageW, pageH, marginX);
      doc.addPage();
      const sy = drawPremiumHeader(doc, pageW, marginX, 10, headerTitle, headerSub + ' (suite)', logo, 'SFX PLANNER', statsBadge) + 2;
      colYs.fill(sy);
      bestCol = 0;
    }

    const x = marginX + bestCol * (colW + gutter);
    const h = drawSceneCard(doc, x, colYs[bestCol], colW, block.header, block.rows, rowH, block.themeColorName, block.dateStr);
    colYs[bestCol] += h + C_CARD_GAP;
  }
}

/* ─── generateAndSave (day export) ─── */
export async function generateAndSave(opts: {
  title: string; subtitle: string; filename: string;
  itemCount: number; totalRows: number;
  maxCols?: number;
  statsBadge?: string;
  blocks: Array<{
    header: string;
    themeColorName: string;
    rows: Array<{name:string;time:string;role?:string;isFO?:boolean;subtext?:string}>;
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
  const startY = drawPremiumHeader(doc, pageW, C_MARGIN, 10, opts.title, opts.subtitle, logo, 'SFX PLANNER', opts.statsBadge);
  layoutCards(doc, opts.blocks, startY, C_MARGIN, pageW, pageH, cols, rowH, C_CARD_GAP, logo, opts.title, opts.subtitle, opts.statsBadge);
  drawPremiumFooter(doc, pageW, pageH, C_MARGIN);
  await downloadOrSharePdf(doc, opts.filename);
}

/* ═══════════════════════════════════════════════
   EXPORT QUOTIDIEN — Vue globale du jour
═══════════════════════════════════════════════ */
export async function exportDayPdf(date: string, records: PlanningRecord[]): Promise<void> {
  const dayRecs = records.filter(r => r.date===date && r.time!=='OFF');
  const sceneMap = new Map<string, Array<{name:string;time:string;role?:string;isFO?:boolean;subtext?:string}>>();

  for (const r of dayRecs) {
    let groupName = r.scene;
    const displayName = prettyName(r.employee);
    let roleLabel = r.role || '';
    let subtext: string | undefined;
    
    if (isTrainingScene(r.scene)) {
      groupName = 'Formations';
      if (r.scene.toLowerCase() !== 'formation' && r.scene.toLowerCase() !== 'fo') {
        const detail = r.scene.replace(/^(formation|fo)\s*(-\s*)?/i, '').trim();
        if (detail) roleLabel = detail;
      }
    }
    
    if (r.shiftTime && r.shiftTime !== r.time) {
      subtext = `Amplitude journée : ${r.shiftTime}`;
    }
    
    if (!sceneMap.has(groupName)) sceneMap.set(groupName, []);
    sceneMap.get(groupName)!.push({
      name: displayName,
      time: r.time,
      role: roleLabel,
      isFO: isTrainingScene(r.scene),
      subtext
    });
  }

  const uniqueTechCount = new Set(dayRecs.map(r => r.employee)).size;

  const blocks = Array.from(sceneMap.entries())
    .sort((a, b) => {
      const aFO = isTrainingScene(a[0]);
      const bFO = isTrainingScene(b[0]);
      if (aFO && !bFO) return 1;
      if (!aFO && bFO) return -1;
      const diff = b[1].length - a[1].length;
      if (diff !== 0) return diff;
      return a[0].localeCompare(b[0], 'fr');
    })
    .map(([scene, rows]) => ({
      header: cleanText(cleanSceneName(scene)),
      themeColorName: scene,
      rows: rows.sort((a, b) => {
        const rA = parseRange(a.time);
        const rB = parseRange(b.time);
        if (rA && rB && rA.start !== rB.start) return rA.start - rB.start;
        return a.name.localeCompare(b.name, 'fr');
      })
    }));

  await generateAndSave({
    title: 'Vue globale du jour',
    subtitle: fmtDate(date),
    statsBadge: `${uniqueTechCount} PRÉSENTS · ${blocks.length} SCÈNES`,
    blocks,
    itemCount: blocks.length,
    totalRows: blocks.reduce((a,b)=>a+Math.max(1,b.rows.length),0),
    filename: `sfx-planning-${date}.pdf`,
    maxCols: 3
  });
}

/* ═══════════════════════════════════════════════
   EXPORT INDIVIDUEL — Planning d'un technicien
═══════════════════════════════════════════════ */
export async function exportEmployeePdf(employee: string, records: PlanningRecord[]): Promise<void> {
  const empRecs = records.filter(r => r.employee===employee);
  const dateMap = new Map<string, Array<{name:string;time:string;role?:string;isFO?:boolean;subtext?:string}>>();

  for (const r of empRecs) {
    if (!dateMap.has(r.date)) dateMap.set(r.date, []);
    const clean = cleanSceneName(r.scene) || '-';
    const role = (r.role && !isTrainingScene(r.scene)) ? cleanRoleLabel(r.role) : '';
    const name = clean;
    let isFO = false;
    let subtext: string | undefined;
    if (isTrainingScene(r.scene)) {
      isFO = true;
      const dayRecs = records.filter(dr => dr.date === r.date && dr.time !== 'OFF' && !isTrainingScene(dr.scene));
      const scenesOfDay = new Set<string>();
      for (const dr of dayRecs) {
        if (timesMatch(dr.time, r.time, 5)) {
          const cln = dr.scene.replace(/\bENT\b/gi, '').trim().replace(/^[-_]+|[-_]+$/g, '').trim();
          if (cln && cln.toLowerCase() !== 'fo' && cln.toLowerCase() !== 'formation') {
            scenesOfDay.add(cln);
          }
        }
      }
      scenesOfDay.add('Formation autre');
      if (scenesOfDay.size > 0) subtext = 'Possibilités : ' + Array.from(scenesOfDay).sort().join(', ');
    } else if (r.shiftTime && r.shiftTime !== r.time) {
      subtext = `Journée : ${r.shiftTime}`;
    }
    dateMap.get(r.date)!.push(
      r.time === 'OFF'
        ? { name: 'Repos / Congé', time: 'OFF' }
        : { name, time: r.time, role, isFO, subtext }
    );
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
  dateMap: Map<string, Array<{name:string;time:string;role?:string;isFO?:boolean;subtext?:string}>>;
  allDates: string[];
  filename: string;
  themeColorName?: string;
}): Promise<void> {
  const logo = await getLogoDataUrl();
  const doc = new jsPDF({orientation:'landscape', unit:'mm', format:'a4'});
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 8;
  
  let startY = drawPremiumHeader(doc, pageW, marginX, 8, opts.title, opts.subtitle, logo, 'SFX PLANNER', opts.statsBadge);
  const bottomLimit = pageH - 13.5; // footer top
  const gutter = 3.2;

  // Build calendar weeks starting on Sunday (Dimanche -> Samedi, 7 days per column)
  const firstIso = opts.allDates[0];
  const lastIso = opts.allDates[opts.allDates.length - 1];

  const [y1, m1, d1] = firstIso.split('-').map(Number);
  const startDate = new Date(y1, m1 - 1, d1);
  const startDay = startDate.getDay(); // 0 is Sunday
  startDate.setDate(startDate.getDate() - startDay);

  const [y2, m2, d2] = lastIso.split('-').map(Number);
  const endDate = new Date(y2, m2 - 1, d2);
  const endDay = endDate.getDay(); // 6 is Saturday
  if (endDay !== 6) {
    endDate.setDate(endDate.getDate() + (6 - endDay));
  }

  const weeks: string[][] = [];
  const cur = new Date(startDate);
  let currentWeek: string[] = [];
  while (cur <= endDate) {
    const yStr = cur.getFullYear();
    const mStr = String(cur.getMonth() + 1).padStart(2, '0');
    const dStr = String(cur.getDate()).padStart(2, '0');
    currentWeek.push(`${yStr}-${mStr}-${dStr}`);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    cur.setDate(cur.getDate() + 1);
  }
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      cur.setDate(cur.getDate() + 1);
      const yStr = cur.getFullYear();
      const mStr = String(cur.getMonth() + 1).padStart(2, '0');
      const dStr = String(cur.getDate()).padStart(2, '0');
      currentWeek.push(`${yStr}-${mStr}-${dStr}`);
    }
    weeks.push(currentWeek);
  }

  const isSceneMode = Boolean(opts.themeColorName);
  const weekBannerH = 5.4;
  const weekBannerGap = 1.6;
  const availableH = bottomLimit - startY - weekBannerH - weekBannerGap;
  const gapBlock = 1.9;

  // Natural elastic height calculator for a day card
  const calcDayNaturalH = (rows: Array<{name:string;time:string;role?:string;isFO?:boolean;subtext?:string}>): number => {
    const isOff = rows.length === 0 || rows.every(r => /^off$/i.test(r.time));
    if (isOff) return isSceneMode ? 12.8 : 20.7;
    if (!isSceneMode && rows.length === 1) return 20.7;
    if (rows.length === 1) {
      const hasNight = isNightShift(rows[0].time);
      return hasNight ? 20.5 : 18.6;
    }
    const nightCount = rows.filter(r => isNightShift(r.time)).length;
    const hasNightHdr = nightCount > 0;
    const rowH = 4.4;
    const nightHdrH = hasNightHdr ? 4.3 : 0;
    return Math.max(18.6, 2.6 + rows.length * rowH + nightHdrH);
  };

  interface ColumnSegment {
    weekIndex: number;
    partIndex: number;
    totalParts: number;
    days: string[];
    heights: number[];
  }

  const fitSegmentHeights = (natHeights: number[]): number[] => {
    const n = natHeights.length;
    if (n === 0) return [];
    const totalGaps = (n - 1) * gapBlock;
    const maxCardsH = availableH - totalGaps;
    const sumNat = natHeights.reduce((a, b) => a + b, 0);

    if (sumNat > maxCardsH) {
      const scale = maxCardsH / sumNat;
      return natHeights.map(h => h * scale);
    }
    // Gentle expansion if there's slack so columns feel balanced, capped so small cards don't bloat
    const slack = maxCardsH - sumNat;
    const maxAddPerCard = n >= 6 ? 3.2 : 2.5;
    const addTotal = Math.min(slack, n * maxAddPerCard);
    return natHeights.map(h => h + addTotal / n);
  };

  const segments: ColumnSegment[] = [];

  for (let wIdx = 0; wIdx < weeks.length; wIdx++) {
    const weekDays = weeks[wIdx];
    const fallbackRows = isSceneMode ? [] : [{ name: 'Repos / Congé', time: 'OFF' }];

    if (!isSceneMode) {
      const fixedH = Math.min(22.5, (availableH - 6 * gapBlock) / 7);
      segments.push({
        weekIndex: wIdx,
        partIndex: 1,
        totalParts: 1,
        days: weekDays,
        heights: new Array(7).fill(fixedH),
      });
      continue;
    }

    const natH = weekDays.map(d => calcDayNaturalH(opts.dateMap.get(d) || fallbackRows));
    const weekTotal = natH.reduce((a, b) => a + b, 0) + 6 * gapBlock;

    if (weekTotal <= availableH * 1.04) {
      // All 7 days of the week fit comfortably in 1 column
      segments.push({
        weekIndex: wIdx,
        partIndex: 1,
        totalParts: 1,
        days: weekDays,
        heights: fitSegmentHeights(natH),
      });
    } else {
      // Check if splitting the week into 2 balanced columns works without heavy compression (scale >= 0.86)
      let bestSplit = 4;
      let bestMaxHalf = Infinity;
      for (const s of [3, 4]) {
        const h1 = natH.slice(0, s).reduce((a, b) => a + b, 0) + (s - 1) * gapBlock;
        const h2 = natH.slice(s).reduce((a, b) => a + b, 0) + (7 - s - 1) * gapBlock;
        const m = Math.max(h1, h2);
        if (m < bestMaxHalf) {
          bestMaxHalf = m;
          bestSplit = s;
        }
      }

      if (bestMaxHalf <= availableH / 0.86) {
        const d1 = weekDays.slice(0, bestSplit);
        const h1 = fitSegmentHeights(natH.slice(0, bestSplit));
        const d2 = weekDays.slice(bestSplit);
        const h2 = fitSegmentHeights(natH.slice(bestSplit));
        segments.push({ weekIndex: wIdx, partIndex: 1, totalParts: 2, days: d1, heights: h1 });
        segments.push({ weekIndex: wIdx, partIndex: 2, totalParts: 2, days: d2, heights: h2 });
      } else {
        // Greedy multi-column packing for very dense weeks so rows are never crushed
        const weekParts: Array<{ days: string[]; nat: number[] }> = [];
        let curDays: string[] = [];
        let curNat: number[] = [];
        let curSum = 0;

        for (let i = 0; i < 7; i++) {
          const hNeeded = natH[i] + (curDays.length > 0 ? gapBlock : 0);
          if (curDays.length > 0 && curSum + hNeeded > availableH / 0.90) {
            weekParts.push({ days: curDays, nat: curNat });
            curDays = [weekDays[i]];
            curNat = [natH[i]];
            curSum = natH[i];
          } else {
            curDays.push(weekDays[i]);
            curNat.push(natH[i]);
            curSum += hNeeded;
          }
        }
        if (curDays.length > 0) {
          weekParts.push({ days: curDays, nat: curNat });
        }
        weekParts.forEach((p, idx) => {
          segments.push({
            weekIndex: wIdx,
            partIndex: idx + 1,
            totalParts: weekParts.length,
            days: p.days,
            heights: fitSegmentHeights(p.nat),
          });
        });
      }
    }
  }

  // Render up to 4 columns per page
  const maxColsPerPage = 4;
  const cols = Math.min(maxColsPerPage, Math.max(1, segments.length));

  let colW: number;
  if (cols === 1) {
    colW = 160;
  } else if (cols === 2) {
    colW = 132;
  } else if (cols === 3) {
    colW = (pageW - marginX * 2 - gutter * 2) / 3;
  } else {
    colW = (pageW - marginX * 2 - gutter * (cols - 1)) / cols;
  }

  const totalUsedWidth = cols * colW + (cols - 1) * gutter;
  const baseStartX = (pageW - totalUsedWidth) / 2;

  for (let sIdx = 0; sIdx < segments.length; sIdx++) {
    const colOnPage = sIdx % maxColsPerPage;

    if (sIdx > 0 && colOnPage === 0) {
      drawPremiumFooter(doc, pageW, pageH, marginX);
      doc.addPage();
      startY = drawPremiumHeader(doc, pageW, marginX, 8, opts.title, opts.subtitle + ' (suite)', logo, 'SFX PLANNER', opts.statsBadge);
    }

    const seg = segments[sIdx];
    const x = baseStartX + colOnPage * (colW + gutter);

    // Draw Week Column Header Pill (e.g. "SEMAINE 1 · 25/10 AU 31/10" or "SEMAINE 1 (1/2) · 25/10 AU 28/10")
    const firstD = seg.days[0];
    const lastD = seg.days[seg.days.length - 1];
    const wStartShort = firstD.slice(8, 10) + '/' + firstD.slice(5, 7);
    const wEndShort = lastD.slice(8, 10) + '/' + lastD.slice(5, 7);
    const partSuffix = seg.totalParts > 1 ? ` (${seg.partIndex}/${seg.totalParts})` : '';
    const weekLabel = `SEMAINE ${seg.weekIndex + 1}${partSuffix}  ·  ${wStartShort} AU ${wEndShort}`;

    const bannerSc = opts.themeColorName ? getSceneColor(opts.themeColorName) : null;
    doc.setFillColor(...(bannerSc ? bannerSc.rgbBg : [241, 245, 249] as [number, number, number]));
    doc.setDrawColor(...(bannerSc ? bannerSc.rgbAccent : [203, 213, 225] as [number, number, number]));
    doc.setLineWidth(0.22);
    doc.roundedRect(x, startY, colW, weekBannerH, 1.4, 1.4, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.3);
    doc.setTextColor(...(bannerSc ? bannerSc.rgbText : [51, 65, 85] as [number, number, number]));
    doc.text(weekLabel, x + colW / 2, startY + 3.7, { align: 'center' });

    let currentY = startY + weekBannerH + weekBannerGap;

    for (let dayIdx = 0; dayIdx < seg.days.length; dayIdx++) {
      const d = seg.days[dayIdx];
      const cardH = seg.heights[dayIdx];
      const fallbackRows = isSceneMode ? [] : [{ name: 'Repos / Congé', time: 'OFF' }];
      const rows = opts.dateMap.get(d) || fallbackRows;
      drawIndivDayBlock(doc, x, currentY, colW, cardH, d, rows, opts.themeColorName);
      currentY += cardH + gapBlock;
    }
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
  rawRows: Array<{name:string;time:string;role?:string;isFO?:boolean;subtext?:string}>,
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
    }
  }

  // Sort rows so Day/Show shifts are grouped first, followed by Night shifts
  const rows = [...rawRows].sort((a, b) => {
    const nA = isNightShift(a.time) ? 1 : 0;
    const nB = isNightShift(b.time) ? 1 : 0;
    if (nA !== nB) return nA - nB;
    return 0;
  });

  const isOff = rows.length === 0 || rows.every(r => /^off$/i.test(r.time));
  const firstActiveRow = !isOff ? rows[0] : null;
  const isFOFirst = firstActiveRow ? (firstActiveRow.isFO || isTrainingScene(firstActiveRow.name)) : false;
  const primarySc = !isOff && firstActiveRow ? getSceneColor(themeColorName || firstActiveRow.name) : null;
  const primaryAccent: [number, number, number] = isFOFirst
    ? VIOLET
    : (primarySc ? primarySc.rgbAccent : [203, 213, 225]);
  const primaryBg: [number, number, number] = isFOFirst
    ? [245, 243, 255]
    : (primarySc ? primarySc.rgbBg : [248, 250, 252]);

  // Base card: subtle warm/tinted background on active days, soft slate-50 for OFF
  if (isOff) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
  } else {
    const cardTint: [number, number, number] = [
      Math.round(primaryBg[0] * 0.35 + 255 * 0.65),
      Math.round(primaryBg[1] * 0.35 + 255 * 0.65),
      Math.round(primaryBg[2] * 0.35 + 255 * 0.65),
    ];
    doc.setFillColor(...cardTint);
    doc.setDrawColor(
      Math.round(primaryAccent[0] * 0.35 + 203 * 0.65),
      Math.round(primaryAccent[1] * 0.35 + 213 * 0.65),
      Math.round(primaryAccent[2] * 0.35 + 225 * 0.65)
    );
    doc.setLineWidth(0.25);
  }
  doc.roundedRect(x, y, w, h, 1.8, 1.8, 'FD');

  // Date Calendar Leaf Picto on left (scales gracefully for compact Relâche cards or tall multi-tech cards)
  const pictoW = 12.2;
  const isCompactCard = h < 16.5;
  const pictoH = isCompactCard ? Math.max(10.2, h - 2.0) : Math.min(17.6, h - 2.4);
  const px = x + 1.8;
  const py = h > 26 ? y + 2.2 : y + (h - pictoH) / 2;

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(isOff ? 226 : primaryAccent[0], isOff ? 232 : primaryAccent[1], isOff ? 240 : primaryAccent[2]);
  doc.setLineWidth(isOff ? 0.2 : 0.22);
  doc.roundedRect(px, py, pictoW, pictoH, 1.4, 1.4, 'FD');

  // Top header cap on calendar picto
  const capH = isCompactCard ? 3.3 : 4.3;
  if (isOff) {
    doc.setFillColor(241, 245, 249);
  } else {
    doc.setFillColor(...primaryAccent);
  }
  doc.roundedRect(px, py, pictoW, capH, 1.4, 1.4, 'F');
  doc.rect(px, py + capH - 1.4, pictoW, 1.4, 'F');

  const cx = px + pictoW / 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isCompactCard ? 4.1 : 4.6);
  if (isOff) {
    doc.setTextColor(100, 116, 139);
  } else {
    doc.setTextColor(255, 255, 255);
  }
  doc.text(dayName, cx, py + (isCompactCard ? 2.4 : 3.1), { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isCompactCard ? 8.2 : 10.2);
  doc.setTextColor(isOff ? 148 : 15, isOff ? 163 : 23, isOff ? 184 : 42);
  doc.text(dayNum, cx, py + (isCompactCard ? 7.6 : 10.6), { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isCompactCard ? 3.4 : 3.9);
  doc.setTextColor(100, 116, 139);
  doc.text(monthName, cx, py + (isCompactCard ? 10.2 : 14.5), { align: 'center' });

  // Content area on right
  const rx = px + pictoW + 2.4;

  if (isOff) {
    const isScene = Boolean(themeColorName);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(isCompactCard ? 6.6 : 7.2);
    doc.setTextColor(148, 163, 184);
    doc.text(isScene ? 'Relâche / Aucun service' : 'Repos / Congé', rx, y + h / 2 + 1.0);

    const pillW = 11.5;
    const pillH = isCompactCard ? 4.2 : 4.8;
    const pillX = x + w - pillW - 2.2;
    const pillY = y + (h - pillH) / 2;
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.roundedRect(pillX, pillY, pillW, pillH, 1.0, 1.0, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.8);
    doc.setTextColor(148, 163, 184);
    doc.text(isScene ? '—' : 'OFF', pillX + pillW / 2, pillY + pillH * 0.70, { align: 'center' });
    return;
  }

  // Working day
  const rowCount = rows.length;

  if (rowCount === 1) {
    const row = rows[0];
    const isFO = row.isFO || isTrainingScene(row.name);
    const isNight = isNightShift(row.time);
    const sc = getSceneColor(themeColorName || row.name);
    const scBg: [number, number, number] = isFO ? [245, 243, 255] : (isNight ? NIGHT_PILL_BG : sc.rgbBg);
    const scAccent: [number, number, number] = isFO ? VIOLET : (isNight ? NIGHT_PILL_BORDER : sc.rgbAccent);
    const scText: [number, number, number] = isFO ? [76, 29, 149] : (isNight ? [255, 255, 255] : sc.rgbText);
    const cleanTime = (row.time || '').replace(/\s*-\s*/, ' - ');

    const rawNm = cleanText(cleanSceneName(row.name));
    let mainName = rawNm;
    let roleStr = row.role || '';
    const matchRole = rawNm.match(/^(.*?)\s*\((.*?)\)$/);
    if (matchRole) {
      mainName = matchRole[1].trim();
      if (!roleStr) roleStr = cleanRoleLabel(matchRole[2].trim());
    }
    const subStr = row.subtext || '';

    // Time pill top right (or vertically centered if single line)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.6);
    const tw = doc.getTextWidth(cleanTime);
    const pillW = tw + 4.0;
    const pillH = 5.0;
    const pillX = x + w - pillW - 2.0;
    const hasSecondLine = Boolean(roleStr || subStr || isNight);
    const pillY = hasSecondLine ? y + 3.0 : y + (h - pillH) / 2;

    doc.setFillColor(...scBg);
    doc.setDrawColor(...scAccent);
    doc.setLineWidth(0.25);
    doc.roundedRect(pillX, pillY, pillW, pillH, 1.1, 1.1, 'FD');
    doc.setTextColor(...scText);
    doc.text(cleanTime, pillX + pillW / 2, pillY + 3.55, { align: 'center' });

    // Main title (Scene name in Employee PDF, or Technician name in Scene PDF)
    const maxSceneW = pillX - rx - 1.5;
    let fontSize = 8.2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize);
    doc.setTextColor(15, 23, 42);

    while (fontSize > 6.4 && doc.getTextWidth(mainName) > maxSceneW) {
      fontSize -= 0.3;
      doc.setFontSize(fontSize);
    }
    let dispScene = mainName;
    if (doc.getTextWidth(dispScene) > maxSceneW) {
      while (dispScene.length > 0 && doc.getTextWidth(dispScene + '…') > maxSceneW) {
        dispScene = dispScene.slice(0, -1);
      }
      dispScene = dispScene.trim() + '…';
    }
    doc.text(dispScene, rx, hasSecondLine ? y + 6.8 : y + h / 2 + 1.5);

    // Second line: Night badge + Role badge + optional subtext
    if (hasSecondLine) {
      let curSubX = rx;
      const subY = y + 12.6;
      if (isNight) {
        const nLabel = 'NUIT';
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.0);
        const nw = doc.getTextWidth(nLabel) + 5.6;
        const nh = 3.7;
        doc.setFillColor(...NIGHT_PILL_BG);
        doc.setDrawColor(...NIGHT_PILL_BORDER);
        doc.setLineWidth(0.18);
        doc.roundedRect(curSubX, subY - 2.7, nw, nh, 0.8, 0.8, 'FD');
        drawMoonIcon(doc, curSubX + 1.9, subY - 2.7 + nh / 2, 0.85, NIGHT_PILL_BG);
        doc.setTextColor(255, 255, 255);
        doc.text(nLabel, curSubX + 3.5, subY - 0.1);
        curSubX += nw + 1.4;
      }
      if (roleStr) {
        const cleanR = cleanRoleLabel(roleStr);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.4);
        const rw = doc.getTextWidth(cleanR) + 3.0;
        const rh = 3.7;
        const rc = getPdfRoleColors(cleanR);
        doc.setFillColor(...rc.bg);
        doc.setDrawColor(...rc.border);
        doc.setLineWidth(0.18);
        doc.roundedRect(curSubX, subY - 2.7, rw, rh, 0.8, 0.8, 'FD');
        doc.setTextColor(...rc.text);
        doc.text(cleanR, curSubX + rw / 2, subY - 0.1, { align: 'center' });
        curSubX += rw + 1.6;
      }
      if (subStr) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5.4);
        doc.setTextColor(100, 116, 139);
        const availSubW = (x + w - 2.0) - curSubX;
        let dispSub = subStr;
        if (doc.getTextWidth(dispSub) > availSubW) {
          while (dispSub.length > 0 && doc.getTextWidth(dispSub + '…') > availSubW) {
            dispSub = dispSub.slice(0, -1);
          }
          dispSub = dispSub.trim() + '…';
        }
        doc.text(dispSub, curSubX, subY);
      }
    }
  } else {
    // 2 or more rows inside the day card (with automatic ÉQUIPE DE NUIT visual separation)
    const nightCount = rows.filter(r => isNightShift(r.time)).length;
    const hasNightHdr = nightCount > 0;
    const padY = 1.1;
    const innerH = h - padY * 2;
    const nightHdrUnits = hasNightHdr ? 0.95 : 0;
    const unitH = innerH / (rowCount + nightHdrUnits);
    const rH = unitH;
    const nightHdrH = hasNightHdr ? unitH * 0.95 : 0;

    let curRowY = y + padY;
    let nightSectionDrawn = false;

    for (let idx = 0; idx < rowCount; idx++) {
      const row = rows[idx];
      const isNight = isNightShift(row.time);
      const isFO = row.isFO || isTrainingScene(row.name);
      const sc = getSceneColor(themeColorName || row.name);

      // Draw Night Section background container + header right before the first Night row
      if (isNight && !nightSectionDrawn) {
        nightSectionDrawn = true;
        const nightBoxY = curRowY;
        const nightBoxH = (y + h - padY) - nightBoxY + 0.3;
        const nightBoxX = rx - 1.2;
        const nightBoxW = (x + w - 1.0) - nightBoxX;

        doc.setFillColor(...NIGHT_BG);
        doc.setDrawColor(...NIGHT_BORDER);
        doc.setLineWidth(0.2);
        doc.roundedRect(nightBoxX, nightBoxY, nightBoxW, nightBoxH, 1.2, 1.2, 'FD');

        drawNightSectionHeader(doc, rx - 0.2, curRowY + 0.2, (x + w - 2.0) - (rx - 0.2), nightCount, true);
        curRowY += nightHdrH;
      }

      const rowY = curRowY;
      const rowMidY = rowY + rH / 2;
      const cleanTime = (row.time || '').replace(/\s*-\s*/, ' - ');

      const scBg: [number, number, number] = isFO ? [245, 243, 255] : (isNight ? NIGHT_PILL_BG : sc.rgbBg);
      const scAccent: [number, number, number] = isFO ? VIOLET : (isNight ? NIGHT_PILL_BORDER : sc.rgbAccent);
      const scText: [number, number, number] = isFO ? [76, 29, 149] : (isNight ? [255, 255, 255] : sc.rgbText);

      // Time pill
      const timeFont = rH >= 4.2 ? 5.6 : 5.1;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(timeFont);
      const tw = doc.getTextWidth(cleanTime);
      const pillW = tw + (rH >= 4.2 ? 3.2 : 2.6);
      const pillH = Math.min(3.8, Math.max(3.1, rH - 0.7));
      const pillX = x + w - pillW - 1.8;
      const pillY = rowMidY - pillH / 2;

      doc.setFillColor(...scBg);
      doc.setDrawColor(...scAccent);
      doc.setLineWidth(0.2);
      doc.roundedRect(pillX, pillY, pillW, pillH, 0.8, 0.8, 'FD');
      doc.setTextColor(...scText);
      doc.text(cleanTime, pillX + pillW / 2, pillY + pillH * 0.71, { align: 'center' });

      // Role pill next to time pill
      let rightEdge = pillX - 1.1;
      const rawNm = cleanText(cleanSceneName(row.name));
      let mainName = rawNm.replace(/\s*\([^)]*\).*$/, '').replace(/\s*\[[^\]]*\].*$/, '').trim();
      let roleStr = row.role || '';
      const matchRole = rawNm.match(/\((.*?)\)/);
      if (matchRole && !roleStr) roleStr = matchRole[1];

      if (roleStr && rH >= 3.4) {
        const cleanR = cleanRoleLabel(roleStr);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(rH >= 4.2 ? 4.7 : 4.3);
        const rw = doc.getTextWidth(cleanR) + 2.2;
        const rh = Math.min(3.3, Math.max(2.7, rH - 0.9));
        const rxRole = rightEdge - rw;
        if (rxRole - rx > 19) {
          const rc = getPdfRoleColors(cleanR);
          doc.setFillColor(...rc.bg);
          doc.setDrawColor(...rc.border);
          doc.setLineWidth(0.15);
          doc.roundedRect(rxRole, rowMidY - rh / 2, rw, rh, 0.7, 0.7, 'FD');
          doc.setTextColor(...rc.text);
          doc.text(cleanR, rxRole + rw / 2, rowMidY + rh * 0.25, { align: 'center' });
          rightEdge = rxRole - 1.0;
        }
      }

      const maxSceneW = rightEdge - rx;
      let fontSize = rH >= 4.2 ? 6.5 : 5.8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(fontSize);
      doc.setTextColor(15, 23, 42);

      while (fontSize > 4.6 && doc.getTextWidth(mainName) > maxSceneW) {
        fontSize -= 0.25;
        doc.setFontSize(fontSize);
      }
      let dispScene = mainName;
      if (doc.getTextWidth(dispScene) > maxSceneW) {
        while (dispScene.length > 0 && doc.getTextWidth(dispScene + '…') > maxSceneW) {
          dispScene = dispScene.slice(0, -1);
        }
        dispScene = dispScene.trim() + '…';
      }
      doc.text(dispScene, rx, rowMidY + 0.95);

      const nextIsNightStart = idx + 1 < rowCount && !isNight && isNightShift(rows[idx + 1].time);
      if (idx < rowCount - 1 && !nextIsNightStart) {
        doc.setDrawColor(isNight ? 209 : 226, isNight ? 218 : 232, isNight ? 245 : 240);
        doc.setLineWidth(0.15);
        doc.line(rx, rowY + rH, x + w - 2, rowY + rH);
      }

      curRowY += rH;
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

  const dateMap = new Map<string, Array<{name:string;time:string;role?:string;isFO?:boolean;subtext?:string}>>();
  for (const r of sceneRecs) {
    if (!dateMap.has(r.date)) dateMap.set(r.date, []);
    const displayName = prettyName(r.employee);
    let roleLabel = r.role ? cleanRoleLabel(r.role) : '';
    let subtext = '';
    
    if (isFOExport) {
      if (r.scene.toLowerCase() !== 'formation' && r.scene.toLowerCase() !== 'fo') {
        const detail = r.scene.replace(/^(formation|fo)\s*(-\s*)?/i, '').trim();
        if (detail) roleLabel = detail;
      }
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
    dateMap.get(r.date)!.push({
      name: displayName,
      time: r.time,
      role: roleLabel,
      isFO: isTrainingScene(r.scene),
      subtext
    });
  }

  const allDatesTotal = Array.from(new Set(records.map(r=>r.date).filter(Boolean))).sort();
  for (const d of allDatesTotal) {
    if (!dateMap.has(d)) dateMap.set(d, []);
  }
  const pStart = allDatesTotal[0] ? fmtDate(allDatesTotal[0]) : '';
  const pEnd   = allDatesTotal[allDatesTotal.length-1] ? fmtDate(allDatesTotal[allDatesTotal.length-1]) : '';
  const period = pStart && pEnd && pStart !== pEnd ? `${pStart} — ${pEnd}` : pStart;
  const numWeeks = Math.ceil(allDatesTotal.length / 7);
  const activeDays = Array.from(dateMap.entries()).filter(([, rows]) => rows.length > 0).length;

  for (const d of allDatesTotal) {
    dateMap.get(d)!.sort((a, b) => {
      const rA = parseRange(a.time);
      const rB = parseRange(b.time);
      if (rA && rB && rA.start !== rB.start) return rA.start - rB.start;
      return a.name.localeCompare(b.name, 'fr');
    });
  }

  await generateIndivPdf({
    title: cleanText(cleanSceneName(scene)).toUpperCase(),
    subtitle: period ? `Planning de scène · ${period}` : 'Planning de scène',
    statsBadge: `${sceneRecs.length} SERVICES · ${activeDays}/${allDatesTotal.length} JOURS · ${numWeeks} SEM.`,
    dateMap,
    allDates: allDatesTotal,
    filename: `sfx-planning-scene-${slug(scene)}.pdf`,
    themeColorName: scene, // Force scene color for all cards
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
  if (s.length > 8) s = s.substring(0, 8);
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
      const fTime = Math.max(5, Math.min(6.4, rowH * 0.72));
      const fScene = Math.max(4, Math.min(5.8, rowH * 0.65));
      const fOff = Math.max(5, Math.min(7.5, rowH * 0.8));
      const badgeW = 14.2;

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
              const leftBadgeW = 9.2;
              const rightBadgeW = 5.0;
              const totalBadgeW = leftBadgeW + rightBadgeW; // 14.2mm
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
              const timeCenterX = dx + 0.6 + badgeW + 0.4 + (colDayW - badgeW - 1.4) / 2;
              doc.text(amplitudeStr, timeCenterX, y + rowH/2 + 1.2, {align: 'center'});
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
