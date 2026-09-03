import { Injectable } from "@nestjs/common";
import type { Category, Channel, Role, Server } from "@prisma/client";
import {
  type CategoryView,
  type ChannelView,
  type RoleView,
  serializePermissions,
  type ServerSummary,
} from "@voreli/shared";

/** Single place where database rows become the shapes declared in packages/shared. */
@Injectable()
export class ServerPresenter {
  server(server: Server, viewerId: string): ServerSummary {
    return {
      id: server.id,
      name: server.name,
      iconUrl: server.iconUrl,
      isOwner: server.ownerId === viewerId,
    };
  }

  category(category: Category): CategoryView {
    return { id: category.id, name: category.name, position: category.position };
  }

  channel(channel: Channel): ChannelView {
    return {
      id: channel.id,
      categoryId: channel.categoryId,
      type: channel.type,
      name: channel.name,
      topic: channel.topic,
      position: channel.position,
    };
  }

  role(role: Role): RoleView {
    return {
      id: role.id,
      name: role.name,
      color: role.color,
      permissions: serializePermissions(role.permissions),
      position: role.position,
      isDefault: role.isDefault,
    };
  }
}
