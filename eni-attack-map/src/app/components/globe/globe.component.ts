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
  curve: THREE.QuadraticBezierCurve3;
  currentLinePoint: number; // Nuovo campo per tracciare il punto attuale
  linePoints: THREE.Vector3[]; // Array di punti per la linea
}

interface Pagination {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
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
  state: 'pending' | 'active' | 'completed'; // Aggiunto 'pending' per la transizione iniziale
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
  private starCount = 120000; // Numero di stelle nello sfondo

  // Globe parameters
  private radius = environment.globe.radius;
  private segments = environment.globe.segments;
  private rotationSpeed = environment.globe.rotationSpeed;

  // Visual effects
  private activeAttacks: Map<string, AttackVisual> = new Map();
  private attackColors: Record<string, THREE.Color> = {
    'DoS': new THREE.Color(0xff3333),        // Bright Red
    'Malware': new THREE.Color(0xffaa22),    // Vibrant Orange
    'Phishing': new THREE.Color(0xffff44),   // Bright Yellow
    'Ransomware': new THREE.Color(0xff66ff), // Vibrant Magenta
    'SQL Injection': new THREE.Color(0x44ffff) // Bright Cyan
  };

  // Animation and rendering
  private animationFrameId: number = 0;

  // Nuova coda di zoom e variabili correlate
  private zoomQueue: ZoomQueueItem[] = [];
  private isZooming: boolean = false;
  private currentZoomItem: ZoomQueueItem | null = null;
  private initialCameraPosition = new THREE.Vector3();
  private initialCameraLookAt = new THREE.Vector3();
  private defaultCameraPosition = new THREE.Vector3(250, 250, 100);
  private defaultLookAt = new THREE.Vector3(0, 0, 0);
  private cameraIsResetting: boolean = false;
  private cameraResetStartTime: number = 0;
  private cameraResetDuration: number = 2.0; // secondi
  private cameraResetMidPoint: THREE.Vector3 = new THREE.Vector3(250, 250, 100);
  // Popup for attack information
  popupData: PopupData = {
    show: false,
    attack: null,
    position: null
  };
  pastAttacks: Attack[] = [];
  pastAttacksPagination: Pagination = {
    currentPage: 1,
    totalPages: 1,
    pageSize: 10,
    totalItems: 0
  };
  // Statistics data
  topAttackedCountries: Array<{ code: string, name: string, attacks: number }> = [];
  attackTypeStats: Array<{ type: string, count: number }> = [];

  // Europe focus variables
  isEuropeFocused: boolean = false;
  originalRotationSpeed: number = 0;
  europePosition = new THREE.Vector3(350, 350, -100);
  europeLookAt = new THREE.Vector3(0, 0, 0);
  private europeFocusTarget: THREE.Vector3 = new THREE.Vector3();
  private europeFocusCamera: THREE.Vector3 = new THREE.Vector3();
  private europeFocusAnimationComplete: boolean = false;
  //Subscriptions
  private subscriptions: Subscription[] = [];

  constructor(
    private attackService: AttackService,
    private worldDataService: WorldDataService,
    private ngZone: NgZone
  ) { }

