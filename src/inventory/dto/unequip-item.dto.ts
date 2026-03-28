import { IsIn } from 'class-validator';
import { EQUIPMENT_SLOTS } from '../../common/constants/inventory.constants';
import type { EquipmentSlot } from '../../common/constants/inventory.constants';

export class UnequipItemDto {
  @IsIn(EQUIPMENT_SLOTS)
  slot: EquipmentSlot;
}
