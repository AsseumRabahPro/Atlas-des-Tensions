import { WEIGHTS, mapTypeAndWeight, safeText, toIsoDate } from "./eventSchema.js";

const LOCATION_HINTS = [
  { country: "Israel", cities: ["Jerusalem", "Tel Aviv", "Haifa", "Gaza"] },
  { country: "Ukraine", cities: ["Kyiv", "Kharkiv", "Odesa", "Donetsk"] },
  { country: "Russia", cities: ["Moscow", "Belgorod", "Kursk", "Saint Petersburg"] },
  { country: "Iran", cities: ["Tehran", "Isfahan", "Tabriz"] },
  { country: "Syria", cities: ["Damascus", "Aleppo", "Idlib"] },
  { country: "Lebanon", cities: ["Beirut", "Tyre", "Sidon"] },
  { country: "China", cities: ["Beijing", "Shanghai", "Taipei", "Hong Kong"] },
  { country: "Taiwan", cities: ["Taipei", "Kaohsiung"] },
  { country: "India", cities: ["New Delhi", "Kashmir", "Mumbai"] },
  { country: "Pakistan", cities: ["Islamabad", "Karachi", "Lahore"] },
  { country: "France", cities: ["Paris", "Marseille", "Lyon"] },
  { country: "Germany", cities: ["Berlin", "Munich", "Hamburg"] },
  { country: "United Kingdom", cities: ["London", "Manchester", "Belfast"] },
  { country: "United States", cities: ["Washington", "New York", "Los Angeles"] },
  { country: "Brazil", cities: ["Brasilia", "Rio", "Sao Paulo"] },
  { country: "Venezuela", cities: ["Caracas"] },
  { country: "Turkey", cities: ["Ankara", "Istanbul"] },
  { country: "Yemen", cities: ["Sanaa", "Aden"] },
  { country: "Sudan", cities: ["Khartoum", "Darfur"] },
  { country: "DR Congo", cities: ["Kinshasa", "Goma"] },
];

const COUNTRY_ONLY_HINTS = [
  "Afghanistan",
  "Algeria",
  "Armenia",
  "Azerbaijan",
  "Bahrain",
  "Belarus",
  "Canada",
  "Chile",
  "Colombia",
  "Egypt",
  "Ethiopia",
  "Georgia",
  "Greece",
  "Iraq",
  "Japan",
  "Jordan",
  "Kazakhstan",
  "Libya",
  "Mexico",
  "Moldova",
  "Morocco",
  "Myanmar",
  "Nigeria",
  "North Korea",
  "Palestine",
  "Philippines",
  "Poland",
  "Qatar",
  "Romania",
  "Saudi Arabia",
  "Serbia",
  "Somalia",
  "South Korea",
  "South Sudan",
  "Spain",
  "Tunisia",
  "United Arab Emirates",
  "Vietnam",
];

function hasWord(text, needle) {
  return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

async function extractWithLlm(article) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const body = {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Extract one geopolitical event from a news article. Return strict JSON with keys country, city, type, weight, date, confidence. confidence must be between 0.5 and 0.8.",
      },
      {
        role: "user",
        content: JSON.stringify({
          title: article.title,
          description: article.description,
          content: article.content,
          publishedAt: article.publishedAt,
        }),
      },
    ],
  };

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const rawContent = payload?.choices?.[0]?.message?.content;
  if (!rawContent) {
    return null;
  }

  try {
    return JSON.parse(rawContent);
  } catch {
    return null;
  }
}

function detectLocation(text) {
  const lowerText = text.toLowerCase();

  for (const hint of LOCATION_HINTS) {
    if (lowerText.includes(hint.country.toLowerCase())) {
      const city = hint.cities.find((entry) => lowerText.includes(entry.toLowerCase())) || "";
      return { country: hint.country, city };
    }

    const city = hint.cities.find((entry) => lowerText.includes(entry.toLowerCase()));
    if (city) {
      return { country: hint.country, city };
    }
  }

  for (const country of COUNTRY_ONLY_HINTS) {
    if (hasWord(text, country)) {
      return { country, city: "" };
    }
  }

  return { country: "", city: "" };
}

function heuristicExtract(article) {
  const text = [article.title, article.description, article.content].filter(Boolean).join(" ");
  const { type, weight } = mapTypeAndWeight(text);
  const { country, city } = detectLocation(text);

  return {
    country,
    city,
    type,
    weight,
    date: toIsoDate(article.publishedAt) || new Date().toISOString(),
    confidence: country ? 0.65 : 0.5,
  };
}

export async function extractEventFromText(article) {
  const llmResult = await extractWithLlm(article);
  const fallback = heuristicExtract(article);

  const title = safeText(article.title);
  const description = safeText(article.description);
  const signalText = `${title} ${description}`;
  const inferred = mapTypeAndWeight(signalText);

  return {
    country: safeText(llmResult?.country) || fallback.country,
    city: safeText(llmResult?.city) || fallback.city,
    type: safeText(llmResult?.type) || fallback.type,
    weight: Number.isFinite(Number(llmResult?.weight)) ? Number(llmResult.weight) : inferred.weight,
    date: toIsoDate(llmResult?.date) || fallback.date,
    confidence: Math.min(0.8, Math.max(0.5, Number(llmResult?.confidence) || fallback.confidence)),
  };
}

export function isRelevantArticle(article) {
  const text = [article.title, article.description, article.content].filter(Boolean).join(" ");
  return /\b(war|attack|protest|conflict|sanction|tension|missile|drone|riot|strike)\b/i.test(text);
}
