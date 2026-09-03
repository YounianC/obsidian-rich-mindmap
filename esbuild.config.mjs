import esbuild from "esbuild";
import builtins from "builtin-modules";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: watch ? "inline" : false,
  treeShaking: true,
  outfile: "main.js",
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
