import { IsString } from 'class-validator';

export class LearnSpellDto {
  @IsString()
  spellId: string;
}
