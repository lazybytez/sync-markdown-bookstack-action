import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.test.js"],
        coverage: {
            provider: "v8",
            include: ["src/**/*.js"],
            exclude: [
                "src/**/*.test.js",
                "src/bookstack.js",
                "src/configuration.js",
                "src/index.js",
                "src/parser.js",
            ],
            thresholds: { lines: 90 },
        },
    },
});
