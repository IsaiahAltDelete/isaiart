// worker.js

self.onmessage = function(e) {
    let { imageData, grainIntensity, paintingIntensity, blurIntensity, sharpnessIntensity, smoothingIntensity } = e.data;
    let data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    // Apply effects sequentially
    if (blurIntensity > 0) {
        imageData = applyBlur(imageData, blurIntensity, width, height);
    }
    if (paintingIntensity > 0) {
        imageData = applyPaintingEffect(imageData, width, height, paintingIntensity);
    }
    if (smoothingIntensity > 0) {
        imageData = applySmoothing(imageData, width, height, smoothingIntensity);
    }
    if (sharpnessIntensity > 0) {
        imageData = applySharpness(imageData, width, height, sharpnessIntensity);
    }
    if (grainIntensity > 0) {
        imageData = addGrain(imageData, grainIntensity);
    }

    // Return processed image data
    self.postMessage({ imageData });
};

// Clamp function to restrict values between 0 and 255
function clamp(value) {
    return Math.max(0, Math.min(255, value));
}

// Add Grain Effect
function addGrain(imageData, intensity) {
    const data = imageData.data;
    const grainAmount = intensity;

    for(let i = 0; i < data.length; i += 4) {
        const rand = (Math.random() * 2 - 1) * (grainAmount / 2);
        data[i] = clamp(data[i] + rand);
        data[i+1] = clamp(data[i+1] + rand);
        data[i+2] = clamp(data[i+2] + rand);
    }
    return imageData;
}

// Apply Blur Effect using a Box Blur Algorithm
function applyBlur(imageData, intensity, width, height) {
    const data = imageData.data;
    const radius = Math.ceil(intensity / 5); // Adjusted radius for performance
    const tempData = new Uint8ClampedArray(data);

    for (let y = radius; y < height - radius; y++) {
        for (let x = radius; x < width - radius; x++) {
            let r = 0, g = 0, b = 0, a = 0, count = 0;
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const px = (y + dy) * width + (x + dx);
                    r += tempData[px * 4];
                    g += tempData[px * 4 + 1];
                    b += tempData[px * 4 + 2];
                    a += tempData[px * 4 + 3];
                    count++;
                }
            }
            const idx = (y * width + x) * 4;
            data[idx] = Math.round(r / count);
            data[idx + 1] = Math.round(g / count);
            data[idx + 2] = Math.round(b / count);
            data[idx + 3] = Math.round(a / count);
        }
    }

    return imageData;
}

// Apply Painting Effect (Simplified)
function applyPaintingEffect(imageData, width, height, intensity) {
    const data = imageData.data;
    const radius = Math.ceil(intensity / 10);
    const tempData = new Uint8ClampedArray(data);

    for (let y = radius; y < height - radius; y++) {
        for (let x = radius; x < width - radius; x++) {
            let r = 0, g = 0, b = 0, count = 0;
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const px = (y + dy) * width + (x + dx);
                    r += tempData[px * 4];
                    g += tempData[px * 4 + 1];
                    b += tempData[px * 4 + 2];
                    count++;
                }
            }
            const idx = (y * width + x) * 4;
            data[idx] = Math.round(r / count);
            data[idx + 1] = Math.round(g / count);
            data[idx + 2] = Math.round(b / count);
        }
    }

    return imageData;
}

// Apply Smoothing Effect
function applySmoothing(imageData, width, height, intensity) {
    const data = imageData.data;
    const factor = intensity / 100;
    const tempData = new Uint8ClampedArray(data);

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = (y * width + x) * 4;
            for (let rgb = 0; rgb < 3; rgb++) {
                const neighbors = [
                    tempData[((y - 1) * width + x) * 4 + rgb], // top
                    tempData[((y + 1) * width + x) * 4 + rgb], // bottom
                    tempData[(y * width + (x - 1)) * 4 + rgb], // left
                    tempData[(y * width + (x + 1)) * 4 + rgb]  // right
                ];
                const avg = (neighbors[0] + neighbors[1] + neighbors[2] + neighbors[3]) / 4;
                data[idx + rgb] = clamp(tempData[idx + rgb] * (1 - factor) + avg * factor);
            }
        }
    }

    return imageData;
}

// Apply Sharpness Effect using Unsharp Mask
function applySharpness(imageData, width, height, intensity) {
    const data = imageData.data;
    const factor = 1 + (intensity / 100);
    const tempData = new Uint8ClampedArray(data);

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = (y * width + x) * 4;
            for (let rgb = 0; rgb < 3; rgb++) {
                const current = tempData[idx + rgb];
                const neighbors = [
                    tempData[((y - 1) * width + x) * 4 + rgb], // top
                    tempData[((y + 1) * width + x) * 4 + rgb], // bottom
                    tempData[(y * width + (x - 1)) * 4 + rgb], // left
                    tempData[(y * width + (x + 1)) * 4 + rgb]  // right
                ];
                const avg = (neighbors[0] + neighbors[1] + neighbors[2] + neighbors[3]) / 4;
                const diff = current - avg;
                data[idx + rgb] = clamp(current + diff * factor);
            }
        }
    }

    return imageData;
}
