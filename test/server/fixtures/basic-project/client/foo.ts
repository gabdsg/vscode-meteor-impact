import { Template } from "meteor/templating";

interface Person {
    name: string;
    age?: number;
}

const people: Person[] = [];

enum Status {
    Active,
    Inactive,
}

Template.foo.helpers({
    formattedName(person?: Person): string {
        const status: Status = Status.Active;
        return `${person?.name ?? "unknown"} (${status})` as string;
    },
    peopleCount: (): number => people.length,
});
