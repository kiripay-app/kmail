import Fastify from "fastify";

const app = Fastify({ logger: true });

app.get("/api/health", async () => ({ status: "ok", service: "kmail-api" }));

// Planned: /api/auth (IMAP login), /api/mail/*, /api/calendar/*, /api/contacts/*
const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" });
