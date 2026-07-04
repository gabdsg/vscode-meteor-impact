import { Template } from "meteor/templating";

Template.second.helpers({
    secondHelper(): string {
        return "second";
    },
});
