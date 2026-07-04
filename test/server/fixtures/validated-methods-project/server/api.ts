import { ValidatedMethod } from "meteor/mdg:validated-method";

export const updateTask = new ValidatedMethod({
    name: "tasks.update",
    validate: null,
    run(): boolean {
        return true;
    },
});

publishComposite("tasks.composite", {
    find() {
        return [];
    },
});
