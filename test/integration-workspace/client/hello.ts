import { Template } from "meteor/templating";

Template.hello.helpers({
    greeting(): string {
        return "Hello from Meteor Impact";
    },
});
