/* ============================================
   asktru.WeeklyReview — HTML Window Event Handlers
   Runs inside the HTML WebView window
   ============================================ */

// receivingPluginID and npWindowID are set in the inline script before the bridge loads.
// Wrap sendMessageToPlugin so every outgoing payload carries the originating
// window's ID; the plugin uses it to route replies back to the right window
// (sidebar embed vs. separate floating window).
(function() {
  if (typeof window === 'undefined') return;
  var orig = window.sendMessageToPlugin;
  if (typeof orig !== 'function') return;
  window.sendMessageToPlugin = function(action, data) {
    var d = data || {};
    if (typeof npWindowID !== 'undefined' && npWindowID && d._windowID === undefined) {
      d._windowID = npWindowID;
    }
    return orig(action, d);
  };
})();

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
    case 'CARD_META_UPDATED':
      handleCardMetaUpdated(data);
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
  // Don't expand if clicking action buttons, links, expanded area, or meta editors
  var target = e.target;
  if (target.closest('.wr-card-actions') ||
      target.closest('.wr-card-expanded') ||
      target.closest('.wr-task-add') ||
      target.closest('.wr-meta-editable') ||
      target.closest('.wr-sched-picker')) {
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

  // Track last line index across all sections for the bottom-of-note add input
  var lastLineIndex = -1;

  for (var s = 0; s < sections.length; s++) {
    var section = sections[s];

    if (section.heading) {
      var header = document.createElement('div');
      header.className = 'wr-tsec-header';
      header.textContent = section.heading;
      container.appendChild(header);
      if (section.headingLineIndex > lastLineIndex) lastLineIndex = section.headingLineIndex;
    }

    var sectionLastLine = (typeof section.headingLineIndex === 'number') ? section.headingLineIndex : -1;
    for (var t = 0; t < section.tasks.length; t++) {
      var task = section.tasks[t];
      var taskEl = createTaskElement(task, encodedFilename);
      container.appendChild(taskEl);
      if (task.lineIndex > sectionLastLine) sectionLastLine = task.lineIndex;
    }
    if (sectionLastLine > lastLineIndex) lastLineIndex = sectionLastLine;

    // Per-section add affordance: only render under sections that have a heading,
    // so the implicit pre-heading section reuses the bottom-of-note input below.
    if (section.heading) {
      container.appendChild(createSectionAddRow(encodedFilename, section.heading, sectionLastLine));
    }
  }

  // Bottom-of-note add input (always available)
  var addRow = document.createElement('div');
  addRow.className = 'wr-task-add';
  var addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.className = 'wr-task-add-input';
  addInput.placeholder = 'Add a task at the end…';
  addInput.dataset.encodedFilename = encodedFilename;
  addInput.dataset.afterLineIndex = String(lastLineIndex);
  addInput.addEventListener('keydown', handleAddTaskKeydown);
  addRow.appendChild(addInput);
  container.appendChild(addRow);

  card.appendChild(container);

  updateArchiveButton(card, sections);
}

function createSectionAddRow(encodedFilename, heading, afterLineIndex) {
  var row = document.createElement('div');
  row.className = 'wr-tsec-add';

  var btn = document.createElement('button');
  btn.className = 'wr-tsec-add-btn';
  var icon = document.createElement('i');
  icon.className = 'fa-solid fa-plus';
  btn.appendChild(icon);
  btn.appendChild(document.createTextNode(' Add task'));
  row.appendChild(btn);

  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'wr-tsec-add-input';
    input.placeholder = 'Add a task to "' + heading + '"…';
    input.dataset.encodedFilename = encodedFilename;
    input.dataset.afterLineIndex = String(afterLineIndex);
    input.addEventListener('keydown', function(ev) {
      if (ev.key === 'Escape') { row.replaceChild(btn, input); return; }
      handleAddTaskKeydown(ev);
    });
    input.addEventListener('blur', function() {
      // Restore the button if the user dismisses without entering text.
      if (!input.value.trim() && row.contains(input)) row.replaceChild(btn, input);
    });
    row.replaceChild(input, btn);
    input.focus();
  });

  return row;
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
// CARD META EDITING (review interval + reviewed date)
// ============================================

function bindMetaEditable(scope) {
  var root = scope || document;
  root.querySelectorAll('.wr-meta-editable').forEach(function(el) {
    if (el.dataset.bound === '1') return;
    el.dataset.bound = '1';
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      if (el.dataset.action === 'editInterval') showIntervalPicker(el);
    });
  });
}

