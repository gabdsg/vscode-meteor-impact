// Mirrors aldeed:template-extension: iterating Template with
// Object.prototype methods called as members.
for (const t in Template) {
    if (Template.hasOwnProperty(t)) {
        console.log(t);
    }
}
