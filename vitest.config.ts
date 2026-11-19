import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // Avoid CPU contention on small hosted runners. The multi-step user-event
    // flows can exceed Vitest's five-second limit on hosted Intel Macs.
    fileParallelism: false,
    testTimeout: 20_000,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
