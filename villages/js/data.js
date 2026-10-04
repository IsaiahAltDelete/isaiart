// Static game data: goods, buildings, decorations, jobs, quests, names.

export const GOODS = {
  coins:  { name: 'Coins',  icon: 'coin',
            desc: 'Money for building and trading.', from: 'Market Stall sales, quests, the travelling merchant', uses: 'Most buildings, settling new clearings' },
  wood:   { name: 'Wood',   icon: 'wood',  price: 1, reserve: 80, capped: true,
            desc: 'Raw logs felled from the forest.', from: 'Lumber Hut (woodcutters), clearing trees', uses: 'Almost every building; sawn into planks at the Sawmill' },
  planks: { name: 'Planks', icon: 'plank', price: 3, reserve: 30, capped: true,
            desc: 'Sawn lumber — logs cut into boards.', from: 'Sawmill (2 wood → 1 plank)', uses: 'Better buildings, docks, upgrades' },
  stone:  { name: 'Stone',  icon: 'stone', price: 1, reserve: 60, capped: true,
            desc: 'Rough stone broken from boulders.', from: 'Quarry (miners)', uses: 'Windmill, bakery, wells; cut into bricks' },
  bricks: { name: 'Bricks', icon: 'brick', price: 5, reserve: 20, capped: true,
            desc: 'Neatly cut building blocks.', from: 'Stonemason (3 stone → 1 brick)', uses: 'Tiled Cottages, level-3 upgrades' },
  grain:  { name: 'Grain',  icon: 'wheat', price: 2, reserve: 60, capped: true,
            desc: 'Harvested wheat.', from: 'Farm Plot (wheat crop)', uses: 'Windmill → flour, Brewery → ale, Chicken Coop feed' },
  flour:  { name: 'Flour',  icon: 'flour', price: 3, reserve: 20, capped: true,
            desc: 'Freshly milled flour.', from: 'Windmill (3 grain → 2 flour)', uses: 'Bakery → food' },
  food:   { name: 'Food',   icon: 'apple', price: 2, reserve: 150, capped: true,
            desc: 'What everyone eats. Each villager eats about one a minute; children eat less.', from: 'Foragers, fishers, bakery, coop, orchard, vegetable crops', uses: 'Meals, babies, newcomers' },
  wool:   { name: 'Wool',   icon: 'wool',  price: 3, reserve: 20, capped: true,
            desc: 'Soft fleece sheared from sheep.', from: 'Sheep Pasture (shepherd)', uses: 'Weaver → cloth' },
  cloth:  { name: 'Cloth',  icon: 'cloth', price: 9, reserve: 10, capped: true,
            desc: 'Woven fabric. Sells for a lot.', from: 'Weaver (2 wool → 1 cloth)', uses: 'Selling, Tiled Cottage curtains, level-3 upgrades' },
  milk:   { name: 'Milk',   icon: 'milk',  price: 2, reserve: 20, capped: true,
            desc: 'Fresh milk from the cows.', from: 'Cow Pasture (milker)', uses: 'Creamery → cheese' },
  cheese: { name: 'Cheese', icon: 'cheese', price: 8, reserve: 10, capped: true,
            desc: 'Aged wheels of cheese.', from: 'Creamery (2 milk → 1 cheese)', uses: 'Tavern meals, selling' },
  honey:  { name: 'Honey',  icon: 'honey', price: 6, reserve: 10, capped: true,
            desc: 'Golden honey from the hives.', from: 'Beehives (beekeeper)', uses: 'Tavern treats, selling' },
  ale:    { name: 'Ale',    icon: 'ale',   price: 7, reserve: 10, capped: true,
            desc: 'A frothy village brew.', from: 'Brewery (2 grain → 1 ale)', uses: 'Tavern' },
  gems:   { name: 'Gems',   icon: 'gem',
            desc: 'Rare gems.', from: 'Quests, levelling up, achievements', uses: 'Shop deals, statues' },
};
export const TOP_GOODS = ['coins', 'wood', 'planks', 'stone', 'food', 'gems'];
export const SELLABLE = ['wood', 'planks', 'stone', 'bricks', 'grain', 'flour', 'food', 'wool', 'cloth', 'milk', 'cheese', 'honey', 'ale'];

