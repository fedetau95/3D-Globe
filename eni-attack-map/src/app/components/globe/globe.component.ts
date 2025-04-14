import { Component, OnInit, AfterViewInit, ElementRef, ViewChild, OnDestroy, HostListener, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Subscription } from 'rxjs';
import { Attack, AttackService } from '../../services/attack.service';
import { WorldDataService } from '../../services/world-data.service';
import { environment } from '../../../environment';

interface AttackVisual {
  line: THREE.Line;
  particles: THREE.Points;
  directionMarkers?: THREE.Points;
  impactEffects: THREE.Object3D[];
  startTime: number;
  attack: Attack;
  lifetime: number;
  completed: boolean;
  curve: THREE.QuadraticBezierCurve3; // Aggiungi la curva direttamente qui per comodità
}

interface PopupData {
  show: boolean;
  attack: Attack | null;
  position: { x: number, y: number } | null;
}

// Nuova interfaccia per gli elementi nella coda di zoom
interface ZoomQueueItem {
  attack: Attack;
  startPosition: THREE.Vector3;
  midPosition: THREE.Vector3;
  endPosition: THREE.Vector3; 
  startTime?: number;
  duration: number;
  state: 'pending' | 'active' | 'completed';
  followProgress: number; // da 0 a 1 per tracciare il progresso dell'attacco
}

