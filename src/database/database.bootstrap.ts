import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import * as poisData from '../data/pois.json';

@Injectable()
export class DatabaseBootstrap implements OnModuleInit {
  private readonly logger = new Logger(DatabaseBootstrap.name);

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const databaseUrl = this.configService.get<string>('DATABASE_URL');
    if (!databaseUrl) {
      this.logger.warn('DATABASE_URL not set — skipping database bootstrap');
      return;
    }

    const client = new Client({ connectionString: databaseUrl });

    try {
      await client.connect();
      this.logger.log('Connected to database, running bootstrap...');

      await this.createTables(client);
      await this.createPolicies(client);
      await this.seedData(client);

      this.logger.log('Database bootstrap complete');
    } catch (err) {
      this.logger.error('Database bootstrap failed', (err as Error).stack);
    } finally {
      await client.end();
    }
  }

  private async createTables(client: Client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS races (
        id varchar(20) PRIMARY KEY,
        name varchar(50) NOT NULL UNIQUE,
        description text,
        bonus_strength int NOT NULL DEFAULT 0,
        bonus_dexterity int NOT NULL DEFAULT 0,
        bonus_constitution int NOT NULL DEFAULT 0,
        bonus_intelligence int NOT NULL DEFAULT 0,
        bonus_wisdom int NOT NULL DEFAULT 0,
        bonus_charisma int NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS classes (
        id varchar(20) PRIMARY KEY,
        name varchar(50) NOT NULL UNIQUE,
        description text
      );

      CREATE TABLE IF NOT EXISTS pois (
        id varchar(60) PRIMARY KEY,
        name varchar(100) NOT NULL,
        type varchar(30) NOT NULL,
        category varchar(20) NOT NULL,
        x int NOT NULL,
        y int NOT NULL,
        terrain varchar(20) NOT NULL,
        description text,
        level_min int,
        level_max int,
        visible boolean NOT NULL DEFAULT true,
        UNIQUE(x, y)
      );

      CREATE TABLE IF NOT EXISTS player_discoveries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES auth.users(id),
        poi_id varchar(60) NOT NULL REFERENCES pois(id),
        discovered_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(user_id, poi_id)
      );

      CREATE TABLE IF NOT EXISTS characters (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id),
        name varchar(30) NOT NULL,
        race_id varchar(20) NOT NULL REFERENCES races(id),
        class_id varchar(20) NOT NULL REFERENCES classes(id),
        level int NOT NULL DEFAULT 1,
        xp int NOT NULL DEFAULT 0,
        hp int NOT NULL,
        max_hp int NOT NULL,
        ac int NOT NULL,
        strength int NOT NULL,
        dexterity int NOT NULL,
        constitution int NOT NULL,
        intelligence int NOT NULL,
        wisdom int NOT NULL,
        charisma int NOT NULL,
        pos_x int NOT NULL DEFAULT 50,
        pos_y int NOT NULL DEFAULT 50,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    // Add travel columns (idempotent)
    await client.query(`
      ALTER TABLE characters ADD COLUMN IF NOT EXISTS travel_path jsonb DEFAULT NULL;
      ALTER TABLE characters ADD COLUMN IF NOT EXISTS travel_started_at timestamptz DEFAULT NULL;
      ALTER TABLE characters ADD COLUMN IF NOT EXISTS travel_eta timestamptz DEFAULT NULL;
      ALTER TABLE characters ADD COLUMN IF NOT EXISTS travel_step_times jsonb DEFAULT NULL;
    `);

    this.logger.log('Tables verified');
  }

  private async createPolicies(client: Client) {
    await client.query(`
      ALTER TABLE races ENABLE ROW LEVEL SECURITY;
      ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
      ALTER TABLE pois ENABLE ROW LEVEL SECURITY;
      ALTER TABLE player_discoveries ENABLE ROW LEVEL SECURITY;

      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'races_public_read') THEN
          CREATE POLICY races_public_read ON races FOR SELECT USING (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'classes_public_read') THEN
          CREATE POLICY classes_public_read ON classes FOR SELECT USING (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'characters_select') THEN
          CREATE POLICY characters_select ON characters FOR SELECT USING (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'characters_insert') THEN
          CREATE POLICY characters_insert ON characters FOR INSERT WITH CHECK (auth.uid() = user_id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'characters_update') THEN
          CREATE POLICY characters_update ON characters FOR UPDATE USING (auth.uid() = user_id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pois_public_read') THEN
          CREATE POLICY pois_public_read ON pois FOR SELECT USING (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'discoveries_select_own') THEN
          CREATE POLICY discoveries_select_own ON player_discoveries FOR SELECT USING (auth.uid() = user_id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'discoveries_insert_own') THEN
          CREATE POLICY discoveries_insert_own ON player_discoveries FOR INSERT WITH CHECK (auth.uid() = user_id);
        END IF;
      END $$;
    `);

    this.logger.log('RLS policies verified');
  }

  private async seedData(client: Client) {
    // Seed races/classes
    const { rows: raceRows } = await client.query('SELECT count(*) FROM races');
    if (parseInt(raceRows[0].count, 10) === 0) {
      this.logger.log('Seeding races and classes...');

      await client.query(`
        INSERT INTO races (id, name, description, bonus_strength, bonus_dexterity, bonus_constitution, bonus_intelligence, bonus_wisdom, bonus_charisma) VALUES
          ('human',    'Human',    'Versatile and ambitious, humans adapt to any role.',     1, 1, 1, 1, 1, 1),
          ('elf',      'Elf',      'Graceful and keen-minded, with an affinity for magic.',  0, 2, 0, 1, 0, 0),
          ('dwarf',    'Dwarf',    'Stout and hardy, born of stone and stubbornness.',       1, 0, 2, 0, 0, 0),
          ('halfling', 'Halfling', 'Small and nimble, with uncanny luck.',                   0, 2, 0, 0, 0, 1),
          ('orc',      'Orc',      'Powerful and relentless, forged in battle.',              2, 0, 1, 0, 0, 0);
      `);

      await client.query(`
        INSERT INTO classes (id, name, description) VALUES
          ('warrior', 'Warrior', 'A master of martial combat, skilled with weapons and armor.'),
          ('mage',    'Mage',    'A spellcaster who wields arcane magic to devastating effect.'),
          ('rogue',   'Rogue',   'A cunning trickster who uses stealth and guile.'),
          ('cleric',  'Cleric',  'A holy warrior who channels divine power to heal and smite.'),
          ('ranger',  'Ranger',  'A wilderness survivor skilled in tracking and ranged combat.');
      `);

      this.logger.log('Races and classes seeded');
    }

    // Seed POIs
    const { rows: poiRows } = await client.query('SELECT count(*) FROM pois');
    if (parseInt(poiRows[0].count, 10) === 0) {
      this.logger.log('Seeding POIs...');

      const allPois = [
        ...poisData.towns.map((p) => ({ ...p, type: 'town', category: 'town' })),
        ...poisData.landmarks.map((p) => ({ ...p, category: 'landmark' })),
        ...poisData.hidden.map((p) => ({ ...p, category: 'hidden' })),
      ];

      // Batch insert in chunks of 50
      for (let i = 0; i < allPois.length; i += 50) {
        const chunk = allPois.slice(i, i + 50);
        const values = chunk
          .map(
            (p, idx) =>
              `($${idx * 11 + 1}, $${idx * 11 + 2}, $${idx * 11 + 3}, $${idx * 11 + 4}, $${idx * 11 + 5}, $${idx * 11 + 6}, $${idx * 11 + 7}, $${idx * 11 + 8}, $${idx * 11 + 9}, $${idx * 11 + 10}, $${idx * 11 + 11})`,
          )
          .join(', ');

        const params = chunk.flatMap((p) => [
          p.id,
          p.name,
          p.type,
          p.category,
          p.x,
          p.y,
          p.terrain,
          p.description ?? null,
          (p as any).levelMin ?? null,
          (p as any).levelMax ?? null,
          p.visible,
        ]);

        await client.query(
          `INSERT INTO pois (id, name, type, category, x, y, terrain, description, level_min, level_max, visible) VALUES ${values}`,
          params,
        );
      }

      this.logger.log(`${allPois.length} POIs seeded`);
    }
  }
}
