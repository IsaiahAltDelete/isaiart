// Round 7 systems, installed onto a Sim once its save is loaded. Sim-side only.
//
// Each module wraps a few Sim methods on the instance rather than editing their
// bodies, so sim.js stays readable and these systems can be read on their own:
//   roads.js     player roads, cobbles and bridges; saves them with the world
//   island.js    the ferry: ferry-aware paths (world.findPath), boarding (stepVillager), timetable (tick),
//                landing kept clear (checkPlace), the isle's territory (settlementRadius)
//   trade.js     per-settlement stockpiles and carts: tick, second, stepVillager, canAfford, add,
//                place, upgrade, demolish, isSite, unlock, openChest, merchantDeal
//   social.js    friendships and evening visits: think, dropTask, second, endFestival
//   festival.js  festival quests and shop: second
//   education.js school grades, the Library, homes that grow by themselves: assign, second
//   magic.js     arcane crystals, the Enchanter's Forge, magic gear and scrolls: rpgOre, equip, canEquip, unequip
import { installRoads } from './roads.js';
import { installIsland } from './island.js';
import { installTrade } from './trade.js';
import { installSocial } from './social.js';
import { installFestival } from './festival.js';
import { installEducation } from './education.js';
import { installSociety } from './society.js';
import { installGovernment } from './government.js';
import { installEconomy } from './economy.js';
import { installLeisure } from './leisure.js';
import { installCrime } from './crime.js';
import { installClassPlaces } from './classplaces.js';
import { installCareers } from './careers.js';
import { installArcane } from './arcane.js';
import { installMagic } from './magic.js';
import { installEvents } from './events.js';
import { installHardship } from './hardship.js';
import { installClassDuties } from './classduties.js';
import { installWishes } from './wishes.js';
import { installCelebrations } from './celebrations.js';
import { installVisitors } from './visitors.js';
import { installCensus } from './census.js';
import { installFrost } from './frost.js';

export function installAddons(sim, save) {
  installRoads(sim, save);
  installIsland(sim);
  installTrade(sim);
  installSocial(sim);
  installFestival(sim);
  installEducation(sim);
  installSociety(sim, !save);
  installGovernment(sim);
  installEconomy(sim);
  installLeisure(sim);
  installCrime(sim);
  installClassPlaces(sim);
  installCareers(sim);
  installArcane(sim);
  installMagic(sim);        // arcane crystals, scrolls, the Enchanter's Forge, magic gear
  installEvents(sim);       // droughts, fevers, fires, raiders, spirits, the fair folk, dragons
  installHardship(sim);     // villagers who leave; in Harsh, deaths and a village that can fall
  installClassDuties(sim);  // paladins answer the alarm, rangers shoot, rogues spot thieves, bards calm tempers
  installWishes(sim);       // thought-bubble wishes and pets
  installCelebrations(sim, !save);  // weddings, the town's rank, the yearly chronicle
  installVisitors(sim);     // a family, a bard, a scholar or a stranger at the gate
  installCensus(sim);       // a daily population history for the Population page
  installFrost(sim);        // Frostpeak Pass: firewood, wolves, and a glade cleared when it's settled
}
