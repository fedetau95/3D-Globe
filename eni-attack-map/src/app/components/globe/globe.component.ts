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
  startTime: number;
  attack: Attack;
  lifetime: number;
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

  // Camera animation
  private targetZoom: { position: THREE.Vector3, lookAt: THREE.Vector3 } | null = null;
  private zoomDuration = environment.zoom.duration;
  private zoomStartTime = 0;
  private initialCameraPosition = new THREE.Vector3();
  private initialCameraLookAt = new THREE.Vector3();

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
    this.createStarField(); // Aggiungi questo
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

        // For high-intensity attacks, trigger zoom
        if (attack.intensity >= environment.popup.intensityThreshold) {
          this.zoomToAttack(attack);
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

    // Create a curved path from source to target
    const midPoint = new THREE.Vector3().addVectors(sourcePos, targetPos).multiplyScalar(0.5);
    const distance = sourcePos.distanceTo(targetPos);
    const altitude = this.radius * 0.3 + (distance / 100) + (attack.intensity * 0.5);

    // Adjust midpoint for curve height
    midPoint.normalize().multiplyScalar(this.radius + altitude);

    // Create quadratic curve
    const curve = new THREE.QuadraticBezierCurve3(sourcePos, midPoint, targetPos);

    // Create line geometry following the curve
    const points = curve.getPoints(50);
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);

    // Get color based on attack type
    const color = this.getColorForAttackType(attack.type);

    // Create line material
    const lineMaterial = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.8,
      linewidth: 1 + attack.intensity / 2 // Thicker for more intense attacks
    });

    // Create line mesh
    const line = new THREE.Line(lineGeometry, lineMaterial);
    this.scene.add(line);

    // Create particles to flow along the line
    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(50 * 3);

    // Set initial particle positions along the curve
    for (let i = 0; i < 50; i++) {
      const point = curve.getPoint(i / 49);
      particlePositions[i * 3] = point.x;
      particlePositions[i * 3 + 1] = point.y;
      particlePositions[i * 3 + 2] = point.z;
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

    // Create particle material
    const particleMaterial = new THREE.PointsMaterial({
      color: color,
      size: 1.5 + (attack.intensity * 0.1),
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });

    // Create particle system
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    this.scene.add(particles);

    // Store reference to attack visualization
    this.activeAttacks.set(attack.id, {
      line,
      particles,
      startTime: Date.now(),
      attack,
      lifetime: 10000 + (attack.intensity * 500) // Lifetime based on intensity
    });

    // Show popup for high-intensity attacks
    if (attack.intensity >= environment.popup.intensityThreshold) {
      this.showPopup(attack);
    }
  }

  private getColorForAttackType(type: string): THREE.Color {
    return this.attackColors[type] || new THREE.Color(0x00ff00); // Default to green if type unknown
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

      // After delay, return to original view
      setTimeout(() => {
        this.resetZoom();
      }, environment.zoom.resetDelay);

      return;
    }

    // Interpolate between initial and target positions
    const t = elapsedTime / this.zoomDuration;
    const smoothT = this.easeInOutCubic(t);

    // Update camera position
    this.camera.position.lerpVectors(
      this.initialCameraPosition,
      this.targetZoom.position,
      smoothT
    );

    // Update look-at point
    this.controls.target.lerpVectors(
      this.initialCameraLookAt,
      this.targetZoom.lookAt,
      smoothT
    );
  }

  private resetZoom(): void {
    // Set target to return to original view
    this.targetZoom = {
      position: new THREE.Vector3(0, 0, 200),
      lookAt: new THREE.Vector3(0, 0, 0)
    };

    // Save current position for interpolation
    this.initialCameraPosition.copy(this.camera.position);
    this.initialCameraLookAt.copy(this.controls.target);

    // Start zoom animation
    this.zoomStartTime = Date.now();
  }

  // Easing function for smooth animations
  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
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
  
    // Update dynamic zoom
    this.updateZoom();
  
    // Rotate globe slowly
    this.globe.rotation.y += this.rotationSpeed;
    
    // Rotate stars to match earth rotation but at diverse speeds
    this.stars.forEach(starLayer => {
      const speedFactor = starLayer.userData['speedFactor'];
      starLayer.rotation.y -= this.rotationSpeed * speedFactor;
    });
  
    // Il resto del codice animate rimane uguale...
    
    // Update orbital controls
    this.controls.update();
  
    // Handle active attacks
    const now = Date.now();
    this.activeAttacks.forEach((attackVisual, id) => { 
      const age = now - attackVisual.startTime;

      // Remove expired attacks
      if (age > attackVisual.lifetime) {
        this.scene.remove(attackVisual.line);
        this.scene.remove(attackVisual.particles);
        this.activeAttacks.delete(id);
        return;
      }

      // Animate particles along the line
      const positions = (attackVisual.particles.geometry as THREE.BufferGeometry).attributes['position'].array;
      const particleCount = positions.length / 3;

      // Movement speed proportional to attack intensity
      const speed = 0.1 + (attackVisual.attack.intensity * 0.05);

      // Move particles along the line
      for (let i = 0; i < particleCount - 1; i++) {
        positions[i * 3] = positions[(i + 1) * 3];
        positions[i * 3 + 1] = positions[(i + 1) * 3 + 1];
        positions[i * 3 + 2] = positions[(i + 1) * 3 + 2];
      }

      // Blink effect for high-intensity attacks
      if (attackVisual.attack.intensity >= environment.popup.intensityThreshold) {
        const blinkFrequency = 100 + (10 - attackVisual.attack.intensity) * 50; // Higher intensity = faster blinking
        const blink = Math.sin(age / blinkFrequency) > 0;

        (attackVisual.line.material as THREE.LineBasicMaterial).opacity = blink ? 1 : 0.3;
        (attackVisual.particles.material as THREE.PointsMaterial).opacity = blink ? 1 : 0.3;
      }

      // Update geometry
      (attackVisual.particles.geometry as THREE.BufferGeometry).attributes['position'].needsUpdate = true;
    });

    // Calculate screen position for popup
    if (this.popupData.show && this.popupData.attack) {
      const targetPos = this.latLongToVector3(
        this.popupData.attack.target.lat,
        this.popupData.attack.target.lng,
        this.radius
      );

      // Project 3D position to 2D screen coordinates
      const vector = targetPos.clone();
      vector.project(this.camera);

      // Convert to pixel coordinates
      const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-vector.y * 0.5 + 0.5) * window.innerHeight;

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
}