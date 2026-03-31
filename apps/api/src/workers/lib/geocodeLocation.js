import { safeText } from "./eventSchema.js";

const COUNTRY_FALLBACK_COORDS = {
  israel: { lat: 31.0461, lon: 34.8516 },
  ukraine: { lat: 48.3794, lon: 31.1656 },
  russia: { lat: 61.524, lon: 105.3188 },
  iran: { lat: 32.4279, lon: 53.688 },
  syria: { lat: 34.8021, lon: 38.9968 },
  lebanon: { lat: 33.8547, lon: 35.8623 },
  china: { lat: 35.8617, lon: 104.1954 },
  taiwan: { lat: 23.6978, lon: 120.9605 },
  india: { lat: 20.5937, lon: 78.9629 },
  pakistan: { lat: 30.3753, lon: 69.3451 },
  france: { lat: 46.2276, lon: 2.2137 },
  germany: { lat: 51.1657, lon: 10.4515 },
  "united kingdom": { lat: 55.3781, lon: -3.436 },
  "united states": { lat: 37.0902, lon: -95.7129 },
  usa: { lat: 37.0902, lon: -95.7129 },
  brazil: { lat: -14.235, lon: -51.9253 },
  venezuela: { lat: 6.4238, lon: -66.5897 },
  turkey: { lat: 38.9637, lon: 35.2433 },
  yemen: { lat: 15.5527, lon: 48.5164 },
  sudan: { lat: 12.8628, lon: 30.2176 },
  "dr congo": { lat: -4.0383, lon: 21.7587 },
  "democratic republic of the congo": { lat: -4.0383, lon: 21.7587 },
};

function countryFallback(country) {
  const key = safeText(country).toLowerCase();
  if (!key) {
    return null;
  }

  return COUNTRY_FALLBACK_COORDS[key] || null;
}

export async function geocodeLocation(city, country) {
  const normalizedCity = safeText(city);
  const normalizedCountry = safeText(country);
  const query = [normalizedCity, normalizedCountry].filter(Boolean).join(", ");

  if (!query) {
    return null;
  }

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "global-tension-map/0.1",
      "Accept-Language": "en",
    },
  });

  if (!response.ok) {
    return null;
  }

  const results = await response.json();
  const first = Array.isArray(results) ? results[0] : null;
  if (!first) {
    return countryFallback(normalizedCountry);
  }

  const geocoded = {
    lat: Number(first.lat),
    lon: Number(first.lon),
  };

  if (!Number.isFinite(geocoded.lat) || !Number.isFinite(geocoded.lon)) {
    return countryFallback(normalizedCountry);
  }

  return geocoded;
}
