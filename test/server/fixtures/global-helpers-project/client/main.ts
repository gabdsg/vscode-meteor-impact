import { Template } from "meteor/templating";

Template.home.helpers({
    price(): number {
        return 42;
    },
});
