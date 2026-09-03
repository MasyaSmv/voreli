import { randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import type { InviteView } from "@voreli/shared";

import { CLOCK, type Clock } from "../../common/services/clock.js";
import { ID_GENERATOR, type IdGenerator } from "../../common/services/id-generator.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import { ResourceNotVisibleError } from "../permissions/errors/permission-errors.js";

export interface CreateInviteInput {
  readonly maxUses?: number | undefined;
  readonly expiresInSeconds?: number | undefined;
}

@Injectable()
export class InviteManagementService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async create(
    serverId: string,
    createdById: string,
    input: CreateInviteInput,
  ): Promise<InviteView> {
    const invite = await this.prisma.db.invite.create({
      data: {
        id: this.ids.generate(),
        // Short and random rather than sequential: an invite code is a capability, and a
        // guessable one is a way into a private server.
        code: randomBytes(9).toString("base64url"),
        serverId,
        createdById,
        maxUses: input.maxUses ?? null,
        expiresAt:
          input.expiresInSeconds === undefined
            ? null
            : new Date(this.clock.now().getTime() + input.expiresInSeconds * 1000),
      },
    });

    return this.toView(invite);
  }

  async listFor(serverId: string): Promise<readonly InviteView[]> {
    const invites = await this.prisma.db.invite.findMany({
      where: { serverId },
      orderBy: { createdAt: "desc" },
    });

    return invites.map((invite) => this.toView(invite));
  }

  async revoke(serverId: string, code: string): Promise<void> {
    const invite = await this.prisma.db.invite.findUnique({ where: { code } });

    if (!invite || invite.serverId !== serverId) {
      throw new ResourceNotVisibleError("Invite", code);
    }

    await this.prisma.db.invite.delete({ where: { code } });
  }

  private toView(invite: {
    code: string;
    serverId: string;
    maxUses: number | null;
    uses: number;
    expiresAt: Date | null;
    createdAt: Date;
  }): InviteView {
    return {
      code: invite.code,
      serverId: invite.serverId,
      maxUses: invite.maxUses,
      uses: invite.uses,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
      createdAt: invite.createdAt.toISOString(),
    };
  }
}
