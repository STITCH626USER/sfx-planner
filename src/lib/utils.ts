

export function parseTimeToMinutes(hStr: string): number | null {
  const m = hStr.trim().match(/^(\d{2})[h:](\d{2})$/i) || hStr.trim().match(/^(\d{2})(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function parseRange(timeStr: string): { start: number; end: number } | null {
  const parts = timeStr.split('-');
  if (parts.length !== 2) return null;
  const start = parseTimeToMinutes(parts[0]);
  const end = parseTimeToMinutes(parts[1]);
  if (start === null || end === null) return null;
  return { start, end };
}

export interface ShiftLiveStatus {
  state: 'upcoming' | 'live' | 'finished';
  progress: number; // 0 to 100
  label: string;
  timeRemaining?: string;
}

export function getShiftLiveStatus(timeStr: string, refDate?: Date): ShiftLiveStatus | null {
  const range = parseRange(timeStr);
  if (!range) return null;

  const now = refDate || new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  let { start, end } = range;
  // Handle overnight shift (e.g. 15:00 - 01:00)
  if (end < start) {
    end += 24 * 60;
  }

  let effectiveCurrent = currentMinutes;
  // If overnight and we are past midnight (e.g. 00:30 when shift is 16:00 - 02:00)
  if (range.end < range.start && currentMinutes < range.start && currentMinutes <= range.end) {
    effectiveCurrent += 24 * 60;
  }

  if (effectiveCurrent < start) {
    const diff = start - effectiveCurrent;
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    const label = hours > 0 ? `Débute dans ${hours}h${mins > 0 ? (mins < 10 ? '0' : '') + mins : ''}` : `Débute dans ${mins}min`;
    return {
      state: 'upcoming',
      progress: 0,
      label,
      timeRemaining: label
    };
  }

  if (effectiveCurrent >= start && effectiveCurrent <= end) {
    const total = end - start;
    const elapsed = effectiveCurrent - start;
    const progress = total > 0 ? Math.min(100, Math.max(0, Math.round((elapsed / total) * 100))) : 100;
    const remaining = end - effectiveCurrent;
    const remH = Math.floor(remaining / 60);
    const remM = remaining % 60;
    const remStr = remH > 0 ? `${remH}h${remM > 0 ? (remM < 10 ? '0' : '') + remM : ''}` : `${remM}m`;
    return {
      state: 'live',
      progress,
      label: `CUE EN COURS · ${progress}%`,
      timeRemaining: `Fin dans ${remStr}`
    };
  }

  return {
    state: 'finished',
    progress: 100,
    label: 'CUE TERMINÉ'
  };
}


export function timesMatch(t1: string, t2: string, tolerance = 3): boolean {
  const r1 = parseRange(t1);
  const r2 = parseRange(t2);
  if (!r1 || !r2) return false;
  return Math.abs(r1.start - r2.start) <= tolerance && Math.abs(r1.end - r2.end) <= tolerance;
}

export function isTrainingScene(scene: string): boolean {
  if (!scene) return false;
  const s = scene.toLowerCase().trim();
  return s.includes('formation') || s.includes('fomation') || s.startsWith('fo ') || s === 'fo';
}

export function cleanSceneName(scene: string): string {
  if (!scene) return '';
  let s = scene.trim();
  s = s.replace(/^ENT\s+/i, '');
  s = s.replace(/^ENT(?=[A-Z])/i, '');
  s = s.replace(/^[-_\s]+|[-_\s]+$/g, '').trim();
  return s || scene;
}

const KNOWN_FIRST_NAMES = new Set([
  'alexandre', 'anne sophie', 'anne-sophie', 'antoine', 'armand', 'arnaud',
  'arthur', 'aurelien', 'aurélien', 'balthazar', 'cedric', 'cédric', 'cedrick',
  'cédrick', 'christian', 'christophe', 'clement', 'clément', 'corentin',
  'damien', 'didier', 'dorian', 'erwan', 'florian', 'gabriel', 'gregory',
  'grégory', 'hugo', 'jean marc', 'jean-marc', 'jeremy', 'jérémy', 'joevin',
  'joévin', 'jonathan', 'jordan', 'julie', 'kevin', 'kévin', 'klervie',
  'laura', 'lena shaines', 'léna shaines', 'lena-shaines', 'lola', 'louis',
  'lucas', 'lucas remy georges', 'marion', 'mathieu', 'matthieu', 'maxence',
  'maxime', 'maximilien', 'mikael', 'mikaël', 'mohamed', 'mohamed amine',
  'morgane', 'nadia', 'naym', 'noemi', 'noémi', 'paul', 'pauline', 'robin',
  'sebastien', 'sébastien', 'simon', 'thibault', 'thomas', 'tom', 'viktor',
  'vivien', 'yann'
]);

export function titleCaseWord(w: string): string {
  if (!w) return w;
  return w
    .split(/([-'])/)
    .map(part => /^[-']$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

export function titleCasePart(s: string): string {
  return s.trim().split(/\s+/).map(titleCaseWord).join(' ');
}

export function formatEmployeeName(raw: string): string {
  const s = (raw || '').replace(/\s*\(\*\)\s*$/, '').trim();
  const idx = s.indexOf(',');
  if (idx === -1) {
    return s;
  }
  const p0 = s.slice(0, idx).trim();
  const p1 = s.slice(idx + 1).trim();
  if (!p0 && !p1) return s;
  if (!p0) return p1.toUpperCase();
  if (!p1) return p0.toUpperCase();

  const p0Lower = p0.toLowerCase();
  const p1Lower = p1.toLowerCase();

  let nom = '';
  let prenom = '';

  // If p1 is a known first name (like in "AIRIAU, CEDRICK" on appendix pages)
  if (KNOWN_FIRST_NAMES.has(p1Lower) || Array.from(KNOWN_FIRST_NAMES).some(fn => p1Lower.startsWith(fn + ' '))) {
    nom = p0;
    prenom = p1;
  } else if (KNOWN_FIRST_NAMES.has(p0Lower) || Array.from(KNOWN_FIRST_NAMES).some(fn => p0Lower.startsWith(fn + ' '))) {
    prenom = p0;
    nom = p1;
  } else {
    // Default for new WFM Chronos: "PRENOM, NOM" (e.g. "ALEXANDRE, CALMETTE", "ANTOINE, LE SOMMER")
    prenom = p0;
    nom = p1;
  }

  const nomUpper = nom.toUpperCase();
  const prenomTitle = titleCasePart(prenom);
  return `${nomUpper} ${prenomTitle}`;
}

export function prettyName(s: string): string {
  if (!s) return '';
  return formatEmployeeName(s);
}

export function dayInitials(name: string): string {
  const pretty = prettyName(name);
  const parts = pretty.replace(/[(*)]/g, '').split(/[, ]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function getAvatarColor(name: string): { bg: string; fg: string; border: string } {
  const clean = (name || '').toLowerCase().trim();
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = clean.charCodeAt(i) + ((hash << 5) - hash);
  }
  hash = Math.abs(hash);

  const palettes = [
    { bg: 'rgba(56, 189, 248, 0.16)', fg: '#38bdf8', border: 'rgba(56, 189, 248, 0.35)' }, // Sky Cyan
    { bg: 'rgba(168, 85, 247, 0.16)', fg: '#c084fc', border: 'rgba(168, 85, 247, 0.35)' }, // Purple
    { bg: 'rgba(251, 146, 60, 0.16)', fg: '#fb923c', border: 'rgba(251, 146, 60, 0.35)' }, // Orange
    { bg: 'rgba(52, 211, 153, 0.16)', fg: '#34d399', border: 'rgba(52, 211, 153, 0.35)' }, // Emerald
    { bg: 'rgba(244, 114, 182, 0.16)', fg: '#f472b6', border: 'rgba(244, 114, 182, 0.35)' }, // Pink Rose
    { bg: 'rgba(250, 204, 21, 0.16)', fg: '#facc15', border: 'rgba(250, 204, 21, 0.35)' }, // Amber Yellow
    { bg: 'rgba(129, 140, 248, 0.16)', fg: '#818cf8', border: 'rgba(129, 140, 248, 0.35)' }, // Indigo Blue
    { bg: 'rgba(45, 212, 191, 0.16)', fg: '#2dd4bf', border: 'rgba(45, 212, 191, 0.35)' }, // Teal
  ];

  return palettes[hash % palettes.length];
}



export interface SceneColor {
  bg: string;
  text: string;
  accent: string;
  rgbBg: [number, number, number];
  rgbText: [number, number, number];
  rgbAccent: [number, number, number];
}

export function getSceneColor(scene: string): SceneColor {
  if (!scene || scene === '—') {
    return {
      bg: '#ffffff',
      text: '#475569',
      accent: '#94a3b8',
      rgbBg: [255, 255, 255],
      rgbText: [71, 85, 105],
      rgbAccent: [148, 163, 184]
    };
  }

  // Strip prefixes, parenthesized roles, and bracketed shifts for consistent hashing & lookup
  let s = cleanSceneName(scene).trim();
  s = s.replace(/\s*\([^)]*\).*$/, '').replace(/\s*\[[^\]]*\].*$/, '').trim();
  const lower = s.toLowerCase();

  if (lower.includes('repos') || lower.includes('congé') || lower === 'off') {
    return {
      bg: '#f8fafc',
      text: '#475569',
      accent: '#94a3b8',
      rgbBg: [248, 250, 252],
      rgbText: [100, 116, 139],
      rgbAccent: [148, 163, 184]
    };
  }

  // Colorblind-friendly (Okabe-Ito / Paul Tol inspired) distinct palettes
  // Avoids red/green/brown ambiguity by varying luminance, blue/yellow axis, and saturation
  interface PaletteEntry {
    rgbAccent: [number, number, number];
    rgbBg: [number, number, number];
    rgbText: [number, number, number];
  }

  const CB_PALETTES: Record<string, PaletteEntry> = {
    arendelle:    { rgbAccent: [0, 114, 178],   rgbBg: [232, 244, 252], rgbText: [10, 62, 102] },   // Cobalt Blue
    cascade:      { rgbAccent: [230, 126, 0],   rgbBg: [255, 244, 230], rgbText: [130, 65, 0] },    // Bright Amber-Orange
    castle:       { rgbAccent: [0, 158, 115],   rgbBg: [230, 249, 243], rgbText: [0, 88, 64] },     // Bluish-Green (Teal Emerald)
    dfact:        { rgbAccent: [204, 68, 153],  rgbBg: [252, 237, 247], rgbText: [118, 30, 86] },   // Reddish Purple / Magenta
    illumination: { rgbAccent: [213, 48, 32],   rgbBg: [254, 236, 234], rgbText: [125, 22, 12] },   // Crimson Vermilion
    formation:    { rgbAccent: [124, 58, 237],  rgbBg: [243, 236, 254], rgbText: [76, 29, 149] },   // Deep Royal Violet
    marvel:       { rgbAccent: [14, 148, 210],  rgbBg: [232, 247, 254], rgbText: [12, 74, 110] },   // Sky Cyan
    matmops:      { rgbAccent: [184, 134, 11],  rgbBg: [254, 249, 226], rgbText: [104, 72, 4] },    // Ochre Gold
    pooltechn:    { rgbAccent: [51, 65, 149],   rgbBg: [236, 239, 252], rgbText: [30, 41, 99] },    // Deep Navy Indigo
    studiotsh:    { rgbAccent: [13, 148, 136],  rgbBg: [230, 250, 248], rgbText: [15, 82, 76] },    // Dark Turquoise
    lionking:     { rgbAccent: [194, 65, 12],   rgbBg: [255, 239, 230], rgbText: [116, 36, 8] },    // Terracotta Copper
    videopolis:   { rgbAccent: [79, 70, 229],   rgbBg: [238, 238, 254], rgbText: [49, 46, 129] },   // Electric Ultramarine
    halloween:    { rgbAccent: [162, 28, 175],  rgbBg: [250, 235, 252], rgbText: [98, 16, 107] },   // Plum Fuchsia
    regie:        { rgbAccent: [109, 40, 217],  rgbBg: [241, 234, 254], rgbText: [67, 20, 138] },   // Purple Indigo
    star:         { rgbAccent: [2, 132, 199],   rgbBg: [230, 244, 254], rgbText: [7, 89, 133] },    // Cerulean
  };

  let chosen: PaletteEntry | null = null;
  if (lower.includes('arendelle')) chosen = CB_PALETTES.arendelle;
  else if (lower.includes('cascade')) chosen = CB_PALETTES.cascade;
  else if (lower.includes('castle')) chosen = CB_PALETTES.castle;
  else if (lower.includes('dfact') || lower.includes('fact')) chosen = CB_PALETTES.dfact;
  else if (lower.includes('illumination')) chosen = CB_PALETTES.illumination;
  else if (isTrainingScene(s) || lower.includes('formation') || lower === 'fo') chosen = CB_PALETTES.formation;
  else if (lower.includes('marvel')) chosen = CB_PALETTES.marvel;
  else if (lower.includes('matmops')) chosen = CB_PALETTES.matmops;
  else if (lower.includes('pooltechn')) chosen = CB_PALETTES.pooltechn;
  else if (lower.includes('studiotsh')) chosen = CB_PALETTES.studiotsh;
  else if (lower.includes('lionking')) chosen = CB_PALETTES.lionking;
  else if (lower.includes('videopolis')) chosen = CB_PALETTES.videopolis;
  else if (lower.includes('halloween')) chosen = CB_PALETTES.halloween;
  else if (lower.includes('regie')) chosen = CB_PALETTES.regie;
  else if (lower.includes('star') || lower.includes('tour')) chosen = CB_PALETTES.star;

  if (!chosen) {
    const fallbackList = Object.values(CB_PALETTES);
    let hash = 0;
    for (let i = 0; i < lower.length; i++) {
      hash = lower.charCodeAt(i) + ((hash << 5) - hash);
    }
    hash = Math.abs(hash);
    chosen = fallbackList[hash % fallbackList.length];
  }

  const { rgbBg, rgbText, rgbAccent } = chosen;
  const toHex = (c: [number, number, number]) =>
    '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');

  return {
    bg: toHex(rgbBg),
    text: toHex(rgbText),
    accent: toHex(rgbAccent),
    rgbBg,
    rgbText,
    rgbAccent
  };
}

export function cleanRoleLabel(role: string): string {
  if (!role) return '';
  const r = role.trim();
  if (r.toLowerCase() === 'tech sfx') return 'Tech';
  if (/^tech\s+sfx\s+/i.test(r)) {
    return r.replace(/^tech\s+sfx\s+/i, '').trim();
  }
  if (/^tech\s+(secu|ponton|bassin)/i.test(r)) {
    return r.replace(/^tech\s+/i, '').trim();
  }
  if (/^asstcoordinateur$/i.test(r)) return 'Asst Coord';
  return r;
}

export function getRoleBadgeStyle(role: string): { bg: string; color: string; border: string } {
  const r = (role || '').toLowerCase();
  if (r.includes('regie')) {
    return { bg: 'rgba(245, 158, 11, 0.16)', color: '#fbbf24', border: 'rgba(245, 158, 11, 0.4)' }; // Amber gold
  }
  if (r.includes('coord') || r.includes('lead')) {
    return { bg: 'rgba(244, 63, 94, 0.16)', color: '#fb7185', border: 'rgba(244, 63, 94, 0.4)' }; // Rose Coral
  }
  if (r.includes('secu') || r.includes('ponton') || r.includes('bassin')) {
    return { bg: 'rgba(20, 184, 166, 0.16)', color: '#2dd4bf', border: 'rgba(20, 184, 166, 0.4)' }; // Teal / Cyan
  }
  if (r.includes('maint') || r.includes('matmops')) {
    return { bg: 'rgba(168, 85, 247, 0.16)', color: '#c084fc', border: 'rgba(168, 85, 247, 0.4)' }; // Purple
  }
  return { bg: 'rgba(56, 189, 248, 0.10)', color: '#7dd3fc', border: 'rgba(56, 189, 248, 0.25)' };
}