  ngOnInit(): void {
    this.updateStats();
    this.loadPastAttacks();
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

  loadPastAttacks(page: number = 1): void {
    const { attacks, totalCount } = this.attackService.getPastAttacks(page, this.pastAttacksPagination.pageSize);
    this.pastAttacks = attacks;

    // Aggiorna la paginazione
    this.pastAttacksPagination = {
      currentPage: page,
      pageSize: this.pastAttacksPagination.pageSize,
      totalItems: totalCount,
      totalPages: Math.ceil(totalCount / this.pastAttacksPagination.pageSize)
    };
  }

  // Metodi per la navigazione tra le pagine
  goToPage(page: number): void {
    if (page >= 1 && page <= this.pastAttacksPagination.totalPages) {
      this.loadPastAttacks(page);
    }
  }

  nextPage(): void {
    if (this.pastAttacksPagination.currentPage < this.pastAttacksPagination.totalPages) {
      this.goToPage(this.pastAttacksPagination.currentPage + 1);
    }
  }

  prevPage(): void {
    if (this.pastAttacksPagination.currentPage > 1) {
      this.goToPage(this.pastAttacksPagination.currentPage - 1);
    }
  }

  // Metodo per ottenere la classe CSS in base al tipo di attacco
  getAttackTypeClass(type: string): string {
    return type.toLowerCase().replace(' ', '-');
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

    // Set initial camera position to see the upper hemisphere with Europe
    // Position the camera looking at Europe (roughly 45° north, 10° east)
    this.camera.position.set(
      250,  // X coordinate (negative to move camera left)
      250,   // Y coordinate (positive to move camera up)
      -100    // Z coordinate (positive to move camera back)
    );

    this.initialCameraPosition.copy(this.camera.position);
    this.initialCameraLookAt.set(0, 0, 0);

    // Save the default position for resets
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
    // Increase ambient light intensity for more uniformity
    const ambientLight = new THREE.AmbientLight(0x404040, 5);
    this.scene.add(ambientLight);

    // Add directional lights from various angles for more even illumination
    const createDirectionalLight = (x: number, y: number, z: number, intensity: number) => {
      const light = new THREE.DirectionalLight(0xFFAE00, intensity);
      light.position.set(x, y, z).normalize();
      this.scene.add(light);
      return light;
    };

    // Lights from various directions with adjusted intensity
    createDirectionalLight(1, 1, 1, 4);
    createDirectionalLight(-1, 1, 1, 4);
    createDirectionalLight(1, -1, 1, 4);
    createDirectionalLight(-1, -1, 1, 4);

    // Weaker back lights
    createDirectionalLight(-1, 0, -1, 6);
    createDirectionalLight(1, 0, -1, 6);
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
      specular: new THREE.Color(0xffffff),
      shininess: 30,

    });

