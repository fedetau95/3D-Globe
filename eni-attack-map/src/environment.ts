export const environment = {
  production: false,
  assetsPath: {
    textures: {
      earth: 'assets/images/earth_texture.jpg',
      bump: 'assets/images/earth_bump.jpg',
      specular: 'assets/images/earth_specular.jpg',
    },
    data: {
      world: 'assets/data/world.json',
    }
  },
  globe: {
    radius: 100,
    segments: 64,
    rotationSpeed: 0.0005,
  },
  attacks: {
    simulationInterval: 200, // ms
    attackProbability: 0.9,   // 50% chance per interval
    maxIntensity: 10,
    lifetime: 5000,           // ms - ridotto da 10000 a 5000
    types: ['DoS', 'Malware', 'Phishing', 'Ransomware', 'SQL Injection'],
  },
  zoom: {
    minDistance: 120,
    maxDistance: 300,
    duration: 5,           // seconds
    resetDelay: 7000,        // ms
  },
  popup: {
    duration: 5000,          // ms
    intensityThreshold: 11,   // abbassato da 9 a 7 per mostrare più popup
  }
};