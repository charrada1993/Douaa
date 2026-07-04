// Main JavaScript file for Cute Period Tracker Dashboard

// State Variables
let periodsHistory = [];
let predictionStats = {};
let currentCalendarDate = new Date(); // Month and year currently shown on calendar

// DOM elements
const predictedDateEl = document.getElementById('predictedDate');
const daysRemainingEl = document.getElementById('daysRemaining');
const avgCycleLenEl = document.getElementById('avgCycleLen');
const fertileWindowEl = document.getElementById('fertileWindow');
const onboardingMsgEl = document.getElementById('onboardingMsg');
const historyListEl = document.getElementById('historyList');
const loadingOverlay = document.getElementById('loadingOverlay');

// Modal Elements
const logModal = document.getElementById('logModal');
const quickLogBtn = document.getElementById('quickLogBtn');
const customLogBtn = document.getElementById('customLogBtn');
const closeModalBtn = document.getElementById('closeModal');
const logPeriodForm = document.getElementById('logPeriodForm');
const startDateInput = document.getElementById('startDate');
const endDateInput = document.getElementById('endDate');
const logNotesInput = document.getElementById('logNotes');

// Initialize the App
document.addEventListener('DOMContentLoaded', () => {
    fetchDashboardData();
    setupEventListeners();
    initPetalGenerator();
});

// Event Listeners setup
function setupEventListeners() {
    // Quick Log Today
    quickLogBtn.addEventListener('click', () => {
        resetFormInputs();
        const todayStr = getLocalDateString(new Date());
        startDateInput.value = todayStr;
        openModal();
    });

    // Custom Log Entry
    customLogBtn.addEventListener('click', () => {
        resetFormInputs();
        openModal();
    });

    // Modal Close
    closeModalBtn.addEventListener('click', closeModal);
    window.addEventListener('click', (e) => {
        if (e.target === logModal) closeModal();
    });

    // Form submit
    logPeriodForm.addEventListener('submit', handleFormSubmit);

    // Calendar navigation
    document.getElementById('prevMonth').addEventListener('click', () => {
        currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
        renderCalendar();
    });
    document.getElementById('nextMonth').addEventListener('click', () => {
        currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
        renderCalendar();
    });
}

function resetFormInputs() {
    startDateInput.value = "";
    endDateInput.value = "";
    logNotesInput.value = "";
    // Reset mood radios
    document.querySelectorAll('input[name="mood"]').forEach(r => r.checked = false);
    // Reset symptom checkboxes
    document.querySelectorAll('input[name="symptoms"]').forEach(cb => cb.checked = false);
}

// Modal open/close helpers
function openModal() {
    logModal.style.display = 'flex';
}

function closeModal() {
    logModal.style.display = 'none';
}

// Format local date cleanly to YYYY-MM-DD
function getLocalDateString(date) {
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - (offset * 60 * 1000));
    return localDate.toISOString().split('T')[0];
}

// Fetch dashboard data from API
async function fetchDashboardData() {
    showLoading(true);
    try {
        const response = await fetch('/api/get_history');
        if (!response.ok) throw new Error("Could not fetch data");
        const data = await response.json();
        
        periodsHistory = data.periods || [];
        predictionStats = data.stats || {};
        
        updateDashboardUI();
        renderCalendar();
    } catch (err) {
        console.error("Error loading data:", err);
    } finally {
        showLoading(false);
    }
}

// Loading Spinner toggle
function showLoading(show) {
    if (show) {
        loadingOverlay.style.display = 'flex';
        loadingOverlay.style.opacity = '1';
    } else {
        loadingOverlay.style.opacity = '0';
        setTimeout(() => {
            loadingOverlay.style.display = 'none';
        }, 500);
    }
}

