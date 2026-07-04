import { Template } from "meteor/templating";

Template.bar.helpers({
    barTitle() {
        return "bar";
    },
});
