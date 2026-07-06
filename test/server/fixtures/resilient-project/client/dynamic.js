import { Template } from "meteor/templating";

Template.dynamic.helpers({
    items() {
        return [];
    },
    visible: () => true,
    label: () => "hi",
});
