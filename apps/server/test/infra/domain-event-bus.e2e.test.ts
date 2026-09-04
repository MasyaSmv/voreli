import { createId } from "@paralleldrive/cuid2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../src/common/events/domain-event-bus.js";
import { createTestApp, type TestApp } from "../support/test-app.js";

describe("Redis domain event bus", () => {
  let publisherApp: TestApp;
  let subscriberApp: TestApp;

  beforeAll(async () => {
    [publisherApp, subscriberApp] = await Promise.all([createTestApp(), createTestApp()]);
  });

  afterAll(async () => {
    await Promise.all([publisherApp.close(), subscriberApp.close()]);
  });

  it("delivers an event to a separate application instance through Redis", async () => {
    const publisher = publisherApp.app.get<DomainEventBus>(DOMAIN_EVENT_BUS);
    const subscriber = subscriberApp.app.get<DomainEventBus>(DOMAIN_EVENT_BUS);
    const sessionId = createId();
    const userId = createId();

    const received = new Promise<{ sessionId: string; userId: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error("Timed out waiting for domain event"));
      }, 4000);
      const unsubscribe = subscriber.subscribe("session.revoked", (event) => {
        if (event.sessionId !== sessionId) {
          return;
        }

        clearTimeout(timer);
        unsubscribe();
        resolve(event);
      });
    });

    await publisher.publish("session.revoked", { sessionId, userId });

    await expect(received).resolves.toEqual({ sessionId, userId });
  });

  it("finishes a shared effect before publish returns, and runs it on the publisher only", async () => {
    const publisher = publisherApp.app.get<DomainEventBus>(DOMAIN_EVENT_BUS);
    const subscriber = subscriberApp.app.get<DomainEventBus>(DOMAIN_EVENT_BUS);
    const serverId = createId();
    const userId = createId();
    const ran: string[] = [];

    const unsubscribers = [
      publisher.subscribeShared("member.roles.changed", async (event) => {
        if (event.userId !== userId) {
          return;
        }

        // Yielding proves publish awaits the handler rather than merely starting it.
        await new Promise((resolve) => setTimeout(resolve, 50));
        ran.push("publisher");
      }),
      subscriber.subscribeShared("member.roles.changed", (event) => {
        if (event.userId === userId) {
          ran.push("subscriber");
        }
      }),
    ];

    // Delivery of the same event through the transport is the marker: once the other
    // instance has received it as a per-instance handler, its shared handler has had every
    // chance to run too. A fixed wait would only prove that it did not run within the wait.
    const deliveredToSubscriber = new Promise<void>((resolve) => {
      unsubscribers.push(
        subscriber.subscribe("member.roles.changed", (event) => {
          if (event.userId === userId) {
            resolve();
          }
        }),
      );
    });

    try {
      await publisher.publish("member.roles.changed", { serverId, userId });

      expect(ran).toEqual(["publisher"]);

      await deliveredToSubscriber;
      // One more turn, so a handler queued alongside the marker still has its chance.
      await new Promise((resolve) => setImmediate(resolve));

      expect(ran).toEqual(["publisher"]);
    } finally {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    }
  });
});
