
import React from 'react';
import { CharacterData, Skill, SavingThrow } from '../types';

interface CharacterSheetProps {
  character: CharacterData;
}

const Section: React.FC<{ title: string; children: React.ReactNode; className?: string; titleClassName?: string; icon?: string }> = 
  ({ title, children, className, titleClassName, icon }) => (
  <div className={`bg-[#FDFBF5] p-5 rounded-md shadow-lg mb-6 border border-stone-400/60 ${className}`}>
    <h2 className={`text-2xl font-semibold text-red-800 border-b-2 border-red-700/50 pb-2 mb-4 flex items-center ${titleClassName}`} style={{ fontFamily: "'Merriweather', serif" }}>
      {icon && <span className="material-symbols-outlined mr-2 text-3xl">{icon}</span>}
      {title}
    </h2>
    {children}
  </div>
);

const StatDisplay: React.FC<{ label: string; value: string | number; subValue?: string; large?: boolean }> = ({ label, value, subValue, large }) => (
  <div className="flex flex-col items-center p-2 bg-orange-100/70 rounded-md shadow-sm border border-stone-300/70">
    <span className={`font-bold ${large ? 'text-3xl' : 'text-2xl'} text-red-700`}>{value}</span>
    <span className="text-xs text-stone-700 uppercase tracking-wider mt-1">{label}</span>
    {subValue && <span className="text-sm text-stone-600">{subValue}</span>}
  </div>
);

const PillDisplay: React.FC<{ label: string; value: string | number; className?: string }> = ({label, value, className}) => (
  <div className={`bg-red-100/80 px-3 py-1.5 rounded-md text-sm shadow-sm border border-red-300/50 ${className}`}>
    <span className="text-stone-700">{label}: </span>
    <span className="font-semibold text-red-800">{value}</span>
  </div>
);

const parseStringList = (str: string | undefined, delimiter: string = ','): string[] => {
  if (!str || typeof str !== 'string') return [];
  return str.split(delimiter).map(s => s.trim()).filter(s => s.length > 0);
};

