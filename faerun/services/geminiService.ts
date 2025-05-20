
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { CharacterData } from '../types';

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable not set. Please ensure it is configured.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

// Moved SKILL_LIST_FOR_PROMPT to be a constant as its content doesn't change based on level, only its interpretation by AI.
const SKILL_LIST_FOR_PROMPT_CONTENT = [
  { "name": "Acrobatics", "stat": "Dex" }, { "name": "Animal Handling", "stat": "Wis" },
  { "name": "Arcana", "stat": "Int" }, { "name": "Athletics", "stat": "Str" },
  { "name": "Deception", "stat": "Cha" }, { "name": "History", "stat": "Int" },
  { "name": "Insight", "stat": "Wis" }, { "name": "Intimidation", "stat": "Cha" },
  { "name": "Investigation", "stat": "Int" }, { "name": "Medicine", "stat": "Wis" },
  { "name": "Nature", "stat": "Int" }, { "name": "Perception", "stat": "Wis" },
  { "name": "Performance", "stat": "Cha" }, { "name": "Persuasion", "stat": "Cha" },
  { "name": "Religion", "stat": "Int" }, { "name": "Sleight of Hand", "stat": "Dex" },
  { "name": "Stealth", "stat": "Dex" }, { "name": "Survival", "stat": "Wis" }
].map(s => `      { "name": "${s.name}", "stat": "${s.stat}", "value": "Calculated Modifier e.g. +2", "proficient": false }`).join(',\n');

export interface GenerationParams {
  race?: string;
  characterClass?: string;
  gender?: string;
  age?: string;
  level?: number;
}

