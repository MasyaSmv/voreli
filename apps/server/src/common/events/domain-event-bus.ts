export const DOMAIN_EVENT_BUS = Symbol("DOMAIN_EVENT_BUS");

export interface DomainEventMap {
  readonly "session.revoked": { readonly sessionId: string; readonly userId: string };
  readonly "member.roles.changed": { readonly serverId: string; readonly userId: string };
  readonly "channel.overrides.changed": { readonly channelId: string };
  readonly "member.removed": { readonly serverId: string; readonly userId: string };
  readonly "member.joined": { readonly serverId: string; readonly userId: string };
}

export type DomainEventName = keyof DomainEventMap;
export type DomainEventHandler<Name extends DomainEventName> = (
  payload: DomainEventMap[Name],
) => Promise<void> | void;

/**
 * Process-independent domain notifications.
 *
 * Publishing is best-effort: a failed notification is logged by the implementation but
 * never turns a completed business write into an HTTP failure.
 *
 * A subscriber declares which of the two kinds of effect it performs, because they need
 * opposite delivery guarantees:
 *
 * - `subscribe` — an effect local to one process: sockets it holds, timers it owns. Every
 *   instance must run it, and none of them can run it for the others, so delivery is a
 *   fan-out over the transport and therefore asynchronous.
 * - `subscribeShared` — an effect on state the whole cluster shares: a Redis counter, a
 *   row. Running it once is enough and running it N times is waste, so it runs on the
 *   publishing instance only, and `publish` waits for it.
 */
export interface DomainEventBus {
  /**
   * Announces the event.
   *
   * Returns once every shared effect has been applied, so a caller that awaits it knows
   * the cluster-wide consequences of its write are visible before it answers the client.
   * Per-instance handlers are still in flight at that point.
   */
  publish<Name extends DomainEventName>(name: Name, payload: DomainEventMap[Name]): Promise<void>;

  /** Registers a per-instance effect. Runs on every instance, after `publish` returns. */
  subscribe<Name extends DomainEventName>(
    name: Name,
    handler: DomainEventHandler<Name>,
  ): () => void;

  /** Registers a cluster-wide effect. Runs once, on the publisher, before `publish` returns. */
  subscribeShared<Name extends DomainEventName>(
    name: Name,
    handler: DomainEventHandler<Name>,
  ): () => void;
}
