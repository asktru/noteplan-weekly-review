/* ============================================
   asktru.WeeklyReview — HTML Window Event Handlers
   Runs inside the HTML WebView window
   ============================================ */

// receivingPluginID is set in the inline script before the bridge loads

// ============================================
// DATE HELPERS (client-side)
// ============================================

function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function tomorrowStr() {
  var d = new Date();
  d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function isoWeekStr(date) {
  var d = new Date(date.getTime());
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  var week1 = new Date(d.getFullYear(), 0, 4);
  var weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return d.getFullYear() + '-W' + String(weekNum).padStart(2, '0');
}

function thisWeekStr() {
  return isoWeekStr(new Date());
}

function nextWeekStr() {
  var d = new Date();
  d.setDate(d.getDate() + 7);
  return isoWeekStr(d);
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var d = new Date(dateStr + 'T00:00:00');
  return months[d.getMonth()] + ' ' + d.getDate();
}

// ============================================
// MESSAGE HANDLER FROM PLUGIN
// ============================================

function onMessageFromPlugin(type, data) {
  switch (type) {
    case 'SHOW_TOAST':
      showToast(data.message);
      break;
    case 'UPDATE_CARD':
      updateCardStatus(data);
      break;
    case 'CARD_TASKS':
      renderExpandedTasks(data.encodedFilename, data.sections);
      break;
    case 'TASK_UPDATED':
      handleTaskUpdated(data);
      break;
    case 'TASK_PRIORITY_CHANGED':
      handlePriorityChanged(data);
      break;
    case 'TASK_SCHEDULED':
      handleTaskScheduled(data);
      break;
    case 'CARD_ARCHIVED':
      handleCardArchived(data);
      break;
    case 'FULL_REFRESH':
      window.location.reload();
      break;
    default:
      console.log('WeeklyReview: unknown message type', type);
  }
}

// ============================================
// EXPAND / COLLAPSE
// ============================================

function handleCardClick(e) {
  // Don't expand if clicking action buttons, links, or inside expanded area
  var target = e.target;
  if (target.closest('.wr-card-actions') ||
      target.closest('.wr-card-expanded') ||
      target.closest('.wr-task-add')) {
    return;
  }

  var card = target.closest('.wr-card');
  if (!card) return;

  var isExpanded = card.classList.contains('expanded');

  if (isExpanded) {
    // Collapse
    card.classList.remove('expanded');
    var expanded = card.querySelector('.wr-card-expanded');
    if (expanded) expanded.remove();
    // Remove archive button when collapsing
    var archBtn = card.querySelector('.wr-card-actions .archive-btn');
    if (archBtn) archBtn.remove();
  } else {
    // Expand — request task data from plugin
    card.classList.add('expanded');

    // Show loading state
    var loading = document.createElement('div');
    loading.className = 'wr-card-expanded loading';
    loading.textContent = 'Loading tasks...';
    card.appendChild(loading);

    var encodedFilename = card.dataset.encodedFilename;
    sendMessageToPlugin('expandCard', { encodedFilename: encodedFilename });
  }
}

// ============================================
// TASK RENDERING (DOM-based, no innerHTML)
// ============================================

function renderExpandedTasks(encodedFilename, sections) {
  var card = document.querySelector('.wr-card[data-encoded-filename="' + encodedFilename + '"]');
  if (!card) return;

  // Remove existing expanded content
  var existing = card.querySelector('.wr-card-expanded');
  if (existing) existing.remove();

  var container = document.createElement('div');
  container.className = 'wr-card-expanded';

  // Track last task's line index for add-task positioning
  var lastTaskLineIndex = -1;

  for (var s = 0; s < sections.length; s++) {
    var section = sections[s];

    // Section header
    if (section.heading) {
      var header = document.createElement('div');
      header.className = 'wr-tsec-header';
      header.textContent = section.heading;
      container.appendChild(header);
    }

    // Tasks
    for (var t = 0; t < section.tasks.length; t++) {
      var task = section.tasks[t];
      var taskEl = createTaskElement(task, encodedFilename);
      container.appendChild(taskEl);
      lastTaskLineIndex = task.lineIndex;
    }
  }

  // Add task input
  var addRow = document.createElement('div');
  addRow.className = 'wr-task-add';

  var addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.className = 'wr-task-add-input';
  addInput.placeholder = 'Add a task...';
  addInput.dataset.encodedFilename = encodedFilename;
  addInput.dataset.afterLineIndex = String(lastTaskLineIndex);
  addInput.addEventListener('keydown', handleAddTaskKeydown);
  addRow.appendChild(addInput);
  container.appendChild(addRow);

  card.appendChild(container);

  // Show or hide archive button based on open task count
  updateArchiveButton(card, sections);
}

function createTaskElement(task, encodedFilename) {
  var el = document.createElement('div');
  el.className = 'wr-task';
  if (task.indentLevel >= 1) el.className += ' indent-' + Math.min(task.indentLevel, 3);
  if (task.type === 'done') el.className += ' is-done';
  if (task.type === 'cancelled') el.className += ' is-cancelled';
  el.dataset.lineIndex = String(task.lineIndex);
  el.dataset.encodedFilename = encodedFilename;

  // Checkbox
  var cb = document.createElement('span');
  cb.className = 'wr-task-cb ' + task.type;
  var cbIcon = document.createElement('i');
  if (task.type === 'done') {
    cbIcon.className = 'fa-solid fa-circle-check';
  } else if (task.type === 'cancelled') {
    cbIcon.className = 'fa-solid fa-circle-minus';
  } else {
    cbIcon.className = 'fa-regular fa-circle';
  }
  cb.appendChild(cbIcon);
  cb.addEventListener('click', function(e) {
    e.stopPropagation();
    var taskEl = this.closest('.wr-task');
    sendMessageToPlugin('toggleTaskComplete', {
      encodedFilename: taskEl.dataset.encodedFilename,
      lineIndex: parseInt(taskEl.dataset.lineIndex, 10),
    });
  });
  el.appendChild(cb);

  // Priority badge (if any)
  if (task.priority > 0) {
    var pri = document.createElement('span');
    pri.className = 'wr-task-pri p' + task.priority;
    pri.textContent = '!'.repeat(task.priority);
    pri.addEventListener('click', function(e) {
      e.stopPropagation();
      var taskEl = this.closest('.wr-task');
      sendMessageToPlugin('cycleTaskPriority', {
        encodedFilename: taskEl.dataset.encodedFilename,
        lineIndex: parseInt(taskEl.dataset.lineIndex, 10),
      });
    });
    el.appendChild(pri);
  }

  // Content (use pre-rendered markdown HTML from plugin if available)
  var contentSpan = document.createElement('span');
  contentSpan.className = 'wr-task-content';
  if (task.contentHTML) {
    contentSpan.innerHTML = task.contentHTML;
  } else {
    contentSpan.textContent = task.content;
  }
  el.appendChild(contentSpan);

  // Schedule badge
  if (task.scheduledDate || task.scheduledWeek) {
    var sched = document.createElement('span');
    sched.className = 'wr-task-sched';
    var schedIcon = document.createElement('i');
    schedIcon.className = 'fa-regular fa-calendar';
    sched.appendChild(schedIcon);
    var schedText = document.createTextNode(
      task.scheduledDate ? formatDateShort(task.scheduledDate) : task.scheduledWeek
    );
    sched.appendChild(schedText);
    sched.addEventListener('click', function(e) {
      e.stopPropagation();
      showSchedulePicker(this);
    });
    el.appendChild(sched);
  }

  // Hover action buttons
  var acts = document.createElement('span');
  acts.className = 'wr-task-acts';

  // Priority cycle button (if no priority badge shown)
  if (task.priority === 0) {
    var priBtn = createActionBtn('fa-solid fa-exclamation', 'Priority', function(e) {
      e.stopPropagation();
      var taskEl = this.closest('.wr-task');
      sendMessageToPlugin('cycleTaskPriority', {
        encodedFilename: taskEl.dataset.encodedFilename,
        lineIndex: parseInt(taskEl.dataset.lineIndex, 10),
      });
    });
    acts.appendChild(priBtn);
  }

  // Schedule button (if not already scheduled)
  if (!task.scheduledDate && !task.scheduledWeek) {
    var schedBtn = createActionBtn('fa-regular fa-calendar', 'Schedule', function(e) {
      e.stopPropagation();
      showSchedulePicker(this);
    });
    acts.appendChild(schedBtn);
  }

  // Move up
  var upBtn = createActionBtn('fa-solid fa-chevron-up', 'Move up', function(e) {
    e.stopPropagation();
    var taskEl = this.closest('.wr-task');
    sendMessageToPlugin('moveTask', {
      encodedFilename: taskEl.dataset.encodedFilename,
      lineIndex: parseInt(taskEl.dataset.lineIndex, 10),
      direction: 'up',
    });
  });
  acts.appendChild(upBtn);

  // Move down
  var downBtn = createActionBtn('fa-solid fa-chevron-down', 'Move down', function(e) {
    e.stopPropagation();
    var taskEl = this.closest('.wr-task');
    sendMessageToPlugin('moveTask', {
      encodedFilename: taskEl.dataset.encodedFilename,
      lineIndex: parseInt(taskEl.dataset.lineIndex, 10),
      direction: 'down',
    });
  });
  acts.appendChild(downBtn);

  // Cancel button
  if (task.type !== 'cancelled') {
    var cancelBtn = createActionBtn('fa-solid fa-xmark', 'Cancel', function(e) {
      e.stopPropagation();
      var taskEl = this.closest('.wr-task');
      sendMessageToPlugin('toggleTaskCancel', {
        encodedFilename: taskEl.dataset.encodedFilename,
        lineIndex: parseInt(taskEl.dataset.lineIndex, 10),
      });
    });
    cancelBtn.className += ' cancel';
    acts.appendChild(cancelBtn);
  }

  el.appendChild(acts);
  return el;
}

function createActionBtn(iconClass, tooltip, handler) {
  var btn = document.createElement('button');
  btn.className = 'wr-task-act';
  btn.setAttribute('data-tooltip', tooltip);
  var icon = document.createElement('i');
  icon.className = iconClass;
  btn.appendChild(icon);
  btn.addEventListener('click', handler);
  return btn;
}

// ============================================
// SCHEDULE PICKER
// ============================================

function showSchedulePicker(anchorEl) {
  // Remove any existing picker
  closeAllPickers();

  var taskEl = anchorEl.closest('.wr-task');
  if (!taskEl) return;

  var picker = document.createElement('div');
  picker.className = 'wr-sched-picker';

  var options = [
    { label: 'Today', value: todayStr() },
    { label: 'Tomorrow', value: tomorrowStr() },
    { label: 'This week', value: thisWeekStr() },
    { label: 'Next week', value: nextWeekStr() },
  ];

  for (var i = 0; i < options.length; i++) {
    var opt = document.createElement('button');
    opt.className = 'wr-sched-opt';
    opt.textContent = options[i].label;
    opt.dataset.dateValue = options[i].value;
    opt.addEventListener('click', function(e) {
      e.stopPropagation();
      var pickerEl = this.closest('.wr-sched-picker');
      sendMessageToPlugin('scheduleTask', {
        encodedFilename: pickerEl.dataset.encodedFilename,
        lineIndex: parseInt(pickerEl.dataset.lineIndex, 10),
        dateStr: this.dataset.dateValue,
      });
      closeAllPickers();
    });
    picker.appendChild(opt);
  }

  // Custom date input
  var dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'wr-sched-date-input';
  dateInput.addEventListener('change', function(e) {
    e.stopPropagation();
    if (!this.value) return;
    var pickerEl = this.closest('.wr-sched-picker');
    sendMessageToPlugin('scheduleTask', {
      encodedFilename: pickerEl.dataset.encodedFilename,
      lineIndex: parseInt(pickerEl.dataset.lineIndex, 10),
      dateStr: this.value,
    });
    closeAllPickers();
  });
  picker.appendChild(dateInput);

  // Clear schedule
  var clearOpt = document.createElement('button');
  clearOpt.className = 'wr-sched-opt danger';
  clearOpt.textContent = 'Remove schedule';
  clearOpt.addEventListener('click', function(e) {
    e.stopPropagation();
    var pickerEl = this.closest('.wr-sched-picker');
    sendMessageToPlugin('scheduleTask', {
      encodedFilename: pickerEl.dataset.encodedFilename,
      lineIndex: parseInt(pickerEl.dataset.lineIndex, 10),
      dateStr: '',
    });
    closeAllPickers();
  });
  picker.appendChild(clearOpt);

  // Position picker using fixed coordinates relative to viewport
  document.body.appendChild(picker);
  var rect = anchorEl.getBoundingClientRect();
  picker.style.top = (rect.bottom + 4) + 'px';
  picker.style.left = Math.min(rect.left, window.innerWidth - 170) + 'px';
  // Store reference to task element for action handlers
  picker.dataset.lineIndex = taskEl.dataset.lineIndex;
  picker.dataset.encodedFilename = taskEl.dataset.encodedFilename;

  // Close picker on outside click
  setTimeout(function() {
    document.addEventListener('click', closePickerOnOutsideClick);
  }, 10);
}

function closeAllPickers() {
  document.querySelectorAll('.wr-sched-picker').forEach(function(p) { p.remove(); });
  document.removeEventListener('click', closePickerOnOutsideClick);
}

function closePickerOnOutsideClick(e) {
  if (!e.target.closest('.wr-sched-picker')) {
    closeAllPickers();
  }
}

// ============================================
// ADD TASK
// ============================================

function handleAddTaskKeydown(e) {
  if (e.key !== 'Enter') return;
  var input = e.target;
  var text = input.value.trim();
  if (!text) return;

  sendMessageToPlugin('addTask', {
    encodedFilename: input.dataset.encodedFilename,
    taskText: text,
    afterLineIndex: parseInt(input.dataset.afterLineIndex, 10) || null,
  });

  input.value = '';
}

// ============================================
// TASK UPDATE HANDLERS
// ============================================

function handleTaskUpdated(data) {
  var card = document.querySelector('.wr-card[data-encoded-filename="' + data.encodedFilename + '"]');
  if (!card) return;
  var taskEl = card.querySelector('.wr-task[data-line-index="' + data.lineIndex + '"]');
  if (!taskEl) return;

  // Update classes
  taskEl.classList.remove('is-done', 'is-cancelled');
  if (data.newType === 'done') taskEl.classList.add('is-done');
  if (data.newType === 'cancelled') taskEl.classList.add('is-cancelled');

  // Update checkbox icon
  var cb = taskEl.querySelector('.wr-task-cb');
  if (cb) {
    cb.className = 'wr-task-cb ' + data.newType;
    var icon = cb.querySelector('i');
    if (icon) {
      if (data.newType === 'done') icon.className = 'fa-solid fa-circle-check';
      else if (data.newType === 'cancelled') icon.className = 'fa-solid fa-circle-minus';
      else icon.className = 'fa-regular fa-circle';
    }
  }

  // Re-evaluate archive button visibility
  updateArchiveButton(card, null);
}

function handlePriorityChanged(data) {
  // Re-fetch tasks to rebuild (priority affects content and badges)
  var card = document.querySelector('.wr-card[data-encoded-filename="' + data.encodedFilename + '"]');
  if (!card || !card.classList.contains('expanded')) return;
  sendMessageToPlugin('expandCard', { encodedFilename: data.encodedFilename });
}

function handleTaskScheduled(data) {
  // Re-fetch tasks to rebuild (schedule badge changes)
  var card = document.querySelector('.wr-card[data-encoded-filename="' + data.encodedFilename + '"]');
  if (!card || !card.classList.contains('expanded')) return;
  sendMessageToPlugin('expandCard', { encodedFilename: data.encodedFilename });
}

// ============================================
// CARD STATUS UPDATES (from mark reviewed)
// ============================================

function updateCardStatus(data) {
  var card = document.querySelector('.wr-card[data-encoded-filename="' + data.encodedFilename + '"]');
  if (!card) return;

  var stripe = card.querySelector('.wr-card-stripe');
  if (stripe) stripe.className = 'wr-card-stripe fresh';
  card.dataset.status = 'fresh';

  var pill = card.querySelector('.wr-review-pill');
  if (pill) {
    pill.className = 'wr-review-pill fresh';
    while (pill.firstChild) pill.removeChild(pill.firstChild);
    var icon = document.createElement('i');
    icon.className = 'fa-solid fa-check';
    pill.appendChild(icon);
    pill.appendChild(document.createTextNode(' Reviewed today'));
  }
  showToast('Marked as reviewed');
}

// ============================================
// ARCHIVE
// ============================================

function handleCardArchived(data) {
  var card = document.querySelector('.wr-card[data-encoded-filename="' + data.encodedFilename + '"]');
  if (!card) return;
  card.classList.add('archiving');
  setTimeout(function() { card.remove(); }, 400);
}

function updateArchiveButton(card, sections) {
  // Count open tasks — from sections data if available, else from DOM
  var openCount = 0;
  if (sections) {
    for (var s = 0; s < sections.length; s++) {
      for (var t = 0; t < sections[s].tasks.length; t++) {
        if (sections[s].tasks[t].type === 'open') openCount++;
      }
    }
  } else {
    var tasks = card.querySelectorAll('.wr-task');
    for (var i = 0; i < tasks.length; i++) {
      if (!tasks[i].classList.contains('is-done') && !tasks[i].classList.contains('is-cancelled')) openCount++;
    }
  }

  var actions = card.querySelector('.wr-card-actions');
  if (!actions) return;
  var existing = actions.querySelector('.archive-btn');

  if (openCount === 0) {
    if (!existing) {
      var btn = document.createElement('button');
      btn.className = 'wr-card-action-btn archive-btn';
      btn.setAttribute('data-tooltip', 'Archive');
      btn.setAttribute('data-action', 'archiveNote');
      var icon = document.createElement('i');
      icon.className = 'fa-solid fa-box-archive';
      btn.appendChild(icon);
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var c = this.closest('.wr-card');
        if (c) sendMessageToPlugin('archiveNote', { encodedFilename: c.dataset.encodedFilename });
      });
      actions.appendChild(btn);
    }
  } else if (existing) {
    existing.remove();
  }
}

