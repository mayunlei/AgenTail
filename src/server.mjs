import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(sourceDirectory, "../public");

export async function startServer({ engine, host = "127.0.0.1", port = 4765 }) {
  await engine.start();
  const server = http.createServer(async (request, response) => {
    try {
      if (request.url?.startsWith("/api/")) return await handleApi(engine, request, response);
      return await serveStatic(request, response);
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  server.on("close", () => engine.stop());
  return { server, url: `http://${host}:${server.address().port}` };
}

async function handleApi(engine, request, response) {
  const url = new URL(request.url, "http://localhost");
  if (request.method === "GET" && url.pathname === "/api/status") return sendJson(response, 200, await engine.status());
  if (request.method === "GET" && url.pathname === "/api/canonical-sessions") {
    return sendJson(response, 200, { sessions: await engine.listCanonicalSessions(Number(url.searchParams.get("limit") ?? 100)) });
  }
  if (request.method === "GET" && url.pathname === "/api/sessions") {
    const agent = url.searchParams.get("agent");
    if (!agent) return sendJson(response, 400, { error: "agent is required" });
    return sendJson(response, 200, { sessions: await engine.listSessions(agent, Number(url.searchParams.get("limit") ?? 50)) });
  }
  if (request.method === "PUT" && url.pathname === "/api/config") {
    const config = await engine.updateConfig(await jsonBody(request));
    return sendJson(response, 200, { config });
  }
  if (request.method === "POST" && url.pathname === "/api/sync") {
    const body = await jsonBody(request);
    return sendJson(response, 200, await engine.syncOnce({ includeExisting: Boolean(body.includeExisting) }));
  }
  if (request.method === "POST" && url.pathname === "/api/import") {
    const body = await jsonBody(request);
    if (!body.sourceAgent || !body.sourceKey) return sendJson(response, 400, { error: "sourceAgent and sourceKey are required" });
    return sendJson(response, 200, await engine.importSession(body));
  }
  if (request.method === "POST" && url.pathname === "/api/conflicts/resolve") {
    const body = await jsonBody(request);
    if (!body.canonicalId || !body.conflictId) return sendJson(response, 400, { error: "canonicalId and conflictId are required" });
    return sendJson(response, 200, await engine.resolveConflict(body));
  }
  if (request.method === "POST" && url.pathname === "/api/export") {
    const body = await jsonBody(request);
    return sendJson(response, 200, await engine.exportNativeSession(body));
  }
  return sendJson(response, 404, { error: "Not found" });
}

async function serveStatic(request, response) {
  const url = new URL(request.url, "http://localhost");
  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = path.resolve(publicDirectory, requested);
  if (!file.startsWith(publicDirectory + path.sep) && file !== publicDirectory) return sendJson(response, 403, { error: "Forbidden" });
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    return sendJson(response, 404, { error: "Not found" });
  }
  response.writeHead(200, {
    "content-type": mimeType(file),
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'",
  });
  createReadStream(file).pipe(response);
}

async function jsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, body) {
  const payload = `${JSON.stringify(body)}\n`;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload), "cache-control": "no-store" });
  response.end(payload);
}

function mimeType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}
