import { Template } from "meteor/templating";

Template.registerHelper("formatCurrency", (amount: number): string => {
    return `$${amount.toFixed(2)}`;
});
