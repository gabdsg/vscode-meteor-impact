import { Template } from "meteor/templating";

Template.widget.events({
    "click .js-save"(): void {
        console.log("save from extra");
    },
});
