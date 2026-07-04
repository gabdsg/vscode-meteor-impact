import { Template } from "meteor/templating";

interface Person {
    name: string;
    age: number;
}

Template.list.helpers({
    people(): Person[] {
        return [];
    },
    peopleCount(): number {
        return 0;
    },
    formatAge(person: Person): string {
        return `${person.age} years`;
    },
});

Template.row.helpers({
    rowTitle(): string {
        return "row";
    },
});
