import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class BuyItemDto {
  @IsString()
  itemId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number = 1;
}
