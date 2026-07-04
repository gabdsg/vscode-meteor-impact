import { Template } from "meteor/templating";

import "./widgetA.html";
import "./widgetA.less";

Template.widgetA.helpers({
    title(): string {
        return "widget A";
    },
});
