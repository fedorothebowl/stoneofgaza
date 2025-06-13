  import * as THREE from 'three';
  import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
  import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

  let camera, scene, renderer, labelRenderer, controls;
  const move = { forward: false, back: false, left: false, right: false };
  const speed = 4.0;
  const clock = new THREE.Clock();
  let velocity = new THREE.Vector3();

  // Dati caricati a blocchi
  let TOTAL_COUNT = 0;
  const CHUNK_SIZE = 1000;
  let dataIndex = 0;
  let instancedMesh;
  const items = []; // { basePos: Vector3, en_name, name, age, label?: CSS2DObject }

  // Collisioni
  const colliderBoxes = [];
  const CAMERA_RADIUS = 1.0;

  // Corridoi un terzo più larghi
  const BASE_SPACING = 5;
  const SPACING = BASE_SPACING * (4 / 3);

  // Altezza iniziale e terra
  const START_HEIGHT = 50;
  const GROUND_HEIGHT = 1.6;
  let dropping = false;

  init();

  async function init() {
    try {
      const response = await fetch('https://data.techforpalestine.org/api/v2/killed-in-gaza.json');
      const allData = await response.json();
      TOTAL_COUNT = allData.length;

      setupScene();
      fetchChunks();
      setupControls();
      animate();

      window.addEventListener('resize', onWindowResize);
    } catch (err) {
      console.error('Errore caricamento dati totali:', err);
    }
  }

  function createDarkSky() {
    // Sfera grande per lo skybox chiarito
    const skyGeometry = new THREE.SphereGeometry(500, 32, 32);
    
    const skyMaterial = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform vec3 midColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        
        void main() {
          float h = normalize(vWorldPosition + offset).y;
          
          vec3 color;
          if (h > 0.2) {
            color = mix(midColor, topColor, (h - 0.2) / 0.8);
          } else if (h > -0.3) {
            color = mix(bottomColor, midColor, (h + 0.3) / 0.5);
          } else {
            color = bottomColor;
          }
          
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      uniforms: {
        topColor:    { value: new THREE.Color(0x909090) }, // Grigio chiaro in alto
        midColor:    { value: new THREE.Color(0xa0a0a0) }, // Grigio medio chiaro
        bottomColor: { value: new THREE.Color(0x707070) }, // Grigio non troppo scuro in basso
        offset:      { value: 33 },
        exponent:    { value: 0.4 }                         // Gradiente più dolce
      },
      side: THREE.BackSide
    });
    
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    return sky;
  }


  function setupScene() {
    scene = new THREE.Scene();
    
    // Aggiungo il cielo cupo
    const darkSky = createDarkSky();
    scene.add(darkSky);

    // Nebbia per aumentare l'atmosfera angosciante ma mantenere visibilità
    scene.fog = new THREE.Fog(0x404040, 40, 200);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, START_HEIGHT, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x303030); // Colore di sfondo grigio scuro
    document.body.appendChild(renderer.domElement);

    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    document.body.appendChild(labelRenderer.domElement);

    let count = document.getElementById("sad-count");
    count.innerHTML = TOTAL_COUNT;

    // Illuminazione con più contrasto
    // Luce emisferica per illuminazione di base
    scene.add(new THREE.HemisphereLight(0x606060, 0x303030, 0.5));
    
    // Luce direzionale più forte per creare contrasto
    const dirLight = new THREE.DirectionalLight(0x808080, 0.7);
    dirLight.position.set(-50, 80, -50);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // Luce ambientale per evitare zone completamente buie
    const ambientLight = new THREE.AmbientLight(0x404040, 0.3);
    scene.add(ambientLight);

    // Terreno grigio scuro
    const gridSize = Math.ceil(Math.sqrt(TOTAL_COUNT));
    const groundMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x3a3a3a, 
      roughness: 0.8,
      metalness: 0.1 
    });
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(gridSize * SPACING, gridSize * SPACING),
      groundMaterial
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  async function fetchChunks() {
    while (dataIndex < TOTAL_COUNT) {
      try {
        const res = await fetch(
          `https://data.techforpalestine.org/api/v2/killed-in-gaza.json?offset=${dataIndex}&limit=${CHUNK_SIZE}`
        );
        const chunk = await res.json();
        addInstancedBlocks(chunk);
        dataIndex += chunk.length;
      } catch (err) {
        console.error('Errore fetch chunk:', err);
        break;
      }
    }
  }

  function addInstancedBlocks(data) {
    if (!instancedMesh) {
      const geometry = new THREE.BoxGeometry(2, 4, 2);
      // Materiale dei pilastri nero per forte contrasto
      const material = new THREE.MeshStandardMaterial({ 
        color: 0x000000, 
        roughness: 0.7, 
        metalness: 0.0
      });
      instancedMesh = new THREE.InstancedMesh(geometry, material, TOTAL_COUNT);
      instancedMesh.castShadow = true;
      scene.add(instancedMesh);
    }

    const gridSize = Math.ceil(Math.sqrt(TOTAL_COUNT));
    const halfGrid = (gridSize - 1) * SPACING / 2;

    data.forEach((item, i) => {
      const index = dataIndex + i;
      const row = Math.floor(index / gridSize);
      const col = index % gridSize;
      const x = col * SPACING - halfGrid;
      const z = row * SPACING - halfGrid;
      const y = 2;

      const matrix = new THREE.Matrix4().makeTranslation(x, y, z);
      instancedMesh.setMatrixAt(index, matrix);

      // Box3 di collisione
      colliderBoxes.push(new THREE.Box3(
        new THREE.Vector3(x - 1, 0, z - 1),
        new THREE.Vector3(x + 1, 4, z + 1)
      ));

      // Label data: nome più in alto e aggiunta età con testo tenue
      items.push({
        basePos: new THREE.Vector3(x, y + 3, z),
        en_name: item.en_name,
        name: item.name,
        age: item.age,
        label: null
      });
    });

    instancedMesh.instanceMatrix.needsUpdate = true;
  }

  function setupControls() {
    controls = new PointerLockControls(camera, renderer.domElement);
    scene.add(controls.getObject());

    const instructions = document.getElementById('instructions');
    controls.addEventListener('lock', () => instructions && (instructions.style.display = 'none'));

    document.getElementById("start").addEventListener('click', () => {
      if (!dropping) {
        dropping = true;
        controls.lock();
      }
    });

    window.addEventListener('keydown', (e) => {
      switch (e.code) {
        case 'ArrowUp':    move.forward = true;  break;
        case 'ArrowDown':  move.back = true;     break;
        case 'ArrowLeft':  move.left = true;     break;
        case 'ArrowRight': move.right = true;    break;
      }
    });

    window.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'ArrowUp':    move.forward = false; break;
        case 'ArrowDown':  move.back = false;    break;
        case 'ArrowLeft':  move.left = false;    break;
        case 'ArrowRight': move.right = false;   break;
      }
    });
  }

  function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
  }

  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (dropping) {
      camera.position.y = Math.max(camera.position.y - 30 * delta, GROUND_HEIGHT);
      if (camera.position.y <= GROUND_HEIGHT) {
        dropping = false;
      }
    }

    if (controls.isLocked && !dropping) {
      // Calcolo movimento
      velocity.set(
        (move.right - move.left) * speed * delta,
        0,
        (move.back - move.forward) * speed * delta
      );
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      direction.setY(0).normalize();
      const right = new THREE.Vector3().crossVectors(direction, camera.up).normalize();
      const moveVector = direction.multiplyScalar(-velocity.z).add(right.multiplyScalar(velocity.x));

      const newPos = controls.getObject().position.clone().add(moveVector);
      const sphere = new THREE.Sphere(newPos, CAMERA_RADIUS);

      let blocked = false;
      for (const box of colliderBoxes) {
        if (box.intersectsSphere(sphere)) { blocked = true; break; }
      }
      if (!blocked) controls.getObject().position.copy(newPos);

      // Gestione etichette con opacità graduale e colori più leggibili nel buio
      items.forEach(item => {
        const dist = camera.position.distanceTo(item.basePos);
        
        if (dist < 30) {
          let opacity;

          if (dist < 10) {
            opacity = 1.0;  // Opacità completa fino a 10 unità
          } else if (dist < 15) {
            opacity = 0.3;  // Opacità ridotta tra 10 e 15 unità
          } else {
            opacity = 0.1;  // Opacità minima tra 15 e 30 unità
          }
          
          if (!item.label) {
            // Crea nuova etichetta con colori più chiari per la leggibilità
            const div = document.createElement('div');
            div.className = 'label';
            div.style.color = '#cccccc'; // Grigio chiaro per leggibilità
            div.style.textShadow = '1px 1px 2px rgba(0,0,0,0.8)'; // Ombra per contrasto
            div.style.opacity = opacity;
            div.innerHTML = `<strong>${item.en_name}</strong><br>${item.name}<br>Age: ${item.age}`;
            const label = new CSS2DObject(div);
            label.position.copy(item.basePos);
            scene.add(label);
            item.label = label;
          } else {
            // Aggiorna opacità dell'etichetta esistente
            item.label.element.style.opacity = opacity;
          }
        } else if (item.label) {
          // Rimuovi etichetta se troppo lontana
          scene.remove(item.label);
          item.label.element.remove();
          item.label = null;
        }
      });
    }

    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }