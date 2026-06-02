import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parsePdfFile } from './lib/parsePdf';
import type { PlanningRecord } from './lib/parsePdf';
import { exportDayPdf, exportEmployeePdf, exportScenePdf, listScenes, exportGlobalRecapPdf } from './lib/exportPdf';
import { getFOAssociations, isTrainingScene, computeAllFOAssociations, getFOAssociationKey, getSceneColor } from './lib/utils';

type Tab = 'recherche' | 'daily';
type Theme = 'dark' | 'light';

interface SourceFile {
  name: string;
  pageCount: number;
  recordCount: number;
  weekLabels: string[];
}

const DAY_FR_SHORT: Record<string, string> = {
  dimanche: 'DIM', lundi: 'LUN', mardi: 'MAR', mercredi: 'MER',
  jeudi: 'JEU', vendredi: 'VEN', samedi: 'SAM',
};
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

export default function App() {
  const [tab, setTab] = useState<Tab>('daily');
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  });

  const [records, setRecords] = useState<PlanningRecord[]>([]);
  const [sources, setSources] = useState<SourceFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
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
    setError(null);
    const list = Array.from(files).filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (list.length === 0) return;
    setLoading(true);
    try {
      const newRecs: PlanningRecord[] = [];
      const newSrcs: SourceFile[] = [];
      const existingFiles = new Set(sources.map(s => s.name));
      for (const f of list) {
        if (existingFiles.has(f.name)) continue;
        const r = await parsePdfFile(f);
        newRecs.push(...r.records);
        newSrcs.push({ name: r.sourceFile, pageCount: r.pageCount, recordCount: r.records.length, weekLabels: r.weekLabels });
      }
      setRecords(prev => [...prev, ...newRecs]);
      setSources(prev => [...prev, ...newSrcs]);
    } catch {
      setError('Erreur de lecture.');
    } finally {
      setLoading(false);
    }
  }, [sources]);

  const removeSource = useCallback((name: string) => {
    setRecords(prev => prev.filter(r => r.sourceFile !== name));
    setSources(prev => prev.filter(s => s.name !== name));
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
            <Uploader loading={loading} drag={drag} compact={false} onPick={() => fileRef.current?.click()} onDragOver={(e: any) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e: any) => { e.preventDefault(); setDrag(false); if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files); }} />
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

        <Uploader loading={loading} drag={drag} compact={true} onPick={() => fileRef.current?.click()} onDragOver={(e: any) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e: any) => { e.preventDefault(); setDrag(false); if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files); }} />
        <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple style={{ display: 'none' }} onChange={(e) => e.target.files && handleFiles(e.target.files)} />

        {sources.length > 0 && (
          <div className="sources-strip">
            {sources.map(s => (
              <span className="source-pill" key={s.name}><span className="dot" /><span title={s.name}>{s.name.slice(0,10)}</span><button onClick={() => removeSource(s.name)}>×</button></span>
            ))}
          </div>
        )}

        <div className="sidebar-nav-block">
          <nav className="seg">
            <button aria-selected={tab === 'recherche'} onClick={() => setTab('recherche')}><IconSearch /><span className="tab-label-full">Planning individuel</span></button>
            <button aria-selected={tab === 'daily'} onClick={() => setTab('daily')}><IconCalendar /><span className="tab-label-full">Vue globale</span></button>
          </nav>
        </div>
      </aside>
      <main className="app-main">
        {error && <div className="banner-error">{error}</div>}
        {tab === 'daily' && <div className="main-date-bar"><DailyDateBar records={records} date={dailyDate} onDateChange={setDailyDate} /></div>}
        <div className="main-content-panel">
          {tab === 'recherche' ? <RecherchePanel records={records} /> : <DailyPanel records={records} date={dailyDate} />}
        </div>
      </main>
    </div>
  );
}

function Uploader({ loading, compact, onPick }: any) {
  return (
    <div style={{ padding: '12px', width: '100%' }}>
      <button className="btn" onClick={onPick} disabled={loading} style={{ width: '100%' }}>
        {loading ? 'Lecture...' : compact ? 'Ajouter PDF' : 'Importer PDF Chronos'}
      </button>
    </div>
  );
}

