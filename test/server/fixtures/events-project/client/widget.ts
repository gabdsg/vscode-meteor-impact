import { Template } from "meteor/templating";

Template.widget.events({
    "click .js-save"(event: Event): void {
        console.log("save", event);
    },
    "click .js-cancel": (): void => {},
});
