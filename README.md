# Forgebound

A **fantasy RPG** played entirely through **REST API** calls. Create characters, explore a vast world, fight monsters, delve into dungeons, and complete quests — all via HTTP requests. No frontend required — build your own client, use curl, or just a REST client like Postman.

**[Live API Docs](https://forgebound.io)** | **[OpenAPI Spec](https://forgebound.io/openapi.html)** | **[World Map](https://forgebound.io/map.html)** | **[Discord](https://discord.gg/qPgsa5xqe3)**

---

## Features

- **Character Creation** — 5 races (Human, Elf, Dwarf, Halfling, Orc) and 5 classes (Warrior, Mage, Rogue, Cleric, Ranger) with D&D-style point-buy stats
- **Open World** — 100x100 tile map with 7 terrain types, 12 towns, 14 landmarks, and ~500 points of interest
- **A\* Pathfinding Travel** — Real-time travel with terrain-based movement costs and random encounters
- **Turn-Based Combat** — d20 attack rolls, crits, 65 monsters across 9 types with level scaling
- **Status Effects** — 12 effects (Poison, Burn, Stun, Freeze, Silence, Shield, Regen, and more) via spells, weapons, and monster abilities
- **Spell System** — Class-specific spell lists with damage, healing, buffs, and debuffs
- **Equipment & Inventory** — Weapons, armor, consumables with rarity tiers and carry weight
- **Shops** — Town shops with restocking inventory, buy/sell at different prices
- **Dungeons** — Multi-room instanced dungeons with combat, treasure, traps, rest rooms, and bosses
- **Quests** — 37 hand-crafted quests across all 12 towns with kill, fetch, and explore objectives
- **Leveling** — XP-based progression (levels 1-20) with stat allocation and spell unlocks
- **Rest System** — Camp in the wild or stay at an inn to restore HP and mana

## Quick Start

### 1. Register & Login

```bash
# Register
curl -X POST https://forgebound.io/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "yourpassword"}'

# Login (save the token)
curl -X POST https://forgebound.io/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "yourpassword"}'
```

### 2. Create a Character

```bash
curl -X POST https://forgebound.io/api/characters \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Aldric",
    "raceId": "human",
    "classId": "warrior",
    "strength": 15, "dexterity": 12, "constitution": 14,
    "intelligence": 8, "wisdom": 10, "charisma": 8
  }'
```

### 3. Start Exploring

```bash
# Travel to a location
curl -X POST https://forgebound.io/api/travel/go \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"x": 45, "y": 52}'

# Check travel status
curl https://forgebound.io/api/travel/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## API Endpoints

| Category | Endpoints | Description |
|----------|-----------|-------------|
| **Auth** | 3 | Register, login, profile |
| **Characters** | 3 | Create, view, allocate stats |
| **Travel** | 4 | Move, pathfind, status, cancel |
| **Map** | 3 | World map, regions, cell details |
| **Combat** | 2 | Status, perform action |
| **Inventory** | 6 | View, pick up, drop, equip, unequip, use |
| **Spells** | 3 | Spellbook, learn, cast |
| **Rest** | 4 | Camp, inn, status, stop |
| **Shops** | 3 | View inventory, buy, sell |
| **Quests** | 5 | Available, active, accept, turn in, abandon |
| **Dungeons** | 4 | Status, enter, advance, leave |
| **Game Data** | 4 | Races, classes, items, spells (public) |

Full documentation at [forgebound.io](https://forgebound.io) or via the [OpenAPI spec](https://forgebound.io/openapi.html).

## Self-Hosting

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A [Supabase](https://supabase.com/) project (free tier works)

### Setup

```bash
# Clone the repo
git clone https://github.com/wojo1086/forgebound.git
cd forgebound

# Install dependencies
npm install

# Copy the environment template and fill in your Supabase credentials
cp .env.example .env
# Edit .env with your Supabase URL, anon key, JWT JWK, and database URL
```

### Environment Variables

| Variable | Description | Where to find it |
|----------|-------------|------------------|
| `SUPABASE_URL` | Your Supabase project URL | Dashboard > Settings > API |
| `SUPABASE_ANON_KEY` | Public anon key | Dashboard > Settings > API |
| `SUPABASE_JWT_JWK` | ES256 public key (JSON) | Dashboard > Settings > API > JWT Settings |
| `DATABASE_URL` | PostgreSQL connection string | Dashboard > Settings > Database > Connection string |

### Run

```bash
# Development (watch mode)
npm run start:dev

# Production
npm run build
npm run start:prod
```

The server starts on `http://localhost:3000`. Database tables, seed data, and RLS policies are created automatically on first boot.

### What happens on startup

1. **Tables created** — characters, inventory, active_combats, spells, items, shops, dungeons, quests, etc.
2. **Data seeded** — 65 monsters, 80+ items, 30+ spells, 37 quests, world map with POIs
3. **RLS policies applied** — Row-level security ensures players can only access their own data

## Tech Stack

- **Runtime** — [NestJS](https://nestjs.com/) (Node.js + TypeScript)
- **Database** — [Supabase](https://supabase.com/) (PostgreSQL + Auth + RLS)
- **Auth** — Supabase Auth with JWT verification
- **Hosting** — Static files served from `/public` (API docs, world map, OpenAPI spec)

## Project Structure

```
src/
  auth/           # Registration, login, JWT verification
  characters/     # Character creation and management
  travel/         # Movement, pathfinding, encounters
  map/            # World map, regions, POIs
  combat/         # Turn-based combat engine + status effects
  inventory/      # Items, equipment, backpack
  spells/         # Spell system
  rest/           # Camping and inn resting
  shops/          # Town shops
  quests/         # Quest system
  dungeons/       # Dungeon instances
  leveling/       # XP and level progression
  game-data/      # Public reference data endpoints
  common/         # Shared constants, guards, decorators
  data/           # JSON seed data (monsters, items, spells, quests, map)
  database/       # Bootstrap (table creation, seeding, RLS)
public/
  index.html      # API documentation site
  openapi.html    # OpenAPI spec viewer (Redoc)
  openapi.json    # OpenAPI 3.0.3 specification
  map.html        # Interactive world map
http/             # REST client test files (.http)
```

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## License

[MIT](LICENSE)
