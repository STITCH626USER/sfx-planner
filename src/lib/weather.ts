/**
 * Weather Service for Disneyland Paris (Chessy / Marne-la-Vallée)
 * Coordinates: Lat 48.8722, Lon 2.7758
 * Data source: Open-Meteo Free Weather API with offline/fallback resilience & localStorage caching
 */

export interface HourlyWeather {
  timeStr: string; // "14:00"
  fullIso: string; // "2026-09-26T14:00"
  temp: number; // in °C
  weatherCode: number;
  weatherLabel: string;
  weatherIcon: string;
  pop: number; // Probability of precipitation (0-100%)
  windSpeed: number; // km/h
  isCurrentHour: boolean;
  isPast: boolean;
}

export interface DailyWeatherSummary {
  currentTemp: number;
  currentCode: number;
  currentLabel: string;
  currentIcon: string;
  currentWind: number;
  tempMin: number;
  tempMax: number;
  locationName: string; // "Disneyland Paris (Chessy)"
  hourly: HourlyWeather[];
  lastUpdated: string;
  isOffline: boolean;
}

const WMO_MAP: Record<number, { label: string; icon: string; dayIcon: string; nightIcon: string }> = {
  0: { label: 'Ciel dégagé', icon: '☀️', dayIcon: '☀️', nightIcon: '🌙' },
  1: { label: 'Ensoleillé', icon: '🌤️', dayIcon: '🌤️', nightIcon: '🌤️' },
  2: { label: 'Éclaircies', icon: '⛅', dayIcon: '⛅', nightIcon: '☁️' },
  3: { label: 'Couvert', icon: '☁️', dayIcon: '☁️', nightIcon: '☁️' },
  45: { label: 'Brouillard', icon: '🌫️', dayIcon: '🌫️', nightIcon: '🌫️' },
  48: { label: 'Brouillard givrant', icon: '🌫️', dayIcon: '🌫️', nightIcon: '🌫️' },
  51: { label: 'Bruine légère', icon: '🌦️', dayIcon: '🌦️', nightIcon: '🌧️' },
  53: { label: 'Bruine modérée', icon: '🌦️', dayIcon: '🌦️', nightIcon: '🌧️' },
  55: { label: 'Bruine dense', icon: '🌧️', dayIcon: '🌧️', nightIcon: '🌧️' },
  61: { label: 'Pluie faible', icon: '🌦️', dayIcon: '🌦️', nightIcon: '🌧️' },
  63: { label: 'Pluie modérée', icon: '🌧️', dayIcon: '🌧️', nightIcon: '🌧️' },
  65: { label: 'Forte pluie', icon: '🌧️', dayIcon: '🌧️', nightIcon: '🌧️' },
  71: { label: 'Neige faible', icon: '🌨️', dayIcon: '🌨️', nightIcon: '🌨️' },
  73: { label: 'Neige modérée', icon: '🌨️', dayIcon: '🌨️', nightIcon: '🌨️' },
  75: { label: 'Forte neige', icon: '❄️', dayIcon: '❄️', nightIcon: '❄️' },
  80: { label: 'Averses faibles', icon: '🌦️', dayIcon: '🌦️', nightIcon: '🌧️' },
  81: { label: 'Averses modérées', icon: '🌧️', dayIcon: '🌧️', nightIcon: '🌧️' },
  82: { label: 'Violentes averses', icon: '⛈️', dayIcon: '⛈️', nightIcon: '⛈️' },
  95: { label: 'Orageux', icon: '⛈️', dayIcon: '⛈️', nightIcon: '⛈️' },
  96: { label: 'Orage avec grêle', icon: '⛈️', dayIcon: '⛈️', nightIcon: '⛈️' },
};

export function getWeatherInfo(code: number, hour = 12): { label: string; icon: string } {
  const isNight = hour < 7 || hour >= 21;
  const match = WMO_MAP[code] || { label: 'Nuageux', icon: '⛅', dayIcon: '⛅', nightIcon: '☁️' };
  return {
    label: match.label,
    icon: isNight ? match.nightIcon : match.dayIcon,
  };
}

const CACHE_KEY = 'dlp_weather_cache_v1';
const CACHE_TTL = 15 * 60 * 1000; // 15 mins

