const icons = {
    soon: `
        <svg
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
        >
            <circle
                cx="32"
                cy="32"
                r="22"
                stroke="currentColor"
                stroke-width="3"
            />

            <path
                d="M32 19V32L41 38"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
            />

            <path
                d="M49 10V16M46 13H52"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
            />
        </svg>
    `
};


/* ========================================
   TILE ACTIONS
======================================== */

function viewImage() {
    console.log("View Image clicked");

    // window.location.href = "image.html";
}


function futureFeature() {
    showToast(
        "This feature is coming soon.",
        icons.soon
    );
}


/* ========================================
   TOAST QUEUE
======================================== */

const toastQueue = [];

const MAX_TOASTS = 5;
const TOAST_DURATION = 2500;
const TOAST_ANIMATION = 250;

let toastShowing = false;


function showToast(message, icon = '✓') {

    // Don't allow unlimited queued toasts
    if (toastQueue.length >= MAX_TOASTS) {
        return;
    }

    toastQueue.push({
        message,
        icon
    });

    processToastQueue();
}


function processToastQueue() {

    // Toast already visible
    if (toastShowing) {
        return;
    }

    // Nothing waiting
    if (toastQueue.length === 0) {
        return;
    }


    toastShowing = true;


    const {
        message,
        icon
    } = toastQueue.shift();


    const toast =
        document.getElementById("toast");

    const text =
        document.getElementById("toastMessage");

    const iconEl =
        document.getElementById("icon");


    text.textContent = message;
    iconEl.innerHTML = icon;


    toast.classList.add("show");


    setTimeout(() => {

        toast.classList.remove("show");


        setTimeout(() => {

            toastShowing = false;

            processToastQueue();

        }, TOAST_ANIMATION);

    }, TOAST_DURATION);
}