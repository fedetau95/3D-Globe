# Eni 3D Attack Map

Un globo 3D interattivo che visualizza gli attacchi informatici in tempo reale, ispirato alla Kaspersky Cyber Map.

## Caratteristiche

- **Globo 3D** con effetti di illuminazione e atmosfera
- **Visualizzazione degli attacchi in tempo reale** con animazioni di particelle
- **Effetti grafici avanzati** inclusi effetti di blink e particelle
- **Zoom dinamico intelligente** sugli attacchi più importanti
- **Popup informativi contestuali** con dettagli sugli attacchi
- **Statistiche aggiornate** sui paesi più attaccati e tipologie di attacchi

## Requisiti

- Node.js >= 16.x
- Angular CLI >= 16.x

## Installazione

```bash
# Clona il repository
git clone [repository_url]
cd eni-attack-map

# Installa le dipendenze
npm install

# Avvia l'applicazione in modalità sviluppo
ng serve
```

Apri il browser all'indirizzo `http://localhost:4200/`.

## Struttura delle cartelle

```
src/
├── app/
│   ├── components/
│   │   └── globe/            # Componente principale del globo 3D
│   ├── services/
│   │   ├── attack.service.ts  # Servizio per la gestione degli attacchi
│   │   └── world-data.service.ts # Servizio per i dati geografici
│   ├── app.component.ts      # Componente root
│   └── app.routes.ts         # Configurazione delle rotte
├── assets/
│   ├── data/
│   │   └── world.json        # Dati geografici del mondo
│   └── images/
│       ├── earth_texture.jpg # Texture per il globo
│       ├── earth_bump.jpg    # Mappa di rilievo
│       └── earth_specular.jpg # Mappa speculare
└── environments/
    └── environment.ts        # Configurazione dell'ambiente
```

## Tecnologie utilizzate

- **Angular**: Framework frontend
- **Three.js**: Libreria per grafica 3D
- **D3.js**: Per manipolazione dati e calcoli geografici

## Funzionalità principali

### 1. Visualizzazione globo 3D
Il globo terrestre 3D è creato utilizzando Three.js con texture realistiche e effetti di illuminazione avanzati, inclusa un'atmosfera e un effetto di bagliore.

### 2. Visualizzazione attacchi
Gli attacchi vengono rappresentati come archi animati tra il paese di origine e il paese di destinazione. Ogni tipo di attacco ha un colore distintivo:
- **DoS**: Rosso
- **Malware**: Arancione
- **Phishing**: Giallo
- **Ransomware**: Magenta
- **SQL Injection**: Ciano

### 3. Zoom dinamico
Il sistema di zoom intelligente focalizza automaticamente la visuale sugli attacchi di alta intensità, permettendo all'utente di concentrarsi sugli eventi più critici.

### 4. Popup informativi
I popup mostrano informazioni dettagliate sugli attacchi, inclusi:
- Tipo di attacco
- Paese di origine e destinazione
- Intensità dell'attacco
- Timestamp

### 5. Statistiche in tempo reale
Il pannello laterale mostra statistiche aggiornate, tra cui:
- Top 10 paesi più attaccati
- Distribuzione degli attacchi per tipologia

## Personalizzazione

È possibile personalizzare vari aspetti dell'applicazione modificando il file `environment.ts`:

- Percorsi delle texture
- Parametri del globo (raggio, segmenti, velocità di rotazione)
- Configurazione della simulazione degli attacchi
- Impostazioni dello zoom e dei popup

## Sviluppi futuri

- Integrazione con feed di dati reali
- Visualizzazione di dati storici
- Aggiunta di filtri per tipo di attacco o regione
- Supporto per visualizzazione in VR
- Integrazione con sistemi di monitoraggio esistenti