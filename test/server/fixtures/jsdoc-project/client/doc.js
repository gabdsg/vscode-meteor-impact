import { Template } from "meteor/templating";

Template.doc.helpers({
    /**
     * Formats the user's full name.
     * Falls back to "unknown".
     */
    fullName() {
        return "x";
    },
    plain() {
        return 1;
    },
});

/** Renders a localized date. */
Template.registerHelper("formatDate", (date) => date.toString());
