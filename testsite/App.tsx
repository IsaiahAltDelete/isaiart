
import React, { useState, useCallback, useEffect } from 'react';
import { CharacterData } from './types';
import { generateCharacterDetails, GenerationParams } from './services/geminiService';
import CharacterSheet from './components/CharacterSheet';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorDisplay from './components/ErrorDisplay';

const DND_RACES = ["Any", "Human", "Elf (High)", "Elf (Wood)", "Elf (Drow)", "Dwarf (Mountain)", "Dwarf (Hill)", "Halfling (Lightfoot)", "Halfling (Stout)", "Dragonborn", "Gnome (Forest)", "Gnome (Rock)", "Half-Elf", "Half-Orc", "Tiefling", "Aasimar", "Genasi (Air)", "Genasi (Earth)", "Genasi (Fire)", "Genasi (Water)", "Goliath", "Tabaxi", "Kenku", "Tortle", "Firbolg", "Yuan-ti Pureblood", "Warforged", "Shifter"];
const DND_CLASSES = ["Any", "Artificer", "Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk", "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard", "Blood Hunter"];
const DND_GENDERS = ["Any", "Male", "Female", "Non-binary"];

const loadingMessages = [
  "Consulting the ancient scrolls...",
  "Rolling the dice of fate...",
  "Brewing a potion of potent character...",
  "Summoning spirits from the ethereal plane...",
  "Sharpening the quills of destiny...",
  "Gathering whispers from the Weave...",
  "Polishing the +1 Sword of Generation...",
  "Awakening forgotten legends...",
  "Decoding runic prophecies...",
  "Asking the local tavern for a hero..."
];

const App: React.FC = () => {
  const [character, setCharacter] = useState<CharacterData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [currentLoadingMessage, setCurrentLoadingMessage] = useState(loadingMessages[0]);

  const [selectedRace, setSelectedRace] = useState<string>("Any");
  const [selectedClass, setSelectedClass] = useState<string>("Any");
  const [selectedGender, setSelectedGender] = useState<string>("Any");
  const [desiredAge, setDesiredAge] = useState<string>("Any"); // Can be "Any", a number, or "Young Adult" etc.
  const [selectedLevel, setSelectedLevel] = useState<number>(1);

  useEffect(() => {
    let intervalId: number | undefined;
    if (isLoading) {
      setCurrentLoadingMessage(loadingMessages[Math.floor(Math.random() * loadingMessages.length)]);
      intervalId = setInterval(() => {
        setCurrentLoadingMessage(prevMessage => {
          let newMessage = prevMessage;
          while (newMessage === prevMessage) {
            newMessage = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
          }
          return newMessage;
        });
      }, 2500); 
    } else if (intervalId) {
      clearInterval(intervalId);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isLoading]);

  const handleGenerateCharacter = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setCharacter(null);
    try {
      const params: GenerationParams = {
        race: selectedRace,
        characterClass: selectedClass,
        gender: selectedGender,
        age: desiredAge,
        level: selectedLevel,
      };
      const newCharacter = await generateCharacterDetails(params);
      setCharacter(newCharacter);
    } catch (err) {
      console.error("Error generating character:", err);
      setError(err instanceof Error ? err.message : "An unknown error occurred. Check console for details, ensure API key is set.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedRace, selectedClass, selectedGender, desiredAge, selectedLevel]);

  const ParameterInput: React.FC<{label: string; children: React.ReactNode; icon?: string}> = ({label, children, icon}) => (
    <div className="mb-3">
      <label className="block text-sm font-medium text-stone-700 mb-1 flex items-center">
        {icon && <span className="material-symbols-outlined mr-2 text-red-700/80 text-base">{icon}</span>}
        {label}:
      </label>
      {children}
    </div>
  );

  const commonSelectStyle = "w-full p-2.5 bg-[#FDFBF5] border border-stone-400/80 rounded-md shadow-sm focus:ring-red-600 focus:border-red-600 text-stone-800 text-sm";
  const commonInputStyle = `${commonSelectStyle} placeholder-stone-500`;


  return (
    <div className="min-h-screen bg-[#F5EFE6] text-stone-800 p-4 sm:p-8 flex flex-col items-center selection:bg-red-800 selection:text-orange-50" style={{ fontFamily: "'Merriweather', serif" }}>
      <header className="w-full max-w-4xl mb-6 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold text-red-800 tracking-tight drop-shadow-sm" style={{ fontFamily: "'Merriweather', serif" }}>D&D 5e Character Forge</h1>
      </header>

      <div className="w-full max-w-xl mb-8 p-6 bg-[#FAF0E6]/80 backdrop-blur-sm rounded-lg shadow-lg border border-stone-400/60">
        <h2 className="text-2xl font-semibold text-red-700 mb-4 border-b-2 border-red-700/50 pb-2 flex items-center">
          <span className="material-symbols-outlined mr-2 text-3xl">tune</span>
          Character Parameters
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          <ParameterInput label="Race" icon="group">
            <select value={selectedRace} onChange={(e) => setSelectedRace(e.target.value)} className={commonSelectStyle}>
              {DND_RACES.map(race => <option key={race} value={race}>{race}</option>)}
            </select>
          </ParameterInput>
          <ParameterInput label="Class" icon="shield_person">
            <select value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)} className={commonSelectStyle}>
              {DND_CLASSES.map(cls => <option key={cls} value={cls}>{cls}</option>)}
            </select>
          </ParameterInput>
          <ParameterInput label="Gender" icon="wc">
            <select value={selectedGender} onChange={(e) => setSelectedGender(e.target.value)} className={commonSelectStyle}>
              {DND_GENDERS.map(gender => <option key={gender} value={gender}>{gender}</option>)}
            </select>
          </ParameterInput>
          <ParameterInput label="Desired Age / Description" icon="cake">
            <input type="text" value={desiredAge} onChange={(e) => setDesiredAge(e.target.value)} placeholder="e.g., 25, Young Adult, Any" className={commonInputStyle} />
          </ParameterInput>
          <ParameterInput label="Starting Level (1-20)" icon="trending_up">
            <input 
              type="number" 
              value={selectedLevel} 
              onChange={(e) => setSelectedLevel(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))} 
              min="1" 
              max="20" 
              className={commonInputStyle}
            />
          </ParameterInput>
        </div>
      </div>

      <div className="w-full max-w-md mb-8">
        <button
          onClick={handleGenerateCharacter}
          disabled={isLoading}
          className="w-full bg-red-700 hover:bg-red-800 text-orange-50 font-semibold py-3 px-6 rounded-md shadow-lg border border-red-900 hover:border-red-900 transition-all duration-150 ease-in-out disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center text-lg transform hover:scale-105 active:scale-95 disabled:transform-none"
        >
          {isLoading ? (
            <>
              <LoadingSpinner />
              <span className="ml-2">{currentLoadingMessage}</span>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined mr-2">casino</span>
              Summon a New Hero
            </>
          )}
        </button>
      </div>

      {error && <ErrorDisplay message={error} />}
      
      {/* Placeholder section removed */}

      {character && !isLoading && !error && (
        <div className="w-full max-w-4xl mt-2">
          <CharacterSheet character={character} />
        </div>
      )}
    </div>
  );
};

export default App;