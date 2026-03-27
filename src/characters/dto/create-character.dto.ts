import {
  IsString,
  IsInt,
  Min,
  Max,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { ABILITY_MIN, ABILITY_MAX } from '../../common/constants/game.constants';

export class CreateCharacterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9 ]+$/, {
    message: 'Name can only contain letters, numbers, and spaces',
  })
  name: string;

  @IsString()
  @Matches(/^[a-z]+$/, { message: 'raceId must be a lowercase slug (e.g. "dwarf")' })
  raceId: string;

  @IsString()
  @Matches(/^[a-z]+$/, { message: 'classId must be a lowercase slug (e.g. "warrior")' })
  classId: string;

  @IsInt()
  @Min(ABILITY_MIN)
  @Max(ABILITY_MAX)
  strength: number;

  @IsInt()
  @Min(ABILITY_MIN)
  @Max(ABILITY_MAX)
  dexterity: number;

  @IsInt()
  @Min(ABILITY_MIN)
  @Max(ABILITY_MAX)
  constitution: number;

  @IsInt()
  @Min(ABILITY_MIN)
  @Max(ABILITY_MAX)
  intelligence: number;

  @IsInt()
  @Min(ABILITY_MIN)
  @Max(ABILITY_MAX)
  wisdom: number;

  @IsInt()
  @Min(ABILITY_MIN)
  @Max(ABILITY_MAX)
  charisma: number;
}
