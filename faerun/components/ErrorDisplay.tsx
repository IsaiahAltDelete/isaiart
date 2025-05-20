
import React from 'react';

interface ErrorDisplayProps {
  message: string;
}

const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ message }) => {
  return (
    <div 
      className="bg-red-100/70 border-l-4 border-red-700 text-red-800 px-4 py-3 rounded-md shadow-md relative max-w-xl w-full mx-auto my-4" 
      role="alert"
      style={{ fontFamily: "'Merriweather', serif" }}
    >
      <strong className="font-bold flex items-center">
        <span className="material-symbols-outlined mr-2 text-lg">error</span>
        An Error Has Occurred:
      </strong>
      <span className="block sm:inline ml-1 mt-1 sm:mt-0 sm:ml-2">{message}</span>
    </div>
  );
};

export default ErrorDisplay;