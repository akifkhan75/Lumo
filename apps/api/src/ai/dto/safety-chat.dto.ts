import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const MAX_MESSAGE_LENGTH = 2_000;
const MAX_HISTORY_TURNS = 20;

export class ChatPartDto {
  @IsString()
  @MaxLength(MAX_MESSAGE_LENGTH)
  text!: string;
}

export class ChatHistoryEntryDto {
  @IsIn(['user', 'model'])
  role!: 'user' | 'model';

  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => ChatPartDto)
  parts!: ChatPartDto[];
}

/**
 * The body of POST /api/v1/ai/safety-chat. It was previously an inline object
 * type, which class-validator cannot see, so the global pipe skipped the
 * endpoint and the body arrived unvalidated and unbounded — straight into a
 * metered Gemini call. Message length and history depth are the spend bound.
 */
export class SafetyChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_MESSAGE_LENGTH)
  message!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_HISTORY_TURNS)
  @ValidateNested({ each: true })
  @Type(() => ChatHistoryEntryDto)
  history?: ChatHistoryEntryDto[];
}
