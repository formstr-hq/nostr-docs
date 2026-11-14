/**
 * Minimal in-memory Blossom server for e2e tests.
 *
 * Stores encrypted blobs by opaque id, supports BUD-02 upload, BUD-01 GET and
 * best-effort DELETE, and exposes /stats so specs can assert that binaries
 * actually left the Nostr event. No auth verification — the app signs real
 * BUD-02 events, but this server only needs to store the bytes.
 */
const http = require("http");
const { randomUUID } = require("crypto");

const PORT = Number(process.env.BLOSSOM_PORT || 7450);
const BASE = `http://localhost:${PORT}`;
const blobs = new Map();

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

function sendJson(res, status, value) {
  cors(res);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", BASE);

  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  if (req.method === "GET" && url.pathname === "/stats") {
    sendJson(res, 200, {
      count: blobs.size,
      bytes: Array.from(blobs.values()).reduce((sum, value) => sum + value.length, 0),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/clear") {
    blobs.clear();
    sendJson(res, 200, { cleared: true });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/upload") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const id = randomUUID();
      blobs.set(id, body);
      sendJson(res, 200, { url: `${BASE}/${id}`, size: body.length });
    });
    return;
  }

  if (req.method === "GET" && url.pathname !== "/") {
    const id = url.pathname.slice(1);
    const body = blobs.get(id);
    if (!body) {
      res.writeHead(404);
      res.end();
      return;
    }
    cors(res);
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(body.length),
    });
    res.end(body);
    return;
  }

  if (req.method === "DELETE" && url.pathname !== "/") {
    blobs.delete(url.pathname.slice(1));
    cors(res);
    res.writeHead(200);
    res.end("deleted");
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[e2e-blossom] listening on ${BASE}`);
});
