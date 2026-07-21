import type { Clock } from "../domain";

/** Real system clock - implements the Clock contract. */
export const systemClock: Clock = {
  now: () => Date.now(),
};
