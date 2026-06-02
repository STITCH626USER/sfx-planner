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
  if (isFO || isTrainingScene(scene)) {
    return 'time-pill formation';
  }
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
  const [fireworkTrigger, setFireworkTrigger] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<'safari' | null>(null);
  const [drag, setDrag] = useState(false);
  const [dailyDate, setDailyDate] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const activeDate = tab === 'daily' ? dailyDate : '';

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

  useEffect(() => {
    if (!window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? 'dark' : 'light');
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setError(null);
    const all = Array.from(files);
    const list = all.filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (list.length === 0) {
      setError(all.length > 0 ? 'Le fichier sélectionné n’est pas un PDF.' : 'Aucun PDF détecté.');
      return;
    }
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
      if (newRecs.length > 0) setFireworkTrigger(prev => prev + 1);
    } catch (e: any) {
      setError('Erreur lors de la lecture du PDF.');
    } finally {
      setLoading(false);
    }
  }, [sources]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const removeSource = useCallback((name: string) => {
    setRecords(prev => prev.filter(r => r.sourceFile !== name));
    setSources(prev => prev.filter(s => s.name !== name));
  }, []);

  if (records.length === 0) {
    return (
      <div className="app-shell-empty-container" data-testid="app-root">
        <div className="smoke-bg" aria-hidden="true"><div className="smoke-cloud smoke-cloud-1" /><div className="smoke-cloud smoke-cloud-2" /><div className="smoke-cloud smoke-cloud-3" /></div>
        <FireworksCanvas triggerCount={fireworkTrigger} />
        <div className="empty-landing-card">
          <header className="landing-header">
            <button type="button" className="landing-logo-wrap" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}><Logo /></button>
            <h1 className="landing-title">SFX Planner</h1>
          </header>
          <div className="landing-uploader-wrap">
            <Uploader loading={loading} drag={drag} compact={false} onPick={() => fileRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop} />
          </div>
          <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple style={{ display: 'none' }} onChange={(e) => e.target.files && handleFiles(e.target.files)} />
          {error && <div className="banner-error"><div>{error}</div></div>}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell" data-testid="app-root">
      <FireworksCanvas triggerCount={fireworkTrigger} />
      <aside className="app-sidebar">
        <header className="app-header">
          <button type="button" className="app-logo" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}><Logo /></button>
          <div style={{ minWidth: 0 }}><div className="app-title">SFX Planner</div></div>
        </header>

        <Uploader loading={loading} drag={drag} compact={records.length > 0} onPick={() => fileRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop} />
        <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple style={{ display: 'none' }} onChange={(e) => e.target.files && handleFiles(e.target.files)} />

        {sources.length > 0 && (
          <div className="sources-strip">
            {sources.map(s => (
              <span className="source-pill" key={s.name}><span className="dot" /><span title={s.name}>{shortName(s.name)}</span><span>· {s.recordCount}</span><button onClick={() => removeSource(s.name)}>×</button></span>
            ))}
          </div>
        )}

        <div className="sidebar-nav-block">
          <nav className="seg" role="tablist">
            <button role="tab" aria-selected={tab === 'recherche'} onClick={() => setTab('recherche')}><IconSearch /><span className="tab-label-full">Planning individuel</span></button>
            <button role="tab" aria-selected={tab === 'daily'} onClick={() => setTab('daily')}><IconCalendar /><span className="tab-label-full">Vue globale</span></button>
          </nav>
        </div>

        {records.length > 0 && activeDate && <TechFinder records={records} activeDate={activeDate} />}
      </aside>

      <main className="app-main">
        {error && <div className="banner-error"><div>{error}</div></div>}
        {records.length > 0 && tab === 'daily' && <div className="main-date-bar" style={{ marginBottom: 16 }}><DailyDateBar records={records} date={dailyDate} onDateChange={setDailyDate} /></div>}
        <div className="main-content-panel">
          {records.length === 0 ? <EmptyAllPanel /> : tab === 'recherche' ? <RecherchePanel records={records} /> : <DailyPanel records={records} date={dailyDate} onDateChange={setDailyDate} />}
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
  const cta = loading ? 'Lecture...' : compact ? 'Ajouter PDF Chronos' : 'Importer PDF Chronos';
  return (
    <div className="uploader" data-drag={drag ? 'true' : 'false'} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} style={{ display: 'flex', width: '100%', padding: compact ? '12px' : '24px 16px' }}>
      <button className={'btn' + (compact ? ' btn-sm' : '')} onClick={onPick} disabled={loading} style={{ width: '100%' }}>{cta}</button>
    </div>
  );
}