// Update dashboard stats
function updateDashboardUI() {
    if (periodsHistory.length === 0) {
        onboardingMsgEl.style.display = 'block';
        historyListEl.style.display = 'none';
        
        predictedDateEl.textContent = "Waiting for logs";
        daysRemainingEl.textContent = "Log Today! 💕";
        avgCycleLenEl.textContent = "-- days";
        fertileWindowEl.textContent = "--";
        
        // Reset Phase visualizer values
        document.getElementById('phaseDayText').textContent = "Day --";
        document.getElementById('phaseTotalDays').textContent = "of --";
        document.getElementById('phaseName').textContent = "Waiting for data...";
        document.getElementById('phaseLoveNote').textContent = "Log your first period to calculate your current cycle phase. 💕";
        document.getElementById('phaseRingFill').style.strokeDashoffset = "345.57";
        return;
    }

    onboardingMsgEl.style.display = 'none';
    historyListEl.style.display = 'flex';

    // Set stats
    const stats = predictionStats;
    const avgCycle = stats.average_cycle_length || 28;
    
    // Average Cycle Length
    avgCycleLenEl.textContent = `${avgCycle} days`;
    
    // Prediction Date formatted beautifully
    if (stats.next_period_prediction) {
        const predDate = new Date(stats.next_period_prediction + 'T00:00:00');
        const formattedPred = predDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        predictedDateEl.textContent = formattedPred;
    } else {
        predictedDateEl.textContent = "--";
    }

    // Days until or overdue counter
    const daysUntil = stats.days_until;
    if (daysUntil !== null && daysUntil !== undefined) {
        if (daysUntil === 0) {
            daysRemainingEl.innerHTML = "💗 Expected today! 💖";
        } else if (daysUntil > 0) {
            daysRemainingEl.innerHTML = `💗 ${daysUntil} days until next cycle`;
        } else {
            daysRemainingEl.innerHTML = `🌸 Cycle is late by ${Math.abs(daysUntil)} days`;
        }
    } else {
        daysRemainingEl.textContent = "Waiting for predictions...";
    }

    // Fertile window display
    if (stats.fertile_start && stats.fertile_end) {
        const fStart = new Date(stats.fertile_start + 'T00:00:00');
        const fEnd = new Date(stats.fertile_end + 'T00:00:00');
        
        const fStartStr = fStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const fEndStr = fEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        
        fertileWindowEl.textContent = `${fStartStr} - ${fEndStr} ✨`;
    } else {
        fertileWindowEl.textContent = "--";
    }

    // Calculate current cycle phase dynamically
    calculateCurrentCyclePhase(avgCycle);

    // Render history list
    renderHistoryList();
}

// Cycle Phase Calculation & Visualization
function calculateCurrentCyclePhase(avgCycle) {
    if (periodsHistory.length === 0) return;
    
    // Find the most recent start date (periodsHistory is sorted newest first)
    const lastPeriod = periodsHistory[0]; 
    const lastStart = new Date(lastPeriod.start_date + 'T00:00:00');
    const today = new Date();
    today.setHours(0,0,0,0);
    
    const diffTime = today - lastStart;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
        // Logged start date is in the future
        document.getElementById('phaseDayText').textContent = "Day --";
        document.getElementById('phaseTotalDays').textContent = "of --";
        document.getElementById('phaseName').textContent = "Future Logged";
        document.getElementById('phaseLoveNote').textContent = "You logged a period starting in the future! 🔮";
        document.getElementById('phaseRingFill').style.strokeDashoffset = "345.57";
        return;
    }
    
    // Calculate cycle day
    const cycleDay = (diffDays % avgCycle) + 1;
    
    // Phase calculation bounds
    let phaseName = "";
    let loveNote = "";
    let colorClass = "--primary-pink";
    
    const ovulationDay = Math.max(12, avgCycle - 14); // Ovulation typically occurs 14 days before next start
    
    if (cycleDay <= 5) {
        phaseName = "Menstrual Phase 🩸";
        loveNote = "Take it easy today, my queen. A cozy warm hot water bottle and all my hugs are here for you. 🍫🧸";
    } else if (cycleDay < ovulationDay) {
        phaseName = "Follicular Phase 🌱";
        loveNote = "You're starting to bloom again! Your energy is rising. Go conquer the world, I'm cheering for you! ✨";
    } else if (cycleDay === ovulationDay) {
        phaseName = "Ovulation Phase 🌸";
        loveNote = "You are glowing and radiant today! Sending you a million kisses and lots of love. 💖✨";
    } else {
        phaseName = "Luteal Phase 🌙";
        loveNote = "PMS might kick in, sweetie. Don't worry, I have your favorite snacks and sweet treats ready. Let's cuddle! 🍿🍕";
    }
    
    // Update labels
    document.getElementById('phaseDayText').textContent = `Day ${cycleDay}`;
    document.getElementById('phaseTotalDays').textContent = `of ${avgCycle}`;
    document.getElementById('phaseName').textContent = phaseName;
    document.getElementById('phaseLoveNote').textContent = loveNote;
    
    // Ring Progress: SVG stroke-dasharray = 345.57 (Circumference for r=55)
    const percentage = Math.min(1, cycleDay / avgCycle);
    const strokeDashoffset = 345.57 - (345.57 * percentage);
    document.getElementById('phaseRingFill').style.strokeDashoffset = strokeDashoffset;
}

