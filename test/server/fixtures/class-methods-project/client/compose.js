Template.composeEmail.helpers({
    canSendEmailMessage() {
        return Template.instance().controller.canSendEmail();
    },
    hasUsers() {
        return Template.instance().controller.hasSelectedUsers();
    },
});

const canSendEmail = false;
export const standalone = canSendEmail;
