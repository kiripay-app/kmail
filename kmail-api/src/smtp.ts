import nodemailer from "nodemailer";
import { config } from "./config.js";
import type { Creds } from "./imap.js";

export const transportFor = ({ user, pass }: Creds) =>
  nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: false,
    requireTLS: true,
    auth: { user, pass },
    tls: { rejectUnauthorized: config.smtp.rejectUnauthorized },
  });
