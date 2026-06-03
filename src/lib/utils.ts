

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
  return s.includes('formation') || s.includes('fomation') || s.startsWith('fo ') || s === 'fo';
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

  const s = scene.trim();
  const lower = s.toLowerCase();
  
  let hue = 0;
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
  } else if (lower.includes('fo') || lower.includes('formation')) {
    hue = 270; // Purple
  } else if (lower.includes('marvel')) {
    hue = 190; // Cyan
  } else if (lower.includes('matmops')) {
    hue = 60;  // Pure Yellow (dark mustard text, pastel yellow bg)
  } else if (lower.includes('pooltechn')) {
    hue = 10;  // Rust Red
  } else if (lower.includes('studiotsh')) {
    hue = 100; // Bright Green
  } else if (lower.includes('lionking')) {
    hue = 40;  // Gold
  } else if (lower.includes('repos') || lower.includes('congé') || lower === 'off') {
    return {
      bg: '#f8fafc',
      text: '#475569',
      accent: '#94a3b8',
      rgbBg: [248, 250, 252],
      rgbText: [100, 116, 139],
      rgbAccent: [148, 163, 184]
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