function showIntervalPicker(anchorEl) {
  closeAllPickers();
  var card = anchorEl.closest('.wr-card');
  if (!card) return;
  var encodedFilename = card.dataset.encodedFilename;
  var current = (anchorEl.textContent || '').trim();

  var picker = document.createElement('div');
  picker.className = 'wr-sched-picker';
  picker.dataset.encodedFilename = encodedFilename;
  picker.dataset.kind = 'interval';

  var presets = [
    { label: 'Every day', value: '1d' },
    { label: 'Every 3 days', value: '3d' },
    { label: 'Every week', value: '1w' },
    { label: 'Every 2 weeks', value: '2w' },
    { label: 'Every month', value: '1m' },
    { label: 'Every quarter', value: '1q' },
    { label: 'Every year', value: '1y' },
  ];
  presets.forEach(function(opt) {
    var b = document.createElement('button');
    b.className = 'wr-sched-opt';
    b.textContent = opt.label;
    b.dataset.value = opt.value;
    b.addEventListener('click', function(e) {
      e.stopPropagation();
      sendMessageToPlugin('setReviewInterval', { encodedFilename: encodedFilename, interval: opt.value });
      closeAllPickers();
    });
    picker.appendChild(b);
  });

  // Custom interval input (e.g. "10d", "3w", "6m")
  var customRow = document.createElement('div');
  customRow.className = 'wr-sched-custom-row';
  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'wr-sched-custom-input';
  input.placeholder = 'e.g. 10d, 6w, 3m';
  customRow.appendChild(input);
  var setBtn = document.createElement('button');
  setBtn.className = 'wr-sched-custom-btn';
  setBtn.textContent = 'Set';
  function commitCustom() {
    var v = (input.value || '').trim().toLowerCase();
    if (!/^\d+[dwmqy]$/.test(v)) { input.style.borderColor = 'var(--wr-red)'; return; }
    sendMessageToPlugin('setReviewInterval', { encodedFilename: encodedFilename, interval: v });
    closeAllPickers();
  }
  setBtn.addEventListener('click', function(e) { e.stopPropagation(); commitCustom(); });
  input.addEventListener('keydown', function(e) {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commitCustom(); }
  });
  customRow.appendChild(setBtn);
  picker.appendChild(customRow);

  // Clear option (only if a schedule already exists)
  if (!anchorEl.classList.contains('wr-meta-empty')) {
    var clearOpt = document.createElement('button');
    clearOpt.className = 'wr-sched-opt wr-sched-clear danger';
    clearOpt.textContent = 'Remove schedule';
    clearOpt.addEventListener('click', function(e) {
      e.stopPropagation();
      sendMessageToPlugin('setReviewInterval', { encodedFilename: encodedFilename, interval: '' });
      closeAllPickers();
    });
    picker.appendChild(clearOpt);
  }

  document.body.appendChild(picker);
  positionPickerAt(picker, anchorEl);
  setTimeout(function() { document.addEventListener('click', closePickerOnOutsideClick); }, 10);
}

function positionPickerAt(picker, anchorEl) {
  var rect = anchorEl.getBoundingClientRect();
  picker.style.top = (rect.bottom + 4) + 'px';
  // Keep picker within viewport
  var width = 220;
  picker.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px';
}

