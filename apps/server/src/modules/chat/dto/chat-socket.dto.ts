import {
  MESSAGE_MAX_LENGTH,
  type DirectConversationPayload,
  type DirectMarkReadPayload,
  type DirectSendMessagePayload,
  type MarkReadPayload,
  type SendMessagePayload,
  type SubscribePayload,
  type TypingPayload,
} from "@voreli/shared";
import { IsOptional, IsString, Length } from "class-validator";

const ID_MAX_LENGTH = 64;
const CLIENT_NONCE_MAX_LENGTH = 128;

export class ChannelPayloadDto implements SubscribePayload, TypingPayload {
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  channelId!: string;
}

export class SendMessageDto extends ChannelPayloadDto implements SendMessagePayload {
  @IsString()
  @Length(1, MESSAGE_MAX_LENGTH)
  text!: string;

  @IsOptional()
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  replyToId?: string;

  @IsOptional()
  @IsString()
  @Length(1, CLIENT_NONCE_MAX_LENGTH)
  clientNonce?: string;
}

export class MarkReadDto extends ChannelPayloadDto implements MarkReadPayload {
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  messageId!: string;
}

export class DirectConversationDto implements DirectConversationPayload {
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  conversationId!: string;
}

export class DirectSendMessageDto
  extends DirectConversationDto
  implements DirectSendMessagePayload
{
  @IsString()
  @Length(1, MESSAGE_MAX_LENGTH)
  text!: string;

  @IsOptional()
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  replyToId?: string;

  @IsOptional()
  @IsString()
  @Length(1, CLIENT_NONCE_MAX_LENGTH)
  clientNonce?: string;
}

export class DirectMarkReadDto extends DirectConversationDto implements DirectMarkReadPayload {
  @IsString()
  @Length(1, ID_MAX_LENGTH)
  messageId!: string;
}
