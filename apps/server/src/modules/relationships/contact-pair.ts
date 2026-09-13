export interface ContactPair {
  readonly userLowId: string;
  readonly userHighId: string;
}

export function contactPair(firstUserId: string, secondUserId: string): ContactPair {
  return firstUserId < secondUserId
    ? { userLowId: firstUserId, userHighId: secondUserId }
    : { userLowId: secondUserId, userHighId: firstUserId };
}
