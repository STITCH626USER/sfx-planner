/**
 * Disneyland Paris Live Shows Service
 * Source: ThemeParks.wiki API (unofficial real-time Disney park data)
 * Parks: Disneyland Park & Disney Adventure World (formerly Walt Disney Studios)
 */

export interface DlpParkHours {
  disneyland: string;
  adventureWorld: string;
}

export interface DlpShow {
  id: string;
  name: string;
  park: 'Disneyland Park' | 'Disney Adventure World';
  status: 'OPERATING' | 'CLOSED' | 'REFURBISHMENT' | string;
  isRelache: boolean;
  isEnded?: boolean; // True when the last show of the day started > 30 mins ago
  relacheReason?: string;
  times: string[]; // ['12:30', '13:30', ...]
  nextTime?: string;
  category: 'spectacle' | 'rencontre' | 'nocturne' | 'parade';
}

const CACHE_KEY = 'dlp_shows_cache_v7';
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

function getTodayIsoString(refDate?: Date): string {
  const d = refDate || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Fallback catalog with authentic park naming
const FALLBACK_SHOWS: DlpShow[] = [
  {
    id: 'lion-king',
    name: 'Le Roi Lion : Les Rythmes de la Terre des Lions (Frontierland Theater)',
    park: 'Disneyland Park',
    status: 'OPERATING',
    isRelache: false,
    times: ['12:30', '13:30', '16:05', '17:05'],
    category: 'spectacle'
  },
  {
    id: 'together-pixar',
    name: 'TOGETHER : Une Aventure Musicale Pixar (Studio Theater)',
    park: 'Disney Adventure World',
    status: 'CLOSED',
    isRelache: true,
    relacheReason: 'Relâche programmée aujourd’hui',
    times: [],
    category: 'spectacle'
  },
  {
    id: 'mickey-magician',
    name: 'Mickey et le Magicien (Animagique Theater)',
    park: 'Disney Adventure World',
    status: 'OPERATING',
    isRelache: false,
    times: ['13:00', '14:05', '15:10', '17:25', '18:30'],
    category: 'spectacle'
  },

  {
    id: 'parade-stars',
    name: 'Disney Stars on Parade',
    park: 'Disneyland Park',
    status: 'OPERATING',
    isRelache: false,
    times: ['17:30'],
    category: 'parade'
  },
  {
    id: 'tales-of-magic',
    name: 'Disney Tales of Magic (Spectacle Nocturne Château)',
    park: 'Disneyland Park',
    status: 'OPERATING',
    isRelache: false,
    times: ['22:00'],
    category: 'nocturne'
  },
  {
    id: 'cascade-lights',
    name: 'Disney Cascade of Lights (Lac Adventure Way)',
    park: 'Disney Adventure World',
    status: 'OPERATING',
    isRelache: false,
    times: ['21:50'],
    category: 'nocturne'
  },
  {
    id: 'matmops-dream-factory',
    name: 'La Fabrique des Rêves de Disney Junior (Studio D)',
    park: 'Disney Adventure World',
    status: 'OPERATING',
    isRelache: false,
    times: ['12:00', '13:00', '14:00', '16:20', '17:20'],
    category: 'spectacle'
  },
  {
    id: 'dr-strange',
    name: 'Doctor Strange : Mystères Mystiques (Avengers Campus)',
    park: 'Disney Adventure World',
    status: 'CLOSED',
    isRelache: true,
    relacheReason: 'Aucune représentation aujourd’hui',
    times: [],
    category: 'spectacle'
  },
  {
    id: 'alice-bmx',
    name: 'Alice & la Reine de Cœur : Retour au Pays des Merveilles (Theater of the Stars)',
    park: 'Disney Adventure World',
    status: 'CLOSED',
    isRelache: true,
    relacheReason: 'Relâche ou fin de saison estivale',
    times: [],
    category: 'spectacle'
  }
];

function categorizeShow(name: string): { category: DlpShow['category']; cleanName: string } {
  const lower = name.toLowerCase();
  let cleanName = name;

  // Pretty name translation & theater associations
  if (lower.includes('lion king')) {
    cleanName = 'Le Roi Lion : Les Rythmes de la Terre des Lions (Frontierland Theater)';
  } else if (lower.includes('together')) {
    cleanName = 'TOGETHER : Une Aventure Musicale Pixar (Studio Theater)';
  } else if (lower.includes('mickey and the magician') || lower.includes('magicien')) {
    cleanName = 'Mickey et le Magicien (Animagique Theater)';
  } else if (lower.includes('frozen') || lower.includes('reine des neiges')) {
    cleanName = 'La Reine des Neiges : Une Invitation Musicale (Animation Celebration)';
  } else if (lower.includes('stars on parade')) {
    cleanName = 'Disney Stars on Parade';
  } else if (lower.includes('tales of magic')) {
    cleanName = 'Disney Tales of Magic (Spectacle Nocturne Château)';
  } else if (lower.includes('cascade of lights')) {
    cleanName = 'Disney Cascade of Lights (Lac Adventure Way)';
  } else if (lower.includes('dream factory') || lower.includes('fabrique des')) {
    cleanName = 'La Fabrique des Rêves de Disney Junior (Studio D)';
  } else if (lower.includes('doctor strange')) {
    cleanName = 'Doctor Strange : Mystères Mystiques (Avengers Campus)';
  } else if (lower.includes('splashes of colour')) {
    cleanName = 'A Million Splashes of Colour';
  } else if (lower.includes('sleeping beauty')) {
    cleanName = 'Valse Royale de la Belle au Bois Dormant';
  } else if (lower.includes('stitch live')) {
    cleanName = 'Stitch Live! (Production Courtyard)';
  } else if (lower.includes('animation academy')) {
    cleanName = 'Animation Academy (Toon Studio)';
  } else if (lower.includes('arendelle')) {
    cleanName = 'Une Célébration en Arendelle';
  }

  if (lower.includes('tales of magic') || lower.includes('cascade of lights') || lower.includes('fireworks') || lower.includes('nocturne')) {
    return { category: 'nocturne', cleanName };
  }
  if (lower.includes('parade') || lower.includes('cavalcade')) {
    return { category: 'parade', cleanName };
  }
  if (lower.startsWith('meet ') || lower.startsWith('rencontre') || lower.includes('encounter') || lower.includes('pavilion')) {
    return { category: 'rencontre', cleanName };
  }
  return { category: 'spectacle', cleanName };
}

export async function fetchDlpShows(): Promise<{
  shows: DlpShow[];
  parkHours: DlpParkHours;
  lastUpdated: string;
  isOffline: boolean;
  todayDate: string;
}> {
  const todayIso = getTodayIsoString();

  // Check local cache
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.todayDate === todayIso && Date.now() - parsed.timestamp < CACHE_TTL) {
        return {
          shows: parsed.shows,
          parkHours: parsed.parkHours || { disneyland: '09:30 - 23:00', adventureWorld: '09:30 - 21:00' },
          lastUpdated: parsed.lastUpdated,
          isOffline: false,
          todayDate: todayIso
        };
      }
    }
  } catch {
    // ignore local storage errors
  }

  try {
    // dae968d5-630d-4719-8b06-3d107e944401: Disneyland Park
    // ca888437-ebb4-4d50-aed2-d227f7096968: Disney Adventure World (formerly Walt Disney Studios)
    const park1Promise = fetch('https://api.themeparks.wiki/v1/entity/dae968d5-630d-4719-8b06-3d107e944401/live')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
    const park2Promise = fetch('https://api.themeparks.wiki/v1/entity/ca888437-ebb4-4d50-aed2-d227f7096968/live')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);

    const sched1Promise = fetch('https://api.themeparks.wiki/v1/entity/dae968d5-630d-4719-8b06-3d107e944401/schedule')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
    const sched2Promise = fetch('https://api.themeparks.wiki/v1/entity/ca888437-ebb4-4d50-aed2-d227f7096968/schedule')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);

    const [p1, p2, s1, s2] = await Promise.all([park1Promise, park2Promise, sched1Promise, sched2Promise]);

    if (!p1 && !p2) {
      throw new Error('APIs unavailable');
    }

    // Helper to extract operating hours for today from schedule API
    const extractHours = (scheduleData: any, defaultHours: string): string => {
      try {
        if (!scheduleData?.schedule?.length) return defaultHours;
        const entry = scheduleData.schedule.find((s: any) => s.date === todayIso && s.type === 'OPERATING');
        if (entry?.openingTime && entry?.closingTime) {
          const open = entry.openingTime.slice(11, 16);
          const close = entry.closingTime.slice(11, 16);
          return `${open} - ${close}`;
        }
      } catch {}
      return defaultHours;
    };

    const parkHours: DlpParkHours = {
      disneyland: extractHours(s1, '09:30 - 23:00'),
      adventureWorld: extractHours(s2, '09:30 - 21:00')
    };

    const allItems: any[] = [];
    if (p1?.liveData) {
      p1.liveData.forEach((item: any) => allItems.push({ ...item, park: 'Disneyland Park' }));
    }
    if (p2?.liveData) {
      p2.liveData.forEach((item: any) => allItems.push({ ...item, park: 'Disney Adventure World' }));
    }

    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

    const shows: DlpShow[] = allItems
      .filter(item => item.entityType === 'SHOW')
      .filter(item => !item.name.toLowerCase().startsWith('reserved viewing'))
      // Exclude character meets, autograph sessions, photo locations, and drawing classes
      .filter(item => {
        const l = item.name.toLowerCase();
        if (
          l.startsWith('meet ') ||
          l.startsWith('rencontre') ||
          l.includes('encounter') ||
          l.includes('pavilion') ||
          l.includes('pavillon') ||
          l.includes('academy') ||
          l.includes('meeting') ||
          l.includes('character') ||
          // User exclusions:
          // 1. La reine des neiges invitation
          (l.includes('frozen') && l.includes('invitation')) ||
          (l.includes('reine des neiges') && l.includes('invitation')) ||
          // 2. Les musical moments (Mary Poppins, Rapunzel)
          l.includes('musical moment') ||
          l.includes('moment musical') ||
          // 3. La valse royale de la belle au bois dormant
          l.includes('valse royale') ||
          (l.includes('sleeping beauty') && l.includes('waltz')) ||
          // 4. Stitch Live
          l.includes('stitch live') ||
          // 5. Miguel (Coco)
          l.includes('miguel') ||
          // 6. Princess Cavalcade / Cavalcade des Princesses
          (l.includes('princess') && l.includes('cavalcade')) ||
          (l.includes('princesse') && l.includes('cavalcade')) ||
          // 7. Disney Princess Musical Memories
          l.includes('musical memories')
        ) {
          return false;
        }
        return true;
      })
      .map(item => {
        const { category, cleanName } = categorizeShow(item.name);

        // Filter showtimes STRICTLY for today's date
        const todaysShowtimes = (item.showtimes || []).filter((t: any) => {
          if (!t.startTime) return false;
          const showDate = t.startTime.slice(0, 10);
          return showDate === todayIso;
        });

        const times: string[] = todaysShowtimes

          .map((t: any) => (t.startTime ? t.startTime.slice(11, 16) : ''))
          .filter(Boolean)
          .sort();

        // Calculate next upcoming showtime today
        let nextTime: string | undefined;
        for (const t of times) {
          const [th, tm] = t.split(':').map(Number);
          if (th * 60 + tm >= nowMinutes) {
            nextTime = t;
            break;
          }
        }

        const isClosedStatus = item.status === 'CLOSED' || item.status === 'REFURBISHMENT';
        // A show is in relâche if closed by status OR if it has NO scheduled performances for TODAY's date
        const isRelache = isClosedStatus || times.length === 0;

        let relacheReason: string | undefined;
        if (isRelache) {
          if (item.status === 'REFURBISHMENT') {
            relacheReason = 'Fermeture technique / réhabilitation';
          } else if (item.status === 'CLOSED') {
            relacheReason = 'Fermé aujourd’hui';
          } else {
            relacheReason = 'Relâche programmée aujourd’hui (aucune séance)';
          }
        }
        // Check if all shows for today have ended:
        // "une fois que le dernier show de la journée est passé (environ 30 min après le début) -> shows terminés aujourd'hui"
        let isEnded = false;
        if (!isRelache && times.length > 0) {
          const lastTime = times[times.length - 1];
          const [lh, lm] = lastTime.split(':').map(Number);
          const lastShowMinutes = lh * 60 + lm;
          // 30 min after start of last show
          if (nowMinutes >= lastShowMinutes + 30) {
            isEnded = true;
          }
        }

        return {
          id: item.id || cleanName,
          name: cleanName,
          park: item.park,
          status: isRelache ? 'CLOSED' : (item.status || 'OPERATING'),
          isRelache,
          isEnded,
          relacheReason,
          times,
          nextTime,
          category
        };
      })
      // Sort: spectacles in operation (active) first, then ended shows, then relâches
      .sort((a, b) => {
        const getScore = (s: DlpShow) => {
          if (s.isRelache) return 3;
          if (s.isEnded) return 2;
          return 1;
        };
        const scoreA = getScore(a);
        const scoreB = getScore(b);
        if (scoreA !== scoreB) return scoreA - scoreB;
        return a.name.localeCompare(b.name, 'fr');
      });

    const nowStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        shows,
        parkHours,
        lastUpdated: nowStr,
        todayDate: todayIso,
        timestamp: Date.now()
      }));
    } catch {}

    return { shows, parkHours, lastUpdated: nowStr, isOffline: false, todayDate: todayIso };
  } catch (e) {
    console.warn('Failed to fetch live DLP shows, falling back to local dataset', e);
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    const shows = FALLBACK_SHOWS.map(s => {
      let nextTime: string | undefined;
      for (const t of s.times) {
        const [th, tm] = t.split(':').map(Number);
        if (th * 60 + tm >= nowMinutes) {
          nextTime = t;
          break;
        }
      }
      let isEnded = false;
      if (!s.isRelache && s.times.length > 0) {
        const lastTime = s.times[s.times.length - 1];
        const [lh, lm] = lastTime.split(':').map(Number);
        const lastShowMinutes = lh * 60 + lm;
        if (nowMinutes >= lastShowMinutes + 30) {
          isEnded = true;
        }
      }
      return { ...s, nextTime, isEnded };
    });
    return {
      shows,
      parkHours: { disneyland: '09:30 - 23:00', adventureWorld: '09:30 - 21:00' },
      lastUpdated: 'Secours (Hors ligne)',
      isOffline: true,
      todayDate: todayIso
    };
  }
}