function RecherchePanel({ records }: { records: PlanningRecord[] }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const employees = useMemo(() => Array.from(new Set(records.map(r => r.employee))).sort((a, b) => prettyName(a).localeCompare(prettyName(b), 'fr')), [records]);
  const filtered = useMemo(() => employees.filter(n => searchHaystack(n).includes(query.trim().toLowerCase())), [employees, query]);

  if (selected) return <EmployeeDetail name={selected} records={records.filter(r => r.employee === selected)} allRecords={records} onBack={() => setSelected(null)} />;

  return (
    <div>
      <div className="search-wrap" style={{ marginBottom: 12 }}><span className="search-icon"><IconSearch /></span><input type="search" placeholder="Rechercher un technicien…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      <div className="list">
        {filtered.map(name => (
          <button key={name} className="row" onClick={() => setSelected(name)}><div className="avatar">{dayInitials(name)}</div><div style={{ flex: 1, minWidth: 0 }}><div className="row-title">{prettyName(name)}</div></div><span className="row-arrow"><IconChevron /></span></button>
        ))}
      </div>
    </div>
  );
}

function titleCaseWord(w: string): string { if (!w) return w; return w.split(/([-'])/).map(part => /^[-']$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(''); }
function titleCasePart(s: string): string { return s.trim().split(/\s+/).map(titleCaseWord).join(' '); }
function prettyName(s: string): string {
  const idx = s.indexOf(','); if (idx === -1) return titleCasePart(s);
  const last = titleCasePart(s.slice(0, idx)); const first = titleCasePart(s.slice(idx + 1));
  return first ? `${first} ${last}` : last;
}
function searchHaystack(s: string): string { const pretty = prettyName(s); const idx = s.indexOf(','); const reversed = idx !== -1 ? `${s.slice(idx + 1).trim()} ${s.slice(0, idx).trim()}` : ''; return `${s} ${pretty} ${reversed}`.toLowerCase(); }
function countWeeks(records: PlanningRecord[], name: string): number { const set = new Set<string>(); for (const r of records) if (r.employee === name) set.add(r.weekLabel); return set.size; }
function countActiveDays(records: PlanningRecord[], name: string): number { let n = 0; for (const r of records) if (r.employee === name && r.time !== 'OFF') n++; return n; }

function EmployeeDetail({ name, records, allRecords, onBack }: any) {
  useEffect(() => { setTimeout(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, 50); }, [name]);
  const byWeek = useMemo(() => {
    const m = new Map<string, PlanningRecord[]>();
    for (const r of records) { if (!m.has(r.weekLabel)) m.set(r.weekLabel, []); m.get(r.weekLabel)!.push(r); }
    return Array.from(m.entries()).sort((a, b) => a[1][0].date.localeCompare(b[1][0].date));
  }, [records]);

  const [openScene, setOpenScene] = useState<any>(null);
  const [openEmployee, setOpenEmployee] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const dayAssocMap = useMemo(() => allRecords ? computeAllFOAssociations(allRecords) : new Map(), [allRecords]);

  if (openEmployee && allRecords) return <EmployeeDetail name={openEmployee} records={allRecords.filter(r => r.employee === openEmployee)} allRecords={allRecords} onBack={() => setOpenEmployee(null)} />;
  if (openScene && allRecords) {
    const dayRecs = allRecords.filter(r => r.date === openScene.date && r.time !== 'OFF');
    const team = [...dayRecs.filter(r => !isTrainingScene(r.scene))];
    return <SceneDetail scene={openScene.scene} date={openScene.date} team={team} onBack={() => setOpenScene(null)} onViewEmployee={setOpenEmployee} />;
  }

  return (
    <div>
      <button className="btn-link" onClick={onBack}>← Retour</button>
      <div className="card" style={{ marginTop: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="avatar">{dayInitials(name)}</div>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 17 }}>{prettyName(name)}</div></div>
          <button type="button" className="btn-export" disabled={exporting} onClick={async () => { setExporting(true); try { await exportEmployeePdf(name, allRecords ?? records); } catch(e){} finally { setExporting(false); } }}><IconDownload /><span>Export PDF</span></button>
        </div>
      </div>
      {byWeek.map(([weekLabel, weekRecs]) => (
        <div className="week-block" key={weekLabel}>
          <div className="week-head"><div className="week-name">{weekLabel}</div></div>
          {weekRecs.map(rec => <DayCard key={rec.date} rec={rec} assocScenes={dayAssocMap.get(getFOAssociationKey(rec.date, rec.employee)) ?? []} onOpenScene={allRecords ? () => setOpenScene({ date: rec.date, scene: rec.scene }) : undefined} />)}
        </div>
      ))}
    </div>
  );
}

function DayCard({ rec, assocScenes, onOpenScene }: any) {
  const isOff = rec.time === 'OFF'; const interactive = !isOff && !!onOpenScene && !!rec.scene;
  return (
    <div className="day-card" data-off={isOff ? 'true' : 'false'} onClick={interactive ? () => onOpenScene() : undefined}>
      <div className="day-tag"><span className="d">{DAY_FR_SHORT[rec.day] ?? ''}</span><span className="n">{rec.date.split('-')[2]}</span></div>
      <div style={{ minWidth: 0 }}>
        <div className={'day-scene' + (isOff ? ' off' : '')} style={!isOff ? { borderLeft: `3.5px solid ${getSceneColor(rec.scene).accent}`, paddingLeft: 6 } : undefined}>{isOff ? 'Repos / congé' : isTrainingScene(rec.scene) ? `🎓 ${rec.scene}` : rec.scene}</div>
        {assocScenes && assocScenes.length > 0 && <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 2 }}>Associé à : {assocScenes.join(', ')}</div>}
      </div>
      <span className={timePillClass(rec.time, rec.scene)}>{isOff ? 'OFF' : rec.time}</span>
    </div>
  );
}

