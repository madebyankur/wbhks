import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/core.ts",
    "src/middleware.ts",
    "src/client.ts",
    "src/frameworks.ts",
  ],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: true,
  treeshake: true,
  target: "es2020",
  outDir: "dist",
  external: ["uuid", "zod"],
  esbuildOptions(options) {
    options.treeShaking = true;
    options.minify = true;
    options.minifyIdentifiers = true;
    options.minifySyntax = true;
    options.minifyWhitespace = true;
    options.keepNames = true;
  },
  onSuccess: 'echo "Build completed successfully!"',
});