    // Create globe mesh and add to scene
    this.globe = new THREE.Mesh(geometry, material);
    this.scene.add(this.globe);

  }

  // Sostituzione del metodo createStarField esistente
  private createStarField(): void {
    // Crea tre layer di stelle a distanze differenti per un effetto di profondità migliore
    this.createStarLayer(this.starCount * 0.9, 500, 0.9);
    this.createStarLayer(this.starCount * 0.6, 700, 0.8); // Layer esterno più distante e lento
    this.createStarLayer(this.starCount * 0.3, 900, 0.5); // Layer medio ancora più distante
    this.createStarLayer(this.starCount * 0.1, 1100, 0.3); // Layer interno molto distante e quasi fermo
  }

  private createStarLayer(count: number, radius: number, speedFactor: number): void {
    // Geometria per le stelle
    const starsGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(count * 3);
    const starColors = new Float32Array(count * 3);
    const starSizes = new Float32Array(count);

    // Generazione casuale di posizioni delle stelle (distribuzione migliorata)
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      // Posizione sferica casuale con distribuzione più uniforme
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      // Aggiungi un po' di varianza al raggio per evitare che tutte le stelle 
      // siano esattamente alla stessa distanza
      const radiusVariance = radius * (0.95 + Math.random() * 0.1);

      starPositions[i3] = radiusVariance * Math.sin(phi) * Math.cos(theta);
      starPositions[i3 + 1] = radiusVariance * Math.sin(phi) * Math.sin(theta);
      starPositions[i3 + 2] = radiusVariance * Math.cos(phi);

      // Colori variabili per le stelle (bianco, azzurro, giallastro)
      const colorChoice = Math.random();
      if (colorChoice < 0.6) {
        // Stelle bianche (60%)
        starColors[i3] = 0.9 + Math.random() * 0.1;       // Varia leggermente
        starColors[i3 + 1] = 0.9 + Math.random() * 0.1;
        starColors[i3 + 2] = 0.9 + Math.random() * 0.1;
      } else if (colorChoice < 0.8) {
        // Stelle azzurre (20%)
        starColors[i3] = 0.7 + Math.random() * 0.1;
        starColors[i3 + 1] = 0.8 + Math.random() * 0.1;
        starColors[i3 + 2] = 0.9 + Math.random() * 0.1;
      } else {
        // Stelle giallastre (20%)
        starColors[i3] = 0.9 + Math.random() * 0.1;
        starColors[i3 + 1] = 0.8 + Math.random() * 0.1;
        starColors[i3 + 2] = 0.6 + Math.random() * 0.1;
      }

      // Dimensioni inversamente proporzionali alla distanza per dare l'impressione di profondità
      starSizes[i] = Math.random() * 1.5 + 0.5;
    }

    starsGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starsGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    starsGeometry.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));

    // Materiale per le stelle con opacità ridotta per un look più naturale
    const starsMaterial = new THREE.PointsMaterial({
      size: 0.8,
      transparent: true,
      opacity: 0.7,
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

    // Set initial rotation to show Europe
    this.controls.target.set(0, 0, 0);
    this.controls.update();
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

    // Get color based on attack type
    const color = this.getColorForAttackType(attack.type);

    // Create line material with gradient effect
    // Usiamo LineDashedMaterial per un effetto tratteggiato che aiuta a visualizzare la direzione
    const initialPoint = [sourcePos.x, sourcePos.y, sourcePos.z];
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(initialPoint, 3));

    // Crea il materiale della linea come prima
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

    // Crea una texture per le particelle (più grande per permettere il bagliore)
    const particleTexture = this.createParticleTexture();

    // Create particle material with texture
    const particleMaterial = new THREE.PointsMaterial({
      color: color,
      size: 2.5 + (attack.intensity * 0.2),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      map: particleTexture, // Usa la texture circolare con bagliore
      depthWrite: false // Imposta a false per evitare problemi di rendering con la trasparenza
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

    // Aggiungi le particelle al globo invece che alla scena
    this.globe.add(particles);

    // Preparare l'array per gli effetti di impatto (inizialmente vuoto)
    const impactEffects: THREE.Object3D[] = [];

    // Store reference to attack visualization
    this.activeAttacks.set(attack.id, {
      line,
      particles,
      curve,
      impactEffects,
      startTime: Date.now(),
      attack,
      lifetime: 5000 + (attack.intensity * 300),
      completed: false,
      currentLinePoint: 0, // Aggiungi questa proprietà per tenere traccia del punto attuale della linea
      linePoints: [sourcePos.clone()] // Aggiungi un array per memorizzare i punti della linea
    });
  }

  private createParticleTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    const size = 128; // Aumentato per maggiore dettaglio
    canvas.width = size;
    canvas.height = size;

    const context = canvas.getContext('2d');
    if (context) {
      // Crea un gradiente radiale per un bagliore morbido
      const gradient = context.createRadialGradient(
        size / 2, size / 2, 0,
        size / 2, size / 2, size / 2
      );

      // Aggiungiamo più stop per un bagliore più raffinato
      gradient.addColorStop(0.0, 'rgba(255,255,255,1.0)'); // Centro bianco brillante
      gradient.addColorStop(0.2, 'rgba(255,255,255,0.9)'); // Anello interno quasi bianco
      gradient.addColorStop(0.4, 'rgba(255,255,255,0.5)'); // Bagliore medio
      gradient.addColorStop(0.6, 'rgba(255,255,255,0.2)'); // Bagliore esterno debole
      gradient.addColorStop(1.0, 'rgba(255,255,255,0)');   // Completamente trasparente ai bordi

      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);

      // Aggiungi un elemento di brillantezza al centro
      context.beginPath();
      context.arc(size / 2, size / 2, size / 8, 0, Math.PI * 2);
      context.fillStyle = 'rgba(255,255,255,0.8)';
      context.fill();
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
      blending: THREE.AdditiveBlending,
      depthTest: true
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
      depthTest: true,
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

  private addToZoomQueue(attack: Attack): void {
    // Ottieni la curva per questo attacco
    const attackVisual = this.activeAttacks.get(attack.id);
    if (!attackVisual) return;

    // If we're currently focusing on Europe, cancel that first
    if (this.isEuropeFocused) {
      this.endEuropeFocus();
    }

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
      state: 'pending',  // Cambiato da 'active' a 'pending'
      followProgress: 0,
      startTime: Date.now()
    };

    // Salva la posizione attuale della camera per l'interpolazione
    this.initialCameraPosition.copy(this.camera.position);
    this.initialCameraLookAt.copy(this.controls.target);

    // Imposta lo zoom item corrente e avvia la transizione
    this.currentZoomItem = zoomItem;
    this.isZooming = true;

    // Disabilita temporaneamente i controlli manuali durante lo zoom
    this.controls.enabled = false;
  }

  private updateInitialTransition(item: ZoomQueueItem, now: number): boolean {
    if (item.state !== 'pending') return false;

    // Calcola il tempo trascorso per la transizione iniziale (aumentato a 700ms per maggiore fluidità)
    const initialTransitionDuration = 700; // 700ms per la transizione iniziale
    const elapsed = now - (item.startTime || now);
    const progress = Math.min(elapsed / initialTransitionDuration, 1.0);

    // Se la transizione iniziale è completata
    if (progress >= 1.0) {
      item.state = 'active';
      return false;
    }

    // Calcola la posizione della camera con easing più fluido
    const smoothT = this.easeOutQuint(progress);

    // Calcola un punto intermedio per evitare transizioni brusche
    const attackVisual = this.activeAttacks.get(item.attack.id);
    if (!attackVisual) return false;

    // Calcola un percorso arcuato invece di una linea retta
    // Ottieni la direzione normalizzata dalla posizione corrente al target
    const dirToTarget = new THREE.Vector3().subVectors(item.startPosition, this.initialCameraPosition).normalize();

    // Calcola un punto alto intermedio
    const midDistance = this.initialCameraPosition.distanceTo(item.startPosition) * 0.5;
    const upVector = new THREE.Vector3(0, 1, 0); // Vettore "up" generico

    // Crea un offset perpendicolare alla direzione di movimento
    const perpOffset = new THREE.Vector3().crossVectors(dirToTarget, upVector).normalize();
    perpOffset.multiplyScalar(midDistance * 0.2); // 20% di offset laterale

    // Punto alto intermedio (più alto del percorso diretto)
    const elevationOffset = new THREE.Vector3(0, midDistance * 0.4, 0); // 40% più alto

    // Calcola il punto intermedio effettivo
    const midPoint = new THREE.Vector3().addVectors(
      this.initialCameraPosition.clone().lerp(item.startPosition, 0.5),
      elevationOffset
    ).add(perpOffset);

    // Usa interpolazione quadratica per seguire un percorso arcuato
    let currentPos;
    if (progress < 0.5) {
      // Prima metà: dalla posizione iniziale al punto intermedio
      const tHalf = progress * 2; // Riscala da 0-0.5 a 0-1
      currentPos = new THREE.Vector3().lerpVectors(
        this.initialCameraPosition,
        midPoint,
        this.easeOutQuint(tHalf)
      );
    } else {
      // Seconda metà: dal punto intermedio alla posizione finale
      const tHalf = (progress - 0.5) * 2; // Riscala da 0.5-1 a 0-1
      currentPos = new THREE.Vector3().lerpVectors(
        midPoint,
        item.startPosition,
        this.easeInOutCubic(tHalf)
      );
    }

    // Applica la posizione calcolata
    this.camera.position.copy(currentPos);

    // Interpola anche il punto di mira
    const curve = attackVisual.curve;
    const startPoint = curve.getPoint(0);

    // Applica la rotazione del globo
    const rotatedStartPoint = startPoint.clone();
    const globeRotationMatrix = new THREE.Matrix4().makeRotationY(this.globe.rotation.y);
    rotatedStartPoint.applyMatrix4(globeRotationMatrix);

    // Interpola verso il punto iniziale dell'attacco
    this.controls.target.lerpVectors(
      this.initialCameraLookAt,
      rotatedStartPoint,
      smoothT
    );

    this.controls.update();
    return true;
  }

  // Metodo updateZoom modificato per includere la transizione iniziale
  private updateZoom(delta: number): void {
    if (!this.isZooming || !this.currentZoomItem) {
      return;
    }

    const item = this.currentZoomItem;
    const now = Date.now();

    // Gestisci prima la transizione iniziale se necessario
    if (this.updateInitialTransition(item, now)) {
      return; // Se stiamo ancora nella transizione iniziale, non procedere oltre
    }

    // Continua con la normale logica di tracciamento dell'attacco
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

      // Traccia solo la prima particella invece della media di tutte
      let particleProgress = 0;
      const particleData = attackVisual.particles.userData['particles'];

      if (particleData && particleData.length > 0) {
        // Usa solo la prima particella per determinare la posizione
        particleProgress = particleData[0].t;

        // Assicurati che non arrivi esattamente a 1.0 per evitare scatti
        if (particleProgress > 0.98) {
          particleProgress = 0.98;
        }
      }

      // Usa il progresso della prima particella per determinare la posizione dell'animazione
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
  // Ottieni la posizione della camera in base a un punto sulla superficie del globo
  private getZoomCameraPosition(point: THREE.Vector3, distanceFactor: number): THREE.Vector3 {
    // Calcola la posizione dalla quale guardare il punto target
    const dir = point.clone().normalize();
    const cameraPos = dir.multiplyScalar(this.radius * distanceFactor);
    return cameraPos;
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

  // Toggle Europe focus method
  toggleEuropeFocus(): void {
    if (this.isEuropeFocused) {
      // Se già focalizzato, disattiva il focus e riprendi la rotazione
      this.endEuropeFocus();
    } else {
      // Altrimenti, attiva il focus sull'Europa
      this.focusOnEurope();
    }
  }

  private focusOnEurope(): void {
    if (this.isEuropeFocused) return;

    this.ngZone.run(() => {
      this.isEuropeFocused = true;

      // Reset animation completion flag
      this.europeFocusAnimationComplete = false;

      // Stop any ongoing zoom or camera reset
      if (this.isZooming || this.cameraIsResetting) {
        this.completeCurrentZoom();
        this.cameraIsResetting = false;
      }

      // Store original rotation speed
      this.originalRotationSpeed = this.rotationSpeed;

      // Stop globe rotation
      this.rotationSpeed = 0;

      // Disable controls
      this.controls.enabled = false;

      // Position the camera looking at Europe
      this.moveToEurope();
    });
  }

  // End Europe focus and resume normal operation
  private endEuropeFocus(): void {
    if (!this.isEuropeFocused) return;

    this.ngZone.run(() => {
      // Reset focus state
      this.isEuropeFocused = false;

      // Reset animation completion flag
      this.europeFocusAnimationComplete = false;

      // Restore original rotation speed
      this.rotationSpeed = this.originalRotationSpeed;

      // Start camera reset to default position
      this.startCameraReset();
    });
  }

  private moveToEurope(): void {
    // Coordinate geografiche dell'Europa
    const europeLatLong = { lat: 45, lng: 10 }; // Centro approssimativo dell'Europa

    // Converti in coordinate 3D (senza applicare la rotazione del globo)
    const europePos = this.latLongToVector3(europeLatLong.lat, europeLatLong.lng, this.radius);

    // Salva questi vettori di riferimento non ruotati per l'aggiornamento continuo
    this.europeFocusTarget = europePos.clone();

    // Calcola la posizione ideale della telecamera (offset dall'Europa)
    this.europeFocusCamera = europePos.clone().normalize().multiplyScalar(this.radius * 2.5);

    // Animazione iniziale verso l'Europa
    const startPosition = this.camera.position.clone();
    const startLookAt = this.controls.target.clone();

    const duration = 2.0;
    const startTime = Date.now();

    const animateToEurope = () => {
      if (!this.isEuropeFocused) return; // Interrompi se l'utente ha annullato il focus

      const elapsed = (Date.now() - startTime) / 1000;

      if (elapsed < duration) {
        // Animazione ancora in corso
        const t = this.easeInOutCubic(elapsed / duration);

        // Calcola la posizione corretta tenendo conto della rotazione attuale del globo
        const rotationMatrix = new THREE.Matrix4().makeRotationY(this.globe.rotation.y);

        // Applica la rotazione ai vettori di riferimento
        const targetPosition = this.europeFocusCamera.clone().applyMatrix4(rotationMatrix);
        const targetLookAt = this.europeFocusTarget.clone().applyMatrix4(rotationMatrix);

        // Interpola la posizione della telecamera
        this.camera.position.lerpVectors(startPosition, targetPosition, t);
        this.controls.target.lerpVectors(startLookAt, targetLookAt, t);
        this.controls.update();

        requestAnimationFrame(animateToEurope);
      } else {
        // L'animazione è completata, inizia il tracciamento continuo
        this.europeFocusAnimationComplete = true;
      }
    };

    animateToEurope();
  }

  private startCameraReset(): void {
    // If we're currently focusing on Europe, update the state
    if (this.isEuropeFocused) {
      this.isEuropeFocused = false;
    }

    this.isZooming = false;
    this.cameraIsResetting = true;
    this.cameraResetStartTime = Date.now();

    // Salva la posizione attuale della camera per l'interpolazione
    this.initialCameraPosition.copy(this.camera.position);
    this.initialCameraLookAt.copy(this.controls.target);

    // Calcola un punto intermedio sicuro per evitare di passare troppo vicino alle stelle
    // Usa una sfera immaginaria che contiene sia la posizione iniziale che quella finale
    const distToDefault = this.initialCameraPosition.distanceTo(this.defaultCameraPosition);
    const midRadius = Math.max(
      this.initialCameraPosition.length(),
      this.defaultCameraPosition.length()
    ) * 1.2; // 20% più grande per sicurezza

    // Calcola un punto intermedio sulla sfera immaginaria
    const midDirection = new THREE.Vector3()
      .addVectors(this.initialCameraPosition.clone().normalize(), this.defaultCameraPosition.clone().normalize())
      .normalize();

    // Memorizza il punto intermedio come proprietà
    this.cameraResetMidPoint = midDirection.clone().multiplyScalar(midRadius);
  }

  // Metodo updateCameraReset completamente rivisto 
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

    // Calcola la percentuale di completamento con easing
    const t = elapsed / this.cameraResetDuration;
    const smoothT = this.easeInOutCubic(t);

    // Usa un percorso curvilineo invece di un'interpolazione lineare
    // Divide il movimento in due fasi
    if (t < 0.5) {
      // Prima metà: dalla posizione iniziale al punto intermedio
      const t1 = smoothT * 2; // Normalizza da 0-0.5 a 0-1
      this.camera.position.lerpVectors(
        this.initialCameraPosition,
        this.cameraResetMidPoint,
        this.easeOutQuint(t1)
      );
    } else {
      // Seconda metà: dal punto intermedio alla posizione finale
      const t2 = (smoothT - 0.5) * 2; // Normalizza da 0.5-1 a 0-1
      this.camera.position.lerpVectors(
        this.cameraResetMidPoint,
        this.defaultCameraPosition,
        this.easeInOutCubic(t2)
      );
    }

    // L'interpolazione del target può rimanere lineare perché è sempre vicino al globo
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
    this.loadPastAttacks(this.pastAttacksPagination.currentPage);
    // Sort by count in descending order
    this.attackTypeStats.sort((a, b) => b.count - a.count);
  }

  // NUOVO METODO: riproduce un attacco passato quando viene cliccato nella lista
  showAttackDetails(attack: Attack): void {
    // Interrompi qualsiasi zoom in corso
    if (this.isZooming || this.cameraIsResetting) {
      this.completeCurrentZoom();
      this.cameraIsResetting = false;
    }

    // Pulisci eventuali attacchi attivi esistenti per evitare sovrapposizioni
    this.activeAttacks.forEach((attackVisual, id) => {
      this.cleanupAttackVisual(attackVisual);
    });
    this.activeAttacks.clear();

    // Crea una copia dell'attacco con timestamp corrente
    const replayAttack: Attack = {
      ...attack,
      id: `replay-${Date.now()}-${attack.id}`, // Crea un ID univoco
      timestamp: new Date() // Aggiorna il timestamp all'ora corrente
    };

    // Crea la visualizzazione dell'attacco
    this.createAttackVisualization(replayAttack);

    // Aggiungi alla coda di zoom (indipendentemente dall'intensità)
    const attackVisual = this.activeAttacks.get(replayAttack.id);
    if (attackVisual) {
      this.addToZoomQueue(replayAttack);
      this.showPopup(replayAttack);
    }
  }

  // NUOVO METODO: pulisce le risorse di un attacco visuale
  private cleanupAttackVisual(attackVisual: AttackVisual): void {
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
    }
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
        this.cleanupAttackVisual(attackVisual);
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
      let furthestPoint = 0;

      // Aggiornare la posizione di ogni particella lungo la curva
      for (let i = 0; i < particleCount; i++) {
        const particle = particleData[i];
        particle.t += particle.speed;

        // Tieni traccia del punto più avanzato lungo la curva
        if (particle.t > furthestPoint) {
          furthestPoint = particle.t;
        }

        // Se la particella ha raggiunto la destinazione, tenerla lì
        if (particle.t >= 1) {
          particle.t = 1;
        } else {
          // Solo se almeno una particella non è ancora arrivata, l'attacco non è completo
          allParticlesArrived = false;
        }

        // Calcola la nuova posizione lungo la curva
        const pos = curve.getPoint(particle.t);

        // Aggiorna la posizione della particella
        positions[i * 3] = pos.x;
        positions[i * 3 + 1] = pos.y;
        positions[i * 3 + 2] = pos.z;
      }

      if (!attackVisual.completed && furthestPoint > attackVisual.currentLinePoint) {
        // Calcola quanti nuovi punti aggiungere alla linea
        const numPoints = Math.ceil((furthestPoint - attackVisual.currentLinePoint) * 50); // Moltiplicatore per il numero di punti

        if (numPoints > 0) {
          for (let i = 1; i <= numPoints; i++) {
            const t = attackVisual.currentLinePoint + (i * (furthestPoint - attackVisual.currentLinePoint) / numPoints);
            if (t <= 1.0) {
              const newPoint = curve.getPoint(Math.min(t, 1.0));
              attackVisual.linePoints.push(newPoint);
            }
          }

          // Aggiorna la geometria della linea con i nuovi punti
          const positions = new Float32Array(attackVisual.linePoints.length * 3);
          attackVisual.linePoints.forEach((point, i) => {
            positions[i * 3] = point.x;
            positions[i * 3 + 1] = point.y;
            positions[i * 3 + 2] = point.z;
          });

          // Sostituisci la geometria esistente con la nuova
          attackVisual.line.geometry.dispose();
          attackVisual.line.geometry = new THREE.BufferGeometry();
          attackVisual.line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          attackVisual.line.computeLineDistances(); // Necessario per il materiale tratteggiato

          // Aggiorna il punto corrente
          attackVisual.currentLinePoint = furthestPoint;
        }
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
        const pulseSize = 1.0 + 0.2 * Math.sin(age / 200); // Effetto pulsante

        (attackVisual.line.material as THREE.LineDashedMaterial).opacity = blink ? 0.9 : 0.4;
        (attackVisual.particles.material as THREE.PointsMaterial).opacity = blink ? 1 : 0.5;
        // Aggiungi effetto pulsante alla dimensione delle particelle
        (attackVisual.particles.material as THREE.PointsMaterial).size =
          (2.5 + (attackVisual.attack.intensity * 0.2)) * pulseSize;
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

    if (this.isEuropeFocused && this.europeFocusAnimationComplete) {
      // Aggiorna continuamente la posizione della telecamera per seguire l'Europa durante la rotazione
      const rotationMatrix = new THREE.Matrix4().makeRotationY(this.globe.rotation.y);

      // Applica la rotazione corrente ai vettori di riferimento
      const targetPosition = this.europeFocusCamera.clone().applyMatrix4(rotationMatrix);
      const targetLookAt = this.europeFocusTarget.clone().applyMatrix4(rotationMatrix);

      // Imposta direttamente la posizione della telecamera
      this.camera.position.copy(targetPosition);
      this.controls.target.copy(targetLookAt);
      this.controls.update();
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

  // Funzione di Easing migliorata per movimenti più fluidi
  private easeInOutCubic(x: number): number {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  // Aggiungiamo una funzione di easing più dolce per l'inizio
  private easeOutQuint(x: number): number {
    return 1 - Math.pow(1 - x, 5);
  }

  // Aggiunta di una funzione di Easing con elasticità per un effetto più naturale 
  private easeOutElastic(x: number): number {
    const c4 = (2 * Math.PI) / 3;
    return x === 0
      ? 0
      : x === 1
        ? 1
        : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1;
  }

  private easeOutQuart(x: number): number {
    return 1 - Math.pow(1 - x, 4);
  }
}