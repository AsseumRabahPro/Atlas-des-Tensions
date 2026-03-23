"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { GeoJSONSource, LngLatLike, MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type EventItem = {
  id: string;
  title: string;
  country: string;
  lat: number;
  lon: number;
  type: string;
  weight: number;
  confidence: number;
  date: string;
  source: string;
};

type TopEventItem = EventItem & {
  importance: number;
};

type CountryScore = {
  country: string;
  score: number;
  spike?: boolean;
};

type EventsResponse = {
  items: EventItem[];
  total: number;
  page: number;
  limit: number;
};

type TopEventsResponse = {
  items: TopEventItem[];
  limit: number;
};

type FilterState = {
  source: string;
  type: string;
  days: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";
const COUNTRIES_GEOJSON_URL =
  "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json";

const FALLBACK_EVENTS: EventItem[] = [
  {
    id: "fallback-1",
    title: "Border artillery exchange",
    country: "Ukraine",
    lat: 48.3794,
    lon: 31.1656,
    type: "war",
    weight: 10,
    confidence: 0.6,
    date: "2026-03-20T08:00:00.000Z",
    source: "gdelt",
  },
  {
    id: "fallback-2",
    title: "Drone strike near industrial site",
    country: "Iran",
    lat: 35.6892,
    lon: 51.389,
    type: "attack",
    weight: 9,
    confidence: 0.6,
    date: "2026-03-19T16:00:00.000Z",
    source: "gdelt",
  },
  {
    id: "fallback-3",
    title: "Mass protest in capital",
    country: "France",
    lat: 48.8566,
    lon: 2.3522,
    type: "protest",
    weight: 4,
    confidence: 0.6,
    date: "2026-03-17T13:30:00.000Z",
    source: "gdelt",
  },
  {
    id: "fallback-4",
    title: "Military operation near border",
    country: "Israel",
    lat: 31.7683,
    lon: 35.2137,
    type: "war",
    weight: 10,
    confidence: 0.9,
    date: "2026-03-20T07:10:00.000Z",
    source: "acled",
  },
];

const EMPTY_GEOJSON: GeoJSON.FeatureCollection<GeoJSON.Point> = {
  type: "FeatureCollection",
  features: [],
};

function scoreToColor(score: number): string {
  if (score <= 0) return "#000000";
  if (score <= 3) return "#FFFF00";
  if (score <= 7) return "#FFA500";
  return "#FF0000";
}

function makeEventGeoJSON(events: EventItem[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: events.map((event) => ({
      type: "Feature",
      properties: {
        id: event.id,
        title: event.title,
        country: event.country,
        type: event.type,
        weight: event.weight,
        confidence: event.confidence,
        date: event.date,
        source: event.source,
      },
      geometry: {
        type: "Point",
        coordinates: [event.lon, event.lat],
      },
    })),
  };
}

function normalizeCountryName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-zA-Z\s]/g, "")
    .trim()
    .toLowerCase();
}

function buildCountryScoresMap(scores: CountryScore[]) {
  const scoreMap = new Map<string, { score: number; spike: boolean }>();
  for (const row of scores) {
    scoreMap.set(normalizeCountryName(row.country), { score: row.score, spike: Boolean(row.spike) });
  }
  return scoreMap;
}

function buildFallbackScores(events: EventItem[]): CountryScore[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const totals = new Map<string, number>();

  for (const event of events) {
    const ageDays = Math.max(0, (now - new Date(event.date).getTime()) / dayMs);
    const decay = Math.exp(-ageDays / 7);
    const current = totals.get(event.country) || 0;
    totals.set(event.country, current + event.weight * event.confidence * decay);
  }

  return Array.from(totals.entries())
    .map(([country, score]) => ({ country, score: Number(score.toFixed(2)) }))
    .sort((a, b) => b.score - a.score);
}

function sourcePresentation(source: string) {
  const normalized = source.toLowerCase();
  if (normalized === "news") {
    return { label: "LIVE", className: "source-pill source-pill--news source-pill--live-pulse" };
  }
  return null;
}

