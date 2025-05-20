// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css' // We'll use this for global styles

import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

// Create a simple dark theme
const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#90caf9', // A light blue for primary elements
    },
    background: {
      default: '#121212', // Main background
      paper: '#1e1e1e',   // Background for elements like cards, menus
    },
    text: {
      primary: '#ffffff',
      secondary: '#b0b0b0',
    }
  },
  components: {
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#333333',
          color: '#ffffff',
          border: '1px solid #555555',
          fontSize: '0.875rem',
        },
        arrow: {
          color: '#333333',
        }
      }
    },
    MuiSlider: {
      styleOverrides: {
        root: {
          color: '#90caf9', // Slider color
        },
        thumb: {
          '&:hover, &.Mui-focusVisible': {
            boxShadow: '0px 0px 0px 8px rgba(144, 202, 249, 0.16)', // Brighter glow on hover/focus
          },
          '&.Mui-active': {
            boxShadow: '0px 0px 0px 14px rgba(144, 202, 249, 0.16)',
          },
        },
      }
    }
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider theme={darkTheme}>
      <CssBaseline /> {/* Helps normalize styling and applies background color */}
      <App />
    </ThemeProvider>
  </React.StrictMode>,
)