@Component({
  selector: 'app-globe',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './globe.component.html',
  styleUrls: ['./globe.component.scss']
})
export class GlobeComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('globeCanvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  // Three.js objects
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private globe!: THREE.Mesh;
  private controls!: OrbitControls;
  private clock = new THREE.Clock();
  private starField!: THREE.Points;
  private stars: THREE.Points[] = [];
  private starCount = 10000; // Numero di stelle nello sfondo

  // Globe parameters
  private radius = environment.globe.radius;
  private segments = environment.globe.segments;
  private rotationSpeed = environment.globe.rotationSpeed;

  // Visual effects
  private activeAttacks: Map<string, AttackVisual> = new Map();
  private attackColors: Record<string, THREE.Color> = {
    'DoS': new THREE.Color(0xff0000),        // Red
    'Malware': new THREE.Color(0xff8800),    // Orange
    'Phishing': new THREE.Color(0xffff00),   // Yellow
    'Ransomware': new THREE.Color(0xff00ff), // Magenta
    'SQL Injection': new THREE.Color(0x00ffff) // Cyan
  };

  // Animation and rendering
  private animationFrameId: number = 0;

  // Nuova coda di zoom e variabili correlate
  private zoomQueue: ZoomQueueItem[] = [];
  private isZooming: boolean = false;
  private currentZoomItem: ZoomQueueItem | null = null;
  private initialCameraPosition = new THREE.Vector3();
  private initialCameraLookAt = new THREE.Vector3();
  private defaultCameraPosition = new THREE.Vector3(0, 0, 200);
  private defaultLookAt = new THREE.Vector3(0, 0, 0);
  private cameraIsResetting: boolean = false;
  private cameraResetStartTime: number = 0;
  private cameraResetDuration: number = 2.0; // secondi

  // Popup for attack information
  popupData: PopupData = {
    show: false,
    attack: null,
    position: null
  };

  // Statistics data
  topAttackedCountries: Array<{ code: string, name: string, attacks: number }> = [];
  attackTypeStats: Array<{ type: string, count: number }> = [];

  // Subscriptions
  private subscriptions: Subscription[] = [];

  constructor(
    private attackService: AttackService,
    private worldDataService: WorldDataService,
    private ngZone: NgZone
  ) { }

  ngOnInit(): void {
    this.updateStats();
  }

  ngAfterViewInit(): void {
    // Initialize the 3D scene
    this.initScene();
    this.setupRenderer();
    this.createGlobe();
    this.setupLights();
    this.createStarField();
    this.setupControls();

    // Set up data subscription
    this.subscribeToAttacks();

    // Start animation loop
    this.ngZone.runOutsideAngular(() => this.animate());

    // Update statistics periodically
    setInterval(() => {
      this.ngZone.run(() => this.updateStats());
    }, 5000);
  }

  ngOnDestroy(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    // Clean up subscriptions
    this.subscriptions.forEach(sub => sub.unsubscribe());

    // Dispose Three.js resources
    this.renderer.dispose();
    this.scene.clear();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.camera && this.renderer) {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  private initScene(): void {
    // Create Three.js scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000); // Nero profondo

    // Set up camera
    this.camera = new THREE.PerspectiveCamera(
      60,  // Field of view
      window.innerWidth / window.innerHeight,  // Aspect ratio
      0.1,  // Near clipping plane
      1000  // Far clipping plane
    );

    // Set initial camera position
    this.camera.position.z = 200;
    this.initialCameraPosition.copy(this.camera.position);
    this.initialCameraLookAt.set(0, 0, 0);
    
    // Salva la posizione predefinita per i reset
    this.defaultCameraPosition.copy(this.camera.position);
  }


  private setupRenderer(): void {
    // Create WebGL renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvasRef.nativeElement,
      antialias: true,
      alpha: true
    });

    // Configure renderer
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
  }

  private setupLights(): void {
    // Aumentiamo l'intensità della luce ambientale per una maggiore uniformità
    const ambientLight = new THREE.AmbientLight(0x404040, 3); // Aumento dell'intensità
    this.scene.add(ambientLight);

    // Aggiungiamo più luci direzionali da diverse angolazioni
    const createDirectionalLight = (x: number, y: number, z: number, intensity: number) => {
      const light = new THREE.DirectionalLight(0xffffff, intensity);
      light.position.set(x, y, z).normalize();
      this.scene.add(light);
      return light;
    };

    // Luci da varie direzioni per un'illuminazione più uniforme
    createDirectionalLight(1, 1, 1, 0.5);
    createDirectionalLight(-1, 1, 1, 0.5);
    createDirectionalLight(1, -1, 1, 0.5);
    createDirectionalLight(-1, -1, 1, 0.5);

    // Luce posteriore più debole
    createDirectionalLight(-1, 0, -1, 0.2);
    createDirectionalLight(1, 0, -1, 0.2);
  }

  private createStarField(): void {
    // Creiamo tre layer di stelle con diverse velocità di rotazione
    this.createStarLayer(this.starCount * 0.6, 300, 0.8); // Layer esterno, più lento
    this.createStarLayer(this.starCount * 0.3, 500, 0.9); // Layer medio
    this.createStarLayer(this.starCount * 0.1, 700, 1.0); // Layer interno, più veloce
  }

  private createStarLayer(count: number, radius: number, speedFactor: number): void {
    // Geometria per le stelle
    const starsGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(count * 3);
    const starColors = new Float32Array(count * 3);
    const starSizes = new Float32Array(count);

    // Generazione casuale di posizioni delle stelle
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      // Posizione sferica casuale
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      starPositions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      starPositions[i3 + 2] = radius * Math.cos(phi);

      // Colori variabili per le stelle (bianco, azzurro, giallastro)
      const colorChoice = Math.random();
      if (colorChoice < 0.6) {
        // Stelle bianche (60%)
        starColors[i3] = 1.0;
        starColors[i3 + 1] = 1.0;
        starColors[i3 + 2] = 1.0;
      } else if (colorChoice < 0.8) {
        // Stelle azzurre (20%)
        starColors[i3] = 0.8;
        starColors[i3 + 1] = 0.9;
        starColors[i3 + 2] = 1.0;
      } else {
        // Stelle giallastre (20%)
        starColors[i3] = 1.0;
        starColors[i3 + 1] = 0.9;
        starColors[i3 + 2] = 0.7;
      }

      // Dimensioni variabili casuali
      starSizes[i] = Math.random() * 2 + 0.5;
    }

    starsGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starsGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    starsGeometry.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));

    // Materiale per le stelle
    const starsMaterial = new THREE.PointsMaterial({
      size: 1,
      transparent: true,
      opacity: 0.8,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });

    // Creiamo il sistema di stelle
    const starPoints = new THREE.Points(starsGeometry, starsMaterial);
    starPoints.userData = { speedFactor }; // Memorizziamo il fattore di velocità
    this.scene.add(starPoints);
    this.stars.push(starPoints);
  }

  private createGlobe(): void {
    // Create sphere geometry for Earth
    const geometry = new THREE.SphereGeometry(this.radius, this.segments, this.segments);

    // Load Earth textures
    const textureLoader = new THREE.TextureLoader();
    const earthTexture = textureLoader.load(environment.assetsPath.textures.earth);
    const bumpMap = textureLoader.load(environment.assetsPath.textures.bump);
    const specularMap = textureLoader.load(environment.assetsPath.textures.specular);

    // Create material with textures
    const material = new THREE.MeshPhongMaterial({
      map: earthTexture,
      bumpMap: bumpMap,
      bumpScale: 0.5,
      specularMap: specularMap,
      specular: new THREE.Color('grey'),
      shininess: 5
    });

    // Create globe mesh and add to scene
    this.globe = new THREE.Mesh(geometry, material);
    this.scene.add(this.globe);

    // Add atmospheric and glow effects
    this.addGlowEffect();
    this.addAtmosphere();
  }

  private addGlowEffect(): void {
    // Create glow effect using shader material
    const glowGeometry = new THREE.SphereGeometry(this.radius + 2, this.segments, this.segments);
    const glowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        'c': { value: 0.1 },
        'p': { value: 1.4 },
        glowColor: { value: new THREE.Color(0x00a8ff) },
        viewVector: { value: new THREE.Vector3() }
      },
      vertexShader: `
        uniform vec3 viewVector;
        uniform float c;
        uniform float p;
        varying float intensity;
        void main() {
          vec3 vNormal = normalize(normal);
          vec3 vNormel = normalize(viewVector);
          intensity = pow(c - dot(vNormal, vNormel), p);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 glowColor;
        varying float intensity;
        void main() {
          vec3 glow = glowColor * intensity;
          gl_FragColor = vec4(glow, 1.0);
        }
      `,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true
    });

    const glowSphere = new THREE.Mesh(glowGeometry, glowMaterial);
    this.scene.add(glowSphere);
  }

  private addAtmosphere(): void {
    // Add thin blue atmosphere layer
    const atmosphereGeometry = new THREE.SphereGeometry(this.radius + 1, this.segments, this.segments);
    const atmosphereMaterial = new THREE.MeshBasicMaterial({
      color: 0x0077ff,
      transparent: true,
      opacity: 0.1,
      side: THREE.FrontSide
    });

    const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
    this.scene.add(atmosphere);
  }

  private setupControls(): void {
    // Create orbit controls for camera movement
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);

    // Configure controls
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.rotateSpeed = 0.5;
    this.controls.minDistance = environment.zoom.minDistance;
    this.controls.maxDistance = environment.zoom.maxDistance;
    this.controls.enablePan = false;
  }

  private subscribeToAttacks(): void {
    // Subscribe to attack stream
    this.subscriptions.push(
      this.attackService.getAttacks().subscribe(attack => {
        // Create visual representation of attack
        this.createAttackVisualization(attack);

        // Per gli attacchi ad alta intensità, aggiungi alla coda di zoom
        if (attack.intensity >= environment.popup.intensityThreshold) {
          this.addToZoomQueue(attack);
          this.showPopup(attack);
        }
      })
    );
  }

  private latLongToVector3(lat: number, lon: number, radius: number): THREE.Vector3 {
    // Convert latitude and longitude to 3D position
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lon + 180) * Math.PI / 180;

    // Calculate coordinates
    const x = -radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.sin(theta);

    return new THREE.Vector3(x, y, z);
  }

  private createAttackVisualization(attack: Attack): void {
    // Convert lat/lng to 3D positions
    const sourcePos = this.latLongToVector3(
      attack.source.lat,
      attack.source.lng,
      this.radius
    );
  
    const targetPos = this.latLongToVector3(
      attack.target.lat,
      attack.target.lng,
      this.radius
    );
  
    // Calcola la distanza angolare (in radianti) tra i punti
    const sourceDir = sourcePos.clone().normalize();
    const targetDir = targetPos.clone().normalize();
    const angularDistance = Math.acos(sourceDir.dot(targetDir));
    
    // Create a curved path from source to target
    const midPoint = new THREE.Vector3().addVectors(sourcePos, targetPos).multiplyScalar(0.5);
    const distance = sourcePos.distanceTo(targetPos);
    
    // Calcola l'altezza della curva basandosi sulla distanza angolare
    // Quando la distanza angolare si avvicina a π (antipodi), l'altezza aumenta significativamente
    const baseAltitude = this.radius * 0.3;
    const angularFactor = Math.pow(angularDistance / Math.PI, 2) * this.radius * 2;
    const intensityFactor = attack.intensity * 0.5;
    const altitude = baseAltitude + angularFactor + intensityFactor;
  
    // Adjust midpoint for curve height
    midPoint.normalize().multiplyScalar(this.radius + altitude);
  
    // Create quadratic curve
    const curve = new THREE.QuadraticBezierCurve3(sourcePos, midPoint, targetPos);

    // Create line geometry following the curve
    const points = curve.getPoints(50);
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);

    // Get color based on attack type
    const color = this.getColorForAttackType(attack.type);

    // Create line material with gradient effect
    // Usiamo LineDashedMaterial per un effetto tratteggiato che aiuta a visualizzare la direzione
    const lineMaterial = new THREE.LineDashedMaterial({
      color: color,
      dashSize: 3,
      gapSize: 1,
      transparent: true,
      opacity: 0.7,
      linewidth: 1 + attack.intensity / 3
    });

    // Create line mesh
    const line = new THREE.Line(lineGeometry, lineMaterial);
    line.computeLineDistances(); // Necessario per LineDashedMaterial

    // MODIFICA: Aggiungi la linea al globo invece che alla scena
    this.globe.add(line);

    // Create particles to flow along the line
    const particleGeometry = new THREE.BufferGeometry();
    const particleCount = 20 + attack.intensity; // Più particelle per attacchi più intensi
    const particlePositions = new Float32Array(particleCount * 3);

    // Set initial particle positions at the source with small random offsets
    for (let i = 0; i < particleCount; i++) {
      particlePositions[i * 3] = sourcePos.x + (Math.random() - 0.5) * 2;
      particlePositions[i * 3 + 1] = sourcePos.y + (Math.random() - 0.5) * 2;
      particlePositions[i * 3 + 2] = sourcePos.z + (Math.random() - 0.5) * 2;
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

    // Create particle material
    const particleMaterial = new THREE.PointsMaterial({
      color: color,
      size: 1.5 + (attack.intensity * 0.1),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });

    // Create particle system
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    particles.userData = {
      curve: curve,
      particles: Array.from({ length: particleCount }, () => ({
        t: 0,
        speed: 0.002 + (Math.random() * 0.002) + (attack.intensity * 0.0005) // Velocità variabile basata sull'intensità
      }))
    };

    // MODIFICA: Aggiungi le particelle al globo invece che alla scena
    this.globe.add(particles);

    // Preparare l'array per gli effetti di impatto (inizialmente vuoto)
    const impactEffects: THREE.Object3D[] = [];

    // Store reference to attack visualization
    this.activeAttacks.set(attack.id, {
      line,
      particles,
      curve, // Salviamo la curva direttamente nell'oggetto AttackVisual
      impactEffects,
      startTime: Date.now(),
      attack,
      lifetime: 5000 + (attack.intensity * 300),
      completed: false
    });
  }

  private createParticleTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    const size = 128;
    canvas.width = size;
    canvas.height = size;

    const context = canvas.getContext('2d');
    if (context) {
      const gradient = context.createRadialGradient(
        size / 2, size / 2, 0,
        size / 2, size / 2, size / 2
      );

      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.3, 'rgba(255,255,255,0.8)');
      gradient.addColorStop(0.5, 'rgba(255,255,255,0.4)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');

      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    }

    const texture = new THREE.Texture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  private createImpactEffect(position: THREE.Vector3, color: THREE.Color, intensity: number): THREE.Object3D[] {
    const effects: THREE.Object3D[] = [];

    // 1. Sfera di luce pulsante invece di un punto luce semplice
    const glowGeometry = new THREE.SphereGeometry(3 + intensity * 0.3, 32, 32);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending
    });

    const glowSphere = new THREE.Mesh(glowGeometry, glowMaterial);
    glowSphere.position.copy(position);
    this.globe.add(glowSphere);
    effects.push(glowSphere);

    // Aggiunge una piccola luce con una portata limitata
    const impactLight = new THREE.PointLight(color, 2 + intensity / 2, 10);
    impactLight.position.copy(position);
    this.globe.add(impactLight);
    effects.push(impactLight);

    // 2. Anelli multipli (da 2 a 4 in base all'intensità) che si espandono a velocità diverse
    const ringCount = 2 + Math.floor(intensity / 4); // Da 2 a 4 anelli

    for (let i = 0; i < ringCount; i++) {
      const ringGeometry = new THREE.RingGeometry(0.01, 0.05, 32); // Dimensioni ridotte a 1/10
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      });

      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.position.copy(position);
      ring.lookAt(new THREE.Vector3(0, 0, 0)); // Orienta verso il centro del globo
      ring.userData = {
        expansionSpeed: 0.01 + (Math.random() * 0.01) + (intensity * 0.001), // Velocità ridotta a 1/10
        initialDelay: i * 200 // ms - delay per ogni anello successivo
      };

      this.globe.add(ring);
      effects.push(ring);
    }

    // 3. Sistema di particelle più sofisticato (usando ShaderMaterial per effetti più avanzati)
    const particleCount = 20 + Math.floor(intensity * 3);
    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleSizes = new Float32Array(particleCount);

    // Posizioni iniziali in una sfera intorno al punto di impatto
    for (let i = 0; i < particleCount; i++) {
      const radius = Math.random() * 2;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      const x = position.x + radius * Math.sin(phi) * Math.cos(theta);
      const y = position.y + radius * Math.sin(phi) * Math.sin(theta);
      const z = position.z + radius * Math.cos(phi);

      particlePositions[i * 3] = x;
      particlePositions[i * 3 + 1] = y;
      particlePositions[i * 3 + 2] = z;

      // Dimensioni variabili
      particleSizes[i] = 1 + Math.random() * 2;
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeometry.setAttribute('size', new THREE.BufferAttribute(particleSizes, 1));

    // Materiale shader personalizzato per particelle più belle
    const particleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: color },
        pointTexture: { value: this.createParticleTexture() }
      },
      vertexShader: `
        attribute float size;
        varying vec3 vColor;
        void main() {
          vColor = vec3(1.0, 1.0, 1.0);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform sampler2D pointTexture;
        varying vec3 vColor;
        void main() {
          gl_FragColor = vec4(color * vColor, 1.0);
          gl_FragColor = gl_FragColor * texture2D(pointTexture, gl_PointCoord);
        }
      `,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      transparent: true
    });

    const particles = new THREE.Points(particleGeometry, particleMaterial);
    particles.userData = {
      velocities: Array.from({ length: particleCount }, () => {
        // Direzione di espansione radiale dal centro più randomizzazione
        const dirVector = new THREE.Vector3(
          position.x + (Math.random() - 0.5) * 0.5,
          position.y + (Math.random() - 0.5) * 0.5,
          position.z + (Math.random() - 0.5) * 0.5
        ).normalize();

        return new THREE.Vector3(
          dirVector.x * (0.01 + Math.random() * 0.02) * (1 + intensity * 0.005),
          dirVector.y * (0.01 + Math.random() * 0.02) * (1 + intensity * 0.005),
          dirVector.z * (0.01 + Math.random() * 0.02) * (1 + intensity * 0.005)
        );
      }),
      lifespans: Array.from({ length: particleCount }, () =>
        500 + Math.random() * 1000 // Durata di vita variabile tra 500ms e 1500ms
      ),
      startTimes: Array.from({ length: particleCount }, () =>
        Date.now() + Math.random() * 500 // Inizio ritardato casuale (0-500ms)
      )
    };

    this.globe.add(particles);
    effects.push(particles);

    return effects;
  }

  private getColorForAttackType(type: string): THREE.Color {
    return this.attackColors[type] || new THREE.Color(0x00ff00); // Default to green if type unknown
  }

  // Nuovo metodo per aggiungere un attacco alla coda di zoom
  private addToZoomQueue(attack: Attack): void {
    // Ottieni la curva per questo attacco
    const attackVisual = this.activeAttacks.get(attack.id);
    if (!attackVisual) return;
    
    // Estrai i punti dalla curva dell'attacco
    const curve = attackVisual.curve;
    const startPoint = curve.getPoint(0);
    const midPoint = curve.getPoint(0.5);
    const endPoint = curve.getPoint(1);
  
    // Calcola l'offset della telecamera tenendo conto della rotazione del globo
    const globeRotationMatrix = new THREE.Matrix4().makeRotationY(this.globe.rotation.y);
    const rotatedStartPoint = startPoint.clone().applyMatrix4(globeRotationMatrix);
    const rotatedMidPoint = midPoint.clone().applyMatrix4(globeRotationMatrix);
    const rotatedEndPoint = endPoint.clone().applyMatrix4(globeRotationMatrix);
  
    // Crea un elemento nella coda di zoom
    const zoomItem: ZoomQueueItem = {
      attack,
      startPosition: this.getZoomCameraPosition(rotatedStartPoint, 2.0),
      midPosition: this.getZoomCameraPosition(rotatedMidPoint, 2.5),
      endPosition: this.getZoomCameraPosition(rotatedEndPoint, 2.0),
      duration: attackVisual.lifetime * 0.8,
      state: 'active',
      followProgress: 0,
      startTime: Date.now()
    };
    
    // Inizia immediatamente lo zoom
    this.currentZoomItem = zoomItem;
    this.isZooming = true;
    
    // Salva la posizione attuale della camera per l'interpolazione
    this.initialCameraPosition.copy(this.camera.position);
    this.initialCameraLookAt.copy(this.controls.target);
    
    // Disabilita temporaneamente i controlli manuali durante lo zoom
    this.controls.enabled = false;
  }

  // Ottieni la posizione della camera in base a un punto sulla superficie del globo
  private getZoomCameraPosition(point: THREE.Vector3, distanceFactor: number): THREE.Vector3 {
    // Calcola la posizione dalla quale guardare il punto target
    const dir = point.clone().normalize();
    const cameraPos = dir.multiplyScalar(this.radius * distanceFactor);
    return cameraPos;
  }
 

  // Aggiorna l'animazione di zoom durante il ciclo di rendering
  private updateZoom(delta: number): void {
    if (!this.isZooming || !this.currentZoomItem) {
      return;
    }

    const item = this.currentZoomItem;
    const now = Date.now();
    const elapsed = now - (item.startTime || now);
    const progress = Math.min(elapsed / item.duration, 1.0);
    
    // Aggiorna il progresso di tracciamento dell'attacco
    item.followProgress = progress;

    // Calcola la posizione della camera per seguire l'attacco
    const attackVisual = this.activeAttacks.get(item.attack.id);
    
    if (attackVisual) {
      // Controlla se l'attacco è ancora attivo
      const attackAge = now - attackVisual.startTime;
      
      // Se l'attacco è terminato o la durata dell'animazione è completata
      if (attackAge >= attackVisual.lifetime || progress >= 1.0) {
        // Completa l'animazione
        this.completeCurrentZoom();
        return;
      }

      // Calcola la posizione corrente lungo la curva dell'attacco
      // basata sullo stato di avanzamento delle particelle
      let particleProgress = 0;
      const particleData = attackVisual.particles.userData['particles'];
      
      if (particleData) {
        // Calcola il progresso medio delle particelle
        let totalProgress = 0;
        let particleCount = 0;
        
        for (const particle of particleData) {
          if (particle.t < 1.0) { // Considera solo le particelle non arrivate
            totalProgress += particle.t;
            particleCount++;
          }
        }
        
        if (particleCount > 0) {
          particleProgress = totalProgress / particleCount;
        } else {
          particleProgress = 1.0; // Tutte le particelle sono arrivate
        }
      }

      // Usa il progresso delle particelle per determinare la posizione dell'animazione
      let cameraPos: THREE.Vector3;
      let lookAtPos: THREE.Vector3;
      
      if (particleProgress < 0.5) {
        // Prima metà del percorso: dall'origine al punto medio
        const t = particleProgress * 2; // Normalizza da 0-0.5 a 0-1
        cameraPos = new THREE.Vector3().lerpVectors(item.startPosition, item.midPosition, t);
        
        // Ottieni il punto corrente sulla curva come target
        const curvePos = attackVisual.curve.getPoint(particleProgress);
        // Applica la rotazione del globo
        const rotatedCurvePos = curvePos.clone();
        const globeRotationMatrix = new THREE.Matrix4().makeRotationY(this.globe.rotation.y);
        rotatedCurvePos.applyMatrix4(globeRotationMatrix);
        lookAtPos = rotatedCurvePos;
      } else {
        // Seconda metà del percorso: dal punto medio alla destinazione
        const t = (particleProgress - 0.5) * 2; // Normalizza da 0.5-1 a 0-1
        cameraPos = new THREE.Vector3().lerpVectors(item.midPosition, item.endPosition, t);
        
        // Ottieni il punto corrente sulla curva come target
        const curvePos = attackVisual.curve.getPoint(particleProgress);
        // Applica la rotazione del globo
        const rotatedCurvePos = curvePos.clone();
        const globeRotationMatrix = new THREE.Matrix4().makeRotationY(this.globe.rotation.y);
        rotatedCurvePos.applyMatrix4(globeRotationMatrix);
        lookAtPos = rotatedCurvePos;
      }

      // Applica l'easing per una transizione più fluida
      const smoothT = this.easeInOutCubic(progress);
      
      // Aggiorna la posizione della camera
      this.camera.position.copy(cameraPos);
      this.controls.target.copy(lookAtPos);
      this.controls.update();
    } else {
      // Se l'attacco non è più attivo, termina l'animazione
      this.completeCurrentZoom();
    }
  }

  // Completa l'animazione di zoom corrente
  private completeCurrentZoom(): void {
    if (!this.currentZoomItem) return;
    
    // Segna l'elemento come completato
    this.currentZoomItem.state = 'completed';
    this.currentZoomItem = null;
    
    // Avvia il reset della camera alla posizione originale
    this.startCameraReset();
  }

  // Avvia il reset della camera alla posizione di default
  private startCameraReset(): void {
    this.isZooming = false;
    this.cameraIsResetting = true;
    this.cameraResetStartTime = Date.now();
    
    // Salva la posizione attuale della camera per l'interpolazione
    this.initialCameraPosition.copy(this.camera.position);
    this.initialCameraLookAt.copy(this.controls.target);
  }

  // Aggiorna l'animazione di reset della camera
  private updateCameraReset(): void {
    if (!this.cameraIsResetting) return;
    
    const now = Date.now();
    const elapsed = (now - this.cameraResetStartTime) / 1000; // in secondi
    
    if (elapsed >= this.cameraResetDuration) {
      // Reset completato
      this.camera.position.copy(this.defaultCameraPosition);
      this.controls.target.copy(this.defaultLookAt);
      this.cameraIsResetting = false;
      this.controls.enabled = true; // Riabilita i controlli manuali
      return;
    }
    
    // Interpola tra la posizione corrente e quella di default
    const t = elapsed / this.cameraResetDuration;
    const smoothT = this.easeInOutCubic(t);
    
    // Aggiorna la posizione della camera
    this.camera.position.lerpVectors(
      this.initialCameraPosition,
      this.defaultCameraPosition,
      smoothT
    );
    
    // Aggiorna il punto di mira
    this.controls.target.lerpVectors(
      this.initialCameraLookAt,
      this.defaultLookAt,
      smoothT
    );
    
    this.controls.update();
  }

  private showPopup(attack: Attack): void {
    // Update popup data in Angular zone to trigger change detection
    this.ngZone.run(() => {
      this.popupData = {
        show: true,
        attack: attack,
        position: null // Position will be calculated in the next frame
      };

      // Hide popup after timeout
      setTimeout(() => {
        if (this.popupData.attack === attack) {
          this.popupData.show = false;
        }
      }, environment.popup.duration);
    });
  }

  // Update statistics displayed in the UI
  private updateStats(): void {
    // Get most attacked countries
    this.topAttackedCountries = this.worldDataService.getTopAttackedCountries(10);

    // Get statistics by attack type
    const attackStats = this.attackService.getAttackStats();
    this.attackTypeStats = [];

    attackStats.forEach((count, type) => {
      this.attackTypeStats.push({ type, count });
    });

    // Sort by count in descending order
    this.attackTypeStats.sort((a, b) => b.count - a.count);
  }

  private animate(): void {
    this.animationFrameId = requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();

    // Aggiorna le animazioni di zoom
    if (this.isZooming) {
      this.updateZoom(delta);
    } else if (this.cameraIsResetting) {
      this.updateCameraReset();
    } else {
      // Aggiorna i controlli orbitali solo se non si sta zoomando
      this.controls.update();
    }

    // Rotate globe slowly
    this.globe.rotation.y += this.rotationSpeed;

    // Rotate stars to match earth rotation but at diverse speeds
    this.stars.forEach(starLayer => {
      const speedFactor = starLayer.userData['speedFactor'];
      starLayer.rotation.y -= this.rotationSpeed * speedFactor;
    });

    // Handle active attacks
    const now = Date.now();
    this.activeAttacks.forEach((attackVisual, id) => {
      const age = now - attackVisual.startTime;

      // Remove expired attacks
      if (age > attackVisual.lifetime) {
        // Rimuovi la linea
        if (attackVisual.line) {
          this.globe.remove(attackVisual.line);
          if (attackVisual.line.geometry) {
            attackVisual.line.geometry.dispose();
          }
          if (attackVisual.line.material) {
            if (Array.isArray(attackVisual.line.material)) {
              attackVisual.line.material.forEach(m => m.dispose());
            } else {
              attackVisual.line.material.dispose();
            }
          }
        }

        // Rimuovi le particelle
        if (attackVisual.particles) {
          this.globe.remove(attackVisual.particles);
          if (attackVisual.particles.geometry) {
            attackVisual.particles.geometry.dispose();
          }
          if (attackVisual.particles.material) {
            if (Array.isArray(attackVisual.particles.material)) {
              attackVisual.particles.material.forEach(m => m.dispose());
            } else {
              attackVisual.particles.material.dispose();
            }
          }
        }

        // Rimuovi i marker direzionali
        if (attackVisual.directionMarkers) {
          this.globe.remove(attackVisual.directionMarkers);
          if (attackVisual.directionMarkers.geometry) {
            attackVisual.directionMarkers.geometry.dispose();
          }
          if (attackVisual.directionMarkers.material) {
            if (Array.isArray(attackVisual.directionMarkers.material)) {
              attackVisual.directionMarkers.material.forEach(m => m.dispose());
            } else {
              attackVisual.directionMarkers.material.dispose();
            }
          }
        }

        // Rimuovi gli effetti di impatto
        if (attackVisual.impactEffects && attackVisual.impactEffects.length > 0) {
          attackVisual.impactEffects.forEach(effect => {
            this.globe.remove(effect);
            if (effect instanceof THREE.Mesh || effect instanceof THREE.Points) {
              if (effect.geometry) {
                effect.geometry.dispose();
              }
              if (effect.material) {
                if (Array.isArray(effect.material)) {
                  effect.material.forEach(m => m.dispose());
                } else {
                  effect.material.dispose();
                }
              }
            }
          });
          // Svuota l'array degli effetti
          attackVisual.impactEffects = [];
        }

        this.activeAttacks.delete(id);
        return;
      }

      // Se l'attacco è completo, aggiorna solo gli effetti di impatto
      if (attackVisual.completed) {
        this.updateImpactEffects(attackVisual, age);
        return;
      }

      // Animate particles along the curve
      const positions = (attackVisual.particles.geometry as THREE.BufferGeometry).attributes['position'].array;
      const particleCount = positions.length / 3;
      const curve = attackVisual.curve;
      const particleData = attackVisual.particles.userData['particles'];
      let allParticlesArrived = true;

      // Aggiornare la posizione di ogni particella lungo la curva
      for (let i = 0; i < particleCount; i++) {
        const particle = particleData[i];
        particle.t += particle.speed;

        // Se la particella ha raggiunto la destinazione, tenerla lì
        if (particle.t >= 1) {
          particle.t = 1;
        } else {
          // Se almeno una particella non è ancora arrivata, l'attacco non è completo
          allParticlesArrived = false;
        }

        // Calcola la nuova posizione lungo la curva
        const pos = curve.getPoint(particle.t);

        // Aggiorna la posizione della particella
        positions[i * 3] = pos.x;
        positions[i * 3 + 1] = pos.y;
        positions[i * 3 + 2] = pos.z;
      }

      // Se tutte le particelle sono arrivate e l'attacco non è ancora segnato come completato
      if (allParticlesArrived && !attackVisual.completed) {
        attackVisual.completed = true;

        // Crea l'effetto di impatto al punto di destinazione
        const targetPos = curve.getPoint(1);
        const color = this.getColorForAttackType(attackVisual.attack.type);
        const impactEffects = this.createImpactEffect(targetPos, color, attackVisual.attack.intensity);

        // Memorizza gli effetti di impatto
        attackVisual.impactEffects = impactEffects;
      }

      // Aggiorna la geometria per visualizzare le nuove posizioni
      (attackVisual.particles.geometry as THREE.BufferGeometry).attributes['position'].needsUpdate = true;

      // Blink effect for high-intensity attacks
      if (attackVisual.attack.intensity >= environment.popup.intensityThreshold) {
        const blinkFrequency = 100 + (10 - attackVisual.attack.intensity) * 50; // Higher intensity = faster blinking
        const blink = Math.sin(age / blinkFrequency) > 0;

        (attackVisual.line.material as THREE.LineDashedMaterial).opacity = blink ? 0.9 : 0.4;
        (attackVisual.particles.material as THREE.PointsMaterial).opacity = blink ? 1 : 0.5;
      }
    });

    // Calculate screen position for popup
    if (this.popupData.show && this.popupData.attack) {
      const targetPos = this.latLongToVector3(
        this.popupData.attack.target.lat,
        this.popupData.attack.target.lng,
        this.radius
      );

      // Crea un vettore che tenga conto della rotazione del globo
      const rotatedPos = targetPos.clone();

      // Applica la stessa rotazione del globo
      const globeRotationMatrix = new THREE.Matrix4().makeRotationY(this.globe.rotation.y);
      rotatedPos.applyMatrix4(globeRotationMatrix);

      // Project 3D position to 2D screen coordinates
      rotatedPos.project(this.camera);

      // Convert to pixel coordinates
      const x = (rotatedPos.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-rotatedPos.y * 0.5 + 0.5) * window.innerHeight;

      // Update popup position in Angular zone
      if (this.popupData.position?.x !== x || this.popupData.position?.y !== y) {
        this.ngZone.run(() => {
          this.popupData.position = { x, y };
        });
      }
    }

    // Render the scene
    this.renderer.render(this.scene, this.camera);
  }

  private updateImpactEffects(attackVisual: AttackVisual, age: number): void {
    // Tempo trascorso dall'impatto
    const impactAge = age - (attackVisual.lifetime / 2);

    // Fattore di vita (1.0 all'inizio, 0.0 alla fine)
    const lifeFactor = Math.max(0, 1 - (impactAge / (attackVisual.lifetime / 2)));
    const lifeFactorSmooth = this.easeOutQuart(lifeFactor); // Applicazione di easing

    attackVisual.impactEffects.forEach((effect) => {
      // Effetto sfera luminosa pulsante
      if (effect instanceof THREE.Mesh && effect.geometry instanceof THREE.SphereGeometry) {
        // Pulse effect
        const pulseScale = 1 + (0.2 * Math.sin(impactAge / 100));
        effect.scale.set(pulseScale, pulseScale, pulseScale);

        // Dissolvenza
        (effect.material as THREE.MeshBasicMaterial).opacity = lifeFactorSmooth * 0.7;
      }
      // Effetto point light
      else if (effect instanceof THREE.PointLight) {
        // Pulse intensity
        effect.intensity = lifeFactorSmooth * (2 + attackVisual.attack.intensity / 2) *
          (0.8 + 0.2 * Math.sin(impactAge / 80));
      }
      // Anelli in espansione
      else if (effect instanceof THREE.Mesh && effect.geometry instanceof THREE.RingGeometry) {
        const initialDelay = effect.userData['initialDelay'] || 0;

        // Aspetta il ritardo iniziale
        if (impactAge > initialDelay) {
          const effectAge = impactAge - initialDelay;
          const expansionSpeed = effect.userData['expansionSpeed'] || 0.1;

          // Espansione
          const scale = 1 + (effectAge * expansionSpeed);
          effect.scale.set(scale, scale, scale);

          // Dissolvenza con easing
          const ringLifefactor = Math.max(0, 1 - (effectAge / (attackVisual.lifetime / 1.5)));
          (effect.material as THREE.MeshBasicMaterial).opacity = ringLifefactor * 0.6;
        }
      }
      // Sistema di particelle
      else if (effect instanceof THREE.Points) {
        const positions = (effect.geometry as THREE.BufferGeometry).attributes['position'].array;
        const velocities = effect.userData['velocities'];
        const lifespans = effect.userData['lifespans'];
        const startTimes = effect.userData['startTimes'];
        const particleCount = velocities.length;
        const now = Date.now();

        for (let i = 0; i < particleCount; i++) {
          const particleAge = now - startTimes[i];

          // Aggiorna solo se la particella è attiva
          if (particleAge > 0 && particleAge < lifespans[i]) {
            const particleLifeFactor = 1 - (particleAge / lifespans[i]);

            // Aggiorna posizione con velocità decelerata
            positions[i * 3] += velocities[i].x * particleLifeFactor;
            positions[i * 3 + 1] += velocities[i].y * particleLifeFactor;
            positions[i * 3 + 2] += velocities[i].z * particleLifeFactor;

            // Rallentamento graduale
            velocities[i].multiplyScalar(0.97);
          }
        }

        (effect.geometry as THREE.BufferGeometry).attributes['position'].needsUpdate = true;

        // Dissolvenza generale
        if (effect.material instanceof THREE.ShaderMaterial) {
          effect.material.opacity = lifeFactorSmooth;
        } else if (effect.material instanceof THREE.PointsMaterial) {
          effect.material.opacity = lifeFactorSmooth * 0.8;
        }
      }
    });
  }

  // Funzioni di easing per animazioni fluide
  private easeInOutCubic(x: number): number {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  private easeOutQuart(x: number): number {
    return 1 - Math.pow(1 - x, 4);
  }
}