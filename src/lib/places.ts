import "server-only";

export type Place = {
  name: string;
  address: string;
  rating?: number;
  reviews?: number;
  price?: string;
  openNow?: boolean;
  mapsUrl?: string;
  website?: string;
  summary?: string;
  types?: string[];
};

const PRICE: Record<string, string> = {
  PRICE_LEVEL_FREE: "free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

export async function findPlaces(query: string, near?: string, limit = 6): Promise<Place[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("Places search is not configured");
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours.openNow,places.googleMapsUri,places.websiteUri,places.editorialSummary,places.primaryTypeDisplayName",
    },
    body: JSON.stringify({ textQuery: near ? `${query} near ${near}` : query, pageSize: Math.min(limit, 10) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Places search failed (${res.status})`);
  const data = (await res.json()) as { places?: Record<string, unknown>[] };
  return (data.places ?? []).map((p) => {
    const hours = p.currentOpeningHours as { openNow?: boolean } | undefined;
    return {
      name: (p.displayName as { text?: string })?.text ?? "",
      address: (p.formattedAddress as string) ?? "",
      rating: p.rating as number | undefined,
      reviews: p.userRatingCount as number | undefined,
      price: PRICE[p.priceLevel as string],
      openNow: hours?.openNow,
      mapsUrl: p.googleMapsUri as string | undefined,
      website: p.websiteUri as string | undefined,
      summary: (p.editorialSummary as { text?: string })?.text,
      types: [(p.primaryTypeDisplayName as { text?: string })?.text].filter(Boolean) as string[],
    };
  });
}

const WMO: Record<number, string> = {
  0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow", 80: "showers", 81: "showers", 82: "heavy showers",
  95: "thunderstorms", 96: "thunderstorms w/ hail", 99: "thunderstorms w/ hail",
};

export async function getWeather(location: string, days = 5) {
  const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location.split(",")[0])}&count=1&language=en`, { signal: AbortSignal.timeout(8000) });
  const g = (await geo.json()) as { results?: { latitude: number; longitude: number; name: string; admin1?: string; country?: string; timezone?: string }[] };
  const place = g.results?.[0];
  if (!place) throw new Error(`Couldn't find "${location}"`);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=${encodeURIComponent(place.timezone ?? "auto")}&forecast_days=${Math.min(Math.max(days, 1), 10)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const w = (await res.json()) as {
    current: { temperature_2m: number; weather_code: number; wind_speed_10m: number };
    daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] };
  };
  return {
    place: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
    now: `${Math.round(w.current.temperature_2m)}°F, ${WMO[w.current.weather_code] ?? "—"}, wind ${Math.round(w.current.wind_speed_10m)} mph`,
    days: w.daily.time.map((d, i) => `${new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} ${d}:${WMO[w.daily.weather_code[i]] ?? "—"}, ${Math.round(w.daily.temperature_2m_min[i])}–${Math.round(w.daily.temperature_2m_max[i])}°F, rain ${w.daily.precipitation_probability_max[i] ?? 0}%`),
  };
}