function handleCardMetaUpdated(data) {
  var card = document.querySelector('.wr-card[data-encoded-filename="' + data.encodedFilename + '"]');
  if (!card) return;

  // Update meta row HTML
  var meta = card.querySelector('.wr-card-meta');
  if (meta && data.metaHTML !== undefined) {
    meta.innerHTML = data.metaHTML;
    bindMetaEditable(meta);
  }

  // Update review pill (replace outerHTML so classes refresh too)
  if (data.pillHTML) {
    var pill = card.querySelector('.wr-card-top .wr-review-pill');
    if (pill) {
      var tmp = document.createElement('div');
      tmp.innerHTML = data.pillHTML;
      var newPill = tmp.firstElementChild;
      if (newPill) pill.replaceWith(newPill);
    }
  }

  // Update card status / lifecycle attrs and stripe class
  if (data.status) {
    card.dataset.status = data.status;
    var stripe = card.querySelector('.wr-card-stripe');
    if (stripe) stripe.className = 'wr-card-stripe ' + data.status;
  }
  if (data.lifecycle) card.dataset.lifecycle = data.lifecycle;

  // Re-apply filters in case lifecycle/status now hides the card
  applyFilters();
  showToast('Updated');
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
// FILTERS (review status + type + lifecycle + hide-done-tasks)
// ============================================

var filterState = {
  statusFilter: 'all',
  typeFilter: 'all',
  lifecycleFilter: 'all',
  hideCompletedTasks: false,
};

function readInitialFilterState() {
  var bar = document.querySelector('.wr-filter-bar');
  if (!bar) return;
  filterState.statusFilter = bar.dataset.statusFilter || 'all';
  filterState.typeFilter = bar.dataset.typeFilter || 'all';
  filterState.lifecycleFilter = bar.dataset.lifecycleFilter || 'all';
  filterState.hideCompletedTasks = bar.dataset.hideDoneTasks === '1';
  applyHideDoneTasksClass();
}

function persistFilterState() {
  sendMessageToPlugin('saveFilters', {
    statusFilter: filterState.statusFilter,
    typeFilter: filterState.typeFilter,
    lifecycleFilter: filterState.lifecycleFilter,
    hideCompletedTasks: filterState.hideCompletedTasks,
  });
}

function handleFilterClick(btn) {
  var filter = btn.dataset.filter;
  if (filter) {
    filterState.statusFilter = filter;
    btn.closest('.wr-filter-group').querySelectorAll('.wr-filter-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    applyFilters();
    persistFilterState();
  }
}

function handleShowOptClick(btn) {
  var group = btn.dataset.group;
  var value = btn.dataset.value;
  if (!group || !value) return;
  if (group === 'type') filterState.typeFilter = value;
  else if (group === 'lifecycle') filterState.lifecycleFilter = value;
  // Update active state within the same section
  var section = btn.parentElement;
  if (section) {
    section.querySelectorAll('.wr-show-opt').forEach(function(o) { o.classList.remove('active'); });
  }
  btn.classList.add('active');
  updateShowLabel();
  applyFilters();
  persistFilterState();
}

function updateShowLabel() {
  var label = document.querySelector('#wr-show-btn .wr-show-label');
  if (!label) return;
  var lf = filterState.lifecycleFilter, tf = filterState.typeFilter;
  var lifecycleLabels = { active: 'Active', paused: 'Paused', someday: 'Someday', completed: 'Completed', cancelled: 'Cancelled' };
  var typeLabels = { project: 'projects', area: 'areas' };
  if (tf === 'all' && lf === 'all') { label.textContent = 'Show: All'; return; }
  var parts = [];
  if (lf !== 'all') parts.push(lifecycleLabels[lf]);
  if (tf !== 'all') parts.push(typeLabels[tf]);
  else if (lf !== 'all') parts.push('items');
  label.textContent = 'Show: ' + parts.join(' ');
}

function toggleShowPopover() {
  var pop = document.getElementById('wr-show-popover');
  if (!pop) return;
  if (pop.hasAttribute('hidden')) {
    pop.removeAttribute('hidden');
    setTimeout(function() {
      document.addEventListener('click', closeShowPopoverOnOutside);
    }, 10);
  } else {
    pop.setAttribute('hidden', '');
    document.removeEventListener('click', closeShowPopoverOnOutside);
  }
}

function closeShowPopoverOnOutside(e) {
  if (e.target.closest('#wr-show-popover') || e.target.closest('#wr-show-btn')) return;
  var pop = document.getElementById('wr-show-popover');
  if (pop) pop.setAttribute('hidden', '');
  document.removeEventListener('click', closeShowPopoverOnOutside);
}

function handleHideDoneToggle() {
  filterState.hideCompletedTasks = !filterState.hideCompletedTasks;
  applyHideDoneTasksClass();
  var btn = document.getElementById('wr-hide-done-btn');
  if (btn) {
    btn.classList.toggle('active', filterState.hideCompletedTasks);
    btn.setAttribute('data-tooltip', filterState.hideCompletedTasks ? 'Show completed tasks' : 'Hide completed tasks');
    var icon = btn.querySelector('i');
    if (icon) icon.className = 'fa-regular ' + (filterState.hideCompletedTasks ? 'fa-eye-slash' : 'fa-eye');
  }
  persistFilterState();
}

function applyHideDoneTasksClass() {
  document.body.classList.toggle('wr-hide-done-tasks', !!filterState.hideCompletedTasks);
}

function applyFilters() {
  var cards = document.querySelectorAll('.wr-card');
  var sections = document.querySelectorAll('.wr-section');

  cards.forEach(function(card) {
    var ok = true;
    if (filterState.statusFilter !== 'all' && card.dataset.status !== filterState.statusFilter) ok = false;
    if (ok && filterState.typeFilter !== 'all' && card.dataset.type !== filterState.typeFilter) ok = false;
    if (ok && filterState.lifecycleFilter !== 'all' && card.dataset.lifecycle !== filterState.lifecycleFilter) ok = false;
    card.style.display = ok ? '' : 'none';
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
  // Review status filter pills
  document.querySelectorAll('.wr-filter-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { handleFilterClick(btn); });
  });

  // Show dropdown button
  var showBtn = document.getElementById('wr-show-btn');
  if (showBtn) {
    showBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      toggleShowPopover();
    });
  }
  document.querySelectorAll('.wr-show-opt').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      handleShowOptClick(btn);
    });
  });

  // Hide-completed-tasks toggle
  var hideBtn = document.getElementById('wr-hide-done-btn');
  if (hideBtn) {
    hideBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      handleHideDoneToggle();
    });
  }

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

  // Editable meta items (interval / reviewed date)
  bindMetaEditable(document);
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
  readInitialFilterState();
  attachAllEventListeners();
  applyFilters();
});
