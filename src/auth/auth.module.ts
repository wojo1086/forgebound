import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailValidatorService } from './email-validator.service';
import { UnverifiedCleanupService } from './unverified-cleanup.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, EmailValidatorService, UnverifiedCleanupService],
})
export class AuthModule {}
