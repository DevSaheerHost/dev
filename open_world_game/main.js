import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";

// 1. Scene Setup
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);

// 2. Lighting & Environment Setup
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(10, 20, 10);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 150;

const d = 50;
directionalLight.shadow.camera.left = -d;
directionalLight.shadow.camera.right = d;
directionalLight.shadow.camera.top = d;
directionalLight.shadow.camera.bottom = -d;
scene.add(directionalLight);

// Day/Night Colors
const dayColor = new THREE.Color(0x87ceeb);
const nightColor = new THREE.Color(0x000511);

scene.background = dayColor.clone();
scene.fog = new THREE.Fog(dayColor.clone(), 10, 50);

// Time tracking
const clock = new THREE.Clock();
let totalTime = 0;
const cycleDuration = 100; // Change to 600 later for 10 min cycle

let player, house, land;

let playerEnergy = 100;
let isDead = false;
let gameState = "menu"; // State can be: 'menu', 'playing', or 'dead'
let lastDamageTime = 0;

const healthContainer = document.getElementById("health-bar");
const gameOverUI = document.getElementById("game-over");
const mainMenuUI = document.getElementById("main-menu");
const btnPlay = document.getElementById("btn-play");
const btnExit = document.getElementById("btn-exit");
const btnRespawn = document.getElementById("btn-respawn");

function updateHealthUI() {
  if (!healthContainer) return;
  let uiHTML = "";

  for (let i = 0; i < 10; i++) {
    // Calculate energy for each specific heart block (10 points max per heart)
    let heartEnergy = Math.max(0, Math.min(10, playerEnergy - i * 10));
    let fillPercentage = (heartEnergy / 10) * 100;

    uiHTML += `
      <svg width="30" height="30" viewBox="0 0 24 24">
        <defs>
          <clipPath id="fill-${i}">
            <rect x="0" y="0" width="${fillPercentage}%" height="100%" />
          </clipPath>
        </defs>
        <!-- Background empty heart -->
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#444"/>
        <!-- Foreground red filled heart, clipped by percentage -->
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="red" clip-path="url(#fill-${i})"/>
      </svg>
    `;
  }
  healthContainer.innerHTML = uiHTML;
}

// Call once to load initial full health
updateHealthUI();

// Main Menu Buttons Logic
if (btnPlay) {
  btnPlay.addEventListener("click", () => {
    mainMenuUI.style.display = "none";
    gameState = "playing";

    // Request Fullscreen
    if (document.documentElement.requestFullscreen) {
      document.documentElement
        .requestFullscreen()
        .catch((err) => console.log(err));
    }
  });
}

if (btnExit) {
  btnExit.addEventListener("click", () => {
    alert("Exit functionality is limited in browsers. Please close the tab.");
  });
}

// Respawn Logic
function respawnPlayer() {
  playerEnergy = 100;
  isDead = false;
  gameState = "playing";
  updateHealthUI();

  if (gameOverUI) gameOverUI.style.display = "none";

  // Reset player position
  if (player) {
    player.position.set(2, 3, -5);
    velocityY = 0;
  }

  // Reset all dogs to wander state so they don't instantly attack
  dogs.forEach((dog) => {
    dog.state = "wander";
  });
}

if (btnRespawn) {
  btnRespawn.addEventListener("click", respawnPlayer);
}

const collidables = [];
const streetLights = []; // Array to store all artificial lights
let flashlight;
let isFlashlightOn = false;

const loader = new GLTFLoader();

RectAreaLightUniformsLib.init();

const roomLights = [];
const interactiveSwitches = [];
let activeSwitch = null; // Stores the switch player is currently near
const hintUI = document.getElementById("hint-ui");
const interactBtn = document.getElementById("btn-e");

const dogs = [];
const safeZoneRadius = 15;

