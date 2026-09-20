import { useMemo, useState, useEffect, useRef } from 'react';
import type { PlanningRecord } from './lib/parsePdf';
import { isTrainingScene, getSceneColor, cleanSceneName, timesMatch } from './lib/utils';

const DAY_COLS = [
  { key: 'dim', label: 'DIM', full: 'Dimanche' },
  { key: 'lun', label: 'LUN', full: 'Lundi' },
  { key: 'mar', label: 'MAR', full: 'Mardi' },
  { key: 'mer', label: 'MER', full: 'Mercredi' },
  { key: 'jeu', label: 'JEU', full: 'Jeudi' },
  { key: 'ven', label: 'VEN', full: 'Vendredi' },
  { key: 'sam', label: 'SAM', full: 'Samedi' },
];

const MONTH_FR: Record<string, string> = {
  '01': 'janv.', '02': 'févr.', '03': 'mars', '04': 'avril', '05': 'mai',
  '06': 'juin', '07': 'juil.', '08': 'août', '09': 'sept.', '10': 'oct.',
  '11': 'nov.', '12': 'déc.',
};

const MONTH_FR_FULL: Record<string, string> = {
  '01': 'janvier', '02': 'février', '03': 'mars', '04': 'avril', '05': 'mai',
  '06': 'juin', '07': 'juillet', '08': 'août', '09': 'septembre', '10': 'octobre',
  '11': 'novembre', '12': 'décembre',
};

function formatFullDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const dObj = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  const dayName = DAY_COLS[dObj.getDay()]?.full || '';
  const monthName = MONTH_FR_FULL[m[2]] || m[2];
  return `${dayName} ${parseInt(m[3], 10)} ${monthName} ${m[1]}`;
}

function formatRangeShort(startIso: string, endIso: string): string {
  const sm = startIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const em = endIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!sm || !em) return `${startIso} - ${endIso}`;
  const sDay = parseInt(sm[3], 10);
  const eDay = parseInt(em[3], 10);
  const sMonth = MONTH_FR[sm[2]] || sm[2];
  const eMonth = MONTH_FR[em[2]] || em[2];
  if (sm[2] === em[2] && sm[1] === em[1]) {
    return `${sDay} au ${eDay} ${sMonth} ${sm[1]}`;
  }
  return `${sDay} ${sMonth} au ${eDay} ${eMonth} ${em[1]}`;
}

interface PopoverData {
  date: string;
  records: PlanningRecord[];
  anchorRect?: DOMRect;
}

interface EmployeeCalendarViewProps {
  byWeek: [string, PlanningRecord[]][];
  allRecords?: PlanningRecord[];
  onOpenScene?: (scene: string, date: string) => void;
}

