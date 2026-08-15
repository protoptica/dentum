import test from "node:test";
import assert from "node:assert/strict";
import worker, { calculateDistribution, normalizeFeatures } from "../src/index.js";

test("maps a certain easy combination to simple", () => {
  const features = normalizeFeatures({
    image_quality: "ok",
    angulation: { mesioangular: 1 },
    depth: { A: 1 },
    ramus: { I: 1 },
    evidence: [],
  });
  const result = calculateDistribution(features);
  assert.equal(result.distribution.simple, 1);
  assert.equal(result.mostLikely.score, 3);
});

test("maps a certain difficult combination to complex", () => {
  const features = normalizeFeatures({
    image_quality: "ok",
    angulation: { distoangular: 1 },
    depth: { C: 1 },
    ramus: { III: 1 },
    evidence: [],
  });
  const result = calculateDistribution(features);
  assert.equal(result.distribution.complex, 1);
  assert.equal(result.mostLikely.score, 10);
});

test("normalizes imperfect model probability groups", () => {
  const features = normalizeFeatures({
    image_quality: "low",
    angulation: { mesioangular: 2, horizontal: 2, vertical: 0, distoangular: 0 },
    depth: { A: 1, B: 1, C: 0 },
    ramus: { I: 0, II: 3, III: 0 },
    evidence: ["Нечёткая линия"],
  });
  const result = calculateDistribution(features);
  const total = Object.values(result.distribution).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("returns a scored response from the Worker contract", async () => {
  const request = new Request("https://worker.test", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://yaroslavnasol.ru" },
    body: JSON.stringify({
      tooth: "48",
      image: `data:image/jpeg;base64,${"a".repeat(40)}`,
    }),
  });
  const env = {
    ALLOWED_ORIGIN: "https://yaroslavnasol.ru",
    AI: {
      run: async () => ({
        response: JSON.stringify({
          image_quality: "ok",
          angulation: { mesioangular: 0.8, horizontal: 0.1, vertical: 0.1, distoangular: 0 },
          depth: { A: 0.1, B: 0.8, C: 0.1 },
          ramus: { I: 0.2, II: 0.7, III: 0.1 },
          evidence: ["Наклон к семёрке", "Коронка частично перекрыта ветвью"],
        }),
      }),
    },
  };
  const response = await worker.fetch(request, env);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.tooth, "48");
  assert.ok(payload.distribution.medium > payload.distribution.simple);
});
