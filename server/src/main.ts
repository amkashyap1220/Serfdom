import { GameServer } from "./game-server.ts";
import { consoleLogger } from "./log.ts";

const DEFAULT_PORT = 8080;

function readPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer 1–65535, got "${raw}"`);
  }
  return port;
}

try {
  const port = readPort();
  const server = await GameServer.start({ port });
  consoleLogger.info(
    `Serfdom server listening on ws://localhost:${server.port}`,
  );

  const shutdown = (): void => {
    consoleLogger.info("shutting down");
    server.close().then(
      () => process.exit(0),
      (err: unknown) => {
        consoleLogger.warn(`error during shutdown: ${String(err)}`);
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (err) {
  const message =
    err instanceof Error && "code" in err && err.code === "EADDRINUSE"
      ? `port already in use; stop the other server or set PORT`
      : String(err);
  consoleLogger.warn(`server failed to start: ${message}`);
  process.exit(1);
}