function RecherchePanel({ records }: { records: PlanningRecord[] }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const employees = useMemo(() => Array.from(new Set(records.map(r => r.employee))).sort(), [records]);
  const filtered = useMemo(() => employees.filter(n => n.toLowerCase().includes(query.toLowerCase())), [employees, query]);

  if (selected) return <EmployeeDetail name={selected} records={records.filter(r => r.employee === selected)} onBack={() => setSelected(null)} />;
  return (
    <div>
      <div className="search-wrap" style={{ marginBottom: 12 }}><input type="search" placeholder="Rechercher un technicien…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      <div className="list">
        {filtered.map(name => <button key={name} className="row" onClick={() => setSelected(name)}><div className="avatar">{dayInitials(name)}</div><div>{name}</div></button>)}
      </div>
    </div>
  );
}

function EmployeeDetail({ name, records, onBack }: any) {
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <button className="btn-link" onClick={onBack}>← Retour</button>
      <div className="card" style={{ marginTop: 8, display: 'flex', justifyContent: 'between', alignItems: 'center' }}>
        <div>{name}</div>
        <button className="btn-export" disabled={busy} onClick={async () => { setBusy(true); try { await exportEmployeePdf(name, records); } catch {} finally { setBusy(false); } }}>Export PDF</button>
      </div>
    </div>
  );
}

function DailyDateBar({ records, date, onDateChange }: any) {
  const dates = useMemo(() => Array.from(new Set(records.map((r: any) => r.date))).sort(), [records]);
  useEffect(() => { if (dates.length > 0 && !dates.includes(date)) onDateChange(dates[0]); }, [dates, date, onDateChange]);
  return <div className="date-row">{dates.map((d: any) => <button key={d} aria-selected={d === date} className="date-pill" onClick={() => onDateChange(d)}>{d.split('-')[2]}</button>)}</div>;
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
    return Array.from(groups.entries()).sort((a,b) => a[0].localeCompare(b[0], 'fr'));
  }, [present]);

  return (
    <div>
      <div className="section-h">
        <div className="section-title">Département SFX — {formatDateLong(date)}</div>
        <button type="button" className="btn-export" onClick={() => setShowExport(true)}><IconDownload /><span>Export PDF Cartes</span></button>
      </div>
      {showExport && <ExportDialog records={records} date={date} onClose={() => setShowExport(false)} />}
      <div className="daily-groups">
        {byScene.map(([scene, sceneRecords]) => (
          <section className="daily-scene-group" key={scene} style={{ borderLeft: `4.5px solid ${getSceneColor(scene).accent}` }}>
            <div className="daily-group-head"><div className="daily-group-scene">{scene}</div></div>
            <div className="compact-list">
              {sceneRecords.map((rec: any, idx: number) => (
                <div className="compact-team-row" key={`${rec.employee}-${idx}`}>
                  <div>{rec.isFOVirtual ? `🎓 ` : ''}{rec.employee}</div>
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

function ExportDialog({ records, date, onClose }: any) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'day' | 'scene'>('day');
  const scenes = useMemo(() => listScenes(records), [records]);
  const [selectedScene, setSelectedScene] = useState(scenes[0] ?? '');

  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="export-head"><div className="export-title">Exporter en PDF</div><button onClick={onClose}>×</button></div>
        <div className="export-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button className={'export-opt' + (mode === 'day' ? ' on' : '')} onClick={() => setMode('day')}>Journée</button>
          <button className={'export-opt' + (mode === 'scene' ? ' on' : '')} onClick={() => setMode('scene')}>Par Scène</button>
          {mode === 'scene' && (
            <select value={selectedScene} onChange={(e) => setSelectedScene(e.target.value)} style={{ padding: '6px', borderRadius: '4px' }}>
              {scenes.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
        <div className="export-foot" style={{ padding: '12px', display: 'flex', justifyContent: 'end' }}>
          <button className="btn" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              if (mode === 'day') await exportDayPdf(date, records);
              else await exportScenePdf(selectedScene, records);
              onClose();
            } catch {} finally { setBusy(false); }
          }}>{busy ? 'Génération...' : 'Exporter'}</button>
        </div>
      </div>
    </div>
  );
}

function IconSearch() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>; }
function IconCalendar() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M3 10h18" /></svg>; }
function IconDownload() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m-5-5 5 5 5-5" /></svg>; }
function Logo() { return <img className="logo-img" src={`${import.meta.env.BASE_URL}sfx-dragon-logo.jpg`} alt="" width="56" height="56" />; }
