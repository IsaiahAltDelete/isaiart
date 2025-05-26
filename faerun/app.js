
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

let isLoading = false;
let loadingIntervalId;
let currentLoadingMessage = loadingMessages[0];

document.addEventListener('DOMContentLoaded', () => {
  const raceSelect = document.getElementById('raceSelect');
  const classSelect = document.getElementById('classSelect');
  const genderSelect = document.getElementById('genderSelect');
  const ageInput = document.getElementById('ageInput');
  const levelInput = document.getElementById('levelInput');
  const generateButton = document.getElementById('generateButton');
  const buttonText = document.getElementById('buttonText');
  const buttonIcon = document.getElementById('buttonIcon');
  const loadingSpinnerElement = document.getElementById('loadingSpinnerElement');
  const errorDisplay = document.getElementById('errorDisplay');
  const errorMessageElement = document.getElementById('errorMessage');
  const characterResultArea = document.getElementById('characterResultArea');
  const characterMessageElement = document.getElementById('characterMessage');

  function populateSelect(selectElement, options) {
    if (!selectElement) return;
    options.forEach(optionValue => {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = optionValue;
      selectElement.appendChild(option);
    });
  }

  populateSelect(raceSelect, DND_RACES);
  populateSelect(classSelect, DND_CLASSES);
  populateSelect(genderSelect, DND_GENDERS);

  if (levelInput) {
    levelInput.addEventListener('change', () => {
      let value = parseInt(levelInput.value, 10) || 1;
      value = Math.max(1, Math.min(20, value));
      levelInput.value = value;
    });
  }

  function showError(message) {
    if (errorMessageElement && errorDisplay) {
      errorMessageElement.textContent = message;
      errorDisplay.style.display = 'block';
    }
  }

  function clearError() {
    if (errorDisplay) {
      errorDisplay.style.display = 'none';
      errorMessageElement.textContent = '';
    }
  }
  
  function startLoadingAnimation() {
    if (buttonText && loadingSpinnerElement && buttonIcon) {
      buttonIcon.style.display = 'none';
      loadingSpinnerElement.style.display = 'inline-block';
      currentLoadingMessage = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
      buttonText.textContent = currentLoadingMessage;

      loadingIntervalId = setInterval(() => {
        let newMessage = currentLoadingMessage;
        while (newMessage === currentLoadingMessage) {
          newMessage = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
        }
        currentLoadingMessage = newMessage;
        buttonText.textContent = currentLoadingMessage;
      }, 2500);
    }
  }

  function stopLoadingAnimation() {
    if (loadingIntervalId) {
      clearInterval(loadingIntervalId);
      loadingIntervalId = null;
    }
    if (buttonText && loadingSpinnerElement && buttonIcon) {
      buttonIcon.style.display = 'inline-block';
      loadingSpinnerElement.style.display = 'none';
      buttonText.textContent = 'Summon a New Hero';
    }
  }

  if (generateButton) {
    generateButton.addEventListener('click', async () => {
      if (isLoading) return;

      isLoading = true;
      generateButton.disabled = true;
      clearError();
      if(characterResultArea) characterResultArea.style.display = 'none';
      startLoadingAnimation();

      // Simulate API call / processing time
      setTimeout(() => {
        try {
          const selectedRace = raceSelect ? raceSelect.value : "Any";
          const selectedClass = classSelect ? classSelect.value : "Any";
          const selectedGender = genderSelect ? genderSelect.value : "Any";
          const desiredAge = ageInput ? ageInput.value : "Any";
          const selectedLevel = levelInput ? levelInput.value : "1";

          if (characterMessageElement && characterResultArea) {
            characterMessageElement.textContent = 
              `Parameters submitted:
              Race: ${selectedRace}, Class: ${selectedClass}, Gender: ${selectedGender}, Age: ${desiredAge}, Level: ${selectedLevel}. 
              Character generation via API is not active in this version. This is a UI demonstration.`;
            characterResultArea.style.display = 'block';
          }
          
        } catch (err) {
          console.error("Error processing parameters:", err);
          showError(err.message || "An unexpected error occurred.");
        } finally {
          isLoading = false;
          generateButton.disabled = false;
          stopLoadingAnimation();
        }
      }, 2000); // Simulate 2 seconds of loading
    });
  }
});
