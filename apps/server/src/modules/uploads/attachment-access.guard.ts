import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";

import type { AuthenticatedRequest } from "../auth/access-token.guard.js";
import { AttachmentAccessPolicy, type AccessibleAttachment } from "./attachment-access.policy.js";
import { AttachmentNotFoundError } from "./errors/attachment-not-found.error.js";

interface AttachmentRequest extends AuthenticatedRequest {
  attachment?: AccessibleAttachment;
}

@Injectable()
export class AttachmentAccessGuard implements CanActivate {
  constructor(private readonly policy: AttachmentAccessPolicy) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AttachmentRequest>();
    if (!request.auth) throw new Error("AttachmentAccessGuard requires AccessTokenGuard");
    const attachmentId = request.params["attachmentId"];
    if (typeof attachmentId !== "string") throw new AttachmentNotFoundError("");
    request.attachment = await this.policy.authorize(attachmentId, request.auth.user.id);
    return true;
  }
}

export const CurrentAttachment = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessibleAttachment => {
    const request = context.switchToHttp().getRequest<AttachmentRequest>();
    if (!request.attachment) throw new Error("CurrentAttachment requires AttachmentAccessGuard");
    return request.attachment;
  },
);
