import { Meteor } from "meteor/meteor";

const run = async (): Promise<void> => {
    await Meteor.callAsync("tasks.insert", "x");
    await Meteor.callAsync("tasks.oops");
};

Meteor.subscribe("tasks.all");
Meteor.subscribe("missing.pub");

const emitter = { subscribe: (name: string) => name };
emitter.subscribe("not.a.publication");

export { run };