// Load House Model
// Load House Model
loader.load(
  "models/home.glb",
  (gltf) => {
    const house = gltf.scene;
    collidables.push(house);
    const loadedLights = {}; // Temp object to link switches to lights

    house.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }

      // 1. Setup Lights
      if (child.name.includes("light_point")) {
        const pointLight = new THREE.PointLight(0xffddaa, 10, 15);
        pointLight.position.copy(child.position);
        house.add(pointLight);
        roomLights.push(pointLight);

        // Save light with its ID (e.g., "light_point_1" -> "1")
        const id = child.name.split("_")[2];
        if (id) loadedLights[id] = pointLight;
      }

      // 2. Setup Switches
      if (child.name.includes("switch")) {
        const id = child.name.split("_")[1]; // e.g., "switch_1" -> "1"
        interactiveSwitches.push({
          id: id,
          position: child.position.clone(),
          light: null, // Will link below
        });
      }
    });

    // 3. Link switches to their corresponding lights
    interactiveSwitches.forEach((sw) => {
      if (loadedLights[sw.id]) {
        sw.light = loadedLights[sw.id];
      }
    });

    scene.add(house);
  },
  undefined,
  (error) => {
    console.error("Error loading house:", error);
  },
);

// Load Streetlight Model and Add Light Source
loader.load(
  "models/streetlight.glb",
  (gltf) => {
    const lampMesh = gltf.scene;

    // Position the physical lamp model in the world
    lampMesh.position.set(7, 2, 10);
    lampMesh.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    scene.add(lampMesh);

    // Create the actual light emitting object
    const lampLight = new THREE.SpotLight(0xffddaa, 0); // Intensity is 0 initially

    // Position the light at the height of the bulb in your 3D model
    // Change '4' to match the exact height of your streetlight bulb
    lampLight.position.set(1, 3, 1);

    lampLight.target.position.set(1, 0, 1); // Point light downwards
    lampLight.castShadow = true;
    lampLight.angle = Math.PI / 4;
    lampLight.penumbra = 0.5;
    lampLight.distance = 20;

    scene.add(lampLight);
    scene.add(lampLight.target);

    // Add to array for Day/Night control
    streetLights.push(lampLight);
  },
  undefined,
  (error) => {
    console.error("Error loading streetlight:", error);
  },
);

// Load Second House (house_1)
loader.load(
  "models/house_1.glb",
  (gltf) => {
    const house2 = gltf.scene;

    house2.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // Set exact position for this specific house
    // Adjust X and Z to place it exactly where you want
    house2.position.set(25, 0, -40);

    // Rotate the house if it faces the wrong direction
    // Math.PI / 2 is 90 degrees. Change this value to rotate it correctly
    house2.rotation.y = Math.PI / 2;

    scene.add(house2);

    // Add to collision array so player can't walk through it
    collidables.push(house2);
  },
  undefined,
  (error) => {
    console.error("Error loading house_1:", error);
  },
);

// 3. Load Land Model (Main Ground)
loader.load(
  "models/land.glb",
  (gltf) => {
    land = gltf.scene;
    land.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    scene.add(land);
    collidables.push(land); // Add land to collision list
  },
  undefined,
  (error) => {
    console.error("Error loading land:", error);
  },
);

// 4. Load Player Model
// 4. Load Player Model
loader.load(
  "models/player.glb",
  (gltf) => {
    player = gltf.scene;
    player.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // Flashlight Setup (Attached to Player)
    flashlight = new THREE.SpotLight(0xffffff, 0); // Intensity is 0 initially (OFF)

    // Position it at the player's hand (Adjust x, y, z based on your model)
    flashlight.position.set(-0.4, 1.5, 0.5);
    flashlight.angle = Math.PI / 6;
    flashlight.penumbra = 0.2;
    flashlight.distance = 50;
    flashlight.castShadow = true;

    // Create a target for the flashlight 5 units in front of the player
    const lightTarget = new THREE.Object3D();
    // Use positive or negative Z based on which way your player model faces in Blender
    lightTarget.position.set(0, 1, 5);

    player.add(lightTarget);
    flashlight.target = lightTarget;
    player.add(flashlight);

    player.position.set(2, 3, -5);
    scene.add(player);
  },
  undefined,
  (error) => {
    console.error("Error loading player:", error);
  },
);

