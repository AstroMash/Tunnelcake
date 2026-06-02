import express, { type Express } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Local single-process mode: when `MCP_WEB_DIST` points at the built frontend,
// serve it as static assets from this same server so the whole app runs as one
// process (used by the `npx` launcher). In the Replit dev/prod environment the
// frontend is served separately and this is left unset, so the block is skipped.
const webDist = process.env["MCP_WEB_DIST"];
if (webDist && existsSync(webDist)) {
  app.use(express.static(webDist));
  // SPA fallback: serve index.html for any non-API GET so client-side routes
  // resolve correctly on refresh/deep-link.
  app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
  logger.info({ webDist }, "Serving web UI from static assets");
}

export default app;
