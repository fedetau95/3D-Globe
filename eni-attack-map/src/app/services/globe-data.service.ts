import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import * as THREE from 'three';

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
export class GlobeDataService {
  private worldDataUrl = 'assets/data/world.json';
  private mockAttacks: Attack[] = [];

  constructor(private http: HttpClient) {
    this.generateMockAttacks();
  }

  getWorldData(): Observable<any> {
    return this.http.get(this.worldDataUrl).pipe(
      catchError(error => {
        console.error('Error loading world data:', error);
        return of(null);
      })
    );
  }

  getAttacks(): Observable<Attack[]> {
    // In a real scenario, this would fetch from an API
    return of(this.mockAttacks);
  }

  addNewAttack(attack: Attack): void {
    this.mockAttacks.push(attack);
  }

  private generateMockAttacks(): void {
    // Generate some mock attacks for demonstration
    const countries = [
      { name: 'United States', code: 'US', lat: 37.0902, lng: -95.7129 },
      { name: 'Russia', code: 'RU', lat: 61.524, lng: 105.3188 },
      { name: 'China', code: 'CN', lat: 35.8617, lng: 104.1954 },
      { name: 'Italy', code: 'IT', lat: 41.8719, lng: 12.5674 },
      { name: 'Brazil', code: 'BR', lat: -14.235, lng: -51.9253 },
      { name: 'India', code: 'IN', lat: 20.5937, lng: 78.9629 },
      { name: 'United Kingdom', code: 'GB', lat: 55.3781, lng: -3.4360 },
      { name: 'Germany', code: 'DE', lat: 51.1657, lng: 10.4515 },
    ];

    const attackTypes = ['DoS', 'Malware', 'Phishing', 'Ransomware', 'SQL Injection'];

    // Generate 50 random attacks
    for (let i = 0; i < 50; i++) {
      const sourceIdx = Math.floor(Math.random() * countries.length);
      let targetIdx = Math.floor(Math.random() * countries.length);
      
      // Ensure source and target are different
      while (targetIdx === sourceIdx) {
        targetIdx = Math.floor(Math.random() * countries.length);
      }
      
      const source = countries[sourceIdx];
      const target = countries[targetIdx];
      const type = attackTypes[Math.floor(Math.random() * attackTypes.length)];
      const intensity = Math.floor(Math.random() * 10) + 1;
      
      // Random timestamp in the last 24 hours
      const timestamp = new Date();
      timestamp.setHours(timestamp.getHours() - Math.random() * 24);
      
      this.mockAttacks.push({
        id: `attack-${i}`,
        source: {
          country: source.name,
          countryCode: source.code,
          lat: source.lat,
          lng: source.lng
        },
        target: {
          country: target.name,
          countryCode: target.code,
          lat: target.lat,
          lng: target.lng
        },
        type,
        intensity,
        timestamp
      });
    }
  }
}