function SceneDetail({ scene, date, team, onBack, onViewEmployee }: any) {
  return (
    <div>
      <button className="btn-link" onClick={onBack}>← Retour</button>
      <div className="card" style={{ marginTop: 8, marginBottom: 16 }}><div style={{ fontWeight: 600, fontSize: 17 }}>{scene}</div><div>{formatDateLong(date)}</div></div>
      <div className="list">
        {team.map((rec:any) => (
          <div className="team-row" key={rec.employee}>
            <div className="avatar">{dayInitials(rec.employee)}</div>
            <div style={{ minWidth: 0 }}><div className="team-name">{prettyName(rec.employee)}</div></div>
            <span className={timePillClass(rec.time, rec.scene)}>{rec.time}</span>
            <button type="button" className="btn-eye" onClick={() => onViewEmployee(rec.employee)}><IconEye /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function DailyDateBar({ records, date, onDateChange }: any) {
  const dates = useMemo(() => Array.from(new Set(records.map((r:any) => r.date))).sort(), [records]);
  useEffect(() => { if (dates.length > 0 && (!date || !(dates as any).includes(date))) onDateChange(dates[0]); }, [dates, date, onDateChange]);
  if (dates.length === 0) return null;
  return <div className="daily-date-bar"><DatePicker dates={dates} date={date} records={records} onChange={onDateChange} /></div>;
}

function DailyPanel({ records, date, onDateChange }: any) {
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [openScene, setOpenScene] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  useEffect(() => { setOpenScene(null); }, [date]);

  const present = useMemo(() => {
    const dayRecs = records.filter((r:any) => r.date === date && r.time !== 'OFF');
    const activeRegs = dayRecs.filter((r:any) => !isTrainingScene(r.scene));
    const activeFOs = dayRecs.filter((r:any) => isTrainingScene(r.scene));
    const dayAssoc = getFOAssociations(dayRecs);
    const result: any[] = [...activeRegs];
    for (const fo of activeFOs) {
      const assoc = dayAssoc.get(fo.employee) ?? [];
      result.push({ ...fo, assocScenes: assoc, originalScene: fo.scene });
      for (const scene of assoc) result.push({ ...fo, scene, isFOVirtual: true, assocScenes: assoc, originalScene: fo.scene });
    }
    return result.sort((a, b) => a.scene.localeCompare(b.scene, 'fr') || prettyName(a.employee).localeCompare(prettyName(b.employee), 'fr'));
  }, [records, date]);

  const byScene = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const rec of present) { if (!groups.has(rec.scene)) groups.set(rec.scene, []); groups.get(rec.scene)!.push(rec); }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], 'fr'));
  }, [present]);

  if (selectedEmployee) return <EmployeeDetail name={selectedEmployee} records={records.filter(r => r.employee === selectedEmployee)} allRecords={records} onBack={() => setSelectedEmployee(null)} />;

  return (
    <div>
      {openScene ? (
        <SceneDetail scene={openScene} date={date} team={present.filter(r => r.scene === openScene)} onBack={() => setOpenScene(null)} onViewEmployee={setSelectedEmployee} />
      ) : (
        <>
          <div className="section-h" style={{ marginTop: 6 }}>
            <div className="section-title">Département SFX — {formatDateLong(date)}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><button type="button" className="btn-export" onClick={() => setShowExport(true)}><IconDownload /><span>Export PDF Cartes</span></button></div>
          </div>
          {showExport && <ExportDialog records={records} date={date} onClose={() => setShowExport(false)} />}
          <div className="daily-groups">
            {byScene.map(([scene, sceneRecords]) => (
              <section className="daily-scene-group" key={scene}>
                <button type="button" className="daily-group-head" onClick={() => setOpenScene(scene)} style={{ width: '100%', background: `linear-gradient(90deg, ${getSceneColor(scene).accent}30, transparent)`, borderLeft: `4.5px solid ${getSceneColor(scene).accent}` }}><div className="daily-group-scene">{scene}</div></button>
                <div className="compact-list">
                  {sceneRecords.map((rec: any) => (
                    <div className="compact-team-row" key={`${rec.employee}-${rec.date}`}>
                      <div style={{ minWidth: 0 }}><div className="team-name compact-name">{rec.isFOVirtual ? `🎓 ` : ''}{prettyName(rec.employee)}</div></div>
                      <span className={timePillClass(rec.time, rec.scene)}>{rec.time}</span>
                      <button type="button" className="btn-eye compact-eye" onClick={() => setSelectedEmployee(rec.employee)}><IconEye /></button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DatePicker({ dates, date, onChange }: any) {
  return <div className="date-row">{dates.map((d: string) => <button key={d} aria-selected={d === date} className="date-pill" onClick={() => onChange(d)}><span className="dpn">{d.split('-')[2]}</span></button>)}</div>;
}
function TechFinder({ records, activeDate }: any) { return <div />; }
function EmptyAllPanel() { return <div className="empty" />; }
function ExportDialog({ records, date, onClose }: any) {
  const [mode, setMode] = useState<'day' | 'scene' | 'global'>('day');
  const scenes = useMemo(() => listScenes(records), [records]);
  const [selectedScene, setSelectedScene] = useState(scenes[0] ?? '');
  const [busy, setBusy] = useState(false);

  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="export-head"><div className="export-title">Exporter en PDF</div><button onClick={onClose}>×</button></div>
        <div className="export-body">
          <button className={'export-opt' + (mode === 'day' ? ' on' : '')} onClick={() => setMode('day')}><span className="export-opt-title">Journée du {formatDateLong(date)}</span></button>
          <button className={'export-opt' + (mode === 'scene' ? ' on' : '')} onClick={() => setMode('scene')}><span className="export-opt-title">Scène sur période</span></button>
          {mode === 'scene' && <select value={selectedScene} onChange={(e) => setSelectedScene(e.target.value)}>{scenes.map(s => <option key={s} value={s}>{s}</option>)}</select>}
        </div>
        <div className="export-foot"><button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { if (mode === 'day') await exportDayPdf(date, records); else if (mode === 'scene') await exportScenePdf(selectedScene, records); else await exportGlobalRecapPdf(records); onClose(); } catch(e){} finally { setBusy(false); } }}>Exporter</button></div>
      </div>
    </div>
  );
}

function IconSearch() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>; }
function IconCalendar() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M3 10h18" /></svg>; }
function IconChevron() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6" /></svg>; }
function IconDownload() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m-5-5 5 5 5-5" /></svg>; }
function IconEye() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>; }
function Logo() { return <img className="logo-img" src={`${import.meta.env.BASE_URL}sfx-dragon-logo.jpg`} alt="" width="56" height="56" />; }
function FireworksCanvas({ triggerCount }: any) { return <canvas style={{ display: 'none' }} />; }
