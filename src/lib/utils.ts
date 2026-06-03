import type { PlanningRecord } from './parsePdf';

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

export function timesMatch(t1: string, t2: string, tolerance = 3): boolean {
  const r1 = parseRange(t1);
  const r2 = parseRange(t2);
  if (!r1 || !r2) return false;
  return Math.abs(r1.start - r2.start) <= tolerance && Math.abs(r1.end - r2.end) <= tolerance;
}

export function isTrainingScene(scene: string): boolean {
  if (!scene) return false;
  const s = scene.toLowerCase().trim();
  return s === 'fo' || s === 'formation';
}

export function getFOAssociations(dayRecords: PlanningRecord[]): Map<string, string[]> {
  const associations = new Map<string, string[]>();
  const activeRecs = dayRecords.filter(r => r.time !== 'OFF');
  const foRecs = activeRecs.filter(r => isTrainingScene(r.scene));
  const regRecs = activeRecs.filter(r => !isTrainingScene(r.scene));

  for (const fo of foRecs) {
    const matchedScenes = new Set<string>();
    for (const reg of regRecs) {
      if (reg.scene && reg.scene !== '—' && timesMatch(fo.time, reg.time, 3)) {
        matchedScenes.add(reg.scene);
      }
    }
    if (matchedScenes.size > 0) {
      associations.set(fo.employee, Array.from(matchedScenes).sort((a, b) => a.localeCompare(b, 'fr')));
    }
  }
  return associations;
}

export function getFOAssociationKey(date: string, employee: string): string {
  return `${date}_${employee}`;
}

export function computeAllFOAssociations(records: PlanningRecord[]): Map<string, string[]> {
  const associations = new Map<string, string[]>();
  const byDate = new Map<string, PlanningRecord[]>();
  
  for (const r of records) {
    if (!r.date) continue;
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }

  for (const [date, dayRecs] of byDate.entries()) {
    const dayAssoc = getFOAssociations(dayRecs);
    for (const [employee, scenes] of dayAssoc.entries()) {
      associations.set(getFOAssociationKey(date, employee), scenes);
    }
  }
  return associations;
}

export interface SceneColor {
  bg: string;
  text: string;
  accent: string;
  rgbBg: [number, number, number];
  rgbText: [number, number, number];
}

export function getSceneColor(scene: string): SceneColor {
  if (!scene || scene === '—') {
    return {
      bg: '#ffffff',
      text: '#475569',
      accent: '#94a3b8',
      rgbBg: [255, 255, 255],
      rgbText: [71, 85, 105]
    };
  }

  const s = scene.trim();
  const lower = s.toLowerCase();
  
  let hue = 0;
  if (lower.includes('arendelle')) {
    hue = 200; // Blue
  } else if (lower.includes('cascade')) {
    hue = 35;  // Amber
  } else if (lower.includes('castle')) {
    hue = 150; // Emerald/Green
  } else if (lower.includes('dfact') || lower.includes('fact')) {
    hue = 260; // Indigo/Purple
  } else if (lower.includes('illumination')) {
    hue = 340; // Rose
  } else if (lower.includes('fo') || lower.includes('formation')) {
    hue = 280; // Violet
  } else if (lower.includes('repos') || lower.includes('congé') || lower === 'off') {
    return {
      bg: '#f8fafc',
      text: '#475569',
      accent: '#94a3b8',
      rgbBg: [248, 250, 252],
      rgbText: [100, 116, 139]
    };
  } else {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = s.charCodeAt(i) + ((hash << 5) - hash);
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

  return {
    bg: `hsl(${hue}, 85%, 94%)`,
    text: `hsl(${hue}, 85%, 22%)`,
    accent: `hsl(${hue}, 70%, 45%)`,
    rgbBg,
    rgbText
  };
}
