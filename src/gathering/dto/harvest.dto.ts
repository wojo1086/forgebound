import { IsString } from 'class-validator';

export class HarvestDto {
  @IsString()
  nodeId: string;
}
