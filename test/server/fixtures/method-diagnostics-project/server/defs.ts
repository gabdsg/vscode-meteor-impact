import { Meteor } from "meteor/meteor";

Meteor.methods({
    "tasks.insert"(text: string): void {
        console.log(text);
    },
    "tasks.unused"(): void {
        console.log("unused");
    },
});

Meteor.publish("tasks.all", function () {
    return [];
});
