// infra — implementations of domain contracts (clock, db, push, external APIs, …)
// plus the environment-reading that the rest of the app must not do itself.
export { type ApiConfig, isAllowedOrigin, resolveApiConfig } from "./config";
export { systemClock } from "./system-clock";
