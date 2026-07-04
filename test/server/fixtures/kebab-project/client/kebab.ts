import { Template } from "meteor/templating";

Template["kebab-template"].helpers({
    kebabHelper(): string {
        return "kebab";
    },
    "quoted-helper": (): string => "quoted",
});
