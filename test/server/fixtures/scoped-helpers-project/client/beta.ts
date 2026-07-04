import { Template } from "meteor/templating";

Template.beta.helpers({
    shared(): string {
        return "b";
    },
});
