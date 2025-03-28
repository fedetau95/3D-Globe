import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environment';

@Injectable({
  providedIn: 'root'
})
export class WorldDataService {
  private worldDataUrl = environment.assetsPath.data.world;
  
  // Cache for country data
  private countriesData: any = null;
  
  // Country statistics
  private countryStatistics: Map<string, { 
    attacks: number,
    attacksReceived: number,
    attacksSent: number
  }> = new Map();

  constructor(private http: HttpClient) {
    // Initialize with sample statistics
    this.initializeCountryStats();
  }

  // Load world geographical data
  getWorldData(): Observable<any> {
    if (this.countriesData) {
      return of(this.countriesData);
    }
    
    return this.http.get(this.worldDataUrl).pipe(
      map(data => {
        this.countriesData = data;
        return data;
      }),
      catchError(error => {
        console.error('Error loading world data:', error);
        return of(null);
      })
    );
  }

  // Get statistics for a country
  getCountryStatistics(countryCode: string): any {
    return this.countryStatistics.get(countryCode) || { 
      attacks: 0, 
      attacksReceived: 0, 
      attacksSent: 0 
    };
  }

  // Get top attacked countries sorted by number of attacks
  getTopAttackedCountries(limit: number = 10): Array<{ 
    code: string, 
    name: string, 
    attacks: number 
  }> {
    const stats: Array<{ code: string, name: string, attacks: number }> = [];
    
    this.countryStatistics.forEach((value, key) => {
      stats.push({ 
        code: key, 
        name: this.getCountryNameFromCode(key), 
        attacks: value.attacksReceived 
      });
    });
    
    return stats
      .sort((a, b) => b.attacks - a.attacks)
      .slice(0, limit);
  }

  // Update statistics when a new attack is detected
  updateCountryStats(sourceCountry: string, targetCountry: string): void {
    // Update source country stats
    const sourceStats = this.countryStatistics.get(sourceCountry) || { 
      attacks: 0, 
      attacksReceived: 0, 
      attacksSent: 0 
    };
    sourceStats.attacks++;
    sourceStats.attacksSent++;
    this.countryStatistics.set(sourceCountry, sourceStats);
    
    // Update target country stats
    const targetStats = this.countryStatistics.get(targetCountry) || { 
      attacks: 0, 
      attacksReceived: 0, 
      attacksSent: 0 
    };
    targetStats.attacks++;
    targetStats.attacksReceived++;
    this.countryStatistics.set(targetCountry, targetStats);
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

  // Initialize with sample statistics
  private initializeCountryStats(): void {
    this.countryStatistics.set('US', { attacks: 125000, attacksReceived: 85634, attacksSent: 39366 });
    this.countryStatistics.set('RU', { attacks: 98000, attacksReceived: 73765, attacksSent: 24235 });
    this.countryStatistics.set('CN', { attacks: 83000, attacksReceived: 61069, attacksSent: 21931 });
    this.countryStatistics.set('DE', { attacks: 32000, attacksReceived: 21756, attacksSent: 10244 });
    this.countryStatistics.set('IN', { attacks: 27000, attacksReceived: 19150, attacksSent: 7850 });
    this.countryStatistics.set('BR', { attacks: 18000, attacksReceived: 11545, attacksSent: 6455 });
    this.countryStatistics.set('IT', { attacks: 3800, attacksReceived: 2319, attacksSent: 1481 });
    this.countryStatistics.set('GB', { attacks: 2700, attacksReceived: 1511, attacksSent: 1189 });
    this.countryStatistics.set('FR', { attacks: 1800, attacksReceived: 985, attacksSent: 815 });
    this.countryStatistics.set('JP', { attacks: 1300, attacksReceived: 720, attacksSent: 580 });
  }
}