// size = [w, d] in tiles. time = builder-seconds of work.
// lvl = player level needed. workers/job = staffed production.
export const BUILDINGS = {
  campfire:   { name: 'Campfire', size: [2, 2], hidden: true, housing: 2, storage: 300, time: 20,
                desc: 'Heart of the settlement.' },
  cottage:    { name: 'Cottage', size: [2, 2], cost: { wood: 40, coins: 20 }, time: 14, lvl: 1, housing: 3,
                desc: 'A cozy home for 3 villagers.' },
  lumber:     { name: 'Lumber Hut', size: [2, 2], cost: { wood: 15 }, time: 8, lvl: 1, workers: 2, job: 'woodcutter',
                desc: 'Woodcutters fell nearby trees.' },
  forager:    { name: 'Forager Hut', size: [2, 2], cost: { wood: 25 }, time: 10, lvl: 1, workers: 2, job: 'forager',
                desc: 'Gathers berries from bushes.' },
  farm:       { name: 'Farm Plot', size: [3, 3], cost: { wood: 30, coins: 30 }, time: 12, lvl: 2, workers: 2, job: 'farmer',
                desc: 'Grow wheat, vegetables or pumpkins.' },
  sawmill:    { name: 'Sawmill', size: [2, 2], cost: { wood: 60, coins: 40 }, time: 16, lvl: 2, workers: 2, job: 'sawyer',
                desc: 'Saws 2 wood into 1 plank.' },
  quarry:     { name: 'Quarry', size: [2, 2], cost: { wood: 50, planks: 10 }, time: 16, lvl: 2, workers: 2, job: 'miner',
                desc: 'Miners break boulders for stone.' },
  storehouse: { name: 'Storehouse', size: [3, 2], cost: { wood: 80, planks: 20 }, time: 20, lvl: 3, storage: 400,
                desc: '+400 storage for every good.' },
  dock:       { name: 'Fishing Dock', size: [2, 2], cost: { wood: 40, planks: 20 }, time: 16, lvl: 3, workers: 2, job: 'fisher',
                needsWater: true, desc: 'Fishers catch fish. Build on a shore.' },
  market:     { name: 'Market Stall', size: [2, 2], cost: { planks: 30, coins: 50 }, time: 14, lvl: 3, workers: 1, job: 'merchant',
                desc: 'Sells surplus goods for coins.' },
  forester:   { name: "Forester's Lodge", size: [2, 2], cost: { wood: 40, planks: 10 }, time: 12, lvl: 3, workers: 1, job: 'forester',
                desc: 'Plants saplings so the forest regrows.' },
  windmill:   { name: 'Windmill', size: [2, 2], cost: { planks: 60, stone: 40 }, time: 24, lvl: 4, workers: 1, job: 'miller',
                desc: 'Grinds 3 grain into 2 flour.' },
  bakery:     { name: 'Bakery', size: [2, 2], cost: { planks: 40, stone: 60 }, time: 20, lvl: 5, workers: 2, job: 'baker',
                desc: 'Bakes 2 flour into 8 food.' },
  mason:      { name: 'Stonemason', size: [2, 2], cost: { planks: 50, stone: 40 }, time: 20, lvl: 5, workers: 2, job: 'mason',
                desc: 'Cuts 3 stone into 1 brick.' },
  coop:       { name: 'Chicken Coop', size: [2, 2], cost: { wood: 40, coins: 40 }, time: 12, lvl: 2, workers: 1, job: 'herder',
                desc: 'Chickens turn 1 grain into 5 food (eggs).' },
  orchard:    { name: 'Orchard', size: [3, 3], cost: { wood: 50, coins: 60 }, time: 14, lvl: 3, workers: 2, job: 'picker',
                desc: 'Apple trees. Pickers gather 6 food a basket.' },
  beehive:    { name: 'Apiary', size: [2, 2], cost: { planks: 20, coins: 60 }, time: 12, lvl: 3, workers: 1, job: 'beekeeper',
                desc: 'Honey — and bees speed up nearby farms and orchards.' },
  pasture:    { name: 'Sheep Pasture', size: [3, 3], cost: { wood: 60, planks: 20 }, time: 16, lvl: 4, workers: 1, job: 'shepherd',
                desc: 'A flock of sheep. The shepherd shears wool.' },
  weaver:     { name: 'Weaver', size: [2, 2], cost: { planks: 50, stone: 30 }, time: 18, lvl: 4, workers: 2, job: 'weaver',
                desc: 'Weaves 2 wool into 1 cloth.' },
  dairy:      { name: 'Cow Pasture', size: [3, 3], cost: { wood: 80, planks: 30 }, time: 18, lvl: 5, workers: 1, job: 'milker',
                desc: 'Cows graze; the milker brings in milk.' },
  creamery:   { name: 'Creamery', size: [2, 2], cost: { planks: 50, stone: 50 }, time: 18, lvl: 5, workers: 1, job: 'cheesemaker',
                desc: 'Turns 2 milk into 1 cheese.' },
  brewery:    { name: 'Brewery', size: [2, 2], cost: { planks: 60, stone: 40 }, time: 20, lvl: 6, workers: 1, job: 'brewer',
                desc: 'Brews 2 grain into 1 ale.' },
  tavern:     { name: 'Tavern', size: [3, 2], cost: { planks: 80, bricks: 20, coins: 150 }, time: 26, lvl: 6, workers: 1, job: 'innkeeper',
                desc: 'Serves ale, cheese and honey for a big happiness boost.' },
  school:     { name: 'Schoolhouse', size: [2, 2], cost: { planks: 60, bricks: 10, coins: 80 }, time: 20, lvl: 5, workers: 1, job: 'teacher',
                desc: 'Children study here and grow up 15% faster workers.' },
  watchtower: { name: 'Watchtower', size: [2, 2], cost: { wood: 60, stone: 30 }, time: 16, lvl: 3, workers: 2, job: 'guard',
                desc: 'Guards stay up all night and drive off wolves, boars and goblins.' },
  wizard:     { name: 'Wizard Tower', size: [2, 2], cost: { stone: 80, planks: 40, gems: 10 }, time: 30, lvl: 4, workers: 2, job: 'wizard',
                desc: 'Apprentices study the arcane: they gather mana and learn new spells.' },
  tiled:      { name: 'Tiled Cottage', size: [2, 2], cost: { planks: 60, bricks: 30 }, time: 22, lvl: 6, housing: 6,
                desc: 'A sturdy home for 6 villagers.' },
};
export const BUILD_ORDER = ['cottage', 'lumber', 'forager', 'farm', 'coop', 'sawmill', 'quarry', 'storehouse', 'dock',
  'market', 'forester', 'orchard', 'beehive', 'windmill', 'pasture', 'weaver', 'bakery', 'mason', 'dairy', 'creamery',
  'school', 'brewery', 'tavern', 'watchtower', 'wizard', 'tiled'];