const CharacterSheet: React.FC<CharacterSheetProps> = ({ character }) => {
  const { 
    name, race, class: characterClass, level, alignment, background, gender,
    appearance, hometown, stats, derivedStats, savingThrows, skills,
    attacksAndCantrips, spells, spellcastingInfo, equipment,
    featuresAndTraits, personality, backstory 
  } = character;

  return (
    <div className="text-stone-800" style={{ fontFamily: "'Merriweather', serif" }}>
      <Section 
        title={`${name} - Level ${level} ${race} ${characterClass}`} 
        icon="badge"
        className="bg-[#FAF0E6]/80 backdrop-blur-sm border-2 border-red-700/70"
        titleClassName="text-3xl"
      >
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <PillDisplay label="Alignment" value={alignment} />
          <PillDisplay label="Background" value={background} />
          <PillDisplay label="Gender" value={gender} />
          <PillDisplay label="Hometown" value={hometown} className="md:col-span-1"/>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <h3 className="text-xl font-semibold text-red-700 mb-1 flex items-center">
              <span className="material-symbols-outlined mr-2 text-xl">face_6</span>Appearance
            </h3>
            <p><span className="font-medium text-stone-600">Age:</span> {appearance.age}</p>
            <p><span className="font-medium text-stone-600">Height:</span> {appearance.height} | <span className="font-medium text-stone-600">Weight:</span> {appearance.weight}</p>
            <p><span className="font-medium text-stone-600">Eyes:</span> {appearance.eyes} | <span className="font-medium text-stone-600">Hair:</span> {appearance.hair} | <span className="font-medium text-stone-600">Skin:</span> {appearance.skin}</p>
            <p className="mt-2 text-sm text-stone-700 italic leading-relaxed">{appearance.description}</p>
          </div>
          <div className="mt-4 md:mt-0">
            <h3 className="text-xl font-semibold text-red-700 mb-1 flex items-center">
              <span className="material-symbols-outlined mr-2 text-xl">psychology_alt</span>Personality
            </h3>
            <p><span className="font-medium text-stone-600">Traits:</span> {personality.traits}</p>
            <p><span className="font-medium text-stone-600">Ideals:</span> {personality.ideals}</p>
            <p><span className="font-medium text-stone-600">Bonds:</span> {personality.bonds}</p>
            <p><span className="font-medium text-stone-600">Flaws:</span> {personality.flaws}</p>
          </div>
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Section title="Core Stats" icon="psychology" className="lg:col-span-1">
          <div className="grid grid-cols-3 gap-3">
            <StatDisplay label="STR" value={stats.strength} subValue={derivedStats.strengthMod} />
            <StatDisplay label="DEX" value={stats.dexterity} subValue={derivedStats.dexterityMod} />
            <StatDisplay label="CON" value={stats.constitution} subValue={derivedStats.constitutionMod} />
            <StatDisplay label="INT" value={stats.intelligence} subValue={derivedStats.intelligenceMod} />
            <StatDisplay label="WIS" value={stats.wisdom} subValue={derivedStats.wisdomMod} />
            <StatDisplay label="CHA" value={stats.charisma} subValue={derivedStats.charismaMod} />
          </div>
        </Section>
        <Section title="Combat" icon="swords" className="lg:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <StatDisplay label="Armor Class" value={derivedStats.armorClass} large />
            <StatDisplay label="Hit Points" value={derivedStats.hitPointsMax} subValue={derivedStats.hitDice} large />
            <StatDisplay label="Speed" value={derivedStats.speed} large />
            <StatDisplay label="Initiative" value={derivedStats.initiative} large />
          </div>
          <PillDisplay label="Proficiency Bonus" value={derivedStats.proficiencyBonus} />
        </Section>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <Section title="Saving Throws" icon="health_and_safety">
          <ul className="space-y-1.5">
            {savingThrows.map((st: SavingThrow) => (
              <li key={st.name} className={`flex justify-between p-2.5 rounded-md text-sm ${st.proficient ? 'bg-red-100/70 border border-red-300/50' : 'bg-stone-100/70 border border-stone-300/50'}`}>
                <span className="flex items-center">
                  {st.proficient && <span className="text-red-600 mr-2 text-xs">◆</span>}
                  {st.name}
                </span>
                <span className="font-semibold">{st.value}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Skills" icon="checklist">
          <ul className="space-y-1.5 max-h-[28rem] overflow-y-auto pr-2 custom-scrollbar">
            {skills.map((skill: Skill) => (
              <li key={skill.name} className={`flex justify-between p-2.5 rounded-md text-sm ${skill.proficient ? 'bg-red-100/70 border border-red-300/50' : 'bg-stone-100/70 border border-stone-300/50'}`}>
                <span className="flex items-center">
                  {skill.proficient && <span className="text-red-600 mr-2 text-xs">◆</span>}
                  {skill.name} <span className="text-xs text-stone-500 ml-1">({skill.stat})</span>
                </span>
                <span className="font-semibold">{skill.value}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Capabilities" icon="auto_awesome">
        <div>
          <h3 className="text-xl font-semibold text-red-700 mb-1.5 flex items-center">
            <span className="material-symbols-outlined mr-1.5 text-xl">gavel</span>Attacks & Cantrips
          </h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{attacksAndCantrips || "N/A"}</p>
        </div>
        {(spells && spells.toLowerCase() !== "n/a") && (
          <div className="mt-4">
            <h3 className="text-xl font-semibold text-red-700 mb-1.5 flex items-center">
              <span className="material-symbols-outlined mr-1.5 text-xl">magic_button</span>Spells
            </h3>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{spells}</p>
            {spellcastingInfo && (spellcastingInfo.ability.toLowerCase() !== 'n/a') && (
              <div className="mt-3 flex flex-wrap gap-3">
                <PillDisplay label="Spell Ability" value={spellcastingInfo.ability} />
                <PillDisplay label="Spell Save DC" value={String(spellcastingInfo.saveDC)} />
                <PillDisplay label="Spell Attack" value={spellcastingInfo.attackBonus} />
              </div>
            )}
          </div>
        )}
        <div className="mt-4">
          <h3 className="text-xl font-semibold text-red-700 mb-1.5 flex items-center">
            <span className="material-symbols-outlined mr-1.5 text-xl">star</span>Features & Traits
          </h3>
          <ul className="list-disc list-inside pl-1 space-y-1 text-sm text-stone-700 marker:text-red-700">
            {parseStringList(featuresAndTraits).map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        </div>
      </Section>
      
      <Section title="Equipment" icon="inventory_2">
        <ul className="list-disc list-inside pl-1 space-y-1 text-sm text-stone-700 marker:text-red-700">
            {parseStringList(equipment).map((item, index) => <li key={index}>{item}</li>)}
        </ul>
      </Section>

      <Section title="Backstory" icon="history_edu">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{backstory}</p>
      </Section>
    </div>
  );
};

export default CharacterSheet;