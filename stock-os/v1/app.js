// apps.js

// 1. Install a simple Note App
SystemOS.install({
  id: "com.sys.notes",
  name: "Notes",
  icon: "📝",
  color: "#f1c40f",
  template: `
    <textarea id="noteInput" rows="5" style="width: 100%; box-sizing: border-box; padding: 10px;"></textarea>
    <button id="saveBtn" style="margin-top:10px; width:100%; padding:10px; cursor: pointer;">Save Note</button>
    <p id="statusMsg"></p>
  `,
  // Changed from onLaunch to script string for persistence
  script: "document.getElementById('saveBtn').addEventListener('click', () => { const text = document.getElementById('noteInput').value; document.getElementById('statusMsg').innerText = 'Note Saved: ' + text; });"
});


// 2. Install a simple Counter App
SystemOS.install({
  id: "com.sys.counter",
  name: "Counter",
  icon: "⏱️",
  color: "#e74c3c",
  template: `
    <h1 id="countView" style="text-align:center; font-size: 50px;">0</h1>
    <button id="addBtn" style="width:100%; padding:15px; font-size:20px; cursor: pointer;">+ Add 1</button>
  `,
  // Changed from onLaunch to script string for persistence
  script: "let count = 0; document.getElementById('addBtn').addEventListener('click', () => { count++; document.getElementById('countView').innerText = count; });"
});


// 3. App Installer Logic

// Listen for clicks on the "Install" button
document.getElementById('installNewAppBtn').addEventListener('click', () => {
  document.getElementById('appInstallerInput').click();
}); // <-- Fixed missing closing bracket here


// Handle the file once the user selects it
document.getElementById('appInstallerInput').addEventListener('change', function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = function(e) {
    try {
      const appData = JSON.parse(e.target.result);
      
      if (!appData.id || !appData.name || !appData.template) {
        alert("Invalid App Package: Missing required fields.");
        return;
      }

      // Check if app is already installed
      if (SystemOS.registry[appData.id]) {
        alert("This app is already installed!");
        return;
      }

      const appConfig = {
        id: appData.id,
        name: appData.name,
        icon: appData.icon || "📱",
        color: appData.color || "#333",
        template: appData.template,
        script: appData.script // We pass the raw string here
      };

      SystemOS.install(appConfig);
      alert(`${appData.name} installed successfully!`);
      
    } catch (error) {
      console.error("Installation failed:", error);
      alert("Failed to install app. The file might be corrupted.");
    }
  };

  // Read the selected file as text
  reader.readAsText(file);
  
  // Clear the input so the same file can be selected again if needed
  event.target.value = '';
});

