import { createServer } from "node:http";

// The headers TurboWarp's own development server sends. A browser happily
// reuses a script it already ran, so without "no-store" an edit looks like it
// did nothing until you hard refresh.
const HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Access-Control-Allow-Origin": "*",
};

const PLAIN = "text/plain; charset=utf-8";

// getSource returns the compiled extension, or null while no build has
// succeeded yet.
export function startDevServer({ host, port, extensionPath, getSource, getTitle }) {
  let url = "";
  const server = createServer((req, res) => {
    for (const [header, value] of Object.entries(HEADERS)) res.setHeader(header, value);
    const send = (status, body, contentType = PLAIN) => {
      res.writeHead(status, { "Content-Type": contentType });
      res.end(body);
    };

    const { pathname } = new URL(req.url, "http://localhost");
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(405, "Only GET and HEAD are served here.");
      return;
    }
    if (pathname === "/" || pathname === "/index.html") {
      send(200, `${getTitle()}\n\n${url}${extensionPath}\n`);
      return;
    }
    if (pathname !== extensionPath) {
      send(404, `Not found. The compiled extension is at ${url}${extensionPath}\n`);
      return;
    }

    const source = getSource();
    if (source === null) {
      send(500, "Build failed. See the output of the twext process.\n");
      return;
    }
    send(200, source, "application/javascript; charset=utf-8");
  });

  return new Promise((finish, fail) => {
    server.once("error", fail);
    server.listen(port, host, () => {
      const address = server.address();
      const shown = host.includes(":") ? `[${host}]` : host;
      url = `http://${shown}:${address.port}`;
      finish({
        url,
        extensionUrl: `${url}${extensionPath}`,
        close: () =>
          new Promise((closed) => {
            // Keep-alive connections would otherwise hold the process open
            // after Ctrl+C.
            server.close(() => closed());
            server.closeAllConnections();
          }),
      });
    });
  });
}
