import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served under /kmail-admin/ (by the kmail-admin container itself, behind nginx).
export default defineConfig({
  base: "/kmail-admin/",
  plugins: [react()],
  server: { proxy: { "/kmail-admin/api": "http://localhost:3100" } },
});
