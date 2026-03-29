import { IsString } from 'class-validator';

export class TurnInQuestDto {
  @IsString()
  questId: string;
}
