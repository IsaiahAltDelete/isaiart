
export interface CharacterAppearance {
  height: string;
  weight: string;
  eyes: string;
  hair: string;
  skin: string;
  age: string;
  description: string;
}

export interface CharacterStats {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

export interface DerivedStats {
  strengthMod: string;
  dexterityMod: string;
  constitutionMod: string;
  intelligenceMod: string;
  wisdomMod: string;
  charismaMod: string;
  proficiencyBonus: string;
  initiative: string;
  hitPointsMax: number;
  hitDice: string;
  armorClass: number;
  speed: string;
}

export interface SavingThrow {
  name: string; // e.g., "Strength"
  value: string; // e.g., "+3"
  proficient: boolean;
}

export interface Skill {
  name: string; // e.g., "Acrobatics"
  stat: string; // e.g., "Dex"
  value: string; // e.g., "+5"
  proficient: boolean;
}

export interface SpellcastingInfo {
  ability: string;
  saveDC: number | string; // string for "N/A"
  attackBonus: string; // string for "N/A" or "+5"
}

export interface Personality {
  traits: string; // Comma-separated
  ideals: string;
  bonds: string;
  flaws: string;
}

export interface CharacterData {
  name: string;
  race: string;
  class: string;
  level: number;
  alignment: string;
  background: string;
  gender: string;
  appearance: CharacterAppearance;
  hometown: string;
  stats: CharacterStats;
  derivedStats: DerivedStats;
  savingThrows: SavingThrow[];
  skills: Skill[];
  attacksAndCantrips: string; // Text description or list as string
  spells?: string; // Text description or list as string. Could be "N/A"
  spellcastingInfo?: SpellcastingInfo; // Optional, based on class
  equipment: string; // Comma-separated list or description
  featuresAndTraits: string; // Comma-separated list or description
  personality: Personality;
  backstory: string;
}
    