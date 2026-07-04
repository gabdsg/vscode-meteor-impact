const IDENTIFIER_REGEX = /^[A-Za-z_$][\w$]*$/;

const buildHtmlContent = (name) =>
    `<template name="${name}">\n\n</template>\n`;

const buildStyleContent = (name) =>
    `/* Styles for the "${name}" template. */\n`;

const buildScriptContent = ({ name, styleExtension }) => {
    const templateAccess = IDENTIFIER_REGEX.test(name)
        ? `Template.${name}`
        : `Template["${name}"]`;

    const imports = [
        `import "./${name}.html";`,
        ...(styleExtension ? [`import "./${name}${styleExtension}";`] : []),
    ].join("\n");

    return `import { Template } from "meteor/templating";

${imports}

${templateAccess}.onCreated(function () {

});

${templateAccess}.helpers({

});

${templateAccess}.events({

});
`;
};

/**
 * The files of a new template scaffolding: <name>.html, <name>.js/.ts and
 * optionally <name>.less/.css, all meant to live inside a folder named
 * after the template.
 */
const buildTemplateScaffolding = ({
    name,
    scriptExtension = ".js",
    styleExtension = null,
}) => {
    return [
        { fileName: `${name}.html`, content: buildHtmlContent(name) },
        {
            fileName: `${name}${scriptExtension}`,
            content: buildScriptContent({ name, styleExtension }),
        },
        ...(styleExtension
            ? [
                  {
                      fileName: `${name}${styleExtension}`,
                      content: buildStyleContent(name),
                  },
              ]
            : []),
    ];
};

const TEMPLATE_NAME_REGEX = /^[\w-]+$/;

module.exports = { buildTemplateScaffolding, TEMPLATE_NAME_REGEX };
