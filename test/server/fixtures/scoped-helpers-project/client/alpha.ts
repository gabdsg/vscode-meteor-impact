import { Template } from "meteor/templating";

Template.alpha.helpers({
    shared(): string {
        return "a";
    },
});
