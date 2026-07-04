import { Meteor } from "meteor/meteor";

Meteor.methods({
    "tasks.insert"(text: string): void {
        console.log(text);
    },
    "tasks.remove"(id: string): void {
        console.log(id);
    },
});

Meteor.publish("tasks.all", function () {
    return [];
});
