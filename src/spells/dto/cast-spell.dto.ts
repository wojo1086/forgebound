import { IsString } from 'class-validator';

export class CastSpellDto {
  @IsString()
  spellId: string;
}
