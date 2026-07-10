import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parsePdfFile } from './lib/parsePdf';
import type { PlanningRecord } from './lib/parsePdf';
import { exportDayPdf, exportEmployeePdf, exportScenePdf, listScenes, exportGlobalRecapPdf } from './lib/exportPdf';
import { isTrainingScene, getSceneColor, timesMatch } from './lib/utils';
import { MickeyTamagotchiButton, MickeyTamagotchiModal } from './MickeyTamagotchi';


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
  const [captchaSlider, setCaptchaSlider] = useState(0);
  const [globalCaptchaSolved, setGlobalCaptchaSolved] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [tamagotchiOpen, setTamagotchiOpen] = useState(false);

  // PWA Installation state and hooks
  const [pwaPrompt, setPwaPrompt] = useState<any>(null);
  const [showPwaBanner, setShowPwaBanner] = useState(false);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

    if (!isStandalone) {
      const handleInstallPrompt = (e: any) => {
        e.preventDefault();
        setPwaPrompt(e);
        const hasSeenPrompt = sessionStorage.getItem('sfx_pwa_prompt');
        if (!hasSeenPrompt) {
          setShowPwaBanner(true);
          const timer = setTimeout(() => {
            setShowPwaBanner(false);
            sessionStorage.setItem('sfx_pwa_prompt', 'true');
          }, 12000);
          return () => clearTimeout(timer);
        }
      };
      window.addEventListener('beforeinstallprompt', handleInstallPrompt);
      return () => window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
    }
  }, []);

  const handleInstallClick = () => {
    if (pwaPrompt) {
      pwaPrompt.prompt();
      pwaPrompt.userChoice.then((choice: any) => {
        if (choice.outcome === 'accepted') {
          console.log('PWA installation accepted');
        }
        setPwaPrompt(null);
        setShowPwaBanner(false);
      });
    }
  };



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
      setRecords(prev => {
        return [...prev, ...newRecs];
      });
      setSources(prev => [...prev, ...newSrcs]);
      if (ignored > 0) {
        setError(`${ignored} fichier(s) non-PDF ignoré(s).`);
      }
    } catch (e: unknown) {
      console.error(e);
      const raw = e instanceof Error ? e.message : String(e ?? 'inconnue');
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

  const resetAll = useCallback(() => {
    setRecords([]);
    setSources([]);
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
            <h1 className="landing-title">SFX Planner 3000</h1>
          </header>
          
          <div className="landing-uploader-wrap" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Uploader
              loading={loading}
              drag={drag}
              compact={false}
              onPick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
            />
            <MickeyTamagotchiButton onClick={() => setTamagotchiOpen(true)} />
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
                <strong style={{ color: 'var(--amber)' }}>⚠️</strong>
                Contrôle obligatoire sur UKG personnel.
              </span>
            </div>
          </div>

          {showPwaBanner && (
            <div className="pwa-install-banner animate-slide-up">
              <div className="pwa-banner-content">
                <img src="icon-192.png" alt="SFX Logo" className="pwa-banner-icon" />
                <div className="pwa-banner-text">
                  <div className="pwa-banner-title" style={{ fontSize: '13px', lineHeight: '1.4' }}>
                    Installer SFX Planner 3000 sur votre écran d'accueil ?
                  </div>
                </div>
              </div>
              <div className="pwa-banner-actions">
                <button className="pwa-btn-cancel" onClick={() => {
                  setShowPwaBanner(false);
                  sessionStorage.setItem('sfx_pwa_prompt', 'true');
                }}>Plus tard</button>
                <button className="pwa-btn-install" onClick={handleInstallClick}>Installer</button>
              </div>
            </div>
          )}
        </div>
        <MickeyTamagotchiModal isOpen={tamagotchiOpen} onClose={() => setTamagotchiOpen(false)} />
      </div>
    );
  }

  return (
    <div className="app-shell" data-testid="app-root">
      <div className="smoke-bg" aria-hidden="true" style={{ filter: !globalCaptchaSolved ? 'blur(12px)' : 'none' }}>
        <div className="smoke-cloud smoke-cloud-1" />
        <div className="smoke-cloud smoke-cloud-2" />
        <div className="smoke-cloud smoke-cloud-3" />
      </div>
      <FireworksCanvas triggerCount={fireworkTrigger} />
      <aside className="app-sidebar" style={{ filter: !globalCaptchaSolved ? 'blur(12px)' : 'none', pointerEvents: !globalCaptchaSolved ? 'none' : 'auto' }}>
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
          <div style={{ minWidth: 0, display: 'flex', alignItems: 'baseline' }}>
            <div className="app-title" onClick={() => setShowResetConfirm(true)} style={{ cursor: 'pointer' }}>SFX Planner 3000</div>
          </div>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
          <Uploader
            loading={loading}
            drag={drag}
            compact={records.length > 0}
            onPick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
          />
          <MickeyTamagotchiButton onClick={() => setTamagotchiOpen(true)} />
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
              <IconUser />
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
      </aside>

      <main className="app-main" data-testid="main-content" style={{ filter: !globalCaptchaSolved ? 'blur(12px)' : 'none', pointerEvents: !globalCaptchaSolved ? 'none' : 'auto' }}>
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
              <strong style={{ color: 'var(--amber)', marginRight: '6px' }}>⚠️ :</strong>
              Contrôle obligatoire sur UKG personnel.
            </span>
          </div>
        </footer>
        <ScrollToTop />
      </main>

      {!globalCaptchaSolved && (
        <div className="export-overlay" data-testid="global-captcha-overlay">
          <div className="export-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px', paddingBottom: '32px' }}>
            <div className="export-body" style={{ padding: '32px 24px 0 24px', textAlign: 'center' }}>
              <div style={{ marginBottom: '32px', padding: '16px', background: 'rgba(255, 176, 58, 0.1)', borderRadius: '12px', border: '1px solid rgba(255, 176, 58, 0.3)' }}>
                <p style={{ fontSize: '18px', fontWeight: 700, color: 'var(--amber)', margin: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '24px' }}>⚠️</span>
                  <span>Contrôle obligatoire sur UKG personnel.</span>
                </p>
              </div>
              
              <div style={{ position: 'relative', width: '100px', height: '100px', margin: '0 auto 40px auto' }}>
                <div style={{ 
                  position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                  clipPath: 'polygon(0 0, 50% 0, 50% 100%, 0 100%)',
                  transform: `translateX(-${(100 - captchaSlider)}px)`,
                  transition: 'transform 0.1s ease-out'
                }}>
                  <svg viewBox="0 0 100 100" fill="var(--fg)" width="100" height="100">
                    <circle cx="20" cy="25" r="20" />
                    <circle cx="80" cy="25" r="20" />
                    <circle cx="50" cy="65" r="35" />
                  </svg>
                </div>
                <div style={{ 
                  position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                  clipPath: 'polygon(50% 0, 100% 0, 100% 100%, 50% 100%)',
                  transform: `translateX(${(100 - captchaSlider)}px)`,
                  transition: 'transform 0.1s ease-out'
                }}>
                  <svg viewBox="0 0 100 100" fill="var(--fg)" width="100" height="100">
                    <circle cx="20" cy="25" r="20" />
                    <circle cx="80" cy="25" r="20" />
                    <circle cx="50" cy="65" r="35" />
                  </svg>
                </div>
              </div>

              <div style={{ position: 'relative', margin: '0 auto', maxWidth: '320px', width: '100%' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', color: 'var(--fg-muted)', fontSize: '15px', fontWeight: 600, paddingLeft: '20px', opacity: 0.8 }}>
                  Faites glisser pour déverrouiller
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={captchaSlider}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setCaptchaSlider(val);
                    if (val >= 97) {
                      setTimeout(() => {
                        setGlobalCaptchaSolved(true);
                        setFireworkTrigger(t => t + 1);
                      }, 100);
                    }
                  }}
                  className="iphone-slider"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {showResetConfirm && (
        <div className="export-overlay" data-testid="reset-confirm-overlay" onClick={() => setShowResetConfirm(false)}>
          <div className="export-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '360px' }}>
            <div className="export-head">
              <div className="export-title" style={{ color: 'var(--amber)' }}>Réinitialiser ?</div>
              <button className="icon-btn" onClick={() => setShowResetConfirm(false)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="export-body" style={{ textAlign: 'center', padding: '32px 24px' }}>
              <p style={{ fontSize: '16px', color: 'var(--fg)', marginBottom: '8px' }}>
                Veux-tu vraiment tout effacer ?
              </p>
              <p style={{ fontSize: '14px', color: 'var(--fg-muted)', margin: 0 }}>
                Cela te ramènera à l'accueil et supprimera tous les plannings importés.
              </p>
            </div>
            <div className="export-foot" style={{ justifyContent: 'center', gap: '16px' }}>
              <button className="btn btn-secondary" onClick={() => setShowResetConfirm(false)}>Annuler</button>
              <button 
                className="btn" 
                style={{ background: 'var(--amber)', color: '#fff', border: 'none' }} 
                onClick={() => {
                  setShowResetConfirm(false);
                  resetAll();
                }}
              >
                Tout effacer
              </button>
            </div>
          </div>
        </div>
      )}

      {showPwaBanner && (
        <div className="pwa-install-banner animate-slide-up">
          <div className="pwa-banner-content">
            <img src="icon-192.png" alt="SFX Logo" className="pwa-banner-icon" />
            <div className="pwa-banner-text">
              <div className="pwa-banner-title" style={{ fontSize: '13px', lineHeight: '1.4' }}>
                Installer SFX Planner 3000 sur votre écran d'accueil ?
              </div>
            </div>
          </div>
          <div className="pwa-banner-actions">
            <button className="pwa-btn-cancel" onClick={() => {
              setShowPwaBanner(false);
              sessionStorage.setItem('sfx_pwa_prompt', 'true');
            }}>Plus tard</button>
            <button className="pwa-btn-install" onClick={handleInstallClick}>Installer</button>
          </div>
        </div>
      )}
      <MickeyTamagotchiModal isOpen={tamagotchiOpen} onClose={() => setTamagotchiOpen(false)} />
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

  useEffect(() => {
    if (selected && !employees.includes(selected)) {
      setSelected(null);
    }
  }, [selected, employees]);

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
    <div data-testid="panel-recherche" className={`recherche-panel-container ${query.trim() ? 'has-query' : ''}`}>
      <div className="recherche-header">
        <h2 className="recherche-title">Planning Individuel</h2>
        <p className="recherche-subtitle">Recherchez un technicien pour afficher son planning complet ou l'exporter en PDF.</p>
      </div>

      <div className="search-wrap">
        <span className="search-icon"><IconSearch /></span>
        <form autoComplete="off" onSubmit={e => e.preventDefault()} style={{ flex: 1, display: 'flex', minWidth: 0, margin: 0, padding: 0 }}>
          <input
            id="q_input_field"
            name="q_random_field"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            data-lpignore="true"
            data-form-type="other"
            role="presentation"
            placeholder="Rechercher (ex: Tom)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="input-search"
            aria-label="Recherche"
            style={{ flex: 1, width: '100%' }}
          />
        </form>
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
    return s.trim().toUpperCase();
  }
  const last = s.slice(0, idx).trim().toUpperCase();
  const first = titleCasePart(s.slice(idx + 1));
  if (!first) return last;
  if (!last) return first;
  return `${last} ${first}`;
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
    
    return dayRecs
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
      <button className="btn-back" onClick={onBack} data-testid="btn-back-employees">
        <IconArrowLeft /> Retour
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
            let assocScenes: string[] | undefined;
            if (allRecords && isTrainingScene(rec.scene)) {
              const dayRecs = allRecords.filter(dr => dr.date === rec.date && dr.time !== 'OFF' && !isTrainingScene(dr.scene));
              const scenesOfDay = new Set<string>();
              for (const dr of dayRecs) {
                if (timesMatch(dr.time, rec.time, 5)) {
                  let clean = dr.scene.replace(/\bENT\b/gi, '').trim().replace(/^[-_]+|[-_]+$/g, '').trim();
                  if (clean && clean.toLowerCase() !== 'fo' && clean.toLowerCase() !== 'formation') {
                    scenesOfDay.add(clean);
                  }
                }
              }
              scenesOfDay.add('Formation autre');
              if (scenesOfDay.size > 0) assocScenes = Array.from(scenesOfDay).sort();
            }
            return (
              <DayCard
                key={rec.date}
                rec={rec}
                assocScenes={assocScenes}
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
        <div className="day-date">{rec.date.split('-').length === 3 ? `${rec.date.split('-')[2]}/${rec.date.split('-')[1]}` : rec.date}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          className={'day-scene' + (isOff ? ' off' : '')}
          data-testid={`scene-${rec.date}`}
          style={!isOff ? { borderLeft: `3.5px solid ${getSceneColor(rec.scene).accent}`, paddingLeft: 6, borderRadius: '2px 0 0 2px' } : undefined}
        >
          {isOff ? 'Repos / congé' : isTrainingScene(rec.scene) ? `🎓 ${rec.scene}` : rec.scene}
          {assocScenes && assocScenes.length > 0 && (
            <div style={{ fontSize: '0.85em', color: 'var(--muted)', marginTop: 4, fontWeight: 'normal' }}>
              Peut correspondre à {assocScenes.join(', ')}
            </div>
          )}
        </div>
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
      <button className="btn-back" onClick={onBack} data-testid="btn-back-scenes"><IconArrowLeft /> Retour</button>
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
                    {isTrainingScene(rec.scene) && assocScenes && assocScenes.length > 0 && (
                      <div style={{ color: 'var(--muted)', fontSize: '0.9em', marginTop: 2 }}>
                        (peut correspondre à {assocScenes.join(', ')})
                      </div>
                    )}
                    {isFOVirtual && originalScene && ` · En formation (${originalScene})`}
                  </div>
                </div>
                <span className={timePillClass(rec.time, rec.scene, isFO)}>{rec.time}</span>
                <button
                  type="button"
                  className="btn-eye"
                  aria-label={`Voir le planning de ${prettyName(rec.employee)}`}
                  data-testid={`btn-view-employee-${rec.employee}`}
                  onClick={() => onViewEmployee((rec as any).originalEmployeeName || rec.employee)}
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
  const [openScenes, setOpenScenes] = useState<Set<string>>(new Set());
  const scrollPos = useRef(0);
  const [showExport, setShowExport] = useState(false);

  const handleSelectEmployee = (emp: string) => {
    scrollPos.current = window.scrollY;
    setSelectedEmployee(emp);
  };

  const handleBackFromEmployee = () => {
    setSelectedEmployee(null);
    setTimeout(() => {
      window.scrollTo({ top: scrollPos.current, behavior: 'instant' });
    }, 0);
  };



  const present = useMemo(() => {
    return records.filter(r => r.date === date && r.time !== 'OFF').sort((a, b) => {
      const byScene = a.scene.localeCompare(b.scene, 'fr');
      if (byScene !== 0) return byScene;
      return prettyName(a.employee).localeCompare(prettyName(b.employee), 'fr');
    });
  }, [records, date]);

  const byScene = useMemo(() => {
    const dateToScenes = new Map<string, Array<{time: string, clean: string}>>();
    for (const r of records) {
      if (r.time !== 'OFF' && !isTrainingScene(r.scene)) {
        let clean = r.scene.replace(/\bENT\b/gi, '').trim();
        clean = clean.replace(/^[-_]+|[-_]+$/g, '').trim();
        if (clean && clean.toLowerCase() !== 'fo' && clean.toLowerCase() !== 'formation') {
          if (!dateToScenes.has(r.date)) dateToScenes.set(r.date, []);
          dateToScenes.get(r.date)!.push({time: r.time, clean});
        }
      }
    }

    const groups = new Map<string, Array<PlanningRecord & { assocScenes?: string[] }>>();
    for (const rec of present) {
      let groupName = rec.scene.replace(/\bENT\b/gi, '').trim().replace(/^[-_]+|[-_]+$/g, '').trim() || rec.scene;
      let displayName = prettyName(rec.employee);
      
      let assocScenes: string[] | undefined;
      
      if (isTrainingScene(rec.scene)) {
        groupName = 'Formations';
        if (rec.scene.toLowerCase() !== 'formation' && rec.scene.toLowerCase() !== 'fo') {
          let detail = rec.scene.replace(/^(formation|fo)\s*(-\s*)?/i, '');
          detail = detail.replace(/\bENT\b/gi, '').trim().replace(/^[-_]+|[-_]+$/g, '').trim();
          if (detail) displayName = `${displayName} (${detail})`;
        }
        const scenesOfDate = dateToScenes.get(rec.date) || [];
        const matched = new Set<string>();
        for (const sc of scenesOfDate) {
          if (timesMatch(sc.time, rec.time, 5)) matched.add(sc.clean);
        }
        matched.add('Formation autre');
        if (matched.size > 0) assocScenes = Array.from(matched).sort();
      }
      
      if (!groups.has(groupName)) groups.set(groupName, []);
      // We pass a cloned record with the updated display name so the UI shows it
      groups.get(groupName)!.push({ ...rec, employee: displayName, assocScenes, originalEmployeeName: rec.employee } as any);
    }
    return Array.from(groups.entries()).sort((a, b) => {
      const aFO = isTrainingScene(a[0]);
      const bFO = isTrainingScene(b[0]);
      if (aFO && !bFO) return 1;
      if (!aFO && bFO) return -1;
      return a[0].localeCompare(b[0], 'fr');
    });
  }, [present, records]);

  const uniqueTechs = useMemo(() => {
    return new Set(present.map(r => r.employee)).size;
  }, [present]);




  if (selectedEmployee) {
    return (
      <EmployeeDetail
        name={selectedEmployee}
        records={records.filter(r => r.employee === selectedEmployee)}
        allRecords={records}
        onBack={handleBackFromEmployee}
      />
    );
  }

  return (
    <>
      <div className="main-date-bar" style={{ marginBottom: 16 }}>
        <DailyDateBar
          records={records}
          date={date}
          onDateChange={_onDateChange}
        />
      </div>
      <div data-testid="panel-daily">
        <>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 20, padding: '6px 16px', marginBottom: 16 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)' }}>{uniqueTechs}</span>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--muted)' }}>techniciens présents</span>
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
                    onClick={() => {
                      setOpenScenes(prev => {
                        const next = new Set(prev);
                        if (next.has(scene)) next.delete(scene);
                        else next.add(scene);
                        return next;
                      });
                    }}
                    style={{ 
                      width: '100%', 
                      cursor: 'pointer', 
                      background: `linear-gradient(90deg, ${getSceneColor(scene).accent}30, transparent)`,
                      borderLeft: `4.5px solid ${getSceneColor(scene).accent}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      textAlign: 'left',
                      borderRight: 'none',
                      borderTop: 'none',
                      borderBottom: openScenes.has(scene) ? '1px solid var(--line)' : 'none'
                    }}
                  >
                    <div style={{ textAlign: 'left' }}>
                      <div className="daily-group-scene" style={{ fontSize: '16px', fontWeight: 600 }}>{scene}</div>
                      {openScenes.has(scene) && (
                        <div style={{ fontSize: '12.5px', color: 'var(--fg-muted)', marginTop: '4px', fontFamily: 'var(--font-sans)', fontWeight: 400 }}>
                          {formatDateLong(date)} · {sceneRecords.length} technicien(s)
                        </div>
                      )}
                    </div>
                    <span className="daily-group-count" aria-hidden="true">{sceneRecords.length}</span>
                  </button>
                  <div className={`compact-list-wrapper ${openScenes.has(scene) ? 'expanded' : ''}`}>
                    <div className="compact-list" data-testid={`scene-team-${scene}`}>
                    {sceneRecords.map(rec => {
                      const extRec = rec as PlanningRecord & { isFOVirtual?: boolean; assocScenes?: string[]; originalScene?: string; originalEmployeeName?: string };
                      const isFOVirtual = extRec.isFOVirtual;
                      const assocScenes = extRec.assocScenes;
                      const originalScene = extRec.originalScene;
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
                              {isTrainingScene(rec.scene) && assocScenes && assocScenes.length > 0 && (
                                <div style={{ color: 'var(--muted)', fontSize: '0.9em', marginTop: 2 }}>
                                  (peut correspondre à {assocScenes.join(', ')})
                                </div>
                              )}
                              {isFOVirtual && originalScene && ` · En formation (${originalScene})`}
                            </div>
                          </div>
                          <span className={timePillClass(rec.time, rec.scene, isFO)}>{rec.time}</span>
                          <button
                            type="button"
                            className="btn-eye compact-eye"
                            data-testid={`btn-view-tech-${rec.employee}`}
                            onClick={() => handleSelectEmployee(extRec.originalEmployeeName || rec.employee)}
                          >
                            <IconEye />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      </div>
    </>
  );
}

function DatePicker({ dates, date, records, onChange }: {
  dates: string[]; date: string; records: PlanningRecord[]; onChange: (date: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
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
    </div>
  );
}



function EmptyAllPanel() {
  return <div className="empty" data-testid="empty-root" />;
}

function ExportDialog({ records, date, onClose }: { records: PlanningRecord[]; date: string; onClose: () => void }) {
  const [mode, setMode] = useState<'day' | 'scene' | 'global'>('day');
  const scenes = useMemo(() => listScenes(records), [records]);
  const [selectedScene, setSelectedScene] = useState<string>('ALL');
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
        if (selectedScene === 'ALL') {
          for (const s of scenes) {
            await exportScenePdf(s, records);
            // small delay to prevent browser from blocking multiple downloads
            await new Promise(r => setTimeout(r, 500));
          }
        } else {
          await exportScenePdf(selectedScene, records);
        }
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
          </button>
          <button
            type="button"
            className={'export-opt' + (mode === 'scene' ? ' on' : '')}
            onClick={() => setMode('scene')}
          >
            <span className="export-opt-title">Scène sur la période exportée</span>
          </button>
          <button
            type="button"
            className={'export-opt' + (mode === 'global' ? ' on' : '')}
            onClick={() => setMode('global')}
          >
            <span className="export-opt-title">Vue globale</span>
          </button>
          {mode === 'scene' && (
            <select
              className="export-scene-select"
              value={selectedScene}
              onChange={e => setSelectedScene(e.target.value)}
            >
              <option value="ALL">Toutes les scènes (un fichier par scène)</option>
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}

function IconUser() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
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
function IconArrowLeft() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6"/>
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

function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  
  if (!visible) return null;
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 48,
        height: 48,
        borderRadius: '50%',
        background: 'var(--accent)',
        color: 'white',
        border: 'none',
        boxShadow: '0 4px 12px var(--shadow)',
        fontSize: 24,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        opacity: 0.9
      }}
      aria-label="Remonter en haut"
    >
      ↑
    </button>
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

const FIREWORK_COLORS = ['#ff3366', '#ff9933', '#ffff33', '#33ff66', '#33ccff', '#cc33ff', '#ff00aa', '#00ffcc'];

function FireworksCanvas({ triggerCount }: { triggerCount: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<FireworkParticle[]>([]);
  const rocketsRef = useRef<FireworkRocket[]>([]);
  const animationFrameId = useRef<number | null>(null);

  const spawnExplosion = useCallback((x: number, y: number, color?: string) => {
    const count = 40 + Math.floor(Math.random() * 30);
    const baseColor = color || FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 4.5;
      particlesRef.current.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 0.5, color: baseColor, alpha: 1, decay: 0.012 + Math.random() * 0.015, size: 1 + Math.random() * 2 });
    }
  }, []);

  const spawnRocket = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const tx = 100 + Math.random() * (canvas.width - 200); const ty = 80 + Math.random() * (canvas.height * 0.4);
    const x = tx + (Math.random() - 0.5) * 50; const y = canvas.height;
    const dy = ty - y; const dx = tx - x; const duration = 40 + Math.random() * 20;
    rocketsRef.current.push({ x, y, tx, ty, vx: dx / duration, vy: dy / duration, color: FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)], size: 2.2 });
  }, []);

  useEffect(() => {
    if (triggerCount > 0) {
      let count = 4 + Math.floor(Math.random() * 3);
      const interval = setInterval(() => { spawnRocket(); count--; if (count <= 0) clearInterval(interval); }, 150);
    }
  }, [triggerCount, spawnRocket]);

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