// Buildings near each other help out: "to" works faster when a "from"
// building is within range tiles of it.
export const SYNERGY = [
  { to: 'farm',     from: 'beehive',  bonus: 0.25, range: 8, why: 'Bees pollinate the crops' },
  { to: 'orchard',  from: 'beehive',  bonus: 0.25, range: 8, why: 'Bees pollinate the blossom' },
  { to: 'beehive',  from: 'flowers',  bonus: 0.10, range: 6, why: 'Flower beds feed the bees', stack: 4 },
  { to: 'beehive',  from: 'orchard',  bonus: 0.20, range: 8, why: 'Apple blossom for the bees' },
  { to: 'sawmill',  from: 'lumber',   bonus: 0.15, range: 7, why: 'Logs arrive straight from the woodcutters' },
  { to: 'windmill', from: 'farm',     bonus: 0.15, range: 8, why: 'Grain comes straight off the fields' },
  { to: 'bakery',   from: 'windmill', bonus: 0.20, range: 7, why: 'Fresh flour next door' },
  { to: 'coop',     from: 'farm',     bonus: 0.20, range: 7, why: 'Chickens peck the stubble' },
  { to: 'weaver',   from: 'pasture',  bonus: 0.20, range: 8, why: 'Wool straight from the flock' },
  { to: 'creamery', from: 'dairy',    bonus: 0.20, range: 8, why: 'Milk still warm from the cows' },
  { to: 'tavern',   from: 'brewery',  bonus: 0.20, range: 8, why: 'Ale on tap from next door' },
  { to: 'market',   from: 'tavern',   bonus: 0.15, range: 8, why: 'Tavern crowds buy more' },
  { to: 'lumber',   from: 'forester', bonus: 0.15, range: 9, why: 'The forester keeps the woods stocked' },
];

