
const icons={
    soon:`<svg
    width="64"
    height="64"
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="Coming soon"
>
    <!-- Clock -->
    <circle
        cx="32"
        cy="32"
        r="22"
        stroke="currentColor"
        stroke-width="3"
    />

    <!-- Clock hands -->
    <path
        d="M32 19V32L41 38"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
    />

    <!-- Small sparkle -->
    <path
        d="M49 10V16M46 13H52"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"/></svg>`
}


function viewImage() {
    console.log("View Image clicked");

    // Example:
    // window.location.href = "image.html";
}

function futureFeature() {
    showToast("This feature is coming soon.", icons.soon);
}



// Show toast
const toastQueue = [];
const MAX_TOASTS = 5;
let toastShowing = false;

function showToast(message, icon = '✓') {
    if(toastQueue.length>=MAX_TOASTS)return;
    toastQueue.push({ message, icon });
    processToastQueue();
}

function processToastQueue() {
    if (toastShowing || toastQueue.length === 0) return;

    toastShowing = true;

    const { message, icon } = toastQueue.shift();

    const toast = document.getElementById("toast");
    const text = document.getElementById("toastMessage");
    const iconEl = document.getElementById("icon");

    text.textContent = message;
    iconEl.innerHTML = icon;

    toast.classList.add("show");

    setTimeout(() => {
        toast.classList.remove("show");

        // Animation തീർന്നതിന് ശേഷം അടുത്തത്
        setTimeout(() => {
            toastShowing = false;
            processToastQueue();
        }, 250);

    }, 2500);
}