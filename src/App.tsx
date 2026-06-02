import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parsePdfFile } from './lib/parsePdf';
import type { PlanningRecord } from './lib/parsePdf';
import { exportDayPdf } from './lib/exportPdf';
import { getFOAssociations, isTrainingScene, computeAllFOAssociations, getFOAssociationKey, getSceneColor } from './lib/utils';

type Tab = 'recherche' | 'daily';
type Theme = 'dark' | 'light';

interface SourceFile { name: string; pageCount: number; recordCount: number; weekLabels: string[]; }

const DAY_FR_SHORT: Record<string, string> = { dimanche: 'DIM', lundi: 'LUN', mardi: 'MAR', mercredi: 'MER', jeudi: 'JEU', vendredi: 'VEN', samedi: 'SAM' };
const MONTH_FR: Record<string, string> = { '01': 'janv.', '02': 'févr.', '03': 'mars', '04': 'avril', '05': 'mai', '06': 'juin', '07': 'juil.', '08': 'août', '09': 'sept.', '10': 'oct.', '11': 'nov.', '12': 'déc.' };

function formatDateLong(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return iso;
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
  return isFO || isTrainingScene(scene) ? 'time-pill formation' : 'time-pill';
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
  const [fireworkTrigger, setFireworkTrigger] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [dailyDate, setDailyDate] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const activeDate = tab === 'daily' ? dailyDate : '';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.className = theme;
    document.body.className = theme;
  }, [theme]);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light');
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setError(null); const list = Array.from(files).filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (list.length === 0) { setError('Aucun PDF détecté.'); return; }
    setLoading(true);
    try {
      const newRecs: PlanningRecord[] = []; const newSrcs: SourceFile[] = [];
      const existingFiles = new Set(sources.map(s => s.name));
      for (const f of list) {
        if (existingFiles.has(f.name)) continue;
        const r = await parsePdfFile(f); newRecs.push(...r.records);
        newSrcs.push({ name: r.sourceFile, pageCount: r.pageCount, recordCount: r.records.length, weekLabels: r.weekLabels });
      }
      setRecords(prev => [...prev, ...newRecs]); setSources(prev => [...prev, ...newSrcs]);
      if (newRecs.length > 0) setFireworkTrigger(prev => prev + 1);
    } catch (e: any) { setError('Erreur : ' + (e?.message || 'Lecture impossible.')); } finally { setLoading(false); }
  }, [sources]);

  const onDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setDrag(false); if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files); }, [handleFiles]);
  const removeSource = useCallback((name: string) => { setRecords(prev => prev.filter(r => r.sourceFile !== name)); setSources(prev => prev.filter(s => s.name !== name)); }, []);

  if (records.length === 0) {
    return (
      <div className="app-shell-empty-container">
        <FireworksCanvas triggerCount={fireworkTrigger} />
        <div className="empty-landing-card">
          <header className="landing-header">
            <button type="button" className="landing-logo-wrap" onClick={() => setTheme(c => c === 'dark' ? 'light' : 'dark')}><Logo /></button>
            <h1 className="landing-title">SFX Planner</h1>
          </header>
          <div className="landing-uploader-wrap">
            <Uploader loading={loading} drag={drag} compact={false} onPick={() => fileRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop} />
          </div>
          <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple style={{ display: 'none' }} onChange={(e) => e.target.files && handleFiles(e.target.files)} />
          {error && <div className="banner-error" style={{ marginTop: 16, marginBottom: 16 }}>{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <FireworksCanvas triggerCount={fireworkTrigger} />
      <aside className="app-sidebar">
        <header className="app-header">
          <button type="button" className="app-logo" onClick={() => setTheme(c => c === 'dark' ? 'light' : 'dark')}><Logo /></button>
          <div style={{ minWidth: 0 }}><div className="app-title">SFX Planner</div></div>
        </header>
        <Uploader loading={loading} drag={drag} compact={true} onPick={() => fileRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop} />
        <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple style={{ display: 'none' }} onChange={(e) => e.target.files && handleFiles(e.target.files)} />
        {sources.length > 0 && (
          <div className="sources-strip">
            {sources.map(s => (
              <span className="source-pill" key={s.name}><span className="dot" /><span title={s.name}>{shortName(s.name)}</span><span style={{ color: 'var(--fg-dim)' }}>· {s.recordCount}</span><button onClick={() => removeSource(s.name)}>×</button></span>
            ))}
          </div>
        )}
        <div className="sidebar-nav-block">
          <nav className="seg">
            <button aria-selected={tab === 'recherche'} onClick={() => setTab('recherche')}><IconSearch /><span className="tab-label-full">Planning individuel</span></button>
            <button aria-selected={tab === 'daily'} onClick={() => setTab('daily')}><IconCalendar /><span className="tab-label-full">Vue globale</span></button>
          </nav>
        </div>
        {records.length > 0 && activeDate && <TechFinder records={records} activeDate={activeDate} />}
      </aside>

      <main className="app-main">
        {error && <div className="banner-error" style={{ marginBottom: 16 }}>{error}</div>}
        {records.length > 0 && tab === 'daily' && <div className="main-date-bar" style={{ marginBottom: 16 }}><DailyDateBar records={records} date={dailyDate} onDateChange={setDailyDate} /></div>}
        <div className="main-content-panel">
          {tab === 'recherche' ? <RecherchePanel records={records} /> : <DailyPanel records={records} date={dailyDate} onDateChange={setDailyDate} />}
        </div>
      </main>
    </div>
  );
}

function shortName(n: string): string {
  let name = n.replace(/\.pdf$/i, '').replace(/planning/i, '').replace(/semaine/i, 'S').replace(/week/i, 'W').replace(/sem/i, 'S').replace(/[\s\-_]+/g, ' ').trim();
  return name.replace(/s\s*(\d+)/i, 'S$1') || n;
}

function Uploader({ loading, drag, compact, onPick, onDragOver, onDragLeave, onDrop }: any) {
  const cta = loading ? 'Lecture...' : compact ? 'Ajouter PDF' : 'Importer PDF Chronos';
  return (
    <div className="uploader" data-drag={drag ? 'true' : 'false'} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} style={{ display: 'flex', justifyContent: 'center', width: '100%', padding: compact ? '12px' : '24px 16px' }}>
      <button className={'btn' + (compact ? ' btn-sm' : '')} onClick={onPick} disabled={loading} style={{ width: '100%', maxWidth: '280px', display: 'flex', justifyContent: 'center', gap: '8px' }}>{cta}</button>
    </div>
  );
}

function RecherchePanel({ records }: { records: PlanningRecord[] }) {
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState<string | null>(null);
  const employees = useMemo(() => Array.from(new Set(records.map(r => r.employee))).sort(), [records]);
  const filtered = useMemo(() => employees.filter(n => n.toLowerCase().includes(query.toLowerCase())), [employees, query]);

  if (selected) return <EmployeeDetail name={selected} records={records.filter(r => r.employee === selected)} allRecords={records} onBack={() => setSelected(null)} />;
  return (
    <div>
      <div className="search-wrap" style={{ marginBottom: 12 }}><span className="search-icon"><IconSearch /></span><input type="search" placeholder="Rechercher…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      <div className="section-h"><div className="section-title">Techniciens</div><div className="section-count">{filtered.length}</div></div>
      <div className="list">{filtered.map(name => (<button key={name} className="row" onClick={() => setSelected(name)}><div className="avatar">{dayInitials(name)}</div><div style={{ flex: 1, minWidth: 0 }}><div className="row-title">{name}</div></div><span className="row-arrow"><IconChevron /></span></button>))}</div>
    </div>
  );
}

function EmployeeDetail({ name, records, onBack }: any) {
  return <div><button className="btn-link" onClick={onBack}>← Retour</button><div className="card" style={{ marginTop: 8, marginBottom: 16 }}>{name}</div></div>;
}

function SceneDetail({ scene, date, team, onBack }: any) {
  return <div><button className="btn-link" onClick={onBack}>← Retour</button><div className="card" style={{ marginTop: 8, marginBottom: 16 }}>{scene} - {date}</div></div>;
}

function DailyDateBar({ records, date, onDateChange }: any) {
  const dates = useMemo(() => Array.from(new Set(records.map((r:any) => r.date))).sort(), [records]);
  useEffect(() => { if (dates.length > 0 && (!date || !(dates as any).includes(date))) onDateChange(dates[0]); }, [dates, date, onDateChange]);
  if (dates.length === 0) return null;
  return <div className="daily-date-bar"><DatePicker dates={dates as string[]} date={date} records={records} onChange={onDateChange} /></div>;
}

function DailyPanel({ records, date }: any) {
  const [showExport, setShowExport] = useState(false);
  const present = useMemo(() => records.filter((r:any) => r.date === date && r.time !== 'OFF'), [records, date]);

  return (
    <div>
      <div className="section-h" style={{ marginTop: 6 }}>
        <div className="section-title">Département SFX — {formatDateLong(date)}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><button type="button" className="btn-export" onClick={() => setShowExport(true)}><IconDownload /><span>Export PDF Cartes</span></button></div>
      </div>
      {showExport && <ExportDialog records={records} date={date} onClose={() => setShowExport(false)} />}
      <div className="daily-groups">
        <div className="card" style={{marginTop: 16}}>Présents: {present.length}</div>
      </div>
    </div>
  );
}

function DatePicker({ dates, date, onChange }: any) {
  return <div className="date-row">{dates.map((d:string) => <button key={d} aria-selected={d === date} className="date-pill" onClick={() => onChange(d)}><span className="dpn">{d.split('-')[2]}</span></button>)}</div>;
}

function TechFinder({ records, activeDate }: any) { return <div/>; }

function ExportDialog({ records, date, onClose }: any) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="export-head"><div className="export-title">Exporter le planning quotidien</div><button onClick={onClose}>×</button></div>
        <div className="export-body" style={{ padding: '16px 0' }}>
          <button className="export-opt on" onClick={async () => { setBusy(true); try { await exportDayPdf(date, records); onClose(); } catch(e){} finally { setBusy(false); } }}><span className="export-opt-title">Journée du {formatDateLong(date)}</span><span className="export-opt-sub">Format cartes par scènes / équipes</span></button>
        </div>
        <div className="export-foot"><button className="btn-link" onClick={onClose}>Annuler</button><button className="btn" disabled={busy}>{busy ? 'Génération…' : 'Générer le PDF'}</button></div>
      </div>
    </div>
  );
}

function IconSearch() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>; }
function IconCalendar() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="3" /></svg>; }
function IconChevron() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6" /></svg>; }
function IconDownload() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m-5-5 5 5 5-5m-10 11h14" /></svg>; }
function Logo() { return <img className="logo-img" src={`${import.meta.env.BASE_URL}sfx-dragon-logo.jpg`} alt="" width="56" height="56" />; }
function FireworksCanvas() { return <canvas style={{ display: 'none' }} />; }