// spells the Wizard Tower can learn, in study order
export const SPELLS = [
  { id: 'harvest',   name: 'Bountiful Harvest', icon: 'wheat',  cost: 30, study: 120,  cd: 120, desc: 'Every growing field ripens at once.' },
  { id: 'rain',      name: 'Call the Rain',     icon: 'sound',  cost: 20, study: 160,  cd: 120, desc: 'Summon a gentle shower — crops grow 60% faster in rain.' },
  { id: 'haste',     name: 'Swift Feet',        icon: 'fast',   cost: 40, study: 220, cd: 180, desc: 'For 90 seconds everyone walks and works 35% faster.' },
  { id: 'ward',      name: 'Ward of Light',     icon: 'star',   cost: 50, study: 280, cd: 300, desc: 'Glowing wards keep every beast away for three nights.' },
  { id: 'bloom',     name: 'Forest Bloom',      icon: 'sapling', cost: 35, study: 340, cd: 240, desc: 'Plants a ring of saplings and refills every berry bush.' },
  { id: 'transmute', name: 'Stone to Gems',     icon: 'gem',    cost: 60, study: 440, cd: 300, desc: 'Turns 60 stone into 4 gems.' },
];

// beasts that prowl at night
export const BEASTS = {
  wolf:   { name: 'Wolf',   hp: 3, speed: 2.2, lvl: 1, steals: { food: 25 }, verb: 'snatched' },
  boar:   { name: 'Boar',   hp: 5, speed: 1.7, lvl: 3, farm: true, verb: 'trampled' },
  goblin: { name: 'Goblin', hp: 4, speed: 1.9, lvl: 5, steals: { coins: 60 }, verb: 'pinched' },
};

// what a Farm Plot can grow
export const CROPS = {
  wheat:    { name: 'Wheat',      out: 'grain', n: 20, grow: 50, color: 0xe8c14a, desc: '20 grain a harvest' },
  veg:      { name: 'Vegetables', out: 'food',  n: 14, grow: 40, color: 0x6fbf3f, desc: '14 food a harvest' },
  pumpkins: { name: 'Pumpkins',   out: 'food',  n: 26, grow: 75, color: 0xe58a3a, desc: '26 food, slower to grow' },
};

