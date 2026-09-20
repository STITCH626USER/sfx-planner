/**
 * Disneyland Paris Live Shows Service
 * Source: ThemeParks.wiki API (unofficial real-time Disney park data)
 */

export interface DlpShow {
  id: string;
  name: string;
  park: 'Disneyland Park' | 'Walt Disney Studios';
  status: 'OPERATING' | 'CLOSED' | 'REFURBISHMENT' | string;
  isRelache: boolean;
  times: string[]; // ['12:30', '13:30', ...]
  nextTime?: string;
  category: 'spectacle' | 'rencontre' | 'nocturne' | 'parade';
}

const CACHE_KEY = 'dlp_shows_cache';
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

// Fallback data in case the client is completely offline or API has a temporary hiccup
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
    park: 'Walt Disney Studios',
    status: 'OPERATING',
    isRelache: false,
    times: ['11:15', '12:25', '13:35', '15:40', '16:50'],
    category: 'spectacle'
  },
  {
    id: 'mickey-magician',
    name: 'Mickey et le Magicien (Animagique Theater)',
    park: 'Walt Disney Studios',
    status: 'OPERATING',
    isRelache: false,
    times: ['13:00', '14:05', '15:10', '17:25', '18:30'],
    category: 'spectacle'
  },
  {
    id: 'frozen-musical',
    name: 'La Reine des Neiges : Une Invitation Musicale (Animation Celebration)',
    park: 'Walt Disney Studios',
    status: 'OPERATING',
    isRelache: false,
    times: ['10:30', '11:15', '12:00', '12:45', '13:30', '14:15', '15:00', '15:45', '16:30', '17:15', '18:00', '18:45'],
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
    name: 'Disney Tales of Magic (Nocturne Château)',
    park: 'Disneyland Park',
    status: 'OPERATING',
    isRelache: false,
    times: ['22:00'],
    category: 'nocturne'
  },
  {
    id: 'cascade-lights',
    name: 'Disney Cascade of Lights (Lac / Studios)',
    park: 'Walt Disney Studios',
    status: 'OPERATING',
    isRelache: false,
    times: ['21:50'],
    category: 'nocturne'
  },
  {
    id: 'matmops-dream-factory',
    name: 'La Fabrique des Rêves de Disney Junior (Studio D)',
    park: 'Walt Disney Studios',
    status: 'OPERATING',
    isRelache: false,
    times: ['12:00', '13:00', '14:00', '16:20', '17:20'],
    category: 'spectacle'
  },
  {
    id: 'dr-strange',
    name: 'Doctor Strange : Mystères Mystiques (Avengers Campus)',
    park: 'Walt Disney Studios',
    status: 'OPERATING',
    isRelache: false,
    times: ['19:30', '20:15'],
    category: 'spectacle'
  },
  {
    id: 'alice-bmx',
    name: 'Alice & la Reine de Cœur : Retour au Pays des Merveilles',
    park: 'Walt Disney Studios',
    status: 'CLOSED',
    isRelache: true,
    times: [],
    category: 'spectacle'
  }
];

function categorizeShow(name: string): { category: DlpShow['category']; cleanName: string } {
  const lower = name.toLowerCase();
  let cleanName = name;

  // Pretty name translation & cleanup
  if (lower.includes('lion king')) {
    cleanName = 'Le Roi Lion : Les Rythmes de la Terre des Lions (Frontierland Theater)';
  } else if (lower.includes('together')) {
    cleanName = 'TOGETHER : Une Aventure Musicale Pixar (Studio Theater)';
  } else if (lower.includes('mickey and the magician') || lower.includes('magicien')) {
    cleanName = 'Mickey et le Magicien (Animagique Theater)';
  } else if (lower.includes('frozen') || lower.includes('reine des neiges')) {
    cleanName = 'La Reine des Neiges : Une Invitation Musicale';
  } else if (lower.includes('stars on parade')) {
    cleanName = 'Disney Stars on Parade';
  } else if (lower.includes('tales of magic')) {
    cleanName = 'Disney Tales of Magic (Spectacle Nocturne)';
  } else if (lower.includes('cascade of lights')) {
    cleanName = 'Disney Cascade of Lights';
  } else if (lower.includes('dream factory') || lower.includes('fabrique des')) {
    cleanName = 'La Fabrique des Rêves de Disney Junior (Studio D)';
  } else if (lower.includes('doctor strange')) {
    cleanName = 'Doctor Strange : Mystères Mystiques (Avengers Campus)';
  } else if (lower.includes('splashes of colour')) {
    cleanName = 'A Million Splashes of Colour';
  } else if (lower.includes('sleeping beauty')) {
    cleanName = 'Valse Royale de la Belle au Bois Dormant';
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

export async function fetchDlpShows(): Promise<{ shows: DlpShow[]; lastUpdated: string; isOffline: boolean }> {
  // Check local cache
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.timestamp < CACHE_TTL) {
        return { shows: parsed.shows, lastUpdated: parsed.lastUpdated, isOffline: false };
      }
    }
  } catch {
    // ignore local storage errors
  }

  try {
    const park1Promise = fetch('https://api.themeparks.wiki/v1/entity/dae968d5-630d-4719-8b06-3d107e944401/live')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
    const park2Promise = fetch('https://api.themeparks.wiki/v1/entity/ca888437-ebb4-4d50-aed2-d227f7096968/live')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);

    const [p1, p2] = await Promise.all([park1Promise, park2Promise]);

    if (!p1 && !p2) {
      throw new Error('APIs unavailable');
    }

    const allItems: any[] = [];
    if (p1?.liveData) {
      p1.liveData.forEach((item: any) => allItems.push({ ...item, park: 'Disneyland Park' }));
    }
    if (p2?.liveData) {
      p2.liveData.forEach((item: any) => allItems.push({ ...item, park: 'Walt Disney Studios' }));
    }

    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

    const shows: DlpShow[] = allItems
      .filter(item => item.entityType === 'SHOW')
      .filter(item => !item.name.toLowerCase().startsWith('reserved viewing'))
      .map(item => {
        const { category, cleanName } = categorizeShow(item.name);
        const times: string[] = (item.showtimes || [])
          .map((t: any) => (t.startTime ? t.startTime.slice(11, 16) : ''))
          .filter(Boolean)
          .sort();

        // Calculate next upcoming showtime
        let nextTime: string | undefined;
        for (const t of times) {
          const [th, tm] = t.split(':').map(Number);
          if (th * 60 + tm >= nowMinutes) {
            nextTime = t;
            break;
          }
        }

        const isClosed = item.status === 'CLOSED' || item.status === 'REFURBISHMENT';
        const isRelache = isClosed || times.length === 0;

        return {
          id: item.id || cleanName,
          name: cleanName,
          park: item.park,
          status: item.status || (isRelache ? 'CLOSED' : 'OPERATING'),
          isRelache,
          times,
          nextTime,
          category
        };
      })
      // Sort: spectacles with showtimes first, then parades, then relâches at the end
      .sort((a, b) => {
        if (a.isRelache !== b.isRelache) {
          return a.isRelache ? 1 : -1;
        }
        return a.name.localeCompare(b.name, 'fr');
      });

    const nowStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ shows, lastUpdated: nowStr, timestamp: Date.now() }));
    } catch {}

    return { shows, lastUpdated: nowStr, isOffline: false };
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
      return { ...s, nextTime };
    });
    return { shows, lastUpdated: 'Secours (Hors ligne)', isOffline: true };
  }
}
