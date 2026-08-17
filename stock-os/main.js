// JavaScript

// Simple Clock Update
function updateClock() {
  const now = new Date();
  let hours = now.getHours();
  let minutes = now.getMinutes();
  
  // Format to HH:MM
  hours = hours < 10 ? '0' + hours : hours;
  minutes = minutes < 10 ? '0' + minutes : minutes;
  
  document.getElementById('clock').textContent = `${hours}:${minutes}`;
}
setInterval(updateClock, 1000);
updateClock(); // Initial call

// App Navigation Logic
const mobileDevice = document.querySelector('.mobile-device');
const homeScreen = document.getElementById('homeScreen');

function openApp(appId) {
  // Find the selected app
  const app = document.getElementById(appId);
  if (!app) return;
  
  // 1. Add active class to slide it up
  app.classList.add('active');
  
  // 2. Add class to device to change status bar/home button colors
  mobileDevice.classList.add('app-open');
  
  // 3. Optional: slightly scale down home screen for a cool effect
  homeScreen.style.transform = 'scale(0.95)';
  homeScreen.style.opacity = '0';
}

function goHome() {
  // 1. Find the currently active app
  const activeApp = document.querySelector('.app-window.active');
  if (!activeApp) return; // Already on home screen
  
  // 2. Remove active class to slide it down
  activeApp.classList.remove('active');
  
  // 3. Revert status bar/home button colors
  mobileDevice.classList.remove('app-open');
  
  // 4. Restore home screen
  homeScreen.style.transform = 'scale(1)';
  homeScreen.style.opacity = '1';
}
