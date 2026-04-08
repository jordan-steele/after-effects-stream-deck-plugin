import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const isWatch = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.jordansteele.aftereffects.sdPlugin";
const manifestSource = "plugin/manifest.json";
const uiSourceDir = "ui";
const imageSourceDir = "assets/imgs";

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function pluginScaffold() {
  return {
    name: "plugin-scaffold",
    buildStart: async function () {
      await rm(sdPlugin, { recursive: true, force: true });

      this.addWatchFile(manifestSource);
      for (const file of await listFiles(uiSourceDir)) {
        this.addWatchFile(file);
      }
      for (const file of await listFiles(imageSourceDir)) {
        this.addWatchFile(file);
      }
    },
    writeBundle: async function () {
      await mkdir(sdPlugin, { recursive: true });
      await cp(manifestSource, path.join(sdPlugin, "manifest.json"), {
        force: true,
      });
      await cp(uiSourceDir, path.join(sdPlugin, "pi"), {
        recursive: true,
        force: true,
      });
      await cp(imageSourceDir, path.join(sdPlugin, "imgs"), {
        recursive: true,
        force: true,
      });
    },
  };
}

/**
 * @type {import("rollup").RollupOptions}
 */
const config = {
  input: "src/plugin.ts",
  output: {
    file: `${sdPlugin}/bin/plugin.js`,
    sourcemap: isWatch,
    sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
      return url.pathToFileURL(
        path.resolve(path.dirname(sourcemapPath), relativeSourcePath)
      ).href;
    },
  },
  plugins: [
    pluginScaffold(),
    typescript(),
    nodeResolve({
      browser: false,
      exportConditions: ["node"],
      preferBuiltins: true,
    }),
    commonjs(),
    ...(isWatch
      ? [
          (function restart() {
            return {
              name: "restart",
              writeBundle: async function () {
                const cp = await import("node:child_process");
                cp.execSync(
                  `npx streamdeck restart ${sdPlugin}`,
                  { stdio: "inherit" }
                );
              },
            };
          })(),
        ]
      : []),
  ],
};

export default config;
