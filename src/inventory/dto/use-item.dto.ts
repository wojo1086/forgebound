import { IsString } from 'class-validator';

export class UseItemDto {
  @IsString()
  itemId: string;
}
