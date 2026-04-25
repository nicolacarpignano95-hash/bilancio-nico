import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const projectRoot = resolve(".");
const args = process.argv.slice(2);

function getArgValue(name, fallback) {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }
  return fallback;
}

const host = getArgValue("--host", process.env.HOST || "0.0.0.0");
const port = Number(getArgValue("--port", process.env.PORT || 3000));

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function safePath(urlPath) {
  const cleanPath = normalize(decodeURIComponent(urlPath.split("?")[0])).replace(
    /^(\.\.[/\\])+/,
    "",
  );
  const requestedPath = cleanPath === "/" ? "/index.html" : cleanPath;
  return resolve(projectRoot, `.${requestedPath}`);
}

function sendFile(response, filePath) {
  const extension = extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": mimeTypes[extension] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer((request, response) => {
  console.log(`${request.method} ${request.url}`);
  const filePath = safePath(request.url || "/");
  const insideProject = filePath.startsWith(projectRoot);

  if (!insideProject) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Accesso negato.");
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    sendFile(response, filePath);
    return;
  }

  const fallback = join(projectRoot, "index.html");
  if (existsSync(fallback)) {
    sendFile(response, fallback);
    return;
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("File non trovato.");
});

server.listen(port, host, () => {
  console.log(`Bilancio Nico in ascolto su http://${host}:${port}`);
});
