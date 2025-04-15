import { Injectable } from '@angular/core';
import { Observable, Subject, interval } from 'rxjs';
import { WorldDataService } from './world-data.service'; 
import { environment } from '../../environment';

export interface Attack {
  id: string;
  source: {
    country: string;
    countryCode: string;
    lat: number;
    lng: number;
  };
  target: {
    country: string;
    countryCode: string;
    lat: number;
    lng: number;
  };
  type: string;
  intensity: number;
  timestamp: Date;
}

@Injectable({
  providedIn: 'root'
})
export class AttackService {
  private attackSubject = new Subject<Attack>();
  private activeAttacks: Map<string, Attack> = new Map();
  private pastAttacks: Attack[] = []; // Nuovo array per memorizzare gli attacchi passati
  private nextAttackId = 1;
  
  // Statistics on attacks by type
  private attackStats: Map<string, number> = new Map([
    ['DoS', 61069],
    ['Malware', 73765],
    ['Phishing', 11545],
    ['Ransomware', 19150],
    ['SQL Injection', 2319]
  ]);
  
  // Geographic coordinates of major countries
  private countryCoordinates: { [key: string]: { lat: number, lng: number } } = {
    'US': { lat: 37.0902, lng: -95.7129 },
    'RU': { lat: 61.524, lng: 105.3188 },
    'CN': { lat: 35.8617, lng: 104.1954 },
    'IT': { lat: 41.8719, lng: 12.5674 },
    'BR': { lat: -14.235, lng: -51.9253 },
    'IN': { lat: 20.5937, lng: 78.9629 },
    'GB': { lat: 55.3781, lng: -3.4360 },
    'DE': { lat: 51.1657, lng: 10.4515 },
    'FR': { lat: 46.6034, lng: 1.8883 },
    'JP': { lat: 36.2048, lng: 138.2529 },
    'CA': { lat: 56.1304, lng: -106.3468 },
    'AU': { lat: -25.2744, lng: 133.7751 },
    'ES': { lat: 40.4637, lng: -3.7492 },
    'KR': { lat: 35.9078, lng: 127.7669 },
    'MX': { lat: 23.6345, lng: -102.5528 }
  };
  
  constructor(private worldDataService: WorldDataService) {
    // Start periodic attack simulation
    this.startAttackSimulation();
    
    // Genera alcuni attacchi passati di esempio per avere dati iniziali
    this.generateInitialPastAttacks();
  }

  // Get attack stream as Observable
  getAttacks(): Observable<Attack> {
    return this.attackSubject.asObservable();
  }
  
  // Get active attacks
  getActiveAttacks(): Map<string, Attack> {
    return this.activeAttacks;
  }
  
  // Get past attacks with pagination
  getPastAttacks(page: number = 1, pageSize: number = 10): { attacks: Attack[], totalCount: number } {
    const startIdx = (page - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, this.pastAttacks.length);
    
    return {
      attacks: this.pastAttacks.slice(startIdx, endIdx),
      totalCount: this.pastAttacks.length
    };
  }
  
  // Get attack statistics by type
  getAttackStats(): Map<string, number> {
    return this.attackStats;
  }
  
  // Increment statistics for an attack type
  incrementAttackStat(type: string): void {
    const currentValue = this.attackStats.get(type) || 0;
    this.attackStats.set(type, currentValue + 1);
  }

