import { IsString } from 'class-validator';

export class AbandonQuestDto {
  @IsString()
  questId: string;
}
