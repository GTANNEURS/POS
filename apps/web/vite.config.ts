import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || "http://localhost:4000";

  return {
    plugins: [react()],
    server: {
      port: 5180,
      strictPort: true,
      host: "0.0.0.0",
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true
        }
      }
    }
  };
});
