/**
 * Minimal server logger. Log lines must never contain IP addresses, tokens,
 * or other private data (T-025); identify connections by guest id only.
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

export const consoleLogger: Logger = {
  info: (message) =>
    console.log(`${new Date().toISOString()} INFO  ${message}`),
  warn: (message) =>
    console.warn(`${new Date().toISOString()} WARN  ${message}`),
};

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
};
