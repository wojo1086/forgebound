import { IsString } from 'class-validator';

export class EnterDungeonDto {
  @IsString()
  poiId: string;
}
