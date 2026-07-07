import { Meteor } from "meteor/meteor";

export function sharedFunction() {
    if (Meteor.isServer) {
        return "server";
    }
    return "client";
}
