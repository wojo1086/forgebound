import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import * as poisData from '../data/pois.json';
import itemsData = require('../data/items.json');
import spellsData = require('../data/spells.json');

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

    // Items definition table
    await client.query(`
      CREATE TABLE IF NOT EXISTS items (
        id varchar(60) PRIMARY KEY,
        name varchar(100) NOT NULL,
        description text,
        type varchar(20) NOT NULL CHECK (type IN (
          'weapon','armor','helmet','shield','leggings','boots','gloves','ring','amulet',
          'consumable','material','quest','ammunition'
        )),
        rarity varchar(20) NOT NULL DEFAULT 'common' CHECK (rarity IN (
          'common','uncommon','rare','epic','legendary'
        )),
        weight numeric(6,1) NOT NULL DEFAULT 0,
        value int NOT NULL DEFAULT 0,
        level_required int NOT NULL DEFAULT 1,
        class_restriction varchar(20) DEFAULT NULL REFERENCES classes(id),
        bonus_strength int NOT NULL DEFAULT 0,
        bonus_dexterity int NOT NULL DEFAULT 0,
        bonus_constitution int NOT NULL DEFAULT 0,
        bonus_intelligence int NOT NULL DEFAULT 0,
        bonus_wisdom int NOT NULL DEFAULT 0,
        bonus_charisma int NOT NULL DEFAULT 0,
        bonus_ac int NOT NULL DEFAULT 0,
        bonus_hp int NOT NULL DEFAULT 0,
        damage_min int DEFAULT NULL,
        damage_max int DEFAULT NULL,
        effect_type varchar(30) DEFAULT NULL,
        effect_value int DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS character_inventory (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        item_id varchar(60) NOT NULL REFERENCES items(id),
        quantity int NOT NULL DEFAULT 1 CHECK (quantity > 0),
        slot varchar(20) DEFAULT NULL CHECK (slot IN (
          'weapon','armor','helmet','shield','leggings','boots','gloves','ring1','ring2','amulet',
          NULL
        )),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(character_id, item_id, slot)
      );

      CREATE INDEX IF NOT EXISTS idx_char_inv_character ON character_inventory(character_id);
      CREATE INDEX IF NOT EXISTS idx_char_inv_slot ON character_inventory(character_id, slot) WHERE slot IS NOT NULL;
    `);

    // Spells definition table
    await client.query(`
      CREATE TABLE IF NOT EXISTS spells (
        id varchar(60) PRIMARY KEY,
        name varchar(100) NOT NULL,
        description text,
        school varchar(20) NOT NULL CHECK (school IN (
          'evocation','restoration','abjuration','conjuration',
          'enchantment','necromancy','divination','transmutation'
        )),
        spell_level int NOT NULL DEFAULT 1,
        mana_cost int NOT NULL DEFAULT 0,
        cooldown_seconds int NOT NULL DEFAULT 0,
        level_required int NOT NULL DEFAULT 1,
        class_restriction varchar(20) DEFAULT NULL REFERENCES classes(id),
        target_type varchar(10) NOT NULL CHECK (target_type IN ('self','enemy','ally','area')),
        effect_type varchar(30) DEFAULT NULL,
        effect_value int DEFAULT NULL,
        damage_type varchar(20) DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS character_spells (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        spell_id varchar(60) NOT NULL REFERENCES spells(id),
        learned_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(character_id, spell_id)
      );

      CREATE INDEX IF NOT EXISTS idx_char_spells_character ON character_spells(character_id);
    `);

    // Add mana columns to characters (idempotent)
    await client.query(`
      ALTER TABLE characters ADD COLUMN IF NOT EXISTS mana int NOT NULL DEFAULT 0;
      ALTER TABLE characters ADD COLUMN IF NOT EXISTS max_mana int NOT NULL DEFAULT 0;
    `);

    // Update CHECK constraints for existing databases (idempotent)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE items DROP CONSTRAINT IF EXISTS items_type_check;
        ALTER TABLE items ADD CONSTRAINT items_type_check CHECK (type IN (
          'weapon','armor','helmet','shield','leggings','boots','gloves','ring','amulet',
          'consumable','material','quest','ammunition'
        ));
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;

      DO $$ BEGIN
        ALTER TABLE character_inventory DROP CONSTRAINT IF EXISTS character_inventory_slot_check;
        ALTER TABLE character_inventory ADD CONSTRAINT character_inventory_slot_check CHECK (slot IN (
          'weapon','armor','helmet','shield','leggings','boots','gloves','ring1','ring2','amulet',
          NULL
        ));
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
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
      ALTER TABLE items ENABLE ROW LEVEL SECURITY;
      ALTER TABLE character_inventory ENABLE ROW LEVEL SECURITY;
      ALTER TABLE spells ENABLE ROW LEVEL SECURITY;
      ALTER TABLE character_spells ENABLE ROW LEVEL SECURITY;

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
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'items_public_read') THEN
          CREATE POLICY items_public_read ON items FOR SELECT USING (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'inventory_select_own') THEN
          CREATE POLICY inventory_select_own ON character_inventory FOR SELECT
            USING (character_id IN (SELECT id FROM characters WHERE user_id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'inventory_insert_own') THEN
          CREATE POLICY inventory_insert_own ON character_inventory FOR INSERT
            WITH CHECK (character_id IN (SELECT id FROM characters WHERE user_id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'inventory_update_own') THEN
          CREATE POLICY inventory_update_own ON character_inventory FOR UPDATE
            USING (character_id IN (SELECT id FROM characters WHERE user_id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'inventory_delete_own') THEN
          CREATE POLICY inventory_delete_own ON character_inventory FOR DELETE
            USING (character_id IN (SELECT id FROM characters WHERE user_id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'spells_public_read') THEN
          CREATE POLICY spells_public_read ON spells FOR SELECT USING (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'char_spells_select_own') THEN
          CREATE POLICY char_spells_select_own ON character_spells FOR SELECT
            USING (character_id IN (SELECT id FROM characters WHERE user_id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'char_spells_insert_own') THEN
          CREATE POLICY char_spells_insert_own ON character_spells FOR INSERT
            WITH CHECK (character_id IN (SELECT id FROM characters WHERE user_id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'char_spells_delete_own') THEN
          CREATE POLICY char_spells_delete_own ON character_spells FOR DELETE
            USING (character_id IN (SELECT id FROM characters WHERE user_id = auth.uid()));
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

    // Seed items (uses ON CONFLICT so new items are added on restarts)
    this.logger.log('Syncing items...');
    const items = (itemsData as any[]).map((item: any) => ({
      id: item.id,
      name: item.name,
      description: item.description ?? null,
      type: item.type,
      rarity: item.rarity ?? 'common',
      weight: item.weight ?? 0,
      value: item.value ?? 0,
      level_required: item.levelRequired ?? 1,
      class_restriction: item.classRestriction ?? null,
      bonus_strength: item.bonusStrength ?? 0,
      bonus_dexterity: item.bonusDexterity ?? 0,
      bonus_constitution: item.bonusConstitution ?? 0,
      bonus_intelligence: item.bonusIntelligence ?? 0,
      bonus_wisdom: item.bonusWisdom ?? 0,
      bonus_charisma: item.bonusCharisma ?? 0,
      bonus_ac: item.bonusAc ?? 0,
      bonus_hp: item.bonusHp ?? 0,
      damage_min: item.damageMin ?? null,
      damage_max: item.damageMax ?? null,
      effect_type: item.effectType ?? null,
      effect_value: item.effectValue ?? null,
    }));

    const COLS = 21;
    for (let i = 0; i < items.length; i += 50) {
      const chunk = items.slice(i, i + 50);
      const values = chunk
        .map(
          (_, idx) =>
            `(${Array.from({ length: COLS }, (__, c) => `$${idx * COLS + c + 1}`).join(', ')})`,
        )
        .join(', ');

      const params = chunk.flatMap((item) => [
        item.id, item.name, item.description, item.type, item.rarity,
        item.weight, item.value, item.level_required, item.class_restriction,
        item.bonus_strength, item.bonus_dexterity, item.bonus_constitution,
        item.bonus_intelligence, item.bonus_wisdom, item.bonus_charisma,
        item.bonus_ac, item.bonus_hp, item.damage_min, item.damage_max,
        item.effect_type, item.effect_value,
      ]);

      await client.query(
        `INSERT INTO items (id, name, description, type, rarity, weight, value, level_required, class_restriction,
          bonus_strength, bonus_dexterity, bonus_constitution, bonus_intelligence, bonus_wisdom, bonus_charisma,
          bonus_ac, bonus_hp, damage_min, damage_max, effect_type, effect_value)
         VALUES ${values}
         ON CONFLICT (id) DO NOTHING`,
        params,
      );
    }

    this.logger.log(`${items.length} items synced`);

    // Seed spells (uses ON CONFLICT so new spells are added on restarts)
    this.logger.log('Syncing spells...');
    const spells = (spellsData as any[]).map((s: any) => ({
      id: s.id,
      name: s.name,
      description: s.description ?? null,
      school: s.school,
      spell_level: s.spellLevel ?? 1,
      mana_cost: s.manaCost ?? 0,
      cooldown_seconds: s.cooldownSeconds ?? 0,
      level_required: s.levelRequired ?? 1,
      class_restriction: s.classRestriction ?? null,
      target_type: s.targetType,
      effect_type: s.effectType ?? null,
      effect_value: s.effectValue ?? null,
      damage_type: s.damageType ?? null,
    }));

    const SPELL_COLS = 13;
    for (let i = 0; i < spells.length; i += 50) {
      const chunk = spells.slice(i, i + 50);
      const values = chunk
        .map(
          (_, idx) =>
            `(${Array.from({ length: SPELL_COLS }, (__, c) => `$${idx * SPELL_COLS + c + 1}`).join(', ')})`,
        )
        .join(', ');

      const params = chunk.flatMap((s) => [
        s.id, s.name, s.description, s.school, s.spell_level,
        s.mana_cost, s.cooldown_seconds, s.level_required, s.class_restriction,
        s.target_type, s.effect_type, s.effect_value, s.damage_type,
      ]);

      await client.query(
        `INSERT INTO spells (id, name, description, school, spell_level,
          mana_cost, cooldown_seconds, level_required, class_restriction,
          target_type, effect_type, effect_value, damage_type)
         VALUES ${values}
         ON CONFLICT (id) DO NOTHING`,
        params,
      );
    }

    this.logger.log(`${spells.length} spells synced`);
  }
}
