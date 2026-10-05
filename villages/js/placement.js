// Front doors point toward +Z at rotation zero; camera yaw uses the same axes.
export const facingViewer = yaw => ((Math.floor(yaw / (Math.PI / 2) + 0.5) % 4) + 4) % 4;
