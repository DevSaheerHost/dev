import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  // `server-only` throws outside React Server Components; tests run on the server side.
  "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      { resolve: { alias }, test: { name: "unit", environment: "node", include: ["src/**/*.test.ts"], exclude: ["src/**/*.emulator.test.ts"] } },
      {
        resolve: { alias },
        test: {
          name: "firebase",
          environment: "node",
          include: ["src/**/*.emulator.test.ts", "firebase/**/*.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
