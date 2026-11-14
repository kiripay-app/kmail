import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { calendarRoutes } from "./routes/calendar.js";
import { contactRoutes } from "./routes/contacts.js";
import { mailRoutes } from "./routes/mail.js";

const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 1024 * 1024 });

// Treat an empty JSON body (e.g. a bare POST /logout) as {} instead of a 400.
app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
  if (body === "") return done(null, {});
  try {
    done(null, JSON.parse(body as string));
  } catch {
    done(Object.assign(new Error("invalid json"), { statusCode: 400 }), undefined);
  }
});

await app.register(cookie);
await app.register(rateLimit, { global: false });

app.get("/api/health", async () => ({ status: "ok", service: "kmail-api" }));
await app.register(authRoutes);
await app.register(mailRoutes);
await app.register(calendarRoutes);
await app.register(contactRoutes);

app.addHook("onSend", async (_req, reply) => {
  reply.header("cache-control", "no-store");
  reply.header("x-content-type-options", "nosniff");
});

await app.listen({ port: config.port, host: "0.0.0.0" });
