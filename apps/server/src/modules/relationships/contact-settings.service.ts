import { Inject, Injectable } from "@nestjs/common";
import type { ContactAudience as PrismaContactAudience } from "@prisma/client";
import {
  ContactAudience,
  type ContactSettingsView,
  type UpdateContactSettingsInput,
} from "@voreli/shared";

import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../common/events/domain-event-bus.js";
import { PrismaService } from "../../infra/database/prisma.service.js";

@Injectable()
export class ContactSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async get(userId: string): Promise<ContactSettingsView> {
    const settings = await this.prisma.db.userContactSettings.findUnique({ where: { userId } });

    return this.toView(settings ?? {});
  }

  async update(userId: string, input: UpdateContactSettingsInput): Promise<ContactSettingsView> {
    const data = {
      ...(input.directMessageAudience === undefined
        ? {}
        : { directMessageAudience: input.directMessageAudience }),
      ...(input.directCallAudience === undefined
        ? {}
        : { directCallAudience: input.directCallAudience }),
      ...(input.friendRequestAudience === undefined
        ? {}
        : { friendRequestAudience: input.friendRequestAudience }),
    };
    const settings = await this.prisma.db.userContactSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    await this.events.publish("contact.policy.changed", { userId });

    return this.toView(settings);
  }

  private toView(settings: {
    readonly directMessageAudience?: PrismaContactAudience;
    readonly directCallAudience?: PrismaContactAudience;
    readonly friendRequestAudience?: PrismaContactAudience;
  }): ContactSettingsView {
    return {
      directMessageAudience: settings.directMessageAudience ?? ContactAudience.Everyone,
      directCallAudience: settings.directCallAudience ?? ContactAudience.Everyone,
      friendRequestAudience: settings.friendRequestAudience ?? ContactAudience.Everyone,
    };
  }
}
