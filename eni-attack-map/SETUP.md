# Guida all'Installazione e Configurazione

Questa guida spiega come installare, configurare e avviare il progetto Eni 3D Attack Map.

## Prerequisiti

- [Node.js](https://nodejs.org/) (versione 16.x o superiore)
- [npm](https://www.npmjs.com/) (solitamente incluso con Node.js)
- [Angular CLI](https://angular.io/cli) (versione 16.x o superiore)

## Installazione

1. Installa Angular CLI globalmente (se non l'hai già fatto):

```bash
npm install -g @angular/cli
```

2. Clona il repository o crea un nuovo progetto Angular:

```bash
# Opzione 1: Clonare il repository
git clone [repository_url]
cd eni-attack-map

# Opzione 2: Creare un nuovo progetto
ng new eni-attack-map --routing=true --style=scss
cd eni-attack-map
```

3. Installa le dipendenze necessarie:

```bash
npm install three @types/three d3 @types/d3 topojson-client @types/topojson-client
```

## Struttura delle cartelle

Crea la seguente struttura di cartelle nel progetto:

```bash
# Crea le cartelle per i componenti e i servizi
mkdir -p src/app/components/globe
mkdir -p src/app/services

# Crea le cartelle per gli assets
mkdir -p src/assets/images
mkdir -p src/assets/data
```

## Texture e Dati Geografici

1. Scarica le texture della Terra:

Dovrai ottenere tre texture principali:
- Earth texture map (earth_texture.jpg)
- Earth bump map (earth_bump.jpg)
- Earth specular map (earth_specular.jpg)

Puoi trovare queste texture su siti come [Solar System Scope](https://www.solarsystemscope.com/textures/) o [NASA Visible Earth](https://visibleearth.nasa.gov/).

2. Scarica i dati geografici:

Dovrai scaricare un file GeoJSON o TopoJSON contenente i confini dei paesi. Puoi usare:
- [Natural Earth](https://www.naturalearthdata.com/downloads/)
- [GeoJSON Maps](https://geojson-maps.ash.ms/)
- [GitHub repositories](https://github.com/topojson/world-atlas)

Scarica un file adatto e rinominalo in `world.json`.

3. Posiziona i file:

```bash
# Posiziona le texture nella cartella delle immagini
mv earth_texture.jpg earth_bump.jpg earth_specular.jpg src/assets/images/

# Posiziona i dati geografici nella cartella dei dati
mv world.json src/assets/data/
```

## Configurazione dei File

Copia i file di codice del progetto nelle rispettive cartelle:

1. Servizi:
   - Copia `world-data.service.ts` e `attack.service.ts` in `src/app/services/`

2. Componenti:
   - Copia `globe.component.ts`, `globe.component.html` e `globe.component.scss` in `src/app/components/globe/`

3. Configurazione:
   - Copia `environment.ts` in `src/environments/`
   - Aggiorna `app.component.ts`, `app.routes.ts` e `main.ts` con i file forniti

## Avvio dell'Applicazione

1. Avvia il server di sviluppo:

```bash
ng serve
```

2. Apri un browser e accedi a:

```
http://localhost:4200/
```

## Risoluzione dei Problemi

### CORS Issues

Se riscontri problemi di CORS durante il caricamento delle texture o dei dati:

1. Assicurati che tutti i file siano correttamente posizionati nella cartella `src/assets/`
2. Verifica che i percorsi nei file di configurazione siano corretti
3. Riavvia il server di sviluppo

### Performance

Se il rendering 3D è lento:

1. Riduci il numero di segmenti del globo modificando `segments` in `environment.ts`
2. Riduci la frequenza di generazione degli attacchi modificando `simulationInterval` e `attackProbability` in `environment.ts`
3. Usa texture con risoluzione più bassa

### Errori di Texture

Se le texture non si caricano correttamente:

1. Verifica che i file delle texture esistano nella posizione corretta
2. Controlla la console del browser per eventuali errori
3. Prova ad usare formati alternativi (.png invece di .jpg)

## Personalizzazione

### Colori degli Attacchi

Per modificare i colori associati ai diversi tipi di attacco, modifica il metodo `getColorForAttackType` nel file `globe.component.ts`.

### Parametri di Simulazione

Modifica i parametri nel file `environment.ts` per personalizzare:
- Velocità di rotazione del globo
- Frequenza e probabilità degli attacchi
- Durata delle animazioni
- Soglie per lo zoom e i popup