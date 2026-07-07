import { Session } from "meteor/session";
import { ReactiveDict } from "meteor/reactive-dict";

Session.setDefault("counter", 0);
Session.set("filters.text", "");

export const readCounter = () => Session.get("counter");
export const hasFilter = () => Session.equals("filters.text", "");

export const badRead = () => Session.get("neverSet");
Session.set("neverRead", 1);

const state = new ReactiveDict("pageState");
state.set("dictKey", 1);
export const readDict = () => state.get("dictKey");

// Dynamic keys are invisible to the indexer on purpose.
export const dynamicRead = (key) => Session.get(key);

// Unrelated get/set receivers must not be indexed.
const map = new Map();
map.set("mapKey", 1);
map.get("mapKey");
