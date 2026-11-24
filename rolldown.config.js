import { defineConfig } from "rolldown";
import { licensePlugin } from "rolldown-license-plugin";

export default defineConfig({
    input: "src/index.js",
    platform: "node",
    resolve: {
        // Resolve glob's dependencies individually so their licenses are collected.
        alias: { glob$: "glob/raw" },
    },
    output: {
        file: "dist/index.js",
        format: "es",
    },
    plugins: [
        licensePlugin({
            failOnUnlicensed: true,
            done(dependencies, context) {
                const licenses = dependencies
                    .map(
                        ({ name, version, license, licenseText }) =>
                            `${name}@${version}\n${license}\n${licenseText.trim()}`,
                    )
                    .sort();
                context.emitFile({
                    type: "asset",
                    fileName: "licenses.txt",
                    source: `${licenses.join("\n\n---\n\n")}\n`,
                });
            },
        }),
    ],
});