// Fallback realistic weather generator for Chessy / Marne-la-Vallée based on date & current hour
function getFallbackWeather(): DailyWeatherSummary {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  const hourly: HourlyWeather[] = [];
  const baseTemp = 17;

  for (let h = 8; h <= 23; h++) {
    // Diurnal temperature curve
    const tempOffset = Math.sin(((h - 8) / 15) * Math.PI) * 7;
    const temp = Math.round(baseTemp + tempOffset);
    const pop = h >= 14 && h <= 17 ? 20 : 5;
    const weatherCode = pop > 15 ? 2 : 1;
    const info = getWeatherInfo(weatherCode, h);

    hourly.push({
      timeStr: `${String(h).padStart(2, '0')}:00`,
      fullIso: `${now.toISOString().split('T')[0]}T${String(h).padStart(2, '0')}:00`,
      temp,
      weatherCode,
      weatherLabel: info.label,
      weatherIcon: info.icon,
      pop,
      windSpeed: 12 + (h % 5),
      isCurrentHour: h === currentHour,
      isPast: h < currentHour,
    });
  }

  const currentInfo = getWeatherInfo(1, currentHour);
  const temps = hourly.map(item => item.temp);

  return {
    currentTemp: Math.round(baseTemp + Math.sin(((currentHour - 8) / 15) * Math.PI) * 7),
    currentCode: 1,
    currentLabel: currentInfo.label,
    currentIcon: currentInfo.icon,
    currentWind: 14,
    tempMin: Math.min(...temps),
    tempMax: Math.max(...temps),
    locationName: 'Disneyland Paris · Chessy',
    hourly,
    lastUpdated: `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`,
    isOffline: true,
  };
}

export async function fetchDlpWeather(): Promise<DailyWeatherSummary> {
  const now = new Date();
  const todayIso = now.toISOString().split('T')[0];
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const updatedStr = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;

  // 1. Check local cache
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.timestamp < CACHE_TTL && parsed.date === todayIso) {
        // Update isCurrentHour and isPast flags based on live currentHour
        parsed.data.hourly = parsed.data.hourly.map((h: HourlyWeather) => {
          const hVal = parseInt(h.timeStr.slice(0, 2), 10);
          return {
            ...h,
            isCurrentHour: hVal === currentHour,
            isPast: hVal < currentHour,
          };
        });
        return parsed.data;
      }
    }
  } catch {
    // Ignore localStorage parse errors
  }

  // 2. Fetch live data from Open-Meteo
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=48.8722&longitude=2.7758&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m&current=temperature_2m,weather_code,wind_speed_10m&timezone=Europe%2FParis&forecast_days=1';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.hourly || !data.hourly.time) {
      throw new Error('Invalid Open-Meteo format');
    }

    const times: string[] = data.hourly.time;
    const temperatures: number[] = data.hourly.temperature_2m;
    const weatherCodes: number[] = data.hourly.weather_code;
    const pops: number[] = data.hourly.precipitation_probability || [];
    const winds: number[] = data.hourly.wind_speed_10m || [];

    const hourly: HourlyWeather[] = [];
    for (let i = 0; i < times.length; i++) {
      const iso = times[i];
      const hourPart = parseInt(iso.slice(11, 13), 10);

      // We focus on park schedule hours: 08:00 to 23:00 (or all 24h)
      if (hourPart >= 8 && hourPart <= 23) {
        const wCode = weatherCodes[i] ?? 0;
        const info = getWeatherInfo(wCode, hourPart);
        hourly.push({
          timeStr: `${String(hourPart).padStart(2, '0')}:00`,
          fullIso: iso,
          temp: Math.round(temperatures[i]),
          weatherCode: wCode,
          weatherLabel: info.label,
          weatherIcon: info.icon,
          pop: pops[i] ?? 0,
          windSpeed: Math.round(winds[i] ?? 0),
          isCurrentHour: hourPart === currentHour,
          isPast: hourPart < currentHour,
        });
      }
    }

    const currentTemp = data.current ? Math.round(data.current.temperature_2m) : (hourly.find(h => h.isCurrentHour)?.temp ?? 18);
    const currentCode = data.current ? data.current.weather_code : (hourly.find(h => h.isCurrentHour)?.weatherCode ?? 1);
    const currentWind = data.current ? Math.round(data.current.wind_speed_10m) : 10;
    const currentInfo = getWeatherInfo(currentCode, currentHour);

    const temps = hourly.map(h => h.temp);
    const summary: DailyWeatherSummary = {
      currentTemp,
      currentCode,
      currentLabel: currentInfo.label,
      currentIcon: currentInfo.icon,
      currentWind,
      tempMin: Math.min(...temps),
      tempMax: Math.max(...temps),
      locationName: 'Disneyland Paris · Chessy',
      hourly,
      lastUpdated: updatedStr,
      isOffline: false,
    };

    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          timestamp: Date.now(),
          date: todayIso,
          data: summary,
        })
      );
    } catch {}

    return summary;
  } catch (err) {
    console.warn('Live weather fetch failed, using fallback:', err);
    return getFallbackWeather();
  }
}
