const calendarGrid = document.getElementById("calendarGrid");
const monthTitle = document.getElementById("monthTitle");
const prevMonthBtn = document.getElementById("prevMonth");
const nextMonthBtn = document.getElementById("nextMonth");

// Start with the current month
const now = new Date();

let currentYear = now.getFullYear();
let currentMonth = now.getMonth();

// Store paid dates separately for each month
const STORAGE_KEY = "foodMoney_paidDates";

function loadPaidDates() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return new Set(saved ? JSON.parse(saved) : []);
  } catch (error) {
    console.error("Failed to load payment dates:", error);
    return new Set();
  }
}

const paidDates = loadPaidDates();

function savePaidDates() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([...paidDates])
  );
}

function getMonthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function renderCalendar() {
  calendarGrid.innerHTML = "";
  
  // Month heading
  monthTitle.textContent = new Date(
    currentYear,
    currentMonth,
    1
  ).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric"
  });
  
  // Number of days in the selected month
  const daysInMonth = new Date(
    currentYear,
    currentMonth + 1,
    0
  ).getDate();
  
  // Monday = 0, Tuesday = 1, ..., Sunday = 6
  const firstDay = (
    new Date(currentYear, currentMonth, 1).getDay() + 6
  ) % 7;
  
  // Empty cells before the first date
  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement("div");
    empty.className = "empty";
    calendarGrid.appendChild(empty);
  }
  
  // Generate every date in the month
  for (let day = 1; day <= daysInMonth; day++) {
    const dateCell = document.createElement("button");
    
    dateCell.type = "button";
    dateCell.className = "date";
    dateCell.textContent = day;
    
    const dateKey =
      `${getMonthKey(currentYear, currentMonth)}-${String(day).padStart(2, "0")}`;
    
    // Highlight today's date
    if (
      currentYear === now.getFullYear() &&
      currentMonth === now.getMonth() &&
      day === now.getDate()
    ) {
      dateCell.classList.add("today");
    }
    
    // Restore this date's payment status
    if (paidDates.has(dateKey)) {
      dateCell.classList.add("paid");
      dateCell.textContent = `✓ ${day}`;
    }
    
    // Toggle paid / unpaid
    dateCell.addEventListener("click", () => {
      if (paidDates.has(dateKey)) {
        paidDates.delete(dateKey);
      } else {
        paidDates.add(dateKey);
      }
      savePaidDates();
      renderCalendar();
    });
    
    calendarGrid.appendChild(dateCell);
  }
  
  // Navigation
  prevMonthBtn.disabled =
    currentYear === 2000 && currentMonth === 0;
  
  nextMonthBtn.disabled =
    currentYear === 2100 && currentMonth === 11;
}

prevMonthBtn.addEventListener("click", () => {
  if (currentYear === 2000 && currentMonth === 0) return;
  
  currentMonth--;
  
  if (currentMonth < 0) {
    currentMonth = 11;
    currentYear--;
  }
  
  renderCalendar();
});

nextMonthBtn.addEventListener("click", () => {
  if (currentYear === 2100 && currentMonth === 11) return;
  
  currentMonth++;
  
  if (currentMonth > 11) {
    currentMonth = 0;
    currentYear++;
  }
  
  renderCalendar();
});

// Initial render
renderCalendar();