// Decorations are placed instantly and raise happiness nearby.
export const DECOR = {
  flowers:  { name: 'Flower Bed', size: [1, 1], cost: { coins: 15 }, lvl: 1, joy: 2 },
  bench:    { name: 'Bench',      size: [1, 1], cost: { wood: 10 }, lvl: 1, joy: 2 },
  lantern:  { name: 'Lantern',    size: [1, 1], cost: { wood: 5, coins: 20 }, lvl: 2, joy: 2 },
  hay:      { name: 'Hay Bales',  size: [1, 1], cost: { grain: 10 }, lvl: 2, joy: 1 },
  pumpkins: { name: 'Pumpkins',   size: [1, 1], cost: { food: 15 }, lvl: 2, joy: 2 },
  fence:    { name: 'Fence',      size: [1, 1], cost: { wood: 4 }, lvl: 1, joy: 1 },
  well:     { name: 'Well',       size: [1, 1], cost: { stone: 30, planks: 10 }, lvl: 3, joy: 5 },
  sign:     { name: 'Signpost',   size: [1, 1], cost: { planks: 5 }, lvl: 2, joy: 1 },
  torch:    { name: 'Torch Post', size: [1, 1], cost: { wood: 4, coins: 5 }, lvl: 2, joy: 1, desc: 'Lights the night. Prowling animals hate the flames.' },
  palisade: { name: 'Palisade',   size: [1, 1], cost: { wood: 6 }, lvl: 2, joy: 0, desc: 'A sharpened log wall. Villagers slip through; beasts can\'t.' },
  memorial: { name: 'Memorial Garden', size: [2, 2], cost: { stone: 40, coins: 60 }, lvl: 3, joy: 3, desc: 'A quiet garden where the village remembers those who have passed. Softens mourning.' },
  statue:   { name: 'Statue',     size: [1, 1], cost: { gems: 25 }, lvl: 4, joy: 10 },
};
export const DECOR_ORDER = ['flowers', 'bench', 'fence', 'lantern', 'torch', 'palisade', 'hay', 'pumpkins', 'sign', 'well', 'memorial', 'statue'];

export const JOBS = {
  idle:       { name: 'Idle',       tool: null },
  builder:    { name: 'Builder',    tool: 'hammer' },
  woodcutter: { name: 'Woodcutter', tool: 'axe' },
  forager:    { name: 'Forager',    tool: 'basket' },
  farmer:     { name: 'Farmer',     tool: 'hoe' },
  sawyer:     { name: 'Sawyer',     tool: 'hammer' },
  miner:      { name: 'Miner',      tool: 'pick' },
  fisher:     { name: 'Fisher',     tool: 'rod' },
  merchant:   { name: 'Merchant',   tool: null },
  forester:   { name: 'Forester',   tool: 'sapling' },
  miller:     { name: 'Miller',     tool: null },
  baker:      { name: 'Baker',      tool: null },
  mason:      { name: 'Mason',      tool: 'hammer' },
  herder:     { name: 'Chicken Keeper', tool: 'basket' },
  picker:     { name: 'Apple Picker', tool: 'basket' },
  beekeeper:  { name: 'Beekeeper',  tool: null },
  shepherd:   { name: 'Shepherd',   tool: 'hoe' },
  weaver:     { name: 'Weaver',     tool: null },
  milker:     { name: 'Milker',     tool: 'basket' },
  cheesemaker:{ name: 'Cheesemaker', tool: null },
  brewer:     { name: 'Brewer',     tool: null },
  innkeeper:  { name: 'Innkeeper',  tool: null },
  teacher:    { name: 'Teacher',    tool: null },
  child:      { name: 'Child',      tool: null },
  guard:      { name: 'Guard',      tool: 'spear' },
  wizard:     { name: 'Wizard',     tool: 'staff' },
  retired:    { name: 'Retired',    tool: null },
};

export const SETTLEMENTS = [
  { id: 'meadow', name: 'Meadowbrook', unlock: null, blurb: 'Your first clearing.' },
  { id: 'pine',   name: 'Pinehollow',  unlock: { lvl: 4, cost: { coins: 400, wood: 200 } }, blurb: 'Deep woods, endless timber.' },
  { id: 'shallows', name: 'The Shallows', unlock: { lvl: 6, cost: { coins: 900, planks: 150 } }, blurb: 'A lakeside hamlet. Great fishing.' },
  { id: 'stone',  name: 'Stonecrest',  unlock: { lvl: 8, cost: { coins: 1600, bricks: 60 } }, blurb: 'Rocky hills full of boulders.' },
];

