import { IsIn, IsString } from 'class-validator';
import { ABILITY_NAMES } from '../../common/constants/leveling.constants';

export class AllocateStatDto {
  @IsString()
  @IsIn(ABILITY_NAMES as unknown as string[])
  stat: string;
}
