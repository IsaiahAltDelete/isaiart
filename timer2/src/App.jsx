// src/App.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import './TimerPage.css'; // Import your styles

// Constants from your original script
const NUM_RAINDROPS = 200;
const NUM_FISHES = 10;
const FISH_EMOJIS = ['🐠', '🐟', '🐡', '🦈', '🐳', '🐋', '🦑', '🐙'];
const INITIAL_WATER_COLOR = '#4caf50';

const COLOR_OPTIONS_HEX = [
  '#4caf50', '#2196f3', '#ffc107', '#e91e63', '#9c27b0',
  '#f44336', '#ff9800', '#00bcd4', '#3f51b5',
];

function App() {
  // Canvas refs
  const rainCanvasRef = useRef(null);
  const waterCanvasRef = useRef(null);
  const fishCanvasRef = useRef(null);

  // Animation state refs (to store mutable data not needing re-renders for each change)
  const raindropsRef = useRef([]);
  const splashesRef = useRef([]);
  const fishesRef = useRef([]);
  const animationFrameIdRef = useRef(null);
  const waterHeightRef = useRef(0); // Current animated water height
  const targetWaterHeightRef = useRef(0); // Target water height based on progress

  // React state
  const [countdownString, setCountdownString] = useState('00s');
  const [timeUpMessage, setTimeUpMessage] = useState([]);
  const [isTimeUp, setIsTimeUp] = useState(false);
  const [endDateInput, setEndDateInput] = useState('');
  const [selectedColor, setSelectedColor] = useState(INITIAL_WATER_COLOR);

  // Refs for timer interval and state
  const countdownIntervalRef = useRef(null);
  const timerStateRef = useRef({
    startTime: 0,
    totalTime: 0,
  });

  // Helper to format time (from your original script, adapted)
  const formatTime = (time) => {
    if (time < 0) time = 0;
    const days = Math.floor(time / (1000 * 60 * 60 * 24));
    const hours = Math.floor((time % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((time % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((time % (1000 * 60)) / 1000);

    let html = '';
    if (days > 0) html += `<span class="time-num">${days}</span><span class="time-unit">d </span>`;
    if (hours > 0 || days > 0) html += `<span class="time-num">${hours}</span><span class="time-unit">h </span>`;
    if (minutes > 0 || hours > 0 || days > 0) html += `<span class="time-num">${minutes}</span><span class="time-unit">m </span>`;
    html += `<span class="time-num">${seconds}</span><span class="time-unit">s</span>`;
    return html;
  };

  const updateCountdownDisplay = useCallback((time) => {
    setCountdownString(formatTime(time));
  }, []);

  const displayTimeUp = useCallback(() => {
    setIsTimeUp(true);
    const messageChars = "Time's Up!".split('');
    setTimeUpMessage(
      messageChars.map((char, index) => ({ char, delay: index }))
    );
  }, []);

  const hideTimeUp = useCallback(() => {
    setIsTimeUp(false);
    setTimeUpMessage([]);
  }, []);

  // Canvas and Animation Logic (memoized with useCallback where appropriate)
  const setCanvasSize = useCallback(() => {
    const canvases = [rainCanvasRef.current, waterCanvasRef.current, fishCanvasRef.current];
    canvases.forEach(canvas => {
      if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
    });
  }, []);

  const createRaindrop = useCallback(() => ({
    x: Math.random() * (rainCanvasRef.current?.width || 0),
    y: Math.random() * (rainCanvasRef.current?.height || 0),
    speed: Math.random() * 5 + 2,
    length: Math.random() * 20 + 10,
  }), []);

  const createFish = useCallback(() => ({
    x: Math.random() * (fishCanvasRef.current?.width || 0),
    y: (fishCanvasRef.current?.height || 0) - Math.random() * waterHeightRef.current,
    speed: Math.random() * 0.5 + 0.5,
    size: Math.random() * 20 + 50,
    direction: Math.random() < 0.5 ? -1 : 1,
    emoji: FISH_EMOJIS[Math.floor(Math.random() * FISH_EMOJIS.length)],
    angle: 0,
  }), []);

  const createSplash = useCallback((x, y) => ({
    x, y,
    radius: Math.random() * 3 + 1,
    opacity: 1,
  }), []);

  // Initialize raindrops and fishes
  useEffect(() => {
    setCanvasSize(); // Initial size
    raindropsRef.current = Array.from({ length: NUM_RAINDROPS }, createRaindrop);
    fishesRef.current = Array.from({ length: NUM_FISHES }, createFish);

    window.addEventListener('resize', setCanvasSize);
    return () => window.removeEventListener('resize', setCanvasSize);
  }, [setCanvasSize, createRaindrop, createFish]);


  // Main animation loop
  useEffect(() => {
    const rainCtx = rainCanvasRef.current?.getContext('2d');
    const waterCtx = waterCanvasRef.current?.getContext('2d');
    const fishCtx = fishCanvasRef.current?.getContext('2d');

    if (!rainCtx || !waterCtx || !fishCtx) return;

    const animate = () => {
      // Move logic
      raindropsRef.current.forEach(raindrop => {
        raindrop.y += raindrop.speed;
        if (raindrop.y > rainCanvasRef.current.height - waterHeightRef.current) {
          raindrop.y = 0;
          raindrop.x = Math.random() * rainCanvasRef.current.width;
          splashesRef.current.push(createSplash(raindrop.x, rainCanvasRef.current.height - waterHeightRef.current));
        }
      });

      for (let i = splashesRef.current.length - 1; i >= 0; i--) {
        splashesRef.current[i].opacity -= 0.02; // splashDecay
        if (splashesRef.current[i].opacity <= 0) {
          splashesRef.current.splice(i, 1);
        }
      }

      fishesRef.current.forEach(fish => {
        fish.x += fish.speed * fish.direction;
        if (fish.x > fishCanvasRef.current.width + fish.size) fish.x = -fish.size;
        else if (fish.x < -fish.size) fish.x = fishCanvasRef.current.width + fish.size;

        const waterLevel = fishCanvasRef.current.height - waterHeightRef.current;
        const bobbing = Math.sin(Date.now() * 0.005 + fish.x * 0.02) * 5;
        fish.y = waterLevel + bobbing; // Ensure fish stay above or at water surface
        if (fish.y > fishCanvasRef.current.height - fish.size / 2) { // Don't let fish go below canvas bottom
            fish.y = fishCanvasRef.current.height - fish.size / 2;
        }
        if (waterHeightRef.current > 0 && fish.y < fishCanvasRef.current.height - waterHeightRef.current) { // Keep fish in water
             fish.y = fishCanvasRef.current.height - waterHeightRef.current + bobbing;
        }


        fish.angle = Math.sin(Date.now() * 0.002 + fish.x * 0.01) * 0.2;
        if (Math.random() < 0.005) fish.direction *= -1;
      });

      // Draw logic
      rainCtx.clearRect(0, 0, rainCanvasRef.current.width, rainCanvasRef.current.height);
      rainCtx.strokeStyle = selectedColor;
      rainCtx.lineWidth = 1;
      rainCtx.lineCap = 'round';
      raindropsRef.current.forEach(raindrop => {
        rainCtx.beginPath();
        rainCtx.moveTo(raindrop.x, raindrop.y);
        rainCtx.lineTo(raindrop.x, raindrop.y - raindrop.length);
        rainCtx.stroke();
      });
      splashesRef.current.forEach(splash => {
        rainCtx.beginPath();
        rainCtx.arc(splash.x, splash.y, splash.radius, 0, Math.PI * 2);
        rainCtx.fillStyle = `rgba(255, 255, 255, ${splash.opacity})`;
        rainCtx.fill();
      });

      waterHeightRef.current += (targetWaterHeightRef.current - waterHeightRef.current) * 0.1;
      waterCtx.clearRect(0, 0, waterCanvasRef.current.width, waterCanvasRef.current.height);
      const gradient = waterCtx.createLinearGradient(0, waterCanvasRef.current.height - waterHeightRef.current, 0, waterCanvasRef.current.height);
      gradient.addColorStop(0, selectedColor);
      gradient.addColorStop(1, '#1e88e5'); // Darker blue at bottom
      waterCtx.fillStyle = gradient;
      waterCtx.beginPath();
      waterCtx.moveTo(0, waterCanvasRef.current.height);
      for (let i = 0; i <= waterCanvasRef.current.width; i++) {
        waterCtx.lineTo(i, waterCanvasRef.current.height - waterHeightRef.current + Math.sin(i * 0.05 + Date.now() * 0.005) * 5);
      }
      waterCtx.lineTo(waterCanvasRef.current.width, waterCanvasRef.current.height);
      waterCtx.closePath();
      waterCtx.fill();

      fishCtx.clearRect(0, 0, fishCanvasRef.current.width, fishCanvasRef.current.height);
      fishCtx.textAlign = 'center';
      fishCtx.textBaseline = 'middle';
      fishesRef.current.forEach(fish => {
        if (fish.y > fishCanvasRef.current.height - waterHeightRef.current + fish.size/2) { // Only draw if in water
            fishCtx.save();
            fishCtx.translate(fish.x, fish.y);
            fishCtx.rotate(fish.angle);
            fishCtx.scale((fish.direction * fish.size) / 30, fish.size / 30);
            fishCtx.fillText(fish.emoji, 0, 0);
            fishCtx.restore();
        }
      });

      animationFrameIdRef.current = requestAnimationFrame(animate);
    };

    animationFrameIdRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [selectedColor, createSplash]); // Re-run if selectedColor changes, or createSplash changes (it won't due to useCallback)

  // Timer Logic
  const startCountdown = useCallback(() => {
    clearInterval(countdownIntervalRef.current);
    hideTimeUp();

    const endDate = new Date(endDateInput).getTime();
    if (isNaN(endDate)) {
      alert("Please select a valid date and time.");
      return;
    }

    timerStateRef.current.startTime = Date.now();
    timerStateRef.current.totalTime = endDate - timerStateRef.current.startTime;
    
    if (timerStateRef.current.totalTime <=0) {
        alert("Please select a future date and time.");
        updateCountdownDisplay(0);
        targetWaterHeightRef.current = 0; // Reset water
        return;
    }

    waterHeightRef.current = 0; // Reset water level visually
    targetWaterHeightRef.current = 0;

    updateCountdownDisplay(timerStateRef.current.totalTime);

    countdownIntervalRef.current = setInterval(() => {
      const now = Date.now();
      const remainingTime = endDate - now;

      if (remainingTime <= 0) {
        clearInterval(countdownIntervalRef.current);
        updateCountdownDisplay(0);
        displayTimeUp();
        targetWaterHeightRef.current = rainCanvasRef.current?.height || 0; // Fill water on time up
      } else {
        updateCountdownDisplay(remainingTime);
        const progress = (timerStateRef.current.totalTime - remainingTime) / timerStateRef.current.totalTime;
        targetWaterHeightRef.current = (rainCanvasRef.current?.height || 0) * Math.min(progress, 1);
      }
    }, 1000);
  }, [endDateInput, updateCountdownDisplay, displayTimeUp, hideTimeUp]);

  // Set default end time on mount
  useEffect(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset() + 5); // Default to 5 mins from now
    const localISOTime = now.toISOString().slice(0, 16);
    setEndDateInput(localISOTime);
    updateCountdownDisplay(5 * 60 * 1000); // Initialize display for 5 mins
  }, [updateCountdownDisplay]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => clearInterval(countdownIntervalRef.current);
  }, []);


  return (
    <div className="container">
      <canvas id="rainCanvas" ref={rainCanvasRef}></canvas>
      <canvas id="waterCanvas" ref={waterCanvasRef}></canvas>
      <canvas id="fishCanvas" ref={fishCanvasRef}></canvas>

      {!isTimeUp && (
        <div
          id="countdown"
          className="luckiest-guy-regular"
          dangerouslySetInnerHTML={{ __html: countdownString }}
        ></div>
      )}

      {isTimeUp && (
        <div id="time-up" className="luckiest-guy-regular">
          {timeUpMessage.map((item, index) => (
            <span
              key={index}
              className="bounce"
              style={{ '--delay': `${item.delay}` }}
            >
              {item.char}
            </span>
          ))}
        </div>
      )}

      <div className="controls-trigger"></div>
      <div className="controls">
        <input
          type="datetime-local"
          id="endDate"
          value={endDateInput}
          onChange={(e) => setEndDateInput(e.target.value)}
        />
        <button onClick={startCountdown}>Start Countdown</button>
        <div className="color-options">
          {COLOR_OPTIONS_HEX.map(colorHex => (
            <div
              key={colorHex}
              className={`color-option ${selectedColor === colorHex ? 'selected' : ''}`}
              style={{ backgroundColor: colorHex }}
              onClick={() => setSelectedColor(colorHex)}
            ></div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;