// Quests unlock in order; three are shown at a time.
export const QUESTS = [
  { id: 'q_lumber',  title: 'Build a Lumber Hut',   kind: 'build', key: 'lumber', n: 1,  reward: { gems: 5, coins: 40, xp: 30 } },
  { id: 'q_staff',   title: 'Assign 2 Woodcutters', kind: 'job', key: 'woodcutter', n: 2, reward: { coins: 40, xp: 20 } },
  { id: 'q_wood',    title: 'Collect 200 Wood',     kind: 'produce', key: 'wood', n: 200, reward: { gems: 5, coins: 60, xp: 40 } },
  { id: 'q_forage',  title: 'Build a Forager Hut',  kind: 'build', key: 'forager', n: 1, reward: { coins: 40, xp: 30 } },
  { id: 'q_cottage', title: 'Build a Cottage',      kind: 'build', key: 'cottage', n: 1, reward: { gems: 5, xp: 40 } },
  { id: 'q_farm',    title: 'Build a Farm Plot',    kind: 'build', key: 'farm', n: 1,    reward: { coins: 80, xp: 40 } },
  { id: 'q_harvest', title: 'Harvest 40 Grain',     kind: 'produce', key: 'grain', n: 40, reward: { gems: 10, coins: 80, xp: 60 } },
  { id: 'q_saw',     title: 'Build a Sawmill',      kind: 'build', key: 'sawmill', n: 1, reward: { coins: 100, xp: 50 } },
  { id: 'q_planks',  title: 'Saw 60 Planks',        kind: 'produce', key: 'planks', n: 60, reward: { gems: 10, xp: 60 } },
  { id: 'q_pop10',   title: 'Reach 10 Villagers',   kind: 'pop', n: 10, reward: { gems: 10, coins: 120, xp: 80 } },
  { id: 'q_coop',    title: 'Build a Chicken Coop',  kind: 'build', key: 'coop', n: 1,  reward: { coins: 80, xp: 40 } },
  { id: 'q_baby',    title: 'Welcome a Baby',       kind: 'births', n: 1,               reward: { gems: 10, coins: 100, xp: 60 } },
  { id: 'q_quarry',  title: 'Build a Quarry',       kind: 'build', key: 'quarry', n: 1, reward: { coins: 100, xp: 50 } },
  { id: 'q_dock',    title: 'Build a Fishing Dock', kind: 'build', key: 'dock', n: 1,    reward: { gems: 10, xp: 60 } },
  { id: 'q_market',  title: 'Build a Market Stall', kind: 'build', key: 'market', n: 1,  reward: { coins: 150, xp: 60 } },
  { id: 'q_sell',    title: 'Earn 300 Coins Trading', kind: 'earn', n: 300,             reward: { gems: 15, xp: 80 } },
  { id: 'q_decor',   title: 'Place 6 Decorations',  kind: 'decor', n: 6,                reward: { gems: 10, xp: 60 } },
  { id: 'q_bees',    title: 'Build an Apiary by a Farm', kind: 'synergy', key: 'beehive', n: 1, reward: { gems: 10, xp: 80 } },
  { id: 'q_pine',    title: 'Settle Pinehollow',    kind: 'unlock', key: 'pine', n: 1,  reward: { gems: 20, coins: 200, xp: 120 } },
  { id: 'q_mill',    title: 'Build a Windmill',     kind: 'build', key: 'windmill', n: 1, reward: { coins: 200, xp: 80 } },
  { id: 'q_bake',    title: 'Bake 200 Food',        kind: 'produce', key: 'bread', n: 200, reward: { gems: 15, xp: 100 } },
  { id: 'q_sheep',   title: 'Build a Sheep Pasture', kind: 'build', key: 'pasture', n: 1, reward: { coins: 150, xp: 80 } },
  { id: 'q_cloth',   title: 'Weave 20 Cloth',        kind: 'produce', key: 'cloth', n: 20, reward: { gems: 15, xp: 120 } },
  { id: 'q_pop25',   title: 'Reach 25 Villagers',   kind: 'pop', n: 25, reward: { gems: 25, coins: 300, xp: 150 } },
  { id: 'q_shallows', title: 'Settle the Shallows', kind: 'unlock', key: 'shallows', n: 1, reward: { gems: 25, coins: 300, xp: 180 } },
  { id: 'q_bricks',  title: 'Cut 50 Bricks',        kind: 'produce', key: 'bricks', n: 50, reward: { gems: 20, xp: 150 } },
  { id: 'q_tower',   title: 'Build a Watchtower',    kind: 'build', key: 'watchtower', n: 1, reward: { coins: 120, xp: 80 } },
  { id: 'q_wizard',  title: 'Raise a Wizard Tower',  kind: 'build', key: 'wizard', n: 1, reward: { gems: 15, xp: 120 } },
  { id: 'q_spell',   title: 'Cast Your First Spell', kind: 'spells', n: 1,               reward: { gems: 10, xp: 100 } },
  { id: 'q_tavern',  title: 'Open a Tavern',         kind: 'build', key: 'tavern', n: 1, reward: { gems: 25, coins: 300, xp: 200 } },
  { id: 'q_tiled',   title: 'Build 3 Tiled Cottages', kind: 'build', key: 'tiled', n: 3, reward: { gems: 30, xp: 200 } },
  { id: 'q_stone',   title: 'Settle Stonecrest',    kind: 'unlock', key: 'stone', n: 1, reward: { gems: 40, coins: 500, xp: 300 } },
  { id: 'q_pop50',   title: 'Reach 50 Villagers',   kind: 'pop', n: 50, reward: { gems: 50, coins: 800, xp: 400 } },
];

