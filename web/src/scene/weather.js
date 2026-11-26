// The current weather near the visitor, from Open-Meteo: free, no key, for non-commercial use under 10,000 calls a day (open-meteo.com/en/terms). The request carries the coordinates
// of a city, never the visitor's own, though the service sees the visitor's address as any web server does. The scene has five kinds of weather, so the WMO codes the service
// returns are folded into them.
const URL_BASE = 'https://api.open-meteo.com/v1/forecast';

// WMO weather interpretation codes (open-meteo.com/en/docs). There is no snow in the scene, so snow shows as a heavy overcast.
export function weatherFromCode(code) {
  if (!Number.isInteger(code) || code < 0 || code > 99) throw new Error(`unknown weather code ${code}`);
  if (code <= 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'overcast';
  throw new Error(`unknown weather code ${code}`);
}

// Resolves to one of the scene's weather names, or rejects, and the caller then keeps the daily pick. `fetchFn` is there for the tests.
export async function fetchLiveWeather(lat, lon, fetchFn = fetch, timeoutMs = 10000) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('bad coordinates');
  const url = `${URL_BASE}?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=weather_code&timezone=auto`;
  const reply = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!reply.ok) throw new Error(`weather service said ${reply.status}`);
  const data = await reply.json();
  return weatherFromCode(data && data.current && data.current.weather_code);
}
