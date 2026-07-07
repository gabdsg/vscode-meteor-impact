import { Session } from "meteor/session";

export const readFromOtherFile = () => Session.get("filters.text");