export const generateCharacterDetails = async (params: GenerationParams = {}): Promise<CharacterData> => {
  const {
    race = "Any",
    characterClass = "Any",
    gender = "Any",
    age = "Any",
    level = 1,
  } = params;

  // Fix: Renamed finalLevel to calculatedLevel to avoid potential "redeclaration" errors if finalLevel had a naming conflict or confused the linter.
  // The variable 'calculatedLevel' is declared once here and used throughout the function.
  const calculatedLevel = Math.max(1, Math.min(level || 1, 20));

  const raceInstruction = race.toLowerCase() === 'any' || !race ? "Randomly chosen D&D 5e Race from Faerun (e.g., Human, High Elf, Mountain Dwarf)" : race;
  const classInstruction = characterClass.toLowerCase() === 'any' || !characterClass ? "Randomly chosen D&D 5e Class (e.g., Fighter, Wizard, Rogue)" : characterClass;
  const genderInstruction = gender.toLowerCase() === 'any' || !gender ? "Randomly chosen Gender (e.g., Male, Female, Non-binary)" : gender;
  const ageInstruction = age.toLowerCase() === 'any' || !age || age.trim() === "" ? `Age appropriate for a level ${calculatedLevel} adventurer of the chosen race/class` : age;
  
  let proficiencyBonusInstruction = "+2";
  if (calculatedLevel >= 5 && calculatedLevel <= 8) proficiencyBonusInstruction = "+3";
  else if (calculatedLevel >= 9 && calculatedLevel <= 12) proficiencyBonusInstruction = "+4";
  else if (calculatedLevel >= 13 && calculatedLevel <= 16) proficiencyBonusInstruction = "+5";
  else if (calculatedLevel >= 17) proficiencyBonusInstruction = "+6"; // This usage of calculatedLevel corresponds to the original error line 43.

  const PROMPT = `
Generate a complete Dungeons & Dragons 5th Edition character for a level ${calculatedLevel} adventurer in the Faerun setting.

The character MUST be:
- Race: ${raceInstruction} (If a specific race is listed, use that. If 'Randomly chosen', select one.)
- Class: ${classInstruction} (If a specific class is listed, use that. If 'Randomly chosen', select one.)
- Gender: ${genderInstruction} (If a specific gender is listed, use that. If 'Randomly chosen', select one.)
- Age: ${ageInstruction} (If a specific age or description like 'Young Adult' is listed, use that. If 'Age appropriate...', make a sensible choice based on race/class/level.)

Provide the output as a single JSON object. Do not include any explanatory text, comments, or markdown formatting before or after the JSON object itself.
The JSON object must strictly conform to the following structure and data types:
\`\`\`json
{
  "name": "Character Name (e.g., Elara Meadowlight, Gorok Stonebeard)",
  "race": "Actual Race (e.g., Human, High Elf). This MUST match the race instruction above or be a random valid choice.",
  "class": "Actual Class (e.g., Fighter, Wizard). This MUST match the class instruction above or be a random valid choice.",
  "level": ${calculatedLevel},
  "alignment": "Alignment (e.g., Lawful Good, Neutral, Chaotic Evil)",
  "background": "Background (e.g., Acolyte, Criminal, Folk Hero) - appropriate for class and level ${calculatedLevel}",
  "gender": "Actual Gender (e.g., Male, Female, Non-binary). This MUST match the gender instruction or be a random valid choice.",
  "appearance": {
    "height": "Height (e.g., 5'10\\")",
    "weight": "Weight (e.g., 160 lbs)",
    "eyes": "Eye Color (e.g., Blue, Hazel)",
    "hair": "Hair Color/Style (e.g., Black, tousled)",
    "skin": "Skin Tone (e.g., Fair, Tanned)",
    "age": "Actual Age as a string (e.g., '28 years old', 'Young Adult (approx 22)'). This MUST reflect the age instruction.",
    "description": "Brief physical description (1-2 sentences)"
  },
  "hometown": "Hometown in Faerun (e.g., Waterdeep, Baldur's Gate)",
  "stats": {
    "strength": 10, "dexterity": 12, "constitution": 14, "intelligence": 8, "wisdom": 15, "charisma": 13
  },
  "derivedStats": {
    "strengthMod": "+0", "dexterityMod": "+1", "constitutionMod": "+2", "intelligenceMod": "-1", "wisdomMod": "+2", "charismaMod": "+1",
    "proficiencyBonus": "${proficiencyBonusInstruction}",
    "initiative": "+1 (Dex Mod)",
    "hitPointsMax": 12,
    "hitDice": "${calculatedLevel}dXX (Class dependent, e.g., ${calculatedLevel}d10 for Fighter)",
    "armorClass": 14,
    "speed": "30 ft. (Race dependent)"
  },
  "savingThrows": [
    { "name": "Strength", "value": "Calculated", "proficient": false },
    { "name": "Dexterity", "value": "Calculated", "proficient": false },
    { "name": "Constitution", "value": "Calculated", "proficient": false },
    { "name": "Intelligence", "value": "Calculated", "proficient": false },
    { "name": "Wisdom", "value": "Calculated", "proficient": false },
    { "name": "Charisma", "value": "Calculated", "proficient": false }
  ],
  "skills": [
${SKILL_LIST_FOR_PROMPT_CONTENT}
  ],
  "attacksAndCantrips": "List main attacks or cantrips with to-hit and damage. Example: 'Longsword: +X to hit, YdZ+Mod slashing. Fire Bolt: +X to hit, NdN fire damage.' Values based on level ${calculatedLevel}.",
  "spells": "If a spellcaster, list prepared/known spells appropriate for level ${calculatedLevel} (including cantrips and leveled spells by spell level, and total spell slots per level). Example: 'Cantrips: Light, Sacred Flame. Level 1 (X slots): Bless, Cure Wounds. Level 2 (Y slots): Aid.' If not a spellcaster or no spells at level ${calculatedLevel}, use 'N/A'.",
  "spellcastingInfo": {
    "ability": "Spellcasting Ability (e.g., Wisdom, Intelligence, Charisma, or 'N/A')",
    "saveDC": "8 + Prof Bonus + Ability Mod (e.g., 13, or 'N/A')",
    "attackBonus": "Prof Bonus + Ability Mod (e.g., +5, or 'N/A')"
  },
  "equipment": "List starting equipment appropriate for class and level ${calculatedLevel}. (e.g., 'Scale mail, shield, warhammer, explorer\\'s pack, holy symbol')",
  "featuresAndTraits": "List key racial traits and ALL class features acquired up to level ${calculatedLevel}. (e.g., 'Darkvision, Fey Ancestry, Second Wind (Fighter L1), Action Surge (Fighter L2)')",
  "personality": {
    "traits": "Two distinct personality traits, comma-separated",
    "ideals": "One ideal",
    "bonds": "One bond",
    "flaws": "One flaw"
  },
  "backstory": "A brief backstory (2-4 sentences) incorporating class, background, hometown, and level ${calculatedLevel}. Make it engaging!"
}
\`\`\`
Instructions for JSON content generation:
1.  Strictly adhere to the JSON structure provided. Do not add extra fields or omit required ones.
2.  Stats: Generate ability scores (strength, dexterity, etc.) ensuring they are between 3 and 18 before racial modifiers. Apply racial modifiers.
3.  Derived Stats:
    *   Calculate all modifiers (e.g., strengthMod) as (Stat - 10) / 2, floored.
    *   Proficiency Bonus: Must be '${proficiencyBonusInstruction}' for level ${calculatedLevel}.
    *   Hit Points (HP): Calculate correctly for level ${calculatedLevel}. For level 1: Max Hit Die value + CON modifier. For levels > 1: (HP from previous level) + (Rolled Hit Die OR Average Hit Die rounded up) + CON modifier. Ensure total HP reflects this.
    *   Hit Dice: Total number of hit dice should be equal to ${calculatedLevel}, of the type appropriate for the class (e.g. \`${calculatedLevel}d10\` for Fighter, \`${calculatedLevel}d8\` for Rogue). <!-- Note: 'd8', 'd10' etc. are literal string examples for the AI, not variables. -->
    *   Armor Class (AC): Base it on equipped armor (from 'equipment' field), shield, Dexterity modifier, and any other relevant features.
4.  Saving Throws: Determine proficiencies based on class. Value = Stat Modifier + Proficiency Bonus (if proficient).
5.  Skills: Determine proficiencies based on class and background (typically 2 from class, 2 from background for level 1, ensure this is consistent). Value = Stat Modifier + Proficiency Bonus (if proficient). Skill list in JSON should be complete as provided in template.
6.  Spells: If a spellcasting class, provide cantrips known, spells known/prepared, and spell slots per spell level appropriate for level ${calculatedLevel}. Refer to D&D 5e rules for class spell progression.
7.  Spellcasting Info: Provide correct spellcasting ability, save DC, and attack bonus based on class, stats, and level ${calculatedLevel} proficiency bonus.
8.  Features & Traits: List ALL racial traits and ALL class features the character would have at level ${calculatedLevel}. Be specific.
9.  Ensure all "Calculated" or example values in the template are replaced with actual, correctly calculated D&D 5e values for a level ${calculatedLevel} character of the specified/chosen race and class.
The entire response MUST be only the JSON object, starting with '{' and ending with '}'. No leading/trailing text or markdown.
`; // This usage of calculatedLevel in the prompt, particularly around Hit Dice, corresponds to the original error line 134.

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-04-17",
      contents: PROMPT,
      config: {
        responseMimeType: "application/json",
        // temperature: 0.8, // Slightly increased for more varied results.
      },
    });

    let jsonStr = response.text.trim();
    
    const fenceRegex = /^```(?:json)?\s*\n?(.*?)\n?\s*```$/s;
    const match = jsonStr.match(fenceRegex);
    if (match && match[1]) {
      jsonStr = match[1].trim();
    }
    if (jsonStr.startsWith("```") && jsonStr.endsWith("```")) {
        jsonStr = jsonStr.substring(3, jsonStr.length - 3).trim();
    }

    const parsedData = JSON.parse(jsonStr);

    if (!parsedData.name || !parsedData.class || !parsedData.stats || parsedData.level !== calculatedLevel) {
      console.warn("Generated data missing essential fields or level mismatch:", parsedData);
      throw new Error(`Generated data is incomplete, missing key fields, or level mismatch (expected ${calculatedLevel}, got ${parsedData.level}).`);
    }
    
    return parsedData as CharacterData;

  } catch (error) {
    console.error("Error calling Gemini API or parsing response:", error);
    let rawResponseInfo = "";
    if (error instanceof Error && error.message.toLowerCase().includes("json")) {
        // Attempt to get more context if possible, but avoid exposing too much raw data if it's huge or sensitive.
        // This example just uses the error message itself.
        rawResponseInfo = `Details: ${error.message}`;
    }
    throw new Error(`Failed to parse character data from AI. The response was not valid JSON or was incomplete. ${rawResponseInfo} Please check the console for more details and try adjusting parameters or trying again.`);
  }
};
