import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app is served under /kmail/ by mailcow's nginx (data/conf/nginx/site.kmail.custom).
export default defineConfig({
  base: "/kmail/",
  plugins: [react()],
  server: { proxy: { "/kmail/api": { target: "http://localhost:3000", rewrite: (p) => p.replace(/^\/kmail/, "") } } },
});
