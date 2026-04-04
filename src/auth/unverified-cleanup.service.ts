import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Client } from 'pg';

@Injectable()
export class UnverifiedCleanupService {
  private readonly logger = new Logger(UnverifiedCleanupService.name);

  constructor(private configService: ConfigService) {}

  /** Runs every hour to delete unverified users older than 24 hours */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupUnverifiedUsers() {
    const databaseUrl = this.configService.get<string>('DATABASE_URL');
    if (!databaseUrl) return;

    const client = new Client({ connectionString: databaseUrl });

    try {
      await client.connect();

      // Find unverified users created more than 24 hours ago
      const { rows } = await client.query(`
        SELECT id, email, created_at
        FROM auth.users
        WHERE email_confirmed_at IS NULL
          AND created_at < NOW() - INTERVAL '24 hours'
      `);

      if (rows.length === 0) return;

      this.logger.log(
        `Found ${rows.length} unverified user(s) older than 24h — cleaning up`,
      );

      for (const user of rows) {
        // Delete any characters owned by this user (cascades inventory, skills, etc.)
        await client.query(
          `DELETE FROM public.characters WHERE user_id = $1`,
          [user.id],
        );

        // Delete the auth user
        await client.query(`DELETE FROM auth.users WHERE id = $1`, [user.id]);

        this.logger.log(
          `Deleted unverified user ${user.email} (created ${user.created_at})`,
        );
      }
    } catch (err: any) {
      this.logger.error(`Unverified user cleanup failed: ${err.message}`);
    } finally {
      await client.end();
    }
  }
}
