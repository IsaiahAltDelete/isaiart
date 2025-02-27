// script.js
document.addEventListener('DOMContentLoaded', () => {
    const gridWidthInput = document.getElementById('grid-width');
    const gridHeightInput = document.getElementById('grid-height');
    const createGridButton = document.getElementById('create-grid');
    const colorPicker = document.getElementById('color-picker');
    const colorPreview = document.querySelector('.color-preview');
    const saveColorButton = document.getElementById('save-color');
    const savedColorsContainer = document.querySelector('.saved-colors');
    const brushSizeButtons = document.querySelectorAll('.brush-size button');
    const saveLocalButton = document.getElementById('save-local');
    const loadLocalButton = document.getElementById('load-local');
    const exportPngButton = document.getElementById('export-png');
    const canvas = document.getElementById('pixel-canvas');
    const ctx = canvas.getContext('2d');

    let currentBrushSize = 1;
    let savedColors = [];
    const maxSavedColors = 10;

    // Initial color preview
    colorPreview.style.backgroundColor = colorPicker.value;

    // --- Event Listeners ---

    createGridButton.addEventListener('click', createGrid);

    colorPicker.addEventListener('input', () => {
        colorPreview.style.backgroundColor = colorPicker.value;
    });

    saveColorButton.addEventListener('click', saveColor);

    brushSizeButtons.forEach(button => {
        button.addEventListener('click', () => {
            currentBrushSize = parseInt(button.dataset.size);
            // Remove 'active' class from all brush size buttons
            brushSizeButtons.forEach(btn => btn.classList.remove('active'));
            // Add 'active' class to the clicked button
            button.classList.add('active');
        });
    });
      // Initially select the first brush size button
      if (brushSizeButtons.length > 0) {
        brushSizeButtons[0].classList.add('active');
    }

    saveLocalButton.addEventListener('click', saveToLocalStorage);
    loadLocalButton.addEventListener('click', loadFromLocalStorage);
    exportPngButton.addEventListener('click', exportToPNG);
    canvas.addEventListener('mousedown', handleDrawStart);


    // --- Functions ---

    function createGrid() {
        const width = parseInt(gridWidthInput.value);
        const height = parseInt(gridHeightInput.value);

        if (isNaN(width) || isNaN(height) || width < 1 || height < 1) {
            alert('Please enter valid width and height values.');
            return;
        }

        canvas.width = width;
        canvas.height = height;
        canvas.style.width = `${width * 10}px`; // *10 for visual size
        canvas.style.height = `${height * 10}px`;
        ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear previous grid
    }

    function saveColor() {
        const color = colorPicker.value;
        if (!savedColors.includes(color) && savedColors.length < maxSavedColors) {
            savedColors.push(color);
            const colorSwatch = document.createElement('div');
            colorSwatch.classList.add('saved-color');
            colorSwatch.style.backgroundColor = color;
            colorSwatch.addEventListener('click', () => {
                colorPicker.value = color;
                colorPreview.style.backgroundColor = color;
            });
            savedColorsContainer.appendChild(colorSwatch);
        }
    }

    let isDrawing = false;

    function handleDrawStart(event) {
        isDrawing = true;
        draw(event); // Draw immediately on mousedown
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', handleDrawEnd);
        canvas.addEventListener('mouseleave', handleDrawEnd); // Stop drawing if mouse leaves canvas
    }

    function draw(event) {
        if (!isDrawing) return;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = Math.floor((event.clientX - rect.left) * scaleX);
        const y = Math.floor((event.clientY - rect.top) * scaleY);
        const brushSize = currentBrushSize;
        const color = colorPicker.value;

        ctx.fillStyle = color;
        // Adjust drawing position for brush size
        for (let i = 0; i < brushSize; i++) {
            for (let j = 0; j < brushSize; j++) {
                ctx.fillRect(x + i, y + j, 1, 1);
            }
        }
    }

    function handleDrawEnd() {
        isDrawing = false;
        canvas.removeEventListener('mousemove', draw);
        canvas.removeEventListener('mouseup', handleDrawEnd);
        canvas.removeEventListener('mouseleave', handleDrawEnd);
    }

    function saveToLocalStorage() {
        const data = {
            gridSize: {
                width: canvas.width,
                height: canvas.height
            },
            brushSize: currentBrushSize,
            savedColors: savedColors,
            pixelData: getPixelData() // Get pixel data from the canvas
        };
        localStorage.setItem('pixelArtData', JSON.stringify(data));
    }

    function getPixelData() {
        const pixelData = [];
        for (let y = 0; y < canvas.height; y++) {
            const row = [];
            for (let x = 0; x < canvas.width; x++) {
                const imageData = ctx.getImageData(x, y, 1, 1).data;
                const color = `rgba(${imageData[0]}, ${imageData[1]}, ${imageData[2]}, ${imageData[3] / 255})`;
                row.push(color);
            }
            pixelData.push(row);
        }
        return pixelData;
    }

    function loadFromLocalStorage() {
        const dataString = localStorage.getItem('pixelArtData');
        if (dataString) {
            const data = JSON.parse(dataString);

            // Restore grid size
            canvas.width = data.gridSize.width;
            canvas.height = data.gridSize.height;
            canvas.style.width = `${data.gridSize.width * 10}px`;
            canvas.style.height = `${data.gridSize.height * 10}px`;
            gridWidthInput.value = data.gridSize.width;
            gridHeightInput.value = data.gridSize.height;

            // Restore brush size
            currentBrushSize = data.brushSize;
            brushSizeButtons.forEach(button => {
                if (parseInt(button.dataset.size) === currentBrushSize) {
                    button.classList.add('active');
                } else {
                    button.classList.remove('active');
                }
            });

            // Restore saved colors
            savedColors = data.savedColors;
            savedColorsContainer.innerHTML = ''; // Clear existing swatches
            savedColors.forEach(color => {
                const colorSwatch = document.createElement('div');
                colorSwatch.classList.add('saved-color');
                colorSwatch.style.backgroundColor = color;
                colorSwatch.addEventListener('click', () => {
                    colorPicker.value = color;
                    colorPreview.style.backgroundColor = color;
                });
                savedColorsContainer.appendChild(colorSwatch);
            });

            // Restore pixel data
            setPixelData(data.pixelData);
        }
    }

    function setPixelData(pixelData) {
        for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
                ctx.fillStyle = pixelData[y][x];
                ctx.fillRect(x, y, 1, 1);
            }
        }
    }

    function exportToPNG() {
        const scale = 10; // Upscale by a factor of 10
        const scaledCanvas = document.createElement('canvas');
        scaledCanvas.width = canvas.width * scale;
        scaledCanvas.height = canvas.height * scale;
        const scaledCtx = scaledCanvas.getContext('2d');

        // Draw the original canvas onto the scaled canvas
        for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
                const imageData = ctx.getImageData(x, y, 1, 1).data;
                const color = `rgba(${imageData[0]}, ${imageData[1]}, ${imageData[2]}, ${imageData[3] / 255})`;
                scaledCtx.fillStyle = color;
                scaledCtx.fillRect(x * scale, y * scale, scale, scale);
            }
        }

        // Create a download link
        const link = document.createElement('a');
        link.href = scaledCanvas.toDataURL('image/png');
        link.download = 'pixel-art.png';
        link.click();
    }

     // Load from local storage on page load
     loadFromLocalStorage();
});