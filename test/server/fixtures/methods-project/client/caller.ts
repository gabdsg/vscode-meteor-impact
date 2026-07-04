import { Meteor } from "meteor/meteor";

const insert = async (): Promise<void> => {
    await Meteor.callAsync("tasks.insert", "new task");
};

Meteor.subscribe("tasks.all");

export { insert };
