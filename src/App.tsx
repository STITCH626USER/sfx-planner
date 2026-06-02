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
          'Cette page est ouverte dans une app (WhatsApp, etc.) qui limite la lecture des PDF. Ouvre le lien dans Safari pour importer ton planning. Détail : ' + raw,
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
                Contrôle obligatoire sur UKG personnel. Données traitées localement.
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

        {records.length > 0 && activeDate && (
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
              Contrôle obligatoire sur UKG personnel. Données traitées localement.
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
 