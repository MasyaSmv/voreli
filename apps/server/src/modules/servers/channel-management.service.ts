import { Inject, Injectable } from "@nestjs/common";
import type { Category, Channel } from "@prisma/client";
import type { ChannelKind } from "@voreli/shared";

import { ID_GENERATOR, type IdGenerator } from "../../common/services/id-generator.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import { ResourceNotVisibleError } from "../permissions/errors/permission-errors.js";
import { CrossServerReferenceError } from "./errors/server-errors.js";

export interface CreateChannelInput {
  readonly name: string;
  readonly type: ChannelKind;
  readonly categoryId?: string | undefined;
  readonly topic?: string | undefined;
  readonly position?: number | undefined;
}

export interface UpdateChannelInput {
  readonly name?: string | undefined;
  readonly topic?: string | null | undefined;
  readonly categoryId?: string | null | undefined;
  readonly position?: number | undefined;
}

/**
 * Structure of a server: categories and channels.
 *
 * Every write checks that what it touches belongs to the server named in the route. Without
 * that check a valid permission on my own server would let me rename a channel on yours.
 */
@Injectable()
export class ChannelManagementService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async createCategory(serverId: string, name: string, position?: number): Promise<Category> {
    return this.prisma.db.category.create({
      data: {
        id: this.ids.generate(),
        serverId,
        name: name.trim(),
        position: position ?? (await this.nextCategoryPosition(serverId)),
      },
    });
  }

  async renameCategory(categoryId: string, name?: string, position?: number): Promise<Category> {
    await this.categoryOrFail(categoryId);

    return this.prisma.db.category.update({
      where: { id: categoryId },
      data: {
        ...(name === undefined ? {} : { name: name.trim() }),
        ...(position === undefined ? {} : { position }),
      },
    });
  }

  async deleteCategory(categoryId: string): Promise<void> {
    await this.categoryOrFail(categoryId);
    // Channels survive their category and become uncategorised: deleting a folder must not
    // delete the conversations inside it.
    await this.prisma.db.category.delete({ where: { id: categoryId } });
  }

  async createChannel(serverId: string, input: CreateChannelInput): Promise<Channel> {
    if (input.categoryId !== undefined) {
      await this.assertCategoryOfServer(input.categoryId, serverId);
    }

    return this.prisma.db.channel.create({
      data: {
        id: this.ids.generate(),
        serverId,
        categoryId: input.categoryId ?? null,
        type: input.type,
        name: input.name.trim(),
        topic: input.topic ?? null,
        position: input.position ?? (await this.nextChannelPosition(serverId)),
      },
    });
  }

  async updateChannel(channelId: string, input: UpdateChannelInput): Promise<Channel> {
    const channel = await this.channelOrFail(channelId);

    if (typeof input.categoryId === "string") {
      await this.assertCategoryOfServer(input.categoryId, channel.serverId);
    }

    return this.prisma.db.channel.update({
      where: { id: channelId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.topic === undefined ? {} : { topic: input.topic }),
        ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
        ...(input.position === undefined ? {} : { position: input.position }),
      },
    });
  }

  async deleteChannel(channelId: string): Promise<void> {
    await this.channelOrFail(channelId);
    await this.prisma.db.channel.delete({ where: { id: channelId } });
  }

  private async channelOrFail(channelId: string): Promise<Channel> {
    const channel = await this.prisma.db.channel.findUnique({ where: { id: channelId } });

    if (!channel) {
      throw new ResourceNotVisibleError("Channel", channelId);
    }

    return channel;
  }

  private async categoryOrFail(categoryId: string): Promise<Category> {
    const category = await this.prisma.db.category.findUnique({ where: { id: categoryId } });

    if (!category) {
      throw new ResourceNotVisibleError("Category", categoryId);
    }

    return category;
  }

  private async assertCategoryOfServer(categoryId: string, serverId: string): Promise<void> {
    const category = await this.categoryOrFail(categoryId);

    if (category.serverId !== serverId) {
      throw new CrossServerReferenceError("Category", categoryId);
    }
  }

  private async nextCategoryPosition(serverId: string): Promise<number> {
    const last = await this.prisma.db.category.findFirst({
      where: { serverId },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    return (last?.position ?? -1) + 1;
  }

  private async nextChannelPosition(serverId: string): Promise<number> {
    const last = await this.prisma.db.channel.findFirst({
      where: { serverId },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    return (last?.position ?? -1) + 1;
  }
}
