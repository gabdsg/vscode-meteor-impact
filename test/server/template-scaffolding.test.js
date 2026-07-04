const assert = require("assert");

const {
    buildTemplateScaffolding,
    TEMPLATE_NAME_REGEX,
} = require("../../src/template-scaffolding");

const fileNamed = (files, fileName) =>
    files.find((file) => file.fileName === fileName);

describe("Template scaffolding", () => {
    it("builds html, script and style files with less", () => {
        const files = buildTemplateScaffolding({
            name: "myWidget",
            scriptExtension: ".js",
            styleExtension: ".less",
        });

        assert.deepStrictEqual(
            files.map(({ fileName }) => fileName).sort(),
            ["myWidget.html", "myWidget.js", "myWidget.less"]
        );

        const html = fileNamed(files, "myWidget.html").content;
        assert.ok(html.includes('<template name="myWidget">'));
        assert.ok(html.includes("</template>"));

        const script = fileNamed(files, "myWidget.js").content;
        assert.ok(
            script.includes('import { Template } from "meteor/templating";')
        );
        assert.ok(script.includes('import "./myWidget.html";'));
        assert.ok(script.includes('import "./myWidget.less";'));
        assert.ok(script.includes("Template.myWidget.onCreated(function () {"));
        assert.ok(script.includes("Template.myWidget.helpers({"));
        assert.ok(script.includes("Template.myWidget.events({"));
    });

    it("builds a css file when less is not used", () => {
        const files = buildTemplateScaffolding({
            name: "myWidget",
            scriptExtension: ".ts",
            styleExtension: ".css",
        });

        assert.ok(fileNamed(files, "myWidget.css"));
        assert.ok(fileNamed(files, "myWidget.ts"));
        assert.ok(
            fileNamed(files, "myWidget.ts").content.includes(
                'import "./myWidget.css";'
            )
        );
    });

    it("omits the style file and its import when not requested", () => {
        const files = buildTemplateScaffolding({
            name: "myWidget",
            scriptExtension: ".js",
            styleExtension: null,
        });

        assert.strictEqual(files.length, 2);

        const script = fileNamed(files, "myWidget.js").content;
        assert.ok(script.includes('import "./myWidget.html";'));
        assert.ok(!script.includes(".less"));
        assert.ok(!script.includes(".css"));
    });

    it("uses computed access for kebab-case template names", () => {
        const files = buildTemplateScaffolding({
            name: "my-widget",
            scriptExtension: ".ts",
            styleExtension: ".less",
        });

        const script = fileNamed(files, "my-widget.ts").content;
        assert.ok(script.includes('Template["my-widget"].onCreated'));
        assert.ok(script.includes('Template["my-widget"].helpers({'));
        assert.ok(script.includes('Template["my-widget"].events({'));
        assert.ok(
            fileNamed(files, "my-widget.html").content.includes(
                '<template name="my-widget">'
            )
        );
    });

    it("validates template names", () => {
        assert.ok(TEMPLATE_NAME_REGEX.test("myWidget"));
        assert.ok(TEMPLATE_NAME_REGEX.test("my-widget_2"));
        assert.ok(!TEMPLATE_NAME_REGEX.test("my widget"));
        assert.ok(!TEMPLATE_NAME_REGEX.test('my"widget'));
        assert.ok(!TEMPLATE_NAME_REGEX.test(""));
    });

    it("produces scaffolding the language server can index", async () => {
        // Write the generated files into a temp fixture and index them.
        const fs = require("fs");
        const path = require("path");
        const os = require("os");

        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "meteor-toolbox-scaffold-")
        );
        const folder = path.join(root, "client", "myWidget");
        fs.mkdirSync(folder, { recursive: true });

        try {
            buildTemplateScaffolding({
                name: "myWidget",
                scriptExtension: ".ts",
                styleExtension: ".less",
            }).forEach(({ fileName, content }) => {
                if (fileName.endsWith(".less")) return;
                fs.writeFileSync(path.join(folder, fileName), content);
            });

            const { Indexer } = require("../../server/src/indexer");
            const indexer = new Indexer({
                rootUri: `file://${root}`,
                serverInstance: { sendNotification: () => {} },
                documentsInstance: { get: () => undefined },
            });

            const { hasErrors } = await indexer.loadSources();
            assert.strictEqual(hasErrors, false);
            assert.ok(indexer.blazeIndexer.templateIndexMap["myWidget"]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
