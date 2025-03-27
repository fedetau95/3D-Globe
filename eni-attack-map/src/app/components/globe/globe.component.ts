import { Component, OnInit, AfterViewInit, ElementRef, ViewChild, OnDestroy, HostListener, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Subscription } from 'rxjs';
import { AttackService, Attack, AttackType } from '../../services/attack.service';
import { WorldDataService } from '../../services/world-data.service';

interface AttackVisual {
  line: THREE.Line;
  particles: THREE.Points;
  startTime: number;
  attack: Attack;
}

interface PopupData {
  show: boolean;
  attack: Attack | null;
  position: { x: number, y: number } | null;
}

@Component({
  selector: 'app-globe',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './globe.component.html',
  styleUrls: ['./globe.component.scss']
})
export class GlobeComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('globeCanvas') private canvasRef!: ElementRef;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private globe!: THREE.Mesh;
  private controls!: OrbitControls;
  private activeAttacks: Map<string, AttackVisual> = new Map();

  // Modello 3D del globo
  private radius = 100;
  private segments = 64;

  // Animazione e rendering
  private animationFrame: number = 0;
  private lastTime: number = 0;

  // Zoom dinamico
  private targetZoom: { position: THREE.Vector3, lookAt: THREE.Vector3 } | null = null;
  private zoomDuration = 1.5; // secondi
  private zoomStartTime = 0;
  private initialCameraPosition = new THREE.Vector3();
  private initialCameraLookAt = new THREE.Vector3();

  // Popup informativo sugli attacchi
  popupData: PopupData = {
    show: false,
    attack: null,
    position: null
  };

  // Statistiche sugli attacchi
  topAttackedCountries: Array<{ code: string, name: string, attacks: number }> = [];
  attackTypeStats: { type: AttackType, count: number }[] = [];

  // Flag per il debug
  private debugMode = false;

  // Subscriptions
  private subscriptions: Subscription[] = [];

  constructor(
    private attackService: AttackService,
    private worldDataService: WorldDataService
  ) { }

  ngOnInit(): void {
    this.updateStats();
  }

  ngAfterViewInit(): void {
    this.initScene();
    this.setupRenderer();
    this.createGlobe();
    this.setupControls();
    this.setupLights();
    this.subscribeToAttacks();
    this.animate(0);

    // Aggiorna le statistiche ogni 5 secondi
    setInterval(() => this.updateStats(), 5000);
  }

  ngOnDestroy(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.renderer.dispose();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.camera && this.renderer) {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  @HostListener('document:keydown.d')
  toggleDebug(): void {
    this.debugMode = !this.debugMode;
    console.log(`Debug mode: ${this.debugMode ? 'enabled' : 'disabled'}`);
  }

  private initScene(): void {
    this.scene = new THREE.Scene();

    // Set up camera
    this.camera = new THREE.PerspectiveCamera(
      60, // FOV
      window.innerWidth / window.innerHeight, // Aspect ratio
      0.1, // Near clipping plane
      1000 // Far clipping plane
    );
    this.camera.position.z = 200;
    this.initialCameraPosition.copy(this.camera.position);
    this.initialCameraLookAt.set(0, 0, 0);
  }

  private setupRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvasRef.nativeElement,
      antialias: true,
      alpha: true
    });

    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
  }

  private setupLights(): void {
    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0x404040, 1);
    this.scene.add(ambientLight);

    // Add directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 1, 1).normalize();
    this.scene.add(directionalLight);

    // Add point light
    const pointLight = new THREE.PointLight(0xffffff, 0.5);
    pointLight.position.set(50, 50, 50);
    this.scene.add(pointLight);
  }

  private createGlobe(): void {
    // Create the globe geometry
    const geometry = new THREE.SphereGeometry(this.radius, this.segments, this.segments);

    // Load Earth texture
    const textureLoader = new THREE.TextureLoader();

    // Earth texture - you'll need to add earth texture images to your assets
    const earthTexture = textureLoader.load('assets/images/earth_texture.jpg');
    const bumpMap = textureLoader.load('assets/images/earth_bump.jpg');
    const specularMap = textureLoader.load('assets/images/earth_specular.jpg');

    const material = new THREE.MeshPhongMaterial({
      map: earthTexture,
      bumpMap: bumpMap,
      bumpScale: 0.5,
      specularMap: specularMap,
      specular: new THREE.Color('grey'),
      shininess: 5
    });

    this.globe = new THREE.Mesh(geometry, material);
    this.scene.add(this.globe);

    // Add a glow effect
    this.addGlowEffect();

    // Add atmosphere effect
    this.addAtmosphere();
  }

  private addGlowEffect(): void {
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
    // Atmosphere is a thin layer of blue around the earth
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
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.rotateSpeed = 0.5;
    this.controls.minDistance = 120;
    this.controls.maxDistance = 300;
    this.controls.enablePan = false;
  }

  private subscribeToAttacks(): void {
    this.subscriptions.push(
      this.attackService.getAttacks().subscribe((attack: Attack) => {
        this.createAttackVisualization(attack);

        // Per gli attacchi ad alta intensità, fai lo zoom automatico
        if (attack.intensity >= 8) {
          this.zoomToAttack(attack);
        }
      })
    );
  }

  private latLongToVector3(lat: number, lon: number, radius: number): THREE.Vector3 {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lon + 180) * Math.PI / 180;

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

    // Create a curve from source to target, extending above the surface
    const midPoint = new THREE.Vector3().addVectors(sourcePos, targetPos).multiplyScalar(0.5);
    const distance = sourcePos.distanceTo(targetPos);
    const altitude = this.radius * 0.3 + (distance / 100) + (attack.intensity * 0.5);

    midPoint.normalize().multiplyScalar(this.radius + altitude);

    const curve = new THREE.QuadraticBezierCurve3(sourcePos, midPoint, targetPos);

    // Create line geometry
    const points = curve.getPoints(50);
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);

    // Different colors for different attack types
    const color = this.getColorForAttackType(attack.type);

    const lineMaterial = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.8,
      linewidth: 1 + attack.intensity / 2 // Thicker for more intense attacks
    });

    const line = new THREE.Line(lineGeometry, lineMaterial);
    this.scene.add(line);

    // Create particles along the line
    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(50 * 3);

    for (let i = 0; i < 50; i++) {
      const point = curve.getPoint(i / 49);
      particlePositions[i * 3] = point.x;
      particlePositions[i * 3 + 1] = point.y;
      particlePositions[i * 3 + 2] = point.z;
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

    const particleMaterial = new THREE.PointsMaterial({
      color: color,
      size: 1.5 + (attack.intensity * 0.1),
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });

    const particles = new THREE.Points(particleGeometry, particleMaterial);
    this.scene.add(particles);

    // Store reference to attack visualization
    this.activeAttacks.set(attack.id, {
      line,
      particles,
      startTime: Date.now(),
      attack
    });

    // Show popup for high-intensity attacks
    if (attack.intensity >= 7) {
      this.showPopup(attack);
    }
  }

  private getColorForAttackType(type: string): THREE.Color {
    switch (type) {
      case 'DoS':
        return new THREE.Color(0xff0000); // Red
      case 'Malware':
        return new THREE.Color(0xff8800); // Orange
      case 'Phishing':
        return new THREE.Color(0xffff00); // Yellow
      case 'Ransomware':
        return new THREE.Color(0xff00ff); // Magenta
      case 'SQL Injection':
        return new THREE.Color(0x00ffff); // Cyan
      default:
        return new THREE.Color(0x00ff00); // Green
    }
  }

  private zoomToAttack(attack: Attack): void {
    // Get the target location in 3D space
    const targetPos = this.latLongToVector3(
      attack.target.lat,
      attack.target.lng,
      this.radius
    );

    // Calculate a position to zoom to
    const zoomVector = targetPos.clone().normalize().multiplyScalar(this.radius * 1.5);

    // Set the target zoom
    this.targetZoom = {
      position: zoomVector,
      lookAt: targetPos
    };

    // Save the current camera position for smooth transition
    this.initialCameraPosition.copy(this.camera.position);
    this.initialCameraLookAt.copy(this.controls.target);

    // Start the zoom animation
    this.zoomStartTime = Date.now();
  }

  private updateZoom(): void {
    if (!this.targetZoom) return;

    const currentTime = Date.now();
    const elapsedTime = (currentTime - this.zoomStartTime) / 1000; // in seconds

    if (elapsedTime >= this.zoomDuration) {
      // Zoom complete
      this.camera.position.copy(this.targetZoom.position);
      this.controls.target.copy(this.targetZoom.lookAt);
      this.targetZoom = null;

      // After 5 seconds, return to the original view
      setTimeout(() => {
        this.resetZoom();
      }, 5000);

      return;
    }

    // Interpola tra la posizione iniziale e quella target
    const t = elapsedTime / this.zoomDuration;
    const smoothT = this.easeInOutCubic(t);

    // Interpola posizione della camera
    this.camera.position.lerpVectors(
      this.initialCameraPosition,
      this.targetZoom.position,
      smoothT
    );

    // Interpola punto di osservazione
    this.controls.target.lerpVectors(
      this.initialCameraLookAt,
      this.targetZoom.lookAt,
      smoothT
    );
  }

  private resetZoom(): void {
    // Imposta il target per tornare alla vista originale
    this.targetZoom = {
      position: new THREE.Vector3(0, 0, 200),
      lookAt: new THREE.Vector3(0, 0, 0)
    };

    // Salva la posizione corrente per l'interpolazione
    this.initialCameraPosition.copy(this.camera.position);
    this.initialCameraLookAt.copy(this.controls.target);

    // Avvia l'animazione di ritorno
    this.zoomStartTime = Date.now();
  }

  // Funzione di easing per animazioni fluide
  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  private showPopup(attack: Attack): void {
    // Mostra il popup con le informazioni sull'attacco
    this.popupData = {
      show: true,
      attack: attack,
      position: null // La posizione verrà calcolata nella prossima frame
    };

    // Dopo 5 secondi, nascondi il popup
    setTimeout(() => {
      if (this.popupData.attack === attack) {
        this.popupData.show = false;
      }
    }, 5000);
  }

  // Aggiorna le statistiche visualizzate
  private updateStats(): void {
    // Ottieni i paesi più attaccati
    this.topAttackedCountries = this.worldDataService.getTopAttackedCountries(10);

    // Ottieni le statistiche per tipo di attacco
    const attackStats = this.attackService.getAttackStats();
    this.attackTypeStats = [];

    attackStats.forEach((count, type) => {
      this.attackTypeStats.push({ type, count });
    });

    // Ordina per conteggio decrescente
    this.attackTypeStats.sort((a, b) => b.count - a.count);
  }

  private animate(time: number): void {
    this.animationFrame = requestAnimationFrame((t) => this.animate(t));

    const deltaTime = time - this.lastTime;
    this.lastTime = time;

    // Aggiorna lo zoom dinamico
    this.updateZoom();

    // Ruota lentamente il globo
    this.globe.rotation.y += 0.0005;

    // Aggiorna i controlli orbitali
    this.controls.update();

    // Gestisci gli attacchi attivi
    const now = Date.now();
    this.activeAttacks.forEach((attackVisual, id) => {
      const age = now - attackVisual.startTime;

      // Se l'attacco è troppo vecchio, rimuovilo
      if (age > 10000) { // 10 secondi di vita
        this.scene.remove(attackVisual.line);
        this.scene.remove(attackVisual.particles);
        this.activeAttacks.delete(id);
        return;
      }

      // Anima le particelle lungo la linea
      const positions = (attackVisual.particles.geometry as THREE.BufferGeometry).attributes['position'].array;
      const particleCount = positions.length / 3;

      // Velocità di movimento proporzionale all'intensità dell'attacco
      const speed = 0.1 + (attackVisual.attack.intensity * 0.05);

      // Muovi le particelle lungo la linea
      for (let i = 0; i < particleCount - 1; i++) {
        positions[i * 3] = positions[(i + 1) * 3];
        positions[i * 3 + 1] = positions[(i + 1) * 3 + 1];
        positions[i * 3 + 2] = positions[(i + 1) * 3 + 2];
      }

      // Effetto blink per attacchi ad alta intensità
      if (attackVisual.attack.intensity >= 7) {
        const blinkFrequency = 100 + (10 - attackVisual.attack.intensity) * 50; // più intenso = lampeggio più veloce
        const blink = Math.sin(age / blinkFrequency) > 0;

        (attackVisual.line.material as THREE.LineBasicMaterial).opacity = blink ? 1 : 0.3;
        (attackVisual.particles.material as THREE.PointsMaterial).opacity = blink ? 1 : 0.3;
      }

      (attackVisual.particles.geometry as THREE.BufferGeometry).attributes['position'].needsUpdate = true;
    });

    // Calcola la posizione dello schermo per il popup
    if (this.popupData.show && this.popupData.attack) {
      const targetPos = this.latLongToVector3(
        this.popupData.attack.target.lat,
        this.popupData.attack.target.lng,
        this.radius
      );

      // Proietta la posizione 3D sullo schermo 2D
      const vector = targetPos.clone();
      vector.project(this.camera);

      // Converte le coordinate normalizzate in pixel
      const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-vector.y * 0.5 + 0.5) * window.innerHeight;

      this.popupData.position = { x, y };
    }

    // Rendering della scena
    this.renderer.render(this.scene, this.camera);
  }
}