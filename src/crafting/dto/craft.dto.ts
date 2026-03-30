import { IsString } from 'class-validator';

export class CraftDto {
  @IsString()
  recipeId: string;
}
