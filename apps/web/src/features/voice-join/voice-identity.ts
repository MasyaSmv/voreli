import { useSession } from "../../entities/session/session.store";

/** Who "self" is inside a voice session. */
export type OwnUserId = () => string | undefined;

/**
 * Read lazily rather than captured once: the voice session outlives a single login, and a
 * captured id would keep pointing at the previous user after a re-login.
 */
export const sessionUserId: OwnUserId = () => useSession.getState().user?.id;
