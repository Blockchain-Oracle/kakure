import type { Verdict } from "./handlers";

/** The HTTP answers a refusal carries, and the clock every signed request is checked against. */
export const BAD_REQUEST = 400;
export const UNAUTHORIZED = 401;
export const NOT_FOUND = 404;
export const CONFLICT = 409;
export const UNPROCESSABLE = 422;
export const UNAVAILABLE = 503;

const MS = 1000;
export const nowSec = () => Math.floor(Date.now() / MS);

export const refuse = <T>(status: number, error: string): Verdict<T> => ({ ok: false, status, error });