// Load Tree Model and Place Randomly
loader.load(
  "models/tree.glb",
  (gltf) => {
    const baseTree = gltf.scene;

    // Enable shadows for the base tree model
    baseTree.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    const numberOfTrees = 60; // Total trees to spawn
    const spawnArea = 60; // Spawn limit (-60 to +60 in X and Z)
    const exclusionZone = 15; // Safe zone around the center (0,0) for house and buildings

    for (let i = 0; i < numberOfTrees; i++) {
      // Generate random X and Z coordinates
      let x = (Math.random() - 0.5) * spawnArea * 2;
      let z = (Math.random() - 0.5) * spawnArea * 2;

      // EXCLUSION CHECK: If the random position falls inside the house area, skip this tree
      if (
        x > -exclusionZone &&
        x < exclusionZone &&
        z > -exclusionZone &&
        z < exclusionZone
      ) {
        continue;
      }

      // Create a copy of the loaded tree
      const treeClone = baseTree.clone();

      // Place the tree on the ground (Y = 0)
      treeClone.position.set(x, 0, z);

      // Randomize rotation and size for a natural forest look
      treeClone.rotation.y = Math.random() * Math.PI * 2;
      const randomScale = 0.8 + Math.random() * 0.5; // Scale between 0.8 and 1.3
      treeClone.scale.set(randomScale, randomScale, randomScale);

      scene.add(treeClone);

      // Make trees solid so the player collides with them
      collidables.push(treeClone);
    }
  },
  undefined,
  (error) => {
    console.error("Error loading tree:", error);
  },
);

// Load Dog Model and setup AI
loader.load(
  "models/dog.glb",
  (gltf) => {
    const baseDog = gltf.scene;
    baseDog.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    const numberOfDogs = 10; // നിങ്ങൾക്ക് വേണ്ട നായ്ക്കളുടെ എണ്ണം

    for (let i = 0; i < numberOfDogs; i++) {
      const dogClone = baseDog.clone();

      // വീടിനുള്ളിൽ അല്ലാതെ പുറത്ത് എവിടെയെങ്കിലും നായ്ക്കളെ പ്ലേസ് ചെയ്യുക
      let x, z;
      do {
        x = (Math.random() - 0.5) * 80;
        z = (Math.random() - 0.5) * 80;
      } while (Math.abs(x) < safeZoneRadius && Math.abs(z) < safeZoneRadius);

      dogClone.position.set(x, 2, z);
      scene.add(dogClone);

      // നായുടെ ബുദ്ധി (AI Data) സ്റ്റോർ ചെയ്യാൻ ഒരു ഒബ്ജക്റ്റ് ഉണ്ടാക്കുന്നു
      dogs.push({
        mesh: dogClone,
        state: "wander", // 'wander' or 'chase'
        wanderTarget: new THREE.Vector3(x, 0, z),
        speed: 0.03 + Math.random() * 0.02, // നടക്കുന്ന വേഗത
        chaseSpeed: 0.08 + Math.random() * 0.02, // ഓടിക്കുന്ന വേഗത
      });
    }
  },
  undefined,
  (error) => {
    console.error("Error loading dog:", error);
  },
);

// 5. Input Tracking (Keyboard & Mobile UI)
const keys = { w: false, a: false, s: false, d: false, space: false };

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (keys.hasOwnProperty(key)) keys[key] = true;
  if (e.code === "Space") keys.space = true;

  if (e.code === "KeyT") toggleFlashlight();
  if (e.code === "KeyE") toggleRoomLight();

  // Enter key to respawn
  if (e.code === "Enter" && gameState === "dead") {
    respawnPlayer();
  }
});

window.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  if (keys.hasOwnProperty(key)) keys[key] = false;
  if (e.code === "Space") keys.space = false;
});



// Flashlight Toggle Function
function toggleFlashlight() {
  isFlashlightOn = !isFlashlightOn;
  if (flashlight) {
    flashlight.intensity = isFlashlightOn ? 50 : 0;
  }
}

// Room Light Toggle Function
function toggleRoomLight() {
  if (activeSwitch && activeSwitch.light) {
    // If intensity is 0 turn it to 10, else turn it to 0
    activeSwitch.light.intensity = activeSwitch.light.intensity > 0 ? 0 : 10;
  }
}

