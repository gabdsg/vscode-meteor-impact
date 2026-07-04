const assert = require("assert");

const { generateSettingsTypes } = require("../../src/settings-types");

describe("Meteor.settings type generation", () => {
    it("infers primitives, arrays and nested objects", () => {
        const output = generateSettingsTypes({
            public: {
                appName: "My App",
                maxItems: 10,
                beta: true,
                locales: ["en", "es"],
            },
            private: {
                smtp: { host: "smtp.example.com", port: 587 },
            },
        });

        assert.ok(output.includes("interface MeteorSettings {"));
        assert.ok(output.includes("appName: string;"));
        assert.ok(output.includes("maxItems: number;"));
        assert.ok(output.includes("beta: boolean;"));
        assert.ok(output.includes("locales: string[];"));
        assert.ok(output.includes("host: string;"));
        assert.ok(output.includes("port: number;"));
    });

    it("quotes non-identifier keys and handles mixed arrays", () => {
        const output = generateSettingsTypes({
            "kadira-options": { appId: "x" },
            mixed: [1, "two"],
            nothing: null,
            emptyList: [],
            emptyObject: {},
        });

        assert.ok(output.includes('"kadira-options": {'));
        assert.ok(output.includes("mixed: (number | string)[];"));
        assert.ok(output.includes("nothing: unknown;"));
        assert.ok(output.includes("emptyList: unknown[];"));
        assert.ok(output.includes("emptyObject: Record<string, unknown>;"));
    });

    it("tolerates empty settings", () => {
        const output = generateSettingsTypes({});
        assert.ok(
            output.includes("interface MeteorSettings Record<string, unknown>")
        );
    });
});
