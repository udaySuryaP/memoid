import { randomUUID } from "node:crypto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { NodeSDK } from "@opentelemetry/sdk-node";
import pino, { type DestinationStream, type Logger } from "pino";

const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "password",
  "token",
  "secret",
  "apiKey",
  "privateKey",
  "*.password",
  "*.token",
  "*.secret",
  "*.apiKey",
  "*.privateKey",
];
export function createLogger(
  name: string,
  level = "info",
  destination?: DestinationStream,
): Logger {
  return pino(
    { name, level, redact: { paths: redactPaths, censor: "[REDACTED]" }, base: null },
    destination,
  );
}
export const createCorrelationId = (): string => randomUUID();
export function createTelemetrySdk(serviceName: string): NodeSDK {
  return new NodeSDK({ resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }) });
}
