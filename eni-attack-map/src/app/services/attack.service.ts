import { Injectable } from '@angular/core';
import { Observable, Subject, interval } from 'rxjs';
import { WorldDataService } from './world-data.service';

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

export type AttackType = 'DoS' | 'Malware' | 'Phishing' | 'Ransomware' | 'SQL Injection';

@Injectable({
  providedIn: 'root'
})
export class AttackService {
  private attackSubject = new Subject<Attack>();
  private activeAttacks: Map<string, Attack> = new Map();
  private nextAttackId = 1;
  
  // Statistiche sugli attacchi per tipo
  private attackStats: Map<AttackType, number> = new Map([
    ['DoS', 61069],
    ['Malware', 73765],
    ['Phishing', 11545],
    ['Ransomware', 19150],
    ['SQL Injection', 2319]
  ]);
  
  // Coordinate geografiche di alcuni paesi principali
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
    // Simulazione di attacchi periodici
    this.startAttackSimulation();
  }

  // Ottiene lo stream di attacchi come Observable
  getAttacks(): Observable<Attack> {
    return this.attackSubject.asObservable();
  }
  
  // Ottiene gli attacchi attivi
  getActiveAttacks(): Map<string, Attack> {
    return this.activeAttacks;
  }
  
  // Ottiene le statistiche sugli attacchi per tipo
  getAttackStats(): Map<AttackType, number> {
    return this.attackStats;
  }
  
  // Incrementa le statistiche di un tipo di attacco
  incrementAttackStat(type: AttackType): void {
    const currentValue = this.attackStats.get(type) || 0;
    this.attackStats.set(type, currentValue + 1);
  }

  // Genera un nuovo attacco e lo emette
  generateAttack(): Attack {
    const attackTypes: AttackType[] = ['DoS', 'Malware', 'Phishing', 'Ransomware', 'SQL Injection'];
    const countryCodes = Object.keys(this.countryCoordinates);
    
    // Seleziona paesi di origine e destinazione casuali
    const sourceIdx = Math.floor(Math.random() * countryCodes.length);
    let targetIdx = Math.floor(Math.random() * countryCodes.length);
    while (targetIdx === sourceIdx) {
      targetIdx = Math.floor(Math.random() * countryCodes.length);
    }
    
    const sourceCountry = countryCodes[sourceIdx];
    const targetCountry = countryCodes[targetIdx];
    const sourceCoord = this.countryCoordinates[sourceCountry];
    const targetCoord = this.countryCoordinates[targetCountry];
    
    // Seleziona un tipo di attacco casuale
    const attackType = attackTypes[Math.floor(Math.random() * attackTypes.length)];
    
    // Genera un'intensità casuale (1-10)
    const intensity = Math.floor(Math.random() * 10) + 1;
    
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
    
    // Aggiorna le statistiche
    this.incrementAttackStat(attackType);
    this.worldDataService.updateCountryStats(sourceCountry, targetCountry);
    
    // Aggiungi l'attacco alla mappa degli attacchi attivi
    this.activeAttacks.set(attack.id, attack);
    
    // Dopo un periodo, rimuovi l'attacco dalla mappa
    setTimeout(() => {
      this.activeAttacks.delete(attack.id);
    }, 10000 + Math.random() * 5000); // Durata casuale tra 10-15 secondi
    
    // Emetti l'attacco
    this.attackSubject.next(attack);
    
    return attack;
  }
  
  // Avvia la simulazione di attacchi periodici
  startAttackSimulation(): void {
    // Genera attacchi con frequenza variabile (1-5 secondi)
    interval(1000).subscribe(() => {
      // Probabilità variabile di generare un attacco
      if (Math.random() < 0.7) { // 70% di probabilità di generare un attacco ogni secondo
        this.generateAttack();
      }
    });
  }
  
  // Ottiene il nome del paese dal codice
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
}