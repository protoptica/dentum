import http from "node:http";
import worker from "../src/index.js";

const env = {
  ALLOWED_ORIGIN: "http://127.0.0.1:8897",
  AI: {
    run: async () => ({
      response: JSON.stringify({
        image_quality: "ok",
        angulation: { mesioangular: 0.08, horizontal: 0.82, vertical: 0.07, distoangular: 0.03 },
        depth: { A: 0.08, B: 0.77, C: 0.15 },
        ramus: { I: 0.06, II: 0.74, III: 0.2 },
        evidence: ["Продольная ось зуба почти горизонтальна", "Коронка частично перекрыта ветвью"],
      }),
    }),
  },
};

const server = http.createServer(async (incoming, outgoing) => {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const request = new Request(`http://127.0.0.1:8787${incoming.url}`, {
    method: incoming.method,
    headers: incoming.headers,
    body: ["GET", "HEAD"].includes(incoming.method) ? undefined : body,
  });
  const response = await worker.fetch(request, env);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(8787, "127.0.0.1", () => {
  console.log("Mock Worker listening on http://127.0.0.1:8787");
});
