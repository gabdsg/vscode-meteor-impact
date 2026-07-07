import { Mongo } from "meteor/mongo";

export const Students = new Mongo.Collection("students");
export const Aliased = new Mongo.Collection("messageStyles");
const ClientOnly = new Mongo.Collection(null);

export { ClientOnly };
