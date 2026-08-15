const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const MAX_IMAGE_LENGTH = 2_500_000;

const ANGULATION_POINTS = {
  mesioangular: 1,
  horizontal: 2,
  vertical: 3,
  distoangular: 4,
};
const DEPTH_POINTS = { A: 1, B: 2, C: 3 };
const RAMUS_POINTS = { I: 1, II: 2, III: 3 };

const SYSTEM_PROMPT = `You inspect a cropped panoramic dental X-ray for an educational game.
The crop contains one lower third molar, its neighboring second molar, and part of the mandibular ramus.
Do not diagnose disease, nerve involvement, treatment need, or surgical outcome.
Return JSON only. Do not use markdown.`;

function makePrompt(tooth) {
  return `Analyze lower third molar ${tooth} using visible radiographic geometry only.

Return exactly this object:
{
  "image_quality": "ok" | "low" | "invalid",
  "angulation": {
    "mesioangular": number,
    "horizontal": number,
    "vertical": number,
    "distoangular": number
  },
  "depth": { "A": number, "B": number, "C": number },
  "ramus": { "I": number, "II": number, "III": number },
  "evidence": [string, string, string]
}

Each probability group must sum to 1. Use low-confidence, flatter distributions when landmarks are unclear.
Depth: A is at or above the second molar occlusal plane; B is between its occlusal plane and cervical line; C is below its cervical line.
Ramus: I has enough space for the third-molar crown; II has less space than crown width; III is mainly within the ramus.
Evidence must be short, in Russian, and describe only visible geometry.`;
}

function jsonResponse(payload, status, origin) {
  return Response.json(payload, {
    status,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store",
      vary: "origin",
    },
  });
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
}

function normalizeDistribution(value, allowedKeys) {
  if (!value || typeof value !== "object") throw new Error("Missing probability group");
  const entries = allowedKeys.map((key) => [key, Math.max(0, Number(value[key]) || 0)]);
  const total = entries.reduce((sum, [, probability]) => sum + probability, 0);
  if (!total) throw new Error("Empty probability group");
  return Object.fromEntries(entries.map(([key, probability]) => [key, probability / total]));
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model did not return JSON");
  return JSON.parse(text.slice(start, end + 1));
}

export function normalizeFeatures(raw) {
  const quality = ["ok", "low", "invalid"].includes(raw.image_quality) ? raw.image_quality : "low";
  return {
    image_quality: quality,
    angulation: normalizeDistribution(raw.angulation, Object.keys(ANGULATION_POINTS)),
    depth: normalizeDistribution(raw.depth, Object.keys(DEPTH_POINTS)),
    ramus: normalizeDistribution(raw.ramus, Object.keys(RAMUS_POINTS)),
    evidence: Array.isArray(raw.evidence)
      ? raw.evidence.filter((item) => typeof item === "string").slice(0, 3)
      : [],
  };
}

function categoryForScore(score) {
  if (score <= 4) return "simple";
  if (score <= 6) return "medium";
  return "complex";
}

export function calculateDistribution(features) {
  const distribution = { simple: 0, medium: 0, complex: 0 };
  let mostLikely = { probability: -1, score: null, angulation: null, depth: null, ramus: null };

  for (const [angulation, angulationProbability] of Object.entries(features.angulation)) {
    for (const [depth, depthProbability] of Object.entries(features.depth)) {
      for (const [ramus, ramusProbability] of Object.entries(features.ramus)) {
        const probability = angulationProbability * depthProbability * ramusProbability;
        const score = ANGULATION_POINTS[angulation] + DEPTH_POINTS[depth] + RAMUS_POINTS[ramus];
        distribution[categoryForScore(score)] += probability;
        if (probability > mostLikely.probability) {
          mostLikely = { probability, score, angulation, depth, ramus };
        }
      }
    }
  }

  return { distribution, mostLikely };
}

export default {
  async fetch(request, env) {
    const requestOrigin = request.headers.get("origin") || env.ALLOWED_ORIGIN;
    const allowedOrigin = requestOrigin === env.ALLOWED_ORIGIN || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(requestOrigin)
      ? requestOrigin
      : env.ALLOWED_ORIGIN;

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, allowedOrigin);
    if (requestOrigin !== allowedOrigin) return jsonResponse({ error: "Origin not allowed" }, 403, env.ALLOWED_ORIGIN);

    try {
      const body = await request.json();
      if (!["38", "48"].includes(body.tooth)) return jsonResponse({ error: "Unknown tooth" }, 400, allowedOrigin);
      if (typeof body.image !== "string" || !body.image.startsWith("data:image/jpeg;base64,")) {
        return jsonResponse({ error: "JPEG data URL required" }, 400, allowedOrigin);
      }
      if (body.image.length > MAX_IMAGE_LENGTH) return jsonResponse({ error: "Image is too large" }, 413, allowedOrigin);

      const result = await env.AI.run(MODEL, {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: makePrompt(body.tooth) },
        ],
        image: body.image,
        max_tokens: 600,
        temperature: 0.1,
      });

      const modelText = typeof result === "string" ? result : result.response;
      const features = normalizeFeatures(extractJson(modelText));
      const score = calculateDistribution(features);
      return jsonResponse({ model: MODEL, tooth: body.tooth, features, ...score }, 200, allowedOrigin);
    } catch (error) {
      return jsonResponse({ error: "Model response could not be processed", detail: error.message }, 502, allowedOrigin);
    }
  },
};
