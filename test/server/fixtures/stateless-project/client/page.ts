import { Template } from "meteor/templating";

Template.page.helpers({
    pageTitle(): string {
        return "page";
    },
});
