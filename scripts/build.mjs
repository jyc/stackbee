import * as fs from "fs";
import * as crypto from "crypto";
import * as path from "path";

import esbuild from "esbuild";
import { sassPlugin, postcssModules } from "esbuild-sass-plugin";

const BASE_PATH = "src";
const ENTRY_POINTS = ["src/embed.ts"];

const debug = ["true", "1", undefined].indexOf(process.env.DEBUG) !== -1;
const ignoreConfig = ["true", "1", undefined].indexOf(process.env.IGNORE_CONFIG) !== -1;
const minify = ["true", "1"].indexOf(process.env.MINIFY) !== -1;
const watch = ["true", "1"].indexOf(process.env.WATCH) !== -1;

const port = process.env.PORT ? +process.env.PORT : 8000;

async function beep(hasError) {
  if (hasError) {
    // Beep twice on failure.
    process.stderr.write("\x07");
    await new Promise((resolve) => setTimeout(resolve, 500));
    process.stderr.write("\x07");
  }
}

async function writeIfChanged(path, contents) {
  const didChange = !fs.existsSync(path) || fs.readFileSync(path).toString() !== contents;
  if (didChange) {
    console.log(`${path} changed; writing...`);
    fs.writeFileSync(path, contents);
  }
}

async function onBuildEnd(result) {
  const hasError = result.errors.length > 0;
  await beep(hasError);

  for (let out of result.outputFiles) {
    // Only write if the file changed so that e.g. Phoenix LiveReloader doesn't
    // reload the whole page when only CSS has changed.
    // console.log(out.path, out.contents, out.hash, out.text);
    writeIfChanged(out.path, out.text);
  }

  if (result?.metafile) {
    writeIfChanged("public/meta.json", JSON.stringify(result.metafile));
  }
}

try {
  const plugins = [
    sassPlugin({
      type: "css",
      transform: postcssModules({
        // https://github.com/madyankin/postcss-modules
        generateScopedName: function (name, filename, _css) {
          // const file = filename.replace(/\.[a-zA-Z]$/, "").replace(/[^a-zA-Z0-9]+/g, "-");
          // Use deterministic class names because they end up included in the
          // output JavaScript. That way if only CSS changes, the JavaScript
          // file stays the same, and Phoenix can hotreload the CSS only.
          const hash = crypto.createHash("sha256");
          hash.update(path.relative(BASE_PATH, filename));
          return name + "-" + hash.digest("hex").slice(0, 8);
        },
      }),
    }),
    {
      name: "exclude",
      setup: (build) => {
        build.onResolve({ filter: /\.(woff|woff2|eot)$/ }, (args) => {
          return { path: args.path, external: true };
        });
      },
    },
  ];

  if (watch) {
    plugins.push({
      name: "watch",
      setup: (build) => {
        build.onEnd(onBuildEnd);
      },
    });
  }

  let config = {};
  if (!ignoreConfig) {
    try {
      config = JSON.parse(fs.readFileSync("config.json", "utf8"));
    } catch {}
  }

  const define = {
    DEBUG: debug ? "true" : "false",
    "process.env.DEFAULT_API_KEY": JSON.stringify(config.defaultApiKey ?? null),
  };

  const ctx = await esbuild.context({
    entryPoints: ENTRY_POINTS,

    bundle: true,
    define,
    external: ["woff2/", "eot/"],
    metafile: true,
    minify,
    outdir: "public",
    platform: "browser",
    plugins,
    sourcemap: true,
    write: false,
  });
  if (watch) {
    await ctx.watch();
    await ctx.serve({
      servedir: "public",
      port,
    });
  } else {
    const result = await ctx.rebuild();
    onBuildEnd(result);
    await ctx.dispose();
  }
} catch (e) {
  await beep(e);
  console.error(e);
  process.exit(1);
}
