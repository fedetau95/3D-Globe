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
    simulationInterval: 1000, // ms
    attackProbability: 0.3,   // 30% chance per interval
    maxIntensity: 10,
    lifetime: 10000,          // ms
    types: ['DoS', 'Malware', 'Phishing', 'Ransomware', 'SQL Injection'],
  },
  zoom: {
    minDistance: 120,
    maxDistance: 300,
    duration: 1.5,           // seconds
    resetDelay: 5000,        // ms
  },
  popup: {
    duration: 5000,          // ms
    intensityThreshold: 10,   // show popup for attacks with intensity >= this value
  }
};