export function EmployeeCalendarView({
  byWeek,
  allRecords,
  onOpenScene,
}: EmployeeCalendarViewProps) {
  const [selectedWeek, setSelectedWeek] = useState<string>('all');
  const [popover, setPopover] = useState<PopoverData | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const todayIso = useMemo(() => new Date().toISOString().split('T')[0], []);

  // Filter weeks if a specific week is selected, otherwise unified all weeks
  const visibleWeeks = useMemo(() => {
    if (selectedWeek === 'all') return byWeek;
    return byWeek.filter(([lbl]) => lbl === selectedWeek);
  }, [byWeek, selectedWeek]);

  // Global records for visible weeks
  const allVisibleRecords = useMemo(() => {
    return visibleWeeks.flatMap(([, recs]) => recs);
  }, [visibleWeeks]);

  const totalWorkedDays = useMemo(() => {
    return new Set(allVisibleRecords.filter(r => r.time !== 'OFF').map(r => r.date)).size;
  }, [allVisibleRecords]);

  const totalCalendarDays = useMemo(() => {
    return new Set(allVisibleRecords.map(r => r.date)).size;
  }, [allVisibleRecords]);

  // Overall date range string
  const dateRangeLabel = useMemo(() => {
    const allDates = Array.from(new Set(allVisibleRecords.map(r => r.date))).sort();
    if (allDates.length === 0) return '';
    const firstDate = allDates[0];
    const lastDate = allDates[allDates.length - 1];
    return formatRangeShort(firstDate, lastDate);
  }, [allVisibleRecords]);

  // Close popover on Escape
  useEffect(() => {
    if (!popover) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopover(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [popover]);

  // Extract short week label (e.g. "S39")
  const getShortWeekLabel = (fullLabel: string) => {
    const m = fullLabel.match(/sem\.?\s*(\d+)/i);
    return m ? `S${m[1]}` : fullLabel.split('·')[0].trim();
  };

  return (
    <div className="employee-calendar-view" data-testid="employee-calendar-view">
      {/* UNIFIED CALENDAR CARD */}
      <div className="cal-unified-card">
        {/* Header with period and worked days badge */}
        <div className="cal-unified-header">
          <div className="cal-unified-info">
            <div className="cal-unified-title">
              {selectedWeek === 'all'
                ? (byWeek.length > 1 ? 'Planning unifié' : byWeek[0]?.[0] || 'Planning')
                : selectedWeek}
            </div>
            <div className="cal-unified-sub">
              {dateRangeLabel && <span>{dateRangeLabel}</span>}
              {visibleWeeks.length > 1 && <span className="cal-unified-dot">·</span>}
              {visibleWeeks.length > 1 && <span>{visibleWeeks.length} semaines</span>}
            </div>
          </div>
          <div className="cal-unified-badge">
            {totalWorkedDays}/{totalCalendarDays} jours travaillés
          </div>
        </div>

        {/* Quick week filter pills if multiple weeks uploaded */}
        {byWeek.length > 1 && (
          <div className="cal-week-filter-bar">
            <button
              type="button"
              className={`cal-week-pill ${selectedWeek === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedWeek('all')}
            >
              Tout afficher ({byWeek.length} sem.)
            </button>
            {byWeek.map(([wLabel]) => (
              <button
                key={wLabel}
                type="button"
                className={`cal-week-pill ${selectedWeek === wLabel ? 'active' : ''}`}
                onClick={() => setSelectedWeek(wLabel)}
                title={wLabel}
              >
                {getShortWeekLabel(wLabel)}
              </button>
            ))}
          </div>
        )}

        {/* 7-COLUMN UNIFIED CALENDAR GRID */}
        <div className="cal-grid-wrapper">
          {/* Single Column Header row for the entire unified calendar */}
          <div className="cal-grid-header">
            {DAY_COLS.map(col => (
              <div key={col.key} className="cal-grid-th">
                <span className="th-short">{col.label}</span>
              </div>
            ))}
          </div>

          {/* All days of all visible weeks flowing row-by-row */}
          <div className="cal-grid-body">
            {visibleWeeks.map(([weekLabel, weekRecs]) => {
              const daysMap = new Map<string, PlanningRecord[]>();
              for (const r of weekRecs) {
                if (!daysMap.has(r.date)) daysMap.set(r.date, []);
                daysMap.get(r.date)!.push(r);
              }
              const sortedDates = Array.from(daysMap.keys()).sort();
              const shortWeek = getShortWeekLabel(weekLabel);

              return sortedDates.map((dateStr, dayInWeekIdx) => {
                const recs = daysMap.get(dateStr) || [];
                const isOff = recs.every(r => r.time === 'OFF');
                const isToday = dateStr === todayIso;
                const dateParts = dateStr.split('-');
                const dayNum = dateParts[2] ? parseInt(dateParts[2], 10) : dateStr;
                const monthNum = dateParts[1] || '';
                const monthShort = MONTH_FR[monthNum] || '';

                // Show month on first day of week (Sunday) or 1st of month
                const showMonth = dayInWeekIdx === 0 || dayNum === 1;
                // Show week pill badge on Sunday when multiple weeks are visible
                const showWeekBadge = dayInWeekIdx === 0 && visibleWeeks.length > 1;

                // Unique scenes for the day
                const uniqueScenes = Array.from(
                  new Set(recs.map(r => r.scene).filter(s => s && s !== 'OFF'))
                );

                return (
                  <div
                    key={dateStr}
                    className={`cal-day-cell ${isOff ? 'is-off' : 'is-working'} ${isToday ? 'is-today' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Voir les horaires du ${formatFullDate(dateStr)}`}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setPopover({ date: dateStr, records: recs, anchorRect: rect });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setPopover({ date: dateStr, records: recs, anchorRect: rect });
                      }
                    }}
                  >
                    <div className="cal-day-cell-top">
                      <div className="cal-day-cell-date-group">
                        <span className="cal-day-num">{dayNum}</span>
                        {showMonth && <span className="cal-day-month">{monthShort}</span>}
                      </div>
                      {showWeekBadge && (
                        <span className="cal-week-tag" title={weekLabel}>{shortWeek}</span>
                      )}
                      {isToday && <span className="cal-today-dot" title="Aujourd'hui" />}
                    </div>

                    <div className="cal-day-cell-content">
                      {isOff ? (
                        <div className="cal-scene-pill off-pill">
                          <span>Repos</span>
                        </div>
                      ) : (
                        uniqueScenes.map(scene => {
                          const isFO = isTrainingScene(scene);
                          const clean = cleanSceneName(scene);
                          const color = getSceneColor(clean);

                          return (
                            <div
                              key={scene}
                              className={`cal-scene-pill ${isFO ? 'fo-pill' : ''}`}
                              style={{
                                borderLeft: `3px solid ${color.accent}`,
                              }}
                              title={isFO ? `Formation (${clean})` : clean}
                            >
                              <span className="cal-scene-name">
                                {isFO ? `🎓 ${clean}` : clean}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              });
            })}
          </div>
        </div>
      </div>

      {/* Interactive Popover Bubble */}
      {popover && (
        <>
          <div
            className="cal-popover-backdrop"
            onClick={() => setPopover(null)}
            aria-hidden="true"
          />
          <div
            ref={popoverRef}
            className="cal-popover-bubble animate-scale-up"
            role="dialog"
            aria-modal="true"
            aria-label={`Détail des horaires du ${formatFullDate(popover.date)}`}
            style={getPopoverStyle(popover.anchorRect)}
          >
            <div className="cal-popover-head">
              <div className="cal-popover-date">
                <span>{formatFullDate(popover.date)}</span>
                {popover.date === todayIso && (
                  <span className="cal-popover-today-badge">Aujourd'hui</span>
                )}
              </div>
              <button
                type="button"
                className="cal-popover-close-btn"
                onClick={() => setPopover(null)}
                aria-label="Fermer la bulle"
              >
                ✕
              </button>
            </div>

            <div className="cal-popover-body">
              {(() => {
                const isOff = popover.records.every(r => r.time === 'OFF');
                if (isOff) {
                  return (
                    <div className="cal-popover-off">
                      <div className="cal-popover-off-icon">🏖️</div>
                      <div className="cal-popover-off-text">
                        <strong>Repos / Congé</strong>
                        <span>Aucun poste ni formation planifié ce jour.</span>
                      </div>
                    </div>
                  );
                }

                const firstRec = popover.records[0];
                const dayShift = firstRec?.shiftTime;
                const hasMultipleSlots =
                  popover.records.length > 1 || (!!dayShift && dayShift !== firstRec.time);

                return (
                  <div className="cal-popover-slots">
                    {hasMultipleSlots && dayShift && (
                      <div className="cal-popover-shift-banner">
                        <span className="shift-label">🕒 Amplitude journée :</span>
                        <strong className="shift-time">{dayShift}</strong>
                      </div>
                    )}

                    {popover.records.map((r, idx) => {
                      const isFO = isTrainingScene(r.scene);
                      const clean = cleanSceneName(r.scene);
                      const color = getSceneColor(clean);

                      // Detect associated scenes if formation
                      let assocScenes: string[] | undefined;
                      if (allRecords && isFO) {
                        const dayRecs = allRecords.filter(
                          dr => dr.date === r.date && dr.time !== 'OFF' && !isTrainingScene(dr.scene)
                        );
                        const scenesOfDay = new Set<string>();
                        for (const dr of dayRecs) {
                          if (timesMatch(dr.time, r.time, 5)) {
                            const c = cleanSceneName(dr.scene);
                            if (c && c.toLowerCase() !== 'fo' && c.toLowerCase() !== 'formation') {
                              scenesOfDay.add(c);
                            }
                          }
                        }
                        if (scenesOfDay.size > 0) assocScenes = Array.from(scenesOfDay).sort();
                      }

                      return (
                        <div
                          key={idx}
                          className="cal-popover-slot-card"
                          style={{ borderLeft: `3.5px solid ${color.accent}` }}
                        >
                          <div className="cal-popover-slot-top">
                            <div className="cal-popover-slot-name">
                              {isFO ? `🎓 ${clean}` : clean}
                            </div>
                            <span className="time-pill">{r.time}</span>
                          </div>

                          {r.role && (
                            <div className="cal-popover-slot-role">
                              Rôle : <strong>{r.role}</strong>
                            </div>
                          )}

                          {assocScenes && assocScenes.length > 0 && (
                            <div className="cal-popover-slot-assoc">
                              Associé à : {assocScenes.join(', ')}
                            </div>
                          )}

                          {onOpenScene && !isFO && (
                            <button
                              type="button"
                              className="cal-popover-team-btn"
                              onClick={() => {
                                setPopover(null);
                                onOpenScene(r.scene, r.date);
                              }}
                            >
                              <span>Voir l'équipe de ce show</span>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12h14M12 5l7 7-7 7" />
                              </svg>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Calculate popover positioning relative to clicked anchor or center/bottom on mobile
function getPopoverStyle(anchorRect?: DOMRect): React.CSSProperties {
  if (typeof window === 'undefined') return {};
  const isMobile = window.innerWidth < 640;

  if (isMobile) {
    // Mobile: sleek floating bottom-sheet card
    return {
      position: 'fixed',
      bottom: 'calc(16px + env(safe-area-inset-bottom))',
      left: 12,
      right: 12,
      zIndex: 2000,
      maxHeight: '75vh',
    };
  }

  // Desktop: floating anchored popover with bounds clamping
  const popoverW = 340;
  let left = anchorRect
    ? anchorRect.left + anchorRect.width / 2 - popoverW / 2
    : window.innerWidth / 2 - popoverW / 2;

  // Clamp horizontally
  left = Math.max(16, Math.min(window.innerWidth - popoverW - 16, left));

  let top = anchorRect ? anchorRect.bottom + 8 : 120;
  if (anchorRect && top + 240 > window.innerHeight) {
    top = Math.max(16, anchorRect.top - 250);
  }

  return {
    position: 'fixed',
    top,
    left,
    width: popoverW,
    zIndex: 2000,
  };
}
