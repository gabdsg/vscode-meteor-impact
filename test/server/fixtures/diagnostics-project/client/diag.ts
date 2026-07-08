import { Template } from "meteor/templating";

Template.diagT.helpers({
    usedHelper(): string {
        return "used";
    },
    unusedHelper(): string {
        return "unused";
    },
    or(...args: unknown[]): boolean {
        return args.some(Boolean);
    },
    argOnlyHelper(): boolean {
        return true;
    },
    anotherArgHelper(): boolean {
        return false;
    },
    subExprHelper(): boolean {
        return true;
    },
    hashArgHelper(): number {
        return 1;
    },
});
