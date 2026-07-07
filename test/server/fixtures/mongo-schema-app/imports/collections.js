import { Mongo } from "meteor/mongo";
import { Repository } from "./repository";

export const Students = new Mongo.Collection("students");
export const Aliased = new Mongo.Collection("messageStyles");
const ClientOnly = new Mongo.Collection(null);

export { ClientOnly };

// This app's data-access wrapper: the collection name lives on the
// options object rather than a positional string argument.
export const StudentsRepository = new Repository({
    name: "students",
    decorators: {},
});