function buildSourceBadgeHtml(source: string) {
  const presentation = sourcePresentation(source);
  if (!presentation) {
    return "";
  }
  return `<span class="${presentation.className}">${presentation.label}</span>`;
}

function filterFallbackEvents(events: EventItem[], filters: FilterState) {
  return events.filter((event) => {
    if (filters.source !== "all" && event.source !== filters.source) {
      return false;
    }

    if (filters.type !== "all" && event.type !== filters.type) {
      return false;
    }

    if (filters.days !== "all") {
      const maxAgeMs = Number(filters.days) * 24 * 60 * 60 * 1000;
      if (Date.now() - new Date(event.date).getTime() > maxAgeMs) {
        return false;
      }
    }

    return true;
  });
}

function buildFilterQuery(filters: FilterState) {
  const params = new URLSearchParams();

  if (filters.source !== "all") {
    params.set("source", filters.source);
  }

  if (filters.type !== "all") {
    params.set("type", filters.type);
  }

  if (filters.days !== "all") {
    params.set("days", filters.days);
  }

  return params;
}

async function fetchLatestCountryEvent(country: string, filters: FilterState): Promise<EventItem | null> {
  const params = buildFilterQuery(filters);
  params.set("country", country);
  params.set("limit", "1");

  const response = await fetch(`${API_BASE}/events?${params.toString()}`);
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as EventsResponse;
  return payload.items[0] || null;
}

