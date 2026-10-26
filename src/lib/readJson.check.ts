import { isAbortError } from "./readJson.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(isAbortError(new DOMException("aborted", "AbortError")), "AbortError is ignored as a cancel");
assert(isAbortError(Object.assign(new Error("timeout"), { name: "TimeoutError" })), "TimeoutError is a client abort");
assert(!isAbortError(new Error("行情刷新失败")), "a real refresh error is not treated as abort");
assert(!isAbortError(null), "null is not an abort");

console.log("readJson checks passed");
