// Static game data: goods, buildings, decorations, jobs, quests, names.

export const GOODS = {
  coins:  { name: 'Coins',  icon: 'coin' },
  wood:   { name: 'Wood',   icon: 'wood',  price: 1, reserve: 80, capped: true },
  planks: { name: 'Planks', icon: 'plank', price: 3, reserve: 30, capped: true },
  stone:  { name: 'Stone',  icon: 'stone', price: 1, reserve: 60, capped: true },
  bricks: { name: 'Bricks', icon: 'brick', price: 5, reserve: 20, capped: true },
  grain:  { name: 'Grain',  icon: 'wheat', price: 2, reserve: 60, capped: true },
  flour:  { name: 'Flour',  icon: 'flour', price: 3, reserve: 20, capped: true },
  food:   { name: 'Food',   icon: 'apple', price: 2, reserve: 150, capped: true },
  gems:   { name: 'Gems',   icon: 'gem' },
};
export const TOP_GOODS = ['coins', 'wood', 'planks', 'stone', 'food', 'gems'];
export const SELLABLE = ['wood', 'planks', 'stone', 'bricks', 'grain', 'flour', 'food'];

// size = [w, d] in tiles. time = builder-seconds of work.
// lvl = player level needed. workers/job = staffed production.
export const BUILDINGS = {
  campfire:   { name: 'Campfire', size: [2, 2], hidden: true, housing: 2, storage: 300,
                desc: 'Heart of the settlement.' },
  cottage:    { name: 'Cottage', size: [2, 2], cost: { wood: 40, coins: 20 }, time: 14, lvl: 1, housing: 3,
                desc: 'A cozy home for 3 villagers.' },
  lumber:     { name: 'Lumber Hut', size: [2, 2], cost: { wood: 15 }, time: 8, lvl: 1, workers: 2, job: 'woodcutter',
                desc: 'Woodcutters fell nearby trees.' },
  forager:    { name: 'Forager Hut', size: [2, 2], cost: { wood: 25 }, time: 10, lvl: 1, workers: 2, job: 'forager',
                desc: 'Gathers berries from bushes.' },
  farm:       { name: 'Farm Plot', size: [3, 3], cost: { wood: 30, coins: 30 }, time: 12, lvl: 2, workers: 2, job: 'farmer',
                desc: 'Plant and harvest golden wheat.' },
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
  tiled:      { name: 'Tiled Cottage', size: [2, 2], cost: { planks: 60, bricks: 30 }, time: 22, lvl: 6, housing: 6,
                desc: 'A sturdy home for 6 villagers.' },
};
export const BUILD_ORDER = ['cottage', 'lumber', 'forager', 'farm', 'sawmill', 'quarry', 'storehouse', 'dock',
  'market', 'forester', 'windmill', 'bakery', 'mason', 'tiled'];

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
  statue:   { name: 'Statue',     size: [1, 1], cost: { gems: 25 }, lvl: 4, joy: 10 },
};
export const DECOR_ORDER = ['flowers', 'bench', 'fence', 'lantern', 'hay', 'pumpkins', 'sign', 'well', 'statue'];

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
  { id: 'q_quarry',  title: 'Build a Quarry',       kind: 'build', key: 'quarry', n: 1, reward: { coins: 100, xp: 50 } },
  { id: 'q_dock',    title: 'Build a Fishing Dock', kind: 'build', key: 'dock', n: 1,    reward: { gems: 10, xp: 60 } },
  { id: 'q_market',  title: 'Build a Market Stall', kind: 'build', key: 'market', n: 1,  reward: { coins: 150, xp: 60 } },
  { id: 'q_sell',    title: 'Earn 300 Coins Trading', kind: 'earn', n: 300,             reward: { gems: 15, xp: 80 } },
  { id: 'q_decor',   title: 'Place 6 Decorations',  kind: 'decor', n: 6,                reward: { gems: 10, xp: 60 } },
  { id: 'q_pine',    title: 'Settle Pinehollow',    kind: 'unlock', key: 'pine', n: 1,  reward: { gems: 20, coins: 200, xp: 120 } },
  { id: 'q_mill',    title: 'Build a Windmill',     kind: 'build', key: 'windmill', n: 1, reward: { coins: 200, xp: 80 } },
  { id: 'q_bake',    title: 'Bake 200 Food',        kind: 'produce', key: 'bread', n: 200, reward: { gems: 15, xp: 100 } },
  { id: 'q_pop25',   title: 'Reach 25 Villagers',   kind: 'pop', n: 25, reward: { gems: 25, coins: 300, xp: 150 } },
  { id: 'q_shallows', title: 'Settle the Shallows', kind: 'unlock', key: 'shallows', n: 1, reward: { gems: 25, coins: 300, xp: 180 } },
  { id: 'q_bricks',  title: 'Cut 50 Bricks',        kind: 'produce', key: 'bricks', n: 50, reward: { gems: 20, xp: 150 } },
  { id: 'q_tiled',   title: 'Build 3 Tiled Cottages', kind: 'build', key: 'tiled', n: 3, reward: { gems: 30, xp: 200 } },
  { id: 'q_stone',   title: 'Settle Stonecrest',    kind: 'unlock', key: 'stone', n: 1, reward: { gems: 40, coins: 500, xp: 300 } },
  { id: 'q_pop50',   title: 'Reach 50 Villagers',   kind: 'pop', n: 50, reward: { gems: 50, coins: 800, xp: 400 } },
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
