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

export function getFOAssociations(dayRecords: PlanningRecord[]): Map<string, string[]> {
  const associations = new Map<string, string[]>();
  const activeRecs = dayRecords.filter(r => r.time !== 'OFF');
  const foRecs = activeRecs.filter(r => r.scene === 'FO');
  const regRecs = activeRecs.filter(r => r.scene !== 'FO');

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
