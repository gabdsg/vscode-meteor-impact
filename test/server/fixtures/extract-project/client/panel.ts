import { Template } from "meteor/templating";

Template.panel.helpers({
    title(): string {
        return "t";
    },
    boxLabel(): string {
        return "box";
    },
    summary(): string {
        return "s";
    },
});

Template.panel.events({
    "click .js-save"(): void {
        console.log("save");
    },
});
