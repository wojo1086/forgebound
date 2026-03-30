import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailValidatorService } from './email-validator.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, EmailValidatorService],
})
export class AuthModule {}
