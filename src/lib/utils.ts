

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

/**
 * Mappage des scènes / codes techniques du planning vers les véritables
 * spectacles & lieux Disney (ex: matm -> Mickey et le Magicien, dfact -> Dream Factory, etc.)
 */
export function getSceneShowLabel(scene: string): string | null {
  if (!scene) return null;
  const s = cleanSceneName(scene).toLowerCase();

  // Support / Pool technique
  if (s.includes('pooltechn') || s.includes('pool techn') || s.includes('support')) {
    return 'Support Technique';
  }
  // Mickey et le Magicien (MATM / Animagique Theater)
  if (s.includes('matm') || s.includes('magicien') || s.includes('animagique')) {
    return 'Mickey et le Magicien';
  }
  // Disney Junior Dream Factory / La Fabrique des Rêves (DFACT / Studio D)
  if (s.includes('dfact') || s.includes('dream factory') || s.includes('fabrique')) {
    return 'Dream Factory (Minnie)';
  }
  // Disney Tales of Magic / Illuminations (Château)
  if (s.includes('illumination') || s.includes('tales of magic') || s.includes('castle')) {
    return 'Disney Tales of Magic';
  }
  // Disney Cascade of Lights (Lac Adventure Way)
  if (s.includes('cascade')) {
    return 'Cascade of Lights';
  }
  // Le Roi Lion (Frontierland Theater)
  if (s.includes('lionking') || s.includes('roi lion') || s.includes('frontierland')) {
    return 'Le Roi Lion';
  }
  // TOGETHER : Une Aventure Musicale Pixar (Studio Theater)
  if (s.includes('together') || s.includes('studiotsh')) {
    return 'Together Pixar';
  }
  // Reine des Neiges (Arendelle / Animation Celebration)
  if (s.includes('arendelle') || s.includes('frozen') || s.includes('neiges')) {
    return 'La Reine des Neiges';
  }
  // Avengers Campus / Marvel
  if (s.includes('marvel') || s.includes('avengers')) {
    return 'Avengers Campus';
  }
  // Videopolis
  if (s.includes('videopolis')) {
    return 'Vidéopolis';
  }

  return null;
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

  let hue: number;
  if (lower.includes('arendelle')) {
    hue = 230; // Blue
  } else if (lower.includes('cascade')) {
    hue = 25;  // Deep Orange
  } else if (lower.includes('castle')) {
    hue = 150; // Emerald Green
  } else if (lower.includes('dfact') || lower.includes('fact')) {
    hue = 310; // Pink
  } else if (lower.includes('illumination')) {
    hue = 350; // Red
  } else if (isTrainingScene(s) || lower.includes('formation') || lower === 'fo') {
    hue = 270; // Purple
  } else if (lower.includes('marvel')) {
    hue = 190; // Cyan
  } else if (lower.includes('matmops')) {
    hue = 60;  // Pure Yellow / Chartreuse Lime
  } else if (lower.includes('pooltechn')) {
    hue = 10;  // Rust Red
  } else if (lower.includes('studiotsh')) {
    hue = 100; // Bright Green
  } else if (lower.includes('lionking')) {
    hue = 40;  // Gold
  } else if (lower.includes('videopolis')) {
    hue = 210; // Azure
  } else if (lower.includes('regie')) {
    hue = 285; // Indigo
  } else if (lower.includes('star') || lower.includes('tour')) {
    hue = 175; // Teal
  } else {
    // High dispersion deterministic hash for any generated scene
    let hash = 0;
    for (let i = 0; i < lower.length; i++) {
      hash = lower.charCodeAt(i) + ((hash << 5) - hash);
    }
    // Mix the hash to avoid prefix clustering (e.g. all "ENT " scenes)
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    hash = (hash ^ (hash >>> 16)) >>> 0;
    hue = hash % 360;
  }

  const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
    s /= 100;
    l /= 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [
      Math.round(255 * f(0)),
      Math.round(255 * f(8)),
      Math.round(255 * f(4))
    ];
  };

  const rgbBg = hslToRgb(hue, 85, 94);
  const rgbText = hslToRgb(hue, 85, 22);
  const rgbAccent = hslToRgb(hue, 70, 45);

  return {
    bg: `hsl(${hue}, 85%, 94%)`,
    text: `hsl(${hue}, 85%, 22%)`,
    accent: `hsl(${hue}, 70%, 45%)`,
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