export const ACHIEVEMENTS = [
  { id: 'a_build',   name: 'Breaking Ground', desc: 'Finish 5 buildings',       stat: 'buildings', n: 5,    gems: 5,  icon: 'hammer' },
  { id: 'a_build2',  name: 'Town Planner',    desc: 'Finish 25 buildings',      stat: 'buildings', n: 25,   gems: 15, icon: 'house' },
  { id: 'a_trees',   name: 'Lumberjack',      desc: 'Fell 150 trees',           stat: 'felled',    n: 150,  gems: 10, icon: 'axe' },
  { id: 'a_sap',     name: 'Green Thumb',     desc: 'Plant 40 saplings',        stat: 'saplings',  n: 40,   gems: 10, icon: 'sapling' },
  { id: 'a_bread',   name: "Baker's Dozen",   desc: 'Bake 300 food',            stat: 'bread',     n: 300,  gems: 10, icon: 'flour' },
  { id: 'a_coins',   name: 'Merchant Prince', desc: 'Earn 2,000 coins trading', stat: 'earned',    n: 2000, gems: 15, icon: 'coin' },
  { id: 'a_pop',     name: 'Big Family',      desc: 'Reach 30 villagers',       stat: 'pop',       n: 30,   gems: 15, icon: 'people' },
  { id: 'a_happy',   name: 'Happy Place',     desc: 'Reach 90 happiness',       stat: 'happy',     n: 90,   gems: 10, icon: 'smile' },
  { id: 'a_settle',  name: 'Explorer',        desc: 'Settle 3 clearings',       stat: 'settled',   n: 3,    gems: 20, icon: 'map' },
  { id: 'a_up',      name: 'Fixer-Upper',     desc: 'Finish 6 upgrades',        stat: 'upgrades',  n: 6,    gems: 10, icon: 'star' },
  { id: 'a_days',    name: 'Old Timer',       desc: 'Reach day 15',             stat: 'day',       n: 15,   gems: 10, icon: 'clock' },
  { id: 'a_rain',    name: 'Puddle Jumper',   desc: 'See 5 rain showers',       stat: 'rains',     n: 5,    gems: 5,  icon: 'sound' },
  { id: 'a_pave',    name: 'Cobblestoner',    desc: 'Lay 60 stone path tiles',  stat: 'paved',     n: 60,   gems: 10, icon: 'stone' },
  { id: 'a_babies',  name: 'Growing Family',  desc: 'Welcome 10 babies',        stat: 'births',    n: 10,   gems: 15, icon: 'heart' },
  { id: 'a_elder',   name: 'Golden Years',    desc: 'A villager reaches 80',     stat: 'oldest',    n: 80,   gems: 10, icon: 'clock' },
  { id: 'a_synergy', name: 'Good Neighbours', desc: 'Have 8 building bonuses active', stat: 'synergies', n: 8, gems: 15, icon: 'star' },
  { id: 'a_guard',   name: 'Night Watch',     desc: 'Drive off 15 prowling beasts', stat: 'fended', n: 15, gems: 15, icon: 'shield' },
  { id: 'a_spells',  name: 'Archmage',        desc: 'Cast 12 spells',           stat: 'spells',    n: 12,   gems: 20, icon: 'staff' },
  { id: 'a_merch',   name: 'Good Customer',   desc: 'Trade with the merchant 5 times', stat: 'deals', n: 5,  gems: 10, icon: 'shop' },
];