// Bind Mobile UI Button for Torch
const torchBtn = document.getElementById("btn-t");
if (torchBtn) {
  const handleTorchToggle = (e) => {
    e.preventDefault();
    toggleFlashlight();
  };
  torchBtn.addEventListener("mousedown", handleTorchToggle);
  torchBtn.addEventListener("touchstart", handleTorchToggle, {
    passive: false,
  });
}

// Bind Mobile UI Button for Interact (Switch)
if (interactBtn) {
  const handleInteract = (e) => {
    e.preventDefault();
    toggleRoomLight();
  };
  interactBtn.addEventListener("mousedown", handleInteract);
  interactBtn.addEventListener("touchstart", handleInteract, {
    passive: false,
  });
}

const bindUIButton = (elementId, keyId) => {
  const button = document.getElementById(elementId);
  if (!button) return;

  const startAction = (e) => {
    e.preventDefault();
    keys[keyId] = true;
  };

  const endAction = (e) => {
    e.preventDefault();
    keys[keyId] = false;
  };

  button.addEventListener("mousedown", startAction);
  button.addEventListener("mouseup", endAction);
  button.addEventListener("mouseleave", endAction);
  button.addEventListener("touchstart", startAction, { passive: false });
  button.addEventListener("touchend", endAction, { passive: false });
  button.addEventListener("touchcancel", endAction, { passive: false });
};

bindUIButton("btn-w", "w");
bindUIButton("btn-a", "a");
bindUIButton("btn-s", "s");
bindUIButton("btn-d", "d");
bindUIButton("btn-space", "space");

// Physics Variables
const moveSpeed = 0.1;
let velocityY = 0;
const gravity = -0.015;
const jumpStrength = 0.2;
let isGrounded = false;

const raycaster = new THREE.Raycaster();
const downVector = new THREE.Vector3(0, -1, 0);

// Camera Rotation & Zoom Variables
let yaw = 0;
let pitch = 0;
const rotationSensitivity = 0.005;
let cameraDistance = 2;
const minCameraDistance = 1;
const maxCameraDistance = 20;
const zoomSensitivity = 0.005;

