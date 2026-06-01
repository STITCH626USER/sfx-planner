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
  // Take first letters of two name parts (e.g. "AIRIAU, CEDRICK" → "AC")
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
  const [tab, setTab] = useState<Tab>('recherche');
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  const [records, setRecords] = useState<PlanningRecord[]>([]);
  const [sources, setSources] = useState<SourceFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<'safari' | null>(null);
  const [drag, setDrag] = useState(false);
  const [dailyDate, setDailyDate] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const activeDate = tab === 'daily' ? dailyDate : '';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

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
          'Cette page est ouverte dans une app (WhatsApp, Instagram, etc.) qui ' +
          'limite la lecture des PDF. Ouvre le lien dans Safari pour importer ton ' +
          'planning. Détail : ' + raw,
        );
        setErrorHint('safari');
      } else if (isIOS) {
        setError(
          'Impossible de lire ce PDF sur cet iPhone. Essaie de l’ouvrir d’abord ' +
          'dans l’app Fichiers puis « Partager → SFX Planner », ou ouvre la page ' +
          'depuis Safari. Détail : ' + raw,
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
        <div className="empty-landing-card">
          <header className="landing-header">
            <button
              type="button"
              className="landing-logo-wrap"
              aria-label={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
              title="Changer le mode d’affichage"
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
                Contrôle obligatoire sur UKG personnel. Le placement des formations peut varier. Données traitées localement.
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell" data-testid="app-root">
      <aside className="app-sidebar">
        <header className="app-header">
          <button
            type="button"
            className="app-logo"
            aria-label={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
            title="Changer le mode d’affichage"
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
                <div style={{ marginTop: 4, opacity: 0.85 }}>
                  Astuce : bouton Partager <span aria-hidden>↑</span> puis « Ouvrir dans Safari ».
                </div>
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
          <div className="footer-warning-card">
            <span className="warning-text">
              <strong style={{ color: 'var(--amber)', marginRight: '6px' }}>⚠️ ATTENTION :</strong>
              Contrôle obligatoire sur UKG personnel. Le placement des formations peut varier. Données traitées localement.
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

/* ---------- Uploader ---------- */
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

/* ---------- Recherche (employee search) ---------- */

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
  // Preserve hyphens and apostrophes as separators within a word.
  return w
    .split(/([-'])/)
    .map(part => /^[-']$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

function titleCasePart(s: string): string {
  return s.trim().split(/\s+/).map(titleCaseWord).join(' ');
}

function prettyName(s: string): string {
  // "SERRANO, FLORIAN" → "Florian Serrano"
  // "AIRIAU, CEDRICK" → "Cedrick Airiau"
  // "JEAN-MARIE, ANNE" → "Anne Jean-Marie"
  // Falls back gracefully if no comma is present.
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
  // Build a haystack that lets users match "Prénom", "Nom", "Prénom Nom" or "Nom Prénom".
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
  // Group by weekLabel
  const byWeek = useMemo(() => {
    const m = new Map<string, PlanningRecord[]>();
    for (const r of records) {
      if (!m.has(r.weekLabel)) m.set(r.weekLabel, []);
      m.get(r.weekLabel)!.push(r);
    }
    // sort within each week by date
    for (const [, arr] of m) arr.sort((a, b) => a.date.localeCompare(b.date));
    // sort weeks by first date
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

/* ---------- Scene detail (used from EmployeeDetail when tapping a day card) ---------- */

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

/* ---------- Sticky daily date bar (rendered inside tabs-block) ---------- */
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

/* ---------- Vue globale journalière ---------- */

function DailyPanel({ records, date, onDateChange }: { records: PlanningRecord[]; date: string; onDateChange: (d: string) => void }) {
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [openScene, setOpenScene] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);

  // Reset opened scene when date changes
  useEffect(() => {
    setOpenScene(null);
  }, [date]);

  // Keep parent in charge of date normalization
  void onDateChange;

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
            <div className="section-title">Scènes le {formatDateLong(date)}</div>
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
              {byScene.map(([scene, sceneRecords]) => (
                <section
                  className="daily-scene-group"
                  key={scene}
                  data-testid={`scene-group-${scene}`}
                  aria-label={`Équipe de ${scene} (${sceneRecords.length} personnes)`}
                >
                  <button
                    type="button"
                    className="daily-group-head"
                    data-testid={`scene-card-${scene}`}
                    aria-label={`Ouvrir le détail de ${scene}`}
                    onClick={() => setOpenScene(scene)}
                    style={{ width: '100%', cursor: 'pointer', borderLeft: `4.5px solid ${getSceneColor(scene).accent}` }}
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
                            aria-label={`Voir le planning de ${prettyName(rec.employee)}`}
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

/* ---------- Tech Finder (compact, in tabs block) ---------- */
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
          aria-label="Vérifier la présence d'un technicien"
        />
        {query && (
          <button
            type="button"
            className="tech-finder-clear"
            aria-label="Effacer"
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

/* ---------- Empty all ---------- */
function EmptyAllPanel() {
  return <div className="empty" data-testid="empty-root" />;
}

/* ---------- Icons ---------- */
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

function ExportDialog({ records, date, onClose }: { records: PlanningRecord[]; date: string; onClose: () => void }) {
  const [mode, setMode] = useState<'day' | 'scene' | 'global'>('day');
  const scenes = useMemo(() => listScenes(records), [records]);
  const [selectedScene, setSelectedScene] = useState<string>(() => scenes[0] ?? '');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [busy, setBusy] = useState(false);
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
            aria-pressed={mode === 'day'}
            onClick={() => setMode('day')}
            data-testid="export-mode-day"
          >
            <span className="export-opt-title">Journée sélectionnée</span>
            <span className="export-opt-sub">{formatDateLong(date)} · toutes les scènes</span>
          </button>
          <button
            type="button"
            className={'export-opt' + (mode === 'scene' ? ' on' : '')}
            aria-pressed={mode === 'scene'}
            onClick={() => setMode('scene')}
            data-testid="export-mode-scene"
          >
            <span className="export-opt-title">Scène sur période</span>
            <span className="export-opt-sub">Une scène sur toutes les dates importées</span>
          </button>
          <button
            type="button"
            className={'export-opt' + (mode === 'global' ? ' on' : '')}
            aria-pressed={mode === 'global'}
            onClick={() => setMode('global')}
            data-testid="export-mode-global"
          >
            <span className="export-opt-title">Rapport Roster Hebdomadaire (Tableau)</span>
            <span className="export-opt-sub">Grille tabulaire couleur ultra-lisible (1 page par semaine), aucun technicien masqué</span>
          </button>
          {mode === 'scene' && (
            <select
              className="export-scene-select"
              value={selectedScene}
              onChange={(e) => setSelectedScene(e.target.value)}
              data-testid="export-scene-select"
              aria-label="Sélectionner la scène"
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
            data-testid="btn-export-confirm"
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
    <img
      className="logo-img"
      src={logoSrc}
      alt=""
      width="56"
      height="56"
      decoding="async"
      aria-hidden="true"
    />
  );
}
