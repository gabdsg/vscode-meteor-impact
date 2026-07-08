export class ComposeController {
    constructor() {
        this.fromChannel = new ReactiveVar(null);
    }

    canSendEmail() {
        return !!this.fromChannel.get();
    }

    hasSelectedUsers = () => false;

    get selectedCount() {
        return 0;
    }
}