// 6. Game Loop
function animate() {
  requestAnimationFrame(animate);

  // Day/Night Cycle Update
  const delta = clock.getDelta();
  totalTime += delta;

  const timeRatio = (totalTime % cycleDuration) / cycleDuration;
  const sunAngle = timeRatio * Math.PI * 2;
  const sunRadius = 50;

  directionalLight.position.x = Math.cos(sunAngle) * sunRadius;
  directionalLight.position.y = Math.sin(sunAngle) * sunRadius;
  directionalLight.position.z = Math.cos(sunAngle) * (sunRadius / 2);

  const sunHeight = Math.sin(sunAngle);
  const intensity = Math.max(0, sunHeight);

  directionalLight.intensity = intensity;
  ambientLight.intensity = 0.02 + intensity * 0.5;

  const lerpFactor = Math.max(0, Math.min(1, sunHeight * 2));
  // const lerpFactor = (sunHeight + 1) / 2;
  scene.background.copy(nightColor).lerp(dayColor, lerpFactor);
  scene.fog.color.copy(nightColor).lerp(dayColor, lerpFactor);

  // Control artificial lights based on sun position
  const isNight = sunHeight < 0;
  // Dog AI Logic
  const isPlayerInSafeZone =
    player &&
    Math.abs(player.position.x) < safeZoneRadius &&
    Math.abs(player.position.z) < safeZoneRadius;

  dogs.forEach((dog) => {
    // പകൽ സമയത്ത് നായ്ക്കളെ അപ്രത്യക്ഷമാക്കുന്നു
    if (!isNight) {
      dog.mesh.visible = false;
      return; // Stop AI calculation during day
    }

    dog.mesh.visible = true; // രാത്രിയിൽ നായ്ക്കളെ കാണിക്കാം

    if (player) {
      const distToPlayer = player.position.distanceTo(dog.mesh.position);

      // പ്ലെയർ അടുത്തുണ്ട്, ഒപ്പം വീടിന് പുറത്തുമാണെങ്കിൽ അറ്റാക്ക് ചെയ്യുക
      if (distToPlayer < 20 && !isPlayerInSafeZone) {
        dog.state = "chase";
      }
      // പ്ലെയർ ദൂരെ പോവുകയോ വീട്ടിൽ കയറുകയോ ചെയ്താൽ തിരിച്ചു പോവുക
      else if (distToPlayer > 30 || isPlayerInSafeZone) {
        dog.state = "wander";
      }

      // Movement Logic
      if (dog.state === "chase") {
        const targetAngle = Math.atan2(
          player.position.x - dog.mesh.position.x,
          player.position.z - dog.mesh.position.z,
        );

        let angleDiff = targetAngle - dog.mesh.rotation.y;
        angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
        dog.mesh.rotation.y += angleDiff * 0.1; // Smooth rotation to player

        // പ്ലെയറിന് അടുത്തേക്ക് ഓടുക
        dog.mesh.position.x += Math.sin(dog.mesh.rotation.y) * dog.chaseSpeed;
        dog.mesh.position.z += Math.cos(dog.mesh.rotation.y) * dog.chaseSpeed;

        // ---- NEW: Attack and Damage Logic ----
        // ---- NEW: Attack and Damage Logic ----
        if (distToPlayer < 2.5 && gameState === "playing") {
          const currentTime = performance.now();
          // Wait 1 second (1000ms) before dealing damage again
          if (currentTime - lastDamageTime > 1000) {
            playerEnergy -= 10;
            updateHealthUI();
            lastDamageTime = currentTime;

            if (playerEnergy <= 0) {
              isDead = true;
              gameState = "dead";

              // Change display to 'flex' to match the new UI structure
              if (gameOverUI) gameOverUI.style.display = "flex";

              if (flashlight) flashlight.intensity = 0;
              isFlashlightOn = false;
            }
          }
        }
      } else {
        // ലക്ഷ്യസ്ഥാനത്ത് എത്തിയാൽ പുതിയൊരു സ്ഥലം കണ്ടുപിടിക്കുക
        if (dog.mesh.position.distanceTo(dog.wanderTarget) < 2) {
          let nx, nz;
          do {
            nx = dog.mesh.position.x + (Math.random() - 0.5) * 30;
            nz = dog.mesh.position.z + (Math.random() - 0.5) * 30;
          } while (
            Math.abs(nx) < safeZoneRadius &&
            Math.abs(nz) < safeZoneRadius
          ); // വീടിനുള്ളിലേക്ക് പോകരുത്

          dog.wanderTarget.set(nx, 0, nz);
        }

        const targetAngle = Math.atan2(
          dog.wanderTarget.x - dog.mesh.position.x,
          dog.wanderTarget.z - dog.mesh.position.z,
        );

        let angleDiff = targetAngle - dog.mesh.rotation.y;
        angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
        dog.mesh.rotation.y += angleDiff * 0.05; // Smooth rotation to random target

        // പതുക്കെ നടക്കുക
        dog.mesh.position.x += Math.sin(dog.mesh.rotation.y) * dog.speed;
        dog.mesh.position.z += Math.cos(dog.mesh.rotation.y) * dog.speed;
      }

      // തറയിൽ തന്നെ നിൽക്കാൻ (ഇവിടെ നായ്ക്കൾക്ക് നിലവിൽ അഡ്വാൻസ്ഡ് കൊളീഷൻ കൊടുത്തിട്ടില്ല, ലാഗ് കുറക്കാനാണ്)
      dog.mesh.position.y = 0;
    }
  });

  const targetIntensity = isNight ? 15 : 0; // 15 when night, 0 when day

  // Smoothly turn lights on or off
  streetLights.forEach((light) => {
    light.intensity += (targetIntensity - light.intensity) * 0.05;
  });

  if (player && collidables.length > 0) {
    let moveX = 0;
    let moveZ = 0;

    // Only allow movement if player is alive and game is playing
    if (gameState === "playing") {
      if (keys.w) moveZ -= moveSpeed;
      if (keys.s) moveZ += moveSpeed;
      if (keys.a) moveX -= moveSpeed;
      if (keys.d) moveX += moveSpeed;
    }

    if (moveX !== 0 || moveZ !== 0) {
      const globalMoveX = moveX * Math.cos(yaw) + moveZ * Math.sin(yaw);
      const globalMoveZ = -moveX * Math.sin(yaw) + moveZ * Math.cos(yaw);

      const moveDirection = new THREE.Vector3(
        globalMoveX,
        0,
        globalMoveZ,
      ).normalize();

      const horizontalRayOrigin = player.position.clone();
      horizontalRayOrigin.y += 1;

      raycaster.set(horizontalRayOrigin, moveDirection);
      const wallIntersects = raycaster.intersectObjects(collidables, true);

      const playerRadius = 0.8;

      if (
        wallIntersects.length === 0 ||
        wallIntersects[0].distance > playerRadius
      ) {
        // Apply movement
        player.position.x += globalMoveX;
        player.position.z += globalMoveZ;

        // Calculate the direction angle based on movement vector
        const targetRotation = Math.atan2(globalMoveX, globalMoveZ);

        // Find the shortest path to the target angle to avoid 360-degree spins
        let angleDiff = targetRotation - player.rotation.y;
        angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));

        // Smoothly rotate the player model
        player.rotation.y += angleDiff * 0.15;
      }
    }

    // --- NEW: Switch Proximity Check ---
    let foundNearbySwitch = null;
    interactiveSwitches.forEach((sw) => {
      // Check if player is within 2 units of the switch
      if (player.position.distanceTo(sw.position) < 2) {
        foundNearbySwitch = sw;
      }
    });

    activeSwitch = foundNearbySwitch;

    // Show/Hide Hint UI and Mobile Button
    if (hintUI && interactBtn) {
      if (activeSwitch) {
        hintUI.style.display = "block";
        interactBtn.style.display = "block"; // Show mobile button
      } else {
        hintUI.style.display = "none";
        interactBtn.style.display = "none"; // Hide mobile button
      }
    }
    // -----------------------------------

    velocityY += gravity;
    player.position.y += velocityY;

    const verticalRayOrigin = player.position.clone();
    verticalRayOrigin.y += 1;
    raycaster.set(verticalRayOrigin, downVector);

    const floorIntersects = raycaster.intersectObjects(collidables, true);

    if (floorIntersects.length > 0 && floorIntersects[0].distance < 1.1) {
      if (velocityY < 0) {
        velocityY = 0;
        isGrounded = true;
        player.position.y = floorIntersects[0].point.y;
      }
    } else {
      isGrounded = false;
    }

    if (keys.space && isGrounded) {
      velocityY = jumpStrength;
      isGrounded = false;
    }

    const cameraHeightOffset = 3;
    camera.position.x = player.position.x + Math.sin(yaw) * cameraDistance;
    camera.position.z = player.position.z + Math.cos(yaw) * cameraDistance;
    camera.position.y =
      player.position.y + cameraHeightOffset + Math.sin(pitch) * cameraDistance;

    camera.lookAt(
      player.position.x,
      player.position.y + 1.5,
      player.position.z,
    );
  }

  renderer.render(scene, camera);
}