// Render list of past logged periods
function renderHistoryList() {
    historyListEl.innerHTML = "";
    
    periodsHistory.forEach(period => {
        const item = document.createElement('div');
        item.className = 'history-item';
        
        // Formatting dates
        const start = new Date(period.start_date + 'T00:00:00');
        const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        
        let endStr = "";
        let durationDays = "";
        if (period.end_date) {
            const end = new Date(period.end_date + 'T00:00:00');
            endStr = ` to ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
            const duration = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
            durationDays = ` (${duration} days long)`;
        }

        const moodHtml = period.mood ? `<span class="history-item-mood" title="Mood: ${escapeHTML(period.mood)}">${period.mood}</span>` : '';
        const notesHtml = period.notes ? `<div class="history-notes">" ${escapeHTML(period.notes)} "</div>` : '';
        const cycleHtml = period.cycle_length ? `<span class="history-cycle-badge">Cycle length: ${period.cycle_length} days</span>` : '';
        
        // Symptoms tags rendering
        let symptomsHtml = "";
        if (period.symptoms && period.symptoms.length > 0) {
            symptomsHtml = `<div class="history-item-symptoms">`;
            period.symptoms.forEach(sym => {
                symptomsHtml += `<span class="symptom-badge">${escapeHTML(sym)}</span>`;
            });
            symptomsHtml += `</div>`;
        }

        item.innerHTML = `
            <div class="history-details">
                <div class="history-dates">🌸 ${moodHtml}${startStr}${endStr}${durationDays}</div>
                ${notesHtml}
                ${symptomsHtml}
                ${cycleHtml}
            </div>
            <button class="delete-log-btn" title="Delete Log" onclick="handleDeleteLog('${period.id}')">🗑️</button>
        `;
        
        historyListEl.appendChild(item);
    });
}

// Handle period logging submission
async function handleFormSubmit(e) {
    e.preventDefault();
    
    // Gather checked symptoms
    const selectedSymptoms = [];
    document.querySelectorAll('input[name="symptoms"]:checked').forEach(cb => {
        selectedSymptoms.push(cb.value);
    });
    
    // Gather selected mood
    const selectedMood = document.querySelector('input[name="mood"]:checked')?.value || "";

    const payload = {
        start_date: startDateInput.value,
        end_date: endDateInput.value || null,
        notes: logNotesInput.value || "",
        mood: selectedMood,
        symptoms: selectedSymptoms
    };
    
    closeModal();
    showLoading(true);
    
    try {
        const response = await fetch('/api/log_period', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error("Logging failed");
        
        await fetchDashboardData();
    } catch (err) {
        alert("Failed to save log. Let's try again! 💖");
        console.error(err);
        showLoading(false);
    }
}

// Handle deleting a log entry
async function handleDeleteLog(id) {
    if (!confirm("Are you sure you want to remove this log entry, sweetie? 💕")) return;
    
    showLoading(true);
    try {
        const response = await fetch(`/api/delete_period/${id}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) throw new Error("Delete failed");
        
        await fetchDashboardData();
    } catch (err) {
        alert("Failed to delete log entry.");
        console.error(err);
        showLoading(false);
    }
}

// Calendar Rendering Logic
function renderCalendar() {
    const calendarDays = document.getElementById('calendarDays');
    const calendarMonthYear = document.getElementById('calendarMonthYear');
    calendarDays.innerHTML = "";

    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();

    // Display title
    const monthName = currentCalendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    calendarMonthYear.textContent = monthName;

    // Get first day of month and total days
    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();

    // Render empty slots for preceding month
    for (let i = 0; i < firstDayIndex; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day empty';
        calendarDays.appendChild(emptyCell);
    }

    const todayStr = getLocalDateString(new Date());

    // Render days
    for (let day = 1; day <= totalDays; day++) {
        const dayCell = document.createElement('div');
        dayCell.className = 'calendar-day';
        dayCell.textContent = day;

        // Current date object to match
        const currentDateObj = new Date(year, month, day);
        const currentDateStr = getLocalDateString(currentDateObj);

        // Highlight Today
        if (currentDateStr === todayStr) {
            dayCell.classList.add('today');
        }

        // Highlight Logged Period
        // Check if date is in range [start_date, end_date]. If end_date is missing, assume 4 days duration.
        const isLogged = periodsHistory.some(period => {
            const start = new Date(period.start_date + 'T00:00:00');
            const end = period.end_date ? new Date(period.end_date + 'T00:00:00') : new Date(start.getTime() + 3 * 24 * 60 * 60 * 1000);
            return currentDateObj >= start && currentDateObj <= end;
        });

        // Highlight Predicted Period
        // Check if date falls in predicted range: [prediction_start, prediction_start + 4 days]
        let isPredicted = false;
        if (predictionStats.next_period_prediction) {
            const startPred = new Date(predictionStats.next_period_prediction + 'T00:00:00');
            const endPred = new Date(startPred.getTime() + 3 * 24 * 60 * 60 * 1000);
            isPredicted = currentDateObj >= startPred && currentDateObj <= endPred;
        }

        // Highlight Fertile Window
        let isFertile = false;
        if (predictionStats.fertile_start && predictionStats.fertile_end) {
            const fertileStart = new Date(predictionStats.fertile_start + 'T00:00:00');
            const fertileEnd = new Date(predictionStats.fertile_end + 'T00:00:00');
            isFertile = currentDateObj >= fertileStart && currentDateObj <= fertileEnd;
        }

        // Prioritize logged over predicted
        if (isLogged) {
            dayCell.classList.add('logged');
        } else if (isPredicted) {
            dayCell.classList.add('predicted');
        } else if (isFertile) {
            dayCell.classList.add('fertile');
        }

        calendarDays.appendChild(dayCell);
    }
}

// Background Particle Effects (Flower Petals)
function initPetalGenerator() {
    const container = document.getElementById('petals-container');
    if (!container) return;
    const colors = ['#ffd1dc', '#ffb6c1', '#ffc0cb', '#ffe4e1'];
    
    function createPetal() {
        const petal = document.createElement('div');
        petal.style.position = 'absolute';
        petal.style.width = Math.random() * 15 + 10 + 'px';
        petal.style.height = Math.random() * 15 + 10 + 'px';
        petal.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        petal.style.borderRadius = '50% 0 50% 50%';
        petal.style.opacity = Math.random() * 0.5 + 0.3;
        petal.style.left = Math.random() * 100 + 'vw';
        petal.style.top = '-20px';
        
        const duration = Math.random() * 8 + 7;
        petal.style.transition = `transform ${duration}s linear, top ${duration}s linear`;
        
        container.appendChild(petal);
        
        setTimeout(() => {
            petal.style.top = '105vh';
            petal.style.transform = `translateX(${Math.random() * 120 - 60}px) rotate(${Math.random() * 360}deg)`;
        }, 50);
        
        setTimeout(() => {
            petal.remove();
        }, duration * 1000);
    }
    
    setInterval(createPetal, 600);
}

// Helper to escape HTML tags to prevent XSS
function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