// the travelling merchant picks three of these each visit
export const MERCHANT_OFFERS = [
  { give: { coins: 90 },  get: { planks: 60 } },
  { give: { coins: 150 }, get: { bricks: 35 } },
  { give: { coins: 80 },  get: { stone: 120 } },
  { give: { wood: 100 },  get: { coins: 160 } },
  { give: { food: 100 },  get: { coins: 230 } },
  { give: { grain: 80 },  get: { coins: 200 } },
  { give: { coins: 260 }, get: { gems: 6 } },
  { give: { planks: 40 }, get: { coins: 170 } },
  { give: { coins: 60 },  get: { food: 150 } },
  { give: { stone: 100 }, get: { coins: 140 } },
];

export const xpForLevel = lvl => Math.round(80 * Math.pow(lvl, 1.45));

export const FIRST_NAMES = ['Ada', 'Bram', 'Cora', 'Dell', 'Effie', 'Finn', 'Gus', 'Hazel', 'Ivo', 'June', 'Kit', 'Lark',
  'Milo', 'Nell', 'Otto', 'Pip', 'Quill', 'Rosa', 'Sage', 'Tam', 'Una', 'Vera', 'Wren', 'Yara', 'Bea', 'Clem', 'Dot',
  'Elm', 'Fern', 'Hob', 'Ivy', 'Juno', 'Lou', 'Moss', 'Ned', 'Olive', 'Poppy', 'Rue', 'Sol', 'Tilly', 'Bo', 'Arlo',
  'Basil', 'Clover', 'Dill', 'Ember', 'Flint', 'Hollis', 'Iris', 'Jasper', 'Linden', 'Maple', 'Nutmeg', 'Rowan', 'Saffron'];
export const LAST_NAMES = ['Ashby', 'Brook', 'Cobble', 'Dale', 'Fairweather', 'Greenleaf', 'Hollow', 'Thistle', 'Mossway',
  'Pinecone', 'Underhill', 'Warren', 'Applewood', 'Bramble', 'Fernsby', 'Oakes', 'Rook', 'Tumble', 'Willow', 'Hearth'];
export const SHIRTS = [0xd9534f, 0x4f8fd9, 0x5cb85c, 0xe8a23c, 0x9b6bd1, 0x3fb7ae, 0xe36f9c, 0x8a6a4a, 0xf0c94a, 0x6c8fb3];
export const SKINS = [0xf5d0b0, 0xe8b590, 0xc98e66, 0x9a6640, 0x6e4529, 0xfbe0c8];
export const HAIRS = [0x3b2416, 0x6b4226, 0xc9a050, 0x1b1b1b, 0xa8452a, 0xd8d0c0, 0x4a3020];