// PC: Pointer Lock (Mouse look without clicking)
document.body.addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") {
    document.body.requestPointerLock();
  }
});

window.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement === document.body) {
    yaw -= e.movementX * rotationSensitivity;
    pitch += e.movementY * rotationSensitivity;
    pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitch));
  }
});

// Mouse Scroll Wheel Event for Zooming
window.addEventListener("wheel", (e) => {
  cameraDistance += e.deltaY * zoomSensitivity;
  cameraDistance = Math.max(
    minCameraDistance,
    Math.min(maxCameraDistance, cameraDistance),
  );
});

// Mobile: Touch Swipe Rotation
let previousTouchPosition = { x: 0, y: 0 };

window.addEventListener(
  "touchstart",
  (e) => {
    if (e.target.tagName === "BUTTON") return;
    previousTouchPosition = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  },
  { passive: false },
);

window.addEventListener(
  "touchmove",
  (e) => {
    if (e.target.tagName === "BUTTON") return;

    const deltaX = e.touches[0].clientX - previousTouchPosition.x;
    const deltaY = e.touches[0].clientY - previousTouchPosition.y;

    yaw -= deltaX * rotationSensitivity;
    pitch += deltaY * rotationSensitivity;

    pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitch));

    previousTouchPosition = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  },
  { passive: false },
);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
