import { Button } from "../../components/button";
import { useCounter } from "./model";

/** Demonstrates shared client state working identically on every target. */
export function CounterButton() {
  const { count, inc } = useCounter();
  return <Button onClick={inc}>Shared state: {count}</Button>;
}
