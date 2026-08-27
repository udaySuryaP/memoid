import { parseApiConfig } from "@memoid/config";
import { buildServer } from "./server.js";
const config = parseApiConfig(process.env);
const app = buildServer(config);
const close = async () => {
  await app.close();
  process.exitCode = 0;
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
await app.listen({ host: "0.0.0.0", port: config.API_PORT });
