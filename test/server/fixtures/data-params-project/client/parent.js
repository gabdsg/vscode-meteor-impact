import { Template } from "meteor/templating";

Template.parent.helpers({
    computedSubtitle() {
        return "sub";
    },
});