  // Generate a new attack and emit it
  generateAttack(): Attack {
    const attackTypes = environment.attacks.types;
    const countryCodes = Object.keys(this.countryCoordinates);
    
    // Select random source and target countries
    const sourceIdx = Math.floor(Math.random() * countryCodes.length);
    let targetIdx = Math.floor(Math.random() * countryCodes.length);
    
    // Ensure target is different from source
    while (targetIdx === sourceIdx) {
      targetIdx = Math.floor(Math.random() * countryCodes.length);
    }
    
    const sourceCountry = countryCodes[sourceIdx];
    const targetCountry = countryCodes[targetIdx];
    const sourceCoord = this.countryCoordinates[sourceCountry];
    const targetCoord = this.countryCoordinates[targetCountry];
    
    // Select random attack type
    const attackType = attackTypes[Math.floor(Math.random() * attackTypes.length)];
    
    // Generate random intensity (1-10)
    const intensity = Math.floor(Math.random() * environment.attacks.maxIntensity) + 1;
    
    // Create attack object
    const attack: Attack = {
      id: `attack-${this.nextAttackId++}`,
      source: {
        country: this.getCountryNameFromCode(sourceCountry),
        countryCode: sourceCountry,
        lat: sourceCoord.lat,
        lng: sourceCoord.lng
      },
      target: {
        country: this.getCountryNameFromCode(targetCountry),
        countryCode: targetCountry,
        lat: targetCoord.lat,
        lng: targetCoord.lng
      },
      type: attackType,
      intensity: intensity,
      timestamp: new Date()
    };
    
    // Update statistics
    this.incrementAttackStat(attackType);
    this.worldDataService.updateCountryStats(sourceCountry, targetCountry);
    
    // Add attack to active attacks map
    this.activeAttacks.set(attack.id, attack);
    
    // Remove attack after a period
    setTimeout(() => {
      this.activeAttacks.delete(attack.id);
      // Aggiungi l'attacco all'elenco degli attacchi passati
      this.pastAttacks.unshift(attack); // Inserisci all'inizio per avere i più recenti in cima
      
      // Limita il numero massimo di attacchi passati memorizzati (per evitare consumo eccessivo di memoria)
      if (this.pastAttacks.length > 1000) {
        this.pastAttacks.pop(); // Rimuovi l'ultimo (più vecchio)
      }
    }, environment.attacks.lifetime + Math.random() * 5000);
    
    // Emit attack event
    this.attackSubject.next(attack);
    
    return attack;
  }
  
  // Start periodic attack simulation
  startAttackSimulation(): void {
    // Generate attacks with variable frequency
    interval(environment.attacks.simulationInterval).subscribe(() => {
      // Variable probability of generating an attack
      if (Math.random() < environment.attacks.attackProbability) {
        this.generateAttack();
      }
    });
  }
  
  // Get country name from country code
  private getCountryNameFromCode(code: string): string {
    const countryNames: { [key: string]: string } = {
      'US': 'United States',
      'RU': 'Russia',
      'CN': 'China',
      'IT': 'Italy',
      'DE': 'Germany',
      'GB': 'United Kingdom',
      'FR': 'France',
      'JP': 'Japan',
      'BR': 'Brazil',
      'IN': 'India',
      'CA': 'Canada',
      'AU': 'Australia',
      'ES': 'Spain',
      'KR': 'South Korea',
      'MX': 'Mexico'
    };
    
    return countryNames[code] || code;
  }
  
  // Genera attacchi passati di esempio per avere dati da mostrare all'avvio
  private generateInitialPastAttacks(): void {
    const attackTypes = environment.attacks.types;
    const countryCodes = Object.keys(this.countryCoordinates);
    
    // Crea 50 attacchi casuali nel passato
    for (let i = 0; i < 50; i++) {
      const sourceIdx = Math.floor(Math.random() * countryCodes.length);
      let targetIdx = Math.floor(Math.random() * countryCodes.length);
      
      // Ensure target is different from source
      while (targetIdx === sourceIdx) {
        targetIdx = Math.floor(Math.random() * countryCodes.length);
      }
      
      const sourceCountry = countryCodes[sourceIdx];
      const targetCountry = countryCodes[targetIdx];
      const sourceCoord = this.countryCoordinates[sourceCountry];
      const targetCoord = this.countryCoordinates[targetCountry];
      
      // Select random attack type
      const attackType = attackTypes[Math.floor(Math.random() * attackTypes.length)];
      
      // Generate random intensity (1-10)
      const intensity = Math.floor(Math.random() * environment.attacks.maxIntensity) + 1;
      
      // Create timestamp in the past (up to 24 hours ago)
      const pastTime = new Date();
      pastTime.setMinutes(pastTime.getMinutes() - Math.floor(Math.random() * 1440)); // Fino a 24 ore nel passato
      
      // Create attack object
      const attack: Attack = {
        id: `past-attack-${i}`,
        source: {
          country: this.getCountryNameFromCode(sourceCountry),
          countryCode: sourceCountry,
          lat: sourceCoord.lat,
          lng: sourceCoord.lng
        },
        target: {
          country: this.getCountryNameFromCode(targetCountry),
          countryCode: targetCountry,
          lat: targetCoord.lat,
          lng: targetCoord.lng
        },
        type: attackType,
        intensity: intensity,
        timestamp: pastTime
      };
      
      // Aggiungi l'attacco all'elenco degli attacchi passati
      this.pastAttacks.push(attack);
    }
    
    // Ordina gli attacchi per timestamp (più recenti in cima)
    this.pastAttacks.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
}