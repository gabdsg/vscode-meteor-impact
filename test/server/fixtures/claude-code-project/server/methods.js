import { Meteor } from "meteor/meteor";
import { ValidatedMethod } from "meteor/mdg:validated-method";

Meteor.methods({
    "tasks.insert"(text) {
        console.log(text);
        return text;
    },
});

Meteor.publish("tasks.mine", function () {
    return [];
});

export function plainServerFunction(value) {
    return value * 2;
}

export const removeTask = new ValidatedMethod({
    name: "tasks.remove",
    run({ taskId }) {
        console.log(taskId);
    },
});
