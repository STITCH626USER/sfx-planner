import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parsePdfFile } from './lib/parsePdf';
import type { PlanningRecord } from './lib/parsePdf';
// Ajout de exportWeeklyPdf ici
import { exportDayPdf, exportEmployeePdf, exportScenePdf, exportWeeklyPdf, listScenes } from './lib/exportPdf';
import { getFOAssociations, isTrainingScene, getSceneColor } from './lib/utils';

type Tab = 'recherche' | 'daily';
type Theme = 'dark' | 'light';

const MONTH_FR: Record<string, string> = {
  '01': 'janv.', '02': 'févr.', '03': 'mars', '04': 'avril', '05': 'mai',
  '06': 'juin', '07': 'juil.', '08': 'août', '09': 'sept.', '10': 'oct.', '11': 'nov.', '12': 'déc.',
};

function formatDateLong(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${parseInt(m[3], 10)} ${MONTH_FR[m[2]] ?? m[2]} ${m[1]}`;
}

function dayInitials(name: string): string {
  const parts = name.replace(/[(*)]/g, '').split(/[, ]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function timePillClass(time: string, scene: string, isFO?: boolean): string {
  if (time === 'OFF') return 'time-pill off';
  if (isFO || isTrainingScene(scene)) return 'time-pill formation';
  return 'time-pill';
}

function titleCaseWord(w: string): string { if (!w) return w; return w.split(/([-'])/).map(part => /^[-']$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(''); }
function titleCasePart(s: string): string { return s.trim().split(/\s+/).map(titleCaseWord).join(' '); }
function prettyName(s: string): string {
  const idx = s.indexOf(','); if (idx === -1) return titleCasePart(s);
  const last = titleCasePart(s.slice(0, idx)); const first = titleCasePart(s.slice(idx + 1));
  return first ? `${first} ${last}` : last;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('daily');
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  });

  const [records, setRecords] = useState<PlanningRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [dailyDate, setDailyDate] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.className = theme;
    document.body.className = theme;
    
    if (theme === 'light') {
      document.body.style.backgroundColor = '#f1f5f9';
      document.body.style.color = '#0f172a';
    } else {
      document.body.style.backgroundColor = '#0b0f19';
      document.body.style.color = '#f1f5f9';
    }
  }, [theme]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (list.length === 0) return;
    setLoading(true);
    try {
      const newRecs: PlanningRecord[] = [];
      for (const f of list) {
        const r = await parsePdfFile(f);
        newRecs.push(...r.records);
      }
      setRecords(prev => [...prev, ...newRecs]);
    } catch {
      console.error('Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  if (records.length === 0) {
    return (
      <div className="app-shell-empty-container">
        <div className="empty-landing-card">
          <header className="landing-header">
            <button type="button" className="landing-logo-wrap" onClick={() => setTheme(c => c === 'dark' ? 'light' : 'dark')}><Logo /></button>
            <h1 className="landing-title">SFX Planner</h1>
          </header>
          <div className="landing-uploader-wrap">
            <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={loading}>
              {loading ? 'Lecture...' : 'Importer PDF Chronos'}
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple style={{ display: 'none' }} onChange={(e) => e.target.files && handleFiles(e.target.files)} />
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <header className="app-header">
          <button type="button" className="app-logo" onClick={() => setTheme(c => c === 'dark' ? 'light' : 'dark')}><Logo /></button>
          <div style={{ minWidth: 0 }}><div className="app-title">SFX Planner</div></div>
        </header>
        <div style={{ padding: '12px', width: '100%' }}>
          <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} style={{ width: '100%' }}>Ajouter PDF</button>
        </div>
        <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple style={{ display: 'none' }} onChange={(e) => e.target.files && handleFiles(e.target.files)} />
        <div className="sidebar-nav-block">
          <nav className="seg" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'recherche'} onClick={() => setTab('recherche')}><span className="tab-label-full">Planning individuel</span></button>
            <button type="button" role="tab" aria-selected={tab === 'daily'} onClick={() => setTab('daily')}><span className="tab-label-full">Vue globale</span></button>
          </nav>
        </div>
      </aside>
      <main className="app-main">
        {tab === 'daily' && <div className="main-date-bar"><DailyDateBar records={records} date={dailyDate} onDateChange={setDailyDate} /></div>}
        <div className="main-content-panel">
          {tab === 'recherche' ? <RecherchePanel records={records} /> : <DailyPanel records={records} date={dailyDate} />}
        </div>
      </main>
    </div>
  );
}

function RecherchePanel({ records }: { records: PlanningRecord[] }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const employees = useMemo(() => Array.from(new Set(records.map(r => r.employee))).sort(), [records]);
  const filtered = useMemo(() => employees.filter(n => n.toLowerCase().includes(query.trim().toLowerCase())), [employees, query]);

  if (selected) return <EmployeeDetail name={selected} records={records} onBack={() => setSelected(null)} />;
  return (
    <div>
      <div className="search-wrap" style={{ marginBottom: 12 }}><input type="search" placeholder="Rechercher un technicien…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      <div className="list">
        {filtered.map(name => <button key={name} className="row" onClick={() => setSelected(name)}><div className="avatar">{dayInitials(name)}</div><div>{prettyName(name)}</div></button>)}
      </div>
    </div>
  );
}

function EmployeeDetail({ name, records, onBack }: { name: string; records: PlanningRecord[]; onBack: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <button type="button" className="btn-link" onClick={onBack}>← Retour</button>
      <div className="card" style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>{prettyName(name)}</div>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={async () => {
          setBusy(true); try { await exportEmployeePdf(name, records); } catch {} finally { setBusy(false); }
        }}>Export PDF</button>
      </div>
    </div>
  );
}

function DailyDateBar({ records, date, onDateChange }: { records: PlanningRecord[]; date: string; onDateChange: (d: string) => void }) {
  const dates = useMemo(() => Array.from(new Set(records.map(r => r.date))).sort(), [records]);
  useEffect(() => { if (dates.length > 0 && !dates.includes(date)) onDateChange(dates[0]); }, [dates, date, onDateChange]);
  return <div className="date-row">{dates.map(d => <button key={d} type="button" className="date-pill" aria-selected={d === date} onClick={() => onDateChange(d)}><span className="dpn">{d.split('-')[2]}</span></button>)}</div>;
}

function DailyPanel({ records, date }: { records: PlanningRecord[]; date: string }) {
  const [showExport, setShowExport] = useState(false);
  const present = useMemo(() => {
    const dayRecs = records.filter(r => r.date === date && r.time !== 'OFF');
    const activeRegs = dayRecs.filter(r => !isTrainingScene(r.scene));
    const activeFOs = dayRecs.filter(r => isTrainingScene(r.scene));
    const dayAssoc = getFOAssociations(dayRecs);
    const result: any[] = [...activeRegs];
    for (const fo of activeFOs) {
      const assoc = dayAssoc.get(fo.employee) ?? [];
      result.push({ ...fo, assocScenes: assoc, originalScene: fo.scene });
      for (const scene of assoc) result.push({ ...fo, scene, isFOVirtual: true, assocScenes: assoc, originalScene: fo.scene });
    }
    return result.sort((a, b) => a.scene.localeCompare(b.scene, 'fr'));
  }, [records, date]);

  const byScene = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const rec of present) { if (!groups.has(rec.scene)) groups.set(rec.scene, []); groups.get(rec.scene)!.push(rec); }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], 'fr'));
  }, [present]);

  return (
    <div>
      <div className="section-h">
        <div className="section-title">Département SFX — {formatDateLong(date)}</div>
        <button type="button" className="btn-export" onClick={() => setShowExport(true)}><span>Export PDF Cartes</span></button>
      </div>
      {showExport && <ExportDialog records={records} date={date} onClose={() => setShowExport(false)} />}
      <div className="daily-groups">
        {byScene.map(([scene, sceneRecords]) => (
          <section className="daily-scene-group" key={scene} style={{ borderLeft: `4.5px solid ${getSceneColor(scene).accent}` }}>
            <div className="daily-group-head"><div className="daily-group-scene">{scene}</div></div>
            <div className="compact-list">
              {sceneRecords.map((rec: any, idx: number) => (
                <div className="compact-team-row" key={`${rec.employee}-${idx}`}>
                  <div>{rec.isFOVirtual ? `🎓 ` : ''}{prettyName(rec.employee)}</div>
                  <span className={timePillClass(rec.time, rec.scene)}>{rec.time}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// Composant ExportDialog modifié avec l'option Semaine
function ExportDialog({ records, date, onClose }: { records: PlanningRecord[]; date: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'day' | 'week' | 'scene'>('day');
  const scenes = useMemo(() => listScenes(records), [records]);
  const dates = useMemo(() => Array.from(new Set(records.map(r => r.date))).sort(), [records]);
  const [selectedScene, setSelectedScene] = useState(scenes[0] ?? '');

  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="export-head"><div className="export-title">Exporter en PDF</div><button type="button" onClick={onClose}>×</button></div>
        <div className="export-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button type="button" className={'export-opt' + (mode === 'day' ? ' on' : '')} onClick={() => setMode('day')}>Journée actuelle</button>
          <button type="button" className={'export-opt' + (mode === 'week' ? ' on' : '')} onClick={() => setMode('week')}>Semaine entière ({dates.length} jours)</button>
          <button type="button" className={'export-opt' + (mode === 'scene' ? ' on' : '')} onClick={() => setMode('scene')}>Par Scène</button>
          {mode === 'scene' && (
            <select value={selectedScene} onChange={(e) => setSelectedScene(e.target.value)} style={{ padding: '6px' }}>
              {scenes.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
        <div className="export-foot" style={{ padding: '12px', display: 'flex', justifyContent: 'end' }}>
          <button type="button" className="btn" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              if (mode === 'day') await exportDayPdf(date, records);
              else if (mode === 'week') await exportWeeklyPdf(dates, records);
              else await exportScenePdf(selectedScene, records);
              onClose();
            } catch {} finally { setBusy(false); }
          }}>{busy ? 'Génération...' : 'Exporter'}</button>
        </div>
      </div>
    </div>
  );
}

function Logo() { return <img className="logo-img" src={`${import.meta.env.BASE_URL}sfx-dragon-logo.jpg`} alt="" width="56" height="56" />; }
