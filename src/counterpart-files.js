/**
 * Ordering logic for "Go to Template Counterpart", vscode-free: given the
 * current file, the counterpart candidates to try, in cycle order
 * (template -> code-behind -> style -> template...).
 */

const COUNTERPART_CYCLE = [[".html"], [".ts", ".js"], [".less", ".css"]];

const counterpartCandidates = (fsPath) => {
    const match = fsPath.match(/^(.*)(\.html|\.ts|\.js|\.less|\.css)$/);
    if (!match) return [];

    const [, base, extension] = match;
    const groupIndex = COUNTERPART_CYCLE.findIndex((extensions) =>
        extensions.includes(extension)
    );

    const candidates = [];
    for (let step = 1; step < COUNTERPART_CYCLE.length; step++) {
        const group =
            COUNTERPART_CYCLE[(groupIndex + step) % COUNTERPART_CYCLE.length];
        for (const candidateExtension of group) {
            candidates.push(`${base}${candidateExtension}`);
        }
    }

    return candidates;
};

module.exports = { counterpartCandidates };
