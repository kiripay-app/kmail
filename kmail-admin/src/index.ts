import { makeAdapter } from "./adapters/index.js";
import { config } from "./config.js";
import { adminCount } from "./auth.js";
import { open } from "./db.js";
import { buildServer } from "./server.js";

open();
const app = await buildServer(makeAdapter(), { logger: true });
if (adminCount() === 0) app.log.warn("No administrators yet. Run: docker compose exec kmail-admin node --disable-warning=ExperimentalWarning dist/cli.js create-admin <username>");
await app.listen({ port: config.port, host: "0.0.0.0" });
