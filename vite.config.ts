import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static SPA. The whole tool runs client-side; no server.
export default defineConfig({
  plugins: [react()],
});
