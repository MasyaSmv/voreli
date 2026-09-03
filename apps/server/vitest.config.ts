import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
  // esbuild, which Vitest uses by default, drops `emitDecoratorMetadata`. Nest resolves
  // constructor dependencies from that metadata, so without SWC the DI container sees
  // untyped parameters and refuses to build the module.
  plugins: [swc.vite({ module: { type: "es6" } })],
});
