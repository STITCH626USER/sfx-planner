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
    
    // CORRECTION MAJEURE : On force la couleur de fond du site
    // car votre fichier index.css bloque probablement le fond global.
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
      setError(all.length > 0
        ? 'Le fichier sélectionné n’est pas un PDF. Sur iPhone, ouvrez Fichiers et choisissez un PDF.'
        : 'Aucun PDF détecté.');
      return;
    }
    const ignored = all.length - list.length;
    setLoading(true);
    try {
      const newRecs: PlanningRecord[] = [];
      const newSrcs: SourceFile[] = [];
      const existingFiles = new Set(sources.map(s => s.name));
      for (const f of list) {
        if (existingFiles.has(f.name)) continue;
        const r = await parsePdfFile(f);
        newRecs.push(...r.records);
        newSrcs.push({
          name: r.sourceFile,
          pageCount: r.pageCount,
          recordCount: r.records.length,
          weekLabels: r.weekLabels,
        });
      }
      setRecords(prev => [...prev, ...newRecs]);
      setSources(prev => [...prev, ...newSrcs]);
      if (newRecs.length > 0) {
        setFireworkTrigger(prev => prev + 1);
      }
      if (ignored > 0) {
        setError(`${ignored} fichier(s) non-PDF ignoré(s).`);
      }
    } catch (e: any) {
      console.error(e);
      const raw = e?.message ?? String(e ?? 'inconnue');
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      const isIOS = /iPad|iPhone|iPod/.test(ua);
      const inApp = /WhatsApp|Instagram|FBAN|FBAV|FB_IAB|FBIOS|Line\/|Snapchat|Twitter|TikTok|GSA\/|OutlookMobile/i.test(ua)
        || (isIOS && !/Safari\//.test(ua));
      if (inApp) {
        setError(
          'Cette page est ouverte dans une app qui limite la lecture des PDF. Ouvre le lien dans Safari pour importer ton planning. Détail : ' + raw,
        );
        setErrorHint('safari');
      } else if (isIOS) {
        setError(
          'Impossible de lire ce PDF sur cet iPhone. Essaie de l’ouvrir d’abord dans l’app Fichiers puis « Partager → SFX Planner », ou ouvre la page depuis Safari. Détail : ' + raw,
        );
        setErrorHint('safari');
      } else {
        setError('Erreur lors de la lecture du PDF : ' + raw);
        setErrorHint(null);
      }
    } finally {
      setLoading(false);
    }
  }, [sources]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer?.files?.length) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const removeSource = useCallback((name: string) => {
    setRecords(prev => prev.filter(r => r.sourceFile !== name));
    setSources(prev => prev.filter(s => s.name !== name));
  }, []);

  if (records.length === 0) {
    return (
      <div className="app-shell-empty-container" data-testid="app-root">
        <div className="smoke-bg" aria-hidden="true">
          <div className="smoke-cloud smoke-cloud-1" />
          <div className="smoke-cloud smoke-cloud-2" />
          <div className="smoke-cloud smoke-cloud-3" />
        </div>
        <FireworksCanvas triggerCount={fireworkTrigger} />
        <div className="empty-landing-card">
          <header className="landing-header">
            <button
              type="button"
              className="landing-logo-wrap"
              aria-label="Changer le mode d'affichage"
              title="Changer le mode d'affichage"
              data-testid="btn-theme-toggle"
              onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
            >
              <Logo />
            </button>
            <h1 className="landing-title">SFX Planner</h1>
          </header>
          
          <div className="landing-uploader-wrap">
            <Uploader
              loading={loading}
              drag={drag}
              compact={false}
              onPick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
            />
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            style={{ display: 'none' }}
            data-testid="input-file"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />

          {error && (
            <div className="banner-error" role="alert" data-testid="error-banner" style={{ marginTop: 16, marginBottom: 16 }}>
              <div>{error}</div>
            </div>
          )}

          <div className="landing-warning-notice">
            <div className="footer-warning-card">
              <span className="warning-text">
                <strong style={{ color: 'var(--amber)', marginRight: '6px' }}>⚠️ ATTENTION :</strong>
                Contrôle obligatoire sur UKG personnel. Données traitées localement. <span style={{opacity: 0.45, fontSize: '10px', marginLeft: '6px'}}>v3.11</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell" data-testid="app-root">
      <div className="smoke-bg" aria-hidden="true">
        <div className="smoke-cloud smoke-cloud-1" />
        <div className="smoke-cloud smoke-cloud-2" />
        <div className="smoke-cloud smoke-cloud-3" />
      </div>
      <FireworksCanvas triggerCount={fireworkTrigger} />
      <aside className="app-sidebar">
        <header className="app-header">
          <button
            type="button"
            className="app-logo"
            aria-label="Changer le mode d'affichage"
            title="Changer le mode d'affichage"
            data-testid="btn-theme-toggle"
            onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
          >
            <Logo />
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="app-title">SFX Planner</div>
          </div>
        </header>

        <Uploader
          loading={loading}
          drag={drag}
          compact={records.length > 0}
          onPick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          style={{ display: 'none' }}
          data-testid="input-file"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />

        {sources.length > 0 && (
          <div className="sources-strip" data-testid="sources-strip">
            {sources.map(s => (
              <span className="source-pill" key={s.name} data-testid={`source-${s.name}`}>
                <span className="dot" />
                <span title={s.name}>{shortName(s.name)}</span>
                <span style={{ color: 'var(--fg-dim)' }}>· {s.recordCount}</span>
                <button
                  aria-label={`Retirer ${s.name}`}
                  data-testid={`btn-remove-${s.name}`}
                  onClick={() => removeSource(s.name)}
                >×</button>
              </span>
            ))}
          </div>
        )}

        <div className="sidebar-nav-block">
          <nav className="seg" role="tablist" aria-label="Catégories">
            <button
              role="tab"
              aria-selected={tab === 'recherche'}
              data-testid="tab-recherche"
              title="Planning individuel"
              aria-label="Planning individuel"
              onClick={() => setTab('recherche')}
            >
              <IconSearch />
              <span className="tab-label-full">Planning individuel</span>
              <span className="tab-label-short">Planning indiv.</span>
            </button>
            <button
              role="tab"
              aria-selected={tab === 'daily'}
              data-testid="tab-daily"
              onClick={() => setTab('daily')}
            >
              <IconCalendar />
              <span className="tab-label-full">Vue globale</span>
              <span className="tab-label-short">Vue globale</span>
            </button>
          </nav>
        </div>

        {records.length > 0 && activeDate && tab === 'recherche' && (
          <TechFinder records={records} activeDate={activeDate} />
        )}
      </aside>

      <main className="app-main">
        {error && (
          <div className="banner-error" role="alert" data-testid="error-banner" style={{ marginBottom: 16 }}>
            <div>{error}</div>
            {errorHint === 'safari' && (
              <div style={{ marginTop: 8, fontSize: 13 }}>
                <a
                  href={typeof window !== 'undefined' ? window.location.href : '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'inherit', textDecoration: 'underline' }}
                  data-testid="link-open-safari"
                >
                  Ouvrir dans le navigateur →
                </a>
              </div>
            )}
          </div>
        )}

        {records.length > 0 && tab === 'daily' && (
          <div className="main-date-bar" style={{ marginBottom: 16 }}>
            <DailyDateBar
              records={records}
              date={dailyDate}
              onDateChange={setDailyDate}
            />
          </div>
        )}

        <div className="main-content-panel">
          {records.length === 0 ? (
            <EmptyAllPanel />
          ) : tab === 'recherche' ? (
            <RecherchePanel records={records} />
          ) : (
            <DailyPanel records={records} date={dailyDate} onDateChange={setDailyDate} />
          )}
        </div>

        <footer className="app-footer-notice" data-testid="text-footer-notice" aria-label="Mention de fiabilité">
          <div className="footer-smoke-bg" aria-hidden="true">
            <div className="footer-smoke-cloud footer-smoke-cloud-1" />
            <div className="footer-smoke-cloud footer-smoke-cloud-2" />
          </div>
          <div className="footer-warning-card">
            <span className="warning-text">
              <strong style={{ color: 'var(--amber)', marginRight: '6px' }}>⚠️ ATTENTION :</strong>
              Contrôle obligatoire sur UKG personnel. L'affectation des formations (FO) est donnée à titre indicatif et peut varier. Données traitées localement.
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}

function shortName(n: string): string {
  let name = n.replace(/\.pdf$/i, '');
  name = name.replace(/planning/i, '');
  name = name.replace(/semaine/i, 'S');
  name = name.replace(/week/i, 'W');
  name = name.replace(/sem/i, 'S');
  name = name.replace(/[\s\-_]+/g, ' ').trim();
  name = name.replace(/s\s*(\d+)/i, 'S$1');
  return name || n;
}

function Uploader({
  loading, drag, compact, onPick, onDragOver, onDragLeave, onDrop,
}: {
  loading: boolean; drag: boolean; compact: boolean;
  onPick: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const cta = loading
    ? 'Lecture...'
    : compact
      ? 'Ajouter PDF Chronos'
      : 'Importer PDF Chronos';

  return (
    <div
      className="uploader"
      data-drag={drag ? 'true' : 'false'}
      data-testid="uploader"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', padding: compact ? '12px' : '24px 16px' }}
    >
      <button
        className={'btn' + (compact ? ' btn-sm' : '')}
        onClick={onPick}
        disabled={loading}
        data-testid="btn-pick"
        style={{ width: '100%', maxWidth: '280px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
      >
        {loading && <span className="spinner" style={{ borderColor: 'rgba(0,0,0,0.1)', borderTopColor: 'currentColor' }} />}
        {cta}
      </button>
    </div>
  );
}

function RecherchePanel({ records }: { records: PlanningRecord[] }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const employees = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) set.add(r.employee);
    return Array.from(set).sort((a, b) => prettyName(a).localeCompare(prettyName(b), 'fr'));
  }, [records]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    const tokens = q.split(/\s+/).filter(Boolean);
    return employees.filter(n => {
      const hay = searchHaystack(n);
      return tokens.every(t => hay.includes(t));
    });
  }, [employees, query]);

  if (selected) {
    return (
      <EmployeeDetail
        name={selected}
        records={records.filter(r => r.employee === selected)}
        allRecords={records}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div data-testid="panel-recherche">
      <div className="search-wrap" style={{ marginBottom: 12 }}>
        <span className="search-icon"><IconSearch /></span>
        <input
          type="search"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Rechercher un technicien…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="input-search"
          aria-label="Rechercher un technicien"
        />
      </div>

      <div className="section-h">
        <div className="section-title">Techniciens</div>
        <div className="section-count" data-testid="text-count-employees">{filtered.length}</div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty" data-testid="empty-search">
          <div className="empty-icon"><IconSearch /></div>
          <div className="empty-title">Aucun résultat</div>
          <div className="empty-sub">Vérifiez l'orthographe ou essayez une partie du nom.</div>
        </div>
      ) : (
        <div className="list" data-testid="list-employees">
          {filtered.map(name => (
            <button
              key={name}
              className="row"
              onClick={() => setSelected(name)}
              data-testid={`row-employee-${name}`}
            >
              <div className="avatar" aria-hidden>{dayInitials(name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row-title">{prettyName(name)}</div>
                <div className="row-meta">
                  {countWeeks(records, name)} semaine(s) · {countActiveDays(records, name)} jour(s) actif(s)
                </div>
              </div>
              <span className="row-arrow"><IconChevron /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function titleCaseWord(w: string): string {
  if (!w) return w;
  return w
    .split(/([-'])/)
    .map(part => /^[-']$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

function titleCasePart(s: string): string {
  return s.trim().split(/\s+/).map(titleCaseWord).join(' ');
}

function prettyName(s: string): string {
  const idx = s.indexOf(',');
  if (idx === -1) {
    return titleCasePart(s);
  }
  const last = titleCasePart(s.slice(0, idx));
  const first = titleCasePart(s.slice(idx + 1));
  if (!first) return last;
  if (!last) return first;
  return `${first} ${last}`;
}

function searchHaystack(s: string): string {
  const pretty = prettyName(s);
  const idx = s.indexOf(',');
  let reversed = '';
  if (idx !== -1) {
    const last = s.slice(0, idx).trim();
    const first = s.slice(idx + 1).trim();
    reversed = `${first} ${last}`;
  }
  return `${s} ${pretty} ${reversed}`.toLowerCase();
}

function countWeeks(records: PlanningRecord[], name: string): number {
  const set = new Set<string>();
  for (const r of records) if (r.employee === name) set.add(r.weekLabel);
  return set.size;
}
function countActiveDays(records: PlanningRecord[], name: string): number {
  let n = 0;
  for (const r of records) if (r.employee === name && r.time !== 'OFF') n++;
  return n;
}

function EmployeeDetail({ name, records, allRecords, onBack }: {
  name: string; records: PlanningRecord[]; allRecords?: PlanningRecord[]; onBack: () => void;
}) {
  useEffect(() => {
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
  }, [name]);
  
  const byWeek = useMemo(() => {
    const m = new Map<string, PlanningRecord[]>();
    for (const r of records) {
      if (!m.has(r.weekLabel)) m.set(r.weekLabel, []);
      m.get(r.weekLabel)!.push(r);
    }
    for (const [, arr] of m) arr.sort((a, b) => a.date.localeCompare(b.date));
    return Array.from(m.entries()).sort((a, b) => a[1][0].date.localeCompare(b[1][0].date));
  }, [records]);

  const active = records.filter(r => r.time !== 'OFF').length;
  const total = records.length;

  const [openScene, setOpenScene] = useState<{ date: string; scene: string } | null>(null);
  const [openEmployee, setOpenEmployee] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const dayAssocMap = useMemo(() => {
    if (!allRecords) return new Map<string, string[]>();
    return computeAllFOAssociations(allRecords);
  }, [allRecords]);

  const handleExportIndiv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportEmployeePdf(name, allRecords ?? records);
    } catch (e) {
      console.error('PDF export failed', e);
    } finally {
      setExporting(false);
    }
  };

  const teamForOpen = useMemo(() => {
    if (!openScene || !allRecords) return [];
    const dayRecs = allRecords.filter(r => r.date === openScene.date && r.time !== 'OFF');
    const activeRegs = dayRecs.filter(r => !isTrainingScene(r.scene));
    const activeFOs = dayRecs.filter(r => isTrainingScene(r.scene));
    const dayAssoc = getFOAssociations(dayRecs);
    
    const result: Array<PlanningRecord & { isFOVirtual?: boolean; assocScenes?: string[]; originalScene?: string }> = [...activeRegs];
    for (const fo of activeFOs) {
      const assoc = dayAssoc.get(fo.employee) ?? [];
      result.push({ ...fo, assocScenes: assoc, originalScene: fo.scene });
      for (const scene of assoc) {
        result.push({ ...fo, scene, isFOVirtual: true, assocScenes: assoc, originalScene: fo.scene });
      }
    }
    
    return result
      .filter(r => r.scene === openScene.scene)
      .sort((a, b) => prettyName(a.employee).localeCompare(prettyName(b.employee), 'fr'));
  }, [openScene, allRecords]);

  if (openEmployee && allRecords) {
    return (
      <EmployeeDetail
        name={openEmployee}
        records={allRecords.filter(r => r.employee === openEmployee)}
        allRecords={allRecords}
        onBack={() => setOpenEmployee(null)}
      />
    );
  }

  if (openScene) {
    return (
      <SceneDetail
        scene={openScene.scene}
        date={openScene.date}
        team={teamForOpen}
        onBack={() => setOpenScene(null)}
        onViewEmployee={(emp) => setOpenEmployee(emp)}
      />
    );
  }

  const canOpenScene = !!allRecords;

  return (
    <div data-testid="panel-employee">
      <button className="btn-link" onClick={onBack} data-testid="btn-back-employees">
        ← Retour
      </button>
      <div className="card" style={{ marginTop: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="avatar" style={{ width: 44, height: 44, fontSize: 14 }}>{dayInitials(name)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17 }} data-testid="text-employee-name">
              {prettyName(name)}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', marginTop: 2 }}>
              {active}/{total} jours travaillés sur {byWeek.length} semaine(s)
            </div>
          </div>
          <button
            type="button"
            className="btn-export"
            data-testid="btn-export-indiv"
            aria-label={`Exporter le planning de ${prettyName(name)} en PDF`}
            title="Exporter en PDF"
            disabled={exporting || records.length === 0}
            onClick={handleExportIndiv}
          >
            <IconDownload />
            <span>{exporting ? 'Génération…' : 'Export PDF'}</span>
          </button>
        </div>
      </div>

      {byWeek.map(([weekLabel, weekRecs]) => (
        <div className="week-block" key={weekLabel} data-testid={`week-${weekLabel}`}>
          <div className="week-head">
            <div className="week-name">{weekLabel}</div>
            <div className="week-range">
              {weekRecs.filter(r => r.time !== 'OFF').length}/7 jours
            </div>
          </div>
          {weekRecs.map(rec => {
            const key = getFOAssociationKey(rec.date, rec.employee);
            const assoc = dayAssocMap.get(key) ?? [];
            return (
              <DayCard
                key={rec.date}
                rec={rec}
                assocScenes={assoc}
                onOpenScene={canOpenScene ? () => setOpenScene({ date: rec.date, scene: rec.scene }) : undefined}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function DayCard({ rec, assocScenes, onOpenScene }: { rec: PlanningRecord; assocScenes?: string[]; onOpenScene?: () => void }) {
  const isOff = rec.time === 'OFF';
  const dayPart = rec.date.split('-')[2];
  const interactive = !isOff && !!onOpenScene && !!rec.scene;
  const handleClick = () => { if (interactive) onOpenScene!(); };
  const handleKey = (e: React.KeyboardEvent) => {
    if (!interactive) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpenScene!();
    }
  };
  return (
    <div
      className="day-card"
      data-off={isOff ? 'true' : 'false'}
      data-interactive={interactive ? 'true' : 'false'}
      data-testid={`day-${rec.date}`}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `Voir l'équipe de ${rec.scene} le ${formatDateLong(rec.date)}` : undefined}
      onClick={interactive ? handleClick : undefined}
      onKeyDown={interactive ? handleKey : undefined}
      style={interactive ? { cursor: 'pointer' } : undefined}
    >
      <div className="day-tag">
        <span className="d">{DAY_FR_SHORT[rec.day] ?? rec.day.slice(0, 3).toUpperCase()}</span>
        <span className="n">{dayPart}</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          className={'day-scene' + (isOff ? ' off' : '')}
          data-testid={`scene-${rec.date}`}
          style={!isOff ? { borderLeft: `3.5px solid ${getSceneColor(rec.scene).accent}`, paddingLeft: 6, borderRadius: '2px 0 0 2px' } : undefined}
        >
          {isOff ? 'Repos / congé' : isTrainingScene(rec.scene) ? `🎓 ${rec.scene}` : rec.scene}
        </div>
        {assocScenes && assocScenes.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 500, marginTop: 2 }}>
            Associé à : {assocScenes.join(', ')}
          </div>
        )}
        <div className="row-meta" style={{ marginTop: 2 }}>
          {formatDateLong(rec.date)}
        </div>
      </div>
      <span
        className={timePillClass(rec.time, rec.scene, isTrainingScene(rec.scene))}
        data-testid={`time-${rec.date}`}
        aria-hidden={interactive ? 'true' : undefined}
      >
        {isOff ? 'OFF' : rec.time}
      </span>
    </div>
  );
}

function SceneDetail({ scene, date, team, onBack, onViewEmployee }: {
  scene: string; date: string; team: PlanningRecord[]; onBack: () => void; onViewEmployee: (employee: string) => void;
}) {
  return (
    <div data-testid="panel-scene-detail">
      <button className="btn-link" onClick={onBack} data-testid="btn-back-scenes">← Retour</button>
      <div className="card" style={{ marginTop: 8, marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17, overflowWrap: 'anywhere' }}
             data-testid="text-scene-name">
          {scene}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', marginTop: 2 }}>
          {formatDateLong(date)} · {team.length} technicien(s)
        </div>
      </div>

      {team.length === 0 ? (
        <div className="empty"><div className="empty-title">Personne sur cette scène ce jour.</div></div>
      ) : (
        <div className="list" data-testid="list-team">
          {team.map(rec => {
            const isFOVirtual = (rec as any).isFOVirtual;
            const assocScenes = (rec as any).assocScenes;
            const originalScene = (rec as any).originalScene;
            const isFO = isTrainingScene(rec.scene) || isFOVirtual;
            return (
              <div className="team-row" key={rec.employee} data-testid={`team-${rec.employee}`}>
                <div className="avatar" aria-hidden>{dayInitials(rec.employee)}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="team-name">
                    {isFOVirtual ? `🎓 ` : ''}{prettyName(rec.employee)}
                  </div>
                  <div className="team-meta">
                    {rec.weekLabel}
                    {isTrainingScene(rec.scene) && assocScenes && assocScenes.length > 0 && ` · Associé à : ${assocScenes.join(', ')}`}
                    {isFOVirtual && originalScene && ` · En formation (${originalScene})`}
                  </div>
                </div>
                <span className={timePillClass(rec.time, rec.scene, isFO)}>{rec.time}</span>
                <button
                  type="button"
                  className="btn-eye"
                  aria-label={`Voir le planning de ${prettyName(rec.employee)}`}
                  data-testid={`btn-view-employee-${rec.employee}`}
                  onClick={() => onViewEmployee(rec.employee)}
                >
                  <IconEye />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DailyDateBar({ records, date, onDateChange }: {
  records: PlanningRecord[]; date: string; onDateChange: (d: string) => void;
}) {
  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) if (r.date) set.add(r.date);
    return Array.from(set).sort();
  }, [records]);

  useEffect(() => {
    if (dates.length === 0) return;
    if (!date || !dates.includes(date)) onDateChange(dates[0]);
  }, [dates, date, onDateChange]);

  if (dates.length === 0) return null;

  return (
    <div className="daily-date-bar" data-testid="daily-date-bar">
      <DatePicker dates={dates} date={date} records={records} onChange={onDateChange} />
    </div>
  );
}

function DailyPanel({ records, date, onDateChange: _onDateChange }: { records: PlanningRecord[]; date: string; onDateChange: (d: string) => void }) {
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [openScene, setOpenScene] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);

  useEffect(() => {
    setOpenScene(null);
  }, [date]);

  const present = useMemo(() => {
    const dayRecs = records.filter(r => r.date === date && r.time !== 'OFF');
    const activeRegs = dayRecs.filter(r => !isTrainingScene(r.scene));
    const activeFOs = dayRecs.filter(r => isTrainingScene(r.scene));

    const dayAssoc = getFOAssociations(dayRecs);
    const result: Array<PlanningRecord & { isFOVirtual?: boolean; assocScenes?: string[]; originalScene?: string }> = [...activeRegs];
    
    for (const fo of activeFOs) {
      const assoc = dayAssoc.get(fo.employee) ?? [];
      result.push({
        ...fo,
        assocScenes: assoc,
        originalScene: fo.scene
      });
      
      for (const scene of assoc) {
        result.push({
          ...fo,
          scene,
          isFOVirtual: true,
          assocScenes: assoc,
          originalScene: fo.scene
        });
      }
    }

    return result.sort((a, b) => {
      const byScene = a.scene.localeCompare(b.scene, 'fr');
      if (byScene !== 0) return byScene;
      return prettyName(a.employee).localeCompare(prettyName(b.employee), 'fr');
    });
  }, [records, date]);

  const byScene = useMemo(() => {
    const groups = new Map<string, Array<PlanningRecord & { isFOVirtual?: boolean; assocScenes?: string[]; originalScene?: string }>>();
    for (const rec of present) {
      if (!groups.has(rec.scene)) groups.set(rec.scene, []);
      groups.get(rec.scene)!.push(rec);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], 'fr'));
  }, [present]);

  const uniqueTechs = useMemo(() => {
    return new Set(present.filter(r => !r.isFOVirtual).map(r => r.employee)).size;
  }, [present]);

  const activeFOsCount = useMemo(() => {
    return present.filter(r => isTrainingScene(r.originalScene || r.scene) && !r.isFOVirtual).length;
  }, [present]);

  const sceneTeam = useMemo(() => {
    if (!openScene) return [];
    return present.filter(r => r.scene === openScene);
  }, [openScene, present]);

  if (selectedEmployee) {
    return (
      <EmployeeDetail
        name={selectedEmployee}
        records={records.filter(r => r.employee === selectedEmployee)}
        allRecords={records}
        onBack={() => setSelectedEmployee(null)}
      />
    );
  }

  return (
    <div data-testid="panel-daily">
      {openScene ? (
        <SceneDetail
          scene={openScene}
          date={date}
          team={sceneTeam}
          onBack={() => setOpenScene(null)}
          onViewEmployee={(emp) => setSelectedEmployee(emp)}
        />
      ) : (
        <>
          <div className="stats-grid" data-testid="stats-grid" style={{ marginBottom: 16 }}>
            <div className="stat-card">
              <div className="stat-value">{uniqueTechs}</div>
              <div className="stat-label">Techniciens actifs</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{byScene.length}</div>
              <div className="stat-label">Scènes & FO</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{activeFOsCount}</div>
              <div className="stat-label">En formation (FO)</div>
            </div>
          </div>

          <div className="section-h" style={{ marginTop: 6 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="section-title" style={{ textTransform: 'capitalize' }}>{formatDateLong(date)}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className="btn-export"
                data-testid="btn-export-pdf"
                aria-label="Exporter en PDF"
                onClick={() => setShowExport(true)}
              >
                <IconDownload />
                <span>Export PDF</span>
              </button>
              <div className="section-count" data-testid="text-count-daily">{present.length}</div>
            </div>
          </div>

          {showExport && (
            <ExportDialog
              records={records}
              date={date}
              onClose={() => setShowExport(false)}
            />
          )}

          {byScene.length === 0 ? (
            <div className="empty" data-testid="empty-daily">
              <div className="empty-icon"><IconCalendar /></div>
              <div className="empty-title">Personne présent ce jour</div>
              <div className="empty-sub">Aucun technicien avec une scène planifiée sur cette date.</div>
            </div>
          ) : (
            <div className="daily-groups" data-testid="list-daily-scenes">
              {byScene.map(([scene, sceneRecords], sIndex) => (
                <section
                  className="daily-scene-group animate-fade-in"
                  key={scene}
                  data-testid={`scene-group-${scene}`}
                  style={{ animationDelay: `${sIndex * 0.05}s` }}
                >
                  <button
                    type="button"
                    className="daily-group-head"
                    data-testid={`scene-card-${scene}`}
                    onClick={() => setOpenScene(scene)}
                    style={{ 
                      width: '100%', 
                      cursor: 'pointer', 
                      background: `linear-gradient(90deg, ${getSceneColor(scene).accent}30, transparent)`,
                      borderLeft: `4.5px solid ${getSceneColor(scene).accent}` 
                    }}
                  >
                    <div className="daily-group-scene">{scene}</div>
                    <span className="daily-group-count" aria-hidden="true">{sceneRecords.length}</span>
                  </button>
                  <div className="compact-list" data-testid={`scene-team-${scene}`}>
                    {sceneRecords.map(rec => {
                      const isFOVirtual = (rec as any).isFOVirtual;
                      const assocScenes = (rec as any).assocScenes;
                      const originalScene = (rec as any).originalScene;
                      const isFO = isTrainingScene(rec.scene) || isFOVirtual;
                      return (
                        <div
                          className="compact-team-row"
                          key={`${rec.employee}-${rec.date}`}
                          data-testid={`scene-tech-${scene}-${rec.employee}`}
                        >
                          <div className="avatar compact-avatar" aria-hidden>{dayInitials(rec.employee)}</div>
                          <div style={{ minWidth: 0 }}>
                            <div className="team-name compact-name">
                              {isFOVirtual ? `🎓 ` : ''}{prettyName(rec.employee)}
                            </div>
                            <div className="team-meta compact-meta">
                              {rec.weekLabel}
                              {isTrainingScene(rec.scene) && assocScenes && assocScenes.length > 0 && ` · ${assocScenes.join(', ')}`}
                              {isFOVirtual && originalScene && ` · En formation (${originalScene})`}
                            </div>
                          </div>
                          <span className={timePillClass(rec.time, rec.scene, isFO)}>{rec.time}</span>
                          <button
                            type="button"
                            className="btn-eye compact-eye"
                            data-testid={`btn-view-tech-${rec.employee}`}
                            onClick={() => setSelectedEmployee(rec.employee)}
                          >
                            <IconEye />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DatePicker({ dates, date, records, onChange }: {
  dates: string[]; date: string; records: PlanningRecord[]; onChange: (date: string) => void;
}) {
  return (
    <div className="date-row" role="tablist" data-testid="date-row">
      {dates.map(d => {
        const sel = d === date;
        const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const dn = m ? m[3] : d;
        const mo = m ? (MONTH_FR[m[2]] ?? m[2]) : '';
        const day = records.find(r => r.date === d)?.day ?? '';
        return (
          <button
            key={d}
            role="tab"
            aria-selected={sel}
            className="date-pill"
            data-testid={`date-pill-${d}`}
            onClick={() => onChange(d)}
          >
            <span className="dpd">{DAY_FR_SHORT[day] ?? ''}</span>
            <span className="dpn">{dn}</span>
            <span className="dpm">{mo}</span>
          </button>
        );
      })}
    </div>
  );
}

function TechFinder({ records, activeDate }: { records: PlanningRecord[]; activeDate: string }) {
  const [query, setQuery] = useState('');

  const result = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    if (!activeDate) {
      return { kind: 'no-date' as const };
    }
    const tokens = q.split(/\s+/).filter(Boolean);
    const dayAllRecs = records.filter(r => r.date === activeDate && r.time !== 'OFF');
    const dayAssoc = getFOAssociations(dayAllRecs);
    const dayRecs = dayAllRecs
      .filter(r => tokens.every(t => searchHaystack(r.employee).includes(t)))
      .map(r => ({
        ...r,
        assocScenes: dayAssoc.get(r.employee)
      }));
    if (dayRecs.length === 0) {
      return { kind: 'off' as const };
    }
    return { kind: 'found' as const, recs: dayRecs };
  }, [query, activeDate, records]);

  return (
    <div className="tech-finder" data-testid="tech-finder">
      <div className="tech-finder-input-wrap">
        <span className="tech-finder-icon" aria-hidden><IconSearch /></span>
        <input
          type="search"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Vérifier un technicien…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="input-tech-finder"
        />
        {query && (
          <button
            type="button"
            className="tech-finder-clear"
            data-testid="btn-tech-finder-clear"
            onClick={() => setQuery('')}
          >×</button>
        )}
      </div>
      {result && (
        <div className="tech-finder-result" data-testid="tech-finder-result">
          {result.kind === 'no-date' ? (
            <div className="tf-status-card tf-card-info">
              <span className="tf-status-icon"><IconCalendar /></span>
              <span className="tf-status-text">
                Choisissez une date dans Vue globale.
              </span>
            </div>
          ) : result.kind === 'off' ? (
            <div className="tf-status-card tf-card-off" data-testid="tf-off">
              <span className="tf-status-icon"><IconMoon /></span>
              <span className="tf-status-text">la personne est OFF</span>
            </div>
          ) : (
            <div className="tf-found-list">
              {result.recs.map(rec => {
                const isFO = isTrainingScene(rec.scene);
                const assocScenes = (rec as any).assocScenes;
                return (
                  <div className="tf-found-row" key={`${rec.employee}-${rec.date}`} data-testid={`tf-found-${rec.employee}`}>
                    <span className="tf-name">
                      {isFO ? `🎓 ` : ''}{prettyName(rec.employee)}
                    </span>
                    <span className={timePillClass(rec.time, rec.scene, isFO)}>{rec.time}</span>
                    <span className="tf-scene" title={rec.scene}>
                      {isFO && assocScenes && assocScenes.length > 0 ? `${rec.scene} (${assocScenes.join(', ')})` : rec.scene}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyAllPanel() {
  return <div className="empty" data-testid="empty-root" />;
}

function ExportDialog({ records, date, onClose }: { records: PlanningRecord[]; date: string; onClose: () => void }) {
  const [mode, setMode] = useState<'day' | 'scene' | 'global'>('day');
  const scenes = useMemo(() => listScenes(records), [records]);
  const [selectedScene, setSelectedScene] = useState<string>(() => scenes[0] ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleExport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (mode === 'day') {
        await exportDayPdf(date, records);
      } else if (mode === 'scene' && selectedScene) {
        await exportScenePdf(selectedScene, records);
      } else if (mode === 'global') {
        await exportGlobalRecapPdf(records);
      }
      onClose();
    } catch (e) {
      console.error('PDF export failed', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="export-overlay" data-testid="export-overlay" onClick={onClose}>
      <div className="export-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="export-head">
          <div className="export-title">Exporter en PDF</div>
          <button type="button" className="export-close" aria-label="Fermer" onClick={onClose}>×</button>
        </div>
        <div className="export-body">
          <button
            type="button"
            className={'export-opt' + (mode === 'day' ? ' on' : '')}
            onClick={() => setMode('day')}
          >
            <span className="export-opt-title">Journée du {formatDateLong(date)}</span>
            <span className="export-opt-sub">Format cartes par scènes / équipes (très lisible)</span>
          </button>
          <button
            type="button"
            className={'export-opt' + (mode === 'scene' ? ' on' : '')}
            onClick={() => setMode('scene')}
          >
            <span className="export-opt-title">Scène sur période</span>
            <span className="export-opt-sub">Une scène sur toutes les dates importées</span>
          </button>
          {mode === 'scene' && (
            <select
              className="export-scene-select"
              value={selectedScene}
              onChange={(e) => setSelectedScene(e.target.value)}
            >
              {scenes.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
        <div className="export-foot">
          <button type="button" className="btn-link" onClick={onClose}>Annuler</button>
          <button
            type="button"
            className="btn"
            disabled={busy || (mode === 'scene' && !selectedScene)}
            onClick={handleExport}
          >
            {busy ? 'Génération…' : 'Exporter'}
          </button>
        </div>
      </div>
    </div>
  );
}

function IconSearch() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2v4M16 2v4M3 10h18" />
      <rect x="3" y="4" width="18" height="18" rx="3" />
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
    </svg>
  );
}
function IconChevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
function IconMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}
function IconDownload() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
    </svg>
  );
}
function IconEye() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function Logo() {
  const logoSrc = `${import.meta.env.BASE_URL}sfx-dragon-logo.jpg`;
  return (
    <img className="logo-img" src={logoSrc} alt="" width="56" height="56" decoding="async" aria-hidden="true" />
  );
}

interface FireworkParticle {
  x: number; y: number; vx: number; vy: number; color: string; alpha: number; decay: number; size: number;
}
interface FireworkRocket {
  x: number; y: number; tx: number; ty: number; vx: number; vy: number; color: string; size: number;
}

function FireworksCanvas({ triggerCount }: { triggerCount: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<FireworkParticle[]>([]);
  const rocketsRef = useRef<FireworkRocket[]>([]);
  const animationFrameId = useRef<number | null>(null);

  const colors = ['#ff3366', '#ff9933', '#ffff33', '#33ff66', '#33ccff', '#cc33ff', '#ff00aa', '#00ffcc'];

  const spawnExplosion = useCallback((x: number, y: number, color?: string) => {
    const count = 40 + Math.floor(Math.random() * 30);
    const baseColor = color || colors[Math.floor(Math.random() * colors.length)];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 4.5;
      particlesRef.current.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 0.5, color: baseColor, alpha: 1, decay: 0.012 + Math.random() * 0.015, size: 1 + Math.random() * 2 });
    }
  }, [colors]);

  const spawnRocket = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const tx = 100 + Math.random() * (canvas.width - 200); const ty = 80 + Math.random() * (canvas.height * 0.4);
    const x = tx + (Math.random() - 0.5) * 50; const y = canvas.height;
    const dy = ty - y; const dx = tx - x; const duration = 40 + Math.random() * 20;
    rocketsRef.current.push({ x, y, tx, ty, vx: dx / duration, vy: dy / duration, color: colors[Math.floor(Math.random() * colors.length)], size: 2.2 });
  }, [colors]);

  useEffect(() => {
    if (triggerCount > 0) {
      let count = 4 + Math.floor(Math.random() * 3);
      const interval = setInterval(() => { spawnRocket(); count--; if (count <= 0) clearInterval(interval); }, 150);
    }
  }, [triggerCount, spawnRocket]);

  const spawnSparkle = useCallback((x: number, y: number) => {
    const count = 4 + Math.floor(Math.random() * 3);
    const sparkleColors = ['#ffb03a', '#ffe066', '#fff8dc', '#00e5c6'];
    const color = sparkleColors[Math.floor(Math.random() * sparkleColors.length)];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.6 + Math.random() * 1.8;
      particlesRef.current.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.8,
        color,
        alpha: 0.85,
        decay: 0.06 + Math.random() * 0.06,
        size: 0.8 + Math.random() * 1.2
      });
    }
  }, []);

  useEffect(() => {
    const isInteractive = (target: EventTarget | null): boolean => {
      let el = target as HTMLElement | null;
      while (el) {
        if (
          el.tagName === 'BUTTON' ||
          el.tagName === 'INPUT' ||
          el.tagName === 'SELECT' ||
          el.tagName === 'A' ||
          el.tagName === 'LABEL' ||
          (el.classList && (
            el.classList.contains('date-pill') ||
            el.classList.contains('seg') ||
            el.classList.contains('btn') ||
            el.classList.contains('day-card') ||
            el.classList.contains('export-opt') ||
            el.classList.contains('row') ||
            el.classList.contains('compact-team-row')
          ))
        ) return true;
        el = el.parentElement;
      }
      return false;
    };

    // Desktop click
    const handleMouseDown = (e: MouseEvent) => {
      if (isInteractive(e.target)) return;
      spawnSparkle(e.clientX, e.clientY);
    };

    // Mobile tap — only fire if finger didn't move (not a scroll)
    let touchStartX = 0;
    let touchStartY = 0;
    const handleTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) { touchStartX = t.clientX; touchStartY = t.clientY; }
    };
    const handleTouchEnd = (e: TouchEvent) => {
      if (isInteractive(e.target)) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = Math.abs(t.clientX - touchStartX);
      const dy = Math.abs(t.clientY - touchStartY);
      if (dx < 12 && dy < 12) spawnSparkle(t.clientX, t.clientY);
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [spawnSparkle]);


  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return; const ctx = canvas.getContext('2d'); if (!ctx) return;
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize(); window.addEventListener('resize', resize);

    const update = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const rockets = rocketsRef.current;
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]; r.x += r.vx; r.y += r.vy;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.size, 0, Math.PI * 2); ctx.fillStyle = r.color; ctx.shadowColor = r.color; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0;
        if (r.vy >= 0 || r.y <= r.ty) { spawnExplosion(r.x, r.y, r.color); rockets.splice(i, 1); }
      }
      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]; p.x += p.vx; p.y += p.vy; p.vy += 0.045; p.vx *= 0.985; p.vy *= 0.985; p.alpha -= p.decay;
        if (p.alpha <= 0) { particles.splice(i, 1); continue; }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.globalAlpha = p.alpha; ctx.shadowColor = p.color; ctx.shadowBlur = 4; ctx.fill(); ctx.shadowBlur = 0; ctx.globalAlpha = 1.0;
      }
      animationFrameId.current = requestAnimationFrame(update);
    };
    animationFrameId.current = requestAnimationFrame(update);
    return () => { window.removeEventListener('resize', resize); if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current); };
  }, [spawnExplosion]);

  return (
    <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 9999 }} />
  );
}