// ============================================
// FILTER TABS
// ============================================

var activeStatusFilter = 'all';
var activeTypeFilter = 'all';

function handleFilterClick(btn) {
  var filter = btn.dataset.filter;
  if (filter) {
    // Review status filter
    activeStatusFilter = filter;
    btn.closest('.wr-filter-group').querySelectorAll('.wr-filter-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
  }
  var typeFilter = btn.dataset.typeFilter;
  if (typeFilter) {
    // Type filter
    activeTypeFilter = typeFilter;
    btn.closest('.wr-filter-group').querySelectorAll('.wr-filter-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
  }
  applyFilters();
}

function applyFilters() {
  var cards = document.querySelectorAll('.wr-card');
  var sections = document.querySelectorAll('.wr-section');

  cards.forEach(function(card) {
    var statusMatch = true;
    var typeMatch = true;

    if (activeStatusFilter !== 'all') {
      statusMatch = card.dataset.status === activeStatusFilter;
    }
    if (activeTypeFilter !== 'all') {
      typeMatch = card.dataset.type === activeTypeFilter;
    }

    card.style.display = (statusMatch && typeMatch) ? '' : 'none';
  });

  sections.forEach(function(section) {
    var visible = section.querySelectorAll('.wr-card:not([style*="display: none"])');
    section.style.display = visible.length === 0 ? 'none' : '';
  });
}

// ============================================
// TOAST
// ============================================

function showToast(message) {
  document.querySelectorAll('.wr-toast').forEach(function(t) { t.remove(); });
  var toast = document.createElement('div');
  toast.className = 'wr-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(function() { toast.remove(); }, 3000);
}

// ============================================
// EVENT LISTENER SETUP
// ============================================

function attachAllEventListeners() {
  // Filter buttons (review status + type)
  document.querySelectorAll('.wr-filter-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { handleFilterClick(btn); });
  });

  // Card clicks for expand/collapse
  document.querySelectorAll('.wr-card').forEach(function(card) {
    card.addEventListener('click', handleCardClick);
  });

  // Card action buttons (review, open note)
  document.querySelectorAll('.wr-card-action-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var action = btn.dataset.action;
      var card = btn.closest('.wr-card');
      if (action && card) {
        sendMessageToPlugin(action, { encodedFilename: card.dataset.encodedFilename });
      }
    });
  });

  // Header action buttons
  document.querySelectorAll('.wr-header-actions .wr-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var action = btn.dataset.action;
      if (action) sendMessageToPlugin(action, {});
    });
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
  attachAllEventListeners();
});
