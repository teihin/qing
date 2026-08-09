import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, ".", "XUAN_");
  const apiTarget = env.XUAN_DEV_API_TARGET || "http://127.0.0.1:8891";
  const apiOrigin = new URL(apiTarget).origin;
  const apiPrefix = (env.XUAN_DEV_API_PREFIX || "").replace(/\/$/, "");

  return {
    base: command === "build" ? "/xuanmanager/" : "/",
    plugins: [react()],
    server: {
      port: 7458,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          headers: { Origin: apiOrigin },
          rewrite: (path) => `${apiPrefix}${path}`,
        },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
    },
  };
});
