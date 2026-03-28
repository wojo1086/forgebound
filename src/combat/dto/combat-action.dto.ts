import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum CombatAction {
  ATTACK = 'attack',
  CAST = 'cast',
  USE_ITEM = 'use_item',
  FLEE = 'flee',
}

export class CombatActionDto {
  @IsEnum(CombatAction)
  action: CombatAction;

  @IsOptional()
  @IsString()
  spellId?: string;

  @IsOptional()
  @IsString()
  itemId?: string;
}
