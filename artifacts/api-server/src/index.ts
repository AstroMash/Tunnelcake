import app from "./app";
import { logger } from "./lib/logger";
import { resumeServers } from "./lib/manager";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const host = process.env["HOST"] ?? "127.0.0.1";

app.listen(port, host, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, host }, "Server listening");

  const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
  if (!loopbackHosts.has(host)) {
    logger.warn(
      { host },
      "Management API is bound to a non-loopback address and has no authentication. " +
        "This exposes server management (commands, secrets) to other hosts on the network. " +
        "Bind to 127.0.0.1 unless you intentionally need remote access.",
    );
  }

  resumeServers().catch((resumeErr) => {
    logger.error({ err: resumeErr }, "Failed to resume servers on startup");
  });
});
