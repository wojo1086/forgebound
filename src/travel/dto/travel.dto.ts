import { IsInt, Min, Max } from 'class-validator';

export class TravelDto {
  @IsInt()
  @Min(0)
  @Max(99)
  x: number;

  @IsInt()
  @Min(0)
  @Max(99)
  y: number;
}
