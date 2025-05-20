// src/App.jsx
import React, { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// Material UI Components
import Button from '@mui/material/Button';
import Slider from '@mui/material/Slider';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import Paper from '@mui/material/Paper';
import Link from '@mui/material/Link';

// Icons
import FileUploadIcon from '@mui/icons-material/FileUpload';
import MovieIcon from '@mui/icons-material/Movie';
import GifIcon from '@mui/icons-material/Gif';
import DownloadIcon from '@mui/icons-material/Download';
import SettingsIcon from '@mui/icons-material/Settings';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

// A simple style for our main container
const appStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '20px',
  padding: '20px',
  fontFamily: 'Arial, sans-serif',
};

const controlSectionStyle = {
  padding: '20px',
  width: '100%',
  maxWidth: '600px',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: '15px',
};

const videoPreviewStyle = {
  maxWidth: '100%',
  maxHeight: '400px',
  border: '1px solid #444', // Darker border for video
  borderRadius: '4px',
  backgroundColor: '#000', // Black background for video player
};

const gifPreviewStyle = {
  maxWidth: '100%',
  maxHeight: '300px',
  border: '1px solid #444',
  borderRadius: '4px',
  marginTop: '10px',
};

function App() {
  const [ffmpeg, setFfmpeg] = useState(null);
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const [videoFile, setVideoFile] = useState(null);
  const [videoSrc, setVideoSrc] = useState('');
  const [videoDuration, setVideoDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [gifSettings, setGifSettings] = useState({ fps: 10, width: 320 });
  const [outputGif, setOutputGif] = useState('');
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Upload a video to start.');

  const videoRef = useRef(null);
  const ffmpegInstance = useRef(new FFmpeg());

  // Load FFMPEG
  useEffect(() => {
    const loadFFmpeg = async () => {
      setMessage('Loading FFMPEG (this may take a moment)...');
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'
      // const baseURL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/umd' // For multi-threaded
      
      ffmpegInstance.current.on('log', ({ message }) => {
        // console.log(message); // You can show FFMPEG logs if needed
      });

      ffmpegInstance.current.on('progress', ({ progress, time }) => {
        setProgress(Math.round(progress * 100));
      });
      
      try {
        await ffmpegInstance.current.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
          // workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'), // For multi-threaded
        });
        setFfmpeg(ffmpegInstance.current);
        setFfmpegLoaded(true);
        setMessage('FFMPEG Loaded. Ready to convert!');
      } catch (error) {
        console.error("Error loading FFMPEG:", error);
        setMessage('Failed to load FFMPEG. Please refresh the page or check your browser console.');
      }
    };
    loadFFmpeg();
  }, []);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      setVideoFile(file);
      const url = URL.createObjectURL(file);
      setVideoSrc(url);
      setOutputGif(''); // Clear previous GIF
      setMessage('Video loaded. Adjust settings and convert.');
    }
  };

  const handleVideoLoadedMetadata = () => {
    if (videoRef.current) {
      const duration = videoRef.current.duration;
      setVideoDuration(duration);
      setStartTime(0); // Reset start time
      setEndTime(Math.min(duration, 10)); // Default to 10s or video length
    }
  };

  const handleConvert = async () => {
    if (!ffmpeg || !videoFile || !ffmpegLoaded) {
      setMessage('FFMPEG not loaded or no video file selected.');
      return;
    }

    setIsConverting(true);
    setProgress(0);
    setOutputGif('');
    setMessage('Converting... Please wait.');

    try {
      const inputFileName = 'input.mp4'; // Or derive from videoFile.name
      const outputFileName = 'output.gif';

      await ffmpeg.writeFile(inputFileName, await fetchFile(videoFile));

      const duration = endTime - startTime;
      if (duration <= 0) {
        setMessage('End time must be after start time.');
        setIsConverting(false);
        return;
      }

      // FFMPEG command
      // -i inputFileName: input file
      // -ss startTime: start time in seconds
      // -t duration: duration of the clip in seconds
      // -vf "fps=FPS,scale=WIDTH:-1:flags=lanczos": video filter
      //    fps=FPS: set frames per second
      //    scale=WIDTH:-1: scale width to WIDTH, height is auto-calculated (-1) maintaining aspect ratio.
      //    flags=lanczos: use lanczos scaling algorithm for better quality
      // -loop 0: loop GIF infinitely (0 means infinite, -1 means no loop, 1 means loop once, etc.)
      // outputFileName: output file
      await ffmpeg.exec([
        '-i', inputFileName,
        '-ss', String(startTime),
        '-t', String(duration),
        '-vf', `fps=${gifSettings.fps},scale=${gifSettings.width}:-1:flags=lanczos`,
        '-loop', '0',
        outputFileName
      ]);

      const data = await ffmpeg.readFile(outputFileName);
      const gifUrl = URL.createObjectURL(new Blob([data.buffer], { type: 'image/gif' }));
      setOutputGif(gifUrl);
      setMessage('Conversion successful! GIF is ready below.');

      // Optional: Clean up files from FFMPEG's virtual file system
      // await ffmpeg.deleteFile(inputFileName);
      // await ffmpeg.deleteFile(outputFileName);

    } catch (error) {
      console.error('Conversion error:', error);
      setMessage(`Conversion failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsConverting(false);
      setProgress(0);
    }
  };

  const formatTime = (timeInSeconds) => {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    const milliseconds = Math.floor((timeInSeconds % 1) * 1000);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
  };

  return (
    <Box sx={appStyle}>
      <Paper elevation={3} sx={{ padding: '20px', marginBottom: '20px', width: '100%', maxWidth: '700px' }}>
        <Typography variant="h4" component="h1" gutterBottom sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <GifIcon sx={{ marginRight: '10px', fontSize: '2rem' }} /> Video to GIF Converter
        </Typography>
        <Typography variant="body2" sx={{ marginBottom: '20px', color: 'text.secondary' }}>{message}</Typography>
      </Paper>

      {/* File Upload */}
      <Paper elevation={3} sx={controlSectionStyle}>
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
          <FileUploadIcon sx={{ marginRight: '8px' }} /> Upload Video
        </Typography>
        <Button
          variant="contained"
          component="label" // Makes the button act like a label for the hidden input
        >
          Choose Video File
          <input
            type="file"
            accept="video/*"
            hidden
            onChange={handleFileChange}
          />
        </Button>
        {videoSrc && (
          <video
            ref={videoRef}
            src={videoSrc}
            controls
            style={videoPreviewStyle}
            onLoadedMetadata={handleVideoLoadedMetadata}
            onTimeUpdate={() => {
              // This could be used for more interactive seeking if needed
              // For now, sliders control start/end, video player is for general preview
            }}
          />
        )}
      </Paper>

      {/* Conversion Settings */}
      {videoFile && ffmpegLoaded && (
        <Paper elevation={3} sx={controlSectionStyle}>
          <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
            <SettingsIcon sx={{ marginRight: '8px' }} /> GIF Settings
          </Typography>

          {/* Time Range Slider */}
          <Box>
            <Typography gutterBottom>
              Time Range: {formatTime(startTime)} - {formatTime(endTime)} (Duration: {formatTime(endTime - startTime)})
              <Tooltip title="Select the start and end points of the video segment to convert into a GIF.">
                <HelpOutlineIcon sx={{ fontSize: '1rem', marginLeft: '5px', verticalAlign: 'middle', cursor: 'help' }} />
              </Tooltip>
            </Typography>
            {videoDuration > 0 && (
              <Slider
                value={[startTime, endTime]}
                onChange={(e, newValue) => {
                  setStartTime(newValue[0]);
                  setEndTime(newValue[1]);
                }}
                min={0}
                max={videoDuration}
                step={0.1} // Fine-grained control
                valueLabelFormat={formatTime}
                valueLabelDisplay="auto"
                marks={[
                  { value: 0, label: formatTime(0) },
                  { value: videoDuration, label: formatTime(videoDuration) },
                ]}
                disabled={isConverting}
              />
            )}
          </Box>

          {/* FPS Slider */}
          <Box>
            <Typography gutterBottom>
              FPS (Frames Per Second): {gifSettings.fps}
              <Tooltip title="Higher FPS means smoother animation but larger file size. 10-15 FPS is common for GIFs.">
                <HelpOutlineIcon sx={{ fontSize: '1rem', marginLeft: '5px', verticalAlign: 'middle', cursor: 'help' }} />
              </Tooltip>
            </Typography>
            <Slider
              value={gifSettings.fps}
              onChange={(e, newValue) => setGifSettings(prev => ({ ...prev, fps: newValue }))}
              min={1}
              max={30}
              step={1}
              valueLabelDisplay="auto"
              marks
              disabled={isConverting}
            />
          </Box>

          {/* Width Input */}
          <Box>
            <Typography gutterBottom>
              GIF Width (px):
              <Tooltip title="Height will be adjusted automatically to maintain aspect ratio. Smaller width means smaller file size.">
                <HelpOutlineIcon sx={{ fontSize: '1rem', marginLeft: '5px', verticalAlign: 'middle', cursor: 'help' }} />
              </Tooltip>
            </Typography>
            <TextField
              type="number"
              value={gifSettings.width}
              onChange={(e) => setGifSettings(prev => ({ ...prev, width: parseInt(e.target.value) || 320 }))}
              size="small"
              variant="outlined"
              disabled={isConverting}
              InputProps={{ inputProps: { min: 50, max: 1000 } }}
            />
          </Box>

          <Button
            variant="contained"
            color="primary"
            onClick={handleConvert}
            disabled={isConverting || !ffmpegLoaded || !videoFile}
            startIcon={isConverting ? <CircularProgress size={20} color="inherit" /> : <MovieIcon />}
            sx={{ marginTop: '10px' }}
          >
            {isConverting ? `Converting... ${progress}%` : 'Convert to GIF'}
          </Button>
        </Paper>
      )}

      {/* Output GIF */}
      {outputGif && (
        <Paper elevation={3} sx={controlSectionStyle}>
          <Typography variant="h6" gutterBottom>
            Your GIF!
          </Typography>
          <img src={outputGif} alt="Generated GIF" style={gifPreviewStyle} />
          <Button
            variant="outlined"
            href={outputGif}
            download="converted.gif"
            startIcon={<DownloadIcon />}
            sx={{ marginTop: '10px' }}
          >
            Download GIF
          </Button>
        </Paper>
      )}

      {!ffmpegLoaded && !isConverting && (
        <Box sx={{ display: 'flex', alignItems: 'center', flexDirection: 'column', marginTop: '20px' }}>
          <CircularProgress />
          <Typography variant="body1" sx={{ marginTop: '10px' }}>{message}</Typography>
        </Box>
      )}
    </Box>
  );
}

export default App;