import React, { useState, useRef } from 'react';
import { Upload, Play, Film, Download, Settings, Image, Sliders, Check, X, RefreshCcw } from 'lucide-react';

const VideoToGifConverter = () => {
  // State management
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [isConverting, setIsConverting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [gifUrl, setGifUrl] = useState(null);
  const [previewMode, setPreviewMode] = useState('original');
  const [error, setError] = useState(null);
  
  // Settings state
  const [settings, setSettings] = useState({
    startTime: 0,
    duration: 5,
    fps: 10,
    width: 320,
    height: 240,
    quality: 75,
    loop: true,
    speed: 1,
    filter: 'none',
  });
  
  // References
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  
  // Handle file upload
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('video/')) {
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setGifUrl(null);
      setError(null);
    } else {
      setError('Please select a valid video file');
    }
  };
  
  // Trigger file input click
  const triggerFileInput = () => {
    fileInputRef.current.click();
  };
  
  // Update settings
  const updateSetting = (key, value) => {
    setSettings({
      ...settings,
      [key]: value
    });
  };
  
  // Convert video to GIF
  const convertToGif = () => {
    // In a real implementation, we would use a library like FFmpeg.wasm
    // or send the video to a server for processing
    setIsConverting(true);
    
    // Simulate conversion process
    setTimeout(() => {
      setIsConverting(false);
      // For demo purposes, just show a placeholder image
      setGifUrl('/api/placeholder/320/240');
    }, 2000);
  };
  
  // Download GIF
  const downloadGif = () => {
    // In a real implementation, this would download the actual GIF
    const link = document.createElement('a');
    link.href = gifUrl;
    link.download = 'converted.gif';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  // Reset the application
  const resetApp = () => {
    setVideoFile(null);
    setVideoUrl(null);
    setGifUrl(null);
    setError(null);
    setSettings({
      startTime: 0,
      duration: 5,
      fps: 10,
      width: 320,
      height: 240,
      quality: 75,
      loop: true,
      speed: 1,
      filter: 'none',
    });
  };

  return (
    <div className="flex flex-col bg-gray-100 rounded-lg shadow-lg p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-center mb-6">Video to GIF Converter</h1>
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-700">
            <X size={18} />
          </button>
        </div>
      )}
      
      {!videoUrl ? (
        <div 
          className="border-2 border-dashed border-gray-300 rounded-lg p-12 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition-colors"
          onClick={triggerFileInput}
        >
          <Upload size={48} className="text-blue-500 mb-4" />
          <p className="text-lg font-medium text-gray-700">Click or drag video to upload</p>
          <p className="text-sm text-gray-500 mt-1">Supports MP4, WebM, MOV formats</p>
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="video/*" 
            onChange={handleFileChange} 
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Video Preview */}
          <div className="bg-white p-4 rounded-lg shadow">
            <h2 className="text-lg font-medium mb-3 flex items-center">
              <Film className="mr-2" size={20} />
              Original Video
            </h2>
            <div className="relative aspect-video bg-black rounded overflow-hidden">
              <video 
                ref={videoRef} 
                src={videoUrl} 
                className="w-full h-full" 
                controls
              />
            </div>
            <div className="mt-4 flex justify-between">
              <button 
                className="flex items-center text-sm text-blue-600 hover:text-blue-800"
                onClick={triggerFileInput}
              >
                <RefreshCcw size={16} className="mr-1" />
                Change Video
              </button>
              <button 
                className="flex items-center text-sm text-blue-600 hover:text-blue-800"
                onClick={() => setShowSettings(!showSettings)}
              >
                <Settings size={16} className="mr-1" />
                {showSettings ? 'Hide Settings' : 'Show Settings'}
              </button>
            </div>
          </div>
          
          {/* GIF Preview */}
          <div className="bg-white p-4 rounded-lg shadow">
            <h2 className="text-lg font-medium mb-3 flex items-center">
              <Image className="mr-2" size={20} />
              GIF Preview
            </h2>
            <div className="relative aspect-video bg-black rounded overflow-hidden flex items-center justify-center">
              {gifUrl ? (
                <img src={gifUrl} className="max-w-full max-h-full" alt="Converted GIF" />
              ) : (
                <div className="text-white text-center p-4">
                  <p>GIF preview will appear here after conversion</p>
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-between">
              <button 
                className={`px-4 py-2 rounded-lg text-white flex items-center justify-center ${gifUrl ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                onClick={gifUrl ? downloadGif : convertToGif}
                disabled={isConverting}
              >
                {isConverting ? (
                  <>
                    <div className="animate-spin mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                    Processing...
                  </>
                ) : gifUrl ? (
                  <>
                    <Download size={16} className="mr-2" />
                    Download GIF
                  </>
                ) : (
                  <>
                    <Play size={16} className="mr-2" />
                    Convert to GIF
                  </>
                )}
              </button>
              {gifUrl && (
                <button 
                  className="px-4 py-2 rounded-lg text-gray-600 border border-gray-300 hover:bg-gray-100 flex items-center"
                  onClick={resetApp}
                >
                  <RefreshCcw size={16} className="mr-2" />
                  Start Over
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Settings Panel */}
      {videoUrl && showSettings && (
        <div className="mt-6 bg-white p-4 rounded-lg shadow">
          <h2 className="text-lg font-medium mb-4 flex items-center">
            <Sliders className="mr-2" size={20} />
            GIF Settings
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            {/* Time Range */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Time (seconds)
              </label>
              <input 
                type="range" 
                min="0" 
                max={videoRef.current ? videoRef.current.duration || 30 : 30} 
                step="0.1"
                value={settings.startTime} 
                onChange={(e) => updateSetting('startTime', parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>0s</span>
                <span>{settings.startTime.toFixed(1)}s</span>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Duration (seconds)
              </label>
              <input 
                type="range" 
                min="1" 
                max="10" 
                step="0.5"
                value={settings.duration} 
                onChange={(e) => updateSetting('duration', parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>1s</span>
                <span>{settings.duration.toFixed(1)}s</span>
              </div>
            </div>
            
            {/* Quality Settings */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                FPS (Frames Per Second)
              </label>
              <select 
                value={settings.fps} 
                onChange={(e) => updateSetting('fps', parseInt(e.target.value))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="5">5 FPS (Smaller file)</option>
                <option value="10">10 FPS (Balanced)</option>
                <option value="15">15 FPS (Smoother)</option>
                <option value="24">24 FPS (High quality)</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Quality
              </label>
              <input 
                type="range" 
                min="10" 
                max="100" 
                step="5"
                value={settings.quality} 
                onChange={(e) => updateSetting('quality', parseInt(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>Low</span>
                <span>{settings.quality}%</span>
                <span>High</span>
              </div>
            </div>
            
            {/* Size Settings */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Output Width
              </label>
              <select 
                value={settings.width} 
                onChange={(e) => {
                  const width = parseInt(e.target.value);
                  // Maintain aspect ratio if needed
                  updateSetting('width', width);
                }}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="160">160px (Very small)</option>
                <option value="320">320px (Small)</option>
                <option value="480">480px (Medium)</option>
                <option value="640">640px (Large)</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Output Height
              </label>
              <select 
                value={settings.height} 
                onChange={(e) => updateSetting('height', parseInt(e.target.value))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="120">120px (Very small)</option>
                <option value="240">240px (Small)</option>
                <option value="360">360px (Medium)</option>
                <option value="480">480px (Large)</option>
              </select>
            </div>
            
            {/* Effects */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Speed
              </label>
              <select 
                value={settings.speed} 
                onChange={(e) => updateSetting('speed', parseFloat(e.target.value))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="0.5">0.5x (Slow motion)</option>
                <option value="0.75">0.75x (Slower)</option>
                <option value="1">1x (Normal)</option>
                <option value="1.5">1.5x (Faster)</option>
                <option value="2">2x (Double speed)</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Filter Effect
              </label>
              <select 
                value={settings.filter} 
                onChange={(e) => updateSetting('filter', e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="none">None</option>
                <option value="grayscale">Grayscale</option>
                <option value="sepia">Sepia</option>
                <option value="invert">Invert Colors</option>
                <option value="blur">Blur</option>
              </select>
            </div>
            
            {/* Loop option */}
            <div className="col-span-1 md:col-span-2">
              <label className="flex items-center space-x-2 cursor-pointer">
                <div className={`w-10 h-5 flex items-center rounded-full p-1 ${settings.loop ? 'bg-blue-600' : 'bg-gray-300'}`}>
                  <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${settings.loop ? 'translate-x-5' : 'translate-x-0'}`}></div>
                </div>
                <span className="text-sm font-medium text-gray-700">Loop GIF (repeat animation)</span>
              </label>
            </div>
          </div>
          
          {/* Current settings summary */}
          <div className="mt-4 bg-gray-50 p-3 rounded text-sm text-gray-600">
            <p className="font-medium mb-1">Summary:</p>
            <p>
              Converting {settings.duration}s clip starting at {settings.startTime}s, 
              {settings.width}x{settings.height} resolution at {settings.fps} FPS,
              {settings.quality}% quality, {settings.speed}x speed,
              {settings.filter !== 'none' ? ` with ${settings.filter} filter` : ' no filter'},
              {settings.loop ? ' looping enabled' : ' no loop'}
            </p>
          </div>
        </div>
      )}
      
      {/* Features List */}
      {!videoUrl && (
        <div className="mt-6">
          <h2 className="text-xl font-semibold mb-3">Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex items-start">
              <Check size={18} className="text-green-500 mr-2 mt-0.5 flex-shrink-0" />
              <p>Convert videos to GIF with custom settings</p>
            </div>
            <div className="flex items-start">
              <Check size={18} className="text-green-500 mr-2 mt-0.5 flex-shrink-0" />
              <p>Adjust start time and duration</p>
            </div>
            <div className="flex items-start">
              <Check size={18} className="text-green-500 mr-2 mt-0.5 flex-shrink-0" />
              <p>Control frame rate (FPS) for smoother animations</p>
            </div>
            <div className="flex items-start">
              <Check size={18} className="text-green-500 mr-2 mt-0.5 flex-shrink-0" />
              <p>Resize output dimensions for smaller file sizes</p>
            </div>
            <div className="flex items-start">
              <Check size={18} className="text-green-500 mr-2 mt-0.5 flex-shrink-0" />
              <p>Apply visual filters: grayscale, sepia, invert, blur</p>
            </div>
            <div className="flex items-start">
              <Check size={18} className="text-green-500 mr-2 mt-0.5 flex-shrink-0" />
              <p>Control playback speed: normal, slow-mo, or fast</p>
            </div>
            <div className="flex items-start">
              <Check size={18} className="text-green-500 mr-2 mt-0.5 flex-shrink-0" />
              <p>Toggle loop option for continuous playback</p>
            </div>
            <div className="flex items-start">
              <Check size={18} className="text-green-500 mr-2 mt-0.5 flex-shrink-0" />
              <p>Adjust quality to balance size and appearance</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoToGifConverter;