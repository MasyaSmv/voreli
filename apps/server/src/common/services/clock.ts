import { Injectable } from "@nestjs/common";

/**
 * Time as a dependency. Sessions expire, invites run out, tokens age — every one of those
 * is a decision made against "now", and a test that cannot move "now" has to sleep.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol("CLOCK");

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
