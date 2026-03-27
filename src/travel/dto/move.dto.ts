import { IsIn } from 'class-validator';

export class MoveDto {
  @IsIn(['north', 'south', 'east', 'west'])
  direction: 'north' | 'south' | 'east' | 'west';
}
