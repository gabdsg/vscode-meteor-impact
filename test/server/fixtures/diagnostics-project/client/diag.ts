import { Template } from "meteor/templating";

Template.diagT.helpers({
    usedHelper(): string {
        return "used";
    },
    unusedHelper(): string {
        return "unused";
    },
});