export function TensionMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const eventsRef = useRef<EventItem[]>([]);
  const loadDataRef = useRef<(() => Promise<void>) | null>(null);
  const countriesDataRef = useRef<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [scores, setScores] = useState<CountryScore[]>([]);
  const [error, setError] = useState<string>("");
  const [topEvents, setTopEvents] = useState<TopEventItem[]>([]);
  const [filters, setFilters] = useState<FilterState>({ source: "all", type: "all", days: "7" });

  const eventsGeoJSON = useMemo(() => makeEventGeoJSON(events), [events]);
  const countryScoreMap = useMemo(() => buildCountryScoresMap(scores), [scores]);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      const map = mapRef.current;
      const zoom = map?.getZoom() ?? 1.4;
      const shouldLoadPoints = zoom >= 3;
      const params = buildFilterQuery(filters);
      params.set("limit", "800");

      const countryParams = buildFilterQuery(filters);
      const topParams = buildFilterQuery(filters);
      topParams.set("limit", "6");

      if (map) {
        const bounds = map.getBounds();
        params.set(
          "bbox",
          [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(",")
        );
      }

      try {
        const [eventsResponse, countriesResponse, topEventsResponse] = await Promise.all([
          shouldLoadPoints ? fetch(`${API_BASE}/events?${params.toString()}`) : Promise.resolve(null),
          fetch(`${API_BASE}/countries?${countryParams.toString()}`),
          fetch(`${API_BASE}/events/top?${topParams.toString()}`),
        ]);

        if ((eventsResponse && !eventsResponse.ok) || !countriesResponse.ok || !topEventsResponse.ok) {
          throw new Error("Unable to load API data");
        }

        const eventsData = eventsResponse ? ((await eventsResponse.json()) as EventsResponse) : { items: [] };
        const countriesData = (await countriesResponse.json()) as CountryScore[];
        const topData = (await topEventsResponse.json()) as TopEventsResponse;

        if (!cancelled) {
          setEvents(eventsData.items);
          setScores(countriesData);
          setTopEvents(Array.isArray(topData.items) ? topData.items : []);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          const fallbackEvents = filterFallbackEvents(FALLBACK_EVENTS, filters);
          setEvents(fallbackEvents);
          setScores(buildFallbackScores(fallbackEvents));
          const fallbackTop = [...fallbackEvents]
            .map((event) => ({
              ...event,
              importance: Number((event.weight * event.confidence).toFixed(2)),
            }))
            .sort((a, b) => b.importance - a.importance)
            .slice(0, 6);
          setTopEvents(fallbackTop);
          setError("API indisponible: affichage des donnees locales de secours");
        }
      }
    }

    loadDataRef.current = loadData;
    loadData();
    const timer = setInterval(loadData, 30_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [filters]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        name: "Global Tension Minimal",
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: {
              "background-color": "#000000",
            },
          },
        ],
      },
      center: [6, 20] as LngLatLike,
      zoom: 1.4,
      minZoom: 1,
      maxZoom: 8,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");

    map.on("load", async () => {
      map.addSource("events", {
        type: "geojson",
        data: EMPTY_GEOJSON,
        cluster: true,
        clusterMaxZoom: 6,
        clusterRadius: 60,
      });

      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "events",
        filter: ["has", "point_count"],
        minzoom: 3,
        maxzoom: 6,
        paint: {
          "circle-color": "#FFFFFF",
          "circle-radius": ["step", ["get", "point_count"], 14, 10, 20, 50, 28],
          "circle-opacity": 0.8,
        },
      });

      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "events",
        filter: ["has", "point_count"],
        minzoom: 3,
        maxzoom: 6,
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Open Sans Bold"],
          "text-size": 12,
        },
        paint: {
          "text-color": "#000000",
        },
      });

      map.addLayer({
        id: "event-points",
        type: "circle",
        source: "events",
        filter: ["!", ["has", "point_count"]],
        minzoom: 5,
        paint: {
          "circle-color": ["case", ["==", ["get", "source"], "news"], "#ff3b30", "#FFFFFF"],
          "circle-stroke-color": "#000000",
          "circle-stroke-width": 1,
          "circle-radius": ["case", ["==", ["get", "source"], "news"], 5.5, 4],
        },
      });

      const countriesResponse = await fetch(COUNTRIES_GEOJSON_URL);
      const countriesGeoJSON = (await countriesResponse.json()) as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
      countriesDataRef.current = countriesGeoJSON;

      map.addSource("countries", {
        type: "geojson",
        data: countriesGeoJSON,
      });

      map.addLayer({
        id: "country-fill",
        type: "fill",
        source: "countries",
        paint: {
          "fill-color": ["coalesce", ["get", "fillColor"], "#000000"],
          "fill-opacity": 0.75,
        },
      });

      map.addLayer({
        id: "country-borders",
        type: "line",
        source: "countries",
        paint: {
          "line-color": "#FFFFFF",
          "line-width": 0.8,
          "line-opacity": 0.95,
        },
      });

      map.addLayer({
        id: "country-spike-outline",
        type: "line",
        source: "countries",
        filter: ["==", ["get", "spike"], true],
        paint: {
          "line-color": "#ff3b30",
          "line-width": 2.1,
          "line-opacity": 0.95,
        },
      });

      map.on("click", "event-points", (e) => {
        const feature = e.features?.[0];
        if (!feature || !feature.geometry || feature.geometry.type !== "Point") {
          return;
        }

        const props = feature.properties || {};
        const sourceBadge = buildSourceBadgeHtml(String(props.source || "gdelt"));
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: false })
          .setLngLat(feature.geometry.coordinates as [number, number])
          .setHTML(
            `<strong>${props.title || "Event"}</strong>${sourceBadge ? `<br/>${sourceBadge}` : ""}<br/>${props.country || "Unknown"}<br/>Type: ${props.type || "n/a"}<br/>Weight: ${props.weight || "n/a"}<br/>Confidence: ${props.confidence || "n/a"}`
          )
          .addTo(map);
      });

      map.on("click", "country-fill", async (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature) {
          return;
        }

        const name = String(feature.properties?.name || "Unknown country");
        const score = Number(feature.properties?.score || 0);
        const spike = Boolean(feature.properties?.spike);
        const normalizedName = normalizeCountryName(name);
        let latestEvent: EventItem | null = eventsRef.current
          .filter((event) => normalizeCountryName(event.country) === normalizedName)
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

        if (!latestEvent) {
          latestEvent = await fetchLatestCountryEvent(name, filters);
        }

        const newsLine = latestEvent
          ? `Derniere news: ${latestEvent.title}${buildSourceBadgeHtml(latestEvent.source) ? `<br/>${buildSourceBadgeHtml(latestEvent.source)}` : ""}<br/>Type: ${latestEvent.type}<br/>Date: ${new Date(latestEvent.date).toLocaleString()}`
          : "Derniere news: aucune donnee disponible";
        const spikeLine = spike ? '<br/><span class="spike-indicator">🔥 Activity spike</span>' : "";

        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: false })
          .setLngLat(e.lngLat)
          .setHTML(`<strong>${name}</strong><br/>Score: ${score.toFixed(2)}${spikeLine}<br/>${newsLine}`)
          .addTo(map);
      });

      map.on("mouseenter", "event-points", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "event-points", () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("mouseenter", "country-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "country-fill", () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("moveend", () => {
        void loadDataRef.current?.();
      });

      map.on("zoomend", () => {
        const eventSource = map.getSource("events") as GeoJSONSource | undefined;
        if (!eventSource) {
          return;
        }

        if (map.getZoom() < 3) {
          eventSource.setData(EMPTY_GEOJSON);
          return;
        }

        void loadDataRef.current?.();
      });

      void loadDataRef.current?.();
    });

    mapRef.current = map;

    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    const eventSource = map.getSource("events") as GeoJSONSource | undefined;
    if (eventSource) {
      if (map.getZoom() < 3) {
        eventSource.setData(EMPTY_GEOJSON);
      } else {
        eventSource.setData(eventsGeoJSON);
      }
    }

    const countrySource = map.getSource("countries") as GeoJSONSource | undefined;
    const countriesData = countriesDataRef.current;
    if (!countrySource || !countriesData) {
      return;
    }

    const updatedFeatures = countriesData.features.map((feature) => {
      const rawName = String(feature.properties?.name || "");
      const countryState = countryScoreMap.get(normalizeCountryName(rawName)) || {
        score: 0,
        spike: false,
      };
      return {
        ...feature,
        properties: {
          ...feature.properties,
          score: countryState.score,
          spike: countryState.spike,
          fillColor: scoreToColor(countryState.score),
        },
      };
    });

    const updatedData = {
      ...countriesData,
      features: updatedFeatures,
    };

    countriesDataRef.current = updatedData;
    countrySource.setData(updatedData);
  }, [eventsGeoJSON, countryScoreMap]);

  return (
    <section className="map-shell">
      <div className="filters-panel">
        <label>
          Source
          <select
            value={filters.source}
            onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value }))}
          >
            <option value="all">Toutes</option>
            <option value="news">LIVE</option>
          </select>
        </label>
        <label>
          Type
          <select
            value={filters.type}
            onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}
          >
            <option value="all">Tous</option>
            <option value="war">War</option>
            <option value="attack">Attack</option>
            <option value="conflict">Conflict</option>
            <option value="sanction">Sanction</option>
            <option value="protest">Protest</option>
            <option value="tension">Tension</option>
            <option value="politic">Politic</option>
          </select>
        </label>
        <label>
          Periode
          <select
            value={filters.days}
            onChange={(event) => setFilters((current) => ({ ...current, days: event.target.value }))}
          >
            <option value="1">24h</option>
            <option value="7">7j</option>
            <option value="30">30j</option>
            <option value="all">Tout</option>
          </select>
        </label>
      </div>
      <div className="legend">
        <span>0</span>
        <span className="legend-swatch yellow">1-3</span>
        <span className="legend-swatch orange">4-7</span>
        <span className="legend-swatch red">8+</span>
      </div>
      {error ? <div className="error">API error: {error}</div> : null}
      <div className="top-events-panel">
        <h3>Top global events</h3>
        {topEvents.length === 0 ? <p>Aucun evenement prioritaire</p> : null}
        {topEvents.map((event) => (
          <div key={event.id} className="top-event-row">
            <div className="top-event-title">{event.title}</div>
            <div className="top-event-meta">
              <span>{event.country}</span>
              <span>{event.type}</span>
              <span>Score {event.importance.toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>
      <div ref={containerRef} className="map" />
    </section>
  );
}
